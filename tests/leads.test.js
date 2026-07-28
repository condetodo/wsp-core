const { test } = require('node:test');
const assert = require('node:assert');
const { debeAvisar, HORAS_SILENCIO } = require('../leads');

const AHORA = new Date('2026-07-28T15:00:00Z');
const hace = (horas) => new Date(AHORA.getTime() - horas * 3600 * 1000);

test('no avisa por debajo del umbral', () => {
  assert.strictEqual(debeAvisar({ puntaje: 2, umbral: 4, ultimo: null, ahora: AHORA }), false);
});

test('avisa la primera vez que cruza el umbral', () => {
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo: null, ahora: AHORA }), true);
});

test('NO repite el aviso si sigue hablando con el mismo puntaje', () => {
  // Sin esto, cada mensaje del lead caliente dispara otra alerta y los
  // vendedores silencian el aviso en una semana.
  const ultimo = { puntaje: 4, creado: hace(1) };
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo, ahora: AHORA }), false);
});

test('avisa de nuevo si el puntaje SUBE', () => {
  // Pasar de 4 a 5 es información nueva y urgente: vale interrumpir otra vez.
  const ultimo = { puntaje: 4, creado: hace(1) };
  assert.strictEqual(debeAvisar({ puntaje: 5, umbral: 4, ultimo, ahora: AHORA }), true);
});

test('no avisa si el puntaje BAJA pero sigue sobre el umbral', () => {
  const ultimo = { puntaje: 5, creado: hace(1) };
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo, ahora: AHORA }), false);
});

test('vuelve a avisar pasadas las horas de silencio', () => {
  // Vuelve al día siguiente: es un lead nuevo en la práctica.
  const ultimo = { puntaje: 4, creado: hace(HORAS_SILENCIO + 1) };
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo, ahora: AHORA }), true);
});

test('justo en el borde de las horas de silencio, avisa', () => {
  const ultimo = { puntaje: 4, creado: hace(HORAS_SILENCIO) };
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo, ahora: AHORA }), true);
});

test('el umbral se respeta aunque haya avisos previos', () => {
  const ultimo = { puntaje: 5, creado: hace(48) };
  assert.strictEqual(debeAvisar({ puntaje: 1, umbral: 4, ultimo, ahora: AHORA }), false);
});

test('un puntaje que no es número no avisa', () => {
  // El modelo puede mandar "5" o null; ante la duda, no interrumpimos a nadie.
  assert.strictEqual(debeAvisar({ puntaje: '5', umbral: 4, ultimo: null, ahora: AHORA }), false);
  assert.strictEqual(debeAvisar({ puntaje: null, umbral: 4, ultimo: null, ahora: AHORA }), false);
});

test('tolera que el creado venga como string ISO desde Postgres', () => {
  const ultimo = { puntaje: 4, creado: hace(1).toISOString() };
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo, ahora: AHORA }), false);
});
