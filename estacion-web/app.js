// Sistema de administracion · Asilo Cabeza de Algodon.
// Empezo como la estacion de enfermeria; hoy es la interfaz de los siete roles.
// Todo pasa por ms-gateway: es el unico origen que conoce el navegador.

const AUTH = "/api/auth";
const VIGIA = "/vigia";
const PASTILLERO = "/pastillero";
const CAJA = "/caja";
const CONSULTAS = "/consultas";

// Cache de presentacion, no fuente de verdad: el padron vive en
// ms-pastillero. Alterar esto no cambia ningun dictamen, porque ms-vigia arma
// la ficha por su cuenta y del cliente solo recibe el pacienteId.
const INTERNOS = {};

// cambio: true mientras la sesion sea la de una clave temporal. Ese token
// solo abre la pantalla de cambio de clave; el gateway rechaza todo lo demas.
const SESION = { token: null, usuario: null, nombre: null, rol: null, cambio: false };
const estado = { interno: null, medicacion: [], dictamen: null, receta: null };
let TARIFAS_CAJA = [];

// A donde queria ir antes de que le pidieran iniciar sesion, para devolverla
// ahi despues de entrar.
let rutaPretendida = location.hash || "";

const $ = (id) => document.getElementById(id);


function servicioDe(url) {
  if (url.startsWith(VIGIA)) return "ms-vigia";
  if (url.startsWith(PASTILLERO)) return "ms-pastillero";
  if (url.startsWith(CAJA)) return "ms-caja";
  return "ms-gateway";
}

async function pedir(url, opciones) {
  opciones = opciones || {};
  const encabezados = Object.assign({}, opciones.headers || {});
  const tokenDeLaPeticion = SESION.token;
  if (tokenDeLaPeticion) encabezados["Authorization"] = "Bearer " + tokenDeLaPeticion;

  let respuesta;
  try {
    respuesta = await fetch(url, Object.assign({}, opciones, { headers: encabezados }));
  } catch (_) {
    // Ni se pudo hablar con la estacion: no hay respuesta que leer.
    const caido = new Error("sin-red");
    caido.red = true;
    caido.servicio = servicioDe(url);
    throw caido;
  }

  let cuerpo = null;
  try { cuerpo = await respuesta.json(); } catch (_) { cuerpo = null; }

  // Si la sesion se cerro mientras la respuesta venia en camino, esos datos
  // son de quien ya se fue: no se pintan en la pantalla del que llega.
  if (SESION.token !== tokenDeLaPeticion) {
    const ajena = new Error("sesion-cambiada");
    ajena.sesionCambiada = true;
    throw ajena;
  }

  if (!respuesta.ok) {
    const error = new Error("http-" + respuesta.status);
    error.estado = respuesta.status;
    error.cuerpo = cuerpo;
    error.servicio = servicioDe(url);
    if (respuesta.status === 401) error.sesionExpirada = true;
    throw error;
  }
  return cuerpo;
}

// Nunca se muestra el mensaje crudo del servidor: se distingue "no responde"
// de "fue rechazada", y se dice que hacer en cada caso.

const NOMBRE_ROL = {
  MEDICO: "medicina",
  ENFERMERIA: "enfermería",
  ADMINISTRACION: "administración"
};

function listaDeRoles(roles) {
  const nombres = (roles || []).map((r) => NOMBRE_ROL[r] || r.toLowerCase());
  if (nombres.length === 0) return "otro rol";
  if (nombres.length === 1) return nombres[0];
  return nombres.slice(0, -1).join(", ") + " o " + nombres[nombres.length - 1];
}

function explicarError(error, accion) {
  const quehacer = accion ? " al " + accion : "";
  const servicio = error.servicio || "el servicio";

  if (error.red) {
    return {
      titulo: "No hay conexión con el sistema",
      texto: "El navegador no pudo comunicarse con el sistema" + quehacer +
             ". Revise que el stack esté levantado y vuelva a intentar.",
      reintentar: true
    };
  }

  switch (error.estado) {
    case 403:
      return {
        titulo: "Su rol no tiene acceso a esto",
        texto: "La sesión de " + (NOMBRE_ROL[SESION.rol] || SESION.rol) +
               " no está autorizada" + quehacer + ". Se necesita una sesión de " +
               listaDeRoles(error.cuerpo && error.cuerpo.rolesPermitidos) + ".",
        reintentar: false
      };
    case 404:
      return {
        titulo: "No se encontró el registro",
        texto: "El dato que se pidió" + quehacer + " ya no existe o nunca existió.",
        reintentar: false
      };
    case 409:
      return {
        titulo: "La operación choca con lo ya registrado",
        texto: "No se pudo completar" + quehacer +
               " porque el registro cambió o ya estaba cerrado. Actualice la vista para ver el estado real.",
        reintentar: true
      };
    case 400:
      return {
        titulo: "Faltan datos o son inválidos",
        texto: "Revise los campos del formulario antes de volver a enviarlo.",
        detalles: (error.cuerpo && error.cuerpo.detalles) || [],
        reintentar: false
      };
    case 429:
      return {
        titulo: "Demasiados intentos seguidos",
        texto: "El sistema pidió esperar antes de volver a intentar.",
        reintentar: false
      };
    case 502:
      return {
        titulo: "El servicio " + servicio + " no respondió",
        texto: "El gateway no pudo alcanzar a " + servicio +
               ". El contenedor puede estar reiniciándose.",
        reintentar: true,
        espera: true
      };
    case 503:
      return {
        titulo: "El servicio " + servicio + " no está disponible",
        texto: "Depende de otro servicio que no está respondiendo. " +
               "No se muestra información incompleta a propósito.",
        reintentar: true,
        espera: true
      };
    default:
      return {
        titulo: "El sistema no pudo completar la operación",
        texto: "Ocurrió un error inesperado" + quehacer + " (código " +
               (error.estado || "desconocido") + ").",
        reintentar: true
      };
  }
}

// Los errores se quedan hasta que se cierren; los demas se van a los 6
// segundos. Todo se anuncia por la region aria-live.

function aviso(titulo, texto, tipo, alReintentar) {
  const caja = $("avisos");
  const nodo = document.createElement("div");
  nodo.className = "aviso aviso--" + (tipo || "ok");

  const cuerpo = document.createElement("div");
  cuerpo.className = "aviso__cuerpo";

  const t = document.createElement("p");
  t.className = "aviso__titulo";
  t.textContent = titulo;
  cuerpo.appendChild(t);

  if (texto) {
    const p = document.createElement("p");
    p.className = "aviso__texto";
    p.textContent = texto;
    cuerpo.appendChild(p);
  }
  if (alReintentar) {
    const boton = document.createElement("button");
    boton.className = "accion-sec";
    boton.type = "button";
    boton.textContent = "Reintentar";
    boton.addEventListener("click", () => { nodo.remove(); alReintentar(); });
    cuerpo.appendChild(boton);
  }

  const cerrar = document.createElement("button");
  cerrar.className = "aviso__cerrar";
  cerrar.type = "button";
  cerrar.setAttribute("aria-label", "Cerrar el aviso");
  cerrar.textContent = "×";
  cerrar.addEventListener("click", () => nodo.remove());

  nodo.append(cuerpo, cerrar);
  caja.appendChild(nodo);

  // Solo lo que no es error desaparece solo.
  if (tipo !== "error") setTimeout(() => nodo.remove(), 6000);
  return nodo;
}

function avisarError(error, accion, alReintentar) {
  if (error && error.sesionCambiada) return;
  if (error && error.sesionExpirada) { sesionExpirada(); return; }
  const e = explicarError(error, accion);
  let texto = e.texto;
  if (e.detalles && e.detalles.length) texto += " " + e.detalles.join(" ");
  aviso(e.titulo, texto, e.reintentar && e.espera ? "aviso" : "error",
        e.reintentar ? alReintentar : null);
}


const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function atraparFoco(nodo) {
  function alTabular(evento) {
    if (evento.key !== "Tab") return;
    const lista = [...nodo.querySelectorAll(ENFOCABLES)].filter((n) => n.offsetParent !== null);
    if (!lista.length) return;
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    if (evento.shiftKey && document.activeElement === primero) {
      evento.preventDefault(); ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault(); primero.focus();
    }
  }
  nodo.addEventListener("keydown", alTabular);
  return () => nodo.removeEventListener("keydown", alTabular);
}


function confirmar(opciones) {
  return new Promise((resolver) => {
    const dialogo = $("confirmar");
    const velo = $("velo-confirmar");
    const cuerpo = $("confirmar-cuerpo");
    const si = $("confirmar-si");
    const no = $("confirmar-no");
    const devolverA = document.activeElement;

    $("confirmar-titulo").textContent = opciones.titulo;
    dialogo.className = "confirmar" + (opciones.tono === "peligro" ? " confirmar--peligro" : "");
    si.className = "accion" + (opciones.tono === "peligro" ? " accion--peligro" : "");
    si.textContent = opciones.textoSi || "Confirmar";

    cuerpo.textContent = "";
    const lista = document.createElement("dl");
    for (const [rotulo, valor] of opciones.datos || []) {
      const fila = document.createElement("div");
      fila.className = "confirmar__dato";
      const dt = document.createElement("dt");
      dt.textContent = rotulo;
      const dd = document.createElement("dd");
      dd.textContent = valor;
      fila.append(dt, dd);
      lista.appendChild(fila);
    }
    cuerpo.appendChild(lista);
    if (opciones.aviso) {
      const p = document.createElement("p");
      p.className = "confirmar__aviso";
      p.textContent = opciones.aviso;
      cuerpo.appendChild(p);
    }

    dialogo.hidden = false;
    velo.hidden = false;
    const soltar = atraparFoco(dialogo);
    no.focus();

    function terminar(respuesta) {
      soltar();
      dialogo.hidden = true;
      velo.hidden = true;
      si.removeEventListener("click", alSi);
      no.removeEventListener("click", alNo);
      velo.removeEventListener("click", alNo);
      document.removeEventListener("keydown", alTecla);
      if (devolverA && devolverA.focus) devolverA.focus();
      resolver(respuesta);
    }
    const alSi = () => terminar(true);
    const alNo = () => terminar(false);
    const alTecla = (e) => { if (e.key === "Escape") terminar(false); };

    si.addEventListener("click", alSi);
    no.addEventListener("click", alNo);
    velo.addEventListener("click", alNo);
    document.addEventListener("keydown", alTecla);
  });
}


function esqueleto(nodo, filas, altas) {
  nodo.textContent = "";
  const caja = document.createElement("div");
  caja.className = "esqueleto";
  caja.setAttribute("aria-hidden", "true");
  for (let i = 0; i < filas; i++) {
    const linea = document.createElement("div");
    linea.className = "esqueleto__linea" + (altas ? " esqueleto__linea--alta" : "") +
      (!altas && i % 3 === 2 ? " esqueleto__linea--media" : "");
    caja.appendChild(linea);
  }
  nodo.appendChild(caja);
}

function vacio(nodo, titulo, texto, accion) {
  nodo.textContent = "";
  const caja = document.createElement("div");
  caja.className = "vacio";
  const t = document.createElement("p");
  t.className = "vacio__titulo";
  t.textContent = titulo;
  const p = document.createElement("p");
  p.className = "vacio__texto";
  p.textContent = texto;
  caja.append(t, p);
  if (accion) {
    const boton = document.createElement("button");
    boton.className = "accion";
    boton.type = "button";
    boton.textContent = accion.texto;
    boton.addEventListener("click", accion.alPulsar);
    caja.appendChild(boton);
  }
  nodo.appendChild(caja);
}

function problema(nodo, error, accion, alReintentar) {
  // Una respuesta de la sesion anterior no es un problema de esta.
  if (error && error.sesionCambiada) return;
  const e = explicarError(error, accion);
  nodo.textContent = "";
  const caja = document.createElement("div");
  caja.className = "problema" + (e.espera ? " problema--espera" : "");
  const t = document.createElement("p");
  t.className = "problema__titulo";
  t.textContent = e.titulo;
  const p = document.createElement("p");
  p.className = "problema__texto";
  p.textContent = e.texto;
  caja.append(t, p);
  if (e.reintentar && alReintentar) {
    const boton = document.createElement("button");
    boton.className = "accion-sec";
    boton.type = "button";
    boton.textContent = "Reintentar";
    boton.addEventListener("click", alReintentar);
    caja.appendChild(boton);
  }
  nodo.appendChild(caja);
}

// Enrutado por hash: las vistas son enlazables (#/jornada, #/caja,
// #/interno/ASL-014) y el boton de atras funciona.

const VISTAS = ["jornada", "caja", "consultas", "reportes", "padron", "usuarios",
                "agenda", "laboratorio", "farmacia"];

// Reflejo exacto de la matriz del gateway: una vista de mas aqui solo
// conseguiria que la persona pulse y reciba un 403.
const VISTAS_POR_ROL = {
  MEDICO:         ["jornada", "consultas", "caja", "reportes"],
  ENFERMERIA:     ["jornada", "consultas", "reportes"],
  ADMINISTRACION: ["caja", "reportes"],
  ADMINISTRADOR:  ["padron", "usuarios"],
  FUNDACION:      ["agenda"],
  LABORATORIO:    ["laboratorio"],
  FARMACIA:       ["farmacia"],
};

// Los tres roles operativos no tienen internos a cargo: su pantalla es una
// bandeja, sin barra lateral.
// El ADMINISTRADOR tampoco lleva la lateral: su pantalla ES el padron, y una
// lista de internos al lado de otra lista de internos solo confunde.
const ROLES_SIN_PADRON = ["FUNDACION", "LABORATORIO", "FARMACIA", "ADMINISTRADOR"];

function vistasDelRol() { return VISTAS_POR_ROL[SESION.rol] || []; }
function vistaPermitida(vista) { return vistasDelRol().includes(vista); }
function vistaPorDefecto() { return vistasDelRol()[0] || "jornada"; }
function tienePadron() { return !ROLES_SIN_PADRON.includes(SESION.rol); }

function parsearHash(cadena) {
  const partes = String(cadena || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!partes.length) return {};
  if (partes[0] === "interno") return { vista: "jornada", interno: partes[1] };
  if (VISTAS.includes(partes[0])) return { vista: partes[0], interno: partes[1] };
  return {};
}

let rutaActual = { vista: null, interno: null };

function normalizarRuta(destino) {
  let vista = destino.vista && vistaPermitida(destino.vista) ? destino.vista : vistaPorDefecto();
  // Las bandejas no cuelgan de un interno: su ruta es solo la vista.
  if (!tienePadron()) return { vista, interno: null };
  let interno = destino.interno && INTERNOS[destino.interno] ? destino.interno : estado.interno;
  if (!INTERNOS[interno]) interno = Object.keys(INTERNOS)[0] || null;
  return { vista, interno };
}

function irA(destino, reemplazar) {
  const ruta = normalizarRuta(destino);
  const hash = "#/" + ruta.vista + (ruta.interno ? "/" + ruta.interno : "");
  if (location.hash !== hash) {
    if (reemplazar) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  const cambioVista = ruta.vista !== rutaActual.vista;
  const cambioInterno = ruta.interno !== rutaActual.interno;
  rutaActual = ruta;
  estado.interno = ruta.interno;

  if (cambioVista) pintarVista(ruta.vista);
  if (cambioInterno) { marcarInternoSeleccionado(); actualizarSuperior(); }

  if (ruta.vista === "jornada" && (cambioVista || cambioInterno)) cargarInterno();
  if (ruta.vista === "caja" && (cambioVista || cambioInterno)) pintarCaja();
  if (ruta.vista === "consultas" && (cambioVista || cambioInterno)) pintarConsultas();
  if (ruta.vista === "reportes" && (cambioVista || cambioInterno)) pintarReportes();
  if (ruta.vista === "padron" && cambioVista) pintarPadron();
  if (ruta.vista === "usuarios" && cambioVista) pintarUsuarios();
  if (ruta.vista === "agenda" && cambioVista) pintarAgenda();
  if (ruta.vista === "laboratorio" && cambioVista) pintarLaboratorio();
  if (ruta.vista === "farmacia" && cambioVista) pintarFarmacia();
}

function sincronizarDesdeHash() {
  if (!SESION.token) return;
  irA(parsearHash(location.hash), true);
}

window.addEventListener("popstate", sincronizarDesdeHash);
window.addEventListener("hashchange", sincronizarDesdeHash);

function pintarVista(nombre) {
  for (const vista of VISTAS) {
    const nodo = $("vista-" + vista);
    if (nodo) nodo.hidden = vista !== nombre;
  }
  document.querySelectorAll(".pestana").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.vista === nombre)));
  window.scrollTo({ top: 0, behavior: "auto" });
}

document.querySelectorAll(".pestana").forEach((boton) => {
  boton.addEventListener("click", () => irA({ vista: boton.dataset.vista, interno: estado.interno }));
});


function guardarSesion(datos) {
  SESION.token = datos.token;
  SESION.usuario = datos.usuario;
  SESION.nombre = datos.nombre;
  SESION.rol = datos.debeCambiarClave ? "CAMBIO_DE_CLAVE" : datos.rol;
  SESION.cambio = datos.debeCambiarClave === true;
  // Solo el token y quien es. Una clave, temporal o no, nunca se guarda aqui.
  sessionStorage.setItem("sesionAsilo", JSON.stringify(SESION));
}

function limpiarSesion() {
  SESION.token = null; SESION.usuario = null; SESION.nombre = null; SESION.rol = null;
  SESION.cambio = false;
  sessionStorage.removeItem("sesionAsilo");
}

function mostrarAcceso(mensajeReanudar) {
  const reanudar = $("acceso-reanudar");
  reanudar.hidden = !mensajeReanudar;
  reanudar.textContent = mensajeReanudar || "";
  $("acceso").hidden = false;
  $("cambio-clave").hidden = true;
  $("superior").hidden = true;
  $("armazon").hidden = true;
  $("barra").hidden = true;
  $("acceso-clave").value = "";
  // Se borra la clave, no el usuario escrito.
  $("acceso-usuario").focus();
  $("acceso-usuario").select();
}

// Todo lo que pinto la sesion que se va. Las vistas estan en el DOM aunque
// esten ocultas, y una vista solo se repinta cuando se entra a ella; un panel
// que el rol nuevo no repinta enseña lo que pidio el anterior. Asi
// administracion veia la hoja "Medicamentos aplicados" que genero el medico,
// y el medico veia el costo por consulta que armo administracion.
const PANELES_DE_SESION = [
  // la lateral y la cabecera
  "lista-internos", "internos-vacio", "superior-interno-nombre", "superior-interno-codigo",
  "sesion-nombre", "sesion-rol",
  // jornada
  "meta-interno", "datos-interno", "regla", "parte", "registro",
  // caja
  "caja-meta", "caja-resumen", "caja-saldo", "caja-cargos", "costos-conteo", "lista-costos",
  "fundacion-nota",
  // consultas
  "consultas-meta", "consultas-conteo", "lista-solicitudes", "correos-conteo", "correos-nota",
  "lista-correos", "examenes-conteo", "lista-examenes", "historial-conteo", "historial",
  // padron y bandejas
  "padron-meta", "padron-lista", "agenda-conteo", "bandeja-agenda",
  "laboratorio-conteo", "bandeja-laboratorio", "farmacia-conteo", "bandeja-farmacia",
  // reportes: el selector se rearma con los informes del rol que entre
  "reportes-meta", "reporte-ayuda", "reporte-cual", "reporte-interno", "reporte-visita",
  // los cajones
  "dictamen", "ficha-cuerpo", "ficha-pie", "visita-cabecera", "visita-examenes",
  "visita-indicaciones", "dictamen-indicacion", "egreso-cabecera", "confirmar-cuerpo",
  // cuentas del personal, y el cuadro de la clave temporal: una clave que se
  // queda en pantalla para el siguiente es exactamente la fuga a cerrar
  // la informacion clinica
  "clinica-estado", "clinica-psicopatologias", "clinica-alergias", "clinica-medicacion",
  "clinica-vademecum-estado", "clinica-pie", "clinica-titulo",
  "usuarios-meta", "usuarios-lista", "usuario-rol-motivo", "desactivar-cabecera",
  "bitacora-cabecera", "bitacora-lista", "clave-para", "clave-valor", "clave-vence",
  "clave-copiada",
  // la pantalla de cambio de clave
  "cambio-saludo", "cambio-error",
  // los avisos que quedaron abiertos hablan de lo que hizo el anterior
  "avisos",
];

// Lo que la persona escribio y no envio tampoco es del que llega.
const FORMULARIOS_DE_SESION = [
  "formulario", "formulario-remision", "formulario-visita", "formulario-examen",
  "formulario-indicacion", "formulario-interno", "formulario-egreso",
  "formulario-cargo", "formulario-donacion", "formulario-gasto", "formulario-reporte",
  "formulario-fundacion",
  "formulario-usuario", "formulario-desactivar", "formulario-cambio", "formulario-clinica",
];

function vaciarInforme() {
  $("reporte-hoja").hidden = true;
  for (const id of ["reporte-estado", "reporte-titulo", "reporte-alcance", "reporte-sello", "reporte-cuerpo"]) {
    $(id).textContent = "";
  }
}

function vaciarPantallas() {
  // Un dialogo de confirmacion abierto se cancela: nadie dijo que si.
  if (!$("confirmar").hidden) $("confirmar-no").click();
  cerrarCajon(); cerrarFicha(); cerrarVisita(); cerrarRemision();
  cerrarFormularioInterno(); cerrarEgreso();
  cerrarFormularioUsuario(); cerrarDesactivar(); cerrarBitacora(); cerrarClaveTemporal();
  cerrarClinica();
  ocultarCambioClave();

  for (const id of PANELES_DE_SESION) $(id).textContent = "";
  for (const id of FORMULARIOS_DE_SESION) $(id).reset();
  $("nombre-interno").textContent = "—";
  $("caja-interno-nombre").textContent = "—";
  $("superior-interno").hidden = true;
  $("internos-vacio").hidden = true;
  $("bloque-costos").hidden = true;
  $("buscador-campo").value = "";
  vaciarInforme();

  // La memoria de la pagina tambien: el padron que cargo el medico le pondria
  // nombre a los internos en la bandeja de un rol que no lee el padron.
  Object.keys(INTERNOS).forEach((k) => delete INTERNOS[k]);
  Object.assign(estado, { interno: null, medicacion: [], dictamen: null, receta: null });
  Object.assign(estadoConsultas, { visitaAbierta: null, solicitudes: [], visitas: [] });
  Object.assign(estadoPadron, { internos: [], editando: null, egresando: null });
  Object.assign(estadoUsuarios, { cuentas: [], editando: null, desactivando: null });
  Object.assign(estadoClinica, { interno: null, psicopatologias: [], alergias: [],
                                 medicacion: [], vademecum: null, original: null });
  $("usuarios-estado").value = "ACTIVAS";
  TARIFAS_CAJA = [];
  informePedido = null;
  saldoFundacion = null;
}

// No se expulsa de golpe: se avisa y se guarda donde estaba, para devolverla
// ahi cuando vuelva a entrar. La ruta se guarda; lo pintado no, porque quien
// entre despues puede ser otra persona con otro rol.
function sesionExpirada() {
  if (!SESION.token) return;
  rutaPretendida = location.hash || "";
  const usuario = SESION.usuario;
  limpiarSesion();
  vaciarPantallas();
  rutaActual = { vista: null, interno: null };
  clearInterval(relojBarra);
  $("acceso-usuario").value = usuario || "";
  mostrarAcceso(
    "Su sesión expiró por seguridad. Vuelva a ingresar y lo devolvemos a donde estaba."
  );
}

async function cerrarSesion() {
  // El gateway mete el token en la lista de revocacion. Sin esto, borrar la
  // sesion del navegador no invalida nada: el token sigue sirviendo.
  const token = SESION.token;
  if (token) pedir(AUTH + "/logout", { method: "POST" }).catch(() => { });
  limpiarSesion();
  vaciarPantallas();
  rutaActual = { vista: null, interno: null };
  rutaPretendida = "";
  clearInterval(relojBarra);
  history.replaceState(null, "", location.pathname);
  $("acceso-usuario").value = "";
  mostrarAcceso("");
}

$("cerrar-sesion").addEventListener("click", cerrarSesion);

// --- Formulario de acceso ---------------------------------------------
$("formulario-acceso").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const campoUsuario = $("acceso-usuario");
  const campoClave = $("acceso-clave");
  const boton = $("acceso-enviar");
  const error = $("acceso-error");

  error.textContent = "";
  campoClave.removeAttribute("aria-invalid");

  const usuario = campoUsuario.value.trim();
  const clave = campoClave.value;
  if (!usuario || !clave) {
    error.textContent = "Escriba su usuario y su clave.";
    (usuario ? campoClave : campoUsuario).focus();
    return;
  }

  boton.disabled = true;
  const textoOriginal = boton.textContent;
  boton.textContent = "Verificando…";
  try {
    const respuesta = await fetch(AUTH + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, clave })
    });
    const cuerpo = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      if (respuesta.status === 429) {
        const espera = (cuerpo && cuerpo.reintentarEnSegundos) || 300;
        throw new Error("Demasiados intentos fallidos. Espere " +
          Math.ceil(espera / 60) + " minuto(s) antes de volver a intentar.");
      }
      // El gateway distingue la clave mala, la cuenta desactivada, la clave
      // temporal vencida y la base que no responde, y cada una se resuelve
      // distinto: reducirlas todas a "clave incorrecta" mandaba a la persona
      // a probar otra clave cuando lo que tenia que hacer era llamar al
      // administrador. Sus mensajes ya estan escritos para leerse.
      if ([401, 403, 503].includes(respuesta.status) && cuerpo && cuerpo.error) {
        throw new Error(cuerpo.error);
      }
      throw new Error("Usuario o clave incorrectos.");
    }
    guardarSesion(cuerpo);
    campoClave.value = "";
    // Con la clave temporal no se entra a la aplicacion: se entra a elegir la
    // propia.
    if (cuerpo.debeCambiarClave) { mostrarCambioClave("obligatorio"); return; }
    await mostrarApp();
  } catch (e) {
    // El error va junto al campo, y lo que la persona escribio se queda.
    error.textContent = e.message === "Failed to fetch"
      ? "No hay conexión con el sistema. Revise que esté levantado."
      : e.message;
    campoClave.setAttribute("aria-invalid", "true");
    campoClave.value = "";
    campoClave.focus();
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
});

