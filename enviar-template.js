// ============================================================
// Módulo reutilizable para ENVIAR un TEMPLATE (plantilla pre-aprobada).
// A diferencia de enviar.js (texto libre, solo dentro de la ventana de 24hs),
// un template se puede mandar SIEMPRE → sirve para que el negocio INICIE la
// conversación (recordatorios, avisos, etc.).
//
// La plantilla tiene que estar APROBADA por Meta (ver crear-template.js).
// Acá solo la "disparamos" rellenando sus variables.
// ============================================================
require('dotenv').config();
const { paraEnviar } = require('./enviar'); // mismo formato de número (AR sin el 9)

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERSION = 'v25.0';

// Sube una imagen a la WhatsApp Cloud API y devuelve { ok, id, data }. El "id"
// (media id) es reusable para muchos envíos desde este número. Se sube UNA vez
// por campaña y se reusa en cada mensaje (no por destinatario).
async function subirMediaImagen(buffer, mime) {
  const url = `https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([buffer], { type: mime }), 'header');
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  const data = await respuesta.json();
  if (!respuesta.ok) console.error('❌ subirMediaImagen ->', JSON.stringify(data));
  return { ok: respuesta.ok && !!data.id, id: data.id, data };
}

// Manda el template "nombre" (en idioma "idioma") al "numero", rellenando
// las variables {{1}}, {{2}}, ... del cuerpo con el array "variables".
// headerImageId (opcional): media id de una imagen ya subida → header de imagen.
// Ej: enviarTemplate('549...', 'recordatorio_turno', 'es_AR', ['Juan', 'el sábado', '10 hs'])
async function enviarTemplate(numero, nombre, idioma, variables = [], headerImageId = null) {
  const url = `https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`;

  const components = [];
  // Header de imagen, si la plantilla lo tiene.
  if (headerImageId) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { id: headerImageId } }],
    });
  }
  // Si la plantilla tiene variables, las mandamos como parámetros del body.
  // El orden del array es el orden de {{1}}, {{2}}, ...
  if (variables.length) {
    components.push({
      type: 'body',
      parameters: variables.map((v) => ({ type: 'text', text: String(v) })),
    });
  }

  const body = {
    messaging_product: 'whatsapp',
    to: paraEnviar(numero),
    type: 'template',
    template: {
      name: nombre,
      language: { code: idioma },
      ...(components.length ? { components } : {})
    }
  };

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await respuesta.json();
  if (!respuesta.ok) {
    console.error('❌ Error al enviar template a', numero, '->', JSON.stringify(data));
  }
  return data;
}

module.exports = { enviarTemplate, subirMediaImagen };
