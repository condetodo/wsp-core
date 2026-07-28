# Vertical inmobiliario + calificación de leads — Plan de implementación

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Que el agente pueda buscar propiedades reales por criterios (operación, tipo, zona, ambientes, precio) y que califique en vivo a los leads, avisando por WhatsApp a los vendedores cuando alguien cruza un umbral.

**Architecture:** El inventario es del VERTICAL: dos tablas nuevas en `cliente/schema.js` (`desarrollos` y `propiedades`, con `desarrollo_id` nullable) y un módulo `cliente/propiedades.js` cuyo armado de filtro es una función pura testeable. La calificación es CORE: tabla `calificaciones` en `db.js` y módulo `leads.js` con la lógica de umbral y anti-repetición también pura. Las dos tools nuevas se enchufan en `herramientas.js`, y el aviso reusa `enviarTemplate` igual que `derivacion.js`.

**Tech Stack:** Node + Express + Postgres (`pg`), `node --test` para los tests, `xlsx` para el importador (ya es dependencia), WhatsApp Cloud API para el aviso.

**Diseño aprobado:** `docs/plans/2026-07-28-vertical-inmobiliario-design.md`

---

## Orden de las tareas

Tarea 1 el canal de aviso (independiente del resto), después el inventario
completo (2 a 7) y al final la calificación (8 a 12).

**Confirmado el 28/07/2026:** la inmobiliaria no tiene CRM y esta plataforma pasa
a serlo, así que el panel es la fuente de verdad del inventario. Las tareas 6 y 7
van tal cual están escritas.

---

### Tarea 1: Canal de aviso por mail (Resend)

El aviso sale por mail, no por plantilla de WhatsApp. Va aislado en su propio
módulo para que sumar WhatsApp después no toque la lógica de calificación.

**Files:**
- Create: `avisos.js`
- Test: `tests/avisos.test.js`
- Modify: `db.js` (columna `email` en `asesores`)
- Modify: `package.json`, `.env.example`

**Step 1: Dependencia y variable**

```bash
npm install resend
```

En `.env.example`, documentá las dos variables nuevas:

```
# Aviso de leads calificados por mail (https://resend.com)
RESEND_API_KEY=
# Remitente. El dominio tiene que estar verificado en Resend.
AVISOS_FROM=
```

**Step 2: Columna `email` en asesores**

`asesores` hoy guarda `whatsapp` pero no mail. En `db.js`, junto a los otros
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:

```js
  await pool.query(`ALTER TABLE asesores ADD COLUMN IF NOT EXISTS email TEXT;`);
```

**Step 3: Test del render, primero**

El armado del mail es puro y se testea; el envío no.

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderAvisoLead } = require('../avisos');

test('el asunto lleva nombre y puntaje, para que se lea sin abrir el mail', () => {
  const { asunto } = renderAvisoLead({ nombre: 'Carlos Rivarola', puntaje: 5, motivo: 'quiere visitar el sábado' });
  assert.match(asunto, /Carlos Rivarola/);
  assert.match(asunto, /5/);
});

test('el cuerpo incluye motivo e interés', () => {
  const { html } = renderAvisoLead({
    nombre: 'Ana', puntaje: 4, motivo: 'dejó su mail', interes: '2 ambientes en Pilar',
  });
  assert.match(html, /dejó su mail/);
  assert.match(html, /2 ambientes en Pilar/);
});

