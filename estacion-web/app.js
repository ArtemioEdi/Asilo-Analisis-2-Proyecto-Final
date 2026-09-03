// =====================================================================
// Estacion de enfermeria · Asilo Cabeza de Algodon
// Consume ms-vigia, ms-pastillero y ms-caja siempre a traves de
// ms-gateway, que es el unico origen que conoce el navegador.
// =====================================================================

const AUTH = "/api/auth";
const VIGIA = "/vigia";
const PASTILLERO = "/pastillero";
const CAJA = "/caja";

// Las fichas de los internos ya NO viven aqui. Estaban quemadas en este
// archivo, o sea en el navegador, y son los tres datos —edad, alergias y
// psicopatologias— con los que ms-vigia decide si bloquea un medicamento.
// Ahora el padron vive en ms-pastillero y esto es solo una cache de
// presentacion: alterarla no cambia ningun dictamen, porque ms-vigia arma
// la ficha por su cuenta y del cliente solo recibe el pacienteId.
const INTERNOS = {};

const SESION = { token: null, usuario: null, nombre: null, rol: null };
const estado = { interno: null, medicacion: [], dictamen: null, receta: null };
let TARIFAS_CAJA = [];

// A donde queria ir la persona antes de que le pidieran iniciar sesion.
// Se guarda para devolverla ahi despues de entrar, en vez de dejarla en
// una vista cualquiera.
let rutaPretendida = location.hash || "";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------

function servicioDe(url) {
  if (url.startsWith(VIGIA)) return "ms-vigia";
  if (url.startsWith(PASTILLERO)) return "ms-pastillero";
  if (url.startsWith(CAJA)) return "ms-caja";
  return "ms-gateway";
}

async function pedir(url, opciones) {
  opciones = opciones || {};
  const encabezados = Object.assign({}, opciones.headers || {});
  if (SESION.token) encabezados["Authorization"] = "Bearer " + SESION.token;

  let respuesta;
  try {
    respuesta = await fetch(url, Object.assign({}, opciones, { headers: encabezados }));
  } catch (_) {
    // Ni siquiera se pudo hablar con la estacion: no hay respuesta que leer.
    const caido = new Error("sin-red");
    caido.red = true;
    caido.servicio = servicioDe(url);
    throw caido;
  }

  let cuerpo = null;
  try { cuerpo = await respuesta.json(); } catch (_) { cuerpo = null; }

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

// ---------------------------------------------------------------------
// Traduccion de errores.
//
// Nunca se le muestra a la persona el mensaje crudo del servidor: se
// distingue "el servicio no responde" de "la peticion fue rechazada", y
// se dice que hacer en cada caso.
// ---------------------------------------------------------------------

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
      titulo: "No hay conexión con la estación",
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

// ---------------------------------------------------------------------
// Avisos
//
// Los errores se quedan hasta que la persona los cierre. Los demas se
// van solos a los 6 segundos. Todo se anuncia por la region aria-live.
// ---------------------------------------------------------------------

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

  // Solo lo que no es un error desaparece solo.
  if (tipo !== "error") setTimeout(() => nodo.remove(), 6000);
  return nodo;
}

function avisarError(error, accion, alReintentar) {
  if (error && error.sesionExpirada) { sesionExpirada(); return; }
  const e = explicarError(error, accion);
  let texto = e.texto;
  if (e.detalles && e.detalles.length) texto += " " + e.detalles.join(" ");
  aviso(e.titulo, texto, e.reintentar && e.espera ? "aviso" : "error",
        e.reintentar ? alReintentar : null);
}

// ---------------------------------------------------------------------
// Foco atrapado dentro de un dialogo
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Confirmacion de actos irreversibles
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Esqueletos de carga
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Enrutado por hash
//
// Las vistas son enlazables (#/jornada, #/caja, #/interno/ASL-014) y el
// boton de atras del navegador funciona.
// ---------------------------------------------------------------------

