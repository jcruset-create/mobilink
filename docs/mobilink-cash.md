# Mobilink Cash — mapa técnico y decisiones

Módulo de caja física: cobros, pagos, denominaciones, cambio, arqueo y cierre.
Se integra opcionalmente con una ERP externa; **sin ERP el módulo es
completamente funcional**.

## 1. Lo que ya había en Mobilink (y que se reutiliza)

El análisis previo a programar. Nada de esto se ha reinventado.

| Pieza | Dónde está | Cómo se usa en Cash |
|---|---|---|
| Stack web | React 18 + TS + Vite 5 + Tailwind 4 + react-router 7 + lucide | Igual, sin librerías nuevas |
| Backend | Express 5 (`server/index.ts`) + `pg` Pool (`server/db.ts`) | Router propio montado en `/api/cash` |
| Esquema | SQL crudo idempotente (`initDb()`) + `supabase/migrations/*.sql` | `server/cash/schema.ts` + `supabase/migrations/cash_fase1.sql` |
| Autenticación | `server/core/auth.ts` → `authenticate` (Bearer Supabase) | Mismo middleware, sin sistema de usuarios nuevo |
| Licencias | `app_licencias` + `requireModule("modulo")` | Se añade el módulo `cash` al CHECK |
| Permisos | `app_usuario_modulos (modulo, rol, pantallas)` | Rol + pantallas de Cash, mismo mecanismo |
| Auditoría | `app_auditoria` + `registrarAuditoria()` | Toda operación sensible de caja |
| Front sesión | `src/modules/sessionHeaders.ts` | `Authorization: Bearer` en cada fetch |
| Dominio puro + tests | `server/connect/pricing/*` (money.ts, engine.ts, vitest) | Mismo patrón para el motor de caja |
| Conectores externos | `server/integration-hub/` (`Connector`, `ConnectorRegistry`, `integration_operations` con `retry_count`) | Mismo contrato para `ICashErpConnector` |
| Numeración | `nextDocumentNumber()` sobre `integration_document_counters` | `MC-C-YYYY-NNNNNN` / `MC-P-YYYY-NNNNNN` |
| Lenguaje visual | `src/modules/administracion/components/ui.tsx` (slate-900/800, acento sky) | Se reutilizan `Card`, `Modal`, `TableWrap`, `Pill`, `inputCls`… |

Decisión de arquitectura clave: **el backend de Cash va en Node/Express con
`pg`**, no en funciones RPC de Postgres como TyreControl. Motivo: las
credenciales de la ERP no pueden vivir en el navegador (§46), el motor de
cambio tiene que ser testeable con vitest como `pricing/`, y el worker de
outbox necesita proceso Node. Las transacciones y los bloqueos siguen siendo
de Postgres (`BEGIN` / `SELECT … FOR UPDATE`).

## 2. Dinero

`server/cash/domain/money.ts`. Dinero = **entero de céntimos** (`Centimos`),
nunca `float`. `pricing/money.ts` usa `bigint` escalado a diezmilésimas porque
allí hay precios por km y porcentajes; en caja no existe nada por debajo del
céntimo (no hay moneda de menos de 1 c), así que el entero de céntimos es
exacto y hace el algoritmo de cambio directamente indexable.

## 3. Modelo de datos (tablas `cash_*`)

```
cash_denominations        catálogo (valor en céntimos, tipo billete/moneda, cartucho)
cash_registers            cajas físicas (centro + nombre)
cash_sessions             jornada: DRAFT|OPEN|PENDING_CLOSE|CLOSED|REOPENED|CANCELLED
cash_operations           operación normalizada (COLLECTION|PAYMENT|MANUAL_IN|…)
                          source = MANUAL|ERP|API|IMPORT|POS|OTHER
                          erp_sync_status = NOT_APPLICABLE|PENDING|SYNCING|SYNCED|ERROR|…
cash_operation_payments   formas de pago por operación (soporta mixtos)
cash_denomination_movements  libro mayor inmutable de piezas (IN/OUT + reason)
cash_counts               arqueo: cabecera
cash_count_lines          arqueo: piezas contadas por denominación
cash_external_documents   caché local de documentos ERP (externalSystem+externalId únicos)
cash_erp_configs          integración por empresa/centro (sin secretos en claro)
cash_erp_outbox           eventos pendientes de enviar a la ERP (patrón outbox)
```

El **stock teórico se reconstruye siempre** sumando
`cash_denomination_movements` de la jornada. Es la única fuente de verdad; no
hay saldo acumulado que se pueda desincronizar.

