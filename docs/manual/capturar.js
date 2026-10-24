// ---------------------------------------------------------------------------
// Capturas del manual de usuario.
//
// Maneja Edge (o Chrome) en modo headless por su protocolo de depuracion, sin
// dependencias: solo Node 22, que ya trae fetch y WebSocket. Recorre el sistema
// como lo haria una persona y guarda cada pantalla en
// docs/manual/capturas/captura-NN.png.
//
// Se corre desde la raiz del proyecto, con el stack recien levantado y SIN
// haber corrido ninguna prueba antes, para que se vea el escenario sembrado:
//
//     docker compose down -v && docker compose up -d     (y esperar a que este sano)
//     node docs/manual/capturar.js
//
// Usa solo las cuentas de demostracion documentadas en el README. No lee el
// .env. La captura 28 detiene ms-caja un momento con "docker compose stop" y lo
// vuelve a levantar.
//
// Variables opcionales: NAVEGADOR (ruta del ejecutable de Edge o Chrome),
// WEB (por defecto http://localhost:8090), GATEWAY (http://localhost:8080) y
// SOLO, para repetir capturas sueltas: SOLO=06,07 node docs/manual/capturar.js.
// Las tres de telefono (29, 34 y 35) entran solas con la cuenta que necesitan:
// SOLO=29,34,35 las repite sin tocar las demas.
// Ojo: cada paso que solo mira se puede repetir, pero los que guardan algo
// (09, 11, 12, 13, 27) cambian los datos; para repetirlos, stack desde cero.
// ---------------------------------------------------------------------------
"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WEB = process.env.WEB || "http://localhost:8090";
const GATEWAY = process.env.GATEWAY || "http://localhost:8080";
const SALIDA = path.join(__dirname, "capturas");
const PUERTO = 9340;
const NAVEGADOR = process.env.NAVEGADOR || [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium",
].find((r) => fs.existsSync(r));

// Las cuentas de demostracion del README.
const CLAVES = {
  admin: "admin2026x", medico: "medico2026", enfermeria: "enfermeria2026",
  administracion: "admin2026", fundacion: "fundacion2026",
  laboratorio: "laboratorio2026", farmacia: "farmacia2026",
};

const ANCHO = 1366, ALTO = 768, ESCALA = 2;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const resultado = [];
const SOLO = process.env.SOLO ? process.env.SOLO.split(",").map((x) => x.trim()) : null;

// ----------------------------- el navegador ---------------------------------

function conectar(url) {
  const ws = new WebSocket(url);
  let n = 0;
  const espera = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && espera.has(d.id)) {
      const { ok, mal } = espera.get(d.id);
      espera.delete(d.id);
      d.error ? mal(new Error(JSON.stringify(d.error))) : ok(d.result);
    }
  };
  return new Promise((listo) => {
    ws.onopen = () => listo({
      send: (method, params) => new Promise((ok, mal) => {
        const id = ++n;
        espera.set(id, { ok, mal });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      }),
      cerrar: () => ws.close(),
    });
  });
}

