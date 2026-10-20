const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const { createProxyMiddleware } = require("http-proxy-middleware");

const APP_NOMBRE = "ms-gateway";
const APP_VERSION = "1.3.0";
const PUERTO = process.env.PUERTO || 8080;
const DURACION_SESION = process.env.GATEWAY_DURACION_SESION || "8h";
// El token de cambio de clave solo sirve para elegir la clave definitiva.
const DURACION_CAMBIO = "15m";
const ORIGEN_PERMITIDO = process.env.ORIGEN_PERMITIDO || "http://localhost:8090";


const SECRETO = process.env.GATEWAY_SECRETO;
if (!SECRETO || SECRETO.trim().length < 16) {
  console.error(
    "\n[ms-gateway] ERROR DE ARRANQUE: falta la variable GATEWAY_SECRETO " +
      "(o mide menos de 16 caracteres).\n" +
      "  Copie .env.ejemplo a .env y genere un secreto con:\n" +
      "      openssl rand -hex 32\n"
  );
  process.exit(1);
}

const VIGIA_URL = process.env.VIGIA_URL || "http://ms-vigia:8081";
const PASTILLERO_URL = process.env.PASTILLERO_URL || "http://ms-pastillero:8082";
const CAJA_URL = process.env.CAJA_URL || "http://ms-caja:8083";
const CONSULTAS_URL = process.env.CONSULTAS_URL || "http://ms-consultas:8084";

// Las cuentas del personal viven en asilo_acceso, no en un archivo horneado en
// la imagen: el ADMINISTRADOR las da de alta y las desactiva en caliente.
//
// Pool chico: el gateway solo hace lecturas por clave primaria y alguna
// escritura de administracion.
//
// Sobre caching_sha2_password, el metodo por defecto de MySQL 8.4: despues de
// reiniciar bd-asilo el cache de autenticacion rapida queda vacio, y la
// primera conexion pasa por el camino completo, que sin TLS exige cifrar la
// clave con la llave publica RSA del servidor. mysql2 pide esa llave por su
// cuenta cuando la conexion no es segura (es la misma trampa que con PyMySQL,
// que para eso necesita el paquete cryptography). Comprobado con
// "docker compose restart bd-asilo" seguido de un login.
const bd = mysql.createPool({
  host: process.env.BD_HOST || "bd-asilo",
  port: Number(process.env.BD_PUERTO || 3306),
  user: process.env.BD_USUARIO || "usr_acceso",
  password: process.env.BD_CLAVE,
  database: process.env.BD_NOMBRE || "asilo_acceso",
  charset: "utf8mb4",
  connectionLimit: 5,
  // Si la base no contesta, mejor un 503 rapido que una pantalla colgada.
  connectTimeout: 5000,
  enableKeepAlive: true,
  // Las fechas salen como texto, tal cual las guardo MySQL en la hora de
  // Guatemala, sin pasar por la zona horaria del proceso.
  dateStrings: true,
});

// Errores que significan "la base no esta", no "la peticion estaba mal".
const ERRORES_DE_CONEXION = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "EAI_AGAIN",
  "PROTOCOL_CONNECTION_LOST", "PROTOCOL_SEQUENCE_TIMEOUT", "ER_CON_COUNT_ERROR",
  "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_SERVER_SHUTDOWN",
]);

function esErrorDeConexion(error) {
  return Boolean(error && (error.fatal || ERRORES_DE_CONEXION.has(error.code)));
}

const MENSAJE_SIN_BASE =
  "No se pudo consultar la base de cuentas. Intente de nuevo en unos segundos.";

function responderErrorDeBase(res, error) {
  if (esErrorDeConexion(error)) {
    console.error("[ms-gateway] la base de cuentas no responde: " + (error.code || error.message));
    return res.status(503).json({ error: MENSAJE_SIN_BASE });
  }
  console.error("[ms-gateway] error inesperado:", error);
  return res.status(500).json({ error: "Error interno del gateway." });
}

// Envuelve un manejador async: Express 4 no atrapa las promesas rechazadas, y
// sin esto un error de base dejaria la peticion colgada.
function manejar(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => responderErrorDeBase(res, error));
  };
}

// Una sola transaccion por accion de administracion: el cambio y su fila en
// la bitacora se guardan juntos o no se guarda ninguno.
async function enTransaccion(trabajo) {
  const conexion = await bd.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    try { await conexion.rollback(); } catch (_) { /* la conexion ya cayo */ }
    throw error;
  } finally {
    conexion.release();
  }
}

const HASH_SENUELO = bcrypt.hashSync("usuario-inexistente-cabeza-de-algodon", 10);

const app = express();
app.disable("x-powered-by");

app.use(cors({ origin: ORIGEN_PERMITIDO }));

// express.json() NO va global: si se consume el cuerpo aqui, el proxy queda
// esperando un cuerpo ya leido y la peticion se cuelga. Solo en las rutas
// propias del gateway.

