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

auth.onAuthStateChanged(user => {
    if (user) document.getElementById('login-screen').style.display = 'none';
    else document.getElementById('login-screen').style.display = 'flex';
});

function iniciarSesion() {
    auth.signInWithEmailAndPassword(document.getElementById('login-email').value, document.getElementById('login-pass').value)
    .catch(error => { document.getElementById('login-error').style.display = 'block'; });
}
function cerrarSesion() { auth.signOut(); }
setInterval(() => { document.getElementById('reloj').innerText = new Date().toLocaleString(); }, 1000);

function switchView(viewId, element) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
    if(element) element.classList.add('active');
}

// === CEREBRO AUTÓNOMO: CONFIGURACIÓN DINÁMICA ===
let configSeguros = {}; let configPrecios = {};

db.ref("configuracion").on("value", snapshot => {
    if (snapshot.exists()) {
        const data = snapshot.val();
        configSeguros = data.seguros || { "Particular": 0 }; 
        configPrecios = data.precios || { "GLU": 25, "HEMO": 60 };
        renderizarConfiguracion(); actualizarSelectSeguros();
    } else {
        db.ref("configuracion").set({ seguros: { "Particular": 0 }, precios: { "GLU": 25 } });
    }
});

function guardarSeguro() {
    const nombre = document.getElementById('conf-seguro-nombre').value.trim();
    const desc = parseFloat(document.getElementById('conf-seguro-desc').value);
    if (!nombre || isNaN(desc)) return alert("Llene los datos");
    db.ref(`configuracion/seguros/${nombre}`).set(desc);
    document.getElementById('conf-seguro-nombre').value = ''; document.getElementById('conf-seguro-desc').value = '';
    mostrarToast("Sistema", `Seguro guardado.`);
}
function eliminarSeguro(nombre) {
    if(nombre === "Particular") return alert("No borrable.");
    if(confirm(`¿Borrar ${nombre}?`)) db.ref(`configuracion/seguros/${nombre}`).remove();
}
function guardarPrueba() {
    const id = document.getElementById('conf-prueba-id').value.trim().toUpperCase();
    const precio = parseFloat(document.getElementById('conf-prueba-precio').value);
    if (!id || isNaN(precio)) return alert("Llene los datos");
    db.ref(`configuracion/precios/${id}`).set(precio);
    document.getElementById('conf-prueba-id').value = ''; document.getElementById('conf-prueba-precio').value = '';
    mostrarToast("Sistema", `Precio actualizado.`);
}
function eliminarPrueba(id) { if(confirm(`¿Borrar ${id}?`)) db.ref(`configuracion/precios/${id}`).remove(); }

function renderizarConfiguracion() {
    const tablaS = document.getElementById('tabla-conf-seguros'); tablaS.innerHTML = "";
    Object.keys(configSeguros).forEach(nombre => { tablaS.innerHTML += `<tr><td>${nombre}</td><td>${configSeguros[nombre]}%</td><td><button onclick="eliminarSeguro('${nombre}')" style="color:red; background:none; border:none; cursor:pointer;">🗑️</button></td></tr>`; });
    const tablaP = document.getElementById('tabla-conf-pruebas'); tablaP.innerHTML = "";
    Object.keys(configPrecios).forEach(id => { tablaP.innerHTML += `<tr><td><strong>${id}</strong></td><td>${configPrecios[id]} Bs</td><td><button onclick="eliminarPrueba('${id}')" style="color:red; background:none; border:none; cursor:pointer;">🗑️</button></td></tr>`; });
}

function actualizarSelectSeguros() {
    const select = document.getElementById('seguro-paciente'); select.innerHTML = "";
    Object.keys(configSeguros).forEach(nombre => { select.innerHTML += `<option value="${nombre}">${nombre} (${configSeguros[nombre]}% Desc.)</option>`; });
}

