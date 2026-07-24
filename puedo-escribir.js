// ============================================================
// Lógica de la VENTANA DE 24 HORAS.
// Dado un número, dice si podés mandarle texto libre o si necesitás template.
//
// Se puede usar de 2 formas:
//   1) Como función (la importa otro código):  const { estadoVentana } = require('./puedo-escribir')
//   2) Desde la consola para chequear a mano:   node puedo-escribir.js 541158404881
// ============================================================
const { ultimoMensaje } = require('./contactos');

// 24 horas expresadas en milisegundos (que es como guardamos el tiempo)
const VENTANA_MS = 24 * 60 * 60 * 1000;

async function estadoVentana(numero) {
  const ultimo = await ultimoMensaje(numero);

  // Si nunca nos escribió, no hay ventana abierta: solo template.
  if (!ultimo) {
    return { abierta: false, motivo: 'este número nunca te escribió' };
  }

  const transcurridoMs = Date.now() - ultimo;
  const abierta = transcurridoMs < VENTANA_MS;
  const restanteMs = VENTANA_MS - transcurridoMs;

  return {
    abierta,
    ultimo,
    horasDesdeUltimo: (transcurridoMs / 1000 / 60 / 60).toFixed(1),
    horasRestantes: abierta ? (restanteMs / 1000 / 60 / 60).toFixed(1) : 0
  };
}

module.exports = { estadoVentana };

// --- Modo consola: solo corre si ejecutás "node puedo-escribir.js <numero>" ---
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.log('Uso: node puedo-escribir.js <numero>');
    console.log('Ej:  node puedo-escribir.js 541158404881');
    process.exit(1);
  }

  (async () => {
    const e = await estadoVentana(numero);
    console.log(`\n📋 Estado de la ventana para ${numero}:`);
    if (e.abierta) {
      console.log(`   🟢 ABIERTA — escribió hace ${e.horasDesdeUltimo}hs.`);
      console.log(`   Podés mandarle TEXTO LIBRE. Te quedan ~${e.horasRestantes}hs.`);
    } else if (e.motivo) {
      console.log(`   🔴 CERRADA — ${e.motivo}.`);
      console.log('   Solo podés iniciar con un TEMPLATE aprobado.');
    } else {
      console.log(`   🔴 CERRADA — su último mensaje fue hace ${e.horasDesdeUltimo}hs (más de 24).`);
      console.log('   Solo podés contactarlo con un TEMPLATE aprobado.');
    }
    console.log('');

    // Cerramos el pool para que el proceso termine (si no, queda colgado).
    const { pool } = require('./db');
    await pool.end();
  })();
}
