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

auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('login-screen').style.display = 'none';
        iniciarListeners();
    } else {
        document.getElementById('login-screen').style.display = 'flex';
        detenerListeners();
    }
});

function iniciarSesion() {
    const err = document.getElementById('login-error');
    err.style.display = 'none';
    auth.signInWithEmailAndPassword(document.getElementById('login-email').value.trim(), document.getElementById('login-pass').value)
        .catch(error => {
            err.innerText = (error.code === "auth/network-request-failed") ? "Sin conexión a internet." : "Correo o contraseña incorrectos.";
            err.style.display = 'block';
        });
}
document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') iniciarSesion(); });
function cerrarSesion() { auth.signOut(); }
setInterval(() => { document.getElementById('reloj').innerText = new Date().toLocaleString(); }, 1000);

function switchView(viewId, element) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
    if (element) element.classList.add('active');

    if (viewId === 'estadisticas') {
        const hoy = new Date();
        document.getElementById('filtro-fecha-inicio').value = fechaLocalISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
        document.getElementById('filtro-fecha-fin').value = fechaLocalISO(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
        calcularEstadisticas();
    }
}

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

    db.ref("ordenes_pendientes").on("value", snap => { ordenesGlobales = snap.val() || {}; renderizarBandeja(); });

    db.ref("resultados").on("value", snapshot => {
        datosGlobales = snapshot.val() || {};
        if (!primeraCarga) {
            Object.keys(datosGlobales).forEach(key => {
                if (!keysAnteriores.has(key)) {
                    const r = datosGlobales[key];
                    agregarNotificacion(key, nombreDeResultado(r).nombre, r.muestra);
                }
            });
        }
        keysAnteriores = new Set(Object.keys(datosGlobales)); primeraCarga = false;
        renderizarBandeja();
        if (pacienteSeleccionadoId && datosGlobales[pacienteSeleccionadoId]) mostrarDetalle(pacienteSeleccionadoId);
        if (document.getElementById('view-estadisticas').classList.contains('active')) calcularEstadisticas();
    });

    db.ref("inventario").on("value", snapshot => { inventarioGlobal = snapshot.val() || {}; renderizarInventario(); });
}
function detenerListeners() {
    if (!listenersActivos) return;
    ["configuracion", "ordenes_pendientes", "resultados", "inventario"].forEach(r => db.ref(r).off());
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
                "<td><span style=\"color: " + colorEstado + "; font-weight: bold;\">" + estadoVisual + "</span></td>" +
                "<td><button onclick=\"cargarExamenesDesdeHistorial(" + jsArg(o.id_muestra) + ")\" style=\"background: #E0F2FE; color: var(--aes-blue); border: 1px solid var(--aes-blue); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: bold;\" title=\"Repetir estas pruebas\">🔄 Repetir</button></td></tr>";
        });
        tabla.innerHTML = h;
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
    const o = ordenesGlobales[r.muestra];
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
    Object.keys(datosGlobales).reverse().forEach(key => {
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
        "<div class=\"entrega-fila\"><span>✉️ Correo " + esc(c.correo ? "(" + c.correo + ")" : "(sin correo)") + "</span><b>" + f(e.correo) + "</b></div>";
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
        const res = await fetch(WEBHOOK_AUTOPEDIDO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error("Make respondió " + res.status);
        await db.ref("resultados/" + key + "/entregas/correo").set(new Date().toISOString());
        await registrarAuditoria(key, "Enviado por correo", correo);
        mostrarToast("Correo enviado", correo);
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

function guardarConfigEntrega() {
    configEntrega.auto_correo = document.getElementById('conf-auto-correo').checked;
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
    const chk = document.getElementById('conf-auto-correo'); if (chk) chk.checked = !!configEntrega.auto_correo;
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
function resultadosEnRango() {
    const ini = document.getElementById('filtro-fecha-inicio').value, fin = document.getElementById('filtro-fecha-fin').value;
    const fInicio = new Date(ini + "T00:00:00"); const fFin = new Date(fin + "T23:59:59");
    const out = [];
    Object.keys(datosGlobales).forEach(key => {
        const r = datosGlobales[key]; if (r.estado === "Rechazado") return;
        const f = fechaDeResultado(r);
        if (f && f >= fInicio && f <= fFin) out.push({ key: key, r: r, fecha: f });
    });
    return out;
}
window.calcularEstadisticas = function () {
    if (!document.getElementById('filtro-fecha-inicio').value || !document.getElementById('filtro-fecha-fin').value) return alert("Seleccione el rango de fechas");
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
    fetch(WEBHOOK_AUTOPEDIDO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(res => {
            if (!res.ok) throw new Error("Make respondió " + res.status);
            // Solo se marca la fecha si el envío salió bien
            db.ref("inventario/" + codigo + "/ultimo_pedido").set(hoyStr);
            mostrarToast("Auto-Pedido enviado", item.nombre);
        })
        .catch(e => { console.error(e); alert("⚠️ No se pudo enviar el auto-pedido de " + item.nombre + ".\nRevise la conexión o el escenario de Make.\n\nDetalle: " + e.message); });
}
