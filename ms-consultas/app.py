"""ms-consultas · la cadena clinica del asilo Cabeza de Algodon.

El medico general remite a un interno, la fundacion le asigna cita con un
especialista, el especialista lo atiende y llena la ficha medica: diagnostico,
observaciones, examenes indicados y medicamentos recetados.

Cuatro tablas encadenadas: solicitudes -> visitas -> (examenes, indicaciones).
"""

import os
import re
import smtplib
import time
import uuid
from email.message import EmailMessage
from datetime import date, datetime, timedelta
from decimal import Decimal

import jwt
import pymysql
import requests
from flask import Flask, g, jsonify, request
from flask.json.provider import DefaultJSONProvider
from pymysql.cursors import DictCursor

APP_NOMBRE = "ms-consultas"
APP_VERSION = "1.0.0"

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
        "ms-consultas no arranca: faltan las variables de conexion a MySQL (%s). "
        "Copie .env.ejemplo a .env." % ", ".join(_faltantes)
    )

# Los tres servicios con los que habla este.
PASTILLERO_URL = os.environ.get("PASTILLERO_URL", "http://ms-pastillero:8082")
VIGIA_URL = os.environ.get("VIGIA_URL", "http://ms-vigia:8081")
CAJA_URL = os.environ.get("CAJA_URL", "http://ms-caja:8083")

# Correo al familiar. La configuracion es opcional a proposito: sin servidor
# de correo el aviso no se pierde ni tumba la remision, queda en la bitacora y
# en la tabla correos_enviados con estado REGISTRADO.
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PUERTO = int(os.environ.get("SMTP_PUERTO", "587") or "587")
SMTP_USUARIO = os.environ.get("SMTP_USUARIO", "").strip()
SMTP_CLAVE = os.environ.get("SMTP_CLAVE", "")
SMTP_DE = os.environ.get("SMTP_DE", "").strip() or "asilo@cabezadealgodon.local"

# Secreto compartido con ms-gateway. Sin valor por defecto a proposito: un
# secreto escrito en el codigo es un secreto publicado.
SECRETO = os.environ.get("GATEWAY_SECRETO", "")
if len(SECRETO.strip()) < 16:
    raise RuntimeError(
        "ms-consultas no arranca: falta la variable de entorno GATEWAY_SECRETO "
        "(o mide menos de 16 caracteres). Copie .env.ejemplo a .env y genere "
        "un secreto con: openssl rand -hex 32"
    )

# Matriz de acceso, ruta por ruta y no en bloque: cada eslabon de la cadena lo
# mueve un rol distinto. La misma matriz, mas gruesa, la aplica ms-gateway
# antes de reenviar; que este repetida es defensa en profundidad.
#
# ADMINISTRACION no aparece: la cadena clinica no es informacion
# administrativa.
REGLAS_LECTURA = (
    (re.compile(r"^/api/v1/solicitudes"),
     ("MEDICO", "ENFERMERIA", "FUNDACION")),
    (re.compile(r"^/api/v1/visitas"),
     ("MEDICO", "ENFERMERIA", "LABORATORIO", "FARMACIA")),
    (re.compile(r"^/api/v1/examenes"),
     ("MEDICO", "ENFERMERIA", "LABORATORIO")),
    (re.compile(r"^/api/v1/indicaciones"),
     ("MEDICO", "ENFERMERIA", "FARMACIA")),
    # Los avisos a la familia los ve quien lleva la parte clinica.
    (re.compile(r"^/api/v1/correos"),
     ("MEDICO", "ENFERMERIA")),
    # La ficha completa es el documento mas sensible y se queda en manos
    # clinicas: darsela al laboratorio o a la farmacia desharia por la puerta
    # de atras el filtro por bloque de /api/v1/visitas.
    (re.compile(r"^/api/v1/reportes/ficha"),
     ("MEDICO", "ENFERMERIA")),
    # El laboratorio si ve este: son los estudios que el mismo realiza.
    (re.compile(r"^/api/v1/reportes/examenes"),
     ("MEDICO", "ENFERMERIA", "LABORATORIO")),
)

# Una visita trae examenes e indicaciones juntos. Sin este filtro el
# laboratorio leeria las recetas y la farmacia los resultados de laboratorio
# con solo pedir la visita.
ROLES_VEN_EXAMENES = ("MEDICO", "ENFERMERIA", "LABORATORIO")
ROLES_VEN_INDICACIONES = ("MEDICO", "ENFERMERIA", "FARMACIA")

REGLAS_ESCRITURA = (
    # (metodo, expresion de la ruta, roles autorizados)
    ("POST", re.compile(r"^/api/v1/solicitudes/?$"), ("MEDICO",)),
    ("PUT",  re.compile(r"^/api/v1/solicitudes/[^/]+/agendar/?$"), ("FUNDACION",)),
    ("POST", re.compile(r"^/api/v1/visitas/?$"), ("MEDICO",)),
    ("PUT",  re.compile(r"^/api/v1/visitas/[^/]+/cerrar/?$"), ("MEDICO",)),
    ("PUT",  re.compile(r"^/api/v1/visitas/[^/]+/?$"), ("MEDICO",)),
    ("POST", re.compile(r"^/api/v1/visitas/[^/]+/examenes/?$"), ("MEDICO",)),
    ("POST", re.compile(r"^/api/v1/visitas/[^/]+/indicaciones/?$"), ("MEDICO",)),
    ("PUT",  re.compile(r"^/api/v1/examenes/[^/]+/resultado/?$"), ("LABORATORIO",)),
    ("PUT",  re.compile(r"^/api/v1/indicaciones/[^/]+/entregar/?$"), ("FARMACIA",)),
)

# La sonda de vida no expone datos y Docker la consulta sin token.
RUTAS_LIBRES = ("/salud",)


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
    ya hayan creado la base y el usuario de este servicio.
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
        "claves de .env coincidan con sql/01-bases-y-usuarios.sh."
        % (APP_NOMBRE, BD_HOST, BD_PUERTO, BD_NOMBRE, intentos)
    )


# El gateway ya valido el token, pero aqui se vuelve a validar: defensa en
# profundidad, por si alguien alcanza la red interna y llama directo.
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

    rol = g.sesion.get("rol")

    if request.method in ("GET", "HEAD"):
        for patron, permitidos in REGLAS_LECTURA:
            if patron.match(request.path):
                if rol in permitidos:
                    return None
                return jsonify({
                    "error": "Su rol (%s) no esta autorizado para leer este "
                             "registro de la cadena clinica." % rol,
                    "rolesPermitidos": list(permitidos),
                }), 403
        return jsonify({"error": "Ruta no encontrada en ms-consultas."}), 404

    for metodo, patron, permitidos in REGLAS_ESCRITURA:
        if request.method == metodo and patron.match(request.path):
            if rol in permitidos:
                return None
            return jsonify({
                "error": "Su rol (%s) no esta autorizado para esta accion." % rol,
                "rolesPermitidos": list(permitidos),
            }), 403

    return jsonify({"error": "Ruta no encontrada en ms-consultas."}), 404


