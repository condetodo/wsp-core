const { test } = require('node:test');
const assert = require('node:assert');
const { renderAvisoLead } = require('../avisos');

test('el asunto lleva nombre y puntaje, para que se lea sin abrir el mail', () => {
  const { asunto } = renderAvisoLead({
    nombre: 'Carlos Rivarola', puntaje: 5, motivo: 'quiere visitar el sábado',
  });
  assert.match(asunto, /Carlos Rivarola/);
  assert.match(asunto, /5/);
});

test('el cuerpo incluye motivo e interés', () => {
  const { html } = renderAvisoLead({
    nombre: 'Ana', puntaje: 4, motivo: 'dejó su mail', interes: '2 ambientes en Pilar',
  });
  assert.match(html, /dejó su mail/);
  assert.match(html, /2 ambientes en Pilar/);
});

test('tolera lead sin nombre y sin interés', () => {
  const { asunto, html } = renderAvisoLead({
    puntaje: 4, motivo: 'preguntó por tres propiedades',
  });
  assert.match(asunto, /sin nombre/i);
  assert.ok(html.length > 0);
});

test('el teléfono va en el cuerpo: es con lo que el vendedor llama', () => {
  const { html } = renderAvisoLead({
    nombre: 'Ana', telefono: '5491158404881', puntaje: 4, motivo: 'pidió precios',
  });
  assert.match(html, /5491158404881/);
});

test('escapa el HTML de los datos del lead', () => {
  // El motivo lo redacta el modelo a partir de lo que escribió el cliente:
  // si no se escapa, un "<" cualquiera rompe el mail.
  const { html } = renderAvisoLead({
    nombre: '<script>alert(1)</script>', puntaje: 5, motivo: 'busca casa <10 km',
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;10 km/);
});
