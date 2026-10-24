// ---------------------------------------------------------------------------
// Auditoria de la interfaz en pantalla de telefono.
//
// Recorre todas las vistas de los siete roles, los cajones, los dialogos de
// confirmacion, el cuadro de la clave temporal, «Elija su clave» y los ocho
// informes, a 360 x 800 y a 390 x 844, con escala 3 y emulacion tactil. En
// cada pantalla mide, desde el navegador:
//
//   desborde   la pagina se desplaza a lo ancho (scrollWidth > innerWidth)
//   se-sale    elementos que pasan el borde de la pantalla, con su selector
//   letra      texto de menos de 12 px
//   toque      botones o enlaces de menos de 40 x 40 px
//   zoom       campos con letra de menos de 16 px, que iOS amplia al enfocar
//   tapado     elementos debajo de la barra superior o de la de servicios
//
// No sirve el DOM minimo de pruebas-interfaz/: ese DOM no tiene motor de
// diseño, y scrollWidth o getBoundingClientRect darian cero. Por eso este
// guion maneja un Edge de verdad, igual que capturar.js y sin dependencias:
// solo Node 22.
//
// Se corre desde la raiz del proyecto con el stack local levantado. Escribe
// datos (atiende una consulta, crea y restablece la cuenta rgarcia): despues,
// "docker compose down -v && docker compose up -d".
//
//     node docs/manual/auditar-telefono.js
//
// Variables opcionales: NAVEGADOR, WEB (http://localhost:8090), GATEWAY
// (http://localhost:8080), SALIDA (carpeta de capturas e informe; por
// defecto una carpeta temporal), TAMANOS ("360x800,390x844") y SOLO, con
// nombres de pantalla separados por coma.
//
// Termina con codigo 1 si queda algun hallazgo que no este en EXCEPCIONES.
// ---------------------------------------------------------------------------
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WEB = process.env.WEB || "http://localhost:8090";
const GATEWAY = process.env.GATEWAY || "http://localhost:8080";
const SALIDA = process.env.SALIDA || path.join(os.tmpdir(), "auditoria-telefono");
const TAMANOS = (process.env.TAMANOS || "360x800,390x844").split(",").map((t) => t.split("x").map(Number));
const SOLO = process.env.SOLO ? process.env.SOLO.split(",").map((x) => x.trim()) : null;
const PUERTO = 9342;
const ESCALA = 3;
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