// Quien abre el 8080 en el navegador busca el sistema, no un error: la raiz
// le dice que la aplicacion vive en el 8090.
app.get("/", (_req, res) => {
  res.json({
    servicio: APP_NOMBRE,
    version: APP_VERSION,
    descripcion:
      "Puerta de entrada unica del sistema del asilo Cabeza de Algodon. " +
      "Autentica a la persona usuaria y reenvia sus peticiones a ms-vigia, " +
      "ms-pastillero y ms-caja segun su rol.",
    aviso:
      "Esto es la API, no la aplicacion. La estacion de enfermeria esta en " +
      ORIGEN_PERMITIDO,
    rutas: {
      publicas: {
        "GET /": "Este directorio de rutas.",
        "GET /salud": "Sonda de vida del gateway.",
        "POST /api/auth/login":
          "{ usuario, clave } devuelve { token, nombre, rol }. Si la clave es " +
          "temporal devuelve { token, debeCambiarClave: true }: ese token solo " +
          "sirve para /api/auth/me, /api/auth/logout y /api/auth/cambiar-clave.",
      },
      conSesion: {
        "GET /api/auth/me": "Datos de la persona dueña del token vigente.",
        "POST /api/auth/logout": "Revoca el token vigente.",
        "POST /api/auth/cambiar-clave":
          "{ claveActual, claveNueva }. Al menos 8 caracteres, con letra y " +
          "dígito. Devuelve un token nuevo; el anterior deja de servir.",
        "* /vigia/*": "ms-vigia, farmacovigilancia. Lee MEDICO y ENFERMERIA; escribe MEDICO.",
        "* /pastillero/*":
          "ms-pastillero, padron de internos y plan de tomas. Lee y escribe " +
          "MEDICO y ENFERMERIA; ADMINISTRACION solo lee /api/v1/internos, y sin " +
          "la parte clinica de la ficha.",
        "* /caja/*":
          "ms-caja, entradas, salidas y caja. Lee y escribe ADMINISTRACION; " +
          "MEDICO solo lee /api/v1/pacientes/{id}/cuenta.",
        "* /consultas/*":
          "ms-consultas, la cadena clinica: remision, cita, consulta y ficha " +
          "medica. La lee todo rol clinico; escribe segun el eslabon: MEDICO " +
          "remite y atiende, FUNDACION agenda, LABORATORIO carga resultados y " +
          "FARMACIA entrega.",
      },
      soloAdministrador: {
        "GET /api/usuarios": "Las cuentas del personal, activas y desactivadas.",
        "POST /api/usuarios":
          "{ usuario, nombre, rol } da de alta y devuelve la clave temporal, " +
          "esta única vez.",
        "PUT /api/usuarios/{usuario}": "{ nombre, rol }.",
        "POST /api/usuarios/{usuario}/restablecer":
          "Clave temporal nueva, que vence a las 72 horas.",
        "POST /api/usuarios/{usuario}/desactivar": "{ motivo }, obligatorio.",
        "POST /api/usuarios/{usuario}/reactivar":
          "Reactiva la cuenta con una clave temporal nueva.",
        "GET /api/usuarios/{usuario}/bitacora": "Historial de la cuenta.",
        "DELETE /api/usuarios/{usuario}": "No existe: las cuentas no se borran, se desactivan.",
      },
    },
    comoAutenticarse:
      "Envie el token en el encabezado: Authorization: Bearer <token>",
    hora: new Date().toISOString(),
  });
});

app.get("/salud", (_req, res) => {
  res.json({
    servicio: APP_NOMBRE,
    version: APP_VERSION,
    estado: "arriba",
    depende_de: {
      vigia: VIGIA_URL, pastillero: PASTILLERO_URL,
      caja: CAJA_URL, consultas: CONSULTAS_URL,
    },
    hora: new Date().toISOString(),
  });
});

// Limite de intentos: cinco fallos del mismo usuario en cinco minutos.
//
// El contador vive en memoria del proceso, que alcanza para una sola
// instancia. En produccion va en Redis: con varias instancias cada una
// llevaria su propia cuenta y el limite se multiplicaria, ademas de perderse
// en cada reinicio.
const MAX_INTENTOS = 5;
const VENTANA_MS = 5 * 60 * 1000;
const intentos = new Map(); // usuario -> { fallos, desde }

function esperaPorBloqueo(usuario) {
  const registro = intentos.get(usuario);
  if (!registro) return 0;
  const transcurrido = Date.now() - registro.desde;
  if (transcurrido > VENTANA_MS) {
    intentos.delete(usuario);
    return 0;
  }
  if (registro.fallos < MAX_INTENTOS) return 0;
  return Math.ceil((VENTANA_MS - transcurrido) / 1000);
}

function anotarFallo(usuario) {
  const registro = intentos.get(usuario);
  if (!registro || Date.now() - registro.desde > VENTANA_MS) {
    intentos.set(usuario, { fallos: 1, desde: Date.now() });
    return;
  }
  registro.fallos += 1;
}

// Tokens a los que se les cerro la sesion antes de vencer. Se guarda el jti y
// no el token completo. En produccion va en Redis, igual que el contador de
// intentos.
const revocados = new Map(); // jti -> instante (ms) en que vence el token

function limpiarRevocados() {
  const ahora = Date.now();
  for (const [jti, vence] of revocados) {
    if (vence <= ahora) revocados.delete(jti);
  }
}

const ROLES = [
  "MEDICO", "ENFERMERIA", "ADMINISTRACION", "FUNDACION",
  "LABORATORIO", "FARMACIA", "ADMINISTRADOR",
];

// Rol del token de cambio de clave. No esta en ninguna matriz, ni aqui ni en
// los microservicios, asi que todos lo rechazan solos aunque alguien lo lleve
// directo a uno de ellos desde la red interna.
const ROL_CAMBIO = "CAMBIO_DE_CLAVE";

// Lo unico que un token de cambio puede hacer.
const RUTAS_DE_CAMBIO = new Set([
  "GET /api/auth/me",
  "POST /api/auth/logout",
  "POST /api/auth/cambiar-clave",
]);

const MENSAJE_SESION_INVALIDA = "La sesión ya no es válida. Inicie sesión de nuevo.";

// Nunca se selecciona clave_hash fuera del login y del cambio de clave: asi
// ninguna respuesta puede llevarlo por descuido.
const COLUMNAS_PUBLICAS =
  "usuario, nombre, rol, debe_cambiar_clave, clave_temporal_vence, version_sesion, " +
  "activo, creado_en, creado_por, actualizado_en, actualizado_por, desactivado_en, " +
  "desactivado_por, motivo_desactivacion, ultimo_ingreso";

function fecha(valor) {
  return valor ? String(valor).replace(" ", "T") : null;
}

function cuentaPublica(fila) {
  return {
    usuario: fila.usuario,
    nombre: fila.nombre,
    rol: fila.rol,
    activo: fila.activo === 1,
    debeCambiarClave: fila.debe_cambiar_clave === 1,
    claveTemporalVence: fecha(fila.clave_temporal_vence),
    ultimoIngreso: fecha(fila.ultimo_ingreso),
    creadoEn: fecha(fila.creado_en),
    creadoPor: fila.creado_por,
    actualizadoEn: fecha(fila.actualizado_en),
    actualizadoPor: fila.actualizado_por,
    desactivadoEn: fecha(fila.desactivado_en),
    desactivadoPor: fila.desactivado_por,
    motivoDesactivacion: fila.motivo_desactivacion,
  };
}

async function anotarEnBitacora(conexion, usuario, accion, hechoPor, detalle) {
  await conexion.execute(
    "INSERT INTO bitacora_usuarios (usuario, accion, hecho_por, en, detalle) " +
      "VALUES (?, ?, ?, NOW(), ?)",
    [usuario, accion, hechoPor, detalle ? String(detalle).slice(0, 255) : null]
  );
}

