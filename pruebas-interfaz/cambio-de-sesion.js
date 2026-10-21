// ---------------------------------------------------------------------------
// Recorrido de interfaz: lo que un usuario deja en pantalla no lo hereda el
// siguiente.
//
// Carga el index.html y el app.js QUE SIRVE estacion-web —no los del disco—
// en un DOM minimo escrito aqui mismo, y maneja la estacion como lo haria una
// persona: escribe usuario y clave, cambia de pestaña, genera un informe,
// cierra sesion. Las peticiones van al gateway de verdad.
//
// No usa jsdom ni un navegador a proposito: meterlos obligaria a traer
// node_modules a un proyecto cuyo unico requisito es Docker. El DOM de abajo
// cubre solo lo que app.js usa; si app.js empieza a usar algo que no esta, el
// recorrido falla en vez de pasar en falso.
//
// Recorre tambien las cuentas del personal: la clave temporal que ve el
// administrador no le queda al siguiente, y quien entra con ella cae en la
// pantalla de cambio de clave, tambien si recarga la pagina.
//
// Lo corre pruebas.sh. Imprime una linea por comprobacion, "si" o "no", un
// tabulador y la descripcion; y al final "FIN" si llego hasta el final.
// ---------------------------------------------------------------------------
"use strict";
const vm = require("vm");

const WEB = process.env.WEB || "http://localhost:8090";
const GATEWAY = process.env.GATEWAY || "http://localhost:8080";

// ----------------------------- DOM minimo ----------------------------------

const VACIOS = new Set(["input", "br", "img", "meta", "link", "hr", "source", "wbr"]);

function aCamello(nombre) {
  return nombre.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
}

class Nodo {
  constructor(etiqueta) {
    this.tagName = etiqueta.toUpperCase();
    this.hijos = [];
    this.padre = null;
    this.atributos = {};
    this.escuchas = {};
    this.dataset = {};
    this.style = {};
    this.id = "";
    this.type = "";
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.placeholder = "";
    this.title = "";
    this._clases = new Set();
    this._valor = undefined;
  }

  get className() { return [...this._clases].join(" "); }
  set className(v) { this._clases = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const c = this._clases;
    return {
      add: (...n) => n.forEach((x) => c.add(x)),
      remove: (...n) => n.forEach((x) => c.delete(x)),
      contains: (n) => c.has(n),
      toggle: (n, forzar) => {
        const poner = forzar === undefined ? !c.has(n) : !!forzar;
        if (poner) c.add(n); else c.delete(n);
        return poner;
      },
    };
  }

  get textContent() {
    return this.hijos.map((h) => (typeof h === "string" ? h : h.textContent)).join("");
  }
  set textContent(v) {
    // Como en el navegador: al rehacer las opciones de un select vuelve a
    // quedar elegida la primera.
    if (this.tagName === "SELECT") this._valor = undefined;
    for (const h of this.hijos) if (typeof h !== "string") h.padre = null;
    this.hijos = v === "" || v == null ? [] : [String(v)];
  }

  appendChild(n) {
    if (n.esFragmento) {
      for (const h of n.hijos.slice()) this.appendChild(h);
      n.hijos = [];
      return n;
    }
    if (n.padre) n.remove();
    n.padre = this;
    this.hijos.push(n);
    return n;
  }
  append(...nodos) {
    for (const n of nodos) {
      if (typeof n === "string") this.hijos.push(n);
      else this.appendChild(n);
    }
  }
  remove() {
    if (!this.padre) return;
    this.padre.hijos = this.padre.hijos.filter((h) => h !== this);
    this.padre = null;
  }

  setAttribute(k, v) {
    this.atributos[k] = String(v);
    if (k === "id") this.id = String(v);
    if (k === "class") this.className = v;
    if (k === "hidden") this.hidden = true;
  }
  getAttribute(k) { return k in this.atributos ? this.atributos[k] : null; }
  removeAttribute(k) {
    delete this.atributos[k];
    if (k === "hidden") this.hidden = false;
  }

