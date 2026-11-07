// =====================================================================
//  AES O.S. Enterprise - LIS
// =====================================================================

// === CONEXIÓN FIREBASE ===
// (La apiKey de Firebase es pública por diseño. La seguridad real la dan
//  las REGLAS de la base de datos: ver archivo firebase_reglas.json)
const firebaseConfig = {
    apiKey: "AIzaSyBLuIk-gKICLWlLSdWNAsnVYPXxqvroijI",
    authDomain: "lis-aes.firebaseapp.com",
    databaseURL: "https://lis-aes-default-rtdb.firebaseio.com",
    projectId: "lis-aes",
    storageBucket: "lis-aes.firebasestorage.app",
    messagingSenderId: "333107041449",
    appId: "1:333107041449:web:e498022d3e04e876f9c5b8"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// Webhook de Make SOLO para auto-pedidos de inventario.
// (Los resultados del equipo ahora los escribe el motor directo en Firebase.)
const WEBHOOK_AUTOPEDIDO = "https://hook.us2.make.com/h5w14y7wlwdwh3ey492wa7kt7lbltt63";

// =====================================================================
//  UTILIDADES
// =====================================================================

// Evita que un nombre con caracteres raros (<, ", ') rompa la página
function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Para pasar texto como argumento dentro de onclick="funcion(...)"
function jsArg(s) { return esc(JSON.stringify(String(s))); }

// Fecha local de Bolivia en formato AAAA-MM-DD (NO usar toISOString, que da la fecha UTC)
function fechaLocalISO(d) {
    d = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function usuarioActual() { return (auth.currentUser && auth.currentUser.email) || "desconocido"; }
function num(x) { if (x === undefined || x === null || x === "") return null; const n = Number(String(x).replace(',', '.')); return isNaN(n) ? null : n; }
function calcularEdad(fechaNac) {
    if (!fechaNac) return "";
    const n = new Date(fechaNac + "T00:00:00"); if (isNaN(n)) return "";
    const h = new Date(); let e = h.getFullYear() - n.getFullYear();
    if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--;
    return e + " años";
}
// Firebase no acepta estos caracteres en las claves
function claveValida(k) { return k && !/[.#$\[\]\/]/.test(k); }

function registrarAuditoria(idResultado, accion, detalle) {
    return db.ref("resultados/" + idResultado + "/auditoria").push({ accion: accion, usuario: usuarioActual(), fecha: new Date().toISOString(), detalle: detalle || "" });
}

// =====================================================================
//  SESIÓN
// =====================================================================
let listenersActivos = false;

// =====================================================================
//  ROLES Y USUARIOS
// =====================================================================
const ROLES = {
    admin: { nombre: "Administrador", vistas: ["admision", "validacion", "historial", "estadisticas", "inventario", "configuracion"] },
    bioquimico: { nombre: "Bioquímico (valida)", vistas: ["admision", "validacion", "historial", "estadisticas", "inventario"] },
    recepcion: { nombre: "Recepción", vistas: ["admision", "validacion", "historial"] },
    consulta: { nombre: "Solo consulta", vistas: ["validacion", "historial", "estadisticas"] }
};
let miRol = null, miPerfil = null;
function puedeValidar() { return miRol === "admin" || miRol === "bioquimico"; }
function esAdmin() { return miRol === "admin"; }

auth.onAuthStateChanged(async user => {
    if (!user) {
        miRol = null; miPerfil = null;
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('sin-rol-screen').style.display = 'none';
        detenerListeners(); return;
    }
    document.getElementById('login-screen').style.display = 'none';
    try {
        const bloq = (await db.ref("usuarios_bloqueados/" + user.uid).once("value")).val();
        let perfil = (await db.ref("usuarios/" + user.uid).once("value")).val();
        if (!perfil && !bloq) {
            // Si todavía no existe ningún usuario registrado, el primero que entra queda como Administrador
            const hay = (await db.ref("usuarios").limitToFirst(1).once("value")).exists();
            if (!hay) {
                perfil = { email: user.email, nombre: user.email.split("@")[0], rol: "admin", activo: true, creado: new Date().toISOString() };
                await db.ref("usuarios/" + user.uid).set(perfil);
                await db.ref("propietario_uid").set(user.uid).catch(() => { });
            }
        }
        if (bloq || !perfil || perfil.activo === false || !ROLES[perfil.rol]) {
            if (!perfil && !bloq) await db.ref("usuarios_solicitudes/" + user.uid).set({ email: user.email, fecha: new Date().toISOString() }).catch(() => { });
            mostrarSinRol(user.email, bloq || (perfil && perfil.activo === false)); return;
        }
        miPerfil = perfil; miRol = perfil.rol;
    } catch (e) {
        mostrarSinRol(user.email, false, e.message); return;
    }
    aplicarRol();
    iniciarListeners();
});
function mostrarSinRol(email, bloqueado, error) {
    detenerListeners();
    document.getElementById('sin-rol-email').innerText = email || "";
    document.getElementById('sin-rol-msg').innerText = error ? "No se pudo verificar su usuario: " + error :
        (bloqueado ? "Su usuario está DESACTIVADO. Consulte con el administrador del laboratorio." : "Su usuario todavía no tiene un rol asignado. Pida al administrador que lo apruebe en Configuración → Usuarios y luego vuelva a entrar.");
    document.getElementById('sin-rol-screen').style.display = 'flex';
}
function aplicarRol() {
    const permitidas = ROLES[miRol].vistas;
    document.querySelectorAll('.nav-item').forEach(el => {
        const m = (el.getAttribute('onclick') || "").match(/switchView\('(\w+)'/);
        el.style.display = m && !permitidas.includes(m[1]) ? "none" : "";
    });
    document.body.classList.remove("rol-admin", "rol-bioquimico", "rol-recepcion", "rol-consulta");
    document.body.classList.add("rol-" + miRol);
    const et = document.getElementById('usuario-rol'); if (et) et.innerText = (miPerfil.nombre || miPerfil.email) + " · " + ROLES[miRol].nombre;
    // Abre la primera vista permitida
    const activa = document.querySelector('.view-section.active'); const actual = activa ? activa.id.replace("view-", "") : "";
    if (!permitidas.includes(actual)) { const i = [...document.querySelectorAll('.nav-item')].find(el => el.style.display !== "none"); if (i) i.click(); }
    if (esAdmin()) { iniciarPanelUsuarios(); document.getElementById('nu-rol').innerHTML = opcionesRol('recepcion'); }
}

function iniciarSesion() {
    const err = document.getElementById('login-error');
    err.style.display = 'none'; err.style.color = 'red';
    auth.signInWithEmailAndPassword(document.getElementById('login-email').value.trim(), document.getElementById('login-pass').value)
        .catch(error => {
            const t = {
                "auth/network-request-failed": "Sin conexión a internet.",
                "auth/user-not-found": "Ese correo no tiene cuenta en este laboratorio.",
                "auth/wrong-password": "Contraseña incorrecta.",
                "auth/invalid-login-credentials": "Correo o contraseña incorrectos.",
                "auth/invalid-credential": "Correo o contraseña incorrectos.",
                "auth/invalid-email": "El correo está mal escrito.",
                "auth/user-disabled": "Esta cuenta fue deshabilitada en Firebase.",
                "auth/too-many-requests": "Demasiados intentos fallidos. Espere unos minutos o use '¿Olvidó su contraseña?'."
            };
            err.innerText = (t[error.code] || "No se pudo entrar") + "  [" + (error.code || error.message) + "]";
            err.style.display = 'block';
        });
}
document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') iniciarSesion(); });
window.olvideClaveLogin = async function () {
    const email = document.getElementById('login-email').value.trim();
    const err = document.getElementById('login-error');
    if (!email) { err.innerText = "Escriba primero su correo arriba y vuelva a presionar '¿Olvidó su contraseña?'."; err.style.display = 'block'; return; }
    try { await auth.sendPasswordResetEmail(email); err.style.color = "#166534"; err.innerText = "Si ese correo tiene cuenta, le llegó un mensaje para crear una contraseña nueva. Revise también 'Correo no deseado' / Spam."; }
    catch (e) { err.style.color = "red"; err.innerText = "No se pudo enviar [" + e.code + "]"; }
    err.style.display = 'block';
};
function cerrarSesion() { detenerPanelUsuarios(); auth.signOut(); }
setInterval(() => { document.getElementById('reloj').innerText = new Date().toLocaleString(); }, 1000);

function switchView(viewId, element) {
    if (miRol && ROLES[miRol] && !ROLES[miRol].vistas.includes(viewId)) return mostrarToast("Sin permiso", "Su rol no tiene acceso a esta sección.");
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
    if (element) element.classList.add('active');

    if (viewId === 'historial' && !document.getElementById('hist-desde').value) semanaHistorial();
    if (viewId === 'estadisticas') {
        const hoy = new Date();
        document.getElementById('filtro-fecha-inicio').value = fechaLocalISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
        document.getElementById('filtro-fecha-fin').value = fechaLocalISO(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
        calcularEstadisticas();
    }
}


// ---------- Carga por ventana de días (rendimiento) ----------
let qOrdenes = null, qResVentana = null, qResPend = null;
let llegaron = { o: false, v: false, p: false };
let resVentana = {}, resPend = {}, resExtra = {}, ordenesVentana = {}, ordenesExtra = {}, ordenesPedidas = {}, seguidos = {};
function diasVentana() { const n = parseInt(localStorageSeguro("aes_dias_ventana"), 10); return n > 0 ? n : 7; }
function localStorageSeguro(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
function desdeISO(dias) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - dias + 1); return d.toISOString().substring(0, 10); }
// Mantiene en vivo un resultado suelto (uno buscado o uno antiguo que se acaba de validar)
function seguirResultado(k) {
    if (seguidos[k]) return; seguidos[k] = true;
    db.ref("resultados/" + k).on("value", s => { if (s.exists()) resExtra[k] = s.val(); else delete resExtra[k]; recomponerDatos(); });
}
let _recomponerPend = false;
function recomponerDatos() {
    if (_recomponerPend) return; _recomponerPend = true;
    setTimeout(() => { _recomponerPend = false; aplicarDatos(); }, 30);
}
function aplicarDatos() {
    ordenesGlobales = Object.assign({}, ordenesExtra, ordenesVentana);
    datosGlobales = Object.assign({}, resExtra, resPend, resVentana);
    // Trae la orden de los resultados cuya orden es más antigua que la ventana
    Object.values(datosGlobales).forEach(r => {
        const m = r.muestra; if (!m || ordenesGlobales[m] || ordenesPedidas[m] || /[.#$\[\]\/]/.test(m)) return;
        ordenesPedidas[m] = true;
        db.ref("ordenes_pendientes/" + m).once("value").then(s => { if (s.exists()) { ordenesExtra[m] = s.val(); recomponerDatos(); } }).catch(() => { });
    });
    if (!primeraCarga) {
        Object.keys(datosGlobales).forEach(key => {
            if (!keysAnteriores.has(key)) { const r = datosGlobales[key]; agregarNotificacion(key, nombreDeResultado(r).nombre, r.muestra); }
        });
    }
    keysAnteriores = new Set(Object.keys(datosGlobales));
    if (llegaron.o && llegaron.v && llegaron.p) primeraCarga = false; // no avisar de lo que ya existía al abrir
    renderizarBandeja();
    if (pacienteSeleccionadoId && datosGlobales[pacienteSeleccionadoId]) mostrarDetalle(pacienteSeleccionadoId);
    const ve = document.getElementById('view-estadisticas'); if (ve && ve.classList.contains('active') && !cargandoEstadisticas) calcularEstadisticas();
    const info = document.getElementById('info-ventana'); if (info) info.innerText = "Mostrando últimos " + diasVentana() + " días + todo lo pendiente";
}
// Búsqueda en todo el historial: por tubo, CI o nombre (nombre solo dentro de lo cargado)
window.buscarEnHistorial = async function () {
    const txt = (document.getElementById('buscar-historial').value || "").trim();
    const caja = document.getElementById('resultado-busqueda');
    if (!txt) { caja.innerText = ""; return; }
    if (/[.#$\[\]\/]/.test(txt)) { caja.innerText = "Texto no válido"; return; }
    caja.innerText = "Buscando...";
    const hallados = [];
    try {
        const muestras = new Set([txt.toUpperCase(), txt]);
        // ¿Es un CI? -> todas sus órdenes
        const porCI = await db.ref("ordenes_pendientes").orderByChild("ci_paciente").equalTo(txt).once("value");
        porCI.forEach(h => { ordenesExtra[h.key] = h.val(); muestras.add(h.key); });
        for (const m of muestras) {
            const o = await db.ref("ordenes_pendientes/" + m).once("value");
            if (o.exists()) ordenesExtra[m] = o.val();
            const rs = await db.ref("resultados").orderByChild("muestra").equalTo(m).once("value");
            rs.forEach(h => { resExtra[h.key] = h.val(); seguirResultado(h.key); if (!hallados.includes(h.key)) hallados.push(h.key); });
        }
    } catch (e) { caja.innerText = "Error al buscar: " + e.message; return; }
    aplicarDatos();
    if (!hallados.length) { caja.innerText = "No se encontró nada con ese tubo o CI."; return; }
    // Más reciente primero
    hallados.sort((a, b) => msDe(datosGlobales[b] || {}) - msDe(datosGlobales[a] || {}));
    const etiqueta = { Pendientes: "Pendiente", Validados: "✔ Validado", Rechazados: "✖ Rechazado" };
    caja.innerHTML = "<div style=\"font-weight:bold; margin-bottom:4px;\">Encontrados (" + hallados.length + ") — clic para abrir:</div>" + hallados.map(k => {
        const r = datosGlobales[k] || {}; const f = fechaDeResultado(r);
        return "<div class=\"item-busqueda\" onclick=\"abrirEncontrado(" + jsArg(k) + ")\"><b>" + esc(nombreDeResultado(r).nombre) + "</b> · Tubo " + esc(r.muestra || "") + (f ? " · " + esc(f.toLocaleDateString()) : "") + " · " + etiqueta[filtroDeEstado(r.estado)] + "</div>";
    }).join("");
    abrirEncontrado(hallados[0]);
};
window.abrirEncontrado = function (key) {
    const r = datosGlobales[key]; if (!r) return;
    const caja = document.getElementById('resultado-busqueda'); const html = caja.innerHTML;
    cambiarFiltroBandeja(filtroDeEstado(r.estado));
    caja.innerHTML = html; // cambiar de pestaña no borra la lista encontrada
    setTimeout(() => { mostrarDetalle(key); const c = document.getElementById("card-" + key); if (c) c.scrollIntoView({ block: "center" }); }, 50);
};
window.cambiarDiasVentana = function () {
    const n = parseInt(document.getElementById('conf-dias-ventana').value, 10);
    if (!(n >= 1 && n <= 365)) return alert("Escriba un número de días entre 1 y 365");
    localStorageSeguro("aes_dias_ventana", String(n));
    detenerListeners(); iniciarListeners(); alert("Listo. Ahora se cargan los últimos " + n + " días.");
};

// Los listeners se activan SOLO después del login (con reglas seguras, antes del login no hay permiso)
function iniciarListeners() {
    if (listenersActivos) return;
    listenersActivos = true;

    db.ref("configuracion").on("value", snapshot => {
        if (snapshot.exists()) {
            const data = snapshot.val();
            configSeguros = data.seguros || { "Particular": 0 };
            configPrecios = data.precios || {};
            configReferencias = data.referencias || {};
            configLab = data.laboratorio || { nombre: "Laboratorio Clínico", telefono: "", direccion: "" };
            configEntrega = data.entrega || { auto_correo: false };
            renderizarConfiguracion(); actualizarSelectSeguros(); renderizarReferencias(); renderizarConfigEntrega();
            // Copia pública (solo nombre y contacto) para el encabezado del portal del paciente
            db.ref("portal_publico/laboratorio").set({ nombre: configLab.nombre || "", telefono: configLab.telefono || "", direccion: configLab.direccion || "" }).catch(() => { });
        } else {
            db.ref("configuracion").set({ seguros: { "Particular": 0 }, precios: { "GLU": 25 }, laboratorio: configLab });
        }
    });

    // RENDIMIENTO: ya no se descarga todo el historial. Se escucha en vivo:
    //  - las órdenes y resultados de los últimos N días (configurable, por defecto 7)
    //  - TODOS los resultados aún sin validar (estado "Completado"), sin importar su antigüedad
    // Lo más antiguo se trae solo cuando se busca (buscarEnHistorial) o se piden estadísticas.
    const desde = desdeISO(diasVentana()); llegaron = { o: false, v: false, p: false };
    qOrdenes = db.ref("ordenes_pendientes").orderByChild("fecha_creacion").startAt(desde);
    qOrdenes.on("value", snap => { ordenesVentana = snap.val() || {}; llegaron.o = true; recomponerDatos(); });
    qResVentana = db.ref("resultados").orderByChild("fecha_recepcion").startAt(desde);
    qResVentana.on("value", snap => { resVentana = snap.val() || {}; llegaron.v = true; recomponerDatos(); });
    qResPend = db.ref("resultados").orderByChild("estado").equalTo("Completado");
    qResPend.on("value", snap => {
        const nuevo = snap.val() || {};
        // Si un resultado antiguo deja de estar pendiente (se validó/rechazó) lo seguimos mostrando
        Object.keys(resPend).forEach(k => { if (!nuevo[k] && !resVentana[k]) seguirResultado(k); });
        resPend = nuevo; llegaron.p = true; recomponerDatos();
    });

    db.ref("inventario").on("value", snapshot => { inventarioGlobal = snapshot.val() || {}; renderizarInventario(); });
}
function detenerListeners() {
    if (!listenersActivos) return;
    ["configuracion", "inventario"].forEach(r => db.ref(r).off());
    [qOrdenes, qResVentana, qResPend].forEach(q => { if (q) q.off(); });
    Object.keys(seguidos).forEach(k => db.ref("resultados/" + k).off()); seguidos = {};
    resVentana = {}; resPend = {}; resExtra = {}; ordenesVentana = {}; ordenesExtra = {}; ordenesPedidas = {};
    listenersActivos = false; primeraCarga = true; keysAnteriores = new Set();
}

// =====================================================================
//  CONFIGURACIÓN
// =====================================================================
let configSeguros = {}; let configPrecios = {}; let configReferencias = {};
let configLab = { nombre: "Laboratorio Clínico", telefono: "", direccion: "" };

function guardarPerfilLab() {
    const n = document.getElementById('conf-lab-nombre').value.trim();
    const t = document.getElementById('conf-lab-telefono').value.trim();
    const d = document.getElementById('conf-lab-direccion').value.trim();
    if (!n) return alert("El nombre del laboratorio es obligatorio.");
    db.ref("configuracion/laboratorio").set({ nombre: n, telefono: t, direccion: d });
    db.ref("portal_publico/laboratorio").set({ nombre: n, telefono: t, direccion: d });
    mostrarToast("Perfil Actualizado", "Datos del laboratorio guardados.");
}

function guardarSeguro() {
    const nombre = document.getElementById('conf-seguro-nombre').value.trim(); const desc = parseFloat(document.getElementById('conf-seguro-desc').value);
    if (!nombre || isNaN(desc)) return alert("Llene los datos");
    if (!claveValida(nombre)) return alert("El nombre no puede tener los caracteres . # $ [ ] /");
    if (desc < 0 || desc > 100) return alert("El descuento debe estar entre 0 y 100%.");
    db.ref("configuracion/seguros/" + nombre).set(desc);
    document.getElementById('conf-seguro-nombre').value = ''; document.getElementById('conf-seguro-desc').value = ''; mostrarToast("Sistema", "Seguro guardado.");
}
function eliminarSeguro(nombre) { if (nombre === "Particular") return alert("No borrable."); if (confirm("¿Borrar " + nombre + "?")) db.ref("configuracion/seguros/" + nombre).remove(); }
function guardarPrueba() {
    const id = document.getElementById('conf-prueba-id').value.trim().toUpperCase(); const precio = parseFloat(document.getElementById('conf-prueba-precio').value);
    if (!id || isNaN(precio)) return alert("Llene los datos");
    if (!claveValida(id)) return alert("La abreviación no puede tener los caracteres . # $ [ ] /");
    db.ref("configuracion/precios/" + id).set(precio);
    document.getElementById('conf-prueba-id').value = ''; document.getElementById('conf-prueba-precio').value = ''; mostrarToast("Sistema", "Precio actualizado.");
}
function eliminarPrueba(id) { if (confirm("¿Borrar " + id + "?")) db.ref("configuracion/precios/" + id).remove(); }

function renderizarConfiguracion() {
    document.getElementById('conf-lab-nombre').value = configLab.nombre || "";
    document.getElementById('conf-lab-telefono').value = configLab.telefono || "";
    document.getElementById('conf-lab-direccion').value = configLab.direccion || "";

    let hs = "";
    Object.keys(configSeguros).forEach(nombre => { hs += "<tr><td>" + esc(nombre) + "</td><td>" + esc(configSeguros[nombre]) + "%</td><td><button onclick=\"eliminarSeguro(" + jsArg(nombre) + ")\" style=\"color:red; background:none; border:none; cursor:pointer;\">🗑️</button></td></tr>"; });
    document.getElementById('tabla-conf-seguros').innerHTML = hs;
    let hp = "";
    Object.keys(configPrecios).forEach(id => { hp += "<tr><td><strong>" + esc(id) + "</strong></td><td>" + esc(configPrecios[id]) + " Bs</td><td><button onclick=\"eliminarPrueba(" + jsArg(id) + ")\" style=\"color:red; background:none; border:none; cursor:pointer;\">🗑️</button></td></tr>"; });
    document.getElementById('tabla-conf-pruebas').innerHTML = hp;
}
function actualizarSelectSeguros() {
    const select = document.getElementById('seguro-paciente'); const previo = select.value; let h = "";
    Object.keys(configSeguros).forEach(nombre => { h += "<option value=\"" + esc(nombre) + "\">" + esc(nombre) + " (" + esc(configSeguros[nombre]) + "% Desc.)</option>"; });
    select.innerHTML = h;
    if (previo && configSeguros[previo] !== undefined) select.value = previo;
}

// === VALORES DE REFERENCIA ===
function guardarReferencia() {
    const id = document.getElementById('ref-id').value.trim().toUpperCase();
    if (!id) return alert("Ingrese la abreviación de la prueba (Ej: GLU).");
    if (!claveValida(id)) return alert("La abreviación no puede tener los caracteres . # $ [ ] /");
    const ref = {
        unidad: document.getElementById('ref-unidad').value.trim(),
        min: num(document.getElementById('ref-min').value),
        max: num(document.getElementById('ref-max').value),
        min_f: num(document.getElementById('ref-min-f').value),
        max_f: num(document.getElementById('ref-max-f').value),
        texto: document.getElementById('ref-texto').value.trim()
    };
    if (ref.min === null && ref.max === null && !ref.texto) return alert("Ingrese al menos un mínimo, un máximo o un texto de referencia.");
    if (ref.min !== null && ref.max !== null && ref.min > ref.max) return alert("El mínimo no puede ser mayor que el máximo.");
    db.ref("configuracion/referencias/" + id).set(ref).then(() => {
        ['ref-id', 'ref-unidad', 'ref-min', 'ref-max', 'ref-min-f', 'ref-max-f', 'ref-texto'].forEach(c => document.getElementById(c).value = "");
        mostrarToast("Referencias", "Rango de " + id + " guardado.");
    });
}
function editarReferencia(id) {
    const r = configReferencias[id] || {};
    document.getElementById('ref-id').value = id;
    document.getElementById('ref-unidad').value = r.unidad || "";
    document.getElementById('ref-min').value = r.min ?? "";
    document.getElementById('ref-max').value = r.max ?? "";
    document.getElementById('ref-min-f').value = r.min_f ?? "";
    document.getElementById('ref-max-f').value = r.max_f ?? "";
    document.getElementById('ref-texto').value = r.texto || "";
    document.getElementById('ref-id').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function eliminarReferencia(id) { if (confirm("¿Borrar el rango de referencia de " + id + "?")) db.ref("configuracion/referencias/" + id).remove(); }
function renderizarReferencias() {
    const tabla = document.getElementById('tabla-conf-referencias'); if (!tabla) return;
    const ids = Object.keys(configReferencias).sort();
    if (ids.length === 0) { tabla.innerHTML = "<tr><td colspan=\"5\" style=\"text-align:center; color:#888; padding:15px;\">Aún no hay rangos cargados.</td></tr>"; return; }
    let h = "";
    ids.forEach(id => {
        const r = configReferencias[id];
        const gen = rangoTexto(num(r.min), num(r.max));
        const fem = (num(r.min_f) !== null || num(r.max_f) !== null) ? rangoTexto(num(r.min_f), num(r.max_f)) : "Igual";
        h += "<tr><td><strong>" + esc(id) + "</strong></td><td>" + esc(r.unidad || "-") + "</td><td>" + esc(gen) + "</td><td>" + esc(fem) + "</td><td style=\"white-space:nowrap;\"><button onclick=\"editarReferencia(" + jsArg(id) + ")\" style=\"background:none; border:none; cursor:pointer;\">✏️</button><button onclick=\"eliminarReferencia(" + jsArg(id) + ")\" style=\"color:red; background:none; border:none; cursor:pointer;\">🗑️</button></td></tr>";
    });
    tabla.innerHTML = h;
}
function rangoTexto(min, max) {
    if (min !== null && max !== null) return min + " - " + max;
    if (max !== null) return "< " + max;
    if (min !== null) return "> " + min;
    return "-";
}

// Decide qué rango usar: 1) el configurado en el LIS  2) el que mandó el equipo  3) "Según inserto"
function resolverReferencia(prueba, genero, refEquipo) {
    const R = configReferencias[String(prueba).toUpperCase()];
    if (R) {
        let min = num(R.min), max = num(R.max);
        if (genero === 'F' && (num(R.min_f) !== null || num(R.max_f) !== null)) { min = num(R.min_f); max = num(R.max_f); }
        const texto = R.texto || rangoTexto(min, max);
        return { min: min, max: max, texto: texto, unidad: R.unidad || "" };
    }
    if (refEquipo && refEquipo !== "N/A") {
        const s = String(refEquipo).trim(); let m;
        if ((m = s.match(/^([\d.,]+)\s*-\s*([\d.,]+)/))) return { min: num(m[1]), max: num(m[2]), texto: s, unidad: "" };
        if ((m = s.match(/^<\s*=?\s*([\d.,]+)/))) return { min: null, max: num(m[1]), texto: s, unidad: "" };
        if ((m = s.match(/^>\s*=?\s*([\d.,]+)/))) return { min: num(m[1]), max: null, texto: s, unidad: "" };
        return { min: null, max: null, texto: s, unidad: "" };
    }
    return { min: null, max: null, texto: "Según inserto", unidad: "" };
}
function calcularFlag(valor, ref) {
    const v = num(valor); if (v === null) return "";
    if (ref.min !== null && v < ref.min) return "L";
    if (ref.max !== null && v > ref.max) return "H";
    return "";
}

// =====================================================================
//  CATÁLOGO Y ADMISIÓN
// =====================================================================
let pruebasSeleccionadas = new Set(); let preciosModificados = {};
const catalogoPruebas = {
    quimica: [ { id: "GLU", nombre: "Glucosa" }, { id: "UREA", nombre: "Urea" }, { id: "BUN", nombre: "Nitrógeno Ureico" }, { id: "CREA", nombre: "Creatinina" }, { id: "URI", nombre: "Ácido Úrico" }, { id: "COL", nombre: "Colesterol Total" }, { id: "TRIG", nombre: "Triglicéridos" }, { id: "HDL", nombre: "Colesterol HDL" }, { id: "LDL", nombre: "Colesterol LDL" }, { id: "VLDL", nombre: "Colesterol VLDL" }, { id: "LIPA", nombre: "Lipoproteína (a)" }, { id: "APOA1", nombre: "Apolipoproteína A1" }, { id: "APOB", nombre: "Apolipoproteína B" }, { id: "AST", nombre: "AST / GOT" }, { id: "ALT", nombre: "ALT / GPT" }, { id: "ALP", nombre: "Fosfatasa Alcalina" }, { id: "GGT", nombre: "Gamma GT" }, { id: "LDH", nombre: "Lactato Deshidrogenasa" }, { id: "BT", nombre: "Bilirrubina Total" }, { id: "BD", nombre: "Bilirrubina Directa" }, { id: "BI", nombre: "Bilirrubina Indirecta" }, { id: "PT", nombre: "Proteínas Totales" }, { id: "ALB", nombre: "Albúmina" }, { id: "GLOB", nombre: "Globulinas" }, { id: "CA", nombre: "Calcio Total" }, { id: "CAI", nombre: "Calcio Iónico" }, { id: "P", nombre: "Fósforo" }, { id: "MG", nombre: "Magnesio" }, { id: "FE", nombre: "Hierro Sanguíneo" }, { id: "TIBC", nombre: "Capacidad Fijación Fe" }, { id: "NA", nombre: "Sodio (Na+)" }, { id: "K", nombre: "Potasio (K+)" }, { id: "CL", nombre: "Cloro (Cl-)" }, { id: "AMIL", nombre: "Amilasa" }, { id: "LIP", nombre: "Lipasa" }, { id: "HBA1C", nombre: "Hemoglobina A1c" }, { id: "PCR", nombre: "Proteína C Reactiva" }, { id: "ASO", nombre: "Antiestreptolisina O" }, { id: "FR", nombre: "Factor Reumatoide" }, { id: "C3", nombre: "Complemento C3" }, { id: "C4", nombre: "Complemento C4" }, { id: "IGA", nombre: "Inmunoglobulina A" }, { id: "IGG", nombre: "Inmunoglobulina G" }, { id: "IGM", nombre: "Inmunoglobulina M" }, { id: "DIG", nombre: "Digoxina" }, { id: "VAL", nombre: "Ácido Valproico" }, { id: "FEN", nombre: "Fenitoína" }, { id: "CBZ", nombre: "Carbamazepina" } ],
    inmunologia: [ { id: "TSH", nombre: "Hormona TSH" }, { id: "FT4", nombre: "T4 Libre" }, { id: "FT3", nombre: "T3 Libre" }, { id: "T4", nombre: "T4 Total" }, { id: "T3", nombre: "T3 Total" }, { id: "ATPO", nombre: "Anti-TPO" }, { id: "ATG", nombre: "Anti-Tiroglobulina" }, { id: "TRAB", nombre: "Anti-Receptor TSH" }, { id: "FSH", nombre: "Hormona FSH" }, { id: "LH", nombre: "Hormona LH" }, { id: "PRL", nombre: "Prolactina" }, { id: "E2", nombre: "Estradiol" }, { id: "E3", nombre: "Estriol Libre" }, { id: "PRG", nombre: "Progesterona" }, { id: "TESTO", nombre: "Testosterona Total" }, { id: "TESTL", nombre: "Testosterona Libre" }, { id: "SHBG", nombre: "Globulina Fijadora Sex." }, { id: "BHCG", nombre: "Beta-hCG Cuantitativa" }, { id: "AMH", nombre: "Hormona Antimülleriana" }, { id: "CORT", nombre: "Cortisol (Sérico)" }, { id: "ACTH", nombre: "Hormona ACTH" }, { id: "PTH", nombre: "Paratohormona Intacta" }, { id: "INS", nombre: "Insulina" }, { id: "CPEP", nombre: "Péptido C" }, { id: "FERR", nombre: "Ferritina" }, { id: "VITD", nombre: "Vitamina D (25-OH)" }, { id: "VITB12", nombre: "Vitamina B12" }, { id: "FOL", nombre: "Ácido Fólico" }, { id: "TROP", nombre: "Troponina I Alta Sens." }, { id: "PROBNP", nombre: "NT-proBNP" }, { id: "CKMB", nombre: "CK-MB Masa" }, { id: "MYO", nombre: "Mioglobina" }, { id: "PCT", nombre: "Procalcitonina" }, { id: "IGE", nombre: "IgE Total" }, { id: "ANA", nombre: "Anticuerpos ANA" }, { id: "ADN", nombre: "Anti-DNA dc" } ],
    infecciosas: [ { id: "HBSAG", nombre: "Antígeno de Sup. Hep B" }, { id: "AHBS", nombre: "Ac. Anti-HBs" }, { id: "AHBC", nombre: "Ac. Anti-HBc Total" }, { id: "AHBCM", nombre: "Ac. Anti-HBc IgM" }, { id: "HBEAG", nombre: "Antígeno HBe" }, { id: "AHBE", nombre: "Ac. Anti-HBe" }, { id: "HCV", nombre: "Anticuerpos Hep C" }, { id: "HAVM", nombre: "Hep A IgM" }, { id: "HIV", nombre: "VIH Ag/Ab Combo" }, { id: "SYPH", nombre: "Sífilis (Treponema)" }, { id: "CHAGAS", nombre: "Chagas IgG/IgM" }, { id: "TOXOG", nombre: "Toxoplasma IgG" }, { id: "TOXOM", nombre: "Toxoplasma IgM" }, { id: "RUBG", nombre: "Rubéola IgG" }, { id: "RUBM", nombre: "Rubéola IgM" }, { id: "CMVG", nombre: "Citomegalovirus IgG" }, { id: "CMVM", nombre: "Citomegalovirus IgM" }, { id: "HSV1G", nombre: "Herpes I IgG" }, { id: "HSV2G", nombre: "Herpes II IgG" }, { id: "DENG", nombre: "Dengue NS1 Ag" }, { id: "DENGM", nombre: "Dengue IgM" }, { id: "EBVG", nombre: "Epstein-Barr VCA IgG" }, { id: "EBVM", nombre: "Epstein-Barr VCA IgM" }, { id: "HPI", nombre: "Helicobacter pylori IgG" }, { id: "COVG", nombre: "SARS-CoV-2 IgG" }, { id: "COVAG", nombre: "SARS-CoV-2 Antígeno" } ],
    marcadores: [ { id: "PSA", nombre: "PSA Total" }, { id: "PSAL", nombre: "PSA Libre" }, { id: "CEA", nombre: "Antígeno Carcinoembrionario" }, { id: "CA125", nombre: "CA 125 (Ovario)" }, { id: "CA153", nombre: "CA 15-3 (Mama)" }, { id: "CA199", nombre: "CA 19-9 (GI/Páncreas)" }, { id: "AFP", nombre: "Alfa-fetoproteína" }, { id: "B2M", nombre: "Beta-2 Microglobulina" }, { id: "HE4", nombre: "HE4 (Ovario)" }, { id: "CYFRA", nombre: "CYFRA 21-1 (Pulmón)" }, { id: "NSE", nombre: "Enolasa Específica" }, { id: "SCC", nombre: "Antígeno Células Esc." } ],
    hematologia: [ { id: "HEMO", nombre: "Hemograma Completo" }, { id: "VSG", nombre: "Velocidad de Sedimentación" }, { id: "RET", nombre: "Reticulocitos" }, { id: "GS", nombre: "Grupo y Factor Rh" }, { id: "PLA", nombre: "Recuento de Plaquetas" }, { id: "LEU", nombre: "Fórmula Leucocitaria" }, { id: "HGB", nombre: "Hemoglobina" }, { id: "HCT", nombre: "Hematocrito" }, { id: "VCM", nombre: "Índices Eritrocitarios" } ],
    coagulacion: [ { id: "TP", nombre: "Tiempo de Protrombina" }, { id: "INR", nombre: "INR" }, { id: "TTPA", nombre: "Tiempo de Tromboplastina (APTT)" }, { id: "FIB", nombre: "Fibrinógeno" }, { id: "TT", nombre: "Tiempo de Trombina" }, { id: "DDIM", nombre: "Dímero D" }, { id: "VWFAG", nombre: "von Willebrand (Ag)" }, { id: "VWFRC", nombre: "von Willebrand (RCo)" }, { id: "FVIII", nombre: "Factor VIII" }, { id: "FIX", nombre: "Factor IX" }, { id: "FVII", nombre: "Factor VII" }, { id: "FV", nombre: "Factor V" }, { id: "FX", nombre: "Factor X" }, { id: "FXI", nombre: "Factor XI" }, { id: "FXII", nombre: "Factor XII" }, { id: "PC", nombre: "Proteína C (Actividad)" }, { id: "PS", nombre: "Proteína S (Libre)" }, { id: "ATIII", nombre: "Antitrombina III" }, { id: "LA1", nombre: "Anticoagulante Lúpico" }, { id: "AXA", nombre: "Anti-Factor Xa" }, { id: "PLAS", nombre: "Plasminógeno" }, { id: "ACA", nombre: "Anticuerpos Anticardiolipina" } ]
};
const nombresCategorias = { quimica: "🧪 Química Sanguínea, TDM y Drogas", inmunologia: "🧬 Inmunología y Hormonas", infecciosas: "🦠 Serología e Infecciosas", marcadores: "🎗️ Marcadores Tumorales", hematologia: "🩸 Hematología", coagulacion: "⏱️ Coagulación y Factores" };

function abrirModal(categoria) {
    document.getElementById('modal-titulo').innerText = nombresCategorias[categoria];
    const grid = document.getElementById('modal-grid'); grid.innerHTML = "";
    catalogoPruebas[categoria].forEach(prueba => {
        const card = document.createElement('div'); card.className = "test-card " + (pruebasSeleccionadas.has(prueba.id) ? "selected" : "");
        card.onclick = () => togglePrueba(card, prueba.id);
        card.innerHTML = "<div class=\"test-code\">" + esc(prueba.id) + "</div><div class=\"test-name\">" + esc(prueba.nombre) + "</div>";
        grid.appendChild(card);
    });
    document.getElementById('modal-pruebas').style.display = 'flex';
}
function togglePrueba(cardElement, idPrueba) {
    if (pruebasSeleccionadas.has(idPrueba)) { pruebasSeleccionadas.delete(idPrueba); cardElement.classList.remove('selected'); delete preciosModificados[idPrueba]; }
    else { pruebasSeleccionadas.add(idPrueba); cardElement.classList.add('selected'); }
}
function cerrarModal() { document.getElementById('modal-pruebas').style.display = 'none'; actualizarCotizacion(); }

function precioDe(id) { return preciosModificados[id] !== undefined ? preciosModificados[id] : (configPrecios[id] !== undefined ? configPrecios[id] : 50); }
function editarPrecioManual(idPrueba) {
    const nuevoPrecio = prompt("✏️ Editar precio para " + idPrueba + " (Bs):", precioDe(idPrueba));
    if (nuevoPrecio !== null && nuevoPrecio.trim() !== "" && !isNaN(nuevoPrecio) && parseFloat(nuevoPrecio) >= 0) { preciosModificados[idPrueba] = parseFloat(nuevoPrecio); actualizarCotizacion(); }
}
function calcularTotales() {
    let subtotal = 0; pruebasSeleccionadas.forEach(id => subtotal += precioDe(id));
    const desc = (configSeguros[document.getElementById('seguro-paciente').value] || 0) / 100;
    const descMonto = subtotal * desc;
    return { subtotal: subtotal, descuento: descMonto, total: subtotal - descMonto };
}
function actualizarCotizacion() {
    const panel = document.getElementById('panel-cotizacion');
    if (pruebasSeleccionadas.size === 0) { panel.style.display = "none"; return; }
    panel.style.display = "block"; let h = "";
    pruebasSeleccionadas.forEach(id => {
        h += "<tr><td><strong>" + esc(id) + "</strong></td><td>" + precioDe(id).toFixed(2) + "</td><td><button class=\"btn-edit-price\" onclick=\"editarPrecioManual(" + jsArg(id) + ")\">✏️</button></td></tr>";
    });
    document.getElementById('lista-precios').innerHTML = h;
    const t = calcularTotales();
    document.getElementById('lbl-subtotal').innerText = t.subtotal.toFixed(2) + " Bs"; document.getElementById('lbl-descuento').innerText = "- " + t.descuento.toFixed(2) + " Bs"; document.getElementById('lbl-total').innerText = t.total.toFixed(2) + " Bs";
}

function buscarPaciente() {
    const ci = document.getElementById('ci').value.trim(); if (!ci) return alert("Ingrese un CI.");
    if (!claveValida(ci)) return alert("El CI no puede tener los caracteres . # $ [ ] /");
    db.ref("pacientes/" + ci).once("value").then(snapshot => {
        if (snapshot.exists()) {
            const p = snapshot.val();
            document.getElementById('nombre').value = p.nombre || "";
            document.getElementById('fecha_nac').value = p.fecha_nac || "";
            document.getElementById('genero').value = p.genero || "M";
            document.getElementById('celular').value = p.celular || "";
            document.getElementById('correo').value = p.correo || "";
            mostrarInfoPortal(ci, p);
            buscarHistorial(ci);
        } else {
            mostrarToast("Paciente nuevo", "No existe el CI " + ci + ". Complete sus datos.");
            ['nombre', 'fecha_nac', 'celular', 'correo'].forEach(c => document.getElementById(c).value = "");
            document.getElementById('info-portal').style.display = "none";
            document.getElementById('panel-historial').style.display = "none";
        }
    }).catch(e => alert("Error al buscar: " + e.message));
}
function buscarHistorial(ci) {
    const tabla = document.getElementById('tabla-historial'); tabla.innerHTML = "";
    db.ref("ordenes_pendientes").orderByChild("ci_paciente").equalTo(ci).once("value", snapshot => {
        if (!snapshot.exists()) { document.getElementById('panel-historial').style.display = "none"; return; }
        document.getElementById('panel-historial').style.display = "block";
        const ordenes = []; snapshot.forEach(hijo => { ordenes.push(hijo.val()); });
        ordenes.sort((a, b) => String(b.fecha_creacion).localeCompare(String(a.fecha_creacion)));
        ordenes.splice(20); // solo las 20 más recientes

        // Estado real según los resultados ya cargados en memoria
        const estadoPorMuestra = {};
        Object.values(datosGlobales).forEach(r => {
            if (!r.muestra) return;
            const previo = estadoPorMuestra[r.muestra];
            if (r.estado === "Validado_Final" || !previo) estadoPorMuestra[r.muestra] = r.estado;
        });

        let h = "";
        ordenes.forEach(o => {
            let estadoVisual = "En espera"; let colorEstado = "var(--aes-blue)";
            const est = estadoPorMuestra[o.id_muestra];
            if (est === "Validado_Final") { estadoVisual = "✔ Validado"; colorEstado = "var(--success)"; }
            else if (est === "Rechazado") { estadoVisual = "✖ Rechazado"; colorEstado = "var(--danger)"; }
            else if (est) { estadoVisual = "Procesando"; colorEstado = "var(--warning)"; }
            h += "<tr><td>" + esc(new Date(o.fecha_creacion).toLocaleDateString()) + "</td><td>" + esc(o.medico || 'N/A') + "</td><td><strong>" + esc(o.examenes ? o.examenes.join(", ") : "") + "</strong></td>" +
                "<td><span id=\"hist-est-" + esc(o.id_muestra) + "\" style=\"color: " + colorEstado + "; font-weight: bold;\">" + estadoVisual + "</span></td>" +
                "<td><button onclick=\"cargarExamenesDesdeHistorial(" + jsArg(o.id_muestra) + ")\" style=\"background: #E0F2FE; color: var(--aes-blue); border: 1px solid var(--aes-blue); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: bold;\" title=\"Repetir estas pruebas\">🔄 Repetir</button></td></tr>";
        });
        tabla.innerHTML = h;
        // Las órdenes antiguas no están en memoria: se consulta su estado una por una
        ordenes.filter(o => o.id_muestra && !estadoPorMuestra[o.id_muestra]).forEach(o => {
            db.ref("resultados").orderByChild("muestra").equalTo(o.id_muestra).once("value").then(rs => {
                let est = null; rs.forEach(x => { const e = x.val().estado; if (e === "Validado_Final" || !est) est = e; });
                const span = document.getElementById("hist-est-" + o.id_muestra); if (!span || !est) return;
                if (est === "Validado_Final") { span.innerText = "✔ Validado"; span.style.color = "var(--success)"; }
                else if (est === "Rechazado") { span.innerText = "✖ Rechazado"; span.style.color = "var(--danger)"; }
                else { span.innerText = "Procesando"; span.style.color = "var(--warning)"; }
            }).catch(() => { });
        });
    });
}
window.cargarExamenesDesdeHistorial = function (idMuestra) {
    db.ref("ordenes_pendientes/" + idMuestra + "/examenes").once("value").then(snap => {
        const examenes = snap.val() || [];
        if (examenes.length === 0) return;
        pruebasSeleccionadas.clear(); preciosModificados = {};
        examenes.forEach(p => pruebasSeleccionadas.add(p));
        actualizarCotizacion();
        mostrarToast("Pruebas Cargadas", "Se seleccionaron " + examenes.length + " pruebas del historial.");
        document.getElementById('panel-cotizacion').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
};
window.copiarIDMuestra = function (id) { navigator.clipboard.writeText(id).then(() => { mostrarToast("Copiado", "El ID " + id + " está copiado."); }).catch(err => alert("Error: " + err)); };

// ID de tubo: AAMMDD (fecha LOCAL) + 4 dígitos. Se verifica que no exista antes de usarlo.
async function generarIdMuestraUnico() {
    const hoy = fechaLocalISO().slice(2).replace(/-/g, "");
    for (let i = 0; i < 10; i++) {
        const id = hoy + Math.floor(1000 + Math.random() * 9000);
        const snap = await db.ref("ordenes_pendientes/" + id).once("value");
        if (!snap.exists()) return id;
    }
    throw new Error("No se pudo generar un ID único. Intente de nuevo.");
}

async function generarOrden() {
    const ci = document.getElementById('ci').value.trim(); const nombre = document.getElementById('nombre').value.trim();
    if (!ci || !nombre) return alert("CI y Nombre obligatorios.");
    if (!claveValida(ci)) return alert("El CI no puede tener los caracteres . # $ [ ] /");
    if (pruebasSeleccionadas.size === 0) return alert("Seleccione exámenes.");

    const btn = document.querySelector('.btn-success-adm'); if (btn.disabled) return;
    btn.disabled = true; const txt = btn.innerHTML; btn.innerHTML = "⏳ Generando...";
    try {
        const fechaNac = document.getElementById('fecha_nac').value; const genero = document.getElementById('genero').value;
        const celular = document.getElementById('celular').value.trim(); const correo = document.getElementById('correo').value.trim();
        if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error("El correo del paciente no es válido.");
        // update (no set) para no borrar el acceso al portal del paciente
        await db.ref("pacientes/" + ci).update({ nombre: nombre, fecha_nac: fechaNac, genero: genero, celular: celular, correo: correo, ultima_visita: new Date().toISOString() });
        const acceso = await asegurarAccesoPortal(ci);

        const examenesArray = Array.from(pruebasSeleccionadas);
        const idMuestra = await generarIdMuestraUnico();
        const sel = document.getElementById('seguro-paciente');
        const seguroTexto = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "Particular";
        const t = calcularTotales();
        const detallePrecios = {}; examenesArray.forEach(id => detallePrecios[id] = precioDe(id));

        const ordenNueva = {
            id_muestra: idMuestra, ci_paciente: ci, nombre_paciente: nombre, fecha_nac: fechaNac, genero: genero, celular: celular, correo: correo,
            medico: document.getElementById('medico').value.trim(), prioridad: document.getElementById('prioridad').value,
            examenes: examenesArray, precios: detallePrecios, seguro: seguroTexto,
            subtotal: t.subtotal, descuento: t.descuento, total: t.total, total_cobrado: t.total.toFixed(2) + " Bs",
            estado: "Pendiente", fecha_creacion: new Date().toISOString(), creado_por: usuarioActual()
        };
        await db.ref("ordenes_pendientes/" + idMuestra).set(ordenNueva);
        ultimaOrden = Object.assign({ pin: acceso.pin, token: acceso.token, seguro_texto: seguroTexto }, ordenNueva);
        publicarOrdenEnPortal(idMuestra, ordenNueva).catch(e => console.warn("Portal:", e));

        document.getElementById('lbl-paciente-etiqueta').innerHTML = esc(nombre) + " | CI: " + esc(ci) + "<br>Seguro: " + esc(seguroTexto) + " | Total: " + t.total.toFixed(2) + " Bs<br>Exámenes: " + esc(examenesArray.join(", ")) + "<br><br><span style=\"font-size: 1.1rem; color: var(--aes-dark);\">ID de Tubo: <strong>" + idMuestra + "</strong></span><button onclick=\"copiarIDMuestra('" + idMuestra + "')\" style=\"background:none; border:none; cursor:pointer; font-size:1.4rem; color:var(--aes-blue); margin-left: 5px; vertical-align: middle;\" title=\"Copiar ID\">📋</button><br><span style=\"font-size:0.85rem;color:var(--aes-purple);\">🌐 Código del portal del paciente: <b style=\"letter-spacing:2px;\">" + acceso.pin + "</b></span>";
        document.getElementById('barcode-panel').style.display = "block";
        JsBarcode("#barcode", idMuestra, { format: "CODE128", width: 2, height: 50, displayValue: true, fontSize: 16, fontOptions: "bold" });
        mostrarQRAdmision();
        pruebasSeleccionadas.clear(); preciosModificados = {}; actualizarCotizacion(); document.getElementById('medico').value = ""; buscarHistorial(ci);
        mostrarToast("Orden creada", "Tubo " + idMuestra);
    } catch (e) {
        alert("No se pudo generar la orden: " + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = txt;
    }
}

// Abre la pestaña EN EL MISMO CLIC (si se abre después de buscar datos, Chrome la bloquea)
function pestanaReservada() {
    const w = window.open("", "_blank");
    if (w) { try { w.document.write("<p style='font-family:Arial;padding:30px;'>Abriendo WhatsApp...</p>"); } catch (e) { } }
    return w;
}
function irA(w, url) {
    if (w && !w.closed) { w.location.href = url; return; }
    const ok = window.open(url, "_blank");
    if (!ok) prompt("Chrome bloqueó la ventana. Copie este enlace y ábralo, o permita las ventanas emergentes de este sitio (icono a la derecha de la barra de direcciones):", url);
}

// ---------- Código del portal de un paciente (para reenviarlo si lo perdió) ----------
function mostrarInfoPortal(ci, p) {
    const box = document.getElementById('info-portal');
    if (!p || !p.portal_pin || !p.portal_token) { box.style.display = "none"; return; }
    box.innerHTML = "🌐 Código del portal: <b class=\"qr-pin\" style=\"font-size:1.05rem;\">" + esc(p.portal_pin) + "</b>" +
        "<span style=\"display:flex;gap:6px;\"><button onclick=\"reenviarCodigoWhatsApp(" + jsArg(ci) + ")\">📱 Reenviar por WhatsApp</button>" +
        "<button onclick=\"copiarCodigoPortal(" + jsArg(ci) + ")\">📋 Copiar enlace y código</button></span>";
    box.style.display = "flex";
}
async function reenviarCodigoWhatsApp(ci) {
    let cel = document.getElementById('celular').value.trim();
    if (!cel) { cel = prompt("📱 Número de WhatsApp del paciente (Ej: 70012345):"); if (!cel) return; db.ref("pacientes/" + ci + "/celular").set(cel.trim()); }
    const w = pestanaReservada();
    const p = (await db.ref("pacientes/" + ci).once("value")).val() || {};
    const texto = "Hola " + (p.nombre || "") + " 👋\n\nEste es su acceso al portal de resultados de *" + (configLab.nombre || "el laboratorio") + "*:\n" +
        urlPortal(p.portal_token) + "\n\nCódigo de acceso: *" + p.portal_pin + "*\n\nTambién puede entrar con su CI y este código en:\n" + urlPortal();
    irA(w, "https://wa.me/" + normalizarCelular(cel) + "?text=" + encodeURIComponent(texto));
}
async function copiarCodigoPortal(ci) {
    const p = (await db.ref("pacientes/" + ci).once("value")).val() || {};
    const t = urlPortal(p.portal_token) + "  (Código: " + p.portal_pin + ")";
    navigator.clipboard.writeText(t).then(() => mostrarToast("Copiado", t)).catch(() => prompt("Copie:", t));
}

// ---------- Comprobante, etiqueta y acceso del paciente ----------
let ultimaOrden = null;
function mostrarQRAdmision() {
    if (!ultimaOrden) return;
    const box = document.getElementById("qr-paciente");
    const url = qrDataURL(urlPortal(ultimaOrden.token));
    box.innerHTML = url ? "<img src=\"" + url + "\" alt=\"QR\">" : "";
    document.getElementById("qr-pin").innerText = ultimaOrden.pin;
    document.getElementById("qr-paciente-box").style.display = "flex";
}
function ventanaImpresion(titulo, cuerpo, css) {
    const w = window.open("", "_blank", "width=480,height=720");
    if (!w) return alert("El navegador bloqueó la ventana de impresión. Permita las ventanas emergentes para este sitio.");
    w.document.write("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(titulo) + "</title><style>" +
        "body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#111;} " + css + "</style></head><body>" + cuerpo +
        "<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>");
    w.document.close();
}
function imprimirEtiqueta() {
    if (!ultimaOrden) return;
    const svg = document.getElementById("barcode").outerHTML;
    ventanaImpresion("Etiqueta " + ultimaOrden.id_muestra,
        "<div class=\"et\"><div class=\"n\">" + esc(ultimaOrden.nombre_paciente) + "</div>" + svg + "<div class=\"s\">CI " + esc(ultimaOrden.ci_paciente) + " · " + esc(new Date(ultimaOrden.fecha_creacion).toLocaleDateString()) + (ultimaOrden.prioridad === "Urgencia" ? " · URGENTE" : "") + "</div></div>",
        "@page{size:50mm 25mm;margin:0;} .et{width:50mm;height:25mm;padding:1mm 2mm;box-sizing:border-box;text-align:center;overflow:hidden;} .n{font-size:8pt;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} svg{width:46mm;height:14mm;} .s{font-size:6.5pt;}");
}
function imprimirComprobante() {
    if (!ultimaOrden) return;
    const o = ultimaOrden, url = urlPortal(o.token);
    const qr = qrDataURL(url);
    const svg = document.getElementById("barcode").outerHTML;
    ventanaImpresion("Comprobante " + o.id_muestra,
        "<div class=\"t\"><div class=\"lab\">" + esc(configLab.nombre || "Laboratorio Clínico") + "</div>" +
        "<div class=\"c\">" + esc([configLab.direccion, configLab.telefono].filter(Boolean).join(" · ")) + "</div><hr>" +
        "<div class=\"tit\">COMPROBANTE DE ORDEN</div>" +
        "<p><b>Paciente:</b> " + esc(o.nombre_paciente) + "<br><b>CI:</b> " + esc(o.ci_paciente) + "<br><b>Fecha:</b> " + esc(new Date(o.fecha_creacion).toLocaleString()) +
        (o.medico ? "<br><b>Médico:</b> " + esc(o.medico) : "") + "<br><b>N° de orden:</b> " + esc(o.id_muestra) + "</p>" +
        "<div class=\"bc\">" + svg + "</div>" +
        "<p><b>Exámenes (" + o.examenes.length + "):</b><br>" + esc(o.examenes.join(", ")) + "</p>" +
        "<p><b>Total:</b> " + esc(o.total_cobrado) + (o.seguro_texto ? "<br><small>" + esc(o.seguro_texto) + "</small>" : "") + "</p><hr>" +
        "<div class=\"tit\">VEA SUS RESULTADOS EN LÍNEA</div>" +
        (qr ? "<img class=\"qr\" src=\"" + qr + "\">" : "") +
        "<p class=\"ctr\">Escanee el código con su celular<br>o entre a:<br><small>" + esc(urlPortal()) + "</small></p>" +
        "<p class=\"ctr\">Código de acceso:<br><span class=\"pin\">" + esc(o.pin) + "</span></p>" +
        "<p class=\"ctr small\">Podrá ver el avance de cada examen y descargar los resultados apenas estén validados.<br>Guarde este comprobante: el código sirve para todas sus órdenes.</p></div>",
        "@page{margin:6mm;} .t{width:72mm;margin:0 auto;font-size:9.5pt;} .lab{font-size:13pt;font-weight:bold;text-align:center;} .c{font-size:8pt;text-align:center;color:#444;} .tit{font-weight:bold;text-align:center;margin:6px 0;font-size:10pt;} .bc{text-align:center;} .bc svg{width:62mm;height:22mm;} .qr{display:block;width:38mm;height:38mm;margin:4px auto;} .ctr{text-align:center;} .pin{font-size:18pt;font-weight:bold;letter-spacing:4px;} .small{font-size:7.5pt;color:#444;} hr{border:none;border-top:1px dashed #999;}");
}
function enviarAccesoWhatsApp() {
    if (!ultimaOrden) return;
    const o = ultimaOrden;
    let cel = o.celular;
    if (!cel) { cel = prompt("📱 Número de WhatsApp del paciente (Ej: 70012345):"); if (!cel) return; db.ref("pacientes/" + o.ci_paciente + "/celular").set(cel.trim()); }
    const texto = "Hola " + o.nombre_paciente + " 👋\n\nSu orden N° *" + o.id_muestra + "* fue registrada en *" + (configLab.nombre || "el laboratorio") + "* ✅\n\n" +
        "Puede seguir el avance de sus exámenes y ver sus resultados apenas estén listos aquí:\n" + urlPortal(o.token) + "\n\nCódigo de acceso: *" + o.pin + "*\n\nGracias por su confianza.";
    irA(null, "https://wa.me/" + normalizarCelular(cel) + "?text=" + encodeURIComponent(texto));
}

// =====================================================================
//  VALIDACIÓN, AUDITORÍA Y NOTIFICACIONES
// =====================================================================
let datosGlobales = {}; let ordenesGlobales = {}; let pacienteSeleccionadoId = null; let filtroActual = "Pendientes";
let notificacionesPendientes = []; let unreadCount = 0; let keysAnteriores = new Set(); let primeraCarga = true;

const diccionarioLIS = {
    "QUÍMICA SANGUÍNEA Y ENZIMAS": ["GLU", "UREA", "BUN", "CREA", "URI", "COL", "TRIG", "HDL", "LDL", "VLDL", "LIPA", "APOA1", "APOB", "AST", "ALT", "ALP", "GGT", "LDH", "BT", "BD", "BI", "PT", "ALB", "GLOB", "CA", "CAI", "P", "MG", "FE", "TIBC", "NA", "K", "CL", "AMIL", "LIP", "HBA1C", "PCR", "ASO", "FR", "C3", "C4", "IGA", "IGG", "IGM", "DIG", "VAL", "FEN", "CBZ"],
    "INMUNOLOGÍA Y HORMONAS": ["TSH", "FT4", "FT3", "T4", "T3", "ATPO", "ATG", "TRAB", "FSH", "LH", "PRL", "E2", "E3", "PRG", "TESTO", "TESTL", "SHBG", "BHCG", "AMH", "CORT", "ACTH", "PTH", "INS", "CPEP", "FERR", "VITD", "VITB12", "FOL", "TROP", "PROBNP", "CKMB", "MYO", "PCT", "IGE", "ANA", "ADN"],
    "SEROLOGÍA E INFECCIOSAS": ["HBSAG", "AHBS", "AHBC", "AHBCM", "HBEAG", "AHBE", "HCV", "HAVM", "HIV", "SYPH", "CHAGAS", "TOXOG", "TOXOM", "RUBG", "RUBM", "CMVG", "CMVM", "HSV1G", "HSV2G", "DENG", "DENGM", "EBVG", "EBVM", "HPI", "COVG", "COVAG"],
    "MARCADORES TUMORALES": ["PSA", "PSAL", "CEA", "CA125", "CA153", "CA199", "AFP", "B2M", "HE4", "CYFRA", "NSE", "SCC"],
    "HEMATOLOGÍA Y COAGULACIÓN": ["HEMO", "VSG", "RET", "GS", "PLA", "LEU", "HGB", "HCT", "VCM", "TP", "INR", "TTPA", "FIB", "TT", "DDIM", "VWFAG", "VWFRC", "FVIII", "FIX", "FVII", "FV", "FX", "FXI", "FXII", "PC", "PS", "ATIII", "LA1", "AXA", "PLAS", "ACA"]
};
function categoriaDe(prueba) {
    for (const [c, lista] of Object.entries(diccionarioLIS)) { if (lista.includes(String(prueba).toUpperCase())) return c; }
    return "OTROS EXÁMENES DE LABORATORIO";
}

// Nombre y datos del paciente de un resultado (cruzando con la orden web)
function nombreDeResultado(r) {
    const o = ordenesGlobales[r.muestra] || statsCache.ord[r.muestra];
    if (o) return { nombre: o.nombre_paciente, huerfano: false, orden: o };
    if (r.paciente && r.paciente !== "Paciente Desconocido" && r.paciente !== "Desconocido") return { nombre: r.paciente, huerfano: true, orden: null };
    return { nombre: "Paciente No Registrado", huerfano: true, orden: null };
}

// Devuelve la lista de resultados en formato uniforme, venga del motor nuevo o del formato viejo "GLU: 95 mg/dL~..."
function listaResultados(r) {
    if (Array.isArray(r.resultados_lista)) {
        return r.resultados_lista.map(x => ({ n: String(x.prueba || "").trim(), v: String(x.valor ?? "").trim(), u: String(x.unidad || "").trim(), refEq: x.ref_equipo || "" }));
    }
    const resRaw = r.resultados_totales || r.resultados || r.resultaos || "";
    if (typeof resRaw !== "string" || resRaw === "") return [];
    const out = [];
    resRaw.split('~').forEach(linea => {
        if (linea.trim() === "") return;
        const p = linea.split(':'); const n = p[0].trim(); const valU = p.slice(1).join(':').trim();
        let vNum = valU, uStr = ""; const sep = valU.indexOf(' ');
        if (sep > -1) { vNum = valU.substring(0, sep).trim(); uStr = valU.substring(sep).trim(); }
        out.push({ n: n, v: vNum, u: uStr, refEq: "" });
    });
    return out;
}

function msDe(r) { const f = fechaDeResultado(r); return f ? f.getTime() : 0; }
function fechaDeResultado(r) {
    if (r.fecha_recepcion) { const d = new Date(r.fecha_recepcion); if (!isNaN(d)) return d; }
    const m = r.muestra || "";
    if (/^\d{6}/.test(m)) return new Date("20" + m.substring(0, 2) + "-" + m.substring(2, 4) + "-" + m.substring(4, 6) + "T12:00:00");
    return null;
}

function agregarNotificacion(key, nombre, tubo) { unreadCount++; notificacionesPendientes.unshift({ key: key, nombre: nombre, tubo: tubo, leido: false }); actualizarCampanaUI(); mostrarToast("Nuevos Resultados", nombre + " (Tubo: " + tubo + ")"); }
function actualizarCampanaUI() {
    const badge = document.getElementById('campana-badge');
    if (unreadCount > 0) { badge.style.display = 'block'; badge.innerText = unreadCount; } else { badge.style.display = 'none'; }
    const lista = document.getElementById('notif-lista');
    if (notificacionesPendientes.length === 0) { lista.innerHTML = "<div style=\"padding: 20px; text-align: center; color: #888; font-size: 0.85rem;\">No hay notificaciones nuevas</div>"; return; }
    let h = "";
    notificacionesPendientes.forEach(n => { h += "<div class=\"notif-item " + (n.leido ? '' : 'unread') + "\" onclick=\"abrirDesdeNotificacion(" + jsArg(n.key) + ")\"><div class=\"notif-title\">" + esc(n.nombre) + "</div><div class=\"notif-desc\">Tubo: <strong>" + esc(n.tubo) + "</strong></div></div>"; });
    lista.innerHTML = h;
}
window.toggleNotificaciones = function () { document.getElementById('notif-dropdown').classList.toggle('active'); };
window.marcarTodasLeidas = function (e) { e.stopPropagation(); notificacionesPendientes.forEach(n => n.leido = true); unreadCount = 0; actualizarCampanaUI(); };
window.abrirDesdeNotificacion = function (key) {
    document.getElementById('notif-dropdown').classList.remove('active'); const noti = notificacionesPendientes.find(n => n.key === key);
    if (noti && !noti.leido) { noti.leido = true; unreadCount = Math.max(0, unreadCount - 1); actualizarCampanaUI(); }
    if (!datosGlobales[key]) return mostrarToast("Aviso", "Ese resultado ya no existe.");
    switchView('validacion', document.querySelectorAll('.nav-item')[1]);
    cambiarFiltroBandeja(filtroDeEstado(datosGlobales[key].estado)); setTimeout(() => mostrarDetalle(key), 100);
};
function mostrarToast(titulo, desc) {
    const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = 'toast';
    toast.innerHTML = "<div style=\"font-size: 1.8rem;\">🔔</div><div><div style=\"font-weight: 800; color: var(--aes-dark);\">" + esc(titulo) + "</div><div style=\"color: var(--aes-blue); font-size: 0.85rem; font-weight: bold; margin-top:2px;\">" + esc(desc) + "</div></div>";
    container.appendChild(toast); setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 500); }, 5000);
}

function filtroDeEstado(estado) {
    if (estado === "Validado_Final") return "Validados";
    if (estado === "Rechazado") return "Rechazados";
    return "Pendientes";
}
function cambiarFiltroBandeja(nuevoFiltro) {
    filtroActual = nuevoFiltro;
    ['btn-filtro-pendientes', 'btn-filtro-validados', 'btn-filtro-rechazados'].forEach(id => document.getElementById(id).classList.remove('active'));
    document.getElementById({ Pendientes: 'btn-filtro-pendientes', Validados: 'btn-filtro-validados', Rechazados: 'btn-filtro-rechazados' }[filtroActual]).classList.add('active');
    document.getElementById("estado-vacio").style.display = "flex"; document.getElementById("contenedor-resultados").style.display = "none";
    pacienteSeleccionadoId = null; renderizarBandeja();
}
function renderizarBandeja() {
    const lista = document.getElementById("lista-pacientes"); let h = ""; let n = 0;
    Object.keys(datosGlobales).sort((a, b) => (msDe(datosGlobales[b]) - msDe(datosGlobales[a])) || (a < b ? 1 : -1)).forEach(key => {
        const r = datosGlobales[key];
        if (filtroDeEstado(r.estado) !== filtroActual) return;
        n++;
        const info = nombreDeResultado(r);
        const pacienteName = info.huerfano ? "⚠️ " + info.nombre : info.nombre;
        const estiloNombre = info.huerfano ? "color: #DC2626; font-style: italic;" : "";
        const badgeHuerfano = info.huerfano ? "<span class=\"badge-huerfano\">⚠️ SIN ORDEN WEB</span>" : "";
        const nv = r.validados ? Object.keys(r.validados).length : 0, nt = listaResultados(r).length;
        const pill = r.estado === "Validado_Final" ? "<span class=\"status-pill val\">✔ Validado</span>" : (r.estado === "Rechazado" ? "<span class=\"status-pill rech\">✖ Rechazado</span>" : (nv ? "<span class=\"status-pill parc\">Parcial " + nv + "/" + nt + "</span>" : "<span class=\"status-pill pend\">Pendiente</span>"));
        const activeClass = (pacienteSeleccionadoId === key) ? 'active' : '';
        // El borrado definitivo solo existe en la pestaña Rechazados
        const btnBorrar = (r.estado === "Rechazado") ? "<button class=\"btn-delete-card\" title=\"Eliminar definitivamente\" onclick=\"borrarRegistroLIS(event, " + jsArg(key) + ")\">🗑️</button>" : "";
        h += "<div class=\"patient-card-val " + activeClass + "\" id=\"card-" + esc(key) + "\" style=\"display: flex; justify-content: space-between; align-items: center; gap: 10px;\"><div style=\"flex: 1;\" onclick=\"mostrarDetalle(" + jsArg(key) + ")\">" + badgeHuerfano + "<div class=\"patient-name\" style=\"" + estiloNombre + " font-size: 0.95rem; font-weight: bold;\">" + esc(pacienteName) + "</div><div class=\"patient-meta\" style=\"margin-top: 5px; display:flex; justify-content:space-between; gap:8px;\"><span>Tubo: <strong>" + esc(r.muestra || "N/A") + "</strong></span>" + pill + "</div></div>" + btnBorrar + "</div>";
    });
    lista.innerHTML = n === 0 ? "<div style=\"padding: 30px; text-align: center; color: #888;\">No hay informes aquí.</div>" : h;
}

// ---------- Datos del informe (los usan pantalla, PDF y portal) ----------
function pruebaValidada(r, n) { return r.estado === "Validado_Final" || !!(r.validados && r.validados[String(n).toUpperCase()]); }
function datosInforme(key, soloValidados) {
    const r = datosGlobales[key]; if (!r) return null;
    const info = nombreDeResultado(r); const o = info.orden;
    const genero = o ? o.genero : undefined;
    const grupos = {}; let anormales = 0;
    listaResultados(r).forEach(x => {
        const val = pruebaValidada(r, x.n);
        if (soloValidados && !val) return;
        const ref = resolverReferencia(x.n, genero, x.refEq);
        const flag = calcularFlag(x.v, ref);
        if (flag) anormales++;
        const cat = categoriaDe(x.n);
        const vinfo = (r.validados || {})[String(x.n).toUpperCase()] || {};
        (grupos[cat] = grupos[cat] || []).push({ n: x.n, v: x.v, u: x.u || ref.unidad, ref: ref.texto, flag: flag, val: val, vpor: vinfo.por || r.validado_por || "", vfecha: vinfo.fecha || r.fecha_validacion || "" });
    });
    return {
        lab: { nombre: configLab.nombre || "Laboratorio Clínico", direccion: configLab.direccion || "", telefono: configLab.telefono || "" },
        paciente: info.nombre, huerfano: info.huerfano, ci: o ? o.ci_paciente : (r.ci || ""),
        edad: calcularEdad(o ? o.fecha_nac : ""), sexo: genero === "F" ? "Femenino" : (genero === "M" ? "Masculino" : "-"),
        medico: (o && o.medico) ? o.medico : "-", muestra: r.muestra || "N/A", equipo: r.equipo || "N/A",
        fecha: r.fecha_validacion || null, validado_por: r.validado_por || "",
        grupos: grupos, anormales: anormales, examenes_web: (o && o.examenes) ? o.examenes : []
    };
}

// Une todos los resultados VALIDADOS del mismo tubo (+ el que se está validando) en un solo informe
function datosInformeTubo(key, forzarValidacion) {
    const base = datosInforme(key, true); if (!base) return null;
    const muestra = datosGlobales[key].muestra;
    const keys = Object.keys(datosGlobales).filter(k => datosGlobales[k].muestra === muestra && (datosGlobales[k].estado === "Validado_Final" || datosGlobales[k].validados || k === key));
    keys.sort((a, b) => String(datosGlobales[a].fecha_validacion || "9").localeCompare(String(datosGlobales[b].fecha_validacion || "9")));
    const filas = {}, orden = [], validadores = new Set(), equipos = new Set(); let ultima = null;
    keys.forEach(k => {
        const todo = (k === key && forzarValidacion);
        const d = datosInforme(k, !todo), r = datosGlobales[k];
        Object.keys(d.grupos).forEach(cat => d.grupos[cat].forEach(x => {
            const id = x.n.toUpperCase();
            if (!filas[id]) orden.push(id);
            filas[id] = Object.assign({ cat: cat }, x);   // si se repitió la prueba, queda la última validada
            const fv = todo ? new Date().toISOString() : x.vfecha;
            const vp = todo ? usuarioActual() : x.vpor;
            if (fv && (!ultima || fv > ultima)) ultima = fv;
            if (vp) validadores.add(vp);
        }));
        if (r.equipo && Object.keys(d.grupos).length) equipos.add(r.equipo);
    });
    const grupos = {}; let anormales = 0;
    orden.forEach(id => { const x = filas[id]; if (x.flag) anormales++; (grupos[x.cat] = grupos[x.cat] || []).push({ n: x.n, v: x.v, u: x.u, ref: x.ref, flag: x.flag }); });
    const listos = new Set(orden);
    base.grupos = grupos; base.anormales = anormales;
    base.fecha = ultima; base.validado_por = Array.from(validadores).join(", ");
    base.equipo = Array.from(equipos).join(", ") || base.equipo;
    base.pendientes = (base.examenes_web || []).filter(e => !listos.has(String(e).toUpperCase()));
    return base;
}

function mostrarDetalle(key) {
    const r = datosGlobales[key]; if (!r) return;
    pacienteSeleccionadoId = key;
    const estado = r.estado;
    document.querySelectorAll('.patient-card-val').forEach(el => el.classList.remove('active'));
    const card = document.getElementById("card-" + key); if (card) card.classList.add('active');
    document.getElementById("estado-vacio").style.display = "none"; document.getElementById("contenedor-resultados").style.display = "block";

    const bp = document.getElementById('botones-pendientes'), bv = document.getElementById('botones-validados'), br = document.getElementById('botones-rechazados'), badge = document.getElementById('badge-estado-visor');
    const pe = document.getElementById('panel-entrega');
    bp.style.display = bv.style.display = br.style.display = pe.style.display = "none";
    const nVal = r.validados ? Object.keys(r.validados).length : 0;
    if (estado === "Validado_Final") { bv.style.display = "flex"; pe.style.display = "block"; badge.innerText = "✔ VALIDADO"; }
    else if (estado === "Rechazado") { br.style.display = "flex"; badge.innerText = "✖ RECHAZADO"; }
    else { bp.style.display = "flex"; badge.innerText = nVal ? "Validación parcial" : "Pendiente Firma"; if (nVal) pe.style.display = "block"; }
    const editable = estado !== "Validado_Final" && estado !== "Rechazado";

    const d = datosInforme(key);
    document.getElementById("detalle-nombre").innerText = d.huerfano ? d.paciente + " (sin orden web)" : d.paciente;
    document.getElementById("detalle-muestra").innerText = d.muestra;
    document.getElementById("detalle-equipo").innerText = d.equipo;

    let hT = "";
    if (r.estado === "Rechazado") hT += "<tr><td colspan=\"4\" class=\"aviso-rechazo\"><strong>Motivo de rechazo:</strong> " + esc(r.motivo_rechazo || "-") + " — " + esc(r.rechazado_por || "") + "</td></tr>";
    if (d.anormales > 0) hT += "<tr><td colspan=\"4\" class=\"aviso-anormal\">⚠️ " + d.anormales + " resultado(s) fuera del rango de referencia</td></tr>";
    if (!d.huerfano) hT += "<tr><td colspan=\"4\" style=\"background: #FFFBEB; padding: 10px; color: #B45309; font-size: 0.8rem;\"><strong>Pruebas solicitadas en Web:</strong> " + esc(d.examenes_web.join(", ")) + "</td></tr>";
    const cats = Object.keys(d.grupos);
    if (cats.length === 0) hT += "<tr><td colspan=\"4\" style=\"text-align: center; padding: 20px;\">Sin resultados</td></tr>";
    cats.forEach(cat => {
        const pendArea = d.grupos[cat].filter(x => !x.val).length;
        const btnArea = (editable && pendArea) ? "<button class=\"btn-area\" onclick=\"validarArea(" + jsArg(cat) + ")\">✔ Validar área (" + pendArea + ")</button>" : "";
        hT += "<tr style=\"background: #F3E8FF;\"><td colspan=\"4\" style=\"padding: 10px 20px; font-weight: 800; color: var(--aes-purple); font-size: 0.85rem;\"><div style=\"display:flex;justify-content:space-between;align-items:center;\"><span>🏷️ " + esc(cat) + "</span>" + btnArea + "</div></td></tr>";
        d.grupos[cat].forEach(x => {
            const flagHtml = x.flag === "H" ? " <span class=\"flag flag-h\">▲ H</span>" : (x.flag === "L" ? " <span class=\"flag flag-l\">▼ L</span>" : "");
            const marca = !editable ? "" : (x.val ? "<span class=\"ok-val\" title=\"Validado por " + esc(x.vpor) + "\">✔</span> " : "<input type=\"checkbox\" class=\"chk-val\" data-p=\"" + esc(x.n) + "\"> ");
            hT += "<tr class=\"" + (x.flag ? "fila-anormal" : "") + (editable && x.val ? " fila-validada" : "") + "\"><td style=\"padding-left: 20px;\">" + marca + "<strong>" + esc(x.n) + "</strong></td><td style=\"font-family: monospace; font-size:1.1rem;\">" + esc(x.v) + flagHtml + "</td><td><span class=\"unit-badge\">" + esc(x.u || '-') + "</span></td><td style=\"color:#64748B; font-size:0.85rem;\">" + esc(x.ref) + "</td></tr>";
        });
    });
    document.getElementById("tabla-analitos").innerHTML = hT;
    renderizarAuditoria(r);
    if (estado === "Validado_Final") renderizarEntrega(key);
}

function renderizarAuditoria(r) {
    const cont = document.getElementById("auditoria-lista"); if (!cont) return;
    const items = [];
    if (r.fecha_recepcion) items.push({ fecha: r.fecha_recepcion, accion: "Recibido del equipo", usuario: r.equipo || "Motor LIS", detalle: "" });
    if (r.auditoria) Object.values(r.auditoria).forEach(a => items.push(a));
    items.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    if (items.length === 0) { cont.innerHTML = "<div style=\"color:#94A3B8; font-size:0.8rem;\">Sin movimientos registrados.</div>"; return; }
    cont.innerHTML = items.map(a => "<div class=\"audit-item\"><span class=\"audit-fecha\">" + esc(new Date(a.fecha).toLocaleString()) + "</span> <strong>" + esc(a.accion) + "</strong> — " + esc(a.usuario) + (a.detalle ? " <em>(" + esc(a.detalle) + ")</em>" : "") + "</div>").join("");
}

// ---------- PDF ----------
function qrDataURL(texto) {
    try {
        if (!window.QRCode || !texto) return "";
        const div = document.createElement("div");
        new QRCode(div, { text: texto, width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M });
        const c = div.querySelector("canvas");
        return c ? c.toDataURL("image/png") : "";
    } catch (e) { return ""; }
}
async function prepararPlantillaPDF(key, forzarValidacion) {
    const d = datosInformeTubo(key, forzarValidacion);
    let extra = { pendientes: d.pendientes };
    if (!d.huerfano && d.ci) {
        try {
            const acc = await asegurarAccesoPortal(d.ci);
            const url = urlPortal(acc.token);
            extra = { qr: qrDataURL(url), portal: urlPortal(), pin: acc.pin, pendientes: d.pendientes };
        } catch (e) { console.warn("Sin datos de portal para el PDF:", e); }
    }
    document.getElementById('plantilla-pdf').innerHTML = AESInforme.html(d, extra);
    return d;
}
function opcionesPDF(d) {
    return { margin: 10, filename: "Informe_" + String(d.paciente).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, '_') + "_" + d.muestra + ".pdf", image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['avoid-all', 'css', 'legacy'] } };
}
function conPlantillaVisible(fn) {
    const pw = document.getElementById('pdf-container');
    pw.style.display = 'block'; pw.style.position = 'absolute'; pw.style.left = '-10000px'; pw.style.top = '0';
    return Promise.resolve().then(fn).finally(() => { pw.style.display = 'none'; });
}

async function descargarSoloPDF(forzarValidacion) {
    const btn = document.querySelector(forzarValidacion ? '.btn-validate-pdf' : '.btn-reprint'); const tOriginal = btn.innerHTML; btn.innerHTML = "⏳ Generando..."; btn.disabled = true;
    const idActual = pacienteSeleccionadoId;
    try {
        const d = await prepararPlantillaPDF(idActual, forzarValidacion);
        await conPlantillaVisible(() => html2pdf().set(opcionesPDF(d)).from(document.getElementById('plantilla-pdf')).save());
        if (forzarValidacion) {
            await db.ref("resultados/" + idActual).update({ estado: "Validado_Final", fecha_validacion: d.fecha, validado_por: d.validado_por });
            await registrarAuditoria(idActual, "Validado y liberado");
            await publicarEnPortal(idActual);
            if (configEntrega.auto_correo && d.pendientes.length === 0) {   // el correo automático va cuando la orden está completa
                const contacto = await contactoDe(idActual);
                if (contacto.correo) enviarCorreoResultados(idActual, true);
            }
            cambiarFiltroBandeja('Validados');
        } else {
            registrarAuditoria(idActual, "Re-impresión de informe");
        }
    } catch (e) {
        alert("Error al generar el PDF: " + e);
    } finally {
        btn.innerHTML = tOriginal; btn.disabled = false;
    }
}
// ---------- Validación por parámetro y por área ----------
async function validarPruebas(lista) {
    const key = pacienteSeleccionadoId; const r = datosGlobales[key]; if (!r) return;
    lista = Array.from(new Set(lista)).filter(n => !pruebaValidada(r, n));
    if (!lista.length) return alert("Marque al menos una prueba que no esté validada.");
    if (!confirm("¿Validar y liberar al paciente: " + lista.join(", ") + "?")) return;
    const ahora = new Date().toISOString(), por = usuarioActual(), upd = {};
    lista.forEach(n => upd["validados/" + String(n).toUpperCase()] = { por: por, fecha: ahora });
    await db.ref("resultados/" + key).update(upd);
    const r2 = datosGlobales[key];
    const faltan = listaResultados(r2).filter(x => !pruebaValidada(r2, x.n));
    if (!faltan.length) await db.ref("resultados/" + key).update({ estado: "Validado_Final", fecha_validacion: ahora, validado_por: por });
    await registrarAuditoria(key, faltan.length ? "Validación parcial" : "Validado y liberado", lista.join(", "));
    const est = await publicarEnPortal(key);
    mostrarToast("Liberado al paciente", lista.join(", ") + (est ? " · orden " + est.listos + "/" + est.total : ""));
    if (est && est.completo && configEntrega.auto_correo) { const c = await contactoDe(key); if (c.correo) enviarCorreoResultados(key, true); }
    if (!faltan.length) cambiarFiltroBandeja('Validados'); else mostrarDetalle(key);
}
function validarSeleccionados() {
    validarPruebas(Array.from(document.querySelectorAll('#tabla-analitos .chk-val:checked')).map(c => c.getAttribute('data-p')));
}
function validarArea(cat) {
    const d = datosInforme(pacienteSeleccionadoId);
    validarPruebas((d.grupos[cat] || []).filter(x => !x.val).map(x => x.n));
}

function validarYGenerarPDF() { if (pacienteSeleccionadoId && confirm("¿Liberar reporte médico?")) descargarSoloPDF(true); }

function revertirValidacion() {
    if (!pacienteSeleccionadoId) return;
    const motivo = prompt("↩ Motivo para revertir la validación (obligatorio):");
    if (!motivo || !motivo.trim()) return;
    const id = pacienteSeleccionadoId;
    db.ref("resultados/" + id).update({ estado: "Pendiente Validacion", fecha_validacion: null, validado_por: null, validados: null })
        .then(() => registrarAuditoria(id, "Validación revertida", motivo.trim()))
        .then(() => publicarEnPortal(id))
        .then(() => cambiarFiltroBandeja('Pendientes'));
}
// Rechazar ya NO borra: marca como Rechazado y guarda motivo y usuario
function rechazarMuestra() {
    if (!pacienteSeleccionadoId) return;
    const motivo = prompt("✖ Motivo del rechazo (obligatorio). Ej: muestra hemolizada, error de identificación...");
    if (!motivo || !motivo.trim()) return;
    const id = pacienteSeleccionadoId;
    db.ref("resultados/" + id).update({ estado: "Rechazado", motivo_rechazo: motivo.trim(), rechazado_por: usuarioActual(), fecha_rechazo: new Date().toISOString() })
        .then(() => registrarAuditoria(id, "Muestra rechazada", motivo.trim()))
        .then(() => cambiarFiltroBandeja('Rechazados'));
}
function restaurarRechazado() {
    if (!pacienteSeleccionadoId || !confirm("¿Devolver este resultado a Pendientes?")) return;
    const id = pacienteSeleccionadoId;
    db.ref("resultados/" + id).update({ estado: "Pendiente Validacion" })
        .then(() => registrarAuditoria(id, "Restaurado desde rechazados"))
        .then(() => cambiarFiltroBandeja('Pendientes'));
}
function borrarRegistroLIS(event, key) {
    event.stopPropagation();
    const r = datosGlobales[key]; if (!r) return;
    if (!confirm("¿ELIMINAR permanentemente el tubo " + (r.muestra || key) + "? Esto no se puede deshacer.")) return;
    db.ref("auditoria_eliminaciones").push({ muestra: r.muestra || "", paciente: nombreDeResultado(r).nombre, motivo_rechazo: r.motivo_rechazo || "", usuario: usuarioActual(), fecha: new Date().toISOString() })
        .then(() => db.ref("resultados/" + key).remove());
}

// =====================================================================
//  ENTREGA DE RESULTADOS: PORTAL, WHATSAPP Y CORREO
// =====================================================================
let configEntrega = { auto_correo: false };
const ALFABETO_PIN = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin 0/O, 1/I/L para no confundir
function aleatorio(n, alfabeto) { const a = new Uint32Array(n); crypto.getRandomValues(a); return Array.from(a, x => alfabeto[x % alfabeto.length]).join(""); }

function urlPortal(token) {
    const base = location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
    return base + "portal.html" + (token ? "?t=" + token : "");
}

// Cada paciente tiene UN enlace (token) y UN código de 6 caracteres para el portal
async function asegurarAccesoPortal(ci) {
    if (!ci || !claveValida(ci)) throw new Error("CI inválido");
    const ref = db.ref("pacientes/" + ci);
    const p = (await ref.once("value")).val() || {};
    if (p.portal_token && p.portal_pin) return { token: p.portal_token, pin: p.portal_pin };
    const token = aleatorio(24, "abcdefghijkmnpqrstuvwxyz23456789"), pin = aleatorio(6, ALFABETO_PIN);
    await ref.update({ portal_token: token, portal_pin: pin });
    await db.ref("portal_indice/" + await AESInforme.indiceDe(ci, pin)).set(token);
    return { token: token, pin: pin };
}

// El portal guarda UNA entrada por orden (tubo): pruebas pendientes/listas + informe con lo ya validado
async function publicarOrdenEnPortal(muestra, ordenDirecta) {
    const o = ordenDirecta || ordenesGlobales[muestra];
    if (!o || !o.ci_paciente) return false;
    const acc = await asegurarAccesoPortal(o.ci_paciente);
    const validados = Object.keys(datosGlobales).filter(k => datosGlobales[k].muestra === muestra && (datosGlobales[k].estado === "Validado_Final" || datosGlobales[k].validados));
    const d = validados.length ? datosInformeTubo(validados[0]) : null;
    const listos = new Set();
    if (d) Object.values(d.grupos).forEach(g => g.forEach(x => listos.add(x.n.toUpperCase())));
    const examenes = (o.examenes || []).map(e => ({ codigo: e, estado: listos.has(String(e).toUpperCase()) ? "listo" : "pendiente" }));
    listos.forEach(t => { if (!examenes.some(x => String(x.codigo).toUpperCase() === t)) examenes.push({ codigo: t, estado: "listo" }); });
    const completo = examenes.length > 0 && examenes.every(x => x.estado === "listo");
    const obj = {
        v: 2, muestra: muestra, fecha_orden: o.fecha_creacion, medico: o.medico || "", paciente: o.nombre_paciente,
        lab: { nombre: configLab.nombre || "Laboratorio Clínico", direccion: configLab.direccion || "", telefono: configLab.telefono || "" },
        examenes: examenes, completo: completo, d: d, actualizado: new Date().toISOString()
    };
    const paquete = await AESInforme.cifrar(obj, acc.pin, acc.token);
    await db.ref("portal/" + acc.token + "/informes/" + muestra).set({ fecha: o.fecha_creacion || new Date().toISOString(), iv: paquete.iv, datos: paquete.datos });
    return { completo: completo, listos: examenes.filter(x => x.estado === "listo").length, total: examenes.length };
}
async function publicarEnPortal(key) {
    const r = datosGlobales[key];
    const info = r ? nombreDeResultado(r) : null;
    if (!r || !info || info.huerfano) { mostrarToast("Portal", "No se publicó: el resultado no tiene orden web."); return false; }
    try {
        const estado = await publicarOrdenEnPortal(r.muestra);
        if (r.estado === "Validado_Final" || r.validados) {
            await db.ref("resultados/" + key + "/entregas/portal").set(new Date().toISOString());
            await registrarAuditoria(key, "Publicado en el portal del paciente", estado ? estado.listos + " de " + estado.total + " pruebas listas" : "");
        } else {
            await db.ref("resultados/" + key + "/entregas/portal").remove();
            await registrarAuditoria(key, "Retirado del portal del paciente");
        }
        return estado;
    } catch (e) {
        console.error(e); mostrarToast("Portal", "No se pudo actualizar el portal: " + e.message); return false;
    }
}

async function contactoDe(key) {
    const d = datosInforme(key); const o = (nombreDeResultado(datosGlobales[key]) || {}).orden || {};
    let celular = o.celular || "", correo = o.correo || "";
    if (d.ci && (!celular || !correo)) {
        const p = (await db.ref("pacientes/" + d.ci).once("value")).val() || {};
        celular = celular || p.celular || ""; correo = correo || p.correo || "";
    }
    return { ci: d.ci, celular: celular, correo: correo };
}
function normalizarCelular(t) {
    let n = String(t || "").replace(/\D/g, "");
    if (n.length === 8) n = "591" + n;           // número boliviano sin código de país
    return n;
}

async function renderizarEntrega(key) {
    const cont = document.getElementById("estado-entrega"); if (!cont) return;
    const r = datosGlobales[key] || {}; const e = r.entregas || {};
    const f = x => x ? "✔ " + new Date(x).toLocaleString() : "—";
    const c = await contactoDe(key);
    if (pacienteSeleccionadoId !== key) return;
    cont.innerHTML = "<div class=\"entrega-fila\"><span>🌐 Portal</span><b>" + f(e.portal) + "</b></div>" +
        "<div class=\"entrega-fila\"><span>📱 WhatsApp " + esc(c.celular ? "(+" + normalizarCelular(c.celular) + ")" : "(sin número)") + "</span><b>" + f(e.whatsapp) + "</b></div>" +
        "<div class=\"entrega-fila\"><span>✉️ Correo " + esc(c.correo ? "(" + c.correo + ")" : "(sin correo)") + "</span><b>" + (e.correo_estado && !(e.correo && e.correo_estado === "Enviado") ? esc(e.correo_estado) + (e.correo ? "<br><small>último: " + f(e.correo) + "</small>" : "") : f(e.correo)) + "</b></div>";
}

async function pedirDato(ci, campo, texto, validar) {
    const v = prompt(texto);
    if (!v || !v.trim()) return "";
    if (validar && !validar(v.trim())) { alert("El dato ingresado no es válido."); return ""; }
    if (ci) await db.ref("pacientes/" + ci + "/" + campo).set(v.trim());
    return v.trim();
}

async function enviarWhatsApp() {
    const key = pacienteSeleccionadoId; if (!key) return;
    const w = pestanaReservada();
    const c = await contactoDe(key);
    if (!c.ci) { if (w) w.close(); return alert("Este resultado no tiene orden web con CI: no se puede generar el acceso al portal."); }
    let cel = c.celular || await pedirDato(c.ci, "celular", "📱 Número de WhatsApp del paciente (Ej: 70012345):", v => normalizarCelular(v).length >= 10);
    if (!cel) { if (w) w.close(); return; }
    if (!datosGlobales[key].entregas || !datosGlobales[key].entregas.portal) await publicarEnPortal(key);
    const acc = await asegurarAccesoPortal(c.ci);
    const d = datosInformeTubo(key);
    const estado = d.pendientes.length ? "Ya tiene resultados listos ✅ (faltan " + d.pendientes.length + " prueba(s), le avisaremos)" : "Sus resultados ya están listos ✅";
    const texto = "Hola " + d.paciente + " 👋\n\n*" + d.lab.nombre + "*: " + estado + "\n\n" +
        "Véalos y descárguelos aquí:\n" + urlPortal(acc.token) + "\n\nCódigo de acceso: *" + acc.pin + "*\n\n" +
        (d.lab.telefono ? "Consultas: " + d.lab.telefono + "\n" : "") + "Gracias por su confianza.";
    irA(w, "https://wa.me/" + normalizarCelular(cel) + "?text=" + encodeURIComponent(texto));
    await db.ref("resultados/" + key + "/entregas/whatsapp").set(new Date().toISOString());
    await registrarAuditoria(key, "Enviado por WhatsApp", "+" + normalizarCelular(cel));
    renderizarEntrega(key);
}

async function enviarCorreoResultados(keyParam, automatico) {
    const key = keyParam || pacienteSeleccionadoId; if (!key) return;
    const c = await contactoDe(key);
    if (!c.ci) { if (!automatico) alert("Este resultado no tiene orden web con CI."); return; }
    let correo = c.correo || (automatico ? "" : await pedirDato(c.ci, "correo", "✉️ Correo del paciente:", v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)));
    if (!correo) return;
    if (!automatico) mostrarToast("Correo", "Preparando el PDF y enviando a " + correo + "...");
    try {
        if (!datosGlobales[key].entregas || !datosGlobales[key].entregas.portal) await publicarEnPortal(key);
        const acc = await asegurarAccesoPortal(c.ci);
        const d = await prepararPlantillaPDF(key, false);
        const opt = opcionesPDF(d);
        const uri = await conPlantillaVisible(() => html2pdf().set(opt).from(document.getElementById('plantilla-pdf')).outputPdf('datauristring'));
        const pdf64 = String(uri).split(",").pop();
        const enlace = urlPortal(acc.token);
        const parcial = d.pendientes && d.pendientes.length ? "<p style=\"background:#FFFBEB;border:1px solid #FCD34D;padding:10px;border-radius:6px;\">⏳ <b>Informe parcial:</b> todavía faltan " + esc(d.pendientes.join(", ")) + ". Le avisaremos cuando estén listos.</p>" : "";
        const html = "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:600px;\">" +
            "<div style=\"background:#1A1A24;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0;\"><b style=\"font-size:17px;\">Sus resultados están listos</b><br><span style=\"color:#00A8E8;\">" + esc(d.lab.nombre) + "</span></div>" +
            "<div style=\"border:1px solid #E2E8F0;border-top:none;padding:20px;border-radius:0 0 6px 6px;\">" +
            "<p>Estimado/a <b>" + esc(d.paciente) + "</b>:</p><p>Le informamos que los resultados de su muestra <b>" + esc(d.muestra) + "</b> ya fueron validados. Le adjuntamos el informe en PDF.</p>" + parcial +
            "<p>También puede verlos y descargarlos cuando quiera desde su portal:</p>" +
            "<p style=\"text-align:center;margin:22px 0;\"><a href=\"" + enlace + "\" style=\"background:#00A8E8;color:#fff;text-decoration:none;padding:12px 26px;border-radius:6px;font-weight:bold;\">Ver mis resultados</a></p>" +
            "<p style=\"text-align:center;\">Código de acceso: <b style=\"font-size:18px;letter-spacing:3px;\">" + acc.pin + "</b></p>" +
            "<p style=\"color:#888;font-size:12px;\">Este correo es informativo. Ante cualquier duda consulte a su médico" + (d.lab.telefono ? " o comuníquese al " + esc(d.lab.telefono) : "") + ".</p>" +
            "<p>Atentamente,<br><b>" + esc(d.lab.nombre) + "</b></p></div></div>";
        const payload = {
            tipo: "resultados", correo_paciente: correo, paciente: d.paciente, muestra: d.muestra,
            asunto: "Resultados de laboratorio - " + d.lab.nombre, mensaje_html: html,
            pdf_nombre: opt.filename, pdf_base64: pdf64, enlace_portal: enlace, laboratorio_nombre: d.lab.nombre, fecha: new Date().toLocaleString()
        };
        if (metodoCorreo() === "motor") {
            await encolarCorreo({ tipo: "resultados", para: correo, asunto: payload.asunto, html: html, pdf_nombre: opt.filename, pdf_base64: pdf64, resultado_key: key });
            await db.ref("resultados/" + key + "/entregas/correo_estado").set("En cola (lo envía el motor)");
            await registrarAuditoria(key, "Correo puesto en cola", correo);
            mostrarToast("Correo en cola", "El motor lo enviará a " + correo + " en unos segundos.");
        } else {
            const res = await fetch(WEBHOOK_AUTOPEDIDO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            if (!res.ok) throw new Error("Make respondió " + res.status);
            await db.ref("resultados/" + key + "/entregas/correo").set(new Date().toISOString());
            await registrarAuditoria(key, "Enviado por correo", correo);
            mostrarToast("Correo enviado", correo);
        }
        if (pacienteSeleccionadoId === key) renderizarEntrega(key);
    } catch (e) {
        console.error(e);
        alert("⚠️ No se pudo enviar el correo a " + correo + ".\n\nDetalle: " + e.message);
    }
}

async function copiarEnlacePortal() {
    const key = pacienteSeleccionadoId; if (!key) return;
    const c = await contactoDe(key);
    if (!c.ci) return alert("Este resultado no tiene orden web con CI.");
    const acc = await asegurarAccesoPortal(c.ci);
    const texto = urlPortal(acc.token) + "  (Código: " + acc.pin + ")";
    navigator.clipboard.writeText(texto).then(() => mostrarToast("Enlace copiado", texto)).catch(() => prompt("Copie el enlace:", texto));
}

function metodoCorreo() { return configEntrega.metodo_correo === "motor" ? "motor" : "make"; }
async function encolarCorreo(datos) {
    datos.estado = "pendiente"; datos.creado = new Date().toISOString(); datos.por = usuarioActual(); datos.intentos = 0;
    return db.ref("cola_correos").push(datos);
}
window.correoPruebaMotor = async function () {
    const para = prompt("¿A qué correo envío la prueba?", (auth.currentUser && auth.currentUser.email) || "");
    if (!para) return;
    await encolarCorreo({ tipo: "prueba", para: para, asunto: "Prueba de correo - AES LIS", html: "<p>Si recibió este correo, el motor envía correos correctamente. ✔</p><p>" + esc(configLab.nombre || "") + "</p>" });
    mostrarToast("Prueba en cola", "Si el motor está bien configurado, llegará en menos de 1 minuto.");
};
function guardarConfigEntrega() {
    configEntrega.auto_correo = document.getElementById('conf-auto-correo').checked;
    configEntrega.metodo_correo = document.getElementById('conf-metodo-correo').value;
    db.ref("configuracion/entrega").set(configEntrega).then(() => mostrarToast("Entrega", "Configuración guardada."));
}
// Envía a Make un ejemplo con TODOS los campos, para que Make "aprenda" los datos nuevos
function enviarPruebaMake() {
    const ejemplo = {
        tipo: "prueba", correo_paciente: "paciente@ejemplo.com", paciente: "PACIENTE DE PRUEBA", muestra: "0000000000",
        asunto: "Resultados de laboratorio - prueba", mensaje_html: "<p>Prueba</p>", pdf_nombre: "Informe_prueba.pdf",
        pdf_base64: "JVBERi0xLjQKJcfsj6IKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbXS9Db3VudCAwPj4KZW5kb2JqCnRyYWlsZXIKPDwvUm9vdCAxIDAgUj4+CiUlRU9G",
        enlace_portal: urlPortal("ejemplo"), laboratorio_nombre: configLab.nombre,
        codigo: "TEST", producto: "Producto de prueba", marca: "N/A", presentacion: "N/A", stock_actual: 0, cantidad_solicitada: 1,
        distribuidor: "N/A", correo_proveedor: "proveedor@ejemplo.com", telefono_proveedor: "", laboratorio_telefono: configLab.telefono,
        laboratorio_direccion: configLab.direccion, mensaje_formal: "<p>Prueba</p>", mensaje_texto: "Prueba", fecha: new Date().toLocaleString(), solicitado_por: usuarioActual()
    };
    fetch(WEBHOOK_AUTOPEDIDO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ejemplo) })
        .then(r => { if (!r.ok) throw new Error("Make respondió " + r.status); mostrarToast("Make", "Datos de prueba enviados."); })
        .catch(e => alert("No se pudo enviar a Make: " + e.message));
}
function renderizarConfigEntrega() {
    const cdv = document.getElementById("conf-dias-ventana"); if (cdv) cdv.value = diasVentana();
    const chk = document.getElementById('conf-auto-correo'); if (chk) chk.checked = !!configEntrega.auto_correo;
    const mc = document.getElementById('conf-metodo-correo'); if (mc) mc.value = metodoCorreo();
    const u = document.getElementById('conf-url-portal'); if (u) { u.innerText = urlPortal(); u.href = urlPortal(); }
}

// =====================================================================
//  ESTADÍSTICAS
// =====================================================================
window.filtrarTablaParametros = function () {
    const filtro = document.getElementById('buscador-parametros').value.toUpperCase();
    document.querySelectorAll('#tabla-estadisticas tr').forEach(fila => {
        if (fila.cells.length < 2) return;
        fila.style.display = fila.cells[0].innerText.toUpperCase().includes(filtro) ? '' : 'none';
    });
};
// Estadísticas: el rango elegido se trae de la base SOLO al pedirlo (no está todo en memoria)
let statsCache = { rango: "", res: {}, ord: {} }; let cargandoEstadisticas = false;
async function cargarRangoEstadisticas(ini, fin) {
    const rango = ini + "|" + fin; if (statsCache.rango === rango) return;
    cargandoEstadisticas = true;
    try {
        const desde = ini, hasta = fin + "\uf8ff";
        const [rs, os] = await Promise.all([
            db.ref("resultados").orderByChild("fecha_recepcion").startAt(desde).endAt(hasta).once("value"),
            db.ref("ordenes_pendientes").orderByChild("fecha_creacion").startAt(desde).endAt(hasta).once("value")]);
        statsCache = { rango: rango, res: rs.val() || {}, ord: os.val() || {} };
    } finally { cargandoEstadisticas = false; }
}
function resultadosEnRango() {
    const ini = document.getElementById('filtro-fecha-inicio').value, fin = document.getElementById('filtro-fecha-fin').value;
    const fInicio = new Date(ini + "T00:00:00"); const fFin = new Date(fin + "T23:59:59");
    const out = []; const todos = Object.assign({}, statsCache.res, datosGlobales);
    Object.keys(todos).forEach(key => {
        const r = todos[key]; if (r.estado === "Rechazado") return;
        const f = fechaDeResultado(r);
        if (f && f >= fInicio && f <= fFin) out.push({ key: key, r: r, fecha: f });
    });
    return out;
}
window.calcularEstadisticas = async function () {
    const ini = document.getElementById('filtro-fecha-inicio').value, fin = document.getElementById('filtro-fecha-fin').value;
    if (!ini || !fin) return alert("Seleccione el rango de fechas");
    if (statsCache.rango !== ini + "|" + fin) {
        document.getElementById('tabla-estadisticas').innerHTML = "<tr><td colspan=\"2\" style=\"text-align:center; padding:20px; color:#888;\">⏳ Cargando datos del rango...</td></tr>";
        try { await cargarRangoEstadisticas(ini, fin); } catch (e) { return alert("No se pudieron cargar las estadísticas: " + e.message); }
    }
    const registros = resultadosEnRango(); const conteo = {};
    registros.forEach(x => listaResultados(x.r).forEach(res => { conteo[res.n] = (conteo[res.n] || 0) + 1; }));
    document.getElementById('stat-total-tubos').innerText = registros.length;
    const tabla = document.getElementById('tabla-estadisticas');
    if (Object.keys(conteo).length === 0) {
        document.getElementById('stat-top-prueba').innerText = "---";
        tabla.innerHTML = "<tr><td colspan=\"2\" style=\"text-align: center; padding: 20px; color: #888;\">No hay resultados en estas fechas.</td></tr>"; return;
    }
    const ord = Object.entries(conteo).sort((a, b) => b[1] - a[1]);
    document.getElementById('stat-top-prueba').innerText = ord[0][0];
    tabla.innerHTML = ord.map(p => "<tr><td><strong>" + esc(p[0]) + "</strong></td><td><button onclick=\"verDetallePrueba(" + jsArg(p[0]) + ")\" style=\"cursor:pointer; background: #E0F2FE; color: var(--aes-blue); font-weight: bold; padding: 5px 12px; border-radius: 20px; border: 1px solid var(--aes-blue);\">" + p[1] + " Test(s) 🔍</button></td></tr>").join("");
    filtrarTablaParametros();
};

let datosPruebaActual = []; let datosFiltradosModal = []; let paginaActual = 1; let itemsPorPagina = 30;
window.verDetallePrueba = function (pruebaId) {
    document.getElementById('modal-detalle-titulo').innerText = "Detalle de Pacientes - Parámetro: " + pruebaId;
    document.getElementById('filtro-modal-paciente').value = ""; document.getElementById('filtro-modal-fecha').value = ""; datosPruebaActual = [];
    resultadosEnRango().forEach(x => {
        const res = listaResultados(x.r).find(z => z.n.toUpperCase() === pruebaId.toUpperCase());
        if (!res) return;
        const info = nombreDeResultado(x.r);
        datosPruebaActual.push({ fecha: x.fecha.toLocaleDateString(), fechaISO: fechaLocalISO(x.fecha), hora: x.fecha.toLocaleTimeString(), tubo: x.r.muestra || "N/A", paciente: info.huerfano ? "⚠️ " + info.nombre : info.nombre, valor: (res.v + " " + res.u).trim(), estado: x.r.estado === "Validado_Final" ? "✔ Validado" : "Pendiente" });
    });
    document.getElementById('modal-detalle-prueba').style.display = 'flex'; aplicarFiltrosModal();
};
window.cerrarModalDetalle = function () { document.getElementById('modal-detalle-prueba').style.display = 'none'; };
window.aplicarFiltrosModal = function () {
    const filtroTexto = document.getElementById('filtro-modal-paciente').value.toUpperCase();
    const filtroFecha = document.getElementById('filtro-modal-fecha').value;
    datosFiltradosModal = datosPruebaActual.filter(item => (item.paciente.toUpperCase().includes(filtroTexto) || item.tubo.includes(filtroTexto)) && (filtroFecha === "" || item.fechaISO === filtroFecha));
    paginaActual = 1; renderizarPaginacion();
};
window.cambiarItemsPorPagina = function () { itemsPorPagina = parseInt(document.getElementById('select-paginacion').value); paginaActual = 1; renderizarPaginacion(); };
window.cambiarPagina = function (d) { paginaActual += d; renderizarPaginacion(); };
window.renderizarPaginacion = function () {
    const totalPaginas = Math.ceil(datosFiltradosModal.length / itemsPorPagina) || 1;
    if (paginaActual < 1) paginaActual = 1; if (paginaActual > totalPaginas) paginaActual = totalPaginas;
    const datosPagina = datosFiltradosModal.slice((paginaActual - 1) * itemsPorPagina, paginaActual * itemsPorPagina);
    const tabla = document.getElementById('tabla-modal-detalle');
    if (datosPagina.length === 0) tabla.innerHTML = "<tr><td colspan=\"5\" style=\"text-align: center; padding: 20px; color: #888;\">No se encontraron pacientes.</td></tr>";
    else tabla.innerHTML = datosPagina.map(item => "<tr><td>" + esc(item.fecha) + " <span style=\"color:#888; font-size:0.75rem;\">" + esc(item.hora) + "</span></td><td><strong>" + esc(item.tubo) + "</strong></td><td>" + esc(item.paciente) + "</td><td style=\"font-family: monospace; font-weight: bold; font-size: 1.05rem;\">" + esc(item.valor) + "</td><td style=\"" + (item.estado.includes("Validado") ? "color: var(--success);" : "color: var(--warning);") + " font-weight: bold;\">" + esc(item.estado) + "</td></tr>").join("");
    document.getElementById('lbl-pagina-actual').innerText = "Pág " + paginaActual + " de " + totalPaginas;
    document.getElementById('btn-prev-page').disabled = (paginaActual === 1); document.getElementById('btn-next-page').disabled = (paginaActual === totalPaginas);
};

// =====================================================================
//  INVENTARIO Y AUTO-PEDIDOS
// =====================================================================
let inventarioGlobal = {};

window.guardarInventario = function () {
    const v = id => document.getElementById(id).value.trim();
    const nombre = v('inv-nombre'), codigo = v('inv-codigo'), lote = v('inv-lote'), vencimiento = v('inv-vencimiento');
    const stock = parseInt(v('inv-stock')), minimo = parseInt(v('inv-minimo'));
    if (!nombre || !codigo || !lote || !vencimiento || isNaN(stock) || isNaN(minimo)) return alert("Complete los campos obligatorios (Nombre, Código, Lote, Vencimiento, Stock y Mínimo).");
    if (!claveValida(codigo)) return alert("El código no puede tener los caracteres . # $ [ ] /");
    if (stock < 0 || minimo < 0) return alert("Stock y mínimo no pueden ser negativos.");
    const auto = document.getElementById('inv-autopedido').checked;
    const correo = v('inv-correo'), telefono = v('inv-telefono'), cantPedido = parseInt(v('inv-cant-pedido')) || 0;
    if (auto && !correo && !telefono) return alert("Para el auto-pedido indique el correo o el WhatsApp del proveedor.");
    if (auto && cantPedido <= 0) return alert("Para el auto-pedido indique la cantidad a pedir.");

    const existente = inventarioGlobal[codigo];
    if (existente && !confirm("Ya existe un producto con el código " + codigo + ". ¿Reemplazarlo?")) return;

    const item = {
        nombre: nombre, codigo: codigo, marca: v('inv-marca') || "N/A", presentacion: v('inv-presentacion') || "N/A",
        lote: lote, vencimiento: vencimiento, stock: stock, minimo: minimo,
        distribuidor: v('inv-distribuidor') || "N/A", cantidad_pedido: cantPedido, correo_proveedor: correo, telefono_proveedor: telefono,
        autopedido: auto, ultimo_pedido: existente ? (existente.ultimo_pedido || "") : ""
    };
    db.ref("inventario/" + codigo).set(item).then(() => {
        mostrarToast("Inventario", "Producto guardado correctamente.");
        ['inv-nombre', 'inv-codigo', 'inv-marca', 'inv-presentacion', 'inv-lote', 'inv-vencimiento', 'inv-stock', 'inv-minimo', 'inv-distribuidor', 'inv-cant-pedido', 'inv-correo', 'inv-telefono'].forEach(id => document.getElementById(id).value = "");
        document.getElementById('inv-autopedido').checked = false;
        verificarStockYPedir(codigo, item); // si ya entra con stock bajo, también se pide
    });
};
window.eliminarInventario = function (codigo) { if (confirm("¿Eliminar el producto " + codigo + " del inventario?")) db.ref("inventario/" + codigo).remove(); };

function renderizarInventario() {
    const tabla = document.getElementById('tabla-inventario');
    const keys = Object.keys(inventarioGlobal);
    if (keys.length === 0) { tabla.innerHTML = "<tr><td colspan=\"6\" style=\"text-align:center; padding:20px; color:#888;\">Inventario vacío</td></tr>"; return; }
    let h = "";
    keys.forEach(key => {
        const item = inventarioGlobal[key];
        let colorStock = "var(--aes-dark)", badgeStock = "";
        if (item.stock <= item.minimo) { colorStock = "var(--danger)"; badgeStock = "<span style=\"background:#FEE2E2; color:var(--danger); padding:2px 6px; border-radius:10px; font-size:0.65rem; font-weight:bold; margin-left:5px;\">BAJO</span>"; }
        const dias = (new Date(item.vencimiento + "T00:00:00") - new Date()) / 86400000;
        let colorVenc = "var(--text-main)", txtVenc = ""; if (dias < 30) { colorVenc = "var(--warning)"; txtVenc = " ⚠️"; } if (dias < 0) { colorVenc = "var(--danger)"; txtVenc = " VENCIDO"; }
        const c = jsArg(item.codigo);
        h += "<tr><td><strong>" + esc(item.codigo) + "</strong><br><span style=\"font-size:0.7rem; color:#888;\">" + esc(item.marca) + "</span></td><td><div style=\"font-weight:bold;\">" + esc(item.nombre) + " <span style=\"font-size:0.8rem; font-weight:normal;\">(" + esc(item.presentacion) + ")</span></div><div style=\"font-size:0.75rem; color:#666;\">Lote: " + esc(item.lote) + " | Prov: " + esc(item.distribuidor) + "</div></td><td style=\"color:" + colorVenc + "; font-weight:bold;\">" + esc(item.vencimiento) + txtVenc + "</td><td style=\"color:" + colorStock + "; font-weight:bold; font-size:1.1rem;\">" + esc(item.stock) + " " + badgeStock + "</td><td>" + (item.autopedido ? "<span style=\"color:var(--success); font-weight:bold;\">✔ Activado</span>" + (item.ultimo_pedido ? "<br><span style=\"font-size:0.7rem; color:#888;\">Último: " + esc(item.ultimo_pedido) + "</span>" : "") : "<span style=\"color:#888;\">✖ Desact.</span>") + "</td><td style=\"white-space:nowrap;\"><button onclick=\"sumarStock(" + c + ")\" style=\"background:#D1FAE5; border:1px solid #10B981; border-radius:4px; cursor:pointer; font-size:1rem; padding:4px 8px; margin-right:5px;\" title=\"Ingresar Nuevo Stock\">➕</button><button onclick=\"restarStock(" + c + ")\" style=\"background:#FEE2E2; border:1px solid #EF4444; border-radius:4px; cursor:pointer; font-size:1rem; padding:4px 8px; margin-right:10px;\" title=\"Dar de Baja / Retirar\">➖</button><button onclick=\"eliminarInventario(" + c + ")\" style=\"background:none; border:none; cursor:pointer; font-size:1.1rem; color:red;\" title=\"Eliminar Producto\">🗑️</button></td></tr>";
    });
    tabla.innerHTML = h;
}

window.sumarStock = function (codigo) {
    const item = inventarioGlobal[codigo]; if (!item) return;
    const cantidad = prompt("🟢 INGRESO DE STOCK\nProducto: " + item.nombre + "\nStock actual: " + item.stock + " unidades.\n\n¿Cuántas unidades NUEVAS acaban de llegar?");
    const n = parseInt(cantidad);
    if (!cantidad || isNaN(n) || n <= 0) return;
    const nuevo = item.stock + n;
    if (confirm("Stock Anterior: " + item.stock + "\nCantidad Añadida: +" + n + "\nNUEVO STOCK TOTAL: " + nuevo + "\n\n¿Confirmar?")) {
        db.ref("inventario/" + codigo + "/stock").set(nuevo).then(() => mostrarToast("Inventario", "Se agregaron " + n + " unidades de " + item.nombre + "."));
    }
};
window.restarStock = function (codigo) {
    const item = inventarioGlobal[codigo]; if (!item) return;
    const cantidad = prompt("🔴 RETIRO DE STOCK\nProducto: " + item.nombre + "\nStock actual: " + item.stock + " unidades.\n\n¿Cuántas unidades va a RETIRAR / DAR DE BAJA?");
    const n = parseInt(cantidad);
    if (!cantidad || isNaN(n) || n <= 0) return;
    const nuevo = item.stock - n;
    if (nuevo < 0) return alert("Error: No puede retirar más unidades de las que hay en stock.");
    if (confirm("Stock Anterior: " + item.stock + "\nCantidad Retirada: -" + n + "\nNUEVO STOCK TOTAL: " + nuevo + "\n\n¿Confirmar?")) {
        db.ref("inventario/" + codigo + "/stock").set(nuevo).then(() => {
            mostrarToast("Inventario", "Se retiraron " + n + " unidades de " + item.nombre + ".");
            verificarStockYPedir(codigo, Object.assign({}, item, { stock: nuevo }));
        });
    }
};

function verificarStockYPedir(codigo, item) {
    if (!item.autopedido || item.stock > item.minimo) return;
    const hoyStr = fechaLocalISO();
    let diasPasados = 999;
    if (item.ultimo_pedido) diasPasados = Math.floor((new Date(hoyStr + "T00:00:00") - new Date(item.ultimo_pedido + "T00:00:00")) / 86400000);
    if (diasPasados <= 3) {
        if (confirm("⚠️ AVISO DE AUTO-PEDIDO\n\nEl stock de " + item.nombre + " está en " + item.stock + ", pero ya se envió un pedido al proveedor el " + item.ultimo_pedido + ".\n\n¿Enviar OTRO pedido de todas formas?")) enviarWebhook(codigo, item, hoyStr);
        else mostrarToast("Auto-Pedido", "Se mantuvo el pedido anterior.");
    } else {
        enviarWebhook(codigo, item, hoyStr);
    }
}

function enviarWebhook(codigo, item, hoyStr) {
    const mensajeFormal = "Estimados señores de " + (item.distribuidor !== "N/A" ? item.distribuidor : "Ventas") + ",\n\n" +
        "Por medio de la presente, el laboratorio *" + configLab.nombre + "* solicita cordialmente el abastecimiento del siguiente producto para nuestro inventario:\n\n" +
        "📦 *Producto:* " + item.nombre + (item.presentacion !== "N/A" ? " (" + item.presentacion + ")" : "") + "\n" +
        "🔖 *Marca:* " + item.marca + "\n" +
        "🔢 *Código / Ref:* " + item.codigo + "\n" +
        "🛒 *Cantidad Solicitada:* " + item.cantidad_pedido + " unidades/cajas\n\n" +
        "Por favor, confirmar la recepción de este pedido y el tiempo estimado de entrega a nuestras instalaciones en: " + configLab.direccion + ".\n\n" +
        "Atentamente,\n*" + configLab.nombre + "*\nTeléfono: " + configLab.telefono;

    // Versión con formato para correo (en una sola línea, sin saltos)
    const fila = (k, v) => "<tr><td style=\"padding:8px 12px;border:1px solid #E2E8F0;background:#F8FAFC;font-weight:bold;width:40%;\">" + k + "</td><td style=\"padding:8px 12px;border:1px solid #E2E8F0;\">" + esc(v) + "</td></tr>";
    const mensajeHTML =
        "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:600px;\">" +
        "<div style=\"background:#1A1A24;color:#fff;padding:14px 18px;border-radius:6px 6px 0 0;\"><b style=\"font-size:16px;\">Solicitud de pedido de reactivo</b><br><span style=\"color:#00A8E8;\">" + esc(configLab.nombre) + "</span></div>" +
        "<div style=\"border:1px solid #E2E8F0;border-top:none;padding:18px;border-radius:0 0 6px 6px;\">" +
        "<p>Estimados señores de <b>" + esc(item.distribuidor !== "N/A" ? item.distribuidor : "Ventas") + "</b>:</p>" +
        "<p>Por medio de la presente, el laboratorio <b>" + esc(configLab.nombre) + "</b> solicita cordialmente el abastecimiento del siguiente producto:</p>" +
        "<table style=\"border-collapse:collapse;width:100%;margin:12px 0;\">" +
        fila("Producto", item.nombre + (item.presentacion !== "N/A" ? " (" + item.presentacion + ")" : "")) +
        fila("Marca", item.marca) +
        fila("Código / Ref.", item.codigo) +
        fila("Cantidad solicitada", item.cantidad_pedido + " unidades/cajas") +
        "</table>" +
        "<p>Por favor, confirmar la recepción de este pedido y el tiempo estimado de entrega" + (configLab.direccion ? " a nuestras instalaciones en: <b>" + esc(configLab.direccion) + "</b>" : "") + ".</p>" +
        "<p>Atentamente,<br><b>" + esc(configLab.nombre) + "</b>" + (configLab.telefono ? "<br>Teléfono: " + esc(configLab.telefono) : "") + "</p>" +
        "</div></div>";

    const payload = {
        tipo: "autopedido",
        codigo: item.codigo, producto: item.nombre, marca: item.marca, presentacion: item.presentacion,
        stock_actual: item.stock, cantidad_solicitada: item.cantidad_pedido, distribuidor: item.distribuidor,
        correo_proveedor: item.correo_proveedor, telefono_proveedor: item.telefono_proveedor,
        laboratorio_nombre: configLab.nombre, laboratorio_telefono: configLab.telefono, laboratorio_direccion: configLab.direccion,
        mensaje_formal: mensajeHTML, mensaje_texto: mensajeFormal, fecha: new Date().toLocaleString(), solicitado_por: usuarioActual()
    };

    mostrarToast("Auto-Pedido", "Enviando pedido al proveedor de " + item.nombre + "...");
    if (metodoCorreo() === "motor") {
        if (!item.correo_proveedor) return alert("El producto " + item.nombre + " no tiene correo del proveedor.");
        encolarCorreo({ tipo: "autopedido", para: item.correo_proveedor, asunto: "Pedido de reactivos - " + (configLab.nombre || "") + " - " + item.nombre, html: mensajeHTML, inventario_codigo: codigo })
            .then(() => { db.ref("inventario/" + codigo + "/ultimo_pedido").set(hoyStr); mostrarToast("Auto-Pedido en cola", "El motor lo enviará a " + item.correo_proveedor); })
            .catch(e => alert("⚠️ No se pudo poner en cola el pedido: " + e.message));
        return;
    }
    fetch(WEBHOOK_AUTOPEDIDO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(res => {
            if (!res.ok) throw new Error("Make respondió " + res.status);
            // Solo se marca la fecha si el envío salió bien
            db.ref("inventario/" + codigo + "/ultimo_pedido").set(hoyStr);
            mostrarToast("Auto-Pedido enviado", item.nombre);
        })
        .catch(e => { console.error(e); alert("⚠️ No se pudo enviar el auto-pedido de " + item.nombre + ".\nRevise la conexión o el escenario de Make.\n\nDetalle: " + e.message); });
}


// =====================================================================
//  HISTORIAL DE RESULTADOS (módulo aparte, en forma de tabla)
// =====================================================================
let histFilas = [];
window.semanaHistorial = function () {
    const h = new Date(); document.getElementById('hist-hasta').value = fechaLocalISO(h);
    document.getElementById('hist-desde').value = fechaLocalISO(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 6));
    document.getElementById('hist-paciente').value = ""; document.getElementById('hist-tubo').value = ""; document.getElementById('hist-estado').value = "";
    buscarHistorialTabla();
};
function sinAcentos(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
function sumarDias(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return fechaLocalISO(d); }
window.buscarHistorialTabla = async function () {
    const desde = document.getElementById('hist-desde').value, hasta = document.getElementById('hist-hasta').value;
    const pac = document.getElementById('hist-paciente').value.trim(), tubo = document.getElementById('hist-tubo').value.trim();
    const cuerpo = document.getElementById('hist-cuerpo'), resumen = document.getElementById('hist-resumen');
    if (!tubo && !/^\d{4,}$/.test(pac) && (!desde || !hasta)) return alert("Elija las fechas Desde y Hasta");
    if (/[.#$\[\]\/]/.test(tubo)) return alert("N° de tubo no válido");
    cuerpo.innerHTML = "<tr><td colspan=\"7\" style=\"text-align:center; padding:20px; color:#888;\">⏳ Buscando en el historial...</td></tr>"; resumen.innerText = "";
    try {
        let ordenes = {};
        if (tubo) {
            const o = await db.ref("ordenes_pendientes/" + tubo).once("value"); if (o.exists()) ordenes[tubo] = o.val();
        } else if (/^\d{4,}$/.test(pac)) {
            // Es un CI: todas sus órdenes, sin importar la fecha
            ordenes = (await db.ref("ordenes_pendientes").orderByChild("ci_paciente").equalTo(pac).once("value")).val() || {};
        } else {
            ordenes = (await db.ref("ordenes_pendientes").orderByChild("fecha_creacion").startAt(desde).endAt(hasta + "\uf8ff").once("value")).val() || {};
        }
        // Filtro por nombre (sin importar mayúsculas ni tildes)
        if (pac && !/^\d{4,}$/.test(pac)) { const q = sinAcentos(pac); Object.keys(ordenes).forEach(k => { if (!sinAcentos(ordenes[k].nombre_paciente).includes(q)) delete ordenes[k]; }); }
        // Resultados de esas órdenes
        const porMuestra = {};
        const agregar = (k, r) => { if (!r || !r.muestra) return; (porMuestra[r.muestra] = porMuestra[r.muestra] || {})[k] = r; };
        const muestras = Object.keys(ordenes);
        if (tubo || /^\d{4,}$/.test(pac) || muestras.length <= 30) {
            await Promise.all(muestras.map(m => db.ref("resultados").orderByChild("muestra").equalTo(m).once("value").then(s => s.forEach(h => agregar(h.key, h.val())))));
            if (tubo && !muestras.length) { // tubo sin orden web (huérfano)
                const s = await db.ref("resultados").orderByChild("muestra").equalTo(tubo).once("value"); s.forEach(h => agregar(h.key, h.val()));
                if (porMuestra[tubo]) ordenes[tubo] = null;
            }
        } else {
            const rs = (await db.ref("resultados").orderByChild("fecha_recepcion").startAt(desde).endAt(sumarDias(hasta, 15) + "\uf8ff").once("value")).val() || {};
            Object.keys(rs).forEach(k => agregar(k, rs[k]));
        }
        Object.keys(datosGlobales).forEach(k => { if (ordenes.hasOwnProperty(datosGlobales[k].muestra)) agregar(k, datosGlobales[k]); });
        histFilas = Object.keys(ordenes).map(m => filaHistorial(m, ordenes[m], porMuestra[m] || {}));
        histFilas.sort((a, b) => String(b.fechaISO).localeCompare(String(a.fechaISO)));
        // Guardamos lo traído para poder abrirlo en Validación
        Object.values(porMuestra).forEach(g => Object.keys(g).forEach(k => { resExtra[k] = g[k]; }));
        Object.keys(ordenes).forEach(m => { if (ordenes[m]) ordenesExtra[m] = ordenes[m]; });
        pintarHistorialTabla();
    } catch (e) { cuerpo.innerHTML = "<tr><td colspan=\"7\" style=\"color:#DC2626; padding:15px;\">Error al buscar: " + esc(e.message) + "</td></tr>"; }
};
function filaHistorial(m, o, resultados) {
    o = o || {}; const keys = Object.keys(resultados);
    const pruebas = {}; // nombre -> estado
    const valores = {}; // nombre -> "valor unidad"
    (o.examenes || []).forEach(n => pruebas[String(n).toUpperCase()] = "espera");
    let rechazado = false, primeraKey = keys[0] || null, fechaRes = null;
    keys.forEach(k => {
        const r = resultados[k]; if (r.estado === "Rechazado") rechazado = true;
        if (!fechaRes && r.fecha_recepcion) fechaRes = r.fecha_recepcion;
        listaResultados(r).forEach(x => {
            const n = x.n.toUpperCase(); const est = r.estado === "Rechazado" ? "rechazado" : (pruebaValidada(r, n) ? "validado" : "pendiente");
            if (pruebas[n] !== "validado") { pruebas[n] = est; valores[n] = (x.v + " " + x.u).trim(); }
        });
        if (r.estado !== "Rechazado" && (!resultados[primeraKey] || resultados[primeraKey].estado === "Rechazado")) primeraKey = k;
    });
    const vals = Object.values(pruebas);
    let estado = "Sin resultados";
    if (keys.length) {
        if (vals.length && vals.every(v => v === "validado")) estado = "Validado";
        else if (rechazado && !vals.some(v => v === "validado" || v === "pendiente")) estado = "Rechazado";
        else if (vals.some(v => v === "validado")) estado = "Parcial";
        else estado = "Pendiente";
    }
    const fechaISO = o.fecha_creacion || fechaRes || "";
    return { muestra: m, nombre: o.nombre_paciente || (keys.length ? nombreDeResultado(resultados[keys[0]]).nombre : "-"), ci: o.ci_paciente || "", fechaISO: fechaISO, pruebas: pruebas, valores: valores, estado: estado, key: primeraKey, medico: o.medico || "" };
}
window.pintarHistorialTabla = function () {
    const filtro = document.getElementById('hist-estado').value;
    const filas = histFilas.filter(f => !filtro || f.estado === filtro);
    const cuerpo = document.getElementById('hist-cuerpo');
    const cuenta = {}; histFilas.forEach(f => cuenta[f.estado] = (cuenta[f.estado] || 0) + 1);
    document.getElementById('hist-resumen').innerHTML = "<b>" + histFilas.length + "</b> órdenes encontradas" + Object.keys(cuenta).map(k => " · " + esc(k) + ": <b>" + cuenta[k] + "</b>").join("");
    if (!filas.length) { cuerpo.innerHTML = "<tr><td colspan=\"7\" style=\"text-align:center; padding:20px; color:#888;\">No hay órdenes con esos filtros.</td></tr>"; return; }
    const icono = { validado: "✔", pendiente: "⏳", espera: "•", rechazado: "✖" };
    const claseEstado = { "Validado": "val", "Rechazado": "rech", "Parcial": "parc", "Pendiente": "pend", "Sin resultados": "sinres" };
    cuerpo.innerHTML = filas.map(f => {
        const d = f.fechaISO ? new Date(f.fechaISO) : null;
        const chips = Object.keys(f.pruebas).map(n => "<span class=\"chip-prueba " + f.pruebas[n] + "\" title=\"" + esc(f.pruebas[n]) + "\">" + icono[f.pruebas[n]] + " " + esc(n) + "</span>").join(" ");
        const abrir = f.key ? "<button class=\"btn-abrir-hist\" onclick=\"abrirDesdeHistorial(" + jsArg(f.key) + ")\">Abrir</button>" : "";
        return "<tr><td>" + (d && !isNaN(d) ? esc(d.toLocaleDateString()) + "<br><small>" + esc(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) + "</small>" : "-") + "</td><td><b>" + esc(f.muestra) + "</b></td><td>" + esc(f.nombre) + "</td><td>" + esc(f.ci) + "</td><td>" + chips + "</td><td><span class=\"status-pill " + claseEstado[f.estado] + "\">" + esc(f.estado) + "</span></td><td>" + abrir + "</td></tr>";
    }).join("");
};
window.abrirDesdeHistorial = function (key) {
    seguirResultado(key); aplicarDatos();
    switchView('validacion', document.querySelectorAll('.nav-item')[1]);
    if (window.abrirEncontrado) abrirEncontrado(key);
};
// Exporta a Excel real (.xlsx) con cabecera formal. La librería se carga solo al usarla.
function cargarScript(url) {
    return new Promise((ok, mal) => { const sc = document.createElement("script"); sc.src = url; sc.onload = ok; sc.onerror = () => mal(new Error("No se pudo cargar " + url)); document.head.appendChild(sc); });
}
window.exportarHistorialCSV = async function () {
    if (!histFilas.length) return alert("Primero haga una búsqueda");
    try { if (!window.ExcelJS) await cargarScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js"); }
    catch (e) { return alert("No se pudo preparar el Excel. Revise su conexión a internet."); }
    const filtro = document.getElementById('hist-estado').value;
    const filas = histFilas.filter(f => !filtro || f.estado === filtro);
    const desde = document.getElementById('hist-desde').value, hasta = document.getElementById('hist-hasta').value;
    const pac = document.getElementById('hist-paciente').value.trim(), tubo = document.getElementById('hist-tubo').value.trim();
    const fmt = iso => { if (!iso) return ""; const [a, m, d] = iso.split("-"); return d + "/" + m + "/" + a; };

    const AZUL = "FF0B4F8A", AZUL_CLARO = "FFE0F2FE", GRIS = "FFF8FAFC", BORDE = "FFCBD5E1";
    const COLOR_ESTADO = { "Validado": ["FFDCFCE7", "FF166534"], "Parcial": ["FFE0F2FE", "FF075985"], "Pendiente": ["FFFEF3C7", "FF92400E"], "Rechazado": ["FFFEE2E2", "FF991B1B"], "Sin resultados": ["FFF1F5F9", "FF475569"] };
    const borde = { top: { style: "thin", color: { argb: BORDE } }, left: { style: "thin", color: { argb: BORDE } }, bottom: { style: "thin", color: { argb: BORDE } }, right: { style: "thin", color: { argb: BORDE } } };

    const wb = new ExcelJS.Workbook(); wb.creator = "AES O.S. Enterprise"; wb.created = new Date();

    function encabezado(ws, titulo, nCols) {
        const ultima = String.fromCharCode(64 + nCols);
        ws.mergeCells("A1:" + ultima + "1"); ws.getCell("A1").value = (configLab.nombre || "Laboratorio Clínico").toUpperCase();
        ws.getCell("A1").font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
        ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
        ws.getCell("A1").alignment = { vertical: "middle", horizontal: "center" }; ws.getRow(1).height = 30;
        ws.mergeCells("A2:" + ultima + "2"); ws.getCell("A2").value = [configLab.direccion, configLab.telefono ? "Tel. " + configLab.telefono : ""].filter(Boolean).join("  ·  ");
        ws.getCell("A2").font = { size: 10, color: { argb: "FF475569" } }; ws.getCell("A2").alignment = { horizontal: "center" };
        ws.mergeCells("A3:" + ultima + "3"); ws.getCell("A3").value = titulo;
        ws.getCell("A3").font = { size: 13, bold: true, color: { argb: AZUL } }; ws.getCell("A3").alignment = { horizontal: "center" }; ws.getRow(3).height = 22;
        const filtros = ["Período: " + (tubo || /^\d{4,}$/.test(pac) ? "todo el historial" : fmt(desde) + " al " + fmt(hasta))];
        if (pac) filtros.push("Paciente: " + pac); if (tubo) filtros.push("Tubo: " + tubo); if (filtro) filtros.push("Estado: " + filtro);
        ws.mergeCells("A4:" + ultima + "4"); ws.getCell("A4").value = filtros.join("   |   ");
        ws.getCell("A4").font = { size: 10, italic: true }; ws.getCell("A4").alignment = { horizontal: "center" };
        ws.mergeCells("A5:" + ultima + "5"); ws.getCell("A5").value = "Generado el " + new Date().toLocaleString() + " por " + usuarioActual();
        ws.getCell("A5").font = { size: 9, color: { argb: "FF94A3B8" } }; ws.getCell("A5").alignment = { horizontal: "center" };
    }
    function cabecera(ws, fila, textos) {
        const r = ws.getRow(fila); r.values = textos; r.height = 22;
        r.eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = borde; });
    }
    function pintarEstado(c, est) { const col = COLOR_ESTADO[est]; if (!col) return; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col[0] } }; c.font = { bold: true, color: { argb: col[1] } }; c.alignment = { horizontal: "center", vertical: "middle" }; }

    // ---- Hoja 1: Resumen por orden ----
    const ws = wb.addWorksheet("Historial", { views: [{ state: "frozen", ySplit: 7 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws.columns = [{ width: 12 }, { width: 8 }, { width: 14 }, { width: 30 }, { width: 13 }, { width: 20 }, { width: 38 }, { width: 30 }, { width: 30 }, { width: 10 }, { width: 15 }];
    encabezado(ws, "HISTORIAL DE ÓRDENES Y RESULTADOS", 11);
    cabecera(ws, 7, ["Fecha", "Hora", "N° Tubo", "Paciente", "CI", "Médico", "Pruebas validadas", "Con resultado (sin validar)", "Esperando al equipo / Rechazadas", "Avance", "Estado"]);
    filas.forEach((f, i) => {
        const d = f.fechaISO ? new Date(f.fechaISO) : null; const ok = d && !isNaN(d);
        const grupo = t => Object.keys(f.pruebas).filter(n => f.pruebas[n] === t);
        const val = grupo("validado"), pen = grupo("pendiente"), esp = grupo("espera"), rec = grupo("rechazado");
        const total = Object.keys(f.pruebas).length;
        const r = ws.addRow([ok ? new Date(d.getTime() - d.getTimezoneOffset() * 60000) : "", ok ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "", f.muestra, f.nombre, f.ci, f.medico, val.join(", "), pen.join(", "), esp.join(", ") + (rec.length ? (esp.length ? " | " : "") + "Rech: " + rec.join(", ") : ""), total ? val.length + " / " + total : "-", f.estado]);
        r.eachCell({ includeEmpty: true }, (c, col) => {
            c.border = borde; c.alignment = { vertical: "middle", wrapText: col >= 7 && col <= 9, horizontal: [1, 2, 3, 5, 10].includes(col) ? "center" : "left" };
            if (i % 2) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
        });
        r.getCell(1).numFmt = "dd/mm/yyyy"; r.getCell(3).font = { bold: true };
        pintarEstado(r.getCell(11), f.estado);
    });
    ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7 + filas.length, column: 11 } };
    // Totales
    const cuenta = {}; filas.forEach(f => cuenta[f.estado] = (cuenta[f.estado] || 0) + 1);
    let fr = ws.rowCount + 2;
    ws.getCell("C" + fr).value = "RESUMEN"; ws.getCell("C" + fr).font = { bold: true, color: { argb: AZUL }, size: 12 };
    [["Total de órdenes", filas.length]].concat(Object.keys(COLOR_ESTADO).filter(k => cuenta[k]).map(k => [k, cuenta[k]])).forEach((par, j) => {
        const rr = ws.getRow(fr + 1 + j); rr.getCell(3).value = par[0]; rr.getCell(4).value = par[1];
        [3, 4].forEach(c => { rr.getCell(c).border = borde; }); rr.getCell(4).alignment = { horizontal: "center" };
        if (j === 0) { rr.getCell(3).font = { bold: true }; rr.getCell(4).font = { bold: true }; rr.getCell(3).fill = rr.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_CLARO } }; }
        else pintarEstado(rr.getCell(3), par[0]);
    });

    // ---- Hoja 2: Detalle por prueba (con el valor) ----
    const ws2 = wb.addWorksheet("Detalle por prueba", { views: [{ state: "frozen", ySplit: 7 }], pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws2.columns = [{ width: 12 }, { width: 14 }, { width: 30 }, { width: 13 }, { width: 14 }, { width: 22 }, { width: 16 }];
    encabezado(ws2, "DETALLE DE PRUEBAS", 7);
    cabecera(ws2, 7, ["Fecha", "N° Tubo", "Paciente", "CI", "Prueba", "Resultado", "Estado"]);
    const nombreEstado = { validado: "Validado", pendiente: "Pendiente", espera: "Sin resultados", rechazado: "Rechazado" };
    let i2 = 0;
    filas.forEach(f => {
        const d = f.fechaISO ? new Date(f.fechaISO) : null; const ok = d && !isNaN(d);
        Object.keys(f.pruebas).forEach(n => {
            const est = nombreEstado[f.pruebas[n]];
            const r = ws2.addRow([ok ? new Date(d.getTime() - d.getTimezoneOffset() * 60000) : "", f.muestra, f.nombre, f.ci, n, (f.valores || {})[n] || "", est === "Sin resultados" ? "En espera" : est]);
            r.eachCell({ includeEmpty: true }, (c, col) => { c.border = borde; c.alignment = { vertical: "middle", horizontal: [1, 2, 4, 5, 6].includes(col) ? "center" : "left" }; if (i2 % 2) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } }; });
            r.getCell(1).numFmt = "dd/mm/yyyy"; r.getCell(5).font = { bold: true }; pintarEstado(r.getCell(7), est); i2++;
        });
    });
    ws2.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7 + i2, column: 7 } };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "Historial_" + (tubo || pac || (desde + "_al_" + hasta)).replace(/[^\w\-]+/g, "_") + ".xlsx";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};


// ---------- Panel de usuarios (solo Administrador) ----------
let usuariosGlobal = {}, solicitudesGlobal = {}, bloqueadosGlobal = {}, panelUsuariosActivo = false, propietarioUid = null;
function iniciarPanelUsuarios() {
    if (panelUsuariosActivo) return; panelUsuariosActivo = true;
    db.ref("usuarios").on("value", s => { usuariosGlobal = s.val() || {}; renderizarUsuarios(); });
    db.ref("usuarios_solicitudes").on("value", s => { solicitudesGlobal = s.val() || {}; renderizarUsuarios(); });
    db.ref("usuarios_bloqueados").on("value", s => { bloqueadosGlobal = s.val() || {}; renderizarUsuarios(); });
    db.ref("propietario_uid").on("value", s => { propietarioUid = s.val(); renderizarUsuarios(); });
}
function detenerPanelUsuarios() {
    if (!panelUsuariosActivo) return; panelUsuariosActivo = false;
    ["usuarios", "usuarios_solicitudes", "usuarios_bloqueados", "propietario_uid"].forEach(r => db.ref(r).off());
}
function opcionesRol(sel) { return Object.keys(ROLES).map(r => "<option value=\"" + r + "\"" + (r === sel ? " selected" : "") + ">" + ROLES[r].nombre + "</option>").join(""); }
function renderizarUsuarios() {
    const t = document.getElementById('tabla-usuarios'); if (!t) return;
    const yo = auth.currentUser ? auth.currentUser.uid : "";
    const filas = Object.keys(usuariosGlobal).sort((a, b) => String(usuariosGlobal[a].nombre || "").localeCompare(String(usuariosGlobal[b].nombre || ""))).map(uid => {
        const u = usuariosGlobal[uid]; const activo = u.activo !== false && !bloqueadosGlobal[uid];
        const esYo = uid === yo, esDueno = uid === propietarioUid, intocable = esYo || esDueno;
        return "<tr" + (activo ? "" : " class=\"usuario-inactivo\"") + "><td><b>" + esc(u.nombre || "") + "</b>" + (esYo ? " <small>(usted)</small>" : "") + "</td><td>" + esc(u.email || "") + "</td>" +
            "<td><select onchange=\"cambiarRolUsuario(" + jsArg(uid) + ", this.value)\"" + (intocable ? " disabled" : "") + ">" + opcionesRol(u.rol) + "</select></td>" +
            "<td>" + (activo ? "<span class=\"status-pill val\">Activo</span>" : "<span class=\"status-pill rech\">Desactivado</span>") + "</td>" +
            "<td class=\"acciones-usuario\">" + (intocable ? "" : "<button onclick=\"activarUsuario(" + jsArg(uid) + ", " + (!activo) + ")\">" + (activo ? "Desactivar" : "Activar") + "</button>") +
            "<button onclick=\"resetearClave(" + jsArg(u.email || "") + ")\">Enviar cambio de contraseña</button>" + (intocable ? "" : "<button onclick=\"quitarUsuario(" + jsArg(uid) + ")\" title=\"Quitar de la lista (también lo bloquea)\">🗑️</button>") + "</td></tr>";
    }).join("");
    t.innerHTML = filas || "<tr><td colspan=\"5\">Sin usuarios</td></tr>";
    const bp = document.getElementById('btn-propietario'); if (bp) bp.style.display = propietarioUid ? "none" : "inline-block";
    const sol = document.getElementById('tabla-solicitudes'), caja = document.getElementById('caja-solicitudes');
    const ks = Object.keys(solicitudesGlobal).filter(uid => !usuariosGlobal[uid]);
    caja.style.display = ks.length ? "block" : "none";
    sol.innerHTML = ks.map(uid => "<tr><td>" + esc(solicitudesGlobal[uid].email) + "</td><td>" + esc(new Date(solicitudesGlobal[uid].fecha).toLocaleString()) + "</td><td><select id=\"sol-rol-" + esc(uid) + "\">" + opcionesRol("recepcion") + "</select></td><td class=\"acciones-usuario\"><button onclick=\"aprobarSolicitud(" + jsArg(uid) + ")\">✔ Aprobar</button><button onclick=\"db.ref('usuarios_solicitudes/' + " + jsArg(uid) + ").remove()\">Descartar</button></td></tr>").join("");
}
window.cambiarRolUsuario = async function (uid, rol) {
    await db.ref("usuarios/" + uid + "/rol").set(rol);
    db.ref("auditoria_usuarios").push({ accion: "Cambio de rol a " + rol, usuario_afectado: usuariosGlobal[uid].email, por: usuarioActual(), fecha: new Date().toISOString() });
    mostrarToast("Rol actualizado", (usuariosGlobal[uid].nombre || "") + " → " + ROLES[rol].nombre);
};
window.activarUsuario = async function (uid, activar) {
    const u = usuariosGlobal[uid];
    if (!activar && !confirm("¿Desactivar a " + (u.nombre || u.email) + "? Ya no podrá entrar al sistema.")) return;
    const upd = {}; upd["usuarios/" + uid + "/activo"] = activar; upd["usuarios_bloqueados/" + uid] = activar ? null : true;
    await db.ref().update(upd);
    db.ref("auditoria_usuarios").push({ accion: activar ? "Activado" : "Desactivado", usuario_afectado: u.email, por: usuarioActual(), fecha: new Date().toISOString() });
};
window.resetearClave = async function (email) {
    if (!email) return;
    try { await auth.sendPasswordResetEmail(email); alert("Se envió a " + email + " un correo para que elija una nueva contraseña (revise también la carpeta Spam)."); }
    catch (e) { alert("No se pudo enviar: " + e.message); }
};
window.aprobarSolicitud = async function (uid) {
    const s = solicitudesGlobal[uid]; const rol = document.getElementById("sol-rol-" + uid).value;
    await db.ref("usuarios/" + uid).set({ email: s.email, nombre: s.email.split("@")[0], rol: rol, activo: true, creado: new Date().toISOString(), creado_por: usuarioActual() });
    await db.ref("usuarios_solicitudes/" + uid).remove();
    mostrarToast("Usuario aprobado", s.email + " ya puede entrar (debe volver a iniciar sesión).");
};
// Crear usuario nuevo SIN cerrar la sesión del administrador (usa una segunda conexión)
window.crearUsuario = async function () {
    const nombre = document.getElementById('nu-nombre').value.trim(), email = document.getElementById('nu-email').value.trim().toLowerCase();
    const clave = document.getElementById('nu-clave').value, rol = document.getElementById('nu-rol').value;
    const msg = document.getElementById('nu-msg');
    if (!nombre || !email) return alert("Escriba nombre y correo");
    if (clave.length < 6) return alert("La contraseña temporal debe tener al menos 6 caracteres");
    msg.innerText = "Creando...";
    let app2;
    try {
        app2 = firebase.apps.find(a => a.name === "altaUsuarios") || firebase.initializeApp(firebaseConfig, "altaUsuarios");
        const cred = await app2.auth().createUserWithEmailAndPassword(email, clave);
        const uid = cred.user.uid;
        await app2.auth().signOut();
        await db.ref("usuarios/" + uid).set({ email: email, nombre: nombre, rol: rol, activo: true, creado: new Date().toISOString(), creado_por: usuarioActual() });
        db.ref("auditoria_usuarios").push({ accion: "Creado con rol " + rol, usuario_afectado: email, por: usuarioActual(), fecha: new Date().toISOString() });
        ['nu-nombre', 'nu-email', 'nu-clave'].forEach(id => document.getElementById(id).value = "");
        msg.innerHTML = "✔ Usuario creado. Anote y entregue estos datos:<br><b>Correo:</b> " + esc(email) + "<br><b>Contraseña:</b> <code style=\"font-size:1.1em; background:#F1F5F9; padding:2px 6px;\">" + esc(clave) + "</code>";
    } catch (e) {
        const t = { "auth/email-already-in-use": "Ese correo ya tiene cuenta. Pídale que entre al LIS una vez: aparecerá abajo en 'Solicitudes pendientes' para aprobarlo.", "auth/invalid-email": "Correo no válido.", "auth/weak-password": "Contraseña muy débil (mínimo 6)." };
        msg.innerText = "✖ " + (t[e.code] || e.message);
    }
};
window.generarClaveTemporal = function () {
    const c = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; let x = "";
    const r = crypto.getRandomValues(new Uint32Array(10)); r.forEach(n => x += c[n % c.length]);
    document.getElementById('nu-clave').value = x; document.getElementById('nu-clave').type = "text";
};

// ---------- Permisos: se revisan también en el código, no solo ocultando botones ----------
(function () {
    const envolver = (nombres, permitido, texto) => nombres.forEach(n => {
        const original = window[n]; if (typeof original !== "function") return;
        window[n] = function () {
            if (!permitido.apply(this, arguments)) { mostrarToast("Sin permiso", texto); return; }
            return original.apply(this, arguments);
        };
    });
    envolver(["validarPruebas", "validarSeleccionados", "validarArea", "validarYGenerarPDF", "revertirValidacion", "rechazarMuestra", "restaurarRechazado", "borrarRegistroLIS"],
        () => puedeValidar(), "Solo un Bioquímico o el Administrador puede validar, rechazar o revertir.");
    envolver(["descargarSoloPDF"], function (forzar) { return !forzar || puedeValidar(); }, "Solo un Bioquímico o el Administrador puede validar.");
    envolver(["guardarPerfilLab", "guardarSeguro", "guardarPrueba", "guardarReferencia", "guardarConfigEntrega", "cambiarDiasVentana"],
        () => esAdmin(), "Solo el Administrador puede cambiar la configuración.");
    envolver(["guardarInventario", "eliminarInventario"], () => miRol === "admin" || miRol === "bioquimico", "Su rol no puede modificar el inventario.");
})();

window.quitarUsuario = async function (uid) {
    const u = usuariosGlobal[uid] || {};
    if (!confirm("¿Quitar a " + (u.nombre || u.email) + " de la lista? Quedará bloqueado. (Para borrar la cuenta del todo: Firebase → Authentication.)")) return;
    const upd = {}; upd["usuarios/" + uid] = null; upd["usuarios_bloqueados/" + uid] = true;
    await db.ref().update(upd);
    db.ref("auditoria_usuarios").push({ accion: "Quitado de la lista", usuario_afectado: u.email || uid, por: usuarioActual(), fecha: new Date().toISOString() });
};

window.reclamarPropietario = async function () {
    if (!confirm("¿Marcar SU cuenta (" + usuarioActual() + ") como Propietario del sistema?\n\nEl Propietario no puede ser desactivado ni cambiado por otros administradores. Esto se hace una sola vez.")) return;
    try { await db.ref("propietario_uid").set(auth.currentUser.uid); mostrarToast("👑 Propietario", "Su cuenta quedó protegida."); }
    catch (e) { alert("No se pudo: " + e.message + "\n\n¿Ya publicó las reglas nuevas de Firebase?"); }
};