def firmante():
    """Quien esta actuando, tomado del token y nunca del cuerpo de la peticion.

    Una remision, un diagnostico y una entrega de medicamento son actos que
    quedan firmados: los firma quien inicio sesion.
    """
    return g.sesion.get("nombre") or g.sesion.get("usuario") or "no indicado"


def token_de_servicio():
    """Credencial con la que ms-consultas le habla a ms-caja.

    Los cargos de laboratorio y farmacia los dispara un medico o farmacia, y
    ninguno de los dos puede escribir en ms-caja por su cuenta: eso es de
    ADMINISTRACION. Pero el cobro tiene que quedar registrado igual.

    La solucion es un token de servicio, firmado con el mismo secreto
    compartido, que dice tres cosas: que quien pide es ms-consultas (rol
    SERVICIO), en nombre de quien lo pide (el nombre real de la persona, para
    que el cargo quede firmado por ella y no por un robot), y que dura un
    minuto. ms-caja acepta el rol SERVICIO UNICAMENTE para crear cargos.
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
        SECRETO, algorithm="HS256",
    )


def autorizacion_del_cliente():
    """El encabezado tal cual llego, para reenviarlo a otro microservicio."""
    return {"Authorization": request.headers.get("Authorization", "")}



def existe_el_interno(paciente_id):
    """Devuelve (ficha, error, codigo). Nunca lanza excepcion.

    No se remite a un paciente que no esta en el padron. El padron lo tiene
    ms-pastillero, asi que se le pregunta a el; si no responde, no se inventa
    la respuesta: 503 y no se guarda nada.
    """
    try:
        r = requests.get(
            "%s/api/v1/internos/%s" % (PASTILLERO_URL, paciente_id),
            headers=autorizacion_del_cliente(), timeout=4,
        )
    except requests.RequestException:
        return None, ("MS-PASTILLERO no responde y sin el padron no se puede "
                      "comprobar que el interno exista. No se registra la "
                      "solicitud a ciegas."), 503
    if r.status_code == 404:
        return None, "El interno %s no existe en el padron del asilo." % paciente_id, 404
    if r.status_code != 200:
        return None, ("MS-PASTILLERO respondio con codigo %d al consultar el "
                      "padron." % r.status_code), 503
    # De la ficha salen el nombre del interno y el correo del familiar.
    return r.json(), None, 200


def consultar_dictamen(paciente_id, principio_activo, dosis_mg, cada_horas, via="oral"):
    """Le pide a ms-vigia que dictamine la receta antes de guardarla.

    Se manda solo el pacienteId: la edad, las alergias y las psicopatologias
    las busca ms-vigia por su cuenta en ms-pastillero. Igual que en la
    estacion web, el cliente no puede mentir sobre la ficha.
    """
    try:
        r = requests.post(
            "%s/api/v1/validaciones" % VIGIA_URL,
            headers=autorizacion_del_cliente(),
            json={
                "pacienteId": paciente_id,
                "propuesta": {
                    "principioActivo": principio_activo,
                    "dosisMg": dosis_mg,
                    "cadaHoras": cada_horas,
                    "viaAdministracion": via,
                },
            },
            timeout=6,
        )
    except requests.RequestException:
        return None, ("MS-VIGIA no responde. No se receta sin dictamen de "
                      "farmacovigilancia."), 503
    if r.status_code == 201:
        return r.json(), None, 201
    if r.status_code in (400, 404):
        cuerpo = r.json() if r.content else {}
        return None, cuerpo.get("error", "MS-VIGIA rechazo la propuesta."), r.status_code
    return None, "MS-VIGIA respondio con codigo %d." % r.status_code, 503


def crear_cargo(paciente_id, categoria, concepto, tarifa, visita_id=None):
    """Crea el cargo en ms-caja. Devuelve (cargo_id, advertencia).

    visita_id viaja con el cobro a proposito. La caja no puede averiguar por
    su cuenta de que consulta salio un examen o un medicamento: las visitas
    viven en asilo_consultas y usr_caja no tiene permiso para leer esa base.
    Mandandoselo aqui, la caja puede responder despues cuanto costo una
    consulta completa sin llamar a nadie.

    Si ms-caja no responde, devuelve (None, advertencia) y el llamador guarda
    igual el dato clinico: no se pierde un examen ni una receta por un fallo
    de facturacion. El cobro se concilia despues con el cargo_id nulo.
    """
    try:
        r = requests.post(
            "%s/api/v1/cargos" % CAJA_URL,
            headers={"Authorization": "Bearer " + token_de_servicio()},
            json={
                "pacienteId": paciente_id,
                "categoria": categoria,
                "concepto": concepto,
                "tarifa": tarifa,
                "visitaId": visita_id,
            },
            timeout=4,
        )
    except requests.RequestException:
        return None, ("No se pudo registrar el cobro: MS-CAJA no responde. El "
                      "dato clinico quedo guardado; el cargo hay que crearlo a "
                      "mano.")
    if r.status_code != 201:
        return None, ("No se pudo registrar el cobro: MS-CAJA respondio con "
                      "codigo %d. El dato clinico quedo guardado." % r.status_code)
    return r.json().get("id"), None



def redactar_aviso(ficha, solicitud):
    """El texto del correo. Dice en que estado quedo y a donde se le remitio."""
    nombre = ficha.get("nombre") or solicitud["paciente_id"]
    responsable = ficha.get("responsable") or "familiar responsable"
    especialidad = solicitud["especialidad_solicitada"] or "la especialidad que corresponda"

    asunto = "Asilo Cabeza de Algodon · %s fue remitido a %s" % (nombre, especialidad)

    cuerpo = (
        "Estimado/a %s:\n"
        "\n"
        "Le escribimos del Asilo de Ancianos \"Cabeza de Algodon\" para informarle\n"
        "que su familiar %s (%s) fue remitido a una consulta con especialista.\n"
        "\n"
        "  Numero de solicitud : %s\n"
        "  Especialidad        : %s\n"
        "  Motivo              : %s\n"
        "  Remitido por        : %s\n"
        "  Fecha de la remision: %s\n"
        "  Estado actual       : %s\n"
        "\n"
        "%s\n"
        "\n"
        "Cuando la fundacion le asigne medico, fecha y hora, se le informara el\n"
        "detalle de la cita. Si necesita acompañar a su familiar ese dia, puede\n"
        "comunicarse con la administracion del asilo.\n"
        "\n"
        "Atentamente,\n"
        "Asilo de Ancianos \"Cabeza de Algodon\"\n"
        "Mazatenango, Suchitepequez\n"
    ) % (
        responsable, nombre, solicitud["paciente_id"], solicitud["id"], especialidad,
        solicitud["motivo"], solicitud["solicitado_por"] or "el medico general",
        fecha_legible(solicitud["creada_en"]),
        "PENDIENTE de que la fundacion le asigne medico y hora",
        ("Lo acompaña: " + solicitud["enfermero_acompanante"] + ".")
        if solicitud["enfermero_acompanante"] else
        "El asilo coordinara el acompañamiento el dia de la cita.",
    )
    return asunto, cuerpo


def fecha_legible(momento):
    return momento.strftime("%d/%m/%Y a las %H:%M") if momento else "sin fecha"


def registrar_aviso(solicitud, ficha):
    """Avisa al familiar y deja constancia. NUNCA propaga una excepcion.

    Que el correo falle no puede tumbar la remision: la remision es el acto
    clinico y el correo es una notificacion. Por eso esto corre despues del
    commit de la solicitud, en su propia transaccion, y cualquier problema se
    resuelve dejando el correo asentado con el estado que corresponda.
    """
    try:
        destinatario = (ficha or {}).get("correoResponsable")
        asunto, cuerpo = redactar_aviso(ficha or {}, solicitud)

        if not destinatario:
            estado = "SIN_DESTINATARIO"
        elif not SMTP_HOST:
            estado = "REGISTRADO"
        else:
            estado = enviar_por_smtp(destinatario, asunto, cuerpo)

        # Al log siempre y completo: es la prueba de que el aviso se genero
        # aunque no haya servidor de correo.
        print(
            "\n[%s] ===== AVISO AL FAMILIAR (%s) =====\n"
            "De     : %s\n"
            "Para   : %s\n"
            "Asunto : %s\n"
            "%s\n"
            "[%s] ===== fin del aviso =====\n"
            % (APP_NOMBRE, estado, SMTP_DE, destinatario or "(sin correo en la ficha)",
               asunto, cuerpo, APP_NOMBRE),
            flush=True,
        )

        correo_id = folio("CO")
        bd = conexion()
        try:
            ejecutar(
                """INSERT INTO correos_enviados
                       (id, solicitud_id, destinatario, asunto, cuerpo, enviado_en, estado)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (correo_id, solicitud["id"], destinatario, asunto, cuerpo, ahora(), estado),
            )
            bd.commit()
        except Exception:
            bd.rollback()
            raise
        return {"id": correo_id, "estado": estado, "destinatario": destinatario,
                "asunto": asunto}
    except Exception as error:
        # Ni siquiera se pudo dejar constancia. La remision ya esta guardada.
        print("[%s] no se pudo registrar el aviso al familiar: %s"
              % (APP_NOMBRE, error), flush=True)
        return None


