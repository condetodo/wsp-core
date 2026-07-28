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

  // --- Inventario inmobiliario ---------------------------------------------
  // El PROYECTO: un edificio o barrio con muchas unidades. Lo que es común a
  // todas ellas (estado de obra, entrega, financiación) vive acá una sola vez.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS desarrollos (
      id           BIGSERIAL PRIMARY KEY,
      nombre       TEXT NOT NULL,
      zona         TEXT,
      direccion    TEXT,
      estado_obra  TEXT NOT NULL DEFAULT 'pozo',
      entrega      DATE,
      financiacion TEXT,
      descripcion  TEXT,
      activo       BOOLEAN NOT NULL DEFAULT true,
      creado       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // La UNIDAD concreta, que es sobre lo que corre siempre la búsqueda.
  // desarrollo_id nullable es la clave del modelo: null = propiedad suelta
  // (una casa en venta), con valor = unidad de un proyecto. Gracias a eso un
  // filtro por ambientes y precio encuentra a las dos por igual.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS propiedades (
      id            BIGSERIAL PRIMARY KEY,
      desarrollo_id BIGINT REFERENCES desarrollos(id),
      operacion     TEXT NOT NULL,
      tipo          TEXT NOT NULL,
      zona          TEXT,
      direccion     TEXT,
      ambientes     INTEGER,
      dormitorios   INTEGER,
      superficie_m2 NUMERIC(10,2),
      precio        NUMERIC(14,2),
      moneda        TEXT NOT NULL DEFAULT 'USD',
      expensas      NUMERIC(12,2),
      descripcion   TEXT,
      link          TEXT,
      estado        TEXT NOT NULL DEFAULT 'disponible',
      creado        TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_propiedades_busqueda
    ON propiedades (estado, operacion, tipo);`);
}

module.exports = { init };
