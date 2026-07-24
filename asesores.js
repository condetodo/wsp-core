// ============================================================
// Asesores del panel: alta, búsqueda y verificación de login.
// Las contraseñas se guardan hasheadas con bcryptjs (JS puro).
// ============================================================
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

// Crea (o actualiza) un asesor con la contraseña hasheada.
async function crearAsesor(usuario, nombre, password, whatsapp = null) {
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO asesores (usuario, password_hash, nombre, whatsapp)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (usuario) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       nombre = EXCLUDED.nombre,
       whatsapp = EXCLUDED.whatsapp,
       activo = true
     RETURNING id, usuario, nombre, whatsapp, activo`,
    [usuario, hash, nombre, whatsapp]
  );
  return rows[0];
}

// Busca un asesor ACTIVO por usuario. Devuelve la fila o null.
async function buscarPorUsuario(usuario) {
  const { rows } = await pool.query(
    'SELECT * FROM asesores WHERE usuario = $1 AND activo = true',
    [usuario]
  );
  return rows.length ? rows[0] : null;
}

// Verifica usuario+password. Devuelve { usuario, nombre } si es válido, o null.
async function verificar(usuario, password) {
  const asesor = await buscarPorUsuario(usuario);
  if (!asesor) return null;
  const ok = await bcrypt.compare(password, asesor.password_hash);
  return ok ? { usuario: asesor.usuario, nombre: asesor.nombre } : null;
}

// Asesores activos con WhatsApp cargado (para el aviso por plantilla).
async function listarConWhatsapp() {
  const { rows } = await pool.query(
    "SELECT usuario, nombre, whatsapp FROM asesores WHERE activo = true AND whatsapp IS NOT NULL AND whatsapp <> ''"
  );
  return rows;
}

// ¿La sesión tiene un asesor logueado? PURA (guard de las rutas del panel).
function sesionValida(session) {
  return Boolean(session && session.usuario);
}

module.exports = { crearAsesor, buscarPorUsuario, verificar, listarConWhatsapp, sesionValida };
