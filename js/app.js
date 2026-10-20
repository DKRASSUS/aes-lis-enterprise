// === LLAVE CORRECTA DE FIREBASE ====
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
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    const errorMsg = document.getElementById('login-error');
    errorMsg.style.display = 'none';
    auth.signInWithEmailAndPassword(email, pass).catch(error => {
        errorMsg.innerText = "Error: " + error.message;
        errorMsg.style.display = 'block';
    });
}
function cerrarSesion() { auth.signOut(); }

setInterval(() => { document.getElementById('reloj').innerText = new Date().toLocaleString(); }, 1000);

function switchView(viewId, element) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
    element.classList.add('active');
}

// === CEREBRO AUTÓNOMO: CONFIGURACIÓN DINÁMICA ===
let configSeguros = {};
let configPrecios = {};

db.ref("configuracion").on("value", snapshot => {
    if (snapshot.exists()) {
        const data = snapshot.val();
        configSeguros = data.seguros || { "Particular": 0 }; 
        configPrecios = data.precios || { "GLU": 25, "HEMO": 60 };
        renderizarConfiguracion();
        actualizarSelectSeguros();
    } else {
        db.ref("configuracion").set({
            seguros: { "Particular": 0, "Nacional Vida": 20 },
            precios: { "GLU": 25, "UREA": 30, "CREA": 35, "HEMO": 60 }
        });
    }
});

function guardarSeguro() {
    const nombre = document.getElementById('conf-seguro-nombre').value.trim();
    const desc = parseFloat(document.getElementById('conf-seguro-desc').value);
    if (!nombre || isNaN(desc)) return alert("Llene los datos del seguro correctamente");
    db.ref(`configuracion/seguros/${nombre}`).set(desc);
    document.getElementById('conf-seguro-nombre').value = '';
    document.getElementById('conf-seguro-desc').value = '';
    mostrarNotificacion("Sistema", `Seguro ${nombre} guardado.`);
}
function eliminarSeguro(nombre) {
    if(nombre === "Particular") return alert("El seguro Particular no se puede borrar.");
    if(confirm(`¿Borrar seguro ${nombre}?`)) db.ref(`configuracion/seguros/${nombre}`).remove();
}

function guardarPrueba() {
    const id = document.getElementById('conf-prueba-id').value.trim().toUpperCase();
    const precio = parseFloat(document.getElementById('conf-prueba-precio').value);
    if (!id || isNaN(precio)) return alert("Llene los datos de la prueba correctamente");
    db.ref(`configuracion/precios/${id}`).set(precio);
    document.getElementById('conf-prueba-id').value = '';
    document.getElementById('conf-prueba-precio').value = '';
    mostrarNotificacion("Sistema", `Precio de ${id} actualizado.`);
}
function eliminarPrueba(id) {
    if(confirm(`¿Borrar precio de ${id}?`)) db.ref(`configuracion/precios/${id}`).remove();
}

function renderizarConfiguracion() {
    const tablaS = document.getElementById('tabla-conf-seguros');
    tablaS.innerHTML = "";
    Object.keys(configSeguros).forEach(nombre => {
        tablaS.innerHTML += `<tr><td>${nombre}</td><td>${configSeguros[nombre]}%</td><td><button onclick="eliminarSeguro('${nombre}')" style="color:red; background:none; border:none; cursor:pointer;">🗑️</button></td></tr>`;
    });

    const tablaP = document.getElementById('tabla-conf-pruebas');
    tablaP.innerHTML = "";
    Object.keys(configPrecios).forEach(id => {
        tablaP.innerHTML += `<tr><td><strong>${id}</strong></td><td>${configPrecios[id]} Bs</td><td><button onclick="eliminarPrueba('${id}')" style="color:red; background:none; border:none; cursor:pointer;">🗑️</button></td></tr>`;
    });
}

function actualizarSelectSeguros() {
    const select = document.getElementById('seguro-paciente');
    select.innerHTML = "";
    Object.keys(configSeguros).forEach(nombre => {
        const desc = configSeguros[nombre];
        select.innerHTML += `<option value="${nombre}">${nombre} (${desc}% Desc.)</option>`;
    });
}

// === LÓGICA DE ADMISIÓN Y COTIZACIÓN ===
let pruebasSeleccionadas = new Set();
let preciosModificados = {}; 

