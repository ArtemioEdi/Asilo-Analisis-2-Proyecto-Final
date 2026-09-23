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

APP_NOMBRE = "ms-caja"

# Solo para la generacion mensual de cuotas: hace falta el padron activo
# para saber a quien cobrarle la estadia.
PASTILLERO_URL = os.environ.get("PASTILLERO_URL", "http://ms-pastillero:8082")
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
        "ms-caja no arranca: faltan las variables de conexion a MySQL (%s). "
        "Copie .env.ejemplo a .env." % ", ".join(_faltantes)
    )

# Secreto compartido con ms-gateway. Sin valor por defecto a proposito: un
# secreto escrito en el codigo es un secreto publicado.
SECRETO = os.environ.get("GATEWAY_SECRETO", "")
if len(SECRETO.strip()) < 16:
    raise RuntimeError(
        "ms-caja no arranca: falta la variable de entorno GATEWAY_SECRETO "
        "(o mide menos de 16 caracteres). Copie .env.ejemplo a .env y genere "
        "un secreto con: openssl rand -hex 32"
    )

# El dinero del asilo lo ve y lo mueve administracion.
ROLES_LECTURA = ("ADMINISTRACION",)
ROLES_ESCRITURA = ("ADMINISTRACION",)

# Excepcion: el medico lee la cuenta de UN interno, porque antes de indicar un
# laboratorio necesita saber si la familia puede costearlo. Solo lectura y solo
# esta ruta: no ve el balance del asilo, ni donaciones, ni gastos, ni la cuenta
# con la fundacion.
CUENTA_DE_PACIENTE = re.compile(r"^/api/v1/pacientes/[^/]+/cuenta/?$")

# Segunda excepcion, para otro servicio y no para una persona. El examen y la
# entrega los dispara un MEDICO o FARMACIA, que no pueden escribir en la caja,
# pero el cobro tiene que quedar asentado. ms-consultas firma un token de un
# minuto con rol=SERVICIO que lleva el nombre real de quien provoco el cobro,
# para que el cargo quede firmado por esa persona y no por un robot. Ese rol se
# acepta UNICAMENTE para crear cargos: no paga, no dona, no lee nada.
CREAR_CARGO = re.compile(r"^/api/v1/cargos/?$")
ROLES_SERVICIO = ("SERVICIO",)

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


# El tarifario son datos, no logica de negocio: vive junto al codigo que lo
# aplica, igual que el vademecum de ms-vigia.
TARIFARIO = {
    "consulta-general":     {"nombre": "Consulta medico general",     "categoria": "CONSULTA",     "precioFundacion": 150.0, "descuentoPct": 60},
    "consulta-especialista":{"nombre": "Consulta con especialista",   "categoria": "CONSULTA",     "precioFundacion": 350.0, "descuentoPct": 55},
    "laboratorio-basico":   {"nombre": "Perfil de laboratorio basico","categoria": "LABORATORIO",  "precioFundacion": 280.0, "descuentoPct": 50},
    "laboratorio-imagen":   {"nombre": "Estudio de imagen (Rx/US)",   "categoria": "LABORATORIO",  "precioFundacion": 420.0, "descuentoPct": 45},
    "farmacia-generico":    {"nombre": "Medicamento generico (caja)", "categoria": "FARMACIA",      "precioFundacion": 60.0,  "descuentoPct": 65},
    "farmacia-especializado":{"nombre": "Medicamento de marca / especializado", "categoria": "FARMACIA", "precioFundacion": 220.0, "descuentoPct": 40},
    # La cuota no la cobra la fundacion sino el asilo, asi que no lleva
    # descuento: no hay nada que descontar.
    "cuota-mensual":        {"nombre": "Cuota mensual de estadia",    "categoria": "CUOTA",        "precioFundacion": 450.0, "descuentoPct": 0},
}

CATEGORIAS_CARGO = {"CONSULTA", "LABORATORIO", "FARMACIA", "CUOTA", "OTRO"}

# Solo lo que la fundacion presta. La CUOTA queda fuera porque es plata que el
# familiar le paga al asilo: contarla como deuda inflaria las salidas con un
# gasto que no existe. OTRO es un cargo interno.
CATEGORIAS_QUE_COBRA_LA_FUNDACION = ("CONSULTA", "LABORATORIO", "FARMACIA")
_EN_CLAUSULA_FUNDACION = "(" + ",".join("'%s'" % c for c in CATEGORIAS_QUE_COBRA_LA_FUNDACION) + ")"
CATEGORIAS_DONANTE = {"EMPRESA_INTERNACIONAL", "EMPRESA_NACIONAL",
                      "GOBIERNO", "PARTICULAR"}
