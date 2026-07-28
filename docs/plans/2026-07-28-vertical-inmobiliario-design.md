# Vertical inmobiliario + calificación de leads

Fecha: 2026-07-28
Estado: diseño aprobado, pendiente de plan de implementación

## Problema

El cliente es una inmobiliaria. El agente tiene que poder responder consultas
sobre los desarrollos que la inmobiliaria está construyendo, sobre las
propiedades que tiene en alquiler y sobre las que tiene en venta. Para eso hace
falta un lugar donde cargar ese inventario y una forma de que el agente lo
consulte.

Además, la mayoría de los números que escriben no están en la base. El agente
tiene que registrarlos y, sobre todo, distinguir al curioso del comprador, para
que los vendedores humanos sepan a quién llamar.

## Punto de partida

Buena parte del pedido ya existe en el core y no hay que construirlo:

- **Registro automático de leads.** `clientes.buscarOcrearPersona` crea una
  persona para todo número que escribe. La tool `guardar_datos_cliente` guarda
  nombre, apellido y correo, y `render360` ya instruye al agente a averiguar el
  nombre con naturalidad. Cada conversación cerrada deja un resumen.
- **Aviso a humanos.** `derivar_a_asesor` marca al cliente, silencia al bot,
  abre un caso y notifica a los asesores con la plantilla `aviso_asesor`.
  Cubre el caso del cliente que pide hablar con una persona.

Lo que no existe: el inventario de propiedades (`cliente/schema.js` sólo tiene
`negocio_info`) y cualquier forma de calificación graduada de leads.

## Decisiones

1. **El agente filtra, no sólo describe.** La consulta típica por WhatsApp es
   "2 ambientes en Pilar hasta 300 mil", así que el inventario necesita
   columnas estructuradas, no una ficha de texto.
2. **Desarrollos y unidades son entidades separadas.** Un desarrollo tiene
   muchas unidades con distinta tipología y precio. Si se aplasta todo en una
   tabla, el filtro por ambientes y precio nunca encuentra al desarrollo.
3. **La calificación la hace el agente en vivo**, no reglas por conteo. Alguien
   que escribe "tengo la plata lista, ¿cuándo la veo?" es un lead ardiendo en un
   solo mensaje y por conteo de preguntas puntuaría bajo.
4. **La alerta no silencia al bot.** El cliente nunca pidió un humano; callar al
   bot lo deja esperando. Los vendedores intervienen desde el panel cuando
   quieren, con `clientes.intervenir`, que ya existe.
5. **El aviso sale por mail, con Resend.** Decisión de Francisco (28/07/2026):
   más barato que la plantilla de WhatsApp y sin depender de la aprobación de
   Meta, que tarda. Implica sumar la dependencia `resend`, la variable
   `RESEND_API_KEY`, un dominio verificado y una columna `email` en `asesores`
   (hoy sólo tiene `whatsapp`). El aviso por plantilla de WhatsApp
   (`aviso_lead`) queda en el backlog como canal alternativo: es el que llega al
   teléfono un sábado a la noche, cuando nadie mira el correo.
6. **La calificación es core, no vertical.** Sirve para cualquier rubro.

## Modelo de datos

### Vertical (`cliente/schema.js`)

**`desarrollos`** — el proyecto: nombre, zona, dirección, estado de obra
(pozo / en construcción / terminado), fecha de entrega, financiación,
descripción, activo.

**`propiedades`** — la unidad. `desarrollo_id` nullable: si es null es una
propiedad suelta, si apunta a un desarrollo es una unidad de ese proyecto.

Campos filtrables: `operacion` (venta/alquiler), `tipo`
(casa/departamento/PH/lote/local), `zona`, `ambientes`, `dormitorios`,
`superficie_m2`, `precio`, `moneda`, `expensas`, `estado`
(disponible/reservada/vendida/alquilada). Más `descripcion` y `link` para lo que
el agente redacta.

El filtro corre **siempre sobre `propiedades`**, de modo que una búsqueda por
ambientes y precio encuentra por igual la casa suelta y el 2 ambientes del pozo.

**Moneda: nunca convertir.** Las ventas se cotizan en dólares y los alquileres
en pesos, y "hasta 300 mil" es ambiguo. Sin cotización en la base cualquier
conversión miente, así que el agente pregunta la moneda cuando no está clara.

### Core (`db.js`)

**`calificaciones`** — persona_id, puntaje, motivo, creado. Guarda historial, no
un valor único: importa ver que el lead pasó de 2 a 5.

## Componentes

### Panel

Solapa nueva **Propiedades** (`panel-propiedades.html`, la octava) con ABM:
listar, alta, edición y cambio de estado. Dar de baja no borra: pasa a
`vendida`/`alquilada`, así no se pierde el historial y el filtro las excluye.

**Importador de Excel**, siguiendo el patrón de `importar-clientes.js`. `xlsx`
ya es dependencia del proyecto. Es lo que evita que un vendedor cargue 80
propiedades a mano.

### Agente

**`buscar_propiedades`** (tool del vertical, en `herramientas.js`): recibe
`operacion`, `tipo`, `zona`, `ambientes`, `precio_max`, `moneda`. Devuelve como
máximo 5 unidades disponibles; si hay más, informa cuántas y pide acotar. El
tope importa porque cada resultado son tokens en todas las vueltas siguientes de
la conversación.

**`calificar_lead`** (tool core): puntaje 1-5, motivo e interés. Los criterios de
cada nivel van explícitos en el prompt; sin eso el modelo puntúa distinto cada
vez.

`cliente/contexto360.js` suma qué propiedades consultó antes, para que en la
segunda charla el bot retome sin volver a preguntar todo.

### Alerta

Umbral configurable en la tabla `config`, que ya existe y ya se edita desde el
panel. Al cruzarlo: mail a los vendedores vía Resend y destaque en el panel. El
bot sigue atendiendo.

**Anti-repetición:** un aviso por persona cada 24 hs, salvo que el puntaje suba.
Sin esto, cada mensaje posterior vuelve a cruzar el umbral y dispara otra
alerta.

El canal está aislado en un módulo propio (`avisos.js`), de modo que sumar
WhatsApp más adelante no toque la lógica de calificación.

## Testing

El proyecto ya corre `node --test`. Se testean las partes puras, que es donde se
esconden los errores caros:

- el armado del filtro SQL de `buscar_propiedades` (combinaciones de criterios
  presentes y ausentes);
- la lógica de umbral y anti-repetición de la alerta.

## Duda resuelta

**De dónde sale el inventario.** Confirmado por Francisco (28/07/2026): la
inmobiliaria **no tiene CRM**; esta plataforma pasa a serlo. El panel es la
fuente de verdad, con ABM manual e importador de Excel para la carga inicial. No
hay riesgo de doble carga ni de datos desincronizados con un sistema externo.

## Backlog

- **Aviso por plantilla de WhatsApp (`aviso_lead`)** como canal alternativo al
  mail. Es el que llega al teléfono fuera del horario de oficina. Requiere
  aprobación de Meta, que tarda, así que conviene mandarla con tiempo.