function aplicarPermisos() {
  $("abrir-cajon").hidden = SESION.rol !== "MEDICO";
  $("caja-admin").hidden = SESION.rol !== "ADMINISTRACION";

  // La pestaña se nombra por lo que cada rol puede hacer: administración entra
  // al módulo completo, el médico solo al estado de cuenta del interno.
  const esAdmin = SESION.rol === "ADMINISTRACION";
  $("pestana-caja-texto").textContent = esAdmin ? "Caja y donaciones" : "Cuenta del interno";
  $("caja-titulo").textContent = esAdmin ? "Caja y donaciones" : "Cuenta del interno";
  // Solo se muestran las pestañas que el rol puede usar.
  $("pestana-jornada").hidden = !vistaPermitida("jornada");
  $("pestana-caja").hidden = !vistaPermitida("caja");
  $("pestana-consultas").hidden = !vistaPermitida("consultas");
  $("pestana-reportes").hidden = !vistaPermitida("reportes");
  $("pestana-padron").hidden = !vistaPermitida("padron");
  $("pestana-usuarios").hidden = !vistaPermitida("usuarios");
  // Enfermeria lee la cadena clinica pero no escribe: sin boton de remitir.
  $("abrir-remision").hidden = SESION.rol !== "MEDICO";
  // La parte clinica la escribe el medico y nadie mas; enfermeria la lee.
  $("abrir-clinica").hidden = SESION.rol !== "MEDICO";
  $("abrir-clinica-ficha").hidden = SESION.rol !== "MEDICO";
  // Los tres roles operativos no tienen internos a cargo: fuera la lateral.
  $("armazon").classList.toggle("armazon--sin-lateral", !tienePadron());
  // Con una sola vista, la barra de pestañas no aporta nada.
  $("pestanas").hidden = vistasDelRol().length < 2;
  $("sesion-nombre").textContent = SESION.nombre;
  $("sesion-rol").textContent = SESION.rol;
  $("internos-rotulo").textContent =
    SESION.rol === "ADMINISTRACION" ? "Internos del asilo" : "Internos a cargo";
}

function actualizarSuperior() {
  const ficha = INTERNOS[estado.interno];
  $("superior-interno").hidden = !ficha;
  if (!ficha) return;
  $("superior-interno-nombre").textContent = ficha.nombre;
  $("superior-interno-codigo").textContent = ficha.pacienteId;
}

async function mostrarApp() {
  aplicarPermisos();
  // La vista se elige ANTES de descubrir la pantalla: si no, administracion
  // alcanza a ver un instante la jornada de medicacion.
  pintarVista(vistaPorDefecto());
  $("acceso").hidden = true;
  $("superior").hidden = false;
  $("armazon").hidden = false;
  $("barra").hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
  await iniciarApp();
}


async function refrescarBarra() {
  const nodoGw = document.querySelector('.barra span[data-servicio="gateway"]');
  try {
    await pedir(AUTH + "/me");
    nodoGw.dataset.vivo = "si";
    nodoGw.textContent = "ms-gateway: en línea";
  } catch (error) {
    nodoGw.dataset.vivo = "no";
    nodoGw.textContent = "ms-gateway: sin respuesta";
    if (error.sesionExpirada) { sesionExpirada(); return; }
  }

  for (const [clave, base] of [["vigia", VIGIA], ["pastillero", PASTILLERO], ["caja", CAJA], ["consultas", CONSULTAS]]) {
    const nodo = document.querySelector('.barra span[data-servicio="' + clave + '"]');
    try {
      const salud = await pedir(base + "/salud");
      nodo.dataset.vivo = "si";
      nodo.textContent = salud.servicio + " " + salud.version + ": en línea";
    } catch (_) {
      nodo.dataset.vivo = "no";
      nodo.textContent = "ms-" + clave + ": sin respuesta";
    }
  }

  // El turno lo sirve ms-pastillero, que solo lee el personal clinico.
  if (SESION.rol === "MEDICO" || SESION.rol === "ENFERMERIA") {
    try {
      const t = await pedir(PASTILLERO + "/api/v1/turnos");
      $("barra-turno").textContent = "turno " + t.turnoActual;
      $("barra-hora").textContent = t.hora;
    } catch (_) { }
  }
}


async function cargarInternos() {
  const lista = $("lista-internos");
  esqueleto(lista, 3, true);
  try {
    const datos = await pedir(PASTILLERO + "/api/v1/internos");
    Object.keys(INTERNOS).forEach((k) => delete INTERNOS[k]);
    datos.internos.forEach((i) => (INTERNOS[i.pacienteId] = i));
    // El buscador aparece cuando la lista deja de caber de un vistazo.
    $("buscador").hidden = datos.internos.length <= 6;
    pintarInternos();
    return true;
  } catch (error) {
    lista.textContent = "";
    problema($("internos-vacio"), error, "cargar el padrón de internos", cargarInternos);
    $("internos-vacio").hidden = false;
    if (error.sesionExpirada) sesionExpirada();
    return false;
  }
}

function pintarInternos() {
  const lista = $("lista-internos");
  const filtro = $("buscador-campo").value.trim().toLowerCase();
  lista.textContent = "";

  const visibles = Object.values(INTERNOS).filter((f) =>
    !filtro ||
    f.nombre.toLowerCase().includes(filtro) ||
    f.pacienteId.toLowerCase().includes(filtro));

  const nodoVacio = $("internos-vacio");
  nodoVacio.hidden = visibles.length > 0;
  if (!visibles.length) {
    nodoVacio.textContent = "Ningún interno coincide con «" + filtro + "».";
    return;
  }

  for (const ficha of visibles) {
    const fila = document.createElement("li");
    const boton = document.createElement("button");
    boton.className = "interno";
    boton.type = "button";
    boton.dataset.interno = ficha.pacienteId;
    boton.setAttribute("aria-pressed", String(ficha.pacienteId === estado.interno));

    const nombre = document.createElement("span");
    nombre.className = "interno__nombre";
    nombre.textContent = ficha.nombre;

    const meta = document.createElement("span");
    meta.className = "interno__meta";
    const tratamientos = ficha.planesActivos
      ? " · " + ficha.planesActivos + " tratamiento" + (ficha.planesActivos === 1 ? "" : "s")
      : "";
    meta.textContent = ficha.pacienteId + " · " + ficha.edad + " años" + tratamientos;

    boton.append(nombre, meta);
    boton.addEventListener("click", () => {
      cerrarCajon();
      irA({ vista: rutaActual.vista, interno: ficha.pacienteId });
    });
    fila.appendChild(boton);
    lista.appendChild(fila);
  }
}

function marcarInternoSeleccionado() {
  document.querySelectorAll(".interno").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.interno === estado.interno)));
}

$("buscador-campo").addEventListener("input", pintarInternos);


function campo(rotulo, contenido) {
  const div = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = rotulo;
  const dd = document.createElement("dd");
  if (contenido instanceof Node) dd.appendChild(contenido);
  else dd.textContent = contenido;
  div.append(dt, dd);
  return div;
}

function enfasis(texto) {
  const em = document.createElement("em");
  em.textContent = texto;
  return em;
}

function pintarFicha() {
  const f = INTERNOS[estado.interno];
  if (!f) return;
  $("nombre-interno").textContent = f.nombre;
  $("meta-interno").textContent =
    f.pacienteId + " · " + f.edad + " años · " + (f.ubicacion || "sin cama asignada") +
    " · ingresó el " + f.ingreso;

  const datos = $("datos-interno");
  datos.textContent = "";

  // A administracion el servicio le devuelve la ficha sin la parte clinica.
  const oculto = "No visible para administración";

  datos.appendChild(campo("Psicopatología",
    f.psicopatologias ? f.psicopatologias.join(", ") : oculto));

  datos.appendChild(campo("Alergias",
    !f.alergias ? oculto
      : f.alergias.length ? enfasis(f.alergias.join(", "))
        : "Ninguna declarada"));

  datos.appendChild(campo("Recibe actualmente", listaMedicacion(oculto)));
  datos.appendChild(campo("Familiar responsable", f.responsable));
}

function listaMedicacion(oculto) {
  const caja = document.createElement("div");
  if (SESION.rol === "ADMINISTRACION") { caja.textContent = oculto; return caja; }
  if (!estado.medicacion.length) {
    caja.textContent = "Sin tratamiento crónico registrado";
    return caja;
  }
  caja.className = "medicacion";
  for (const m of estado.medicacion) {
    const linea = document.createElement("div");
    linea.className = "medicacion__linea";
    const texto = document.createElement("span");
    texto.className = "medicacion__pauta";
    texto.textContent = m.farmaco + " " + m.dosisMg + " mg cada " + m.cadaHoras + " h";
    linea.appendChild(texto);
    // Suspender es revocar una decision clinica: solo el medico. La misma
    // regla la hacen cumplir el gateway y ms-pastillero.
    if (SESION.rol === "MEDICO" && m.planId) {
      const boton = document.createElement("button");
      boton.className = "accion-sec accion-sec--suave medicacion__accion";
      boton.type = "button";
      boton.textContent = "Suspender";
      boton.setAttribute("aria-label", "Suspender el tratamiento de " + m.farmaco);
      boton.addEventListener("click", () => suspenderPlan(m));
      linea.appendChild(boton);
    }
    caja.appendChild(linea);
  }
  return caja;
}

async function suspenderPlan(medicamento) {
  const ficha = INTERNOS[estado.interno];
  const seguro = await confirmar({
    titulo: "¿Suspender este tratamiento?",
    tono: "peligro",
    textoSi: "Suspender el tratamiento",
    datos: [
      ["Interno", ficha.nombre + " · " + ficha.pacienteId],
      ["Fármaco", medicamento.farmaco],
      ["Pauta", medicamento.dosisMg + " mg cada " + medicamento.cadaHoras + " h"]
    ],
    aviso: "Se anularán todas las tomas futuras de este plan. No se puede deshacer."
  });
  if (!seguro) return;

  try {
    await pedir(PASTILLERO + "/api/v1/planes/" + medicamento.planId + "/suspender", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: "Suspendido por " + SESION.nombre + " desde el sistema" })
    });
    aviso("Tratamiento suspendido",
      medicamento.farmaco + " ya no se administrará a " + ficha.nombre +
      ". Las tomas futuras quedaron anuladas.", "ok");
    await cargarInterno();
    await cargarInternos();
  } catch (error) {
    avisarError(error, "suspender el tratamiento");
  }
}

async function cargarInterno() {
  pintarFicha();
  if (SESION.rol === "ADMINISTRACION") return;

  try {
    const meds = await pedir(
      PASTILLERO + "/api/v1/pacientes/" + estado.interno + "/medicacion-activa");
    estado.medicacion = meds.medicacionActual;
  } catch (_) {
    estado.medicacion = [];
  }
  pintarFicha();
  await pintarJornada();
}


const ETIQUETA_ESTADO = {
  ADMINISTRADA: "administrada",
  PENDIENTE: "pendiente",
  OMITIDA: "omitida",
  VENCIDA: "vencida"
};

function marcaEstado(estadoToma) {
  const marca = document.createElement("span");
  marca.className = "marca-estado marca-estado--" + estadoToma;
  marca.setAttribute("aria-hidden", "true");
  return marca;
}

async function pintarJornada(resaltar) {
  const regla = $("regla");
  const registro = $("registro");
  const parte = $("parte");

  if (!resaltar) {
    esqueleto(regla, 1, true);
    esqueleto(registro, 4, true);
    parte.textContent = "Consultando el parte del día…";
  }

  let datos, adherencia;
  try {
    datos = await pedir(PASTILLERO + "/api/v1/pacientes/" + estado.interno + "/tomas");
    adherencia = await pedir(PASTILLERO + "/api/v1/pacientes/" + estado.interno + "/adherencia");
  } catch (error) {
    regla.textContent = "";
    parte.textContent = "";
    problema(registro, error, "consultar la jornada del interno", () => pintarJornada());
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  $("fecha-hoy").textContent = datos.fecha;
  dibujarRegla(regla, datos.tomas);
  escribirParte(parte, datos, adherencia);
  dibujarRegistro(registro, datos.tomas, resaltar);
}

function dibujarRegla(regla, tomas) {
  regla.textContent = "";
  if (!tomas.length) {
    const p = document.createElement("p");
    p.className = "regla__vacia";
    p.textContent = "Sin tomas programadas para hoy.";
    regla.appendChild(p);
    return;
  }

  for (let h = 0; h <= 24; h += 2) {
    const pos = (h / 24) * 100;
    const marca = document.createElement("span");
    marca.className = "regla__marca" + (h % 4 === 0 ? " regla__marca--mayor" : "");
    marca.style.left = pos + "%";
    regla.appendChild(marca);
    if (h % 4 === 0 && h < 24) {
      const rotulo = document.createElement("span");
      rotulo.className = "regla__hora";
      rotulo.style.left = pos + "%";
      rotulo.textContent = String(h).padStart(2, "0") + ":00";
      regla.appendChild(rotulo);
    }
  }

  const ahora = new Date();
  const marcaAhora = document.createElement("span");
  marcaAhora.className = "regla__ahora";
  marcaAhora.style.left = ((ahora.getHours() + ahora.getMinutes() / 60) / 24) * 100 + "%";
  regla.appendChild(marcaAhora);

  for (const t of tomas) {
    const momento = new Date(t.programadoPara);
    const pos = ((momento.getHours() + momento.getMinutes() / 60) / 24) * 100;
    const alfiler = document.createElement("button");
    alfiler.className = "alfiler";
    alfiler.type = "button";
    alfiler.style.left = pos + "%";
    alfiler.dataset.estado = t.estado;
    alfiler.title = t.hora + " · " + t.farmaco + " · " + ETIQUETA_ESTADO[t.estado];
    alfiler.setAttribute("aria-label",
      t.hora + ", " + t.farmaco + " " + t.dosisMg + " miligramos, " + ETIQUETA_ESTADO[t.estado]);

    // Viaja en el DOM aunque en pantalla ancha no se vea: en angosta la regla
    // se vuelve linea de tiempo y esto es lo que se lee.
    const etiqueta = document.createElement("span");
    etiqueta.className = "alfiler__etiqueta";
    const hora = document.createElement("span");
    hora.className = "alfiler__hora";
    hora.textContent = t.hora;
    const farmaco = document.createElement("span");
    farmaco.className = "alfiler__farmaco";
    farmaco.textContent = t.farmaco + " " + t.dosisMg + " mg";
    etiqueta.append(hora, farmaco);

    const tallo = document.createElement("span");
    tallo.className = "alfiler__tallo";

    alfiler.append(marcaEstado(t.estado), tallo, etiqueta);
    alfiler.addEventListener("click", () => senalarToma(t.id));
    regla.appendChild(alfiler);
  }
}

function escribirParte(parte, datos, adherencia) {
  parte.textContent = "";
  const resumen = datos.resumen || {};
  const trozos = [];
  for (const clave of ["ADMINISTRADA", "PENDIENTE", "VENCIDA", "OMITIDA"]) {
    if (resumen[clave]) trozos.push(resumen[clave] + " " + ETIQUETA_ESTADO[clave] + "s");
  }
  const texto = document.createElement("span");
  texto.textContent = datos.total
    ? "Turno " + datos.turnoActual + ". " + datos.total + " tomas hoy: " + trozos.join(", ") + ". "
    : "Turno " + datos.turnoActual + ". Sin tomas programadas para hoy. ";
  parte.appendChild(texto);

  if (adherencia && adherencia.adherenciaPorcentaje !== null) {
    const b = document.createElement("b");
    b.textContent = adherencia.adherenciaPorcentaje + "%";
    parte.append("Adherencia de los últimos 7 días: ", b, ".");
  }
}

function dibujarRegistro(registro, tomas, resaltar) {
  registro.textContent = "";

  if (!tomas.length) {
    // El vacio dice que hacer, no solo que no hay nada.
    const puedeIndicar = SESION.rol === "MEDICO";
    vacio(registro,
      "Este interno no tiene tomas programadas para hoy",
      puedeIndicar
        ? "Para que aparezcan tomas, indique un medicamento: ms-vigia lo revisa contra la ficha del interno y, si lo aprueba, ms-pastillero reparte las tomas por turno."
        : "El médico tiene que indicar un medicamento y ms-vigia debe aprobarlo. Cuando eso ocurra, las tomas aparecerán aquí repartidas por turno.",
      puedeIndicar ? { texto: "Indicar un medicamento", alPulsar: abrirCajon } : null);
    return;
  }

  for (const turno of ["matutino", "vespertino", "nocturno"]) {
    const delTurno = tomas.filter((t) => t.turno === turno);
    if (!delTurno.length) continue;
    const bloque = document.createElement("section");
    bloque.className = "turno";
    const titulo = document.createElement("h4");
    titulo.className = "turno__titulo";
    const izquierda = document.createElement("span");
    izquierda.textContent = "turno " + turno;
    const derecha = document.createElement("span");
    derecha.textContent = delTurno.length + (delTurno.length === 1 ? " toma" : " tomas");
    titulo.append(izquierda, derecha);
    bloque.appendChild(titulo);
    delTurno.forEach((t) => bloque.appendChild(filaToma(t)));
    registro.appendChild(bloque);
  }

  if (resaltar) senalarToma(resaltar);
}

function filaToma(t) {
  const fila = document.createElement("div");
  fila.className = "toma toma--" + t.estado;
  fila.dataset.tomaId = t.id;

  const hora = document.createElement("div");
  hora.className = "toma__hora";
  hora.textContent = t.hora;

  const centro = document.createElement("div");
  const farmaco = document.createElement("div");
  farmaco.className = "toma__farmaco";
  farmaco.textContent = t.farmaco;
  const detalle = document.createElement("small");
  detalle.textContent = t.dosisMg + " mg · vía " + t.via;
  farmaco.appendChild(detalle);
  centro.appendChild(farmaco);

  const cerrada = t.estado === "ADMINISTRADA" || t.estado === "OMITIDA";
  if (cerrada) {
    const pie = document.createElement("p");
    pie.className = "toma__pie";
    pie.textContent = (t.enfermero || "enfermería") + (t.observacion ? " · " + t.observacion : "");
    centro.appendChild(pie);
  }

  const acciones = document.createElement("div");
  acciones.className = "toma__acciones";

  const marbete = document.createElement("span");
  marbete.className = "estado";
  marbete.dataset.estado = t.estado;
  marbete.append(marcaEstado(t.estado));
  const palabra = document.createElement("span");
  palabra.textContent = ETIQUETA_ESTADO[t.estado];
  marbete.appendChild(palabra);
  acciones.appendChild(marbete);

  // Registrar u omitir una toma es tarea clinica, igual que exige el gateway.
  const puedeRegistrar = SESION.rol === "MEDICO" || SESION.rol === "ENFERMERIA";
  if (!cerrada && puedeRegistrar) {
    const dar = document.createElement("button");
    dar.className = "accion-sec";
    dar.type = "button";
    dar.textContent = "Registrar administración";
    dar.addEventListener("click", () => pedirConfirmacionAdministrar(t));

    const saltar = document.createElement("button");
    saltar.className = "accion-sec accion-sec--suave";
    saltar.type = "button";
    saltar.textContent = "Omitir";
    saltar.addEventListener("click", () => pedirMotivo(fila, t));

    acciones.append(dar, saltar);
  }

  fila.append(hora, centro, acciones);
  return fila;
}

function senalarToma(tomaId) {
  const fila = document.querySelector('[data-toma-id="' + CSS.escape(tomaId) + '"]');
  if (!fila) return;
  document.querySelectorAll(".toma--cambiada").forEach((n) => n.classList.remove("toma--cambiada"));
  fila.classList.add("toma--cambiada");
  fila.scrollIntoView({ block: "center", behavior: "smooth" });
}

// Acto clinico irreversible: se confirma mostrando a quien, que y cuando.
async function pedirConfirmacionAdministrar(t) {
  const ficha = INTERNOS[estado.interno];
  const seguro = await confirmar({
    titulo: "¿Registrar esta administración?",
    textoSi: "Sí, registrar",
    datos: [
      ["Interno", ficha.nombre + " · " + ficha.pacienteId],
      ["Fármaco", t.farmaco],
      ["Dosis", t.dosisMg + " mg · vía " + t.via],
      ["Hora programada", t.hora + (t.estado === "VENCIDA" ? " (vencida)" : "")]
    ],
    aviso: "Queda firmado a su nombre en la hoja de administración y no se puede registrar dos veces."
  });
  if (!seguro) return;
  registrar(t, "administrar", { observacion: "Toma sin incidencias" });
}

function pedirMotivo(fila, t) {
  if (fila.querySelector(".motivo")) return;
  const caja = document.createElement("div");
  caja.className = "motivo";

  const entrada = document.createElement("input");
  entrada.type = "text";
  entrada.placeholder = "Motivo: el interno rechaza la toma, náusea, ayuno para laboratorio…";
  entrada.setAttribute("aria-label", "Motivo de la omisión");

  const boton = document.createElement("button");
  boton.className = "accion-sec accion-sec--suave";
  boton.type = "button";
  boton.textContent = "Registrar la omisión";
  boton.addEventListener("click", () => {
    if (!entrada.value.trim()) {
      aviso("Falta el motivo", "Toda omisión necesita un motivo escrito.", "aviso");
      entrada.focus();
      return;
    }
    registrar(t, "omitir", { motivo: entrada.value.trim() });
  });

  caja.append(entrada, boton);
  fila.appendChild(caja);
  entrada.focus();
}

async function registrar(t, accion, cuerpo) {
  const ficha = INTERNOS[estado.interno];
  try {
    const respuesta = await pedir(PASTILLERO + "/api/v1/tomas/" + t.id + "/" + accion, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    });
    // Se dice que cambio y la fila afectada queda resaltada.
    const puntual = respuesta.puntual ? "a tiempo" :
      "con " + Math.abs(respuesta.desfaseMinutos) + " min de desfase";
    aviso(
      accion === "administrar" ? "Administración registrada" : "Omisión registrada",
      t.farmaco + " " + t.dosisMg + " mg de las " + t.hora + " · " +
      ficha.nombre + " · " + puntual + " · firma " + respuesta.enfermero,
      "ok");
    await pintarJornada(t.id);
    await cargarInternos();
  } catch (error) {
    avisarError(error, accion === "administrar" ? "registrar la administración" : "registrar la omisión");
  }
}


const cajon = $("cajon");
const velo = $("velo");
let soltarFocoCajon = null;
let abrioElCajon = null;

// Alimenta DOS desplegables —el recetario y la consulta del especialista— con
// una sola consulta a ms-vigia.
async function cargarVademecum() {
  const destinos = [$("principioActivo"), $("indicacion-principio")].filter(Boolean);
  try {
    const datos = await pedir(VIGIA + "/api/v1/vademecum");
    for (const select of destinos) {
      select.textContent = "";
      for (const f of datos.farmacos) {
        const opcion = document.createElement("option");
        opcion.value = f.principioActivo;
        opcion.textContent = f.nombre + " — " + f.grupo.toLowerCase().replace(/_/g, " ");
        select.appendChild(opcion);
      }
      select.value = "ibuprofeno";
    }
  } catch (_) {
    for (const select of destinos) {
      select.textContent = "";
      const opcion = document.createElement("option");
      opcion.value = "";
      opcion.textContent = "ms-vigia no responde";
      select.appendChild(opcion);
    }
  }
}

function abrirCajon() {
  abrioElCajon = document.activeElement;
  cajon.hidden = false;
  velo.hidden = false;
  $("dictamen").textContent = "";
  estado.dictamen = null;
  soltarFocoCajon = atraparFoco(cajon);
  $("principioActivo").focus();
}

function cerrarCajon() {
  if (cajon.hidden) return;
  cajon.hidden = true;
  velo.hidden = true;
  if (soltarFocoCajon) { soltarFocoCajon(); soltarFocoCajon = null; }
  // El foco vuelve al boton que lo abrio.
  if (abrioElCajon && abrioElCajon.focus && document.contains(abrioElCajon)) abrioElCajon.focus();
  abrioElCajon = null;
}

$("abrir-cajon").addEventListener("click", abrirCajon);
$("cerrar-cajon").addEventListener("click", cerrarCajon);
velo.addEventListener("click", cerrarCajon);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // La informacion clinica se abre encima de la ficha: Escape cierra solo la
  // de arriba.
  if (!$("cajon-clinica").hidden) { cerrarClinica(); return; }
  if (!cajon.hidden) cerrarCajon();
  if (!$("cajon-remision").hidden) cerrarRemision();
  if (!$("cajon-visita").hidden) cerrarVisita();
  if (!$("cajon-ficha").hidden) cerrarFicha();
  if (!$("cajon-interno").hidden) cerrarFormularioInterno();
  if (!$("cajon-egreso").hidden) cerrarEgreso();
  if (!$("cajon-usuario").hidden) cerrarFormularioUsuario();
  if (!$("cajon-desactivar").hidden) cerrarDesactivar();
  if (!$("cajon-bitacora").hidden) cerrarBitacora();
  // El cambio voluntario se cancela con Escape; el obligatorio no tiene a
  // donde volver. El cuadro de la clave temporal tampoco se cierra asi.
  if (!$("cambio-clave").hidden && modoCambio === "voluntario") ocultarCambioClave();
});

$("formulario").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const boton = $("someter");
  const receta = {
    principioActivo: $("principioActivo").value,
    dosisMg: parseFloat($("dosisMg").value),
    cadaHoras: parseFloat($("cadaHoras").value),
    dias: parseInt($("dias").value, 10),
    via: $("via").value,
    indicacion: $("indicacion").value
  };
  estado.receta = receta;

  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Consultando a ms-vigia…";
  esqueleto($("dictamen"), 3);

  try {
    // Se manda solo a quien se le receta y que. La edad, las alergias y la
    // medicacion las busca ms-vigia por su cuenta en ms-pastillero.
    const dictamen = await pedir(VIGIA + "/api/v1/validaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pacienteId: estado.interno,
        propuesta: {
          principioActivo: receta.principioActivo,
          dosisMg: receta.dosisMg,
          cadaHoras: receta.cadaHoras,
          viaAdministracion: receta.via
        }
      })
    });
    estado.dictamen = dictamen;
    pintarDictamen(dictamen);
  } catch (error) {
    problema($("dictamen"), error, "someter la prescripción a revisión", null);
    if (error.sesionExpirada) sesionExpirada();
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});

const SIMBOLO_VEREDICTO = { BLOQUEADO: "⛔", ADVERTENCIA: "⚠", APROBADO: "✓" };

