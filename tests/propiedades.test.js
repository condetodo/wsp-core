const { test } = require('node:test');
const assert = require('node:assert');
const { construirFiltro } = require('../cliente/propiedades');

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
