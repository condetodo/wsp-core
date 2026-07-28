const { test } = require('node:test');
const assert = require('node:assert');
const { valorDe, parsearFila } = require('../importar-propiedades');

test('valorDe encuentra la columna sin importar acentos ni mayúsculas', () => {
  // Un Excel hecho por una persona dice "Operación", "OPERACION" o "operacion".
  // Si sólo matcheáramos exacto, la columna se pierde y la fila entera se
  // descarta sin que nadie entienda por qué.
  assert.strictEqual(valorDe({ 'Operación': 'Venta' }, 'operacion'), 'Venta');
  assert.strictEqual(valorDe({ 'OPERACION': 'Venta' }, 'operacion'), 'Venta');
  assert.strictEqual(valorDe({ ' operacion ': 'Venta' }, 'operacion'), 'Venta');
});

test('valorDe acepta varios nombres posibles de columna', () => {
  assert.strictEqual(valorDe({ 'Superficie': '80' }, 'superficie_m2', 'superficie', 'm2'), '80');
  assert.strictEqual(valorDe({ 'M2': '80' }, 'superficie_m2', 'superficie', 'm2'), '80');
});

test('valorDe devuelve null si la columna no está', () => {
  assert.strictEqual(valorDe({ 'Zona': 'Pilar' }, 'precio'), null);
});

test('parsearFila mapea las columnas del Excel a la propiedad', () => {
  const r = parsearFila({
    'Operacion': 'Alquiler', 'Tipo': 'Departamento', 'Zona': 'Pilar',
    'Ambientes': '2', 'Precio': '450000', 'Moneda': 'ARS',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.limpia.operacion, 'alquiler');
  assert.strictEqual(r.limpia.tipo, 'departamento');
  assert.strictEqual(r.limpia.ambientes, 2);
  assert.strictEqual(r.limpia.precio, 450000);
  assert.strictEqual(r.limpia.moneda, 'ARS');
});

test('parsearFila descarta la fila sin operacion o sin tipo', () => {
  const r = parsearFila({ 'Zona': 'Pilar' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errores.length);
});

test('parsearFila tolera precio con símbolo y separador de miles', () => {
  // Los Excel reales traen "U$S 145.000", no 145000. Sin limpiarlo, precio
  // queda null y la propiedad nunca aparece en una búsqueda por presupuesto.
  const r = parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Casa', 'Precio': 'U$S 145.000' });
  assert.strictEqual(r.limpia.precio, 145000);
});

test('parsearFila entiende los decimales con coma', () => {
  const r = parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Casa', 'Superficie': '80,5' });
  assert.strictEqual(r.limpia.superficie_m2, 80.5);
});

test('parsearFila rechaza un tipo que no está en la lista cerrada', () => {
  const r = parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Quincho' });
  assert.strictEqual(r.ok, false);
  assert.match(r.errores.join(' '), /tipo/);
});

test('parsearFila devuelve aparte el nombre del desarrollo', () => {
  // En el Excel el desarrollo viene por NOMBRE; el id se resuelve al importar.
  const r = parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Departamento', 'Desarrollo': 'Torres del Sol' });
  assert.strictEqual(r.desarrollo, 'Torres del Sol');
  assert.strictEqual(r.limpia.desarrollo_id, null);
});

test('parsearFila deja la propiedad como disponible si no dice otra cosa', () => {
  const r = parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Casa' });
  assert.strictEqual(r.limpia.estado, 'disponible');
});

// --- importarFilas() ------------------------------------------------------

const { importarFilas } = require('../importar-propiedades');

// Pool falso: responde a las consultas del importador según el SQL.
function poolFalso({ desarrollosExistentes = {} } = {}) {
  const insertadas = [];
  const desarrollosCreados = [];
  let proximoId = 100;
  return {
    insertadas, desarrollosCreados,
    query: async (sql, params) => {
      if (/SELECT id FROM desarrollos/.test(sql)) {
        const id = desarrollosExistentes[String(params[0]).toLowerCase()];
        return { rows: id ? [{ id }] : [] };
      }
      if (/INSERT INTO desarrollos/.test(sql)) {
        desarrollosCreados.push(params[0]);
        return { rows: [{ id: ++proximoId }] };
      }
      if (/INSERT INTO propiedades/.test(sql)) {
        insertadas.push(params);
        return { rows: [{ id: ++proximoId }] };
      }
      return { rows: [] };
    },
  };
}

test('importa las filas válidas y saltea las rotas', async () => {
  const pool = poolFalso();
  const r = await importarFilas(pool, [
    parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Casa' }),
    parsearFila({ 'Zona': 'Pilar' }),                       // sin operacion ni tipo
    parsearFila({ 'Operacion': 'Alquiler', 'Tipo': 'PH' }),
  ]);
  assert.strictEqual(r.creadas, 2);
  assert.strictEqual(r.saltadas, 1);
});

test('el problema informa el número de fila del Excel', async () => {
  // Sin el número de fila, "3 filas salteadas" es inaccionable: hay que
  // revisar la planilla entera a ojo.
  const pool = poolFalso();
  const r = await importarFilas(pool, [
    parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Casa' }),
    parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Quincho' }),
  ]);
  assert.strictEqual(r.problemas[0].fila, 3); // encabezado + 2ª fila de datos
});

test('reusa el desarrollo que ya existe en vez de duplicarlo', async () => {
  const pool = poolFalso({ desarrollosExistentes: { 'torres del sol': 7 } });
  const r = await importarFilas(pool, [
    parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Departamento', 'Desarrollo': 'Torres del Sol' }),
  ]);
  assert.strictEqual(r.desarrollosCreados, 0);
  assert.strictEqual(pool.desarrollosCreados.length, 0);
});

test('crea el desarrollo una sola vez para todas sus unidades', async () => {
  // 20 unidades del mismo proyecto no pueden crear 20 desarrollos.
  const pool = poolFalso();
  const filas = new Array(5).fill(null).map(() =>
    parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Departamento', 'Desarrollo': 'Torres del Sol' }));
  const r = await importarFilas(pool, filas);
  assert.strictEqual(r.creadas, 5);
  assert.strictEqual(r.desarrollosCreados, 1);
  assert.strictEqual(pool.desarrollosCreados.length, 1);
});

test('la propiedad sin desarrollo queda con desarrollo_id null', async () => {
  const pool = poolFalso();
  await importarFilas(pool, [parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Casa' })]);
  assert.strictEqual(pool.insertadas[0][0], null); // desarrollo_id es el 1er campo
});
