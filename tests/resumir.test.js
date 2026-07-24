const { test } = require('node:test');
const assert = require('node:assert');
const { construirTextoConversacion, sistemaResumen } = require('../resumir');

test('construirTextoConversacion etiqueta cliente y agente', () => {
  const txt = construirTextoConversacion([
    { role: 'user', content: 'Hola, quiero un turno' },
    { role: 'assistant', content: 'Claro, ¿para qué auto?' },
  ]);
  assert.strictEqual(txt, 'Cliente: Hola, quiero un turno\nAgente: Claro, ¿para qué auto?');
});

test('construirTextoConversacion con lista vacía devuelve string vacío', () => {
  assert.strictEqual(construirTextoConversacion([]), '');
});

test('sistemaResumen: ancla la fecha de hoy (absoluta) e instruye no usar relativas', () => {
  // 15:00Z = 12:00 en Argentina (UTC-3) -> mismo día, sin corrimiento de fecha.
  const s = sistemaResumen(new Date('2026-06-27T15:00:00Z'));
  assert.match(s, /27 de junio de 2026/); // fecha legible de hoy
  assert.match(s, /2026-06-27/);          // ISO de hoy
  assert.match(s, /NO uses fechas relativas/i);
});