const VISTAS = ["jornada", "caja"];

// MEDICO ve las dos. ENFERMERIA no entra a la caja del asilo.
// ADMINISTRACION no entra a la jornada de medicacion.
function vistaPermitida(vista) {
  if (vista === "caja") return SESION.rol === "ADMINISTRACION" || SESION.rol === "MEDICO";
  if (vista === "jornada") return SESION.rol === "MEDICO" || SESION.rol === "ENFERMERIA";
  return false;
}
function vistaPorDefecto() {
  return SESION.rol === "ADMINISTRACION" ? "caja" : "jornada";
}

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
}

function sincronizarDesdeHash() {
  if (!SESION.token) return;
  irA(parsearHash(location.hash), true);
}

window.addEventListener("popstate", sincronizarDesdeHash);
window.addEventListener("hashchange", sincronizarDesdeHash);

function pintarVista(nombre) {
  $("vista-jornada").hidden = nombre !== "jornada";
  $("vista-caja").hidden = nombre !== "caja";
  document.querySelectorAll(".pestana").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.vista === nombre)));
  window.scrollTo({ top: 0, behavior: "auto" });
}

document.querySelectorAll(".pestana").forEach((boton) => {
  boton.addEventListener("click", () => irA({ vista: boton.dataset.vista, interno: estado.interno }));
});

// ---------------------------------------------------------------------
// Sesion
// ---------------------------------------------------------------------

function guardarSesion(datos) {
  SESION.token = datos.token;
  SESION.usuario = datos.usuario;
  SESION.nombre = datos.nombre;
  SESION.rol = datos.rol;
  sessionStorage.setItem("sesionAsilo", JSON.stringify(SESION));
}

function limpiarSesion() {
  SESION.token = null; SESION.usuario = null; SESION.nombre = null; SESION.rol = null;
  sessionStorage.removeItem("sesionAsilo");
}

function mostrarAcceso(mensajeReanudar) {
  const reanudar = $("acceso-reanudar");
  reanudar.hidden = !mensajeReanudar;
  reanudar.textContent = mensajeReanudar || "";
  $("acceso").hidden = false;
  $("superior").hidden = true;
  $("armazon").hidden = true;
  $("barra").hidden = true;
  $("acceso-clave").value = "";
  // El usuario escrito NO se borra: solo la clave.
  $("acceso-usuario").focus();
  $("acceso-usuario").select();
}

// La sesion vencio. No se expulsa de golpe: se avisa, se guarda donde
// estaba la persona y se la devuelve ahi cuando vuelva a entrar.
function sesionExpirada() {
  if (!SESION.token) return;
  rutaPretendida = location.hash || "";
  const usuario = SESION.usuario;
  limpiarSesion();
  cerrarCajon();
  rutaActual = { vista: null, interno: null };
  clearInterval(relojBarra);
  $("acceso-usuario").value = usuario || "";
  mostrarAcceso(
    "Su sesión expiró por seguridad. Vuelva a ingresar y lo devolvemos a donde estaba."
  );
}

async function cerrarSesion() {
  // Se le avisa al gateway para que meta el token en la lista de
  // revocacion. Sin esto, borrar la sesion del navegador no invalida
  // nada: el token sigue sirviendo hasta que venza.
  const token = SESION.token;
  if (token) pedir(AUTH + "/logout", { method: "POST" }).catch(() => { });
  limpiarSesion();
  cerrarCajon();
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
      throw new Error("Usuario o clave incorrectos.");
    }
    guardarSesion(cuerpo);
    await mostrarApp();
  } catch (e) {
    // El error va junto al campo, y lo que la persona escribio se queda.
    error.textContent = e.message === "Failed to fetch"
      ? "No hay conexión con la estación. Revise que el sistema esté levantado."
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
  // Solo se muestran las pestañas que el rol puede usar.
  $("pestana-jornada").hidden = !vistaPermitida("jornada");
  $("pestana-caja").hidden = !vistaPermitida("caja");
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
  // La vista del rol se elige ANTES de descubrir la pantalla. Si no, se
  // alcanza a ver un instante la jornada de medicacion incluso cuando la
  // sesion es de administracion, que no deberia verla nunca.
  pintarVista(vistaPorDefecto());
  $("acceso").hidden = true;
  $("superior").hidden = false;
  $("armazon").hidden = false;
  $("barra").hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
  await iniciarApp();
}

