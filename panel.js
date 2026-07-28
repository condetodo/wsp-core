// ============================================================
// PANEL DEL ASESOR (Opción B). Router de Express montado en /panel.
// Login individual (asesores) con sesión en cookie firmada (cookie-session).
// Si falta PANEL_SECRET, el panel queda DESACTIVADO (no se expone abierto).
// ============================================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const { verificar, sesionValida } = require('./asesores');
const { listarDerivados, tomar, reactivar, obtenerDatos360, estadoAsignacion, listarEnBot, intervenir } = require('./clientes');
const { obtenerParaPanel, agregar } = require('./historial');
const { enviarTexto } = require('./enviar');
const { resumirConversacion } = require('./resumir');
const plantillas = require('./plantillas');
const { crearTemplate, estadosTemplates } = require('./meta-templates');
const { enviarTemplate, subirMediaImagen } = require('./enviar-template');
const { resumenCostos, desgloseDia, diaValido } = require('./uso');
const { MODELOS, guardarConfig, modeloActivo } = require('./config');
const { normalizar } = require('./contactos');
const { resolverCaso, mejorEsfuerzo } = require('./casos');
const { resumenMetricas } = require('./metricas');
const { resumenPanelEncuestas, registrarTemplateEncuesta } = require('./encuestas');

const router = express.Router();
const PANEL_SECRET = process.env.PANEL_SECRET;

if (!PANEL_SECRET) {
  console.warn('⚠️  PANEL_SECRET no configurado: el panel del asesor queda DESACTIVADO.');
  router.use((req, res) => res.status(503).send('Panel desactivado (falta PANEL_SECRET).'));
  module.exports = router;
  return;
}

router.use(express.urlencoded({ extended: false }));
router.use(express.json({ limit: '8mb' })); // 8mb: la imagen de header viaja en base64
router.use(cookieSession({
  name: 'panel',
  secret: PANEL_SECRET,
  maxAge: 12 * 60 * 60 * 1000, // 12 h
  sameSite: 'lax',
  httpOnly: true,
  // El panel se sirve por HTTPS en Railway. secure exige que la cookie viaje cifrada;
  // necesita 'trust proxy' (ver webhook.js) para detectar el https detrás del proxy.
  secure: true,
}));
// Rolling: tocar la sesión en cada request renueva la cookie (expira por inactividad).
router.use((req, res, next) => {
  if (req.session && req.session.usuario) req.session.touched = Date.now();
  next();
});

