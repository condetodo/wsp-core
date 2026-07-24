// ============================================================
// DERIVACIÓN a un asesor humano (Opción B: el asesor responde desde el panel).
// Marca al cliente en_asesor (el bot se calla, ver webhook.js) y avisa a los
// asesores por PLANTILLA (el texto libre no se entrega fuera de la ventana de
// 24hs; la plantilla sí). El asesor le responde al cliente desde el panel.
// ============================================================
require('dotenv').config();
const { obtenerDatos360, marcarEnAsesor } = require('./clientes');
const { normalizar } = require('./contactos');
const { abrirCaso, mejorEsfuerzo } = require('./casos');
const { listarConWhatsapp } = require('./asesores');
const { enviarTemplate } = require('./enviar-template');

// Variables del template aviso_asesor: [nombreCliente, motivo]. PURA.
function renderAvisoAsesor(datos, motivo) {
  const p = (datos && datos.persona) || {};
  const nombre = [p.nombre, p.apellido].filter(Boolean).join(' ') || 'Cliente sin nombre';
  return [nombre, motivo || 'sin motivo especificado'];
}

// Marca al cliente en_asesor y avisa a los asesores por plantilla.
// Destinatarios: asesores activos con whatsapp; si no hay, fallback a ASESOR_WHATSAPP (demo).
async function derivarAAsesor(numero, motivo) {
  await marcarEnAsesor(numero);
  // Registra el caso con su motivo (Métricas). Mejor esfuerzo: las métricas
  // nunca frenan la derivación real.
  await mejorEsfuerzo(abrirCaso(normalizar(numero), motivo));

  const datos = await obtenerDatos360(numero);
  const [nombre, mot] = renderAvisoAsesor(datos, motivo);

  let destinos = (await listarConWhatsapp()).map((a) => a.whatsapp);
  if (destinos.length === 0 && process.env.ASESOR_WHATSAPP) {
    destinos = [process.env.ASESOR_WHATSAPP];
  }
  if (destinos.length === 0) {
    console.warn('⚠️  Sin asesores con WhatsApp ni ASESOR_WHATSAPP: no se notifica (el bot igual quedó en pausa).');
    return { ok: true, notificados: 0 };
  }

  let notificados = 0;
  for (const dest of destinos) {
    const resp = await enviarTemplate(dest, 'aviso_asesor', 'es_AR', [nombre, mot]);
    if (resp && Array.isArray(resp.messages)) notificados++;
  }
  return { ok: true, notificados };
}

module.exports = { renderAvisoAsesor, derivarAAsesor };