// Contenido del servidor: se construye con nodos y textContent, nunca con
// innerHTML.
function pintarDictamen(d, contenedor, conBotonProgramar) {
  const caja = contenedor || $("dictamen");
  caja.textContent = "";
  caja.className = "dictamen dictamen--" + d.veredicto;

  const banda = document.createElement("div");
  banda.className = "dictamen__banda";

  const veredicto = document.createElement("p");
  veredicto.className = "dictamen__veredicto";
  const simbolo = document.createElement("span");
  simbolo.className = "dictamen__simbolo";
  simbolo.setAttribute("aria-hidden", "true");
  simbolo.textContent = SIMBOLO_VEREDICTO[d.veredicto] || "";
  const palabra = document.createElement("span");
  palabra.textContent = d.veredicto;
  veredicto.append(simbolo, palabra);

  const resumen = document.createElement("p");
  resumen.className = "dictamen__resumen";
  resumen.textContent = d.resumen;

  const folio = document.createElement("p");
  folio.className = "dictamen__folio";
  folio.textContent = d.folio
    ? "folio " + d.folio + (d.puntajeRiesgo ? " · riesgo " + d.puntajeRiesgo + " de 100" : "")
    : "";

  banda.append(veredicto, resumen, folio);
  caja.appendChild(banda);

  for (const h of d.hallazgos) {
    const bloque = document.createElement("div");
    bloque.className = "hallazgo hallazgo--" + h.severidad;

    const marbete = document.createElement("p");
    marbete.className = "hallazgo__marbete";
    marbete.textContent =
      h.codigo + " · " + h.tipo.replace(/_/g, " ").toLowerCase() +
      " · severidad " + h.severidad.toLowerCase();

    const mensaje = document.createElement("p");
    mensaje.textContent = h.mensaje;

    const salida = document.createElement("p");
    salida.className = "hallazgo__salida";
    salida.textContent = h.recomendacion;

    bloque.append(marbete, mensaje, salida);
    caja.appendChild(bloque);
  }

  // Solo aplica al recetario de la jornada: en la consulta del especialista la
  // receta ya quedo guardada por ms-consultas.
  if (d.veredicto !== "BLOQUEADO" && conBotonProgramar !== false) {
    const boton = document.createElement("button");
    boton.className = "accion accion--ancha";
    boton.type = "button";
    boton.style.marginTop = "20px";
    boton.textContent = "Programar el tratamiento";
    boton.addEventListener("click", () => programar(boton));
    caja.appendChild(boton);
  }
}

async function programar(boton) {
  const d = estado.dictamen;
  const r = estado.receta;
  const ficha = INTERNOS[estado.interno];
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Programando…";
  try {
    const plan = await pedir(PASTILLERO + "/api/v1/planes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pacienteId: estado.interno,
        pacienteNombre: ficha.nombre,
        principioActivo: r.principioActivo,
        farmaco: d.propuesta.nombre,
        dosisMg: r.dosisMg,
        cadaHoras: r.cadaHoras,
        dias: r.dias,
        via: r.via,
        indicacion: r.indicacion,
        folioValidacion: d.folio
      })
    });
    aviso("Tratamiento programado",
      plan.tomasProgramadas + " tomas de " + d.propuesta.nombre + " para " + ficha.nombre +
      ". La primera, a las " + plan.primeraToma.slice(11) + ".", "ok");
    cerrarCajon();
    await cargarInterno();
    await cargarInternos();
  } catch (error) {
    avisarError(error, "programar el tratamiento");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}


// El conteo lleva al informe completo: el mismo dato, con el detalle.
function enlaceCitasPendientes(n) {
  const enlace = document.createElement("a");
  enlace.href = "#/reportes";
  enlace.className = "enlace-dato";
  enlace.textContent = n + " · ver el informe";
  enlace.addEventListener("click", (evento) => {
    evento.preventDefault();
    informePedido = "citas-pendientes";
    irA({ vista: "reportes", interno: estado.interno });
  });
  return enlace;
}

async function pintarCaja() {
  const interno = INTERNOS[estado.interno];
  if (!interno) return;
  $("caja-interno-nombre").textContent = interno.nombre;
  $("caja-meta").textContent = SESION.rol === "ADMINISTRACION"
    ? "Módulo de entradas, salidas y caja: cobros con el descuento de la fundación, donaciones y gastos del asilo."
    : "Cargos y saldo del interno seleccionado. Le sirve para saber si la familia puede costear un estudio antes de indicarlo.";

  const resumenNodo = $("caja-resumen");
  resumenNodo.textContent = "";
  // El balance del asilo es solo de administracion: el medico entra aqui
  // unicamente por el estado de cuenta del interno.
  if (SESION.rol === "ADMINISTRACION") {
    esqueleto(resumenNodo, 4);
    try {
      // Las cuentas con la fundacion, en la misma ida: van en el mismo resumen.
      const [resumen, fundacion] = await Promise.all([
        pedir(CAJA + "/api/v1/resumen"),
        pedir(CAJA + "/api/v1/fundacion/resumen"),
      ]);
      saldoFundacion = fundacion.saldoConFundacion;
      $("fundacion-nota").textContent = "Saldo con la fundación: " +
        quetzales(fundacion.saldoConFundacion) + ". No se acepta un pago mayor que el saldo.";
      resumenNodo.textContent = "";
      resumenNodo.append(
        campo("Entradas (donaciones + cobros)", "Q " + resumen.entradas.total.toFixed(2)),
        campo("Salidas (gastos + adeudo fundación)", "Q " + resumen.salidas.total.toFixed(2)),
        campo("Saldo pendiente de familiares", "Q " + resumen.saldoPendienteFamiliares.toFixed(2)),
        campo("Balance", "Q " + resumen.balance.toFixed(2)),
        campo("Citas con saldo pendiente", enlaceCitasPendientes(resumen.citasConSaldoPendiente)),
        campo("Adeudado a la fundación", quetzales(fundacion.totalAdeudado)),
        campo("Pagado a la fundación", quetzales(fundacion.totalPagado)),
        campo("Saldo con la fundación", quetzales(fundacion.saldoConFundacion))
      );
    } catch (error) {
      problema(resumenNodo, error, "consultar el resumen financiero", pintarCaja);
      if (error.sesionExpirada) { sesionExpirada(); return; }
    }
  }

  const cargosNodo = $("caja-cargos");
  esqueleto(cargosNodo, 3, true);
  try {
    const cuenta = await pedir(CAJA + "/api/v1/pacientes/" + estado.interno + "/cuenta");
    $("caja-saldo").textContent = "saldo pendiente Q " + cuenta.saldoPendiente.toFixed(2);
    cargosNodo.textContent = "";
    if (!cuenta.cargos.length) {
      vacio(cargosNodo,
        "Este interno todavía no tiene cargos",
        SESION.rol === "ADMINISTRACION"
          ? "Cuando se le cargue una consulta, un laboratorio, farmacia o la cuota de estadía, aparecerá aquí con el descuento de la fundación ya aplicado. Use el formulario de abajo para registrar el primero."
          : "Todavía no se le ha cargado ninguna consulta, laboratorio ni cuota a la cuenta de este interno.");
    } else {
      cuenta.cargos.forEach((c) => cargosNodo.appendChild(filaCargo(c)));
    }
    // Solo administracion, igual que el resto de la caja.
    if (SESION.rol === "ADMINISTRACION") await pintarCostosPorVisita(cuenta.cargos);
  } catch (error) {
    $("caja-saldo").textContent = "";
    problema(cargosNodo, error, "consultar el estado de cuenta", pintarCaja);
    if (error.sesionExpirada) { sesionExpirada(); return; }
  }

  if (SESION.rol === "ADMINISTRACION") await cargarTarifasCaja();
}

function filaCargo(c) {
  const fila = document.createElement("div");
  fila.className = "cargo";

  const categoria = document.createElement("div");
  categoria.className = "cargo__categoria";
  categoria.textContent = c.categoria.toLowerCase();

  const concepto = document.createElement("div");
  concepto.className = "cargo__concepto";
  concepto.textContent = c.concepto;
  const fecha = document.createElement("small");
  fecha.textContent = new Date(c.creadoEn).toLocaleDateString("es-GT");
  concepto.appendChild(fecha);

  const monto = document.createElement("div");
  monto.className = "cargo__monto";
  monto.textContent = "Q " + c.montoNeto.toFixed(2);
  const marbete = document.createElement("small");
  const estadoPago = document.createElement("span");
  estadoPago.className = "estado-pago";
  estadoPago.dataset.estado = c.estado;
  estadoPago.textContent = c.estado.toLowerCase();
  marbete.appendChild(estadoPago);
  monto.appendChild(marbete);

  const acciones = document.createElement("div");
  acciones.className = "cargo__acciones";
  if (SESION.rol === "ADMINISTRACION" && c.estado !== "PAGADO") {
    const boton = document.createElement("button");
    boton.className = "accion-sec";
    boton.type = "button";
    boton.textContent = "Pagar Q " + c.saldo.toFixed(2);
    boton.addEventListener("click", () => pagarCargo(c));
    acciones.appendChild(boton);
  }

  fila.append(categoria, concepto, monto, acciones);
  return fila;
}

// Mueve dinero de una familia: se confirma.
async function pagarCargo(c) {
  const interno = INTERNOS[estado.interno];
  const seguro = await confirmar({
    titulo: "¿Registrar este pago?",
    textoSi: "Sí, registrar el pago",
    datos: [
      ["Interno", interno.nombre + " · " + interno.pacienteId],
      ["Concepto", c.concepto],
      ["Monto a recibir", "Q " + c.saldo.toFixed(2)],
      ["Método", "efectivo"]
    ],
    aviso: "Queda asentado en el libro de caja a su nombre y no se puede anular desde el sistema."
  });
  if (!seguro) return;

  try {
    const pago = await pedir(CAJA + "/api/v1/cargos/" + c.id + "/pagar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monto: c.saldo, metodo: "efectivo" })
    });
    aviso("Pago registrado",
      "Q " + pago.monto.toFixed(2) + " de " + interno.nombre + " · " + c.concepto +
      " · el cargo queda " + pago.estadoCargo.toLowerCase() + ".", "ok");
    await pintarCaja();
  } catch (error) {
    avisarError(error, "registrar el pago");
  }
}

async function cargarTarifasCaja() {
  if (TARIFAS_CAJA.length) return;
  const select = $("cargo-tarifa");
  try {
    const datos = await pedir(CAJA + "/api/v1/tarifas");
    TARIFAS_CAJA = datos.tarifas;
    select.textContent = "";
    for (const t of TARIFAS_CAJA) {
      const opcion = document.createElement("option");
      opcion.value = t.clave;
      opcion.textContent = t.nombre + " — Q " + t.precioFundacion.toFixed(2) +
        (t.descuentoPct ? " (" + t.descuentoPct + "% de descuento)" : " (sin descuento)");
      select.appendChild(opcion);
    }
    ajustarCampoMes();
    select.addEventListener("change", ajustarCampoMes);
    // Ya hay tarifario: la nota del formulario de cuotas puede decir cuanto.
    prepararCuotas();
  } catch (_) {
    select.textContent = "";
    const opcion = document.createElement("option");
    opcion.value = "";
    opcion.textContent = "ms-caja no responde";
    select.appendChild(opcion);
  }
}

async function enviarFormulario(formulario, construir, url, exito, accion) {
  const boton = formulario.querySelector('button[type="submit"]');
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Registrando…";
  try {
    const cuerpo = construir();
    if (!cuerpo) return;
    const respuesta = await pedir(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    });
    formulario.reset();
    if (formulario.id === "formulario-cargo") ajustarCampoMes();
    exito(respuesta, cuerpo);
    await pintarCaja();
  } catch (error) {
    avisarError(error, accion);
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}

// El mes solo tiene sentido en la cuota, asi que el campo aparece cuando la
// tarifa elegida es de esa categoria y desaparece con las demas. Se le pone y
// se le quita required a la vez que se muestra: un campo obligatorio y oculto
// bloquea el envio sin decir por que.
function ajustarCampoMes() {
  const clave = $("cargo-tarifa").value;
  const tarifa = TARIFAS_CAJA.find((t) => t.clave === clave);
  const esCuota = !!tarifa && tarifa.categoria === "CUOTA";
  $("campo-cargo-mes").hidden = !esCuota;
  $("cargo-mes").required = esCuota;
  if (esCuota) {
    if (!$("cargo-mes").value) $("cargo-mes").value = mesActualISO();
  } else {
    $("cargo-mes").value = "";
  }
}

$("formulario-cargo").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const interno = INTERNOS[estado.interno];
  enviarFormulario($("formulario-cargo"), () => {
    const clave = $("cargo-tarifa").value;
    const tarifa = TARIFAS_CAJA.find((t) => t.clave === clave);
    if (!tarifa) { aviso("Elija una tarifa", "Seleccione una tarifa del catálogo.", "aviso"); return null; }
    const cuerpo = {
      pacienteId: estado.interno,
      pacienteNombre: interno.nombre,
      categoria: tarifa.categoria,
      concepto: $("cargo-concepto").value.trim(),
      tarifa: clave
    };
    if (tarifa.categoria === "CUOTA") {
      // Sin el mes, ms-caja no puede distinguir esta cuota de la que genera la
      // pantalla de cuotas, y la familia terminaria pagando la estadia dos
      // veces. Por eso se pide aqui y el servidor tambien lo exige.
      const mes = $("cargo-mes").value;
      if (!mes) {
        aviso("Falta el mes", "Indique el mes de estadía que cubre la cuota.", "aviso");
        return null;
      }
      cuerpo.mes = mes;
    }
    return cuerpo;
  }, CAJA + "/api/v1/cargos",
    (r) => aviso("Cargo registrado",
      r.concepto + " · Q " + r.montoNeto.toFixed(2) + " a la cuenta de " + interno.nombre +
      (r.descuentoPct ? " (con " + r.descuentoPct + "% de descuento de la fundación)" : "") + ".", "ok"),
    "registrar el cargo");
});

$("formulario-donacion").addEventListener("submit", (evento) => {
  evento.preventDefault();
  enviarFormulario($("formulario-donacion"), () => ({
    donante: $("donacion-donante").value.trim(),
    tipo: $("donacion-tipo").value,
    monto: parseFloat($("donacion-monto").value)
  }), CAJA + "/api/v1/donaciones",
    (r) => aviso("Donación registrada",
      "Q " + r.monto.toFixed(2) + " de " + r.donante + ". Gracias.", "ok"),
    "registrar la donación");
});

// El saldo con la fundacion que se mostro por ultima vez, para la
// confirmacion. Quien decide es el servidor, que rechaza pagar de mas.
let saldoFundacion = null;

$("formulario-fundacion").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const montoTexto = $("fundacion-monto").value.trim();
  const referencia = $("fundacion-referencia").value.trim();
  const monto = Number(montoTexto);
  if (!(monto > 0) || referencia.length < 3) {
    aviso("Faltan datos del pago", "Indique el monto y la referencia del recibo o la transferencia.", "aviso");
    return;
  }
  const seguro = await confirmar({
    titulo: "¿Registrar un pago de " + quetzales(monto) + " a la fundación?",
    textoSi: "Sí, registrar el pago",
    datos: [
      ["Monto", quetzales(monto)],
      ["Referencia", referencia],
      ["Saldo con la fundación", saldoFundacion == null ? "—" : quetzales(saldoFundacion)],
      ["Saldo después del pago", saldoFundacion == null ? "—" : quetzales(saldoFundacion - monto)],
    ],
    aviso: "Queda firmado con su sesión y aparece en el informe de pagos a la fundación.",
  });
  if (!seguro) return;

  const boton = $("registrar-pago-fundacion");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Registrando…";
  try {
    // El monto viaja como texto: el servidor lo lee como DECIMAL, sin pasar
    // por coma flotante.
    const r = await pedir(CAJA + "/api/v1/fundacion/pagos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monto: montoTexto, referencia }),
    });
    $("formulario-fundacion").reset();
    aviso("Pago a la fundación registrado",
      quetzales(r.monto) + " · " + r.referencia + " · queda un saldo de " +
      quetzales(r.saldoConFundacion) + ".", "ok");
    await pintarCaja();
  } catch (error) {
    if (error.estado === 400 && error.cuerpo && error.cuerpo.error) {
      aviso("No se registró el pago", error.cuerpo.error, "aviso");
    } else {
      avisarError(error, "registrar el pago a la fundación");
    }
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});

$("formulario-gasto").addEventListener("submit", (evento) => {
  evento.preventDefault();
  enviarFormulario($("formulario-gasto"), () => ({
    concepto: $("gasto-concepto").value.trim(),
    categoria: $("gasto-categoria").value,
    monto: parseFloat($("gasto-monto").value)
  }), CAJA + "/api/v1/gastos",
    (r) => aviso("Gasto registrado",
      r.concepto + " · Q " + r.monto.toFixed(2) + " · " + r.categoria.toLowerCase() + ".", "ok"),
    "registrar el gasto");
});


// Consultas · la cadena clinica. Cuatro pantallas sobre el mismo servicio,
// una por rol.

const estadoConsultas = { visitaAbierta: null, solicitudes: [], visitas: [] };

const ETIQUETA_ESTADO_CADENA = {
  PENDIENTE: "pendiente", AGENDADA: "agendada", ATENDIDA: "atendida",
  CANCELADA: "cancelada", ABIERTA: "abierta", CERRADA: "cerrada",
  SOLICITADO: "solicitado", RESULTADO_LISTO: "resultado listo",
  ENVIADO: "enviado", REGISTRADO: "registrado", FALLIDO: "falló",
  SIN_DESTINATARIO: "sin correo"
};

function marbeteEstado(estadoNombre, textoPropio) {
  const nodo = document.createElement("span");
  nodo.className = "marbete-estado";
  nodo.dataset.estado = estadoNombre;
  nodo.textContent = textoPropio ||
    ETIQUETA_ESTADO_CADENA[estadoNombre] || estadoNombre.toLowerCase();
  return nodo;
}

// Fecha legible, sin depender de la configuración regional del equipo.
function fechaLegible(iso) {
  if (!iso) return "sin fecha";
  const f = new Date(iso);
  if (isNaN(f.getTime())) return iso;
  return f.toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " · " + f.toTimeString().slice(0, 5);
}

// El nombre del interno si está en el padrón; si no, su código. Los roles
// operativos no leen ms-pastillero, así que trabajan con el código.
function nombreDeInterno(pacienteId) {
  const ficha = INTERNOS[pacienteId];
  return ficha ? ficha.nombre : pacienteId;
}

function campoFicha(rotulo, valor, clase) {
  const caja = document.createElement("div");
  caja.className = "visita__campo";
  const r = document.createElement("p");
  r.className = "visita__rotulo";
  r.textContent = rotulo;
  const v = document.createElement("p");
  v.className = clase || "visita__observaciones";
  if (valor) {
    v.textContent = valor;
  } else {
    v.classList.add("visita__sinllenar");
    v.textContent = "sin llenar";
  }
  caja.append(r, v);
  return caja;
}


async function pintarConsultas() {
  const interno = INTERNOS[estado.interno];
  if (!interno) return;
  $("consultas-meta").textContent =
    interno.nombre + " · " + interno.pacienteId + " · " + interno.edad + " años";
  await Promise.all([pintarSolicitudes(), pintarCorreos(), pintarExamenes(), pintarHistorial()]);
}