CATEGORIAS_GASTO = {"SERVICIOS", "PERSONAL", "INSUMOS", "MANTENIMIENTO", "OTRO"}


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


def revisar_el_esquema():
    """Avisa si la base no tiene cargos.visita_id, y dice como agregarla.

    No se repara solo a proposito: usr_caja no tiene ALTER. Un servicio que
    puede cambiar la forma de sus tablas en caliente puede cambiarla para
    cualquier otra cosa el dia que lo comprometan. El esquema lo define sql/.
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


# El gateway ya valido el token, pero aqui se vuelve a validar: defensa en
# profundidad, por si alguien alcanza la red interna y llama directo. Sin esto
# bastaria un POST a la caja para meter una donacion sin iniciar sesion.
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
    if not escribe and CUENTA_DE_PACIENTE.match(request.path):
        # Y el token de servicio de ms-pastillero, que consulta esta misma
        # cuenta para advertir si un interno egresa debiendo. Solo esta ruta:
        # el balance del asilo, las donaciones y los gastos siguen fuera del
        # alcance de cualquier servicio.
        permitidos = permitidos + ("MEDICO",) + ROLES_SERVICIO
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
    # De Decimal a float solo para la respuesta. La exactitud que importa —la
    # de las sumas— la da MySQL, que hace los SUM() sobre DECIMAL.
    neto = float(fila["monto_neto"])
    pagado = float(fila["monto_pagado"])
    return {
        "id": fila["id"],
        "pacienteId": fila["paciente_id"],
        "pacienteNombre": fila["paciente_nombre"],
        "categoria": fila["categoria"],
        "concepto": fila["concepto"],
        # Nulo en los cargos que no nacen de una consulta. Es la unica forma
        # de agrupar por visita sin leer la base de ms-consultas.
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
    # Sin fechas centinela: '0000-00-00' no es valida en MySQL. Si no viene
    # rango, no se agrega la condicion.
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
    salida = _cabecera_informe("Cobros por paciente, con el detalle de gastos medicos", desde, hasta)
    salida.update({
        "total": len(cargos),
        "montoNetoTotal": round(sum(c["montoNeto"] for c in cargos), 2),
        "saldoTotal": round(sum(c["saldo"] for c in cargos), 2),
        "cargos": cargos,
    })
    return jsonify(salida)


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

    # A float: mezclar Decimal y float en una misma operacion es un error.
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
    # Asentar el pago y actualizar el cargo es una sola operacion contable: o
    # pasan las dos cosas, o no pasa ninguna.
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
    # Los SUM() los hace MySQL sobre DECIMAL: exactos al centavo.
    donaciones = float(consultar_uno("SELECT COALESCE(SUM(monto),0) t FROM donaciones")["t"])
    cobrado = float(consultar_uno("SELECT COALESCE(SUM(monto_pagado),0) t FROM cargos")["t"])
    pendiente = float(consultar_uno(
        "SELECT COALESCE(SUM(monto_neto - monto_pagado),0) t FROM cargos "
        "WHERE estado != 'PAGADO'")["t"])
    gastos = float(consultar_uno("SELECT COALESCE(SUM(monto),0) t FROM gastos")["t"])

    # La cuota se desglosa aparte: es una ENTRADA del asilo, no una deuda con
    # la fundacion, y por eso no aparece en adeudo_fundacion.
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


@app.get("/api/v1/reportes/costo-por-visita")
def costo_por_visita():
    """Costo total de una consulta: la consulta mas su laboratorio y su farmacia.

    Todo sale de la base de la caja. No le pregunta a ms-consultas: usr_caja no
    tiene permiso sobre asilo_consultas, y abrirlo tiraria abajo la separacion
    de bases. Tampoco le habla por HTTP, porque un reporte de dinero no puede
    depender de que este arriba un servicio clinico. En vez de eso ms-consultas
    manda de que visita salio cada cargo, y aqui se agrupa por visita_id.
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

    # Se suman en el motor y sobre DECIMAL, no en Python sobre float.
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

    # Las tres categorias siempre, aunque vengan en cero: esconder las filas
    # vacias obliga a adivinar si el examen no se cobro o si no hubo examen.
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

    salida = _sello_informe("Costo de la consulta, con laboratorio y farmacia")
    salida.update({
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
    })
    if not cargos:
        # La caja no tiene la tabla de visitas, asi que no puede distinguir
        # entre "sin cargos" y "folio inexistente". Un 404 seria mentira la
        # mitad de las veces.
        salida["nota"] = ("Esta visita no tiene ningun cargo asentado. Puede ser una "
                          "consulta sin examenes ni recetas, o un folio de visita que "
                          "no existe: la caja no lleva el registro de visitas y no "
                          "puede distinguir entre las dos cosas.")
    return jsonify(salida)