// Hallazgos aceptados a conciencia. Se informan, pero no hacen fallar la
// auditoria. Valen solo para un elemento que se desplaza dentro de su propia
// franja: si el mismo elemento quedara recortado o empujara la pagina,
// cuenta como cualquier otro.
const EXCEPCIONES = [
  { selector: /^#lista-internos > li/,
    motivo: "la tira de internos se desplaza a lo largo en su propia franja, a proposito" },
  { selector: /^(#barra-servicios|#barra > span\.barra__grupo)/,
    motivo: "la barra de servicios se desplaza en un solo renglon: su alto esta reservado y no puede crecer" },
  { selector: /^#pestana-/,
    motivo: "las pestañas se desplazan dentro de su franja, como pide el bloque 14" },
];
const excepcion = (h) => h.tipo === "se-sale" && h.detalle.includes("se desplaza dentro de") &&
  (EXCEPCIONES.find((e) => e.selector.test(h.selector)) || {}).motivo;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function esperarA(expr, descripcion, ms) {
  const fin = Date.now() + (ms || 15000);
  while (Date.now() < fin) {
    try { if (await ev(expr)) return; } catch (_) { /* la pagina todavia carga */ }
    await dormir(150);
  }
  throw new Error("no se cumplio a tiempo: " + descripcion);
}

async function telefono(ancho, alto) {
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: ancho, height: alto, deviceScaleFactor: ESCALA, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setEmulatedMedia",
    { media: "", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
}

// ----------------------------- la estacion ----------------------------------

async function cargar() {
  await cdp.send("Page.navigate", { url: WEB + "/" });
  await esperarA(`document.readyState === "complete" && !!document.getElementById("acceso-usuario")`, "la pagina de acceso");
  await dormir(1000);
}
async function entrar(usuario, clave, aDondeLlega) {
  await ev(`(() => { document.getElementById("acceso-usuario").value = ${JSON.stringify(usuario)};
    document.getElementById("acceso-clave").value = ${JSON.stringify(clave || CLAVES[usuario])};
    document.getElementById("formulario-acceso").requestSubmit(); return true; })()`);
  await esperarA(aDondeLlega || `!document.getElementById("armazon").hidden`, "entrar como " + usuario);
  await dormir(1200);
}
async function salir() {
  await ev(`document.getElementById("cambio-clave").hidden ? document.getElementById("cerrar-sesion").click()
            : document.getElementById("cambio-salir").click(); true`);
  await esperarA(`!document.getElementById("acceso").hidden`, "volver al acceso");
  await dormir(400);
}
async function ir(hash, listo, descripcion) {
  await ev(`location.hash = ${JSON.stringify(hash)}; window.scrollTo(0, 0); true`);
  if (listo) await esperarA(listo, descripcion || hash);
  await dormir(700);
}
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
async function aceptarSiPregunta() {
  await dormir(400);
  if (await ev(`!document.getElementById("confirmar").hidden`)) {
    await ev(`document.getElementById("confirmar-si").click(); true`);
    await dormir(800);
  }
}
const pulsar = (contenedor, texto, dentroDe) => ev(`(() => {
  const raiz = document.getElementById(${JSON.stringify(contenedor)});
  const tarjetas = ${dentroDe ? `[...raiz.querySelectorAll(".ficha, .cargo, .toma, article, li, tr")].filter((t) => t.textContent.includes(${JSON.stringify(dentroDe)}))` : "[raiz]"};
  for (const t of tarjetas) {
    const b = [...t.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(texto)} && !x.disabled);
    if (b) { b.scrollIntoView({ block: "center" }); b.click(); return true; }
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
const fechaLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Genera un informe con los filtros que pida: el interno ASL-022 si lo hay,
// la primera consulta y los ultimos 30 dias. Los filtros opcionales quedan
// vacios.
async function informe(clave, interno) {
  await ir("#/reportes", `document.getElementById("reporte-cual").options.length > 0`, "reportes");
  await ev(`(() => { const s = document.getElementById("reporte-cual"); s.value = ${JSON.stringify(clave)};
    s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await dormir(500);
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 30 * 24 * 3600 * 1000);
  await ev(`(() => {
    const visible = (id) => !document.getElementById(id).hidden;
    const opcional = ${JSON.stringify(clave === "citas-pendientes")};
    if (visible("campo-reporte-interno") && !opcional) {
      const s = document.getElementById("reporte-interno");
      const op = [...s.options].find((o) => o.value === ${JSON.stringify(interno || "ASL-022")}) || [...s.options].find((o) => o.value);
      s.value = op.value; s.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (visible("campo-reporte-desde") && !opcional) {
      document.getElementById("reporte-desde").value = ${JSON.stringify(fechaLocal(desde))};
      document.getElementById("reporte-hasta").value = ${JSON.stringify(fechaLocal(hoy))};
    }
    return true; })()`);
  if (await ev(`!document.getElementById("campo-reporte-visita").hidden`)) {
    await esperarA(`[...document.getElementById("reporte-visita").options].some((o) => o.value)`, "las consultas del interno");
    await ev(`(() => { const s = document.getElementById("reporte-visita");
      s.value = [...s.options].find((o) => o.value).value; return true; })()`);
  }
  await ev(`document.getElementById("formulario-reporte").requestSubmit(); true`);
  await esperarA(`!document.getElementById("reporte-hoja").hidden && !document.querySelector("#reporte-cuerpo .esqueleto") && document.getElementById("reporte-cuerpo").children.length > 0`, "el informe " + clave, 20000);
  await ev(`document.getElementById("reporte-hoja").scrollIntoView({ block: "start" }); true`);
  await dormir(600);
}

// ----------------------------- la medicion ----------------------------------

// Corre dentro de la pagina. Si hay un cajon o un dialogo abierto, se mide
// solo esa capa: lo de atras esta bajo el velo y no se puede tocar.
const MEDIR = `(() => {
  const W = innerWidth;
  const hallazgos = [];
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  // Oculto a la vista pero no a los lectores de pantalla: el patron de
  // .visualmente-oculto (recortado con clip), que tambien usa el encabezado
  // de las tablas hechas tarjeta.
  const oculto = (el) => {
    if (el.closest(".visualmente-oculto, [hidden]")) return true;
    for (let p = el; p && p !== document.body; p = p.parentElement)
      if (getComputedStyle(p).clip === "rect(0px, 0px, 0px, 0px)") return true;
    return false;
  };
  const sel = (el) => {
    const parte = (n) => n.id ? "#" + n.id
      : n.tagName.toLowerCase() + [...n.classList].slice(0, 2).map((c) => "." + c).join("");
    const trozos = [parte(el)];
    let p = el.parentElement;
    while (p && !el.id && trozos.length < 3 && p !== document.body) {
      trozos.unshift(parte(p));
      if (p.id) break;
      p = p.parentElement;
    }
    return trozos.join(" > ");
  };
  const capas = [...document.querySelectorAll(".acceso, .cajon, .confirmar")]
    .filter((n) => !n.hidden && vis(n))
    .sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0));
  const raiz = capas[0] || document.body;
  const todos = [...raiz.querySelectorAll("*")].filter((n) => !oculto(n) && vis(n));

  // 1. Desborde de la pagina.
  const sw = document.documentElement.scrollWidth;
  if (sw > W) hallazgos.push({ tipo: "desborde", selector: "html", detalle: "scrollWidth " + sw + " > innerWidth " + W });

  // 2. Lo que pasa el borde de la pantalla. Se dice donde termina: si un
  //    contenedor lo recorta (overflow hidden), no se ve ni se alcanza; si
  //    va dentro de una franja con su propio desplazamiento, no empuja la
  //    pagina, pero se informa igual para que quede justificado.
  const contenedor = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll") return { como: "franja", p };
      if (ox === "hidden" || ox === "clip") return { como: "recorte", p };
    }
    return null;
  };
  const pasa = (el) => { const r = el.getBoundingClientRect(); return r.right > W + 0.5 || r.left < -0.5; };
  for (const el of todos) {
    if (!pasa(el)) continue;
    // Solo el primero de la cadena: donde empieza a salirse.
    if (el.parentElement && raiz.contains(el.parentElement) && pasa(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    const c = contenedor(el);
    const dentro = c && c.p.getBoundingClientRect().right <= W + 0.5 && c.p.getBoundingClientRect().left >= -0.5;
    hallazgos.push({ tipo: "se-sale", selector: sel(el),
      detalle: "de " + Math.round(r.left) + " a " + Math.round(r.right) + " px" +
        (dentro ? (c.como === "recorte" ? " · RECORTADO por " : " · se desplaza dentro de ") + sel(c.p) : "") });
  }

  // 3. Letra de menos de 12 px, en lo que tiene texto propio.
  for (const el of todos) {
    const propio = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    if (!propio) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) hallazgos.push({ tipo: "letra", selector: sel(el), detalle: fs + " px · «" + el.textContent.trim().slice(0, 30) + "»" });
  }

  // 4. Botones y enlaces de menos de 40 x 40.
  for (const el of todos.filter((n) => n.matches("button, a[href], [role=tab], summary, input[type=checkbox], input[type=radio]"))) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40)
      hallazgos.push({ tipo: "toque", selector: sel(el), detalle: Math.round(r.width) + " x " + Math.round(r.height) + " · «" + (el.textContent.trim() || el.getAttribute("aria-label") || "").slice(0, 24) + "»" });
  }

  // 5. Campos que iOS amplia al enfocarlos.
  for (const el of todos.filter((n) => n.matches("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), select, textarea"))) {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) hallazgos.push({ tipo: "zoom", selector: sel(el), detalle: fs + " px" });
  }

  // 6. Tapado por una barra. Cada control se trae a la vista como lo haria
  //    el foco al tabular o al tocar el siguiente campo (scrollIntoView
  //    respeta scroll-padding, igual que el foco), y se mira si su centro cae
  //    debajo de la barra superior o de la de servicios.
  const barras = ".superior, .barra";
  const H = innerHeight;
  const x0 = scrollX, y0 = scrollY;
  for (const el of todos.filter((n) => n.matches("button, a[href], input, select, textarea"))) {
    if (el.closest(barras)) continue;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cx > W || cy < 0 || cy > H) continue;
    const arriba = document.elementFromPoint(cx, cy);
    if (arriba && arriba.closest(barras) && !el.contains(arriba))
      hallazgos.push({ tipo: "tapado", selector: sel(el), detalle: "al traerlo a la vista queda bajo " + sel(arriba.closest(barras)) });
  }
  window.scrollTo({ left: x0, top: y0, behavior: "instant" });
  return hallazgos;
})()`;

async function medir() {
  await ev(`document.getElementById("avisos").textContent = ""; true`);
  await ev(`window.scrollTo(0, 0); true`);
  await dormir(150);
  const todos = await ev(MEDIR);
  await ev(`(() => { window.scrollTo(0, 0); for (const c of document.querySelectorAll(".cajon:not([hidden])")) c.scrollTop = 0; return true; })()`);
  // Sin repetidos: una celda que se repite en cada fila es un solo hallazgo.
  const vistos = new Map();
  for (const h of todos) {
    const k = h.tipo + "|" + h.selector;
    if (vistos.has(k)) vistos.get(k).veces++;
    else vistos.set(k, Object.assign({ veces: 1 }, h));
  }
  return [...vistos.values()];
}

async function foto(archivo, paginaEntera) {
  await dormir(300);
  const params = { format: "png" };
  if (paginaEntera) {
    const alto = Math.min(await ev(`document.documentElement.scrollHeight`), 5000);
    const ancho = await ev(`innerWidth`);
    Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: ancho, height: alto, scale: 1 } });
  }
  const r = await cdp.send("Page.captureScreenshot", params);
  fs.writeFileSync(archivo, Buffer.from(r.data, "base64"));
}

