import json
import os
import sqlite3
import uuid
from datetime import datetime

import jwt
import requests
from flask import Flask, g, jsonify, request

import vademecum as vd

APP_NOMBRE = "ms-vigia"
APP_VERSION = "1.2.0"
BD = os.environ.get("VIGIA_BD", "/datos/vigia.db")

# ms-pastillero es el dueño del padron de internos. Este servicio le pregunta
# la ficha clinica en vez de creerle al cliente: ver consultar_ficha().
PASTILLERO_URL = os.environ.get("PASTILLERO_URL", "http://ms-pastillero:8082")

# ---------------------------------------------------------------------------
# Secreto compartido con ms-gateway. No hay valor por defecto: si falta, el
# servicio no arranca. Un secreto escrito en el codigo es un secreto publicado.
# ---------------------------------------------------------------------------
SECRETO = os.environ.get("GATEWAY_SECRETO", "")
if len(SECRETO.strip()) < 16:
    raise RuntimeError(
        "ms-vigia no arranca: falta la variable de entorno GATEWAY_SECRETO "
        "(o mide menos de 16 caracteres). Copie .env.ejemplo a .env y genere "
        "un secreto con: openssl rand -hex 32"
    )

# Matriz de acceso de este servicio. La bitacora de farmacovigilancia es
# informacion clinica: la leen medicina y enfermeria, y la escribe unicamente
# el medico, que es quien firma la prescripcion.
ROLES_LECTURA = ("MEDICO", "ENFERMERIA")
ROLES_ESCRITURA = ("MEDICO",)

# La sonda de vida no expone datos del asilo y la consulta Docker desde dentro
# del contenedor, sin token.
RUTAS_LIBRES = ("/salud",)

# Puntaje a partir del cual un dictamen deja de ser APROBADO y pasa a
# ADVERTENCIA. Equivale a un solo hallazgo de severidad MEDIA. Ver dictaminar().
UMBRAL_ADVERTENCIA = 8

app = Flask(__name__)
app.json.ensure_ascii = False

def conexion():
    if "bd" not in g:
        os.makedirs(os.path.dirname(BD) or ".", exist_ok=True)
        g.bd = sqlite3.connect(BD, timeout=10)
        g.bd.row_factory = sqlite3.Row
    return g.bd


@app.teardown_appcontext
def cerrar_conexion(_):
    bd = g.pop("bd", None)
    if bd is not None:
        bd.close()


def preparar_bd():
    os.makedirs(os.path.dirname(BD) or ".", exist_ok=True)
    bd = sqlite3.connect(BD, timeout=10)
    # WAL deja que las lecturas sigan corriendo mientras alguien escribe. Con
    # gunicorn en --threads 4 y varias personas usando la estacion a la vez,
    # sin esto aparece "database is locked" justo en la demostracion en vivo.
    # El timeout=10 de la conexion es la otra mitad: si la base esta ocupada,
    # se espera hasta 10 segundos en vez de fallar de inmediato.
    bd.execute("PRAGMA journal_mode=WAL")
    bd.execute(
        """CREATE TABLE IF NOT EXISTS validaciones (
               folio            TEXT PRIMARY KEY,
               paciente_id      TEXT NOT NULL,
               principio_activo TEXT NOT NULL,
               veredicto        TEXT NOT NULL,
               puntaje_riesgo   INTEGER NOT NULL,
               solicitado_por   TEXT,
               dictamen         TEXT NOT NULL,
               creado_en        TEXT NOT NULL
           )"""
    )
    bd.commit()
    bd.close()


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
        # Respuesta sin la parte clinica: quien pregunta no tiene rol clinico.
        # No se puede evaluar una prescripcion con media ficha.
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


# ---------------------------------------------------------------------------
# Verificacion de la sesion.
#
# ms-gateway ya valida el token antes de reenviar la peticion, pero este
# servicio lo vuelve a verificar por su cuenta: es defensa en profundidad. Si
# alguien alcanza la red interna del stack y llama directo a ms-vigia sin
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
    # La ficha NO se lee del cuerpo de la peticion: se le pide a ms-pastillero,
    # que es el dueño del padron de internos. El cliente solo dice a quien se
    # le va a recetar; con que condiciones cuenta ese interno lo dice el
    # servidor. Ver consultar_ficha().
    ficha, problema, codigo = consultar_ficha(cuerpo["pacienteId"])
    if problema:
        return jsonify({"error": problema, "pacienteId": cuerpo["pacienteId"]}), codigo

    hallazgos = evaluar(ficha, propuesta)
    veredicto, puntaje = dictaminar(hallazgos)

    bd = conexion()
    folio = nuevo_folio()
    dictamen = {
        "folio": folio,
        "pacienteId": cuerpo["pacienteId"],
        "solicitadoPor": firmante(),
        "propuesta": dict(propuesta, nombre=vd.FARMACOS[propuesta["principioActivo"]]["nombre"]),
        "veredicto": veredicto,
        "puntajeRiesgo": puntaje,
        "hallazgos": hallazgos,
        "resumen": _resumen(veredicto, hallazgos),
        # Queda escrito en el dictamen con que ficha se evaluo y de donde
        # salio. Es lo que permite auditar despues por que se bloqueo o se
        # aprobo un medicamento, y deja claro que el dato no vino del cliente.
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
        "evaluadoEn": datetime.now().isoformat(timespec="seconds"),
    }
    bd.execute(
        "INSERT INTO validaciones VALUES (?,?,?,?,?,?,?,?)",
        (folio, cuerpo["pacienteId"], propuesta["principioActivo"], veredicto, puntaje,
         dictamen["solicitadoPor"], json.dumps(dictamen, ensure_ascii=False),
         dictamen["evaluadoEn"]),
    )
    bd.commit()
    return jsonify(dictamen), 201


def _resumen(veredicto, hallazgos):
    if veredicto == "BLOQUEADO":
        return "No administrar hasta corregir la prescripcion."
    if veredicto == "ADVERTENCIA":
        return "Puede administrarse con las precauciones indicadas (%d hallazgo(s))." % len(hallazgos)
    return "Sin hallazgos de seguridad. Puede programarse."


@app.get("/api/v1/validaciones/<folio>")
def obtener_validacion(folio):
    fila = conexion().execute(
        "SELECT dictamen FROM validaciones WHERE folio = ?", (folio,)
    ).fetchone()
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
        sql += " WHERE paciente_id = ?"
        params = (paciente,)
    sql += " ORDER BY creado_en DESC LIMIT 100"
    filas = conexion().execute(sql, params).fetchall()
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


preparar_bd()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PUERTO", 8081)))