const catalogoPruebas = {
    quimica: [ { id: "GLU", nombre: "Glucosa" }, { id: "UREA", nombre: "Urea" }, { id: "BUN", nombre: "Nitrógeno Ureico" }, { id: "CREA", nombre: "Creatinina" }, { id: "URI", nombre: "Ácido Úrico" }, { id: "COL", nombre: "Colesterol Total" }, { id: "TRIG", nombre: "Triglicéridos" }, { id: "HDL", nombre: "Colesterol HDL" }, { id: "LDL", nombre: "Colesterol LDL" }, { id: "VLDL", nombre: "Colesterol VLDL" }, { id: "LIPA", nombre: "Lipoproteína (a)" }, { id: "APOA1", nombre: "Apolipoproteína A1" }, { id: "APOB", nombre: "Apolipoproteína B" }, { id: "AST", nombre: "AST / GOT" }, { id: "ALT", nombre: "ALT / GPT" }, { id: "ALP", nombre: "Fosfatasa Alcalina" }, { id: "GGT", nombre: "Gamma GT" }, { id: "LDH", nombre: "Lactato Deshidrogenasa" }, { id: "BT", nombre: "Bilirrubina Total" }, { id: "BD", nombre: "Bilirrubina Directa" }, { id: "BI", nombre: "Bilirrubina Indirecta" }, { id: "PT", nombre: "Proteínas Totales" }, { id: "ALB", nombre: "Albúmina" }, { id: "GLOB", nombre: "Globulinas" }, { id: "CA", nombre: "Calcio Total" }, { id: "CAI", nombre: "Calcio Iónico" }, { id: "P", nombre: "Fósforo" }, { id: "MG", nombre: "Magnesio" }, { id: "FE", nombre: "Hierro Sanguíneo" }, { id: "TIBC", nombre: "Capacidad Fijación Fe" }, { id: "NA", nombre: "Sodio (Na+)" }, { id: "K", nombre: "Potasio (K+)" }, { id: "CL", nombre: "Cloro (Cl-)" }, { id: "AMIL", nombre: "Amilasa" }, { id: "LIP", nombre: "Lipasa" }, { id: "HBA1C", nombre: "Hemoglobina A1c" }, { id: "PCR", nombre: "Proteína C Reactiva" }, { id: "ASO", nombre: "Antiestreptolisina O" }, { id: "FR", nombre: "Factor Reumatoide" }, { id: "C3", nombre: "Complemento C3" }, { id: "C4", nombre: "Complemento C4" }, { id: "IGA", nombre: "Inmunoglobulina A" }, { id: "IGG", nombre: "Inmunoglobulina G" }, { id: "IGM", nombre: "Inmunoglobulina M" }, { id: "DIG", nombre: "Digoxina" }, { id: "VAL", nombre: "Ácido Valproico" }, { id: "FEN", nombre: "Fenitoína" }, { id: "CBZ", nombre: "Carbamazepina" } ],
    inmunologia: [ { id: "TSH", nombre: "Hormona TSH" }, { id: "FT4", nombre: "T4 Libre" }, { id: "FT3", nombre: "T3 Libre" }, { id: "T4", nombre: "T4 Total" }, { id: "T3", nombre: "T3 Total" }, { id: "ATPO", nombre: "Anti-TPO" }, { id: "ATG", nombre: "Anti-Tiroglobulina" }, { id: "TRAB", nombre: "Anti-Receptor TSH" }, { id: "FSH", nombre: "Hormona FSH" }, { id: "LH", nombre: "Hormona LH" }, { id: "PRL", nombre: "Prolactina" }, { id: "E2", nombre: "Estradiol" }, { id: "E3", nombre: "Estriol Libre" }, { id: "PRG", nombre: "Progesterona" }, { id: "TESTO", nombre: "Testosterona Total" }, { id: "TESTL", nombre: "Testosterona Libre" }, { id: "SHBG", nombre: "Globulina Fijadora Sex." }, { id: "BHCG", nombre: "Beta-hCG Cuantitativa" }, { id: "AMH", nombre: "Hormona Antimülleriana" }, { id: "CORT", nombre: "Cortisol (Sérico)" }, { id: "ACTH", nombre: "Hormona ACTH" }, { id: "PTH", nombre: "Paratohormona Intacta" }, { id: "INS", nombre: "Insulina" }, { id: "CPEP", nombre: "Péptido C" }, { id: "FERR", nombre: "Ferritina" }, { id: "VITD", nombre: "Vitamina D (25-OH)" }, { id: "VITB12", nombre: "Vitamina B12" }, { id: "FOL", nombre: "Ácido Fólico" }, { id: "TROP", nombre: "Troponina I Alta Sens." }, { id: "PROBNP", nombre: "NT-proBNP" }, { id: "CKMB", nombre: "CK-MB Masa" }, { id: "MYO", nombre: "Mioglobina" }, { id: "PCT", nombre: "Procalcitonina" }, { id: "IGE", nombre: "IgE Total" }, { id: "ANA", nombre: "Anticuerpos ANA" }, { id: "ADN", nombre: "Anti-DNA dc" } ],
    infecciosas: [ { id: "HBSAG", nombre: "Antígeno de Sup. Hep B" }, { id: "AHBS", nombre: "Ac. Anti-HBs" }, { id: "AHBC", nombre: "Ac. Anti-HBc Total" }, { id: "AHBCM", nombre: "Ac. Anti-HBc IgM" }, { id: "HBEAG", nombre: "Antígeno HBe" }, { id: "AHBE", nombre: "Ac. Anti-HBe" }, { id: "HCV", nombre: "Anticuerpos Hep C" }, { id: "HAVM", nombre: "Hep A IgM" }, { id: "HIV", nombre: "VIH Ag/Ab Combo" }, { id: "SYPH", nombre: "Sífilis (Treponema)" }, { id: "CHAGAS", nombre: "Chagas IgG/IgM" }, { id: "TOXOG", nombre: "Toxoplasma IgG" }, { id: "TOXOM", nombre: "Toxoplasma IgM" }, { id: "RUBG", nombre: "Rubéola IgG" }, { id: "RUBM", nombre: "Rubéola IgM" }, { id: "CMVG", nombre: "Citomegalovirus IgG" }, { id: "CMVM", nombre: "Citomegalovirus IgM" }, { id: "HSV1G", nombre: "Herpes I IgG" }, { id: "HSV2G", nombre: "Herpes II IgG" }, { id: "DENG", nombre: "Dengue NS1 Ag" }, { id: "DENGM", nombre: "Dengue IgM" }, { id: "EBVG", nombre: "Epstein-Barr VCA IgG" }, { id: "EBVM", nombre: "Epstein-Barr VCA IgM" }, { id: "HPI", nombre: "Helicobacter pylori IgG" }, { id: "COVG", nombre: "SARS-CoV-2 IgG" }, { id: "COVAG", nombre: "SARS-CoV-2 Antígeno" } ],
    marcadores: [ { id: "PSA", nombre: "PSA Total" }, { id: "PSAL", nombre: "PSA Libre" }, { id: "CEA", nombre: "Antígeno Carcinoembrionario" }, { id: "CA125", nombre: "CA 125 (Ovario)" }, { id: "CA153", nombre: "CA 15-3 (Mama)" }, { id: "CA199", nombre: "CA 19-9 (GI/Páncreas)" }, { id: "AFP", nombre: "Alfa-fetoproteína" }, { id: "B2M", nombre: "Beta-2 Microglobulina" }, { id: "HE4", nombre: "HE4 (Ovario)" }, { id: "CYFRA", nombre: "CYFRA 21-1 (Pulmón)" }, { id: "NSE", nombre: "Enolasa Específica" }, { id: "SCC", nombre: "Antígeno Células Esc." } ],
    hematologia: [ { id: "HEMO", nombre: "Hemograma Completo" }, { id: "VSG", nombre: "Velocidad de Sedimentación" }, { id: "RET", nombre: "Reticulocitos" }, { id: "GS", nombre: "Grupo y Factor Rh" }, { id: "PLA", nombre: "Recuento de Plaquetas" }, { id: "LEU", nombre: "Fórmula Leucocitaria" }, { id: "HGB", nombre: "Hemoglobina" }, { id: "HCT", nombre: "Hematocrito" }, { id: "VCM", nombre: "Índices Eritrocitarios" } ],
    coagulacion: [ { id: "TP", nombre: "Tiempo de Protrombina" }, { id: "INR", nombre: "INR" }, { id: "TTPA", nombre: "Tiempo de Tromboplastina (APTT)" }, { id: "FIB", nombre: "Fibrinógeno" }, { id: "TT", nombre: "Tiempo de Trombina" }, { id: "DDIM", nombre: "Dímero D" }, { id: "VWFAG", nombre: "von Willebrand (Ag)" }, { id: "VWFRC", nombre: "von Willebrand (RCo)" }, { id: "FVIII", nombre: "Factor VIII" }, { id: "FIX", nombre: "Factor IX" }, { id: "FVII", nombre: "Factor VII" }, { id: "FV", nombre: "Factor V" }, { id: "FX", nombre: "Factor X" }, { id: "FXI", nombre: "Factor XI" }, { id: "FXII", nombre: "Factor XII" }, { id: "PC", nombre: "Proteína C (Actividad)" }, { id: "PS", nombre: "Proteína S (Libre)" }, { id: "ATIII", nombre: "Antitrombina III" }, { id: "LA1", nombre: "Anticoagulante Lúpico" }, { id: "AXA", nombre: "Anti-Factor Xa" }, { id: "PLAS", nombre: "Plasminógeno" }, { id: "ACA", nombre: "Anticuerpos Anticardiolipina" } ]
};

