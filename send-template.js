// ============================================================
// Enviar un TEMPLATE (plantilla pre-aprobada por Meta).
// A diferencia de send.js, esto funciona AUNQUE la ventana de 24hs
// esté cerrada — por eso sirve para INICIAR una conversación.
// Lo corrés con:  node send-template.js
// ============================================================
require('dotenv').config();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TO = process.env.MY_TEST_NUMBER;
const VERSION = 'v25.0';

// Template a usar. "hello_world" viene aprobado de fábrica, en inglés (en_US).
// Cuando crees los tuyos en el panel, cambiás estos dos valores.
const TEMPLATE_NAME = 'hello_world';
const TEMPLATE_LANG = 'en_US';

if (!TOKEN || !PHONE_NUMBER_ID || !TO) {
  console.error('❌ Falta completar el .env (WHATSAPP_TOKEN, PHONE_NUMBER_ID o MY_TEST_NUMBER).');
  process.exit(1);
}

async function enviarTemplate() {
  const url = `https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to: TO,
    type: 'template', // <-- la diferencia clave con send.js (que usa "text")
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANG }
    }
  };

  console.log(`📤 Enviando template "${TEMPLATE_NAME}" a ${TO} ...`);

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await respuesta.json();

  if (respuesta.ok) {
    console.log('✅ ¡Template enviado! Meta respondió:');
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.error('❌ Meta rechazó el envío. Detalle:');
    console.error(JSON.stringify(data, null, 2));
  }
}

enviarTemplate().catch((err) => {
  console.error('❌ Error inesperado:', err.message);
});
