// ============================================================
// EL AGENTE DE IA (el corazón de la Fase 3, ampliado en la Fase 5).
// Recibe el historial de una conversación y devuelve la respuesta de Claude.
//
// El agente tiene HERRAMIENTAS (ver herramientas.js): las acciones reales
// que puede ejecutar sobre el negocio. Eso agrega un "loop":
// Claude pide una tool → la ejecutamos → le devolvemos el resultado →
// vuelve a pensar. Repetimos hasta que da una respuesta final de texto.
// ============================================================
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { DEFINICIONES, ejecutar } = require('./herramientas');
const { registrarUso, costoUSD } = require('./uso');

// El cliente lee la clave ANTHROPIC_API_KEY del .env automáticamente.
const client = new Anthropic();

// El modelo del agente se resuelve por respuesta vía modeloActivo() (config
// de la DB, editable en la solapa Costos > env MODELO_AGENTE > Sonnet).
const { modeloActivo } = require('./config');

// Tope de vueltas del loop de tools, por las dudas (evita un bucle infinito
// si algo sale mal). En la práctica con 1-2 alcanza de sobra.
const MAX_VUELTAS = 5;

// ------------------------------------------------------------
// LA PERSONALIDAD DEL NEGOCIO ("system prompt") vive en cliente/personalidad.js:
// es el archivo que se escribe para cada negocio nuevo. El motor de acá abajo
// no se toca al dar de alta un cliente.
// ------------------------------------------------------------
const { PERSONALIDAD } = require('./cliente/personalidad');

// Fecha/hora actual en zona Argentina, para que el agente resuelva expresiones
// relativas ("el lunes", "mañana") a fechas concretas YYYY-MM-DD.
function contextoTemporal() {
  const tz = 'America/Argentina/Buenos_Aires';
  const hoy = new Date();
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(hoy); // YYYY-MM-DD
  const legible = new Intl.DateTimeFormat('es-AR', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(hoy);
  return `Fecha actual: hoy es ${legible} (${iso}), zona horaria de Argentina. ` +
    `Cuando el cliente diga "el lunes", "mañana", etc., convertí a una fecha concreta YYYY-MM-DD.`;
}

// Recibe el historial (array de { role, content }) y un contexto
// (ej: { numero } del cliente) y devuelve el texto de respuesta.
// opciones (solo para tests/simulaciones; en producción no se pasa):
//   modelo: usar otro modelo en vez del default.
//   sinRegistro: no guardar el consumo en la base (no ensucia la solapa Costos).
async function responder(historial, contexto = {}, opciones = {}) {
  const modelo = opciones.modelo || await modeloActivo();
  // Armamos el system: personalidad + fecha actual + (si lo hay) el perfil 360
  // del cliente, para que el agente sepa con quién habla y en qué fecha está.
  const partes = [PERSONALIDAD, contextoTemporal()];
  if (contexto.perfil) partes.push(contexto.perfil);
  const system = partes.join('\n\n');

  // Trabajamos sobre una COPIA: al historial persistido solo le sumamos
  // texto (lo hace webhook.js). Los pasos intermedios de tools viven acá.
  const mensajes = [...historial];

  // Recordamos el último texto NO vacío: a veces el agente dice su mensaje
  // (ej: una despedida) en el MISMO turno en que pide una tool, y después no
  // agrega más texto. Sin esto, devolveríamos "" y el envío a Meta falla.
  let ultimoTexto = '';

  // Acumulamos el consumo de tokens de TODAS las vueltas de este mensaje
  // (cada vuelta de tools es una llamada aparte a la API y se cobra aparte).
  const uso = { entrada: 0, salida: 0, llamadas: 0 };

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const respuesta = await client.messages.create({
      model: modelo,
      max_tokens: 1024,
      system: system,
      tools: DEFINICIONES, // le mostramos el menú de herramientas
      messages: mensajes
    });

    uso.entrada += respuesta.usage.input_tokens;
    uso.salida += respuesta.usage.output_tokens;
    uso.llamadas++;

    const textoTurno = textoDe(respuesta);
    if (textoTurno) ultimoTexto = textoTurno;

    // ¿Claude quiere usar una o más herramientas?
    if (respuesta.stop_reason === 'tool_use') {
      // 1) Guardamos en la conversación lo que "pensó" (incluye los pedidos de tool).
      mensajes.push({ role: 'assistant', content: respuesta.content });

      // 2) Ejecutamos cada tool pedida y juntamos los resultados.
      const resultados = [];
      for (const bloque of respuesta.content) {
        if (bloque.type !== 'tool_use') continue;
        console.log(`🔧 Usando herramienta: ${bloque.name}(${JSON.stringify(bloque.input)})`);

        let resultado;
        try {
          resultado = await ejecutar(bloque.name, bloque.input, contexto);
        } catch (err) {
          resultado = { error: err.message };
        }

        resultados.push({
          type: 'tool_result',
          tool_use_id: bloque.id,
          content: JSON.stringify(resultado)
        });
      }

      // 3) Le devolvemos los resultados a Claude y volvemos a iterar.
      mensajes.push({ role: 'user', content: resultados });
      continue;
    }

    // No pidió tools: esta es la respuesta final. Si este turno no trajo texto
    // (porque ya lo dijo en un turno con tool), devolvemos el último no vacío.
    contexto.uso = uso; // los tests/simulaciones leen el consumo de acá
    if (!opciones.sinRegistro) logUso(uso, contexto.numero, modelo);
    return textoTurno || ultimoTexto;
  }

  // Si nos pasamos de vueltas, devolvemos algo seguro en vez de colgarnos.
  console.warn('⚠️  Se alcanzó el máximo de vueltas de herramientas.');
  contexto.uso = uso;
  if (!opciones.sinRegistro) logUso(uso, contexto.numero, modelo);
  return 'Perdón, tuve un problema procesando eso. ¿Lo podés repetir?';
}

// Loguea el consumo del mensaje (todas las vueltas sumadas) y lo guarda en la
// base para la solapa Costos. Si la base falla, la respuesta al cliente sale
// igual: acá solo avisamos por consola.
function logUso(uso, numero, modelo) {
  const { entrada, salida, llamadas } = uso;
  if (!llamadas) return;
  console.log(
    `💰 Tokens: ${entrada} entrada + ${salida} salida en ${llamadas} llamada(s)` +
    ` ≈ USD ${costoUSD(entrada, salida, modelo).toFixed(4)}`
  );
  registrarUso({ numero, modelo, entrada, salida, llamadas }).catch((err) =>
    console.error('⚠️  No se pudo guardar el uso de tokens:', err.message)
  );
}

// La respuesta viene como una lista de "bloques"; juntamos los de texto.
function textoDe(respuesta) {
  return respuesta.content
    .filter((bloque) => bloque.type === 'text')
    .map((bloque) => bloque.text)
    .join('');
}

module.exports = { responder };