async function pintarCorreos() {
  const nodo = $("lista-correos");
  esqueleto(nodo, 2, true);
  let datos;
  try {
    datos = await pedir(CONSULTAS + "/api/v1/correos?pacienteId=" + estado.interno);
  } catch (error) {
    problema(nodo, error, "consultar los avisos a la familia", pintarCorreos);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  $("correos-conteo").textContent =
    datos.total + (datos.total === 1 ? " aviso" : " avisos");

  // Se explica por qué el estado dice "registrado" y no "enviado".
  const nota = $("correos-nota");
  nota.textContent = datos.smtpConfigurado
    ? "Hay un servidor de correo configurado: los avisos salen de verdad."
    : "No hay servidor de correo configurado, así que los avisos no salen a Internet. " +
      "Se generan igual, quedan guardados y se muestran aquí completos.";

  nodo.textContent = "";
  if (!datos.total) {
    vacio(nodo, "Todavía no se le ha avisado a ninguna familia",
      "Cada vez que remita a este interno a una especialidad, se genera un aviso " +
      "para su familiar responsable y aparece aquí con el texto completo.");
    return;
  }

  for (const c of datos.correos) {
    const ficha = document.createElement("div");
    ficha.className = "ficha ficha--" + (c.estado === "ENVIADO" ? "ATENDIDA" : "SOLICITADO");

    const cuerpo = document.createElement("div");
    const asunto = document.createElement("p");
    asunto.className = "correo__asunto";
    asunto.textContent = c.asunto;
    const dato = document.createElement("p");
    dato.className = "ficha__dato";
    dato.textContent = "para " + (c.destinatario || "(la ficha no tiene correo del familiar)") +
      " · " + fechaLegible(c.enviadoEn) + " · " + c.solicitudId;
    cuerpo.append(asunto, dato);

    const acciones = document.createElement("div");
    acciones.className = "ficha__acciones";
    acciones.appendChild(marbeteEstado(c.estado));
    const ver = document.createElement("button");
    ver.className = "accion-sec";
    ver.type = "button";
    ver.textContent = "Ver el correo";
    acciones.appendChild(ver);

    const texto = document.createElement("pre");
    texto.className = "correo__cuerpo";
    texto.textContent = c.cuerpo;
    texto.hidden = true;
    ver.addEventListener("click", () => {
      texto.hidden = !texto.hidden;
      ver.textContent = texto.hidden ? "Ver el correo" : "Ocultar";
    });

    ficha.append(cuerpo, acciones, texto);
    nodo.appendChild(ficha);
  }
}


async function pintarExamenes() {
  const nodo = $("lista-examenes");
  esqueleto(nodo, 2, true);
  let datos;
  try {
    datos = await pedir(CONSULTAS + "/api/v1/reportes/examenes?pacienteId=" + estado.interno);
  } catch (error) {
    problema(nodo, error, "consultar los exámenes del interno", pintarExamenes);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  $("examenes-conteo").textContent = datos.total === 0
    ? "ninguno"
    : datos.total + (datos.total === 1 ? " examen · " : " exámenes · ") +
      datos.conResultado + " con resultado";

  nodo.textContent = "";
  if (!datos.total) {
    vacio(nodo, "A este interno todavía no se le ha hecho ningún examen",
      "Los exámenes los indica el especialista durante la consulta, y el laboratorio " +
      "carga el resultado después. Aparecerán aquí en cuanto se indique el primero.");
    return;
  }

  for (const e of datos.examenes) {
    const ficha = document.createElement("div");
    ficha.className = "ficha ficha--" + e.estado;

    const cuerpo = document.createElement("div");
    const titulo = document.createElement("p");
    titulo.className = "ficha__titulo";
    titulo.textContent = e.nombre;

    const dato = document.createElement("p");
    dato.className = "ficha__dato";
    // De qué consulta salió: suelto no dice a qué pregunta responde.
    dato.textContent = fechaLegible(e.fechaVisita) + " · " +
      (e.especialidad || "sin especialidad") + " · " +
      (e.medicoTratante || "sin médico asignado");
    cuerpo.append(titulo, dato);

    if (e.resultado) {
      const resultado = document.createElement("p");
      resultado.className = "ficha__resultado";
      resultado.textContent = e.resultado;
      cuerpo.appendChild(resultado);
    }

    const acciones = document.createElement("div");
    acciones.className = "ficha__acciones";
    acciones.appendChild(marbeteEstado(e.estado));

    ficha.append(cuerpo, acciones);
    nodo.appendChild(ficha);
  }
}


// Ficha médica completa: junta lo del padrón —psicopatologías y alergias— con
// lo de la cadena clínica.

let soltarFocoFicha = null;
let abrioLaFicha = null;

function lineaDato(rotulo, valor) {
  const caja = document.createElement("div");
  caja.className = "visita__campo";
  const r = document.createElement("dt");
  r.textContent = rotulo;
  const v = document.createElement("dd");
  if (valor) {
    v.textContent = valor;
  } else {
    v.classList.add("visita__sinllenar");
    v.textContent = "sin llenar";
  }
  caja.append(r, v);
  return caja;
}

// null es "el padrón no lo entregó" y [] es "no tiene". Mostrarlos igual, en
// alergias, es peligroso.
function comoLista(valores, vacioTexto) {
  if (valores === null || valores === undefined) {
    const p = document.createElement("p");
    p.className = "parte";
    p.textContent = "Este dato no se pudo traer del padrón.";
    return p;
  }
  if (!valores.length) {
    const p = document.createElement("p");
    p.className = "parte";
    p.textContent = vacioTexto;
    return p;
  }
  const ul = document.createElement("ul");
  ul.className = "lista-ficha";
  for (const v of valores) {
    const li = document.createElement("li");
    li.textContent = v;
    ul.appendChild(li);
  }
  return ul;
}

function listaFicha(titulo, valores, vacioTexto) {
  const seccion = document.createElement("section");
  seccion.className = "bloque";
  const cab = document.createElement("div");
  cab.className = "bloque__cabecera";
  const h = document.createElement("h3");
  h.textContent = titulo;
  cab.appendChild(h);
  seccion.appendChild(cab);
  seccion.appendChild(comoLista(valores, vacioTexto));
  return seccion;
}

function sublistaFicha(titulo, valores, vacioTexto) {
  const caja = document.createElement("div");
  const h = document.createElement("p");
  h.className = "ficha__rotulo";
  h.textContent = titulo;
  caja.append(h, comoLista(valores, vacioTexto));
  return caja;
}

async function abrirFicha(evento) {
  if (evento && evento.currentTarget) abrioLaFicha = evento.currentTarget;
  const cuerpo = $("ficha-cuerpo");
  $("ficha-pie").textContent = "";
  esqueleto(cuerpo, 4, true);
  $("cajon-ficha").hidden = false;
  $("velo-ficha").hidden = false;
  if (!soltarFocoFicha) soltarFocoFicha = atraparFoco($("cajon-ficha"));
  $("cerrar-ficha").focus();

  let f;
  try {
    f = await pedir(CONSULTAS + "/api/v1/reportes/ficha?pacienteId=" + estado.interno);
  } catch (error) {
    problema(cuerpo, error, "traer la ficha médica completa", () => abrirFicha());
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  cuerpo.textContent = "";
  const id = f.identificacion || {};

  // Es un documento clínico: se firma con quién lo sacó y cuándo.
  $("ficha-pie").textContent = "Generada el " + fechaLegible(f.generadoEn) +
    " a solicitud de " + f.generadoPor + ".";

  const datos = document.createElement("dl");
  datos.className = "datos";
  datos.append(
    lineaDato("Interno", id.nombre || f.pacienteId),
    lineaDato("Código", f.pacienteId),
    lineaDato("Edad", id.edad ? id.edad + " años" : null),
    lineaDato("Cama", id.ubicacion),
    lineaDato("Ingreso", id.ingreso),
    lineaDato("Responsable", id.responsable),
    lineaDato("Correo del responsable", id.correoResponsable)
  );
  cuerpo.appendChild(datos);

  if (f.advertencia) {
    const aviso = document.createElement("p");
    aviso.className = "parte";
    aviso.textContent = f.advertencia;
    cuerpo.appendChild(aviso);
  }

  cuerpo.appendChild(listaFicha("Psicopatologías", f.psicopatologias,
    "No se registran psicopatologías en el padrón."));
  cuerpo.appendChild(listaFicha("Alergias", f.alergias,
    "No se registran alergias en el padrón."));

  const seccion = document.createElement("section");
  seccion.className = "bloque";
  const cab = document.createElement("div");
  cab.className = "bloque__cabecera";
  const h = document.createElement("h3");
  h.textContent = "Historial de consultas";
  const nota = document.createElement("span");
  nota.className = "bloque__nota";
  // El singular importa: es la cabecera de un documento clínico.
  const cuenta = (n, uno, varios) => n + " " + (n === 1 ? uno : varios);
  nota.textContent = [
    cuenta(f.resumen.visitas, "consulta", "consultas"),
    cuenta(f.resumen.examenes, "examen", "exámenes"),
    cuenta(f.resumen.medicamentosIndicados, "medicamento", "medicamentos"),
  ].join(" · ");
  cab.append(h, nota);
  seccion.appendChild(cab);

  if (!f.visitas.length) {
    const p = document.createElement("p");
    p.className = "parte";
    p.textContent = "Este interno todavía no ha sido atendido por ningún especialista.";
    seccion.appendChild(p);
  } else {
    for (const v of f.visitas) {
      const caja = document.createElement("article");
      caja.className = "ficha ficha--documento ficha--" + v.estado;

      const enc = document.createElement("p");
      enc.className = "ficha__titulo";
      enc.textContent = (v.especialidad || "Consulta") + " · " + fechaLegible(v.fechaVisita);
      const quien = document.createElement("p");
      quien.className = "ficha__dato";
      quien.textContent = (v.medicoTratante || "sin médico asignado") + " · " + v.id;
      caja.append(enc, quien, marbeteEstado(v.estado));

      const detalle = document.createElement("dl");
      detalle.className = "datos";
      detalle.append(
        lineaDato("Motivo", v.motivo),
        lineaDato("Diagnóstico", v.diagnostico),
        lineaDato("Observaciones", v.observaciones)
      );
      caja.appendChild(detalle);

      caja.appendChild(sublistaFicha("Exámenes", (v.examenes || []).map((e) =>
        e.nombre + " — " + (e.resultado || "sin resultado todavía")),
        "No se indicaron exámenes en esta consulta."));
      caja.appendChild(sublistaFicha("Medicamentos", (v.indicaciones || []).map((i) =>
        i.nombre + " " + i.dosisMg + " mg cada " + i.cadaHoras + " h por " +
        i.duracionDias + " días" + (i.entregado ? " · entregado" : " · sin entregar")),
        "No se recetó nada en esta consulta."));

      seccion.appendChild(caja);
    }
  }
  cuerpo.appendChild(seccion);
}

function cerrarFicha() {
  if ($("cajon-ficha").hidden) return;
  $("cajon-ficha").hidden = true;
  $("velo-ficha").hidden = true;
  if (soltarFocoFicha) { soltarFocoFicha(); soltarFocoFicha = null; }
  if (abrioLaFicha && abrioLaFicha.focus && document.contains(abrioLaFicha)) {
    abrioLaFicha.focus();
  }
  abrioLaFicha = null;
}


// La caja no lleva registro de visitas y no puede listarlas. Pero cada cargo
// trae de qué consulta salió, así que las visitas se sacan de los cargos que
// ya están en pantalla.

async function pintarCostosPorVisita(cargos) {
  const bloque = $("bloque-costos");
  const nodo = $("lista-costos");

  const visitas = [...new Set((cargos || []).map((c) => c.visitaId).filter(Boolean))];
  if (!visitas.length) {
    // Sin cargos de consulta el bloque se esconde: un vacío se leería como
    // un error.
    bloque.hidden = true;
    return;
  }
  bloque.hidden = false;
  $("costos-conteo").textContent =
    visitas.length + (visitas.length === 1 ? " consulta" : " consultas");
  esqueleto(nodo, visitas.length, true);

  let reportes;
  try {
    reportes = await Promise.all(visitas.map((v) =>
      pedir(CAJA + "/api/v1/reportes/costo-por-visita?visitaId=" + encodeURIComponent(v))));
  } catch (error) {
    problema(nodo, error, "calcular el costo de cada consulta",
      () => pintarCostosPorVisita(cargos));
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  nodo.textContent = "";
  for (const r of reportes) {
    const caja = document.createElement("div");
    caja.className = "ficha ficha--documento";

    const titulo = document.createElement("p");
    titulo.className = "ficha__titulo";
    titulo.textContent = "Consulta " + r.visitaId;
    caja.appendChild(titulo);

    const desglose = document.createElement("dl");
    desglose.className = "datos";
    for (const categoria of ["CONSULTA", "LABORATORIO", "FARMACIA"]) {
      const c = r.porCategoria[categoria];
      desglose.appendChild(lineaDato(
        categoria.charAt(0) + categoria.slice(1).toLowerCase(),
        // "sin cargos" y no "sin llenar": el cero no es un campo olvidado,
        // es que la consulta no generó ese gasto.
        c.cantidad
          ? c.cantidad + (c.cantidad === 1 ? " cargo · Q " : " cargos · Q ") +
            c.montoNeto.toFixed(2)
          : "sin cargos"));
    }
    caja.appendChild(desglose);

    const total = document.createElement("p");
    total.className = "ficha__total";
    total.textContent = "Q " + r.totales.montoNeto.toFixed(2) + " a cobrar · la fundación " +
      "descontó Q " + r.totales.descuento.toFixed(2) + " de Q " +
      r.totales.montoBruto.toFixed(2) + " · saldo Q " + r.totales.saldo.toFixed(2);
    caja.appendChild(total);

    nodo.appendChild(caja);
  }
}


async function pintarSolicitudes() {
  const nodo = $("lista-solicitudes");
  esqueleto(nodo, 2, true);
  let datos;
  try {
    datos = await pedir(CONSULTAS + "/api/v1/solicitudes?pacienteId=" + estado.interno);
  } catch (error) {
    problema(nodo, error, "consultar las remisiones", pintarSolicitudes);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  estadoConsultas.solicitudes = datos.solicitudes;
  $("consultas-conteo").textContent =
    datos.total + (datos.total === 1 ? " remisión" : " remisiones");
  nodo.textContent = "";

  if (!datos.total) {
    vacio(nodo, "Este interno no tiene remisiones",
      SESION.rol === "MEDICO"
        ? "Cuando lo remita a una especialidad, la solicitud aparecerá aquí y la fundación le asignará médico y hora."
        : "El médico general todavía no lo ha remitido a ninguna especialidad.",
      SESION.rol === "MEDICO"
        ? { texto: "Remitir a especialidad", alPulsar: abrirRemision } : null);
    return;
  }

  for (const s of datos.solicitudes) {
    const ficha = document.createElement("div");
    ficha.className = "ficha ficha--" + s.estado;

    const cuerpo = document.createElement("div");
    const titulo = document.createElement("p");
    titulo.className = "ficha__titulo";
    titulo.textContent = s.especialidadAsignada || s.especialidadSolicitada || "Sin especialidad";
    const dato = document.createElement("p");
    dato.className = "ficha__dato";
    dato.textContent = s.id + " · remitida el " + fechaLegible(s.creadaEn) +
      " por " + (s.solicitadoPor || "—");
    const motivo = document.createElement("p");
    motivo.className = "ficha__texto";
    motivo.textContent = s.motivo;
    cuerpo.append(titulo, dato, motivo);

    if (s.estado === "AGENDADA") {
      const cita = document.createElement("p");
      cita.className = "ficha__dato";
      cita.textContent = "cita: " + fechaLegible(s.agendadaPara) +
        " con " + (s.medicoAsignado || "—");
      cuerpo.appendChild(cita);
    }
    if (s.enfermeroAcompanante) {
      const acompana = document.createElement("p");
      acompana.className = "ficha__dato";
      acompana.textContent = "acompaña: " + s.enfermeroAcompanante;
      cuerpo.appendChild(acompana);
    }

    const acciones = document.createElement("div");
    acciones.className = "ficha__acciones";
    acciones.appendChild(marbeteEstado(s.estado));

    if (s.estado === "AGENDADA" && SESION.rol === "MEDICO") {
      const boton = document.createElement("button");
      boton.className = "accion";
      boton.type = "button";
      boton.textContent = "Atender";
      boton.addEventListener("click", () => atender(s));
      acciones.appendChild(boton);
    }

    ficha.append(cuerpo, acciones);
    nodo.appendChild(ficha);
  }
}

async function pintarHistorial() {
  const nodo = $("historial");
  esqueleto(nodo, 3, true);
  let datos;
  try {
    datos = await pedir(CONSULTAS + "/api/v1/visitas?pacienteId=" + estado.interno);
  } catch (error) {
    problema(nodo, error, "consultar el historial clínico", pintarHistorial);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  estadoConsultas.visitas = datos.visitas;
  $("historial-conteo").textContent =
    datos.total + (datos.total === 1 ? " consulta" : " consultas");
  nodo.textContent = "";

  if (!datos.total) {
    vacio(nodo, "Este interno todavía no tiene consultas",
      "El historial se llena cuando la fundación agenda una remisión y el especialista atiende. " +
      "Cada consulta guarda su diagnóstico, sus exámenes y lo que se recetó.");
    return;
  }

  datos.visitas.forEach((v) => nodo.appendChild(tarjetaVisita(v)));
}

// Una tarjeta por consulta.
function tarjetaVisita(v) {
  const caja = document.createElement("article");
  caja.className = "visita visita--" + v.estado;

  const cabecera = document.createElement("header");
  cabecera.className = "visita__cabecera";

  const izquierda = document.createElement("div");
  const fecha = document.createElement("p");
  fecha.className = "visita__fecha";
  fecha.textContent = fechaLegible(v.fechaVisita);
  const medico = document.createElement("p");
  medico.className = "visita__medico";
  medico.textContent = v.medicoTratante || "Sin médico asignado";
  const especialidad = document.createElement("p");
  especialidad.className = "visita__especialidad";
  especialidad.textContent = (v.especialidad || "sin especialidad") + " · " + v.id;
  izquierda.append(fecha, medico, especialidad);

  const derecha = document.createElement("div");
  derecha.className = "ficha__acciones";
  derecha.appendChild(marbeteEstado(v.estado));
  if (v.estado === "ABIERTA" && SESION.rol === "MEDICO") {
    const seguir = document.createElement("button");
    seguir.className = "accion-sec";
    seguir.type = "button";
    seguir.textContent = "Continuar la consulta";
    seguir.addEventListener("click", () => abrirVisita(v));
    derecha.appendChild(seguir);
  }

  cabecera.append(izquierda, derecha);

  const cuerpo = document.createElement("div");
  cuerpo.className = "visita__cuerpo";
  cuerpo.appendChild(campoFicha("Motivo de la consulta", v.motivo));
  cuerpo.appendChild(campoFicha("Diagnóstico", v.diagnostico, "visita__diagnostico"));
  cuerpo.appendChild(campoFicha("Observaciones", v.observaciones));

  // Si el rol no puede verlos, el campo no viene y el bloque no se dibuja.
  if (v.examenes) cuerpo.appendChild(bloqueExamenes(v.examenes));
  if (v.indicaciones) cuerpo.appendChild(bloqueIndicaciones(v.indicaciones));

  caja.append(cabecera, cuerpo);
  return caja;
}

function bloqueExamenes(examenes) {
  const bloque = document.createElement("div");
  bloque.className = "visita__campo";
  const rotulo = document.createElement("p");
  rotulo.className = "visita__rotulo";
  rotulo.textContent = "Exámenes (" + examenes.length + ")";
  bloque.appendChild(rotulo);

  if (!examenes.length) {
    const p = document.createElement("p");
    p.className = "visita__observaciones visita__sinllenar";
    p.textContent = "no se indicó ninguno";
    bloque.appendChild(p);
    return bloque;
  }

  const lista = document.createElement("ul");
  lista.className = "visita__lista";
  for (const e of examenes) {
    const li = document.createElement("li");
    li.className = "visita__linea";
    const nombre = document.createElement("span");
    nombre.className = "visita__nombre";
    nombre.textContent = e.nombre;
    li.append(nombre, marbeteEstado(e.estado));
    if (e.resultado) {
      const res = document.createElement("p");
      res.className = "visita__resultado";
      res.textContent = e.resultado + "  ·  " + (e.registradoPor || "") +
        (e.resultadoEn ? ", " + fechaLegible(e.resultadoEn) : "");
      li.appendChild(res);
    }
    lista.appendChild(li);
  }
  bloque.appendChild(lista);
  return bloque;
}

function bloqueIndicaciones(indicaciones) {
  const bloque = document.createElement("div");
  bloque.className = "visita__campo";
  const rotulo = document.createElement("p");
  rotulo.className = "visita__rotulo";
  rotulo.textContent = "Medicamentos recetados (" + indicaciones.length + ")";
  bloque.appendChild(rotulo);

  if (!indicaciones.length) {
    const p = document.createElement("p");
    p.className = "visita__observaciones visita__sinllenar";
    p.textContent = "no se recetó ninguno";
    bloque.appendChild(p);
    return bloque;
  }

  const lista = document.createElement("ul");
  lista.className = "visita__lista";
  for (const i of indicaciones) {
    const li = document.createElement("li");
    li.className = "visita__linea";
    const izq = document.createElement("div");
    const nombre = document.createElement("span");
    nombre.className = "visita__nombre";
    nombre.textContent = i.nombre;
    const pauta = document.createElement("p");
    pauta.className = "visita__pauta";
    pauta.textContent = i.dosisMg + " mg cada " + i.cadaHoras + " h · " +
      i.duracionDias + " días";
    izq.append(nombre, pauta);
    li.append(izq, marbeteEstado(
      i.entregado ? "RESULTADO_LISTO" : "SOLICITADO",
      i.entregado ? "entregado" : "por entregar"));
    if (i.comoTomarlo) {
      const como = document.createElement("p");
      como.className = "visita__comotomarlo";
      como.textContent = i.comoTomarlo;
      li.appendChild(como);
    }
    lista.appendChild(li);
  }
  bloque.appendChild(lista);
  return bloque;
}


let soltarFocoRemision = null;
let abrioLaRemision = null;

function abrirRemision() {
  abrioLaRemision = document.activeElement;
  $("cajon-remision").hidden = false;
  $("velo-remision").hidden = false;
  soltarFocoRemision = atraparFoco($("cajon-remision"));
  $("remision-motivo").focus();
}

function cerrarRemision() {
  if ($("cajon-remision").hidden) return;
  $("cajon-remision").hidden = true;
  $("velo-remision").hidden = true;
  if (soltarFocoRemision) { soltarFocoRemision(); soltarFocoRemision = null; }
  if (abrioLaRemision && abrioLaRemision.focus && document.contains(abrioLaRemision)) {
    abrioLaRemision.focus();
  }
  abrioLaRemision = null;
}

$("abrir-remision").addEventListener("click", abrirRemision);
$("cerrar-remision").addEventListener("click", cerrarRemision);
$("velo-remision").addEventListener("click", cerrarRemision);

$("formulario-remision").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const boton = $("enviar-remision");
  const interno = INTERNOS[estado.interno];
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Enviando…";
  try {
    const solicitud = await pedir(CONSULTAS + "/api/v1/solicitudes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pacienteId: estado.interno,
        motivo: $("remision-motivo").value.trim(),
        especialidadSolicitada: $("remision-especialidad").value.trim() || null,
        enfermeroAcompanante: $("remision-enfermero").value.trim() || null
      })
    });
    $("formulario-remision").reset();
    cerrarRemision();
    // El servicio devuelve el aviso que generó, si lo consiguió.
    const enviado = solicitud.avisoFamiliar;
    aviso("Remisión enviada",
      solicitud.id + " · " + interno.nombre + " queda a la espera de que la fundación " +
      "le asigne médico y hora." +
      (enviado ? "  Se avisó a " + (enviado.destinatario || "la familia") +
                 " (" + (ETIQUETA_ESTADO_CADENA[enviado.estado] || enviado.estado) + ")." : ""),
      "ok");
    await Promise.all([pintarSolicitudes(), pintarCorreos(), pintarExamenes()]);
  } catch (error) {
    avisarError(error, "enviar la remisión");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});

// Convierte la remisión en un acto clínico y la marca atendida: se confirma.
async function atender(solicitud) {
  const interno = INTERNOS[solicitud.pacienteId];
  const seguro = await confirmar({
    titulo: "¿Iniciar la consulta?",
    textoSi: "Sí, atender",
    datos: [
      ["Interno", (interno ? interno.nombre : solicitud.pacienteId) + " · " + solicitud.pacienteId],
      ["Especialidad", solicitud.especialidadAsignada || "—"],
      ["Médico", solicitud.medicoAsignado || "—"],
      ["Cita", fechaLegible(solicitud.agendadaPara)]
    ],
    aviso: "La remisión quedará como atendida y se abrirá la ficha de la consulta, " +
           "firmada a su nombre."
  });
  if (!seguro) return;

  try {
    const visita = await pedir(CONSULTAS + "/api/v1/visitas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ solicitudId: solicitud.id })
    });
    aviso("Consulta iniciada",
      visita.id + " · " + (visita.medicoTratante || "") + " · " + (visita.especialidad || ""),
      "ok");
    await pintarSolicitudes();
    await pintarHistorial();
    abrirVisita(visita);
  } catch (error) {
    avisarError(error, "iniciar la consulta");
  }
}

let soltarFocoVisita = null;
let abrioLaVisita = null;

function abrirVisita(visita) {
  estadoConsultas.visitaAbierta = visita;
  abrioLaVisita = document.activeElement;

  const interno = INTERNOS[visita.pacienteId];
  $("visita-titulo").textContent = "Consulta · " + (visita.especialidad || "sin especialidad");
  const cabecera = $("visita-cabecera");
  cabecera.textContent = "";
  cabecera.append(
    campo("Interno", interno ? interno.nombre : visita.pacienteId),
    campo("Fecha", fechaLegible(visita.fechaVisita)),
    campo("Médico tratante", visita.medicoTratante || "—"),
    campo("Motivo", visita.motivo || "—")
  );

  $("visita-diagnostico").value = visita.diagnostico || "";
  $("visita-observaciones").value = visita.observaciones || "";
  $("dictamen-indicacion").textContent = "";
  pintarDetalleVisita(visita);
  aplicarEstadoVisita(visita);

  $("cajon-visita").hidden = false;
  $("velo-visita").hidden = false;
  soltarFocoVisita = atraparFoco($("cajon-visita"));
  $("visita-diagnostico").focus();
}

function cerrarVisita() {
  if ($("cajon-visita").hidden) return;
  $("cajon-visita").hidden = true;
  $("velo-visita").hidden = true;
  estadoConsultas.visitaAbierta = null;
  if (soltarFocoVisita) { soltarFocoVisita(); soltarFocoVisita = null; }
  if (abrioLaVisita && abrioLaVisita.focus && document.contains(abrioLaVisita)) {
    abrioLaVisita.focus();
  }
  abrioLaVisita = null;
}

$("cerrar-visita").addEventListener("click", cerrarVisita);
$("velo-visita").addEventListener("click", cerrarVisita);

// Una consulta ABIERTA se edita; una CERRADA es un documento clinico que solo
// se lee. ms-consultas ya lo hace cumplir del lado del servidor —responde 409
// a examenes, recetas y cambios de ficha—, asi que esto no es la defensa: es
// no ofrecer lo que el servidor va a rechazar.
function aplicarEstadoVisita(visita) {
  const abierta = visita.estado === "ABIERTA";

  const marbete = $("visita-estado");
  marbete.textContent = "";
  marbete.appendChild(marbeteEstado(visita.estado));

  $("formulario-visita").hidden = !abierta;
  $("formulario-examen").hidden = !abierta;
  $("formulario-indicacion").hidden = !abierta;
  $("visita-cerrada").hidden = abierta;

  // El cierre es del medico tratante, no de quien pase por la ficha.
  $("finalizar-consulta").hidden = !(abierta && SESION.rol === "MEDICO");
}

$("finalizar-consulta").addEventListener("click", async () => {
  const visita = estadoConsultas.visitaAbierta;
  if (!visita) return;
  const interno = INTERNOS[visita.pacienteId];

  const seguro = await confirmar({
    titulo: "¿Cerrar la consulta?",
    textoSi: "Sí, cerrar",
    tono: "peligro",
    datos: [
      ["Interno", (interno ? interno.nombre : visita.pacienteId) + " · " + visita.pacienteId],
      ["Consulta", visita.id],
      ["Exámenes", (visita.examenes || []).length + " indicados"],
      ["Recetas", (visita.indicaciones || []).length + " recetados"]
    ],
    aviso: "Una consulta cerrada ya no admite cambios: no se le podrán agregar " +
           "exámenes ni recetas, ni corregir el diagnóstico. Si le falta algo, " +
           "guarde la ficha antes de cerrarla."
  });
  if (!seguro) return;

  const boton = $("finalizar-consulta");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Cerrando…";
  try {
    const cerrada = await pedir(
      CONSULTAS + "/api/v1/visitas/" + visita.id + "/cerrar", { method: "PUT" });
    estadoConsultas.visitaAbierta = cerrada;
    pintarDetalleVisita(cerrada);
    aplicarEstadoVisita(cerrada);
    aviso("Consulta cerrada",
      cerrada.id + " queda como documento clínico: ya no admite cambios.", "ok");
    // El boton que tenia el foco acaba de desaparecer: hay que devolverlo a
    // algo que exista, o el lector de pantalla se queda sin punto de partida.
    $("cerrar-visita").focus();
    await pintarHistorial();
  } catch (error) {
    avisarError(error, "cerrar la consulta");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});

$("abrir-ficha").addEventListener("click", abrirFicha);
$("cerrar-ficha").addEventListener("click", cerrarFicha);
$("velo-ficha").addEventListener("click", cerrarFicha);

// Exámenes e indicaciones ya cargados, dentro del cajón de la consulta.
function pintarDetalleVisita(visita) {
  const ex = $("visita-examenes");
  ex.textContent = "";
  $("visita-examenes-conteo").textContent = (visita.examenes || []).length + " indicados";
  if ((visita.examenes || []).length) {
    ex.appendChild(bloqueExamenes(visita.examenes));
  }

  const ind = $("visita-indicaciones");
  ind.textContent = "";
  $("visita-indicaciones-conteo").textContent = (visita.indicaciones || []).length + " recetados";
  if ((visita.indicaciones || []).length) {
    ind.appendChild(bloqueIndicaciones(visita.indicaciones));
  }
}

async function refrescarVisitaAbierta() {
  const abierta = estadoConsultas.visitaAbierta;
  if (!abierta) return;
  try {
    const visita = await pedir(CONSULTAS + "/api/v1/visitas/" + abierta.id);
    estadoConsultas.visitaAbierta = visita;
    pintarDetalleVisita(visita);
    aplicarEstadoVisita(visita);
  } catch (_) { /* el aviso del error ya se mostró en la acción que falló */ }
  await pintarHistorial();
}

$("formulario-visita").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const visita = estadoConsultas.visitaAbierta;
  if (!visita) return;
  const boton = $("guardar-visita");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Guardando…";
  try {
    await pedir(CONSULTAS + "/api/v1/visitas/" + visita.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        diagnostico: $("visita-diagnostico").value.trim(),
        observaciones: $("visita-observaciones").value.trim()
      })
    });
    aviso("Ficha guardada", "El diagnóstico y las observaciones quedaron en el historial.", "ok");
    await refrescarVisitaAbierta();
  } catch (error) {
    avisarError(error, "guardar la ficha de la consulta");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});

$("formulario-examen").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const visita = estadoConsultas.visitaAbierta;
  if (!visita) return;
  const boton = $("agregar-examen");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Agregando…";
  try {
    const examen = await pedir(CONSULTAS + "/api/v1/visitas/" + visita.id + "/examenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: $("examen-nombre").value.trim() })
    });
    $("formulario-examen").reset();
    // El servicio avisa si no pudo crear el cargo: el examen se guarda igual.
    if (examen.advertencia) {
      aviso("Examen indicado, pero sin cobro", examen.advertencia, "aviso");
    } else {
      aviso("Examen indicado",
        examen.nombre + " · queda esperando el resultado del laboratorio.", "ok");
    }
    await refrescarVisitaAbierta();
  } catch (error) {
    avisarError(error, "indicar el examen");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});

$("formulario-indicacion").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const visita = estadoConsultas.visitaAbierta;
  if (!visita) return;
  const boton = $("agregar-indicacion");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Consultando a ms-vigia…";
  esqueleto($("dictamen-indicacion"), 3);
  try {
    const indicacion = await pedir(CONSULTAS + "/api/v1/visitas/" + visita.id + "/indicaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        principioActivo: $("indicacion-principio").value,
        dosisMg: parseFloat($("indicacion-dosis").value),
        cadaHoras: parseFloat($("indicacion-cada").value),
        duracionDias: parseInt($("indicacion-dias").value, 10),
        comoTomarlo: $("indicacion-como").value.trim() || null
      })
    });
    // Aprobada: mismo tratamiento visual que el recetario.
    pintarDictamen({
      veredicto: indicacion.veredictoVigia,
      folio: indicacion.folioValidacion,
      puntajeRiesgo: 0,
      resumen: "Receta guardada en la ficha de la consulta.",
      hallazgos: indicacion.hallazgos || []
    }, $("dictamen-indicacion"), false);
    aviso("Medicamento recetado",
      indicacion.nombre + " " + indicacion.dosisMg + " mg · queda pendiente de entrega en farmacia.",
      "ok");
    await refrescarVisitaAbierta();
  } catch (error) {
    // Bloqueado por farmacovigilancia: no es un error del sistema sino una
    // decisión clínica, y se muestra como tal.
    if (error.estado === 409 && error.cuerpo && error.cuerpo.dictamen) {
      pintarDictamen(error.cuerpo.dictamen, $("dictamen-indicacion"), false);
      aviso("ms-vigia bloqueó la receta",
        "No se guardó nada. El dictamen está debajo del formulario.", "error");
    } else {
      $("dictamen-indicacion").textContent = "";
      avisarError(error, "recetar el medicamento");
    }
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});