test('tolera lead sin nombre y sin interés', () => {
  const { asunto, html } = renderAvisoLead({ puntaje: 4, motivo: 'preguntó por tres propiedades' });
  assert.match(asunto, /sin nombre/i);
  assert.ok(html.length > 0);
});
```

**Step 4: Correr y verificar que falla**

```bash
node --test tests/avisos.test.js
```

Esperado: FAIL, "Cannot find module '../avisos'".

**Step 5: Implementar**

`renderAvisoLead(datos)` puro, devolviendo `{ asunto, html }`, y
`avisarLeadPorMail(destinos, datos)` que usa Resend. Si falta `RESEND_API_KEY`,
loguear una advertencia y devolver `{ avisados: 0 }` **sin tirar error**: el
aviso es una comodidad, nunca puede romper la conversación con el cliente. Mismo
criterio que `mejorEsfuerzo` en `casos.js`.

**Step 6: Tests en verde**

```bash
node --test tests/avisos.test.js
```

**Step 7: Commit**

```bash
git add avisos.js tests/avisos.test.js db.js package.json package-lock.json .env.example
git commit -m "feat: canal de aviso de leads por mail con Resend"
```

> **Ojo con Resend:** para mandar desde un dominio propio hay que verificarlo en
> el panel de Resend (registros DNS). Sin eso sólo se puede enviar desde
> `onboarding@resend.dev` y únicamente a la casilla dueña de la cuenta, lo que
> sirve para probar pero no para producción.

---

### Tarea 2: Tablas `desarrollos` y `propiedades`

**Files:**
- Modify: `cliente/schema.js`

**Step 1: Agregar las tablas dentro de `init(pool)`**

```js
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
```

`desarrollo_id` nullable es lo que permite que una casa suelta y una unidad de un
proyecto convivan en la misma tabla, que es lo que hace que el filtro las
encuentre a las dos.

**Step 2: Verificar contra la base**

```bash
node -e "require('./db').init().then(()=>process.exit(0))"
```

Esperado: imprime el log de "Base de datos lista" sin error. Usá
`DATABASE_PUBLIC_URL` para correr contra Railway desde local.

**Step 3: Commit**

```bash
git add cliente/schema.js
git commit -m "feat: tablas desarrollos y propiedades del vertical inmobiliario"
```

---

### Tarea 3: `construirFiltro`, la función pura de búsqueda

El corazón de la búsqueda. Es donde se esconden los errores caros, así que va con
test primero.

**Files:**
- Create: `cliente/propiedades.js`
- Test: `tests/propiedades.test.js`

**Step 1: Escribir el test que falla**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { construirFiltro } = require('../cliente/propiedades');

test('sin criterios, sólo filtra por disponible', () => {
  const { where, params } = construirFiltro({});
  assert.match(where, /estado = 'disponible'/);
  assert.deepStrictEqual(params, []);
});

test('cada criterio agrega su condición con parámetro numerado', () => {
  const { where, params } = construirFiltro({ operacion: 'alquiler', zona: 'Pilar' });
  assert.match(where, /operacion = \$1/);
  assert.match(where, /zona ILIKE \$2/);
  assert.deepStrictEqual(params, ['alquiler', '%Pilar%']);
});

test('ambientes matchea exacto, no mínimo', () => {
  // Quien pide "2 ambientes" no quiere que le ofrezcan un 5 ambientes.
  const { where, params } = construirFiltro({ ambientes: 2 });
  assert.match(where, /ambientes = \$1/);
  assert.deepStrictEqual(params, [2]);
});

test('precio_max con moneda filtra por ambos', () => {
  const { where, params } = construirFiltro({ precio_max: 300000, moneda: 'USD' });
  assert.match(where, /precio <= \$1/);
  assert.match(where, /moneda = \$2/);
  assert.deepStrictEqual(params, [300000, 'USD']);
});

test('precio_max SIN moneda se ignora y avisa', () => {
  // Nunca convertimos monedas: sin cotización, comparar mentiría.
  const { where, params, aviso } = construirFiltro({ precio_max: 300000 });
  assert.doesNotMatch(where, /precio/);
  assert.deepStrictEqual(params, []);
  assert.strictEqual(aviso, 'precio_sin_moneda');
});
```

**Step 2: Correrlo y verificar que falla**

```bash
node --test tests/propiedades.test.js
```

Esperado: FAIL, "Cannot find module '../cliente/propiedades'".

**Step 3: Implementación mínima**

```js
// Arma el WHERE de la búsqueda de propiedades a partir de los criterios que
// mandó el agente. PURA: no toca la base. Devuelve { where, params, aviso }.
function construirFiltro(criterios = {}) {
  const cond = ["estado = 'disponible'"];
  const params = [];
  let aviso = null;

  const agregar = (sql, valor) => {
    params.push(valor);
    cond.push(sql.replace('$?', '$' + params.length));
  };

  if (criterios.operacion) agregar('operacion = $?', criterios.operacion);
  if (criterios.tipo) agregar('tipo = $?', criterios.tipo);
  if (criterios.zona) agregar('zona ILIKE $?', `%${criterios.zona}%`);
  if (Number.isFinite(criterios.ambientes)) agregar('ambientes = $?', criterios.ambientes);

  // El precio SOLO se compara dentro de la misma moneda. Las ventas se cotizan
  // en dólares y los alquileres en pesos; sin cotización en la base, convertir
  // mentiría. Si falta la moneda, ignoramos el tope y que el agente pregunte.
  if (Number.isFinite(criterios.precio_max)) {
    if (criterios.moneda) {
      agregar('precio <= $?', criterios.precio_max);
      agregar('moneda = $?', criterios.moneda);
    } else {
      aviso = 'precio_sin_moneda';
    }
  }

  return { where: cond.join(' AND '), params, aviso };
}

module.exports = { construirFiltro };
```

