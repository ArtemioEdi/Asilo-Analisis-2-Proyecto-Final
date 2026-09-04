import os
import re
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import jwt
import pymysql
from flask import Flask, g, jsonify, request
from flask.json.provider import DefaultJSONProvider
from pymysql.cursors import DictCursor

APP_NOMBRE = "ms-caja"
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
        "ms-caja no arranca: faltan las variables de conexion a MySQL (%s). "
        "Copie .env.ejemplo a .env." % ", ".join(_faltantes)
    )

# ---------------------------------------------------------------------------
# Secreto compartido con ms-gateway. No hay valor por defecto: si falta, el
# servicio no arranca. Un secreto escrito en el codigo es un secreto publicado.
# ---------------------------------------------------------------------------
SECRETO = os.environ.get("GATEWAY_SECRETO", "")
if len(SECRETO.strip()) < 16:
    raise RuntimeError(
        "ms-caja no arranca: falta la variable de entorno GATEWAY_SECRETO "
        "(o mide menos de 16 caracteres). Copie .env.ejemplo a .env y genere "
        "un secreto con: openssl rand -hex 32"
    )

# Matriz de acceso de este servicio. El movimiento de dinero del asilo, lo que
# se le cobra a cada familia y lo que se le debe a la fundacion lo ve y lo
# mueve administracion. Enfermeria no tiene por que conocerlo.
ROLES_LECTURA = ("ADMINISTRACION",)
ROLES_ESCRITURA = ("ADMINISTRACION",)

# Excepcion documentada: el medico puede consultar el estado de cuenta de un
# interno concreto. Antes de indicar un estudio de laboratorio necesita saber
# si el familiar responsable puede costearlo; sin ese dato terminaria
# indicando examenes que nunca se van a hacer. La excepcion es solo de lectura
# y solo de esta ruta: el medico no ve el resumen financiero del asilo, ni las
# donaciones, ni los gastos, ni la cuenta con la fundacion.
CUENTA_DE_PACIENTE = re.compile(r"^/api/v1/pacientes/[^/]+/cuenta/?$")

# Segunda excepcion, esta vez para otro servicio y no para una persona.
#
# Cuando el especialista manda un examen o farmacia entrega un medicamento,
# ms-consultas tiene que dejar el cobro asentado aqui. Pero quien dispara esa
# accion es un MEDICO o FARMACIA, y ninguno de los dos puede escribir en la
# caja: eso es de ADMINISTRACION, y asi debe seguir siendo. Si se le abriera
# la caja al medico para resolver esto, se perderia toda la separacion que
# defiende el resto del sistema.
#
# La salida es un token de servicio: ms-consultas firma, con el mismo secreto
# compartido, un token de un minuto que dice rol=SERVICIO y lleva el nombre
# real de la persona que provoco el cobro, para que el cargo quede firmado por
# ella y no por un robot. Aqui se acepta ese rol UNICAMENTE para crear cargos:
# no puede pagar, ni donar, ni registrar gastos, ni leer nada.
CREAR_CARGO = re.compile(r"^/api/v1/cargos/?$")
ROLES_SERVICIO = ("SERVICIO",)

# La sonda de vida no expone datos del asilo y la consulta Docker desde dentro
# del contenedor, sin token.
RUTAS_LIBRES = ("/salud",)

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


# El tarifario es la base de datos de conocimiento del servicio, igual que
# el vademecum lo es para ms-vigia: son datos, no logica de negocio.
TARIFARIO = {
    "consulta-general":     {"nombre": "Consulta medico general",     "categoria": "CONSULTA",     "precioFundacion": 150.0, "descuentoPct": 60},
    "consulta-especialista":{"nombre": "Consulta con especialista",   "categoria": "CONSULTA",     "precioFundacion": 350.0, "descuentoPct": 55},
    "laboratorio-basico":   {"nombre": "Perfil de laboratorio basico","categoria": "LABORATORIO",  "precioFundacion": 280.0, "descuentoPct": 50},
    "laboratorio-imagen":   {"nombre": "Estudio de imagen (Rx/US)",   "categoria": "LABORATORIO",  "precioFundacion": 420.0, "descuentoPct": 45},
    "farmacia-generico":    {"nombre": "Medicamento generico (caja)", "categoria": "FARMACIA",      "precioFundacion": 60.0,  "descuentoPct": 65},
    "farmacia-especializado":{"nombre": "Medicamento de marca / especializado", "categoria": "FARMACIA", "precioFundacion": 220.0, "descuentoPct": 40},
    # La cuota de estadia es la excepcion del tarifario: no la cobra la
    # fundacion, la paga el familiar directamente al asilo por tener a su
    # interno aqui. Por eso tiene precio propio y no lleva descuento de la
    # fundacion: no hay nada que descontar, el asilo es el que cobra.
    # Antes valia 0.0 y solo el sembrado lo suplia con un 450.0 de respaldo,
    # asi que toda cuota registrada desde la interfaz quedaba en Q0.00.
    "cuota-mensual":        {"nombre": "Cuota mensual de estadia",    "categoria": "CUOTA",        "precioFundacion": 450.0, "descuentoPct": 0},
}

