import json
import os
import re
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import jwt
import pymysql
import requests
from flask import Flask, g, jsonify, request
from flask.json.provider import DefaultJSONProvider
from pymysql.cursors import DictCursor

APP_NOMBRE = "ms-pastillero"
APP_VERSION = "2.0.0"

# Conexion a MySQL. Si falta alguna variable, el servicio no arranca.
BD_HOST = os.environ.get("BD_HOST", "")
BD_PUERTO = int(os.environ.get("BD_PUERTO", "3306"))
BD_NOMBRE = os.environ.get("BD_NOMBRE", "")
BD_USUARIO = os.environ.get("BD_USUARIO", "")
BD_CLAVE = os.environ.get("BD_CLAVE", "")

_faltantes = [
    nombre for nombre, valor in (
        ("BD_HOST", BD_HOST), ("BD_NOMBRE", BD_NOMBRE),
        ("BD_USUARIO", BD_USUARIO), ("BD_CLAVE", BD_CLAVE),
    ) if not valor.strip()
]
if _faltantes:
    raise RuntimeError(
        "ms-pastillero no arranca: faltan las variables de conexion a MySQL (%s). "
        "Copie .env.ejemplo a .env." % ", ".join(_faltantes)
    )
VIGIA_URL = os.environ.get("VIGIA_URL", "http://ms-vigia:8081")
# Solo para comprobar la deuda al egresar a un interno; ver saldo_pendiente().
CAJA_URL = os.environ.get("CAJA_URL", "http://ms-caja:8083")
TOLERANCIA_MIN = int(os.environ.get("TOLERANCIA_MIN", 60))

# Secreto compartido con ms-gateway. Sin valor por defecto a proposito: un
# secreto escrito en el codigo es un secreto publicado.
SECRETO = os.environ.get("GATEWAY_SECRETO", "")
if len(SECRETO.strip()) < 16:
    raise RuntimeError(
        "ms-pastillero no arranca: falta la variable de entorno GATEWAY_SECRETO "
        "(o mide menos de 16 caracteres). Copie .env.ejemplo a .env y genere "
        "un secreto con: openssl rand -hex 32"
    )

# El medico prescribe el plan y enfermeria registra cada toma. Administracion
# no ve el tratamiento de nadie.
ROLES_LECTURA = ("MEDICO", "ENFERMERIA")
ROLES_ESCRITURA = ("MEDICO", "ENFERMERIA")

# Excepcion, simetrica a la del medico en ms-caja: administracion lee el
# padron porque le cobra a la familia de cada interno, pero NO recibe la parte
# clinica de la ficha (ver ficha_json). Saber que el interno esta aqui es
# administrativo; saber que tiene demencia mixta es clinico.
PADRON_DE_INTERNOS = re.compile(r"^/api/v1/internos(/[^/]+)?/?$")

# Suspender es solo del MEDICO: no es registrar lo que paso, es revocar una
# decision clinica, y esa la toma quien la firmo. Enfermeria consigna hechos
# con "omitir", que exige motivo.
SUSPENDER_PLAN = re.compile(r"^/api/v1/planes/[^/]+/suspender/?$")
ROLES_SUSPENDER = ("MEDICO",)

# El padron lo gestiona el ADMINISTRADOR: alta, datos administrativos y
# egreso. Es la misma matriz del gateway, repetida aqui por si alguien entra
# por la red interna. No alcanza ninguna otra ruta de ms-pastillero: no
# prescribe, no administra tomas y no suspende planes.
PADRON_ESCRITURA = re.compile(r"^/api/v1/internos(/[^/]+(/egreso)?)?/?$")
ROLES_PADRON = ("ADMINISTRADOR",)

# La simetrica: psicopatologias, alergias y medicacion permanente las escribe
# el MEDICO y nadie mas, ni siquiera quien gestiona el padron. Son los datos
# con los que ms-vigia decide si bloquea un medicamento, y por eso no pueden
# quedar en manos de un rol administrativo.
FICHA_CLINICA = re.compile(r"^/api/v1/internos/[^/]+/clinica/?$")
ROLES_FICHA_CLINICA = ("MEDICO",)

# La sonda de vida no expone datos y Docker la consulta sin token.
RUTAS_LIBRES = ("/salud",)

TURNOS = [
    {"clave": "matutino", "nombre": "Matutino", "desde": 6, "hasta": 14},
    {"clave": "vespertino", "nombre": "Vespertino", "desde": 14, "hasta": 22},
    {"clave": "nocturno", "nombre": "Nocturno", "desde": 22, "hasta": 6},
]

# MySQL devuelve Decimal y datetime, y ninguno sabe convertirse solo a JSON.
class ProveedorJSON(DefaultJSONProvider):
    @staticmethod
    def default(objeto):
        if isinstance(objeto, Decimal):
            return float(objeto)
        if isinstance(objeto, datetime):
            return objeto.isoformat(timespec="seconds")
        if isinstance(objeto, date):
            return objeto.isoformat()
        return DefaultJSONProvider.default(objeto)


app = Flask(__name__)
app.json = ProveedorJSON(app)
app.json.ensure_ascii = False


def abrir_conexion():
    return pymysql.connect(
        host=BD_HOST, port=BD_PUERTO, user=BD_USUARIO, password=BD_CLAVE,
        database=BD_NOMBRE, charset="utf8mb4", cursorclass=DictCursor,
        # Nada queda escrito hasta el commit() de la peticion.
        autocommit=False, connect_timeout=5,
    )


def conexion():
    """Una conexion por peticion, guardada en g y cerrada en el teardown."""
    if "bd" not in g:
        g.bd = abrir_conexion()
    return g.bd


@app.teardown_appcontext
def cerrar_conexion(_):
    bd = g.pop("bd", None)
    if bd is not None:
        bd.close()


def consultar(sql, parametros=()):
    with conexion().cursor() as cursor:
        cursor.execute(sql, parametros)
        return cursor.fetchall()


def consultar_uno(sql, parametros=()):
    with conexion().cursor() as cursor:
        cursor.execute(sql, parametros)
        return cursor.fetchone()


def ejecutar(sql, parametros=()):
    with conexion().cursor() as cursor:
        cursor.execute(sql, parametros)
        return cursor.rowcount


def esperar_a_mysql(intentos=30, pausa=2):
    """El healthcheck del compose ayuda, pero no alcanza.

    Que MySQL responda al ping no garantiza que los scripts de inicializacion
    ya hayan creado la base y el usuario de este servicio. Se reintenta hasta
    conseguir una conexion de verdad, y si no se logra se sale con un mensaje
    que dice exactamente contra que se estaba intentando.
    """
    for intento in range(1, intentos + 1):
        try:
            prueba = abrir_conexion()
            prueba.close()
            print("[%s] conectado a MySQL en %s:%s/%s" %
                  (APP_NOMBRE, BD_HOST, BD_PUERTO, BD_NOMBRE), flush=True)
            return
        except pymysql.MySQLError as error:
            print("[%s] MySQL todavia no acepta conexiones (intento %d de %d): %s" %
                  (APP_NOMBRE, intento, intentos, error), flush=True)
            time.sleep(pausa)
    raise RuntimeError(
        "%s no arranca: MySQL en %s:%s/%s no acepto conexiones despues de %d "
        "intentos. Revise que el contenedor bd-asilo este arriba y que las "
        "claves de .env coincidan con sql/01-bases-y-usuarios.sql."
        % (APP_NOMBRE, BD_HOST, BD_PUERTO, BD_NOMBRE, intentos)
    )