# ---------------------------------------------------------------------------
#  Informes 4 y 5 del enunciado. Los otros cinco ya existian: tres aqui y en
#  ms-consultas, y el de medicamentos en ms-pastillero.
#
#  Los dos comparten el rango de fechas, asi que comparten el validador. Las
#  rutas son GET bajo /api/v1, de modo que el guardia de arriba ya las deja
#  solo para ADMINISTRACION sin tener que tocar la matriz: el dinero del asilo
#  no lo lee nadie mas.
# ---------------------------------------------------------------------------

def _rango_de_fechas():
    """Lee desde/hasta de la consulta. Devuelve (desde, hasta, None) o (None, None, error).

    Se valida el formato en vez de pasarselo crudo a MySQL: una fecha con
    basura no da error, da un reporte vacio, y un reporte de dinero vacio por
    un error de tecleo es peor que un 400.
    """
    crudos = {}
    for nombre in ("desde", "hasta"):
        valor = (request.args.get(nombre) or "").strip()
        if not valor:
            crudos[nombre] = None
            continue
        try:
            crudos[nombre] = date.fromisoformat(valor).isoformat()
        except ValueError:
            return None, None, (jsonify({
                "error": "El parametro %s no es una fecha valida." % nombre,
                "recibido": valor,
                "formatoEsperado": "AAAA-MM-DD",
            }), 400)

    if crudos["desde"] and crudos["hasta"] and crudos["desde"] > crudos["hasta"]:
        return None, None, (jsonify({
            "error": "El rango esta al reves: la fecha inicial es posterior a la final.",
            "desde": crudos["desde"], "hasta": crudos["hasta"],
        }), 400)

    return crudos["desde"], crudos["hasta"], None


def _filtro_fechas(columna, desde, hasta):
    """Fragmento SQL y parametros para acotar una columna DATETIME al rango."""
    sql, params = "", []
    if desde:
        sql += " AND DATE(%s) >= %%s" % columna
        params.append(desde)
    if hasta:
        sql += " AND DATE(%s) <= %%s" % columna
        params.append(hasta)
    return sql, params


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


def _cabecera_informe(nombre, desde, hasta):
    """El sello, mas el rango para los informes que se piden por fechas."""
    cabecera = _sello_informe(nombre)
    cabecera["rango"] = {"desde": desde, "hasta": hasta}
    return cabecera


@app.get("/api/v1/reportes/pagos-fundacion")
def reporte_pagos_fundacion():
    """Informe 4: los pagos que el asilo le ha hecho a la fundacion.

    El rango acota los pagos y lo devengado dentro de esas fechas, pero el
    saldo acumulado va aparte y sin acotar: lo que se le debe a la fundacion no
    empieza de cero porque uno elija ver un mes.
    """
    desde, hasta, error = _rango_de_fechas()
    if error:
        return error

    filtro, params = _filtro_fechas("creado_en", desde, hasta)
    pagos = consultar(
        "SELECT * FROM pagos_fundacion WHERE 1=1" + filtro + " ORDER BY creado_en DESC",
        params)

    pagado_rango = float(consultar_uno(
        "SELECT COALESCE(SUM(monto),0) t FROM pagos_fundacion WHERE 1=1" + filtro,
        params)["t"])
    devengado_rango = float(consultar_uno(
        "SELECT COALESCE(SUM(monto_neto),0) t FROM cargos WHERE categoria IN "
        + _EN_CLAUSULA_FUNDACION + filtro, params)["t"])

    adeudado_total = float(consultar_uno(
        "SELECT COALESCE(SUM(monto_neto),0) t FROM cargos WHERE categoria IN "
        + _EN_CLAUSULA_FUNDACION)["t"])
    pagado_total = float(consultar_uno(
        "SELECT COALESCE(SUM(monto),0) t FROM pagos_fundacion")["t"])

    salida = _cabecera_informe("Pagos realizados a la fundacion", desde, hasta)
    salida.update({
        "total": len(pagos),
        "pagos": [
            {"id": p["id"], "monto": float(p["monto"]), "referencia": p["referencia"],
             "registradoPor": p["registrado_por"],
             "creadoEn": p["creado_en"].isoformat(timespec="seconds")}
            for p in pagos
        ],
        "totales": {
            "pagadoEnElRango": round(pagado_rango, 2),
            "devengadoEnElRango": round(devengado_rango, 2),
            "diferenciaEnElRango": round(devengado_rango - pagado_rango, 2),
        },
        "acumulado": {
            "totalAdeudado": round(adeudado_total, 2),
            "totalPagado": round(pagado_total, 2),
            "saldoConFundacion": round(adeudado_total - pagado_total, 2),
        },
    })
    return jsonify(salida)


