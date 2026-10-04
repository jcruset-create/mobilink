# Mobilink Self Storage: arquitectura propuesta

> **Estado: arquitectura CONFIRMADA (2 de octubre de 2026) y fase 1
> implementada.** Las decisiones confirmadas del §0 mandan sobre cualquier
> otra parte de este documento que diga lo contrario. El esquema de la fase 1
> vive en [`supabase/migrations/self_storage/`](../../supabase/migrations/self_storage/),
> que es la fuente única y la aplica el servidor al arrancar. [`esquema.sql`](./esquema.sql)
> queda como borrador de diseño de las fases 2 a 4 y se irá pasando a
> migraciones fase a fase.

Índice:

0. Decisiones confirmadas
1. Análisis de requisitos: inconsistencias y huecos
2. Arquitectura
3. Estructura de carpetas
4. Modelo de datos: tablas, campos y relaciones
5. Estados y transiciones
6. API / endpoints
7. Servicios Stripe
8. Servicio RUT241 (control de puertas)
9. Seguridad y RLS
10. Flujos principales
11. Pantallas
12. Importación de trasteros (CSV / Reus)
13. Tareas programadas
14. Plan por fases y criterio de éxito
15. Fase 1: lo que está hecho

---

## 0. Decisiones confirmadas

| # | Decisión |
|---|---|
| D1 | **Un solo stack**: Vite + React + TypeScript + Express + Supabase/PostgreSQL + Render. Ni migración a Next.js ni una segunda app Next.js para la web pública en el MVP. Si más adelante el SEO lo pide, se valorará una web pública aparte. |
| D2 | **Render**: en desarrollo, la infraestructura actual. Se diseña **suponiendo que en producción el servicio no se duerme**; antes de poner en producción el control de accesos se pasa a un plan adecuado. Las tareas críticas (caducidad de reservas, impagos, reintentos, sincronización con dispositivos, procesamiento de eventos) son **trabajos programados del servidor**, nunca dependen de que alguien tenga el panel abierto (§13). |
| D3 | **Facturación propia**. Stripe es el medio de cobro, no la única fuente contable. La factura emitida guarda **instantáneas** (nombre o razón social, NIF, dirección fiscal, conceptos, bases, impuestos y totales); un cambio posterior del cliente no altera facturas antiguas. Las emitidas no se borran ni se renumeran; la numeración es **transaccional y correlativa**. El modelo deja sitio para la facturación electrónica (Veri*factu) sin rehacer el módulo. |
| D4 | **Tratamiento fiscal configurable por concepto**. No se presupone en el código si la fianza lleva IVA. `invoice_items` guarda como mínimo concepto, `quantity`, `unit_price`, `tax_rate`, `tax_amount`, `total` e `item_type` (`rental`, `deposit`, `insurance`, `lock`, `penalty`, `discount`, `other`). El trastero guarda base, IVA y PVP **del alquiler**, sin suponer que otras líneas tengan el mismo tratamiento. En la fase 2 habrá un catálogo de conceptos facturables con su tratamiento fiscal. |
| D5 | **SEPA, dos situaciones**. *Cliente nuevo, primer cobro*: tarjeta confirmada → se activa; SEPA en `processing` → **por defecto NO se da acceso** hasta confirmarse (`billing.first_sepa_payment_access_policy` = `wait_for_success` \| `allow_while_processing`, más un *override* administrativo auditado). *Cliente con contrato activo*: una mensualidad SEPA en `processing` **no bloquea**; la política de impago sólo empieza cuando Stripe informa de fallo o devolución. |
| D6 | **Bloqueos separados por motivo** (`self_storage_access_blocks`). Puede haber varios a la vez; cobrar la deuda levanta **sólo** el de impago. El acceso efectivo se calcula con **todos** los bloqueos activos. |
| D7 | **Acceso telefónico por adaptador**: `rut_whitelist` (el RUT241 abre a los números autorizados), `backend_validated` y `twilio`. **Twilio no es obligatorio** y la aplicación no se acopla a él. Para el MVP se conserva la apertura por llamada del RUT241: el backend **sincroniza** los teléfonos autorizados con el dispositivo (contrato activo → alta; suspensión → baja; reactivación → alta otra vez) y guarda un **registro de sincronización** que dice si la configuración del RUT241 está al día. |
| D8 | **Dispositivo → salidas → puertas**. No se asume ni «1 RUT241 = 1 puerta» ni «1 RUT241 = varias». Entidad `self_storage_device_outputs` (`device_id`, `output_number`, `name`, `output_type`, `pulse_duration_ms`, `enabled`) y la puerta referencia `device_output_id`. Adaptadores separados (RMS / API / VPN, módulos de relés, otros controladores); la conectividad física se decide tras las pruebas con el equipo. |
| D9 | **Plano SVG** con `floor_plan_shape_id` y colores del estado REAL en la base. En el panel, la ficha del trastero muestra número, medidas, m², m³, precio, estado, cliente, contrato, estado de pagos y zona, con accesos rápidos: ver cliente, contrato, facturas y accesos, cambiar trastero y finalizar contrato. |
| D10 | **Tipos de trastero** (`self_storage_unit_types`) con la imagen 3D y la descripción de capacidad compartidas. Cada trastero conserva sus medidas reales y apunta a su tipo con `unit_type_id`. |
| D11 | **Reservas**: la garantía contra la doble contratación está en PostgreSQL (índices únicos parciales y transacciones), con `expires_at`. |
| D12 | **Accesos temporales** asociados al contrato: si el contrato pierde el derecho de acceso, el temporal tampoco abre. |
| D13 | **Personas autorizadas por contrato** (`self_storage_contract_members`): nombre, teléfono, email opcional, estado y métodos de acceso, con sus propios eventos de acceso. |
| D14 | **Sólo inserción** donde tiene sentido: eventos de acceso, eventos de Stripe, cambios de seguridad, aperturas de administrador y auditoría. |
| D15 | **Importador** con dry-run, validación, listado de errores, confirmación e importación sin duplicados. Identificador comercial: número de trastero + centro. Ningún dato de Reus en el código. |
| D16 | **Multi-centro** desde el primer día. 1 cliente → N contratos (incluso en centros distintos); 1 contrato → 1 trastero (inicialmente). |
| D17 | **Aislamiento**: los clientes de Self Storage no se mezclan con los de ningún otro módulo. Sólo se comparte lo transversal: la autenticación y los permisos de los usuarios internos, la empresa (tenant) y la configuración común cuando tenga sentido. |

## 1. Análisis de requisitos: inconsistencias y huecos

1. **Next.js frente al repositorio real.** Ver D1. Además el servidor de
   Mobilink crea el esquema **al arrancar** con DDL idempotente
   (`prepararEsquema`, ARCHITECTURE.md §14), sin herramienta de migraciones. Lo
   respeto: `esquema.sql` se aplicará así.
2. **Supabase Auth es un único pool de usuarios.** Los empleados (`app_usuarios`)
   y los clientes de trasteros vivirían en el mismo `auth.users`. La separación
   que propongo:
   - empleado = tiene fila en `app_usuarios` y en
     `app_usuario_modulos(modulo='self_storage')`;
   - cliente = tiene `self_storage_customers.auth_user_id`;
   - **dos guardas independientes**. La del portal no da ningún permiso
     interno y la del panel no ve a nadie del portal;
   - un mismo email puede ser las dos cosas, y cada guarda decide por su lado.

   Se respeta ARCHITECTURE.md §4: no se crea otro sistema de permisos, se usa
   `app_usuario_modulos` con los roles `superadmin` (que es `es_superadmin`),
   `admin`, `employee` y `maintenance`.
3. **Cliente de tipo `company`** con solo `first_name` y `last_name` no puede
   emitir una factura válida. Añado `company_name` (razón social), con un
   CHECK según el tipo.
4. **`phone` en el cliente frente a `self_storage_customer_phones`.**
   `customers.phone` es el teléfono de contacto. La tabla de teléfonos guarda
   los números **autorizados para abrir por llamada** (`allow_door_access`),
   que pueden ser varios (por ejemplo, empleados de una empresa cliente). Un
   número autorizado identifica a **un solo** cliente por empresa (índice
   único parcial).
5. **Bloqueos que se pisan.** Con un único `status = blocked` en el permiso,
   cobrar la deuda levantaría también un bloqueo por **seguridad**. Por eso
   añado **`self_storage_access_blocks`**: una fila por motivo
   (`non_payment`, `security`, `incident`, `contract_ended`, `manual`) y por
   ámbito (cliente, contrato o puerta). Al cobrar solo se levantan los
   bloqueos `non_payment`.
6. **«Puertas permitidas» de un acceso temporal.** Con un array no habría FKs.
   Uso la tabla de unión **`self_storage_temporary_access_doors`**. Al
   acceso temporal le añado `contract_id`: sin él no se puede suspender
   cuando se suspende el contrato. Sus estados son `active`, `suspended`,
   `expired`, `revoked` y `exhausted` (usos agotados). El invitado abre con un
   enlace mágico (se guarda el token con hash) o por llamada desde
   `guest_phone`.
7. **Horario permitido.** No tenía dónde guardarse. Va en
   `centers.access_schedule` y opcionalmente en `doors.access_schedule`, que
   lo sobreescribe. Se evalúa en la zona horaria del centro.
8. **Numeración de facturas.** Tiene que ser correlativa y sin huecos por
   serie y año. Añado `self_storage_sequences`, con bloqueo de fila. La
   factura en `draft` no tiene número; lo recibe al emitirse. Una factura
   emitida **no se edita**: lo impide un trigger, y se corrige con una
   rectificativa (`rectifies_invoice_id`).
9. **Veri*factu.** Si Mobilink emite las facturas, es un sistema
   informático de facturación sujeto al RD 1007/2023 (Veri*factu), con plazos
   en 2027. **No entra en el MVP**, pero el modelo lo deja preparado: datos
   congelados, huella del PDF y numeración correlativa. Conviene que lo
   revise vuestra asesoría.
10. **Stripe puede cancelar suscripciones por su cuenta.** Si en Stripe la
    suscripción se cancela tras los reintentos fallidos, llegaría
    `customer.subscription.deleted` y alguien podría entender «terminar el
    contrato». Decisión: en Stripe se configura **«dejar la suscripción
    vencida»** en vez de cancelarla. Nuestro motor de impagos manda. Si llega
    un `deleted` que no hemos pedido nosotros, se registra, se abre una
    incidencia de facturación y **no** se termina el contrato.
11. **Estado del trastero: dos fuentes de verdad.** `units.status` se podría
    contradecir con las reservas y los contratos. Por eso:
    - lo mueve **solo** el servicio, dentro de la misma transacción que
      cambia la reserva o el contrato;
    - la exclusión real la garantizan **índices únicos parciales**, uno de
      reserva activa por trastero y otro de contrato vivo por trastero;
    - `maintenance` y `blocked` son manuales y no se pueden poner con un
      contrato vivo.
