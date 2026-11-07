// =====================================================================
//  AES LIS - LISTA DE LABORATORIOS
// ---------------------------------------------------------------------
//  Cada laboratorio tiene SU PROPIO proyecto de Firebase (sus datos
//  quedan separados). La página es la misma para todos.
//
//  Cómo entra cada laboratorio:
//     LIS:    https://dkrassus.github.io/aes-lis-enterprise/?lab=CODIGO
//     (el primero de la lista también entra sin ?lab=)
//
//  Para agregar un laboratorio: use la herramienta NUEVO_LABORATORIO.html
//  y pegue el bloque que genera ANTES de la línea "FIN DE LA LISTA".
// =====================================================================
window.AES_LABORATORIOS = {

    "aes": {
        nombre: "AES Laboratorio",
        firebase: {
            apiKey: "AIzaSyBLuIk-gKICLWlLSdWNAsnVYPXxqvroijI",
            authDomain: "lis-aes.firebaseapp.com",
            databaseURL: "https://lis-aes-default-rtdb.firebaseio.com",
            projectId: "lis-aes",
            storageBucket: "lis-aes.firebasestorage.app",
            messagingSenderId: "333107041449",
            appId: "1:333107041449:web:e498022d3e04e876f9c5b8"
        },
        webhook_make: "https://hook.us2.make.com/h5w14y7wlwdwh3ey492wa7kt7lbltt63"
    },

    // ===== FIN DE LA LISTA (pegue los laboratorios nuevos arriba de esta línea) =====
};

(function () {
    const labs = window.AES_LABORATORIOS, codigos = Object.keys(labs);
    const maestro = labs[codigos[0]];
    const esPortal = /portal\.html$/i.test(location.pathname);
    const pedido = (new URLSearchParams(location.search).get("lab") || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // Laboratorios agregados desde la plataforma (Configuración → Laboratorios clientes).
    // Se guardan en el Firebase principal (registro_labs) y aquí se leen sin tocar este archivo.
    function delRegistro(cod) {
        try {
            const x = new XMLHttpRequest();
            x.open("GET", maestro.firebase.databaseURL + "/registro_labs/" + cod + ".json", false);   // síncrono: se necesita antes de arrancar
            x.send();
            if (x.status === 200) { const v = JSON.parse(x.responseText); if (v && v.firebase) return v; }
        } catch (e) { }
        try { const c = JSON.parse(localStorage.getItem("aes_lab_cache_" + cod) || "null"); if (c) return c; } catch (e) { }
        return null;
    }
    let codigo = labs[pedido] ? pedido : null;
    if (!codigo && pedido) { const r = delRegistro(pedido); if (r) { labs[pedido] = r; codigo = pedido; try { localStorage.setItem("aes_lab_cache_" + pedido, JSON.stringify(r)); } catch (e) { } } }
    // En el LIS se recuerda el laboratorio de esta PC; en el portal manda solo el enlace
    if (!codigo && !esPortal) {
        try {
            const g = localStorage.getItem("aes_lab");
            if (labs[g]) codigo = g;
            else if (g) { const r = delRegistro(g); if (r) { labs[g] = r; codigo = g; } }
        } catch (e) { }
    }
    if (!codigo) codigo = codigos[0];
    if (!esPortal && codigo === pedido) { try { localStorage.setItem("aes_lab", pedido); } catch (e) { } }
    window.AES_LAB_CODIGO = codigo;
    window.AES_LAB = labs[codigo];
    window.AES_LAB_ES_PRIMERO = codigo === codigos[0];
    window.AES_LAB_MAESTRO = maestro;
    // Laboratorio suspendido desde la plataforma (p. ej. por falta de pago)
    if (window.AES_LAB.activo === false && !esPortal) {
        document.addEventListener("DOMContentLoaded", () => {
            document.body.innerHTML = "<div style=\"font-family:Arial;max-width:520px;margin:80px auto;text-align:center;\"><h2>⏸ Servicio suspendido</h2><p>El sistema de <b>" + (window.AES_LAB.nombre || "este laboratorio") + "</b> está temporalmente suspendido.</p><p>Comuníquese con su proveedor del sistema.</p></div>";
        });
    }
})();