def turno_de(momento):
    hora = momento.hour
    for t in TURNOS:
        if t["desde"] < t["hasta"]:
            if t["desde"] <= hora < t["hasta"]:
                return t["clave"]
        else:  # nocturno cruza la medianoche
            if hora >= t["desde"] or hora < t["hasta"]:
                return t["clave"]
    return "matutino"


def estado_efectivo(fila, ahora=None):
    """Una toma pendiente cuya hora ya paso con holgura se considera VENCIDA."""
    ahora = ahora or datetime.now()
    if fila["estado"] != "PENDIENTE":
        return fila["estado"]
    # La columna es DATETIME: llega como datetime, no hay texto que interpretar.
    if ahora - fila["programado_para"] > timedelta(minutes=TOLERANCIA_MIN):
        return "VENCIDA"
    return "PENDIENTE"


def toma_json(fila, plan=None):
    return {
        "id": fila["id"],
        "planId": fila["plan_id"],
        "pacienteId": fila["paciente_id"],
        "farmaco": plan["farmaco"] if plan else fila["farmaco"],
        "principioActivo": plan["principio_activo"] if plan else fila["principio_activo"],
        "dosisMg": plan["dosis_mg"] if plan else fila["dosis_mg"],
        "via": plan["via"] if plan else fila["via"],
        # Texto ISO: la interfaz hace new Date(programadoPara).
        "programadoPara": fila["programado_para"].isoformat(timespec="minutes"),
        "hora": fila["programado_para"].strftime("%H:%M"),
        "turno": fila["turno"],
        "estado": estado_efectivo(fila),
        "enfermero": fila["enfermero"],
        "observacion": fila["observacion"],
        "registradoEn": (fila["registrado_en"].isoformat(timespec="seconds")
                         if fila["registrado_en"] else None),
    }

def consultar_dictamen(folio):
    """Devuelve (dictamen, error). Nunca lanza excepcion hacia el endpoint.

    ms-vigia ahora tambien exige token, asi que se le reenvia el de quien pidio
    programar el plan. La consulta viaja con la identidad de esa persona y no
    con una credencial de servicio: si el medico no puede leer la bitacora,
    tampoco puede leerla a traves del pastillero.
    """
    try:
        r = requests.get(
            "%s/api/v1/validaciones/%s" % (VIGIA_URL, folio),
            headers={"Authorization": request.headers.get("Authorization", "")},
            timeout=4,
        )
    except requests.RequestException:
        return None, "MS-VIGIA no responde. No se puede programar sin dictamen de farmacovigilancia."
    if r.status_code == 404:
        return None, "El folio %s no existe en MS-VIGIA." % folio
    if r.status_code != 200:
        return None, "MS-VIGIA respondio con codigo %d." % r.status_code
    return r.json(), None

