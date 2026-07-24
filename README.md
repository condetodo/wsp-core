# wsp-core

Plataforma base de **WhatsApp + agente IA + panel de asesores**, lista para replicar por cliente. Es el esqueleto genérico extraído de un proyecto real en producción: motor de conversación con Claude (con herramientas), CRM mínimo por teléfono, derivación a asesores humanos, plantillas y envíos masivos, encuestas CSAT, métricas y tracking de costos.

## Arquitectura: core vs cliente

El repo separa el **motor genérico** (core, no se toca al dar de alta un negocio) de lo **específico de cada cliente**:

| Dónde | Qué es |
|---|---|
| `cliente/personalidad.js` | El system prompt del agente: quién es, qué atiende, con qué reglas. **El** archivo a escribir por cliente. |
| `cliente/schema.js` | Las tablas del vertical del negocio (db.js las crea después de las core). |
| `cliente/contexto360.js` | Qué datos del negocio se suman al perfil 360 que ve el agente. |
| `herramientas.js` | Las tools del agente. Trae las core (guardar datos, cerrar, derivar) + `consultar_info_negocio` como demo del patrón; las tools reales del negocio se agregan acá. |
| `assets/branding.css` / `assets/branding.js` / `assets/logo.svg` | Color, nombre y logo del panel. |

Todo lo demás es core: `webhook.js` (entrada de Meta + loop de respuesta), `agente.js` (motor del agente con tools), `clientes.js` (contexto 360), `historial.js`/`resumir.js` (memoria + resúmenes), `derivacion.js`/`casos.js` (asesores humanos), `plantillas.js` (envíos masivos), `encuestas.js`, `metricas.js`, `uso.js` (costos), `panel.js` + `panel-*.html` (panel web).

## Checklist de alta de un cliente nuevo

1. **Copiar el repo** a uno nuevo del cliente.
2. **Cuenta de WhatsApp Business (Meta)**: app en Meta for Developers, número de WhatsApp, token permanente, WABA ID, y apuntar el webhook a la URL del deploy (`GET/POST /webhook`).
3. **Proyecto en Railway** (o equivalente) con plugin Postgres y estas variables:
   - `DATABASE_URL` (la inyecta el plugin)
   - `ANTHROPIC_API_KEY`
   - `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `WABA_ID`, `VERIFY_TOKEN`
   - `PANEL_SECRET` (habilita el panel), `TAREAS_KEY` (habilita las tareas por URL)
4. **Escribir el prompt** del negocio en `cliente/personalidad.js`.
5. **Definir el vertical**: tablas en `cliente/schema.js`, datos del perfil en `cliente/contexto360.js`, tools en `herramientas.js` (seguí el patrón de `consultar_info_negocio`).
6. **Branding**: nombre en `assets/branding.js`, colores en `assets/branding.css`, logo en `assets/logo.svg`.
7. **Asesores**: crear usuarios del panel con `node crear-asesor.js`.
8. **Importar la base de contactos** (opcional): `node importar-clientes.js archivo.xlsx` (columnas Nombre, Apellido, Telefono, Correo Electronico; extendible por cliente).
9. **Templates de Meta**: registrar el aviso a asesores (`node aviso-asesor-template.js`) y la encuesta (`/tareas/crear-encuesta?key=...`); adaptar `crear-template.js` si el negocio usa recordatorios.
10. **Validar**: `npm test` y una conversación de punta a punta con `railway run node simular-conversacion.js`.

## Desarrollo

- `npm test` — suite de tests (node:test, sin base de datos).
- `node webhook.js` — levanta el servidor (webhook + panel).
- `node simular-conversacion.js [numero]` — conversa con el agente real por consola (escribe en la base).
- `node comparar-modelos.js [numero]` — corre el mismo guion contra dos modelos de Claude y compara tokens, costo y calidad.
