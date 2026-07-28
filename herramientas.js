// ============================================================
// HERRAMIENTAS del agente (function calling / "tools").
// Acá definimos QUÉ puede hacer el agente más allá de hablar.
//
// Dos partes:
//   - DEFINICIONES: el "menú" que le mostramos a Claude (qué tools hay y
//     qué datos necesita cada una). Va en el campo `tools` de la API.
//   - ejecutar(): cuando Claude decide usar una tool, este código corre la
//     query de verdad y devuelve el resultado para dárselo de vuelta.
//
// CORE vs CLIENTE: guardar_datos_cliente, cerrar_conversacion y
// derivar_a_asesor son core (el webhook depende de ellas). Las tools del
// NEGOCIO se agregan acá por cliente; consultar_info_negocio es la demo del
// esqueleto (lee la tabla negocio_info de cliente/schema.js) y muestra el
// patrón a seguir: definición + rama en ejecutar() + función con la query.
// ============================================================
const { pool } = require('./db');
const clientes = require('./clientes');
const propiedades = require('./cliente/propiedades');

// ------------------------------------------------------------
// DEFINICIONES (el menú de tools que ve Claude).
// El `input_schema` describe los datos que Claude debe completar.
// ------------------------------------------------------------
const DEFINICIONES = [
  {
    name: 'consultar_info_negocio',
    description:
      'Consulta los datos reales del negocio: horarios, dirección y contacto. ' +
      'Usala SIEMPRE que el cliente pregunte por esos datos, en vez de inventar.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'buscar_propiedades',
    description:
      'Busca en el inventario real de la inmobiliaria las propiedades disponibles. ' +
      'Usala SIEMPRE que el cliente pregunte por algo para alquilar o comprar, en vez de inventar. ' +
      'Pasá solo los criterios que el cliente haya dicho; no completes los demás. ' +
      'IMPORTANTE: si el cliente da un presupuesto, preguntale primero si es en pesos o en dólares. ' +
      'Sin la moneda el tope se ignora y le podrías ofrecer algo carísimo.',
    input_schema: {
      type: 'object',
      properties: {
        operacion: {
          type: 'string', enum: ['venta', 'alquiler'],
          description: 'Si el cliente quiere comprar o alquilar.'
        },
        tipo: {
          type: 'string', enum: ['casa', 'departamento', 'ph', 'lote', 'local', 'oficina'],
          description: 'Tipo de propiedad.'
        },
        zona: { type: 'string', description: 'Barrio o localidad que pidió el cliente.' },
        ambientes: { type: 'integer', description: 'Cantidad exacta de ambientes.' },
        precio_max: { type: 'number', description: 'Tope de presupuesto. Requiere moneda.' },
        moneda: {
          type: 'string', enum: ['USD', 'ARS'],
          description: 'Moneda del presupuesto: USD para dólares, ARS para pesos.'
        }
      },
      required: []
    }
  },
  {
    name: 'guardar_datos_cliente',
    description:
      'Guarda en el sistema los datos que el cliente te da en la charla: nombre, apellido y/o correo. ' +
      'Usala apenas un cliente nuevo se presenta (así la próxima vez ya lo conocemos) o cuando ' +
      'corrige un dato. Pasá SOLO campos nuevos o corregidos en esta charla; no inventes ninguno ' +
      'y no la repitas con datos que ya guardaste antes.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de pila del cliente.' },
        apellido: { type: 'string', description: 'Apellido del cliente.' },
        correo: { type: 'string', description: 'Correo electrónico del cliente.' }
      },
      required: []
    }
  },
  {
    name: 'cerrar_conversacion',
    description:
      'Marcá la conversación como terminada cuando el cliente se despide o ya no ' +
      'necesita nada más (ej: "listo, gracias", "no, nada más"). Llamala JUNTO con tu ' +
      'mensaje de despedida. No la llames si la charla todavía sigue.',
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'derivar_a_asesor',
    description:
      'Derivá la conversación a un asesor humano cuando no puedas resolver el pedido ' +
      '(reclamos, casos complejos, algo fuera de tus herramientas) o cuando el cliente ' +
      'pida hablar con una persona. Pasá un "motivo" breve con lo que necesita. Avisale ' +
      'al cliente, en tu mensaje, que lo vas a derivar y que un asesor lo contacta.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Breve descripción de lo que necesita el cliente o por qué se deriva.' }
      },
      required: ['motivo']
    }
  }
];

// ------------------------------------------------------------
// EJECUCIÓN: corre la tool que pidió Claude y devuelve un texto/objeto
// con el resultado. `contexto` trae datos que el cliente NO debe elegir
// (ej: su propio número), que inyectamos nosotros desde el webhook.
// ------------------------------------------------------------
async function ejecutar(nombre, input, contexto = {}) {
  if (nombre === 'consultar_info_negocio') {
    return await consultarInfoNegocio();
  }
  if (nombre === 'buscar_propiedades') {
    return await propiedades.buscar(pool, input);
  }
  if (nombre === 'guardar_datos_cliente') {
    return await clientes.actualizarPersona(contexto.numero, input);
  }
  if (nombre === 'cerrar_conversacion') {
    // No resumimos acá (el mensaje final del agente todavía no está guardado);
    // solo marcamos el cierre y webhook.js dispara el resumen al final.
    contexto.cerrar = true;
    return { ok: true };
  }
  if (nombre === 'derivar_a_asesor') {
    // Igual que el cierre: marcamos el pedido y webhook.js ejecuta la derivación
    // al final (con el mensaje de aviso al cliente ya enviado).
    contexto.derivar = input.motivo || 'Sin motivo especificado';
    return { ok: true };
  }
  // Tool desconocida: se lo decimos a Claude para que no se cuelgue.
  return { error: `Herramienta desconocida: ${nombre}` };
}

// Tool DEMO del esqueleto: devuelve los datos del negocio (tabla negocio_info).
// Claude los redacta para el cliente.
async function consultarInfoNegocio() {
  const res = await pool.query('SELECT clave, valor FROM negocio_info ORDER BY clave');
  if (res.rows.length === 0) {
    return { nota: 'No hay datos del negocio cargados todavía.' };
  }
  const info = {};
  for (const fila of res.rows) info[fila.clave] = fila.valor;
  return { negocio: info };
}

module.exports = { DEFINICIONES, ejecutar };