const nombresCategorias = { quimica: "🧪 Química Sanguínea", inmunologia: "🧬 Inmunología", infecciosas: "🦠 Infecciosas", marcadores: "🎗️ Marcadores", hematologia: "🩸 Hematología", coagulacion: "⏱️ Coagulación" };

function abrirModal(categoria) {
    document.getElementById('modal-titulo').innerText = nombresCategorias[categoria];
    const grid = document.getElementById('modal-grid');
    grid.innerHTML = ""; 
    catalogoPruebas[categoria].forEach(prueba => {
        const isSelected = pruebasSeleccionadas.has(prueba.id);
        const card = document.createElement('div');
        card.className = `test-card ${isSelected ? 'selected' : ''}`;
        card.onclick = () => togglePrueba(card, prueba.id);
        card.innerHTML = `<div class="test-code">${prueba.id}</div><div class="test-name">${prueba.nombre}</div>`;
        grid.appendChild(card);
    });
    document.getElementById('modal-pruebas').style.display = 'flex';
}

function togglePrueba(cardElement, idPrueba) {
    if (pruebasSeleccionadas.has(idPrueba)) {
        pruebasSeleccionadas.delete(idPrueba);
        cardElement.classList.remove('selected');
        delete preciosModificados[idPrueba];
    } else {
        pruebasSeleccionadas.add(idPrueba);
        cardElement.classList.add('selected');
    }
}

