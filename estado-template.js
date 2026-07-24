// ============================================================
// Consulta el ESTADO de aprobación de las plantillas en Meta.
// Útil para saber si "recordatorio_turno" ya pasó a APPROVED.
// Lo corrés con:  node estado-template.js
// Necesita WHATSAPP_TOKEN y WABA_ID en el entorno.
// ============================================================
require('dotenv').config();

const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = process.env.WABA_ID;
const VERSION = 'v25.0';

async function ver() {
  if (!TOKEN || !WABA_ID) {
    console.error('❌ Falta WHATSAPP_TOKEN o WABA_ID en el entorno.');
    process.exit(1);
  }

  const url = `https://graph.facebook.com/${VERSION}/${WABA_ID}/message_templates?fields=name,status,category,language`;
  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const data = await respuesta.json();

  if (!respuesta.ok) {
    console.error('❌ Error consultando plantillas:', JSON.stringify(data, null, 2));
    return;
  }

  const plantillas = data.data || [];
  if (plantillas.length === 0) {
    console.log('No hay plantillas registradas.');
    return;
  }

  console.log('📋 Plantillas:');
  for (const p of plantillas) {
    console.log(`   - ${p.name} (${p.language}, ${p.category}) → ${p.status}`);
  }
}

ver().catch((err) => console.error('❌ Error inesperado:', err.message));
