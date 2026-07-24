// ============================================================
// PIEZA 2: webhook (mensajes ENTRANTES) + RESPUESTA con IA (Fase 3)
// Acá Meta te habla a vos. Cuando entra un mensaje de texto, el agente
// de Claude genera la respuesta y este código la manda solo.
// Lo corrés con:  node webhook.js
// ============================================================
require('dotenv').config();
const path = require('path');
const express = require('express');
const { init } = require('./db');
const { registrarMensaje, normalizar } = require('./contactos');
const { agregar, obtener } = require('./historial');
const { perfilParaAgente, buscarOcrearPersona, enAsesorActivo, reactivar } = require('./clientes');
const { responder } = require('./agente');
const { resumirConversacion, resumirInactivas } = require('./resumir');
const { derivarAAsesor } = require('./derivacion');
const { enviarTexto } = require('./enviar');
const { expirarCaso, mejorEsfuerzo } = require('./casos');
const { interpretarRespuesta, textoAgradecimiento, registrarRespuesta, registrarTemplateEncuesta, encuestaActiva, botonesDe } = require('./encuestas');

const app = express();
// Railway termina el TLS en su proxy: confiamos en X-Forwarded-Proto para que la
// cookie `secure` del panel se setee bien (req.secure refleje el https real).
app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' })); // 8mb: el panel sube imágenes de header en base64

