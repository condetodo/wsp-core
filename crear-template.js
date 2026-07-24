// ============================================================
// Crea (registra) un TEMPLATE en Meta vía la API.
// Esto es el "lado Meta" del asunto: definimos la plantilla y Meta la REVISA.
// Queda en estado IN_REVIEW y, si la aprueban, pasa a APPROVED y recién ahí
// se puede enviar (con enviar-template.js).
//
// Lo corrés con:  node crear-template.js
// Necesita en el entorno: WHATSAPP_TOKEN y WABA_ID.
// ============================================================
require('dotenv').config();

const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = process.env.WABA_ID; // ID de la cuenta de WhatsApp Business
const VERSION = 'v25.0';

// ------------------------------------------------------------
// La plantilla base: recordatorio de cita/turno genérico.
// Categoría UTILITY (transaccional) → se aprueba fácil y es barata.
// {{1}} = nombre, {{2}} = día, {{3}} = horario.
// El "example" es OBLIGATORIO cuando hay variables: Meta lo usa para revisar.
// Adaptá el texto al negocio del cliente antes de registrarla.
// ------------------------------------------------------------
const TEMPLATE = {
  name: 'recordatorio_turno',
  language: 'es_AR',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text:
        'Hola {{1}}! 👋 Te recordamos tu turno para el {{2}} a las {{3}}. ' +
        'Si querés reprogramar, respondé este mensaje.',
      example: {
        body_text: [['Juan', 'el sábado', '10 hs']]
      }
    }
  ]
};

async function crear() {
  if (!TOKEN || !WABA_ID) {
    console.error('❌ Falta WHATSAPP_TOKEN o WABA_ID en el entorno.');
    process.exit(1);
  }

  const url = `https://graph.facebook.com/${VERSION}/${WABA_ID}/message_templates`;
  console.log(`📤 Registrando template "${TEMPLATE.name}" (${TEMPLATE.language}, ${TEMPLATE.category}) ...`);

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(TEMPLATE)
  });

  const data = await respuesta.json();

  if (respuesta.ok) {
    console.log('✅ Template enviado a revisión. Meta respondió:');
    console.log(JSON.stringify(data, null, 2));
    console.log('\nQueda IN_REVIEW. Cuando pase a APPROVED ya se puede enviar.');
    console.log('El estado lo ves en WhatsApp Manager → Plantillas de mensajes.');
  } else {
    console.error('❌ Meta rechazó la creación. Detalle:');
    console.error(JSON.stringify(data, null, 2));
  }
}

crear().catch((err) => {
  console.error('❌ Error inesperado:', err.message);
});