function cerrarModal() { document.getElementById('modal-pruebas').style.display = 'none'; actualizarCotizacion(); }

function editarPrecioManual(idPrueba) {
    let precioBaseDB = configPrecios[idPrueba] || 50;
    let precioActual = preciosModificados[idPrueba] !== undefined ? preciosModificados[idPrueba] : precioBaseDB;
    let nuevoPrecio = prompt(`✏️ Editar precio para ${idPrueba} (Bs):`, precioActual);
    if(nuevoPrecio !== null && !isNaN(nuevoPrecio)) {
        preciosModificados[idPrueba] = parseFloat(nuevoPrecio);
        actualizarCotizacion();
    }
}

function actualizarCotizacion() {
    const panel = document.getElementById('panel-cotizacion');
    const lista = document.getElementById('lista-precios');
    if(pruebasSeleccionadas.size === 0) { panel.style.display = "none"; return; }
    panel.style.display = "block";
    lista.innerHTML = "";
    let subtotal = 0;

    pruebasSeleccionadas.forEach(id => {
        let precioBaseDB = configPrecios[id] || 50;
        let precio = preciosModificados[id] !== undefined ? preciosModificados[id] : precioBaseDB;
        subtotal += precio;
        lista.innerHTML += `<tr><td><strong>${id}</strong></td><td>${precio.toFixed(2)}</td><td><button class="btn-edit-price" onclick="editarPrecioManual('${id}')">✏️</button></td></tr>`;
    });

    const seguroSelect = document.getElementById('seguro-paciente').value;
    const porcentajeDescuento = (configSeguros[seguroSelect] || 0) / 100;
    const descuentoMonto = subtotal * porcentajeDescuento;
    const total = subtotal - descuentoMonto;

    document.getElementById('lbl-subtotal').innerText = `${subtotal.toFixed(2)} Bs`;
    document.getElementById('lbl-descuento').innerText = `- ${descuentoMonto.toFixed(2)} Bs`;
    document.getElementById('lbl-total').innerText = `${total.toFixed(2)} Bs`;
}