12. **Las reservas caducan, pero `now()` no puede ir en un índice.** La
    caducidad se resuelve de dos formas, sin depender de que el cron haya
    pasado:
    - **perezosa**: dentro de la transacción de reservar se marcan como
      `expired` las reservas caducadas de ese trastero, después del
      `SELECT … FOR UPDATE`;
    - **barrido**: una tarea cada minuto.
13. **El cliente en el flujo online.** Se crea en `inactive` en el paso
    «introducir datos», deduplicado por `tax_id`. Pasa a `active` al activar
    el primer contrato. El estado `inactive` cubre a quien no termina.
14. **El impago no es «día 0 = pago fallido» si es SEPA.** Un SEPA en
    `processing` no cuenta como vencido. El día 0 es el `invoice.payment_failed`
    o la fecha de vencimiento sin cobrar, lo que llegue antes, y se guarda en
    `invoices.overdue_since`.
15. **El RUT241 tiene muy pocas E/S.** Tiene una entrada y una salida
    digitales configurables, según la ficha de Teltonika; **hay que
    confirmarlo con el modelo exacto**. Probablemente harán falta un RUT241
    por puerta o un módulo de relés. El modelo ya lo admite: `doors.device_id`
    y `output_channel`, con una salida física por puerta como mucho.
16. **`pdf_url`.** Como el bucket es privado, guarda la **ruta**, no una URL.
    La API entrega una URL firmada de 60 s después de comprobar a quién
    pertenece. El número de factura se diseña sin `/` (`SS-2026-000123`)
    porque va en la ruta.
17. **Centros de Self Storage frente a `app_centros`.** `app_centros` son
    talleres. Self Storage tiene sus propios `self_storage_centers`. Solo se
    comparte el **tenant de plataforma** (`empresa_id` → `app_empresas`), que
    no es un cliente, así que no rompe el aislamiento. Cualquier enlace futuro
    con otros módulos irá en una tabla de enlaces opcional.

## 2. Arquitectura

```
                    ┌──────────────── Render (1 servicio Node) ─────────────────┐
 Navegador          │                                                           │
 ─ Panel interno ───┤  Express                                                  │
 ─ Portal cliente ──┤   /api/self-storage/admin/*    guard: staff + rol         │
 ─ Web pública ─────┤   /api/self-storage/portal/*   guard: cliente (auth_user) │
                    │   /api/self-storage/public/*   sin sesión, lista blanca   │
 Stripe ──webhook──►│   /api/self-storage/webhooks/stripe    firma Stripe      │
 Twilio ──webhook──►│   /api/self-storage/webhooks/voice     firma Twilio      │
                    │         │                                                 │
                    │   server/self-storage/  (dominio aislado)                 │
                    │     modules/* → service → repository (pg, SQL)            │
                    │     domain/*  → reglas puras, testeadas sin BD            │
                    │     integrations/stripe, integrations/doors (RUT241)      │
                    │     jobs/* (reservas, accesos, impagos, heartbeat)        │
                    └────────┬───────────────────────┬──────────────────────────┘
                             │ pg (propietario)      │ HTTPS
                    Supabase PostgreSQL + Storage    Stripe · Teltonika RMS/RUT241 · Twilio
                    (RLS como 2.ª barrera)
```

Principios:

- **Dominio aislado.** Ningún fichero de `server/self-storage/` lee tablas
  que no empiecen por `self_storage_`, salvo `app_usuarios`,
  `app_usuario_modulos` y `app_empresas`, que son la identidad interna y el
  tenant. Una prueba recorre el código y falla si aparece otra, como ya hace
  Recepciones (ARCHITECTURE.md §15).
- **Capas por módulo**: `router` (HTTP y validación zod) → `service`
  (transacciones, reglas y auditoría) → `repository` (SQL). Las reglas de
  negocio que deciden algo, como si se puede abrir, si toca suspender o la
  transición de estado, están en `domain/` como **funciones puras** que
  devuelven también el **motivo**.
- **La base de datos es la última barrera**: constraints, índices únicos
  parciales, triggers que no admiten cambios y RLS.
- **Nada importante se calcula en el frontend**: ni precios, ni estados, ni
  permisos. Los precios siempre llegan de la API.
- **Secretos solo en variables de entorno**: `STRIPE_SS_SECRET_KEY`,
  `STRIPE_SS_WEBHOOK_SECRET`, `SELF_STORAGE_*` para los dispositivos y la
  service role. En base de datos solo se guarda el **nombre** de la variable
  (ARCHITECTURE.md §10).

## 3. Estructura de carpetas

```
server/self-storage/
  index.ts                     initSelfStorage() + mountSelfStorage(app) + startJobs()
  schema/
    001_enums.sql  002_tables.sql  003_indexes.sql  004_triggers.sql  005_rls.sql
    apply.ts                   aplica los .sql en orden (idempotente)
  auth/
    staff.ts                   authenticate + rol en app_usuario_modulos('self_storage')
    customer.ts                Bearer → self_storage_customers.auth_user_id
    permissions.ts             rol → permisos finos (forma de recepciones/permissions.ts)
  shared/
    db.ts (withTx)  errors.ts  money.ts (toCents/fromCents)  validation.ts (zod)
    audit.ts  sequences.ts  storage.ts (bucket privado, URLs firmadas)  rateLimit.ts
  domain/                      PURO, sin BD, con *.test.ts al lado
    unitStatus.ts  reservation.ts  contractState.ts  invoiceState.ts
    paymentState.ts  accessDecision.ts  schedule.ts  dunning.ts
    pricing.ts  taxId.ts  phone.ts  importUnits.ts  floorPlan.ts
  modules/
    centers/ zones/ units/ floorplan/ imports/
    customers/ contracts/ documents/ reservations/
    invoices/ (pdf.ts) payments/
    doors/ devices/ access/ temporary-access/ blocks/
    incidents/ notifications/ settings/ dashboard/ audit/
    portal/ public/            routers que componen servicios de los módulos
    (cada módulo: router.ts · service.ts · repository.ts · schemas.ts)
  integrations/
    stripe/   client.ts  webhook.ts  handlers/*.ts  checkout.ts  sync.ts
    doors/    DoorController.ts  rmsController.ts  rutHttpController.ts  mockController.ts
    voice/    twilioVoice.ts       llamada entrante → abrir
  jobs/
    scheduler.ts  expireReservations.ts  expireAccesses.ts  dunning.ts
    deviceHeartbeat.ts  notificationsOutbox.ts  stripeReplay.ts
  aislamiento.integration.test.ts  flujoMvp.integration.test.ts

src/modules/self-storage/
  SelfStorageApp.tsx           rutas /self-storage/* (panel)
  PortalApp.tsx                rutas /trasteros/portal/* (cliente)
  PublicApp.tsx                rutas /trasteros/* (web pública + contratación)
  config/navigation.ts
  services/ adminApi.ts  portalApi.ts  publicApi.ts
  types/                       DTOs compartidos con el servidor (sin secretos)
  components/
    floor-plan/ FloorPlan.tsx  UnitShape.tsx  UnitPanelAdmin.tsx  UnitPanelPublic.tsx
    ui/ StatusBadge.tsx  Money.tsx  ...
  pages/admin/   Dashboard Customers CustomerDetail Units FloorPlanPage Contracts
                 ContractDetail Invoices Payments Access Doors Devices Incidents Settings Imports
  pages/portal/  Home Unit Contract Invoices PaymentMethod Doors TemporaryAccess
  pages/public/  Centers Sizes UnitCapacity Checkout/{Data,Review,Sign,Pay,Done}
```

Además: añadir `server/self-storage/**` al `include` de `tsconfig.server.json`
**en el mismo commit** (ARCHITECTURE.md §14); `self-storage` en `BASES`
(`src/modules/rutasModulos.ts`) y en `MODULOS_SAAS`. En `server/index.ts`
solo se añaden dos líneas: `prepararEsquema("Self Storage", …)` y
`mountSelfStorage(app)`. El webhook se monta **antes** de `express.json()`
porque necesita el cuerpo sin procesar.

## 4. Modelo de datos

Detalle completo en [`esquema.sql`](./esquema.sql). Resumen:

```
app_empresas (tenant de plataforma)
 └─ self_storage_centers ─┬─ self_storage_zones ─┬─ self_storage_units ──┐
                          │                      └─ self_storage_doors   │
                          ├─ self_storage_devices ──► doors.device_id    │
                          └─ self_storage_settings (por empresa/centro)  │
 └─ self_storage_customers ─┬─ customer_phones                           │
                            ├─ reservations ─────────────────────────────┤
                            ├─ contracts ────────────────────────────────┘
                            │    ├─ contract_documents
                            │    ├─ invoices ── invoice_items
                            │    │     └─ payments
                            │    ├─ access_permissions ──► doors
                            │    ├─ access_blocks
                            │    └─ temporary_accesses ── temporary_access_doors ──► doors
                            ├─ access_events (sin FKs, solo inserción)
                            ├─ incidents
                            └─ notifications
 self_storage_audit_logs (solo inserción) · self_storage_stripe_events (PK = evt_id)
 self_storage_sequences · self_storage_unit_imports ── unit_import_rows
```

**Las 21 tablas pedidas, más 5 nuevas justificadas**: `access_blocks` (§1.5),
`temporary_access_doors` (§1.6), `sequences` (§1.8) y `unit_imports` con
`unit_import_rows` (§12).

**Integridad de la jerarquía con FKs compuestas.** `(zone_id, center_id) →
zones(id, center_id)` impide que un trastero o una puerta apunte a una zona de
otro centro. `(customer_id, empresa_id) → customers(id, empresa_id)` impide
que un contrato, una factura o un pago cuelgue de un cliente de otro tenant.

**Constraints clave**:

| Garantía | Mecanismo |
|---|---|
| Dos clientes no contratan el mismo trastero | `UNIQUE (storage_unit_id) WHERE status='active'` en reservas, más `UNIQUE (storage_unit_id) WHERE status IN (pending_signature, pending_payment, active, suspended)` en contratos, más `SELECT … FOR UPDATE` del trastero en la transacción |
| Un evento de Stripe no se procesa dos veces | PK `self_storage_stripe_events.id = evt_…` más un «reclamo» con `UPDATE … WHERE status IN ('received','failed') RETURNING` |
| Un periodo no se factura dos veces | `UNIQUE (contract_id, billing_period_start)` parcial |
| La factura emitida no se toca | trigger `self_storage_invoice_freeze` |
| Totales coherentes | `CHECK (total = subtotal + tax)` en la factura y en las líneas |
| Un pago no lo marca el frontend | `CHECK`: `card`/`sepa` exigen `stripe_payment_intent_id`; `cash`/`bank_transfer` exigen `recorded_by` (un empleado) |
| Accesos temporales con usos limitados | `CHECK (uses_count <= max_uses)` más un incremento atómico `UPDATE … WHERE uses_count < max_uses RETURNING` |
| Una salida física, una puerta | `UNIQUE (device_id, output_channel)` |
| El elemento SVG vincula un único trastero | `UNIQUE (center_id, floor_plan_shape_id)` |
| Los eventos de acceso y la auditoría no se modifican | trigger que rechaza UPDATE y DELETE |
| Nunca una credencial en base de datos | `CHECK credentials_secret_name ~ '^SELF_STORAGE_[A-Z0-9_]+$'` |