CATEGORIAS_CARGO = {"CONSULTA", "LABORATORIO", "FARMACIA", "CUOTA", "OTRO"}

# Que le debe el asilo a la fundacion. Solo lo que la fundacion presta como
# servicio: consultas, laboratorio y farmacia. La CUOTA de estadia queda fuera
# a proposito, porque es plata que el familiar le paga al asilo por tener a su
# interno aqui; contarla como deuda con la fundacion inflaria las salidas con
# un gasto que no existe. OTRO tambien queda fuera: es un cargo interno.
CATEGORIAS_QUE_COBRA_LA_FUNDACION = ("CONSULTA", "LABORATORIO", "FARMACIA")
_EN_CLAUSULA_FUNDACION = "(" + ",".join("'%s'" % c for c in CATEGORIAS_QUE_COBRA_LA_FUNDACION) + ")"
CATEGORIAS_DONANTE = {"EMPRESA", "GOBIERNO", "PARTICULAR"}
CATEGORIAS_GASTO = {"SERVICIOS", "PERSONAL", "INSUMOS", "MANTENIMIENTO", "OTRO"}


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


def revisar_el_esquema():
    """Avisa si la base viene de una version anterior a cargos.visita_id.

    Este servicio NO se repara solo a proposito. usr_caja tiene unicamente
    SELECT, INSERT, UPDATE y DELETE sobre su base: no tiene ALTER, igual que
    los otros tres usuarios de servicio. Un microservicio que puede cambiar la
    forma de sus propias tablas en caliente es un microservicio que, el dia
    que lo comprometan, puede cambiarla para cualquier otra cosa. El esquema
    lo define sql/04-esquema-caja.sql y lo aplica el arranque de bd-asilo.

    En una instalacion nueva la columna ya viene creada y esta funcion no
    dice nada. Solo habla cuando alguien levanta codigo nuevo sobre un volumen
    viejo, y entonces dice exactamente que hacer.
    """
    try:
        bd = abrir_conexion()
        try:
            with bd.cursor() as cursor:
                cursor.execute(
                    """SELECT COUNT(*) AS hay FROM information_schema.columns
                        WHERE table_schema = %s AND table_name = 'cargos'
                          AND column_name = 'visita_id'""",
                    (BD_NOMBRE,),
                )
                if cursor.fetchone()["hay"]:
                    return
        finally:
            bd.close()
    except Exception as error:
        print("[%s] no se pudo revisar el esquema: %s" % (APP_NOMBRE, error), flush=True)
        return

    print(
        "\n[%s] AVISO: la tabla cargos de esta base no tiene la columna visita_id.\n"
        "  Este volumen de datos se creo con una version anterior del esquema, y\n"
        "  los archivos de sql/ solo corren cuando el volumen esta vacio.\n"
        "  El reporte GET /api/v1/reportes/costo-por-visita no va a funcionar.\n"
        "  La forma limpia de resolverlo es rehacer el volumen:\n"
        "      docker compose down -v && docker compose up -d --build\n"
        "  Si hay datos que conservar, la columna se agrega a mano con el usuario\n"
        "  root del motor (usr_caja no tiene ALTER, y asi debe seguir):\n"
        "      ALTER TABLE asilo_caja.cargos ADD COLUMN visita_id VARCHAR(24) NULL;\n"
        "      ALTER TABLE asilo_caja.cargos ADD INDEX idx_cargos_visita (visita_id);\n"
        % APP_NOMBRE, flush=True)


def _folio(prefijo):
    return "%s-%s" % (prefijo, uuid.uuid4().hex[:8].upper())


# ---------------------------------------------------------------------------
# Verificacion de la sesion.
#
# ms-gateway ya valida el token antes de reenviar la peticion, pero este
# servicio lo vuelve a verificar por su cuenta: es defensa en profundidad. Si
# alguien alcanza la red interna del stack y llama directo a ms-caja sin pasar
# por el gateway, aqui se le vuelve a pedir quien es. Este era el agujero mas
# visible del prototipo: bastaba un POST a localhost:8083 para meter una
# donacion inventada en los libros del asilo, sin haber iniciado sesion nunca.
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
    if not escribe and CUENTA_DE_PACIENTE.match(request.path):
        permitidos = permitidos + ("MEDICO",)
    # El token de servicio de ms-consultas: solo POST /api/v1/cargos.
    if escribe and request.method == "POST" and CREAR_CARGO.match(request.path):
        permitidos = permitidos + ROLES_SERVICIO

    if g.sesion.get("rol") not in permitidos:
        return jsonify({
            "error": "Su rol (%s) no esta autorizado para %s la caja del asilo."
                     % (g.sesion.get("rol"), "escribir en" if escribe else "leer"),
            "rolesPermitidos": list(permitidos),
        }), 403
    return None