// === ADMISIÓN ===
let pruebasSeleccionadas = new Set(); let preciosModificados = {}; 
const catalogoPruebas = {
    quimica: [ { id: "GLU", nombre: "Glucosa" }, { id: "UREA", nombre: "Urea" }, { id: "BUN", nombre: "Nitrógeno Ureico" }, { id: "CREA", nombre: "Creatinina" }, { id: "URI", nombre: "Ácido Úrico" }, { id: "COL", nombre: "Colesterol Total" }, { id: "TRIG", nombre: "Triglicéridos" }, { id: "HDL", nombre: "Colesterol HDL" }, { id: "LDL", nombre: "Colesterol LDL" }, { id: "VLDL", nombre: "Colesterol VLDL" }, { id: "AST", nombre: "AST / GOT" }, { id: "ALT", nombre: "ALT / GPT" }, { id: "ALP", nombre: "Fosfatasa Alcalina" } ],
    inmunologia: [ { id: "TSH", nombre: "Hormona TSH" }, { id: "FT4", nombre: "T4 Libre" }, { id: "FT3", nombre: "T3 Libre" } ],
    infecciosas: [ { id: "HIV", nombre: "VIH Ag/Ab Combo" }, { id: "HBSAG", nombre: "Antígeno de Sup. Hep B" } ],
    marcadores: [ { id: "PSA", nombre: "PSA Total" }, { id: "CEA", nombre: "Antígeno Carcinoembrionario" }, { id: "CA125", nombre: "CA 125 (Ovario)" }, { id: "CA153", nombre: "CA 15-3 (Mama)" } ],
    hematologia: [ { id: "HEMO", nombre: "Hemograma Completo" }, { id: "VSG", nombre: "Velocidad de Sedimentación" }, { id: "HGB", nombre: "Hemoglobina" }, { id: "HCT", nombre: "Hematocrito" }, { id: "VCM", nombre: "Índices Eritrocitarios" } ],
    coagulacion: [ { id: "TP", nombre: "Tiempo de Protrombina" }, { id: "INR", nombre: "INR" } ]
};
const nombresCategorias = { quimica: "🧪 Química", inmunologia: "🧬 Inmunología", infecciosas: "🦠 Infecciosas", marcadores: "🎗️ Marcadores", hematologia: "🩸 Hematología", coagulacion: "⏱️ Coagulación" };

function abrirModal(categoria) {
    document.getElementById('modal-titulo').innerText = nombresCategorias[categoria];
    const grid = document.getElementById('modal-grid'); grid.innerHTML = ""; 
    catalogoPruebas[categoria].forEach(prueba => {
        const isSelected = pruebasSeleccionadas.has(prueba.id);
        const card = document.createElement('div'); card.className = `test-card ${isSelected ? 'selected' : ''}`;
        card.onclick = () => togglePrueba(card, prueba.id);
        card.innerHTML = `<div class="test-code">${prueba.id}</div><div class="test-name">${prueba.nombre}</div>`;
        grid.appendChild(card);
    });
    document.getElementById('modal-pruebas').style.display = 'flex';
}
function togglePrueba(cardElement, idPrueba) {
    if (pruebasSeleccionadas.has(idPrueba)) { pruebasSeleccionadas.delete(idPrueba); cardElement.classList.remove('selected'); delete preciosModificados[idPrueba]; } 
    else { pruebasSeleccionadas.add(idPrueba); cardElement.classList.add('selected'); }
}
function cerrarModal() { document.getElementById('modal-pruebas').style.display = 'none'; actualizarCotizacion(); }

function editarPrecioManual(idPrueba) {
    let precioBaseDB = configPrecios[idPrueba] || 50;
    let precioActual = preciosModificados[idPrueba] !== undefined ? preciosModificados[idPrueba] : precioBaseDB;
    let nuevoPrecio = prompt(`✏️ Editar precio para ${idPrueba} (Bs):`, precioActual);
    if(nuevoPrecio !== null && !isNaN(nuevoPrecio)) { preciosModificados[idPrueba] = parseFloat(nuevoPrecio); actualizarCotizacion(); }
}

