const { test } = require('node:test');
const assert = require('node:assert');
const { resolverModelo, MODELOS } = require('../config');

test('MODELOS lista los modelos elegibles con id y nombre', () => {
  const ids = MODELOS.map((m) => m.id);
  assert.ok(ids.includes('claude-sonnet-4-6'));
  assert.ok(ids.includes('claude-haiku-4-5'));
  assert.ok(MODELOS.every((m) => m.id && m.nombre));
});

test('resolverModelo prioriza la config de la DB sobre el env', () => {
  assert.strictEqual(
    resolverModelo('claude-haiku-4-5', 'claude-sonnet-4-6'),
    'claude-haiku-4-5'
  );
});

test('resolverModelo cae al env si no hay config, y al default si no hay nada', () => {
  assert.strictEqual(resolverModelo(null, 'claude-haiku-4-5'), 'claude-haiku-4-5');
  assert.strictEqual(resolverModelo(null, undefined), 'claude-sonnet-4-6');
});

test('resolverModelo ignora un valor de config que no está en MODELOS', () => {
  // Si en la DB quedó un id viejo/roto, no lo usamos: seguimos con env/default.
  assert.strictEqual(resolverModelo('claude-inventado-9', undefined), 'claude-sonnet-4-6');
});
