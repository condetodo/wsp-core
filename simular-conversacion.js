// ============================================================
// SIMULADOR de conversación (test del cerebro del agente, sin WhatsApp).
// Reproduce el loop de webhook.js: identifica al cliente, arma el contexto 360,
// llama al agente y ejecuta sus tools. Útil para probar el flujo end-to-end
// contra datos reales, sin necesitar un teléfono.
//
// Uso:  node simular-conversacion.js [numero]
//   numero: WhatsApp del cliente a simular (default: 5491100000000).
//
// Requiere DATABASE_URL y ANTHROPIC_API_KEY. La forma más limpia:
//   railway login   (una vez, abre el navegador)
//   railway run node simular-conversacion.js
//
// OJO: escribe en la base REAL (historial + lo que hagan las tools). Test data.
// El guion es genérico (ejercita la tool demo, el alta de datos y el cierre);
// al armar un vertical, sumá acá mensajes que ejerciten SUS tools.
// ============================================================
const { agregar, obtener } = require('./historial');
const { perfilParaAgente } = require('./clientes');
const { responder } = require('./agente');
const { pool } = require('./db');

const NUMERO = process.argv[2] || '5491100000000';

// Lo que dice el cliente, en orden. El agente responde entre cada mensaje.
const GUION = [
  'Hola! ¿Qué horario de atención tienen?',
  'Genial. Soy Carlos Rivarola, ¿me pueden contactar por acá?',
  'Perfecto, gracias! Eso era todo.',
];

(async () => {
  console.log(`\n🧪 Simulando conversación con ${NUMERO}\n${'='.repeat(50)}`);

  for (const texto of GUION) {
    console.log(`\n👤 Cliente: ${texto}`);

    // Mismo flujo que webhook.js (sin el envío a Meta).
    await agregar(NUMERO, 'user', texto);
    const { perfil } = await perfilParaAgente(NUMERO);
    const historial = await obtener(NUMERO);
    const contexto = { numero: NUMERO, perfil };
    const respuesta = await responder(historial, contexto);

    if (respuesta && respuesta.trim()) {
      await agregar(NUMERO, 'assistant', respuesta);
      console.log(`🤖 Bot: ${respuesta}`);
    } else {
      console.log('🤖 Bot: (respuesta vacía)');
    }
    if (contexto.cerrar) console.log('   [el agente marcó CERRAR la conversación]');
    if (contexto.derivar) console.log('   [el agente pidió DERIVAR a un asesor]');
  }

  // ¿Qué quedó guardado de la persona?
  console.log(`\n${'='.repeat(50)}\n📋 Persona ${NUMERO} en la base:`);
  const r = await pool.query(
    'SELECT id, nombre, apellido, correo FROM personas WHERE telefono = $1',
    [NUMERO]
  );
  if (r.rows.length) {
    const p = r.rows[0];
    console.log(`   #${p.id} · ${[p.nombre, p.apellido].filter(Boolean).join(' ') || 'sin nombre'} · ${p.correo || 'sin correo'}`);
  } else {
    console.log('   (no existe)');
  }
  process.exit(0);
})().catch((err) => {
  console.error('❌ Error en la simulación:', err.message);
  process.exit(1);
});
