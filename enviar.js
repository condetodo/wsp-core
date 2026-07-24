// ============================================================
// Módulo reutilizable para ENVIAR un mensaje de texto por WhatsApp.
// Lo usan tanto send.js (prueba manual) como webhook.js (respuesta de la IA).
// ============================================================
require('dotenv').config();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERSION = 'v25.0';

// Override opcional para el SANDBOX de Meta: algunos celulares AR (según el área)
// solo aceptan como destinatario el formato viejo con "15" (54 + área + 15 + abonado),
// y rechazan tanto el wa_id 549... como el 54... sin 9 (error 131030). SANDBOX_TO es
// un mapa JSON { "wa_id_con_9": "to_exacto" }. En PRODUCCIÓN se deja vacío y no actúa.
// Ej: SANDBOX_TO={"5493329603525":"54332915603525"}
let SANDBOX_TO = {};
try {
  SANDBOX_TO = JSON.parse(process.env.SANDBOX_TO || '{}');
} catch (e) {
  console.warn('⚠️  SANDBOX_TO no es JSON válido; se ignora.');
}

// Convierte un número AR a la forma que WhatsApp acepta en el campo "to":
// SIN el 9 extra. Los mensajes ENTRANTES traen el número con el 9 (549...),
// pero para ENVIAR a la sandbox hay que sacárselo (54...).
function paraEnviar(numero) {
  let n = String(numero).replace(/\D/g, ''); // solo dígitos
  // Clave canónica con el 9 (como llegan los entrantes / se guardan en la DB).
  const canon = n.startsWith('54') && !n.startsWith('549') ? '549' + n.slice(2) : n;
  if (SANDBOX_TO[canon]) return SANDBOX_TO[canon]; // override del sandbox, si existe
  if (n.startsWith('549')) {
    n = '54' + n.slice(3); // sacamos el 9 que va después del 54
  }
  return n;
}

// Manda "texto" al número "numero". Devuelve la respuesta de Meta.
async function enviarTexto(numero, texto) {
  const url = `https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to: paraEnviar(numero), // convertimos al formato de envío (AR sin el 9)
    type: 'text',
    text: { body: texto }
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
    console.error('❌ Error al enviar a', numero, '->', JSON.stringify(data));
  }
  return data;
}

// Exportamos también paraEnviar para que el envío de templates use el mismo
// formato de número (AR sin el 9).
module.exports = { enviarTexto, paraEnviar };