function buscarPaciente() {
    const ci = document.getElementById('ci').value.trim();
    if(!ci) return alert("Ingrese un CI.");
    db.ref("pacientes/" + ci).once("value").then(snapshot => {
        if (snapshot.exists()) {
            const datos = snapshot.val();
            document.getElementById('nombre').value = datos.nombre;
            document.getElementById('fecha_nac').value = datos.fecha_nac;
            buscarHistorial(ci);
        } else {
            alert("Paciente nuevo.");
            document.getElementById('nombre').value = "";
            document.getElementById('panel-historial').style.display = "none";
        }
    });
}

function buscarHistorial(ci) {
    const tabla = document.getElementById('tabla-historial');
    tabla.innerHTML = ""; 
    db.ref("ordenes_pendientes").orderByChild("ci_paciente").equalTo(ci).once("value", (snapshot) => {
        if(snapshot.exists()) {
            document.getElementById('panel-historial').style.display = "block";
            snapshot.forEach((hijo) => {
                const orden = hijo.val();
                const fecha = new Date(orden.fecha_creacion).toLocaleDateString();
                const pruebas = orden.examenes ? orden.examenes.join(", ") : "N/A";
                tabla.insertAdjacentHTML("afterbegin", `<tr><td>${fecha}</td><td>${orden.medico || 'N/A'}</td><td><strong>${pruebas}</strong></td><td><span style="color: var(--aes-blue); font-weight: bold;">${orden.estado}</span></td></tr>`);
            });
        }
    });
}

function generarOrden() {
    const ci = document.getElementById('ci').value.trim();
    const nombre = document.getElementById('nombre').value.trim();
    if(!ci || !nombre) return alert("CI y Nombre obligatorios.");
    if(pruebasSeleccionadas.size === 0) return alert("Seleccione exámenes.");
    
    db.ref("pacientes/" + ci).set({ nombre: nombre, fecha_nac: document.getElementById('fecha_nac').value, genero: document.getElementById('genero').value, ultima_visita: new Date().toISOString() });

    const examenesArray = Array.from(pruebasSeleccionadas);
    const idMuestra = `${new Date().toISOString().slice(2,10).replace(/-/g,"")}${Math.floor(1000 + Math.random() * 9000)}`;
    const seguroSelect = document.getElementById('seguro-paciente').options[document.getElementById('seguro-paciente').selectedIndex].text;
    const totalCobrado = document.getElementById('lbl-total').innerText;

    const datosOrden = {
        id_muestra: idMuestra, ci_paciente: ci, nombre_paciente: nombre, medico: document.getElementById('medico').value.trim(),
        examenes: examenesArray, prioridad: document.getElementById('prioridad').value,
        seguro: seguroSelect, total_cobrado: totalCobrado, estado: "Pendiente", fecha_creacion: new Date().toISOString()
    };

    db.ref("ordenes_pendientes/" + idMuestra).set(datosOrden).then(() => {
        document.getElementById('lbl-paciente-etiqueta').innerText = `${nombre} | CI: ${ci}\nSeguro: ${seguroSelect} | Total: ${totalCobrado}\nExámenes: ${examenesArray.join(", ")}`;
        document.getElementById('barcode-panel').style.display = "block";
        JsBarcode("#barcode", idMuestra, { format: "CODE128", lineColor: "#000000", width: 2, height: 50, displayValue: true, fontSize: 16, fontOptions: "bold" });
        pruebasSeleccionadas.clear(); preciosModificados = {}; actualizarCotizacion(); document.getElementById('medico').value = ""; buscarHistorial(ci);
    });
}

