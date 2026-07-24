// ============================================================
// Identificación del cliente y armado del "contexto 360" que se le inyecta
// al agente para que sepa con quién habla (perfil, datos del negocio, último
// resumen). El cruce es por teléfono (forma canónica 549..., ver
// contactos.normalizar). El MECANISMO es core; QUÉ datos del negocio se
// suman al perfil lo define cada cliente en cliente/contexto360.js.
// ============================================================
const { pool } = require('./db');
const { normalizar } = require('./contactos');
const { tomarCaso, abrirCasoTomado, mejorEsfuerzo } = require('./casos');
const contexto360 = require('./cliente/contexto360');

// Pasa una fecha 'YYYY-MM-DD' (o Date) a algo legible en español, con día de la
// semana: "sábado, 27 de junio de 2026". Mediodía UTC para que el día no se
// corra por zona horaria. PURA.
function fechaLegible(fecha) {
  const iso = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);
  const d = new Date(iso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(d);
}

// Construye el bloque de contexto para el system prompt a partir de datos
// YA consultados. Función PURA: no toca la base.
function render360(datos) {
  if (!datos || !datos.esConocido) {
    return 'CLIENTE NUEVO: todavía no tenemos sus datos en el sistema. ' +
      'Presentate, atendé su consulta y averiguá con naturalidad su nombre. ' +
      'Guardá lo que te diga con guardar_datos_cliente, así la próxima vez ya lo conocemos.';
  }
  const p = datos.persona || {};
  const nombre = [p.nombre, p.apellido].filter(Boolean).join(' ') || 'sin nombre registrado';
  const lineas = [];
  lineas.push('PERFIL DEL CLIENTE (ya lo conocés; NO preguntes datos que ya figuran acá):');
  lineas.push(`- Nombre: ${nombre}`);

  // Las líneas del NEGOCIO (lo que este vertical sabe del cliente) las define
  // cada cliente en cliente/contexto360.js.
  lineas.push(...contexto360.renderNegocio(datos));

  if (datos.ultimoResumen) {
    lineas.push(`- Resumen de la última conversación: ${datos.ultimoResumen}`);
  }

  return lineas.join('\n');
}

// Campos de la persona que el agente puede guardar desde la charla. Recorta
// espacios, descarta vacíos y valida lo mínimo (correo con @). PURA.
function datosPersonaLimpios(datos = {}) {
  const limpios = {};
  for (const campo of ['nombre', 'apellido', 'correo']) {
    const v = typeof datos[campo] === 'string' ? datos[campo].trim() : '';
    if (!v) continue;
    if (campo === 'correo' && !v.includes('@')) continue;
    limpios[campo] = v;
  }
  return limpios;
}

// Busca la persona por teléfono; si no existe, crea una mínima (solo teléfono).
// Así todo número que escribe tiene persona, y sus resúmenes se le enganchan
// (objetivo: el perfil crece solo). Devuelve { persona, creada }.
async function buscarOcrearPersona(numero) {
  const tel = normalizar(numero);
  const existente = await pool.query('SELECT * FROM personas WHERE telefono = $1', [tel]);
  if (existente.rows.length) return { persona: existente.rows[0], creada: false };

  const nueva = await pool.query(
    `INSERT INTO personas (telefono) VALUES ($1)
     ON CONFLICT (telefono) DO UPDATE SET telefono = EXCLUDED.telefono
     RETURNING *`,
    [tel]
  );
  return { persona: nueva.rows[0], creada: true };
}

