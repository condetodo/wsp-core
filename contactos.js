// ============================================================
// Pieza compartida: memoria simple de "quién nos escribió y cuándo".
// La usan webhook.js (para anotar) y puedo-escribir.js (para consultar).
// Antes guardaba todo en contactos.json; ahora vive en Postgres (ver db.js)
// para que no se borre en cada redeploy de Railway.
// ============================================================
const { pool } = require('./db');

// Normaliza un número a UNA sola forma, para que el mismo cliente no se
// guarde de dos maneras distintas.
// Problema argentino: WhatsApp identifica a los celulares AR como "549..."
// (con el 9), pero para mandar usamos "54..." (sin el 9). Acá unificamos
// todo a la forma canónica CON el 9, que es la que usa WhatsApp internamente.
// (Sigue siendo una función pura: no toca la base.)
function normalizar(numero) {
  let n = String(numero).replace(/\D/g, ''); // dejamos solo dígitos
  if (n.startsWith('54') && !n.startsWith('549')) {
    n = '549' + n.slice(2); // AR sin el 9 -> le agregamos el 9
  }
  return n;
}

// Anota que "numero" nos escribió AHORA (timestamp en ms). Vive en personas
// (que ya es la fuente de verdad del número). Crea la persona si es nueva.
async function registrarMensaje(numero) {
  await pool.query(
    `INSERT INTO personas (telefono, ultimo_mensaje)
     VALUES ($1, $2)
     ON CONFLICT (telefono) DO UPDATE SET ultimo_mensaje = EXCLUDED.ultimo_mensaje`,
    [normalizar(numero), Date.now()]
  );
}

// Devuelve el timestamp del último mensaje de "numero", o null si nunca escribió.
// OJO: personas tiene filas de TODOS (importados, derivados...), muchos con
// ultimo_mensaje NULL → eso también es "nunca escribió" (ventana cerrada).
async function ultimoMensaje(numero) {
  const { rows } = await pool.query(
    'SELECT ultimo_mensaje FROM personas WHERE telefono = $1',
    [normalizar(numero)]
  );
  return rows.length && rows[0].ultimo_mensaje != null ? Number(rows[0].ultimo_mensaje) : null;
}

// Exportamos también normalizar para que otros módulos (ej. historial.js)
// usen exactamente la misma forma canónica de los números.
module.exports = { registrarMensaje, ultimoMensaje, normalizar };