# El gateway ya valido el token, pero aqui se vuelve a validar: defensa en
# profundidad, por si alguien alcanza la red interna y llama directo.
#
# Sin encabezados CORS: este servicio no publica puerto y ningun navegador le
# habla de forma directa.
@app.before_request
def exigir_sesion():
    if request.method == "OPTIONS" or request.path in RUTAS_LIBRES:
        return None

    partes = request.headers.get("Authorization", "").split(" ", 1)
    if len(partes) != 2 or partes[0] != "Bearer" or not partes[1].strip():
        return jsonify({
            "error": "Falta el token de sesion. Inicie sesion en ms-gateway.",
        }), 401

    try:
        g.sesion = jwt.decode(partes[1].strip(), SECRETO, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return jsonify({"error": "La sesion expiro. Inicie sesion de nuevo."}), 401
    except jwt.InvalidTokenError:
        return jsonify({"error": "Token invalido."}), 401

    escribe = request.method not in ("GET", "HEAD")
    permitidos = ROLES_ESCRITURA if escribe else ROLES_LECTURA
    if not escribe and PADRON_DE_INTERNOS.match(request.path):
        permitidos = permitidos + ("ADMINISTRACION", "ADMINISTRADOR")
    # El orden importa: /clinica se comprueba antes, y PADRON_ESCRITURA no la
    # abarca, para que el administrador no pueda escribir alergias por el
    # camino de los datos administrativos.
    if escribe and FICHA_CLINICA.match(request.path):
        permitidos = ROLES_FICHA_CLINICA
    elif escribe and PADRON_ESCRITURA.match(request.path):
        permitidos = ROLES_PADRON
    if escribe and SUSPENDER_PLAN.match(request.path):
        permitidos = ROLES_SUSPENDER

    if g.sesion.get("rol") not in permitidos:
        if escribe and SUSPENDER_PLAN.match(request.path):
            detalle = "suspender un tratamiento: es una decision clinica y la revoca el medico"
        elif escribe and FICHA_CLINICA.match(request.path):
            detalle = ("escribir la parte clinica de la ficha: psicopatologias, alergias "
                       "y medicacion permanente las registra el medico")
        elif escribe and PADRON_ESCRITURA.match(request.path):
            detalle = "gestionar el padron de internos: eso es del administrador"
        else:
            detalle = ("escribir en el pastillero" if escribe else "leer el pastillero")
        return jsonify({
            "error": "Su rol (%s) no esta autorizado para %s."
                     % (g.sesion.get("rol"), detalle),
            "rolesPermitidos": list(permitidos),
        }), 403
    return None


def firmante():
    """Quien esta actuando, tomado del token y nunca del cuerpo de la peticion.

    Antes el cliente mandaba prescritoPor y enfermero, de modo que cualquiera
    podia dejar firmada una toma a nombre de otra persona. La hoja de
    administracion de medicamentos es un documento legal: la firma quien inicio
    sesion.
    """
    return g.sesion.get("nombre") or g.sesion.get("usuario") or "no indicado"


def token_de_servicio():
    """Credencial con la que ms-pastillero le pregunta a ms-caja.

    Quien egresa a un interno es el ADMINISTRADOR, que no puede leer la caja:
    eso es de ADMINISTRACION. Pero el egreso tiene que poder advertir que la
    familia queda debiendo, y para eso hay que mirar la cuenta.

    Mismo mecanismo que ya usa ms-consultas para cobrar: un token firmado con
    el secreto compartido que dice que quien pregunta es ms-pastillero (rol
    SERVICIO), en nombre de quien lo pide, y que dura un minuto. ms-caja
    acepta el rol SERVICIO solo para crear cargos y para LEER la cuenta de un
    interno: nunca para el balance del asilo, las donaciones o los gastos.
    """
    ahora = int(time.time())
    return jwt.encode(
        {
            "usuario": APP_NOMBRE,
            "nombre": firmante(),
            "rol": "SERVICIO",
            "emisor": APP_NOMBRE,
            "iat": ahora,
            "exp": ahora + 60,
        },
        SECRETO,
        algorithm="HS256",
    )


def saldo_pendiente(paciente_id):
    """Cuanto debe la familia del interno. Devuelve (deuda, aviso).

    Si ms-caja no responde NO se aborta el egreso: se devuelve un aviso de que
    no se pudo comprobar la deuda. Un interno no se queda sin egresar porque
    la caja este caida, igual que una consulta no se queda sin abrir porque no
    se pudo cobrar.
    """
    try:
        r = requests.get(
            "%s/api/v1/pacientes/%s/cuenta" % (CAJA_URL, paciente_id),
            headers={"Authorization": "Bearer " + token_de_servicio()},
            timeout=4,
        )
    except requests.RequestException:
        return None, ("No se pudo comprobar si el interno queda debiendo: "
                      "MS-CAJA no responde. El egreso se hizo igual; revise la "
                      "cuenta a mano.")
    if r.status_code != 200:
        return None, ("No se pudo comprobar si el interno queda debiendo: "
                      "MS-CAJA respondio con codigo %d. El egreso se hizo igual."
                      % r.status_code)
    cuenta = r.json()
    saldo = float(cuenta.get("saldoPendiente") or 0)
    if saldo <= 0:
        return None, None
    return {"saldo": saldo,
            "cargosPendientes": int(cuenta.get("cargosPendientes") or 0)}, None



def _sello_informe(nombre):
    """Quien pidio el informe y cuando, para la cabecera de la hoja impresa.

    Sale del token y no del cliente, por la misma razon que el resto de la
    bitacora: un informe impreso lleva el nombre de quien tenia la sesion
    abierta, no el que diga el navegador. Que el dato se vea igual no es
    suficiente; lo que se esta defendiendo es de donde viene.
    """
    return {
        "informe": nombre,
        "generadoEn": datetime.now().isoformat(timespec="seconds"),
        "generadoPor": firmante(),
    }


@app.get("/salud")
def salud():
    bd = conexion()
    return jsonify({
        "servicio": APP_NOMBRE,
        "version": APP_VERSION,
        "estado": "arriba",
        "planesActivos": consultar_uno(
            "SELECT COUNT(*) n FROM planes WHERE estado='ACTIVO'")["n"],
        "tomasRegistradas": consultar_uno("SELECT COUNT(*) n FROM tomas")["n"],
        "dependeDe": VIGIA_URL,
        "hora": datetime.now().isoformat(timespec="seconds"),
    })


# Padron de internos.
#
# La ficha vive aqui, del lado del servidor, y no en el navegador: ms-vigia
# bloquea medicamentos con la edad, las alergias y las psicopatologias. Si el
# cliente la enviara, bastaria vaciar el arreglo de alergias para que el
# sistema aprobara furosemida a una paciente alergica a las sulfas.

def edad_de(nacimiento, referencia=None):
    """Edad cumplida a partir de la fecha de nacimiento.

    Se calcula y no se guarda. Una edad guardada envejece mal: queda vieja al
    dia siguiente del cumpleanos, y aqui eso no es cosmetico, porque ms-vigia
    aplica criterios geriatricos a partir de ella.
    """
    if nacimiento is None:
        return None
    hoy = referencia or date.today()
    # Se resta un ano si todavia no ha llegado el cumpleanos de este ano.
    return hoy.year - nacimiento.year - (
        (hoy.month, hoy.day) < (nacimiento.month, nacimiento.day))


def ficha_json(fila, incluir_clinico=True):
    """Ficha del interno. Sin la parte clinica si quien pregunta no es clinico."""
    pabellon = fila["pabellon"]
    cama = fila["cama"]
    ficha = {
        "pacienteId": fila["id"],
        "nombre": fila["nombre"],
        "documento": fila["documento"],
        "fechaNacimiento": fila["fecha_nacimiento"].isoformat()
                           if fila["fecha_nacimiento"] else None,
        "edad": edad_de(fila["fecha_nacimiento"]),
        "sexo": fila["sexo"],
        "pabellon": pabellon,
        "cama": cama,
        # Las dos juntas, ya legibles: es como se nombra una cama en la
        # practica y como la pinta la estacion.
        "ubicacion": ", ".join(p for p in (pabellon,
                                           "cama %s" % cama if cama else None) if p) or None,
        # La columna es DATE; el personal la lee en dd/mm/aaaa.
        "ingreso": fila["ingreso"].strftime("%d/%m/%Y") if fila["ingreso"] else None,
        "motivoIngreso": fila["motivo_ingreso"],
        "responsable": fila["responsable"],
        # De contacto, no clinico: ms-consultas avisa al familiar y
        # administracion le cobra.
        "correoResponsable": fila["correo_responsable"],
        "estado": fila["estado"],
        "egreso": None,
    }
    if fila["estado"] == "EGRESADO":
        ficha["egreso"] = {
            "fecha": fila["egreso_fecha"].strftime("%d/%m/%Y")
                     if fila["egreso_fecha"] else None,
            "motivo": fila["egreso_motivo"],
        }
    if incluir_clinico:
        ficha["psicopatologias"] = json.loads(fila["psicopatologias"])
        ficha["alergias"] = json.loads(fila["alergias"])
        ficha["medicacionPermanente"] = json.loads(fila["medicacion_permanente"])
    return ficha


def puede_ver_lo_clinico():
    # ADMINISTRADOR gestiona el padron pero no es personal clinico: ve los
    # datos administrativos del interno, no sus psicopatologias.
    return g.sesion.get("rol") in ("MEDICO", "ENFERMERIA")
@app.get("/api/v1/internos")
def listar_internos():
    """El padron. Por omision solo los ACTIVOS.

    Un egresado no desaparece —su historial queda intacto y se le puede pedir
    por su id—, pero deja de salir en el padron: la jornada de enfermeria y el
    selector de internos no tienen por que ofrecer a alguien que ya no vive
    aqui. Con ?estado=EGRESADO o ?estado=TODOS se ven los demas.
    """
    estado = (request.args.get("estado") or "ACTIVO").strip().upper()
    if estado not in ("ACTIVO", "EGRESADO", "TODOS"):
        return jsonify({
            "error": "estado tiene que ser ACTIVO, EGRESADO o TODOS.",
            "recibido": estado,
        }), 400

    if estado == "TODOS":
        filas = consultar("SELECT * FROM internos ORDER BY nombre")
    else:
        filas = consultar(
            "SELECT * FROM internos WHERE estado = %s ORDER BY nombre", (estado,))

    activos = {
        f["paciente_id"]: f["n"]
        for f in consultar(
            "SELECT paciente_id, COUNT(*) n FROM planes WHERE estado='ACTIVO' "
            "GROUP BY paciente_id")
    }
    clinico = puede_ver_lo_clinico()
    internos = []
    for f in filas:
        ficha = ficha_json(f, clinico)
        ficha["planesActivos"] = activos.get(f["id"], 0)
        internos.append(ficha)
    return jsonify({"total": len(internos), "estado": estado, "internos": internos})


def medicacion_actual_de(paciente_id, fila=None):
    """Todo lo que el interno tiene encima ahora mismo, de las DOS fuentes.

    Un plan de tomas es lo que se le administra por turnos aqui dentro. La
    medicacion permanente es lo que ya tomaba antes de entrar —las "medicinas
    de cajon"— y que nadie programa porque la toma por su cuenta.

    Las dos cuentan igual para la farmacovigilancia: a ms-vigia le da lo mismo
    de donde salga la warfarina, lo que necesita saber es que el interno la
    tiene encima antes de dejar pasar un ibuprofeno. Mientras esta lista se
    armaba solo con los planes, registrar un farmaco como permanente no
    protegia de nada: la ficha lo mostraba y el motor no lo miraba.

    Si un principio activo esta en los dos lados cuenta UNA sola vez, y gana el
    plan: lleva dosis y pauta vigentes, y un planId con el que suspenderlo.
    """
    medicacion = []
    vistos = set()

    for p in consultar(
        "SELECT id, principio_activo, farmaco, dosis_mg, cada_horas, via "
        "FROM planes WHERE paciente_id = %s AND estado = 'ACTIVO'",
        (paciente_id,)
    ):
        vistos.add(p["principio_activo"])
        medicacion.append({
            "planId": p["id"],
            "principioActivo": p["principio_activo"],
            "farmaco": p["farmaco"],
            "dosisMg": p["dosis_mg"],
            "cadaHoras": p["cada_horas"],
            "via": p["via"],
            "origen": "PLAN",
        })

    if fila is None:
        fila = consultar_uno(
            "SELECT medicacion_permanente FROM internos WHERE id = %s", (paciente_id,))
    if fila is None:
        return medicacion

    for m in json.loads(fila["medicacion_permanente"]):
        clave = m.get("principioActivo")
        if not clave or clave in vistos:
            continue
        vistos.add(clave)
        medicacion.append({
            "planId": None,
            "principioActivo": clave,
            "farmaco": m.get("farmaco") or clave,
            "dosisMg": m.get("dosisMg"),
            "cadaHoras": m.get("cadaHoras"),
            "via": m.get("via"),
            "origen": "PERMANENTE",
        })

    return medicacion


@app.get("/api/v1/internos/<paciente_id>")
def obtener_interno(paciente_id):
    fila = consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,))
    if fila is None:
        return jsonify({"error": "No existe el interno %s." % paciente_id}), 404

    clinico = puede_ver_lo_clinico()
    ficha = ficha_json(fila, clinico)
    if clinico:
        ficha["medicacionActual"] = medicacion_actual_de(paciente_id, fila)
    return jsonify(ficha)


