// ============================================================
// CONEXIÓN A LA BASE DE DATOS (Postgres).
// Antes guardábamos todo en archivos JSON (contactos.json, historial.json),
// pero en Railway el disco es EFÍMERO: cada redeploy lo borra. Por eso
// pasamos a una base de datos Postgres, que sí sobrevive a los redeploys.
//
// Railway, al agregar el plugin de Postgres, te inyecta la variable
// DATABASE_URL automáticamente. Este módulo la lee y arma el "pool" de
// conexiones que comparten todos los demás archivos.
// ============================================================
require('dotenv').config();
const { Pool } = require('pg');

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error('❌ Falta DATABASE_URL. En Railway agregá el plugin de Postgres;');
  console.error('   en local, exportá DATABASE_URL apuntando a tu base.');
}

// SSL: la conexión INTERNA de Railway (postgres.railway.internal) y la local
// no usan SSL. La conexión PÚBLICA (proxy.rlwy.net) sí lo exige.
function configSSL() {
  const url = URL || '';
  if (url.includes('railway.internal') || url.includes('localhost') || url.includes('127.0.0.1')) {
    return false;
  }
  return { rejectUnauthorized: false };
}

// Un único pool reutilizado por toda la app (no abrimos una conexión por consulta).
const pool = new Pool({
  connectionString: URL,
  ssl: configSSL()
});