// === LÓGICA DE VALIDACIÓN Y PDF ===
let datosGlobales = {}; 
let pacienteSeleccionadoId = null;
let filtroActual = "Pendientes";

const diccionarioLIS = {
    "QUÍMICA SANGUÍNEA Y ENZIMAS": ["GLU", "UREA", "BUN", "CREA", "URI", "COL", "TRIG", "HDL", "LDL", "VLDL", "AST", "ALT", "ALP", "GGT", "LDH", "BT", "BD", "BI", "PT", "ALB", "CA", "P", "MG", "FE", "NA", "K", "CL", "AMIL", "LIP"],
    "INMUNOLOGÍA Y HORMONAS": ["TSH", "FT4", "FT3", "T4", "T3", "FSH", "LH", "PRL", "E2", "PRG", "TESTO", "BHCG", "INS", "CORT", "FERR", "VITD", "VITB12", "FOL"],
    "SEROLOGÍA E INFECCIOSAS": ["HBSAG", "HCV", "HIV", "SYPH", "CHAGAS", "TOXOG", "TOXOM", "DENG"],
    "MARCADORES TUMORALES": ["PSA", "CEA", "CA125", "CA153", "CA199", "AFP"],
    "HEMATOLOGÍA Y COAGULACIÓN": ["HEMO", "VSG", "RET", "TP", "INR", "TTPA", "FIB", "DDIM"]
};

function obtenerInfoPrueba(prueba) {
    let categoriaEncontrada = "OTROS EXÁMENES DE LABORATORIO";
    for (const [cat, lista] of Object.entries(diccionarioLIS)) {
        if (lista.includes(prueba.toUpperCase())) { categoriaEncontrada = cat; break; }
    }
    return { cat: categoriaEncontrada, ref: "Referencia según inserto" };
}

let keysAnteriores = new Set();
let primeraCarga = true;

db.ref("resultados").on("value", snapshot => {
    if (snapshot.exists()) { 
        datosGlobales = snapshot.val(); 
        if (!primeraCarga) {
            Object.keys(datosGlobales).forEach(key => {
                if (!keysAnteriores.has(key)) mostrarNotificacion(datosGlobales[key].paciente || "Paciente Desconocido", datosGlobales[key].muestra || "N/A");
            });
        }
        keysAnteriores = new Set(Object.keys(datosGlobales));
        primeraCarga = false;
        renderizarBandeja(); 
    } else {
        datosGlobales = {};
        renderizarBandeja();
    }
});

