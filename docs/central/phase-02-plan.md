# Fase 2 — Motor de eventos, idempotencia y DLQ · Plan e impacto

- **Commit de partida:** `6885c39` · **Estado:** propuesta, **sin código escrito**.
- **Base:** `docs/central/phase-00-discovery.md` (apartado G) y la Fase 1 ya entregada.

---

## 1. Qué falta de verdad

La Fase 0 dejó claro que **el patrón ya está construido y probado**, solo que atado a la ERP:
outbox dentro de la transacción, `idempotency_key UNIQUE`, backoff exponencial de 30 s a 1 h y
`FOR UPDATE SKIP LOCKED` para varias instancias (`server/cash/erp/worker.ts:27-28,68`).

Lo que falta es de acoplamiento, no de diseño:

| # | Trabajo | Evidencia |
|---|---|---|
| 1 | **Emitir siempre**, haya ERP o no | Hoy el encolado va dentro de `if (conector)` (`service.ts:655,1571-1572`) |
| 2 | **Cubrir todo el dominio**, no solo cobros y pagos | Solo dos emisores: `service.ts:711` y `:1573` |
| 3 | **Versionado optimista** | No existe `aggregate_version` en el esquema |
| 4 | **DLQ que se pueda mirar** | Hay estado terminal y relanzamiento, pero ninguna pantalla |

## 2. El hallazgo que hace esta fase barata

Buscando dónde habría que emitir salió esto: **`registrarOperacion` es el cuello de botella de todo
el dinero**. Cobros, pagos, movimientos, ajustes, cambios de moneda, pedidos de cambio al banco,
entregas, liquidaciones y canjes de ingreso pasan todos por ahí —`treasury.ts:345,483,580,658,793,813`,
`bankdeposits.ts:772`, `service.ts:852`, `router.ts:1182,1311,1354`— y además **acepta el cliente de
una transacción ya abierta** (`service.ts:513-520`).

Es decir: **un solo punto de emisión cubre todos los movimientos de efectivo del módulo**, dentro de
la transacción que ya está abierta y sin abrir ninguna nueva.

Fuera de él solo quedan los cambios de estado que no mueven piezas:

`abrirJornada` · `cerrarJornada` · `reabrirJornada` · `guardarArqueo` · `regularizarArqueo` ·
`anularOperacion` · `crearIngreso` · `anularIngreso`

**Nueve puntos de emisión en total**, no diecisiete.

## 3. Decisiones que necesito confirmadas

| # | Decisión | Recomendación | Por qué |
|---|---|---|---|
| E1 | ¿Tabla nueva o generalizar `cash_erp_outbox`? | **Tabla nueva `cash_event_outbox`** | La existente lleva `connector_key` y una FK a `cash_operations`. Mezclar dominios en una cola que está en producción es riesgo gratuito |
| E2 | ¿Qué es el agregado? | **Dos tipos: la jornada y la caja** | Los eventos de jornada ya están serializados por su bloqueo (`repository.ts:259`) y los de ingreso por el de la caja (`bankdeposits.ts:271`). El contador sube dentro de un bloqueo que ya existe: no añade contención |
| E3 | ¿A dónde se entregan, si Central no existe? | **Interfaz `EventTransport` + implementación en memoria para pruebas.** Los eventos se acumulan en `PENDING` | Es el mismo patrón que el módulo ya usa con `MockCashErpConnector`. El transporte HTTP real llega en la Fase 3, cuando haya destino |
| E4 | ¿Qué lleva el evento? | **Lo mínimo identificable + el importe**, no la operación entera | Un evento gordo se convierte en un segundo modelo de datos que mantener. Central puede pedir el detalle cuando lo necesite |
| E5 | ¿Se emite lo ya ocurrido antes de esta fase? | **No.** El flujo arranca vacío | Rellenar el histórico es la Fase 11 (`Migration Center` + `INITIAL_BALANCE`), con su propio criterio |

## 4. Análisis de impacto

**Riesgo principal: emitir dentro de la transacción del dinero.** Si el `INSERT` del evento falla, la
transacción entera se deshace y **un cobro que ya ocurrió físicamente no se registra**. Es el peor
fallo posible en este módulo.

Mitigación, y es la razón de tres decisiones del diseño:

- El `INSERT` no valida nada que pueda fallar por datos: sin FK a `cash_operations` (que en algunos
  casos aún no tiene id), sin CHECK sobre el tipo, y el payload es `JSONB` sin forma obligatoria.
- Sin índice único más allá de `event_id`, que es un UUID generado en el momento.
- Se prueba explícitamente que **la caída del transporte no revierte nada**: es la prueba que ya
  existe para la ERP («ERP caída y reintento idempotente») aplicada al canal nuevo.

**Riesgo secundario: coste por operación.** Un `INSERT` más por movimiento, dentro de una transacción
ya abierta y con la jornada ya bloqueada. Irrelevante para una caja de mostrador.

**Lo que NO se toca:** el motor de dominio, el libro mayor, la numeración, `cash_erp_outbox` y su
worker —que siguen funcionando igual— y ninguna pantalla existente.

## 5. Plan de ejecución

1. **Esquema** — `cash_event_outbox` (migración + DDL de arranque, todo nullable salvo lo que el
   propio insert genera) y `version` en `cash_sessions` y `cash_registers`, con DEFAULT 0.
2. **`server/cash/events/emitter.ts`** — `emitirEvento(client, ctx, {...})`: asigna versión dentro
   del bloqueo existente y escribe la fila. Sin dependencias del transporte.
3. **Emisión** — el punto único de `registrarOperacion` más los ocho cambios de estado.
4. **`server/cash/events/transport.ts`** — interfaz + implementación en memoria.
5. **`server/cash/events/worker.ts`** — reutiliza el backoff y el `SKIP LOCKED` del de ERP. Si los
   dos workers acaban siendo el mismo código con distinta tabla, se extrae; si no, se dejan separados
   antes que forzar una abstracción sobre dos casos.
6. **DLQ** — endpoints de listado y relanzamiento, y pantalla mínima bajo Integración.
7. **Pruebas** — contra PostgreSQL real, en base nueva y migrada: un cobro emite un evento y solo
   uno; el reintento no duplica; la versión sube en orden bajo concurrencia; **el transporte caído no
   revierte el cobro**; y el relanzamiento desde la DLQ funciona.
8. **Documentación** — `docs/central/phase-02-*.md` y nota en `docs/mobilink-cash.md`.

## 6. Qué no entra

- **El transporte HTTP real y MC Central**: Fase 3, cuando haya a quién entregar.
- **Webhooks de entrada**: Fase 12.
- **Reconstruir el histórico anterior**: Fase 11.

## 7. Verificación comprometida

`npm test` con `RUN_DB_TESTS=1` **en las dos bases** (recién creada y migrada), `npm run build`,
`npx tsc`, `npm run lint` sobre los ficheros tocados —comprobando que no añaden ningún aviso nuevo
al inventario heredado— y `bash scripts/check-versions.sh`.
