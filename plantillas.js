// ============================================================
// Dominio de Plantillas + Envío masivo.
// Funciones PURAS (render de variables, mapeo cliente→variable, filtrado)
// + capa DB de las tablas plantillas/campanias/envios.
// ============================================================

const { pool } = require('./db');

// Reemplaza {{1}}, {{2}}, ... por valores[0], valores[1], ...
// Si falta el valor, deja string vacío (no rompe el envío).
function renderVariables(cuerpo, valores = []) {
  return String(cuerpo).replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = valores[Number(n) - 1];
    return v === undefined || v === null ? '' : String(v);
  });
}

// Arma el array de valores para una plantilla, ordenado por número de variable.
// variables: [{n, campo}], cliente: objeto plano con esos campos.
function valoresDesdeCliente(cliente, variables = []) {
  return [...variables]
    .sort((a, b) => a.n - b.n)
    .map((v) => {
      const valor = cliente ? cliente[v.campo] : null;
      return valor === undefined || valor === null ? '' : String(valor);
    });
}

// Normaliza un valor de campo para comparar (string, trim, minúsculas).
function valorCampo(persona, campo) {
  const v = persona ? persona[campo] : null;
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
}

// ¿La persona cumple UNA condición? campo + op + valor.
// Ops de texto: 'es' (exacto), 'contiene', 'vacio', 'no_vacio'. Valor vacío en
// 'es'/'contiene' se ignora (la condición no filtra). Los campos disponibles
// son los que devuelve destinatariosBase(); si el vertical suma columnas,
// las condiciones las pueden usar sin tocar este motor.
function cumpleCondicion(persona, c) {
  if (!c || !c.campo) return true;
  const campoVal = valorCampo(persona, c.campo);
  const objetivo = String(c.valor === undefined || c.valor === null ? '' : c.valor).trim().toLowerCase();
  switch (c.op) {
    case 'contiene': return objetivo === '' ? true : campoVal.includes(objetivo);
    case 'vacio':    return campoVal === '';
    case 'no_vacio': return campoVal !== '';
    default:         return objetivo === '' ? true : campoVal === objetivo; // 'es'
  }
}

// Filtra la base de destinatarios.
// base: [{id, nombre, apellido, telefono, correo, ...campos del vertical}]
// filtro: { condiciones:[{campo,op,valor}], ids:[...] } (condiciones con AND;
//   ids = selección manual que restringe el resultado). Sin condiciones = toda la base.
function filtrarDestinatarios(base = [], filtro = {}) {
  // Condiciones AND + ids (selección manual).
  let r = [...base];
  for (const c of (filtro.condiciones || [])) r = r.filter((p) => cumpleCondicion(p, c));
  if (Array.isArray(filtro.ids)) {
    const ids = new Set(filtro.ids.map(Number));
    r = r.filter((p) => ids.has(Number(p.id)));
  }
  return r;
}

// --- Capa DB: plantillas -------------------------------------------------

// Inserta una plantilla local (estado inicial PENDING). variables es el
// mapeo [{n, campo}]. Devuelve la fila creada.
async function crearPlantilla({ nombre, idioma, categoria, cuerpo, variables, meta_id, header, botones, es_encuesta }) {
  const tipo = header && header.buffer ? 'IMAGE' : 'TEXT';
  const { rows } = await pool.query(
    `INSERT INTO plantillas (nombre, idioma, categoria, cuerpo, variables, meta_id, estado, header_tipo, header_mime, header_img, botones, es_encuesta)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9, $10, $11)
     RETURNING id, nombre, idioma, categoria, cuerpo, variables, estado, meta_id, header_tipo, botones, es_encuesta, creado`,
    [nombre, idioma || 'es_AR', categoria || 'MARKETING', cuerpo, JSON.stringify(variables || []), meta_id || null,
     tipo, header ? header.mime : null, header ? header.buffer : null,
     JSON.stringify(botones || []), !!es_encuesta]
  );
  return rows[0];
}

// Lista todas las plantillas (más nuevas primero). NO trae header_img (bytes
// pesados): sólo header_tipo para que la UI sepa si tiene imagen.
async function listarPlantillas() {
  const { rows } = await pool.query(
    `SELECT id, nombre, idioma, categoria, cuerpo, variables, estado, meta_id, header_tipo, botones, es_encuesta, creado
       FROM plantillas ORDER BY id DESC`
  );
  return rows;
}

