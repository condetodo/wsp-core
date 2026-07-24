const { test } = require('node:test');
const assert = require('node:assert');
const { render360, fechaLegible } = require('../clientes');

test('render360: cliente desconocido', () => {
  const txt = render360({ esConocido: false });
  assert.match(txt, /CLIENTE NUEVO/);
});

test('render360: cliente conocido muestra su nombre', () => {
  const txt = render360({
    esConocido: true,
    persona: { nombre: 'Francisco', apellido: 'Pérez' },
    ultimoResumen: null,
  });
  assert.match(txt, /PERFIL DEL CLIENTE/);
  assert.match(txt, /Francisco Pérez/);
});

test('render360: conocido sin nombre lo dice', () => {
  const txt = render360({
    esConocido: true,
    persona: {},
    ultimoResumen: null,
  });
  assert.match(txt, /sin nombre registrado/);
});

test('render360: incluye el último resumen si existe', () => {
  const txt = render360({
    esConocido: true,
    persona: { nombre: 'Laura', apellido: 'Gómez' },
    ultimoResumen: 'Preguntó por los horarios; quedó en pasar el viernes.',
  });
  assert.match(txt, /última conversación/i);
  assert.match(txt, /viernes/);
});

test('fechaLegible: día de la semana + fecha absoluta en español', () => {
  const txt = fechaLegible('2026-06-27');
  assert.match(txt, /sábado/i);
  assert.match(txt, /27 de junio de 2026/i);
});

const { enAsesorActivo } = require('../clientes');

test('enAsesorActivo: persona sin flag -> false', () => {
  assert.strictEqual(enAsesorActivo({ en_asesor: false }), false);
});

test('enAsesorActivo: flag activo y reciente -> true', () => {
  const ahora = new Date('2026-06-26T12:00:00Z');
  const desde = new Date('2026-06-26T11:00:00Z'); // hace 1 h
  assert.strictEqual(enAsesorActivo({ en_asesor: true, en_asesor_desde: desde }, 24, ahora), true);
});

test('enAsesorActivo: flag activo pero vencido -> false', () => {
  const ahora = new Date('2026-06-28T12:00:00Z');
  const desde = new Date('2026-06-26T11:00:00Z'); // hace ~49 h (> 24)
  assert.strictEqual(enAsesorActivo({ en_asesor: true, en_asesor_desde: desde }, 24, ahora), false);
});

// --- Alta de datos del cliente (lo que el agente guarda con sus tools) ---

const { datosPersonaLimpios } = require('../clientes');

test('datosPersonaLimpios: recorta espacios y descarta campos vacíos', () => {
  assert.deepStrictEqual(
    datosPersonaLimpios({ nombre: ' Nadia ', apellido: '', correo: undefined }),
    { nombre: 'Nadia' }
  );
});

test('datosPersonaLimpios: acepta correo con @ y lo recorta', () => {
  assert.deepStrictEqual(
    datosPersonaLimpios({ correo: ' prueba@ejemplo.com ' }),
    { correo: 'prueba@ejemplo.com' }
  );
});

test('datosPersonaLimpios: ignora un correo sin @', () => {
  assert.deepStrictEqual(datosPersonaLimpios({ correo: 'no-es-un-mail' }), {});
});

test('datosPersonaLimpios: ignora campos que no son de la persona', () => {
  assert.deepStrictEqual(
    datosPersonaLimpios({ nombre: 'Ana', telefono: '549...', id: 99 }),
    { nombre: 'Ana' }
  );
});

const { estadoAsignacion } = require('../clientes');

test('estadoAsignacion: no derivado -> null', () => {
  assert.strictEqual(estadoAsignacion({ en_asesor: false }), null);
});

test('estadoAsignacion: derivado sin tomar -> en_espera', () => {
  assert.strictEqual(estadoAsignacion({ en_asesor: true, atendido_por: null }), 'en_espera');
});

test('estadoAsignacion: derivado y tomado -> en_atencion', () => {
  assert.strictEqual(estadoAsignacion({ en_asesor: true, atendido_por: 'fran' }), 'en_atencion');
});