function mostrarNotificacion(nombre, tubo) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div'); toast.className = 'toast';
    toast.innerHTML = `<div style="font-size: 1.8rem;">🔔</div><div><div style="font-weight: 800; color: var(--aes-dark);">Nuevos Resultados!</div><div style="color: #666; font-size: 0.8rem;">Tubo ${tubo}</div><div style="color: var(--aes-blue); font-size: 0.85rem; font-weight: bold;">${nombre}</div></div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 500); }, 5000);
}

function cambiarFiltroBandeja(nuevoFiltro) {
    filtroActual = nuevoFiltro;
    document.getElementById('btn-filtro-pendientes').classList.remove('active');
    document.getElementById('btn-filtro-validados').classList.remove('active');
    document.getElementById(filtroActual === "Pendientes" ? 'btn-filtro-pendientes' : 'btn-filtro-validados').classList.add('active');
    document.getElementById("estado-vacio").style.display = "flex";
    document.getElementById("contenedor-resultados").style.display = "none";
    pacienteSeleccionadoId = null;
    renderizarBandeja();
}

function renderizarBandeja() {
    const lista = document.getElementById("lista-pacientes"); lista.innerHTML = "";
    let keysMostradas = 0;
    Object.keys(datosGlobales).reverse().forEach(key => {
        const r = datosGlobales[key];
        const estaValidado = (r.estado === "Validado_Final");
        if ((filtroActual === "Pendientes" && !estaValidado) || (filtroActual === "Validados" && estaValidado)) {
            keysMostradas++;
            const esHuerfano = (!r.paciente || r.paciente === "Paciente Desconocido");
            const pacienteName = esHuerfano ? "⚠️ Creado en Analizador" : r.paciente;
            const estiloNombre = esHuerfano ? "color: #DC2626; font-style: italic;" : "";
            const badgeHuerfano = esHuerfano ? `<span style="background: #FEE2E2; color: #DC2626; padding: 3px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; margin-bottom: 5px; display: inline-block;">⚠️ SIN ORDEN WEB</span>` : "";
            const claseActiva = (pacienteSeleccionadoId === key) ? "active" : "";
            const clasePill = estaValidado ? "val" : "pend";
            const textoPill = estaValidado ? "✔ Validado" : "Pendiente";

            lista.insertAdjacentHTML('beforeend', `
                 <div class="patient-card-val ${claseActiva}" id="card-${key}" style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                     <div style="flex: 1;" onclick="mostrarDetalle('${key}')">
                         ${badgeHuerfano}
                         <div class="patient-name" style="${estiloNombre}">${pacienteName}</div>
                         <div class="patient-meta"><span>Tubo: <strong>${r.muestra || "N/A"}</strong></span><span class="status-pill ${clasePill}">${textoPill}</span></div>
                     </div>
                     <button class="btn-delete-card" onclick="borrarRegistroLIS(event, '${key}')">🗑️</button>
                 </div>`);
        }
    });
    if (keysMostradas === 0) lista.innerHTML = `<div style="padding: 30px; text-align: center; color: #888;">No hay informes aquí.</div>`;
}

function mostrarDetalle(key) {
    pacienteSeleccionadoId = key;
    const registro = datosGlobales[key];
    const estaValidado = (registro.estado === "Validado_Final");
    const esHuerfano = (!registro.paciente || registro.paciente === "Paciente Desconocido");
    
    document.querySelectorAll('.patient-card-val').forEach(el => el.classList.remove('active'));
    document.getElementById(`card-${key}`).classList.add('active');
    document.getElementById("estado-vacio").style.display = "none";
    document.getElementById("contenedor-resultados").style.display = "block";

    if(estaValidado) {
        document.getElementById('botones-pendientes').style.display = "none";
        document.getElementById('botones-validados').style.display = "flex";
        document.getElementById('badge-estado-visor').innerText = "✔ ARCHIVADO";
    } else {
        document.getElementById('botones-pendientes').style.display = "flex";
        document.getElementById('botones-validados').style.display = "none";
        document.getElementById('badge-estado-visor').innerText = "Pendiente Firma";
    }

    document.getElementById("detalle-nombre").innerText = esHuerfano ? "Paciente de Urgencia (Equipo)" : registro.paciente;
    document.getElementById("detalle-muestra").innerText = registro.muestra || "N/A";
    document.getElementById("detalle-equipo").innerText = registro.equipo || "Analizador LIS";

    document.getElementById("pdf-paciente").innerText = esHuerfano ? "Paciente No Registrado" : registro.paciente;
    document.getElementById("pdf-orden").innerText = registro.muestra || "N/A";
    document.getElementById("pdf-equipo").innerText = registro.equipo || "N/A";
    document.getElementById("pdf-fecha").innerText = registro.fecha_validacion ? new Date(registro.fecha_validacion).toLocaleString() : new Date().toLocaleString();

    const tablaLIS = document.getElementById("tabla-analitos");
    const contPDF = document.getElementById("pdf-resultados-dinamicos");
    tablaLIS.innerHTML = ""; contPDF.innerHTML = "";

    const resultadosBrutos = registro.resultados_totales || registro.resultados || registro.resultaos || "";

    if(resultadosBrutos !== "") {
        const lineasAnalitos = resultadosBrutos.split('~');
        let resultadosAgrupados = {};
        
        lineasAnalitos.forEach(linea => {
            if(linea.trim() === "") return; 
            const partes = linea.split(':');
            const nombrePrueba = partes[0].trim();
            let valorUnidad = partes.slice(1).join(':').trim(); 
            let valorNum = valorUnidad; let unidadStr = "";
            const sep = valorUnidad.indexOf(' ');
            if(sep > -1) { valorNum = valorUnidad.substring(0, sep).trim(); unidadStr = valorUnidad.substring(sep).trim(); }

            const infoPrueba = obtenerInfoPrueba(nombrePrueba);
            if(!resultadosAgrupados[infoPrueba.cat]) resultadosAgrupados[infoPrueba.cat] = [];
            resultadosAgrupados[infoPrueba.cat].push({ nombre: nombrePrueba, valor: valorNum, unidad: unidadStr, ref: infoPrueba.ref });
        });

        Object.keys(resultadosAgrupados).forEach(categoria => {
            tablaLIS.insertAdjacentHTML('beforeend', `<tr style="background: #F3E8FF;"><td colspan="3" style="padding: 10px 20px; font-weight: 800; color: var(--aes-purple); font-size: 0.85rem; text-transform: uppercase;">🏷️ ${categoria}</td></tr>`);
            let htmlSeccion = `<div class="pdf-banda-color">${categoria}</div><table class="pdf-table"><thead><tr><th style="width: 30%;">EXAMEN</th><th style="width: 20%;">RESULTADO</th><th style="width: 20%;">UNIDAD</th><th style="width: 30%;">RANGO DE REFERENCIA</th></tr></thead><tbody>`;

            resultadosAgrupados[categoria].forEach(res => {
                tablaLIS.insertAdjacentHTML('beforeend', `<tr><td class="test-name" style="padding-left: 35px;">${res.nombre}</td><td class="test-value">${res.valor}</td><td><span class="unit-badge">${res.unidad || '-'}</span></td></tr>`);
                htmlSeccion += `<tr><td style="font-weight: bold;">${res.nombre}</td><td style="font-family: monospace; font-size: 13px; font-weight: bold;">${res.valor}</td><td style="color: #666;">${res.unidad || '-'}</td><td style="color: #888; font-size: 11px;">${res.ref}</td></tr>`;
            });
            htmlSeccion += `</tbody></table>`;
            contPDF.insertAdjacentHTML('beforeend', htmlSeccion);
        });
    } else {
        tablaLIS.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px;">Sin resultados</td></tr>`;
        contPDF.innerHTML = `<p>No hay resultados analíticos disponibles.</p>`;
    }
}