function actualizarCotizacion() {
    const panel = document.getElementById('panel-cotizacion'); const lista = document.getElementById('lista-precios');
    if(pruebasSeleccionadas.size === 0) { panel.style.display = "none"; return; }
    panel.style.display = "block"; lista.innerHTML = ""; let subtotal = 0;
    pruebasSeleccionadas.forEach(id => {
        let precio = preciosModificados[id] !== undefined ? preciosModificados[id] : (configPrecios[id] || 50);
        subtotal += precio;
        lista.innerHTML += `<tr><td><strong>${id}</strong></td><td>${precio.toFixed(2)}</td><td><button class="btn-edit-price" onclick="editarPrecioManual('${id}')">✏️</button></td></tr>`;
    });
    const desc = (configSeguros[document.getElementById('seguro-paciente').value] || 0) / 100;
    const descMonto = subtotal * desc; const total = subtotal - descMonto;
    document.getElementById('lbl-subtotal').innerText = `${subtotal.toFixed(2)} Bs`; document.getElementById('lbl-descuento').innerText = `- ${descMonto.toFixed(2)} Bs`; document.getElementById('lbl-total').innerText = `${total.toFixed(2)} Bs`;
}

function buscarPaciente() {
    const ci = document.getElementById('ci').value.trim(); if(!ci) return alert("Ingrese un CI.");
    db.ref("pacientes/" + ci).once("value").then(snapshot => {
        if (snapshot.exists()) {
            document.getElementById('nombre').value = snapshot.val().nombre; document.getElementById('fecha_nac').value = snapshot.val().fecha_nac;
            buscarHistorial(ci);
        } else { alert("Paciente nuevo."); document.getElementById('nombre').value = ""; document.getElementById('panel-historial').style.display = "none"; }
    });
}
function buscarHistorial(ci) {
    const tabla = document.getElementById('tabla-historial'); tabla.innerHTML = ""; 
    db.ref("ordenes_pendientes").orderByChild("ci_paciente").equalTo(ci).once("value", snapshot => {
        if(snapshot.exists()) {
            document.getElementById('panel-historial').style.display = "block";
            snapshot.forEach(hijo => { const o = hijo.val(); tabla.insertAdjacentHTML("afterbegin", `<tr><td>${new Date(o.fecha_creacion).toLocaleDateString()}</td><td>${o.medico||'N/A'}</td><td><strong>${o.examenes?o.examenes.join(", "):""}</strong></td><td><span style="color: var(--aes-blue); font-weight: bold;">${o.estado}</span></td></tr>`); });
        }
    });
}

function generarOrden() {
    const ci = document.getElementById('ci').value.trim(); const nombre = document.getElementById('nombre').value.trim();
    if(!ci || !nombre) return alert("CI y Nombre obligatorios.");
    if(pruebasSeleccionadas.size === 0) return alert("Seleccione exámenes.");
    db.ref("pacientes/" + ci).set({ nombre: nombre, fecha_nac: document.getElementById('fecha_nac').value, genero: document.getElementById('genero').value, ultima_visita: new Date().toISOString() });
    
    const examenesArray = Array.from(pruebasSeleccionadas);
    const idMuestra = `${new Date().toISOString().slice(2,10).replace(/-/g,"")}${Math.floor(1000 + Math.random() * 9000)}`;
    const seguroSelect = document.getElementById('seguro-paciente').options[document.getElementById('seguro-paciente').selectedIndex].text;
    
    db.ref("ordenes_pendientes/" + idMuestra).set({
        id_muestra: idMuestra, ci_paciente: ci, nombre_paciente: nombre, medico: document.getElementById('medico').value.trim(),
        examenes: examenesArray, seguro: seguroSelect, total_cobrado: document.getElementById('lbl-total').innerText, estado: "Pendiente", fecha_creacion: new Date().toISOString()
    }).then(() => {
        document.getElementById('lbl-paciente-etiqueta').innerText = `${nombre} | CI: ${ci}\nSeguro: ${seguroSelect}\nExámenes: ${examenesArray.join(", ")}`;
        document.getElementById('barcode-panel').style.display = "block";
        JsBarcode("#barcode", idMuestra, { format: "CODE128", width: 2, height: 50, displayValue: true, fontSize: 16, fontOptions: "bold" });
        pruebasSeleccionadas.clear(); preciosModificados = {}; actualizarCotizacion(); document.getElementById('medico').value = ""; buscarHistorial(ci);
    });
}

