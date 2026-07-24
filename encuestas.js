// ============================================================
// ENCUESTAS de satisfacción por WhatsApp.
// La encuesta se CREA desde el panel (solapa Encuestas) como una plantilla
// más, con botones de respuesta rápida definidos por el negocio. La plantilla
// es_encuesta más reciente es "la encuesta activa": sus botones definen qué
// respuestas esperamos en el webhook y cómo se calcula el CSAT.
//
// Regla de los botones: van DE MEJOR A PEOR. Todos cuentan como respuesta
// positiva salvo el ÚLTIMO (la peor). Con [Excelente, Buena, Mala]:
// CSAT = (Excelente + Buena) / total.
// ============================================================
const { pool } = require('./db');
const { normalizar } = require('./contactos');
const { crearTemplate } = require('./meta-templates');
const { crearPlantilla, listarPlantillas } = require('./plantillas');

// Valores por defecto (los usa la URL /tareas/crear-encuesta y el script de
// consola; el formulario del panel manda los suyos).
const TEMPLATE_ENCUESTA = 'encuesta_service';
const TEMPLATE_IDIOMA = 'es_AR';
const OPCIONES = ['Excelente', 'Buena', 'Mala'];

// Normaliza el campo botones (jsonb puede venir como array o string). PURA.
function botonesDe(plantilla) {
  if (!plantilla) return [];
  const b = plantilla.botones;
  if (Array.isArray(b)) return b;
  try { return JSON.parse(b || '[]'); } catch (e) { return []; }
}

// La plantilla de encuesta vigente (la más reciente marcada es_encuesta),
// o null si todavía no se creó ninguna.
async function encuestaActiva() {
  const { rows } = await pool.query(
    `SELECT id, nombre, idioma, estado, cuerpo, botones
       FROM plantillas WHERE es_encuesta = true ORDER BY id DESC LIMIT 1`
  );
  return rows[0] || null;
}

// % redondeado de parte sobre total, o null si no hay total. PURA.
function porcentaje(parte, total) {
  return total ? Math.round((parte / total) * 100) : null;
}

// CSAT = % de respuestas positivas (todas las opciones menos la última).
// conteo: { [textoBoton]: n }, botones: array de mejor a peor. PURA.
function csatDe(conteo = {}, botones = []) {
  const n = (k) => Number(conteo[k]) || 0;
  const total = botones.reduce((a, b) => a + n(b), 0);
  const positivas = botones.slice(0, -1).reduce((a, b) => a + n(b), 0);
  return porcentaje(positivas, total);
}

// ¿El texto de un botón tocado es una respuesta de la encuesta? Devuelve el
// texto canónico del botón o null (podría ser un botón de otro template). PURA.
function interpretarRespuesta(texto, botones = []) {
  const t = String(texto === undefined || texto === null ? '' : texto).trim().toLowerCase();
  return botones.find((b) => String(b).trim().toLowerCase() === t) || null;
}

// ¿Es la peor opción (el último botón)? PURA.
function esNegativa(respuesta, botones = []) {
  return botones.length > 0 && respuesta === botones[botones.length - 1];
}

// Texto con el que agradecemos según la respuesta. PURA.
function textoAgradecimiento(respuesta, botones = []) {
  if (esNegativa(respuesta, botones)) {
    return 'Gracias por contarnos. Lamentamos que la experiencia no haya sido buena 🙏 ' +
      'Si querés contarnos qué pasó, respondé este mensaje y lo vemos con el equipo.';
  }
  return '¡Gracias por tu respuesta! 🙌 Nos ayuda a mejorar. Cualquier cosa que necesites, escribinos por acá.';
}

// Guarda (o pisa) la respuesta del cliente. wamid = id del mensaje de encuesta
// original (viene en context.id del botón); si el cliente vuelve a tocar un
// botón del mismo mensaje, se actualiza en vez de duplicar.
async function registrarRespuesta({ telefono, respuesta, wamid }) {
  const numero = normalizar(telefono);
  const p = await pool.query('SELECT id FROM personas WHERE telefono = $1', [numero]);
  const personaId = p.rows.length ? p.rows[0].id : null;
  await pool.query(
    `INSERT INTO encuestas (persona_id, telefono, respuesta, wamid_contexto)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telefono, wamid_contexto)
     DO UPDATE SET respuesta = EXCLUDED.respuesta, creado = now()`,
    [personaId, numero, respuesta, wamid || null]
  );
}

