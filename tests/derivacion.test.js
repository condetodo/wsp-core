const { test } = require('node:test');
const assert = require('node:assert');
const { renderAvisoAsesor } = require('../derivacion');

test('renderAvisoAsesor: devuelve [nombre, motivo]', () => {
  const vars = renderAvisoAsesor(
    { persona: { nombre: 'Francisco', apellido: 'Pérez' } },
    'Quiere un reclamo'
  );
  assert.deepStrictEqual(vars, ['Francisco Pérez', 'Quiere un reclamo']);
});

test('renderAvisoAsesor: tolera datos faltantes', () => {
  const vars = renderAvisoAsesor({ persona: {} }, '');
  assert.match(vars[0], /sin nombre/i);
  assert.match(vars[1], /sin motivo/i);
});