def enviar_por_smtp(destinatario, asunto, cuerpo):
    """Devuelve ENVIADO o FALLIDO. No lanza excepcion."""
    mensaje = EmailMessage()
    mensaje["From"] = SMTP_DE
    mensaje["To"] = destinatario
    mensaje["Subject"] = asunto
    mensaje.set_content(cuerpo)
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PUERTO, timeout=8) as servidor:
            servidor.ehlo()
            try:
                servidor.starttls()
                servidor.ehlo()
            except smtplib.SMTPException:
                # Servidor sin TLS: se sigue en claro, normal en un servidor
                # de pruebas dentro de la propia red.
                pass
            if SMTP_USUARIO:
                servidor.login(SMTP_USUARIO, SMTP_CLAVE)
            servidor.send_message(mensaje)
        return "ENVIADO"
    except Exception as error:
        print("[%s] SMTP en %s:%s rechazo el envio: %s"
              % (APP_NOMBRE, SMTP_HOST, SMTP_PUERTO, error), flush=True)
        return "FALLIDO"



def folio(prefijo):
    return "%s-%s-%s" % (prefijo, datetime.now().year, uuid.uuid4().hex[:8].upper())


def ahora():
    return datetime.now().replace(microsecond=0)


def iso(momento):
    return momento.isoformat(timespec="seconds") if momento else None


def leer_fecha(texto, campo):
    """Acepta AAAA-MM-DDTHH:MM o AAAA-MM-DD HH:MM. Devuelve (fecha, error)."""
    if not texto:
        return None, "Falta %s." % campo
    try:
        return datetime.fromisoformat(str(texto).replace(" ", "T")), None
    except ValueError:
        return None, "%s debe tener formato ISO (AAAA-MM-DDTHH:MM)." % campo


def solicitud_json(fila):
    return {
        "id": fila["id"],
        "pacienteId": fila["paciente_id"],
        "motivo": fila["motivo"],
        "especialidadSolicitada": fila["especialidad_solicitada"],
        "enfermeroAcompanante": fila["enfermero_acompanante"],
        "solicitadoPor": fila["solicitado_por"],
        "creadaEn": iso(fila["creada_en"]),
        "estado": fila["estado"],
        "medicoAsignado": fila["medico_asignado"],
        "especialidadAsignada": fila["especialidad_asignada"],
        "agendadaPara": iso(fila["agendada_para"]),
        "agendadaPor": fila["agendada_por"],
    }


def examen_json(fila):
    return {
        "id": fila["id"],
        "visitaId": fila["visita_id"],
        "nombre": fila["nombre"],
        "indicadoEn": iso(fila["indicado_en"]),
        "estado": fila["estado"],
        "resultado": fila["resultado"],
        "resultadoEn": iso(fila["resultado_en"]),
        "registradoPor": fila["registrado_por"],
        "cargoId": fila["cargo_id"],
    }


def indicacion_json(fila):
    return {
        "id": fila["id"],
        "visitaId": fila["visita_id"],
        "principioActivo": fila["principio_activo"],
        "nombre": fila["nombre"],
        "dosisMg": float(fila["dosis_mg"]),
        "cadaHoras": float(fila["cada_horas"]),
        "duracionDias": fila["duracion_dias"],
        "comoTomarlo": fila["como_tomarlo"],
        "entregado": bool(fila["entregado"]),
        "entregadoEn": iso(fila["entregado_en"]),
        "entregadoPor": fila["entregado_por"],
        "cargoId": fila["cargo_id"],
    }


def visita_json(fila, con_detalle=True):
    visita = {
        "id": fila["id"],
        "solicitudId": fila["solicitud_id"],
        "pacienteId": fila["paciente_id"],
        "fechaVisita": iso(fila["fecha_visita"]),
        "motivo": fila["motivo"],
        "medicoTratante": fila["medico_tratante"],
        "especialidad": fila["especialidad"],
        "diagnostico": fila["diagnostico"],
        "observaciones": fila["observaciones"],
        "estado": fila["estado"],
        "creadaEn": iso(fila["creada_en"]),
    }
    if con_detalle:
        # Cada bloque solo si el rol puede verlo: los dos pueden abrir la
        # visita, pero no leer lo del otro.
        rol = g.sesion.get("rol") if "sesion" in g else None
        if rol in ROLES_VEN_EXAMENES:
            visita["examenes"] = [
                examen_json(f) for f in consultar(
                    "SELECT * FROM examenes WHERE visita_id = %s ORDER BY indicado_en",
                    (fila["id"],))
            ]
        if rol in ROLES_VEN_INDICACIONES:
            visita["indicaciones"] = [
                indicacion_json(f) for f in consultar(
                    "SELECT * FROM indicaciones WHERE visita_id = %s ORDER BY id",
                    (fila["id"],))
            ]
    return visita