// Recursos estáticos (logo y branding del negocio, etc.) servidos en /assets.
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Panel web del asesor (rutas /panel/*). Se desactiva solo si falta PANEL_SECRET.
app.use('/panel', require('./panel'));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
// Clave para disparar tareas administrativas por URL (ej: resumir inactivas).
// La inventás vos y la ponés en Railway. Si no está, las tareas quedan desactivadas.
const TAREAS_KEY = process.env.TAREAS_KEY;
// En local usamos el 3000; en la nube (Railway) el puerto lo asigna el servidor
// y nos lo pasa por process.env.PORT. Hay que respetarlo o el deploy no arranca.
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// RUTA 1: GET /webhook  →  el "apretón de manos" de verificación
// ------------------------------------------------------------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado por Meta.');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Verificación fallida (token no coincide).');
    res.sendStatus(403);
  }
});

// ------------------------------------------------------------
// RUTA 2: POST /webhook  →  acá llegan los mensajes entrantes
// ------------------------------------------------------------
app.post('/webhook', (req, res) => {
  // 1) Le respondemos 200 a Meta YA, sin esperar a la IA.
  //    Claude tarda unos segundos en responder. Si hiciéramos esperar a Meta,
  //    creería que fallamos y reintentaría, generando respuestas duplicadas.
  //    Por eso: contestamos primero, procesamos después (en segundo plano).
  res.sendStatus(200);

  // 2) Procesamos el mensaje aparte, sin bloquear la respuesta a Meta.
  procesarMensaje(req.body).catch((err) =>
    console.error('❌ Error procesando el mensaje:', err.message)
  );
});

// ------------------------------------------------------------
// RUTA 4: GET /tareas/resumir-inactivas  →  resume las charlas quietas.
// Protegida con la misma clave. Pensada para un cron (cada ~30-60 min).
// Opcional: ?minutos=120 para ajustar el umbral de inactividad.
// ------------------------------------------------------------
app.get('/tareas/resumir-inactivas', async (req, res) => {
  if (!TAREAS_KEY) {
    return res.status(503).send('TAREAS_KEY no configurada: tarea desactivada.');
  }
  if (req.query.key !== TAREAS_KEY) {
    return res.sendStatus(403);
  }
  try {
    const minutos = req.query.minutos ? parseInt(req.query.minutos, 10) : 120;
    const resumen = await resumirInactivas(minutos);
    console.log('🧠 Resúmenes inactivas:', JSON.stringify(resumen));
    res.json(resumen);
  } catch (err) {
    console.error('❌ Error resumiendo inactivas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// RUTA: GET /tareas/crear-encuesta?key=...  →  registra el template de
// encuesta de satisfacción en Meta y lo da de alta en el panel. Se abre UNA
// vez desde el navegador; es idempotente (si ya existe, no duplica nada).
// ------------------------------------------------------------
app.get('/tareas/crear-encuesta', async (req, res) => {
  if (!TAREAS_KEY) {
    return res.status(503).send('TAREAS_KEY no configurada: tarea desactivada.');
  }
  if (req.query.key !== TAREAS_KEY) {
    return res.sendStatus(403);
  }
  try {
    const r = await registrarTemplateEncuesta();
    console.log('📊 Registro de template de encuesta:', JSON.stringify(r));
    res.status(r.ok ? 200 : 502).json(r);
  } catch (err) {
    console.error('❌ Error registrando template de encuesta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// RUTA 5: GET /tareas/reactivar?key=...&numero=...  →  reactiva el bot para
// un cliente que estaba en manos de un asesor.
// ------------------------------------------------------------
app.get('/tareas/reactivar', async (req, res) => {
  if (!TAREAS_KEY) {
    return res.status(503).send('TAREAS_KEY no configurada: tarea desactivada.');
  }
  if (req.query.key !== TAREAS_KEY) {
    return res.sendStatus(403);
  }
  const numero = req.query.numero;
  if (!numero) {
    return res.status(400).send('Falta el parámetro "numero".');
  }
  try {
    // Reactivación manual: el caso no lo resolvió un asesor, expira. Mejor
    // esfuerzo: las métricas nunca frenan la reactivación real.
    await mejorEsfuerzo(expirarCaso(normalizar(numero)));
    await reactivar(numero);
    console.log(`🔈 Bot reactivado manualmente para ${numero}.`);
    res.json({ ok: true, numero });
  } catch (err) {
    console.error('❌ Error reactivando:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Toda la lógica de "entender el mensaje y responder con IA" vive acá.
async function procesarMensaje(cuerpo) {
  const mensaje = cuerpo?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  // Si no es un mensaje (ej: un aviso de "entregado/leído"), no hacemos nada.
  if (!mensaje) return;

  const de = mensaje.from; // número del cliente

  // Cualquier mensaje entrante reinicia su ventana de 24hs.
  await registrarMensaje(de);

  // Toque de un botón de template (ej: la encuesta de satisfacción). No pasa
  // por el agente: se interpreta, se guarda y se agradece acá mismo.
  if (mensaje.type === 'button') {
    await procesarBoton(de, mensaje);
    return;
  }

  // Por ahora el agente solo entiende texto (no audios/imágenes).
  if (mensaje.type !== 'text') {
    console.log(`💬 ${de} mandó algo tipo "${mensaje.type}" (el agente solo maneja texto por ahora).`);
    return;
  }

  const texto = mensaje.text.body;
  console.log(`💬 ${de} dijo: "${texto}"`);

  // 1) Guardamos lo que dijo el cliente en su historial.
  await agregar(de, 'user', texto);

  // 1.5) Si el cliente está en manos de un asesor (y no venció el timeout), el
  //      bot NO responde: el humano está atendiendo. El mensaje ya quedó guardado.
  const { persona } = await buscarOcrearPersona(de);
  if (persona.en_asesor) {
    // Si un asesor lo tomó, el bot calla SIEMPRE (no aplica timeout).
    // Si nadie lo tomó pero sigue dentro de las 24 h, también calla.
    if (persona.atendido_por || enAsesorActivo(persona)) {
      console.log(`🔇 ${de} en manos de un asesor; el bot no responde.`);
      return;
    }
    // Venció el timeout y nadie lo tomó -> reactivamos el bot.
    // El caso no se resolvió: expira (Métricas). Mejor esfuerzo: las métricas
    // nunca frenan la reactivación real.
    await mejorEsfuerzo(expirarCaso(normalizar(de)));
    await reactivar(de);
    console.log(`🔈 ${de} reactivado (venció el timeout, sin asesor a cargo).`);
  }

  // 2) Identificamos al cliente y armamos su contexto 360 (quién es, datos
  //    del negocio, último resumen) para que el agente no repita preguntas.
  const { perfil } = await perfilParaAgente(de);

  // 3) Le pasamos la conversación + el número + el perfil al agente.
  //    El contexto es mutable: si el agente cierra la charla, deja contexto.cerrar.
  const historial = await obtener(de);
  const contexto = { numero: de, perfil };
  const respuesta = await responder(historial, contexto);

  // 4) Enviamos y guardamos la respuesta, SOLO si no está vacía (Meta rechaza
  //    los mensajes vacíos). Si quedó vacía, igual seguimos al cierre.
  if (respuesta && respuesta.trim()) {
    await enviarTexto(de, respuesta);
    await agregar(de, 'assistant', respuesta);
    console.log(`🤖 respondió: "${respuesta}"`);
  } else {
    console.warn(`⚠️  respuesta vacía para ${de}, no se envía.`);
  }

  // 6) Si el agente marcó el cierre, resumimos la conversación (con el mensaje
  //    de despedida ya guardado) y limpiamos el historial crudo.
  if (contexto.cerrar) {
    const r = await resumirConversacion(de);
    if (r.resumido) console.log(`🧠 conversación resumida para ${de}`);
  }

  // 7) Si el agente pidió derivar, marcamos en_asesor y avisamos al asesor.
  if (contexto.derivar) {
    const d = await derivarAAsesor(de, contexto.derivar);
    console.log(`🙋 ${de} derivado a un asesor (notificados: ${d.notificados}).`);
  }
}

// Toque de un botón de template. Se interpreta contra los botones de la
// encuesta activa (la creada desde el panel); si el texto no coincide (ej: un
// botón de otro template futuro) cae al log sin romper nada.
async function procesarBoton(de, mensaje) {
  const texto = mensaje.button && mensaje.button.text;
  const activa = await encuestaActiva();
  const botones = botonesDe(activa);
  const opcion = interpretarRespuesta(texto, botones);
  if (!opcion) {
    console.log(`🔘 ${de} tocó un botón desconocido: "${texto}" (no es de la encuesta activa).`);
    return;
  }

  // context.id = wamid del mensaje de encuesta que respondió (para no duplicar
  // si toca dos veces un botón del mismo mensaje).
  await registrarRespuesta({ telefono: de, respuesta: opcion, wamid: mensaje.context && mensaje.context.id });
  console.log(`📊 ${de} respondió la encuesta: ${opcion}`);

  // Lo dejamos en el historial (el toque abre la ventana de 24hs, así que
  // podemos agradecer con texto libre) y agradecemos.
  await agregar(de, 'user', `[Encuesta] ${opcion}`);
  const gracias = textoAgradecimiento(opcion, botones);
  await enviarTexto(de, gracias);
  await agregar(de, 'assistant', gracias);
}

// Antes de aceptar mensajes, nos aseguramos de que las tablas existan.
init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🟢 Webhook + agente IA escuchando en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ No se pudo inicializar la base de datos:', err.message);
    process.exit(1);
  });
