const { test } = require('node:test');
const assert = require('node:assert');
const { DEFINICIONES, ejecutar } = require('../herramientas');

test('toda definición tiene la forma que espera la API de Claude', () => {
  // Un input_schema mal armado no falla acá: falla en cada llamada al modelo,
  // en producción y con el cliente esperando.
  for (const d of DEFINICIONES) {
    assert.ok(d.name, 'falta name');
    assert.ok(d.description, `falta description en ${d.name}`);
    assert.strictEqual(d.input_schema.type, 'object', `input_schema raro en ${d.name}`);
    assert.ok(d.input_schema.properties, `faltan properties en ${d.name}`);
    assert.ok(Array.isArray(d.input_schema.required), `required no es array en ${d.name}`);
  }
});

test('los nombres de las tools no se repiten', () => {
  // Dos tools con el mismo nombre: la API rechaza el request entero.
  const nombres = DEFINICIONES.map((d) => d.name);
  assert.strictEqual(new Set(nombres).size, nombres.length);
});

test('están las tools core y la del vertical', () => {
  const nombres = DEFINICIONES.map((d) => d.name);
  for (const esperada of ['guardar_datos_cliente', 'cerrar_conversacion', 'derivar_a_asesor', 'buscar_propiedades']) {
    assert.ok(nombres.includes(esperada), `falta la tool ${esperada}`);
  }
});

test('buscar_propiedades expone los criterios de búsqueda', () => {
  const d = DEFINICIONES.find((x) => x.name === 'buscar_propiedades');
  const props = Object.keys(d.input_schema.properties);
  assert.deepStrictEqual(props.sort(), ['ambientes', 'moneda', 'operacion', 'precio_max', 'tipo', 'zona']);
  // Ningún criterio es obligatorio: el cliente rara vez los da todos.
  assert.deepStrictEqual(d.input_schema.required, []);
});

test('la descripción avisa que hay que preguntar la moneda', () => {
  // Es la instrucción que evita ofrecer una casa de USD 300.000 a alguien
  // que tenía $300.000. Si se cae de la descripción, el modelo no lo sabe.
  const d = DEFINICIONES.find((x) => x.name === 'buscar_propiedades');
  assert.match(d.description, /pesos o en dólares/);
});

test('buscar_propiedades sin moneda devuelve el aviso sin tocar la base', async () => {
  const r = await ejecutar('buscar_propiedades', { precio_max: 300000 });
  assert.match(r.aviso, /pesos o en dólares/);
});

test('una tool desconocida no rompe: se lo decimos al modelo', async () => {
  const r = await ejecutar('tool_que_no_existe', {});
  assert.match(r.error, /desconocida/);
});