function descargarSoloPDF(forzarValidacion = false) {
    const btn = document.querySelector(forzarValidacion ? '.btn-validate-pdf' : '.btn-reprint');
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = "⏳ Generando Informe...";

    const pdfWrapper = document.getElementById('pdf-container');
    const elementoPlantilla = document.getElementById('plantilla-pdf');
    
    pdfWrapper.style.display = 'block'; pdfWrapper.style.position = 'absolute'; pdfWrapper.style.zIndex = '-100';

    const opt = { margin: 10, filename: `Informe_AES_${document.getElementById('pdf-paciente').innerText.replace(/\s+/g, '_')}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['avoid-all', 'css', 'legacy'] } };

    html2pdf().set(opt).from(elementoPlantilla).save().then(() => {
        pdfWrapper.style.display = 'none'; btn.innerHTML = textoOriginal;
        if(forzarValidacion) {
            db.ref("resultados/" + pacienteSeleccionadoId).update({ estado: "Validado_Final", fecha_validacion: new Date().toISOString() }).then(() => { alert(`Informe descargado y archivado.`); });
        }
    });
}

function validarYGenerarPDF() { if(pacienteSeleccionadoId && confirm("¿Liberar reporte médico?")) descargarSoloPDF(true); }
function revertirValidacion() { if(pacienteSeleccionadoId && confirm("¿Regresar a Pendientes?")) db.ref("resultados/" + pacienteSeleccionadoId).update({ estado: "Pendiente Validacion" }).then(() => { document.getElementById("estado-vacio").style.display = "flex"; document.getElementById("contenedor-resultados").style.display = "none"; pacienteSeleccionadoId = null; }); }
function rechazarMuestra() { if(pacienteSeleccionadoId && confirm("¿RECHAZAR y ELIMINAR?")) db.ref("resultados/" + pacienteSeleccionadoId).remove().then(() => { document.getElementById("estado-vacio").style.display = "flex"; document.getElementById("contenedor-resultados").style.display = "none"; pacienteSeleccionadoId = null; }); }
function borrarRegistroLIS(event, key) { event.stopPropagation(); if(confirm("¿ELIMINAR registro permanentemente?")) db.ref("resultados/" + key).remove().then(() => { if(pacienteSeleccionadoId === key) { document.getElementById("estado-vacio").style.display = "flex"; document.getElementById("contenedor-resultados").style.display = "none"; pacienteSeleccionadoId = null; } }); }
