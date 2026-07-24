// ============================================================
// Crea el template de ENCUESTA de satisfacción (encuesta_service):
// cuerpo con {{1}}=nombre {{2}}=modelo + 3 botones de respuesta rápida
// (Excelente / Buena / Mala). Registra en Meta + alta en `plantillas`.
// La lógica vive en encuestas.js (registrarTemplateEncuesta); esto es el
// atajo por consola. El mismo registro se puede disparar desde el navegador
// con GET /tareas/crear-encuesta?key=TAREAS_KEY (corre dentro de Railway).
//
// Lo corrés con:  node crear-template-encuesta.js
// Necesita: WHATSAPP_TOKEN, WABA_ID y DATABASE_URL en el entorno.
// ============================================================
require('dotenv').config();
const { pool } = require('./db');
const { registrarTemplateEncuesta, TEMPLATE_ENCUESTA, OPCIONES } = require('./encuestas');

async function main() {
  console.log(`📤 Registrando template "${TEMPLATE_ENCUESTA}" en Meta (con ${OPCIONES.length} botones)...`);
  const r = await registrarTemplateEncuesta();

  if (!r.ok) {
    console.error('❌ Meta rechazó la creación. Detalle:');
    console.error(JSON.stringify(r.detalle, null, 2));
    process.exit(1);
  }

  if (r.yaExistiaEnMeta) console.log('ℹ️  El template ya existía en Meta; no se volvió a crear.');
  else console.log('✅ Template enviado a revisión:', JSON.stringify(r.meta, null, 2));

  if (r.altaLocal) console.log('✅ Alta local en `plantillas`: ya aparece en el panel para Envío masivo.');
  else console.log('ℹ️  Ya estaba en la tabla plantillas; no se duplica.');

  console.log('\nQueda IN_REVIEW/PENDING. Cuando Meta la apruebe ("Actualizar estado" en');
  console.log('el panel de Plantillas), se puede mandar por Envío masivo como cualquier otra.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('❌ Error inesperado:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