@app.get("/api/v1/reportes/entradas")
def reporte_entradas():
    """Informe 5: todo lo que entra al asilo, donaciones y cobros a las familias.

    Los cobros salen de la tabla de pagos y no de cargos.monto_pagado: el cargo
    guarda cuanto se ha pagado, pero no cuando, y un informe por rango de fecha
    necesita la fecha en que el dinero entro, que es la del abono.
    """
    desde, hasta, error = _rango_de_fechas()
    if error:
        return error

    filtro, params = _filtro_fechas("creado_en", desde, hasta)

    donaciones = consultar(
        "SELECT * FROM donaciones WHERE 1=1" + filtro + " ORDER BY creado_en DESC", params)
    # Los tres tipos siempre, aunque vengan en cero, por la misma razon que en
    # costo-por-visita: un renglon ausente obliga a adivinar.
    por_tipo = {t: {"cantidad": 0, "monto": 0.0} for t in sorted(CATEGORIAS_DONANTE)}
    for fila in consultar(
        "SELECT tipo, COUNT(*) c, SUM(monto) m FROM donaciones WHERE 1=1"
        + filtro + " GROUP BY tipo", params):
        por_tipo[fila["tipo"]] = {"cantidad": int(fila["c"]), "monto": float(fila["m"])}

    # El JOIN es lo que le pone categoria a cada abono: el pago apunta al cargo.
    filtro_pagos, params_pagos = _filtro_fechas("p.creado_en", desde, hasta)
    cobros = consultar(
        """SELECT p.id, p.cargo_id, p.paciente_id, p.monto, p.metodo,
                  p.registrado_por, p.creado_en, c.categoria, c.concepto,
                  c.paciente_nombre
             FROM pagos p JOIN cargos c ON c.id = p.cargo_id
            WHERE 1=1""" + filtro_pagos + " ORDER BY p.creado_en DESC", params_pagos)
    por_categoria = {}
    for fila in consultar(
        """SELECT c.categoria, COUNT(*) n, SUM(p.monto) m
             FROM pagos p JOIN cargos c ON c.id = p.cargo_id
            WHERE 1=1""" + filtro_pagos + " GROUP BY c.categoria", params_pagos):
        por_categoria[fila["categoria"]] = {"cantidad": int(fila["n"]),
                                            "monto": float(fila["m"])}
    for categoria in sorted(CATEGORIAS_CARGO):
        por_categoria.setdefault(categoria, {"cantidad": 0, "monto": 0.0})

    total_donaciones = round(sum(float(d["monto"]) for d in donaciones), 2)
    total_cobros = round(sum(float(c["monto"]) for c in cobros), 2)

    salida = _cabecera_informe("Entradas: donaciones y cobros", desde, hasta)
    salida.update({
        "donaciones": {
            "total": len(donaciones),
            "monto": total_donaciones,
            "porTipo": por_tipo,
            "detalle": [
                {"id": d["id"], "donante": d["donante"], "tipo": d["tipo"],
                 "monto": float(d["monto"]), "destino": d["destino"],
                 "registradoPor": d["registrado_por"],
                 "creadoEn": d["creado_en"].isoformat(timespec="seconds")}
                for d in donaciones
            ],
        },
        "cobros": {
            "total": len(cobros),
            "monto": total_cobros,
            "porCategoria": por_categoria,
            "detalle": [
                {"id": c["id"], "cargoId": c["cargo_id"], "pacienteId": c["paciente_id"],
                 "pacienteNombre": c["paciente_nombre"], "categoria": c["categoria"],
                 "concepto": c["concepto"], "monto": float(c["monto"]),
                 "metodo": c["metodo"], "registradoPor": c["registrado_por"],
                 "creadoEn": c["creado_en"].isoformat(timespec="seconds")}
                for c in cobros
            ],
        },
        "totales": {
            "donaciones": total_donaciones,
            "cobros": total_cobros,
            "total": round(total_donaciones + total_cobros, 2),
        },
    })
    return jsonify(salida)




