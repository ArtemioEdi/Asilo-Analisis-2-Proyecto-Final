import json
import os
import time
import uuid
from datetime import date, datetime
from decimal import Decimal

import jwt
import pymysql
import requests
from flask import Flask, g, jsonify, request
from flask.json.provider import DefaultJSONProvider
from pymysql.cursors import DictCursor

import vademecum as vd

APP_NOMBRE = "ms-vigia"
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
        "ms-vigia no arranca: faltan las variables de conexion a MySQL (%s). "
        "Copie .env.ejemplo a .env." % ", ".join(_faltantes)
    )

# El padron es de ms-pastillero: la ficha se le pregunta a el, no se le cree
# al cliente. Ver consultar_ficha().
PASTILLERO_URL = os.environ.get("PASTILLERO_URL", "http://ms-pastillero:8082")

# Secreto compartido con ms-gateway. Sin valor por defecto a proposito: un
# secreto escrito en el codigo es un secreto publicado.
SECRETO = os.environ.get("GATEWAY_SECRETO", "")
if len(SECRETO.strip()) < 16:
    raise RuntimeError(
        "ms-vigia no arranca: falta la variable de entorno GATEWAY_SECRETO "
        "(o mide menos de 16 caracteres). Copie .env.ejemplo a .env y genere "
        "un secreto con: openssl rand -hex 32"
    )

# La bitacora es informacion clinica: la escribe solo el medico, que es quien
# firma la prescripcion.
ROLES_LECTURA = ("MEDICO", "ENFERMERIA")
ROLES_ESCRITURA = ("MEDICO",)

# La sonda de vida no expone datos y Docker la consulta sin token.
RUTAS_LIBRES = ("/salud",)

# Desde aqui un dictamen pasa de APROBADO a ADVERTENCIA: equivale a un solo
# hallazgo de severidad MEDIA.
UMBRAL_ADVERTENCIA = 8

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


def nuevo_folio():
    """Folio unico de dictamen, con el formato legible FV-<anio>-XXXXXXXX.

    Antes era SELECT COUNT(*) + 1. Con gunicorn corriendo --threads 4, dos
    medicos validando a la vez leian el mismo total y armaban el mismo folio:
    el segundo INSERT reventaba contra el PRIMARY KEY. El identificador ya no
    depende de cuantas filas hay, igual que en ms-caja y ms-pastillero.
    """
    return "FV-%s-%s" % (datetime.now().year, uuid.uuid4().hex[:8].upper())

def _hallazgo(codigo, tipo, severidad, mensaje, recomendacion):
    return {
        "codigo": codigo,
        "tipo": tipo,
        "severidad": severidad,
        "mensaje": mensaje,
        "recomendacion": recomendacion,
    }