@app.get("/api/v1/turnos")
def listar_turnos():
    ahora = datetime.now()
    return jsonify({
        "turnos": TURNOS,
        "turnoActual": turno_de(ahora),
        "hora": ahora.strftime("%H:%M"),
    })


@app.get("/api/v1/pacientes")
def listar_pacientes():
    filas = consultar(
        """SELECT paciente_id, paciente_nombre, COUNT(*) planes
           FROM planes WHERE estado='ACTIVO'
           GROUP BY paciente_id, paciente_nombre ORDER BY paciente_nombre""")
    return jsonify({"pacientes": [
        {"pacienteId": f["paciente_id"], "nombre": f["paciente_nombre"], "planesActivos": f["planes"]}
        for f in filas
    ]})


@app.get("/api/v1/pacientes/<paciente_id>/medicacion-activa")
def medicacion_activa(paciente_id):
    """Lo que el interno recibe ahora mismo.

    Se devuelve tambien el planId para que la estacion pueda ofrecer
    suspender ese tratamiento sin tener que buscar el plan por otro lado.
    """
    # La misma fusion que la ficha: quien mira lo que el interno tiene
    # encima tiene que ver tambien lo que toma por su cuenta.
    return jsonify({"pacienteId": paciente_id,
                    "medicacionActual": medicacion_actual_de(paciente_id)})


@app.post("/api/v1/planes")
def crear_plan():
    cuerpo = request.get_json(silent=True) or {}
    errores = []
    for campo in ("pacienteId", "principioActivo"):
        if not cuerpo.get(campo):
            errores.append("Falta %s." % campo)
    try:
        dosis = float(cuerpo.get("dosisMg"))
        if dosis <= 0:
            errores.append("dosisMg debe ser mayor que cero.")
    except (TypeError, ValueError):
        errores.append("dosisMg debe ser numerico.")
    try:
        cada = float(cuerpo.get("cadaHoras"))
        if not 1 <= cada <= 72:
            errores.append("cadaHoras debe estar entre 1 y 72.")
    except (TypeError, ValueError):
        errores.append("cadaHoras debe ser numerico.")
    try:
        dias = int(cuerpo.get("dias", 1))
        if not 1 <= dias <= 90:
            errores.append("dias debe estar entre 1 y 90.")
    except (TypeError, ValueError):
        errores.append("dias debe ser numerico.")
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    folio = cuerpo.get("folioValidacion")
    dictamen = None
    if folio:
        dictamen, problema = consultar_dictamen(folio)
        if problema:
            return jsonify({"error": problema}), 422
        if dictamen["pacienteId"] != cuerpo["pacienteId"]:
            return jsonify({"error": "El folio %s pertenece a otro paciente." % folio}), 409
        if dictamen["veredicto"] == "BLOQUEADO":
            return jsonify({
                "error": "MS-VIGIA bloqueo esta prescripcion. No se programa el pastillero.",
                "folio": folio,
                "hallazgos": dictamen["hallazgos"],
            }), 409

    inicio_txt = cuerpo.get("inicio")
    try:
        inicio = datetime.fromisoformat(inicio_txt) if inicio_txt else datetime.now().replace(
            second=0, microsecond=0)
    except ValueError:
        return jsonify({"error": "inicio debe tener formato ISO (AAAA-MM-DDTHH:MM)."}), 400

    plan_id = "PL-" + uuid.uuid4().hex[:8].upper()
    farmaco = cuerpo.get("farmaco") or cuerpo["principioActivo"].replace("_", " ").capitalize()
    bd = conexion()
    # El plan y sus tomas van en una transaccion: un plan sin tomas no sirve y
    # unas tomas sin plan son huerfanas.
    try:
        ejecutar(
            """INSERT INTO planes (id, paciente_id, paciente_nombre, principio_activo,
                                   farmaco, dosis_mg, via, cada_horas, dias, indicacion,
                                   folio_validacion, prescrito_por, inicio, estado, creado_en)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ACTIVO',%s)""",
            (plan_id, cuerpo["pacienteId"], cuerpo.get("pacienteNombre"),
             cuerpo["principioActivo"], farmaco, dosis, (cuerpo.get("via") or "oral").lower(),
             cada, dias, cuerpo.get("indicacion"), folio, firmante(),
             inicio, datetime.now().replace(microsecond=0)),
        )
        tomas = generar_tomas(plan_id, cuerpo["pacienteId"], inicio, cada, dias)
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    return jsonify({
        "planId": plan_id,
        "pacienteId": cuerpo["pacienteId"],
        "farmaco": farmaco,
        "dosisMg": dosis,
        "cadaHoras": cada,
        "dias": dias,
        "folioValidacion": folio,
        "veredictoVigia": dictamen["veredicto"] if dictamen else "SIN_VALIDACION",
        "tomasProgramadas": len(tomas),
        "primeraToma": tomas[0]["programadoPara"],
        "ultimaToma": tomas[-1]["programadoPara"],
        "tomas": tomas,
    }), 201


def generar_tomas(plan_id, paciente_id, inicio, cada_horas, dias):
    """Expande la pauta medica en tomas con hora exacta.

    Corre dentro de la transaccion que abrio crear_plan: no confirma nada.
    """
    total = max(1, int(round(dias * 24 / cada_horas)))
    generadas = []
    for i in range(total):
        momento = inicio + timedelta(hours=cada_horas * i)
        toma_id = "TM-" + uuid.uuid4().hex[:10].upper()
        ejecutar(
            "INSERT INTO tomas (id, plan_id, paciente_id, programado_para, turno, estado) "
            "VALUES (%s,%s,%s,%s,%s, 'PENDIENTE')",
            (toma_id, plan_id, paciente_id, momento, turno_de(momento)),
        )
        generadas.append({
            "id": toma_id,
            "programadoPara": momento.isoformat(timespec="minutes"),
            "turno": turno_de(momento),
        })
    return generadas


@app.get("/api/v1/planes/<plan_id>")
def obtener_plan(plan_id):
    plan = consultar_uno("SELECT * FROM planes WHERE id = %s", (plan_id,))
    if plan is None:
        return jsonify({"error": "No existe el plan %s." % plan_id}), 404
    filas = consultar(
        "SELECT * FROM tomas WHERE plan_id = %s ORDER BY programado_para", (plan_id,))
    return jsonify({
        "planId": plan["id"],
        "pacienteId": plan["paciente_id"],
        "pacienteNombre": plan["paciente_nombre"],
        "farmaco": plan["farmaco"],
        "dosisMg": plan["dosis_mg"],
        "via": plan["via"],
        "cadaHoras": plan["cada_horas"],
        "dias": plan["dias"],
        "indicacion": plan["indicacion"],
        "folioValidacion": plan["folio_validacion"],
        "estado": plan["estado"],
        "tomas": [toma_json(f, plan) for f in filas],
    })