def firmante():
    """Quien esta actuando, tomado del token y nunca del cuerpo de la peticion.

    Antes el cliente mandaba registradoPor, asi que cualquiera podia dejar un
    cobro o una donacion firmados a nombre de otra persona. En un libro de caja
    eso es exactamente lo que no puede pasar.
    """
    return g.sesion.get("nombre") or g.sesion.get("usuario") or "no indicado"


@app.get("/salud")
def salud():
    bd = conexion()
    return jsonify({
        "servicio": APP_NOMBRE,
        "version": APP_VERSION,
        "estado": "arriba",
        "cargosRegistrados": consultar_uno("SELECT COUNT(*) n FROM cargos")["n"],
        "hora": datetime.now().isoformat(timespec="seconds"),
    })


@app.get("/api/v1/tarifas")
def listar_tarifas():
    salida = [dict(clave=clave, **datos) for clave, datos in TARIFARIO.items()]
    return jsonify({"total": len(salida), "tarifas": salida})


def _cargo_json(fila):
    # Las columnas de dinero son DECIMAL y MySQL las devuelve como Decimal.
    # Se pasan a float aqui para que el resto del servicio siga haciendo
    # aritmetica con los valores que llegan de la peticion, que son float, y
    # para que la respuesta sea identica a la de la version con SQLite. La
    # exactitud que importa —la de las sumas de los reportes— la da MySQL,
    # que hace los SUM() sobre DECIMAL.
    neto = float(fila["monto_neto"])
    pagado = float(fila["monto_pagado"])
    return {
        "id": fila["id"],
        "pacienteId": fila["paciente_id"],
        "pacienteNombre": fila["paciente_nombre"],
        "categoria": fila["categoria"],
        "concepto": fila["concepto"],
        # Nulo en los cargos que no nacen de una consulta (la cuota mensual,
        # por ejemplo). Es la unica forma que tiene la caja de agrupar por
        # visita sin leer la base de ms-consultas.
        "visitaId": fila["visita_id"],
        "referencia": fila["referencia"],
        "montoBruto": float(fila["monto_bruto"]),
        "descuentoPct": float(fila["descuento_pct"]),
        "montoNeto": neto,
        "montoPagado": pagado,
        "saldo": round(neto - pagado, 2),
        "estado": fila["estado"],
        "registradoPor": fila["registrado_por"],
        "creadoEn": fila["creado_en"].isoformat(timespec="seconds"),
    }