// ----------------------------- el recorrido ---------------------------------

// Cada pantalla: quien entra, como se llega y si la foto va de pagina entera
// (las vistas) o solo de la ventana (cajones y dialogos, que no desplazan la
// pagina).
function pantallas(temporal) {
  const abrir = (boton, cajon) => async () => {
    await ev(`window.scrollTo(0, 0); document.getElementById(${JSON.stringify(boton)}).click(); true`);
    await esperarA(`!document.getElementById(${JSON.stringify(cajon)}).hidden`, cajon);
    await dormir(900);
  };
  const cerrar = (boton) => () => ev(`document.getElementById(${JSON.stringify(boton)}).click(); true`);
  const confirmarNo = () => ev(`document.getElementById("confirmar-no").click(); true`);
  return [
    { nombre: "acceso", rol: null, entera: false, llegar: async () => {} },
    { nombre: "elija-su-clave", rol: "rgarcia", entera: true, llegar: async () => {} },

    { nombre: "enfermeria-jornada", rol: "enfermeria", entera: true,
      llegar: () => ir("#/jornada/ASL-014", `document.querySelectorAll("#registro .toma").length > 0`) },
    { nombre: "enfermeria-confirmar-toma", rol: "enfermeria", entera: false,
      llegar: async () => {
        await pulsar("registro", "Registrar administración");
        await esperarA(`!document.getElementById("confirmar").hidden`, "la confirmacion");
      }, despues: confirmarNo },
    { nombre: "enfermeria-cambiar-mi-clave", rol: "enfermeria", entera: false,
      llegar: async () => {
        await ev(`window.scrollTo(0, 0); document.getElementById("cambiar-mi-clave").click(); true`);
        await esperarA(`!document.getElementById("cambio-clave").hidden`, "cambio voluntario");
      }, despues: cerrar("cambio-cancelar") },
    { nombre: "enfermeria-consultas", rol: "enfermeria", entera: true,
      llegar: () => ir("#/consultas/ASL-014", `document.getElementById("lista-solicitudes").children.length > 0`) },
    { nombre: "enfermeria-reportes", rol: "enfermeria", entera: true,
      llegar: () => ir("#/reportes", `document.getElementById("reporte-cual").options.length > 0`) },
    { nombre: "informe-medicamentos", rol: "enfermeria", entera: true, llegar: () => informe("medicamentos", "ASL-014") },

    { nombre: "medico-jornada", rol: "medico", entera: true,
      llegar: () => ir("#/jornada/ASL-014", `document.querySelectorAll("#registro .toma").length > 0`) },
    { nombre: "medico-cajon-recetario", rol: "medico", entera: false,
      llegar: async () => {
        await abrir("abrir-cajon", "cajon")();
        await esperarA(`document.getElementById("principioActivo").options.length > 1`, "el vademecum");
        await llenar({ principioActivo: "quetiapina", dosisMg: "25", cadaHoras: "12", dias: "5", indicacion: "Agitación nocturna" });
        await ev(`document.getElementById("formulario").requestSubmit(); true`);
        await esperarA(`!!document.querySelector("#dictamen.dictamen--BLOQUEADO")`, "el dictamen BLOQUEADO");
        await ev(`document.getElementById("dictamen").scrollIntoView({ block: "start" }); true`);
      }, despues: cerrar("cerrar-cajon") },
    { nombre: "medico-consultas", rol: "medico", entera: true,
      llegar: () => ir("#/consultas/ASL-014", `document.getElementById("lista-solicitudes").children.length > 0`) },
    { nombre: "medico-cajon-remision", rol: "medico", entera: false,
      llegar: abrir("abrir-remision", "cajon-remision"), despues: cerrar("cerrar-remision") },
    { nombre: "medico-cajon-clinica", rol: "medico", entera: false,
      llegar: async () => {
        await abrir("abrir-clinica", "cajon-clinica")();
        await esperarA(`!document.getElementById("formulario-clinica").hidden`, "la ficha clinica");
      }, despues: cerrar("cerrar-clinica") },
    { nombre: "medico-cajon-ficha", rol: "medico", entera: false,
      llegar: async () => {
        await ir("#/consultas/ASL-022", `document.getElementById("lista-solicitudes").children.length > 0`);
        await abrir("abrir-ficha", "cajon-ficha")();
        await esperarA(`document.getElementById("ficha-cuerpo").textContent.includes("Historial")`, "la ficha completa");
      }, despues: cerrar("cerrar-ficha") },
    { nombre: "medico-cajon-consulta", rol: "medico", entera: false,
      llegar: async () => {
        await ir("#/consultas/ASL-014", `document.getElementById("lista-solicitudes").children.length > 0`);
        const seguir = await ev(`(() => { const b = [...document.querySelectorAll("#vista-consultas button")]
          .find((x) => x.textContent.trim() === "Continuar la consulta"); if (b) { b.click(); return true; } return false; })()`);
        if (!seguir) { await pulsar("lista-solicitudes", "Atender", "DEMO0014"); await aceptarSiPregunta(); }
        await esperarA(`!document.getElementById("cajon-visita").hidden`, "el cajon de la consulta");
        await dormir(900);
      }, despues: cerrar("cerrar-visita") },
    { nombre: "medico-cuenta", rol: "medico", entera: true,
      llegar: () => ir("#/caja/ASL-022", `document.getElementById("caja-cargos").children.length > 0`) },
    { nombre: "informe-analisis-medicos", rol: "medico", entera: true, llegar: () => informe("analisis-medicos") },
    { nombre: "informe-examenes", rol: "medico", entera: true, llegar: () => informe("examenes") },

    { nombre: "administracion-caja", rol: "administracion", entera: true,
      llegar: () => ir("#/caja/ASL-022", `document.getElementById("caja-resumen").textContent.includes("Saldo con la fundación") && document.getElementById("caja-cargos").children.length > 0`) },
    { nombre: "administracion-confirmar-pago", rol: "administracion", entera: false,
      llegar: async () => {
        await pulsar("caja-cargos", "Pagar", "VM-2026-DEMO0022");
        await esperarA(`!document.getElementById("confirmar").hidden && !!document.getElementById("confirmar-campo")`, "el dialogo de pago");
      }, despues: confirmarNo },
    { nombre: "administracion-reportes", rol: "administracion", entera: true,
      llegar: () => ir("#/reportes", `document.getElementById("reporte-cual").options.length > 0`) },
    { nombre: "informe-costos-cita", rol: "administracion", entera: true, llegar: () => informe("costos-cita") },
    { nombre: "informe-cobros-paciente", rol: "administracion", entera: true, llegar: () => informe("cobros-paciente") },
    { nombre: "informe-pagos-fundacion", rol: "administracion", entera: true, llegar: () => informe("pagos-fundacion") },
    { nombre: "informe-entradas", rol: "administracion", entera: true, llegar: () => informe("entradas") },
    { nombre: "informe-citas-pendientes", rol: "administracion", entera: true, llegar: () => informe("citas-pendientes") },

    { nombre: "admin-padron", rol: "admin", entera: true,
      llegar: () => ir("#/padron", `document.querySelectorAll("#padron-lista tbody tr").length > 0`) },
    { nombre: "admin-cajon-alta-interno", rol: "admin", entera: false,
      llegar: abrir("abrir-alta", "cajon-interno"), despues: cerrar("cerrar-interno") },
    { nombre: "admin-cajon-egreso", rol: "admin", entera: false,
      llegar: async () => {
        await pulsar("padron-lista", "Egresar", "ASL-007");
        await esperarA(`!document.getElementById("cajon-egreso").hidden`, "el egreso");
        await dormir(700);
      }, despues: cerrar("cerrar-egreso") },
    { nombre: "admin-usuarios", rol: "admin", entera: true,
      llegar: () => ir("#/usuarios", `document.getElementById("usuarios-lista").textContent.includes("rgarcia")`) },
    { nombre: "admin-cajon-alta-cuenta", rol: "admin", entera: false,
      llegar: abrir("abrir-alta-usuario", "cajon-usuario"), despues: cerrar("cerrar-usuario") },
    { nombre: "admin-cajon-desactivar", rol: "admin", entera: false,
      llegar: async () => {
        await pulsar("usuarios-lista", "Desactivar", "rgarcia");
        await esperarA(`!document.getElementById("cajon-desactivar").hidden`, "desactivar");
        await dormir(700);
      }, despues: cerrar("cerrar-desactivar") },
    { nombre: "admin-cajon-bitacora", rol: "admin", entera: false,
      llegar: async () => {
        await pulsar("usuarios-lista", "Ver bitácora", "rgarcia");
        await esperarA(`!document.getElementById("cajon-bitacora").hidden && !!document.querySelector("#bitacora-lista table")`, "la bitacora");
        await dormir(700);
      }, despues: cerrar("cerrar-bitacora") },
    { nombre: "admin-confirmar-restablecer", rol: "admin", entera: false,
      llegar: async () => {
        await pulsar("usuarios-lista", "Restablecer clave", "rgarcia");
        await esperarA(`!document.getElementById("confirmar").hidden`, "la confirmacion de restablecer");
      } },
    { nombre: "admin-clave-temporal", rol: "admin", entera: false,
      llegar: async () => {
        await ev(`document.getElementById("confirmar-si").click(); true`);
        await esperarA(`!document.getElementById("cuadro-clave").hidden && document.getElementById("clave-valor").textContent.length === 10`, "la clave temporal");
      }, despues: cerrar("clave-cerrar") },

    { nombre: "fundacion-agenda", rol: "fundacion", entera: true,
      llegar: () => esperarA(`document.getElementById("bandeja-agenda").children.length > 0`, "la bandeja") },
    { nombre: "fundacion-asignar-cita", rol: "fundacion", entera: true,
      llegar: async () => {
        await pulsar("bandeja-agenda", "Asignar cita", "DEMO0007");
        await dormir(600);
      } },
    { nombre: "laboratorio-bandeja", rol: "laboratorio", entera: true,
      llegar: () => esperarA(`document.getElementById("bandeja-laboratorio").children.length > 0`, "la bandeja") },
    { nombre: "farmacia-bandeja", rol: "farmacia", entera: true,
      llegar: () => esperarA(`document.getElementById("bandeja-farmacia").children.length > 0`, "la bandeja") },
  ];
}

