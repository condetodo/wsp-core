// ============================================================
// Importa el inventario de propiedades desde un Excel a Postgres.
// Uso:  node importar-propiedades.js "ruta/al/archivo.xlsx"
//
// Es el camino de carga inicial: la inmobiliaria tiene su inventario en una
// planilla y cargar 80 propiedades a mano por el panel no lo hace nadie.
//
// Columnas esperadas (los acentos y las mayúsculas no importan):
//   Operacion, Tipo, Zona, Direccion, Ambientes, Dormitorios, Superficie,
//   Precio, Moneda, Expensas, Estado, Descripcion, Link, Desarrollo
// ============================================================
const { validarPropiedad } = require('./cliente/propiedades');

// Normaliza el nombre de una columna: minúsculas, sin acentos, sin espacios.
// PURA.
function normalizarClave(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca acentos
    .trim().toLowerCase().replace(/[\s_-]+/g, '');
}

// Busca el valor de una columna probando varios nombres posibles. Devuelve
// null si no está. PURA.
//
// Sin esto, un Excel que dice "Operación" (con acento, que es como lo escribe
// cualquiera) no matchearía "Operacion" y la fila entera se descartaría sin
// que nadie entienda por qué.
function valorDe(fila, ...alias) {
  const buscados = alias.map(normalizarClave);
  for (const clave of Object.keys(fila)) {
    if (buscados.includes(normalizarClave(clave))) {
      const v = fila[clave];
      if (v === null || v === undefined || String(v).trim() === '') return null;
      return typeof v === 'string' ? v.trim() : v;
    }
  }
  return null;
}

// Convierte una fila del Excel en una propiedad validada. PURA: no toca la base.
// Devuelve { ok, limpia, desarrollo } o { ok: false, errores }.
function parsearFila(fila) {
  const crudo = {
    operacion: valorDe(fila, 'operacion'),
    tipo: valorDe(fila, 'tipo'),
    zona: valorDe(fila, 'zona', 'barrio', 'localidad'),
    direccion: valorDe(fila, 'direccion'),
    ambientes: valorDe(fila, 'ambientes', 'amb'),
    dormitorios: valorDe(fila, 'dormitorios', 'dorm'),
    superficie_m2: valorDe(fila, 'superficie_m2', 'superficie', 'm2', 'metros'),
    precio: valorDe(fila, 'precio', 'valor'),
    moneda: valorDe(fila, 'moneda'),
    expensas: valorDe(fila, 'expensas'),
    estado: valorDe(fila, 'estado'),
    descripcion: valorDe(fila, 'descripcion', 'observaciones'),
    link: valorDe(fila, 'link', 'url', 'ficha'),
  };

  const v = validarPropiedad(crudo);
  if (!v.ok) return v;

  // El desarrollo viene por NOMBRE en la planilla; el id lo resuelve
  // importarFilas contra la base.
  return { ok: true, limpia: v.limpia, desarrollo: valorDe(fila, 'desarrollo', 'proyecto', 'emprendimiento') };
}

module.exports = { normalizarClave, valorDe, parsearFila };

// --- Todo lo de abajo toca la base o el disco -----------------------------

const xlsx = require('xlsx');

// Lee un .xlsx (primera hoja) y devuelve sus filas como objetos por columna.
function leerExcel(ruta) {
  const libro = xlsx.readFile(ruta);
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return xlsx.utils.sheet_to_json(hoja, { defval: null });
}

// Resuelve el desarrollo por nombre; si no existe, lo crea con el nombre solo.
// Crear es lo correcto acá: si la planilla trae 20 unidades de "Torres del Sol"
// y no creáramos el proyecto, quedarían 20 unidades huérfanas. El resumen final
// informa cuántos se crearon, para que un nombre mal escrito se note.
async function resolverDesarrollo(pool, nombre, cache) {
  if (!nombre) return { id: null, creado: false };
  const clave = normalizarClave(nombre);
  if (cache.has(clave)) return { id: cache.get(clave), creado: false };

  const existente = await pool.query(
    'SELECT id FROM desarrollos WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
    [nombre]
  );
  if (existente.rows.length) {
    cache.set(clave, existente.rows[0].id);
    return { id: existente.rows[0].id, creado: false };
  }

  const nuevo = await pool.query(
    'INSERT INTO desarrollos (nombre) VALUES ($1) RETURNING id', [nombre]
  );
  cache.set(clave, nuevo.rows[0].id);
  return { id: nuevo.rows[0].id, creado: true };
}

// Importa las filas YA parseadas. Devuelve un resumen con los conteos y el
// detalle de lo que se descartó, con el número de fila del Excel para poder
// ir a corregirlo.
async function importarFilas(pool, parseadas) {
  const propiedades = require('./cliente/propiedades');
  const cache = new Map();
  let creadas = 0, saltadas = 0, desarrollosCreados = 0;
  const problemas = [];

  for (let i = 0; i < parseadas.length; i++) {
    const p = parseadas[i];
    const filaExcel = i + 2; // +1 por el encabezado, +1 porque Excel arranca en 1
    if (!p.ok) {
      saltadas++;
      problemas.push({ fila: filaExcel, errores: p.errores });
      continue;
    }
    const des = await resolverDesarrollo(pool, p.desarrollo, cache);
    if (des.creado) desarrollosCreados++;
    await propiedades.crear(pool, { ...p.limpia, desarrollo_id: des.id });
    creadas++;
  }

  return { creadas, saltadas, desarrollosCreados, problemas };
}

module.exports.leerExcel = leerExcel;
module.exports.resolverDesarrollo = resolverDesarrollo;
module.exports.importarFilas = importarFilas;

// --- CLI: node importar-propiedades.js "archivo.xlsx" ---------------------
if (require.main === module) {
  const ruta = process.argv[2];
  if (!ruta) {
    console.error('Uso: node importar-propiedades.js "ruta/al/archivo.xlsx"');
    process.exit(1);
  }
  (async () => {
    const { pool, init } = require('./db');
    await init(); // por las dudas, asegura que las tablas existan
    const filas = leerExcel(ruta).map(parsearFila);
    const r = await importarFilas(pool, filas);
    console.log(`✅ Importadas ${r.creadas} propiedades (${r.desarrollosCreados} desarrollos nuevos).`);
    if (r.saltadas) {
      console.log(`⚠️  ${r.saltadas} filas salteadas:`);
      for (const p of r.problemas) console.log(`   fila ${p.fila}: ${p.errores.join(', ')}`);
    }
    process.exit(0);
  })().catch((err) => {
    console.error('❌ Error importando:', err.message);
    process.exit(1);
  });
}
