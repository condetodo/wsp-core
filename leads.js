// ============================================================
// CALIFICACIÓN DE LEADS (core, sirve para cualquier vertical).
// El agente puntúa al cliente del 1 al 5 con la tool calificar_lead; acá se
// guarda esa calificación y, si cruza el umbral, se avisa a los vendedores.
//
// El aviso NO silencia al bot. El cliente nunca pidió hablar con un humano:
// si lo calláramos, se quedaría esperando a que alguien entre al panel. Los
// vendedores intervienen cuando quieren, con clientes.intervenir.
// ============================================================
const { pool } = require('./db');
const { leerConfig } = require('./config');
const { listarConEmail } = require('./asesores');
const { avisarLeadPorMail } = require('./avisos');
const { buscarOcrearPersona } = require('./clientes');

// Ventana de silencio entre avisos de un mismo lead.
const HORAS_SILENCIO = 24;
const UMBRAL_DEFAULT = 4;

// ¿Corresponde avisarle a los vendedores? PURA.
//
// Avisa si el puntaje llega al umbral Y además pasa alguna de estas: nunca se
// avisó, el puntaje subió respecto del último aviso, o ya pasaron las horas de
// silencio. Sin esta lógica cada mensaje del lead caliente dispararía otra
// alerta y los vendedores silenciarían el aviso en una semana, que es la forma
// más rápida de perder también los leads buenos.
function debeAvisar({ puntaje, umbral, ultimo, ahora = new Date() }) {
  if (typeof puntaje !== 'number' || !Number.isFinite(puntaje)) return false;
  if (puntaje < umbral) return false;
  if (!ultimo) return true;
  if (puntaje > ultimo.puntaje) return true;
  const limite = new Date(ultimo.creado).getTime() + HORAS_SILENCIO * 3600 * 1000;
  return ahora.getTime() >= limite;
}

// Umbral configurable desde el panel (tabla config). Si la lectura falla o el
// valor está roto, caemos al default: la calificación nunca puede tirar abajo
// la conversación.
async function umbralActivo() {
  try {
    const v = Number(await leerConfig('umbral_lead'));
    return Number.isInteger(v) && v >= 1 && v <= 5 ? v : UMBRAL_DEFAULT;
  } catch (err) {
    console.error('⚠️  No se pudo leer umbral_lead:', err.message);
    return UMBRAL_DEFAULT;
  }
}

// Última calificación de esta persona que EFECTIVAMENTE avisó. Es contra esa
// que se mide el anti-repetición: si midiéramos contra la última calificación
// a secas, un puntaje bajo intermedio "reiniciaría" el silencio.
async function ultimoAviso(personaId) {
  const { rows } = await pool.query(
    `SELECT puntaje, creado FROM calificaciones
      WHERE persona_id = $1 AND avisado = true
      ORDER BY creado DESC LIMIT 1`,
    [personaId]
  );
  return rows[0] || null;
}

// Guarda la calificación y, si corresponde, avisa a los vendedores por mail.
async function calificar(numero, { puntaje, motivo, interes } = {}) {
  const p = Number(puntaje);
  if (!Number.isInteger(p) || p < 1 || p > 5) {
    return { ok: false, motivo: 'puntaje_invalido' };
  }

  const { persona } = await buscarOcrearPersona(numero);
  const [ultimo, umbral] = await Promise.all([ultimoAviso(persona.id), umbralActivo()]);
  const avisar = debeAvisar({ puntaje: p, umbral, ultimo });

  await pool.query(
    `INSERT INTO calificaciones (persona_id, puntaje, motivo, interes, avisado)
     VALUES ($1, $2, $3, $4, $5)`,
    [persona.id, p, motivo || null, interes || null, avisar]
  );

  if (!avisar) return { ok: true, avisados: 0 };

  const destinos = (await listarConEmail()).map((a) => a.email);
  const r = await avisarLeadPorMail(destinos, {
    nombre: [persona.nombre, persona.apellido].filter(Boolean).join(' ') || null,
    telefono: persona.telefono,
    puntaje: p,
    motivo,
    interes,
  });
  console.log(`🔥 Lead ${persona.telefono} calificado ${p}/5 — avisados ${r.avisados}`);
  return { ok: true, avisados: r.avisados };
}

// Última calificación de cada persona, para el panel. Devuelve un Map por
// telefono para que el listado de conversaciones lo cruce sin otra consulta.
async function ultimasPorPersona() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (c.persona_id) p.telefono, c.puntaje, c.motivo, c.interes, c.creado
       FROM calificaciones c
       JOIN personas p ON p.id = c.persona_id
      ORDER BY c.persona_id, c.creado DESC`
  );
  return new Map(rows.map((r) => [r.telefono, r]));
}

module.exports = {
  debeAvisar, calificar, umbralActivo, ultimoAviso, ultimasPorPersona,
  HORAS_SILENCIO, UMBRAL_DEFAULT,
};
