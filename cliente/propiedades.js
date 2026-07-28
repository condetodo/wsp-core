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

module.exports = { construirFiltro, buscar, esNumero, esTexto, TOPE };
