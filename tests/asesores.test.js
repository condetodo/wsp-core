const { test } = require('node:test');
const assert = require('node:assert');
const { sesionValida } = require('../asesores');

test('sesionValida: sin sesión -> false', () => {
  assert.strictEqual(sesionValida(null), false);
  assert.strictEqual(sesionValida({}), false);
});

test('sesionValida: con usuario -> true', () => {
  assert.strictEqual(sesionValida({ usuario: 'fran' }), true);
});
