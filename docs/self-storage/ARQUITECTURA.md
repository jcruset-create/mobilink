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

- **Columnas reconocidas**, con mapeo de cabeceras editable en la vista
  previa: número, zona, largo, ancho, alto, m², m³, precio, IVA, PVP. Se
  admiten `,` o `.` decimal y medidas en m o en cm (si el valor es menor de
  20, se interpreta como metros).
- **Reglas** (`domain/importUnits.ts`, pura y probada):
  - sin m² o m³, se calculan a partir de las medidas;
  - si vienen y difieren más de un 5 % del cálculo, se avisa (no es un
    error);
  - `precio` es la base; si solo viene el PVP, base = PVP / (1 + IVA);
  - si vienen los tres y `|precio × (1 + IVA) − PVP| > 0,01`, se avisa;
  - una zona que no existe se crea al aplicar, con confirmación;
  - un código que ya existe se **actualiza** (medidas y precio) pero **nunca**
    se cambia su estado ni el precio de los contratos vivos: el precio del
    contrato está congelado.
- **Proceso en tres pasos**: subir, vista previa con errores y avisos por
  fila, y aplicar en una transacción con auditoría. Se puede repetir:
  importar dos veces el mismo fichero no duplica nada.
- **Para los datos de Reus**, el mismo proceso con `source='reus_seed'`, en
  cuanto me pases el fichero o la tabla.

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
| **3** | puertas; dispositivos; `DoorController` (mock, después RMS/HTTP con el hardware); permisos; bloqueos; accesos temporales; llamada Twilio; límite de frecuencia; suspensión y restauración automáticas | con hardware real: abre la puerta autorizada, deniega la de otra zona, bloquea al suspender y restaura al pagar |
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
aparecen en el menú con su fase.

**Pruebas**:

- Unitarias de dominio.
- Aislamiento del módulo por código.
- Integración por HTTP contra PostgreSQL (`selfStorage.integration.test.ts`).
- RLS entre clientes con roles y `auth.uid()` equivalentes a los de
  Supabase (`rls.integration.test.ts`).