**Enums.** Son tipos ENUM de PostgreSQL, con su espejo en
`src/modules/self-storage/types/enums.ts`, que el servidor también importa
para validar con zod. Hay 29 tipos en total, listados en el §1 del SQL.

**Settings** (clave → valor JSON, validado por zod; el centro sobreescribe a
la empresa):

| Clave | Por defecto |
|---|---|
| `reservation.ttl_minutes` | `15` |
| `billing.default_tax_rate` | `21` |
| `billing.invoice_series` | `"SS"` |
| `billing.due_days` | `0` (vence el día de cargo) |
| `billing.sepa_activate_on_processing` | `true` |
| `dunning.policy` | `[{"day":3,"action":"notify","template":"dunning.first"},{"day":7,"action":"notify","template":"dunning.second"},{"day":10,"action":"suspend"}]` |
| `access.rate_limit` | `{"perCustomerPerMinute":6,"perDoorPerMinute":30}` |
| `access.default_schedule` | `{}` (24 h) |
| `temporary_access.max_duration_days` | `30` |
| `public.capacity_examples` | por `size_category`: `{"S":["10 cajas de mudanza","bicicleta"],...}` |

## 5. Estados y transiciones

Todas en `domain/*State.ts`: una tabla de transiciones permitidas y una
función `transicion(actual, evento) → {nuevo, efectos[] } | error`. Una
transición no prevista devuelve 409 en lugar de saltarse un paso.

**Trastero**
```
available ──reservar──► reserved ──contrato activo──► occupied
    ▲  ▲                   │ caduca/cancela                │ contrato terminated/cancelled
    │  └───────────────────┘                               │
    └──────────────────────────────────────────────────────┘
available ⇄ maintenance / blocked   (manual; prohibido con contrato vivo)
```

**Reserva**: `active → converted` (al crear el contrato) `| expired | cancelled`.

**Contrato**
```
draft → pending_signature → pending_payment → active ⇄ suspended
  │            │                  │             │          │
  └────────────┴──────────────────┴→ cancelled  └──────────┴→ terminated
```
- `pending_payment → active`: llega `invoice.paid` o `payment_intent.succeeded`
  del primer cobro, o `processing` si es SEPA (D6), o un pago manual registrado.
  Efectos: el trastero pasa a `occupied`, se generan los permisos y el cliente
  pasa a `active`.
- `active → suspended`: lo dispara el motor de impagos (`non_payment`) o una
  acción manual (`security` / `incident` / `manual`). Efectos: se crea el
  bloqueo, los permisos pasan a `blocked` y los accesos temporales a
  `suspended`.
- `suspended → active`: **solo si no queda ningún bloqueo abierto** de ese
  contrato. Al cobrar se levantan solo los `non_payment`.
- `→ terminated`: efectos: los permisos pasan a `expired`, los temporales a
  `revoked`, el trastero a `available`, se cancela la suscripción en Stripe y
  se crea un bloqueo `contract_ended`.

**Factura**: `draft → pending → paid`; `pending → overdue → paid`;
`pending|overdue → cancelled`; `paid → refunded` (con la rectificativa).

**Pago**: `pending → processing → succeeded | failed`; `succeeded → refunded`.

**Permiso**: `enabled ⇄ blocked`; `enabled|blocked → expired` (terminal).

**Acceso temporal**: `active ⇄ suspended` (sigue al contrato);
`active → expired` (por fecha), `exhausted` (por usos) o `revoked`
(manual o fin de contrato).

**Decisión de apertura** (`domain/accessDecision.ts`, pura, devuelve el
motivo del primer fallo):

```
cliente.status = active                         else CUSTOMER_NOT_ACTIVE
AND contrato.status = active                    else CONTRACT_NOT_ACTIVE
AND permiso(contrato, puerta).status = enabled  else NO_PERMISSION
AND valid_from ≤ ahora < valid_until            else PERMISSION_OUT_OF_DATES
AND puerta.status = active AND allow_<método>   else DOOR_NOT_ALLOWED
AND sin bloqueo abierto (cliente|contrato|puerta) else BLOCKED_<MOTIVO>
AND dentro de horario (puerta ?? centro, TZ del centro) else OUTSIDE_SCHEDULE
AND dentro del límite de frecuencia             else RATE_LIMITED
→ GRANTED → orden al dispositivo → DEVICE_OK | DEVICE_TIMEOUT | DEVICE_ERROR
```
En un acceso temporal se comprueban además: el acceso está `active`, está
dentro de fechas, la puerta está en `temporary_access_doors`, queda algún uso,
**y el contrato del titular cumple todo lo anterior**.

## 6. API / endpoints

Todo con validación zod, respuestas en lista blanca y 404 (nunca 403) para
lo que no es del solicitante. Los roles: `S` superadmin, `A` admin, `E`
employee, `M` maintenance.

**Panel interno**: `/api/self-storage/admin`

| Recurso | Endpoints | Rol |
|---|---|---|
| Sesión | `GET /me` (rol, permisos, centros) | todos |
| Centros | `GET/POST /centers`, `GET/PATCH /centers/:id` | lectura: todos; escritura: A |
| Zonas | `GET/POST /centers/:id/zones`, `PATCH /zones/:id` | A |
| Trasteros | `GET /units?center&zone&status&q`, `POST /units`, `GET/PATCH /units/:id`, `POST /units/:id/status` | lectura: E; escritura: A; mantenimiento: M |
| Plano | `GET /centers/:id/floor-plan` (SVG saneado más el estado de cada forma), `PUT /centers/:id/floor-plan` (subir SVG), `PUT /units/:id/shape` | lectura: E; escritura: A |
| Importación | `POST /centers/:id/imports` (CSV) → `GET /imports/:id` (vista previa) → `POST /imports/:id/apply` | A |
| Clientes | `GET/POST /customers`, `GET/PATCH /customers/:id`, `POST/DELETE /customers/:id/phones`, `POST /customers/:id/portal-invite` | E |
| Reservas | `POST /reservations` (desde el mostrador), `DELETE /reservations/:id` | E |
| Contratos | `GET/POST /contracts`, `GET /contracts/:id`, `POST /contracts/:id/send-for-signature`, `POST /contracts/:id/sign` (presencial), `POST /contracts/:id/checkout` (enlace de pago), `PATCH /contracts/:id/price`, `POST /contracts/:id/suspend`, `POST /contracts/:id/reactivate`, `POST /contracts/:id/terminate`, `GET/POST /contracts/:id/documents` | E; precio, suspensión y terminación: A |
| Facturas | `GET /invoices`, `GET /invoices/:id`, `GET /invoices/:id/pdf` (URL firmada), `POST /invoices/:id/cancel`, `POST /invoices/:id/rectify` | lectura: E; cambios: A |
| Pagos | `GET /payments`, `POST /payments/manual` (efectivo/transferencia), `POST /payments/:id/refund` | E; reembolso: A |
| Puertas | `GET/POST /doors`, `PATCH /doors/:id`, `POST /doors/:id/open` (apertura manual con motivo obligatorio) | lectura: E; alta: A; apertura: E y M |
| Dispositivos | `GET/POST /devices`, `PATCH /devices/:id`, `POST /devices/:id/test` | A |
| Accesos | `GET /access/events`, `GET/POST /access/permissions`, `PATCH /access/permissions/:id`, `GET/POST /access/blocks`, `POST /access/blocks/:id/lift`, `GET/POST /temporary-accesses`, `POST /temporary-accesses/:id/revoke` | E; levantar bloqueos de seguridad: A |
| Incidencias | `GET/POST /incidents`, `PATCH /incidents/:id` | todos (M incluido) |
| Configuración | `GET /settings`, `PUT /settings/:key` | A |
| Dashboard | `GET /dashboard?center=` | E |
| Auditoría | `GET /audit?entity_type&entity_id` | A |

**Portal del cliente**: `/api/self-storage/portal` (guarda de cliente; el
`customer_id` sale **siempre** de la sesión, nunca del cuerpo ni de la URL)

`GET /me` · `GET /contracts` · `GET /contracts/:id` (con el trastero) ·
`GET /contracts/:id/documents/:docId` (URL firmada) · `GET /invoices` ·
`GET /invoices/:id/pdf` · `POST /invoices/:id/pay` (Checkout o
PaymentIntent; **devuelve un enlace, no marca nada**) · `GET /payment-method` ·
`POST /payment-method/setup` (sesión de configuración de Stripe) ·
`GET /doors` (las suyas) · `POST /doors/:id/open` · `GET/POST
/temporary-accesses` · `POST /temporary-accesses/:id/revoke` ·
`GET /access/events`.

**Web pública**: `/api/self-storage/public` (sin sesión, con límite de
frecuencia por IP)

`GET /centers` · `GET /centers/:code/floor-plan` (formas más
disponibilidad; ni cliente ni contrato) · `GET /centers/:code/units?size=`
(código, m², dimensiones, m³, PVP, disponibilidad, imagen 3D, ejemplos) ·
`GET /units/:id/capacity` · `POST /reservations` (devuelve el token de
reserva) · `PUT /reservations/:id/customer` (datos del cliente, con el token) ·
`GET /reservations/:id/contract-preview` (PDF) · `POST /reservations/:id/sign`
(firma simple: nombre, aceptación, IP, user-agent y hash del PDF) ·
`POST /reservations/:id/checkout` (Stripe Checkout) · `GET /reservations/:id/status`
(sondeo hasta que el webhook active el contrato) ·
`POST /temporary/:token/open` (invitado con enlace).

**Webhooks**: `POST /api/self-storage/webhooks/stripe` (cuerpo sin procesar
y firma) · `POST /api/self-storage/webhooks/voice` (firma `X-Twilio-Signature`).

## 7. Servicios Stripe

- **Cuenta y endpoint propios del módulo.** Hay un webhook distinto del de
  `/api/stripe/webhook` que ya existe, con su propio
  `STRIPE_SS_WEBHOOK_SECRET`. Todo objeto que creamos lleva
  `metadata.module = "self_storage"`, más `contract_id` y `customer_id`; el
  manejador **ignora** (estado `ignored`) lo que no lleva esa marca. Si se
  usa la misma cuenta de Stripe que Assist, cada webhook ve los eventos del
  otro módulo y los descarta.
