// ============================================================
// CONTEXTO 360 DEL NEGOCIO — ARCHIVO POR CLIENTE.
// El mecanismo 360 (identificar por teléfono + inyectar perfil al agente) es
// core y vive en clientes.js. Este archivo define QUÉ datos del NEGOCIO se
// suman a ese perfil; es lo que se escribe por cliente, junto con sus tools.
//
// Dos funciones:
//   - datosNegocio(pool, persona): consulta la base y devuelve un objeto con
//     los datos del vertical. Puede incluir `esConocido: true` si esos datos
//     alcanzan para considerar conocido al cliente aunque no tenga nombre
//     (ej. en el concesionario: tiene un vehículo registrado).
//   - renderNegocio(datos): recibe el objeto 360 completo y devuelve las
//     LÍNEAS extra para el system prompt (array de strings).
//
// En el esqueleto base no hay vertical: no se suma nada. Ejemplo real (el
// concesionario sumaba vehículos, últimos services y próximos turnos, y
// renderizaba una línea por cada uno con la patente y la fecha).
// ============================================================

// Datos del vertical para el perfil del cliente. Base: nada extra.
async function datosNegocio(pool, persona) {
  return {};
}

// Líneas extra del perfil para el system prompt. Base: ninguna.
function renderNegocio(datos) {
  return [];
}

module.exports = { datosNegocio, renderNegocio };
