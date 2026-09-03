const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createProxyMiddleware } = require("http-proxy-middleware");

const APP_NOMBRE = "ms-gateway";
const APP_VERSION = "1.2.0";
const PUERTO = process.env.PUERTO || 8080;
const DURACION_SESION = process.env.GATEWAY_DURACION_SESION || "8h";
const ORIGEN_PERMITIDO = process.env.ORIGEN_PERMITIDO || "http://localhost:8090";

// ---------------------------------------------------------------------------
// El secreto no tiene valor por defecto. Un secreto de desarrollo escrito en
// el codigo es un secreto publicado: cualquiera que lea el repositorio puede
// firmarse un token de MEDICO. Si no viene por ambiente, el gateway no arranca.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Personal del asilo. Ya no vive en este archivo: se lee de usuarios.json, con
// las claves guardadas como hash bcrypt. Ver el README para las credenciales
// de demostracion.
// ---------------------------------------------------------------------------
const USUARIOS = require("./usuarios.json").usuarios;

// Hash de descarte con el que se compara cuando el usuario NO existe, para que
// un login fallido tarde lo mismo exista o no la persona. Sin esto, medir el
// tiempo de respuesta permite averiguar que usuarios estan dados de alta.
const HASH_SENUELO = bcrypt.hashSync("usuario-inexistente-cabeza-de-algodon", 10);

const app = express();
app.disable("x-powered-by");

// Solo la estacion web puede llamar al gateway desde un navegador. Antes el
// CORS estaba abierto a cualquier origen, asi que una pagina cualquiera podia
// usar la sesion de la enfermera que la tuviera abierta.
app.use(cors({ origin: ORIGEN_PERMITIDO }));

// OJO: express.json() NO se registra de forma global. Si consumieramos el
// cuerpo de la peticion aqui, el proxy hacia los microservicios se quedaria
// esperando un cuerpo que ya fue leido y la peticion se cuelga. Por eso el
// parser de JSON solo se monta en las rutas propias del gateway (login).