- `integrations/stripe/client.ts`: instancia única, `apiVersion` fijada.
- `checkout.ts`:
  - `createContractCheckout(contract)`: Checkout en modo `subscription`, con
    `card` y `sepa_debit`, la renta como `price_data` (precio **desde la
    base de datos**, nunca desde el navegador), la fianza en
    `add_invoice_items`, `billing_cycle_anchor` según `billing_day` y
    `metadata`.
  - `createInvoicePaymentLink(invoice)`.
  - `createSetupSession(customer)`.
- `sync.ts`:
  - `ensureStripeCustomer`;
  - `updateSubscriptionPrice` (cambio de precio, sin prorrateo por defecto,
    auditado);
  - `cancelSubscription`.
- `webhook.ts`: un único punto de entrada.
  1. Verifica la firma con `constructEvent` (400 si no es válida).
  2. Hace `INSERT … ON CONFLICT (id) DO NOTHING` en `self_storage_stripe_events`.
  3. Reclama el evento con `UPDATE status='processing' WHERE status IN
     ('received','failed') RETURNING`; si otro proceso lo tiene, termina.
  4. Ejecuta el manejador **en una transacción**.
  5. Lo marca `processed`, o `failed` con el error saneado.
  6. Responde 200, salvo si la firma no es válida. Un `failed` lo reintenta
     el trabajo `stripeReplay`, que reprocesa desde el payload guardado, y
     Stripe también reintenta.
- **Manejadores**:

| Evento | Efecto |
|---|---|
| `invoice.finalized` | crea nuestra factura `pending` con número propio, líneas y datos congelados; el PDF se genera **después del COMMIT** |
| `invoice.paid` | factura `paid` más el pago `succeeded`; si es la primera, activa el contrato; si estaba suspendido por impago, levanta los bloqueos `non_payment` y reactiva el contrato si no quedan otros bloqueos |
| `invoice.payment_failed` | pago `failed` con `failure_reason`; la factura pasa a `overdue` y se fija `overdue_since`; notificación del día 0 |
| `payment_intent.processing` | pago `processing` (SEPA); primera activación si D6 está activo |
| `payment_intent.succeeded` / `.payment_failed` | concilia el pago (pagos sueltos del portal) |
| `customer.subscription.updated` | sincroniza el estado y el periodo; **no** cambia nuestro precio sin que nosotros lo hayamos pedido (si no cuadra, se abre una incidencia de facturación) |
| `customer.subscription.deleted` | si lo pedimos nosotros, no hace nada; si no, incidencia y aviso (§1.10) |
| `checkout.session.completed` | enlaza `stripe_subscription_id` y `stripe_customer_id` con el contrato; **no** activa nada por sí mismo |
| `charge.refunded` | pago `refunded` y, si cubre el total, factura `refunded` más rectificativa |

- **Lista blanca de eventos** que se suscriben en el panel de Stripe:
  `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`,
  `payment_intent.processing`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `checkout.session.completed` y
  `charge.refunded`.

## 8. Servicio RUT241 (control de puertas)

Revisado tras la confirmación (D7 y D8). Se programa en la fase 3.

**Modelo físico: dispositivo → salidas → puertas.**

```
self_storage_devices         (center_id, model, driver, endpoint, credentials_secret_name, status, last_seen_at)
 └─ self_storage_device_outputs (device_id, output_number, name, output_type, pulse_duration_ms, enabled)
      └─ self_storage_doors       (center_id, zone_id?, name, type, device_output_id, status, allow_app, allow_phone)
```

`UNIQUE (device_id, output_number)` en las salidas y una puerta por salida
como mucho. Un RUT241 con una salida, un módulo de relés con ocho u otro
controlador son el mismo modelo: la lógica de accesos sólo habla de puertas.

**Adaptadores de apertura** (`integrations/doors/`), uno por conectividad:

```ts
interface DoorController {
  pulse(output: OutputTarget, ms: number): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  ping(device: DeviceTarget): Promise<{ online: boolean; firmware?: string }>;
}
```

- `rms`: API de Teltonika RMS (routers detrás de CGNAT).
- `rut_http`: API HTTP de RutOS (SIM con IP fija o VPN). Enciende la salida,
  espera `pulse_duration_ms` y la apaga, siempre con `finally`.
- `relay_*`: módulos de relés u otros controladores, cuando los haya.
- `mock`: desarrollo y pruebas.

La conectividad definitiva se decide después de las pruebas con el equipo.

**Acceso telefónico por adaptador** (`integrations/phone-access/`):

| Modo | Quién decide | Para qué |
|---|---|---|
| `rut_whitelist` | el RUT241, con su lista de números autorizados | **MVP**. Es como se trabaja hoy. |
| `backend_validated` | el backend: el dispositivo avisa de la llamada y el backend decide y ordena abrir | cuando el firmware o la conectividad lo permitan |
| `twilio` | el backend, vía un número de Twilio | opcional, **no** es requisito |

Con `rut_whitelist` el RUT241 abre sin preguntar al backend. Por eso el
backend tiene que **mantener la lista al día** y saber si lo está:

- **Qué números van a la lista**: los `customer_phones` con
  `allow_door_access`, los de las personas autorizadas (`contract_members`
  con `allow_phone`) y los de los accesos temporales con teléfono. Sólo
  entran mientras su acceso efectivo está permitido: contrato activo, sin
  bloqueos activos y dentro de fechas.
- **Cuándo cambia**: alta o activación de un contrato → alta; suspensión o
  bloqueo → baja; reactivación → alta otra vez. Cada cambio de acceso
  efectivo **encola** la sincronización de los dispositivos afectados.
- **`self_storage_device_phone_sync`** (registro de sincronización): por
  dispositivo, la lista deseada (con su huella), la última aplicada con
  éxito, el intento, el resultado y el error. «Al día» significa que la
  huella deseada es igual a la aplicada. El dashboard enseña los
  dispositivos desfasados.
- **Trabajo `deviceSync`**: aplica las sincronizaciones pendientes con
  reintentos y espera creciente. Si el RUT241 no responde, la puerta sigue
  con la lista anterior y la desviación queda a la vista. Por eso un bloqueo
  por seguridad se señala como **«pendiente de aplicar en el dispositivo»**
  hasta que la sincronización se confirma.
- Una llamada que abre por la lista blanca no pasa por el backend. Si el
  dispositivo informa del evento (registro, SMS o RMS), se importa a
  `access_events` con `method = 'phone'`.

**Credenciales**: sólo en variables de entorno (`credentials_secret_name`
guarda el NOMBRE). Nunca se guardan en la base, no se escriben en los
registros y no llegan al frontend.

**Apertura desde app o panel** (`access/service.ts → openDoor`):

1. Límite de frecuencia.
2. Carga del contexto.
3. `accessDecision`, que tiene en cuenta **todos** los bloqueos activos.
4. Incremento atómico de usos si es un acceso temporal.
5. `pulse` sobre la salida de la puerta.
6. Registro **siempre** en `access_events`, con `contract_member_id` si abre
   una persona autorizada.
7. Si es una apertura de administrador, además una línea en `audit_logs`.

## 9. Seguridad y RLS

- **El servidor accede con `pg` como propietario.** RLS no le aplica, así
  que el aislamiento lo garantiza el propio servidor:
  - **el id nunca viaja solo**: toda consulta filtra por `empresa_id`, y en
    el portal por `customer_id` de la sesión;
  - **404, no 403**.
- **RLS activado en las 26 tablas** como segunda barrera:
  - `anon` no tiene nada;
  - `authenticated` (cliente) solo puede **leer** lo suyo en 12 tablas, a
    través de `self_storage_current_customer_id()` (SECURITY DEFINER);
  - nadie puede escribir por PostgREST;
  - las tablas internas tienen RLS **sin políticas**, es decir, nadie entra.

  Probado: el cliente B no ve el contrato ni el trastero del cliente A.
- **Storage**: bucket `self-storage` **privado**. Solo escribe el backend. La
  lectura es por URL firmada de 60 s después de comprobar la propiedad. Hay
  una política opcional de lectura por carpeta `{customer_id}`.