# ===========================================================================
#  Cuota mensual de estadia
#
#  La tarifa existia desde siempre, pero el cargo habia que crearlo a mano,
#  interno por interno. Esto lo genera de una vez para todo el padron activo.
#
#  La cuota NO forma parte del adeudo con la fundacion: es plata que el
#  familiar le paga al asilo por tener ahi a su pariente, no un servicio que
#  la fundacion preste. Por eso su categoria queda fuera de
#  CATEGORIAS_QUE_COBRA_LA_FUNDACION y por eso no lleva descuento.
# ===========================================================================

MES_VALIDO = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def internos_activos(token):
    """El padron activo, preguntado a ms-pastillero. Devuelve (lista, error).

    Se le reenvia el token de quien pide la generacion, que es ADMINISTRACION
    y ya puede leer el padron —sin la parte clinica, que ms-pastillero no le
    entrega—. No hace falta un token de servicio para leer algo que quien
    pregunta ya podria leer por su cuenta.
    """
    try:
        r = requests.get(
            "%s/api/v1/internos?estado=ACTIVO" % PASTILLERO_URL,
            headers={"Authorization": token},
            timeout=5,
        )
    except requests.RequestException:
        return None, "MS-PASTILLERO no responde."
    if r.status_code != 200:
        return None, "MS-PASTILLERO respondio con codigo %d." % r.status_code
    return r.json().get("internos", []), None