// Quien abre http://localhost:8080 en el navegador no esta buscando un error:
// esta buscando el sistema. La raiz explica que es esto, que rutas hay, y
// sobre todo que la aplicacion del asilo vive en el 8090.
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
        "POST /api/auth/login": "{ usuario, clave } devuelve { token, nombre, rol }.",
      },
      conSesion: {
        "GET /api/auth/me": "Datos de la persona dueña del token vigente.",
        "POST /api/auth/logout": "Revoca el token vigente.",
        "* /vigia/*": "ms-vigia, farmacovigilancia. Lee MEDICO y ENFERMERIA; escribe MEDICO.",
        "* /pastillero/*":
          "ms-pastillero, padron de internos y plan de tomas. Lee y escribe " +
          "MEDICO y ENFERMERIA; ADMINISTRACION solo lee /api/v1/internos, y sin " +
          "la parte clinica de la ficha.",
        "* /caja/*":
          "ms-caja, entradas, salidas y caja. Lee y escribe ADMINISTRACION; " +
          "MEDICO solo lee /api/v1/pacientes/{id}/cuenta.",
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
    depende_de: { vigia: VIGIA_URL, pastillero: PASTILLERO_URL, caja: CAJA_URL },
    hora: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Limite de intentos de acceso.
// Cinco fallos del mismo usuario en cinco minutos y la cuenta queda en espera.
// Para el prototipo el contador vive en memoria del proceso; en produccion
// esto va en Redis, porque con varias instancias del gateway cada una llevaria
// su propia cuenta y el limite se multiplicaria por el numero de instancias
// (y ademas se perderia en cada reinicio).
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Lista de revocacion: tokens a los que se les cerro la sesion antes de que
// venzan. Se guarda el identificador (jti) y no el token completo. Igual que
// el contador de intentos, en produccion va en Redis y compartida entre
// instancias; aqui alcanza con la memoria del proceso.
// ---------------------------------------------------------------------------
const revocados = new Map(); // jti -> instante (ms) en que vence el token

function limpiarRevocados() {
  const ahora = Date.now();
  for (const [jti, vence] of revocados) {
    if (vence <= ahora) revocados.delete(jti);
  }
}

// ---------------------------------------------------------------------------
// Autenticacion
// ---------------------------------------------------------------------------

app.post("/api/auth/login", express.json(), (req, res) => {
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

  const persona = USUARIOS.find((u) => u.usuario === nombreUsuario);
  // Se compara SIEMPRE contra un hash, exista o no la persona, para que un
  // login fallido tarde lo mismo en los dos casos. Si solo se comparara
  // cuando el usuario existe, cronometrar la respuesta revelaria que
  // usuarios estan dados de alta en el asilo.
  const claveCorrecta = bcrypt.compareSync(
    String(clave),
    persona ? persona.claveHash : HASH_SENUELO
  );
  if (!persona || !claveCorrecta) {
    anotarFallo(nombreUsuario);
    return res.status(401).json({ error: "Usuario o clave incorrectos." });
  }

  intentos.delete(nombreUsuario);
  const payload = { usuario: persona.usuario, nombre: persona.nombre, rol: persona.rol };
  const token = jwt.sign(payload, SECRETO, {
    expiresIn: DURACION_SESION,
    jwtid: crypto.randomUUID(),
  });
  res.json({ token, ...payload, expiraEn: DURACION_SESION });
});

function requiereSesion(req, res, next) {
  const encabezado = req.headers.authorization || "";
  const [tipo, token] = encabezado.split(" ");
  if (tipo !== "Bearer" || !token) {
    return res.status(401).json({ error: "Falta el token de sesion. Inicie sesion primero." });
  }
  try {
    const sesion = jwt.verify(token, SECRETO, { algorithms: ["HS256"] });
    limpiarRevocados();
    if (sesion.jti && revocados.has(sesion.jti)) {
      return res.status(401).json({ error: "La sesion fue cerrada. Inicie sesion de nuevo." });
    }
    req.usuario = sesion;
    return next();
  } catch (error) {
    const mensaje =
      error.name === "TokenExpiredError"
        ? "La sesion expiro. Inicie sesion de nuevo."
        : "Token invalido.";
    return res.status(401).json({ error: mensaje });
  }
}

app.get("/api/auth/me", requiereSesion, (req, res) => {
  res.json(req.usuario);
});

app.post("/api/auth/logout", requiereSesion, (req, res) => {
  if (req.usuario.jti) {
    // exp viene en segundos. Basta recordar el token hasta que venza solo:
    // despues de eso jwt.verify ya lo rechaza por su cuenta.
    revocados.set(req.usuario.jti, (req.usuario.exp || 0) * 1000);
  }
  res.json({ cerrada: true, usuario: req.usuario.usuario });
});

// ---------------------------------------------------------------------------
// Autorizacion por rol.
//
// Se controla la LECTURA y no solo la escritura. En un sistema de salud saber
// quien puede leer que es tan importante como saber quien puede escribir:
// administracion no tiene por que ver la bitacora clinica de un interno, ni
// enfermeria el estado financiero del asilo.
//
//   servicio        lee                     escribe
//   ms-vigia        MEDICO, ENFERMERIA      MEDICO
//   ms-pastillero   MEDICO, ENFERMERIA      MEDICO, ENFERMERIA
//   ms-caja         ADMINISTRACION          ADMINISTRACION
//
// La misma matriz esta repetida dentro de cada microservicio. No es
// duplicacion por descuido: es defensa en profundidad. Si alguien alcanza la
// red interna y esquiva el gateway, el microservicio vuelve a preguntarle
// quien es.
// ---------------------------------------------------------------------------

// Excepcion documentada: el medico puede consultar el estado de cuenta de un
// interno aunque no vea el resto de la caja. Antes de indicar un estudio de
// laboratorio necesita saber si el familiar responsable puede costearlo; sin
// ese dato terminaria indicando examenes que nunca se hacen. La excepcion
// alcanza solo la cuenta de un paciente concreto, nunca el resumen financiero
// del asilo ni el listado de donaciones y gastos.
const CUENTA_DE_PACIENTE = /^\/api\/v1\/pacientes\/[^/]+\/cuenta\/?$/;

// La excepcion simetrica: administracion si puede leer el padron de internos
// de ms-pastillero, porque le cobra a la familia de cada uno y necesita saber
// a quien tiene el asilo y quien es el familiar responsable. ms-pastillero le
// responde la ficha SIN la parte clinica: sin alergias, sin psicopatologias y
// sin medicacion. Saber que Rosalia esta aqui es administrativo; saber que
// tiene demencia mixta es clinico.
const PADRON_DE_INTERNOS = /^\/api\/v1\/internos(\/[^/]+)?\/?$/;

function autorizar(rolesLectura, rolesEscritura) {
  return (req, res, next) => {
    if (req.method === "OPTIONS") return next();

    // La sonda de vida no expone ningun dato del asilo: la consulta la barra
    // de estado de la estacion web con cualquiera de los tres roles.
    if (req.path === "/salud") return next();

    const escribe = req.method !== "GET" && req.method !== "HEAD";
    let permitidos = escribe ? rolesEscritura : rolesLectura;

    if (!escribe && req.baseUrl === "/caja" && CUENTA_DE_PACIENTE.test(req.path)) {
      permitidos = permitidos.concat("MEDICO");
    }
    if (!escribe && req.baseUrl === "/pastillero" && PADRON_DE_INTERNOS.test(req.path)) {
      permitidos = permitidos.concat("ADMINISTRACION");
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

function montarProxy(ruta, destino, rolesLectura, rolesEscritura) {
  app.use(
    ruta,
    requiereSesion,
    autorizar(rolesLectura, rolesEscritura),
    createProxyMiddleware({
      target: destino,
      changeOrigin: true,
      pathRewrite: { ["^" + ruta]: "" },
      onProxyReq: (proxyReq, req) => {
        // El encabezado Authorization viaja tal cual hacia el microservicio,
        // que vuelve a verificar el token por su cuenta. Estos dos
        // encabezados son solo informativos, para la bitacora de acceso.
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

// El 404 dice QUE se pidio y COMO, para que se vea de un vistazo si el error
// fue el metodo, un prefijo mal escrito o una ruta que no existe.
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
  console.log("  personal dado de alta: " + USUARIOS.length);
});
