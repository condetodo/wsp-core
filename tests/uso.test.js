const { test } = require('node:test');
const assert = require('node:assert');
const { costoUSD, diaValido } = require('../uso');

test('costoUSD aplica la tarifa de sonnet-4-6 (3 entrada / 15 salida por millón)', () => {
  assert.strictEqual(costoUSD(1_000_000, 0), 3);
  assert.strictEqual(costoUSD(0, 1_000_000), 15);
  assert.strictEqual(costoUSD(1_000_000, 1_000_000), 18);
});

test('costoUSD con un mensaje típico da centavos, no pesos', () => {
  // ~3500 de entrada + ~700 de salida ≈ USD 0.021
  const costo = costoUSD(3500, 700);
  assert.ok(costo > 0.02 && costo < 0.025, `costo inesperado: ${costo}`);
});

test('costoUSD sin tokens es 0', () => {
  assert.strictEqual(costoUSD(0, 0), 0);
});

test('costoUSD aplica la tarifa de haiku-4-5 (1 entrada / 5 salida por millón)', () => {
  assert.strictEqual(costoUSD(1_000_000, 0, 'claude-haiku-4-5'), 1);
  assert.strictEqual(costoUSD(0, 1_000_000, 'claude-haiku-4-5'), 5);
  assert.strictEqual(costoUSD(1_000_000, 1_000_000, 'claude-haiku-4-5'), 6);
});

test('costoUSD con un modelo desconocido usa la tarifa de sonnet (no rompe)', () => {
  assert.strictEqual(costoUSD(1_000_000, 1_000_000, 'claude-raro-9'), 18);
});

test('diaValido acepta solo YYYY-MM-DD estricto', () => {
  assert.strictEqual(diaValido('2026-07-17'), true);
  assert.strictEqual(diaValido('2026-7-17'), false);
  assert.strictEqual(diaValido('17/07/2026'), false);
  assert.strictEqual(diaValido(''), false);
  assert.strictEqual(diaValido(null), false);
  assert.strictEqual(diaValido("2026-07-17'; DROP TABLE uso_agente;--"), false);
});
