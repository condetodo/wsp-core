// ============================================================
// BÚSQUEDA DE PROPIEDADES — ARCHIVO POR CLIENTE (vertical inmobiliario).
// Lo consume la tool buscar_propiedades de herramientas.js.
//
// El armado del WHERE está separado de la consulta a propósito: es una función
// PURA y testeada, porque es donde se decide qué encuentra y qué no el agente.
// Un criterio mal armado no rompe nada visible: simplemente devuelve vacío, y
// el bot le dice al cliente que no hay nada. Errores así no se notan.
// ============================================================

// Cada resultado son tokens en TODAS las vueltas siguientes de la conversación,
// así que el tope no es cosmético: es lo que evita que una búsqueda amplia
// dispare el costo de todo el resto de la charla.
const TOPE = 5;

// Valores cerrados. Son los mismos que el enum de la tool: si acá entra un
// 'depto' y la tool busca 'departamento', la propiedad existe pero el agente
// nunca la encuentra. Ese error no da ningún síntoma visible.
const OPERACIONES = ['venta', 'alquiler'];
const TIPOS = ['casa', 'departamento', 'ph', 'lote', 'local', 'oficina'];
const ESTADOS = ['disponible', 'reservada', 'vendida', 'alquilada'];
const MONEDAS = ['USD', 'ARS'];

// ¿Es un número usable? El modelo a veces manda strings, null o NaN en vez de
// omitir el campo. PURA.
function esNumero(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ¿Es un texto con contenido? PURA.
function esTexto(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// Arma el WHERE de la búsqueda a partir de los criterios que mandó el agente.
// PURA: no toca la base. Devuelve { where, params, aviso }.
function construirFiltro(criterios = {}) {
  const cond = ["estado = 'disponible'"];
  const params = [];
  let aviso = null;

  const agregar = (sql, valor) => {
    params.push(valor);
    cond.push(sql.replace('$?', '$' + params.length));
  };

  if (esTexto(criterios.operacion)) agregar('operacion = $?', criterios.operacion.trim());
  if (esTexto(criterios.tipo)) agregar('tipo = $?', criterios.tipo.trim());
  // ILIKE con comodines: el cliente escribe "pilar" y la ficha dice "Pilar Centro".
  if (esTexto(criterios.zona)) agregar('zona ILIKE $?', `%${criterios.zona.trim()}%`);
  // Exacto, no mínimo: quien pide "2 ambientes" no quiere un 5 ambientes.
  if (esNumero(criterios.ambientes)) agregar('ambientes = $?', criterios.ambientes);
  if (esTexto(criterios.moneda)) agregar('moneda = $?', criterios.moneda.trim());

  // El precio SOLO se compara dentro de la misma moneda. Las ventas se cotizan
  // en dólares y los alquileres en pesos; sin cotización en la base, convertir
  // mentiría, y el error es caro: ofrecerle una casa de USD 300.000 a alguien
  // que tenía $300.000 para alquilar. Sin moneda, ignoramos el tope y que el
  // agente pregunte.
  if (esNumero(criterios.precio_max)) {
    if (esTexto(criterios.moneda)) {
      agregar('precio <= $?', criterios.precio_max);
    } else {
      aviso = 'precio_sin_moneda';
    }
  }

  return { where: cond.join(' AND '), params, aviso };
}

// Pasa un valor a número, o null si no lo es. Tolera lo que llega del Excel y
// de los formularios: strings, vacíos, "U$S 145.000". PURA.
function aNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Saca todo lo que no sea dígito, coma o punto (símbolos de moneda, espacios)
  // y trata el punto como separador de miles, que es como se escribe acá.
  const limpio = String(v).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) && limpio !== '' ? n : null;
}

// Valida y normaliza una propiedad venida del panel o del Excel.
// PURA. Devuelve { ok: true, limpia } o { ok: false, errores: [...] }.
function validarPropiedad(datos = {}) {
  const errores = [];
  const enLista = (valor, lista, campo, obligatorio) => {
    const v = esTexto(valor) ? valor.trim().toLowerCase() : null;
    if (!v) {
      if (obligatorio) errores.push(`falta ${campo}`);
      return null;
    }
    const match = lista.find((x) => x.toLowerCase() === v);
    if (!match) errores.push(`${campo} inválido: "${valor}"`);
    return match || null;
  };

  const operacion = enLista(datos.operacion, OPERACIONES, 'operacion', true);
  const tipo = enLista(datos.tipo, TIPOS, 'tipo', true);
  const estado = datos.estado ? enLista(datos.estado, ESTADOS, 'estado', false) : 'disponible';
  const moneda = datos.moneda ? enLista(datos.moneda, MONEDAS, 'moneda', false) : 'USD';

  if (errores.length) return { ok: false, errores };

  return {
    ok: true,
    limpia: {
      desarrollo_id: aNumero(datos.desarrollo_id),
      operacion, tipo, estado, moneda,
      zona: esTexto(datos.zona) ? datos.zona.trim() : null,
      direccion: esTexto(datos.direccion) ? datos.direccion.trim() : null,
      ambientes: aNumero(datos.ambientes),
      dormitorios: aNumero(datos.dormitorios),
      superficie_m2: aNumero(datos.superficie_m2),
      precio: aNumero(datos.precio),
      expensas: aNumero(datos.expensas),
      descripcion: esTexto(datos.descripcion) ? datos.descripcion.trim() : null,
      link: esTexto(datos.link) ? datos.link.trim() : null,
    },
  };
}

