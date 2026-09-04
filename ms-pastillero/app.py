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

# ---------------------------------------------------------------------------
# Conexion a MySQL. Todo por variables de entorno; si falta alguna, el
# servicio no arranca, igual que con GATEWAY_SECRETO.
# ---------------------------------------------------------------------------
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
TOLERANCIA_MIN = int(os.environ.get("TOLERANCIA_MIN", 60))

# ---------------------------------------------------------------------------
# Secreto compartido con ms-gateway. No hay valor por defecto: si falta, el
# servicio no arranca. Un secreto escrito en el codigo es un secreto publicado.
# ---------------------------------------------------------------------------
SECRETO = os.environ.get("GATEWAY_SECRETO", "")
if len(SECRETO.strip()) < 16:
    raise RuntimeError(
        "ms-pastillero no arranca: falta la variable de entorno GATEWAY_SECRETO "
        "(o mide menos de 16 caracteres). Copie .env.ejemplo a .env y genere "
        "un secreto con: openssl rand -hex 32"
    )

# Matriz de acceso de este servicio. El pastillero lo trabajan las dos manos
# que tocan al interno: el medico prescribe el plan y enfermeria registra cada
# toma administrada u omitida. Administracion no ve el tratamiento de nadie.
ROLES_LECTURA = ("MEDICO", "ENFERMERIA")
ROLES_ESCRITURA = ("MEDICO", "ENFERMERIA")

# Excepcion documentada, simetrica a la del medico en ms-caja: administracion
# si puede leer el padron de internos, porque le cobra a la familia de cada uno
# y necesita saber a quien tiene el asilo y quien es el familiar responsable.
# Lo que NO recibe es la parte clinica de la ficha: las psicopatologias, las
# alergias y la medicacion se omiten de la respuesta cuando quien pregunta es
# ADMINISTRACION (ver ficha_json). Saber que Rosalia esta aqui es
# administrativo; saber que tiene demencia mixta es clinico.
PADRON_DE_INTERNOS = re.compile(r"^/api/v1/internos(/[^/]+)?/?$")

# Suspender un tratamiento queda reservado al MEDICO, aunque el resto del
# pastillero lo escriban las dos manos.
#
# El criterio: suspender no es registrar lo que paso, es cambiar la
# indicacion. Enfermeria puede decir que una toma no se dio y por que —eso es
# consignar un hecho, y para eso esta "omitir", que exige motivo—, pero
# retirarle el medicamento a un interno de aqui en adelante es revocar una
# decision clinica, y esa la toma quien la firmo. Antes la interfaz solo le
# mostraba el boton al medico mientras la API se lo permitia a enfermeria:
# las dos partes decian cosas distintas, y la que mandaba era la API.
SUSPENDER_PLAN = re.compile(r"^/api/v1/planes/[^/]+/suspender/?$")
ROLES_SUSPENDER = ("MEDICO",)

# La sonda de vida no expone datos del asilo y la consulta Docker desde dentro
# del contenedor, sin token.
RUTAS_LIBRES = ("/salud",)

TURNOS = [
    {"clave": "matutino", "nombre": "Matutino", "desde": 6, "hasta": 14},
    {"clave": "vespertino", "nombre": "Vespertino", "desde": 14, "hasta": 22},
    {"clave": "nocturno", "nombre": "Nocturno", "desde": 22, "hasta": 6},
]

# MySQL devuelve DECIMAL como Decimal y DATETIME como datetime, y ninguno de
# los dos sabe convertirse solo a JSON. Se traducen aqui, en un solo lugar,
# para que ninguna respuesta cambie de forma respecto a la version con SQLite.
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
        # Nada se da por escrito hasta que la peticion lo confirma con
        # commit(). Con SQLite cada execute() se guardaba solo.
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
    # La columna es DATETIME: MySQL la devuelve ya como datetime, no hay
    # texto ISO que interpretar.
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
        # Se devuelven como texto ISO para que la respuesta sea identica a la
        # de la version con SQLite: la interfaz hace new Date(programadoPara).
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

# ---------------------------------------------------------------------------
# Verificacion de la sesion.
#
# ms-gateway ya valida el token antes de reenviar la peticion, pero este
# servicio lo vuelve a verificar por su cuenta: es defensa en profundidad. Si
# alguien alcanza la red interna del stack y llama directo a ms-pastillero sin
# pasar por el gateway, aqui se le vuelve a pedir quien es.
#
# Ya no hay encabezados Access-Control-Allow-Origin: este servicio no publica
# puerto al host y ningun navegador le habla de forma directa. El unico origen
# que atiende peticiones del navegador es ms-gateway.
# ---------------------------------------------------------------------------
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
        permitidos = permitidos + ("ADMINISTRACION",)
    if escribe and SUSPENDER_PLAN.match(request.path):
        permitidos = ROLES_SUSPENDER

    if g.sesion.get("rol") not in permitidos:
        if escribe and SUSPENDER_PLAN.match(request.path):
            detalle = "suspender un tratamiento: es una decision clinica y la revoca el medico"
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


# ---------------------------------------------------------------------------
# Padron de internos.
#
# Esta ficha estaba quemada en el JavaScript de la estacion web, o sea que
# vivia en el navegador. Como ms-vigia decide si bloquea un medicamento con la
# edad, las alergias y las psicopatologias, cualquiera podia abrir las
# herramientas de desarrollo, vaciar el arreglo de alergias y conseguir que el
# sistema aprobara furosemida a una paciente alergica a las sulfas. El dato del
# que depende la seguridad del paciente ahora vive aqui, del lado del servidor.
# ---------------------------------------------------------------------------

