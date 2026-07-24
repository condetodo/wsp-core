// ============================================================
// Registra el template `aviso_asesor` en Meta (UTILITY, es_AR).
// {{1}} = nombre del cliente, {{2}} = motivo de la derivación.
// Uso:  node aviso-asesor-template.js   (necesita WHATSAPP_TOKEN y WABA_ID)
// Queda IN_REVIEW hasta que Meta lo apruebe.
// ============================================================
require('dotenv').config();

const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = process.env.WABA_ID;
const VERSION = 'v25.0';

const TEMPLATE = {
  name: 'aviso_asesor',
  language: 'es_AR',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text:
        '🔔 Tenés un cliente para atender: {{1}}. Motivo: {{2}}. ' +
        'Entrá al panel para responderle.',
      example: { body_text: [['Francisco Pérez', 'Quiere hablar con una persona']] }
    }
  ]
};

async function crear() {
  if (!TOKEN || !WABA_ID) {
    console.error('❌ Falta WHATSAPP_TOKEN o WABA_ID en el entorno.');
    process.exit(1);
  }
  const url = `https://graph.facebook.com/${VERSION}/${WABA_ID}/message_templates`;
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(TEMPLATE)
  });
  const data = await respuesta.json();
  if (respuesta.ok) {
    console.log('✅ Template aviso_asesor enviado a revisión:', JSON.stringify(data));
  } else {
    console.error('❌ Meta rechazó la creación:', JSON.stringify(data, null, 2));
  }
}

crear().catch((err) => console.error('❌ Error inesperado:', err.message));
