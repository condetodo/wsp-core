// ============================================================
// COMPARADOR DE MODELOS (costo real Sonnet 4.6 vs Haiku 4.5).
// Corre LA MISMA conversación de 7 mensajes contra cada modelo, con las
// herramientas y el perfil 360 reales, y compara tokens, costo y calidad.
//
// - El historial vive en memoria: NO escribe en la tabla historial y NO
//   registra el consumo en la solapa Costos (usa sinRegistro).
// - Las herramientas SÍ pegan a la base real: revisá y borrá los datos de
//   prueba que dejen.
//
// Uso:  railway run node comparar-modelos.js [numero]
//   numero: WhatsApp del cliente a simular (default: 5491100000000).
// Requiere DATABASE_URL y ANTHROPIC_API_KEY.
// ============================================================
require('dotenv').config();
const { perfilParaAgente } = require('./clientes');
const { responder } = require('./agente');
const { pool } = require('./db');

const NUMERO = process.argv[2] || '5491100000000';

// USD por millón de tokens de cada modelo a comparar.
const MODELOS = [
  { id: 'claude-sonnet-4-6', nombre: 'Sonnet 4.6 (actual)', entrada: 3, salida: 15 },
  { id: 'claude-haiku-4-5', nombre: 'Haiku 4.5', entrada: 1, salida: 5 },
];

// Conversación genérica (7 respuestas del bot, parecido al promedio esperado
// en vivo). Al armar un vertical, reemplazala por una realista de ESE negocio.
const GUION = [
  'Hola! ¿Qué horario de atención tienen?',
  '¿Y dónde quedan?',
  'Soy Carlos Rivarola, todavía no soy cliente',
  'Mi correo es carlos@ejemplo.com',
  'Quería saber si atienden los sábados',
  'Perfecto, con eso me arreglo',
  'Genial, gracias! Nos vemos',
];

function costo(total, precios) {
  return (total.entrada * precios.entrada + total.salida * precios.salida) / 1_000_000;
}

async function correr(modelo) {
  console.log(`\n${'='.repeat(60)}\n🧪 ${modelo.nombre}  (${modelo.id})\n${'='.repeat(60)}`);

  const { perfil } = await perfilParaAgente(NUMERO);
  const historial = []; // en memoria: cada modelo arranca de cero
  const total = { entrada: 0, salida: 0, llamadas: 0 };

  for (const texto of GUION) {
    console.log(`\n👤 Cliente: ${texto}`);
    historial.push({ role: 'user', content: texto });

    const contexto = { numero: NUMERO, perfil };
    const respuesta = await responder(historial, contexto, {
      modelo: modelo.id,
      sinRegistro: true,
    });
    historial.push({ role: 'assistant', content: respuesta || '(sin texto)' });

    console.log(`🤖 Bot: ${respuesta || '(respuesta vacía)'}`);
    if (contexto.uso) {
      total.entrada += contexto.uso.entrada;
      total.salida += contexto.uso.salida;
      total.llamadas += contexto.uso.llamadas;
    }
    if (contexto.cerrar) console.log('   [marcó CERRAR la conversación]');
    if (contexto.derivar) console.log('   [pidió DERIVAR a un asesor]');
  }

  const usd = costo(total, modelo);
  console.log(
    `\n📊 ${modelo.nombre}: ${total.entrada.toLocaleString('es-AR')} entrada + ` +
    `${total.salida.toLocaleString('es-AR')} salida en ${total.llamadas} llamadas ` +
    `→ USD ${usd.toFixed(4)} la conversación`
  );
  return { ...modelo, ...total, usd };
}

(async () => {
  const resultados = [];
  for (const modelo of MODELOS) {
    resultados.push(await correr(modelo));
  }

  // Resumen comparativo + proyección mensual.
  console.log(`\n${'='.repeat(60)}\n💵 RESUMEN (conversación de ${GUION.length} respuestas)\n${'='.repeat(60)}`);
  for (const r of resultados) {
    console.log(
      `${r.nombre.padEnd(22)} USD ${r.usd.toFixed(4)}/conversación · ` +
      `USD ${(r.usd / GUION.length).toFixed(4)}/respuesta`
    );
  }
  const [sonnet, haiku] = resultados;
  if (sonnet && haiku && sonnet.usd > 0) {
    const ahorro = (1 - haiku.usd / sonnet.usd) * 100;
    console.log(`\nAhorro con Haiku: ${ahorro.toFixed(0)}%`);
    for (const porMes of [100, 500, 1000]) {
      console.log(
        `  ${String(porMes).padStart(4)} conversaciones/mes → ` +
        `Sonnet USD ${(sonnet.usd * porMes).toFixed(2)} vs Haiku USD ${(haiku.usd * porMes).toFixed(2)}`
      );
    }
  }

  // Qué quedó guardado de la persona (datos de prueba, borralos si molestan).
  console.log(`\n📋 Persona ${NUMERO} en la base (revisá los datos de prueba):`);
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
  console.error('❌ Error en la comparación:', err.message);
  process.exit(1);
});