function firmarSesion(fila) {
  const payload = {
    usuario: fila.usuario, nombre: fila.nombre, rol: fila.rol,
    ver: fila.version_sesion, cambio: false,
  };
  const token = jwt.sign(payload, SECRETO, {
    expiresIn: DURACION_SESION,
    jwtid: crypto.randomUUID(),
  });
  return {
    token, usuario: fila.usuario, nombre: fila.nombre, rol: fila.rol,
    debeCambiarClave: false, expiraEn: DURACION_SESION,
  };
}

// Con la clave temporal no se entra al sistema: se entra a elegir la clave
// propia, y nada mas.
function firmarCambio(fila) {
  const payload = {
    usuario: fila.usuario, nombre: fila.nombre, rol: ROL_CAMBIO,
    ver: fila.version_sesion, cambio: true,
  };
  const token = jwt.sign(payload, SECRETO, {
    expiresIn: DURACION_CAMBIO,
    jwtid: crypto.randomUUID(),
  });
  return {
    token, usuario: fila.usuario, nombre: fila.nombre,
    debeCambiarClave: true, expiraEn: DURACION_CAMBIO,
  };
}

app.post("/api/auth/login", express.json(), manejar(async (req, res) => {
  const { usuario, clave } = req.body || {};
  if (!usuario || !clave) {
    return res.status(400).json({ error: "Indique usuario y clave." });
  }
  const nombreUsuario = String(usuario).toLowerCase().trim();

  const espera = esperaPorBloqueo(nombreUsuario);
  if (espera > 0) {
    res.set("Retry-After", String(espera));
    return res.status(429).json({
      error: "Demasiados intentos fallidos. Vuelva a intentar en " + espera + " segundos.",
      reintentarEnSegundos: espera,
    });
  }

  // Si la base no responde, 503 y nadie entra. Nunca se deja pasar a alguien
  // porque no se pudo comprobar quien es.
  let persona;
  try {
    const [filas] = await bd.execute(
      "SELECT usuario, nombre, rol, clave_hash, debe_cambiar_clave, version_sesion, activo, " +
        "(clave_temporal_vence IS NOT NULL AND clave_temporal_vence < NOW()) AS temporal_vencida " +
        "FROM usuarios WHERE usuario = ?",
      [nombreUsuario]
    );
    persona = filas[0];
  } catch (error) {
    return responderErrorDeBase(res, error);
  }

  // Siempre contra un hash, exista o no la persona: si solo se comparara
  // cuando existe, cronometrar la respuesta revelaria que usuarios hay.
  const claveCorrecta = await bcrypt.compare(
    String(clave),
    persona ? persona.clave_hash : HASH_SENUELO
  );
  if (!persona || !claveCorrecta) {
    anotarFallo(nombreUsuario);
    return res.status(401).json({ error: "Usuario o clave incorrectos." });
  }
  intentos.delete(nombreUsuario);

  // Estos dos avisos van solo con la clave correcta: a quien no la sabe no se
  // le confirma que la cuenta existe ni en que estado esta.
  if (persona.activo !== 1) {
    return res.status(403).json({
      error: "Esta cuenta está desactivada. Consulte con el administrador.",
    });
  }
  if (persona.temporal_vencida === 1) {
    return res.status(401).json({
      error: "La clave temporal venció. Pida al administrador que la restablezca.",
    });
  }

  await bd.execute("UPDATE usuarios SET ultimo_ingreso = NOW() WHERE usuario = ?", [persona.usuario]);

  if (persona.debe_cambiar_clave === 1) return res.json(firmarCambio(persona));
  res.json(firmarSesion(persona));
}));

// Ademas de la firma, cada peticion consulta la cuenta en la base: una fila por
// clave primaria. Si la cuenta se desactivo, o su version de sesion cambio
// porque le restablecieron la clave, le cambiaron el rol o la cambio ella
// misma, el token deja de servir al instante, sin esperar a que venza. La
// lista de revocados en memoria queda solo para el logout.
async function requiereSesion(req, res, next) {
  const encabezado = req.headers.authorization || "";
  const [tipo, token] = encabezado.split(" ");
  if (tipo !== "Bearer" || !token) {
    return res.status(401).json({ error: "Falta el token de sesion. Inicie sesion primero." });
  }
  let sesion;
  try {
    sesion = jwt.verify(token, SECRETO, { algorithms: ["HS256"] });
  } catch (error) {
    const mensaje =
      error.name === "TokenExpiredError"
        ? "La sesion expiro. Inicie sesion de nuevo."
        : "Token invalido.";
    return res.status(401).json({ error: mensaje });
  }
  limpiarRevocados();
  if (sesion.jti && revocados.has(sesion.jti)) {
    return res.status(401).json({ error: "La sesion fue cerrada. Inicie sesion de nuevo." });
  }

  let cuenta;
  try {
    const [filas] = await bd.execute(
      "SELECT nombre, rol, activo, version_sesion FROM usuarios WHERE usuario = ?",
      [String(sesion.usuario || "")]
    );
    cuenta = filas[0];
  } catch (error) {
    return responderErrorDeBase(res, error);
  }
  if (!cuenta || cuenta.activo !== 1 || cuenta.version_sesion !== sesion.ver) {
    return res.status(401).json({ error: MENSAJE_SESION_INVALIDA });
  }

  if (sesion.cambio === true) {
    const ruta = req.method + " " + (req.baseUrl + req.path).replace(/\/+$/, "");
    if (!RUTAS_DE_CAMBIO.has(ruta)) {
      return res.status(403).json({
        error: "Debe cambiar su clave temporal antes de usar el sistema.",
        debeCambiarClave: true,
      });
    }
    req.usuario = { ...sesion, nombre: cuenta.nombre, rol: ROL_CAMBIO };
    return next();
  }

  // El nombre y el rol salen de la base y no del token, para que un cambio
  // rija de inmediato. Cambiar el rol tambien sube la version, asi que un
  // token con el rol viejo ya no llega hasta aqui.
  req.usuario = { ...sesion, nombre: cuenta.nombre, rol: cuenta.rol };
  return next();
}

app.get("/api/auth/me", requiereSesion, (req, res) => {
  res.json({ ...req.usuario, debeCambiarClave: req.usuario.cambio === true });
});

