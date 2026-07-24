const { test } = require('node:test');
const assert = require('node:assert');
const { limpiar, parsearFila } = require('../importar-clientes');

test('limpiar recorta espacios y convierte vacío en null', () => {
  assert.strictEqual(limpiar('  Hola  '), 'Hola');
  assert.strictEqual(limpiar('   '), null);
  assert.strictEqual(limpiar(''), null);
  assert.strictEqual(limpiar(null), null);
  assert.strictEqual(limpiar(undefined), null);
});

test('limpiar convierte números a string', () => {
  assert.strictEqual(limpiar(541158404881), '541158404881');
});

test('parsearFila mapea las columnas del Excel a la persona', () => {
  const fila = {
    'Nombre': 'Francisco',
    'Apellido': 'Pérez',
    'Telefono': '541158404881',
    'Correo Electronico': 'fran@uanaknow.com',
  };
  const r = parsearFila(fila);
  assert.deepStrictEqual(r.persona, {
    nombre: 'Francisco',
    apellido: 'Pérez',
    telefono: '5491158404881', // normalizado CON el 9
    correo: 'fran@uanaknow.com',
  });
});

test('parsearFila tolera columnas faltantes o vacías', () => {
  const r = parsearFila({ 'Nombre': 'Ana' });
  assert.strictEqual(r.persona.nombre, 'Ana');
  assert.strictEqual(r.persona.telefono, null);
  assert.strictEqual(r.persona.apellido, null);
  assert.strictEqual(r.persona.correo, null);
});
