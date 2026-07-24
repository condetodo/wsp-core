const { test } = require('node:test');
const assert = require('node:assert');
const { agregarPorAsesor, promedioMin } = require('../metricas');

const min = (n) => n * 60 * 1000;
// Caso de fábrica: derivado en t0, tomado a los 5 min, resuelto a los 35 min.
function caso(extra = {}) {
  const t0 = new Date('2026-07-15T10:00:00Z');
  return {
    telefono: '549111', motivo: 'repuestos', origen: 'bot', expirado: false,
    derivado_en: t0,
    tomado_en: new Date(t0.getTime() + min(5)), tomado_por: 'fran',
    resuelto_en: new Date(t0.getTime() + min(35)), resuelto_por: 'fran',
    ...extra,
  };
}

test('promedioMin: promedia en minutos e ignora null', () => {
  assert.strictEqual(promedioMin([min(10), null, min(20)]), 15);
  assert.strictEqual(promedioMin([]), null);
});

test('agregarPorAsesor: cuenta y promedia por asesor', () => {
  const filas = agregarPorAsesor([caso(), caso({ resuelto_en: null, resuelto_por: null })]);
  assert.strictEqual(filas.length, 1);
  const f = filas[0];
  assert.strictEqual(f.asesor, 'fran');
  assert.strictEqual(f.tomados, 2);
  assert.strictEqual(f.abiertos, 1);
  assert.strictEqual(f.esperaPromMin, 5);      // ambos tomados a los 5 min
  assert.strictEqual(f.resolucionPromMin, 30); // solo el resuelto cuenta
});

test('agregarPorAsesor: ignora casos sin tomar y cuenta expirados del asesor', () => {
  const filas = agregarPorAsesor([
    caso({ tomado_en: null, tomado_por: null, resuelto_en: null }), // en espera: de nadie
    caso({ resuelto_en: null, resuelto_por: null, expirado: true }),
  ]);
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].tomados, 1);
  assert.strictEqual(filas[0].expirados, 1);
});