// Crea las tablas si todavía no existen. Se llama una vez al arrancar.
// Acá viven SOLO las tablas core (genéricas de la plataforma); las tablas del
// vertical del negocio se definen en cliente/schema.js y se crean al final.
async function init() {
  // --- Modelo CRM -----------------------------------------------------------
  // El contacto humano: quien escribe por WhatsApp. telefono es la clave de
  // cruce con los mensajes entrantes (forma canónica 549..., ver contactos.js).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS personas (
      id              BIGSERIAL PRIMARY KEY,
      nombre          TEXT,
      apellido        TEXT,
      telefono        TEXT UNIQUE,
      correo          TEXT,
      en_asesor       BOOLEAN NOT NULL DEFAULT false,
      en_asesor_desde TIMESTAMPTZ,
      creado          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Memoria de CONVERSACIÓN por cliente. Se cruza por persona_id (FK a personas)
  // -> va DESPUÉS de personas por la referencia. La migración de más abajo
  // re-clava las bases viejas que todavía lo tienen por `numero`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS historial (
      id         BIGSERIAL PRIMARY KEY,
      persona_id BIGINT NOT NULL REFERENCES personas(id),
      rol        TEXT NOT NULL,
      contenido  TEXT NOT NULL,
      creado     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Asesores que usan el panel (login individual). password_hash = bcrypt.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asesores (
      id            BIGSERIAL PRIMARY KEY,
      usuario       TEXT UNIQUE,
      password_hash TEXT,
      nombre        TEXT,
      whatsapp      TEXT,
      activo        BOOLEAN NOT NULL DEFAULT true,
      creado        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Quién atiende a cada cliente derivado (null = en espera, nadie lo tomó).
  await pool.query(`ALTER TABLE personas ADD COLUMN IF NOT EXISTS atendido_por TEXT;`);
  await pool.query(`ALTER TABLE personas ADD COLUMN IF NOT EXISTS atendido_desde TIMESTAMPTZ;`);

  // Autor visible del mensaje en el panel ('bot' | 'asesor' | null). No afecta al agente.
  await pool.query(`ALTER TABLE historial ADD COLUMN IF NOT EXISTS autor TEXT;`);

  // --- Limpieza de esquema: plegar `contactos` en `personas` y borrar `services` ---
  // personas gana ultimo_mensaje (la ventana de 24hs deja de vivir en una tabla aparte).
  await pool.query(`ALTER TABLE personas ADD COLUMN IF NOT EXISTS ultimo_mensaje BIGINT;`);

  // Backfill desde contactos y borrado, SOLO si contactos todavía existe (idempotente:
  // tras la 1ª corrida la tabla ya no está y el bloque es no-op).
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.contactos') IS NOT NULL THEN
        INSERT INTO personas (telefono, ultimo_mensaje)
        SELECT numero, ultimo_mensaje FROM contactos
        ON CONFLICT (telefono) DO UPDATE SET ultimo_mensaje = EXCLUDED.ultimo_mensaje;
        DROP TABLE contactos;
      END IF;
    END $$;
  `);

  // --- Re-clavar `historial` por persona_id (deja todo el modelo por persona_id) ---
  // Bases viejas tienen historial.numero (string de teléfono). Lo migramos a
  // persona_id (idempotente: tras la 1ª corrida la columna `numero` ya no está
  // y el bloque DO es no-op; en bases nuevas historial ya nace con persona_id).
  await pool.query(`ALTER TABLE historial ADD COLUMN IF NOT EXISTS persona_id BIGINT REFERENCES personas(id);`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'historial' AND column_name = 'numero'
      ) THEN
        -- Defensivo: crear persona para cualquier numero del historial sin persona
        -- (0 huérfanas hoy, pero así el backfill nunca deja filas sin persona_id).
        INSERT INTO personas (telefono)
        SELECT DISTINCT h.numero FROM historial h
        LEFT JOIN personas p ON p.telefono = h.numero
        WHERE p.id IS NULL
        ON CONFLICT (telefono) DO NOTHING;
        -- Backfill: cada fila toma el id de su persona.
        UPDATE historial h SET persona_id = p.id
        FROM personas p
        WHERE p.telefono = h.numero AND h.persona_id IS NULL;
        -- Ya no quedan filas sin persona_id -> obligatorio + borrar numero.
        ALTER TABLE historial ALTER COLUMN persona_id SET NOT NULL;
        DROP INDEX IF EXISTS idx_historial_numero_id;
        ALTER TABLE historial DROP COLUMN numero;
      END IF;
    END $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_historial_persona_id ON historial (persona_id, id);`);

  // Un resumen por conversación cerrada, asociado a la persona.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resumenes (
      id         BIGSERIAL PRIMARY KEY,
      persona_id BIGINT REFERENCES personas(id),
      resumen    TEXT NOT NULL,
      desde      TIMESTAMPTZ,
      hasta      TIMESTAMPTZ,
      creado     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // --- Plantillas + Envío masivo -------------------------------------------
  // Catálogo local de templates. Meta es la fuente de verdad del ESTADO;
  // acá guardamos el mapeo variable→campo del cliente que Meta no guarda.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plantillas (
      id        BIGSERIAL PRIMARY KEY,
      nombre    TEXT UNIQUE NOT NULL,
      idioma    TEXT NOT NULL DEFAULT 'es_AR',
      categoria TEXT NOT NULL DEFAULT 'MARKETING',
      cuerpo    TEXT NOT NULL,
      variables JSONB NOT NULL DEFAULT '[]',
      estado    TEXT NOT NULL DEFAULT 'PENDING',
      meta_id   TEXT,
      creado    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Header opcional de imagen (la foto que se ve arriba del mensaje en WhatsApp).
  // header_tipo: 'TEXT' (sin imagen) | 'IMAGE'. Guardamos los bytes para poder
  // re-subirla a Meta en cada envío (Railway no persiste el filesystem).
  await pool.query(`ALTER TABLE plantillas ADD COLUMN IF NOT EXISTS header_tipo TEXT NOT NULL DEFAULT 'TEXT';`);
  await pool.query(`ALTER TABLE plantillas ADD COLUMN IF NOT EXISTS header_mime TEXT;`);
  await pool.query(`ALTER TABLE plantillas ADD COLUMN IF NOT EXISTS header_img  BYTEA;`);
  // Botones de respuesta rápida (array de textos, orden de mejor a peor) y
  // marca de encuesta: la plantilla es_encuesta más reciente es "la encuesta
  // activa" (sus botones definen qué respuestas esperamos en el webhook).
  await pool.query(`ALTER TABLE plantillas ADD COLUMN IF NOT EXISTS botones JSONB NOT NULL DEFAULT '[]';`);
  await pool.query(`ALTER TABLE plantillas ADD COLUMN IF NOT EXISTS es_encuesta BOOLEAN NOT NULL DEFAULT false;`);
  // Backfill: si la encuesta por defecto se creó ANTES de estas columnas,
  // marcarla como encuesta con sus botones (idempotente: solo si está "vacía").
  await pool.query(`
    UPDATE plantillas
       SET es_encuesta = true, botones = '["Excelente","Buena","Mala"]'::jsonb
     WHERE nombre = 'encuesta_service' AND es_encuesta = false AND botones = '[]'::jsonb;
  `);

  // Cada corrida de envío masivo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campanias (
      id          BIGSERIAL PRIMARY KEY,
      plantilla_id BIGINT REFERENCES plantillas(id),
      filtro      JSONB NOT NULL DEFAULT '{}',
      total       INTEGER NOT NULL DEFAULT 0,
      enviados    INTEGER NOT NULL DEFAULT 0,
      errores     INTEGER NOT NULL DEFAULT 0,
      estado      TEXT NOT NULL DEFAULT 'en_curso',
      creada_por  TEXT,
      creada      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Detalle por destinatario (trazabilidad + anti-duplicado).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS envios (
      id          BIGSERIAL PRIMARY KEY,
      campania_id BIGINT NOT NULL REFERENCES campanias(id),
      persona_id  BIGINT REFERENCES personas(id),
      numero      TEXT,
      estado      TEXT NOT NULL,
      detalle     TEXT,
      wamid       TEXT,
      creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campania_id, persona_id)
    );
  `);

  // --- Consumo del agente (tokens de la API de Anthropic) -------------------
  // Una fila por respuesta del bot (todas las vueltas de tools de ese mensaje
  // sumadas). costo_usd se calcula al momento de guardar con el precio vigente,
  // así los históricos no cambian si mañana cambia la tarifa.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uso_agente (
      id         BIGSERIAL PRIMARY KEY,
      persona_id BIGINT REFERENCES personas(id),
      modelo     TEXT NOT NULL,
      entrada    INTEGER NOT NULL,
      salida     INTEGER NOT NULL,
      llamadas   SMALLINT NOT NULL,
      costo_usd  NUMERIC(12,6) NOT NULL,
      creado     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_uso_agente_creado ON uso_agente (creado);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_uso_agente_persona ON uso_agente (persona_id);`);

  // Configuración editable desde el panel (clave/valor). Hoy: 'modelo_agente'
  // (el modelo de Claude que usa el bot, seleccionable en la solapa Costos).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      clave       TEXT PRIMARY KEY,
      valor       TEXT NOT NULL,
      actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Ciclo de vida de cada derivación a asesor (para la solapa Métricas).
  // Un caso nace cuando el bot deriva (origen 'bot') o un asesor interviene
  // (origen 'asesor', nace ya tomado). Se cierra cuando el asesor reactiva el
  // bot (resuelto_*) o cuando vence el timeout sin atención (expirado=true).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS casos (
      id           BIGSERIAL PRIMARY KEY,
      telefono     TEXT NOT NULL,
      motivo       TEXT,
      origen       TEXT NOT NULL DEFAULT 'bot',
      derivado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
      tomado_en    TIMESTAMPTZ,
      tomado_por   TEXT,
      resuelto_en  TIMESTAMPTZ,
      resuelto_por TEXT,
      expirado     BOOLEAN NOT NULL DEFAULT false
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_casos_telefono_abierto ON casos (telefono) WHERE resuelto_en IS NULL AND expirado = false;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_casos_derivado_en ON casos (derivado_en);`);

  // Respuestas de ENCUESTAS de satisfacción (botones del template encuesta_service).
  // wamid_contexto = id del mensaje de encuesta original que respondió el cliente;
  // el UNIQUE hace que si toca dos veces un botón del MISMO mensaje, gane la última.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS encuestas (
      id             BIGSERIAL PRIMARY KEY,
      persona_id     BIGINT REFERENCES personas(id),
      telefono       TEXT NOT NULL,
      respuesta      TEXT NOT NULL,
      wamid_contexto TEXT,
      creado         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (telefono, wamid_contexto)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_encuestas_creado ON encuestas (creado);`);

  // Tablas del VERTICAL del negocio (definidas por cliente, ver cliente/schema.js).
  await require('./cliente/schema').init(pool);

  console.log('🗄️  Base de datos lista (CRM, historial, plantillas, casos, encuestas + vertical).');
}

module.exports = { pool, init };
