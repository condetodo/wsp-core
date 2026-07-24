// ============================================================
// CASOS: ciclo de vida de cada derivación a asesor.
// derivado (abrir) → tomado (tomar / abrirTomado) → resuelto (resolver)
// o expirado (expirar, cuando vence el timeout sin atención).
// La solapa Métricas del panel se calcula sobre esta tabla (ver metricas.js).
// El teléfono se guarda en forma canónica (549..., ver contactos.normalizar): normalizar en el llamador.
// ============================================================
require('dotenv').config();
const { pool } = require('./db');

// Envuelve una escritura de caso para que sea de MEJOR ESFUERZO: si falla,
// avisa por consola y sigue. Las métricas nunca frenan el flujo real.
function mejorEsfuerzo(promesa) {
  return promesa.catch((err) => console.warn('⚠️  No se pudo registrar el caso:', err.message));
}

// Estado legible de un caso. PURA.
function estadoCaso(caso) {
  if (!caso) return null;
  if (caso.expirado) return 'expirado';
  if (caso.resuelto_en) return 'resuelto';
  return caso.tomado_por ? 'en_atencion' : 'en_espera';
}

// El bot derivó: nace un caso en espera. Cierra antes cualquier caso abierto
// colgado del mismo teléfono (no debería haber, pero evita duplicados).
async function abrirCaso(telefono, motivo) {
  await pool.query(
    `UPDATE casos SET expirado = true
      WHERE telefono = $1 AND resuelto_en IS NULL AND expirado = false`,
    [telefono]
  );
  const { rows } = await pool.query(
    `INSERT INTO casos (telefono, motivo, origen) VALUES ($1, $2, 'bot') RETURNING id`,
    [telefono, motivo || null]
  );
  return rows[0].id;
}

// Un asesor intervino una charla que estaba con el bot: caso que nace ya tomado.
async function abrirCasoTomado(telefono, usuario) {
  const { rows } = await pool.query(
    `INSERT INTO casos (telefono, origen, motivo, tomado_en, tomado_por)
     VALUES ($1, 'asesor', 'intervención del asesor', now(), $2) RETURNING id`,
    [telefono, usuario]
  );
  return rows[0].id;
}

// Un asesor tomó el caso en espera.
async function tomarCaso(telefono, usuario) {
  await pool.query(
    `UPDATE casos SET tomado_en = now(), tomado_por = $2
      WHERE telefono = $1 AND resuelto_en IS NULL AND expirado = false AND tomado_en IS NULL`,
    [telefono, usuario]
  );
}

// El asesor reactivó el bot: caso resuelto.
async function resolverCaso(telefono, usuario) {
  await pool.query(
    `UPDATE casos SET resuelto_en = now(), resuelto_por = $2
      WHERE telefono = $1 AND resuelto_en IS NULL AND expirado = false`,
    [telefono, usuario || null]
  );
}

// Venció el timeout sin que nadie atienda: no cuenta como resuelto.
async function expirarCaso(telefono) {
  await pool.query(
    `UPDATE casos SET expirado = true
      WHERE telefono = $1 AND resuelto_en IS NULL AND expirado = false`,
    [telefono]
  );
}

module.exports = { estadoCaso, mejorEsfuerzo, abrirCaso, abrirCasoTomado, tomarCaso, resolverCaso, expirarCaso };