@app.post("/api/v1/planes/<plan_id>/suspender")
def suspender_plan(plan_id):
    motivo = (request.get_json(silent=True) or {}).get("motivo", "sin motivo indicado")
    bd = conexion()
    plan = consultar_uno("SELECT * FROM planes WHERE id = %s", (plan_id,))
    if plan is None:
        return jsonify({"error": "No existe el plan %s." % plan_id}), 404
    ahora = datetime.now().replace(microsecond=0)
    # Toca el plan y sus tomas futuras: o cambian las dos tablas, o ninguna.
    try:
        ejecutar("UPDATE planes SET estado='SUSPENDIDO' WHERE id = %s", (plan_id,))
        ejecutar(
            "UPDATE tomas SET estado='OMITIDA', observacion=%s, registrado_en=%s "
            "WHERE plan_id = %s AND estado='PENDIENTE' AND programado_para > %s",
            ("Plan suspendido: " + motivo, ahora, plan_id, ahora),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    return jsonify({"planId": plan_id, "estado": "SUSPENDIDO", "motivo": motivo})


@app.get("/api/v1/pacientes/<paciente_id>/tomas")
def tomas_paciente(paciente_id):
    """Tomas de un dia. Es la hoja de trabajo del turno de enfermeria."""
    fecha = request.args.get("fecha") or datetime.now().strftime("%Y-%m-%d")
    turno = request.args.get("turno")
    # DATETIME: se filtra con DATE(), no recortando texto.
    filas = consultar(
        """SELECT t.*, p.farmaco, p.principio_activo, p.dosis_mg, p.via, p.indicacion
           FROM tomas t JOIN planes p ON p.id = t.plan_id
           WHERE t.paciente_id = %s AND DATE(t.programado_para) = %s
           ORDER BY t.programado_para""",
        (paciente_id, fecha))
    tomas = [toma_json(f) for f in filas]
    if turno:
        tomas = [t for t in tomas if t["turno"] == turno]
    resumen = {}
    for t in tomas:
        resumen[t["estado"]] = resumen.get(t["estado"], 0) + 1
    return jsonify({
        "pacienteId": paciente_id,
        "fecha": fecha,
        "turnoActual": turno_de(datetime.now()),
        "total": len(tomas),
        "resumen": resumen,
        "tomas": tomas,
    })


@app.post("/api/v1/tomas/<toma_id>/administrar")
def administrar(toma_id):
    cuerpo = request.get_json(silent=True) or {}
    return _registrar(toma_id, "ADMINISTRADA", firmante(), cuerpo.get("observacion"))


@app.post("/api/v1/tomas/<toma_id>/omitir")
def omitir(toma_id):
    cuerpo = request.get_json(silent=True) or {}
    motivo = cuerpo.get("motivo")
    if not motivo:
        return jsonify({"error": "Toda omision necesita un motivo registrado."}), 400
    return _registrar(toma_id, "OMITIDA", firmante(), motivo)


def _registrar(toma_id, nuevo_estado, enfermero, observacion):
    bd = conexion()
    fila = consultar_uno("SELECT * FROM tomas WHERE id = %s", (toma_id,))
    if fila is None:
        return jsonify({"error": "No existe la toma %s." % toma_id}), 404
    if fila["estado"] in ("ADMINISTRADA", "OMITIDA"):
        return jsonify({
            "error": "Esta toma ya fue registrada como %s por %s. Una toma no se registra dos veces."
                     % (fila["estado"], fila["enfermero"]),
        }), 409
    ahora = datetime.now().replace(microsecond=0)
    try:
        ejecutar(
            "UPDATE tomas SET estado=%s, enfermero=%s, observacion=%s, registrado_en=%s "
            "WHERE id=%s",
            (nuevo_estado, enfermero, observacion, ahora, toma_id),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    desfase = int((ahora - fila["programado_para"]).total_seconds() // 60)
    return jsonify({
        "id": toma_id,
        "estado": nuevo_estado,
        "enfermero": enfermero,
        "observacion": observacion,
        "programadoPara": fila["programado_para"].isoformat(timespec="minutes"),
        "registradoEn": ahora.isoformat(timespec="seconds"),
        "desfaseMinutos": desfase,
        "puntual": abs(desfase) <= TOLERANCIA_MIN,
    })


@app.get("/api/v1/pacientes/<paciente_id>/adherencia")
def adherencia(paciente_id):
    """Indicador para el reporte de medicamentos aplicados por paciente."""
    desde = request.args.get("desde") or (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    hasta = request.args.get("hasta") or datetime.now().strftime("%Y-%m-%d")
    filas = consultar(
        """SELECT t.*, p.farmaco FROM tomas t JOIN planes p ON p.id = t.plan_id
           WHERE t.paciente_id = %s AND DATE(t.programado_para) BETWEEN %s AND %s""",
        (paciente_id, desde, hasta))

    conteo = {"ADMINISTRADA": 0, "OMITIDA": 0, "PENDIENTE": 0, "VENCIDA": 0}
    por_farmaco = {}
    for f in filas:
        estado = estado_efectivo(f)
        conteo[estado] = conteo.get(estado, 0) + 1
        d = por_farmaco.setdefault(f["farmaco"], {"programadas": 0, "administradas": 0})
        d["programadas"] += 1
        if estado == "ADMINISTRADA":
            d["administradas"] += 1

    cerradas = conteo["ADMINISTRADA"] + conteo["OMITIDA"] + conteo["VENCIDA"]
    porcentaje = round(conteo["ADMINISTRADA"] / cerradas * 100, 1) if cerradas else None
    salida = _sello_informe("Medicamentos aplicados por paciente")
    salida.update({
        "pacienteId": paciente_id,
        "desde": desde,
        "hasta": hasta,
        "totalProgramadas": len(filas),
        "detalle": conteo,
        "adherenciaPorcentaje": porcentaje,
        "porFarmaco": por_farmaco,
    })
    return jsonify(salida)




# ===========================================================================
#  Gestion del padron de internos
#
#  Hasta aqui el padron solo se leia y se sembraba al arrancar. Estos cuatro
#  endpoints lo hacen gestionable, con una division deliberada: el
#  ADMINISTRADOR lleva los datos administrativos y el MEDICO la parte clinica.
#  No es burocracia: psicopatologias, alergias y medicacion permanente son los
#  datos con los que ms-vigia decide si bloquea un medicamento, y quien lleva
#  camas y expedientes no tiene por que poder cambiarlos.
# ===========================================================================

SEXOS = ("FEMENINO", "MASCULINO", "OTRO")


def _texto(cuerpo, clave, maximo, obligatorio=True):
    """Lee un campo de texto del cuerpo y devuelve (valor, error)."""
    valor = (cuerpo.get(clave) or "").strip()
    if not valor:
        if obligatorio:
            return None, "Falta %s." % clave
        return None, None
    if len(valor) > maximo:
        return None, "%s no puede pasar de %d caracteres." % (clave, maximo)
    return valor, None


def _fecha(cuerpo, clave, obligatorio=True):
    """Lee una fecha AAAA-MM-DD y devuelve (date, error)."""
    valor = (cuerpo.get(clave) or "").strip()
    if not valor:
        return None, ("Falta %s." % clave) if obligatorio else None
    try:
        return date.fromisoformat(valor), None
    except ValueError:
        return None, "%s no es una fecha valida; se espera AAAA-MM-DD." % clave


def _lista_de_textos(cuerpo, clave):
    """Lee una lista de cadenas cortas y devuelve (lista, error)."""
    valor = cuerpo.get(clave, [])
    if valor is None:
        return [], None
    if not isinstance(valor, list):
        return None, "%s tiene que ser una lista." % clave
    limpia = []
    for elemento in valor:
        if not isinstance(elemento, str):
            return None, "%s solo admite texto." % clave
        elemento = elemento.strip()
        if elemento:
            limpia.append(elemento)
    return limpia, None


def _datos_administrativos(cuerpo, para_alta):
    """Valida el bloque administrativo. Devuelve (dict, lista de errores)."""
    errores = []
    datos = {}

    nombre, error = _texto(cuerpo, "nombre", 120)
    if error:
        errores.append(error)
    datos["nombre"] = nombre

    if para_alta:
        documento, error = _texto(cuerpo, "documento", 32)
        if error:
            errores.append(error)
        datos["documento"] = documento

        nacimiento, error = _fecha(cuerpo, "fechaNacimiento")
        if error:
            errores.append(error)
        elif nacimiento > date.today():
            errores.append("fechaNacimiento no puede estar en el futuro.")
        datos["fecha_nacimiento"] = nacimiento

        sexo = (cuerpo.get("sexo") or "").strip().upper()
        if sexo not in SEXOS:
            errores.append("sexo tiene que ser uno de: %s." % ", ".join(SEXOS))
        datos["sexo"] = sexo

    ingreso, error = _fecha(cuerpo, "ingreso", obligatorio=False)
    if error:
        errores.append(error)
    datos["ingreso"] = ingreso

    datos["motivo_ingreso"] = (cuerpo.get("motivoIngreso") or "").strip() or None
    datos["pabellon"] = (cuerpo.get("pabellon") or "").strip() or None
    datos["cama"] = (cuerpo.get("cama") or "").strip() or None
    datos["responsable"] = (cuerpo.get("responsable") or "").strip() or None

    correo = (cuerpo.get("correoResponsable") or "").strip() or None
    # Comprobacion deliberadamente floja: aqui solo se descarta lo que
    # claramente no es un correo. Validar direcciones a fondo con una
    # expresion regular es una fuente conocida de falsos negativos, y el
    # correo se verifica de verdad cuando ms-consultas intenta enviarlo.
    if correo and ("@" not in correo or len(correo) > 160):
        errores.append("correoResponsable no parece una direccion de correo.")
    datos["correo_responsable"] = correo

    return datos, errores


@app.post("/api/v1/internos")
def alta_de_interno():
    """Da de alta a un interno. Solo ADMINISTRADOR (lo exige el guardia)."""
    cuerpo = request.get_json(silent=True) or {}
    datos, errores = _datos_administrativos(cuerpo, para_alta=True)
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    # Id aleatorio y no un correlativo: un MAX(id)+1 colisiona bajo dos altas
    # simultaneas, que es el error que ya se corrigio en los folios de
    # dictamen y no vale la pena repetir.
    paciente_id = "ASL-" + uuid.uuid4().hex[:8].upper()

    bd = conexion()
    try:
        ejecutar(
            """INSERT INTO internos
                   (id, nombre, documento, fecha_nacimiento, sexo, ingreso,
                    motivo_ingreso, pabellon, cama, psicopatologias, alergias,
                    medicacion_permanente, responsable, correo_responsable,
                    estado)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'[]','[]','[]',%s,%s,'ACTIVO')""",
            (paciente_id, datos["nombre"], datos["documento"],
             datos["fecha_nacimiento"], datos["sexo"], datos["ingreso"],
             datos["motivo_ingreso"], datos["pabellon"], datos["cama"],
             datos["responsable"], datos["correo_responsable"]),
        )
        bd.commit()
    except pymysql.err.IntegrityError as error:
        bd.rollback()
        # La unicidad del documento la impone el motor, no una consulta
        # previa: entre el SELECT y el INSERT cabe otra alta.
        if "uq_internos_documento" in str(error) or "Duplicate" in str(error):
            existente = consultar_uno(
                "SELECT id, nombre FROM internos WHERE documento = %s",
                (datos["documento"],))
            return jsonify({
                "error": "Ya hay un interno con el documento %s." % datos["documento"],
                "internoExistente": existente["id"] if existente else None,
                "nombre": existente["nombre"] if existente else None,
            }), 409
        raise
    except Exception:
        bd.rollback()
        raise

    ficha = ficha_json(
        consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,)),
        puede_ver_lo_clinico())
    ficha["nota"] = ("El interno nace sin parte clinica. Las psicopatologias, "
                     "las alergias y la medicacion permanente las registra el "
                     "medico en PUT /api/v1/internos/%s/clinica." % paciente_id)
    return jsonify(ficha), 201


@app.put("/api/v1/internos/<paciente_id>")
def actualizar_interno(paciente_id):
    """Datos administrativos del interno. Solo ADMINISTRADOR.

    El documento, la fecha de nacimiento y el sexo NO se tocan aqui: son la
    identidad de la persona, y corregirlos es rehacer el alta, no editarla.
    """
    fila = consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,))
    if fila is None:
        return jsonify({"error": "No existe el interno %s." % paciente_id}), 404

    cuerpo = request.get_json(silent=True) or {}
    datos, errores = _datos_administrativos(cuerpo, para_alta=False)
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    bd = conexion()
    try:
        ejecutar(
            """UPDATE internos
                  SET nombre=%s, ingreso=%s, motivo_ingreso=%s, pabellon=%s,
                      cama=%s, responsable=%s, correo_responsable=%s
                WHERE id=%s""",
            (datos["nombre"], datos["ingreso"], datos["motivo_ingreso"],
             datos["pabellon"], datos["cama"], datos["responsable"],
             datos["correo_responsable"], paciente_id),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    return jsonify(ficha_json(
        consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,)),
        puede_ver_lo_clinico()))