app.post("/api/auth/logout", requiereSesion, (req, res) => {
  if (req.usuario.jti) {
    // exp viene en segundos. Basta recordarlo hasta que venza: despues
    // jwt.verify lo rechaza solo.
    revocados.set(req.usuario.jti, (req.usuario.exp || 0) * 1000);
  }
  res.json({ cerrada: true, usuario: req.usuario.usuario });
});

// bcrypt solo mira los primeros 72 bytes: una clave mas larga se aceptaria
// aunque se escribiera distinto al final.
const CLAVE_MAX_BYTES = 72;

function motivoClaveDebil(claveNueva, claveActual, usuario) {
  if (claveNueva.length < 8) return "La clave nueva debe tener al menos 8 caracteres.";
  if (Buffer.byteLength(claveNueva, "utf8") > CLAVE_MAX_BYTES) {
    return "La clave nueva no puede pasar de 72 caracteres.";
  }
  if (!/\p{L}/u.test(claveNueva) || !/\d/.test(claveNueva)) {
    return "La clave nueva debe tener al menos una letra y un dígito.";
  }
  if (claveNueva === claveActual) return "La clave nueva debe ser distinta de la actual.";
  if (claveNueva.toLowerCase() === usuario.toLowerCase()) {
    return "La clave nueva no puede ser igual al nombre de usuario.";
  }
  return null;
}

// Sirve para el cambio obligatorio y para el voluntario. En los dos se exige
// la clave actual: un token robado no alcanza para quedarse con la cuenta.
app.post("/api/auth/cambiar-clave", requiereSesion, express.json(), manejar(async (req, res) => {
  const { claveActual, claveNueva } = req.body || {};
  if (typeof claveActual !== "string" || typeof claveNueva !== "string" || !claveActual || !claveNueva) {
    return res.status(400).json({ error: "Indique la clave actual y la clave nueva." });
  }
  const usuario = req.usuario.usuario;

  // El mismo limite de intentos que el login: con un token en la mano no se
  // puede adivinar la clave actual a fuerza de probar.
  const espera = esperaPorBloqueo(usuario);
  if (espera > 0) {
    res.set("Retry-After", String(espera));
    return res.status(429).json({
      error: "Demasiados intentos fallidos. Vuelva a intentar en " + espera + " segundos.",
      reintentarEnSegundos: espera,
    });
  }

  const [filas] = await bd.execute(
    "SELECT clave_hash FROM usuarios WHERE usuario = ?", [usuario]
  );
  if (!filas[0] || !(await bcrypt.compare(claveActual, filas[0].clave_hash))) {
    anotarFallo(usuario);
    return res.status(400).json({ error: "La clave actual no es correcta." });
  }
  intentos.delete(usuario);

  const motivo = motivoClaveDebil(claveNueva, claveActual, usuario);
  if (motivo) return res.status(400).json({ error: motivo });

  const hash = await bcrypt.hash(claveNueva, 10);
  const fila = await enTransaccion(async (conexion) => {
    // La version en el WHERE: si en el medio el administrador le restablecio
    // la clave o la desactivo, este cambio no pisa esa decision.
    const [resultado] = await conexion.execute(
      "UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = 0, clave_temporal_vence = NULL, " +
        "version_sesion = version_sesion + 1, actualizado_en = NOW(), actualizado_por = ? " +
        "WHERE usuario = ? AND version_sesion = ? AND activo = 1",
      [hash, usuario, usuario, req.usuario.ver]
    );
    if (resultado.affectedRows !== 1) return null;
    await anotarEnBitacora(
      conexion, usuario, "CAMBIO_DE_CLAVE", usuario,
      req.usuario.cambio ? "Cambio obligatorio de la clave temporal." : "Cambio voluntario."
    );
    const [nuevas] = await conexion.execute(
      "SELECT usuario, nombre, rol, version_sesion FROM usuarios WHERE usuario = ?", [usuario]
    );
    return nuevas[0];
  });
  if (!fila) return res.status(401).json({ error: MENSAJE_SESION_INVALIDA });

  // Token normal nuevo: la persona sigue trabajando sin volver a escribir la
  // clave. El anterior quedo con la version vieja y ya no sirve.
  res.json(firmarSesion(fila));
}));


// ---------------------------------------------------------------------------
//  Administracion de cuentas: solo el rol ADMINISTRADOR
// ---------------------------------------------------------------------------
//  Las cuentas no se borran: se desactivan. Borrar una dejaria su bitacora sin
//  dueno y permitiria reusar el nombre de usuario para firmar como otra
//  persona. No hay ruta DELETE, y aunque la hubiera usr_acceso no tiene ese
//  permiso en el motor.

// Sin los caracteres que se confunden al dictarla o leerla en papel: ni 0 O o
// ni 1 l I.
const ALFABETO_TEMPORAL = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LARGO_TEMPORAL = 10;
const HORAS_TEMPORAL = 72;

function claveTemporal() {
  for (;;) {
    let clave = "";
    for (let i = 0; i < LARGO_TEMPORAL; i++) {
      clave += ALFABETO_TEMPORAL[crypto.randomInt(ALFABETO_TEMPORAL.length)];
    }
    if (/[a-zA-Z]/.test(clave) && /\d/.test(clave)) return clave;
  }
}

const PATRON_USUARIO = /^[a-z][a-z0-9._-]{2,31}$/;

function soloAdministrador(req, res, next) {
  if (req.usuario.rol === "ADMINISTRADOR") return next();
  return res.status(403).json({
    error: "Su rol (" + req.usuario.rol + ") no esta autorizado para administrar cuentas.",
    rolesPermitidos: ["ADMINISTRADOR"],
  });
}

function validarNombre(nombre) {
  const limpio = typeof nombre === "string" ? nombre.trim().replace(/\s+/g, " ") : "";
  if (limpio.length < 3 || limpio.length > 120) return null;
  return limpio;
}

async function buscarCuenta(conexion, usuario, bloquear) {
  const [filas] = await conexion.execute(
    "SELECT " + COLUMNAS_PUBLICAS + " FROM usuarios WHERE usuario = ?" +
      (bloquear ? " FOR UPDATE" : ""),
    [usuario]
  );
  return filas[0] || null;
}