// Guarda los datos que el cliente dio en la charla (nombre, apellido, correo).
// Solo pisa los campos provistos; los demás quedan como estaban.
async function actualizarPersona(numero, datos) {
  const limpios = datosPersonaLimpios(datos);
  const campos = Object.keys(limpios);
  if (!campos.length) return { ok: false, motivo: 'sin_datos' };

  const { persona } = await buscarOcrearPersona(numero);
  const sets = campos.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE personas SET ${sets} WHERE id = $1`, [
    persona.id, ...campos.map((c) => limpios[c]),
  ]);
  return { ok: true, guardado: limpios };
}

// Junta todo lo que sabemos del cliente: perfil, datos del negocio (los define
// cliente/contexto360.js) y el último resumen. esConocido = tiene nombre o el
// vertical lo reconoce (ej: tiene un vehículo registrado).
async function obtenerDatos360(numero) {
  const { persona } = await buscarOcrearPersona(numero);

  const negocio = await contexto360.datosNegocio(pool, persona);

  const res = await pool.query(
    'SELECT resumen FROM resumenes WHERE persona_id = $1 ORDER BY creado DESC LIMIT 1',
    [persona.id]
  );

  return {
    persona,
    ...negocio,
    esConocido: Boolean(persona.nombre) || Boolean(negocio.esConocido),
    ultimoResumen: res.rows.length ? res.rows[0].resumen : null,
  };
}

// Conveniencia para el webhook: datos + texto listo para el system prompt.
async function perfilParaAgente(numero) {
  const datos = await obtenerDatos360(numero);
  return { datos, perfil: render360(datos) };
}

// ¿El cliente está en manos de un asesor (y todavía no venció el timeout)? PURA.
function enAsesorActivo(persona, horasTimeout = 24, ahora = new Date()) {
  if (!persona || !persona.en_asesor) return false;
  if (!persona.en_asesor_desde) return true; // marcado sin fecha -> activo
  const limite = new Date(persona.en_asesor_desde).getTime() + horasTimeout * 3600 * 1000;
  return ahora.getTime() < limite;
}

// Marca al cliente como "en manos de un asesor" (silencia al bot).
async function marcarEnAsesor(numero) {
  await pool.query(
    'UPDATE personas SET en_asesor = true, en_asesor_desde = now() WHERE telefono = $1',
    [normalizar(numero)]
  );
}

// Reactiva al bot para ese cliente y limpia la asignación.
async function reactivar(numero) {
  await pool.query(
    `UPDATE personas
        SET en_asesor = false, en_asesor_desde = null,
            atendido_por = null, atendido_desde = null
      WHERE telefono = $1`,
    [normalizar(numero)]
  );
}

// Estado de asignación de un cliente. PURA.
// null = no derivado; 'en_espera' = derivado sin tomar; 'en_atencion' = lo tomó alguien.
function estadoAsignacion(persona) {
  if (!persona || !persona.en_asesor) return null;
  return persona.atendido_por ? 'en_atencion' : 'en_espera';
}

// Lista los clientes derivados (en_asesor=true), para el panel.
async function listarDerivados() {
  const { rows } = await pool.query(
    `SELECT telefono, nombre, apellido, en_asesor, atendido_por, atendido_desde, en_asesor_desde
       FROM personas
      WHERE en_asesor = true
      ORDER BY en_asesor_desde ASC NULLS LAST`
  );
  return rows;
}

// Intenta que 'usuario' tome al cliente. ATÓMICO: solo si está en espera.
// Devuelve true si lo tomó; false si ya estaba tomado (carrera).
async function tomar(numero, usuario) {
  const tel = normalizar(numero);
  const { rowCount } = await pool.query(
    `UPDATE personas SET atendido_por = $2, atendido_desde = now()
      WHERE telefono = $1 AND en_asesor = true AND atendido_por IS NULL`,
    [tel, usuario]
  );
  // Mejor esfuerzo: las métricas nunca frenan el flujo real.
  if (rowCount === 1) await mejorEsfuerzo(tomarCaso(tel, usuario));
  return rowCount === 1;
}

// Conversaciones activas con el BOT: no derivadas y con mensaje del cliente en
// las últimas `horas` horas (coincide con la ventana de 24 hs de WhatsApp).
// ultimo_mensaje es epoch en ms. Para la sección "En conversación" del panel.
async function listarEnBot(horas = 24) {
  const desde = Date.now() - horas * 3600 * 1000;
  const { rows } = await pool.query(
    `SELECT telefono, nombre, apellido, ultimo_mensaje
       FROM personas
      WHERE en_asesor = false AND ultimo_mensaje >= $1
      ORDER BY ultimo_mensaje DESC`,
    [desde]
  );
  return rows;
}

// El asesor interviene una conversación que estaba con el bot: la deriva y la
// toma en un solo paso (el bot se calla, ver webhook). ATÓMICO: solo si todavía
// no estaba derivada; false si otro asesor intervino primero (carrera).
async function intervenir(numero, usuario) {
  const tel = normalizar(numero);
  const { rowCount } = await pool.query(
    `UPDATE personas
        SET en_asesor = true, en_asesor_desde = now(),
            atendido_por = $2, atendido_desde = now()
      WHERE telefono = $1 AND en_asesor = false`,
    [tel, usuario]
  );
  // Mejor esfuerzo: las métricas nunca frenan el flujo real.
  if (rowCount === 1) await mejorEsfuerzo(abrirCasoTomado(tel, usuario));
  return rowCount === 1;
}

module.exports = {
  fechaLegible,
  render360,
  datosPersonaLimpios,
  actualizarPersona,
  buscarOcrearPersona,
  obtenerDatos360,
  perfilParaAgente,
  enAsesorActivo,
  marcarEnAsesor,
  reactivar,
  estadoAsignacion,
  listarDerivados,
  tomar,
  listarEnBot,
  intervenir,
};