def vademecum_de_vigia():
    """Los principios activos que ms-vigia conoce. Devuelve (claves, error).

    Se le reenvia el token de quien pregunta, no una credencial de
    servicio, igual que en consultar_dictamen: quien escribe la ficha
    clinica es el medico, y el medico ya puede leer el vademecum.
    """
    try:
        r = requests.get(
            "%s/api/v1/vademecum" % VIGIA_URL,
            headers={"Authorization": request.headers.get("Authorization", "")},
            timeout=4)
    except requests.RequestException:
        return None, "MS-VIGIA no responde."
    if r.status_code != 200:
        return None, "MS-VIGIA respondio con codigo %d." % r.status_code
    datos = r.json()
    claves = set()
    for entrada in datos.get("farmacos", datos.get("vademecum", [])):
        if isinstance(entrada, str):
            claves.add(entrada)
        elif isinstance(entrada, dict):
            clave = entrada.get("principioActivo") or entrada.get("clave")
            if clave:
                claves.add(clave)
    return claves, None


def _medicacion_permanente(cuerpo):
    """Valida la medicacion permanente. Devuelve (lista, errores, sin_vigia).

    Cada entrada tiene que traer un principioActivo que ms-vigia conozca. No
    es burocracia: esta lista entra en los dictamenes, y un principio activo
    mal escrito no da error, da silencio. El farmaco quedaria registrado, la
    ficha lo mostraria y el motor no lo reconoceria, que es exactamente el
    fallo que este cambio vino a cerrar.

    Si ms-vigia no responde no se guarda nada y se devuelve 503. Aqui se esta
    escribiendo un dato del que depende la seguridad del paciente, y escribirlo
    a ciegas es peor que no escribirlo: es el mismo criterio con el que una
    remision aborta si no puede leer la ficha.
    """
    valor = cuerpo.get("medicacionPermanente")
    if not isinstance(valor, list):
        return None, ["medicacionPermanente tiene que ser una lista."], False
    if not valor:
        return [], [], False

    conocidos, fallo = vademecum_de_vigia()
    if fallo:
        return None, [fallo], True

    errores = []
    limpia = []
    vistos = set()
    for i, entrada in enumerate(valor):
        if not isinstance(entrada, dict):
            errores.append("medicacionPermanente[%d] tiene que ser un objeto con "
                           "principioActivo." % i)
            continue
        clave = (entrada.get("principioActivo") or "").strip().lower()
        if not clave:
            errores.append("medicacionPermanente[%d]: falta principioActivo." % i)
            continue
        if clave not in conocidos:
            errores.append(
                "medicacionPermanente[%d]: ms-vigia no conoce el principio activo "
                "'%s', asi que registrarlo no protegeria de nada." % (i, clave))
            continue
        if clave in vistos:
            errores.append("medicacionPermanente[%d]: '%s' esta repetido." % (i, clave))
            continue
        vistos.add(clave)

        item = {"principioActivo": clave}
        for campo, tipo in (("dosisMg", float), ("cadaHoras", float)):
            if entrada.get(campo) is not None:
                try:
                    item[campo] = tipo(entrada[campo])
                except (TypeError, ValueError):
                    errores.append("medicacionPermanente[%d]: %s tiene que ser un "
                                   "numero." % (i, campo))
        for campo in ("farmaco", "via", "nota"):
            texto = (entrada.get(campo) or "").strip()
            if texto:
                item[campo] = texto[:120]
        limpia.append(item)

    return limpia, errores, False