**Step 4: Correr los tests**

```bash
node --test tests/propiedades.test.js
```

Esperado: PASS, 5 tests.

**Step 5: Commit**

```bash
git add cliente/propiedades.js tests/propiedades.test.js
git commit -m "feat: filtro de busqueda de propiedades con test"
```

---

### Tarea 4: `buscar` contra la base

**Files:**
- Modify: `cliente/propiedades.js`

**Step 1: Agregar la consulta**

```js
const TOPE = 5; // cada resultado son tokens en TODAS las vueltas siguientes

// Busca propiedades disponibles. Devuelve como máximo TOPE resultados más el
// total, para que el agente pueda decir "hay 23, acotemos".
async function buscar(pool, criterios = {}) {
  const { where, params, aviso } = construirFiltro(criterios);
  if (aviso === 'precio_sin_moneda') {
    return { aviso: 'Falta saber si el presupuesto está en pesos o en dólares. Preguntáselo al cliente.' };
  }

  const total = await pool.query(`SELECT COUNT(*)::int AS n FROM propiedades WHERE ${where}`, params);
  const { rows } = await pool.query(
    `SELECT p.id, p.operacion, p.tipo, p.zona, p.direccion, p.ambientes,
            p.dormitorios, p.superficie_m2, p.precio, p.moneda, p.expensas,
            p.descripcion, p.link, d.nombre AS desarrollo, d.estado_obra, d.entrega
       FROM propiedades p
       LEFT JOIN desarrollos d ON d.id = p.desarrollo_id
      WHERE ${where}
      ORDER BY p.precio ASC NULLS LAST
      LIMIT ${TOPE}`,
    params
  );

  return { total: total.rows[0].n, mostradas: rows.length, propiedades: rows };
}

module.exports = { construirFiltro, buscar, TOPE };
```

El `LEFT JOIN` es lo que hace que una unidad de un desarrollo llegue con el nombre
del proyecto y su fecha de entrega, sin que el agente tenga que pedirlo aparte.

**Step 2: Probar a mano contra Railway**

Cargá dos propiedades de prueba con `psql` y corré:

```bash
node -e "const{pool}=require('./db');require('./cliente/propiedades').buscar(pool,{operacion:'alquiler'}).then(r=>{console.log(JSON.stringify(r,null,2));process.exit(0)})"
```

Esperado: JSON con `total`, `mostradas` y el array.

**Step 3: Commit**

```bash
git add cliente/propiedades.js
git commit -m "feat: consulta de propiedades con tope de resultados"
```

---

### Tarea 5: Tool `buscar_propiedades`

**Files:**
- Modify: `herramientas.js`

**Step 1: Agregar la definición al array `DEFINICIONES`**

```js
  {
    name: 'buscar_propiedades',
    description:
      'Busca propiedades disponibles en el inventario real de la inmobiliaria. ' +
      'Usala SIEMPRE que el cliente pregunte por algo para alquilar o comprar, en vez de inventar. ' +
      'Si el cliente da un presupuesto, preguntale si es en pesos o en dólares antes de usar precio_max: ' +
      'sin la moneda el tope se ignora.',
    input_schema: {
      type: 'object',
      properties: {
        operacion: { type: 'string', enum: ['venta', 'alquiler'], description: 'Qué busca el cliente.' },
        tipo: { type: 'string', description: 'casa, departamento, PH, lote, local u oficina.' },
        zona: { type: 'string', description: 'Barrio o localidad.' },
        ambientes: { type: 'integer', description: 'Cantidad exacta de ambientes.' },
        precio_max: { type: 'number', description: 'Tope de presupuesto. Requiere moneda.' },
        moneda: { type: 'string', enum: ['USD', 'ARS'], description: 'Moneda del presupuesto.' }
      },
      required: []
    }
  },
```