@app.get("/salud")
def salud():
    return jsonify({
        "servicio": APP_NOMBRE,
        "version": APP_VERSION,
        "estado": "arriba",
        "solicitudesPendientes": consultar_uno(
            "SELECT COUNT(*) n FROM solicitudes WHERE estado='PENDIENTE'")["n"],
        "visitasAbiertas": consultar_uno(
            "SELECT COUNT(*) n FROM visitas WHERE estado='ABIERTA'")["n"],
        "avisosRegistrados": consultar_uno(
            "SELECT COUNT(*) n FROM correos_enviados")["n"],
        "smtpConfigurado": bool(SMTP_HOST),
        "dependeDe": {"pastillero": PASTILLERO_URL, "vigia": VIGIA_URL, "caja": CAJA_URL},
        "hora": iso(ahora()),
    })



@app.post("/api/v1/solicitudes")
def crear_solicitud():
    cuerpo = request.get_json(silent=True) or {}
    errores = []
    if not cuerpo.get("pacienteId"):
        errores.append("Falta pacienteId.")
    if not (cuerpo.get("motivo") or "").strip():
        errores.append("Falta el motivo de la remision.")
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    ficha, problema, codigo = existe_el_interno(cuerpo["pacienteId"])
    if problema:
        return jsonify({"error": problema, "pacienteId": cuerpo["pacienteId"]}), codigo

    solicitud_id = folio("SOL")
    creada = ahora()
    bd = conexion()
    try:
        ejecutar(
            """INSERT INTO solicitudes
                   (id, paciente_id, motivo, especialidad_solicitada,
                    enfermero_acompanante, solicitado_por, creada_en, estado)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'PENDIENTE')""",
            (solicitud_id, cuerpo["pacienteId"], cuerpo["motivo"].strip(),
             cuerpo.get("especialidadSolicitada"), cuerpo.get("enfermeroAcompanante"),
             firmante(), creada),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    # El aviso va DESPUES del commit y en su propia transaccion: la remision
    # es el acto clinico y no puede depender de que el correo salga.
    fila = consultar_uno("SELECT * FROM solicitudes WHERE id = %s", (solicitud_id,))
    aviso = registrar_aviso(fila, ficha)

    salida = solicitud_json(fila)
    if aviso:
        salida["avisoFamiliar"] = aviso
    return jsonify(salida), 201


@app.get("/api/v1/solicitudes")
def listar_solicitudes():
    sql = "SELECT * FROM solicitudes WHERE 1=1"
    parametros = []
    estado = request.args.get("estado")
    paciente = request.args.get("pacienteId")
    if estado:
        sql += " AND estado = %s"
        parametros.append(estado.upper())
    if paciente:
        sql += " AND paciente_id = %s"
        parametros.append(paciente)
    sql += " ORDER BY creada_en DESC LIMIT 200"
    filas = consultar(sql, parametros)
    return jsonify({"total": len(filas),
                    "solicitudes": [solicitud_json(f) for f in filas]})


@app.get("/api/v1/solicitudes/<solicitud_id>")
def obtener_solicitud(solicitud_id):
    fila = consultar_uno("SELECT * FROM solicitudes WHERE id = %s", (solicitud_id,))
    if fila is None:
        return jsonify({"error": "No existe la solicitud %s." % solicitud_id}), 404
    salida = solicitud_json(fila)
    visita = consultar_uno("SELECT * FROM visitas WHERE solicitud_id = %s", (solicitud_id,))
    salida["visitaId"] = visita["id"] if visita else None
    return jsonify(salida)


@app.put("/api/v1/solicitudes/<solicitud_id>/agendar")
def agendar_solicitud(solicitud_id):
    """La fundacion le asigna medico, especialidad y hora a la remision."""
    cuerpo = request.get_json(silent=True) or {}
    errores = []
    if not (cuerpo.get("medicoAsignado") or "").strip():
        errores.append("Falta medicoAsignado.")
    if not (cuerpo.get("especialidadAsignada") or "").strip():
        errores.append("Falta especialidadAsignada.")
    fecha, problema = leer_fecha(cuerpo.get("agendadaPara"), "agendadaPara")
    if problema:
        errores.append(problema)
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    fila = consultar_uno("SELECT * FROM solicitudes WHERE id = %s", (solicitud_id,))
    if fila is None:
        return jsonify({"error": "No existe la solicitud %s." % solicitud_id}), 404
    if fila["estado"] != "PENDIENTE":
        return jsonify({
            "error": "La solicitud %s esta %s: solo se agenda una solicitud PENDIENTE."
                     % (solicitud_id, fila["estado"]),
            "estado": fila["estado"],
        }), 409

    bd = conexion()
    try:
        ejecutar(
            """UPDATE solicitudes
                  SET estado='AGENDADA', medico_asignado=%s, especialidad_asignada=%s,
                      agendada_para=%s, agendada_por=%s
                WHERE id = %s""",
            (cuerpo["medicoAsignado"].strip(), cuerpo["especialidadAsignada"].strip(),
             fecha, firmante(), solicitud_id),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    return jsonify(solicitud_json(
        consultar_uno("SELECT * FROM solicitudes WHERE id = %s", (solicitud_id,))))


@app.get("/api/v1/correos")
def listar_correos():
    """Bitacora de avisos a las familias.

    Existe para que el aviso se pueda MOSTRAR en pantalla: sin servidor de
    correo configurado el mensaje no sale a Internet, pero si queda escrito
    aqui con su asunto y su cuerpo completos, y la estacion lo enseña.
    """
    sql = ("SELECT c.*, s.paciente_id, s.especialidad_solicitada "
           "FROM correos_enviados c "
           "JOIN solicitudes s ON s.id = c.solicitud_id WHERE 1=1")
    parametros = []
    paciente = request.args.get("pacienteId")
    solicitud = request.args.get("solicitudId")
    if paciente:
        sql += " AND s.paciente_id = %s"
        parametros.append(paciente)
    if solicitud:
        sql += " AND c.solicitud_id = %s"
        parametros.append(solicitud)
    sql += " ORDER BY c.enviado_en DESC LIMIT 200"

    correos = [
        {
            "id": f["id"],
            "solicitudId": f["solicitud_id"],
            "pacienteId": f["paciente_id"],
            "destinatario": f["destinatario"],
            "asunto": f["asunto"],
            "cuerpo": f["cuerpo"],
            "enviadoEn": iso(f["enviado_en"]),
            "estado": f["estado"],
        }
        for f in consultar(sql, parametros)
    ]
    return jsonify({
        "total": len(correos),
        # La pantalla lo usa para explicar por que el estado es REGISTRADO.
        "smtpConfigurado": bool(SMTP_HOST),
        "correos": correos,
    })



@app.post("/api/v1/visitas")
def crear_visita():
    """Convierte una solicitud AGENDADA en la visita del especialista."""
    cuerpo = request.get_json(silent=True) or {}
    solicitud_id = cuerpo.get("solicitudId")
    if not solicitud_id:
        return jsonify({"error": "Peticion invalida",
                        "detalles": ["Falta solicitudId."]}), 400

    solicitud = consultar_uno("SELECT * FROM solicitudes WHERE id = %s", (solicitud_id,))
    if solicitud is None:
        return jsonify({"error": "No existe la solicitud %s." % solicitud_id}), 404
    if solicitud["estado"] != "AGENDADA":
        return jsonify({
            "error": "La solicitud %s esta %s: solo se atiende una solicitud AGENDADA."
                     % (solicitud_id, solicitud["estado"]),
            "estado": solicitud["estado"],
        }), 409
    if consultar_uno("SELECT id FROM visitas WHERE solicitud_id = %s", (solicitud_id,)):
        return jsonify({
            "error": "La solicitud %s ya tiene una visita registrada." % solicitud_id,
        }), 409

    fecha = solicitud["agendada_para"] or ahora()
    if cuerpo.get("fechaVisita"):
        fecha, problema = leer_fecha(cuerpo["fechaVisita"], "fechaVisita")
        if problema:
            return jsonify({"error": "Peticion invalida", "detalles": [problema]}), 400

    visita_id = folio("VM")
    bd = conexion()
    # Crear la visita y marcar la solicitud atendida van juntas: si no, la
    # agenda queda mintiendo.
    try:
        ejecutar(
            """INSERT INTO visitas
                   (id, solicitud_id, paciente_id, fecha_visita, motivo,
                    medico_tratante, especialidad, estado, creada_en)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'ABIERTA',%s)""",
            (visita_id, solicitud_id, solicitud["paciente_id"], fecha,
             solicitud["motivo"], solicitud["medico_asignado"],
             solicitud["especialidad_asignada"], ahora()),
        )
        ejecutar("UPDATE solicitudes SET estado='ATENDIDA' WHERE id = %s", (solicitud_id,))
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    return jsonify(visita_json(
        consultar_uno("SELECT * FROM visitas WHERE id = %s", (visita_id,)))), 201


@app.get("/api/v1/visitas")
def listar_visitas():
    """El historial clinico del interno: es la ficha medica del enunciado."""
    sql = "SELECT * FROM visitas WHERE 1=1"
    parametros = []
    paciente = request.args.get("pacienteId")
    estado = request.args.get("estado")
    if paciente:
        sql += " AND paciente_id = %s"
        parametros.append(paciente)
    if estado:
        sql += " AND estado = %s"
        parametros.append(estado.upper())
    sql += " ORDER BY fecha_visita DESC LIMIT 200"
    filas = consultar(sql, parametros)
    return jsonify({"total": len(filas),
                    "visitas": [visita_json(f) for f in filas]})


@app.get("/api/v1/visitas/<visita_id>")
def obtener_visita(visita_id):
    fila = consultar_uno("SELECT * FROM visitas WHERE id = %s", (visita_id,))
    if fila is None:
        return jsonify({"error": "No existe la visita %s." % visita_id}), 404
    return jsonify(visita_json(fila))


@app.put("/api/v1/visitas/<visita_id>")
def actualizar_visita(visita_id):
    """Diagnostico y observaciones: lo que el especialista escribe."""
    cuerpo = request.get_json(silent=True) or {}
    fila = consultar_uno("SELECT * FROM visitas WHERE id = %s", (visita_id,))
    if fila is None:
        return jsonify({"error": "No existe la visita %s." % visita_id}), 404
    if fila["estado"] == "CERRADA":
        return jsonify({
            "error": "La visita %s esta cerrada: no se puede modificar la ficha."
                     % visita_id,
        }), 409

    diagnostico = cuerpo.get("diagnostico", fila["diagnostico"])
    observaciones = cuerpo.get("observaciones", fila["observaciones"])
    bd = conexion()
    try:
        ejecutar("UPDATE visitas SET diagnostico=%s, observaciones=%s WHERE id=%s",
                 (diagnostico, observaciones, visita_id))
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    return jsonify(visita_json(
        consultar_uno("SELECT * FROM visitas WHERE id = %s", (visita_id,))))


@app.put("/api/v1/visitas/<visita_id>/cerrar")
def cerrar_visita(visita_id):
    fila = consultar_uno("SELECT * FROM visitas WHERE id = %s", (visita_id,))
    if fila is None:
        return jsonify({"error": "No existe la visita %s." % visita_id}), 404
    if fila["estado"] == "CERRADA":
        return jsonify({"error": "La visita %s ya estaba cerrada." % visita_id}), 409

    bd = conexion()
    try:
        ejecutar("UPDATE visitas SET estado='CERRADA' WHERE id=%s", (visita_id,))
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    return jsonify(visita_json(
        consultar_uno("SELECT * FROM visitas WHERE id = %s", (visita_id,))))



@app.post("/api/v1/visitas/<visita_id>/examenes")
def indicar_examen(visita_id):
    cuerpo = request.get_json(silent=True) or {}
    nombre = (cuerpo.get("nombre") or "").strip()
    if not nombre:
        return jsonify({"error": "Peticion invalida",
                        "detalles": ["Falta el nombre del examen."]}), 400

    visita = consultar_uno("SELECT * FROM visitas WHERE id = %s", (visita_id,))
    if visita is None:
        return jsonify({"error": "No existe la visita %s." % visita_id}), 404
    if visita["estado"] == "CERRADA":
        return jsonify({
            "error": "La visita %s esta cerrada: no se le pueden agregar examenes."
                     % visita_id,
        }), 409

    # El cobro se intenta antes de guardar, pero su fallo no impide guardar:
    # el examen es el dato clinico y no se pierde por un problema de caja.
    cargo_id, advertencia = crear_cargo(
        visita["paciente_id"], "LABORATORIO",
        "%s (visita %s)" % (nombre, visita_id),
        cuerpo.get("tarifa", "laboratorio-basico"), visita_id)

    examen_id = folio("EX")
    bd = conexion()
    try:
        ejecutar(
            """INSERT INTO examenes
                   (id, visita_id, nombre, indicado_en, estado, cargo_id)
               VALUES (%s,%s,%s,%s,'SOLICITADO',%s)""",
            (examen_id, visita_id, nombre, ahora(), cargo_id),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    salida = examen_json(consultar_uno("SELECT * FROM examenes WHERE id = %s", (examen_id,)))
    if advertencia:
        salida["advertencia"] = advertencia
    return jsonify(salida), 201


@app.put("/api/v1/examenes/<examen_id>/resultado")
def cargar_resultado(examen_id):
    cuerpo = request.get_json(silent=True) or {}
    resultado = (cuerpo.get("resultado") or "").strip()
    if not resultado:
        return jsonify({"error": "Peticion invalida",
                        "detalles": ["Falta el resultado del examen."]}), 400

    fila = consultar_uno("SELECT * FROM examenes WHERE id = %s", (examen_id,))
    if fila is None:
        return jsonify({"error": "No existe el examen %s." % examen_id}), 404
    if fila["estado"] == "RESULTADO_LISTO":
        return jsonify({
            "error": "El examen %s ya tiene resultado, cargado por %s."
                     % (examen_id, fila["registrado_por"]),
        }), 409

    bd = conexion()
    try:
        ejecutar(
            """UPDATE examenes
                  SET estado='RESULTADO_LISTO', resultado=%s, resultado_en=%s,
                      registrado_por=%s
                WHERE id=%s""",
            (resultado, ahora(), firmante(), examen_id),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    return jsonify(examen_json(
        consultar_uno("SELECT * FROM examenes WHERE id = %s", (examen_id,))))


@app.get("/api/v1/examenes")
def listar_examenes():
    """Los examenes de un interno. El paciente vive en la visita, no en el
    examen: se llega a el por la union con visitas."""
    sql = ("SELECT e.*, v.paciente_id, v.fecha_visita FROM examenes e "
           "JOIN visitas v ON v.id = e.visita_id WHERE 1=1")
    parametros = []
    paciente = request.args.get("pacienteId")
    estado = request.args.get("estado")
    if paciente:
        sql += " AND v.paciente_id = %s"
        parametros.append(paciente)
    if estado:
        sql += " AND e.estado = %s"
        parametros.append(estado.upper())
    sql += " ORDER BY e.indicado_en DESC LIMIT 200"

    salida = []
    for fila in consultar(sql, parametros):
        examen = examen_json(fila)
        examen["pacienteId"] = fila["paciente_id"]
        examen["fechaVisita"] = iso(fila["fecha_visita"])
        salida.append(examen)
    return jsonify({"total": len(salida), "examenes": salida})



@app.post("/api/v1/visitas/<visita_id>/indicaciones")
def recetar(visita_id):
    """Receta un medicamento, pero solo si ms-vigia lo aprueba.

    Es el mismo control que hace la estacion web: nada entra al registro sin
    pasar por farmacovigilancia. Si el veredicto es BLOQUEADO, no se guarda
    nada y se devuelve el dictamen completo para que el medico vea por que.
    """
    cuerpo = request.get_json(silent=True) or {}
    errores = []
    principio = (cuerpo.get("principioActivo") or "").strip().lower()
    if not principio:
        errores.append("Falta principioActivo.")
    try:
        dosis = float(cuerpo.get("dosisMg"))
        if dosis <= 0:
            errores.append("dosisMg debe ser mayor que cero.")
    except (TypeError, ValueError):
        errores.append("dosisMg debe ser numerico.")
        dosis = 0
    try:
        cada = float(cuerpo.get("cadaHoras"))
        if not 1 <= cada <= 72:
            errores.append("cadaHoras debe estar entre 1 y 72.")
    except (TypeError, ValueError):
        errores.append("cadaHoras debe ser numerico.")
        cada = 0
    try:
        dias = int(cuerpo.get("duracionDias", 1))
        if not 1 <= dias <= 90:
            errores.append("duracionDias debe estar entre 1 y 90.")
    except (TypeError, ValueError):
        errores.append("duracionDias debe ser numerico.")
        dias = 0
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    visita = consultar_uno("SELECT * FROM visitas WHERE id = %s", (visita_id,))
    if visita is None:
        return jsonify({"error": "No existe la visita %s." % visita_id}), 404
    if visita["estado"] == "CERRADA":
        return jsonify({
            "error": "La visita %s esta cerrada: no se le pueden agregar recetas."
                     % visita_id,
        }), 409

    dictamen, problema, codigo = consultar_dictamen(
        visita["paciente_id"], principio, dosis, cada,
        (cuerpo.get("via") or "oral").lower())
    if problema:
        return jsonify({"error": problema, "pacienteId": visita["paciente_id"]}), codigo

    if dictamen["veredicto"] == "BLOQUEADO":
        return jsonify({
            "error": "MS-VIGIA bloqueo esta receta. No se guarda la indicacion.",
            "folio": dictamen["folio"],
            "veredicto": dictamen["veredicto"],
            "dictamen": dictamen,
        }), 409

    indicacion_id = folio("IN")
    bd = conexion()
    try:
        ejecutar(
            """INSERT INTO indicaciones
                   (id, visita_id, principio_activo, nombre, dosis_mg, cada_horas,
                    duracion_dias, como_tomarlo, entregado)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,FALSE)""",
            (indicacion_id, visita_id, principio,
             cuerpo.get("nombre") or dictamen["propuesta"].get("nombre") or principio.capitalize(),
             dosis, cada, dias, cuerpo.get("comoTomarlo")),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    salida = indicacion_json(
        consultar_uno("SELECT * FROM indicaciones WHERE id = %s", (indicacion_id,)))
    salida["folioValidacion"] = dictamen["folio"]
    salida["veredictoVigia"] = dictamen["veredicto"]
    salida["hallazgos"] = dictamen["hallazgos"]
    return jsonify(salida), 201


@app.put("/api/v1/indicaciones/<indicacion_id>/entregar")
def entregar_indicacion(indicacion_id):
    """Farmacia entrega el medicamento y se le carga a la cuenta del interno."""
    fila = consultar_uno(
        """SELECT i.*, v.paciente_id FROM indicaciones i
           JOIN visitas v ON v.id = i.visita_id WHERE i.id = %s""",
        (indicacion_id,))
    if fila is None:
        return jsonify({"error": "No existe la indicacion %s." % indicacion_id}), 404
    if fila["entregado"]:
        return jsonify({
            "error": "La indicacion %s ya fue entregada por %s. Una entrega no se "
                     "registra dos veces." % (indicacion_id, fila["entregado_por"]),
        }), 409

    cargo_id, advertencia = crear_cargo(
        fila["paciente_id"], "FARMACIA",
        "%s %s mg (indicacion %s)" % (fila["nombre"], fila["dosis_mg"], indicacion_id),
        request.get_json(silent=True).get("tarifa", "farmacia-generico")
        if request.get_json(silent=True) else "farmacia-generico",
        fila["visita_id"])

    bd = conexion()
    try:
        ejecutar(
            """UPDATE indicaciones
                  SET entregado=TRUE, entregado_en=%s, entregado_por=%s, cargo_id=%s
                WHERE id=%s""",
            (ahora(), firmante(), cargo_id, indicacion_id),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    salida = indicacion_json(
        consultar_uno("SELECT * FROM indicaciones WHERE id = %s", (indicacion_id,)))
    if advertencia:
        salida["advertencia"] = advertencia
    return jsonify(salida)



@app.get("/api/v1/reportes/examenes")
def reporte_examenes():
    """Examenes de un interno, con el estado de cada uno y su resultado.

    El examen no guarda a que paciente pertenece: pertenece a una visita, y la
    visita a un paciente. Se llega por la union, igual que en /api/v1/examenes.
    Lo que agrega este reporte es el conteo por estado, que es lo que se
    pregunta de verdad: cuantos se mandaron y cuantos ya tienen resultado.
    """
    paciente = (request.args.get("pacienteId") or "").strip()
    if not paciente:
        return jsonify({
            "error": "Falta pacienteId.",
            "ejemplo": "/api/v1/reportes/examenes?pacienteId=ASL-014",
        }), 400

    filas = consultar(
        """SELECT e.*, v.paciente_id, v.fecha_visita, v.medico_tratante,
                  v.especialidad, v.diagnostico
             FROM examenes e
             JOIN visitas v ON v.id = e.visita_id
            WHERE v.paciente_id = %s
            ORDER BY e.indicado_en DESC, e.id""",
        (paciente,),
    )

    examenes = []
    for fila in filas:
        examen = examen_json(fila)
        # De que consulta salio: sin esto son estudios sueltos.
        examen["pacienteId"] = fila["paciente_id"]
        examen["fechaVisita"] = iso(fila["fecha_visita"])
        examen["medicoTratante"] = fila["medico_tratante"]
        examen["especialidad"] = fila["especialidad"]
        examenes.append(examen)

    listos = sum(1 for e in examenes if e["estado"] == "RESULTADO_LISTO")
    return jsonify({
        "pacienteId": paciente,
        "total": len(examenes),
        "conResultado": listos,
        "pendientes": len(examenes) - listos,
        "examenes": examenes,
    })


@app.get("/api/v1/reportes/ficha")
def reporte_ficha():
    """La ficha medica completa del interno, en una sola respuesta.

    Reune lo que esta repartido en dos microservicios:

      de ms-pastillero   psicopatologias y alergias (el padron del asilo)
      de esta base       las visitas, con su diagnostico, sus examenes y
                         los medicamentos que se recetaron en cada una

    Se le pide la ficha a ms-pastillero con el token de QUIEN PREGUNTA, no con
    el token de servicio. Asi ms-pastillero aplica su propia restriccion: si
    algun dia esta ruta se le abriera a un rol no clinico, el padron seguiria
    negandole la parte clinica por su cuenta. La defensa en profundidad no
    sirve si el servicio de adelante se salta la del de atras.

    Si ms-pastillero no responde, el reporte NO falla: devuelve el historial
    clinico —que es local y esta completo— y avisa que la parte del padron no
    se pudo traer. Es distinto de lo que hace una remision, que si aborta con
    503: alli se estaria escribiendo un dato nuevo a ciegas, aqui solo se lee.
    """
    paciente = (request.args.get("pacienteId") or "").strip()
    if not paciente:
        return jsonify({
            "error": "Falta pacienteId.",
            "ejemplo": "/api/v1/reportes/ficha?pacienteId=ASL-014",
        }), 400

    ficha, error, codigo = existe_el_interno(paciente)
    if codigo == 404:
        return jsonify({"error": error}), 404

    visitas = [
        visita_json(f) for f in consultar(
            "SELECT * FROM visitas WHERE paciente_id = %s ORDER BY fecha_visita DESC",
            (paciente,))
    ]
    solicitudes = [
        solicitud_json(f) for f in consultar(
            "SELECT * FROM solicitudes WHERE paciente_id = %s ORDER BY creada_en DESC",
            (paciente,))
    ]

    total_examenes = sum(len(v.get("examenes", [])) for v in visitas)
    total_indicaciones = sum(len(v.get("indicaciones", [])) for v in visitas)

    salida = {
        "pacienteId": paciente,
        "generadoEn": iso(ahora()),
        # Es un documento clinico: se imprime con el nombre de quien lo saco.
        "consultadaPor": firmante(),
        "identificacion": None,
        "psicopatologias": None,
        "alergias": None,
        "solicitudes": solicitudes,
        "visitas": visitas,
        "resumen": {
            "solicitudes": len(solicitudes),
            "visitas": len(visitas),
            "examenes": total_examenes,
            "medicamentosIndicados": total_indicaciones,
        },
    }

    if ficha:
        salida["identificacion"] = {
            "nombre": ficha.get("nombre"),
            "edad": ficha.get("edad"),
            "cama": ficha.get("cama"),
            "ingreso": ficha.get("ingreso"),
            "responsable": ficha.get("responsable"),
            "correoResponsable": ficha.get("correoResponsable"),
        }
        # Solo si ms-pastillero considera clinico a quien pregunta. Si faltan
        # se dice que faltan: vacias se leerian como "no tiene alergias".
        salida["psicopatologias"] = ficha.get("psicopatologias")
        salida["alergias"] = ficha.get("alergias")
        if ficha.get("psicopatologias") is None:
            salida["advertencia"] = ("El padron no entrego la parte clinica de la ficha "
                                     "para este rol: psicopatologias y alergias no se "
                                     "muestran. No significa que el interno no tenga.")
    else:
        salida["advertencia"] = (
            "No se pudo traer la ficha del padron: %s El historial clinico que sigue "
            "esta completo, pero faltan psicopatologias, alergias y los datos de "
            "identificacion del interno." % (error or "")
        ).strip()

    return jsonify(salida)


# Sembrado del escenario de demostracion.
#
# Los folios son FIJOS y llevan DEMO por dos razones: se distinguen a simple
# vista de los aleatorios que genera folio(), y ms-caja necesita nombrar la
# visita de sus cargos. Las dos bases no se hablan al arrancar, asi que el
# folio tiene que estar escrito en los dos lados: si cambia VISITA_DEMO aqui,
# cambiarlo tambien en el sembrado de ms-caja.

VISITA_DEMO = "VM-2026-DEMO0022"

# Copia de lo que siembra ms-pastillero. Se repite a proposito: el sembrado
# corre al arrancar, cuando ms-pastillero puede no estar listo todavia, y un
# sembrado que depende de otro servicio es uno que a veces no ocurre.
FICHAS_SEMBRADAS = {
    "ASL-014": {"nombre": "Rosalía Menchú Coy", "responsable": "María Coy, hija",
                "correoResponsable": "maria.coy@ejemplo.gt"},
    "ASL-007": {"nombre": "Tránsito Xicará Tzoc", "responsable": "Julio Xicará, sobrino",
                "correoResponsable": "julio.xicara@ejemplo.gt"},
    "ASL-022": {"nombre": "Bernardo Puac Ixcoy", "responsable": "Elena Ixcoy, nieta",
                "correoResponsable": "elena.ixcoy@ejemplo.gt"},
}


def sembrar():
    """Escenario de demostracion. No hace nada si ya hay solicitudes."""
    bd = abrir_conexion()
    try:
        with bd.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) AS n FROM solicitudes")
            if cursor.fetchone()["n"] > 0:
                return

        hoy = datetime.now().replace(microsecond=0)
        # A la hora en punto: las fechas se leen parejas en la demostracion.
        base = hoy.replace(minute=0, second=0)

        solicitudes = [
            # PENDIENTE: la que la fundacion agenda en vivo. Transito Xicara
            # ya toma enalapril por hipertension.
            {
                "id": "SOL-2026-DEMO0007",
                "paciente_id": "ASL-007",
                "motivo": "Cifras de presion arterial elevadas en los ultimos tres "
                          "controles, pese al tratamiento con enalapril.",
                "especialidad_solicitada": "Cardiologia",
                "enfermero_acompanante": "Enf. Lucia Tzoc",
                "solicitado_por": "Dr. Angel Maltez",
                "creada_en": base - timedelta(days=2),
                "estado": "PENDIENTE",
                "medico_asignado": None,
                "especialidad_asignada": None,
                "agendada_para": None,
                "agendada_por": None,
            },
            # AGENDADA: la que el medico atiende en vivo. Rosalia Menchu tiene
            # demencia mixta e insomnio cronico.
            {
                "id": "SOL-2026-DEMO0014",
                "paciente_id": "ASL-014",
                "motivo": "Agitacion nocturna que no cede con el ajuste de la rutina "
                          "de sueño.",
                "especialidad_solicitada": "Psiquiatria",
                "enfermero_acompanante": "Enf. Lucia Tzoc",
                "solicitado_por": "Dr. Angel Maltez",
                "creada_en": base - timedelta(days=4),
                "estado": "AGENDADA",
                "medico_asignado": "Dra. Silvia Racancoj",
                "especialidad_asignada": "Psiquiatria",
                "agendada_para": (base + timedelta(days=1)).replace(hour=9),
                "agendada_por": "Fundación Manos Unidas",
            },
            # ATENDIDA: ya produjo la visita cerrada de abajo. Bernardo Puac
            # tiene fibrilacion auricular y toma warfarina.
            {
                "id": "SOL-2026-DEMO0022",
                "paciente_id": "ASL-022",
                "motivo": "Control de anticoagulacion por fibrilacion auricular.",
                "especialidad_solicitada": "Cardiologia",
                "enfermero_acompanante": "Enf. Lucia Tzoc",
                "solicitado_por": "Dr. Angel Maltez",
                "creada_en": base - timedelta(days=12),
                "estado": "ATENDIDA",
                "medico_asignado": "Dr. Rolando Sicajau",
                "especialidad_asignada": "Cardiologia",
                "agendada_para": (base - timedelta(days=9)).replace(hour=8),
                "agendada_por": "Fundación Manos Unidas",
            },
        ]

        cursor = bd.cursor()
        for s in solicitudes:
            cursor.execute(
                """INSERT INTO solicitudes
                       (id, paciente_id, motivo, especialidad_solicitada,
                        enfermero_acompanante, solicitado_por, creada_en, estado,
                        medico_asignado, especialidad_asignada, agendada_para,
                        agendada_por)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (s["id"], s["paciente_id"], s["motivo"], s["especialidad_solicitada"],
                 s["enfermero_acompanante"], s["solicitado_por"], s["creada_en"],
                 s["estado"], s["medico_asignado"], s["especialidad_asignada"],
                 s["agendada_para"], s["agendada_por"]),
            )

            # Toda solicitud genera su aviso: una sembrada sin correo seria un
            # estado que el sistema en marcha no puede producir. Se redacta con
            # la MISMA funcion del camino en vivo para que no se separen.
            ficha = FICHAS_SEMBRADAS.get(s["paciente_id"], {})
            asunto, cuerpo = redactar_aviso(ficha, s)
            destinatario = ficha.get("correoResponsable")
            cursor.execute(
                """INSERT INTO correos_enviados
                       (id, solicitud_id, destinatario, asunto, cuerpo, enviado_en, estado)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                ("CO-2026-DEMO" + s["id"][-4:], s["id"], destinatario, asunto, cuerpo,
                 s["creada_en"],
                 # Mismo criterio que registrar_aviso().
                 "SIN_DESTINATARIO" if not destinatario
                 else ("ENVIADO" if SMTP_HOST else "REGISTRADO")),
            )

        # La consulta cerrada que llena la ficha medica completa.
        atendida = base - timedelta(days=9)
        cursor.execute(
            """INSERT INTO visitas
                   (id, solicitud_id, paciente_id, fecha_visita, motivo,
                    medico_tratante, especialidad, diagnostico, observaciones,
                    estado, creada_en)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (VISITA_DEMO, "SOL-2026-DEMO0022", "ASL-022",
             atendida.replace(hour=8, minute=30),
             "Control de anticoagulacion por fibrilacion auricular.",
             "Dr. Rolando Sicajau", "Cardiologia",
             "Fibrilacion auricular permanente, con anticoagulacion en rango "
             "terapeutico y frecuencia ventricular controlada.",
             "Se mantiene la warfarina a la dosis actual y se surte la receta del "
             "mes. Control de INR en cuatro semanas y vigilancia de signos de "
             "sangrado.",
             "CERRADA", atendida),
        )

        # Los cargo_id apuntan a cargos que ms-caja siembra con esos mismos
        # folios. No es clave foranea: viven en la base de otro servicio.
        examenes = [
            ("EX-2026-DEMO0001", "Tiempo de protrombina e INR",
             "INR 2.4, dentro del rango terapeutico de 2.0 a 3.0. Sin ajuste de dosis.",
             "CG-DEMO0001"),
            ("EX-2026-DEMO0002", "Electrocardiograma de 12 derivaciones",
             "Fibrilacion auricular con respuesta ventricular controlada, 78 por minuto.",
             "CG-DEMO0002"),
        ]
        for ex_id, nombre, resultado, cargo in examenes:
            cursor.execute(
                """INSERT INTO examenes
                       (id, visita_id, nombre, indicado_en, estado, resultado,
                        resultado_en, registrado_por, cargo_id)
                   VALUES (%s,%s,%s,%s,'RESULTADO_LISTO',%s,%s,%s,%s)""",
                (ex_id, VISITA_DEMO, nombre, atendida.replace(hour=8, minute=45),
                 resultado, atendida.replace(hour=14), "Lab. Clínico Central", cargo),
            )

        # Warfarina 5 mg: ms-vigia la dictamina APROBADA sin hallazgos para
        # este interno. Sembrar algo que la propia farmacovigilancia marcaria
        # seria contradecirse en la demostracion.
        #
        # La dosis tambien pesa: dosis_mg es DECIMAL(10,2), asi que 0.125 mg se
        # guardaria como 0.13 y la ficha mostraria una dosis que nadie receto.
        cursor.execute(
            """INSERT INTO indicaciones
                   (id, visita_id, principio_activo, nombre, dosis_mg, cada_horas,
                    duracion_dias, como_tomarlo, entregado, entregado_en,
                    entregado_por, cargo_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,TRUE,%s,%s,%s)""",
            ("IN-2026-DEMO0001", VISITA_DEMO, "warfarina", "Warfarina", 5, 24, 30,
             "Por la noche, siempre a la misma hora. No cambiar la dosis sin control de INR.",
             atendida.replace(hour=15), "Farmacia de la Fundación", "CG-DEMO0003"),
        )

        bd.commit()
        print("[%s] escenario de demostracion sembrado: 3 solicitudes "
              "(PENDIENTE, AGENDADA, ATENDIDA) y la consulta cerrada %s"
              % (APP_NOMBRE, VISITA_DEMO), flush=True)
    except Exception as error:
        bd.rollback()
        # Que falle el sembrado no puede impedir que arranque el servicio.
        print("[%s] no se pudo sembrar el escenario de demostracion: %s"
              % (APP_NOMBRE, error), flush=True)
    finally:
        bd.close()


@app.errorhandler(404)
def no_encontrado(_):
    return jsonify({"error": "Ruta no encontrada en ms-consultas."}), 404


esperar_a_mysql()
if os.environ.get("SEMBRAR", "1") == "1":
    sembrar()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PUERTO", 8084)))