// === VALIDACIÓN CRÚZADA Y NOTIFICACIONES ===
let datosGlobales = {}; let ordenesGlobales = {}; let pacienteSeleccionadoId = null; let filtroActual = "Pendientes";
let notificacionesPendientes = []; let unreadCount = 0; let keysAnteriores = new Set(); let primeraCarga = true;

const diccionarioLIS = {
    "QUÍMICA SANGUÍNEA Y ENZIMAS": ["GLU", "UREA", "BUN", "CREA", "URI", "COL", "TRIG", "HDL", "LDL", "VLDL", "AST", "ALT", "ALP"],
    "INMUNOLOGÍA Y HORMONAS": ["TSH", "FT4", "FT3", "T4", "T3", "FSH", "LH", "PRL", "E2"],
    "SEROLOGÍA E INFECCIOSAS": ["HBSAG", "HCV", "HIV"],
    "MARCADORES TUMORALES": ["PSA", "CEA", "CA125", "CA153"],
    "HEMATOLOGÍA Y COAGULACIÓN": ["HEMO", "VSG", "HGB", "HCT", "VCM", "TP", "INR"]
};
function obtenerInfoPrueba(prueba) {
    let cat = "OTROS EXÁMENES DE LABORATORIO";
    for (const [c, lista] of Object.entries(diccionarioLIS)) { if (lista.includes(prueba.toUpperCase())) { cat = c; break; } }
    return { cat: cat, ref: "Referencia según inserto" };
}

// Escuchar Órdenes (Para cruzar datos)
db.ref("ordenes_pendientes").on("value", snap => { if(snap.exists()) { ordenesGlobales = snap.val(); renderizarBandeja(); } });

// Escuchar Resultados (El motor principal)
db.ref("resultados").on("value", snapshot => {
    if (snapshot.exists()) { 
        datosGlobales = snapshot.val(); 
        if (!primeraCarga) {
            Object.keys(datosGlobales).forEach(key => {
                if (!keysAnteriores.has(key)) {
                    const r = datosGlobales[key];
                    // Cruzar nombre real
                    let nombreReal = r.paciente;
                    if (ordenesGlobales[r.muestra]) nombreReal = ordenesGlobales[r.muestra].nombre_paciente;
                    else if (!nombreReal || nombreReal === "Paciente Desconocido") nombreReal = "Paciente No Registrado (Huérfano)";
                    
                    agregarNotificacion(key, nombreReal, r.muestra);
                }
            });
        }
        keysAnteriores = new Set(Object.keys(datosGlobales)); primeraCarga = false;
        renderizarBandeja(); 
    } else { datosGlobales = {}; renderizarBandeja(); }
});

// === MOTOR DE CAMPANA Y TOAST ===
function agregarNotificacion(key, nombre, tubo) {
    unreadCount++;
    notificacionesPendientes.unshift({ key: key, nombre: nombre, tubo: tubo, leido: false });
    actualizarCampanaUI();
    mostrarToast("Nuevos Resultados", `${nombre} (Tubo: ${tubo})`);
}