// Los administradores activos, bloqueando sus filas para que dos
// desactivaciones simultaneas no dejen al sistema sin ninguno.
//
// Con una sola peticion por vez esta salvaguarda no se alcanza: quien la pide
// es un administrador activo, y no puede tocarse a si mismo. Existe para la
// carrera: dos administradores que se desactivan mutuamente en el mismo
// instante pasan los dos el control de sesion, pero el FOR UPDATE los pone en
// fila y el segundo encuentra que ya solo queda uno.
//
// Se llama SIEMPRE ANTES de bloquear la fila del objetivo. Al reves se cruzan:
// A bloquea la fila de B y espera la suya, B bloquea la de A y espera la de B,
// e InnoDB aborta a una de las dos con un interbloqueo que salia como 500.
// Con el mismo orden en todas las transacciones no hay ciclo posible: la
// segunda espera, lee que ya queda un solo administrador y responde 409.
//
// Y se recorre la clave primaria, no el indice (rol, activo). Por ese indice,
// InnoDB bloquea tambien el hueco entre sus entradas; desactivar mueve la
// entrada de la cuenta dentro de ese mismo indice, y esa insercion chocaba con
// el bloqueo que la otra transaccion tenia en espera: seguia habiendo
// interbloqueo, comprobado en la carrera. Por la clave primaria nadie retiene
// nada en el indice secundario. Se bloquean todas las filas, pero la tabla es
// el personal de un asilo y las lecturas sin FOR UPDATE —el control de sesion
// de cada peticion— no esperan.
async function administradoresActivos(conexion) {
  const [filas] = await conexion.execute(
    "SELECT usuario FROM usuarios FORCE INDEX (PRIMARY) " +
      "WHERE rol = 'ADMINISTRADOR' AND activo = 1 ORDER BY usuario FOR UPDATE"
  );
  return filas.map((f) => f.usuario);
}

// Quien actua paso el control de sesion al llegar, pero en la misma carrera
// pudieron desactivarlo mientras esperaba su turno. Con las filas de los
// administradores ya bloqueadas, se confirma que sigue siendo uno de ellos.
function exigirAdministradorVigente(administradores, quien) {
  if (!administradores.includes(quien)) throw new Rechazo(401, MENSAJE_SESION_INVALIDA);
}

class Rechazo extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

// Como manejar(), pero un Rechazo lanzado dentro de una transaccion se
// responde con su codigo y su motivo, despues del rollback.
function administrar(fn) {
  return manejar(async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof Rechazo) return res.status(error.estado).json({ error: error.message });
      // Red de seguridad por si algun camino nuevo rompe el orden de los
      // bloqueos: un choque entre dos operaciones no es un error interno.
      if (error.code === "ER_LOCK_DEADLOCK" || error.code === "ER_LOCK_WAIT_TIMEOUT") {
        return res.status(409).json({
          error: "Otra operación sobre las cuentas se cruzó con esta. Vuelva a intentarlo.",
        });
      }
      throw error;
    }
  });
}

const cuentas = express.Router();

cuentas.get("/", administrar(async (_req, res) => {
  const [filas] = await bd.query(
    "SELECT " + COLUMNAS_PUBLICAS + " FROM usuarios ORDER BY activo DESC, nombre"
  );
  const lista = filas.map(cuentaPublica);
  res.json({
    total: lista.length,
    activas: lista.filter((c) => c.activo).length,
    desactivadas: lista.filter((c) => !c.activo).length,
    cuentas: lista,
  });
}));

cuentas.post("/", administrar(async (req, res) => {
  const cuerpo = req.body || {};
  const usuario = typeof cuerpo.usuario === "string" ? cuerpo.usuario.trim().toLowerCase() : "";
  if (!PATRON_USUARIO.test(usuario)) {
    return res.status(400).json({
      error: "El usuario debe tener de 3 a 32 caracteres: minúsculas, dígitos, punto, " +
        "guion o guion bajo, y empezar con una letra.",
    });
  }
  const nombre = validarNombre(cuerpo.nombre);
  if (!nombre) return res.status(400).json({ error: "El nombre debe tener de 3 a 120 caracteres." });
  if (!ROLES.includes(cuerpo.rol)) {
    return res.status(400).json({ error: "Rol desconocido.", rolesValidos: ROLES });
  }

  const temporal = claveTemporal();
  const hash = await bcrypt.hash(temporal, 10);
  const admin = req.usuario.usuario;
  let fila;
  try {
    fila = await enTransaccion(async (conexion) => {
      await conexion.execute(
        "INSERT INTO usuarios (usuario, nombre, rol, clave_hash, debe_cambiar_clave, " +
          "clave_temporal_vence, creado_en, creado_por) " +
          "VALUES (?, ?, ?, ?, 1, NOW() + INTERVAL " + HORAS_TEMPORAL + " HOUR, NOW(), ?)",
        [usuario, nombre, cuerpo.rol, hash, admin]
      );
      await anotarEnBitacora(conexion, usuario, "ALTA", admin, "Alta con rol " + cuerpo.rol + ".");
      return buscarCuenta(conexion, usuario);
    });
  } catch (error) {
    // La clave primaria lo decide, tambien contra una cuenta desactivada: un
    // nombre de usuario no se recicla.
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "Ya existe una cuenta con el usuario '" + usuario + "'" +
          " (puede estar desactivada: reactívela en lugar de crear otra).",
      });
    }
    throw error;
  }
  const cuenta = cuentaPublica(fila);
  res.status(201).json({
    cuenta,
    // Esta unica vez. No se guarda en ningun lado salvo como hash.
    claveTemporal: temporal,
    claveTemporalVence: cuenta.claveTemporalVence,
  });
}));