// Actualiza el estado cacheado de una plantilla por nombre (lo que devuelve Meta).
async function actualizarEstadoPorNombre(nombre, estado) {
  await pool.query('UPDATE plantillas SET estado = $1 WHERE nombre = $2', [estado, nombre]);
}

// Una plantilla por id.
async function obtenerPlantilla(id) {
  const { rows } = await pool.query('SELECT * FROM plantillas WHERE id = $1', [id]);
  return rows[0] || null;
}

// --- Capa DB: destinatarios + campañas + envíos --------------------------

// Lista base de destinatarios: una fila por persona con teléfono. Si el
// vertical quiere segmentar por sus datos (ej. modelo del auto), agrega acá
// sus columnas: filtros y variables de template los levantan solos.
async function destinatariosBase() {
  const { rows } = await pool.query(`
    SELECT p.id, p.nombre, p.apellido, p.telefono, p.correo
      FROM personas p
     WHERE p.telefono IS NOT NULL
     ORDER BY p.id
  `);
  return rows;
}

// Crea la campaña y devuelve su fila.
async function crearCampania({ plantilla_id, filtro, total, creada_por }) {
  const { rows } = await pool.query(
    `INSERT INTO campanias (plantilla_id, filtro, total, creada_por)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [plantilla_id, JSON.stringify(filtro || {}), total || 0, creada_por || null]
  );
  return rows[0];
}

// Registra el resultado de UN envío. El índice único (campania_id, persona_id)
// evita duplicados: si ya existe, ON CONFLICT lo ignora y devuelve false.
async function registrarEnvio({ campania_id, persona_id, numero, estado, detalle, wamid }) {
  const { rows } = await pool.query(
    `INSERT INTO envios (campania_id, persona_id, numero, estado, detalle, wamid)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (campania_id, persona_id) DO NOTHING
     RETURNING id`,
    [campania_id, persona_id, numero, estado, detalle || null, wamid || null]
  );
  return rows.length > 0; // true = se registró, false = ya existía
}

// Cierra la campaña con sus contadores finales.
async function cerrarCampania(id, { enviados, errores }) {
  await pool.query(
    `UPDATE campanias SET enviados = $1, errores = $2, estado = 'terminada' WHERE id = $3`,
    [enviados, errores, id]
  );
}

// Historial de campañas (más nuevas primero), con el nombre de la plantilla.
// Para el listado del panel: no trae el detalle por destinatario (eso va en
// detalleCampania). LEFT JOIN por si la plantilla fue borrada después.
async function listarCampanias() {
  const { rows } = await pool.query(`
    SELECT c.id, c.total, c.enviados, c.errores, c.estado, c.creada_por, c.creada,
           p.nombre AS plantilla_nombre
      FROM campanias c
      LEFT JOIN plantillas p ON p.id = c.plantilla_id
     ORDER BY c.id DESC
  `);
  return rows;
}

// Detalle de UNA campaña: su cabecera + una fila por destinatario (con el
// nombre de la persona). Devuelve null si la campaña no existe.
async function detalleCampania(id) {
  const cab = await pool.query(`
    SELECT c.id, c.total, c.enviados, c.errores, c.estado, c.creada_por, c.creada,
           p.nombre AS plantilla_nombre
      FROM campanias c
      LEFT JOIN plantillas p ON p.id = c.plantilla_id
     WHERE c.id = $1
  `, [id]);
  if (!cab.rows.length) return null;

  const det = await pool.query(`
    SELECT e.persona_id, e.numero, e.estado, e.detalle, e.wamid, e.creado,
           per.nombre, per.apellido
      FROM envios e
      LEFT JOIN personas per ON per.id = e.persona_id
     WHERE e.campania_id = $1
     ORDER BY e.estado, e.id
  `, [id]);

  return { campania: cab.rows[0], envios: det.rows };
}

module.exports = {
  renderVariables, valoresDesdeCliente, filtrarDestinatarios,
  crearPlantilla, listarPlantillas, actualizarEstadoPorNombre, obtenerPlantilla,
  destinatariosBase, crearCampania, registrarEnvio, cerrarCampania,
  listarCampanias, detalleCampania,
};