function actualizarCampanaUI() {
    const badge = document.getElementById('campana-badge');
    if(unreadCount > 0) { badge.style.display = 'block'; badge.innerText = unreadCount; } else { badge.style.display = 'none'; }
    
    const lista = document.getElementById('notif-lista');
    if(notificacionesPendientes.length === 0) { lista.innerHTML = `<div style="padding: 20px; text-align: center; color: #888; font-size: 0.85rem;">No hay notificaciones nuevas</div>`; return; }
    
    lista.innerHTML = "";
    notificacionesPendientes.forEach(n => {
        lista.innerHTML += `
            <div class="notif-item ${n.leido ? '' : 'unread'}" onclick="abrirDesdeNotificacion('${n.key}')">
                <div class="notif-title">${n.nombre}</div>
                <div class="notif-desc">Tubo: <strong>${n.tubo}</strong></div>
            </div>
        `;
    });
}

function toggleNotificaciones() {
    const dropdown = document.getElementById('notif-dropdown');
    dropdown.classList.toggle('active');
}

function marcarTodasLeidas(e) {
    e.stopPropagation();
    notificacionesPendientes.forEach(n => n.leido = true);
    unreadCount = 0; actualizarCampanaUI();
}

function abrirDesdeNotificacion(key) {
    document.getElementById('notif-dropdown').classList.remove('active');
    // Marcar como leída
    const noti = notificacionesPendientes.find(n => n.key === key);
    if(noti && !noti.leido) { noti.leido = true; unreadCount = Math.max(0, unreadCount - 1); actualizarCampanaUI(); }
    
    // Ir a la pestaña validación y abrir paciente
    switchView('validacion', document.querySelectorAll('.nav-item')[1]);
    cambiarFiltroBandeja(datosGlobales[key].estado === "Validado_Final" ? "Validados" : "Pendientes");
    setTimeout(() => mostrarDetalle(key), 100);
}