@app.post("/api/v1/cargos")
def crear_cargo():
    """Carga a la cuenta del familiar el costo de una consulta, examen, medicamento
    o cuota, ya con el descuento que la fundacion otorga a los miembros del asilo."""
    cuerpo = request.get_json(silent=True) or {}
    errores = []
    if not cuerpo.get("pacienteId"):
        errores.append("Falta pacienteId.")
    categoria = (cuerpo.get("categoria") or "").upper()
    if categoria not in CATEGORIAS_CARGO:
        errores.append("categoria debe ser una de: %s." % ", ".join(sorted(CATEGORIAS_CARGO)))
    if not cuerpo.get("concepto"):
        errores.append("Falta concepto.")

    tarifa_clave = cuerpo.get("tarifa")
    tarifa = TARIFARIO.get(tarifa_clave)
    try:
        monto_bruto = float(cuerpo["montoBruto"]) if cuerpo.get("montoBruto") is not None \
            else float(tarifa["precioFundacion"])
    except (TypeError, ValueError, KeyError):
        errores.append("Indique montoBruto, o una tarifa valida del catalogo.")
        monto_bruto = 0
    try:
        descuento_pct = float(cuerpo["descuentoPct"]) if cuerpo.get("descuentoPct") is not None \
            else float(tarifa["descuentoPct"]) if tarifa else 0.0
    except (TypeError, ValueError):
        errores.append("descuentoPct debe ser numerico.")
        descuento_pct = 0
    if not 0 <= descuento_pct <= 100:
        errores.append("descuentoPct debe estar entre 0 y 100.")

    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    monto_neto = round(monto_bruto * (1 - descuento_pct / 100), 2)
    cargo_id = _folio("CG")
    ahora = datetime.now().replace(microsecond=0)
    bd = conexion()
    try:
        ejecutar(
            """INSERT INTO cargos
                   (id, paciente_id, paciente_nombre, categoria, concepto, referencia,
                    monto_bruto, descuento_pct, monto_neto, monto_pagado, estado,
                    registrado_por, creado_en, visita_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,0,'PENDIENTE',%s,%s,%s)""",
            (cargo_id, cuerpo["pacienteId"], cuerpo.get("pacienteNombre"), categoria,
             cuerpo["concepto"], cuerpo.get("referencia"), monto_bruto, descuento_pct,
             monto_neto, firmante(), ahora, cuerpo.get("visitaId")),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    fila = consultar_uno("SELECT * FROM cargos WHERE id = %s", (cargo_id,))
    return jsonify(_cargo_json(fila)), 201


@app.get("/api/v1/cargos")
def listar_cargos():
    """Reporte de cobros por paciente por rango de fecha (incluye consulta, laboratorio y farmacia)."""
    paciente = request.args.get("pacienteId")
    estado = request.args.get("estado")
    desde = request.args.get("desde")
    hasta = request.args.get("hasta")
    # Sin fechas centinela: '0000-00-00' y '9999-99-99' no son fechas validas
    # en MySQL. Si no viene un rango, sencillamente no se agrega la condicion.
    sql = "SELECT * FROM cargos WHERE 1=1"
    params = []
    if desde:
        sql += " AND DATE(creado_en) >= %s"
        params.append(desde)
    if hasta:
        sql += " AND DATE(creado_en) <= %s"
        params.append(hasta)
    if paciente:
        sql += " AND paciente_id = %s"
        params.append(paciente)
    if estado:
        sql += " AND estado = %s"
        params.append(estado.upper())
    sql += " ORDER BY creado_en DESC LIMIT 200"
    filas = consultar(sql, params)
    cargos = [_cargo_json(f) for f in filas]
    return jsonify({
        "total": len(cargos),
        "montoNetoTotal": round(sum(c["montoNeto"] for c in cargos), 2),
        "saldoTotal": round(sum(c["saldo"] for c in cargos), 2),
        "cargos": cargos,
    })


@app.get("/api/v1/pacientes/<paciente_id>/cuenta")
def cuenta_paciente(paciente_id):
    """Estado de cuenta del interno: cargos y saldo pendiente con la fundacion."""
    filas = consultar(
        "SELECT * FROM cargos WHERE paciente_id = %s ORDER BY creado_en DESC", (paciente_id,))
    cargos = [_cargo_json(f) for f in filas]
    pagos = consultar(
        "SELECT * FROM pagos WHERE paciente_id = %s ORDER BY creado_en DESC LIMIT 50",
        (paciente_id,))
    return jsonify({
        "pacienteId": paciente_id,
        "totalCargado": round(sum(c["montoNeto"] for c in cargos), 2),
        "totalPagado": round(sum(c["montoPagado"] for c in cargos), 2),
        "saldoPendiente": round(sum(c["saldo"] for c in cargos), 2),
        "cargosPendientes": len([c for c in cargos if c["estado"] != "PAGADO"]),
        "cargos": cargos,
        "pagos": [
            {"id": p["id"], "cargoId": p["cargo_id"], "monto": float(p["monto"]),
             "metodo": p["metodo"], "registradoPor": p["registrado_por"],
             "creadoEn": p["creado_en"].isoformat(timespec="seconds")}
            for p in pagos
        ],
    })


@app.post("/api/v1/cargos/<cargo_id>/pagar")
def pagar_cargo(cargo_id):
    """Registra un abono o pago total de un cargo. Los familiares pueden abonar por partes."""
    cuerpo = request.get_json(silent=True) or {}
    bd = conexion()
    fila = consultar_uno("SELECT * FROM cargos WHERE id = %s", (cargo_id,))
    if fila is None:
        return jsonify({"error": "No existe el cargo %s." % cargo_id}), 404
    if fila["estado"] == "PAGADO":
        return jsonify({"error": "El cargo %s ya esta completamente cancelado." % cargo_id}), 409

    # De Decimal a float: el monto que llega en la peticion es float y mezclar
    # los dos tipos en una misma operacion es un error en Python.
    monto_neto = float(fila["monto_neto"])
    monto_pagado = float(fila["monto_pagado"])
    saldo = round(monto_neto - monto_pagado, 2)
    try:
        monto = float(cuerpo.get("monto"))
        if monto <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "monto debe ser numerico y mayor que cero."}), 400
    if monto > saldo + 0.01:
        return jsonify({"error": "El monto (%.2f) excede el saldo pendiente (%.2f)." % (monto, saldo)}), 400

    nuevo_pagado = round(monto_pagado + monto, 2)
    nuevo_estado = "PAGADO" if nuevo_pagado >= monto_neto - 0.01 else "ABONADO"
    ahora = datetime.now().replace(microsecond=0)
    pago_id = _folio("PG")
    # Asentar el pago y actualizar el estado del cargo es una sola operacion
    # contable: o pasan las dos cosas, o no pasa ninguna. Con SQLite podian
    # quedar a medias y el libro dejaba de cuadrar.
    try:
        ejecutar(
            """INSERT INTO pagos
                   (id, cargo_id, paciente_id, monto, metodo, registrado_por, creado_en)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (pago_id, cargo_id, fila["paciente_id"], monto,
             cuerpo.get("metodo", "efectivo"), firmante(), ahora),
        )
        ejecutar("UPDATE cargos SET monto_pagado = %s, estado = %s WHERE id = %s",
                 (nuevo_pagado, nuevo_estado, cargo_id))
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    return jsonify({
        "pagoId": pago_id,
        "cargoId": cargo_id,
        "monto": monto,
        "estadoCargo": nuevo_estado,
        "saldoRestante": round(monto_neto - nuevo_pagado, 2),
    }), 201


@app.get("/api/v1/donaciones")
def listar_donaciones():
    """Alimenta el reporte de entradas: donaciones y cobros."""
    filas = consultar("SELECT * FROM donaciones ORDER BY creado_en DESC LIMIT 200")
    donaciones = [
        {"id": f["id"], "donante": f["donante"], "tipo": f["tipo"], "monto": float(f["monto"]),
         "destino": f["destino"], "registradoPor": f["registrado_por"],
         "creadoEn": f["creado_en"].isoformat(timespec="seconds")}
        for f in filas
    ]
    return jsonify({"total": len(donaciones), "montoTotal": round(sum(d["monto"] for d in donaciones), 2),
                     "donaciones": donaciones})


@app.post("/api/v1/donaciones")
def crear_donacion():
    cuerpo = request.get_json(silent=True) or {}
    errores = []
    if not cuerpo.get("donante"):
        errores.append("Falta donante.")
    tipo = (cuerpo.get("tipo") or "").upper()
    if tipo not in CATEGORIAS_DONANTE:
        errores.append("tipo debe ser una de: %s." % ", ".join(sorted(CATEGORIAS_DONANTE)))
    try:
        monto = float(cuerpo.get("monto"))
        if monto <= 0:
            errores.append("monto debe ser mayor que cero.")
    except (TypeError, ValueError):
        errores.append("monto debe ser numerico.")
        monto = 0
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    donacion_id = _folio("DN")
    ahora = datetime.now().replace(microsecond=0)
    bd = conexion()
    try:
        ejecutar(
            """INSERT INTO donaciones
                   (id, donante, tipo, monto, destino, registrado_por, creado_en)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (donacion_id, cuerpo["donante"], tipo, monto,
             cuerpo.get("destino", "fondo general"), firmante(), ahora),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    return jsonify({"id": donacion_id, "donante": cuerpo["donante"], "tipo": tipo, "monto": monto,
                     "creadoEn": ahora.isoformat(timespec="seconds")}), 201


@app.get("/api/v1/gastos")
def listar_gastos():
    filas = consultar("SELECT * FROM gastos ORDER BY creado_en DESC LIMIT 200")
    gastos = [
        {"id": f["id"], "concepto": f["concepto"], "categoria": f["categoria"],
         "monto": float(f["monto"]), "registradoPor": f["registrado_por"],
         "creadoEn": f["creado_en"].isoformat(timespec="seconds")}
        for f in filas
    ]
    return jsonify({"total": len(gastos), "montoTotal": round(sum(g["monto"] for g in gastos), 2),
                     "gastos": gastos})


@app.post("/api/v1/gastos")
def crear_gasto():
    cuerpo = request.get_json(silent=True) or {}
    errores = []
    if not cuerpo.get("concepto"):
        errores.append("Falta concepto.")
    categoria = (cuerpo.get("categoria") or "OTRO").upper()
    if categoria not in CATEGORIAS_GASTO:
        errores.append("categoria debe ser una de: %s." % ", ".join(sorted(CATEGORIAS_GASTO)))
    try:
        monto = float(cuerpo.get("monto"))
        if monto <= 0:
            errores.append("monto debe ser mayor que cero.")
    except (TypeError, ValueError):
        errores.append("monto debe ser numerico.")
        monto = 0
    if errores:
        return jsonify({"error": "Peticion invalida", "detalles": errores}), 400

    gasto_id = _folio("GT")
    ahora = datetime.now().replace(microsecond=0)
    bd = conexion()
    try:
        ejecutar(
            """INSERT INTO gastos
                   (id, concepto, categoria, monto, registrado_por, creado_en)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (gasto_id, cuerpo["concepto"], categoria, monto, firmante(), ahora),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    return jsonify({"id": gasto_id, "concepto": cuerpo["concepto"], "categoria": categoria,
                     "monto": monto, "creadoEn": ahora.isoformat(timespec="seconds")}), 201


@app.get("/api/v1/fundacion/resumen")
def resumen_fundacion():
    """Reporte de pagos a la fundacion: lo adeudado por consultas, examenes y farmacia
    consumidos por los internos, contra lo que el asilo ya le ha pagado."""
    adeudado = float(consultar_uno(
        "SELECT COALESCE(SUM(monto_neto),0) t FROM cargos WHERE categoria IN "
        + _EN_CLAUSULA_FUNDACION)["t"])
    pagado = float(consultar_uno(
        "SELECT COALESCE(SUM(monto),0) t FROM pagos_fundacion")["t"])
    pagos = consultar("SELECT * FROM pagos_fundacion ORDER BY creado_en DESC LIMIT 50")
    return jsonify({
        "totalAdeudado": round(adeudado, 2),
        "totalPagado": round(pagado, 2),
        "saldoConFundacion": round(adeudado - pagado, 2),
        "pagos": [
            {"id": p["id"], "monto": float(p["monto"]), "referencia": p["referencia"],
             "registradoPor": p["registrado_por"],
             "creadoEn": p["creado_en"].isoformat(timespec="seconds")}
            for p in pagos
        ],
    })


@app.post("/api/v1/fundacion/pagos")
def pagar_fundacion():
    cuerpo = request.get_json(silent=True) or {}
    try:
        monto = float(cuerpo.get("monto"))
        if monto <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "monto debe ser numerico y mayor que cero."}), 400

    pago_id = _folio("PF")
    ahora = datetime.now().replace(microsecond=0)
    bd = conexion()
    try:
        ejecutar(
            """INSERT INTO pagos_fundacion
                   (id, monto, referencia, registrado_por, creado_en)
               VALUES (%s,%s,%s,%s,%s)""",
            (pago_id, monto, cuerpo.get("referencia", ""), firmante(), ahora),
        )
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    return jsonify({"id": pago_id, "monto": monto,
                     "creadoEn": ahora.isoformat(timespec="seconds")}), 201


@app.get("/api/v1/resumen")
def resumen_general():
    """Panel de entradas y salidas para el reporte financiero general del asilo."""
    # Los SUM() los hace MySQL sobre columnas DECIMAL, asi que son exactos al
    # centavo; solo al final se pasan a float para la respuesta JSON.
    donaciones = float(consultar_uno("SELECT COALESCE(SUM(monto),0) t FROM donaciones")["t"])
    cobrado = float(consultar_uno("SELECT COALESCE(SUM(monto_pagado),0) t FROM cargos")["t"])
    pendiente = float(consultar_uno(
        "SELECT COALESCE(SUM(monto_neto - monto_pagado),0) t FROM cargos "
        "WHERE estado != 'PAGADO'")["t"])
    gastos = float(consultar_uno("SELECT COALESCE(SUM(monto),0) t FROM gastos")["t"])

    # Lo cobrado por cuota de estadia se desglosa aparte para dejar a la vista
    # que es una ENTRADA del asilo y no una deuda con la fundacion: no aparece
    # en adeudo_fundacion, que solo mira las categorias que la fundacion presta.
    cuotas = float(consultar_uno(
        "SELECT COALESCE(SUM(monto_pagado),0) t FROM cargos WHERE categoria = 'CUOTA'")["t"])
    adeudo_fundacion = float(consultar_uno(
        "SELECT COALESCE(SUM(monto_neto),0) t FROM cargos WHERE categoria IN "
        + _EN_CLAUSULA_FUNDACION)["t"]) - float(consultar_uno(
        "SELECT COALESCE(SUM(monto),0) t FROM pagos_fundacion")["t"])
    entradas = round(donaciones + cobrado, 2)
    salidas = round(gastos + max(adeudo_fundacion, 0), 2)
    return jsonify({
        "entradas": {"donaciones": round(donaciones, 2), "cobrosFamiliares": round(cobrado, 2),
                     "cuotasDeEstadia": round(cuotas, 2), "total": entradas},
        "salidas": {"gastosOperativos": round(gastos, 2), "adeudoFundacion": round(adeudo_fundacion, 2),
                    "total": salidas},
        "saldoPendienteFamiliares": round(pendiente, 2),
        "balance": round(entradas - salidas, 2),
        "hora": datetime.now().isoformat(timespec="seconds"),
    })


# ---------------------------------------------------------------------------
# Reporte · cuanto costo una consulta
# ---------------------------------------------------------------------------

@app.get("/api/v1/reportes/costo-por-visita")
def costo_por_visita():
    """Costo total de una consulta: la consulta mas su laboratorio y su farmacia.

    Todo sale de la propia base de la caja. Esa fue la decision de diseño que
    costo mas pensar, asi que conviene dejarla escrita:

    La caja NO puede preguntarle a ms-consultas que examenes y que recetas
    tuvo la visita. usr_caja no tiene permiso sobre asilo_consultas —el motor
    se lo niega, y hay una prueba que lo comprueba— y abrirle ese permiso
    tiraria abajo la separacion de bases que sostiene todo lo demas.

    La alternativa era que la caja llamara por HTTP a ms-consultas cada vez
    que alguien pide este reporte. Tambien se descarto: pondria a la caja a
    depender de un servicio clinico para poder facturar, y un reporte de
    dinero dejaria de funcionar cuando se cae un servicio que no maneja dinero.

    Lo que se hizo es al reves: cuando ms-consultas manda a crear el cargo,
    manda tambien de que visita salio, y la caja lo guarda en cargos.visita_id.
    El reporte es entonces una consulta local, sin red de por medio.
    """
    visita = (request.args.get("visitaId") or "").strip()
    if not visita:
        return jsonify({
            "error": "Falta visitaId.",
            "ejemplo": "/api/v1/reportes/costo-por-visita?visitaId=VM-2026-1A2B3C4D",
        }), 400

    filas = consultar(
        "SELECT * FROM cargos WHERE visita_id = %s ORDER BY creado_en, id",
        (visita,),
    )
    cargos = [_cargo_json(f) for f in filas]

    # Los totales se suman en el motor y sobre DECIMAL, no en Python sobre
    # float: es la misma razon por la que las columnas de dinero son DECIMAL.
    resumen = consultar_uno(
        """SELECT COALESCE(SUM(monto_bruto), 0)  AS bruto,
                  COALESCE(SUM(monto_neto), 0)   AS neto,
                  COALESCE(SUM(monto_pagado), 0) AS pagado
             FROM cargos WHERE visita_id = %s""",
        (visita,),
    )
    bruto = float(resumen["bruto"])
    neto = float(resumen["neto"])
    pagado = float(resumen["pagado"])

    # Desglose por categoria. Se piden las tres siempre, aunque vengan en
    # cero: un reporte que esconde las filas vacias obliga a adivinar si el
    # examen no se cobro o si no hubo examen.
    porcategoria = {c: {"cantidad": 0, "montoBruto": 0.0, "montoNeto": 0.0, "montoPagado": 0.0}
                    for c in ("CONSULTA", "LABORATORIO", "FARMACIA")}
    for fila in consultar(
        """SELECT categoria, COUNT(*) AS cantidad,
                  SUM(monto_bruto) AS bruto, SUM(monto_neto) AS neto,
                  SUM(monto_pagado) AS pagado
             FROM cargos WHERE visita_id = %s GROUP BY categoria""",
        (visita,),
    ):
        porcategoria[fila["categoria"]] = {
            "cantidad": int(fila["cantidad"]),
            "montoBruto": float(fila["bruto"]),
            "montoNeto": float(fila["neto"]),
            "montoPagado": float(fila["pagado"]),
        }

    salida = {
        "visitaId": visita,
        "pacienteId": cargos[0]["pacienteId"] if cargos else None,
        "pacienteNombre": cargos[0]["pacienteNombre"] if cargos else None,
        "total": len(cargos),
        "porCategoria": porcategoria,
        "totales": {
            "montoBruto": round(bruto, 2),
            # Lo que la fundacion le perdona a la familia por ser del asilo.
            "descuento": round(bruto - neto, 2),
            "montoNeto": round(neto, 2),
            "montoPagado": round(pagado, 2),
            "saldo": round(neto - pagado, 2),
        },
        "cargos": cargos,
    }
    if not cargos:
        # Sin cargos hay dos explicaciones posibles y la caja no puede
        # distinguirlas: no tiene la tabla de visitas para saber si el folio
        # existe. Decirlo es mas util que devolver un 404 que seria mentira
        # la mitad de las veces.
        salida["nota"] = ("Esta visita no tiene ningun cargo asentado. Puede ser una "
                          "consulta sin examenes ni recetas, o un folio de visita que "
                          "no existe: la caja no lleva el registro de visitas y no "
                          "puede distinguir entre las dos cosas.")
    return jsonify(salida)


@app.errorhandler(404)
def no_encontrado(_):
    return jsonify({"error": "Ruta no encontrada en ms-caja."}), 404


def sembrar():
    bd = abrir_conexion()
    with bd.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) n FROM cargos")
        if cursor.fetchone()["n"] > 0:
            bd.close()
            return

    hoy = datetime.now().replace(microsecond=0)
    pacientes = [
        ("ASL-014", "Rosalia Menchu Coy"),
        ("ASL-007", "Transito Xicara Tzoc"),
        ("ASL-022", "Bernardo Puac Ixcoy"),
    ]
    ejemplos = [
        # pacienteId, tarifa, concepto, dias_atras, pagado_ya
        ("ASL-014", "cuota-mensual", "Cuota de estadia, mes en curso", 20, True),
        ("ASL-014", "consulta-especialista", "Valoracion por psiquiatria geriatrica", 12, True),
        ("ASL-014", "laboratorio-basico", "Perfil metabolico de control", 12, False),
        ("ASL-007", "cuota-mensual", "Cuota de estadia, mes en curso", 20, False),
        ("ASL-007", "consulta-general", "Control de presion arterial", 5, True),
        ("ASL-022", "cuota-mensual", "Cuota de estadia, mes en curso", 20, True),
        ("ASL-022", "laboratorio-basico", "Control de INR por warfarina", 3, False),
        ("ASL-022", "farmacia-especializado", "Atorvastatina, caja mensual", 3, False),
    ]
    cursor = bd.cursor()
    for pid, tarifa_clave, concepto, dias_atras, pagado in ejemplos:
        t = TARIFARIO[tarifa_clave]
        monto_bruto = t["precioFundacion"]
        descuento = t["descuentoPct"]
        monto_neto = round(monto_bruto * (1 - descuento / 100), 2)
        creado = hoy - timedelta(days=dias_atras)
        nombre = dict(pacientes)[pid]
        cargo_id = _folio("CG")
        monto_pagado = monto_neto if pagado else 0
        estado = "PAGADO" if pagado else "PENDIENTE"
        cursor.execute(
            """INSERT INTO cargos
                   (id, paciente_id, paciente_nombre, categoria, concepto, referencia,
                    monto_bruto, descuento_pct, monto_neto, monto_pagado, estado,
                    registrado_por, creado_en)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                       'Marta Solis, administracion',%s)""",
            (cargo_id, pid, nombre, t["categoria"], concepto, tarifa_clave,
             monto_bruto, descuento, monto_neto, monto_pagado, estado, creado),
        )
        if pagado:
            cursor.execute(
                """INSERT INTO pagos
                       (id, cargo_id, paciente_id, monto, metodo, registrado_por, creado_en)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (_folio("PG"), cargo_id, pid, monto_neto, "efectivo",
                 "Marta Solis, administracion", creado))


    # -----------------------------------------------------------------------
    # Los cargos de la consulta cerrada que siembra ms-consultas.
    #
    # Van aparte de la lista de arriba porque llevan visita_id: son los que
    # hacen que el reporte de costo por consulta tenga algo que sumar en la
    # demostracion. El folio de la visita y los de los cargos estan fijados
    # en los dos servicios; si cambia uno hay que cambiar el otro (ver
    # VISITA_DEMO en ms-consultas/app.py).
    #
    # El concepto se escribe con el mismo formato que produce el camino en
    # vivo —"nombre (visita FOLIO)" y "nombre dosis mg (indicacion FOLIO)"—
    # para que en pantalla no se distinga un cargo sembrado de uno real.
    # -----------------------------------------------------------------------
    VISITA_DEMO = "VM-2026-DEMO0022"
    atendida = hoy - timedelta(days=9)
    de_la_visita = [
        ("CG-DEMO0001", "laboratorio-basico",
         "Tiempo de protrombina e INR (visita %s)" % VISITA_DEMO,
         "Dr. Rolando Sicajau"),
        ("CG-DEMO0002", "laboratorio-imagen",
         "Electrocardiograma de 12 derivaciones (visita %s)" % VISITA_DEMO,
         "Dr. Rolando Sicajau"),
        ("CG-DEMO0003", "farmacia-generico",
         "Warfarina 5.00 mg (indicacion IN-2026-DEMO0001)",
         "Farmacia de la Fundación"),
    ]
    for cargo_id, tarifa_clave, concepto, quien in de_la_visita:
        t = TARIFARIO[tarifa_clave]
        neto = round(t["precioFundacion"] * (1 - t["descuentoPct"] / 100), 2)
        cursor.execute(
            """INSERT INTO cargos
                   (id, paciente_id, paciente_nombre, categoria, concepto, referencia,
                    monto_bruto, descuento_pct, monto_neto, monto_pagado, estado,
                    registrado_por, creado_en, visita_id)
               VALUES (%s,'ASL-022','Bernardo Puac Ixcoy',%s,%s,%s,%s,%s,%s,0,
                       'PENDIENTE',%s,%s,%s)""",
            (cargo_id, t["categoria"], concepto, tarifa_clave,
             t["precioFundacion"], t["descuentoPct"], neto, quien,
             atendida, VISITA_DEMO),
        )

    donaciones = [
        ("Fundacion Amigos del Adulto Mayor", "EMPRESA", 5000.0, "fondo general", 25),
        ("Municipalidad de Mazatenango", "GOBIERNO", 3500.0, "insumos medicos", 18),
        ("Familia Coy Menchu", "PARTICULAR", 400.0, "fondo general", 6),
    ]
    for donante, tipo, monto, destino, dias in donaciones:
        cursor.execute(
            """INSERT INTO donaciones
                   (id, donante, tipo, monto, destino, registrado_por, creado_en)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (_folio("DN"), donante, tipo, monto, destino,
             "Marta Solis, administracion", hoy - timedelta(days=dias)))

    gastos = [
        ("Energia electrica del mes", "SERVICIOS", 890.0, 15),
        ("Agua potable del mes", "SERVICIOS", 210.0, 15),
        ("Insumos de curacion y limpieza", "INSUMOS", 640.0, 9),
    ]
    for concepto, categoria, monto, dias in gastos:
        cursor.execute(
            """INSERT INTO gastos
                   (id, concepto, categoria, monto, registrado_por, creado_en)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (_folio("GT"), concepto, categoria, monto,
             "Marta Solis, administracion", hoy - timedelta(days=dias)))

    cursor.execute(
        """INSERT INTO pagos_fundacion
               (id, monto, referencia, registrado_por, creado_en)
           VALUES (%s,%s,%s,%s,%s)""",
        (_folio("PF"), 1800.0, "Abono de consultas y laboratorios de julio",
         "Marta Solis, administracion", hoy - timedelta(days=10)))

    try:
        bd.commit()
    except Exception:
        bd.rollback()
        raise
    finally:
        cursor.close()
        bd.close()


esperar_a_mysql()
revisar_el_esquema()
if os.environ.get("SEMBRAR", "1") == "1":
    sembrar()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PUERTO", 8083)))