// ---------------------------------------------------------------------
// Barra de estado de los servicios
// ---------------------------------------------------------------------

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

  for (const [clave, base] of [["vigia", VIGIA], ["pastillero", PASTILLERO], ["caja", CAJA]]) {
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

  if (SESION.rol !== "ADMINISTRACION") {
    try {
      const t = await pedir(PASTILLERO + "/api/v1/turnos");
      $("barra-turno").textContent = "turno " + t.turnoActual;
      $("barra-hora").textContent = t.hora;
    } catch (_) { }
  }
}

// ---------------------------------------------------------------------
// Padron de internos
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Ficha del interno
// ---------------------------------------------------------------------

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
    f.pacienteId + " · " + f.edad + " años · " + f.cama + " · ingresó el " + f.ingreso;

  const datos = $("datos-interno");
  datos.textContent = "";

  // A administracion el servicio le devuelve la ficha sin la parte
  // clinica, asi que esos campos llegan sin definir.
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
  for (const m of estado.medicacion) {
    const linea = document.createElement("div");
    const texto = document.createElement("span");
    texto.textContent = m.farmaco + " " + m.dosisMg + " mg cada " + m.cadaHoras + " h";
    linea.appendChild(texto);
    // Suspender un tratamiento tambien es un acto clinico: solo el medico,
    // y con confirmacion.
    if (SESION.rol === "MEDICO" && m.planId) {
      const boton = document.createElement("button");
      boton.className = "accion-sec accion-sec--suave";
      boton.type = "button";
      boton.style.marginLeft = "8px";
      boton.textContent = "Suspender";
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
      body: JSON.stringify({ motivo: "Suspendido por " + SESION.nombre + " desde la estación" })
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

// ---------------------------------------------------------------------
// Jornada de medicacion
// ---------------------------------------------------------------------

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

    // La etiqueta viaja en el DOM aunque en pantalla ancha no se vea: en
    // pantalla angosta la regla se vuelve linea de tiempo vertical y esto
    // es lo que se lee.
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
    derecha.textContent = delTurno.length + " tomas";
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

  // Registrar o ausentar una toma es tarea clinica: solo medico o
  // enfermeria, igual que exige el gateway del lado del servidor.
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

// Administrar un medicamento es un acto clinico irreversible: se
// confirma mostrando a quien, que, cuanto y a que hora.
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
    // Se dice exactamente que cambio, y la fila afectada queda resaltada.
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

// ---------------------------------------------------------------------
// Recetario (cajon lateral)
// ---------------------------------------------------------------------

const cajon = $("cajon");
const velo = $("velo");
let soltarFocoCajon = null;
let abrioElCajon = null;

async function cargarVademecum() {
  const select = $("principioActivo");
  try {
    const datos = await pedir(VIGIA + "/api/v1/vademecum");
    select.textContent = "";
    for (const f of datos.farmacos) {
      const opcion = document.createElement("option");
      opcion.value = f.principioActivo;
      opcion.textContent = f.nombre + " — " + f.grupo.toLowerCase().replace(/_/g, " ");
      select.appendChild(opcion);
    }
    select.value = "ibuprofeno";
  } catch (_) {
    select.textContent = "";
    const opcion = document.createElement("option");
    opcion.value = "";
    opcion.textContent = "ms-vigia no responde";
    select.appendChild(opcion);
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
  if (e.key === "Escape" && !cajon.hidden) cerrarCajon();
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
    // Se manda UNICAMENTE a quien se le va a recetar y que. La edad, las
    // alergias, las psicopatologias y la medicacion activa las busca
    // ms-vigia por su cuenta en ms-pastillero.
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

// Todo el contenido de aqui viene del servidor, asi que se construye con
// nodos y textContent: nunca se concatena en innerHTML.
function pintarDictamen(d) {
  const caja = $("dictamen");
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
  folio.textContent = "folio " + d.folio + " · riesgo " + d.puntajeRiesgo + " de 100";

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

  if (d.veredicto !== "BLOQUEADO") {
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

// ---------------------------------------------------------------------
// Caja y donaciones
// ---------------------------------------------------------------------

async function pintarCaja() {
  const interno = INTERNOS[estado.interno];
  if (!interno) return;
  $("caja-interno-nombre").textContent = interno.nombre;
  $("caja-meta").textContent = SESION.rol === "ADMINISTRACION"
    ? "Módulo de entradas, salidas y caja: cobros con el descuento de la fundación, donaciones y gastos del asilo."
    : "Estado de cuenta del interno. Le sirve para saber si la familia puede costear un estudio antes de indicarlo.";

  const resumenNodo = $("caja-resumen");
  resumenNodo.textContent = "";
  // El estado financiero del asilo es solo de administracion. El medico
  // entra aqui unicamente por el estado de cuenta del interno.
  if (SESION.rol === "ADMINISTRACION") {
    esqueleto(resumenNodo, 4);
    try {
      const resumen = await pedir(CAJA + "/api/v1/resumen");
      resumenNodo.textContent = "";
      resumenNodo.append(
        campo("Entradas (donaciones + cobros)", "Q " + resumen.entradas.total.toFixed(2)),
        campo("Salidas (gastos + adeudo fundación)", "Q " + resumen.salidas.total.toFixed(2)),
        campo("Saldo pendiente de familiares", "Q " + resumen.saldoPendienteFamiliares.toFixed(2)),
        campo("Balance", "Q " + resumen.balance.toFixed(2))
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

// Registrar un pago tambien mueve dinero de una familia: se confirma.
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
    aviso: "Queda asentado en el libro de caja a su nombre y no se puede anular desde la estación."
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
    exito(respuesta, cuerpo);
    await pintarCaja();
  } catch (error) {
    avisarError(error, accion);
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}

$("formulario-cargo").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const interno = INTERNOS[estado.interno];
  enviarFormulario($("formulario-cargo"), () => {
    const clave = $("cargo-tarifa").value;
    const tarifa = TARIFAS_CAJA.find((t) => t.clave === clave);
    if (!tarifa) { aviso("Elija una tarifa", "Seleccione una tarifa del catálogo.", "aviso"); return null; }
    return {
      pacienteId: estado.interno,
      pacienteNombre: interno.nombre,
      categoria: tarifa.categoria,
      concepto: $("cargo-concepto").value.trim(),
      tarifa: clave
    };
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

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

let relojBarra;

async function iniciarApp() {
  const clinico = SESION.rol !== "ADMINISTRACION";
  const hayPadron = await cargarInternos();
  if (clinico) cargarVademecum();

  if (hayPadron) {
    // Se respeta a donde queria ir la persona antes del acceso. Si no
    // queria ir a ningun lado, o su rol no lo permite, entra en la vista
    // que le corresponde.
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

// Si ya habia una sesion guardada en esta pestaña, se valida contra el
// gateway antes de saltarse la pantalla de acceso.
(async function intentarSesionGuardada() {
  $("acceso-usuario").focus();
  const guardada = sessionStorage.getItem("sesionAsilo");
  if (!guardada) return;
  try {
    const datos = JSON.parse(guardada);
    if (!datos || !datos.token) return;
    Object.assign(SESION, datos);
    await pedir(AUTH + "/me");
    await mostrarApp();
  } catch (_) {
    limpiarSesion();
  }
})();
