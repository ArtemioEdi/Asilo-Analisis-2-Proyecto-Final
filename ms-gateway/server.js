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

const MOSTRAR_USUARIOS_DEMO = process.env.MOSTRAR_USUARIOS_DEMO === "1";

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

const USUARIOS = require("./usuarios.json").usuarios;

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
        "GET /api/config": "Ajustes que la estacion web necesita antes de iniciar sesion.",
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
        "* /consultas/*":
          "ms-consultas, la cadena clinica: remision, cita, consulta y ficha " +
          "medica. La lee todo rol clinico; escribe segun el eslabon: MEDICO " +
          "remite y atiende, FUNDACION agenda, LABORATORIO carga resultados y " +
          "FARMACIA entrega.",
      },
    },
    comoAutenticarse:
      "Envie el token en el encabezado: Authorization: Bearer <token>",
    mostrarUsuariosDemo: MOSTRAR_USUARIOS_DEMO,
    hora: new Date().toISOString(),
  });
});

// Publico a proposito: no revela credenciales, solo dice si las de
// demostracion se imprimen en la pantalla de acceso. Va bajo /api porque es el
// prefijo que nginx reenvia al gateway.
app.get("/api/config", (_req, res) => {
  res.json({ mostrarUsuariosDemo: MOSTRAR_USUARIOS_DEMO });
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
  // Siempre contra un hash, exista o no la persona: si solo se comparara
  // cuando existe, cronometrar la respuesta revelaria que usuarios hay.
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
    // exp viene en segundos. Basta recordarlo hasta que venza: despues
    // jwt.verify lo rechaza solo.
    revocados.set(req.usuario.jti, (req.usuario.exp || 0) * 1000);
  }
  res.json({ cerrada: true, usuario: req.usuario.usuario });
});

// Autorizacion por rol. Se controla la LECTURA y no solo la escritura:
// administracion no tiene por que ver la bitacora clinica de un interno, ni
// enfermeria el estado financiero del asilo.
//
//   servicio        lee                     escribe
//   ms-vigia        MEDICO, ENFERMERIA      MEDICO
//   ms-pastillero   MEDICO, ENFERMERIA      MEDICO, ENFERMERIA
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
      permitidos = permitidos.concat("ADMINISTRACION");
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
  console.log("  personal dado de alta: " + USUARIOS.length);
});
