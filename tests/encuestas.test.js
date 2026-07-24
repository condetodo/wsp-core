const { test } = require('node:test');
const assert = require('node:assert');
const {
  interpretarRespuesta, textoAgradecimiento, esNegativa,
  porcentaje, csatDe, botonesDe, OPCIONES,
} = require('../encuestas');

const BOTONES = ['Excelente', 'Buena', 'Mala'];

test('interpretarRespuesta reconoce los botones de la encuesta', () => {
  for (const b of BOTONES) {
    assert.strictEqual(interpretarRespuesta(b, BOTONES), b);
  }
});

test('interpretarRespuesta ignora mayúsculas y espacios', () => {
  assert.strictEqual(interpretarRespuesta('  excelente ', BOTONES), 'Excelente');
  assert.strictEqual(interpretarRespuesta('BUENA', BOTONES), 'Buena');
  assert.strictEqual(interpretarRespuesta('mala', BOTONES), 'Mala');
});

test('interpretarRespuesta devuelve null para botones que no son de la encuesta', () => {
  assert.strictEqual(interpretarRespuesta('Reprogramar turno', BOTONES), null);
  assert.strictEqual(interpretarRespuesta('', BOTONES), null);
  assert.strictEqual(interpretarRespuesta(null, BOTONES), null);
  assert.strictEqual(interpretarRespuesta('Excelente', []), null);
});

test('interpretarRespuesta funciona con botones personalizados', () => {
  const custom = ['Muy conforme', 'Poco conforme'];
  assert.strictEqual(interpretarRespuesta('muy conforme', custom), 'Muy conforme');
  assert.strictEqual(interpretarRespuesta('Excelente', custom), null);
});

test('esNegativa marca solo el último botón', () => {
  assert.strictEqual(esNegativa('Mala', BOTONES), true);
  assert.strictEqual(esNegativa('Excelente', BOTONES), false);
  assert.strictEqual(esNegativa('Buena', BOTONES), false);
  assert.strictEqual(esNegativa('Mala', []), false);
});

test('porcentaje redondea y devuelve null sin total', () => {
  assert.strictEqual(porcentaje(74, 180), 41);
  assert.strictEqual(porcentaje(0, 10), 0);
  assert.strictEqual(porcentaje(5, 0), null);
  assert.strictEqual(porcentaje(0, 0), null);
});

test('csatDe cuenta como positivas todas las opciones menos la última', () => {
  assert.strictEqual(csatDe({ Excelente: 84, Buena: 31, Mala: 17 }, BOTONES), 87);
  assert.strictEqual(csatDe({ Excelente: 0, Buena: 0, Mala: 5 }, BOTONES), 0);
  assert.strictEqual(csatDe({}, BOTONES), null);
  assert.strictEqual(csatDe({ 'Muy conforme': 3, 'Poco conforme': 1 }, ['Muy conforme', 'Poco conforme']), 75);
});

test('textoAgradecimiento distingue la peor respuesta del resto', () => {
  const mala = textoAgradecimiento('Mala', BOTONES);
  assert.ok(mala.toLowerCase().includes('lamentamos'));
  assert.notStrictEqual(textoAgradecimiento('Excelente', BOTONES), mala);
  assert.strictEqual(textoAgradecimiento('Excelente', BOTONES), textoAgradecimiento('Buena', BOTONES));
});

test('botonesDe tolera jsonb como array, string o plantilla nula', () => {
  assert.deepStrictEqual(botonesDe({ botones: BOTONES }), BOTONES);
  assert.deepStrictEqual(botonesDe({ botones: JSON.stringify(BOTONES) }), BOTONES);
  assert.deepStrictEqual(botonesDe({ botones: 'no-es-json' }), []);
  assert.deepStrictEqual(botonesDe(null), []);
});

test('OPCIONES por defecto siguen siendo 3 (Excelente/Buena/Mala)', () => {
  assert.deepStrictEqual(OPCIONES, BOTONES);
});