**Step 2: Agregar la rama en `ejecutar()`**

```js
  if (nombre === 'buscar_propiedades') {
    return await propiedades.buscar(pool, input);
  }
```

Y arriba, junto a los otros require:

```js
const propiedades = require('./cliente/propiedades');
```

**Step 3: Probar con el simulador**

```bash
node simular-conversacion.js
```

Con un guion que pida "busco 2 ambientes en Pilar para alquilar". Esperado: el
agente llama a `buscar_propiedades` y ofrece resultados reales.

**Step 4: Commit**

```bash
git add herramientas.js
git commit -m "feat: tool buscar_propiedades"
```

---

### Tarea 6: ABM de propiedades en el panel

**Files:**
- Create: `panel-propiedades.html`
- Modify: `panel.js`

**Step 1: Rutas y API en `panel.js`**

Ruta de la página, junto a las otras siete:

```js
router.get('/propiedades', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel-propiedades.html'));
});
```

API bajo el guard de sesión, siguiendo el estilo de las demás (try/catch con
`console.error` y 500):

- `GET /api/propiedades` — lista todo con el desarrollo resuelto
- `POST /api/propiedades` — alta (valida `operacion` y `tipo` contra listas cerradas)
- `PUT /api/propiedades/:id` — edición
- `POST /api/propiedades/:id/estado` — cambia `estado`
- `GET /api/desarrollos` y `POST /api/desarrollos` — ídem para proyectos

**Dar de baja no borra:** el estado pasa a `vendida`/`alquilada`. El filtro las
excluye solo (`estado = 'disponible'`) y no se pierde el historial.

**Step 2: La página**

Copiá `panel-plantillas.html` como base: ya trae el rail lateral, el bloque de
usuario, los estilos y el fetch a `/api/yo`. Reemplazá el contenido por una tabla
de propiedades con filtros arriba y un formulario de alta/edición.

Agregá la solapa "Propiedades" al rail de **los ocho** `panel-*.html`, si no
queda una sección a la que no se llega desde ninguna otra.

**Step 3: Verificar en el navegador**

Levantá el panel y dá de alta una propiedad, editala y cambiale el estado.
Esperado: los tres pasos se ven reflejados al recargar.

**Step 4: Commit**

```bash
git add panel-propiedades.html panel.js panel*.html
git commit -m "feat: ABM de propiedades en el panel"
```

---

### Tarea 7: Importador de propiedades desde Excel

**Files:**
- Create: `importar-propiedades.js`
- Test: `tests/importar-propiedades.test.js`

**Step 1: Test primero**

Mismo estilo que `tests/importar-clientes.test.js`. Casos que importan:

```js
test('parsearFila mapea las columnas del Excel a la propiedad', () => {
  const r = parsearFila({
    'Operacion': 'Alquiler', 'Tipo': 'Departamento', 'Zona': 'Pilar',
    'Ambientes': '2', 'Precio': '450000', 'Moneda': 'ARS',
  });
  assert.strictEqual(r.operacion, 'alquiler');   // normalizado a minúscula
  assert.strictEqual(r.ambientes, 2);            // numérico, no string
  assert.strictEqual(r.precio, 450000);
});

test('parsearFila descarta filas sin operacion o sin tipo', () => {
  assert.strictEqual(parsearFila({ 'Zona': 'Pilar' }), null);
});

test('parsearFila tolera precio con puntos y símbolo', () => {
  const r = parsearFila({ 'Operacion': 'Venta', 'Tipo': 'Casa', 'Precio': 'U$S 145.000' });
  assert.strictEqual(r.precio, 145000);
});
```

Ese último caso no es capricho: los Excel reales traen los precios escritos a
mano, con símbolo y separador de miles. Si no se limpian, `precio` queda null y
la propiedad nunca aparece en una búsqueda por presupuesto.

**Step 2: Correr y verificar que falla**

```bash
node --test tests/importar-propiedades.test.js
```

**Step 3: Implementar**

Reusá `limpiar` de `importar-clientes.js`. Agregá `aNumero(v)` que saque todo lo
que no sea dígito antes de parsear. La fila sin `operacion` o sin `tipo` devuelve
`null` y el importador la cuenta como saltada.

CLI igual que el otro: `node importar-propiedades.js "archivo.xlsx"`.