async function principal() {
  if (!NAVEGADOR) throw new Error("No encontre Edge ni Chrome. Indique la ruta en NAVEGADOR.");
  fs.mkdirSync(SALIDA, { recursive: true });

  // La pantalla «Elija su clave» necesita una cuenta con clave temporal. Se
  // pide una nueva en cada tamaño: el recorrido del admin la restablece.
  async function claveTemporal() {
    const adm = (await api("POST", "/api/auth/login", null, { usuario: "admin", clave: CLAVES.admin })).cuerpo.token;
    if (!adm) throw new Error("no se pudo entrar como admin por la API");
    let r = await api("POST", "/api/usuarios", adm, { usuario: "rgarcia", nombre: "Enf. Rosa García", rol: "ENFERMERIA" });
    if (r.estado === 409) r = await api("POST", "/api/usuarios/rgarcia/restablecer", adm);
    if (!r.cuerpo.claveTemporal) throw new Error("no se obtuvo la clave temporal de rgarcia (" + r.estado + ")");
    return r.cuerpo.claveTemporal;
  }

  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "auditoria-telefono-"));
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

  const informeFinal = [];
  let pendientes = 0;
  for (const [ancho, alto] of TAMANOS) {
    const temporal = await claveTemporal();
    await telefono(ancho, alto);
    await cargar();
    let sesion = null;
    for (const p of pantallas(temporal)) {
      if (SOLO && !SOLO.includes(p.nombre)) continue;
      const etiqueta = p.nombre + " @" + ancho;
      try {
        if (sesion !== p.rol) {
          if (sesion) await salir();
          sesion = p.rol;
          if (p.rol === "rgarcia") await entrar("rgarcia", temporal, `!document.getElementById("cambio-clave").hidden`);
          else if (p.rol) await entrar(p.rol);
        }
        await p.llegar();
        const hallazgos = await medir();
        await foto(path.join(SALIDA, ancho + "-" + p.nombre + ".png"), p.entera);
        if (p.despues) { await p.despues(); await dormir(400); }
        const reales = hallazgos.filter((h) => !excepcion(h));
        pendientes += reales.length;
        informeFinal.push({ pantalla: p.nombre, ancho, hallazgos });
        console.log((reales.length ? "PROBLEMAS " : "OK        ") + etiqueta + (reales.length ? "  (" + reales.length + ")" : ""));
        for (const h of hallazgos) {
          const ex = excepcion(h);
          console.log("    " + (ex ? "excepcion " : "") + h.tipo.padEnd(9) + h.selector +
            (h.veces > 1 ? "  x" + h.veces : "") + "  · " + h.detalle + (ex ? "  · " + ex : ""));
        }
      } catch (e) {
        pendientes++;
        informeFinal.push({ pantalla: p.nombre, ancho, error: e.message });
        console.log("FALLA     " + etiqueta + "  " + e.message.split("\n")[0]);
        // Se vuelve a un estado conocido: pagina recargada y sin sesion.
        await cargar();
        await ev(`localStorage.clear(); sessionStorage.clear(); true`).catch(() => {});
        await cargar();
        sesion = null;
      }
    }
    if (sesion) await salir().catch(() => {});
  }

  fs.writeFileSync(path.join(SALIDA, "auditoria.json"), JSON.stringify(informeFinal, null, 2));
  cdp.cerrar();
  nav.kill();
  try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (_) { /* Windows lo suelta despues */ }
  console.log("\n" + (pendientes ? pendientes + " hallazgo(s) sin resolver." : "Sin hallazgos.") +
    " Capturas e informe en " + SALIDA);
  process.exit(pendientes ? 1 : 0);
}

principal().catch((e) => { console.error(e); process.exit(1); });