  addEventListener(tipo, f) { (this.escuchas[tipo] = this.escuchas[tipo] || []).push(f); }
  removeEventListener(tipo, f) {
    this.escuchas[tipo] = (this.escuchas[tipo] || []).filter((g) => g !== f);
  }
  disparar(tipo, extra) {
    const evento = Object.assign({
      type: tipo, target: this, currentTarget: this,
      preventDefault() { }, stopPropagation() { },
    }, extra);
    for (const f of (this.escuchas[tipo] || []).slice()) f(evento);
  }
  click() { if (!this.disabled) this.disparar("click"); }
  requestSubmit() { this.disparar("submit"); }
  focus() { documento.activeElement = this; }
  blur() { }
  select() { }
  scrollIntoView() { }
  get offsetParent() { return this.hidden ? null : this.padre; }

  get options() { return this.descendientes().filter((n) => n.tagName === "OPTION"); }
  get value() {
    if (this.tagName === "SELECT") {
      // null: se le asigno un valor sin opcion que coincida, y el navegador
      // lo deja sin nada elegido (selectedIndex -1, value "").
      if (this._valor === null) return "";
      const opciones = this.options;
      const elegida = opciones.find((o) => o.value === this._valor);
      return elegida ? elegida.value : (opciones[0] ? opciones[0].value : "");
    }
    if (this._valor !== undefined) return this._valor;
    if (this.atributos.value !== undefined) return this.atributos.value;
    return this.tagName === "OPTION" || this.tagName === "TEXTAREA" ? this.textContent : "";
  }
  set value(v) {
    if (this.tagName === "SELECT") {
      this._valor = this.options.some((o) => o.value === String(v)) ? String(v) : null;
      return;
    }
    this._valor = String(v);
  }
  reset() {
    for (const n of this.descendientes()) {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(n.tagName)) n._valor = undefined;
    }
  }

  descendientes() {
    const todos = [];
    const recorrer = (n) => n.hijos.forEach((h) => {
      if (typeof h !== "string") { todos.push(h); recorrer(h); }
    });
    recorrer(this);
    return todos;
  }
  contains(n) {
    for (let x = n; x; x = x.padre) if (x === this) return true;
    return false;
  }
  querySelectorAll(selector) { return this.descendientes().filter((n) => coincide(n, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function atributo(n, nombre) {
  if (nombre.startsWith("data-")) return n.dataset[aCamello(nombre.slice(5))];
  if (nombre === "type") return n.type || n.atributos.type;
  if (nombre === "id") return n.id || undefined;
  if (nombre === "disabled") return n.disabled ? "" : undefined;
  return n.atributos[nombre];
}

// Un selector compuesto sin combinadores: etiqueta, #id, .clase y [atributo].
function coincideSimple(n, parte) {
  parte = parte.replace(/:not\([^)]*\)/g, "");
  const etiqueta = parte.match(/^[a-zA-Z][\w-]*/);
  if (etiqueta && n.tagName !== etiqueta[0].toUpperCase()) return false;
  for (const [, id] of parte.matchAll(/#([\w-]+)/g)) if (n.id !== id) return false;
  for (const [, clase] of parte.matchAll(/\.([\w-]+)/g)) if (!n._clases.has(clase)) return false;
  for (const [, nombre, valor] of parte.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    const actual = atributo(n, nombre);
    if (actual === undefined || actual === null) return false;
    if (valor !== undefined && String(actual) !== valor) return false;
  }
  return true;
}

function coincide(n, selector) {
  return selector.split(",").some((alternativa) => {
    const partes = alternativa.trim().split(/\s+(?![^[]*\])/);
    if (!coincideSimple(n, partes[partes.length - 1])) return false;
    let ancestro = n.padre;
    for (let i = partes.length - 2; i >= 0; i--) {
      while (ancestro && !coincideSimple(ancestro, partes[i])) ancestro = ancestro.padre;
      if (!ancestro) return false;
      ancestro = ancestro.padre;
    }
    return true;
  });
}

function analizarHtml(html) {
  const raiz = new Nodo("#document");
  let actual = raiz;
  html = html.replace(/<!--[\s\S]*?-->/g, "")
             .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const marcas = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(marcas)) {
    if (m[5] !== undefined) {
      const texto = m[5].replace(/\s+/g, " ");
      if (texto.trim()) actual.hijos.push(texto);
      continue;
    }
    const [, cierre, etiqueta, crudos] = m;
    if (cierre) {
      for (let n = actual; n && n !== raiz; n = n.padre) {
        if (n.tagName === etiqueta.toUpperCase()) { actual = n.padre; break; }
      }
      continue;
    }
    const nodo = new Nodo(etiqueta);
    for (const [, nombre, , crudo, entreComillas] of
         crudos.matchAll(/([\w-]+)(=("([^"]*)"|'[^']*'|[^\s>]+))?/g)) {
      const v = entreComillas !== undefined ? entreComillas
        : crudo !== undefined ? crudo.replace(/^'|'$/g, "") : "";
      if (nombre.startsWith("data-")) nodo.dataset[aCamello(nombre.slice(5))] = v;
      else if (nombre === "class") nodo.className = v;
      else if (["hidden", "disabled", "required"].includes(nombre)) nodo[nombre] = true;
      else if (["id", "type", "placeholder", "title"].includes(nombre)) nodo[nombre] = v;
      if (!nombre.startsWith("data-")) nodo.atributos[nombre] = v;
    }
    actual.appendChild(nodo);
    if (!VACIOS.has(etiqueta.toLowerCase()) && !m[4]) actual = nodo;
  }
  return raiz;
}

let documento;

function crearDocumento(raiz) {
  return {
    raiz,
    activeElement: null,
    body: raiz.querySelector("body") || raiz,
    escuchas: {},
    getElementById: (id) => raiz.descendientes().find((n) => n.id === id) || null,
    querySelector: (s) => raiz.querySelector(s),
    querySelectorAll: (s) => raiz.querySelectorAll(s),
    createElement: (etiqueta) => new Nodo(etiqueta),
    createDocumentFragment: () => Object.assign(new Nodo("#fragment"), { esFragmento: true }),
    contains: (n) => raiz.contains(n),
    addEventListener(tipo, f) { (this.escuchas[tipo] = this.escuchas[tipo] || []).push(f); },
    removeEventListener(tipo, f) {
      this.escuchas[tipo] = (this.escuchas[tipo] || []).filter((g) => g !== f);
    },
  };
}

// ----------------------------- la ventana ----------------------------------

let pendientes = 0;
const erroresDeLaPagina = [];

// El fetch de la pagina va al gateway real. El cuerpo se lee aqui dentro para
// que "esperar" sepa cuando una respuesta termino de llegar de verdad.
async function fetchDeLaPagina(url, opciones) {
  pendientes++;
  try {
    const r = await fetch(url.startsWith("http") ? url : GATEWAY + url, opciones);
    const texto = await r.text();
    return {
      ok: r.ok, status: r.status, headers: r.headers,
      json: async () => JSON.parse(texto),
    };
  } finally {
    pendientes--;
  }
}

async function esperar() {
  let quietos = 0;
  while (quietos < 4) {
    await new Promise((r) => setTimeout(r, 25));
    quietos = pendientes === 0 ? quietos + 1 : 0;
  }
}

// sessionStorage vive mientras viva la pestaña: sobrevive a una recarga, y
// por eso es uno solo para todo el recorrido.
const almacen = new Map();

function crearVentana() {
  const escuchasVentana = {};
  const location = { hash: "", pathname: "/" };
  const ventana = {
    document: documento,
    location,
    history: {
      pushState: (_, __, h) => { location.hash = String(h).startsWith("#") ? h : ""; },
      replaceState: (_, __, h) => { location.hash = String(h).startsWith("#") ? h : ""; },
    },
    sessionStorage: {
      getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
      setItem: (k, v) => almacen.set(k, String(v)),
      removeItem: (k) => almacen.delete(k),
    },
    // app.js pregunta "instanceof Node" para saber si una celda es texto o
    // un elemento armado.
    Node: Nodo,
    CSS: { escape: (s) => String(s) },
    fetch: fetchDeLaPagina,
    console,
    setTimeout, clearTimeout,
    // El refresco de la barra cada 30 s no hace falta en un recorrido de
    // segundos, y dejaria el proceso vivo.
    setInterval: () => 0,
    clearInterval: () => { },
    scrollTo: () => { },
    print: () => { },
    addEventListener: (tipo, f) => (escuchasVentana[tipo] = escuchasVentana[tipo] || []).push(f),
    removeEventListener: () => { },
    escuchasVentana,
  };
  ventana.window = ventana;
  return ventana;
}

// ----------------------------- el recorrido --------------------------------

const resultados = [];
function comprobar(descripcion, cumple) {
  resultados.push((cumple ? "si" : "no") + "\t" + descripcion);
}

let pagina;
const $ = (id) => {
  const n = documento.getElementById(id);
  if (!n) throw new Error("la pagina no tiene #" + id);
  return n;
};
const enPagina = (codigo) => vm.runInContext(codigo, pagina);

function visible(n) {
  for (let x = n; x && x.tagName !== "#DOCUMENT"; x = x.padre) if (x.hidden) return false;
  return true;
}

async function entrar(usuario, clave) {
  $("acceso-usuario").value = usuario;
  $("acceso-clave").value = clave;
  $("formulario-acceso").disparar("submit");
  await esperar();
  return $("acceso").hidden && !$("armazon").hidden;
}

async function salir() {
  $("cerrar-sesion").click();
  await esperar();
}

async function irA(vista, interno) {
  pagina.location.hash = "#/" + vista + (interno ? "/" + interno : "");
  for (const f of pagina.escuchasVentana.hashchange || []) f({});
  await esperar();
}

async function elegirInforme(clave, interno) {
  $("reporte-cual").value = clave;
  $("reporte-cual").disparar("change");
  await esperar();
  if (interno) {
    $("reporte-interno").value = interno;
    $("reporte-interno").disparar("change");
    await esperar();
  }
}

async function generar(clave, interno) {
  await elegirInforme(clave, interno);
  $("formulario-reporte").disparar("submit");
  await esperar();
}

// Busca un texto en todo lo que la pagina guarda en nodos: el texto visible
// y el oculto, los valores de los campos y los atributos.
function rastro(texto) {
  if (documento.raiz.textContent.includes(texto)) return true;
  return documento.raiz.descendientes().some((n) =>
    String(n._valor || "").includes(texto) ||
    Object.values(n.atributos).some((v) => String(v).includes(texto)) ||
    Object.values(n.dataset).some((v) => String(v).includes(texto)));
}

let HTML_SERVIDO, APP_SERVIDA;

// Una pagina nueva sobre el mismo sessionStorage: lo que pasa al recargar.
async function cargarPagina() {
  documento = crearDocumento(analizarHtml(HTML_SERVIDO));
  pagina = vm.createContext(crearVentana());
  vm.runInContext(APP_SERVIDA, pagina, { filename: "app.js" });
  await esperar();
}

const hojaVacia = () =>
  !visible($("reporte-hoja")) && $("reporte-cuerpo").textContent === "" &&
  $("reporte-titulo").textContent === "" && $("reporte-sello").textContent === "";

async function principal() {
  [HTML_SERVIDO, APP_SERVIDA] = await Promise.all([
    fetch(WEB + "/index.html").then((r) => r.text()),
    fetch(WEB + "/app.js").then((r) => r.text()),
  ]);
  await cargarPagina();

  const INTERNO = "ASL-014";

  // --- 1. El medico genera "Medicamentos aplicados" ---------------------
  comprobar("el medico entra por el formulario de acceso", await entrar("medico", "medico2026"));
  const nombres = enPagina("Object.values(INTERNOS).map((i) => i.nombre)");
  await irA("reportes", INTERNO);
  await generar("medicamentos", INTERNO);
  comprobar("el medico ve en pantalla la hoja de medicamentos aplicados",
    visible($("reporte-hoja")) &&
    $("reporte-titulo").textContent === "Medicamentos aplicados por paciente" &&
    $("reporte-cuerpo").textContent.length > 0);

  // --- 2. Cambiar de informe en el selector vacia la hoja ---------------
  await elegirInforme("examenes");
  comprobar("al cambiar de informe en el selector la hoja anterior se vacia", hojaVacia());

  // --- 3. Cerrar sesion vacia la pantalla -------------------------------
  await generar("medicamentos", INTERNO);
  await salir();
  comprobar("al cerrar sesion la hoja del informe queda oculta y vacia", hojaVacia());
  const textoTrasSalir = documento.raiz.textContent;
  comprobar("al cerrar sesion ningun nombre de interno queda en la pagina",
    nombres.length > 0 && nombres.every((n) => !textoTrasSalir.includes(n)));
  comprobar("al cerrar sesion la pagina olvida el padron que habia cargado",
    enPagina("Object.keys(INTERNOS).length") === 0);

  // --- 4. Administracion no hereda la hoja del medico -------------------
  comprobar("administracion entra despues del medico", await entrar("administracion", "admin2026"));
  await irA("reportes");
  comprobar("administracion no ve la hoja de medicamentos que genero el medico",
    hojaVacia() && !$("vista-reportes").textContent.includes("Medicamentos aplicados"));
  const ofrecidos = $("reporte-cual").options.map((o) => o.value).sort().join(",");
  comprobar("el selector de informes solo ofrece los de administracion",
    ofrecidos === "citas-pendientes,cobros-paciente,costos-cita,entradas,pagos-fundacion");

  // --- 5. Administracion arma el costo por consulta ---------------------
  await irA("caja", INTERNO);
  comprobar("administracion ve el costo por consulta en la caja",
    visible($("bloque-costos")) && $("lista-costos").textContent.length > 0);
  await irA("reportes", INTERNO);
  await generar("costos-cita", INTERNO);
  comprobar("administracion ve la hoja de costos de cada cita",
    visible($("reporte-hoja")) &&
    $("reporte-titulo").textContent === "Costos de cada cita por paciente");

  // El informe adicional de la caja, sin filtros: todas las citas con saldo.
  await elegirInforme("citas-pendientes");
  comprobar("el informe de citas pendientes arranca sin interno ni fechas",
    $("reporte-interno").value === "" && $("reporte-desde").value === "" &&
    $("reporte-hasta").value === "");
  $("formulario-reporte").disparar("submit");
  await esperar();
  comprobar("administracion ve la hoja de citas con saldo pendiente",
    visible($("reporte-hoja")) && $("reporte-titulo").textContent === "Citas con saldo pendiente" &&
    $("reporte-alcance").textContent === "todos los internos · todas las fechas");
  await salir();

  // --- 6. El medico no hereda lo de administracion ----------------------
  comprobar("el medico vuelve a entrar despues de administracion", await entrar("medico", "medico2026"));
  await irA("caja", INTERNO);
  comprobar("en la cuenta del interno el medico no ve el costo por consulta de administracion",
    !visible($("bloque-costos")) && $("lista-costos").textContent === "");
  comprobar("ni el balance del asilo", $("caja-resumen").textContent === "");
  await irA("reportes", INTERNO);
  comprobar("el medico no ve la hoja de costos que genero administracion",
    hojaVacia() && !$("vista-reportes").textContent.includes("Costos de cada cita"));
  comprobar("ni la de citas con saldo pendiente",
    !$("vista-reportes").textContent.includes("Citas con saldo pendiente") &&
    !$("reporte-cual").options.some((o) => o.value === "citas-pendientes"));

  // --- 7. Una respuesta que llega despues de cerrar sesion no se pinta --
  await elegirInforme("medicamentos", INTERNO);
  $("formulario-reporte").disparar("submit");
  $("cerrar-sesion").click();
  await esperar();
  comprobar("un informe que llega despues de cerrar sesion no se pinta",
    hojaVacia() && $("reporte-estado").textContent === "" && $("avisos").textContent === "");

  // --- 7b. La informacion clinica no le queda al siguiente -------------
  comprobar("el medico entra para editar la informacion clinica", await entrar("medico", "medico2026"));
  await irA("consultas", INTERNO);
  comprobar("el medico ve el boton Editar informacion clinica", visible($("abrir-clinica")));
  $("abrir-clinica").click();
  await esperar();
  const psicoMedico = $("clinica-psicopatologias").textContent;
  comprobar("el cajon clinico abre con la ficha del interno y su ultima actualizacion",
    visible($("cajon-clinica")) && psicoMedico.length > 0 &&
    $("clinica-pie").textContent.startsWith("Última actualización:") &&
    $("clinica-medicacion-agregar").disabled === false);
  // Sale con el cajon abierto: el peor caso.
  await salir();
  comprobar("al cerrar sesion el cajon clinico queda cerrado y vacio",
    !visible($("cajon-clinica")) && $("clinica-psicopatologias").textContent === "" &&
    $("clinica-alergias").textContent === "" && $("clinica-pie").textContent === "");
  comprobar("enfermeria entra despues del medico", await entrar("enfermeria", "enfermeria2026"));
  await irA("consultas", INTERNO);
  comprobar("enfermeria no ve el boton de editar la informacion clinica",
    !visible($("abrir-clinica")) && !visible($("abrir-clinica-ficha")));
  comprobar("ni le queda la ficha clinica que abrio el medico",
    !visible($("cajon-clinica")) && $("clinica-psicopatologias").textContent === "");
  await salir();

  // --- 8. La clave temporal no le queda al siguiente -------------------
  // Una cuenta de nombre unico en cada corrida: las cuentas no se borran.
  const SUFIJO = String(Date.now()).slice(-9);
  const CUENTA = "int.prueba." + SUFIJO;
  const NOMBRE = "Recorrido Interfaz " + SUFIJO;

  comprobar("el administrador entra", await entrar("admin", "admin2026x"));
  await irA("usuarios");
  comprobar("el administrador ve la pestaña Usuarios junto al padrón",
    visible($("pestanas")) && visible($("pestana-usuarios")) && visible($("pestana-padron")));
  comprobar("la lista de cuentas arranca en activas y no ofrece eliminar",
    $("usuarios-estado").value === "ACTIVAS" && $("usuarios-lista").textContent.includes("admin") &&
    !/eliminar|borrar/i.test($("usuarios-lista").textContent));

  $("abrir-alta-usuario").click();
  $("usuario-usuario").value = CUENTA;
  $("usuario-nombre").value = NOMBRE;
  $("usuario-rol").value = "ENFERMERIA";
  $("formulario-usuario").disparar("submit");
  await esperar();
  const TEMPORAL = $("clave-valor").textContent;
  comprobar("al dar de alta la clave temporal se ve en su cuadro, con su vencimiento",
    visible($("cuadro-clave")) && /^[a-km-zA-HJ-NP-Z2-9]{10}$/.test(TEMPORAL) &&
    $("clave-vence").textContent.startsWith("Vence el"));
  comprobar("la clave temporal no se escribe en sessionStorage",
    ![...almacen.values()].some((v) => v.includes(TEMPORAL)));

  // Sale con el cuadro todavia abierto: el peor caso.
  await salir();
  comprobar("al cerrar sesión el cuadro de la clave queda cerrado y vacío",
    !visible($("cuadro-clave")) && $("clave-valor").textContent === "");
  comprobar("el médico entra después del administrador", await entrar("medico", "medico2026"));
  comprobar("no queda rastro de la clave temporal en ningún nodo", !rastro(TEMPORAL));
  comprobar("ni en la memoria de la página",
    !enPagina("JSON.stringify(estadoUsuarios)").includes(TEMPORAL));
  await salir();

  // --- 9. Quien entra con la temporal cae en el cambio de clave --------
  const entroALaApp = await entrar(CUENTA, TEMPORAL);
  comprobar("la cuenta nueva entra con la temporal y cae en el cambio de clave, no en la aplicación",
    !entroALaApp && visible($("cambio-clave")) && !visible($("armazon")) && !visible($("acceso")));
  comprobar("la pantalla de cambio saluda por nombre y pide la clave temporal",
    $("cambio-saludo").textContent.includes(NOMBRE) &&
    $("cambio-actual-rotulo").textContent === "Clave temporal" && !visible($("cambio-cancelar")));

  await cargarPagina();
  comprobar("al recargar con el token de cambio vuelve a la pantalla de cambio",
    visible($("cambio-clave")) && !visible($("armazon")));

  const PROPIA = "Recorrido" + SUFIJO;
  $("cambio-actual").value = TEMPORAL;
  $("cambio-nueva").value = PROPIA;
  $("cambio-confirmar").value = PROPIA;
  $("formulario-cambio").disparar("submit");
  await esperar();
  comprobar("al guardar la clave propia entra a la aplicación",
    !visible($("cambio-clave")) && visible($("armazon")) && visible($("vista-jornada")));
  comprobar("ningún campo conserva las claves que escribió", !rastro(TEMPORAL) && !rastro(PROPIA));
  await salir();

  // La cuenta del recorrido no se queda activa con una clave conocida.
  const admin = await fetch(GATEWAY + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "admin", clave: "admin2026x" }),
  }).then((r) => r.json());
  await fetch(GATEWAY + "/api/usuarios/" + CUENTA + "/desactivar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + admin.token },
    body: JSON.stringify({ motivo: "Fin del recorrido de interfaz" }),
  });

  comprobar("la estacion corrio sin errores de JavaScript", erroresDeLaPagina.length === 0);
  for (const e of erroresDeLaPagina) console.error(e);
}

process.on("unhandledRejection", (e) => erroresDeLaPagina.push(String(e && e.stack || e)));

principal()
  .then(() => {
    console.log(resultados.join("\n"));
    console.log("FIN");
    process.exit(0);
  })
  .catch((e) => {
    console.log(resultados.join("\n"));
    console.error(e && e.stack || e);
    process.exit(1);
  });