@app.put("/api/v1/internos/<paciente_id>/clinica")
def actualizar_clinica(paciente_id):
    """Psicopatologias, alergias y medicacion permanente. Solo MEDICO.

    Es el unico sitio donde se escriben, y por eso no esta en la pantalla del
    padron: ms-vigia decide con estos datos si un medicamento es seguro para
    este interno, asi que los firma quien responde por esa decision.
    """
    fila = consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,))
    if fila is None:
        return jsonify({"error": "No existe el interno %s." % paciente_id}), 404

    cuerpo = request.get_json(silent=True) or {}
    errores = []
    valores = {}

    # Ausente es "no lo toques"; lista vacia es "no tiene". Si fueran lo mismo,
    # mandar solo las alergias borraria las psicopatologias.
    for clave, columna in (("psicopatologias", "psicopatologias"),
                           ("alergias", "alergias")):
        if clave not in cuerpo:
            continue
        lista, error = _lista_de_textos(cuerpo, clave)
        if error:
            errores.append(error)
        else:
            valores[columna] = lista

    # La medicacion permanente va aparte porque no es texto libre: cada entrada
    # lleva un principioActivo del vademecum, porque esta lista entra en los
    # dictamenes de ms-vigia.
    if "medicacionPermanente" in cuerpo:
        lista, fallos, sin_vigia = _medicacion_permanente(cuerpo)
        if sin_vigia:
            return jsonify({
                "error": "No se puede registrar la medicacion permanente ahora: %s"
                         % fallos[0],
                "detalle": ("Esta lista decide si ms-vigia bloquea un medicamento. "
                            "Guardarla sin poder comprobar los principios activos "
                            "dejaria una ficha que parece protegida y no lo esta, "
                            "asi que no se guarda nada."),
            }), 503
        if fallos:
            errores.extend(fallos)
        else:
            valores["medicacion_permanente"] = lista

    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400
    if not valores:
        return jsonify({
            "error": "Peticion invalida",
            "detalles": ["No se mando ninguno de: psicopatologias, alergias, "
                         "medicacionPermanente."],
        }), 400

    asignaciones = ", ".join("%s=%%s" % c for c in valores)
    bd = conexion()
    try:
        ejecutar("UPDATE internos SET " + asignaciones + " WHERE id=%s",
                 tuple(json.dumps(v, ensure_ascii=False) for v in valores.values())
                 + (paciente_id,))
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    return jsonify(ficha_json(
        consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,)),
        puede_ver_lo_clinico()))


@app.put("/api/v1/internos/<paciente_id>/egreso")
def egresar_interno(paciente_id):
    """Egresa al interno. Solo ADMINISTRADOR.

    Un interno NUNCA se borra. Egresa: deja el padron activo y conserva
    intacto su historial, porque las tomas y los planes que firmo enfermeria
    son documentos legales y no pueden desaparecer porque la persona se fue.

    El egreso, el cierre de sus planes y la anulacion de sus tomas futuras van
    en una sola transaccion: un interno egresado al que le siguieran saliendo
    tomas en la jornada de enfermeria seria peor que no haberlo egresado.
    """
    fila = consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,))
    if fila is None:
        return jsonify({"error": "No existe el interno %s." % paciente_id}), 404
    if fila["estado"] == "EGRESADO":
        return jsonify({
            "error": "El interno %s ya estaba egresado." % paciente_id,
            "egreso": ficha_json(fila, False)["egreso"],
        }), 409

    cuerpo = request.get_json(silent=True) or {}
    errores = []
    fecha, error = _fecha(cuerpo, "fecha")
    if error:
        errores.append(error)
    elif fecha > date.today():
        errores.append("La fecha de egreso no puede estar en el futuro.")
    motivo, error = _texto(cuerpo, "motivo", 500)
    if error:
        errores.append(error)
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    ahora = datetime.now().replace(microsecond=0)
    bd = conexion()
    try:
        ejecutar(
            "UPDATE internos SET estado='EGRESADO', egreso_fecha=%s, "
            "egreso_motivo=%s WHERE id=%s",
            (fecha, motivo, paciente_id))
        planes = ejecutar(
            "UPDATE planes SET estado='FINALIZADO' "
            "WHERE paciente_id=%s AND estado='ACTIVO'",
            (paciente_id,))
        tomas = ejecutar(
            "UPDATE tomas SET estado='OMITIDA', observacion=%s, registrado_en=%s "
            "WHERE paciente_id=%s AND estado='PENDIENTE' AND programado_para > %s",
            ("Interno egresado: " + motivo, ahora, paciente_id, ahora))
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    salida = ficha_json(
        consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,)),
        puede_ver_lo_clinico())
    salida["planesFinalizados"] = planes
    salida["tomasAnuladas"] = tomas

    # La deuda no impide el egreso: la cuenta sigue siendo exigible al
    # familiar responsable. Pero irse sin que nadie lo diga seria peor.
    deuda, aviso_caja = saldo_pendiente(paciente_id)
    if deuda:
        salida["advertencia"] = (
            "El interno egresa con Q %.2f pendientes en %d cargo(s). La deuda "
            "sigue siendo exigible al familiar responsable."
            % (deuda["saldo"], deuda["cargosPendientes"]))
        salida["saldoPendiente"] = deuda
    elif aviso_caja:
        salida["advertencia"] = aviso_caja

    return jsonify(salida)

@app.errorhandler(404)
def no_encontrado(_):
    return jsonify({"error": "Ruta no encontrada en ms-pastillero."}), 404