// Todo lo que necesita la solapa Encuestas, en una sola llamada: total y
// conteo por opción (según los botones de la encuesta activa), últimas
// respuestas, CSAT, tasa de respuesta y corte por campaña (las respuestas se
// atan a su campaña cruzando el wamid enviado con el context.id del botón).
async function resumenPanelEncuestas(dias = 30) {
  const d = Math.max(1, Math.min(365, Number(dias) || 30));
  const activa = await encuestaActiva();
  const botones = botonesDe(activa);

  const porRespuesta = await pool.query(
    `SELECT respuesta, COUNT(*)::int AS n
       FROM encuestas
      WHERE creado >= now() - make_interval(days => $1)
      GROUP BY 1`,
    [d]
  );
  const conteo = Object.fromEntries(botones.map((b) => [b, 0]));
  for (const r of porRespuesta.rows) {
    if (r.respuesta in conteo) conteo[r.respuesta] = r.n;
  }
  const total = porRespuesta.rows.reduce((a, r) => a + r.n, 0);

  const ultimas = await pool.query(
    `SELECT e.telefono, e.respuesta, e.creado, p.nombre, p.apellido
       FROM encuestas e
       LEFT JOIN personas p ON p.id = e.persona_id
      WHERE e.creado >= now() - make_interval(days => $1)
      ORDER BY e.id DESC
      LIMIT 20`,
    [d]
  );

  // Encuestas ENVIADAS en el período (envíos exitosos de campañas de encuesta).
  const env = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM envios e
       JOIN campanias c ON c.id = e.campania_id
       JOIN plantillas p ON p.id = c.plantilla_id
      WHERE p.es_encuesta = true AND e.estado = 'enviado'
        AND e.creado >= now() - make_interval(days => $1)`,
    [d]
  );
  const enviadas = env.rows[0].n;

  // Corte por campaña, SIN filtro de período (una campaña vieja puede seguir
  // recibiendo respuestas). Las positivas se calculan con los botones de LA
  // PLANTILLA DE ESA CAMPAÑA (si cambiaste la encuesta, cada una usa la suya).
  const camp = await pool.query(
    `SELECT c.id, c.creada, p.nombre AS plantilla,
            COUNT(e.id) FILTER (WHERE e.estado = 'enviado')::int AS enviadas,
            COUNT(q.id)::int AS respondieron,
            COUNT(q.id) FILTER (
              WHERE jsonb_array_length(p.botones) > 0
                AND q.respuesta <> p.botones->>(jsonb_array_length(p.botones) - 1)
            )::int AS positivas
       FROM campanias c
       JOIN plantillas p ON p.id = c.plantilla_id
       LEFT JOIN envios e ON e.campania_id = c.id
       LEFT JOIN encuestas q ON e.wamid IS NOT NULL AND q.wamid_contexto = e.wamid
      WHERE p.es_encuesta = true
      GROUP BY c.id, c.creada, p.nombre, p.botones
      ORDER BY c.id DESC
      LIMIT 20`
  );

  return {
    dias: d,
    activa: activa ? { id: activa.id, nombre: activa.nombre, estado: activa.estado } : null,
    total,
    porOpcion: botones.map((b) => ({ respuesta: b, n: conteo[b] })),
    csat: csatDe(conteo, botones),
    enviadas,
    tasaRespuesta: porcentaje(total, enviadas),
    ultimas: ultimas.rows.map((r) => ({
      telefono: r.telefono,
      cliente: [r.nombre, r.apellido].filter(Boolean).join(' ') || null,
      respuesta: r.respuesta,
      creado: r.creado,
    })),
    porCampania: camp.rows.map((c) => ({
      id: c.id,
      creada: c.creada,
      plantilla: c.plantilla,
      enviadas: c.enviadas,
      respondieron: c.respondieron,
      tasa: porcentaje(c.respondieron, c.enviadas),
      csat: porcentaje(c.positivas, c.respondieron),
    })),
  };
}

// Registra la encuesta POR DEFECTO (cuerpo y botones estándar). La usan la URL
// /tareas/crear-encuesta y el script de consola; el formulario del panel crea
// la suya propia vía POST /panel/api/plantillas con es_encuesta=true.
async function registrarTemplateEncuesta() {
  const CUERPO =
    'Hola {{1}}! 👋 Queremos saber cómo fue tu experiencia con nosotros. ' +
    'Tocá una opción y contanos.';
  const r = await crearTemplate({
    nombre: TEMPLATE_ENCUESTA,
    idioma: TEMPLATE_IDIOMA,
    categoria: 'UTILITY',
    cuerpo: CUERPO,
    ejemplos: ['Juan'],
    botones: OPCIONES,
  });

  // 2388024 = "ya existe contenido en este idioma": el template ya estaba en
  // Meta (ej: se disparó dos veces). No es un error para nosotros.
  const yaExistiaEnMeta = !r.ok && JSON.stringify(r.data || {}).includes('2388024');
  if (!r.ok && !yaExistiaEnMeta) {
    return { ok: false, error: 'meta_rechazo', detalle: r.data };
  }

  let altaLocal = false;
  const existentes = await listarPlantillas();
  if (!existentes.some((p) => p.nombre === TEMPLATE_ENCUESTA)) {
    await crearPlantilla({
      nombre: TEMPLATE_ENCUESTA,
      idioma: TEMPLATE_IDIOMA,
      categoria: 'UTILITY',
      cuerpo: CUERPO,
      variables: [{ n: 1, campo: 'nombre' }],
      meta_id: (r.data && r.data.id) || null,
      botones: OPCIONES,
      es_encuesta: true,
    });
    altaLocal = true;
  }

  return { ok: true, yaExistiaEnMeta, altaLocal, meta: r.data };
}

module.exports = {
  TEMPLATE_ENCUESTA, TEMPLATE_IDIOMA, OPCIONES,
  botonesDe, encuestaActiva, porcentaje, csatDe,
  interpretarRespuesta, esNegativa, textoAgradecimiento,
  registrarRespuesta, resumenPanelEncuestas, registrarTemplateEncuesta,
};
