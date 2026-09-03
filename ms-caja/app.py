import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta

import jwt
from flask import Flask, g, jsonify, request

APP_NOMBRE = "ms-caja"
APP_VERSION = "1.2.0"
BD = os.environ.get("CAJA_BD", "/datos/caja.db")

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

# La sonda de vida no expone datos del asilo y la consulta Docker desde dentro
# del contenedor, sin token.
RUTAS_LIBRES = ("/salud",)

app = Flask(__name__)
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
    bd.executescript(
        """
        CREATE TABLE IF NOT EXISTS cargos (
            id               TEXT PRIMARY KEY,
            paciente_id      TEXT NOT NULL,
            paciente_nombre  TEXT,
            categoria        TEXT NOT NULL,
            concepto         TEXT NOT NULL,
            referencia       TEXT,
            monto_bruto      REAL NOT NULL,
            descuento_pct    REAL NOT NULL DEFAULT 0,
            monto_neto       REAL NOT NULL,
            monto_pagado     REAL NOT NULL DEFAULT 0,
            estado           TEXT NOT NULL DEFAULT 'PENDIENTE',
            registrado_por   TEXT,
            creado_en        TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pagos (
            id             TEXT PRIMARY KEY,
            cargo_id       TEXT NOT NULL,
            paciente_id    TEXT NOT NULL,
            monto          REAL NOT NULL,
            metodo         TEXT NOT NULL,
            registrado_por TEXT,
            creado_en      TEXT NOT NULL,
            FOREIGN KEY (cargo_id) REFERENCES cargos(id)
        );
        CREATE TABLE IF NOT EXISTS donaciones (
            id             TEXT PRIMARY KEY,
            donante        TEXT NOT NULL,
            tipo           TEXT NOT NULL,
            monto          REAL NOT NULL,
            destino        TEXT,
            registrado_por TEXT,
            creado_en      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gastos (
            id             TEXT PRIMARY KEY,
            concepto       TEXT NOT NULL,
            categoria      TEXT NOT NULL,
            monto          REAL NOT NULL,
            registrado_por TEXT,
            creado_en      TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pagos_fundacion (
            id             TEXT PRIMARY KEY,
            monto          REAL NOT NULL,
            referencia     TEXT,
            registrado_por TEXT,
            creado_en      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cargos_paciente ON cargos(paciente_id, creado_en);
        """
    )
    bd.commit()
    bd.close()


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
        "cargosRegistrados": bd.execute("SELECT COUNT(*) n FROM cargos").fetchone()["n"],
        "hora": datetime.now().isoformat(timespec="seconds"),
    })


@app.get("/api/v1/tarifas")
def listar_tarifas():
    salida = [dict(clave=clave, **datos) for clave, datos in TARIFARIO.items()]
    return jsonify({"total": len(salida), "tarifas": salida})