async function pintarAgenda() {
  const nodo = $("bandeja-agenda");
  esqueleto(nodo, 3, true);
  let datos;
  try {
    datos = await pedir(CONSULTAS + "/api/v1/solicitudes?estado=PENDIENTE");
  } catch (error) {
    problema(nodo, error, "consultar la bandeja de remisiones", pintarAgenda);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  $("agenda-conteo").textContent =
    datos.total + (datos.total === 1 ? " remisión" : " remisiones");
  nodo.textContent = "";

  if (!datos.total) {
    vacio(nodo, "No hay remisiones esperando cita",
      "Cuando un médico general remita a un interno a una especialidad, la solicitud " +
      "aparecerá aquí para asignarle médico, especialidad y hora.");
    return;
  }

  for (const s of datos.solicitudes) {
    const ficha = document.createElement("div");
    ficha.className = "ficha ficha--PENDIENTE";

    const cuerpo = document.createElement("div");
    const titulo = document.createElement("p");
    titulo.className = "ficha__titulo";
    titulo.textContent = nombreDeInterno(s.pacienteId);
    const dato = document.createElement("p");
    dato.className = "ficha__dato";
    dato.textContent = s.pacienteId + " · " + s.id + " · remitida el " +
      fechaLegible(s.creadaEn) + " por " + (s.solicitadoPor || "—");
    const especialidad = document.createElement("p");
    especialidad.className = "ficha__dato";
    especialidad.textContent = "especialidad pedida: " +
      (s.especialidadSolicitada || "no indicada");
    const motivo = document.createElement("p");
    motivo.className = "ficha__texto";
    motivo.textContent = s.motivo;
    cuerpo.append(titulo, dato, especialidad, motivo);
    if (s.enfermeroAcompanante) {
      const acompana = document.createElement("p");
      acompana.className = "ficha__dato";
      acompana.textContent = "acompaña: " + s.enfermeroAcompanante;
      cuerpo.appendChild(acompana);
    }

    const acciones = document.createElement("div");
    acciones.className = "ficha__acciones";
    acciones.appendChild(marbeteEstado(s.estado));
    const abrir = document.createElement("button");
    abrir.className = "accion";
    abrir.type = "button";
    abrir.textContent = "Asignar cita";
    acciones.appendChild(abrir);

    const formulario = formularioAgendar(s);
    formulario.hidden = true;
    abrir.addEventListener("click", () => {
      formulario.hidden = !formulario.hidden;
      abrir.textContent = formulario.hidden ? "Asignar cita" : "Cancelar";
      if (!formulario.hidden) formulario.querySelector("input").focus();
    });

    ficha.append(cuerpo, acciones, formulario);
    nodo.appendChild(ficha);
  }
}

function formularioAgendar(solicitud) {
  const formulario = document.createElement("form");
  formulario.className = "formulario ficha__formulario";

  const medico = campoDeTexto("Médico asignado", "text",
    "Dra. Ingrid Barrios", true, "campo--ancho");
  const especialidad = campoDeTexto("Especialidad", "text",
    solicitud.especialidadSolicitada || "Cardiología", true, "campo--ancho");
  if (solicitud.especialidadSolicitada) {
    especialidad.querySelector("input").value = solicitud.especialidadSolicitada;
  }
  const cuando = campoDeTexto("Fecha y hora", "datetime-local", "", true, "campo--ancho");

  const boton = document.createElement("button");
  boton.className = "accion accion--ancha";
  boton.type = "submit";
  boton.textContent = "Confirmar la cita";

  formulario.append(medico, especialidad, cuando, boton);

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    boton.disabled = true;
    const original = boton.textContent;
    boton.textContent = "Agendando…";
    try {
      const actualizada = await pedir(
        CONSULTAS + "/api/v1/solicitudes/" + solicitud.id + "/agendar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            medicoAsignado: medico.querySelector("input").value.trim(),
            especialidadAsignada: especialidad.querySelector("input").value.trim(),
            agendadaPara: cuando.querySelector("input").value
          })
        });
      aviso("Cita asignada",
        nombreDeInterno(actualizada.pacienteId) + " · " + actualizada.especialidadAsignada +
        " con " + actualizada.medicoAsignado + " el " + fechaLegible(actualizada.agendadaPara),
        "ok");
      await pintarAgenda();
    } catch (error) {
      avisarError(error, "asignar la cita");
    } finally {
      boton.disabled = false;
      boton.textContent = original;
    }
  });

  return formulario;
}

// Campo suelto, con la misma estructura que los del marcado.
function campoDeTexto(rotulo, tipo, marcador, requerido, clase) {
  const caja = document.createElement("div");
  caja.className = "campo" + (clase ? " " + clase : "");
  const id = "c-" + Math.random().toString(36).slice(2, 9);
  const etiqueta = document.createElement("label");
  etiqueta.setAttribute("for", id);
  etiqueta.textContent = rotulo;
  const entrada = document.createElement("input");
  entrada.id = id;
  entrada.type = tipo;
  if (marcador) entrada.placeholder = marcador;
  if (requerido) entrada.required = true;
  caja.append(etiqueta, entrada);
  return caja;
}


async function pintarLaboratorio() {
  const nodo = $("bandeja-laboratorio");
  esqueleto(nodo, 3, true);
  let examenes, visitas;
  try {
    // El motivo vive en la visita, no en el examen: se piden las dos y se
    // cruzan aquí.
    examenes = await pedir(CONSULTAS + "/api/v1/examenes?estado=SOLICITADO");
    visitas = await pedir(CONSULTAS + "/api/v1/visitas");
  } catch (error) {
    problema(nodo, error, "consultar los exámenes solicitados", pintarLaboratorio);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  const motivoPorVisita = {};
  visitas.visitas.forEach((v) => (motivoPorVisita[v.id] = v));

  $("laboratorio-conteo").textContent =
    examenes.total + (examenes.total === 1 ? " examen" : " exámenes");
  nodo.textContent = "";

  if (!examenes.total) {
    vacio(nodo, "No hay exámenes esperando resultado",
      "Cuando un especialista indique un examen durante una consulta, aparecerá aquí " +
      "para que el laboratorio cargue el resultado.");
    return;
  }

  for (const e of examenes.examenes) {
    const visita = motivoPorVisita[e.visitaId] || {};
    const ficha = document.createElement("div");
    ficha.className = "ficha ficha--SOLICITADO";

    const cuerpo = document.createElement("div");
    const titulo = document.createElement("p");
    titulo.className = "ficha__titulo";
    titulo.textContent = e.nombre;
    const dato = document.createElement("p");
    dato.className = "ficha__dato";
    dato.textContent = "interno " + e.pacienteId + " · " + e.id +
      " · indicado el " + fechaLegible(e.indicadoEn);
    const motivo = document.createElement("p");
    motivo.className = "ficha__texto";
    motivo.textContent = "Motivo de la consulta: " + (visita.motivo || "no disponible");
    cuerpo.append(titulo, dato, motivo);
    if (visita.medicoTratante) {
      const medico = document.createElement("p");
      medico.className = "ficha__dato";
      medico.textContent = "lo indicó: " + visita.medicoTratante +
        (visita.especialidad ? " (" + visita.especialidad + ")" : "");
      cuerpo.appendChild(medico);
    }

    const acciones = document.createElement("div");
    acciones.className = "ficha__acciones";
    acciones.appendChild(marbeteEstado(e.estado));

    const formulario = document.createElement("form");
    formulario.className = "formulario ficha__formulario";
    const resultado = campoDeTexto("Resultado del examen", "text",
      "Ej. INR 4.8 (rango terapéutico 2.0-3.0). Prolongado.", true, "campo--ancho");
    const boton = document.createElement("button");
    boton.className = "accion accion--ancha";
    boton.type = "submit";
    boton.textContent = "Cargar el resultado";
    formulario.append(resultado, boton);

    formulario.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      boton.disabled = true;
      const original = boton.textContent;
      boton.textContent = "Cargando…";
      try {
        await pedir(CONSULTAS + "/api/v1/examenes/" + e.id + "/resultado", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resultado: resultado.querySelector("input").value.trim() })
        });
        aviso("Resultado cargado",
          e.nombre + " · interno " + e.pacienteId + " · ya está en la ficha médica.", "ok");
        await pintarLaboratorio();
      } catch (error) {
        avisarError(error, "cargar el resultado");
      } finally {
        boton.disabled = false;
        boton.textContent = original;
      }
    });

    ficha.append(cuerpo, acciones, formulario);
    nodo.appendChild(ficha);
  }
}


