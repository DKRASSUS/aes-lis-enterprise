// =====================================================================
//  AES - Plantilla del INFORME DE RESULTADOS (la usan el LIS y el Portal)
//  + cifrado de informes para el portal del paciente
// =====================================================================
window.AESInforme = (function () {
    function esc(s) {
        return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function fechaTexto(iso) {
        if (!iso) return new Date().toLocaleString();
        const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString();
    }

    // d = datos del informe (ver datosInforme() en app.js)
    // extra = { qr: "data:image/png...", portal: "https://...", pin: "ABC123" }
    function html(d, extra) {
        extra = extra || {};
        const azul = "#00A8E8", oscuro = "#1A1A24";
        const pendientes = extra.pendientes || d.pendientes || [];
        const parcial = pendientes.length > 0;
        let h = "<div style=\"font-family:Inter,Helvetica,Arial,sans-serif;color:#333;font-size:12px;\">";
        // Encabezado
        h += "<div style=\"display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid " + azul + ";padding-bottom:12px;margin-bottom:14px;\">" +
            "<div><div style=\"font-size:24px;font-weight:800;color:" + oscuro + ";\">" + esc(d.lab.nombre || "Laboratorio Clínico") + "</div>" +
            "<div style=\"font-size:11px;color:#666;\">" + esc([d.lab.direccion, d.lab.telefono].filter(Boolean).join(" · ")) + "</div></div>" +
            "<div style=\"text-align:right;\"><div style=\"font-size:18px;font-weight:800;color:" + azul + ";\">" + (parcial ? "INFORME PARCIAL" : "INFORME DE RESULTADOS") + "</div>" +
            "<div style=\"font-size:11px;font-weight:bold;\">" + esc(fechaTexto(d.fecha)) + "</div></div></div>";
        // Datos del paciente
        h += "<table style=\"width:100%;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;margin-bottom:16px;font-size:12px;\"><tr>" +
            "<td style=\"padding:10px 14px;vertical-align:top;line-height:1.7;\"><b>Paciente:</b> " + esc(d.paciente) + "<br><b>CI:</b> " + esc(d.ci || "-") + "<br><b>Edad / Sexo:</b> " + esc((d.edad || "-") + " / " + d.sexo) + "<br><b>Médico:</b> " + esc(d.medico) + "</td>" +
            "<td style=\"padding:10px 14px;vertical-align:top;line-height:1.7;\"><b>N° de muestra:</b> " + esc(d.muestra) + "<br><b>Equipo:</b> " + esc(d.equipo) + "<br><b>Estado:</b> " + (parcial ? "PARCIAL (en proceso)" : "VALIDADO") + "</td></tr></table>";
        if (parcial) h += "<div style=\"background:#FFFBEB;border:1px solid #FCD34D;color:#92400E;padding:8px 14px;border-radius:6px;margin-bottom:10px;font-size:11px;\"><b>⏳ Exámenes pendientes:</b> " + esc(pendientes.join(", ")) + ". Se agregarán al informe apenas estén validados.</div>";
        // Resultados por categoría
        const cats = Object.keys(d.grupos || {});
        if (cats.length === 0) h += "<p>No hay resultados analíticos disponibles.</p>";
        cats.forEach(cat => {
            h += "<div style=\"background:" + azul + ";color:#fff;padding:7px 14px;font-weight:bold;font-size:12px;text-transform:uppercase;margin-top:12px;\">" + esc(cat) + "</div>" +
                "<table style=\"width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;\"><thead><tr>" +
                ["EXAMEN", "RESULTADO", "UNIDAD", "VALOR DE REFERENCIA"].map(t => "<th style=\"text-align:left;padding:7px 14px;border-bottom:2px solid #E2E8F0;color:#555;font-size:10px;background:#F8FAFC;\">" + t + "</th>").join("") +
                "</tr></thead><tbody>";
            d.grupos[cat].forEach(x => {
                const marca = x.flag === "H" ? " ▲ H" : (x.flag === "L" ? " ▼ L" : "");
                h += "<tr><td style=\"padding:7px 14px;border-bottom:1px solid #eee;\"><b>" + esc(x.n) + "</b></td>" +
                    "<td style=\"padding:7px 14px;border-bottom:1px solid #eee;font-family:monospace;font-size:13px;font-weight:bold;" + (x.flag ? "color:#DC2626;" : "") + "\">" + esc(x.v) + marca + "</td>" +
                    "<td style=\"padding:7px 14px;border-bottom:1px solid #eee;color:#666;\">" + esc(x.u || "-") + "</td>" +
                    "<td style=\"padding:7px 14px;border-bottom:1px solid #eee;color:#888;\">" + esc(x.ref) + "</td></tr>";
            });
            h += "</tbody></table>";
        });
        // Pie: validación + portal
        h += "<div style=\"display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:22px;padding-top:10px;border-top:1px solid #E2E8F0;\">" +
            "<div style=\"font-size:10px;color:#888;\">Los valores marcados con ▲ H (alto) o ▼ L (bajo) están fuera del rango de referencia.<br>" +
            "<span style=\"font-size:11px;color:#333;\"><b>Validado por:</b> " + esc(d.validado_por || "-") + "</span></div>";
        if (extra.qr || extra.portal) {
            h += "<div style=\"display:flex;align-items:center;gap:10px;text-align:right;font-size:10px;color:#555;\">" +
                "<div><b>Vea sus resultados en línea</b><br>Escanee el código o entre a:<br><span style=\"color:" + azul + ";\">" + esc(extra.portal || "") + "</span>" +
                (extra.pin ? "<br>Código de acceso: <b style=\"font-size:12px;letter-spacing:2px;color:#333;\">" + esc(extra.pin) + "</b>" : "") + "</div>" +
                (extra.qr ? "<img src=\"" + extra.qr + "\" style=\"width:84px;height:84px;\">" : "") + "</div>";
        }
        h += "</div></div>";
        return h;
    }

    // ------- Cifrado (WebCrypto): clave = PBKDF2(código del paciente, token) -> AES-GCM -------
    const enc = new TextEncoder(), dec = new TextDecoder();
    function aB64(buf) { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
    function deB64(t) { const s = atob(t); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
    async function clave(pin, token) {
        const base = await crypto.subtle.importKey("raw", enc.encode(String(pin).trim().toUpperCase()), "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode(token), iterations: 100000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    }
    async function cifrar(obj, pin, token) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, await clave(pin, token), enc.encode(JSON.stringify(obj)));
        return { iv: aB64(iv), datos: aB64(c) };
    }
    async function descifrar(paquete, pin, token, k) {
        const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(paquete.iv) }, k || await clave(pin, token), deB64(paquete.datos));
        return JSON.parse(dec.decode(p));
    }
    async function sha256(texto) {
        const b = await crypto.subtle.digest("SHA-256", enc.encode(texto));
        return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join("");
    }
    function indiceDe(ci, pin) { return sha256(String(ci).trim() + ":" + String(pin).trim().toUpperCase()); }

    return { html: html, esc: esc, cifrar: cifrar, descifrar: descifrar, clave: clave, sha256: sha256, indiceDe: indiceDe, fechaTexto: fechaTexto };
})();