function mostrarToast(titulo, desc) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div'); toast.className = 'toast';
    toast.innerHTML = `<div style="font-size: 1.8rem;">🔔</div><div><div style="font-weight: 800; color: var(--aes-dark);">${titulo}</div><div style="color: var(--aes-blue); font-size: 0.85rem; font-weight: bold; margin-top:2px;">${desc}</div></div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 500); }, 5000);
}

// === RENDERIZADO CRUZADO DE LA BANDEJA ===
function cambiarFiltroBandeja(nuevoFiltro) {
    filtroActual = nuevoFiltro;
    document.getElementById('btn-filtro-pendientes').classList.remove('active'); document.getElementById('btn-filtro-validados').classList.remove('active');
    document.getElementById(filtroActual === "Pendientes" ? 'btn-filtro-pendientes' : 'btn-filtro-validados').classList.add('active');
    document.getElementById("estado-vacio").style.display = "flex"; document.getElementById("contenedor-resultados").style.display = "none";
    pacienteSeleccionadoId = null; renderizarBandeja();
}

function renderizarBandeja() {
    const lista = document.getElementById("lista-pacientes"); lista.innerHTML = ""; let keysMostradas = 0;
    Object.keys(datosGlobales).reverse().forEach(key => {
        const r = datosGlobales[key];
        const estaValidado = (r.estado === "Validado_Final");
        
        if ((filtroActual === "Pendientes" && !estaValidado) || (filtroActual === "Validados" && estaValidado)) {
            keysMostradas++;
            
            // MAGIA DE CRUCE DE DATOS
            let nombreReal = r.paciente;
            let esHuerfano = true;
            if (ordenesGlobales[r.muestra]) {
                nombreReal = ordenesGlobales[r.muestra].nombre_paciente;
                esHuerfano = false;
            } else if (r.paciente && r.paciente !== "Paciente Desconocido") {
                nombreReal = r.paciente; // Si el analizador mandó un nombre útil
            }

            const pacienteName = esHuerfano ? "⚠️ Sin Orden" : nombreReal;
            const estiloNombre = esHuerfano ? "color: #DC2626; font-style: italic;" : "";
            const badgeHuerfano = esHuerfano ? `<span style="background: #FEE2E2; color: #DC2626; padding: 3px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; margin-bottom: 5px; display: inline-block;">⚠️ CREADO EN EQUIPO</span>` : "";

            lista.insertAdjacentHTML('beforeend', `
                 <div class="patient-card-val ${(pacienteSeleccionadoId === key) ? 'active' : ''}" id="card-${key}" style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                     <div style="flex: 1;" onclick="mostrarDetalle('${key}')">
                         ${badgeHuerfano}
                         <div class="patient-name" style="${estiloNombre}; font-size: 0.95rem; font-weight: bold;">${pacienteName}</div>
                         <div class="patient-meta" style="margin-top: 5px;"><span>Tubo: <strong>${r.muestra || "N/A"}</strong></span><span class="status-pill ${estaValidado ? 'val' : 'pend'}">${estaValidado ? '✔ Validado' : 'Pendiente'}</span></div>
                     </div>
                     <button class="btn-delete-card" onclick="borrarRegistroLIS(event, '${key}')">🗑️</button>
                 </div>`);
        }
    });
    if (keysMostradas === 0) lista.innerHTML = `<div style="padding: 30px; text-align: center; color: #888;">No hay informes aquí.</div>`;
}

function mostrarDetalle(key) {
    pacienteSeleccionadoId = key; const r = datosGlobales[key]; const estaValidado = (r.estado === "Validado_Final");
    document.querySelectorAll('.patient-card-val').forEach(el => el.classList.remove('active'));
    document.getElementById(`card-${key}`).classList.add('active');
    document.getElementById("estado-vacio").style.display = "none"; document.getElementById("contenedor-resultados").style.display = "block";

    if(estaValidado) { document.getElementById('botones-pendientes').style.display = "none"; document.getElementById('botones-validados').style.display = "flex"; document.getElementById('badge-estado-visor').innerText = "✔ ARCHIVADO"; } 
    else { document.getElementById('botones-pendientes').style.display = "flex"; document.getElementById('botones-validados').style.display = "none"; document.getElementById('badge-estado-visor').innerText = "Pendiente Firma"; }

    // Cruce de datos para el PDF
    let nombreReal = r.paciente; let esHuerfano = true; let parametrosPedidos = "No registrados";
    if (ordenesGlobales[r.muestra]) {
        nombreReal = ordenesGlobales[r.muestra].nombre_paciente;
        parametrosPedidos = ordenesGlobales[r.muestra].examenes ? ordenesGlobales[r.muestra].examenes.join(", ") : "";
        esHuerfano = false;
    }

    document.getElementById("detalle-nombre").innerText = esHuerfano ? "Paciente de Urgencia (Equipo)" : nombreReal;
    document.getElementById("detalle-muestra").innerText = r.muestra || "N/A";
    document.getElementById("detalle-equipo").innerText = r.equipo || "Analizador LIS";
    document.getElementById("pdf-paciente").innerText = esHuerfano ? "Paciente No Registrado" : nombreReal;
    document.getElementById("pdf-orden").innerText = r.muestra || "N/A";
    document.getElementById("pdf-equipo").innerText = r.equipo || "N/A";
    document.getElementById("pdf-fecha").innerText = r.fecha_validacion ? new Date(r.fecha_validacion).toLocaleString() : new Date().toLocaleString();

    const tablaLIS = document.getElementById("tabla-analitos"); const contPDF = document.getElementById("pdf-resultados-dinamicos");
    tablaLIS.innerHTML = ""; contPDF.innerHTML = "";

    // Agregamos aviso visual si los parámetros difieren (Solo informativo para la web)
    if(!esHuerfano) {
        tablaLIS.insertAdjacentHTML('beforeend', `<tr><td colspan="3" style="background: #FFFBEB; padding: 10px; color: #B45309; font-size: 0.8rem;"><strong>Pruebas Solicitadas en Web:</strong> ${parametrosPedidos}</td></tr>`);
    }

    const resRaw = r.resultados_totales || r.resultados || r.resultaos || "";
    if(resRaw !== "") {
        let arr = {};
        resRaw.split('~').forEach(linea => {
            if(linea.trim() === "") return; 
            const p = linea.split(':'); const n = p[0].trim(); let valU = p.slice(1).join(':').trim(); 
            let vNum = valU; let uStr = ""; const sep = valU.indexOf(' ');
            if(sep > -1) { vNum = valU.substring(0, sep).trim(); uStr = valU.substring(sep).trim(); }
            const info = obtenerInfoPrueba(n);
            if(!arr[info.cat]) arr[info.cat] = [];
            arr[info.cat].push({ n: n, v: vNum, u: uStr, ref: info.ref });
        });

        Object.keys(arr).forEach(cat => {
            tablaLIS.insertAdjacentHTML('beforeend', `<tr style="background: #F3E8FF;"><td colspan="3" style="padding: 10px 20px; font-weight: 800; color: var(--aes-purple); font-size: 0.85rem;">🏷️ ${cat}</td></tr>`);
            let h = `<div class="pdf-banda-color">${cat}</div><table class="pdf-table"><thead><tr><th style="width:30%;">EXAMEN</th><th style="width:20%;">RESULTADO</th><th style="width:20%;">UNIDAD</th><th style="width:30%;">REFERENCIA</th></tr></thead><tbody>`;
            arr[cat].forEach(res => {
                tablaLIS.insertAdjacentHTML('beforeend', `<tr><td style="padding-left: 35px;"><strong>${res.n}</strong></td><td style="font-family: monospace; font-size:1.1rem;">${res.v}</td><td><span class="unit-badge">${res.u || '-'}</span></td></tr>`);
                h += `<tr><td><b>${res.n}</b></td><td style="font-family:monospace; font-size:13px; font-weight:bold;">${res.v}</td><td style="color:#666;">${res.u || '-'}</td><td style="color:#888; font-size:11px;">${res.ref}</td></tr>`;
            });
            h += `</tbody></table>`; contPDF.insertAdjacentHTML('beforeend', h);
        });
    } else { tablaLIS.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px;">Sin resultados</td></tr>`; contPDF.innerHTML = `<p>No hay resultados analíticos disponibles.</p>`; }
}