async function pintarFarmacia() {
  const nodo = $("bandeja-farmacia");
  esqueleto(nodo, 3, true);
  let datos;
  try {
    // Farmacia lee las visitas con sus indicaciones; los exámenes no le
    // llegan.
    datos = await pedir(CONSULTAS + "/api/v1/visitas");
  } catch (error) {
    problema(nodo, error, "consultar los medicamentos por entregar", pintarFarmacia);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  const pendientes = [];
  datos.visitas.forEach((v) => {
    (v.indicaciones || []).forEach((i) => {
      if (!i.entregado) pendientes.push({ indicacion: i, visita: v });
    });
  });

  $("farmacia-conteo").textContent =
    pendientes.length + (pendientes.length === 1 ? " medicamento" : " medicamentos");
  nodo.textContent = "";

  if (!pendientes.length) {
    vacio(nodo, "No hay medicamentos por entregar",
      "Cuando un especialista recete algo y ms-vigia lo apruebe, aparecerá aquí para " +
      "entregárselo al interno.");
    return;
  }

  for (const { indicacion, visita } of pendientes) {
    const ficha = document.createElement("div");
    ficha.className = "ficha ficha--SOLICITADO";

    const cuerpo = document.createElement("div");
    const titulo = document.createElement("p");
    titulo.className = "ficha__titulo";
    titulo.textContent = indicacion.nombre + " · " + indicacion.dosisMg + " mg";
    const pauta = document.createElement("p");
    pauta.className = "ficha__dato";
    pauta.textContent = "cada " + indicacion.cadaHoras + " h durante " +
      indicacion.duracionDias + " días · " + indicacion.id;
    const interno = document.createElement("p");
    interno.className = "ficha__dato";
    interno.textContent = "interno " + visita.pacienteId +
      " · recetado por " + (visita.medicoTratante || "—") +
      " el " + fechaLegible(visita.fechaVisita);
    cuerpo.append(titulo, pauta, interno);
    if (indicacion.comoTomarlo) {
      const como = document.createElement("p");
      como.className = "ficha__texto";
      como.textContent = "Cómo tomarlo: " + indicacion.comoTomarlo;
      cuerpo.appendChild(como);
    }

    const acciones = document.createElement("div");
    acciones.className = "ficha__acciones";
    acciones.appendChild(marbeteEstado("SOLICITADO", "por entregar"));
    const boton = document.createElement("button");
    boton.className = "accion";
    boton.type = "button";
    boton.textContent = "Entregar";
    boton.addEventListener("click", () => entregar(indicacion, visita));
    acciones.appendChild(boton);

    ficha.append(cuerpo, acciones);
    nodo.appendChild(ficha);
  }
}

// Le carga el costo a la familia y no se puede deshacer: se confirma.
async function entregar(indicacion, visita) {
  const seguro = await confirmar({
    titulo: "¿Entregar este medicamento?",
    textoSi: "Sí, entregar",
    datos: [
      ["Interno", visita.pacienteId],
      ["Medicamento", indicacion.nombre],
      ["Dosis", indicacion.dosisMg + " mg cada " + indicacion.cadaHoras + " h"],
      ["Duración", indicacion.duracionDias + " días"]
    ],
    aviso: "Queda firmado a su nombre y se le carga el costo a la cuenta del interno. " +
           "Una entrega no se registra dos veces."
  });
  if (!seguro) return;

  try {
    const entregada = await pedir(
      CONSULTAS + "/api/v1/indicaciones/" + indicacion.id + "/entregar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
    if (entregada.advertencia) {
      aviso("Entregado, pero sin cobro", entregada.advertencia, "aviso");
    } else {
      aviso("Medicamento entregado",
        indicacion.nombre + " · interno " + visita.pacienteId +
        " · firma " + entregada.entregadoPor, "ok");
    }
    await pintarFarmacia();
  } catch (error) {
    avisarError(error, "entregar el medicamento");
  }
}


let relojBarra;

async function iniciarApp() {
  // Los roles operativos no leen ms-pastillero: pedir el padron solo daria un
  // 403 y un bloque de error en pantalla.
  const hayPadron = tienePadron() ? await cargarInternos() : true;
  if (SESION.rol === "MEDICO" || SESION.rol === "ENFERMERIA") cargarVademecum();

  if (hayPadron) {
    // Se respeta a donde queria ir antes del acceso; si no, la vista que le
    // corresponde a su rol.
    const destino = parsearHash(rutaPretendida);
    rutaPretendida = "";
    rutaActual = { vista: null, interno: null };
    irA(destino, true);
    actualizarSuperior();
  }

  refrescarBarra();
  clearInterval(relojBarra);
  relojBarra = setInterval(refrescarBarra, 30000);
}

// Una sesion guardada se valida contra el gateway antes de saltarse la
// pantalla de acceso.
(async function intentarSesionGuardada() {
  $("acceso-usuario").focus();
  const guardada = sessionStorage.getItem("sesionAsilo");
  if (!guardada) return;
  try {
    const datos = JSON.parse(guardada);
    if (!datos || !datos.token) return;
    Object.assign(SESION, datos);
    // Quien manda es el gateway, no lo guardado: si el token es de cambio de
    // clave, recargar la pagina vuelve a la pantalla de cambio y no a la
    // aplicacion. El nombre y el rol tambien salen de su respuesta.
    const yo = await pedir(AUTH + "/me");
    SESION.nombre = yo.nombre;
    if (yo.debeCambiarClave) {
      SESION.rol = "CAMBIO_DE_CLAVE";
      SESION.cambio = true;
      mostrarCambioClave("obligatorio");
      return;
    }
    SESION.rol = yo.rol;
    SESION.cambio = false;
    await mostrarApp();
  } catch (_) {
    limpiarSesion();
  }
})();

/* =====================================================================
   Reportes · los siete informes del enunciado

   Los siete salen de tres microservicios distintos, pero para quien los
   consulta son la misma cosa: se elige uno, se acota, se genera y se
   imprime. El catalogo de abajo es lo unico que sabe de esa diferencia;
   el resto de la pantalla trabaja contra el catalogo y no contra las
   rutas.

   Ninguna entrada del catalogo aparece si el rol no la puede pedir: una
   opcion de mas solo conseguiria que la persona la elija y reciba un 403.
   ===================================================================== */


// Los tipos viajan en mayuscula y con guion bajo; en la hoja impresa se leen
// como los nombra el enunciado.
const ETIQUETA_DONANTE = {
  EMPRESA_INTERNACIONAL: "Empresa internacional",
  EMPRESA_NACIONAL: "Empresa nacional",
  GOBIERNO: "Gobierno",
  PARTICULAR: "Particular",
};

function nombreDeDonante(tipo) {
  return ETIQUETA_DONANTE[tipo] || tipo;
}
function quetzales(monto) {
  return "Q " + Number(monto || 0).toFixed(2);
}

// Lo que cada informe necesita antes de poder pedirse.
const INFORMES = [
  {
    clave: "costos-cita",
    titulo: "Costos de cada cita por paciente",
    nota: "Lo que costo una consulta, sumando el laboratorio y la farmacia que salieron de ella.",
    roles: ["ADMINISTRACION"],
    pide: ["interno", "visita"],
    url: (f) => CAJA + "/api/v1/reportes/costo-por-visita?visitaId=" + encodeURIComponent(f.visita),
    pintar: informeCostosCita,
  },
  {
    clave: "analisis-medicos",
    titulo: "Análisis médicos por paciente",
    nota: "Ficha médica completa: por qué fue recluido, sus consultas y su medicación.",
    roles: ["MEDICO"],
    pide: ["interno"],
    url: (f) => CONSULTAS + "/api/v1/reportes/ficha?pacienteId=" + encodeURIComponent(f.interno),
    pintar: informeAnalisisMedicos,
  },
  {
    clave: "cobros-paciente",
    titulo: "Cobros por paciente",
    nota: "Los cargos del interno en el rango, con el detalle de los gastos médicos.",
    roles: ["ADMINISTRACION"],
    pide: ["interno", "rango"],
    url: (f) => CAJA + "/api/v1/cargos?pacienteId=" + encodeURIComponent(f.interno) +
                "&desde=" + f.desde + "&hasta=" + f.hasta,
    pintar: informeCobrosPaciente,
  },
  {
    clave: "pagos-fundacion",
    titulo: "Pagos realizados a la fundación",
    nota: "Lo que el asilo le ha pagado a la fundación, contra lo que devengó en el rango.",
    roles: ["ADMINISTRACION"],
    pide: ["rango"],
    url: (f) => CAJA + "/api/v1/reportes/pagos-fundacion?desde=" + f.desde + "&hasta=" + f.hasta,
    pintar: informePagosFundacion,
  },
  {
    clave: "entradas",
    titulo: "Entradas: donaciones y cobros",
    nota: "Todo lo que entró al asilo en el rango, por donante y por categoría.",
    roles: ["ADMINISTRACION"],
    pide: ["rango"],
    url: (f) => CAJA + "/api/v1/reportes/entradas?desde=" + f.desde + "&hasta=" + f.hasta,
    pintar: informeEntradas,
  },
  {
    clave: "examenes",
    titulo: "Exámenes médicos realizados por paciente",
    nota: "Todos los exámenes indicados al interno y cuáles ya tienen resultado.",
    roles: ["MEDICO"],
    pide: ["interno"],
    url: (f) => CONSULTAS + "/api/v1/reportes/examenes?pacienteId=" + encodeURIComponent(f.interno),
    pintar: informeExamenes,
  },
  {
    clave: "medicamentos",
    titulo: "Medicamentos aplicados por paciente",
    nota: "Qué se le administró, qué se omitió y qué proporción de las tomas se cumplió.",
    roles: ["MEDICO", "ENFERMERIA"],
    pide: ["interno", "rango"],
    url: (f) => PASTILLERO + "/api/v1/pacientes/" + encodeURIComponent(f.interno) +
                "/adherencia?desde=" + f.desde + "&hasta=" + f.hasta,
    pintar: informeMedicamentos,
  },
  // Adicional: no es uno de los siete informes del enunciado, sino el control
  // que el enunciado pide en el modulo de caja. Por eso va al final y se
  // rotula aparte. Todos sus filtros son opcionales.
  {
    clave: "citas-pendientes",
    titulo: "Citas con saldo pendiente",
    adicional: true,
    nota: "Las consultas que la familia aún no termina de pagar: «sin pagar» si no se ha " +
          "abonado nada, «abono parcial» si se pagó una parte. Sin interno ni fechas salen " +
          "todas; las fechas se cuentan por el primer cargo de cada consulta.",
    roles: ["ADMINISTRACION"],
    pide: ["internoOpcional", "rangoOpcional"],
    url: (f) => {
      const partes = [];
      if (f.interno) partes.push("pacienteId=" + encodeURIComponent(f.interno));
      if (f.desde) partes.push("desde=" + f.desde);
      if (f.hasta) partes.push("hasta=" + f.hasta);
      return CAJA + "/api/v1/reportes/citas-pendientes" + (partes.length ? "?" + partes.join("&") : "");
    },
    pintar: informeCitasPendientes,
  },
];

// Un informe que otra vista pidio abrir, como el dato «Citas con saldo
// pendiente» del resumen de la caja. Lo recoge pintarReportes al entrar.
let informePedido = null;

function informesDelRol() {
  return INFORMES.filter((i) => i.roles.includes(SESION.rol));
}

function informeElegido() {
  return INFORMES.find((i) => i.clave === $("reporte-cual").value) || null;
}


/* ---------------------------------------------------------------------
   Piezas comunes de una hoja: una tabla con su pie de totales y un
   bloque de cifras. Los siete informes se dibujan con esto.
   --------------------------------------------------------------------- */

// columnas: [{rotulo, alinear}], filas: [[celda, ...]], pie: [celda, ...]
function tablaInforme(columnas, filas, pie) {
  const caja = document.createElement("div");
  caja.className = "tabla-envoltura";
  const tabla = document.createElement("table");
  tabla.className = "tabla";

  const thead = document.createElement("thead");
  const filaCab = document.createElement("tr");
  for (const col of columnas) {
    const th = document.createElement("th");
    th.textContent = col.rotulo;
    th.scope = "col";
    if (col.alinear === "derecha") th.className = "tabla--numero";
    filaCab.appendChild(th);
  }
  thead.appendChild(filaCab);

  const tbody = document.createElement("tbody");
  for (const fila of filas) {
    const tr = document.createElement("tr");
    fila.forEach((celda, i) => {
      const td = document.createElement("td");
      // Nodo si el dibujante ya armo uno (un marbete); texto si no.
      if (celda instanceof Node) td.appendChild(celda);
      else td.textContent = celda === null || celda === undefined ? "—" : String(celda);
      if (columnas[i] && columnas[i].alinear === "derecha") td.className = "tabla--numero";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  tabla.append(thead, tbody);

  if (pie && pie.length) {
    const tfoot = document.createElement("tfoot");
    const tr = document.createElement("tr");
    pie.forEach((celda, i) => {
      const td = document.createElement("td");
      td.textContent = celda === null || celda === undefined ? "" : String(celda);
      if (columnas[i] && columnas[i].alinear === "derecha") td.className = "tabla--numero";
      tr.appendChild(td);
    });
    tfoot.appendChild(tr);
    tabla.appendChild(tfoot);
  }

  caja.appendChild(tabla);
  return caja;
}

function cifrasInforme(pares) {
  const dl = document.createElement("dl");
  dl.className = "datos";
  for (const [rotulo, valor] of pares) dl.appendChild(lineaDato(rotulo, valor));
  return dl;
}

function bloqueInforme(titulo, contenido) {
  const seccion = document.createElement("section");
  seccion.className = "bloque";
  const cab = document.createElement("div");
  cab.className = "bloque__cabecera";
  const h = document.createElement("h4");
  h.textContent = titulo;
  cab.appendChild(h);
  seccion.append(cab, contenido);
  return seccion;
}

// Un informe sin filas no es un error: es un rango sin movimientos, y hay
// que decir cual, o se lee como que el sistema fallo.
function sinDatos(texto) {
  const p = document.createElement("p");
  p.className = "parte parte--vacia";
  p.textContent = texto;
  return p;
}


/* ---------------------------------------------------------------------
   Los siete dibujantes. Cada uno recibe el JSON del servidor y devuelve
   el cuerpo de la hoja.
   --------------------------------------------------------------------- */

function informeCostosCita(d) {
  const trozos = document.createDocumentFragment();

  trozos.appendChild(cifrasInforme([
    ["Consulta", d.visitaId],
    ["Interno", (d.pacienteNombre || "—") + " · " + (d.pacienteId || "—")],
  ]));

  const filas = ["CONSULTA", "LABORATORIO", "FARMACIA"].map((cat) => {
    const c = d.porCategoria[cat] || { cantidad: 0, montoBruto: 0, montoNeto: 0, montoPagado: 0 };
    return [
      cat.charAt(0) + cat.slice(1).toLowerCase(),
      c.cantidad,
      quetzales(c.montoBruto),
      quetzales(c.montoBruto - c.montoNeto),
      quetzales(c.montoNeto),
      quetzales(c.montoPagado),
    ];
  });

  const t = d.totales;
  trozos.appendChild(tablaInforme(
    [{ rotulo: "Categoría" }, { rotulo: "Cargos", alinear: "derecha" },
     { rotulo: "Bruto", alinear: "derecha" }, { rotulo: "Descuento", alinear: "derecha" },
     { rotulo: "Neto", alinear: "derecha" }, { rotulo: "Pagado", alinear: "derecha" }],
    filas,
    ["Totales", d.total, quetzales(t.montoBruto), quetzales(t.descuento),
     quetzales(t.montoNeto), quetzales(t.montoPagado)]));

  trozos.appendChild(cifrasInforme([
    ["Descuento de la fundación", quetzales(t.descuento)],
    ["Saldo pendiente", quetzales(t.saldo)],
  ]));

  if (d.nota) trozos.appendChild(sinDatos(d.nota));
  return trozos;
}


function informeAnalisisMedicos(d) {
  const trozos = document.createDocumentFragment();
  const id = d.identificacion || {};

  trozos.appendChild(cifrasInforme([
    ["Interno", (id.nombre || d.pacienteId) + " · " + d.pacienteId],
    ["Edad", id.edad != null ? id.edad + " años" : "—"],
    ["Cama", id.ubicacion],
    ["Ingreso", id.ingreso],
    ["Responsable", id.responsable],
  ]));

  // El motivo de reclusion del enunciado son las psicopatologias del padron.
  trozos.appendChild(bloqueInforme("Motivo de reclusión y antecedentes",
    cifrasInforme([
      ["Psicopatologías", (d.psicopatologias || []).join(" · ") || "ninguna registrada"],
      ["Alergias", (d.alergias || []).join(" · ") || "ninguna registrada"],
    ])));

  if (d.advertencia) trozos.appendChild(sinDatos(d.advertencia));

  const r = d.resumen || {};
  trozos.appendChild(bloqueInforme("Resumen clínico", cifrasInforme([
    ["Remisiones", r.solicitudes],
    ["Consultas atendidas", r.visitas],
    ["Exámenes indicados", r.examenes],
    ["Medicamentos recetados", r.medicamentosIndicados],
  ])));

  if (!(d.visitas || []).length) {
    trozos.appendChild(sinDatos(
      "Este interno todavía no ha sido atendido por ningún especialista, " +
      "así que no hay consultas que listar."));
    return trozos;
  }

  trozos.appendChild(bloqueInforme("Consultas", tablaInforme(
    [{ rotulo: "Fecha" }, { rotulo: "Especialidad" }, { rotulo: "Médico" },
     { rotulo: "Diagnóstico" }, { rotulo: "Estado" }],
    d.visitas.map((v) => [
      fechaLegible(v.fechaVisita),
      v.especialidad || "—",
      v.medicoTratante || "—",
      v.diagnostico || "sin diagnóstico anotado",
      marbeteEstado(v.estado),
    ]),
    null)));

  const recetados = [];
  for (const v of d.visitas) {
    for (const i of v.indicaciones || []) {
      recetados.push([
        fechaLegible(v.fechaVisita),
        i.nombre,
        i.dosisMg + " mg cada " + i.cadaHoras + " h por " + i.duracionDias + " días",
        i.entregado ? "entregado" : "sin entregar",
      ]);
    }
  }
  trozos.appendChild(bloqueInforme("Medicación indicada",
    recetados.length
      ? tablaInforme([{ rotulo: "Fecha" }, { rotulo: "Medicamento" },
                      { rotulo: "Pauta" }, { rotulo: "Entrega" }], recetados, null)
      : sinDatos("No se ha recetado ningún medicamento en las consultas de este interno.")));

  return trozos;
}


const ETIQUETA_SALDO_CITA = { PENDIENTE: "sin pagar", PARCIAL: "abono parcial" };

function informeCitasPendientes(d) {
  const trozos = document.createDocumentFragment();
  trozos.appendChild(cifrasInforme([
    // Como texto: lineaDato toma el 0 por un dato sin llenar, y aqui el cero
    // es justamente la respuesta.
    ["Citas con saldo", String(d.totales.citas)],
    ["Sin ningún pago", String(d.totales.pendientes)],
    ["Con abono parcial", String(d.totales.parciales)],
    ["Saldo por cobrar", quetzales(d.totales.saldo)],
  ]));

  if (!d.total) {
    trozos.appendChild(sinDatos(
      "No hay citas con saldo pendiente con estos filtros: todas las consultas con " +
      "cargos están completamente pagadas."));
    return trozos;
  }

  const plural = { CONSULTA: ["consulta", "consultas"], LABORATORIO: ["laboratorio", "laboratorios"],
                   FARMACIA: ["farmacia", "farmacia"], OTRO: ["otro", "otros"] };
  trozos.appendChild(tablaInforme(
    [{ rotulo: "Consulta" }, { rotulo: "Interno" }, { rotulo: "Primer cargo" },
     { rotulo: "Cargos" }, { rotulo: "Neto", alinear: "derecha" },
     { rotulo: "Pagado", alinear: "derecha" }, { rotulo: "Saldo", alinear: "derecha" },
     { rotulo: "Estado" }],
    d.citas.map((c) => {
      // El nombre, del padron si esta; si no, el que trae el cargo; si no, el codigo.
      const id = c.interno.pacienteId;
      const nombre = INTERNOS[id] ? INTERNOS[id].nombre : c.interno.nombre;
      const cargos = Object.entries(c.cargosPorCategoria)
        .filter(([, n]) => n > 0)
        .map(([cat, n]) => n + " " + plural[cat][n === 1 ? 0 : 1])
        .join(" · ");
      return [c.visitaId, nombre ? nombre + " · " + id : id, fechaLegible(c.primerCargo),
              cargos, quetzales(c.neto), quetzales(c.pagado), quetzales(c.saldo),
              marbeteEstado(c.estado, ETIQUETA_SALDO_CITA[c.estado])];
    }),
    ["Totales", d.totales.citas + (d.totales.citas === 1 ? " cita" : " citas"), "", "",
     quetzales(d.totales.neto), quetzales(d.totales.pagado), quetzales(d.totales.saldo), ""]));
  return trozos;
}

function informeCobrosPaciente(d) {
  const trozos = document.createDocumentFragment();
  const interno = INTERNOS[($("reporte-interno").value || "")];

  trozos.appendChild(cifrasInforme([
    ["Interno", interno ? interno.nombre + " · " + interno.pacienteId : "—"],
    ["Cargos en el rango", d.total],
  ]));

  if (!d.total) {
    trozos.appendChild(sinDatos(
      "A este interno no se le cargó nada entre las fechas elegidas. " +
      "Pruebe con un rango más amplio: los cargos se listan por su fecha de creación."));
    return trozos;
  }

  trozos.appendChild(tablaInforme(
    [{ rotulo: "Fecha" }, { rotulo: "Categoría" }, { rotulo: "Concepto" },
     { rotulo: "Neto", alinear: "derecha" }, { rotulo: "Pagado", alinear: "derecha" },
     { rotulo: "Saldo", alinear: "derecha" }, { rotulo: "Estado" }],
    d.cargos.map((c) => [
      fechaLegible(c.creadoEn), c.categoria, c.concepto,
      quetzales(c.montoNeto), quetzales(c.montoPagado), quetzales(c.saldo),
      c.estado.toLowerCase(),
    ]),
    ["Totales", "", "", quetzales(d.montoNetoTotal),
     quetzales(d.montoNetoTotal - d.saldoTotal), quetzales(d.saldoTotal), ""]));

  return trozos;
}


function informePagosFundacion(d) {
  const trozos = document.createDocumentFragment();
  const t = d.totales;

  trozos.appendChild(bloqueInforme("En el rango elegido", cifrasInforme([
    ["Devengado (consultas, laboratorio y farmacia)", quetzales(t.devengadoEnElRango)],
    ["Pagado a la fundación", quetzales(t.pagadoEnElRango)],
    ["Diferencia del período", quetzales(t.diferenciaEnElRango)],
  ])));

  // El acumulado va aparte y sin acotar: lo que se le debe a la fundacion no
  // empieza de cero porque uno elija ver un mes.
  const a = d.acumulado;
  trozos.appendChild(bloqueInforme("Acumulado histórico, sin acotar por fecha",
    cifrasInforme([
      ["Total adeudado", quetzales(a.totalAdeudado)],
      ["Total pagado", quetzales(a.totalPagado)],
      ["Saldo con la fundación", quetzales(a.saldoConFundacion)],
    ])));

  trozos.appendChild(bloqueInforme("Pagos del rango",
    d.total
      ? tablaInforme(
          [{ rotulo: "Fecha" }, { rotulo: "Folio" }, { rotulo: "Referencia" },
           { rotulo: "Registrado por" }, { rotulo: "Monto", alinear: "derecha" }],
          d.pagos.map((p) => [
            fechaLegible(p.creadoEn), p.id, p.referencia || "—",
            p.registradoPor || "—", quetzales(p.monto),
          ]),
          ["Total", "", "", "", quetzales(t.pagadoEnElRango)])
      : sinDatos("No se le hizo ningún pago a la fundación entre las fechas elegidas.")));

  return trozos;
}


function informeEntradas(d) {
  const trozos = document.createDocumentFragment();

  trozos.appendChild(cifrasInforme([
    ["Donaciones", quetzales(d.totales.donaciones)],
    ["Cobros a familiares", quetzales(d.totales.cobros)],
    ["Total de entradas", quetzales(d.totales.total)],
  ]));

  const porTipo = Object.entries(d.donaciones.porTipo)
    .map(([tipo, v]) => [nombreDeDonante(tipo), v.cantidad, quetzales(v.monto)]);
  trozos.appendChild(bloqueInforme("Donaciones por tipo de donante", tablaInforme(
    [{ rotulo: "Tipo" }, { rotulo: "Cantidad", alinear: "derecha" },
     { rotulo: "Monto", alinear: "derecha" }],
    porTipo,
    ["Total", d.donaciones.total, quetzales(d.donaciones.monto)])));

  trozos.appendChild(bloqueInforme("Donaciones recibidas",
    d.donaciones.total
      ? tablaInforme(
          [{ rotulo: "Fecha" }, { rotulo: "Donante" }, { rotulo: "Tipo" },
           { rotulo: "Destino" }, { rotulo: "Monto", alinear: "derecha" }],
          d.donaciones.detalle.map((x) => [
            fechaLegible(x.creadoEn), x.donante, nombreDeDonante(x.tipo),
            x.destino || "—", quetzales(x.monto),
          ]),
          ["Total", "", "", "", quetzales(d.donaciones.monto)])
      : sinDatos("No se recibió ninguna donación entre las fechas elegidas.")));

  const porCat = Object.entries(d.cobros.porCategoria)
    .filter(([, v]) => v.cantidad > 0)
    .map(([cat, v]) => [cat.charAt(0) + cat.slice(1).toLowerCase(), v.cantidad, quetzales(v.monto)]);
  trozos.appendChild(bloqueInforme("Cobros por categoría",
    porCat.length
      ? tablaInforme(
          [{ rotulo: "Categoría" }, { rotulo: "Abonos", alinear: "derecha" },
           { rotulo: "Monto", alinear: "derecha" }],
          porCat,
          ["Total", d.cobros.total, quetzales(d.cobros.monto)])
      : sinDatos("Ningún familiar abonó nada entre las fechas elegidas.")));

  if (d.cobros.total) {
    trozos.appendChild(bloqueInforme("Detalle de los cobros", tablaInforme(
      [{ rotulo: "Fecha" }, { rotulo: "Interno" }, { rotulo: "Concepto" },
       { rotulo: "Método" }, { rotulo: "Monto", alinear: "derecha" }],
      d.cobros.detalle.map((c) => [
        fechaLegible(c.creadoEn), c.pacienteNombre || c.pacienteId,
        c.concepto, c.metodo, quetzales(c.monto),
      ]),
      ["Total", "", "", "", quetzales(d.cobros.monto)])));
  }

  return trozos;
}


function informeExamenes(d) {
  const trozos = document.createDocumentFragment();
  const interno = INTERNOS[d.pacienteId];

  trozos.appendChild(cifrasInforme([
    ["Interno", (interno ? interno.nombre : d.pacienteId) + " · " + d.pacienteId],
    ["Exámenes indicados", d.total],
    ["Con resultado", d.conResultado],
    ["Pendientes", d.pendientes],
  ]));

  if (!d.total) {
    trozos.appendChild(sinDatos(
      "A este interno no se le ha indicado ningún examen. " +
      "Los exámenes los indica el especialista durante la consulta."));
    return trozos;
  }

  trozos.appendChild(tablaInforme(
    [{ rotulo: "Indicado" }, { rotulo: "Examen" }, { rotulo: "Consulta" },
     { rotulo: "Resultado" }, { rotulo: "Estado" }],
    d.examenes.map((e) => [
      fechaLegible(e.indicadoEn),
      e.nombre,
      (e.especialidad || "—") + " · " + fechaLegible(e.fechaVisita),
      e.resultado || "sin resultado todavía",
      marbeteEstado(e.estado),
    ]),
    null));

  return trozos;
}


function informeMedicamentos(d) {
  const trozos = document.createDocumentFragment();
  const interno = INTERNOS[d.pacienteId];
  const c = d.detalle || {};

  trozos.appendChild(cifrasInforme([
    ["Interno", (interno ? interno.nombre : d.pacienteId) + " · " + d.pacienteId],
    ["Tomas programadas", d.totalProgramadas],
    ["Adherencia",
      // null y 0 % no son lo mismo: sin tomas cerradas no hay nada que medir.
      d.adherenciaPorcentaje === null
        ? "todavía no hay tomas cerradas que medir"
        : d.adherenciaPorcentaje + " %"],
  ]));

  trozos.appendChild(bloqueInforme("Cómo terminaron las tomas", tablaInforme(
    [{ rotulo: "Estado" }, { rotulo: "Tomas", alinear: "derecha" }],
    [["Administradas", c.ADMINISTRADA || 0],
     ["Omitidas", c.OMITIDA || 0],
     ["Vencidas sin registrar", c.VENCIDA || 0],
     ["Todavía pendientes", c.PENDIENTE || 0]],
    ["Total", d.totalProgramadas])));

  const porFarmaco = Object.entries(d.porFarmaco || {});
  trozos.appendChild(bloqueInforme("Por medicamento",
    porFarmaco.length
      ? tablaInforme(
          [{ rotulo: "Medicamento" }, { rotulo: "Programadas", alinear: "derecha" },
           { rotulo: "Administradas", alinear: "derecha" }],
          porFarmaco.map(([f, v]) => [f, v.programadas, v.administradas]),
          ["Total",
           porFarmaco.reduce((s, [, v]) => s + v.programadas, 0),
           porFarmaco.reduce((s, [, v]) => s + v.administradas, 0)])
      : sinDatos("Este interno no tuvo ninguna toma programada entre las fechas elegidas.")));

  return trozos;
}


/* ---------------------------------------------------------------------
   La pantalla: armado del formulario, generacion e impresion.
   --------------------------------------------------------------------- */

function pintarReportes() {
  const selector = $("reporte-cual");
  const disponibles = informesDelRol();

  // Se rearma solo la primera vez: rehacerlo perderia lo que ya eligio.
  if (selector.options.length !== disponibles.length) {
    selector.textContent = "";
    let numero = 0;
    disponibles.forEach((informe) => {
      const opcion = document.createElement("option");
      opcion.value = informe.clave;
      // Los del enunciado se numeran; el adicional se dice como tal.
      opcion.textContent = informe.adicional
        ? "Adicional · " + informe.titulo : (++numero) + ". " + informe.titulo;
      selector.appendChild(opcion);
    });
  }

  const pedido = informePedido;
  informePedido = null;
  const abrirPedido = pedido && disponibles.some((i) => i.clave === pedido);
  if (abrirPedido) {
    selector.value = pedido;
    vaciarInforme();
    limpiarFiltrosOpcionales();
  }

  $("reportes-meta").textContent =
    disponibles.length + (disponibles.length === 1 ? " informe disponible" : " informes disponibles") +
    " para el rol " + SESION.rol;

  ajustarFiltrosDelReporte();
  if (abrirPedido) $("formulario-reporte").requestSubmit();
}

// Al elegir un informe de filtros opcionales se arranca sin acotar: lo que
// quedo de otro informe —un interno, el ultimo mes— lo recortaria en silencio.
function limpiarFiltrosOpcionales() {
  const informe = informeElegido();
  if (!informe) return;
  if (informe.pide.includes("internoOpcional")) $("reporte-interno").value = "";
  if (informe.pide.includes("rangoOpcional")) {
    $("reporte-desde").value = "";
    $("reporte-hasta").value = "";
  }
}

function llenarInternosDelReporte(opcional) {
  const selector = $("reporte-interno");
  const previo = selector.value;
  const elegido = opcional ? previo : (previo || estado.interno);
  selector.textContent = "";
  if (opcional) {
    const todos = document.createElement("option");
    todos.value = "";
    todos.textContent = "Todos los internos";
    selector.appendChild(todos);
  }
  for (const id of Object.keys(INTERNOS)) {
    const opcion = document.createElement("option");
    opcion.value = id;
    opcion.textContent = INTERNOS[id].nombre + " · " + id;
    selector.appendChild(opcion);
  }
  if (elegido && INTERNOS[elegido]) selector.value = elegido;
}

// Cada informe pide lo suyo: mostrar los cinco filtros siempre obligaria a
// adivinar cuales cuentan para el que se eligio.
function ajustarFiltrosDelReporte() {
  const informe = informeElegido();
  if (!informe) return;
  const pide = informe.pide;

  const conInterno = pide.includes("interno") || pide.includes("internoOpcional");
  const conRango = pide.includes("rango") || pide.includes("rangoOpcional");
  llenarInternosDelReporte(pide.includes("internoOpcional"));
  $("campo-reporte-interno").hidden = !conInterno;
  $("campo-reporte-visita").hidden = !pide.includes("visita");
  $("campo-reporte-desde").hidden = !conRango;
  $("campo-reporte-hasta").hidden = !conRango;
  $("reporte-ayuda").textContent = informe.nota;

  if (pide.includes("rango") && !$("reporte-desde").value) {
    // Un mes hacia atras: es el rango que se pide casi siempre, y deja ver
    // datos en vez de una hoja vacia la primera vez.
    const hoy = new Date();
    const antes = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
    $("reporte-desde").value = antes.toISOString().slice(0, 10);
    $("reporte-hasta").value = hoy.toISOString().slice(0, 10);
  }

  if (pide.includes("visita")) llenarConsultasDelReporte();
}

// La caja no lleva registro de visitas y ADMINISTRACION no puede leer
// ms-consultas. Pero cada cargo trae de que consulta salio, asi que la lista
// se saca de los cargos del interno, igual que en la vista de caja.
async function llenarConsultasDelReporte() {
  const selector = $("reporte-visita");
  const paciente = $("reporte-interno").value;
  if (!paciente) return;

  selector.textContent = "";
  const cargando = document.createElement("option");
  cargando.textContent = "Buscando consultas…";
  selector.appendChild(cargando);
  selector.disabled = true;

  let datos;
  try {
    datos = await pedir(CAJA + "/api/v1/cargos?pacienteId=" + encodeURIComponent(paciente));
  } catch (error) {
    selector.textContent = "";
    const fallo = document.createElement("option");
    fallo.textContent = "No se pudieron cargar las consultas";
    selector.appendChild(fallo);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  const visitas = [...new Set((datos.cargos || []).map((c) => c.visitaId).filter(Boolean))];
  selector.textContent = "";
  selector.disabled = !visitas.length;
  if (!visitas.length) {
    const ninguna = document.createElement("option");
    ninguna.value = "";
    ninguna.textContent = "Este interno no tiene consultas con cargos";
    selector.appendChild(ninguna);
    return;
  }
  for (const v of visitas) {
    const opcion = document.createElement("option");
    opcion.value = v;
    opcion.textContent = v;
    selector.appendChild(opcion);
  }
}

$("reporte-cual").addEventListener("change", () => {
  // Esconder la hoja no bastaba: seguia en el DOM con el informe anterior.
  vaciarInforme();
  limpiarFiltrosOpcionales();
  ajustarFiltrosDelReporte();
});

$("reporte-interno").addEventListener("change", () => {
  const informe = informeElegido();
  if (informe && informe.pide.includes("visita")) llenarConsultasDelReporte();
});

$("formulario-reporte").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const informe = informeElegido();
  if (!informe) return;

  const filtros = {
    interno: $("reporte-interno").value,
    visita: $("reporte-visita").value,
    desde: $("reporte-desde").value,
    hasta: $("reporte-hasta").value,
  };

  if (informe.pide.includes("visita") && !filtros.visita) {
    aviso("Falta elegir la consulta",
      "Este informe se saca de una consulta concreta, y este interno no tiene ninguna con cargos.",
      "aviso");
    return;
  }
  // El servidor tambien lo valida y responde 400; esto solo evita el viaje.
  if ((informe.pide.includes("rango") || informe.pide.includes("rangoOpcional")) &&
      filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) {
    aviso("El rango está al revés",
      "La fecha inicial es posterior a la final.", "aviso");
    return;
  }

  const boton = $("generar-reporte");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Generando…";
  $("reporte-hoja").hidden = true;
  esqueleto($("reporte-estado"), 4, true);

  let datos;
  try {
    datos = await pedir(informe.url(filtros));
  } catch (error) {
    problema($("reporte-estado"), error, "generar el informe",
      () => $("formulario-reporte").requestSubmit());
    if (error.sesionExpirada) sesionExpirada();
    boton.disabled = false;
    boton.textContent = original;
    return;
  }

  $("reporte-estado").textContent = "";
  $("reporte-titulo").textContent = informe.titulo;
  $("reporte-alcance").textContent = alcanceDelInforme(informe, filtros);
  // Fecha y firmante SIEMPRE del servidor: el navegador sabe quien inicio
  // sesion, pero la hoja la firma el token.
  $("reporte-sello").textContent =
    "Generado el " + fechaLegible(datos.generadoEn) + " a solicitud de " + datos.generadoPor + ".";

  const cuerpo = $("reporte-cuerpo");
  cuerpo.textContent = "";
  cuerpo.appendChild(informe.pintar(datos));
  $("reporte-hoja").hidden = false;
  $("reporte-hoja").scrollIntoView({ block: "start", behavior: "smooth" });

  boton.disabled = false;
  boton.textContent = original;
});

function alcanceDelInforme(informe, filtros) {
  const partes = [];
  if (informe.pide.includes("interno") && INTERNOS[filtros.interno]) {
    partes.push(INTERNOS[filtros.interno].nombre + " (" + filtros.interno + ")");
  }
  if (informe.pide.includes("visita") && filtros.visita) partes.push("consulta " + filtros.visita);
  if (informe.pide.includes("rango")) {
    partes.push("del " + (filtros.desde || "inicio") + " al " + (filtros.hasta || "hoy"));
  }
  if (informe.pide.includes("internoOpcional")) {
    partes.push(!filtros.interno ? "todos los internos"
      : INTERNOS[filtros.interno] ? INTERNOS[filtros.interno].nombre + " (" + filtros.interno + ")"
      : filtros.interno);
  }
  if (informe.pide.includes("rangoOpcional")) {
    partes.push(!filtros.desde && !filtros.hasta ? "todas las fechas"
      : "primer cargo del " + (filtros.desde || "inicio") + " al " + (filtros.hasta || "hoy"));
  }
  return partes.join(" · ");
}

// El navegador ya imprime a PDF: no hace falta una biblioteca. La hoja de
// estilo @media print es la que esconde la navegacion y los filtros.
$("imprimir-reporte").addEventListener("click", () => window.print());

/* =====================================================================
   Padron de internos · la pantalla del ADMINISTRADOR

   Alta, edicion y egreso de internos. Lo clinico —psicopatologias,
   alergias y medicacion permanente— NO se edita desde aqui: lo firma el
   medico desde su propia vista, porque con esos datos ms-vigia decide si
   bloquea un medicamento. Aqui ni siquiera se muestran: el administrador
   lleva camas y expedientes, no historias clinicas.
   ===================================================================== */

const estadoPadron = { internos: [], editando: null, egresando: null };

const ETIQUETA_SEXO = {
  FEMENINO: "Femenino", MASCULINO: "Masculino", OTRO: "Otro",
};

function hoyISO() {
  const h = new Date();
  return new Date(h.getTime() - h.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);
}

// La fecha viaja como dd/mm/aaaa desde el servidor, pero un <input type=date>
// solo entiende aaaa-mm-dd.
function aISO(fecha) {
  if (!fecha) return "";
  const partes = String(fecha).split("/");
  if (partes.length !== 3) return "";
  return partes[2] + "-" + partes[1] + "-" + partes[0];
}

async function pintarPadron() {
  const nodo = $("padron-lista");
  esqueleto(nodo, 4, true);

  let datos;
  try {
    datos = await pedir(PASTILLERO + "/api/v1/internos?estado=" + $("padron-estado").value);
  } catch (error) {
    problema(nodo, error, "consultar el padrón de internos", pintarPadron);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }

  estadoPadron.internos = datos.internos;
  pintarListaPadron();
}

function pintarListaPadron() {
  const nodo = $("padron-lista");
  const filtro = ($("padron-buscar").value || "").trim().toLowerCase();
  const estado = $("padron-estado").value;

  const visibles = estadoPadron.internos.filter((i) => {
    if (!filtro) return true;
    return [i.nombre, i.documento, i.pabellon, i.cama, i.responsable, i.pacienteId]
      .some((campo) => String(campo || "").toLowerCase().includes(filtro));
  });

  $("padron-meta").textContent =
    visibles.length + (visibles.length === 1 ? " interno" : " internos") +
    (filtro ? " que coinciden con la búsqueda" : "") +
    " · " + (estado === "TODOS" ? "activos y egresados"
             : estado === "ACTIVO" ? "solo activos" : "solo egresados");

  nodo.textContent = "";

  if (!visibles.length) {
    // Los dos vacios no son lo mismo y no se explican igual.
    if (filtro) {
      vacio(nodo, "Ningún interno coincide con la búsqueda",
        "Se busca por nombre, documento, pabellón, cama, responsable o código. " +
        "Pruebe con menos letras, o cambie el filtro de arriba.");
    } else if (estado === "EGRESADO") {
      vacio(nodo, "Todavía no hay internos egresados",
        "Cuando un interno egrese aparecerá aquí, con su historial intacto.");
    } else {
      vacio(nodo, "El padrón está vacío",
        "Use «Dar de alta» para registrar al primer interno.");
    }
    return;
  }

  const columnas = [
    { rotulo: "Interno" }, { rotulo: "Documento" }, { rotulo: "Edad", alinear: "derecha" },
    { rotulo: "Ubicación" }, { rotulo: "Ingreso" }, { rotulo: "Responsable" },
    { rotulo: "Estado" }, { rotulo: "" },
  ];

  const filas = visibles.map((i) => {
    const quien = document.createElement("div");
    const nombre = document.createElement("p");
    nombre.className = "padron__nombre";
    nombre.textContent = i.nombre;
    const codigo = document.createElement("p");
    codigo.className = "padron__codigo";
    codigo.textContent = i.pacienteId + " · " + (ETIQUETA_SEXO[i.sexo] || i.sexo);
    quien.append(nombre, codigo);

    const marbete = marbeteEstado(i.estado,
      i.estado === "ACTIVO" ? "activo" : "egresado");

    const acciones = document.createElement("div");
    acciones.className = "ficha__acciones";
    if (i.estado === "ACTIVO") {
      const editar = document.createElement("button");
      editar.className = "accion-sec";
      editar.type = "button";
      editar.textContent = "Editar";
      editar.addEventListener("click", () => abrirFormularioInterno(i));
      const egresar = document.createElement("button");
      egresar.className = "accion-sec accion-sec--peligro";
      egresar.type = "button";
      egresar.textContent = "Egresar";
      egresar.addEventListener("click", () => abrirEgreso(i));
      acciones.append(editar, egresar);
    } else {
      const cuando = document.createElement("span");
      cuando.className = "padron__codigo";
      cuando.textContent = i.egreso && i.egreso.fecha
        ? "egresó el " + i.egreso.fecha : "egresado";
      acciones.appendChild(cuando);
    }

    return [quien, i.documento || "—", i.edad != null ? i.edad : "—",
            i.ubicacion || "sin cama asignada", i.ingreso || "—",
            i.responsable || "—", marbete, acciones];
  });

  nodo.appendChild(tablaInforme(columnas, filas, null));
}

$("padron-buscar").addEventListener("input", pintarListaPadron);
$("padron-estado").addEventListener("change", pintarPadron);


/* ---------------------------------------------------------------------
   Alta y edicion
   --------------------------------------------------------------------- */

let soltarFocoInterno = null;
let abrioElInterno = null;

function abrirFormularioInterno(interno) {
  estadoPadron.editando = interno || null;
  abrioElInterno = document.activeElement;
  const alta = !interno;

  $("interno-titulo").textContent = alta
    ? "Dar de alta a un interno" : "Editar a " + interno.nombre;
  $("guardar-interno").textContent = alta ? "Dar de alta" : "Guardar los cambios";
  $("interno-nota").textContent = alta
    ? "El interno nace sin parte clínica. Las psicopatologías, las alergias y la " +
      "medicación permanente las registra el médico desde su propia vista."
    : "El documento, la fecha de nacimiento y el sexo no se editan: son la " +
      "identidad de la persona, y corregirlos es rehacer el alta.";

  // La identidad solo se pide en el alta.
  for (const campo of ["documento", "nacimiento", "sexo"]) {
    $("campo-interno-" + campo).hidden = !alta;
  }
  $("interno-documento").required = alta;
  $("interno-nacimiento").required = alta;

  $("interno-nombre").value = interno ? interno.nombre : "";
  $("interno-documento").value = "";
  $("interno-nacimiento").value = "";
  $("interno-sexo").value = "FEMENINO";
  $("interno-ingreso").value = interno ? aISO(interno.ingreso) : hoyISO();
  $("interno-pabellon").value = interno ? (interno.pabellon || "") : "";
  $("interno-cama").value = interno ? (interno.cama || "") : "";
  $("interno-motivo").value = interno ? (interno.motivoIngreso || "") : "";
  $("interno-responsable").value = interno ? (interno.responsable || "") : "";
  $("interno-correo").value = interno ? (interno.correoResponsable || "") : "";

  $("interno-clinica").textContent = alta ? "" :
    "La ficha clínica de este interno la edita el médico. Desde el padrón no se " +
    "ve ni se modifica.";

  $("cajon-interno").hidden = false;
  $("velo-interno").hidden = false;
  soltarFocoInterno = atraparFoco($("cajon-interno"));
  $("interno-nombre").focus();
}

function cerrarFormularioInterno() {
  if ($("cajon-interno").hidden) return;
  $("cajon-interno").hidden = true;
  $("velo-interno").hidden = true;
  estadoPadron.editando = null;
  if (soltarFocoInterno) { soltarFocoInterno(); soltarFocoInterno = null; }
  if (abrioElInterno && abrioElInterno.focus && document.contains(abrioElInterno)) {
    abrioElInterno.focus();
  }
  abrioElInterno = null;
}

$("abrir-alta").addEventListener("click", () => abrirFormularioInterno(null));
$("cerrar-interno").addEventListener("click", cerrarFormularioInterno);
$("velo-interno").addEventListener("click", cerrarFormularioInterno);

$("formulario-interno").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const editando = estadoPadron.editando;
  const boton = $("guardar-interno");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Guardando…";

  const cuerpo = {
    nombre: $("interno-nombre").value.trim(),
    ingreso: $("interno-ingreso").value || null,
    motivoIngreso: $("interno-motivo").value.trim(),
    pabellon: $("interno-pabellon").value.trim(),
    cama: $("interno-cama").value.trim(),
    responsable: $("interno-responsable").value.trim(),
    correoResponsable: $("interno-correo").value.trim(),
  };
  if (!editando) {
    cuerpo.documento = $("interno-documento").value.trim();
    cuerpo.fechaNacimiento = $("interno-nacimiento").value;
    cuerpo.sexo = $("interno-sexo").value;
  }

  try {
    const guardado = await pedir(
      PASTILLERO + "/api/v1/internos" + (editando ? "/" + editando.pacienteId : ""),
      {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
    aviso(editando ? "Interno actualizado" : "Interno dado de alta",
      guardado.nombre + " · " + guardado.pacienteId +
      (editando ? "" : " · queda pendiente su ficha clínica"), "ok");
    cerrarFormularioInterno();
    await pintarPadron();
    // El selector de internos del resto de la estacion sale del padron.
    await cargarInternos();
  } catch (error) {
    // El documento repetido no es un fallo del sistema sino un dato que ya
    // existe, y se cuenta como tal, diciendo con quien choca.
    if (error.estado === 409 && error.cuerpo && error.cuerpo.internoExistente) {
      aviso("Ese documento ya está registrado",
        "Pertenece a " + (error.cuerpo.nombre || "otro interno") +
        " (" + error.cuerpo.internoExistente + ").", "aviso");
    } else {
      avisarError(error, editando ? "guardar los cambios" : "dar de alta al interno");
    }
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});


/* ---------------------------------------------------------------------
   Egreso
   --------------------------------------------------------------------- */

let soltarFocoEgreso = null;
let abrioElEgreso = null;

function abrirEgreso(interno) {
  estadoPadron.egresando = interno;
  abrioElEgreso = document.activeElement;

  const cabecera = $("egreso-cabecera");
  cabecera.textContent = "";
  cabecera.append(
    campo("Interno", interno.nombre + " · " + interno.pacienteId),
    campo("Ubicación", interno.ubicacion || "sin cama asignada"),
    campo("Tratamientos activos", String(interno.planesActivos || 0)),
    campo("Responsable", interno.responsable || "sin responsable registrado")
  );

  $("egreso-fecha").value = hoyISO();
  $("egreso-motivo").value = "";
  $("cajon-egreso").hidden = false;
  $("velo-egreso").hidden = false;
  soltarFocoEgreso = atraparFoco($("cajon-egreso"));
  $("egreso-motivo").focus();
}

function cerrarEgreso() {
  if ($("cajon-egreso").hidden) return;
  $("cajon-egreso").hidden = true;
  $("velo-egreso").hidden = true;
  estadoPadron.egresando = null;
  if (soltarFocoEgreso) { soltarFocoEgreso(); soltarFocoEgreso = null; }
  if (abrioElEgreso && abrioElEgreso.focus && document.contains(abrioElEgreso)) {
    abrioElEgreso.focus();
  }
  abrioElEgreso = null;
}

$("cerrar-egreso").addEventListener("click", cerrarEgreso);
$("velo-egreso").addEventListener("click", cerrarEgreso);

$("formulario-egreso").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const interno = estadoPadron.egresando;
  if (!interno) return;

  const seguro = await confirmar({
    titulo: "¿Egresar a " + interno.nombre + "?",
    textoSi: "Sí, egresar",
    tono: "peligro",
    datos: [
      ["Interno", interno.nombre + " · " + interno.pacienteId],
      ["Fecha", $("egreso-fecha").value],
      ["Motivo", $("egreso-motivo").value.trim()],
      ["Tratamientos que se finalizan", String(interno.planesActivos || 0)],
    ],
    aviso: "Sale del padrón activo y sus tomas futuras quedan anuladas. Su " +
           "historial se conserva íntegro y se le puede seguir consultando. " +
           "Si queda debiendo, la deuda sigue siendo exigible al familiar.",
  });
  if (!seguro) return;

  const boton = $("confirmar-egreso");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Egresando…";
  try {
    const salida = await pedir(
      PASTILLERO + "/api/v1/internos/" + interno.pacienteId + "/egreso",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: $("egreso-fecha").value,
          motivo: $("egreso-motivo").value.trim(),
        }),
      });
    aviso("Interno egresado",
      salida.nombre + " · " + (salida.planesFinalizados || 0) +
      " tratamiento(s) finalizado(s) y " + (salida.tomasAnuladas || 0) +
      " toma(s) futura(s) anulada(s).", "ok");
    // La deuda no impide el egreso, pero no puede pasar desapercibida.
    if (salida.advertencia) aviso("Atención", salida.advertencia, "aviso");
    cerrarEgreso();
    await pintarPadron();
    await cargarInternos();
  } catch (error) {
    avisarError(error, "egresar al interno");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});

/* ---------------------------------------------------------------------
   Cuota mensual de estadia

   Genera de una vez el cargo de la cuota para todo el padron activo. La
   confirmacion dice a cuantos se les va a cobrar y cuanto suma, porque
   despues son cargos reales en la cuenta de otras tantas familias.
   --------------------------------------------------------------------- */

function mesActualISO() {
  const h = new Date();
  return h.getFullYear() + "-" + String(h.getMonth() + 1).padStart(2, "0");
}

// El mes en palabras, para que la confirmacion no diga "2026-09".
function mesLegible(iso) {
  const [anio, mes] = String(iso || "").split("-");
  const nombres = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
                   "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const nombre = nombres[parseInt(mes, 10) - 1];
  return nombre ? nombre + " de " + anio : iso;
}

function tarifaDeLaCuota() {
  const t = (TARIFAS_CAJA || []).find((x) => x.clave === "cuota-mensual");
  if (!t) return null;
  return {
    neto: t.precioFundacion * (1 - (t.descuentoPct || 0) / 100),
    nombre: t.nombre,
  };
}

function prepararCuotas() {
  if (!$("cuotas-mes").value) $("cuotas-mes").value = mesActualISO();
  const tarifa = tarifaDeLaCuota();
  const activos = Object.keys(INTERNOS).length;
  $("cuotas-nota").textContent = tarifa
    ? "Se le cobra a cada interno activo. Hoy son " + activos +
      ", a " + quetzales(tarifa.neto) + " cada uno."
    : "Se le cobra a cada interno activo del padrón.";
}

$("formulario-cuotas").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const mes = $("cuotas-mes").value;
  if (!mes) return;

  const tarifa = tarifaDeLaCuota();
  const activos = Object.keys(INTERNOS).length;
  const seguro = await confirmar({
    titulo: "¿Generar las cuotas de " + mesLegible(mes) + "?",
    textoSi: "Sí, generar",
    datos: [
      ["Mes", mesLegible(mes)],
      ["Internos activos", String(activos)],
      ["Cuota por interno", tarifa ? quetzales(tarifa.neto) : "según el tarifario"],
      ["Suma, como máximo", tarifa ? quetzales(tarifa.neto * activos) : "—"],
    ],
    // Es idempotente, y decirlo quita el miedo a pulsarlo dos veces, que es
    // justo lo que lleva a no pulsarlo nunca y cobrar a mano.
    aviso: "Se le cobra la estadía a cada interno activo que todavía no tenga " +
           "la cuota de ese mes. A quien ya la tenga no se le cobra dos veces, " +
           "así que repetir la operación es inofensivo.",
  });
  if (!seguro) return;

  const boton = $("generar-cuotas");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Generando…";
  try {
    const salida = await pedir(CAJA + "/api/v1/cuotas/generar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mes }),
    });
    if (salida.creadas) {
      aviso("Cuotas generadas",
        salida.creadas + " cuota(s) de " + mesLegible(mes) + " por " +
        quetzales(salida.montoTotalGenerado) + " en total" +
        (salida.yaExistian ? " · " + salida.yaExistian + " ya existían" : "") + ".",
        "ok");
    } else {
      // Ni error ni exito: el mes ya estaba cobrado. Decirlo asi evita que
      // alguien lo vuelva a intentar pensando que fallo.
      aviso("No hubo nada que generar",
        "Los " + salida.yaExistian + " internos activos ya tenían su cuota de " +
        mesLegible(mes) + ".", "aviso");
    }
    await pintarCaja();
  } catch (error) {
    avisarError(error, "generar las cuotas del mes");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});