**Step 4: Tests en verde**

```bash
node --test tests/importar-propiedades.test.js
```

**Step 5: Commit**

```bash
git add importar-propiedades.js tests/importar-propiedades.test.js
git commit -m "feat: importador de propiedades desde Excel"
```

---

### Tarea 8: Tabla `calificaciones`

**Files:**
- Modify: `db.js`

**Step 1: Agregar la tabla en `init()`, antes del require del vertical**

```js
  // Calificación de leads: una fila por vez que el agente puntúa al cliente.
  // Historial, no un valor único: importa ver que el lead pasó de 2 a 5.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calificaciones (
      id         BIGSERIAL PRIMARY KEY,
      persona_id BIGINT NOT NULL REFERENCES personas(id),
      puntaje    SMALLINT NOT NULL,
      motivo     TEXT,
      interes    TEXT,
      avisado    BOOLEAN NOT NULL DEFAULT false,
      creado     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_calificaciones_persona
    ON calificaciones (persona_id, creado DESC);`);
```

**Step 2: Verificar**

```bash
node -e "require('./db').init().then(()=>process.exit(0))"
```

**Step 3: Commit**

```bash
git add db.js
git commit -m "feat: tabla calificaciones para el scoring de leads"
```

---

### Tarea 9: `debeAvisar`, la lógica de umbral y anti-repetición

La parte más fácil de romper: sin esto, cada mensaje del lead caliente dispara
otra alerta y los vendedores silencian el aviso en una semana.

**Files:**
- Create: `leads.js`
- Test: `tests/leads.test.js`

**Step 1: Test primero**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { debeAvisar } = require('../leads');

const AHORA = new Date('2026-07-28T15:00:00Z');

test('no avisa por debajo del umbral', () => {
  assert.strictEqual(debeAvisar({ puntaje: 2, umbral: 4, ultimo: null, ahora: AHORA }), false);
});

test('avisa la primera vez que cruza el umbral', () => {
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo: null, ahora: AHORA }), true);
});

test('NO repite el aviso si sigue hablando con el mismo puntaje', () => {
  const ultimo = { puntaje: 4, creado: new Date('2026-07-28T14:00:00Z') };
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo, ahora: AHORA }), false);
});

test('avisa de nuevo si el puntaje SUBE', () => {
  const ultimo = { puntaje: 4, creado: new Date('2026-07-28T14:00:00Z') };
  assert.strictEqual(debeAvisar({ puntaje: 5, umbral: 4, ultimo, ahora: AHORA }), true);
});

test('vuelve a avisar pasadas 24 hs', () => {
  const ultimo = { puntaje: 4, creado: new Date('2026-07-27T10:00:00Z') };
  assert.strictEqual(debeAvisar({ puntaje: 4, umbral: 4, ultimo, ahora: AHORA }), true);
});
```

**Step 2: Correr y verificar que falla**

```bash
node --test tests/leads.test.js
```

Esperado: FAIL, "Cannot find module '../leads'".

**Step 3: Implementar**

```js
const HORAS_SILENCIO = 24;

// ¿Corresponde avisarle a los vendedores? PURA.
// Avisa si cruza el umbral Y (nunca se avisó | subió de puntaje | pasaron 24 hs).
// Sin esto, cada mensaje del lead caliente dispararía otra alerta.
function debeAvisar({ puntaje, umbral, ultimo, ahora = new Date() }) {
  if (!Number.isFinite(puntaje) || puntaje < umbral) return false;
  if (!ultimo) return true;
  if (puntaje > ultimo.puntaje) return true;
  const limite = new Date(ultimo.creado).getTime() + HORAS_SILENCIO * 3600 * 1000;
  return ahora.getTime() >= limite;
}

module.exports = { debeAvisar, HORAS_SILENCIO };
```

**Step 4: Tests en verde**

```bash
node --test tests/leads.test.js
```

Esperado: PASS, 5 tests.

**Step 5: Commit**

```bash
git add leads.js tests/leads.test.js
git commit -m "feat: umbral y anti-repeticion del aviso de leads"
```

---

### Tarea 10: Registrar la calificación y avisar

**Files:**
- Modify: `leads.js`

**Step 1: Agregar el resto del módulo**

