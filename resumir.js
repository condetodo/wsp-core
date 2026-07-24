// ============================================================
// RESÚMENES de conversación. Al terminar una charla, la condensamos con
// Claude Haiku (barato) en 1-3 oraciones y la guardamos en `resumenes`,
// ligada a la persona. Después limpiamos el historial crudo. El resumen se
// re-inyecta como contexto en la próxima conversación (ver clientes.js).
//
// Dos disparadores: el agente detecta el cierre (tool cerrar_conversacion)
// o el cron de inactividad (/tareas/resumir-inactivas). Un solo resumen.
// ============================================================
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('./db');
const { obtener } = require('./historial');
const { buscarOcrearPersona } = require('./clientes');

const client = new Anthropic();

// Haiku: tarea fácil (resumir) → modelo barato.
const MODELO_RESUMEN = 'claude-haiku-4-5-20251001';

// No resumimos charlas triviales (un saludo suelto y nada más).
const MIN_MENSAJES = 2;

const SYSTEM_RESUMEN =
  'Resumí esta conversación de WhatsApp entre un cliente y el asistente virtual de ' +
  'un negocio, en 1 a 3 oraciones. Enfocate en: qué necesitaba el cliente, qué ' +
  'se resolvió o quedó pendiente, y datos útiles para la próxima vez. ' +
  'Español rioplatense, breve y concreto. No inventes datos.';

// Arma el system del resumidor ANCLADO a la fecha de hoy. Sin esto, el modelo
// resume "mañana"/"el sábado" tal cual y esas fechas relativas derivan cuando el
// resumen se lee en otra fecha (bug del turno que "se corría" solo). PURA.
function sistemaResumen(ahora = new Date()) {
  const tz = 'America/Argentina/Buenos_Aires';
  const legible = new Intl.DateTimeFormat('es-AR', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(ahora);
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora);
  return SYSTEM_RESUMEN +
    ` Hoy es ${legible} (${iso}). IMPORTANTE: NO uses fechas relativas como "hoy", ` +
    '"mañana" o "el sábado" en el resumen; convertí SIEMPRE a la fecha concreta y ' +
    'absoluta (ej: "el sábado 27 de junio de 2026"), porque este resumen se va a leer ' +
    'en otra fecha.';
}

// Pasa el historial [{role, content}] a un texto legible. PURA.
function construirTextoConversacion(mensajes) {
  return mensajes
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Agente'}: ${m.content}`)
    .join('\n');
}

// Llama a Haiku y devuelve el resumen (string).
async function generarResumen(mensajes) {
  const resp = await client.messages.create({
    model: MODELO_RESUMEN,
    max_tokens: 256,
    system: sistemaResumen(),
    messages: [{ role: 'user', content: construirTextoConversacion(mensajes) }],
  });
  return resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Resume la conversación de un número, la guarda y limpia el historial crudo.
// Devuelve { resumido: true, resumen } o { resumido: false, motivo }.
async function resumirConversacion(numero) {
  const mensajes = await obtener(numero);
  if (mensajes.length < MIN_MENSAJES) return { resumido: false, motivo: 'pocos_mensajes' };

  const { persona } = await buscarOcrearPersona(numero);
  const rango = await pool.query(
    'SELECT MIN(creado) AS desde, MAX(creado) AS hasta FROM historial WHERE persona_id = $1',
    [persona.id]
  );
  const resumen = await generarResumen(mensajes);

  await pool.query(
    'INSERT INTO resumenes (persona_id, resumen, desde, hasta) VALUES ($1, $2, $3, $4)',
    [persona.id, resumen, rango.rows[0].desde, rango.rows[0].hasta]
  );
  await pool.query('DELETE FROM historial WHERE persona_id = $1', [persona.id]);

  return { resumido: true, resumen };
}

// Resume todas las conversaciones inactivas hace más de `minutos`.
async function resumirInactivas(minutos = 120) {
  const { rows } = await pool.query(
    `SELECT p.telefono AS numero
       FROM historial h
       JOIN personas p ON p.id = h.persona_id
      GROUP BY p.telefono
     HAVING MAX(h.creado) < now() - ($1 || ' minutes')::interval
        AND COUNT(*) >= $2`,
    [String(minutos), MIN_MENSAJES]
  );
  let resumidas = 0;
  for (const r of rows) {
    const res = await resumirConversacion(r.numero);
    if (res.resumido) resumidas++;
  }
  return { candidatas: rows.length, resumidas };
}

module.exports = {
  construirTextoConversacion,
  sistemaResumen,
  generarResumen,
  resumirConversacion,
  resumirInactivas,
};
