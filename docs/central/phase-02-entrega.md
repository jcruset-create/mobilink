# Fase 2 — Entrega: motor de eventos, idempotencia y cola muerta

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.26`
- **Plan aprobado:** `docs/central/phase-02-plan.md`

## Lo que hace ahora el módulo y antes no

Cada hecho de la caja se anota en `cash_event_outbox` **dentro de la misma transacción que mueve el
dinero**, con su número de orden y su clave de deduplicación, y un worker lo entrega con reintentos.
Antes solo se contaban cobros y pagos, y solo si había una ERP configurada.

Nueve tipos de evento: `SESSION_OPENED` · `SESSION_CLOSED` · `SESSION_REOPENED` ·
`OPERATION_REGISTERED` · `OPERATION_REVERSED` · `COUNT_RECORDED` · `COUNT_ADJUSTED` ·
`BANK_DEPOSIT_CREATED` · `BANK_DEPOSIT_VOIDED`.

## Decisiones que sostienen el resto

**Un solo punto de emisión para todo el dinero.** `registrarOperacion` es por donde pasan cobros,
pagos, ajustes, cambios de moneda, pedidos al banco, entregas, liquidaciones y canjes de ingreso. Con
él y los ocho cambios de estado que no mueven piezas, son nueve emisiones y no diecisiete. Menos
sitios que recordar es menos sitios que olvidar.

**El INSERT del evento no puede fallar por los datos.** Va dentro de la transacción del dinero, así
que un rechazo arrastraría consigo un cobro que ya ocurrió —el efectivo en el cajón y el cliente en
la calle—. Por eso la tabla **no tiene claves ajenas ni CHECK sobre el tipo**, y el emisor no valida
nada: no hay comprobación que merezca el riesgo de tirar una transacción de dinero. Lo único que
puede rechazar la fila es que la base esté caída, y entonces el cobro tampoco se guarda.

**La apertura emite un evento, no dos.** El fondo inicial se asienta como operación, pero la apertura
no pasa por `registrarOperacion`: emite `SESSION_OPENED` con el fondo dentro. Con los dos eventos,
Central podría sumar el fondo dos veces — el doble conteo que el encargo prohíbe. Está fijado en una
prueba para que nadie lo "arregle" más adelante.

**El ingreso bancario cuelga de la CAJA, no de una jornada.** Agrupa varios cierres y no pertenece a
ninguno; forzarlo dentro de uno obligaría a elegir cuál manda, y cualquier respuesta sería inventada.
De ahí que haya dos tipos de agregado.

**La versión no añade contención.** Sube con `UPDATE … RETURNING` sobre una fila que la transacción
**ya tiene bloqueada**: la jornada por `bloquearSesion`, la caja por el bloqueo de los ingresos. Dos
terminales no pueden sacar el mismo número porque la segunda ya esperaba antes de esta fase.

**PENDING acumulándose no es una avería.** MC Central no existe hasta la fase 3, así que sin
transporte registrado el worker no toca nada y los eventos esperan destino. La pantalla lo dice con
esas palabras, para que nadie los borre creyendo que están atascados.

**Dos workers y no uno compartido.** El de la ERP y el de eventos comparten la forma —tanda, espera
creciente, `SKIP LOCKED`— pero no lo que hacen: uno traduce a documentos de una ERP y el otro entrega
hechos. Con dos casos, extraer la abstracción cuesta más claridad de la que ahorra. Si aparece un
tercero, se extrae.

## Qué se tocó

| Fichero | Qué |
|---|---|
| `supabase/migrations/central_fase2_eventos.sql` | Nuevo: `cash_event_outbox` y `version` en jornadas y cajas |
| `server/cash/schema.ts` | El mismo DDL, idempotente |
| `server/cash/events/emitter.ts` | Nuevo: tipos de evento, versión del agregado y el INSERT |
| `server/cash/events/transport.ts` | Nuevo: interfaz `EventTransport`, transporte en memoria, error permanente |
| `server/cash/events/worker.ts` | Nuevo: tanda, reintentos, cola muerta y relanzamiento |
| `server/cash/service.ts` | Siete emisiones |
| `server/cash/bankdeposits.ts` | Dos emisiones |
| `server/cash/router.ts` | `GET /events` y `POST /events/retry` |
| `server/cash/index.ts`, `server/index.ts` | Arranque del worker |
| `src/modules/cash/**` | La cola, dentro del panel de Integración |
| `server/cash/cash.integration.test.ts` | Cinco pruebas |

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** | **1127 / 1127** |
| Suite completa, base **recién creada** | **1127 / 1127** |
| Migración aplicada dos veces | Sin error; la segunda no cambia nada |
| `npx tsc` (servidor y app) · `npm run build` | Correcto |
| `bash scripts/check-versions.sh` | `package.json` SUBIDA (1.8.26) |
| ESLint sobre lo tocado | **Un aviso nuevo**: `react-hooks/set-state-in-effect` en `IntegracionErp.tsx:158` |

Sobre ese aviso, y para no venderlo como lo que no es: es el mismo patrón que ya tienen las otras
cuatro llamadas de esa pantalla y las 164 del proyecto. Se ha escrito igual que sus vecinas a
propósito; hacerlo distinto solo en la sección nueva dejaría dos maneras de cargar datos en el mismo
fichero. Va al montón de `docs/central/lint-y-pruebas.md`, que se aborda entero o no se aborda.

La prueba que justifica el diseño: **con el transporte caído, el cobro se registra igual** y el
evento se queda esperando con su error anotado. Si eso fallara, sobraría el resto.

## Lo que queda para después

- **El transporte real y MC Central**: fase 3. Hoy solo existe el de memoria, que es el que usan las
  pruebas.
- **Reconstruir el histórico anterior a esta fase**: fase 11, con su propio criterio.
- **Purga de la cola.** `SENT` crece sin límite. No corre prisa —una caja genera unas decenas de
  eventos al día— pero conviene decidirlo antes de que sean años.
