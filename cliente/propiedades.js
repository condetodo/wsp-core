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

module.exports = { construirFiltro, esNumero, esTexto, TOPE };