// --- Login (sin guard) ---
router.get('/login', (req, res) => {
  res.type('html').send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Ingreso</title>
    <link rel="stylesheet" href="/assets/branding.css">
    <script src="/assets/branding.js" defer></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      :root{
        --bg:#efece4;--surface:#fffdf8;--surface-2:#f7f4ec;--ink:#23211d;--muted:#827d72;
        --line:#e7e1d4;--line-strong:#d9d2c2;
        --warn:#c1502a;--warn-soft:#f7e7df;
        --shadow-sm:0 1px 2px rgba(40,34,24,.06),0 1px 3px rgba(40,34,24,.04);
        --shadow-md:0 18px 50px -18px rgba(40,34,24,.30),0 4px 12px rgba(40,34,24,.06);
      }
      *{box-sizing:border-box}html,body{height:100%}
      body{
        font-family:'Hanken Grotesk',system-ui,sans-serif;margin:0;color:var(--ink);
        background:
          radial-gradient(1200px 500px at 85% -10%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 60%),
          radial-gradient(900px 500px at -5% 110%, rgba(193,80,42,.06), transparent 55%),
          var(--bg);
        min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
        -webkit-font-smoothing:antialiased;font-feature-settings:"ss01","cv01";
      }
      .card{
        background:var(--surface);border:1px solid var(--line);border-radius:18px;
        box-shadow:var(--shadow-md);padding:32px 28px;width:100%;max-width:360px;
      }
      .brand{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:24px}
      .brand img{width:132px;height:auto;display:block}
      .brand p{
        margin:14px 0 0;font-family:'Bricolage Grotesque';font-weight:700;font-size:15px;
        color:var(--muted);letter-spacing:.3px;
      }
      label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:14px 0 5px}
      input{
        width:100%;padding:11px 13px;font:inherit;color:var(--ink);
        background:var(--surface-2);border:1px solid var(--line-strong);border-radius:11px;
        outline:none;transition:border-color .15s,box-shadow .15s,background .15s;
      }
      input:focus{border-color:var(--accent);background:var(--surface);box-shadow:0 0 0 3px var(--accent-soft)}
      button{
        width:100%;margin-top:22px;padding:12px;cursor:pointer;font:inherit;font-weight:700;
        color:#fff;background:linear-gradient(150deg,var(--accent),var(--accent-ink));
        border:none;border-radius:11px;box-shadow:var(--shadow-sm);transition:filter .15s,transform .04s;
      }
      button:hover{filter:brightness(1.06)}
      button:active{transform:translateY(1px)}
      .err{
        margin-top:16px;font-size:13px;color:var(--warn);background:var(--warn-soft);
        border:1px solid #eccab9;border-radius:10px;padding:9px 12px;
      }
    </style></head>
    <body>
    <form class="card" method="post" action="/panel/login">
      <div class="brand">
        <img src="/assets/logo.svg" alt="">
      </div>
      <label for="usuario">Usuario</label>
      <input id="usuario" name="usuario" placeholder="usuario" autocomplete="username" autofocus>
      <label for="password">Contraseña</label>
      <input id="password" name="password" type="password" placeholder="••••••••" autocomplete="current-password">
      <button type="submit">Ingresar</button>
      ${req.query.error ? '<div class="err">Usuario o contraseña incorrectos.</div>' : ''}
    </form>
    </body></html>`);
});

router.post('/login', async (req, res) => {
  try {
    const datos = await verificar(req.body.usuario, req.body.password);
    if (!datos) return res.redirect('/panel/login?error=1');
    req.session.usuario = datos.usuario;
    req.session.nombre = datos.nombre;
    res.redirect('/panel');
  } catch (err) {
    console.error('❌ Error en login:', err.message);
    res.redirect('/panel/login?error=1');
  }
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/panel/login');
});

// --- Guard: todo lo de abajo requiere sesión ---
router.use((req, res, next) => {
  if (sesionValida(req.session)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'no_session' });
  return res.redirect('/panel/login');
});

// La app (HTML estático)
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel.html'));
});
router.get('/plantillas', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel-plantillas.html'));
});
router.get('/envio', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel-envio.html'));
});
router.get('/historial', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel-historial.html'));
});
router.get('/costos', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel-costos.html'));
});
router.get('/encuestas', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel-encuestas.html'));
});
router.get('/metricas', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel-metricas.html'));
});

// --- API JSON (todo bajo guard) ---

// Usuario logueado (para el bloque de usuario del rail en todas las solapas).
router.get('/api/yo', (req, res) => {
  res.json({ usuario: req.session.usuario, nombre: req.session.nombre || null });
});

// Lista de derivados con su estado y nombre mostrable.
router.get('/api/clientes', async (req, res) => {
  try {
    const [filas, enBot] = await Promise.all([listarDerivados(), listarEnBot()]);
    const clientes = filas.map((p) => ({
      numero: p.telefono,
      nombre: [p.nombre, p.apellido].filter(Boolean).join(' ') || p.telefono,
      estado: estadoAsignacion(p),
      atendido_por: p.atendido_por || null,
    }));
    // Conversaciones que maneja el bot (últimas 24 hs): el panel las muestra
    // en solo lectura, con la opción de intervenir.
    const bot = enBot.map((p) => ({
      numero: p.telefono,
      nombre: [p.nombre, p.apellido].filter(Boolean).join(' ') || p.telefono,
      ultimo_mensaje: p.ultimo_mensaje != null ? Number(p.ultimo_mensaje) : null,
    }));
    res.json({ clientes, bot, yo: req.session.usuario });
  } catch (err) {
    console.error('❌ /api/clientes:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Chat (hasta 100 mensajes) + ficha 360 de un cliente.
// La ficha va ESTRUCTURADA (no el texto-prompt del agente, que está redactado
// como instrucciones para la IA): el panel la renderiza prolija por secciones.
router.get('/api/chat', async (req, res) => {
  const numero = req.query.numero;
  if (!numero) return res.status(400).json({ error: 'falta_numero' });
  try {
    const mensajes = await obtenerParaPanel(numero, 100);
    const datos = await obtenerDatos360(numero);
    const p = datos.persona || {};
    const ficha = {
      nombre: [p.nombre, p.apellido].filter(Boolean).join(' ') || null,
      telefono: p.telefono || null,
      correo: p.correo || null,
      es_conocido: datos.esConocido,
      resumen: datos.ultimoResumen,
    };
    res.json({ mensajes, ficha });
  } catch (err) {
    console.error('❌ /api/chat:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Tomar un cliente (atómico). Devuelve { tomado: true|false }.
router.post('/api/tomar', async (req, res) => {
  const { numero } = req.body;
  if (!numero) return res.status(400).json({ error: 'falta_numero' });
  try {
    const tomado = await tomar(numero, req.session.usuario);
    res.json({ tomado });
  } catch (err) {
    console.error('❌ /api/tomar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Intervenir una conversación del bot: la deriva y la toma en un solo paso.
// El bot deja de responderle a ese cliente hasta que se cierre el caso.
router.post('/api/intervenir', async (req, res) => {
  const { numero } = req.body;
  if (!numero) return res.status(400).json({ error: 'falta_numero' });
  try {
    const tomado = await intervenir(numero, req.session.usuario);
    res.json({ tomado });
  } catch (err) {
    console.error('❌ /api/intervenir:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Responder al cliente (sale por el número del bot) y guardar en historial.
router.post('/api/responder', async (req, res) => {
  const { numero, texto } = req.body;
  if (!numero || !texto || !texto.trim()) return res.status(400).json({ error: 'datos_invalidos' });
  try {
    const resp = await enviarTexto(numero, texto);
    const entregado = Boolean(resp && Array.isArray(resp.messages));
    if (entregado) {
      await agregar(numero, 'assistant', texto, 'asesor');
    }
    res.json({ entregado });
  } catch (err) {
    console.error('❌ /api/responder:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cerrar el caso: resume la charla y devuelve el cliente al bot.
router.post('/api/cerrar', async (req, res) => {
  const { numero } = req.body;
  if (!numero) return res.status(400).json({ error: 'falta_numero' });
  try {
    await resumirConversacion(numero);
    // Caso resuelto por este asesor. Mejor esfuerzo: las métricas nunca
    // frenan el cierre real.
    await mejorEsfuerzo(resolverCaso(normalizar(numero), req.session.usuario));
    await reactivar(numero);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/cerrar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- API Plantillas ------------------------------------------------------

// Decodifica un data URL base64 (data:image/jpeg;base64,XXXX) a { mime, buffer }.
// Devuelve null si no es una imagen válida o supera 5MB (límite de Meta).
function decodificarImagen(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return null;
  return { mime: m[1], buffer };
}

// Lista de plantillas locales con su estado cacheado.
router.get('/api/plantillas', async (req, res) => {
  try {
    res.json({ plantillas: await plantillas.listarPlantillas() });
  } catch (err) {
    console.error('❌ /api/plantillas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Crear plantilla: la registra en Meta y, si Meta acepta, la guarda local PENDING.
router.post('/api/plantillas', async (req, res) => {
  const { nombre, idioma, categoria, cuerpo, variables, imagen, botones, es_encuesta } = req.body || {};
  if (!nombre || !cuerpo) return res.status(400).json({ error: 'datos_invalidos' });
  try {
    // Imagen de header opcional: llega como data URL base64 (data:image/...;base64,XXXX).
    const header = decodificarImagen(imagen);
    if (imagen && !header) return res.status(400).json({ error: 'imagen_invalida' });

    // Botones de respuesta rápida (opcional; los usa la encuesta). Meta acepta
    // hasta 10 (WhatsApp muestra 3 y el resto en lista); 25 chars c/u.
    const btns = (Array.isArray(botones) ? botones : [])
      .map((b) => String(b).trim().slice(0, 25)).filter(Boolean).slice(0, 10);
    if (es_encuesta && btns.length < 2) return res.status(400).json({ error: 'encuesta_necesita_botones' });

    // Ejemplo para la revisión de Meta: un VALOR representativo por variable.
    // Meta rechaza ejemplos no representativos (mandar "nombre" en vez de "Carlos"),
    // así que mapeamos cada campo a una muestra realista.
    const MUESTRA = { nombre: 'Carlos', apellido: 'Rivarola', correo: 'carlos@ejemplo.com', telefono: '5491100000000' };
    const ejemplos = (variables || []).map((v) => MUESTRA[v.campo] || 'ejemplo');
    const { ok, data } = await crearTemplate({ nombre, idioma, categoria, cuerpo, ejemplos, header, botones: btns });
    if (!ok) return res.status(400).json({ error: 'meta_rechazo', detalle: data });
    const fila = await plantillas.crearPlantilla({
      nombre, idioma, categoria, cuerpo, variables, meta_id: data.id || null, header,
      botones: btns, es_encuesta: !!es_encuesta,
    });
    res.json({ plantilla: fila });
  } catch (err) {
    console.error('❌ POST /api/plantillas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Re-consulta Meta y actualiza el estado cacheado de cada plantilla local.
router.post('/api/plantillas/sync', async (req, res) => {
  try {
    const estados = await estadosTemplates();
    const porNombre = new Map(estados.map((e) => [e.name, e.status]));
    const locales = await plantillas.listarPlantillas();
    for (const p of locales) {
      const estado = porNombre.get(p.nombre);
      if (estado && estado !== p.estado) {
        await plantillas.actualizarEstadoPorNombre(p.nombre, estado);
      }
    }
    res.json({ plantillas: await plantillas.listarPlantillas() });
  } catch (err) {
    console.error('❌ /api/plantillas/sync:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- API Envío masivo ----------------------------------------------------

// Preview de destinatarios para un filtro dado. Devuelve la lista + total.
router.post('/api/destinatarios', async (req, res) => {
  try {
    const base = await plantillas.destinatariosBase();
    const lista = plantillas.filtrarDestinatarios(base, req.body || {});
    res.json({ total: lista.length, destinatarios: lista });
  } catch (err) {
    console.error('❌ /api/destinatarios:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Pequeña pausa entre envíos para no golpear la API de Meta.
function dormir(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Ejecuta el envío masivo: crea la campaña, recorre destinatarios, manda el
// template con sus variables y graba cada resultado. Devuelve el resumen.
router.post('/api/enviar', async (req, res) => {
  const { plantilla_id, filtro } = req.body || {};
  if (!plantilla_id || !filtro) return res.status(400).json({ error: 'datos_invalidos' });
  try {
    const tpl = await plantillas.obtenerPlantilla(plantilla_id);
    if (!tpl) return res.status(404).json({ error: 'plantilla_inexistente' });
    if (tpl.estado !== 'APPROVED') return res.status(400).json({ error: 'plantilla_no_aprobada' });

    const base = await plantillas.destinatariosBase();
    const destinatarios = plantillas.filtrarDestinatarios(base, filtro);
    const campania = await plantillas.crearCampania({
      plantilla_id, filtro, total: destinatarios.length, creada_por: req.session.usuario,
    });

    // Si la plantilla tiene header de imagen, la subimos UNA vez a Meta y
    // reusamos el media id en todos los mensajes de la campaña.
    let headerImageId = null;
    if (tpl.header_tipo === 'IMAGE' && tpl.header_img) {
      const sub = await subirMediaImagen(tpl.header_img, tpl.header_mime || 'image/jpeg');
      if (!sub.ok) {
        await plantillas.cerrarCampania(campania.id, { enviados: 0, errores: destinatarios.length });
        return res.status(400).json({ error: 'fallo_subida_imagen', detalle: sub.data });
      }
      headerImageId = sub.id;
    }

    const variables = Array.isArray(tpl.variables) ? tpl.variables : JSON.parse(tpl.variables || '[]');
    let enviados = 0, errores = 0;
    const detalleErrores = [];

    for (const d of destinatarios) {
      if (!d.telefono) { errores++; detalleErrores.push({ persona_id: d.id, motivo: 'sin_telefono' }); continue; }
      const valores = plantillas.valoresDesdeCliente(d, variables);
      const resp = await enviarTemplate(d.telefono, tpl.nombre, tpl.idioma, valores, headerImageId);
      const wamid = resp && Array.isArray(resp.messages) ? resp.messages[0].id : null;
      if (wamid) {
        await plantillas.registrarEnvio({ campania_id: campania.id, persona_id: d.id, numero: d.telefono, estado: 'enviado', wamid });
        enviados++;
      } else {
        const motivo = resp && resp.error ? `${resp.error.code || ''} ${resp.error.message || ''}`.trim() : 'desconocido';
        await plantillas.registrarEnvio({ campania_id: campania.id, persona_id: d.id, numero: d.telefono, estado: 'error', detalle: motivo });
        errores++;
        detalleErrores.push({ persona_id: d.id, motivo });
      }
      await dormir(300);
    }

    await plantillas.cerrarCampania(campania.id, { enviados, errores });
    res.json({ campania_id: campania.id, total: destinatarios.length, enviados, errores, detalleErrores });
  } catch (err) {
    console.error('❌ /api/enviar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Historial de campañas (para el listado de la pestaña Historial).
router.get('/api/campanias', async (req, res) => {
  try {
    res.json({ campanias: await plantillas.listarCampanias() });
  } catch (err) {
    console.error('❌ /api/campanias:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- API Costos ------------------------------------------------------------

// Resumen de consumo del agente: totales, mes en curso, por día y por cliente.
router.get('/api/costos', async (req, res) => {
  try {
    res.json(await resumenCostos());
  } catch (err) {
    console.error('❌ /api/costos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Desglose por cliente de un día puntual (click en una fila de "Por día").
router.get('/api/costos/dia', async (req, res) => {
  const dia = req.query.dia;
  if (!diaValido(dia)) return res.status(400).json({ error: 'dia_invalido' });
  try {
    res.json({ dia, clientes: await desgloseDia(dia) });
  } catch (err) {
    console.error('❌ /api/costos/dia:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// Modelo del agente: cuál está activo y cuáles se pueden elegir.
router.get('/api/modelo', async (req, res) => {
  try {
    res.json({ activo: await modeloActivo(), disponibles: MODELOS });
  } catch (err) {
    console.error('❌ /api/modelo:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// Cambia el modelo del agente. Aplica al instante (el agente lo lee en cada
// respuesta): sin reinicio ni deploy. Solo acepta ids de la lista MODELOS.
router.post('/api/modelo', async (req, res) => {
  try {
    const { modelo } = req.body || {};
    if (!MODELOS.some((m) => m.id === modelo)) {
      return res.status(400).json({ error: 'modelo_invalido' });
    }
    await guardarConfig('modelo_agente', modelo);
    console.log(`🤖 Modelo del agente cambiado a ${modelo} (desde el panel)`);
    res.json({ ok: true, activo: modelo });
  } catch (err) {
    console.error('❌ POST /api/modelo:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// --- API Encuestas ----------------------------------------------------------

// Resumen para la solapa Encuestas: CSAT, tasa de respuesta, por campaña.
router.get('/api/encuestas', async (req, res) => {
  try {
    res.json(await resumenPanelEncuestas(req.query.dias));
  } catch (err) {
    console.error('❌ /api/encuestas:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// Crea el template de encuesta (Meta + alta local). Botón "Crear encuesta" de
// la solapa. Idempotente: si ya existe, no duplica. Misma lógica que la URL
// /tareas/crear-encuesta, pero con la sesión del panel como protección.
router.post('/api/encuestas/crear', async (req, res) => {
  try {
    const r = await registrarTemplateEncuesta();
    console.log('📊 Registro de template de encuesta (panel):', JSON.stringify(r));
    res.status(r.ok ? 200 : 502).json(r);
  } catch (err) {
    console.error('❌ POST /api/encuestas/crear:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- API Métricas -----------------------------------------------------------

// Resumen de actividad del agente y de los asesores para la solapa Métricas.
router.get('/api/metricas', async (req, res) => {
  try {
    res.json(await resumenMetricas(req.query.dias));
  } catch (err) {
    console.error('❌ /api/metricas:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// Detalle de una campaña: cabecera + envíos por destinatario.
router.get('/api/campanias/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id_invalido' });
  try {
    const detalle = await plantillas.detalleCampania(id);
    if (!detalle) return res.status(404).json({ error: 'campania_inexistente' });
    res.json(detalle);
  } catch (err) {
    console.error('❌ /api/campanias/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