@app.post("/api/v1/cuotas/generar")
def generar_cuotas():
    """Genera la cuota del mes para cada interno activo que no la tenga.

    Es idempotente: correrlo dos veces sobre el mismo mes no duplica nada y
    devuelve cuantas creo y cuantas ya existian. La garantia no es la consulta
    previa —entre mirar e insertar cabe otra ejecucion— sino el indice unico
    sobre (paciente_id, periodo_cuota); la consulta previa solo sirve para no
    intentar lo que ya se sabe hecho.

    Si ms-pastillero no responde no se genera NADA y se devuelve 503. Cobrarle
    la estadia a una lista incompleta de internos deja a unos cobrados y a
    otros no, y nadie se entera hasta que el familiar reclama.
    """
    cuerpo = request.get_json(silent=True) or {}
    mes = (cuerpo.get("mes") or "").strip()
    if not MES_VALIDO.match(mes):
        return jsonify({
            "error": "Indique el mes como AAAA-MM.",
            "recibido": mes or None,
            "ejemplo": datetime.now().strftime("%Y-%m"),
        }), 400

    tarifa = TARIFARIO["cuota-mensual"]
    monto_bruto = float(tarifa["precioFundacion"])
    descuento_pct = float(tarifa["descuentoPct"])
    monto_neto = round(monto_bruto * (1 - descuento_pct / 100), 2)

    internos, fallo = internos_activos(request.headers.get("Authorization", ""))
    if fallo:
        return jsonify({
            "error": "No se generaron las cuotas: %s" % fallo,
            "detalle": ("Hace falta el padron activo para saber a quien cobrarle. "
                        "Cobrarle a una lista incompleta dejaria a unos internos "
                        "cobrados y a otros no, asi que no se genero ninguna."),
        }), 503

    ya_estaban = {
        f["paciente_id"] for f in consultar(
            "SELECT paciente_id FROM cargos WHERE periodo_cuota = %s", (mes,))
    }

    ahora = datetime.now().replace(microsecond=0)
    creadas, existentes, cargos = [], [], []
    bd = conexion()
    try:
        for interno in internos:
            paciente_id = interno.get("pacienteId")
            if not paciente_id:
                continue
            if paciente_id in ya_estaban:
                existentes.append(paciente_id)
                continue
            cargo_id = _folio("CG")
            try:
                ejecutar(
                    """INSERT INTO cargos
                           (id, paciente_id, paciente_nombre, categoria, concepto,
                            referencia, monto_bruto, descuento_pct, monto_neto,
                            monto_pagado, estado, registrado_por, creado_en,
                            periodo_cuota)
                       VALUES (%s,%s,%s,'CUOTA',%s,%s,%s,%s,%s,0,'PENDIENTE',%s,%s,%s)""",
                    (cargo_id, paciente_id, interno.get("nombre"),
                     "Cuota mensual de estadia %s" % mes, mes,
                     monto_bruto, descuento_pct, monto_neto, firmante(), ahora, mes),
                )
            except pymysql.err.IntegrityError:
                # Otra ejecucion la creo entre la consulta y este INSERT. No es
                # un error: es justamente lo que el indice unico esta para
                # impedir, y el resultado sigue siendo el correcto.
                existentes.append(paciente_id)
                continue
            creadas.append(paciente_id)
            cargos.append({"id": cargo_id, "pacienteId": paciente_id,
                           "pacienteNombre": interno.get("nombre"),
                           "montoNeto": monto_neto})
        bd.commit()
    except Exception:
        bd.rollback()
        raise

    salida = _sello_informe("Generacion de cuotas mensuales")
    salida.update({
        "mes": mes,
        "internosActivos": len(internos),
        "creadas": len(creadas),
        "yaExistian": len(existentes),
        "montoUnitario": monto_neto,
        "montoTotalGenerado": round(monto_neto * len(creadas), 2),
        "cargos": cargos,
    })
    return jsonify(salida), 201 if creadas else 200

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
        # El concepto de la cuota lo arma el ciclo con el mes que le toca: para
        # poder sellarla hay que saber de que mes es, y un texto fijo mentiria
        # en cuanto la demostracion caiga en otro mes.
        ("ASL-014", "cuota-mensual", None, 20, True),
        ("ASL-014", "consulta-especialista", "Valoracion por psiquiatria geriatrica", 12, True),
        ("ASL-014", "laboratorio-basico", "Perfil metabolico de control", 12, False),
        ("ASL-007", "cuota-mensual", None, 20, False),
        ("ASL-007", "consulta-general", "Control de presion arterial", 5, True),
        ("ASL-022", "cuota-mensual", None, 20, True),
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
        # La cuota sembrada lleva su periodo, igual que las que genera
        # /cuotas/generar. Sin ese sello el generador no la ve y le cobraria la
        # estadia por segunda vez a estas tres familias la primera vez que
        # alguien pulse el boton.
        periodo = creado.strftime("%Y-%m") if t["categoria"] == "CUOTA" else None
        if concepto is None:
            concepto = "Cuota mensual de estadia %s" % periodo
        nombre = dict(pacientes)[pid]
        cargo_id = _folio("CG")
        monto_pagado = monto_neto if pagado else 0
        estado = "PAGADO" if pagado else "PENDIENTE"
        cursor.execute(
            """INSERT INTO cargos
                   (id, paciente_id, paciente_nombre, categoria, concepto, referencia,
                    monto_bruto, descuento_pct, monto_neto, monto_pagado, estado,
                    registrado_por, creado_en, periodo_cuota)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                       'Marta Solis, administracion',%s,%s)""",
            (cargo_id, pid, nombre, t["categoria"], concepto, tarifa_clave,
             monto_bruto, descuento, monto_neto, monto_pagado, estado, creado,
             periodo),
        )
        if pagado:
            cursor.execute(
                """INSERT INTO pagos
                       (id, cargo_id, paciente_id, monto, metodo, registrado_por, creado_en)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (_folio("PG"), cargo_id, pid, monto_neto, "efectivo",
                 "Marta Solis, administracion", creado))


    # Los cargos de la consulta cerrada que siembra ms-consultas. Van aparte
    # porque llevan visita_id. Los folios estan fijados en los dos servicios:
    # si cambia uno hay que cambiar el otro (VISITA_DEMO en ms-consultas).
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
        ("Fundacion Amigos del Adulto Mayor", "EMPRESA_NACIONAL", 5000.0, "fondo general", 25),
        ("HelpAge International", "EMPRESA_INTERNACIONAL", 7200.0, "equipamiento", 31),
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
