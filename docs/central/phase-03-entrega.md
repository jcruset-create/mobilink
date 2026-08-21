# Fase 3 — Entrega: MC Central MVP

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.27`
- **Decisión Q6 aplicada:** Central va en el **mismo proceso** Express, como módulo hermano.

## Lo que existe ahora

MC Central: un módulo propio (`server/central/`, `src/modules/central/`) montado en `/api/central`
y `/central`, que **consume la cola de eventos de la fase 2** y mantiene sus propias proyecciones.
Tres pantallas: red de cajas, jornadas y organización.

Con esto la cadena está cerrada de punta a punta: un cobro en el mostrador entra en la cola dentro de
su transacción, el worker lo entrega, Central lo proyecta y aparece en la pantalla de red. Hay una
prueba que recorre exactamente ese camino.

## Decisiones que sostienen el resto

**Central no escribe nunca en `cash_*`.** Solo lee eventos y mantiene `central_events`,
`central_sessions` y `central_registers`. Si se borraran las tres, se reconstruyen volviendo a pasar
los eventos. Esa propiedad es la que las hace seguras: un error de agregación aquí no puede corromper
la caja, que sigue siendo la fuente de verdad de lo suyo.

**La defensa contra el doble conteo no es código: es la clave primaria.** `central_events.event_id`
es PK y la inserción usa `ON CONFLICT DO NOTHING`; si no insertó fila, el evento ya estaba y no se
proyecta. El worker puede reenviar —se cae justo después de entregar y antes de anotar— sin que eso
sume un cobro de más. Está probado ingiriendo el mismo evento tres veces.

**Un evento tardío no resucita un estado viejo.** Un reintento puede entregar la apertura DESPUÉS del
cierre; sin orden, la pantalla diría que sigue abierta una caja cerrada hace horas. Los cambios de
estado solo se aplican si la versión del agregado es mayor que la última aplicada, y el evento
descartado queda anotado como `TARDIO` — que no es lo mismo que no haber llegado, y por eso se
distingue.

**Los contadores, en cambio, se suman siempre.** No es una excepción a lo anterior: un cobro que llega
con retraso ocurrió de verdad y su dinero cuenta igual; lo que no puede es cambiar el estado de la
jornada, y no lo cambia. Que no se sume dos veces ya lo garantiza la clave primaria.

**El transporte es una llamada directa, no HTTP.** Es lo que compra la decisión Q6: sin red de por
medio no hacen falta todavía auth máquina-a-máquina ni certificados. Pero **el emisor no se entera**:
sigue escribiendo en su cola y entregando por `EventTransport`. El día que Central se separe, se
registra un transporte HTTP y no cambia una línea de `server/cash/`.

**Y la entrega sigue siendo asíncrona aunque no haya red.** Llamar a la ingesta dentro de la
transacción del cobro habría sido más corto y habría atado la caja a que Central funcione, que es
exactamente lo que no puede pasar.

**Central solo mira.** No mueve dinero, no cierra jornadas ajenas y no corrige descuadres. Lo único
que escribe es la organización de la red —qué taller cuelga de qué zona—, que es información de la
red y no de una caja. De ahí que haya solo dos permisos.

**Las cajas sin taller salen igual, en ámbar.** Los `LEFT JOIN` son deliberados: con un `JOIN` a
secas desaparecerían justo las cajas que hay que arreglar, que es el peor sitio donde esconderlas.

## Un fallo que solo aparece ejecutándolo

El alta del módulo `central` en el CHECK de `app_licencias` se escribió primero como un bloque
PL/pgSQL con la lista en una variable. **No funciona**: la expresión de un CHECK se guarda en el
catálogo y allí esa variable no existe (`column "modulos" does not exist`). Y el fallo es traicionero
porque el `DROP CONSTRAINT` de la línea anterior sí pasa: te quedas sin restricción **y** con un
error. Se probó contra PostgreSQL antes de dejarlo, y ahora la lista vive en una constante de
TypeScript y el CHECK se monta desde ahí, en un solo sitio.

## Qué se tocó

| Fichero | Qué |
|---|---|
| `supabase/migrations/central_fase3_readmodels.sql` | Nuevo: las tres tablas y el alta del módulo |
| `server/central/schema.ts` | El mismo DDL, idempotente, más el registro del módulo |
| `server/central/ingest.ts` | Nuevo: ingesta idempotente y proyecciones |
| `server/central/queries.ts` | Nuevo: resumen de red, cajas y jornadas |
| `server/central/transport.ts` | Nuevo: transporte local |
| `server/central/permissions.ts`, `router.ts`, `index.ts` | Nuevos |
| `server/index.ts` | Init, montaje y transporte |
| `src/modules/central/**`, `src/App.tsx`, `src/pages/InicioPage.tsx`, `modulosApp.ts` | Módulo en el panel |
| `server/central/central.integration.test.ts` | Seis pruebas |

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** | **1133 / 1133** |
| Suite completa, base **recién creada** | **1133 / 1133** |
| Migración aplicada dos veces | Sin error; el CHECK queda con `central` dentro |
| `npx tsc` (servidor y app) · `npm run build` | Correcto |
| `bash scripts/check-versions.sh` | `package.json` SUBIDA (1.8.27) |
| ESLint sobre lo nuevo | **Tres avisos**, todos `react-hooks/set-state-in-effect` en `CentralApp.tsx` |

Sobre esos tres avisos, igual que en la fase 2: es el patrón de carga de datos que usan las 164
pantallas del proyecto. Escribir la pantalla nueva de otra manera dejaría dos formas de cargar datos
conviviendo. Va al montón de `docs/central/lint-y-pruebas.md`.

## Para estrenarlo

Como con la caja, tres pasos desde la interfaz:

1. **Licencia:** Administración → Empresas → licencias, módulo `central`.
2. **Permisos:** Administración → Usuarios, fila en el módulo MC Central con su rol.
3. **Nada más.** No hay que configurar transporte: al arrancar el servidor se registra solo, y los
   eventos que la caja lleve acumulados desde la fase 2 se proyectan en la primera vuelta del worker.

## Lo que queda

- **Reglas y alertas** (fase 7): hoy la pantalla enseña descuadres, pero nadie avisa de ellos.
- **La jerarquía completa por zona**: la organización se administra, pero el resumen todavía no
  agrupa por zona.
- **Reconstrucción de proyecciones**: es posible por diseño —volver a pasar `central_events`— pero no
  hay botón que lo haga.
- **Purga**: `central_events` y `cash_event_outbox` crecen sin límite.
