// ============================================================
// Memoria de CONVERSACIÓN por cliente.
// La API de Claude no recuerda nada entre llamadas: cada vez le mandamos
// el historial completo. Vive en Postgres (ver db.js), cruzado por persona_id
// (la persona es la fuente de verdad del número, igual que el resto del CRM).
//
// Formato que espera Claude: un array de mensajes con { role, content }
//   role: 'user'      = lo que dijo el cliente
//   role: 'assistant' = lo que respondió la IA
// ============================================================
const { pool } = require('./db');
const { normalizar } = require('./contactos'); // misma forma canónica de números
const { buscarOcrearPersona } = require('./clientes');

// Cuántos mensajes RETENEMOS por cliente (para el panel). El agente igual lee menos.
const MAX_MENSAJES = 100;

// Resuelve numero -> persona_id SOLO si la persona ya existe (no la crea).
// Para LECTURAS: un número desconocido devuelve null -> historial vacío.
async function idPersona(numero) {
  const { rows } = await pool.query(
    'SELECT id FROM personas WHERE telefono = $1',
    [normalizar(numero)]
  );
  return rows.length ? rows[0].id : null;
}

// Agrega un mensaje al historial y poda los más viejos.
// autor ('bot'|'asesor'|null) es solo para mostrar en el panel; no afecta al agente.
// En ESCRITURA garantizamos la persona (get-or-create) para no violar la FK.
async function agregar(numero, rol, texto, autor = null) {
  const { persona } = await buscarOcrearPersona(numero);

  await pool.query(
    'INSERT INTO historial (persona_id, rol, contenido, autor) VALUES ($1, $2, $3, $4)',
    [persona.id, rol, texto, autor]
  );

  await pool.query(
    `DELETE FROM historial
     WHERE persona_id = $1
       AND id NOT IN (
         SELECT id FROM historial
         WHERE persona_id = $1
         ORDER BY id DESC
         LIMIT $2
       )`,
    [persona.id, MAX_MENSAJES]
  );
}

// Devuelve el historial (array { role, content }) en orden cronológico.
// limite: el agente usa 20 (barato); el panel pide 100 (charla completa).
async function obtener(numero, limite = 20) {
  const pid = await idPersona(numero);
  if (pid == null) return [];

  const { rows } = await pool.query(
    `SELECT rol, contenido FROM (
       SELECT id, rol, contenido FROM historial
       WHERE persona_id = $1
       ORDER BY id DESC
       LIMIT $2
     ) sub
     ORDER BY id ASC`,
    [pid, limite]
  );

  return rows.map((r) => ({ role: r.rol, content: r.contenido }));
}

// Para el panel: trae hasta 100 mensajes con autor y orden cronológico.
async function obtenerParaPanel(numero, limite = 100) {
  const pid = await idPersona(numero);
  if (pid == null) return [];

  const { rows } = await pool.query(
    `SELECT rol, contenido, autor, creado FROM (
       SELECT id, rol, contenido, autor, creado FROM historial
       WHERE persona_id = $1
       ORDER BY id DESC
       LIMIT $2
     ) sub
     ORDER BY id ASC`,
    [pid, limite]
  );
  return rows;
}

module.exports = { agregar, obtener, obtenerParaPanel };
