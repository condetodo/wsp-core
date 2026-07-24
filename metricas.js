// ============================================================
// MÉTRICAS del panel: agente (volumen, resolución autónoma) y asesores
// (casos tomados, tiempos). Lee historial y casos.
// La solapa Métricas pide todo junto vía resumenMetricas(dias).
// Las métricas del VERTICAL (ej. turnos agendados por el bot) se agregan
// por cliente, junto con sus tablas.
// ============================================================
require('dotenv').config();
const { pool } = require('./db');
const { estadoCaso } = require('./casos');

// Promedio en MINUTOS (redondeado) de duraciones en ms, ignorando null. PURA.
function promedioMin(duraciones) {
  const validas = duraciones.filter((d) => d != null);
  if (!validas.length) return null;
  const prom = validas.reduce((a, b) => a + b, 0) / validas.length;
  return Math.round(prom / 60000);
}

// ms entre dos timestamps (o null si falta alguno). PURA.
function duracion(desde, hasta) {
  if (!desde || !hasta) return null;
  return new Date(hasta).getTime() - new Date(desde).getTime();
}

// Estadísticas por asesor a partir de las filas de `casos`. PURA.
// Un caso cuenta para el asesor que lo TOMÓ. Los expirados sin tomar no son de nadie.
function agregarPorAsesor(casos) {
  const porAsesor = new Map();
  for (const c of casos) {
    if (!c.tomado_por) continue;
    if (!porAsesor.has(c.tomado_por)) {
      porAsesor.set(c.tomado_por, { asesor: c.tomado_por, tomados: 0, abiertos: 0, expirados: 0, esperas: [], resoluciones: [] });
    }
    const f = porAsesor.get(c.tomado_por);
    f.tomados++;
    if (c.expirado) f.expirados++;
    else if (!c.resuelto_en) f.abiertos++;
    f.esperas.push(duracion(c.derivado_en, c.tomado_en));
    if (c.resuelto_en) f.resoluciones.push(duracion(c.tomado_en, c.resuelto_en));
  }
  return [...porAsesor.values()]
    .map(({ esperas, resoluciones, ...f }) => ({
      ...f,
      esperaPromMin: promedioMin(esperas),
      resolucionPromMin: promedioMin(resoluciones),
    }))
    .sort((a, b) => b.tomados - a.tomados);
}

// Todo lo que necesita la solapa Métricas, en una sola llamada.
// dias: ventana del período (7 o 30).
async function resumenMetricas(dias = 30) {
  const d = Math.max(1, Math.min(365, Number(dias) || 30));

  // --- AGENTE ---------------------------------------------------------------
  // Volumen: mensajes de clientes y clientes únicos por día (hora Argentina).
  const porDia = await pool.query(
    `SELECT to_char(creado AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS dia,
            COUNT(*)::int AS mensajes,
            COUNT(DISTINCT persona_id)::int AS clientes
       FROM historial
      WHERE rol = 'user' AND creado >= now() - make_interval(days => $1)
      GROUP BY 1 ORDER BY 1 DESC`,
    [d]
  );

  const totales = await pool.query(
    `SELECT COUNT(*)::int AS mensajes, COUNT(DISTINCT persona_id)::int AS clientes
       FROM historial
      WHERE rol = 'user' AND creado >= now() - make_interval(days => $1)`,
    [d]
  );

  // Derivaciones del período (solo las que abrió el bot) y motivos frecuentes.
  const derivaciones = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(DISTINCT telefono)::int AS clientes
       FROM casos
      WHERE origen = 'bot' AND derivado_en >= now() - make_interval(days => $1)`,
    [d]
  );
  const motivos = await pool.query(
    `SELECT COALESCE(motivo, 'sin motivo') AS motivo, COUNT(*)::int AS veces
       FROM casos
      WHERE origen = 'bot' AND derivado_en >= now() - make_interval(days => $1)
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    [d]
  );

  // --- ASESORES ---------------------------------------------------------------
  const casos = await pool.query(
    `SELECT c.*, p.nombre, p.apellido
       FROM casos c
       LEFT JOIN personas p ON p.telefono = c.telefono
      WHERE c.derivado_en >= now() - make_interval(days => $1)
      ORDER BY c.derivado_en DESC
      LIMIT 100`,
    [d]
  );

  const t = totales.rows[0];
  const der = derivaciones.rows[0];
  return {
    dias: d,
    agente: {
      mensajes: t.mensajes,
      clientes: t.clientes,
      porDia: porDia.rows,
      derivaciones: der.total,
      clientesDerivados: der.clientes,
      // % de clientes atendidos que el bot resolvió sin derivar.
      resolucionAutonoma: t.clientes ? Math.max(0, Math.round((1 - der.clientes / t.clientes) * 100)) : null,
      motivos: motivos.rows,
    },
    asesores: {
      porAsesor: agregarPorAsesor(casos.rows),
      casos: casos.rows.map((c) => {
        const espera = duracion(c.derivado_en, c.tomado_en);
        const resolucion = duracion(c.tomado_en, c.resuelto_en);
        return {
          telefono: c.telefono,
          cliente: [c.nombre, c.apellido].filter(Boolean).join(' ') || null,
          motivo: c.motivo,
          origen: c.origen,
          estado: estadoCaso(c),
          derivado_en: c.derivado_en,
          tomado_por: c.tomado_por,
          esperaMin: espera != null ? Math.round(espera / 60000) : null,
          resolucionMin: resolucion != null ? Math.round(resolucion / 60000) : null,
        };
      }),
    },
  };
}

module.exports = { promedioMin, duracion, agregarPorAsesor, resumenMetricas };