## 4. Motor de dominio (`server/cash/domain/`, sin dependencias de BD ni UI)

- `money.ts` — céntimos, formateo, parseo.
- `denominations.ts` — catálogo y cartuchos.
- `inventory.ts` — inventario por denominación: sumar, restar, validar, total.
- `change.ts` — cambio con **stock limitado**: programación dinámica exacta,
  minimiza piezas, `NO_SOLUTION` explícito cuando no hay combinación.
- `operations.ts` — invariantes de la operación (recibido − cambio = cobrado,
  mixtos, parciales).
- `arqueo.ts` — teórico vs contado por denominación, doble cuadre, reparto
  cambio final / ingreso bancario.

## 5. Integración ERP

`server/cash/erp/`: interfaz `ICashErpConnector` (`getReceivables`,
`getPayables`, `registerCollection`, `registerPayment`, `cancel*`,
`healthCheck`) + `MockCashErpConnector` para desarrollo y tests. El dominio
**no conoce ninguna ERP**: recibe siempre una `CashOperation` normalizada,
venga de un documento externo o de una alta manual.

Fiabilidad: el evento de sincronización se escribe en `cash_erp_outbox`
**dentro de la misma transacción** que la operación y sus movimientos. Un
worker lo envía después con reintentos e `idempotencyKey =` número de
operación. Una ERP caída nunca revierte un movimiento físico que ya ocurrió.

## 6. Frontend (`src/modules/cash/`)

Rutas `/cash/*`, layout propio con la misma topbar+sidebar que Administración.
Pantallas: Jornada actual · Cobros · Pagos · Movimientos · Stock de caja ·
Arqueo · Cierre · Histórico · Integración ERP.

Componente central reutilizable: `DenominationGrid`, la rejilla de −/+ por
denominación pensada para tablet, que se usa igual en cobro, pago, movimiento,
arqueo y cierre.

Lo común (`Card`, `Modal`, `TableWrap`, `Pill`, `inputCls`…) se **reexporta**
de `administracion/components/ui.tsx` en vez de copiarse; en
`cash/components/ui.tsx` solo vive lo que no existía (botones de 56 px para el
mostrador, distintivos de origen ERP/manual y de estado de sincronización).

## 7. Permisos

`server/cash/permissions.ts` traduce el rol de `app_usuario_modulos` (módulo
`cash`) a permisos finos. No hay tabla de permisos nueva: sería un mecanismo
paralelo que mantener.

| Rol | Puede |
|---|---|
| `consulta` | ver |
| `cajero` | cobrar, pagar, mover efectivo, arquear |
| `responsable` | además abrir/cerrar/reabrir, ajustar, anular, reintentar ERP |
| `admin` | además configurar la integración |

Los cobros y pagos distinguen permiso ERP de permiso manual
(`cash.collection.create` vs `cash.collection.create_manual`), que era lo que
pedía el encargo: se puede dejar cobrar facturas de la ERP a quien no debe
poder inventarse un cobro.

## 8. Estado de la entrega

Implementado y probado:

- Motor de dominio completo, con contraste contra búsqueda exhaustiva.
- Esquema, migración y alta del módulo `cash` en `app_licencias`.
- Servicio transaccional, API `/api/cash/*` y montaje en `server/index.ts`.
- Conector ERP + mock + outbox con reintentos e idempotencia.
- Las nueve pantallas del módulo, dadas de alta en `/inicio` y en `modulosApp`.

**893 pruebas en verde** (`npm test`), de las cuales 83 son de Mobilink Cash y
16 corren contra PostgreSQL real (`RUN_DB_TESTS=1`): escenario completo del
encargo sin ERP, concurrencia sobre la última pieza, ERP caída y reintento
idempotente.

Queda fuera de esta fase, y conviene decirlo:

- **Conector de una ERP real.** Solo está el mock. Escribir el de Business
  Central (o Sage, o A3) es implementar `ICashErpConnector` y registrarlo; el
  motor de caja no cambia.
- **Webhooks de entrada** (`invoice.created`, `invoice.updated`…). El modelo los
  admite —`cash_external_documents` ya hace upsert por
  `(empresa, sistema, id)`— pero no hay endpoint de recepción.
- **PDF del ingreso bancario.** Ahora se imprime la pantalla. El repo ya usa
  `pdfkit` en `server/index.ts`, así que generarlo es un añadido pequeño.
- **Exportación de una operación manual a la ERP.** El modelo lo permite
  (`source = MANUAL` + `erp_sync_status`), pero no hay acción de interfaz.
