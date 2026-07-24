// ============================================================
// SCHEMA DEL VERTICAL — ARCHIVO POR CLIENTE.
// Acá van las tablas propias del negocio (las que usan sus herramientas y su
// contexto 360). db.js llama a init(pool) después de crear las tablas core.
//
// En el esqueleto base solo existe `negocio_info`, la tabla que alimenta la
// tool demo consultar_info_negocio. Al dar de alta un cliente, agregá acá las
// tablas de su vertical (ej. en el concesionario: autos, vehiculos, servicios,
// taller_horarios, taller_config, razones_sociales).
// ============================================================

async function init(pool) {
  // Datos básicos del negocio (clave/valor), editables sin tocar código.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS negocio_info (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
  `);

  // Sembramos los datos demo solo si está vacía (no pisamos ediciones).
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM negocio_info');
  if (rows[0].n === 0) {
    await pool.query(`
      INSERT INTO negocio_info (clave, valor) VALUES
        ('nombre',    'Demo'),
        ('horario',   'lunes a viernes de 9 a 18 hs'),
        ('direccion', 'Av. Siempreviva 742, Buenos Aires'),
        ('contacto',  'info@demo.com.ar');
    `);
    console.log('🌱 Datos del negocio demo sembrados (negocio_info).');
  }
}

module.exports = { init };