/* =====================================================================
   Cambio de clave

   La misma pantalla sirve para dos cosas. En el cambio obligatorio la
   persona entro con una clave temporal: su token solo abre esta pantalla y
   el gateway le rechaza cualquier otra cosa, asi que no hay aplicacion
   detras. En el voluntario se abre encima de la aplicacion, con un boton de
   cancelar. En los dos se pide la clave que se tiene: un token robado no
   alcanza para quedarse con la cuenta.
   ===================================================================== */

let modoCambio = null;
let soltarFocoCambio = null;
let abrioElCambio = null;

// Las mismas reglas que aplica el gateway. Aqui solo sirven para avisar
// antes de enviar: quien decide sigue siendo el servidor.
function requisitosDeClave() {
  const actual = $("cambio-actual").value;
  const nueva = $("cambio-nueva").value;
  const repetida = $("cambio-confirmar").value;
  return {
    largo: nueva.length >= 8,
    mezcla: /\p{L}/u.test(nueva) && /\d/.test(nueva),
    actual: nueva !== "" && nueva !== actual,
    usuario: nueva !== "" && nueva.toLowerCase() !== String(SESION.usuario || "").toLowerCase(),
    iguales: nueva !== "" && nueva === repetida,
  };
}

function pintarRequisitos() {
  const cumple = requisitosDeClave();
  document.querySelectorAll("#cambio-requisitos .requisito").forEach((li) => {
    const si = cumple[li.dataset.requisito] === true;
    li.dataset.cumple = si ? "si" : "no";
    li.querySelector(".requisito__marca").textContent = si ? "cumple" : "falta";
  });
  return cumple;
}

function mostrarCambioClave(modo) {
  const obligatorio = modo === "obligatorio";
  modoCambio = modo;
  abrioElCambio = obligatorio ? null : document.activeElement;

  $("formulario-cambio").reset();
  $("cambio-error").textContent = "";
  ["cambio-actual", "cambio-nueva", "cambio-confirmar"].forEach((id) =>
    $(id).removeAttribute("aria-invalid"));
  pintarRequisitos();

  $("cambio-titulo").textContent = obligatorio ? "Elija su clave" : "Cambiar mi clave";
  $("cambio-saludo").textContent = "Hola, " + (SESION.nombre || SESION.usuario) + ".";
  $("cambio-motivo").textContent = obligatorio
    ? "Entró con una clave temporal que le dio el administrador. Antes de usar el " +
      "sistema tiene que elegir una propia: la temporal la conoce alguien más, y deja " +
      "de servir en cuanto guarde la nueva."
    : "Escriba su clave actual y elija una nueva. Al guardarla se cierran sus otras " +
      "sesiones abiertas; esta sigue.";
  $("cambio-actual-rotulo").textContent = obligatorio ? "Clave temporal" : "Clave actual";
  $("cambio-cancelar").hidden = obligatorio;

  if (obligatorio) {
    // No hay aplicacion detras: nada de la barra, ni de la lateral.
    $("acceso").hidden = true;
    $("superior").hidden = true;
    $("armazon").hidden = true;
    $("barra").hidden = true;
  }
  $("cambio-clave").hidden = false;
  if (soltarFocoCambio) soltarFocoCambio();
  soltarFocoCambio = atraparFoco($("cambio-clave"));
  $("cambio-actual").focus();
}

function ocultarCambioClave() {
  if ($("cambio-clave").hidden) return;
  $("cambio-clave").hidden = true;
  // Las tres claves escritas se borran al salir, se haya guardado o no.
  $("formulario-cambio").reset();
  $("cambio-error").textContent = "";
  pintarRequisitos();
  modoCambio = null;
  if (soltarFocoCambio) { soltarFocoCambio(); soltarFocoCambio = null; }
  if (abrioElCambio && abrioElCambio.focus && document.contains(abrioElCambio)) {
    abrioElCambio.focus();
  }
  abrioElCambio = null;
}

["cambio-actual", "cambio-nueva", "cambio-confirmar"].forEach((id) =>
  $(id).addEventListener("input", pintarRequisitos));

$("cambiar-mi-clave").addEventListener("click", () => mostrarCambioClave("voluntario"));
$("cambio-cancelar").addEventListener("click", ocultarCambioClave);
$("cambio-salir").addEventListener("click", cerrarSesion);

const FALTA_REQUISITO = {
  largo: "La clave nueva debe tener al menos 8 caracteres.",
  mezcla: "La clave nueva debe tener al menos una letra y un dígito.",
  actual: "La clave nueva debe ser distinta de la actual.",
  usuario: "La clave nueva no puede ser igual a su nombre de usuario.",
  iguales: "Las dos claves nuevas no coinciden.",
};

$("formulario-cambio").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const error = $("cambio-error");
  ["cambio-actual", "cambio-nueva", "cambio-confirmar"].forEach((id) =>
    $(id).removeAttribute("aria-invalid"));
  error.textContent = "";

  if (!$("cambio-actual").value) {
    error.textContent = modoCambio === "obligatorio"
      ? "Escriba la clave temporal con la que entró." : "Escriba su clave actual.";
    $("cambio-actual").setAttribute("aria-invalid", "true");
    $("cambio-actual").focus();
    return;
  }
  const cumple = pintarRequisitos();
  const falta = Object.keys(FALTA_REQUISITO).find((k) => !cumple[k]);
  if (falta) {
    const campoMal = falta === "iguales" ? $("cambio-confirmar") : $("cambio-nueva");
    error.textContent = FALTA_REQUISITO[falta];
    campoMal.setAttribute("aria-invalid", "true");
    campoMal.focus();
    return;
  }

  const boton = $("cambio-guardar");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Guardando…";
  const modo = modoCambio;
  try {
    const sesionNueva = await pedir(AUTH + "/cambiar-clave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claveActual: $("cambio-actual").value,
        claveNueva: $("cambio-nueva").value,
      }),
    });
    // El token con que se hizo el cambio ya no sirve: el gateway devuelve
    // uno normal y nuevo, y con el se sigue trabajando sin volver a entrar.
    guardarSesion(sesionNueva);
    ocultarCambioClave();
    if (modo === "obligatorio") {
      await mostrarApp();
      aviso("Clave guardada", "Desde ahora entra con su clave nueva.", "ok");
    } else {
      aviso("Clave cambiada", "Sus otras sesiones abiertas se cerraron.", "ok");
    }
  } catch (e) {
    if (e.sesionCambiada) return;
    if (e.sesionExpirada) { sesionExpirada(); return; }
    // Los rechazos del gateway aqui son para leerse: clave actual equivocada,
    // clave debil, demasiados intentos.
    const mensaje = (e.cuerpo && e.cuerpo.error) || "";
    error.textContent = e.red
      ? "No hay conexión con el sistema. Revise que esté levantado."
      : mensaje || "No se pudo cambiar la clave.";
    const culpable = /actual no es correcta/i.test(mensaje) ? $("cambio-actual") : $("cambio-nueva");
    culpable.setAttribute("aria-invalid", "true");
    culpable.focus();
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});


/* =====================================================================
   Cuentas del personal · la segunda pantalla del ADMINISTRADOR

   Mismo patron que el padron: encabezado con conteo, filtro, lista y
   formularios en cajon. Una cuenta no se borra nunca, asi que no hay
   boton de eliminar: se desactiva y sigue en la lista.

   Los botones que el gateway va a rechazar —desactivarse a si mismo,
   quitarse el rol— aparecen deshabilitados y con el motivo escrito. Es
   cortesia, no seguridad: el servidor decide igual.
   ===================================================================== */

const estadoUsuarios = { cuentas: [], editando: null, desactivando: null };

const ETIQUETA_ROL_CUENTA = {
  MEDICO: "Medicina", ENFERMERIA: "Enfermería", ADMINISTRACION: "Administración (caja)",
  ADMINISTRADOR: "Administrador del sistema", FUNDACION: "Fundación",
  LABORATORIO: "Laboratorio", FARMACIA: "Farmacia",
};

const ETIQUETA_ACCION_CUENTA = {
  ALTA: "Alta", EDICION: "Edición", RESTABLECIMIENTO: "Clave restablecida",
  DESACTIVACION: "Desactivada", REACTIVACION: "Reactivada",
  CAMBIO_DE_CLAVE: "Cambió su clave",
};

function estadoDeCuenta(c) {
  if (!c.activo) return { clave: "DESACTIVADA", texto: "Desactivada" };
  if (c.debeCambiarClave) return { clave: "TEMPORAL", texto: "Clave temporal pendiente" };
  return { clave: "ACTIVA", texto: "Activa" };
}

function administradoresActivos() {
  return estadoUsuarios.cuentas.filter((c) => c.activo && c.rol === "ADMINISTRADOR").length;
}

// Lo que el gateway le va a negar a esta cuenta, dicho antes de pulsar.
function motivoParaNoDesactivar(c) {
  if (c.usuario === SESION.usuario) {
    return "No puede desactivar su propia cuenta: pídaselo a otro administrador.";
  }
  if (c.rol === "ADMINISTRADOR" && administradoresActivos() <= 1) {
    return "Es el último administrador activo.";
  }
  return null;
}

function motivoParaNoCambiarRol(c) {
  if (c.usuario === SESION.usuario) {
    return "No puede cambiarse el rol a sí mismo: pídaselo a otro administrador.";
  }
  if (c.rol === "ADMINISTRADOR" && administradoresActivos() <= 1) {
    return "Es el último administrador activo: no se le puede quitar el rol.";
  }
  return null;
}

// Un rechazo del gateway en esta pantalla viene con su motivo escrito para
// leerse ("es el último administrador activo"); los demas errores se explican
// como en el resto de la estacion.
function avisarRechazoDeCuenta(error, accion) {
  if (error && error.sesionCambiada) return;
  if ((error.estado === 400 || error.estado === 409) && error.cuerpo && error.cuerpo.error) {
    aviso("No se pudo " + accion, error.cuerpo.error, "aviso");
    return;
  }
  avisarError(error, accion);
}

async function pintarUsuarios() {
  const nodo = $("usuarios-lista");
  esqueleto(nodo, 4, true);
  let datos;
  try {
    datos = await pedir("/api/usuarios");
  } catch (error) {
    problema(nodo, error, "consultar las cuentas del personal", pintarUsuarios);
    if (error.sesionExpirada) sesionExpirada();
    return;
  }
  estadoUsuarios.cuentas = datos.cuentas;
  pintarListaUsuarios();
}

function botonCuenta(texto, alPulsar, peligro) {
  const b = document.createElement("button");
  b.className = "accion-sec" + (peligro ? " accion-sec--peligro" : "");
  b.type = "button";
  b.textContent = texto;
  b.addEventListener("click", alPulsar);
  return b;
}

function pintarListaUsuarios() {
  const nodo = $("usuarios-lista");
  const filtro = $("usuarios-estado").value;
  const todas = estadoUsuarios.cuentas;
  const visibles = todas.filter((c) =>
    filtro === "TODAS" ? true : filtro === "ACTIVAS" ? c.activo : !c.activo);

  const activas = todas.filter((c) => c.activo).length;
  $("usuarios-meta").textContent =
    visibles.length + (visibles.length === 1 ? " cuenta" : " cuentas") + " · " +
    (filtro === "TODAS" ? "activas y desactivadas"
      : filtro === "ACTIVAS" ? "solo activas" : "solo desactivadas") +
    " · " + activas + " activa(s) de " + todas.length;

  nodo.textContent = "";
  if (!visibles.length) {
    if (filtro === "DESACTIVADAS") {
      vacio(nodo, "No hay cuentas desactivadas",
        "Cuando desactive una cuenta aparecerá aquí, con su motivo y su historial.");
    } else {
      vacio(nodo, "No hay cuentas que mostrar",
        "Use «Dar de alta» para crear la cuenta de una persona del personal.");
    }
    return;
  }

  const columnas = [
    { rotulo: "Persona" }, { rotulo: "Rol" }, { rotulo: "Estado" },
    { rotulo: "Último ingreso" }, { rotulo: "Creada por" }, { rotulo: "" },
  ];

  const filas = visibles.map((c) => {
    const quien = document.createElement("div");
    const nombre = document.createElement("p");
    nombre.className = "padron__nombre";
    nombre.textContent = c.nombre;
    const codigo = document.createElement("p");
    codigo.className = "padron__codigo";
    codigo.textContent = c.usuario + (c.usuario === SESION.usuario ? " · su cuenta" : "");
    quien.append(nombre, codigo);

    const est = estadoDeCuenta(c);
    const celdaEstado = document.createElement("div");
    celdaEstado.appendChild(marbeteEstado(est.clave, est.texto));
    const detalleEstado = document.createElement("p");
    detalleEstado.className = "padron__codigo";
    if (!c.activo) {
      detalleEstado.textContent = "el " + fechaLegible(c.desactivadoEn) + " por " +
        c.desactivadoPor + ": " + c.motivoDesactivacion;
    } else if (c.debeCambiarClave && c.claveTemporalVence) {
      detalleEstado.textContent = "vence el " + fechaLegible(c.claveTemporalVence);
    }
    if (detalleEstado.textContent) celdaEstado.appendChild(detalleEstado);

    const acciones = document.createElement("div");
    acciones.className = "ficha__acciones usuarios__acciones";
    let porque = null;
    if (c.activo) {
      const restablecer = botonCuenta("Restablecer clave", () => restablecerClave(c));
      const desactivar = botonCuenta("Desactivar", () => abrirDesactivar(c), true);
      acciones.append(botonCuenta("Editar", () => abrirFormularioUsuario(c)), restablecer, desactivar);
      const motivos = [];
      // Restablecer la propia clave cerraria esta misma sesion antes de que
      // la clave temporal llegara a verse.
      if (c.usuario === SESION.usuario) {
        restablecer.disabled = true;
        motivos.push("Su propia clave se cambia con «Cambiar mi clave».");
      }
      const motivo = motivoParaNoDesactivar(c);
      if (motivo) { desactivar.disabled = true; motivos.push(motivo); }
      if (motivos.length) {
        porque = document.createElement("p");
        porque.className = "usuarios__motivo";
        porque.id = "motivo-" + c.usuario;
        porque.textContent = motivos.join(" ");
        for (const b of [restablecer, desactivar]) {
          if (b.disabled) b.setAttribute("aria-describedby", porque.id);
        }
      }
    } else {
      // Desactivada: se ve, pero no se edita. Solo se reactiva.
      acciones.appendChild(botonCuenta("Reactivar", () => reactivarCuenta(c)));
    }
    acciones.appendChild(botonCuenta("Ver bitácora", () => abrirBitacora(c)));
    // El porque de los botones apagados, debajo de todos, en su propia linea.
    if (porque) acciones.appendChild(porque);

    return [quien, ETIQUETA_ROL_CUENTA[c.rol] || c.rol, celdaEstado,
            c.ultimoIngreso ? fechaLegible(c.ultimoIngreso) : "nunca",
            c.creadoPor + " · " + fechaLegible(c.creadoEn), acciones];
  });

  nodo.appendChild(tablaInforme(columnas, filas, null));
}

$("usuarios-estado").addEventListener("change", pintarListaUsuarios);


/* ---------------------------------------------------------------------
   La clave temporal

   Se muestra una sola vez, en un cuadro aparte. No vive en ninguna
   variable: se escribe en el cuadro y, al cerrarlo, se borra de ahi. Nunca
   toca sessionStorage.
   --------------------------------------------------------------------- */

let soltarFocoClave = null;
let abrioLaClave = null;

function mostrarClaveTemporal(titulo, cuenta, clave, vence) {
  abrioLaClave = document.activeElement;
  $("clave-titulo").textContent = titulo;
  $("clave-para").textContent = "Para " + cuenta.nombre + " · usuario " + cuenta.usuario;
  $("clave-valor").textContent = clave;
  $("clave-copiada").textContent = "";
  $("clave-vence").textContent = vence
    ? "Vence el " + fechaLegible(vence) + ". Si no la usa antes, habrá que restablecerla."
    : "";
  $("cuadro-clave").hidden = false;
  $("velo-clave").hidden = false;
  soltarFocoClave = atraparFoco($("cuadro-clave"));
  $("clave-copiar").focus();
}

function cerrarClaveTemporal() {
  if ($("cuadro-clave").hidden) return;
  $("cuadro-clave").hidden = true;
  $("velo-clave").hidden = true;
  for (const id of ["clave-para", "clave-valor", "clave-vence", "clave-copiada"]) {
    $(id).textContent = "";
  }
  if (soltarFocoClave) { soltarFocoClave(); soltarFocoClave = null; }
  // El boton que abrio la accion puede haberse repintado con la lista.
  const destino = abrioLaClave && document.contains(abrioLaClave)
    ? abrioLaClave : $("abrir-alta-usuario");
  if (destino && destino.focus && !$("vista-usuarios").hidden) destino.focus();
  abrioLaClave = null;
}

$("clave-cerrar").addEventListener("click", cerrarClaveTemporal);

$("clave-copiar").addEventListener("click", async () => {
  const estadoCopia = $("clave-copiada");
  try {
    await navigator.clipboard.writeText($("clave-valor").textContent);
    estadoCopia.textContent = "Copiada al portapapeles.";
  } catch (_) {
    estadoCopia.textContent =
      "El navegador no dejó copiarla: selecciónela y cópiela a mano.";
  }
});


/* ---------------------------------------------------------------------
   Alta y edicion
   --------------------------------------------------------------------- */

let soltarFocoUsuario = null;
let abrioElUsuario = null;

function abrirFormularioUsuario(cuenta) {
  estadoUsuarios.editando = cuenta || null;
  abrioElUsuario = document.activeElement;
  const alta = !cuenta;

  $("usuario-titulo").textContent = alta ? "Dar de alta una cuenta" : "Editar a " + cuenta.nombre;
  $("guardar-usuario").textContent = alta ? "Dar de alta" : "Guardar los cambios";
  $("usuario-nota").textContent = alta
    ? "La cuenta nace con una clave temporal que se le muestra una sola vez y " +
      "vence a las 72 horas. La persona la cambia por una propia al entrar."
    : "Cambiar el rol cierra en el acto las sesiones abiertas de esta persona: " +
      "tiene que volver a entrar con el rol nuevo.";

  $("campo-usuario-usuario").hidden = !alta;
  $("usuario-usuario").required = alta;
  $("usuario-usuario").value = "";
  $("usuario-nombre").value = cuenta ? cuenta.nombre : "";
  $("usuario-rol").value = cuenta ? cuenta.rol : "ENFERMERIA";

  const motivo = alta ? null : motivoParaNoCambiarRol(cuenta);
  $("usuario-rol").disabled = Boolean(motivo);
  $("usuario-rol-motivo").textContent = motivo || "";

  $("cajon-usuario").hidden = false;
  $("velo-usuario").hidden = false;
  soltarFocoUsuario = atraparFoco($("cajon-usuario"));
  (alta ? $("usuario-usuario") : $("usuario-nombre")).focus();
}