cuentas.put("/:usuario", administrar(async (req, res) => {
  const cuerpo = req.body || {};
  const objetivo = String(req.params.usuario).toLowerCase();
  const admin = req.usuario.usuario;

  const nombre = cuerpo.nombre === undefined ? undefined : validarNombre(cuerpo.nombre);
  if (nombre === null) return res.status(400).json({ error: "El nombre debe tener de 3 a 120 caracteres." });
  if (cuerpo.rol !== undefined && !ROLES.includes(cuerpo.rol)) {
    return res.status(400).json({ error: "Rol desconocido.", rolesValidos: ROLES });
  }
  if (nombre === undefined && cuerpo.rol === undefined) {
    return res.status(400).json({ error: "Indique el nombre, el rol o los dos." });
  }

  const fila = await enTransaccion(async (conexion) => {
    // Primero los administradores, despues el objetivo: ver administradoresActivos.
    const administradores = await administradoresActivos(conexion);
    const actual = await buscarCuenta(conexion, objetivo, true);
    if (!actual) throw new Rechazo(404, "No existe la cuenta '" + objetivo + "'.");
    if (actual.activo !== 1) {
      throw new Rechazo(409, "La cuenta está desactivada: reactívela antes de editarla.");
    }
    const nombreNuevo = nombre === undefined ? actual.nombre : nombre;
    const rolNuevo = cuerpo.rol === undefined ? actual.rol : cuerpo.rol;
    const cambiaRol = rolNuevo !== actual.rol;

    if (cambiaRol && objetivo === admin) {
      throw new Rechazo(409, "No puede cambiarse el rol a sí mismo: pídaselo a otro administrador.");
    }
    if (cambiaRol && actual.rol === "ADMINISTRADOR" && administradores.length <= 1) {
      throw new Rechazo(409, "Es el último ADMINISTRADOR activo: el sistema se quedaría sin quien gestione las cuentas.");
    }
    exigirAdministradorVigente(administradores, admin);

    const cambios = [];
    if (nombreNuevo !== actual.nombre) cambios.push("nombre '" + actual.nombre + "' → '" + nombreNuevo + "'");
    if (cambiaRol) cambios.push("rol " + actual.rol + " → " + rolNuevo);

    // Cambiar el rol sube la version: los tokens con el rol viejo mueren ya.
    await conexion.execute(
      "UPDATE usuarios SET nombre = ?, rol = ?, actualizado_en = NOW(), actualizado_por = ?" +
        (cambiaRol ? ", version_sesion = version_sesion + 1" : "") +
        " WHERE usuario = ?",
      [nombreNuevo, rolNuevo, admin, objetivo]
    );
    await anotarEnBitacora(
      conexion, objetivo, "EDICION", admin,
      cambios.length ? "Cambió " + cambios.join("; ") + "." : "Sin cambios."
    );
    return buscarCuenta(conexion, objetivo);
  });
  res.json({ cuenta: cuentaPublica(fila) });
}));

cuentas.post("/:usuario/restablecer", administrar(async (req, res) => {
  const objetivo = String(req.params.usuario).toLowerCase();
  const admin = req.usuario.usuario;
  const temporal = claveTemporal();
  const hash = await bcrypt.hash(temporal, 10);

  const fila = await enTransaccion(async (conexion) => {
    const actual = await buscarCuenta(conexion, objetivo, true);
    if (!actual) throw new Rechazo(404, "No existe la cuenta '" + objetivo + "'.");
    if (actual.activo !== 1) {
      throw new Rechazo(409, "La cuenta está desactivada: reactivarla ya le da una clave temporal nueva.");
    }
    await conexion.execute(
      "UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = 1, " +
        "clave_temporal_vence = NOW() + INTERVAL " + HORAS_TEMPORAL + " HOUR, " +
        "version_sesion = version_sesion + 1, actualizado_en = NOW(), actualizado_por = ? " +
        "WHERE usuario = ?",
      [hash, admin, objetivo]
    );
    await anotarEnBitacora(conexion, objetivo, "RESTABLECIMIENTO", admin,
      "Clave temporal nueva; las sesiones abiertas se cerraron.");
    return buscarCuenta(conexion, objetivo);
  });
  const cuenta = cuentaPublica(fila);
  res.json({ cuenta, claveTemporal: temporal, claveTemporalVence: cuenta.claveTemporalVence });
}));

cuentas.post("/:usuario/desactivar", administrar(async (req, res) => {
  const objetivo = String(req.params.usuario).toLowerCase();
  const admin = req.usuario.usuario;
  const motivo = typeof (req.body || {}).motivo === "string"
    ? req.body.motivo.trim().replace(/\s+/g, " ") : "";
  if (motivo.length < 3 || motivo.length > 200) {
    return res.status(400).json({ error: "Indique el motivo de la desactivación (de 3 a 200 caracteres)." });
  }
  if (objetivo === admin) {
    return res.status(409).json({ error: "No puede desactivar su propia cuenta: pídaselo a otro administrador." });
  }

  const fila = await enTransaccion(async (conexion) => {
    // Primero los administradores, despues el objetivo: ver administradoresActivos.
    const administradores = await administradoresActivos(conexion);
    const actual = await buscarCuenta(conexion, objetivo, true);
    if (!actual) throw new Rechazo(404, "No existe la cuenta '" + objetivo + "'.");
    if (actual.activo !== 1) throw new Rechazo(409, "La cuenta ya está desactivada.");
    if (actual.rol === "ADMINISTRADOR" && administradores.length <= 1) {
      throw new Rechazo(409, "Es el último ADMINISTRADOR activo: el sistema se quedaría sin quien gestione las cuentas.");
    }
    exigirAdministradorVigente(administradores, admin);
    await conexion.execute(
      "UPDATE usuarios SET activo = 0, desactivado_en = NOW(), desactivado_por = ?, " +
        "motivo_desactivacion = ?, version_sesion = version_sesion + 1, " +
        "actualizado_en = NOW(), actualizado_por = ? WHERE usuario = ?",
      [admin, motivo, admin, objetivo]
    );
    await anotarEnBitacora(conexion, objetivo, "DESACTIVACION", admin, motivo);
    return buscarCuenta(conexion, objetivo);
  });
  res.json({ cuenta: cuentaPublica(fila) });
}));

// Reactivar emite una clave temporal nueva: la persona estuvo fuera y su clave
// anterior ya no se da por segura.
cuentas.post("/:usuario/reactivar", administrar(async (req, res) => {
  const objetivo = String(req.params.usuario).toLowerCase();
  const admin = req.usuario.usuario;
  const temporal = claveTemporal();
  const hash = await bcrypt.hash(temporal, 10);

  const fila = await enTransaccion(async (conexion) => {
    const actual = await buscarCuenta(conexion, objetivo, true);
    if (!actual) throw new Rechazo(404, "No existe la cuenta '" + objetivo + "'.");
    if (actual.activo === 1) throw new Rechazo(409, "La cuenta ya está activa.");
    // El motivo de la desactivacion no se pierde: queda en la bitacora.
    await conexion.execute(
      "UPDATE usuarios SET activo = 1, desactivado_en = NULL, desactivado_por = NULL, " +
        "motivo_desactivacion = NULL, clave_hash = ?, debe_cambiar_clave = 1, " +
        "clave_temporal_vence = NOW() + INTERVAL " + HORAS_TEMPORAL + " HOUR, " +
        "version_sesion = version_sesion + 1, actualizado_en = NOW(), actualizado_por = ? " +
        "WHERE usuario = ?",
      [hash, admin, objetivo]
    );
    await anotarEnBitacora(conexion, objetivo, "REACTIVACION", admin,
      "Reactivada con clave temporal nueva.");
    return buscarCuenta(conexion, objetivo);
  });
  const cuenta = cuentaPublica(fila);
  res.json({ cuenta, claveTemporal: temporal, claveTemporalVence: cuenta.claveTemporalVence });
}));

