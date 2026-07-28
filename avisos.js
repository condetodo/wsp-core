// ============================================================
// AVISOS a los vendedores por MAIL (Resend).
// Hoy lo usa la calificación de leads: cuando alguien cruza el umbral, los
// asesores con mail cargado reciben la ficha para llamarlo.
//
// El canal vive acá aislado a propósito: sumar WhatsApp más adelante es
// agregar una función en este archivo, sin tocar la lógica de calificación.
//
// REGLA: un aviso nunca puede romper la conversación con el cliente. Si falta
// la clave o Resend falla, se loguea y se sigue (mismo criterio que
// mejorEsfuerzo en casos.js).
// ============================================================
require('dotenv').config();

// Escapa el HTML de un valor. El motivo y el interés los redacta el modelo a
// partir de lo que escribió el cliente, así que un "<" cualquiera rompería el
// mail. PURA.
function escaparHtml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Arma el asunto y el cuerpo del aviso de lead calificado. PURA: no envía nada.
// El asunto lleva nombre y puntaje para que se pueda priorizar desde la bandeja,
// sin abrir el mail.
function renderAvisoLead({ nombre, telefono, puntaje, motivo, interes } = {}) {
  const quien = nombre || 'Lead sin nombre';
  const asunto = `Lead calificado ${puntaje}/5 — ${quien}`;

  const filas = [
    ['Cliente', quien],
    ['Teléfono', telefono],
    ['Puntaje', `${puntaje} de 5`],
    ['Motivo', motivo],
    ['Busca', interes],
  ];

  const cuerpo = filas
    .filter(([, valor]) => valor)
    .map(([etiqueta, valor]) =>
      `<tr>
         <td style="padding:6px 14px 6px 0;color:#827d72;font-size:13px;white-space:nowrap">${etiqueta}</td>
         <td style="padding:6px 0;color:#23211d;font-size:14px">${escaparHtml(valor)}</td>
       </tr>`)
    .join('');

  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:520px">
       <h2 style="margin:0 0 4px;font-size:17px;color:#23211d">Lead calificado</h2>
       <p style="margin:0 0 16px;color:#827d72;font-size:13px">
         El agente detectó interés de compra. Entrá al panel para tomar la conversación.
       </p>
       <table style="border-collapse:collapse">${cuerpo}</table>
     </div>`;

  return { asunto, html };
}

// Manda el aviso a cada destinatario. Devuelve { avisados }.
// Sin RESEND_API_KEY o sin destinatarios, no es un error: el aviso simplemente
// no sale y la conversación con el cliente sigue su curso.
async function avisarLeadPorMail(destinos, datos) {
  const lista = (destinos || []).filter(Boolean);
  if (lista.length === 0) return { avisados: 0 };

  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  Sin RESEND_API_KEY: no se envía el aviso de lead (el bot sigue igual).');
    return { avisados: 0 };
  }
  const from = process.env.AVISOS_FROM;
  if (!from) {
    console.warn('⚠️  Sin AVISOS_FROM: no se envía el aviso de lead (el bot sigue igual).');
    return { avisados: 0 };
  }

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { asunto, html } = renderAvisoLead(datos);

  let avisados = 0;
  for (const to of lista) {
    try {
      const { error } = await resend.emails.send({ from, to, subject: asunto, html });
      if (error) {
        console.error(`❌ Resend rechazó el aviso a ${to}:`, error.message || error);
        continue;
      }
      avisados++;
    } catch (err) {
      console.error(`❌ Error enviando el aviso a ${to}:`, err.message);
    }
  }
  return { avisados };
}

module.exports = { escaparHtml, renderAvisoLead, avisarLeadPorMail };