def evaluar(ficha, propuesta):
    """Aplica las cinco reglas de seguridad y devuelve la lista de hallazgos."""
    hallazgos = []

    clave = propuesta["principioActivo"]
    farmaco = vd.FARMACOS[clave]
    edad = int(ficha.get("edad") or 0)
    dosis_dia = propuesta["dosisMg"] * (24.0 / propuesta["cadaHoras"])
    
    familias_paciente = {vd.normalizar_alergia(a) for a in ficha.get("alergias", [])}
    if clave in familias_paciente:
        hallazgos.append(_hallazgo(
            "FV-ALG-01", "ALERGIA", "CRITICA",
            "El paciente tiene registrada alergia directa a %s." % farmaco["nombre"],
            "No administrar. Elegir un principio activo de otra familia."))
    else:
        cruzadas = familias_paciente.intersection(set(farmaco["familias"]))
        if cruzadas:
            hallazgos.append(_hallazgo(
                "FV-ALG-02", "ALERGIA", "CRITICA",
                "Alergia cruzada: %s pertenece a la familia %s, declarada como alergia del paciente."
                % (farmaco["nombre"], ", ".join(sorted(cruzadas))),
                "No administrar. Consultar con el medico tratante una alternativa."))

    for actual in ficha.get("medicacionActual", []):
        otra = actual.get("principioActivo")
        if otra not in vd.FARMACOS or otra == clave:
            continue
        inter = vd.buscar_interaccion(clave, otra)
        if inter:
            hallazgos.append(_hallazgo(
                "FV-INT-01", "INTERACCION", inter["severidad"],
                "%s + %s: %s" % (farmaco["nombre"], vd.FARMACOS[otra]["nombre"], inter["efecto"]),
                inter["recomendacion"]))

    for actual in ficha.get("medicacionActual", []):
        otra = actual.get("principioActivo")
        if otra not in vd.FARMACOS or otra == clave:
            continue
        if vd.FARMACOS[otra]["grupo"] == farmaco["grupo"]:
            hallazgos.append(_hallazgo(
                "FV-DUP-01", "DUPLICIDAD", "ALTA",
                "El paciente ya recibe %s, del mismo grupo terapeutico (%s)."
                % (vd.FARMACOS[otra]["nombre"], farmaco["grupo"]),
                "Suspender uno de los dos o justificar la asociacion en la ficha medica."))


    if edad >= 65:
        psico = " ".join(ficha.get("psicopatologias", [])).lower()
        if farmaco["grupo"] == "BENZODIACEPINA":
            hallazgos.append(_hallazgo(
                "FV-GER-01", "CRITERIO_GERIATRICO", "ALTA",
                "Las benzodiacepinas duplican el riesgo de caida y fractura de cadera despues de los 65 anos.",
                "Usar la dosis minima, por menos de 4 semanas, y reforzar la vigilancia nocturna."))
        if farmaco["grupo"] in vd.GRUPOS_ANTICOLINERGICOS:
            hallazgos.append(_hallazgo(
                "FV-GER-02", "CRITERIO_GERIATRICO", "ALTA",
                "Farmaco con carga anticolinergica: puede provocar confusion, retencion urinaria y deterioro cognitivo.",
                "Preferir una alternativa sin efecto anticolinergico."))
        if farmaco["grupo"] == "AINE":
            hallazgos.append(_hallazgo(
                "FV-GER-03", "CRITERIO_GERIATRICO", "MEDIA",
                "Los AINE en el adulto mayor aumentan el riesgo de sangrado digestivo y dano renal.",
                "Limitar a tratamientos cortos y acompanar con proteccion gastrica."))
        if farmaco["grupo"] == "ANTIPSICOTICO" and ("demencia" in psico or "alzheimer" in psico):
            hallazgos.append(_hallazgo(
                "FV-GER-04", "CRITERIO_GERIATRICO", "CRITICA",
                "Antipsicotico indicado a un paciente con demencia: se asocia a mayor mortalidad.",
                "Requiere justificacion escrita del medico y consentimiento del familiar responsable."))


    tope = farmaco["dosis_max_dia_mg"]
    if dosis_dia > tope:
        hallazgos.append(_hallazgo(
            "FV-DOS-01", "DOSIS", "CRITICA",
            "La pauta suma %.2f mg al dia y el tope recomendado para este paciente es %.2f mg."
            % (dosis_dia, tope),
            "Reducir la dosis unitaria o ampliar el intervalo entre tomas."))
    elif dosis_dia > tope * 0.8:
        hallazgos.append(_hallazgo(
            "FV-DOS-02", "DOSIS", "MEDIA",
            "La pauta alcanza el %.0f%% de la dosis maxima diaria." % (dosis_dia / tope * 100),
            "Sin margen para dosis de rescate. Vigilar efectos adversos."))

    return hallazgos


def dictaminar(hallazgos):
    """Convierte la lista de hallazgos en un veredicto y un puntaje.

    La regla, en una linea: cualquier hallazgo CRITICO bloquea; a partir de un
    hallazgo MEDIO (8 puntos) se advierte; por debajo de eso se aprueba.

        puntaje       veredicto      con que se llega
        -----------------------------------------------------------------
        >= 40 o       BLOQUEADO      cualquier hallazgo CRITICA (alergia,
        una CRITICA                  dosis sobre el tope, antipsicotico en
                                     demencia)
        >= 8          ADVERTENCIA    una ALTA (20) o una MEDIA (8): se puede
                                     administrar con las precauciones
        < 8           APROBADO       sin hallazgos, o solo INFORMATIVA (2)

    El umbral es MEDIA y no ALTA: si el sistema detecto algo de severidad
    media, quien administra tiene que enterarse. Antes habia dos condiciones
    encadenadas, una con el umbral de ALTA (20) y otra con 8, y la de 20
    nunca llegaba a decidir nada porque la siguiente ya cubria ese caso. El
    README documentaba el 20 y el codigo se comportaba como 8; ahora las dos
    dicen lo mismo.
    """
    puntaje = min(100, sum(vd.PUNTAJE.get(h["severidad"], 0) for h in hallazgos))
    if any(h["severidad"] == "CRITICA" for h in hallazgos):
        return "BLOQUEADO", puntaje
    if puntaje >= UMBRAL_ADVERTENCIA:
        return "ADVERTENCIA", puntaje
    return "APROBADO", puntaje