cuentas.get("/:usuario/bitacora", administrar(async (req, res) => {
  const objetivo = String(req.params.usuario).toLowerCase();
  const cuenta = await buscarCuenta(bd, objetivo);
  if (!cuenta) return res.status(404).json({ error: "No existe la cuenta '" + objetivo + "'." });
  const [filas] = await bd.execute(
    "SELECT id, accion, hecho_por, en, detalle FROM bitacora_usuarios " +
      "WHERE usuario = ? ORDER BY id DESC",
    [objetivo]
  );
  res.json({
    usuario: objetivo,
    total: filas.length,
    registros: filas.map((f) => ({
      id: f.id, accion: f.accion, hechoPor: f.hecho_por, en: fecha(f.en), detalle: f.detalle,
    })),
  });
}));

cuentas.delete(["/", "/:usuario"], (_req, res) => {
  res.set("Allow", "GET, POST, PUT");
  res.status(405).json({ error: "Las cuentas no se borran: se desactivan." });
});

// express.json() solo aqui, igual que en el login: si fuera global se comeria
// el cuerpo que tiene que llegarle al proxy.
app.use("/api/usuarios", requiereSesion, soloAdministrador, express.json(), cuentas);

// Autorizacion por rol. Se controla la LECTURA y no solo la escritura:
// administracion no tiene por que ver la bitacora clinica de un interno, ni
// enfermeria el estado financiero del asilo.
//
//   servicio        lee                     escribe
//   ms-vigia        MEDICO, ENFERMERIA      MEDICO
//   ms-pastillero   MEDICO, ENFERMERIA      MEDICO, ENFERMERIA
//                   + el padron lo leen ADMINISTRACION y ADMINISTRADOR, y lo
//                     escribe solo ADMINISTRADOR; la parte clinica de la
//                     ficha la escribe solo MEDICO
//   ms-caja         ADMINISTRACION          ADMINISTRACION
//
// La misma matriz esta repetida dentro de cada microservicio: defensa en
// profundidad, por si alguien esquiva el gateway desde la red interna.

// Excepcion: el medico lee la cuenta de UN interno, porque antes de indicar un
// laboratorio necesita saber si la familia puede costearlo. Nunca el balance
// del asilo, ni donaciones, ni gastos.
const CUENTA_DE_PACIENTE = /^\/api\/v1\/pacientes\/[^/]+\/cuenta\/?$/;

// La simetrica: administracion lee el padron porque le cobra a la familia,
// pero ms-pastillero le responde la ficha SIN la parte clinica.
const PADRON_DE_INTERNOS = /^\/api\/v1\/internos(\/[^/]+)?\/?$/;

// El padron lo gestiona el ADMINISTRADOR: alta, datos administrativos y
// egreso. No alcanza la parte clinica de la ficha ni ninguna otra ruta de
// ms-pastillero, que siguen siendo del personal clinico.
const PADRON_ESCRITURA = /^\/api\/v1\/internos(\/[^/]+(\/egreso)?)?\/?$/;

// La simetrica: psicopatologias, alergias y medicacion permanente las escribe
// el MEDICO y nadie mas, ni siquiera quien gestiona el padron. Son los datos
// con los que ms-vigia decide si bloquea un medicamento.
const FICHA_CLINICA = /^\/api\/v1\/internos\/[^/]+\/clinica\/?$/;

// Suspender es solo del MEDICO: no es registrar lo que paso, es revocar una
// decision clinica, y esa la toma quien la firmo. Enfermeria consigna hechos
// con "omitir". La misma regla esta repetida dentro de ms-pastillero.
const SUSPENDER_PLAN = /^\/api\/v1\/planes\/[^/]+\/suspender\/?$/;

function autorizar(rolesLectura, rolesEscritura) {
  return (req, res, next) => {
    if (req.method === "OPTIONS") return next();

    // La sonda de vida no expone datos: la consulta la barra de estado.
    if (req.path === "/salud") return next();

    const escribe = req.method !== "GET" && req.method !== "HEAD";
    let permitidos = escribe ? rolesEscritura : rolesLectura;

    if (!escribe && req.baseUrl === "/caja" && CUENTA_DE_PACIENTE.test(req.path)) {
      permitidos = permitidos.concat("MEDICO");
    }
    if (!escribe && req.baseUrl === "/pastillero" && PADRON_DE_INTERNOS.test(req.path)) {
      permitidos = permitidos.concat("ADMINISTRACION", "ADMINISTRADOR");
    }
    // El orden importa: /clinica se comprueba ANTES que PADRON_ESCRITURA, y
    // PADRON_ESCRITURA no la abarca, para que el administrador no pueda
    // escribir alergias por el camino de los datos administrativos.
    if (escribe && req.baseUrl === "/pastillero" && FICHA_CLINICA.test(req.path)) {
      permitidos = ["MEDICO"];
    } else if (escribe && req.baseUrl === "/pastillero" && PADRON_ESCRITURA.test(req.path)) {
      permitidos = ["ADMINISTRADOR"];
    }
    if (escribe && req.baseUrl === "/pastillero" && SUSPENDER_PLAN.test(req.path)) {
      permitidos = ["MEDICO"];
    }

    if (permitidos.includes(req.usuario.rol)) return next();
    return res.status(403).json({
      error:
        "Su rol (" + req.usuario.rol + ") no esta autorizado para " +
        (escribe ? "escribir en " : "leer ") + req.baseUrl.slice(1) + ".",
      rolesPermitidos: permitidos,
    });
  };
}

