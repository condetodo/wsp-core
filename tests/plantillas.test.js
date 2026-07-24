const { test } = require('node:test');
const assert = require('node:assert');
const { renderVariables } = require('../plantillas');

test('renderVariables reemplaza {{1}}, {{2}} por los valores en orden', () => {
  const cuerpo = 'Hola {{1}}! Tenemos una novedad para vos en {{2}}.';
  assert.strictEqual(
    renderVariables(cuerpo, ['Carlos', 'la sucursal Centro']),
    'Hola Carlos! Tenemos una novedad para vos en la sucursal Centro.'
  );
});

test('renderVariables repite el mismo placeholder en todas sus apariciones', () => {
  assert.strictEqual(renderVariables('{{1}} y de nuevo {{1}}', ['X']), 'X y de nuevo X');
});

test('renderVariables deja vacío si falta el valor', () => {
  assert.strictEqual(renderVariables('Hola {{1}} {{2}}', ['A']), 'Hola A ');
});

const { valoresDesdeCliente } = require('../plantillas');

test('valoresDesdeCliente arma el array en orden de n', () => {
  const variables = [{ n: 2, campo: 'correo' }, { n: 1, campo: 'nombre' }];
  const cliente = { nombre: 'Carlos', apellido: 'R', correo: 'carlos@ejemplo.com' };
  assert.deepStrictEqual(valoresDesdeCliente(cliente, variables), ['Carlos', 'carlos@ejemplo.com']);
});

test('valoresDesdeCliente usa string vacío si el campo del cliente es null', () => {
  const variables = [{ n: 1, campo: 'nombre' }, { n: 2, campo: 'correo' }];
  const cliente = { nombre: 'Ana', apellido: null, correo: null };
  assert.deepStrictEqual(valoresDesdeCliente(cliente, variables), ['Ana', '']);
});

// --- Motor de segmentación: condiciones AND + selección manual (ids) ---
// Los campos son los de destinatariosBase(); si el vertical suma columnas
// (ej. modelo del auto), el motor las filtra igual sin cambios.

const { filtrarDestinatarios } = require('../plantillas');

const SEG = [
  { id: 1, nombre: 'Carlos', apellido: 'Rivarola', correo: 'carlos@ejemplo.com' },
  { id: 2, nombre: 'Ana',    apellido: 'Gomez',    correo: null },
  { id: 3, nombre: 'Beto',   apellido: 'Diaz',     correo: 'beto@ejemplo.com' },
];

test('sin condiciones devuelve toda la base', () => {
  assert.strictEqual(filtrarDestinatarios(SEG, { condiciones: [] }).length, 3);
  assert.strictEqual(filtrarDestinatarios(SEG, {}).length, 3);
});

test('condición "es" es case-insensitive', () => {
  const r = filtrarDestinatarios(SEG, { condiciones: [{ campo: 'nombre', op: 'es', valor: 'carlos' }] });
  assert.deepStrictEqual(r.map((p) => p.id), [1]);
});

test('condición "contiene" sobre apellido', () => {
  const r = filtrarDestinatarios(SEG, { condiciones: [{ campo: 'apellido', op: 'contiene', valor: 'ar' }] });
  assert.deepStrictEqual(r.map((p) => p.id), [1]);
});

test('condiciones vacio / no_vacio sobre correo', () => {
  const sin = filtrarDestinatarios(SEG, { condiciones: [{ campo: 'correo', op: 'vacio' }] });
  const con = filtrarDestinatarios(SEG, { condiciones: [{ campo: 'correo', op: 'no_vacio' }] });
  assert.deepStrictEqual(sin.map((p) => p.id), [2]);
  assert.deepStrictEqual(con.map((p) => p.id), [1, 3]);
});

test('varias condiciones se combinan con AND', () => {
  const r = filtrarDestinatarios(SEG, { condiciones: [
    { campo: 'correo', op: 'no_vacio' },
    { campo: 'nombre', op: 'contiene', valor: 'be' },
  ] });
  assert.deepStrictEqual(r.map((p) => p.id), [3]);
});

test('ids (selección manual) restringe el resultado del filtro', () => {
  const r = filtrarDestinatarios(SEG, {
    condiciones: [{ campo: 'correo', op: 'no_vacio' }],
    ids: [3],
  });
  assert.deepStrictEqual(r.map((p) => p.id), [3]);
});

test('condición con valor vacío (op "es") se ignora y no filtra', () => {
  const r = filtrarDestinatarios(SEG, { condiciones: [{ campo: 'nombre', op: 'es', valor: '' }] });
  assert.strictEqual(r.length, 3);
});