def consultar_ficha(paciente_id):
    """Trae la ficha clinica del interno desde ms-pastillero.

    Devuelve (ficha, error, codigo). Nunca lanza excepcion hacia el endpoint,
    igual que consultar_dictamen() en ms-pastillero.

    Esta funcion es el arreglo del error de diseño mas grave que tenia el
    prototipo. La edad, las alergias y las psicopatologias venian en el cuerpo
    de la peticion, o sea que las mandaba el navegador, y son exactamente los
    tres datos con los que se decide si un medicamento se bloquea. Bastaba
    editar el JavaScript en las herramientas de desarrollo para que el sistema
    aprobara furosemida a una paciente alergica a las sulfas. Ahora el cliente
    manda unicamente el pacienteId y la ficha se arma aqui, del lado del
    servidor, preguntandole al servicio que es dueño de ese dato.

    Se reenvia el token de quien pidio la validacion: la consulta viaja con su
    identidad, no con una credencial de servicio.
    """
    try:
        r = requests.get(
            "%s/api/v1/internos/%s" % (PASTILLERO_URL, paciente_id),
            headers={"Authorization": request.headers.get("Authorization", "")},
            timeout=4,
        )
    except requests.RequestException:
        return None, ("MS-PASTILLERO no responde y sin su ficha no se puede "
                      "evaluar la seguridad del medicamento. No se dictamina a "
                      "ciegas: vuelva a intentar en un momento."), 503
    if r.status_code == 404:
        return None, "El interno %s no existe en el padron del asilo." % paciente_id, 404
    if r.status_code != 200:
        return None, ("MS-PASTILLERO respondio con codigo %d al pedirle la ficha "
                      "del interno. No se dictamina sin ficha." % r.status_code), 503

    ficha = r.json()
    if "alergias" not in ficha:
        # Sin la parte clinica no se puede dictaminar: media ficha no sirve.
        return None, ("La ficha recibida no trae los datos clinicos del interno. "
                      "No se dictamina sin alergias ni psicopatologias."), 503
    return ficha, None, 200


def validar_peticion(cuerpo):
    errores = []
    if not isinstance(cuerpo, dict):
        return ["El cuerpo de la peticion debe ser un objeto JSON."]

    if not cuerpo.get("pacienteId"):
        errores.append("Falta pacienteId.")

    prop = cuerpo.get("propuesta")
    if not isinstance(prop, dict):
        errores.append("Falta el objeto propuesta.")
        return errores

    clave = (prop.get("principioActivo") or "").strip().lower()
    if clave not in vd.FARMACOS:
        errores.append("El principio activo '%s' no existe en el vademecum de la fundacion." % clave)

    try:
        dosis = float(prop.get("dosisMg"))
        if dosis <= 0:
            errores.append("dosisMg debe ser mayor que cero.")
    except (TypeError, ValueError):
        errores.append("dosisMg debe ser numerico.")

    try:
        cada = float(prop.get("cadaHoras"))
        if cada <= 0 or cada > 72:
            errores.append("cadaHoras debe estar entre 1 y 72.")
    except (TypeError, ValueError):
        errores.append("cadaHoras debe ser numerico.")

    return errores


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
    if g.sesion.get("rol") not in permitidos:
        return jsonify({
            "error": "Su rol (%s) no esta autorizado para %s la bitacora de "
                     "farmacovigilancia." % (g.sesion.get("rol"),
                                             "escribir en" if escribe else "leer"),
            "rolesPermitidos": list(permitidos),
        }), 403
    return None


def firmante():
    """Quien esta actuando, tomado del token y nunca del cuerpo de la peticion.

    Antes el cliente mandaba solicitadoPor y quedaba firmado en la bitacora el
    nombre que se le antojara. Un dictamen clinico lo firma quien inicio
    sesion, no quien escribe el JSON.
    """
    return g.sesion.get("nombre") or g.sesion.get("usuario") or "no indicado"


@app.get("/salud")
def salud():
    """Sonda de vida usada por Docker y por la estacion de enfermeria."""
    return jsonify({
        "servicio": APP_NOMBRE,
        "version": APP_VERSION,
        "estado": "arriba",
        "farmacos": len(vd.FARMACOS),
        "reglas": len(vd.INTERACCIONES) + 5,
        "hora": datetime.now().isoformat(timespec="seconds"),
    })


@app.get("/api/v1/vademecum")
def listar_vademecum():
    salida = [
        {
            "principioActivo": clave,
            "nombre": datos["nombre"],
            "grupo": datos["grupo"],
            "dosisMaximaDiaMg": datos["dosis_max_dia_mg"],
        }
        for clave, datos in sorted(vd.FARMACOS.items(), key=lambda x: x[1]["nombre"])
    ]
    return jsonify({"total": len(salida), "farmacos": salida})


