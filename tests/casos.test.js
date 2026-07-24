const { test } = require('node:test');
const assert = require('node:assert');
const { estadoCaso } = require('../casos');

test('estadoCaso: expirado gana a todo', () => {
  assert.strictEqual(estadoCaso({ expirado: true, tomado_por: 'fran' }), 'expirado');
});

test('estadoCaso: resuelto si tiene resuelto_en', () => {
  assert.strictEqual(estadoCaso({ expirado: false, resuelto_en: new Date(), tomado_por: 'fran' }), 'resuelto');
});

test('estadoCaso: en_atencion si alguien lo tomó y sigue abierto', () => {
  assert.strictEqual(estadoCaso({ expirado: false, resuelto_en: null, tomado_por: 'fran' }), 'en_atencion');
});

test('estadoCaso: en_espera si nadie lo tomó', () => {
  assert.strictEqual(estadoCaso({ expirado: false, resuelto_en: null, tomado_por: null }), 'en_espera');
});
