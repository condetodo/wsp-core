// ============================================================
// PIEZA 1 (refactor): prueba MANUAL de envío.
// Ahora usa el módulo enviar.js — el mismo que el webhook usa para responder.
// Lo corrés con:  node send.js
// ============================================================
require('dotenv').config();
const { enviarTexto } = require('./enviar');

const TO = process.env.MY_TEST_NUMBER;

if (!process.env.WHATSAPP_TOKEN || !process.env.PHONE_NUMBER_ID || !TO) {
  console.error('❌ Falta completar el .env (WHATSAPP_TOKEN, PHONE_NUMBER_ID o MY_TEST_NUMBER).');
  process.exit(1);
}

(async () => {
  console.log('📤 Enviando mensaje de prueba a', TO, '...');
  const data = await enviarTexto(TO, '¡Hola! Este es mi primer mensaje desde mi propio backend 🚀');
  console.log(JSON.stringify(data, null, 2));
})().catch((err) => console.error('❌ Error inesperado:', err.message));
