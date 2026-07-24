// ============================================================
// CONFIGURACIÓN editable desde el panel (tabla config, clave/valor).
// Hoy la única clave es 'modelo_agente': qué modelo de Claude usa el bot.
// Se elige desde la solapa Costos y aplica al instante (el agente la lee
// en cada respuesta), sin reinicio ni deploy.
// ============================================================
const { pool } = require('./db');

// Modelos elegibles desde el panel. Si se agrega uno acá, agregar también su
// tarifa en PRECIOS (uso.js) para que la solapa Costos lo cobre bien.
const MODELOS = [
  { id: 'claude-sonnet-4-6', nombre: 'Sonnet 4.6 — más capaz (US$ 3/15 por millón)' },
  { id: 'claude-haiku-4-5', nombre: 'Haiku 4.5 — más barato (US$ 1/5 por millón)' },
];

const MODELO_DEFAULT = 'claude-sonnet-4-6';

// Resuelve el modelo activo por prioridad: config de la DB > variable de
// entorno MODELO_AGENTE > default. Un valor de config que no está en MODELOS
// (id viejo/roto) se ignora para que el bot nunca quede apuntando a un modelo
// inexistente. PURA.
function resolverModelo(deConfig, deEnv) {
  if (deConfig && MODELOS.some((m) => m.id === deConfig)) return deConfig;
  return deEnv || MODELO_DEFAULT;
}

async function leerConfig(clave) {
  const { rows } = await pool.query(
    'SELECT valor FROM config WHERE clave = $1', [clave]
  );
  return rows.length ? rows[0].valor : null;
}

async function guardarConfig(clave, valor) {
  await pool.query(
    `INSERT INTO config (clave, valor) VALUES ($1, $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = now()`,
    [clave, valor]
  );
}

// El modelo activo del agente. Si la DB falla, el bot no se cae: responde con
// el modelo de env/default (la config es una comodidad, no un punto de falla).
async function modeloActivo() {
  let deConfig = null;
  try {
    deConfig = await leerConfig('modelo_agente');
  } catch (err) {
    console.error('⚠️  No se pudo leer modelo_agente de config:', err.message);
  }
  return resolverModelo(deConfig, process.env.MODELO_AGENTE);
}

module.exports = { MODELOS, resolverModelo, leerConfig, guardarConfig, modeloActivo };