def _cargo_json(fila):
    return {
        "id": fila["id"],
        "pacienteId": fila["paciente_id"],
        "pacienteNombre": fila["paciente_nombre"],
        "categoria": fila["categoria"],
        "concepto": fila["concepto"],
        "referencia": fila["referencia"],
        "montoBruto": fila["monto_bruto"],
        "descuentoPct": fila["descuento_pct"],
        "montoNeto": fila["monto_neto"],
        "montoPagado": fila["monto_pagado"],
        "saldo": round(fila["monto_neto"] - fila["monto_pagado"], 2),
        "estado": fila["estado"],
        "registradoPor": fila["registrado_por"],
        "creadoEn": fila["creado_en"],
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
    ahora = datetime.now().isoformat(timespec="seconds")
    bd = conexion()
    bd.execute(
        """INSERT INTO cargos (id, paciente_id, paciente_nombre, categoria, concepto, referencia,
                                monto_bruto, descuento_pct, monto_neto, monto_pagado, estado,
                                registrado_por, creado_en)
           VALUES (?,?,?,?,?,?,?,?,?, 0, 'PENDIENTE', ?, ?)""",
        (cargo_id, cuerpo["pacienteId"], cuerpo.get("pacienteNombre"), categoria,
         cuerpo["concepto"], cuerpo.get("referencia"), monto_bruto, descuento_pct, monto_neto,
         firmante(), ahora),
    )
    bd.commit()
    fila = bd.execute("SELECT * FROM cargos WHERE id = ?", (cargo_id,)).fetchone()
    return jsonify(_cargo_json(fila)), 201


@app.get("/api/v1/cargos")
def listar_cargos():
    """Reporte de cobros por paciente por rango de fecha (incluye consulta, laboratorio y farmacia)."""
    paciente = request.args.get("pacienteId")
    estado = request.args.get("estado")
    desde = request.args.get("desde") or "0000-00-00"
    hasta = request.args.get("hasta") or "9999-99-99"
    sql = "SELECT * FROM cargos WHERE substr(creado_en,1,10) BETWEEN ? AND ?"
    params = [desde, hasta]
    if paciente:
        sql += " AND paciente_id = ?"
        params.append(paciente)
    if estado:
        sql += " AND estado = ?"
        params.append(estado.upper())
    sql += " ORDER BY creado_en DESC LIMIT 200"
    filas = conexion().execute(sql, params).fetchall()
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
    bd = conexion()
    filas = bd.execute(
        "SELECT * FROM cargos WHERE paciente_id = ? ORDER BY creado_en DESC", (paciente_id,)
    ).fetchall()
    cargos = [_cargo_json(f) for f in filas]
    pagos = bd.execute(
        "SELECT * FROM pagos WHERE paciente_id = ? ORDER BY creado_en DESC LIMIT 50", (paciente_id,)
    ).fetchall()
    return jsonify({
        "pacienteId": paciente_id,
        "totalCargado": round(sum(c["montoNeto"] for c in cargos), 2),
        "totalPagado": round(sum(c["montoPagado"] for c in cargos), 2),
        "saldoPendiente": round(sum(c["saldo"] for c in cargos), 2),
        "cargosPendientes": len([c for c in cargos if c["estado"] != "PAGADO"]),
        "cargos": cargos,
        "pagos": [
            {"id": p["id"], "cargoId": p["cargo_id"], "monto": p["monto"], "metodo": p["metodo"],
             "registradoPor": p["registrado_por"], "creadoEn": p["creado_en"]}
            for p in pagos
        ],
    })


@app.post("/api/v1/cargos/<cargo_id>/pagar")
def pagar_cargo(cargo_id):
    """Registra un abono o pago total de un cargo. Los familiares pueden abonar por partes."""
    cuerpo = request.get_json(silent=True) or {}
    bd = conexion()
    fila = bd.execute("SELECT * FROM cargos WHERE id = ?", (cargo_id,)).fetchone()
    if fila is None:
        return jsonify({"error": "No existe el cargo %s." % cargo_id}), 404
    if fila["estado"] == "PAGADO":
        return jsonify({"error": "El cargo %s ya esta completamente cancelado." % cargo_id}), 409

    saldo = round(fila["monto_neto"] - fila["monto_pagado"], 2)
    try:
        monto = float(cuerpo.get("monto"))
        if monto <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "monto debe ser numerico y mayor que cero."}), 400
    if monto > saldo + 0.01:
        return jsonify({"error": "El monto (%.2f) excede el saldo pendiente (%.2f)." % (monto, saldo)}), 400

    nuevo_pagado = round(fila["monto_pagado"] + monto, 2)
    nuevo_estado = "PAGADO" if nuevo_pagado >= fila["monto_neto"] - 0.01 else "ABONADO"
    ahora = datetime.now().isoformat(timespec="seconds")
    pago_id = _folio("PG")
    bd.execute("INSERT INTO pagos VALUES (?,?,?,?,?,?,?)",
               (pago_id, cargo_id, fila["paciente_id"], monto,
                cuerpo.get("metodo", "efectivo"), firmante(), ahora))
    bd.execute("UPDATE cargos SET monto_pagado = ?, estado = ? WHERE id = ?",
               (nuevo_pagado, nuevo_estado, cargo_id))
    bd.commit()
    return jsonify({
        "pagoId": pago_id,
        "cargoId": cargo_id,
        "monto": monto,
        "estadoCargo": nuevo_estado,
        "saldoRestante": round(fila["monto_neto"] - nuevo_pagado, 2),
    }), 201