@app.post("/api/v1/validaciones")
def crear_validacion():
    cuerpo = request.get_json(silent=True)
    errores = validar_peticion(cuerpo)
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    prop = cuerpo["propuesta"]
    propuesta = {
        "principioActivo": prop["principioActivo"].strip().lower(),
        "dosisMg": float(prop["dosisMg"]),
        "cadaHoras": float(prop["cadaHoras"]),
        "viaAdministracion": (prop.get("viaAdministracion") or "oral").lower(),
    }
    # La ficha NO viene del cuerpo de la peticion: se le pide a ms-pastillero.
    # El cliente dice a quien se le receta; con que condiciones cuenta ese
    # interno lo dice el servidor.
    ficha, problema, codigo = consultar_ficha(cuerpo["pacienteId"])
    if problema:
        return jsonify({"error": problema, "pacienteId": cuerpo["pacienteId"]}), codigo

    hallazgos = evaluar(ficha, propuesta)
    veredicto, puntaje = dictaminar(hallazgos)

    bd = conexion()
    folio = nuevo_folio()
    evaluado_en = datetime.now().replace(microsecond=0)
    dictamen = {
        "folio": folio,
        "pacienteId": cuerpo["pacienteId"],
        "solicitadoPor": firmante(),
        "propuesta": dict(propuesta, nombre=vd.FARMACOS[propuesta["principioActivo"]]["nombre"]),
        "veredicto": veredicto,
        "puntajeRiesgo": puntaje,
        "hallazgos": hallazgos,
        "resumen": _resumen(veredicto, hallazgos),
        # Con que ficha se evaluo y de donde salio: es lo que permite auditar
        # despues por que se bloqueo o se aprobo.
        "fichaEvaluada": {
            "nombre": ficha.get("nombre"),
            "edad": ficha.get("edad"),
            "alergias": ficha.get("alergias", []),
            "psicopatologias": ficha.get("psicopatologias", []),
            "medicacionActual": [
                m.get("principioActivo") for m in ficha.get("medicacionActual", [])
            ],
            "fuente": "ms-pastillero",
        },
        "evaluadoEn": evaluado_en.isoformat(timespec="seconds"),
    }
    # Columnas explicitas: con el esquema en otro archivo, el orden posicional
    # se rompe en silencio.
    try:
        ejecutar(
            """INSERT INTO validaciones
                   (folio, paciente_id, principio_activo, veredicto, puntaje_riesgo,
                    solicitado_por, dictamen, creado_en)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (folio, cuerpo["pacienteId"], propuesta["principioActivo"], veredicto, puntaje,
             dictamen["solicitadoPor"], json.dumps(dictamen, ensure_ascii=False),
             evaluado_en),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    return jsonify(dictamen), 201


def _resumen(veredicto, hallazgos):
    if veredicto == "BLOQUEADO":
        return "No administrar hasta corregir la prescripcion."
    if veredicto == "ADVERTENCIA":
        return "Puede administrarse con las precauciones indicadas (%d hallazgo(s))." % len(hallazgos)
    return "Sin hallazgos de seguridad. Puede programarse."


@app.get("/api/v1/validaciones/<folio>")
def obtener_validacion(folio):
    fila = consultar_uno(
        "SELECT dictamen FROM validaciones WHERE folio = %s", (folio,))
    if fila is None:
        return jsonify({"error": "No existe el folio %s." % folio}), 404
    return jsonify(json.loads(fila["dictamen"]))


@app.get("/api/v1/validaciones")
def bitacora():
    """Bitacora de dictamenes. Alimenta el reporte de analisis medicos por paciente."""
    paciente = request.args.get("pacienteId")
    sql = "SELECT folio, paciente_id, principio_activo, veredicto, puntaje_riesgo, creado_en FROM validaciones"
    params = ()
    if paciente:
        sql += " WHERE paciente_id = %s"
        params = (paciente,)
    sql += " ORDER BY creado_en DESC LIMIT 100"
    filas = consultar(sql, params)
    return jsonify({
        "total": len(filas),
        "validaciones": [
            {
                "folio": f["folio"],
                "pacienteId": f["paciente_id"],
                "principioActivo": f["principio_activo"],
                "veredicto": f["veredicto"],
                "puntajeRiesgo": f["puntaje_riesgo"],
                "creadoEn": f["creado_en"],
            }
            for f in filas
        ],
    })


@app.errorhandler(404)
def no_encontrado(_):
    return jsonify({"error": "Ruta no encontrada en ms-vigia."}), 404


esperar_a_mysql()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PUERTO", 8081)))