let cdp;
async function ev(expr) {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception
    ? r.exceptionDetails.exception.description : JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const medios = (media) => cdp.send("Emulation.setEmulatedMedia",
  { media, features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
const ventana = (w, h, movil) => cdp.send("Emulation.setDeviceMetricsOverride",
  { width: w, height: h, deviceScaleFactor: ESCALA, mobile: Boolean(movil) });

async function esperarA(expr, descripcion, ms) {
  const fin = Date.now() + (ms || 15000);
  while (Date.now() < fin) {
    try { if (await ev(expr)) return; } catch (_) { /* la pagina todavia carga */ }
    await dormir(150);
  }
  throw new Error("no se cumplio a tiempo: " + descripcion);
}

// Antes de cada foto: que no quede nada cargando y que ningun aviso tape la
// pantalla. Los avisos se retiran: son de la accion anterior, no de esta.
async function foto(nn, nota) {
  await esperarA(`!document.querySelector(".esqueleto")`, "que termine de cargar", 15000);
  await ev(`document.getElementById("avisos").textContent = ""; true`);
  await dormir(700);
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const archivo = path.join(SALIDA, "captura-" + nn + ".png");
  fs.writeFileSync(archivo, Buffer.from(r.data, "base64"));
  resultado.push("OK    " + nn + (nota ? "  " + nota : ""));
}

// Cada captura en su propio intento: si una falla, se anota y siguen las demas.
async function paso(nn, fn) {
  if (SOLO && !SOLO.includes(nn)) return;
  try { await fn(); } catch (e) { resultado.push("FALLA " + nn + "  " + e.message.split("\n")[0]); }
}

// ----------------------------- la estacion ----------------------------------

async function cargar() {
  await cdp.send("Page.navigate", { url: WEB + "/" });
  await esperarA(`document.readyState === "complete" && !!document.getElementById("acceso-usuario")`, "la pagina de acceso");
  await dormir(1200);
}

// Quien tiene la sesion abierta, para que una captura suelta (SOLO) entre por
// su cuenta en vez de depender de los pasos anteriores.
let enSesion = null;
async function asegurar(usuario) {
  if (enSesion === usuario) return;
  if (enSesion) await salir();
  await entrar(usuario);
}

async function entrar(usuario, clave, aDondeLlega) {
  await ev(`(() => { const u = document.getElementById("acceso-usuario"); u.value = ${JSON.stringify(usuario)};
    document.getElementById("acceso-clave").value = ${JSON.stringify(clave || CLAVES[usuario])};
    document.getElementById("formulario-acceso").requestSubmit(); return true; })()`);
  await esperarA(aDondeLlega || `!document.getElementById("armazon").hidden`, "entrar como " + usuario);
  enSesion = usuario;
  await dormir(1500);
}

async function salir() {
  await ev(`document.getElementById("cambio-clave").hidden ? document.getElementById("cerrar-sesion").click()
            : document.getElementById("cambio-salir").click(); true`);
  await esperarA(`!document.getElementById("acceso").hidden`, "volver al acceso");
  enSesion = null;
  await dormir(500);
}

async function ir(hash, listo, descripcion) {
  await ev(`location.hash = ${JSON.stringify(hash)}; window.scrollTo(0, 0); true`);
  if (listo) await esperarA(listo, descripcion || hash);
  await dormir(800);
}

// Rellena campos por id y avisa como si se hubiera escrito.
async function llenar(campos) {
  await ev(`(() => { const c = ${JSON.stringify(campos)};
    for (const [id, valor] of Object.entries(c)) {
      const n = document.getElementById(id);
      if (!n) throw new Error("no existe #" + id);
      n.value = valor;
      n.dispatchEvent(new Event("input", { bubbles: true }));
      n.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true; })()`);
}

// Si la accion abrio el dialogo de confirmacion, se acepta.
async function aceptarSiPregunta() {
  await dormir(400);
  if (await ev(`!document.getElementById("confirmar").hidden`)) {
    await ev(`document.getElementById("confirmar-si").click(); true`);
    await dormir(800);
  }
}

// Un boton por su texto, dentro de un contenedor y de la tarjeta que contenga
// un texto dado.
const pulsar = (contenedor, texto, dentroDe) => ev(`(() => {
  const raiz = document.getElementById(${JSON.stringify(contenedor)});
  const tarjetas = ${dentroDe ? `[...raiz.querySelectorAll(".ficha, .cargo, .toma, article, li, tr")].filter((t) => t.textContent.includes(${JSON.stringify(dentroDe)}))` : "[raiz]"};
  for (const t of tarjetas) {
    const b = [...t.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(texto)} && !x.disabled);
    if (b) { b.scrollIntoView({ block: "center" }); b.focus(); b.click(); return true; }
  }
  throw new Error("no encontre el boton '" + ${JSON.stringify(texto)} + "'");
})()`);

async function api(metodo, ruta, token, cuerpo) {
  const r = await fetch(GATEWAY + ruta, {
    method: metodo,
    headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: r.status, cuerpo: await r.json().catch(() => ({})) };
}

function compose(args) {
  execSync("docker compose " + args, { stdio: "ignore", cwd: path.join(__dirname, "..", "..") });
}
async function esperarSano(servicio) {
  const fin = Date.now() + 120000;
  while (Date.now() < fin) {
    try {
      if (execSync("docker inspect -f {{.State.Health.Status}} " + servicio).toString().trim() === "healthy") return;
    } catch (_) { /* todavia no existe */ }
    await dormir(2000);
  }
  throw new Error(servicio + " no quedo sano");
}

const hoy = new Date();
const fechaLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// ----------------------------- el recorrido ---------------------------------

async function principal() {
  if (!NAVEGADOR) throw new Error("No encontre Edge ni Chrome. Indique la ruta en NAVEGADOR.");
  fs.mkdirSync(SALIDA, { recursive: true });
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "capturas-asilo-"));
  const nav = spawn(NAVEGADOR, ["--headless=new", "--remote-debugging-port=" + PUERTO,
    "--user-data-dir=" + perfil, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"],
    { stdio: "ignore" });
  let lista;
  for (let i = 0; i < 80; i++) {
    try { lista = await (await fetch("http://127.0.0.1:" + PUERTO + "/json/list")).json(); if (lista.some((d) => d.type === "page")) break; }
    catch (_) { /* arrancando */ }
    await dormir(250);
  }
  cdp = await conectar(lista.find((d) => d.type === "page").webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await ventana(ANCHO, ALTO);
  // Menos movimiento: la hoja de estilos apaga el desplazamiento suave y las
  // animaciones, que si no dejan cada scroll a medio camino en la captura.
  await medios("");
  await cargar();

  // 01 · acceso, vacio
  await paso("01", () => foto("01", "acceso"));

  // 02 · primer ingreso de una cuenta nueva. rgarcia la da de alta el admin
  // por la API; si ya existe, se le restablece la clave.
  await paso("02", async () => {
    const adm = (await api("POST", "/api/auth/login", null, { usuario: "admin", clave: CLAVES.admin })).cuerpo.token;
    let r = await api("POST", "/api/usuarios", adm, { usuario: "rgarcia", nombre: "Enf. Rosa García", rol: "ENFERMERIA" });
    if (r.estado === 409) r = await api("POST", "/api/usuarios/rgarcia/restablecer", adm);
    const temporal = r.cuerpo.claveTemporal;
    if (!temporal) throw new Error("no se obtuvo la clave temporal de rgarcia (" + r.estado + ")");
    await entrar("rgarcia", temporal, `!document.getElementById("cambio-clave").hidden`);
    // A medio escribir: cumple la letra y el digito, le faltan largo y la repeticion.
    await llenar({ "cambio-actual": temporal, "cambio-nueva": "Rosa20" });
    // El foco en el campo desplaza la tarjeta; se vuelve arriba para que se vea entera.
    await ev(`document.activeElement.blur(); document.getElementById("cambio-clave").scrollTo(0, 0); true`);
    await foto("02", "cambio obligatorio, requisitos a medias");
    await salir();
  });

  // 03-05 y 29 · enfermeria
  await paso("03", async () => {
    await entrar("enfermeria");
    await ev(`document.getElementById("cambiar-mi-clave").click(); true`);
    await esperarA(`!document.getElementById("cambio-clave").hidden`, "cambio voluntario");
    await foto("03", "cambio voluntario");
    await ev(`document.getElementById("cambio-cancelar").click(); true`);
  });
  await paso("04", async () => {
    await ir("#/jornada/ASL-014", `document.querySelectorAll("#registro .toma").length > 0`, "la jornada de ASL-014");
    await foto("04", "jornada de ASL-014");
  });
  await paso("05", async () => {
    await pulsar("registro", "Registrar administración");
    await esperarA(`!document.getElementById("confirmar").hidden`, "la confirmacion");
    await foto("05", "confirmacion de una toma");
    await ev(`document.getElementById("confirmar-no").click(); true`);
  });
  await paso("29", async () => {
    await asegurar("enfermeria");
    await ir("#/jornada/ASL-014", `document.querySelectorAll("#registro .toma").length > 0`, "la jornada de ASL-014");
    await ventana(375, 812, true);
    await ev(`window.scrollTo(0, 0); true`);
    await dormir(800);
    await ev(`document.getElementById("regla").scrollIntoView({ block: "start" }); window.scrollBy(0, -140); true`);
    await foto("29", "jornada a 375 x 812");
    await ventana(ANCHO, ALTO);
  });
  await paso("salir-enfermeria", salir);

  // 06-10, 30 y 12 · medico
  await paso("06", async () => {
    await entrar("medico");
    await ir("#/jornada/ASL-014", `document.querySelectorAll("#registro .toma").length > 0`);
    await ev(`document.getElementById("abrir-cajon").click(); true`);
    await esperarA(`!document.getElementById("cajon").hidden && document.getElementById("principioActivo").options.length > 1`, "el recetario");
    await llenar({ principioActivo: "paracetamol", dosisMg: "500", cadaHoras: "8", dias: "5", indicacion: "Dolor lumbar mecánico" });
    await ev(`document.getElementById("formulario").requestSubmit(); true`);
    await esperarA(`!!document.querySelector("#dictamen.dictamen--APROBADO")`, "el dictamen APROBADO");
    await ev(`document.getElementById("dictamen").scrollIntoView({ block: "center" }); true`);
    await foto("06", "dictamen APROBADO");
  });
  await paso("07", async () => {
   try {
    await ev(`document.getElementById("cajon").scrollTo(0, 0); true`);
    await llenar({ principioActivo: "quetiapina", dosisMg: "25", cadaHoras: "12", dias: "5", indicacion: "Agitación nocturna" });
    await ev(`document.getElementById("formulario").requestSubmit(); true`);
    await esperarA(`!!document.querySelector("#dictamen.dictamen--BLOQUEADO")`, "el dictamen BLOQUEADO");
    await ev(`document.getElementById("dictamen").scrollIntoView({ block: "center" }); true`);
    await foto("07", "dictamen BLOQUEADO");
   } finally {
    // Pase lo que pase, el recetario no se queda abierto encima de lo que sigue.
    await ev(`document.getElementById("cerrar-cajon").click(); true`);
   }
  });
  await paso("08", async () => {
    await ir("#/consultas/ASL-014", `document.getElementById("lista-solicitudes").children.length > 0`, "consultas de ASL-014");
    await foto("08", "consultas y ficha medica de ASL-014");
  });
  await paso("09", async () => {
    await ev(`document.getElementById("abrir-remision").click(); true`);
    await esperarA(`!document.getElementById("cajon-remision").hidden`, "el cajon de remision");
    await llenar({
      "remision-motivo": "Episodios de desorientación y dos caídas en las últimas dos semanas. Se solicita valoración del deterioro cognitivo y ajuste del manejo.",
      "remision-especialidad": "Neurología",
      "remision-enfermero": "Enf. Lucía Cabrera",
    });
    await foto("09", "remision llena");
    await ev(`document.getElementById("formulario-remision").requestSubmit(); true`);
    await aceptarSiPregunta();
    await esperarA(`document.getElementById("cajon-remision").hidden`, "que se envie la remision");
  });
  await paso("10", async () => {
    await esperarA(`document.getElementById("lista-correos").textContent.includes("Neurolog")`, "el aviso de la remision");
    // La lista se vuelve a pintar despues de enviar la remision: se espera a
    // que se asiente, o el repintado cierra el correo recien abierto.
    await dormir(2500);
    await pulsar("lista-correos", "Ver el correo", "Neurolog");
    await esperarA(`[...document.querySelectorAll("#lista-correos .correo__cuerpo")].some((n) => !n.hidden && n.textContent.includes("Neurolog"))`, "el correo abierto");
    await ev(`[...document.querySelectorAll("#lista-correos .ficha")].find((t) => t.querySelector(".correo__cuerpo:not([hidden])")).scrollIntoView({ block: "start" }); window.scrollBy(0, -90); true`);
    await foto("10", "aviso a la familia abierto");
  });
  await paso("30", async () => {
    await ev(`window.scrollTo(0, 0); document.getElementById("abrir-clinica").click(); true`);
    await esperarA(`!document.getElementById("formulario-clinica").hidden && !!document.getElementById("clinica-farmaco-0")`, "la ficha clinica cargada");
    // Una lista desplegada de verdad la dibuja el sistema operativo y no sale
    // en la captura: se muestra abierta en la pagina, con el mismo contenido.
    await ev(`(() => { const s = document.getElementById("clinica-farmaco-0");
      s.size = 9; s.style.height = "auto"; s.closest(".campo").style.gridColumn = "1 / -1";
      s.closest(".medicacion-fija").scrollIntoView({ block: "center" }); s.focus(); return true; })()`);
    await foto("30", "informacion clinica, vademecum abierto (lista mostrada con size)");
    await ev(`document.getElementById("clinica-farmaco-0").size = 0; document.getElementById("cerrar-clinica").click(); true`);
  });
  await paso("12", async () => {
    await ir("#/consultas/ASL-014", `document.getElementById("lista-solicitudes").textContent.includes("DEMO0014")`);
    await pulsar("lista-solicitudes", "Atender", "DEMO0014");
    await aceptarSiPregunta();
    await esperarA(`!document.getElementById("cajon-visita").hidden && !document.getElementById("formulario-visita").hidden`, "el cajon de la consulta");
    await llenar({
      "visita-diagnostico": "Trastorno del sueño asociado a demencia mixta, sin signos de delirium.",
      "visita-observaciones": "Se refuerza la higiene del sueño y se suspende la siesta de la tarde. Control de cognición y revaloración en seis semanas.",
    });
    await ev(`document.getElementById("formulario-visita").requestSubmit(); true`);
    await aceptarSiPregunta();
    await dormir(800);
    await llenar({ "examen-nombre": "Electroencefalograma de rutina" });
    await ev(`document.getElementById("formulario-examen").requestSubmit(); true`);
    await aceptarSiPregunta();
    await esperarA(`document.getElementById("visita-examenes").textContent.includes("Electroencefalograma")`, "el examen agregado");
    await esperarA(`document.getElementById("indicacion-principio").options.length > 1`, "el vademecum de la receta");
    await llenar({ "indicacion-principio": "paracetamol", "indicacion-dosis": "500", "indicacion-cada": "8",
                   "indicacion-dias": "5", "indicacion-como": "Después de las comidas, con un vaso de agua." });
    await ev(`document.getElementById("formulario-indicacion").requestSubmit(); true`);
    await aceptarSiPregunta();
    await esperarA(`document.getElementById("visita-indicaciones").textContent.includes("aracetamol")`, "la receta aprobada");
    // El cajon no cabe entero en 768 px: arranca en el diagnostico, para que se
    // vean la ficha escrita, el examen y la receta.
    await ev(`(() => { const c = document.getElementById("cajon-visita");
      const f = document.getElementById("formulario-visita");
      c.scrollTop = f.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 24; return true; })()`);
    await foto("12", "consulta de DEMO0014 con examen y receta");
    await ev(`document.getElementById("cerrar-visita").click(); true`);
  });
  await paso("salir-medico", salir);

  // 11 · fundacion
  await paso("11", async () => {
    await entrar("fundacion");
    await esperarA(`document.getElementById("bandeja-agenda").textContent.includes("DEMO0007")`, "la bandeja de remisiones");
    await pulsar("bandeja-agenda", "Asignar cita", "DEMO0007");
    const manana = new Date(hoy.getTime() + 24 * 3600 * 1000);
    await ev(`(() => { const f = [...document.querySelectorAll("#bandeja-agenda .ficha")].find((t) => t.textContent.includes("DEMO0007"));
      const [medico, especialidad, cuando] = f.querySelectorAll("form input");
      medico.value = "Dr. Rolando Sicajau"; especialidad.value = "Cardiología";
      cuando.value = ${JSON.stringify(fechaLocal(manana) + "T10:30")};
      f.scrollIntoView({ block: "center" }); return true; })()`);
    await foto("11", "asignar cita a DEMO0007");
    await ev(`[...document.querySelectorAll("#bandeja-agenda .ficha")].find((t) => t.textContent.includes("DEMO0007")).querySelector("form").requestSubmit(); true`);
    await aceptarSiPregunta();
    await dormir(1200);
    await salir();
  });

  // 13 · laboratorio
  await paso("13", async () => {
    await entrar("laboratorio");
    await esperarA(`document.getElementById("bandeja-laboratorio").textContent.includes("Electroencefalograma")`, "el examen de la 12");
    await ev(`(() => { const f = [...document.querySelectorAll("#bandeja-laboratorio .ficha")].find((t) => t.textContent.includes("Electroencefalograma"));
      const i = f.querySelector("form input"); i.value = "Actividad de fondo lentificada de forma difusa, sin descargas epileptiformes.";
      f.scrollIntoView({ block: "center" }); return true; })()`);
    await foto("13", "resultado del examen escrito");
    await ev(`[...document.querySelectorAll("#bandeja-laboratorio .ficha")].find((t) => t.textContent.includes("Electroencefalograma")).querySelector("form").requestSubmit(); true`);
    await aceptarSiPregunta();
    await dormir(1200);
    await salir();
  });

  // 14 · farmacia
  await paso("14", async () => {
    await entrar("farmacia");
    await esperarA(`document.getElementById("bandeja-farmacia").textContent.includes("aracetamol")`, "el paracetamol de la 12");
    await foto("14", "medicamentos por entregar");
    await salir();
  });

  // 15-16 · medico
  await paso("15", async () => {
    await entrar("medico");
    await ir("#/consultas/ASL-022", `document.getElementById("lista-solicitudes").children.length > 0`);
    await ev(`document.getElementById("abrir-ficha").click(); true`);
    await esperarA(`!document.getElementById("cajon-ficha").hidden && document.getElementById("ficha-cuerpo").textContent.includes("Historial")`, "la ficha completa");
    await foto("15", "ficha medica completa de ASL-022");
    await ev(`document.getElementById("cerrar-ficha").click(); true`);
  });
  await paso("16", async () => {
    await ir("#/caja/ASL-022", `document.getElementById("caja-cargos").children.length > 0`, "la cuenta de ASL-022");
    await foto("16", "cuenta del interno, vista del medico");
    await salir();
  });

  // 17-22, 28, 31 y 32 · administracion
  await paso("17", async () => {
    await entrar("administracion");
    await ir("#/caja/ASL-022", `document.getElementById("caja-resumen").textContent.includes("Saldo con la fundación") && document.getElementById("caja-cargos").children.length > 0`, "la caja");
    await foto("17", "caja y donaciones");
  });
  await paso("18", async () => {
    await esperarA(`!document.getElementById("bloque-costos").hidden`, "el costo por consulta");
    await ev(`document.getElementById("bloque-costos").scrollIntoView({ block: "start" }); window.scrollBy(0, -80); true`);
    await foto("18", "costo por consulta de Bernardo Puac");
  });
  await paso("31", async () => {
    await llenar({ "fundacion-monto": "150.00", "fundacion-referencia": "Transferencia BI 0045821" });
    await ev(`document.getElementById("formulario-fundacion").scrollIntoView({ block: "end" }); window.scrollBy(0, 40); true`);
    await foto("31", "pago a la fundacion lleno");
    await ev(`document.getElementById("formulario-fundacion").reset(); true`);
  });
  await paso("32", async () => {
    await ev(`window.scrollTo(0, 0); true`);
    await pulsar("caja-cargos", "Pagar", "VM-2026-DEMO0022");
    await esperarA(`!document.getElementById("confirmar").hidden && !!document.getElementById("confirmar-campo")`, "el dialogo de pago");
    await ev(`(() => { const c = document.getElementById("confirmar-campo"); c.value = "100.00"; c.focus(); return true; })()`);
    await foto("32", "pago con abono parcial");
    await ev(`document.getElementById("confirmar-no").click(); true`);
  });
  // 34-35 · la caja y un informe en la pantalla de un telefono
  await paso("34", async () => {
    await asegurar("administracion");
    await ventana(390, 844, true);
    try {
      await ir("#/caja/ASL-022", `document.getElementById("caja-resumen").textContent.includes("Saldo con la fundación") && document.getElementById("caja-cargos").children.length > 0`, "la caja");
      await ev(`window.scrollTo(0, 0); true`);
      await foto("34", "caja a 390 x 844");
    } finally {
      await ventana(ANCHO, ALTO);
    }
  });
  await paso("35", async () => {
    await asegurar("administracion");
    await ventana(390, 844, true);
    try {
      await ir("#/reportes", `document.getElementById("reporte-cual").options.length > 0`, "reportes");
      await ev(`(() => { const s = document.getElementById("reporte-cual"); s.value = "cobros-paciente"; s.dispatchEvent(new Event("change")); return true; })()`);
      await dormir(500);
      const desde = new Date(hoy.getTime() - 30 * 24 * 3600 * 1000);
      await llenar({ "reporte-interno": "ASL-022", "reporte-desde": fechaLocal(desde), "reporte-hasta": fechaLocal(hoy) });
      await ev(`document.getElementById("formulario-reporte").requestSubmit(); true`);
      // Se espera a que se vaya el esqueleto de carga, que vive arriba de la
      // hoja: si se desplaza antes, la hoja sube despues y queda bajo la barra.
      await esperarA(`!document.getElementById("reporte-hoja").hidden && document.getElementById("reporte-titulo").textContent === "Cobros por paciente" && !document.querySelector("#vista-reportes .esqueleto")`, "el informe de cobros");
      await dormir(500);
      await ev(`document.getElementById("reporte-hoja").scrollIntoView({ block: "start" }); true`);
      await foto("35", "cobros por paciente a 390 x 844");
    } finally {
      await ventana(ANCHO, ALTO);
    }
  });
  await paso("19", async () => {
    await ir("#/reportes", `document.getElementById("reporte-cual").options.length > 0`, "reportes");
    await ev(`(() => { const s = document.getElementById("reporte-cual"); s.size = s.options.length; s.style.height = "auto"; s.focus(); return true; })()`);
    await foto("19", "selector de informe abierto (lista mostrada con size)");
    await ev(`document.getElementById("reporte-cual").size = 0; true`);
  });
  await paso("20", async () => {
    await ev(`(() => { const s = document.getElementById("reporte-cual"); s.value = "cobros-paciente"; s.dispatchEvent(new Event("change")); return true; })()`);
    await dormir(500);
    const desde = new Date(hoy.getTime() - 30 * 24 * 3600 * 1000);
    await llenar({ "reporte-interno": "ASL-022", "reporte-desde": fechaLocal(desde), "reporte-hasta": fechaLocal(hoy) });
    await ev(`document.getElementById("formulario-reporte").requestSubmit(); true`);
    await esperarA(`!document.getElementById("reporte-hoja").hidden && document.getElementById("reporte-titulo").textContent === "Cobros por paciente"`, "el informe de cobros");
    await ev(`document.getElementById("reporte-hoja").scrollIntoView({ block: "start" }); window.scrollBy(0, -80); true`);
    await foto("20", "cobros por paciente en pantalla");
  });
  await paso("21", async () => {
    await medios("print");
    await ev(`window.scrollTo(0, 0); true`);
    await foto("21", "cobros por paciente impreso (emulando print)");
    await medios("");
  });
  await paso("22", async () => {
    await ev(`(() => { const s = document.getElementById("reporte-cual"); s.value = "citas-pendientes"; s.dispatchEvent(new Event("change")); return true; })()`);
    await dormir(500);
    await ev(`document.getElementById("formulario-reporte").requestSubmit(); true`);
    await esperarA(`!document.getElementById("reporte-hoja").hidden && document.getElementById("reporte-titulo").textContent === "Citas con saldo pendiente"`, "el informe de citas");
    await ev(`document.getElementById("reporte-hoja").scrollIntoView({ block: "start" }); window.scrollBy(0, -80); true`);
    await foto("22", "citas con saldo pendiente, sin filtros");
  });
  await paso("28", async () => {
    compose("stop ms-caja");
    try {
      await ir("#/reportes");
      await ir("#/caja/ASL-022", `[...document.querySelectorAll("#vista-caja .problema button")].some((b) => b.textContent === "Reintentar")`, "el error con Reintentar");
      await foto("28", "ms-caja detenido: error con Reintentar");
    } finally {
      compose("start ms-caja");
      await esperarSano("ms-caja");
    }
    await salir();
  });

  // 23-27 · admin
  await paso("23", async () => {
    await entrar("admin");
    await ir("#/padron", `document.querySelectorAll("#padron-lista tbody tr").length > 0`, "el padron");
    await foto("23", "padron de internos");
  });
  await paso("24", async () => {
    await ev(`document.getElementById("abrir-alta").click(); true`);
    await esperarA(`!document.getElementById("cajon-interno").hidden`, "el alta de interno");
    await llenar({
      "interno-nombre": "Eulalia Choc Tzul", "interno-documento": "2741589630901",
      "interno-nacimiento": "1944-08-15", "interno-sexo": "FEMENINO", "interno-ingreso": fechaLocal(hoy),
      "interno-pabellon": "Pabellón A", "interno-cama": "5",
      "interno-motivo": "Hipertensión y diabetes con dificultad para el autocuidado; vive sola.",
      "interno-responsable": "Marta Choc, hija", "interno-correo": "marta.choc@ejemplo.gt",
    });
    await foto("24", "alta de interno llena, sin guardar");
    await ev(`document.getElementById("cerrar-interno").click(); true`);
  });
  await paso("25", async () => {
    await ir("#/usuarios", `document.getElementById("usuarios-lista").textContent.includes("rgarcia")`, "las cuentas");
    await foto("25", "cuentas del personal con rgarcia");
  });
  await paso("26", async () => {
    await ev(`document.getElementById("abrir-alta-usuario").click(); true`);
    await esperarA(`!document.getElementById("cajon-usuario").hidden`, "el alta de cuenta");
    await llenar({ "usuario-usuario": "jlopez", "usuario-nombre": "Lic. Julio López", "usuario-rol": "ADMINISTRACION" });
    await foto("26", "alta de cuenta llena");
  });
  await paso("27", async () => {
    await ev(`document.getElementById("formulario-usuario").requestSubmit(); true`);
    await esperarA(`!document.getElementById("cuadro-clave").hidden && document.getElementById("clave-valor").textContent.length === 10`, "la clave temporal");
    await foto("27", "clave temporal de jlopez");
    await ev(`document.getElementById("clave-cerrar").click(); true`);
    await salir();
  });

  cdp.cerrar();
  nav.kill();
  try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (_) { /* Windows lo suelta despues */ }
  console.log(resultado.join("\n"));
  const fallas = resultado.filter((l) => l.startsWith("FALLA")).length;
  console.log(fallas ? fallas + " paso(s) fallaron." : "Capturas guardadas en " + SALIDA);
  process.exit(fallas ? 1 : 0);
}

principal().catch((e) => { console.log(resultado.join("\n")); console.error(e); process.exit(1); });