function descargarSoloPDF(forzarValidacion = false) {
    const btn = document.querySelector(forzarValidacion ? '.btn-validate-pdf' : '.btn-reprint'); const tOriginal = btn.innerHTML; btn.innerHTML = "⏳ Generando...";
    const pw = document.getElementById('pdf-container'); const ep = document.getElementById('plantilla-pdf');
    pw.style.display = 'block'; pw.style.position = 'absolute'; pw.style.zIndex = '-100';
    const opt = { margin: 10, filename: `Informe_AES_${document.getElementById('pdf-paciente').innerText.replace(/\s+/g, '_')}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['avoid-all', 'css', 'legacy'] } };
    html2pdf().set(opt).from(ep).save().then(() => {
        pw.style.display = 'none'; btn.innerHTML = tOriginal;
        if(forzarValidacion) db.ref("resultados/" + pacienteSeleccionadoId).update({ estado: "Validado_Final", fecha_validacion: new Date().toISOString() });
    });
}

function validarYGenerarPDF() { if(pacienteSeleccionadoId && confirm("¿Liberar reporte médico?")) descargarSoloPDF(true); }
function revertirValidacion() { if(pacienteSeleccionadoId && confirm("¿Regresar a Pendientes?")) db.ref("resultados/" + pacienteSeleccionadoId).update({ estado: "Pendiente Validacion" }).then(() => cambiarFiltroBandeja('Pendientes')); }
function rechazarMuestra() { if(pacienteSeleccionadoId && confirm("¿RECHAZAR y ELIMINAR?")) db.ref("resultados/" + pacienteSeleccionadoId).remove().then(() => cambiarFiltroBandeja('Pendientes')); }
function borrarRegistroLIS(event, key) { event.stopPropagation(); if(confirm("¿ELIMINAR permanentemente?")) db.ref("resultados/" + key).remove(); }