def sembrar_internos():
    """Los tres internos que antes estaban quemados en el JavaScript.

    Se siembra aparte de los planes para que el padron se pueda poblar aunque
    la base ya tenga tratamientos cargados.
    """
    bd = abrir_conexion()
    with bd.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) n FROM internos")
        if cursor.fetchone()["n"] > 0:
            bd.close()
            return

    # El ingreso y la fecha de nacimiento se guardan como DATE y se presentan
    # en dd/mm/aaaa. La edad NO se siembra: sale de la fecha de nacimiento.
    # Las tres fechas estan elegidas para que den las edades de siempre —84,
    # 79 y 88— y para que sigan dandolas conforme pase el tiempo.
    internos = [
        ("ASL-014", "Rosalía Menchú Coy", "1942-05-11", "FEMENINO", "2587412360101",
         "2023-05-11", "Deterioro cognitivo progresivo; la familia no puede darle "
         "atención permanente en casa.", "Pabellón A", "3",
         ["Demencia mixta", "Insomnio crónico"], ["penicilina"],
         [{"principioActivo": "donepecilo", "farmaco": "Donepecilo",
           "dosisMg": 10, "cadaHoras": 24, "via": "oral"}],
         "María Coy, hija", "maria.coy@ejemplo.gt"),
        ("ASL-007", "Tránsito Xicará Tzoc", "1947-02-02", "FEMENINO", "1874523690902",
         "2024-02-02", "Depresión mayor con intento previo; requiere vigilancia y "
         "control de medicación.", "Pabellón B", "1",
         ["Depresión mayor", "Hipertensión arterial"], ["sulfas"],
         [{"principioActivo": "enalapril", "farmaco": "Enalapril",
           "dosisMg": 10, "cadaHoras": 12, "via": "oral"},
          {"principioActivo": "sertralina", "farmaco": "Sertralina",
           "dosisMg": 50, "cadaHoras": 24, "via": "oral"}],
         "Julio Xicará, sobrino", "julio.xicara@ejemplo.gt"),
        ("ASL-022", "Bernardo Puac Ixcoy", "1938-09-19", "MASCULINO", "1023698740503",
         "2022-09-19", "Viudo sin red familiar de apoyo; deterioro cognitivo leve y "
         "riesgo de caídas.", "Pabellón C", "2",
         ["Deterioro cognitivo leve", "Fibrilación auricular"], [],
         # Warfarina como medicina de cajon: Bernardo ya la tomaba antes
         # de entrar. Entra en los dictamenes igual que un plan activo.
         [{"principioActivo": "warfarina", "farmaco": "Warfarina",
           "dosisMg": 5, "cadaHoras": 24, "via": "oral"}],
         "Elena Ixcoy, nieta", "elena.ixcoy@ejemplo.gt"),
    ]
    try:
        with bd.cursor() as cursor:
            for (pid, nombre, nacimiento, sexo, documento, ingreso, motivo,
                 pabellon, cama, psico, alergias, permanente,
                 responsable, correo) in internos:
                cursor.execute(
                    """INSERT INTO internos
                           (id, nombre, documento, fecha_nacimiento, sexo,
                            ingreso, motivo_ingreso, pabellon, cama,
                            psicopatologias, alergias, medicacion_permanente,
                            responsable, correo_responsable, estado)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ACTIVO')""",
                    (pid, nombre, documento, nacimiento, sexo, ingreso, motivo,
                     pabellon, cama,
                     json.dumps(psico, ensure_ascii=False),
                     json.dumps(alergias, ensure_ascii=False),
                     json.dumps(permanente, ensure_ascii=False),
                     responsable, correo),
                )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    finally:
        bd.close()


def sembrar():
    bd = abrir_conexion()
    with bd.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) n FROM planes")
        if cursor.fetchone()["n"] > 0:
            bd.close()
            return

    hoy = datetime.now().replace(minute=0, second=0, microsecond=0)
    base = hoy.replace(hour=0)
    semilla = [
        ("ASL-014", "Rosalia Menchu Coy", "donepecilo", "Donepecilo", 10, 24, 30, 21,
         "Deterioro cognitivo, dosis nocturna"),
        ("ASL-014", "Rosalia Menchu Coy", "omeprazol", "Omeprazol", 20, 24, 30, 7,
         "Proteccion gastrica en ayunas"),
        ("ASL-014", "Rosalia Menchu Coy", "paracetamol", "Paracetamol", 500, 8, 5, 6,
         "Dolor osteoarticular"),
        ("ASL-007", "Transito Xicara Tzoc", "sertralina", "Sertralina", 50, 24, 30, 8,
         "Depresion mayor"),
        ("ASL-007", "Transito Xicara Tzoc", "enalapril", "Enalapril", 10, 12, 30, 7,
         "Hipertension arterial"),
        ("ASL-022", "Bernardo Puac Ixcoy", "warfarina", "Warfarina", 5, 24, 30, 18,
         "Fibrilacion auricular, control de INR mensual"),
        ("ASL-022", "Bernardo Puac Ixcoy", "metformina", "Metformina", 850, 12, 30, 7,
         "Diabetes tipo 2"),
        ("ASL-022", "Bernardo Puac Ixcoy", "atorvastatina", "Atorvastatina", 20, 24, 30, 20,
         "Dislipidemia"),
    ]
    ahora = datetime.now().replace(microsecond=0)
    try:
        with bd.cursor() as cursor:
            for pid, nombre, clave, farmaco, dosis, cada, dias, hora, indicacion in semilla:
                plan_id = "PL-" + uuid.uuid4().hex[:8].upper()
                inicio = base.replace(hour=hora)
                cursor.execute(
                    """INSERT INTO planes
                           (id, paciente_id, paciente_nombre, principio_activo, farmaco,
                            dosis_mg, via, cada_horas, dias, indicacion, folio_validacion,
                            prescrito_por, inicio, estado, creado_en)
                       VALUES (%s,%s,%s,%s,%s,%s,'oral',%s,%s,%s,NULL,
                               'Dr. Angel Maltez',%s,'ACTIVO',%s)""",
                    (plan_id, pid, nombre, clave, farmaco, dosis, cada, dias, indicacion,
                     inicio, ahora),
                )
                for i in range(max(1, int(round(dias * 24 / cada)))):
                    momento = inicio + timedelta(hours=cada * i)
                    if momento < base or momento > base + timedelta(days=dias):
                        continue
                    toma_id = "TM-" + uuid.uuid4().hex[:10].upper()
                    # Las tomas de hoy ya pasadas se dan por administradas: la
                    # jornada arranca a medio andar y no en blanco.
                    if momento < ahora - timedelta(minutes=TOLERANCIA_MIN) and momento >= base:
                        cursor.execute(
                            """INSERT INTO tomas
                                   (id, plan_id, paciente_id, programado_para, turno,
                                    estado, enfermero, observacion, registrado_en)
                               VALUES (%s,%s,%s,%s,%s,'ADMINISTRADA',%s,%s,%s)""",
                            (toma_id, plan_id, pid, momento, turno_de(momento),
                             "Enf. Lucia Cabrera", "Toma sin incidencias", momento),
                        )
                    else:
                        cursor.execute(
                            """INSERT INTO tomas
                                   (id, plan_id, paciente_id, programado_para, turno, estado)
                               VALUES (%s,%s,%s,%s,%s,'PENDIENTE')""",
                            (toma_id, plan_id, pid, momento, turno_de(momento)),
                        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    finally:
        bd.close()


esperar_a_mysql()
if os.environ.get("SEMBRAR", "1") == "1":
    sembrar_internos()
    sembrar()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PUERTO", 8082)))