```js
const { pool } = require('./db');
const { leerConfig } = require('./config');
const { listarConWhatsapp } = require('./asesores');
const { enviarTemplate } = require('./enviar-template');
const { buscarOcrearPersona } = require('./clientes');

const UMBRAL_DEFAULT = 4;

async function umbralActivo() {
  try {
    const v = Number(await leerConfig('umbral_lead'));
    return Number.isFinite(v) && v >= 1 && v <= 5 ? v : UMBRAL_DEFAULT;
  } catch (err) {
    console.error('⚠️  No se pudo leer umbral_lead:', err.message);
    return UMBRAL_DEFAULT;
  }
}

// Guarda la calificación y, si corresponde, avisa a los vendedores.
async function calificar(numero, { puntaje, motivo, interes }) {
  const { persona } = await buscarOcrearPersona(numero);
  const { rows } = await pool.query(
    `SELECT puntaje, creado FROM calificaciones
      WHERE persona_id = $1 AND avisado = true
      ORDER BY creado DESC LIMIT 1`,
    [persona.id]
  );
  const ultimo = rows[0] || null;
  const umbral = await umbralActivo();
  const avisar = debeAvisar({ puntaje, umbral, ultimo });

  await pool.query(
    `INSERT INTO calificaciones (persona_id, puntaje, motivo, interes, avisado)
     VALUES ($1, $2, $3, $4, $5)`,
    [persona.id, puntaje, motivo || null, interes || null, avisar]
  );

  if (!avisar) return { ok: true, avisados: 0 };

  const nombre = [persona.nombre, persona.apellido].filter(Boolean).join(' ') || null;
  const destinos = await listarConEmail();   // asesores activos con mail cargado
  const r = await avisarLeadPorMail(destinos, { nombre, puntaje, motivo, interes });
  return { ok: true, avisados: r.avisados };
}
```

Los require de arriba usan el canal de mail, no el de WhatsApp:

```js
const { avisarLeadPorMail } = require('./avisos');
const { listarConEmail } = require('./asesores');
```

`listarConEmail` hay que agregarla a `asesores.js`, espejo de `listarConWhatsapp`:
activos y con `email` no nulo.

**Importante: el aviso NO silencia al bot.** No se llama a `marcarEnAsesor`. El
cliente nunca pidió un humano; si lo callamos, se queda esperando. Los vendedores
intervienen desde el panel con `clientes.intervenir`, que ya existe.

**Step 2: Commit**

```bash
git add leads.js
git commit -m "feat: registro de calificacion y aviso a vendedores"
```

---

### Tarea 11: Tool `calificar_lead` y criterios en el prompt

**Files:**
- Modify: `herramientas.js`
- Modify: `cliente/personalidad.js`

**Step 1: Definición de la tool**

```js
  {
    name: 'calificar_lead',
    description:
      'Calificá al cliente según cuán cerca está de comprar o alquilar. Llamala cuando ' +
      'detectes una señal nueva, no en cada mensaje. Criterios: ' +
      '1 = curiosea sin definir nada; 2 = pregunta por una propiedad puntual; ' +
      '3 = da criterios concretos (zona, presupuesto, plazo); ' +
      '4 = pide ver una propiedad, deja datos de contacto o habla de forma de pago; ' +
      '5 = pide hablar con un vendedor o dice que quiere avanzar ya.',
    input_schema: {
      type: 'object',
      properties: {
        puntaje: { type: 'integer', description: 'Del 1 al 5 según los criterios.' },
        motivo: { type: 'string', description: 'Qué señal viste, en una frase.' },
        interes: { type: 'string', description: 'Qué busca: operación, zona, tipo, presupuesto.' }
      },
      required: ['puntaje', 'motivo']
    }
  },
```

**Step 2: Rama en `ejecutar()`**

```js
  if (nombre === 'calificar_lead') {
    return await leads.calificar(contexto.numero, input);
  }
```

**Step 3: Reforzar en el prompt**

En `cliente/personalidad.js`, agregá que califique apenas detecte una señal y que
no anuncie que lo está haciendo. Los criterios ya están en la descripción de la
tool; el prompt sólo empuja el hábito.

**Step 4: Probar con el simulador**

```bash
node simular-conversacion.js
```

Guion: preguntar por dos propiedades y terminar con "me interesa, ¿cuándo la puedo
ver?". Esperado: el agente llama a `calificar_lead` con puntaje 4 o 5 y sale el
aviso.

