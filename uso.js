// ============================================================
// CONSUMO DEL AGENTE (tokens de la API de Anthropic).
// El agente registra acá cuánto costó cada respuesta del bot (todas las
// vueltas de tools sumadas), atado a la persona que escribió. La solapa
// "Costos" del panel lee estos datos.
// ============================================================
const { pool } = require('./db');

// Precios en USD por millón de tokens, por modelo. La clave es un prefijo del
// id (matchea 'claude-haiku-4-5' y 'claude-haiku-4-5-20251001'). Un modelo que
// no figura acá se cobra como Sonnet (peor caso conocido). Los históricos no
// se tocan: cada fila de uso_agente guarda el costo calculado al momento.
const PRECIOS = {
  'claude-sonnet-4-6': { entrada: 3, salida: 15 },
  'claude-haiku-4-5': { entrada: 1, salida: 5 },
};
const PRECIO_DEFAULT = PRECIOS['claude-sonnet-4-6'];

function costoUSD(entrada, salida, modelo = 'claude-sonnet-4-6') {
  const clave = Object.keys(PRECIOS).find((k) => String(modelo).startsWith(k));
  const precio = clave ? PRECIOS[clave] : PRECIO_DEFAULT;
  return (entrada * precio.entrada + salida * precio.salida) / 1_000_000;
}

// Guarda el consumo de UNA respuesta del bot. numero = teléfono canónico del
// cliente; si la persona no existe todavía, la fila queda sin persona_id.
async function registrarUso({ numero, modelo, entrada, salida, llamadas }) {
  const { rows } = await pool.query(
    'SELECT id FROM personas WHERE telefono = $1', [numero]
  );
  const personaId = rows[0] ? rows[0].id : null;
  await pool.query(
    `INSERT INTO uso_agente (persona_id, modelo, entrada, salida, llamadas, costo_usd)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [personaId, modelo, entrada, salida, llamadas, costoUSD(entrada, salida, modelo)]
  );
}

// Todo lo que necesita la solapa Costos, en una sola llamada.
const CAMPOS_SUMA = `
  COALESCE(SUM(entrada), 0)::bigint  AS entrada,
  COALESCE(SUM(salida), 0)::bigint   AS salida,
  COALESCE(SUM(costo_usd), 0)::float AS costo,
  COUNT(*)::int                      AS mensajes`;

async function resumenCostos() {
  const [total, mes, porModelo, porDia, porCliente] = await Promise.all([
    pool.query(`SELECT ${CAMPOS_SUMA} FROM uso_agente`),
    pool.query(`SELECT ${CAMPOS_SUMA} FROM uso_agente
                WHERE creado >= date_trunc('month', now())`),
    // Desglose por modelo (para comparar costos cuando se testea otro modelo
    // vía MODELO_AGENTE). Solo aparece más de una fila si hubo cambio.
    pool.query(`SELECT modelo, ${CAMPOS_SUMA} FROM uso_agente
                GROUP BY modelo ORDER BY SUM(costo_usd) DESC`),
    // Últimos 30 días con actividad, día calendario de Argentina.
    pool.query(`
      SELECT to_char(creado AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS dia,
             ${CAMPOS_SUMA}
      FROM uso_agente
      GROUP BY dia ORDER BY dia DESC LIMIT 30`),
    // Acumulado por cliente (la "conversación" de cada persona), más caros primero.
    pool.query(`
      SELECT p.nombre, p.apellido, p.telefono,
             ${CAMPOS_SUMA},
             MAX(u.creado) AS ultimo
      FROM uso_agente u
      LEFT JOIN personas p ON p.id = u.persona_id
      GROUP BY p.id, p.nombre, p.apellido, p.telefono
      ORDER BY SUM(u.costo_usd) DESC
      LIMIT 200`),
  ]);
  return {
    total: total.rows[0],
    mes: mes.rows[0],
    por_modelo: porModelo.rows,
    por_dia: porDia.rows,
    por_cliente: porCliente.rows,
  };
}

// 'YYYY-MM-DD' estricto (lo que manda el panel al clickear una fila de "Por día").
function diaValido(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Desglose por cliente de UN día calendario de Argentina. Alimenta la fila
// expandible de la tabla "Por día" en la solapa Costos.
async function desgloseDia(dia) {
  if (!diaValido(dia)) throw new Error('dia_invalido');
  const { rows } = await pool.query(`
    SELECT p.nombre, p.apellido, p.telefono, ${CAMPOS_SUMA}
    FROM uso_agente u
    LEFT JOIN personas p ON p.id = u.persona_id
    WHERE to_char(u.creado AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') = $1
    GROUP BY p.id, p.nombre, p.apellido, p.telefono
    ORDER BY SUM(u.costo_usd) DESC`,
    [dia]
  );
  return rows;
}

module.exports = { registrarUso, resumenCostos, costoUSD, desgloseDia, diaValido };