@app.get("/api/v1/donaciones")
def listar_donaciones():
    """Alimenta el reporte de entradas: donaciones y cobros."""
    filas = conexion().execute("SELECT * FROM donaciones ORDER BY creado_en DESC LIMIT 200").fetchall()
    donaciones = [
        {"id": f["id"], "donante": f["donante"], "tipo": f["tipo"], "monto": f["monto"],
         "destino": f["destino"], "registradoPor": f["registrado_por"], "creadoEn": f["creado_en"]}
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
    ahora = datetime.now().isoformat(timespec="seconds")
    bd = conexion()
    bd.execute("INSERT INTO donaciones VALUES (?,?,?,?,?,?,?)",
               (donacion_id, cuerpo["donante"], tipo, monto, cuerpo.get("destino", "fondo general"),
                firmante(), ahora))
    bd.commit()
    return jsonify({"id": donacion_id, "donante": cuerpo["donante"], "tipo": tipo, "monto": monto,
                     "creadoEn": ahora}), 201


@app.get("/api/v1/gastos")
def listar_gastos():
    filas = conexion().execute("SELECT * FROM gastos ORDER BY creado_en DESC LIMIT 200").fetchall()
    gastos = [
        {"id": f["id"], "concepto": f["concepto"], "categoria": f["categoria"], "monto": f["monto"],
         "registradoPor": f["registrado_por"], "creadoEn": f["creado_en"]}
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
    ahora = datetime.now().isoformat(timespec="seconds")
    bd = conexion()
    bd.execute("INSERT INTO gastos VALUES (?,?,?,?,?,?)",
               (gasto_id, cuerpo["concepto"], categoria, monto,
                firmante(), ahora))
    bd.commit()
    return jsonify({"id": gasto_id, "concepto": cuerpo["concepto"], "categoria": categoria,
                     "monto": monto, "creadoEn": ahora}), 201


@app.get("/api/v1/fundacion/resumen")
def resumen_fundacion():
    """Reporte de pagos a la fundacion: lo adeudado por consultas, examenes y farmacia
    consumidos por los internos, contra lo que el asilo ya le ha pagado."""
    bd = conexion()
    adeudado = bd.execute(
        "SELECT COALESCE(SUM(monto_neto),0) t FROM cargos WHERE categoria IN "
        + _EN_CLAUSULA_FUNDACION
    ).fetchone()["t"]
    pagado = bd.execute("SELECT COALESCE(SUM(monto),0) t FROM pagos_fundacion").fetchone()["t"]
    pagos = bd.execute(
        "SELECT * FROM pagos_fundacion ORDER BY creado_en DESC LIMIT 50"
    ).fetchall()
    return jsonify({
        "totalAdeudado": round(adeudado, 2),
        "totalPagado": round(pagado, 2),
        "saldoConFundacion": round(adeudado - pagado, 2),
        "pagos": [
            {"id": p["id"], "monto": p["monto"], "referencia": p["referencia"],
             "registradoPor": p["registrado_por"], "creadoEn": p["creado_en"]}
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
    ahora = datetime.now().isoformat(timespec="seconds")
    bd = conexion()
    bd.execute("INSERT INTO pagos_fundacion VALUES (?,?,?,?,?)",
               (pago_id, monto, cuerpo.get("referencia", ""),
                firmante(), ahora))
    bd.commit()
    return jsonify({"id": pago_id, "monto": monto, "creadoEn": ahora}), 201


@app.get("/api/v1/resumen")
def resumen_general():
    """Panel de entradas y salidas para el reporte financiero general del asilo."""
    bd = conexion()
    donaciones = bd.execute("SELECT COALESCE(SUM(monto),0) t FROM donaciones").fetchone()["t"]
    cobrado = bd.execute("SELECT COALESCE(SUM(monto_pagado),0) t FROM cargos").fetchone()["t"]
    pendiente = bd.execute(
        "SELECT COALESCE(SUM(monto_neto - monto_pagado),0) t FROM cargos WHERE estado != 'PAGADO'"
    ).fetchone()["t"]
    gastos = bd.execute("SELECT COALESCE(SUM(monto),0) t FROM gastos").fetchone()["t"]

    # Lo cobrado por cuota de estadia se desglosa aparte para dejar a la vista
    # que es una ENTRADA del asilo y no una deuda con la fundacion: no aparece
    # en adeudo_fundacion, que solo mira las categorias que la fundacion presta.
    cuotas = bd.execute(
        "SELECT COALESCE(SUM(monto_pagado),0) t FROM cargos WHERE categoria = 'CUOTA'"
    ).fetchone()["t"]
    adeudo_fundacion = bd.execute(
        "SELECT COALESCE(SUM(monto_neto),0) t FROM cargos WHERE categoria IN "
        + _EN_CLAUSULA_FUNDACION
    ).fetchone()["t"] - bd.execute(
        "SELECT COALESCE(SUM(monto),0) t FROM pagos_fundacion"
    ).fetchone()["t"]
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


@app.errorhandler(404)
def no_encontrado(_):
    return jsonify({"error": "Ruta no encontrada en ms-caja."}), 404


def sembrar():
    bd = sqlite3.connect(BD, timeout=10)
    bd.row_factory = sqlite3.Row
    if bd.execute("SELECT COUNT(*) n FROM cargos").fetchone()["n"] > 0:
        bd.close()
        return

    hoy = datetime.now()
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
    for pid, tarifa_clave, concepto, dias_atras, pagado in ejemplos:
        t = TARIFARIO[tarifa_clave]
        monto_bruto = t["precioFundacion"]
        descuento = t["descuentoPct"]
        monto_neto = round(monto_bruto * (1 - descuento / 100), 2)
        creado = (hoy - timedelta(days=dias_atras)).isoformat(timespec="seconds")
        nombre = dict(pacientes)[pid]
        cargo_id = _folio("CG")
        monto_pagado = monto_neto if pagado else 0
        estado = "PAGADO" if pagado else "PENDIENTE"
        bd.execute(
            """INSERT INTO cargos (id, paciente_id, paciente_nombre, categoria, concepto, referencia,
                                    monto_bruto, descuento_pct, monto_neto, monto_pagado, estado,
                                    registrado_por, creado_en)
               VALUES (?,?,?,?,?,?,?,?,?,?,?, 'Marta Solis, administracion', ?)""",
            (cargo_id, pid, nombre, t["categoria"], concepto, tarifa_clave,
             monto_bruto, descuento, monto_neto, monto_pagado, estado, creado),
        )
        if pagado:
            bd.execute("INSERT INTO pagos VALUES (?,?,?,?,?,?,?)",
                       (_folio("PG"), cargo_id, pid, monto_neto, "efectivo",
                        "Marta Solis, administracion", creado))

    donaciones = [
        ("Fundacion Amigos del Adulto Mayor", "EMPRESA", 5000.0, "fondo general", 25),
        ("Municipalidad de Mazatenango", "GOBIERNO", 3500.0, "insumos medicos", 18),
        ("Familia Coy Menchu", "PARTICULAR", 400.0, "fondo general", 6),
    ]
    for donante, tipo, monto, destino, dias in donaciones:
        bd.execute("INSERT INTO donaciones VALUES (?,?,?,?,?,?,?)",
                   (_folio("DN"), donante, tipo, monto, destino, "Marta Solis, administracion",
                    (hoy - timedelta(days=dias)).isoformat(timespec="seconds")))

    gastos = [
        ("Energia electrica del mes", "SERVICIOS", 890.0, 15),
        ("Agua potable del mes", "SERVICIOS", 210.0, 15),
        ("Insumos de curacion y limpieza", "INSUMOS", 640.0, 9),
    ]
    for concepto, categoria, monto, dias in gastos:
        bd.execute("INSERT INTO gastos VALUES (?,?,?,?,?,?)",
                   (_folio("GT"), concepto, categoria, monto, "Marta Solis, administracion",
                    (hoy - timedelta(days=dias)).isoformat(timespec="seconds")))

    bd.execute("INSERT INTO pagos_fundacion VALUES (?,?,?,?,?)",
               (_folio("PF"), 1800.0, "Abono de consultas y laboratorios de julio",
                "Marta Solis, administracion", (hoy - timedelta(days=10)).isoformat(timespec="seconds")))

    bd.commit()
    bd.close()


preparar_bd()
if os.environ.get("SEMBRAR", "1") == "1":
    sembrar()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PUERTO", 8083)))