- **Secretos**: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SS_*`, `SELF_STORAGE_*`
  y `TWILIO_*` solo en el backend. Lo único que llega al frontend es
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y la clave **publicable** de
  Stripe, aunque con Checkout ni siquiera hace falta.
- **Límite de frecuencia**: apertura de puertas por cliente, puerta e IP;
  endpoints públicos (reservas: 5 por IP cada 10 min); enlace de invitado.
  Se reutiliza `server/core/rateLimit.ts`, que es infraestructura y no datos
  de clientes.
- **Validación**: zod en cada cuerpo, consulta y parámetro; DNI/NIE/CIF con
  dígito de control; teléfonos en E.164; SVG saneado (sin `<script>`, `on*`
  ni `href` externos) antes de guardarlo.
- **Auditoría** (`audit_logs`, solo inserción): alta y modificación de
  cliente (con antes y después), creación de contrato, cambio de precio,
  suspensión, desbloqueo, apertura manual, cambios de permisos, terminación,
  cambios de configuración y aplicación de una importación.
- **Pruebas de aislamiento por HTTP contra PostgreSQL real**
  (`RUN_DB_TESTS=1`): el cliente A no puede leer, pagar ni abrir nada del
  cliente B; un empleado de la empresa X no ve la Y; desde el portal no se
  alcanza ningún endpoint del panel.

## 10. Flujos principales

**A. Alta en el mostrador (criterio de éxito del MVP)**
1. Se crea el cliente (`inactive`) → auditoría `customer.created`.
2. Se crea el contrato `draft` sobre un trastero `available`. En una
   transacción: `FOR UPDATE` del trastero, comprobación de que no hay reserva
   ajena activa e `INSERT`. El precio se copia del trastero.
3. Pasa a `pending_signature`: se genera el PDF del contrato
   (`contract_documents`). La firma es presencial o se envía un enlace.
4. Firma → `pending_payment` → enlace de Stripe Checkout (por email o QR en
   el mostrador).
5. Webhook `invoice.finalized` → nuestra factura `pending` → `invoice.paid` →
   factura `paid` y pago `succeeded` → contrato `active` → trastero
   `occupied` → permisos: **puerta principal más la puerta de su zona** →
   cliente `active` → invitación al portal.
6. El cliente abre la puerta desde el portal → `accessDecision` → RUT241 →
   evento `granted`.
7. Falla el cobro del mes siguiente → día 0 `overdue` → día 3 y día 7 avisos
   (`notifications` con `dedupe_key`) → día 10 bloqueo `non_payment` →
   contrato `suspended`, permisos `blocked`, temporales `suspended` → intento
   de apertura `denied / BLOCKED_NON_PAYMENT`.
8. El cliente paga desde el portal → `invoice.paid` → se levanta el bloqueo
   `non_payment` → contrato `active`, permisos `enabled`, temporales
   `active` → puede abrir de nuevo.

**B. Contratación online**

Elegir centro → elegir tamaño o trastero (plano o lista) → **reserva
temporal** (15 min, protegida por el índice único) → datos (cliente
`inactive`, deduplicado por `tax_id`) → revisión del contrato (PDF) → firma
simple → Checkout → retorno a la página de espera, que consulta el estado →
webhook → activación (igual que A.5) → se crea la cuenta del portal con un
enlace mágico de Supabase y queda vinculada a `auth_user_id` → portal.

Si la reserva caduca antes de pagar, la sesión de Checkout se marca como
caducada y el trastero se libera. Si el pago llega tarde, sobre una reserva ya
caducada pero con el trastero aún libre, se reintenta la ocupación; si ya
está ocupado, se hace el reembolso automático y se abre una incidencia. **Los
dos casos tienen prueba.**

**C. Acceso temporal**

El cliente (portal) o un empleado lo crea: invitado, teléfono, desde y hasta
(horas o días), puertas (solo de entre las permitidas al titular) y número
máximo de usos (uno, varios o sin límite). Se envía el enlace por
SMS/WhatsApp. Cada apertura consume un uso de forma atómica. Si caduca, o si
el contrato se suspende o termina, el acceso cambia de estado y queda
auditado.

## 11. Pantallas

**Todas las pantallas son responsive**: la lista pasa a tarjetas en móvil y el
plano admite zoom y desplazamiento táctil.

- **Dashboard**:
  - total de trasteros, disponibles, ocupados, reservados y ocupación %;
  - facturación mensual (facturas emitidas en el mes) y pendiente de cobro;
  - impagos (número e importe);
  - accesos de hoy (concedidos y denegados);
  - estado de las puertas y los dispositivos (online/offline, último latido).
- **Clientes**: lista y ficha (datos, teléfonos, contratos, facturas, accesos
  y auditoría).
- **Trasteros**: lista con filtros, ficha e importación.
- **Plano interactivo**:
  - el SVG del centro, con cada forma coloreada por `floor_plan_shape_id`:
    verde disponible, rojo ocupado, naranja reservado, gris mantenimiento o
    bloqueado;
  - en el **panel**, al pulsar una forma se ve: código, m², dimensiones,
    precio, estado, cliente, contrato, estado de pagos y zona;
  - en la **web pública**: código, m², dimensiones, precio, disponibilidad,
    imagen 3D y «Alquilar»;
  - el contenido de cada vista lo decide la **API**, no el componente, así
    que la versión pública no recibe nunca los datos privados.
- **Contratos**: lista, ficha (estado, documentos, acciones) y asistente de
  alta.
- **Facturas** y **Pagos**: lista, ficha, PDF y registro de pago manual.
- **Accesos**: registro de eventos con filtros, permisos, bloqueos y accesos
  temporales.
- **Puertas** y dispositivos: alta, prueba y apertura manual.
- **Incidencias**.
- **Configuración**: impagos, IVA, reservas, horarios, ejemplos de capacidad
  y series.
- **Portal del cliente**: mi trastero, contrato, facturas (PDF y pago),
  método de pago, puertas (botón grande de abrir), accesos temporales.
- **Web pública**: centros, tamaños, plano, «Ver capacidad» (imagen 3D,
  dimensiones, m², m³, precio y ejemplos desde la configuración) y el
  asistente de contratación.

## 12. Importación de trasteros (CSV / Reus)

Revisado con la corrección del IVA (§17).

**Formato recomendado** (separador `,`, `;` o tabulador; decimal `,` o `.`):

```
codigo,tipo,numero,largo_cm,ancho_cm,alto_cm,m2,m3,precio_base,cuota_iva,pvp
Taquilla 113,taquilla,113,100,100,100,1.0,1.0,20.66,4.34,25.0
```

- `codigo` identifica el trastero en el centro. `numero`, si viene junto a
  `codigo`, es su nombre visible; sin `codigo`, `numero` es el identificador
  (formato antiguo).
- `tipo` es el código del tipo de trastero. Con «Crear los tipos que no
  existan» (marcado por defecto), un tipo nuevo se crea al aplicar, con las
  medidas del primer trastero de ese tipo.
- Medidas con sufijo `_cm` o `_m` se leen en esa unidad. Sin sufijo, un valor
  menor de 20 se entiende en metros.
- **`cuota_iva` es el IMPORTE del IVA en euros**, no el porcentaje. La regla
  es `precio_base + cuota_iva = pvp` con 0,01 € de tolerancia; si no cuadra,
  la fila es un error.
- Con dos de los tres importes, el tercero sale de los otros dos. Con sólo
  base o sólo PVP, se completa con el **IVA general** de la empresa.
- El **tipo de IVA no viene del fichero ni se deduce de él**: es el IVA
  general configurado. Si una cuota no corresponde al IVA general sobre la
  base, se avisa (no es un error).
- **Compatibilidad**: la columna antigua `iva` se acepta como **alias
  deprecado de `cuota_iva`** (se avisa en la vista previa). Una columna con
  un porcentaje de IVA (`tipo_iva`, `iva %`, `tax_rate`…) se rechaza con un
  mensaje claro.
- **Zona**: columna `zona` o «Zona para los nuevos» en la pantalla; si el
  centro sólo tiene una zona, se usa esa.

**Reglas que no cambian** (`domain/importUnits.ts`, pura y probada):

- sin m² o m³, se calculan a partir de las medidas; si vienen y difieren más
  de un 5 % del cálculo, se avisa;
- un código que ya existe se **actualiza** (medidas y precio) pero **nunca**
  se cambia su estado ni el precio de los contratos: el del contrato está
  congelado;
- tres pasos: subir, vista previa con errores y avisos por fila, y aplicar en
  una transacción con auditoría. Importar dos veces el mismo fichero no
  duplica nada.

## 13. Tareas programadas

Se ejecutan en el proceso, con un cerrojo `pg_try_advisory_lock` para que dos
instancias no las repitan. Con el plan gratuito de Render no se ejecutan
(D2).

| Tarea | Frecuencia | Qué hace |
|---|---|---|
| `expireReservations` | 1 min | reservas caducadas → `expired`; trastero → `available` si no hay contrato |
| `expireAccesses` | 5 min | temporales fuera de fecha → `expired`; permisos con `valid_until` pasado → `expired` |
| `dunning` | cada hora | ejecuta la política de `dunning.policy` de forma idempotente |
| `deviceHeartbeat` | 2 min | `ping` a cada dispositivo → `status` y `last_seen_at` |
| `notificationsOutbox` | 1 min | envía las notificaciones pendientes (email/SMS/WhatsApp) con reintentos |
| `stripeReplay` | 5 min | reprocesa los eventos `failed`, con un máximo de intentos |

**Las caducidades además se comprueban en el momento**:
`accessDecision` mira las fechas en cada apertura y la reserva caduca de forma
perezosa. La tarea solo pone orden en los estados.

## 14. Plan por fases

| Fase | Contenido | Hecha cuando… |
|---|---|---|
| **1** | esquema y RLS; auth de empleados y clientes; clientes; centros; zonas; trasteros; plano SVG; importación CSV; auditoría; configuración | se importa Reus, se ve el plano coloreado, se da de alta un cliente y todo queda auditado; pruebas de dominio y de aislamiento en verde |
| **2** | contratos y documentos PDF; reservas; facturación y PDF; Stripe (Checkout, webhook, idempotencia); pagos manuales; motor de impagos (solo estados y avisos) | un contrato se cobra en modo prueba de Stripe, se genera la factura con PDF, un evento repetido no se procesa dos veces y un impago lleva la factura a `overdue` |
| **3** | puertas; dispositivos; `AccessDeviceAdapter` (mock, RUT241 por HTTP directo/VPN, RMS preparado); permisos; bloqueos; accesos temporales; llamada a la lista blanca del RUT241 (sin Twilio); límite de frecuencia; suspensión y restauración automáticas (§18) | con hardware real: abre la puerta autorizada, deniega la de otra zona, bloquea al suspender y restaura al pagar |
| **4** | portal del cliente; web pública con «Ver capacidad»; contratación online de principio a fin; cuenta del cliente con enlace mágico | el flujo B completo en modo prueba |

**Criterio de éxito del MVP**: el flujo A completo es una prueba de
integración automatizada (`flujoMvp.integration.test.ts`) con Stripe simulado
por eventos firmados y `mockController`. Además se hace una vez a mano con
Stripe en modo prueba y el RUT241 real.

## 15. Fase 1: lo que está hecho

**Integración en Mobilink**:

- Módulo `self-storage` en `MODULOS_SAAS` y licenciable.
- Roles en el catálogo de usuarios: `admin`, `employee` y `maintenance`; el
  `superadmin` sale de `es_superadmin`.
- Entrada en el hub de Inicio, en los accesos de cabecera y en la pestaña
  del navegador.
- Rutas `/self-storage/*`.

**Backend** (`server/self-storage/`, en el `include` de `tsconfig.server.json`):

- API `/api/self-storage/admin/*` con
  `authenticate → requireModule → cargarPermisos`.
- Validación con zod (objetos estrictos: un campo inesperado es un 422).
- Errores de PostgreSQL traducidos a mensajes y códigos estables.
- Auditoría en la misma transacción que el cambio.

**Base de datos** (`supabase/migrations/self_storage/0001…0004`):

- 14 tablas.
- Enums.
- FKs compuestas con `empresa_id`.
- Índices únicos parciales contra la doble reserva y el doble contrato.
- Triggers: `updated_at`, tipo del mismo centro, y sólo inserción en la
  auditoría y en las versiones del plano.
- RLS, que fuera de Supabase se activa sin políticas.

**Diferencias con el borrador de diseño**:

- **Plano en `self_storage_floor_plans`** (SVG saneado y versionado en la
  base) en lugar de en Storage: pesa poco, se versiona y se prueba sin
  Supabase.
- **`monthly_price_gross` guardado y no calculado**, con un CHECK que lo ata a
  base + IVA con un céntimo de margen. Así se guarda el PVP redondo publicado.
- **Clientes creados desde el panel nacen `active`**. Los de la web (fase 4)
  nacerán `inactive` hasta activar su primer contrato.
- **`reservations`, `contracts` y `contract_members` ya existen** como
  modelo, para que la base garantice la exclusión desde el primer día, pero
  **no tienen endpoints**: su lógica es de la fase 2.

**Pantallas**:

- Dashboard de ocupación.
- Plano interactivo con vínculo de formas.
- Trasteros.
- Clientes y su ficha, con teléfonos y bloqueo con motivo.
- Centros y zonas.
- Tipos de trastero.
- Importar CSV.

Contratos, facturas, pagos, accesos, puertas, incidencias y configuración
aparecían en el menú con su fase (los de la fase 2 ya están: ver §16).

**Pruebas**:

- Unitarias de dominio.
- Aislamiento del módulo por código.
- Integración por HTTP contra PostgreSQL (`selfStorage.integration.test.ts`).
- RLS entre clientes con roles y `auth.uid()` equivalentes a los de
  Supabase (`rls.integration.test.ts`).

## 16. Fase 2: contratos, facturación, pagos y Stripe

Alcance cerrado: contratos con documento y aceptación, catálogo de conceptos,
facturas propias con numeración, pagos, Stripe (Checkout, suscripción y
webhook), impagos y bloqueos, notificaciones y la parte financiera del portal.
**Sin** RUT241, puertas, RMS, VPN ni listas de teléfonos: los bloqueos se
guardan y la fase 3 los convertirá en puertas cerradas.

### 16.1 Base de datos (`0005…0007`)

- `0005_fase2_tipos_y_contratos.sql`
  - Enums de factura, concepto, pago, cobro, evento de Stripe, documento,
    impago y notificación.
  - Motivos de bloqueo renombrados a `payment` y `terminated`.
  - Columnas nuevas del contrato: precio de tarifa y pactado, PVP, IVA de la
    fianza, periodicidad, forma de pago, datos de firma, suscripción,
    política del primer SEPA, activación por excepción y próxima factura.
  - CHECKs `NOT VALID`: valen para toda escritura nueva sin revalidar filas
    anteriores.
- `0006_fase2_tablas.sql`: `billing_items`, `contract_items`,
  `contract_documents`, `sequences`, `invoices`, `invoice_items`, `payments`,
  `stripe_events`, `access_blocks`, `dunning_cases` y `notifications`.
  - **Una factura de alquiler por contrato y periodo**: índice único parcial,
    salvo las anuladas.
  - **Un pago por factura de Stripe**: índice único sobre `stripe_invoice_id`.
  - **Un bloqueo abierto por motivo** y contrato.
  - **Un caso de impago abierto por factura**.
  - **Triggers de inmutabilidad**:
    - documento firmado: no se toca ni se borra;
    - factura emitida: no se borra, no vuelve a borrador y no cambia número,
      importes ni instantáneas;
    - líneas de una factura emitida: no cambian;
    - eventos de Stripe: el contenido no cambia.
- `0007_fase2_rls.sql`: RLS en todas las tablas nuevas. El cliente sólo lee
  sus contratos, documentos, facturas (nunca borradores), líneas, pagos y
  bloqueos.

### 16.2 API

**Panel** (`/api/self-storage/admin`, permisos `ss.contracts.*`,
`ss.billing.*`, `ss.settings.manage`):

| Recurso | Endpoints |
|---|---|
| Contratos | `GET/POST /contracts`, `GET/PATCH /contracts/:id` (editar sólo en borrador), `GET …/history`, `POST …/issue`, `…/sign` (firma en presencia), `…/checkout` (primer cobro Stripe), `…/activate` (excepción, admin), `…/suspend`, `…/blocks/:blockId/lift`, `…/terminate` (admin), `…/cancel`, `…/annexes` (admin), `GET …/documents/:docId/pdf` |
| Facturas | `GET/POST /invoices` (borrador manual desde el catálogo), `GET /invoices/:id`, `POST …/issue`, `DELETE` (sólo borrador), `POST …/rectify` (admin), `…/pay-link`, `GET …/pdf` |
| Pagos | `GET /payments`, `POST /payments/manual` (transferencia y efectivo; nunca tarjeta ni SEPA) |
| Cliente | `GET /customers/:id/billing` (deuda, facturas y pagos), `GET /customers/:id/payment-methods`, `POST /customers/:id/portal-invite` |
| Impagos | `GET /dunning` |
| Catálogo | `GET/POST /billing-items`, `PATCH /billing-items/:id` |
| Configuración | `GET /settings`, `PUT /settings/:key` (auditado), `POST /jobs/:name/run` |

**Portal** (`/api/self-storage/portal`): la sesión de Supabase tiene que ser
la `auth_user_id` de un cliente; si no, `403 SIN_ACCESO`. Todo filtra por ese
cliente, y lo ajeno contesta 404.

- `GET /me` (con la deuda).
- `GET /contracts`, `GET /contracts/:id` (sin notas internas ni datos de
  Stripe), su PDF, `POST …/accept` y `…/checkout`.
- `GET /invoices`, su PDF y `POST …/pay`.
- `GET /payments`.
- `GET /payment-methods` y `POST /payment-methods/setup`.

**Webhook**: `POST /api/self-storage/webhooks/stripe`, con cuerpo crudo y
firma verificada con `SELF_STORAGE_STRIPE_WEBHOOK_SECRET`.

### 16.3 Stripe

Dos piezas: `pasarela.ts` (interfaz `PasarelaStripe` + implementación con el
SDK, sustituible en las pruebas) y `servicios.ts` (Customer, métodos de pago,
Checkout de pago y de alta de método).

- **Cuota recurrente = Subscription creada con Checkout** en modo
  suscripción.
  - Productos por contrato con el PVP firmado, sin recalcular desde la base.
  - `billing_cycle_anchor` en el día de facturación.
  - Método limitado al elegido: tarjeta o `sepa_debit`.
  - Mapa `stripe_products` (producto → concepto e IVA) para desglosar cada
    cobro en nuestras líneas.
- **Facturas de Stripe → facturas nuestras**: cada `invoice.paid` o
  `invoice.payment_failed` se refleja como factura propia con nuestra
  numeración y las instantáneas. El importe de Stripe (IVA incluido) se
  desglosa por línea para que base + cuota = cargo.
- **Pagos sueltos** (factura manual pendiente): Checkout en modo pago
  (PaymentIntent) con el id de nuestra factura en los metadatos.
- **Nunca se marca un pago desde el navegador.** Volver de Stripe sólo
  enseña un aviso; lo confirma el webhook.

### 16.4 Webhooks: idempotencia

1. Se verifica la firma.
2. Se inserta en `self_storage_stripe_events` (PK `event_id`,
   `ON CONFLICT DO NOTHING`).
3. En UNA transacción: `SELECT … FOR UPDATE` del evento. Si ya está
   `processed` o `ignored`, no se hace nada; si no, se ejecuta el manejador y
   se marca `processed`.
4. Si falla: `failed` con `error_message`, y 500 para que Stripe reintente.
   El trabajo `stripe_reintentos` también los reprocesa.

Los eventos de otros módulos de Mobilink (sin metadatos `ss_*`) quedan como
`ignored`.

Eventos tratados:

| Evento | Qué hace |
|---|---|
| `checkout.session.completed` | Primer cobro, pago de factura o alta de método |
| `invoice.paid` | Factura pagada |
| `invoice.payment_failed` | Factura fallida e impago |
| `payment_intent.succeeded` / `payment_intent.payment_failed` | Pago suelto |
| `customer.subscription.updated` | Sólo refleja el estado; **nunca cambia el contrato** |
| `customer.subscription.deleted` | Si no la canceló el propio módulo, auditoría y aviso al personal; **el contrato no se finaliza solo** |
| `charge.refunded` | Total: factura reembolsada + rectificativa. Parcial: se anota |

### 16.5 Reglas de negocio

**Contrato**:

- `draft → pending_signature` al emitir: genera el PDF v1 y reserva el
  trastero.
- `→ pending_payment` al firmar: el documento queda `final` e inmutable. Si
  el cobro es manual, se emite la primera factura.
- `→ active` con el primer cobro confirmado: trastero ocupado.
- `active ⇄ suspended` por bloqueos.
- `→ terminated` al finalizar: trastero libre, bloqueo `terminated` y
  suscripción cancelada después del COMMIT.
- `cancelled` antes de activarse: las facturas sin cobrar se anulan con
  rectificativa.

**Precio**:

- Se copia al crear: tarifa y precio pactado.
- Cambiar el del trastero no toca el contrato.
- La cuota se factura desde el **PVP firmado**: 55 € con IVA son 55 €, no
  54,99 por redondear la base.

**Aceptación simple**: se guardan fecha, quién (empleado en presencia o el
propio cliente), IP, navegador, SHA-256 del PDF y versión de las condiciones.
Un cambio importante se hace con un **anexo**, que es otro documento con su
propia firma.

**Primer SEPA**:

- `wait_for_success` (por defecto): con el recibo en `processing`, el
  contrato sigue `pending_payment`.
- `allow_while_processing`: se activa ya. Si después falla, abre un impago.
- A un cliente ya activo, un recibo en `processing` no lo bloquea nunca.
  Sólo un fallo real abre impago.

**Impagos** (plazos por defecto: 3, 7 y 10 días, configurables):

1. Factura fallida o vencida → caso de impago.
2. Primer aviso y segundo aviso.
3. Bloqueo `payment` y contrato `suspended`.

Cobrar cierra el caso y levanta **sólo** el bloqueo `payment`. El contrato
vuelve a `active` únicamente si no queda otro bloqueo abierto.

**Bloqueos** (`payment`, `security`, `incident`, `manual`, `terminated`):

- Pueden convivir varios.
- `payment` no se levanta a mano.
- `security` sólo lo levanta un administrador.
- Ni `security` ni `manual` se levantan nunca solos.

**Numeración**:

- Por empresa, serie y año: `F-2026-000001`, `R-…` para rectificativas y
  `C-…` para contratos.
- `INSERT … ON CONFLICT DO UPDATE … RETURNING` sobre
  `self_storage_sequences`: sin huecos por concurrencia y sin dos iguales.
- El borrador no tiene número; se numera al emitir.

**IVA**: vive en el catálogo de conceptos (con motivo de exención). El panel
no conoce ningún tipo impositivo.

**Notificaciones**: tabla de salida `self_storage_notifications` con
`dedupe_key`, enviada por el SMTP común (`server/mail.ts`). Plantillas:

- contrato generado y contrato aceptado;
- factura emitida y factura vencida;
- pago correcto y pago fallido;
- avisos de impago, suspensión y suscripción cancelada fuera.

**Trabajos** (cada 5 minutos, con candado por trabajo; `SELF_STORAGE_JOBS=0`
los apaga):

- facturar periodos de cobro manual;
- marcar vencidas;
- avanzar impagos;
- enviar notificaciones;
- reintentar eventos de Stripe.

### 16.6 Pantallas

**Panel**:

- **Contratos** y su ficha:
  - acciones según el estado (las da el servidor);
  - documentos con huella y aceptación;
  - facturas, bloqueos e historial.
- **Facturas**: lista, ficha, factura manual, emitir, rectificar, PDF,
  enlace de pago y registrar transferencia o efectivo.
- **Pagos**.
- **Impagos**.
- **Conceptos facturables**.
- **Configuración**: emisor, series, vencimiento, plazos de impago, política
  SEPA, condiciones e IVA del alquiler, y ejecución manual de los trabajos.

**Además**:

- Ficha del cliente: deuda, facturas, pagos, método de Stripe e invitación
  al portal.
- Ficha del trastero en el plano: contrato, precio contratado y estado de
  cobros.
- Dashboard: facturado este mes, pendiente e impagos, sólo para quien ve la
  facturación.

**Portal del cliente** (`/trasteros/portal`):

- Entrada con enlace por email, sólo para clientes invitados
  (`shouldCreateUser: false`).
- Contratos: ver, aceptar y descargar.
- Facturas: descargar y pagar.
- Pagos.
- Método de pago: ver y cambiar con Checkout en modo setup.
- Sin puertas.

### 16.7 Pruebas

- `domain/fase2.test.ts`: estados, prorrateo, PVP exacto, desglose,
  decisiones de cobro, impagos y bloqueos.
- `fase2.integration.test.ts`: HTTP contra PostgreSQL, con la pasarela de
  Stripe simulada y webhooks **firmados de verdad**. Cubre todas las pruebas
  obligatorias:
  - factura doble del mismo periodo;
  - numeración concurrente;
  - webhook repetido y pago repetido;
  - A no ve lo de B;
  - la factura no cambia si cambia el cliente;
  - el precio del trastero no cambia el contrato;
  - SEPA `processing` no es un fallo, y el primer SEPA no activa por defecto;
  - el pago sólo levanta el bloqueo `payment`;
  - la suscripción cancelada no finaliza el contrato.
- `rls.integration.test.ts` ampliado a facturas y pagos.

### 16.8 Puesta en marcha

1. En Stripe, crear un endpoint de webhook a
   `https://<app>/api/self-storage/webhooks/stripe`.
   - Eventos: `checkout.session.completed`, `invoice.paid`,
     `invoice.payment_failed`, `payment_intent.succeeded`,
     `payment_intent.payment_failed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `charge.refunded`.
   - Poner su secreto en `SELF_STORAGE_STRIPE_WEBHOOK_SECRET`.
2. Activar SEPA Direct Debit en la cuenta de Stripe.
3. En Supabase Auth, añadir `https://<app>/trasteros/portal` a las URLs de
   redirección permitidas, para que lleguen el enlace de invitación y el del
   login.
4. En Configuración del módulo, rellenar el **emisor**. Sin él no se emite
   ningún contrato ni factura.
5. Revisar con la asesoría el IVA de los conceptos (fianza, seguro y
   penalización vienen como no sujetos o exentos) y el texto de las
   condiciones.

## 17. IVA: tipo (porcentaje) frente a cuota (euros)

Corrección hecha antes de la fase 3. En el CSV de Reus la columna `iva` era
la **cuota** en euros (4,34), y el importador la leía como **porcentaje**
(4,34 %).

**Vocabulario**:

| Concepto | Qué es | Dónde |
|---|---|---|
| tipo de IVA (`vat_rate`) | porcentaje: 21,00, 10,00, 4,00, 0,00 | columnas `tax_rate` de trasteros, contratos, conceptos y líneas; ajuste `default_vat_rate` |
| cuota de IVA (`vat_amount`, `cuota_iva`) | importe en euros: 4,34 | `self_storage_units.vat_amount`; `tax_amount` de las líneas y `tax` de las facturas |

**Reglas**:

- **IVA general por empresa**: ajuste `default_vat_rate` (21,00 por defecto),
  en Configuración → IVA general. No hay ningún tipo escrito en el código.
  Sustituye a `units.default_rental_tax_rate` (la migración copia su valor).
- **Trastero**: guarda su precio comercial como base + cuota + PVP (CHECK
  `base + cuota = PVP ± 0,01`). Su `tax_rate` es informativo: el IVA general
  cuando se fijó el precio.
- **Contrato**: al crearlo se copia el tipo vigente del concepto de alquiler
  (hereda el IVA general salvo que tenga uno propio) y se parte de la BASE del
  trastero. Es una fotografía fiscal: cambiar después la configuración no lo
  toca, y sus facturas futuras siguen con ese tipo mientras no haya una
  actualización fiscal específica.
- **Facturas**: cada línea guarda su `tax_rate` y su `tax_amount`, copiados
  del contrato o del concepto al generarla. Una emitida es inmutable.
- **Conceptos**: política `inherit_default` (usa el IVA general) o `custom`
  (su tipo propio, con motivo si es 0 %). De partida heredan alquiler,
  candado, alta, descuento y otros; fianza, seguro y penalización tienen tipo
  propio 0 % (revisar con la asesoría).

**Migración `0008_iva_tipo_y_cuota.sql`**:

1. Crea `default_vat_rate` por empresa desde el ajuste antiguo.
2. Añade `self_storage_units.vat_amount` (= PVP − base en lo existente; un
   trigger la rellena si se inserta sin ella) y cambia el CHECK del PVP por
   `base + cuota = PVP`.
3. **Corrige los datos mal importados** sin perder nada. Un trastero cuyo
   `tax_rate` es justo la cuota del IVA general sobre la base, y cuyo PVP
   salió de tratarla como porcentaje, pasa a: cuota = ese valor, tipo = IVA
   general y PVP = base + cuota. Deja `unit.vat_fixed` en la auditoría con los
   valores anteriores. Es idempotente y se comprueba en cada arranque.
4. Añade `vat_policy` a los conceptos. Los de partida que llevaban el IVA
   general pasan a heredarlo (su `tax_rate` se conserva).

Contratos y facturas **no** se tocan: son fotografías fiscales.


## 18. Fase 3: accesos físicos, puertas, dispositivos y RUT241

**Regla de oro: quién puede entrar lo decide Mobilink; el dispositivo sólo
ejecuta.** El derecho de acceso (contrato, permisos, bloqueos) está separado
del mecanismo físico (dispositivo → salida → puerta). Cambiar de RUT241 a
otro Teltonika, a un módulo de relés o a otro controlador no toca ninguna
regla de negocio: se cambia el adapter.

### Modelo (migración `0009_fase3_accesos.sql`)

| Tabla | Para qué |
|---|---|
| `self_storage_devices` | equipo físico por centro: fabricante, modelo, serie, IMEI, SIM, `connection_type` (`mock` / `direct_http` / `vpn_http` / `rms`), `endpoint`, `credentials_secret_name` (el **nombre** de una variable de entorno, nunca el secreto), `driver_options` (no secretas), `phone_access_mode` (`none` / `rut_whitelist`), `status`, `last_seen_at`, `last_error` |
| `self_storage_device_outputs` | salidas del equipo (número, tipo, duración del pulso 100–30 000 ms). Una puerta apunta a UNA salida (`unique`) |
| `self_storage_doors` | `center_id`, `zone_id` (nulo salvo `zone`), `door_type` (`main`/`zone`/`internal`/`other`), `device_output_id`, `enabled`, `allow_app`, `allow_phone`, `access_schedule` |
| `self_storage_contract_members` | + `auth_user_id`: la persona autorizada entra al portal con su cuenta y abre con SU identidad |
| `self_storage_access_permissions` | permisos `contract` (generados) y `manual`. **No son la fuente de verdad**: el motor vuelve a comprobar contrato, bloqueos y zona en cada intento |
| `self_storage_temporary_accesses` (+ `_doors`) | fechas, usos (1, N o sin límite), puertas concretas, teléfono, titular/invitado, enlace (sólo se guarda el **sha256** del token) |
| `self_storage_access_events` | registro **append-only** (trigger): centro, puerta, dispositivo, salida, contrato, cliente, miembro, temporal, personal, método, `requested_at`, decisión, motivo, `execution_status`, `executed_at`, `latency_ms`, `device_response` saneada. Sólo se permite UNA transición `pending → succeeded/failed/timeout` |
| `self_storage_device_syncs` | estado deseado y real de la lista de teléfonos por dispositivo, con huella, `status` (`pending`/`synced`/`failed`), intentos, `last_attempt_at`, `last_success_at`, `next_attempt_at`, error |

RLS: el cliente ve sus eventos, permisos y temporales; dispositivos, puertas
y sincronizaciones sólo por el backend (service role).

### Motor único: `evaluateAccess` (`domain/accesos.ts`)

Función pura `evaluateAccess(puerta, actor, instante, método)` →
`{ granted, reason, contractId }`. La usan TODOS los caminos: app del
titular, app de la persona autorizada, enlace temporal, apertura
administrativa, el cálculo de la lista de teléfonos y la ficha del contrato.
No hay reglas duplicadas.

Orden de comprobación: puerta habilitada → método permitido en la puerta →
persona (cliente activo, miembro activo con app/teléfono, temporal vigente
con usos) → contratos y bloqueos (prioridad seguridad > finalizado > manual >
incidencia > impago) → estado del contrato → permiso → puerta derivada (zona
del trastero) → horario (no aplica al personal) → dispositivo en línea.

Motivos: `GRANTED`, `CONTRACT_NOT_ACTIVE`, `CONTRACT_TERMINATED`,
`PAYMENT_BLOCK`, `SECURITY_BLOCK`, `MANUAL_BLOCK`, `INCIDENT_BLOCK`,
`DOOR_NOT_ALLOWED`, `OUTSIDE_SCHEDULE`, `TEMPORARY_ACCESS_EXPIRED`,
`TEMPORARY_ACCESS_EXHAUSTED`, `DEVICE_OFFLINE`, `DEVICE_NOT_CONFIGURED`,
`RATE_LIMITED`, `PERMISSION_EXPIRED`… (lista completa con etiquetas en
`types/enums.ts`).

Contrato de la zona 2 → puerta principal + puerta de la zona 2. No abre la
zona 1 aunque alguien cree un permiso a mano por error: la puerta derivada
se recalcula siempre.

### Apertura (`modules/accesos/apertura.ts`)

`POST /api/self-storage/portal/access/open {doorId}` — la identidad sale de
la sesión (titular o persona autorizada), **nunca del cuerpo**.

1. La puerta tiene que ser de la empresa (si no, 404).
2. Límite de frecuencia: `access.rate_limit_per_minute` por persona
   (Configuración, 6 por defecto) y 30/min por IP. El intento limitado
   también queda registrado (`RATE_LIMITED`, HTTP 429).
3. Si el equipo figura offline se le pregunta en el momento (latido de 4 s).
4. En UNA transacción: evaluar → insertar el evento (`pending` o
   `not_attempted`) → consumir el uso del temporal (con `FOR UPDATE`) →
   auditoría `door.opened_by_admin` si es administrativa.
5. Fuera de la transacción: `activateOutput` con 12 s de tope → el evento
   pasa a `succeeded` / `failed` / `timeout` con la respuesta saneada
   (código, HTTP, mensaje; nunca tokens ni credenciales).
6. Sin confirmación del equipo **no hay «abierto»** (sin falsos positivos).
   Si no se abrió, el temporal recupera su uso.

Apertura administrativa: `POST /api/self-storage/admin/doors/:id/open
{reason?}` (permiso `ss.access.open`), mismo camino con método `admin`.

### Adapters (`integrations/access-devices/`)

```ts
interface AccessDeviceAdapter {
  testConnection(d): Promise<ResultadoConexion>;
  getStatus(d): Promise<{ online; latencyMs }>;
  activateOutput(d, salida): Promise<ResultadoSalida>;
  syncAuthorizedPhones(d, phones): Promise<{ ok; applied; code?; message? }>;
  getAuthorizedPhones(d): Promise<string[]>;
}
```

| Adapter | `connection_type` | Estado |
|---|---|---|
| `MockAccessDeviceAdapter` | `mock` | completo; simulador por dispositivo (`simulation`): online/offline, apertura ok/timeout/salida que falla, sincronización ok/fallo |
| `Rut241Adapter` | `direct_http`, `vpn_http` | apertura completa sobre la API REST de RutOS; teléfonos sólo si se configura `phoneGroupPath` (ver abajo) |
| `RmsAdapter` | `rms` | preparado (devuelve `NOT_SUPPORTED`) |

El dominio no sabe cómo se llega al equipo: `adapterDe(dispositivo)` elige
por `connection_type`.

### Protocolo con el RUT241 (lo confirmado y lo que no)

El contenedor de desarrollo no llega a la documentación de Teltonika, así
que lo de abajo sale de la documentación pública consultada indirectamente y
**se tiene que verificar con el equipo real antes de producción**.

Confirmado:

- El RUT241 tiene **1 entrada digital y 1 salida digital de colector
  abierto** (30 V / 300 mA). Para una cerradura hace falta un **relé
  externo** (o un módulo de relés).
- API REST de RutOS (≥ 7.x): `POST /api/login {username,password}` →
  token Bearer (~5 min). Se renueva antes de caducar y, ante un 401, se
  vuelve a iniciar sesión una vez.
- Salida: `POST /api/io/dout1/actions/change_state {"data":{"value":"1"}}`.
  Desde RutOS 7.18 admite duración (pulso nativo). Para firmware anterior,
  `driver_options.pulseMode = "on_off"`: enciende, espera y **siempre**
  apaga (`finally`).
- La interfaz CGI antigua desapareció en RutOS 7.14: no se usa.
- «Call utilities» puede accionar una salida al recibir una llamada de un
  número de un grupo de teléfonos, sin descolgar y sin Twilio.

**Sin confirmar** (y por eso desactivado por defecto):

- La ruta exacta de la API para leer/escribir el **grupo de teléfonos** de
  Call utilities. El adapter la toma de `driver_options.phoneGroupPath` y
  `phoneGroupField`. Mientras no se configure, la sincronización queda
  `failed` con `NOT_SUPPORTED` y lo dice en el panel: nunca se escribe a
  medias.
- El nombre exacto del campo de duración del pulso nativo
  (`driver_options.pulseTimeField`, `pulseTimeUnit`).

Transporte y credenciales:

- Variable de entorno con el **nombre** guardado en el dispositivo
  (`^[A-Z][A-Z0-9_]{2,80}$`), con JSON
  `{"username":"…","password":"…","ca":"-----BEGIN CERTIFICATE-----…"}`.
  El valor nunca llega a la base, al log ni al navegador.
- `ca`: el certificado autofirmado del router se **fija** (pinning).
- Por Internet sólo `https` con certificado verificado; `http` en claro o
  `tlsInsecure` sólo se aceptan contra direcciones privadas (VPN/LAN).
- `vpn_http` exige una dirección privada (10/8, 172.16/12, 192.168/16,
  100.64/10 de CGNAT/Tailscale).

### Sincronización de teléfonos (`rut_whitelist`)

El backend calcula la lista; el equipo sólo la aplica.

- **Estado deseado calculado**: para cada dispositivo, los teléfonos de
  titulares (`allow_door_access`), miembros con `allow_phone` y temporales
  con teléfono **y sin límite de usos** (una llamada no se puede contar) a
  los que `evaluateAccess(…, "phone")` concede alguna de sus puertas
  **ahora**.
- **Números compartidos**: como la lista es el resultado de evaluar a TODAS
  las personas, un número no se quita mientras otro contrato, miembro o
  temporal siga necesitándolo.
- Activo → entra; suspendido → sale; reactivado → vuelve; finalizado →
  sale. Ninguna de esas reglas está escrita aparte: salen del motor.
- **Cuándo**: cualquier cambio que afecta a accesos (bloquear, levantar,
  activar, suspender, finalizar, cancelar, estado del cliente, teléfonos,
  miembros, permisos, temporales, puertas) llama a `marcarCambioAcceso` en
  su misma transacción → recalcula el deseado de los dispositivos del
  centro (huella sha256; si cambia, `pending`) → tras el COMMIT se aplica a
  los 1,5 s. El webhook de Stripe que suspende o reactiva pasa por los
  mismos hooks.
- **Reintentos**: el trabajo `accesos` (con los demás trabajos programados, con su lock)
  hace latido de los equipos, recalcula y aplica los `pending`/`failed`
  con espera exponencial (máx. 60 min).
- La **app** aplica los cambios al instante (evalúa en cada intento); la
  llamada, en cuanto el equipo acepta la lista. Mientras tanto el panel
  enseña «Pendiente de aplicar» y el deseado frente al real.

### Endpoints

Panel (`/api/self-storage/admin`):

| Método y ruta | Permiso |
|---|---|
| `GET/POST /devices`, `PATCH /devices/:id` | `ss.doors.view` / `ss.devices.manage` |
| `POST /devices/:id/test` | `ss.devices.test` |
| `POST /devices/:id/sync` | `ss.devices.manage` |
| `POST /devices/:id/outputs`, `PATCH /outputs/:id` | `ss.devices.manage` |
| `GET/POST /doors`, `PATCH /doors/:id` | `ss.doors.view` / `ss.devices.manage` |
| `POST /doors/:id/open` | `ss.access.open` |
| `GET /access-events` | `ss.access.view` |
| `GET/POST /contracts/:id/members`, `PATCH …/:memberId`, `POST …/:memberId/portal-invite` | `ss.access.view` / `ss.access.manage` |
| `GET /contracts/:id/access`, `POST /contracts/:id/permissions`, `DELETE …/:permId` | `ss.access.view` / `ss.access.manage` |
| `GET/POST /temporary-accesses`, `POST /temporary-accesses/:id/revoke` | `ss.access.view` / `ss.access.manage` |

Portal (`/api/self-storage/portal`):

| Método y ruta | Quién |
|---|---|
| `GET /access/doors` | titular o persona autorizada (sesión) |
| `POST /access/open {doorId}` | titular o persona autorizada (sesión) |
| `GET /access/events` | titular o persona autorizada (sesión) |
| `POST /access/temporary/doors {token}` | invitado con enlace (sin sesión) |
| `POST /access/temporary/open {token, doorId}` | invitado con enlace (sin sesión) |

Las personas autorizadas no pasan de ahí: contratos, facturas y pagos
llevan `soloTitular`.

### Pantallas

- **Self Storage → Puertas**: por puerta, dispositivo, salida, en
  línea/sin conexión, última comunicación, última apertura y último error;
  «Probar conexión» y «Abrir» (con motivo opcional) según permisos.
  Pestaña de dispositivos: salidas, teléfonos deseados frente a aplicados,
  estado de la sincronización y los mandos del simulador.
- **Self Storage → Accesos**: registro de aperturas con filtros (puerta,
  decisión, método) y accesos temporales (alta, enlace que se muestra una
  sola vez, revocar).
- **Ficha del contrato → Accesos**: qué puertas abre ahora y por qué,
  personas autorizadas (alta, estado, invitar al portal), permisos
  (manuales), temporales y últimas aperturas.
- **Configuración**: «Aperturas de puerta» (límite por minuto).
- **Portal → Accesos**: botones «Abrir» por puerta con el motivo si no
  se puede, y sus últimas aperturas. La persona autorizada sólo ve esto.
- **`/trasteros/abrir/:token`**: página pública del enlace temporal.

### Producción: pasos en Render y en el RUT241

En el RUT241 (verificar cada punto con el firmware instalado):

1. Actualizar RutOS a ≥ 7.18 (pulso nativo) o configurar
   `pulseMode: "on_off"`.
2. Cablear la salida digital a un **relé** que mueva la cerradura (la
   salida no la alimenta directamente).
3. Crear un usuario de API dedicado (no `admin`) con permiso sólo sobre
   E/S (y Call utilities si se usa la llamada).
4. Acceso remoto: IP pública fija con HTTPS y regla de cortafuegos
   limitada a la IP de salida de Render, o **VPN** (WireGuard/OpenVPN/
   Tailscale) si la SIM está tras CGNAT. RMS queda como alternativa
   (adapter preparado; cuesta créditos y tiene cupo mensual).
5. Exportar el certificado del router (o instalar uno propio) para fijar
   su CA.
6. Call utilities: crear el grupo «Mobilink» y una regla «Switch digital
   output» para llamadas de ese grupo. Localizar la ruta de la API del
   grupo y ponerla en `driver_options.phoneGroupPath`.

En Render:

1. Una variable por equipo, p. ej. `SS_RUT_REUS_1`, con el JSON de
   credenciales (+ `ca`). En el dispositivo se guarda sólo ese nombre.
2. Con VPN: la conexión de Render a la red privada (p. ej. un sidecar o
   un servicio con Tailscale) y `connection_type = vpn_http`.
3. Mantener `SELF_STORAGE_JOBS` activo para latidos y reintentos.

Antes de dar de alta clientes: «Probar conexión», abrir desde el panel,
abrir desde la app con un contrato de prueba, bloquear y comprobar que
deniega, y revisar en el registro el `device_response` de cada intento.

## 19. Call Center e incidencias

Ver `docs/CALL_CENTER.md`: llamadas (`self_storage_calls`), cronología
(`self_storage_call_events`), catálogo de motivos y resultados
(`self_storage_call_catalog`) e incidencias (`self_storage_incidents`, la
única entidad de incidencias del módulo; la fase 4 la amplía). Migración
`0010_call_center.sql`. Rol `call_center` y empresa activa del
superadministrador (`auth/empresa.ts`).
