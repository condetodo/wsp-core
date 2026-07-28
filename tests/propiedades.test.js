const { test } = require('node:test');
const assert = require('node:assert');
const { construirFiltro, buscar, TOPE } = require('../cliente/propiedades');

// Pool falso: registra las consultas y devuelve respuestas preparadas. buscar()
// recibe el pool por parámetro justamente para poder probarla sin base.
function poolFalso(respuestas) {
  const consultas = [];
  return {
    consultas,
    query: async (sql, params) => {
      consultas.push({ sql, params });
      return respuestas.shift() || { rows: [] };
    },
  };
}

test('sin criterios, sólo filtra por disponible', () => {
  const { where, params } = construirFiltro({});
  assert.match(where, /estado = 'disponible'/);
  assert.deepStrictEqual(params, []);
});

test('cada criterio agrega su condición con parámetro numerado', () => {
  const { where, params } = construirFiltro({ operacion: 'alquiler', zona: 'Pilar' });
  assert.match(where, /operacion = \$1/);
  assert.match(where, /zona ILIKE \$2/);
  assert.deepStrictEqual(params, ['alquiler', '%Pilar%']);
});

test('ambientes matchea exacto, no mínimo', () => {
  // Quien pide "2 ambientes" no quiere que le ofrezcan un 5 ambientes.
  const { where, params } = construirFiltro({ ambientes: 2 });
  assert.match(where, /ambientes = \$1/);
  assert.deepStrictEqual(params, [2]);
});

test('precio_max con moneda filtra por ambos', () => {
  const { where, params } = construirFiltro({ precio_max: 300000, moneda: 'USD' });
  assert.match(where, /moneda = \$1/);
  assert.match(where, /precio <= \$2/);
  assert.deepStrictEqual(params, ['USD', 300000]);
});

test('precio_max SIN moneda se ignora y avisa', () => {
  // Nunca convertimos monedas: sin cotización en la base, comparar mentiría.
  // Peor aún, ofrecería una casa de USD 300.000 a alguien con $300.000.
  const { where, params, aviso } = construirFiltro({ precio_max: 300000 });
  assert.doesNotMatch(where, /precio/);
  assert.deepStrictEqual(params, []);
  assert.strictEqual(aviso, 'precio_sin_moneda');
});

test('la moneda sola, sin tope de precio, igual filtra', () => {
  // "Quiero algo en dólares" es un criterio válido por sí mismo.
  const { where, params } = construirFiltro({ moneda: 'USD' });
  assert.match(where, /moneda = \$1/);
  assert.deepStrictEqual(params, ['USD']);
});

test('ignora criterios vacíos, nulos o no numéricos', () => {
  // El modelo a veces manda strings vacíos o null en vez de omitir el campo.
  const { where, params } = construirFiltro({
    operacion: '', tipo: null, zona: undefined, ambientes: 'dos', precio_max: NaN,
  });
  assert.strictEqual(where, "estado = 'disponible'");
  assert.deepStrictEqual(params, []);
});

test('ambientes 0 no se confunde con ausente', () => {
  // 0 es falsy: si se chequea con "if (criterios.ambientes)" se pierde.
  const { params } = construirFiltro({ ambientes: 0 });
  assert.deepStrictEqual(params, [0]);
});

test('los criterios se combinan con AND', () => {
  const { where, params } = construirFiltro({
    operacion: 'venta', tipo: 'casa', zona: 'Pilar', ambientes: 3,
    precio_max: 200000, moneda: 'USD',
  });
  assert.strictEqual(where.split(' AND ').length, 7); // disponible + 6 criterios
  assert.deepStrictEqual(params, ['venta', 'casa', '%Pilar%', 3, 'USD', 200000]);
});

// --- buscar() -------------------------------------------------------------

test('con precio sin moneda no consulta la base y pide preguntar', async () => {
  // Cortocircuito: no tiene sentido gastar una query sabiendo que el tope se ignora.
  const pool = poolFalso([]);
  const r = await buscar(pool, { precio_max: 300000 });
  assert.strictEqual(pool.consultas.length, 0);
  assert.match(r.aviso, /pesos o en dólares/);
});

test('devuelve el total y las propiedades encontradas', async () => {
  const pool = poolFalso([
    { rows: [{ n: 12 }] },
    { rows: [{ id: 1, zona: 'Pilar' }, { id: 2, zona: 'Pilar' }] },
  ]);
  const r = await buscar(pool, { operacion: 'alquiler' });
  assert.strictEqual(r.total, 12);
  assert.strictEqual(r.mostradas, 2);
  assert.strictEqual(r.propiedades.length, 2);
});

test('el total sirve para que el agente pida acotar', async () => {
  // 23 encontradas pero 5 mostradas: el bot tiene que poder decir "hay 23".
  const pool = poolFalso([
    { rows: [{ n: 23 }] },
    { rows: new Array(TOPE).fill({ id: 1 }) },
  ]);
  const r = await buscar(pool, {});
  assert.strictEqual(r.total, 23);
  assert.strictEqual(r.mostradas, TOPE);
});

test('la consulta acota los resultados al tope', async () => {
  const pool = poolFalso([{ rows: [{ n: 0 }] }, { rows: [] }]);
  await buscar(pool, {});
  assert.match(pool.consultas[1].sql, new RegExp(`LIMIT ${TOPE}`));
});

test('trae el desarrollo con LEFT JOIN, no INNER', async () => {
  // Con INNER JOIN las propiedades sueltas (desarrollo_id null) desaparecerían.
  const pool = poolFalso([{ rows: [{ n: 0 }] }, { rows: [] }]);
  await buscar(pool, {});
  assert.match(pool.consultas[1].sql, /LEFT JOIN desarrollos/);
  assert.match(pool.consultas[1].sql, /d\.nombre AS desarrollo/);
});

test('las dos consultas usan los mismos parámetros del filtro', async () => {
  // Si el COUNT y el SELECT filtraran distinto, el total mentiría.
  const pool = poolFalso([{ rows: [{ n: 3 }] }, { rows: [] }]);
  await buscar(pool, { operacion: 'venta', zona: 'Pilar' });
  assert.deepStrictEqual(pool.consultas[0].params, pool.consultas[1].params);
  assert.deepStrictEqual(pool.consultas[0].params, ['venta', '%Pilar%']);
});