// La matriz de /consultas va ruta por ruta y no por servicio: cada eslabon de
// la cadena lo mueve un rol distinto y cada uno lee solo su parte.
//
//   MEDICO       lee todo; escribe solicitudes, visitas, examenes e indicaciones
//   ENFERMERIA   lee todo; no escribe nada
//   FUNDACION    lee solicitudes; escribe solo el agendar
//   LABORATORIO  lee visitas y examenes; escribe solo el resultado
//   FARMACIA     lee visitas e indicaciones; escribe solo la entrega
//   ADMINISTRACION  sin acceso: la cadena clinica no es informacion suya
//
// Repetida tambien dentro de ms-consultas: defensa en profundidad.
const LECTURA_CONSULTAS = [
  [/^\/api\/v1\/solicitudes/, ["MEDICO", "ENFERMERIA", "FUNDACION"]],
  [/^\/api\/v1\/visitas/, ["MEDICO", "ENFERMERIA", "LABORATORIO", "FARMACIA"]],
  [/^\/api\/v1\/examenes/, ["MEDICO", "ENFERMERIA", "LABORATORIO"]],
  [/^\/api\/v1\/indicaciones/, ["MEDICO", "ENFERMERIA", "FARMACIA"]],
  // Los avisos a la familia los ve quien lleva la parte clinica.
  [/^\/api\/v1\/correos/, ["MEDICO", "ENFERMERIA"]],
  // La ficha completa se queda en manos clinicas: darsela al laboratorio o a
  // la farmacia desharia por otra puerta el filtro por bloque de las visitas.
  [/^\/api\/v1\/reportes\/ficha/, ["MEDICO", "ENFERMERIA"]],
  // El laboratorio si ve este: son los estudios que el mismo realiza.
  [/^\/api\/v1\/reportes\/examenes/, ["MEDICO", "ENFERMERIA", "LABORATORIO"]],
];

const ESCRITURA_CONSULTAS = [
  ["POST", /^\/api\/v1\/solicitudes\/?$/, ["MEDICO"]],
  ["PUT", /^\/api\/v1\/solicitudes\/[^/]+\/agendar\/?$/, ["FUNDACION"]],
  ["POST", /^\/api\/v1\/visitas\/?$/, ["MEDICO"]],
  ["PUT", /^\/api\/v1\/visitas\/[^/]+\/cerrar\/?$/, ["MEDICO"]],
  ["PUT", /^\/api\/v1\/visitas\/[^/]+\/?$/, ["MEDICO"]],
  ["POST", /^\/api\/v1\/visitas\/[^/]+\/examenes\/?$/, ["MEDICO"]],
  ["POST", /^\/api\/v1\/visitas\/[^/]+\/indicaciones\/?$/, ["MEDICO"]],
  ["PUT", /^\/api\/v1\/examenes\/[^/]+\/resultado\/?$/, ["LABORATORIO"]],
  ["PUT", /^\/api\/v1\/indicaciones\/[^/]+\/entregar\/?$/, ["FARMACIA"]],
];

function autorizarConsultas(req, res, next) {
  if (req.method === "OPTIONS") return next();
  if (req.path === "/salud") return next();

  const rol = req.usuario.rol;
  const lee = req.method === "GET" || req.method === "HEAD";
  const reglas = lee ? LECTURA_CONSULTAS : ESCRITURA_CONSULTAS;

  for (const regla of reglas) {
    const [metodo, patron, permitidos] = lee
      ? [req.method, regla[0], regla[1]]
      : regla;
    if (req.method !== metodo || !patron.test(req.path)) continue;
    if (permitidos.includes(rol)) return next();
    return res.status(403).json({
      error:
        "Su rol (" + rol + ") no esta autorizado para " +
        (lee ? "leer este registro" : "esta accion") + " de la cadena clinica.",
      rolesPermitidos: permitidos,
    });
  }
  return res.status(404).json({
    error: "Ruta no encontrada en ms-consultas.",
    ruta: req.originalUrl,
    metodo: req.method,
  });
}

function montarProxy(ruta, destino, rolesLectura, rolesEscritura, autorizador) {
  app.use(
    ruta,
    requiereSesion,
    autorizador || autorizar(rolesLectura, rolesEscritura),
    createProxyMiddleware({
      target: destino,
      changeOrigin: true,
      pathRewrite: { ["^" + ruta]: "" },
      onProxyReq: (proxyReq, req) => {
        // Authorization viaja tal cual: el microservicio vuelve a verificarlo.
        // Estos dos son informativos, para la bitacora de acceso.
        proxyReq.setHeader("X-Usuario", req.usuario.usuario);
        proxyReq.setHeader("X-Rol", req.usuario.rol);
      },
      onError: (_err, _req, res) => {
        res.status(502).json({ error: "El servicio " + ruta.slice(1) + " no respondio." });
      },
    })
  );
}

montarProxy("/vigia", VIGIA_URL, ["MEDICO", "ENFERMERIA"], ["MEDICO"]);
montarProxy("/pastillero", PASTILLERO_URL, ["MEDICO", "ENFERMERIA"], ["MEDICO", "ENFERMERIA"]);
montarProxy("/caja", CAJA_URL, ["ADMINISTRACION"], ["ADMINISTRACION"]);

// /consultas lleva su propio autorizador: su matriz es por ruta.
montarProxy("/consultas", CONSULTAS_URL, null, null, autorizarConsultas);

// El 404 dice que se pidio y con que metodo, para distinguir un prefijo mal
// escrito de una ruta que no existe.
app.use((req, res) => {
  res.status(404).json({
    error: "Ruta no encontrada en ms-gateway.",
    ruta: req.originalUrl,
    metodo: req.method,
    sugerencia: "Consulte GET / para ver las rutas disponibles.",
  });
});

app.listen(PUERTO, () => {
  console.log(APP_NOMBRE + " v" + APP_VERSION + " escuchando en el puerto " + PUERTO);
  console.log("  origen permitido para el navegador: " + ORIGEN_PERMITIDO);
  // Solo informativo: si la base todavia no responde, el gateway arranca
  // igual y el login contesta 503 hasta que vuelva.
  bd.query("SELECT COUNT(*) AS activas FROM usuarios WHERE activo = 1")
    .then(([filas]) => console.log("  cuentas activas del personal: " + filas[0].activas))
    .catch((error) => console.error("  la base de cuentas todavia no responde: " + (error.code || error.message)));
});