function cerrarFormularioUsuario() {
  if ($("cajon-usuario").hidden) return;
  $("cajon-usuario").hidden = true;
  $("velo-usuario").hidden = true;
  estadoUsuarios.editando = null;
  $("usuario-rol").disabled = false;
  if (soltarFocoUsuario) { soltarFocoUsuario(); soltarFocoUsuario = null; }
  if (abrioElUsuario && abrioElUsuario.focus && document.contains(abrioElUsuario)) {
    abrioElUsuario.focus();
  }
  abrioElUsuario = null;
}

$("abrir-alta-usuario").addEventListener("click", () => abrirFormularioUsuario(null));
$("cerrar-usuario").addEventListener("click", cerrarFormularioUsuario);
$("velo-usuario").addEventListener("click", cerrarFormularioUsuario);

$("formulario-usuario").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const editando = estadoUsuarios.editando;
  const nombre = $("usuario-nombre").value.trim();
  const rol = $("usuario-rol").value;
  const rolBloqueado = $("usuario-rol").disabled;

  if (editando && !rolBloqueado && rol !== editando.rol) {
    const seguro = await confirmar({
      titulo: "¿Cambiar el rol de " + editando.nombre + "?",
      textoSi: "Sí, cambiar el rol",
      datos: [
        ["Cuenta", editando.usuario],
        ["Rol actual", ETIQUETA_ROL_CUENTA[editando.rol] || editando.rol],
        ["Rol nuevo", ETIQUETA_ROL_CUENTA[rol] || rol],
      ],
      aviso: "Sus sesiones abiertas se cierran en el acto: tendrá que volver a " +
             "entrar, y desde ese momento verá lo que le toca al rol nuevo.",
    });
    if (!seguro) return;
  }

  const boton = $("guardar-usuario");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Guardando…";
  try {
    if (editando) {
      const cuerpo = { nombre };
      if (!rolBloqueado) cuerpo.rol = rol;
      const r = await pedir("/api/usuarios/" + encodeURIComponent(editando.usuario), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      aviso("Cuenta actualizada", r.cuenta.nombre + " · " +
        (ETIQUETA_ROL_CUENTA[r.cuenta.rol] || r.cuenta.rol), "ok");
      cerrarFormularioUsuario();
    } else {
      const r = await pedir("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario: $("usuario-usuario").value.trim().toLowerCase(), nombre, rol,
        }),
      });
      cerrarFormularioUsuario();
      mostrarClaveTemporal("Cuenta creada · clave temporal", r.cuenta,
        r.claveTemporal, r.claveTemporalVence);
    }
    await pintarUsuarios();
  } catch (error) {
    avisarRechazoDeCuenta(error, editando ? "guardar los cambios" : "dar de alta la cuenta");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});


/* ---------------------------------------------------------------------
   Restablecer y reactivar: las dos emiten una clave temporal nueva
   --------------------------------------------------------------------- */

async function restablecerClave(c) {
  const seguro = await confirmar({
    titulo: "¿Restablecer la clave de " + c.nombre + "?",
    textoSi: "Sí, restablecer",
    datos: [["Cuenta", c.usuario], ["Rol", ETIQUETA_ROL_CUENTA[c.rol] || c.rol]],
    aviso: "Su clave actual deja de servir y sus sesiones abiertas se cierran en " +
           "el acto. Recibirá una clave temporal que vence a las 72 horas.",
  });
  if (!seguro) return;
  try {
    const r = await pedir("/api/usuarios/" + encodeURIComponent(c.usuario) + "/restablecer",
      { method: "POST" });
    await pintarUsuarios();
    mostrarClaveTemporal("Clave restablecida · clave temporal", r.cuenta,
      r.claveTemporal, r.claveTemporalVence);
  } catch (error) {
    avisarRechazoDeCuenta(error, "restablecer la clave");
  }
}

async function reactivarCuenta(c) {
  const seguro = await confirmar({
    titulo: "¿Reactivar la cuenta de " + c.nombre + "?",
    textoSi: "Sí, reactivar",
    datos: [
      ["Cuenta", c.usuario],
      ["Desactivada", fechaLegible(c.desactivadoEn) + " por " + c.desactivadoPor],
      ["Motivo", c.motivoDesactivacion || "—"],
    ],
    aviso: "Vuelve a poder entrar, con una clave temporal nueva: estuvo fuera y su " +
           "clave anterior ya no se da por segura.",
  });
  if (!seguro) return;
  try {
    const r = await pedir("/api/usuarios/" + encodeURIComponent(c.usuario) + "/reactivar",
      { method: "POST" });
    await pintarUsuarios();
    mostrarClaveTemporal("Cuenta reactivada · clave temporal", r.cuenta,
      r.claveTemporal, r.claveTemporalVence);
  } catch (error) {
    avisarRechazoDeCuenta(error, "reactivar la cuenta");
  }
}


/* ---------------------------------------------------------------------
   Desactivar
   --------------------------------------------------------------------- */

let soltarFocoDesactivar = null;
let abrioElDesactivar = null;

function abrirDesactivar(c) {
  estadoUsuarios.desactivando = c;
  abrioElDesactivar = document.activeElement;
  const cabecera = $("desactivar-cabecera");
  cabecera.textContent = "";
  cabecera.append(
    campo("Persona", c.nombre),
    campo("Usuario", c.usuario),
    campo("Rol", ETIQUETA_ROL_CUENTA[c.rol] || c.rol),
    campo("Último ingreso", c.ultimoIngreso ? fechaLegible(c.ultimoIngreso) : "nunca")
  );
  $("desactivar-motivo").value = "";
  $("cajon-desactivar").hidden = false;
  $("velo-desactivar").hidden = false;
  soltarFocoDesactivar = atraparFoco($("cajon-desactivar"));
  $("desactivar-motivo").focus();
}

function cerrarDesactivar() {
  if ($("cajon-desactivar").hidden) return;
  $("cajon-desactivar").hidden = true;
  $("velo-desactivar").hidden = true;
  estadoUsuarios.desactivando = null;
  if (soltarFocoDesactivar) { soltarFocoDesactivar(); soltarFocoDesactivar = null; }
  if (abrioElDesactivar && abrioElDesactivar.focus && document.contains(abrioElDesactivar)) {
    abrioElDesactivar.focus();
  }
  abrioElDesactivar = null;
}

$("cerrar-desactivar").addEventListener("click", cerrarDesactivar);
$("velo-desactivar").addEventListener("click", cerrarDesactivar);

$("formulario-desactivar").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const c = estadoUsuarios.desactivando;
  if (!c) return;
  const motivo = $("desactivar-motivo").value.trim();
  if (motivo.length < 3) {
    aviso("Falta el motivo", "Escriba por qué se desactiva la cuenta.", "aviso");
    $("desactivar-motivo").focus();
    return;
  }

  const seguro = await confirmar({
    titulo: "¿Desactivar la cuenta de " + c.nombre + "?",
    textoSi: "Sí, desactivar",
    tono: "peligro",
    datos: [
      ["Cuenta", c.usuario],
      ["Rol", ETIQUETA_ROL_CUENTA[c.rol] || c.rol],
      ["Motivo", motivo],
    ],
    aviso: "Deja de poder entrar y sus sesiones abiertas se cierran en el acto. " +
           "La cuenta no se borra: sigue en la lista y se puede reactivar.",
  });
  if (!seguro) return;

  const boton = $("confirmar-desactivar");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Desactivando…";
  try {
    await pedir("/api/usuarios/" + encodeURIComponent(c.usuario) + "/desactivar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo }),
    });
    aviso("Cuenta desactivada", c.nombre + " ya no puede entrar.", "ok");
    cerrarDesactivar();
    await pintarUsuarios();
  } catch (error) {
    avisarRechazoDeCuenta(error, "desactivar la cuenta");
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});


/* ---------------------------------------------------------------------
   Bitacora
   --------------------------------------------------------------------- */

let soltarFocoBitacora = null;
let abrioLaBitacora = null;

async function abrirBitacora(c) {
  if ($("cajon-bitacora").hidden) abrioLaBitacora = document.activeElement;
  $("bitacora-titulo").textContent = "Bitácora de " + c.nombre;
  const cabecera = $("bitacora-cabecera");
  cabecera.textContent = "";
  cabecera.append(campo("Usuario", c.usuario), campo("Estado", estadoDeCuenta(c).texto));
  $("cajon-bitacora").hidden = false;
  $("velo-bitacora").hidden = false;
  if (!soltarFocoBitacora) soltarFocoBitacora = atraparFoco($("cajon-bitacora"));
  $("cerrar-bitacora").focus();

  const nodo = $("bitacora-lista");
  esqueleto(nodo, 4, false);
  let datos;
  try {
    datos = await pedir("/api/usuarios/" + encodeURIComponent(c.usuario) + "/bitacora");
  } catch (error) {
    problema(nodo, error, "consultar la bitácora de la cuenta", () => abrirBitacora(c));
    if (error.sesionExpirada) sesionExpirada();
    return;
  }
  // Si la cerraron mientras llegaba, no se pinta.
  if ($("cajon-bitacora").hidden) return;
  nodo.textContent = "";
  if (!datos.registros.length) {
    vacio(nodo, "Sin movimientos", "Esta cuenta todavía no tiene nada en su bitácora.");
    return;
  }
  nodo.appendChild(tablaInforme(
    [{ rotulo: "Cuándo" }, { rotulo: "Qué" }, { rotulo: "Quién" }, { rotulo: "Detalle" }],
    datos.registros.map((r) => [fechaLegible(r.en),
      ETIQUETA_ACCION_CUENTA[r.accion] || r.accion, r.hechoPor, r.detalle || "—"]),
    null));
}

function cerrarBitacora() {
  if ($("cajon-bitacora").hidden) return;
  $("cajon-bitacora").hidden = true;
  $("velo-bitacora").hidden = true;
  if (soltarFocoBitacora) { soltarFocoBitacora(); soltarFocoBitacora = null; }
  if (abrioLaBitacora && abrioLaBitacora.focus && document.contains(abrioLaBitacora)) {
    abrioLaBitacora.focus();
  }
  abrioLaBitacora = null;
}

$("cerrar-bitacora").addEventListener("click", cerrarBitacora);
$("velo-bitacora").addEventListener("click", cerrarBitacora);


/* =====================================================================
   Información clínica · solo el MEDICO

   Psicopatologías, alergias y medicación permanente. El endpoint existía
   desde hace bloques, pero ningún botón lo llamaba: un interno dado de alta
   desde el padrón quedaba sin ficha clínica y ms-vigia no tenía contra qué
   protegerlo.

   La medicación permanente no se escribe a mano: cada fila elige un
   principio activo del vademécum de ms-vigia, porque un nombre mal escrito
   no da error, da silencio —el motor no lo reconocería—. Si ms-vigia no
   responde, ese bloque no se puede tocar: es el mismo criterio del
   servidor, que responde 503 en vez de guardar a ciegas.
   ===================================================================== */

const estadoClinica = {
  interno: null, psicopatologias: [], alergias: [], medicacion: [],
  vademecum: null, original: null,
};
let soltarFocoClinica = null;
let abrioLaClinica = null;

const VACIO_CLINICO = {
  psicopatologias: "Sin psicopatologías registradas.",
  alergias: "Sin alergias conocidas.",
};

function pintarListaClinica(clave) {
  const lista = $("clinica-" + clave);
  lista.textContent = "";
  const valores = estadoClinica[clave];
  if (!valores.length) {
    // Una lista vacía es un dato —«no tiene»—, y se dice con palabras.
    const li = document.createElement("li");
    li.className = "lista-editable__vacia";
    li.textContent = VACIO_CLINICO[clave];
    lista.appendChild(li);
    return;
  }
  valores.forEach((valor, i) => {
    const li = document.createElement("li");
    li.className = "lista-editable__item";
    const texto = document.createElement("span");
    texto.textContent = valor;
    const quitar = document.createElement("button");
    quitar.className = "accion-sec accion-sec--suave";
    quitar.type = "button";
    quitar.textContent = "Quitar";
    quitar.setAttribute("aria-label", "Quitar " + valor);
    quitar.addEventListener("click", () => {
      estadoClinica[clave].splice(i, 1);
      pintarListaClinica(clave);
      $(clave === "alergias" ? "clinica-alergia-nueva" : "clinica-psico-nueva").focus();
    });
    li.append(texto, quitar);
    lista.appendChild(li);
  });
}

function agregarALista(clave, campoId) {
  const campo = $(campoId);
  const valor = campo.value.trim().replace(/\s+/g, " ");
  if (!valor) { campo.focus(); return; }
  const repetido = estadoClinica[clave].some((v) => v.toLowerCase() === valor.toLowerCase());
  if (!repetido) estadoClinica[clave].push(valor);
  campo.value = "";
  pintarListaClinica(clave);
  campo.focus();
}

function nombreDelFarmaco(clave) {
  const f = (estadoClinica.vademecum || []).find((x) => x.principioActivo === clave);
  return f ? f.nombre : clave;
}

function pintarMedicacionClinica() {
  const caja = $("clinica-medicacion");
  caja.textContent = "";
  const vademecum = estadoClinica.vademecum;
  $("clinica-medicacion-agregar").disabled = !vademecum;
  $("clinica-vademecum-estado").textContent = vademecum ? "" :
    "ms-vigia no responde, así que la medicación permanente no se puede modificar " +
    "ahora: sin el vademécum no hay cómo comprobar que el motor reconozca cada " +
    "principio activo. Las psicopatologías y las alergias sí se pueden guardar.";

  if (!estadoClinica.medicacion.length) {
    const p = document.createElement("p");
    p.className = "parte parte--vacia";
    p.textContent = "No toma ninguna medicación permanente.";
    caja.appendChild(p);
    return;
  }

  estadoClinica.medicacion.forEach((m, i) => {
    const fila = document.createElement("div");
    fila.className = "medicacion-fija";

    if (!vademecum) {
      // Sin vademécum se muestra, pero no se edita.
      const texto = document.createElement("p");
      texto.className = "medicacion-fija__texto";
      texto.textContent = m.principioActivo +
        (m.dosisMg ? " " + m.dosisMg + " mg" : "") + (m.cadaHoras ? " cada " + m.cadaHoras + " h" : "");
      fila.appendChild(texto);
      caja.appendChild(fila);
      return;
    }

    const campoFarmaco = document.createElement("div");
    campoFarmaco.className = "campo";
    const rotulo = document.createElement("label");
    rotulo.textContent = "Principio activo";
    rotulo.setAttribute("for", "clinica-farmaco-" + i);
    const select = document.createElement("select");
    select.id = "clinica-farmaco-" + i;
    const vacia = document.createElement("option");
    vacia.value = "";
    vacia.textContent = "Elija del vademécum…";
    select.appendChild(vacia);
    const conocido = vademecum.some((f) => f.principioActivo === m.principioActivo);
    if (m.principioActivo && !conocido) {
      // Uno guardado que el vademécum ya no trae: se ve, y el servidor lo
      // rechazará si se intenta guardar así.
      const raro = document.createElement("option");
      raro.value = m.principioActivo;
      raro.textContent = m.principioActivo + " (no está en el vademécum)";
      select.appendChild(raro);
    }
    for (const f of vademecum) {
      const opcion = document.createElement("option");
      opcion.value = f.principioActivo;
      opcion.textContent = f.nombre + " — " + String(f.grupo || "").toLowerCase().replace(/_/g, " ");
      select.appendChild(opcion);
    }
    select.value = m.principioActivo || "";
    select.addEventListener("change", () => { m.principioActivo = select.value; });
    campoFarmaco.append(rotulo, select);

    const numero = (rotuloTexto, clave, sufijo) => {
      const c = document.createElement("div");
      c.className = "campo";
      const l = document.createElement("label");
      l.textContent = rotuloTexto;
      l.setAttribute("for", "clinica-" + clave + "-" + i);
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "any";
      input.id = "clinica-" + clave + "-" + i;
      input.placeholder = sufijo;
      input.value = m[clave] != null ? String(m[clave]) : "";
      input.addEventListener("input", () => {
        m[clave] = input.value === "" ? null : Number(input.value);
      });
      c.append(l, input);
      return c;
    };

    const quitar = document.createElement("button");
    quitar.className = "accion-sec accion-sec--suave";
    quitar.type = "button";
    quitar.textContent = "Quitar";
    quitar.setAttribute("aria-label", "Quitar " + (m.principioActivo || "esta fila"));
    quitar.addEventListener("click", () => {
      estadoClinica.medicacion.splice(i, 1);
      pintarMedicacionClinica();
      $("clinica-medicacion-agregar").focus();
    });

    fila.append(campoFarmaco, numero("Dosis (mg)", "dosisMg", "mg"),
                numero("Cada (horas)", "cadaHoras", "h"), quitar);
    caja.appendChild(fila);
  });
}

function pintarPieClinica(ficha) {
  $("clinica-pie").textContent = ficha.clinicaActualizadaPor
    ? "Última actualización: " + ficha.clinicaActualizadaPor + ", " +
      fechaLegible(ficha.clinicaActualizadaEn) + "."
    : "Última actualización: nunca. Este interno todavía no tiene ficha clínica.";
}

function cargarFormularioClinica(ficha) {
  estadoClinica.psicopatologias = [...(ficha.psicopatologias || [])];
  estadoClinica.alergias = [...(ficha.alergias || [])];
  estadoClinica.medicacion = (ficha.medicacionPermanente || []).map((m) => ({
    principioActivo: m.principioActivo, dosisMg: m.dosisMg ?? null, cadaHoras: m.cadaHoras ?? null,
  }));
  estadoClinica.original = {
    psicopatologias: [...estadoClinica.psicopatologias],
    alergias: [...estadoClinica.alergias],
    medicacion: estadoClinica.medicacion.map((m) => ({ ...m })),
  };
  $("clinica-titulo").textContent = "Información clínica de " + ficha.nombre;
  pintarListaClinica("psicopatologias");
  pintarListaClinica("alergias");
  pintarMedicacionClinica();
  pintarPieClinica(ficha);
}

async function abrirClinica(evento) {
  if (SESION.rol !== "MEDICO" || !estado.interno) return;
  const interno = estado.interno;
  if ($("cajon-clinica").hidden) {
    abrioLaClinica = (evento && evento.currentTarget) || document.activeElement;
  }
  estadoClinica.interno = interno;
  $("formulario-clinica").hidden = true;
  $("clinica-pie").textContent = "";
  esqueleto($("clinica-estado"), 4, true);
  $("cajon-clinica").hidden = false;
  $("velo-clinica").hidden = false;
  if (!soltarFocoClinica) soltarFocoClinica = atraparFoco($("cajon-clinica"));
  $("cerrar-clinica").focus();

  // El vademécum se pide aparte: si ms-vigia no responde, la ficha se edita
  // igual, menos la medicación permanente.
  let vademecum = null;
  try {
    vademecum = (await pedir(VIGIA + "/api/v1/vademecum")).farmacos;
  } catch (error) {
    if (error.sesionCambiada) return;
    if (error.sesionExpirada) { sesionExpirada(); return; }
  }

  let ficha;
  try {
    ficha = await pedir(PASTILLERO + "/api/v1/internos/" + encodeURIComponent(interno));
  } catch (error) {
    problema($("clinica-estado"), error, "traer la ficha clínica", () => abrirClinica());
    if (error.sesionExpirada) sesionExpirada();
    return;
  }
  // Si lo cerraron, o cambió de interno, mientras llegaba, no se pinta.
  if ($("cajon-clinica").hidden || estadoClinica.interno !== interno) return;

  estadoClinica.vademecum = vademecum;
  $("clinica-estado").textContent = "";
  $("formulario-clinica").hidden = false;
  cargarFormularioClinica(ficha);
}

function cerrarClinica() {
  if ($("cajon-clinica").hidden) return;
  $("cajon-clinica").hidden = true;
  $("velo-clinica").hidden = true;
  if (soltarFocoClinica) { soltarFocoClinica(); soltarFocoClinica = null; }
  if (abrioLaClinica && abrioLaClinica.focus && document.contains(abrioLaClinica)) {
    abrioLaClinica.focus();
  }
  abrioLaClinica = null;
}

// Lo que cambió, en palabras, para el aviso de después de guardar.
function cambiosClinicos(antes, despues) {
  const partes = [];
  const listas = [["psicopatologias", "psicopatología"], ["alergias", "alergia"]];
  for (const [clave, nombre] of listas) {
    const a = antes[clave].map((x) => x.toLowerCase());
    const d = despues[clave].map((x) => x.toLowerCase());
    const nuevas = despues[clave].filter((x) => !a.includes(x.toLowerCase()));
    const quitadas = antes[clave].filter((x) => !d.includes(x.toLowerCase()));
    if (nuevas.length) partes.push(nombre + (nuevas.length > 1 ? "s" : "") + " agregada" +
      (nuevas.length > 1 ? "s" : "") + ": " + nuevas.join(", "));
    if (quitadas.length) partes.push(nombre + (quitadas.length > 1 ? "s" : "") + " quitada" +
      (quitadas.length > 1 ? "s" : "") + ": " + quitadas.join(", "));
  }
  const pa = antes.medicacion.map((m) => m.principioActivo);
  const pd = despues.medicacion.map((m) => m.principioActivo);
  const nuevos = pd.filter((p) => !pa.includes(p));
  const quitados = pa.filter((p) => !pd.includes(p));
  if (nuevos.length) partes.push("medicación permanente agregada: " + nuevos.map(nombreDelFarmaco).join(", "));
  if (quitados.length) partes.push("medicación permanente quitada: " + quitados.map(nombreDelFarmaco).join(", "));
  const ajustados = despues.medicacion.filter((m) => {
    const previo = antes.medicacion.find((x) => x.principioActivo === m.principioActivo);
    return previo && (previo.dosisMg !== m.dosisMg || previo.cadaHoras !== m.cadaHoras);
  });
  if (ajustados.length) partes.push("dosis ajustada: " + ajustados.map((m) => nombreDelFarmaco(m.principioActivo)).join(", "));
  return partes;
}

function textoMedicacion(lista) {
  if (!lista.length) return "ninguna";
  return lista.map((m) => nombreDelFarmaco(m.principioActivo) +
    (m.dosisMg ? " " + m.dosisMg + " mg" : "") + (m.cadaHoras ? " cada " + m.cadaHoras + " h" : ""))
    .join(", ");
}

$("formulario-clinica").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const interno = estadoClinica.interno;
  if (!interno) return;

  const conMedicacion = Boolean(estadoClinica.vademecum);
  if (conMedicacion) {
    const sinFarmaco = estadoClinica.medicacion.some((m) => !m.principioActivo);
    const claves = estadoClinica.medicacion.map((m) => m.principioActivo);
    const repetido = claves.find((c, i) => claves.indexOf(c) !== i);
    const malNumero = estadoClinica.medicacion.some((m) =>
      [m.dosisMg, m.cadaHoras].some((n) => n != null && !(n > 0)));
    if (sinFarmaco || repetido || malNumero) {
      aviso("Revise la medicación permanente",
        sinFarmaco ? "Hay una fila sin principio activo: elíjalo del vademécum o quítela."
          : repetido ? "El principio activo " + nombreDelFarmaco(repetido) + " está dos veces."
          : "La dosis y la frecuencia, si se indican, tienen que ser mayores que cero.",
        "aviso");
      return;
    }
  }

  const nombre = INTERNOS[interno] ? INTERNOS[interno].nombre : interno;
  const seguro = await confirmar({
    titulo: "¿Guardar la información clínica de " + nombre + "?",
    textoSi: "Sí, guardar",
    datos: [
      ["Interno", nombre + " · " + interno],
      ["Psicopatologías", estadoClinica.psicopatologias.join(", ") || "ninguna registrada"],
      ["Alergias", estadoClinica.alergias.join(", ") || "sin alergias conocidas"],
      ["Medicación permanente", conMedicacion ? textoMedicacion(estadoClinica.medicacion)
        : "sin cambios (ms-vigia no responde)"],
    ],
    aviso: "Estos datos deciden los dictámenes de ms-vigia: con ellos bloquea o aprueba " +
           "cada medicamento que se le recete a este interno. El cambio queda firmado " +
           "con su sesión.",
  });
  if (!seguro) return;

  const cuerpo = {
    psicopatologias: estadoClinica.psicopatologias,
    alergias: estadoClinica.alergias,
  };
  if (conMedicacion) {
    cuerpo.medicacionPermanente = estadoClinica.medicacion.map((m) => {
      const item = { principioActivo: m.principioActivo };
      if (m.dosisMg != null) item.dosisMg = m.dosisMg;
      if (m.cadaHoras != null) item.cadaHoras = m.cadaHoras;
      return item;
    });
  }

  const boton = $("guardar-clinica");
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = "Guardando…";
  const antes = estadoClinica.original;
  try {
    const ficha = await pedir(PASTILLERO + "/api/v1/internos/" + encodeURIComponent(interno) + "/clinica", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    cargarFormularioClinica(ficha);
    const cambios = cambiosClinicos(antes, estadoClinica.original);
    aviso("Información clínica guardada",
      (cambios.length ? cambios.join(" · ") : "Sin cambios en los datos") +
      ". Desde ahora ms-vigia dictamina con esta ficha.", "ok");

    // La ficha repintada donde se esté viendo: el padrón en memoria, la
    // jornada si está abierta y la ficha médica completa si está debajo.
    if (INTERNOS[interno]) Object.assign(INTERNOS[interno], ficha);
    if (rutaActual.vista === "jornada" && estado.interno === interno) cargarInterno();
    if (!$("cajon-ficha").hidden) abrirFicha();
  } catch (error) {
    if (error.sesionCambiada) return;
    if ((error.estado === 503 || error.estado === 400) && error.cuerpo && error.cuerpo.error) {
      const detalles = (error.cuerpo.detalles || []).join(" ");
      aviso(error.estado === 503 ? "No se guardó nada" : "Revise los datos",
        (error.estado === 503 ? error.cuerpo.error : detalles || error.cuerpo.error), "aviso");
    } else {
      avisarError(error, "guardar la información clínica");
    }
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
});

$("clinica-psico-agregar").addEventListener("click", () =>
  agregarALista("psicopatologias", "clinica-psico-nueva"));
$("clinica-alergia-agregar").addEventListener("click", () =>
  agregarALista("alergias", "clinica-alergia-nueva"));
// Enter en el campo agrega a la lista; no envía el formulario entero.
for (const [campo, clave] of [["clinica-psico-nueva", "psicopatologias"], ["clinica-alergia-nueva", "alergias"]]) {
  $(campo).addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); agregarALista(clave, campo); }
  });
}
$("clinica-medicacion-agregar").addEventListener("click", () => {
  estadoClinica.medicacion.push({ principioActivo: "", dosisMg: null, cadaHoras: null });
  pintarMedicacionClinica();
  const ultima = estadoClinica.medicacion.length - 1;
  $("clinica-farmaco-" + ultima).focus();
});
$("abrir-clinica").addEventListener("click", abrirClinica);
$("abrir-clinica-ficha").addEventListener("click", abrirClinica);
$("cerrar-clinica").addEventListener("click", cerrarClinica);
$("velo-clinica").addEventListener("click", cerrarClinica);
