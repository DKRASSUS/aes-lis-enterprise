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
    const esPortal = /portal\.html$/i.test(location.pathname);
    const pedido = (new URLSearchParams(location.search).get("lab") || "").toLowerCase();
    let codigo = labs[pedido] ? pedido : null;
    // En el LIS se recuerda el laboratorio de esta PC; en el portal manda solo el enlace
    if (!codigo && !esPortal) { try { const g = localStorage.getItem("aes_lab"); if (labs[g]) codigo = g; } catch (e) { } }
    if (!codigo) codigo = codigos[0];
    if (!esPortal && labs[pedido]) { try { localStorage.setItem("aes_lab", pedido); } catch (e) { } }
    window.AES_LAB_CODIGO = codigo;
    window.AES_LAB = labs[codigo];
    window.AES_LAB_ES_PRIMERO = codigo === codigos[0];
})();
