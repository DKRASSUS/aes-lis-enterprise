// =====================================================================
//  AES - PORTAL DEL PACIENTE
//  El paciente entra con (enlace + código) o (CI + código).
//  Los informes están cifrados: se descifran aquí, en su celular/PC.
// =====================================================================
firebase.initializeApp({
    apiKey: "AIzaSyBLuIk-gKICLWlLSdWNAsnVYPXxqvroijI",
    authDomain: "lis-aes.firebaseapp.com",
    databaseURL: "https://lis-aes-default-rtdb.firebaseio.com",
    projectId: "lis-aes"
});
const db = firebase.database();
const esc = AESInforme.esc;
const params = new URLSearchParams(location.search);
let tokenURL = (params.get("t") || "").replace(/[^a-z0-9]/gi, "");
let informes = [];   // [{key, fecha, d}]
let actual = null;

// Encabezado con el nombre del laboratorio
db.ref("portal_publico/laboratorio").once("value").then(s => {
    const l = s.val(); if (!l) return;
    if (l.nombre) { document.getElementById("lab-nombre").innerText = l.nombre; document.title = "Resultados - " + l.nombre; }
    const c = [l.direccion, l.telefono].filter(Boolean).join(" · ");
    if (c) document.getElementById("lab-contacto").innerText = c;
}).catch(() => { });

if (tokenURL) {
    document.getElementById("campo-ci").style.display = "none";
    document.getElementById("acceso-sub").innerText = "Ingrese el código de acceso de 6 caracteres que le entregó el laboratorio.";
    document.getElementById("btn-usar-ci").style.display = "inline-block";
    setTimeout(() => document.getElementById("pin").focus(), 100);
}
document.getElementById("pin").addEventListener("keydown", e => { if (e.key === "Enter") entrar(); });
document.getElementById("ci").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("pin").focus(); });

function usarCI() {
    tokenURL = "";
    document.getElementById("campo-ci").style.display = "block";
    document.getElementById("btn-usar-ci").style.display = "none";
    document.getElementById("acceso-sub").innerText = "Ingrese su número de CI y el código de acceso que le entregó el laboratorio.";
}
function error(t) { const e = document.getElementById("error"); e.innerText = t; e.style.display = t ? "block" : "none"; }

async function entrar() {
    error("");
    const pin = document.getElementById("pin").value.trim().toUpperCase();
    const ci = document.getElementById("ci").value.trim();
    if (pin.length !== 6) return error("El código de acceso tiene 6 caracteres.");
    if (!tokenURL && !ci) return error("Ingrese su número de CI.");
    const btn = document.getElementById("btn-entrar"); btn.disabled = true; btn.innerText = "Buscando...";
    try {
        let token = tokenURL;
        if (!token) {
            const s = await db.ref("portal_indice/" + await AESInforme.indiceDe(ci, pin)).once("value");
            token = s.val();
            if (!token) throw new Error("datos");
        }
        const s = await db.ref("portal/" + token + "/informes").once("value");
        const datos = s.val() || {};
        const k = await AESInforme.clave(pin, token);
        informes = [];
        for (const key of Object.keys(datos)) {
            try { informes.push({ key: key, fecha: datos[key].fecha, d: await AESInforme.descifrar(datos[key], pin, token, k) }); }
            catch (e) { throw new Error("codigo"); }
        }
        informes.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        mostrarLista();
    } catch (e) {
        if (e.message === "codigo") error("El código de acceso no es correcto.");
        else if (e.message === "datos") error("No encontramos resultados con ese CI y código. Revise los datos.");
        else error("No se pudo conectar. Revise su conexión a internet e intente de nuevo.");
    } finally {
        btn.disabled = false; btn.innerText = "Ver resultados";
    }
}

function mostrarLista() {
    document.getElementById("acceso").style.display = "none";
    document.getElementById("visor").style.display = "none";
    document.getElementById("lista").style.display = "block";
    const cont = document.getElementById("informes");
    if (informes.length === 0) { cont.innerHTML = "<div class=\"vacio\">Todavía no hay informes validados.<br>Vuelva a revisar más tarde.</div>"; return; }
    document.getElementById("saludo").innerText = "Hola, " + (informes[0].d.paciente || "");
    cont.innerHTML = informes.map((x, i) => {
        const n = Object.values(x.d.grupos || {}).reduce((a, g) => a + g.length, 0);
        return "<div class=\"informe\"><div><b>Informe del " + esc(new Date(x.fecha).toLocaleDateString()) + "</b>" +
            (x.d.anormales ? "<span class=\"alerta\">" + x.d.anormales + " fuera de rango</span>" : "") +
            "<div class=\"meta\">Muestra " + esc(x.d.muestra) + " · " + n + " prueba(s) · " + esc(Object.keys(x.d.grupos || {}).join(", ")) + "</div></div>" +
            "<div class=\"acciones\"><button class=\"b-ver\" onclick=\"ver(" + i + ")\">Ver</button><button class=\"b-pdf\" onclick=\"pdf(" + i + ", this)\">⬇ PDF</button></div></div>";
    }).join("");
}

function ver(i) {
    actual = informes[i];
    document.getElementById("hoja").innerHTML = AESInforme.html(actual.d);
    document.getElementById("lista").style.display = "none";
    document.getElementById("visor").style.display = "block";
    document.getElementById("btn-pdf-visor").onclick = function () { pdf(i, this); };
    window.scrollTo(0, 0);
}
function volver() { mostrarLista(); window.scrollTo(0, 0); }
function salir() { informes = []; location.href = location.pathname + (tokenURL ? "?t=" + tokenURL : ""); }

function pdf(i, btn) {
    const x = informes[i];
    const div = document.createElement("div");
    div.style.cssText = "position:absolute;left:-10000px;top:0;width:740px;padding:25px 30px;background:#fff;";
    div.innerHTML = AESInforme.html(x.d);
    document.body.appendChild(div);
    const txt = btn.innerText; btn.disabled = true; btn.innerText = "⏳";
    html2pdf().set({ margin: 10, filename: "Resultados_" + x.d.muestra + ".pdf", image: { type: "jpeg", quality: 0.95 }, html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } })
        .from(div).save().finally(() => { div.remove(); btn.disabled = false; btn.innerText = txt; });
}
