// ============================================================
// Importa la base de clientes desde un Excel a Postgres.
// Uso:  node importar-clientes.js "ruta/al/archivo.xlsx"
//
// Versión CORE mínima: cada fila del Excel = una persona (contacto).
// Deduplicamos por teléfono. Si el vertical necesita importar más cosas
// (ej. vehículos por patente), extendé parsearFila e importarFilas por cliente.
// ============================================================
const { normalizar } = require('./contactos'); // misma forma canónica de números

// Normaliza un valor de celda: recorta espacios y trata el vacío como null.
function limpiar(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Convierte una fila del Excel (objeto por nombre de columna) en estructuras
// listas para insertar. Función PURA: no toca la base.
function parsearFila(fila) {
  const telCrudo = limpiar(fila['Telefono']);
  return {
    persona: {
      nombre: limpiar(fila['Nombre']),
      apellido: limpiar(fila['Apellido']),
      telefono: telCrudo ? normalizar(telCrudo) : null,
      correo: limpiar(fila['Correo Electronico']),
    },
  };
}

const xlsx = require('xlsx');
const { pool, init } = require('./db');

// Busca o crea una persona por teléfono. Completa nombre/apellido/correo si
// estaban vacíos (no pisa datos ya cargados).
async function upsertPersona(persona) {
  const { rows } = await pool.query(
    `INSERT INTO personas (nombre, apellido, telefono, correo)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telefono) DO UPDATE SET
       nombre   = COALESCE(personas.nombre, EXCLUDED.nombre),
       apellido = COALESCE(personas.apellido, EXCLUDED.apellido),
       correo   = COALESCE(personas.correo, EXCLUDED.correo)
     RETURNING id`,
    [persona.nombre, persona.apellido, persona.telefono, persona.correo]
  );
  return rows[0].id;
}

// Importa un array de filas YA parseadas. Devuelve un resumen con los conteos.
async function importarFilas(filasParseadas) {
  let personas = 0, saltadas = 0;
  for (const f of filasParseadas) {
    // Sin teléfono no hay clave de cruce con WhatsApp: la saltamos.
    if (!f.persona.telefono) { saltadas++; continue; }
    const personaId = await upsertPersona(f.persona);
    if (personaId) personas++;
  }
  return { personas, saltadas };
}

// Lee un .xlsx (primera hoja) y devuelve sus filas como objetos por columna.
function leerExcel(ruta) {
  const libro = xlsx.readFile(ruta);
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return xlsx.utils.sheet_to_json(hoja, { defval: null });
}

module.exports = { limpiar, parsearFila, importarFilas, leerExcel };

// --- CLI: node importar-clientes.js "archivo.xlsx" -----------------------
if (require.main === module) {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error('Uso: node importar-clientes.js "ruta/al/archivo.xlsx"');
    process.exit(1);
  }
  (async () => {
    await init(); // por las dudas, asegura que las tablas existan
    const filas = leerExcel(ruta).map(parsearFila);
    const resumen = await importarFilas(filas);
    console.log('✅ Importación lista:', JSON.stringify(resumen));
    process.exit(0);
  })().catch((err) => {
    console.error('❌ Error importando:', err.message);
    process.exit(1);
  });
}
