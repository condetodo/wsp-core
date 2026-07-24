// ============================================================
// Capa fina sobre la WhatsApp Cloud API para TEMPLATES (nivel WABA).
// Reusa la misma lógica que crear-template.js / estado-template.js pero
// expuesta como funciones, para que el panel cree templates y consulte estado.
// Necesita WHATSAPP_TOKEN y WABA_ID en el entorno.
// ============================================================
require('dotenv').config();

const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = process.env.WABA_ID;
const APP_ID = process.env.APP_ID;
const VERSION = 'v25.0';

// Cuenta cuántas variables {{n}} distintas hay en el cuerpo (para el example).
function contarVariables(cuerpo) {
  const set = new Set();
  for (const m of String(cuerpo).matchAll(/\{\{(\d+)\}\}/g)) set.add(Number(m[1]));
  return set.size;
}

// Sube una imagen de EJEMPLO para el header del template usando la Resumable
// Upload API (a nivel app). Devuelve { ok, handle, data }. El "handle" es lo que
// pide Meta en el example del header IMAGE al crear el template.
async function subirImagenEjemplo(buffer, mime) {
  if (!TOKEN || !APP_ID) return { ok: false, data: { error: 'falta_token_o_app_id' } };
  try {
    // 1) Abrir sesión de subida.
    const inicioUrl = `https://graph.facebook.com/${VERSION}/${APP_ID}/uploads`
      + `?file_name=header&file_length=${buffer.length}&file_type=${encodeURIComponent(mime)}`
      + `&access_token=${TOKEN}`;
    const inicio = await fetch(inicioUrl, { method: 'POST' });
    const sesion = await inicio.json();
    if (!inicio.ok || !sesion.id) return { ok: false, data: sesion };

    // 2) Subir los bytes (offset 0). Devuelve { h: <handle> }.
    const subir = await fetch(`https://graph.facebook.com/${VERSION}/${sesion.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${TOKEN}`, file_offset: '0' },
      body: buffer,
    });
    const res = await subir.json();
    if (!subir.ok || !res.h) return { ok: false, data: res };
    return { ok: true, handle: res.h, data: res };
  } catch (err) {
    return { ok: false, data: { error: err.message } };
  }
}

// Crea (registra) un template en Meta. Devuelve { ok, data }.
// ejemplos: array de strings, uno por variable, para el body_text de revisión.
// header (opcional): { buffer, mime } para un header de imagen.
// botones (opcional): array de textos → botones de respuesta rápida (QUICK_REPLY).
// Meta acepta hasta 10, pero WhatsApp solo muestra 3 sin desplegar lista.
async function crearTemplate({ nombre, idioma, categoria, cuerpo, ejemplos, header, botones }) {
  if (!TOKEN || !WABA_ID) return { ok: false, data: { error: 'falta_token_o_waba' } };

  const components = [];

  // Header de imagen: hay que subir la imagen de ejemplo y pasar su handle.
  if (header && header.buffer) {
    const sub = await subirImagenEjemplo(header.buffer, header.mime);
    if (!sub.ok) return { ok: false, data: { error: 'fallo_subida_imagen', detalle: sub.data } };
    components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [sub.handle] } });
  }

  const n = contarVariables(cuerpo);
  components.push({
    type: 'BODY',
    text: cuerpo,
    ...(n > 0 ? { example: { body_text: [ (ejemplos || []).slice(0, n) ] } } : {}),
  });

  // Botones de respuesta rápida (25 caracteres máx. por botón, límite de Meta).
  if (Array.isArray(botones) && botones.length) {
    components.push({
      type: 'BUTTONS',
      buttons: botones.slice(0, 10).map((t) => ({ type: 'QUICK_REPLY', text: String(t).slice(0, 25) })),
    });
  }

  const body = {
    name: nombre,
    language: idioma || 'es_AR',
    category: categoria || 'MARKETING',
    components,
  };

  const url = `https://graph.facebook.com/${VERSION}/${WABA_ID}/message_templates`;
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await respuesta.json();
  return { ok: respuesta.ok, data };
}

// Devuelve el estado de todos los templates de la WABA: [{name, status, category, language}].
async function estadosTemplates() {
  if (!TOKEN || !WABA_ID) return [];
  const url = `https://graph.facebook.com/${VERSION}/${WABA_ID}/message_templates?fields=name,status,category,language&limit=200`;
  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    console.error('❌ estadosTemplates:', JSON.stringify(data));
    return [];
  }
  return data.data || [];
}

module.exports = { crearTemplate, estadosTemplates, contarVariables, subirImagenEjemplo };