**Step 5: Commit**

```bash
git add herramientas.js cliente/personalidad.js
git commit -m "feat: tool calificar_lead con criterios explicitos"
```

---

### Tarea 12: Umbral configurable y leads calientes en el panel

**Files:**
- Modify: `panel.js`
- Modify: `panel.html`

**Step 1: API del umbral**

`GET /api/umbral-lead` y `POST /api/umbral-lead`, sobre la tabla `config` con
`guardarConfig('umbral_lead', valor)`. Validá 1 a 5 antes de guardar. Mismo patrón
que `/api/modelo`.

**Step 2: Mostrar el puntaje en la lista**

En `GET /api/clientes`, sumale a cada fila su última calificación, y en
`panel.html` mostrá el puntaje al lado del nombre. Ordená los leads calientes
primero: es el punto de todo esto, que el vendedor sepa a quién llamar.

**Step 3: Verificar en el navegador**

Esperado: el cliente calificado aparece arriba con su puntaje, y cambiar el umbral
se refleja al recargar.

**Step 4: Commit**

```bash
git add panel.js panel.html
git commit -m "feat: umbral configurable y leads calificados en el panel"
```

---

## Verificación final

```bash
node --test
```

Esperado: la suite completa en verde, incluidos los 12 archivos que ya existían.

Después, prueba de punta a punta por WhatsApp real: escribir al número de prueba
pidiendo una propiedad, verificar que el agente la ofrece desde el inventario y
que al mostrar interés llega el aviso a los vendedores.

## Estado al 28/07/2026: las 12 tareas hechas y desplegadas

Suite en 127 tests, 0 fallas. Todo pusheado a `main` y desplegado (Railway
despliega solo con cada push).

Se verificó pieza por pieza y contra producción: las rutas nuevas responden y
están detrás del guard de sesión, y la app arranca —lo que prueba que las
tablas se crearon, porque `init()` corre antes de `app.listen`.

**No se verificó el circuito completo con una conversación real.** Nunca se vio
al agente buscando una propiedad y calificando a alguien de verdad: hace falta
inventario cargado y una charla por WhatsApp.

### Pendiente para la próxima sesión

**1. Configurar el canal de mail (sin esto no sale ningún aviso).**
   - Cargar `RESEND_API_KEY` y `AVISOS_FROM` en Railway.
   - **Verificar el dominio en Resend** (registros DNS). Sin eso sólo se puede
     enviar desde `onboarding@resend.dev` y sólo a la casilla dueña de la
     cuenta: sirve para probar, no para producción.
   - Cargar el `email` de cada vendedor en la tabla `asesores` (la columna ya
     existe; `listarConEmail` sólo toma los activos con mail).

   Ojo: sin esto el scoring corre igual y los leads se ven en el panel, pero
   nadie recibe nada.

**2. Probar el panel con sesión real.** Entrar a `/panel/propiedades`, dar de
   alta una propiedad, editarla y cambiarle el estado. Es lo único que no se
   pudo ejercitar sin credenciales.

**3. Prueba de punta a punta.** Con dos o tres propiedades cargadas, escribirle
   al número de prueba pidiendo algo que exista en el inventario, y verificar:
   que el agente use `buscar_propiedades` en vez de inventar, que pregunte la
   moneda si se le da un presupuesto sin aclararla, que llame a `calificar_lead`
   al mostrar interés, y que llegue el mail.

**4. Escribir el prompt real.** `cliente/personalidad.js` sigue siendo el demo
   genérico ("Demo, un negocio de ejemplo"): sólo se le sumaron las dos tools
   nuevas y la regla de calificar. Cuando esté la info de la inmobiliaria hay
   que reescribirlo entero.

**5. Sembrar `negocio_info`** con los datos reales (hoy tiene los del demo:
   Av. Siempreviva 742). Es lo que responde `consultar_info_negocio`.

## Backlog

- **Aviso por plantilla de WhatsApp (`aviso_lead`)** como canal alternativo al
  mail, para que la alerta llegue al teléfono fuera del horario de oficina. El
  módulo `avisos.js` está aislado justamente para poder sumarlo sin tocar la
  lógica de calificación. Requiere aprobación de Meta, que tarda: mandarla con
  tiempo, con `crear-template-encuesta.js` como molde.
