// =====================================================================
//  AES - PORTAL DEL PACIENTE
//  El paciente entra con (enlace + código) o (CI + código).
//  Ve cada ORDEN con el avance de sus exámenes y descarga lo validado.
//  Los datos están cifrados: se descifran aquí, en su celular/PC.
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
let tokenActivo = "", pinActivo = "";
let ordenes = [];   // [{key, fecha, o}]  o = {muestra, examenes:[{codigo,estado}], completo, d, ...}

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

// Convierte entradas viejas (solo informe) al formato de orden
function normalizar(obj) {
    if (obj && obj.v === 2) return obj;
    const n = Object.values(obj.grupos || {}).reduce((a, g) => a.concat(g.map(x => ({ codigo: x.n, estado: "listo" }))), []);
    return { v: 2, muestra: obj.muestra, fecha_orden: obj.fecha, paciente: obj.paciente, examenes: n, completo: true, d: obj, lab: obj.lab };
}

async function cargar(token, pin) {
    const s = await db.ref("portal/" + token + "/informes").once("value");
    const datos = s.val() || {};
    const k = await AESInforme.clave(pin, token);
    const lista = [];
    for (const key of Object.keys(datos)) {
        try { lista.push({ key: key, fecha: datos[key].fecha, o: normalizar(await AESInforme.descifrar(datos[key], pin, token, k)) }); }
        catch (e) { throw new Error("codigo"); }
    }
    lista.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return lista;
}

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
        ordenes = await cargar(token, pin);
        tokenActivo = token; pinActivo = pin;
        mostrarLista();
    } catch (e) {
        if (e.message === "codigo") error("El código de acceso no es correcto.");
        else if (e.message === "datos") error("No encontramos resultados con ese CI y código. Revise los datos.");
        else error("No se pudo conectar. Revise su conexión a internet e intente de nuevo.");
    } finally {
        btn.disabled = false; btn.innerText = "Ver resultados";
    }
}

async function actualizar(btn) {
    btn.disabled = true; btn.innerText = "Actualizando...";
    try { ordenes = await cargar(tokenActivo, pinActivo); mostrarLista(); }
    catch (e) { alert("No se pudo actualizar. Revise su conexión."); }
    btn.disabled = false; btn.innerText = "🔄 Actualizar";
}

function mostrarLista() {
    document.getElementById("acceso").style.display = "none";
    document.getElementById("visor").style.display = "none";
    document.getElementById("lista").style.display = "block";
    const cont = document.getElementById("informes");
    if (ordenes.length === 0) { cont.innerHTML = "<div class=\"vacio\">Todavía no hay órdenes registradas.</div>"; return; }
    document.getElementById("saludo").innerText = "Hola, " + (ordenes[0].o.paciente || "");
    cont.innerHTML = ordenes.map((x, i) => {
        const o = x.o, ex = o.examenes || [];
        const listos = ex.filter(e => e.estado === "listo").length, total = ex.length || 1;
        const pct = Math.round(listos * 100 / total);
        const anorm = o.d && o.d.anormales ? "<span class=\"alerta\">" + o.d.anormales + " fuera de rango</span>" : "";
        const estado = o.completo ? "<span class=\"estado ok\">✅ Resultados completos</span>"
            : (listos ? "<span class=\"estado parcial\">⏳ " + listos + " de " + ex.length + " listos</span>" : "<span class=\"estado espera\">⏳ En proceso</span>");
        const chips = ex.map(e => "<span class=\"chip " + (e.estado === "listo" ? "listo" : "pend") + "\">" + (e.estado === "listo" ? "✔ " : "⏳ ") + esc(e.codigo) + "</span>").join("");
        const botones = o.d ? "<div class=\"acciones\"><button class=\"b-ver\" onclick=\"ver(" + i + ")\">Ver</button><button class=\"b-pdf\" onclick=\"pdf(" + i + ", this)\">⬇ PDF" + (o.completo ? "" : " parcial") + "</button></div>"
            : "<div class=\"meta\">Sus resultados aparecerán aquí apenas estén validados.</div>";
        return "<div class=\"orden\"><div class=\"cab\"><div><b>Orden del " + esc(new Date(o.fecha_orden || x.fecha).toLocaleDateString()) + "</b>" + anorm +
            "<div class=\"meta\">N° " + esc(o.muestra) + (o.medico ? " · " + esc(o.medico) : "") + "</div></div>" + estado + "</div>" +
            "<div class=\"barra-av\"><div style=\"width:" + pct + "%\"></div></div><div class=\"chips\">" + chips + "</div>" + botones + "</div>";
    }).join("") + "<div style=\"text-align:center;margin-top:10px;\"><button class=\"b-ver\" onclick=\"actualizar(this)\">🔄 Actualizar</button></div>";
}

function informeDe(i) {
    const o = ordenes[i].o, d = Object.assign({}, o.d);
    d.pendientes = (o.examenes || []).filter(e => e.estado !== "listo").map(e => e.codigo);
    return d;
}
function ver(i) {
    document.getElementById("hoja").innerHTML = AESInforme.html(informeDe(i));
    document.getElementById("lista").style.display = "none";
    document.getElementById("visor").style.display = "block";
    document.getElementById("btn-pdf-visor").onclick = function () { pdf(i, this); };
    window.scrollTo(0, 0);
}
function volver() { mostrarLista(); window.scrollTo(0, 0); }
function salir() { ordenes = []; location.href = location.pathname + (tokenURL ? "?t=" + tokenURL : ""); }

function pdf(i, btn) {
    const d = informeDe(i);
    const div = document.createElement("div");
    div.style.cssText = "position:absolute;left:-10000px;top:0;width:740px;padding:25px 30px;background:#fff;";
    div.innerHTML = AESInforme.html(d);
    document.body.appendChild(div);
    const txt = btn.innerText; btn.disabled = true; btn.innerText = "⏳";
    html2pdf().set({ margin: 10, filename: "Resultados_" + d.muestra + (d.pendientes.length ? "_parcial" : "") + ".pdf", image: { type: "jpeg", quality: 0.95 }, html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } })
        .from(div).save().finally(() => { div.remove(); btn.disabled = false; btn.innerText = txt; });
}