// Busca propiedades disponibles. Devuelve hasta TOPE resultados más el TOTAL,
// para que el agente pueda decir "hay 23, acotemos" en vez de mostrar cinco y
// dar a entender que no hay más.
//
// Recibe el pool por parámetro (en vez de importarlo) para poder probarla sin base.
async function buscar(pool, criterios = {}) {
  const { where, params, aviso } = construirFiltro(criterios);

  // Cortocircuito: si el tope de precio se va a ignorar, no gastamos la consulta
  // y le devolvemos al agente qué preguntar.
  if (aviso === 'precio_sin_moneda') {
    return {
      aviso: 'Falta saber si el presupuesto está en pesos o en dólares. Preguntáselo al cliente antes de buscar.',
    };
  }

  // El COUNT y el SELECT comparten where y params: si filtraran distinto, el
  // total mentiría.
  const conteo = await pool.query(
    `SELECT COUNT(*)::int AS n FROM propiedades WHERE ${where}`,
    params
  );

  // LEFT JOIN, no INNER: con INNER las propiedades sueltas (desarrollo_id null)
  // desaparecerían de toda búsqueda.
  const { rows } = await pool.query(
    `SELECT p.id, p.operacion, p.tipo, p.zona, p.direccion, p.ambientes,
            p.dormitorios, p.superficie_m2, p.precio, p.moneda, p.expensas,
            p.descripcion, p.link,
            d.nombre AS desarrollo, d.estado_obra, d.entrega, d.financiacion
       FROM propiedades p
       LEFT JOIN desarrollos d ON d.id = p.desarrollo_id
      WHERE ${where}
      ORDER BY p.precio ASC NULLS LAST
      LIMIT ${TOPE}`,
    params
  );

  return { total: conteo.rows[0].n, mostradas: rows.length, propiedades: rows };
}

// --- ABM para el panel ------------------------------------------------------

const CAMPOS = [
  'desarrollo_id', 'operacion', 'tipo', 'zona', 'direccion', 'ambientes',
  'dormitorios', 'superficie_m2', 'precio', 'moneda', 'expensas',
  'descripcion', 'link', 'estado',
];

// Todas las propiedades, con el nombre del desarrollo resuelto. Para el panel:
// acá no filtramos por estado, el vendedor tiene que ver también las vendidas.
async function listar(pool) {
  const { rows } = await pool.query(
    `SELECT p.*, d.nombre AS desarrollo
       FROM propiedades p
       LEFT JOIN desarrollos d ON d.id = p.desarrollo_id
      ORDER BY p.creado DESC`
  );
  return rows;
}

async function crear(pool, limpia) {
  const valores = CAMPOS.map((c) => limpia[c]);
  const marcas = CAMPOS.map((_, i) => '$' + (i + 1)).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO propiedades (${CAMPOS.join(', ')}) VALUES (${marcas}) RETURNING *`,
    valores
  );
  return rows[0];
}

async function actualizar(pool, id, limpia) {
  const sets = CAMPOS.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE propiedades SET ${sets}, actualizado = now() WHERE id = $1 RETURNING *`,
    [id, ...CAMPOS.map((c) => limpia[c])]
  );
  return rows[0] || null;
}

// Dar de baja NO borra: la propiedad pasa a vendida/alquilada. El filtro de
// búsqueda ya la excluye (sólo mira 'disponible') y no se pierde el historial.
async function cambiarEstado(pool, id, estado) {
  if (!ESTADOS.includes(estado)) return null;
  const { rows } = await pool.query(
    `UPDATE propiedades SET estado = $2, actualizado = now() WHERE id = $1 RETURNING *`,
    [id, estado]
  );
  return rows[0] || null;
}

async function listarDesarrollos(pool) {
  const { rows } = await pool.query(
    `SELECT d.*, (SELECT COUNT(*)::int FROM propiedades p WHERE p.desarrollo_id = d.id) AS unidades
       FROM desarrollos d ORDER BY d.nombre`
  );
  return rows;
}

async function crearDesarrollo(pool, datos = {}) {
  if (!esTexto(datos.nombre)) return { ok: false, errores: ['falta nombre'] };
  const { rows } = await pool.query(
    `INSERT INTO desarrollos (nombre, zona, direccion, estado_obra, entrega, financiacion, descripcion)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      datos.nombre.trim(),
      esTexto(datos.zona) ? datos.zona.trim() : null,
      esTexto(datos.direccion) ? datos.direccion.trim() : null,
      esTexto(datos.estado_obra) ? datos.estado_obra.trim() : 'pozo',
      esTexto(datos.entrega) ? datos.entrega.trim() : null,
      esTexto(datos.financiacion) ? datos.financiacion.trim() : null,
      esTexto(datos.descripcion) ? datos.descripcion.trim() : null,
    ]
  );
  return { ok: true, desarrollo: rows[0] };
}

module.exports = {
  construirFiltro, buscar, validarPropiedad, aNumero, esNumero, esTexto,
  listar, crear, actualizar, cambiarEstado, listarDesarrollos, crearDesarrollo,
  TOPE, OPERACIONES, TIPOS, ESTADOS, MONEDAS, CAMPOS,
};