def ficha_json(fila, incluir_clinico=True):
    """Ficha del interno. Sin la parte clinica si quien pregunta no es clinico."""
    ficha = {
        "pacienteId": fila["id"],
        "nombre": fila["nombre"],
        "edad": fila["edad"],
        "cama": fila["cama"],
        # La columna es DATE; se presenta como dd/mm/aaaa, que es como la
        # lee el personal del asilo.
        "ingreso": fila["ingreso"].strftime("%d/%m/%Y") if fila["ingreso"] else None,
        "responsable": fila["responsable"],
        # Dato de contacto, no clinico: lo necesita ms-consultas para avisarle
        # al familiar, y administracion para cobrarle.
        "correoResponsable": fila["correo_responsable"],
    }
    if incluir_clinico:
        ficha["psicopatologias"] = json.loads(fila["psicopatologias"])
        ficha["alergias"] = json.loads(fila["alergias"])
    return ficha


def puede_ver_lo_clinico():
    return g.sesion.get("rol") in ("MEDICO", "ENFERMERIA")


@app.get("/api/v1/internos")
def listar_internos():
    filas = consultar("SELECT * FROM internos ORDER BY nombre")
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
    return jsonify({"total": len(internos), "internos": internos})


@app.get("/api/v1/internos/<paciente_id>")
def obtener_interno(paciente_id):
    fila = consultar_uno("SELECT * FROM internos WHERE id = %s", (paciente_id,))
    if fila is None:
        return jsonify({"error": "No existe el interno %s." % paciente_id}), 404

    clinico = puede_ver_lo_clinico()
    ficha = ficha_json(fila, clinico)
    if clinico:
        # La medicacion activa viaja con la ficha porque es justo lo que
        # ms-vigia necesita para buscar interacciones y duplicidades: asi
        # arma la ficha completa con una sola llamada.
        ficha["medicacionActual"] = [
            {
                "principioActivo": p["principio_activo"],
                "farmaco": p["farmaco"],
                "dosisMg": p["dosis_mg"],
                "cadaHoras": p["cada_horas"],
                "via": p["via"],
            }
            for p in consultar(
                "SELECT principio_activo, farmaco, dosis_mg, cada_horas, via "
                "FROM planes WHERE paciente_id = %s AND estado = 'ACTIVO'",
                (paciente_id,))
        ]
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
    filas = consultar(
        """SELECT id, principio_activo, farmaco, dosis_mg, cada_horas, via
           FROM planes WHERE paciente_id = %s AND estado = 'ACTIVO'""",
        (paciente_id,))
    return jsonify({"pacienteId": paciente_id, "medicacionActual": [
        {
            "planId": f["id"],
            "principioActivo": f["principio_activo"],
            "farmaco": f["farmaco"],
            "dosisMg": f["dosis_mg"],
            "cadaHoras": f["cada_horas"],
            "via": f["via"],
        }
        for f in filas
    ]})


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
    # El plan y sus tomas son una sola cosa: un plan sin tomas no sirve de
    # nada y unas tomas sin plan son huerfanas. Van en una transaccion, y si
    # algo falla a media escritura no queda nada a medias.
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
    # Suspender toca dos tablas: el plan y todas sus tomas futuras. O cambian
    # las dos, o no cambia ninguna.
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
    # La columna es DATETIME: se filtra con DATE(), no recortando texto.
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
    return jsonify({
        "pacienteId": paciente_id,
        "desde": desde,
        "hasta": hasta,
        "totalProgramadas": len(filas),
        "detalle": conteo,
        "adherenciaPorcentaje": porcentaje,
        "porFarmaco": por_farmaco,
    })


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

    # El ingreso se guarda como DATE (aaaa-mm-dd) y se presenta en dd/mm/aaaa.
    internos = [
        ("ASL-014", "Rosalía Menchú Coy", 84, "Pabellón A, cama 3", "2023-05-11",
         ["Demencia mixta", "Insomnio crónico"], ["penicilina"],
         "María Coy, hija", "maria.coy@ejemplo.gt"),
        ("ASL-007", "Tránsito Xicará Tzoc", 79, "Pabellón B, cama 1", "2024-02-02",
         ["Depresión mayor", "Hipertensión arterial"], ["sulfas"],
         "Julio Xicará, sobrino", "julio.xicara@ejemplo.gt"),
        ("ASL-022", "Bernardo Puac Ixcoy", 88, "Pabellón C, cama 2", "2022-09-19",
         ["Deterioro cognitivo leve", "Fibrilación auricular"], [],
         "Elena Ixcoy, nieta", "elena.ixcoy@ejemplo.gt"),
    ]
    try:
        with bd.cursor() as cursor:
            for (pid, nombre, edad, cama, ingreso, psico, alergias,
                 responsable, correo) in internos:
                cursor.execute(
                    """INSERT INTO internos
                           (id, nombre, edad, cama, ingreso, psicopatologias,
                            alergias, responsable, correo_responsable)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (pid, nombre, edad, cama, ingreso,
                     json.dumps(psico, ensure_ascii=False),
                     json.dumps(alergias, ensure_ascii=False), responsable, correo),
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
                    # Las tomas de hoy que ya pasaron se dan por administradas
                    # en el turno, para que la demostracion arranque con una
                    # jornada a medio andar y no en blanco.
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
