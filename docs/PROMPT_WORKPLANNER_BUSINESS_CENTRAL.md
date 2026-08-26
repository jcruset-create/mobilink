# PROMPT — Integrar Mobilink WorkPlanner con Business Central

> Documento de encargo. **Todavía no es código.** Define cómo el WorkPlanner (Operativo 2 +
> Agenda) se conecta con Business Central a través del Integration Hub, qué flujos tiene
> sentido integrar y en qué orden, y qué decisiones necesita tomar el usuario antes de
> programar. Leer entero antes de tocar nada.

---

## 0. Qué es WorkPlanner hoy (inventario real, verificado en el código)

WorkPlanner (`src/modules/workplanner/WorkPlannerApp.tsx`) es el módulo licenciable que
agrupa dos vistas del panel de taller reutilizando `SeaTarragonaV1` en modo embebido:

| Sección | Vista | Datos que maneja |
|---|---|---|
| **Operativo 2** | `initialView="operativo2"` | Trabajos en curso del taller: tabla `jobs` (matrícula, cliente, motivo, técnicos, plantilla, minutos estándar/reales, precio v2) |
| **Agenda** | `initialView="agenda2"` | Citas programadas: tabla `scheduled_jobs` (JSONB con plantilla, cantidad, `unitPrice`, `totalPrice`, estado, cliente) |
| Estadísticas | — | "Próximamente" |
| Configuración | — | "Próximamente" |

Datos clave del modelo (verificados):

- **`jobs`** (`server/db.ts:55`): `plate`, `customerName`, `customerPhone`, `reason`,
  `template` (clave de plantilla), `status`, `actualMinutes`, `workedAccumulatedMinutes`,
  `standardMinutes`, `includedTasks`, y campos v2 de precio.
- **`scheduled_jobs`** (`server/db.ts:92`): fila JSONB con `templateKey`, `quantity`,
  `unitMinutes`, `unitPrice`, `totalPrice`, `includedTasks`, `status`
  (`cancelado`/`eliminado` excluidos en las consultas), cliente y fechas.
- **`quick_templates`**: catálogo de servicios del taller (`key`, `label`,
  `standardMinutes`, `unitMinutes`, `unitPrice`). **Este catálogo es la pieza que se mapea
  contra artículos/servicios de BC** — mismo papel que `trabajoPlantilla` en las OTF.
- El precio en WorkPlanner es **calculado en Mobilink** (plantilla × cantidad), no viene
  de ninguna tarifa de BC.

## 0.1 Qué existe ya del lado de la integración (no se rehace)

| Pieza | Estado |
|---|---|
| `BusinessCentralConnector` robusto (token caché, 429, paginación, lotes) | ✔ producción |
| Mapping Engine + pestaña Mapeos en `/integraciones` | ✔ producción |
| Máquina de estados con `MANUAL_REVIEW` reprocesable | ✔ producción |
| Flujo OTF → presupuesto BC con preview (`WorkOrderQuoteService`) | ✔ producción |
| Panel de operaciones auditadas | ✔ producción |

**Regla que sigue vigente (§2.2 del prompt maestro):** WorkPlanner NO llama a Business
Central directamente. Todo pasa por `/api/v1/...` del Integration Hub. Este encargo añade
servicios al Hub y botones a WorkPlanner; no añade ninguna llamada nueva a BC desde el front.

---

## 1. Flujos candidatos (decidir cuáles y en qué orden)

Ordenados por relación valor/esfuerzo estimada. **Recomendación: A y B en la primera
iteración; C cuando A esté rodado; D después.**

### Flujo A — Trabajo terminado → presupuesto/borrador de factura en BC

El más valioso: hoy un trabajo de Operativo 2 se cierra y la facturación se rehace a mano
en el ERP.

```
Job (status → terminado) ──► Hub ──► BC salesQuote (o salesInvoice borrador)
     línea por plantilla/includedTasks, cantidad y precio v2
     cliente resuelto por Mapping Engine (customerName → nº cliente BC)
```

- Reutiliza el patrón OTF ya construido (`WorkOrderQuoteService` como referencia).
- Nuevo servicio: `JobQuoteService` con `previewQuoteFromJob(jobId)` y
  `createQuoteFromJobId(jobId)`.
- Mapeos necesarios: `quick_templates.key → nº artículo/servicio BC` (tipo `product`) y
  `cliente → nº cliente BC` (tipo `customer`). La pestaña Mapeos ya lo soporta.
- Botón en Operativo 2 sobre trabajos terminados: **"Facturar en BC"** con el mismo modal
  de preview del flujo OTF (qué líneas, qué falta por mapear, crear).

### Flujo B — Cita de la Agenda → presupuesto en BC

Una cita aceptada ya tiene plantilla, cantidad y precio: es un presupuesto natural.

```
scheduled_job ──► Hub ──► BC salesQuote
```

- Mismo servicio con otra fuente (`previewQuoteFromScheduledJob`).
- El nº de presupuesto BC se guarda en el JSONB de la cita (campo nuevo
  `businessCentralQuoteNumber`) y se enseña en la ficha.
- Sirve de confirmación formal al cliente ANTES de hacer el trabajo — el orden natural del
  taller: presupuesto al citar (B), factura al terminar (A).

### Flujo C — Sincronización de catálogo: quick_templates ↔ artículos BC

- Lectura de artículos de BC (`getProducts`, ya paginado) → pantalla de conciliación en
  Configuración de WorkPlanner: plantilla ↔ artículo, con alta masiva de mapeos.
- Opcional (decisión §3.6): traer el `unitPrice` de BC hacia la plantilla, o comparar y
  avisar de divergencias sin sobrescribir.

### Flujo D — Estadísticas con datos de BC

La sección Estadísticas está vacía. Cruce natural: minutos reales (Mobilink) × facturado
(BC) por plantilla/cliente. **Fuera de este encargo** — solo se deja la relación
`job/cita ↔ documento BC` bien guardada (tabla `integration_document_links`, ya existe)
para que sea posible después.

---

## 2. Diseño técnico (lo que se construye)

### 2.1 Servicios nuevos en el Hub

```
server/integration-hub/application/services/
├── JobQuoteService.ts          ← Flujo A (jobs de Operativo 2)
└── ScheduledJobQuoteService.ts ← Flujo B (citas de la Agenda)
```

Ambos siguen el patrón exacto de `WorkOrderQuoteService`:
1. `preview...` — carga la fila, resuelve mapeos, NO toca BC, devuelve `listo`/`sinMapear`.
2. `create...` — exige todo mapeado (con `permitirSinMapear` como escape), delega en
   `createQuoteFromWorkOrder`/`SalesQuoteService`, que es la única puerta al ERP.

Reglas de construcción de líneas (Flujo A):
- Si el job tiene `includedTasks` → una línea por tarea incluida (cada una mapeable).
- Si no → una línea por la plantilla (`template`) con `quantity` v2 (por defecto 1).
- `unitPrice`: el calculado v2 de Mobilink **si la decisión §3.3 dice enviarlo**; si no,
  se omite y BC pone su tarifa.
- Un job sin plantilla ni tareas (texto libre en `reason`) → `MANUAL_REVIEW` en estricto,
  o línea con descripción libre y artículo genérico mapeado (`VARIOS`) si se decide en §3.5.

### 2.2 Endpoints nuevos (API Gateway, mismo estilo que work-orders)

```
GET  /api/v1/erp/jobs/:jobId/quote-preview
POST /api/v1/erp/jobs/:jobId/sales-quote
GET  /api/v1/erp/scheduled-jobs/:id/quote-preview
POST /api/v1/erp/scheduled-jobs/:id/sales-quote
```

### 2.3 UI en WorkPlanner

- **Operativo 2**: botón "Facturar en BC" en trabajos con `status` terminado. Modal de
  preview reutilizando el componente del flujo OTF (extraerlo a compartido si hace falta).
- **Agenda**: botón "Presupuestar en BC" en la ficha de la cita; al crear, guardar y
  mostrar el nº de BC.
- **Configuración** (Flujo C): pantalla de conciliación plantillas ↔ artículos BC.
- Indicador en ambas vistas cuando el documento BC ya existe (leyendo
  `integration_document_links` por `mobilinkDocId`), para no crear duplicados sin querer.

### 2.4 Idempotencia (nuevo requisito, aprendido del flujo OTF)

Pulsar dos veces "Facturar en BC" sobre el mismo job NO debe crear dos presupuestos:
- Antes de crear, consultar `integration_document_links` por
  (`tenantId`, `mobilinkDocType='job_quote'`, `mobilinkDocId=jobId`).
- Si ya hay documento → devolver el existente con `alreadyExists: true` y enseñarlo en el
  modal en lugar del botón de crear. Crear otro exige un flag explícito `force`.

---

## 3. Decisiones que necesito del usuario ANTES de programar

Si no se responden, se aplica el *defecto* y se documenta el supuesto.

1. **¿Qué documento crea el Flujo A?** ¿Presupuesto de venta, pedido, o borrador de
   factura? El trabajo ya está hecho, así que presupuesto suena raro, pero es el documento
   más inofensivo si algo sale mal. *Defecto: presupuesto de venta; pasar a borrador de
   factura cuando el circuito esté rodado.*
2. **¿Cuándo se dispara?** ¿Botón manual por trabajo, o automático al pasar a terminado?
   *Defecto: botón manual. El automático se añade después como preferencia de
   Configuración, nunca antes de haber rodado el manual.*
3. **Precios: ¿manda Mobilink o BC?** WorkPlanner calcula precio v2 (plantilla ×
   cantidad). ¿Se envía ese `unitPrice` a BC, o se deja que BC aplique su tarifa?
   *Defecto: enviar el precio de Mobilink — es el que se pactó con el cliente al citar.*
4. **Identificación del cliente.** `jobs.customerName` es texto libre (sin id). ¿Se mapea
   `customerName → nº cliente BC` tal cual (frágil ante variantes de escritura), o se
   añade antes un selector de cliente a Operativo 2/Agenda? *Defecto: mapeo por
   customerName normalizado, y a MANUAL_REVIEW cuando no case; el selector de cliente es
   mejora aparte.*
5. **Trabajos de texto libre** (sin plantilla): ¿MANUAL_REVIEW siempre, o artículo
   genérico `VARIOS` con la descripción? *Defecto: MANUAL_REVIEW; el genérico solo si el
   usuario lo pide explícitamente.*
6. **Flujo C, dirección del precio:** ¿BC manda sobre `unitPrice` de las plantillas, o
   solo avisar de divergencias? *Defecto: solo avisar; no sobrescribir precios de Mobilink.*
7. **¿Multi-taller?** `jobs.workshopId` existe. ¿Cada taller factura a una company BC
   distinta? Si sí, el mapeo `workshopId → companyId BC` entra en la config del conector.
   *Defecto: una sola company (la actual de CRONUS/producción).*

---

## 4. Plan por iteraciones

- **It. 1 — Flujo A manual completo:** `JobQuoteService` + endpoints + botón con preview
  en Operativo 2 + idempotencia. Tests del servicio (BD simulada, patrón
  `WorkOrderQuoteService.test.ts`).
- **It. 2 — Flujo B:** citas → presupuesto, nº BC guardado en el JSONB y visible.
- **It. 3 — Flujo C:** conciliación de catálogo en Configuración (deja de hacer falta la
  carga de mapeos a mano para las plantillas).
- **It. 4 — disparo automático opcional** (si §3.2 lo aprueba) + indicador de duplicados
  refinado.

**Definition of Done de la It. 1:** desde Operativo 2, un trabajo terminado con plantilla
mapeada se factura en BC con dos clics (preview → crear); el nº de documento BC queda
visible en el trabajo y en el panel de operaciones; pulsar el botón dos veces no crea dos
documentos; un trabajo sin mapear acaba en MANUAL_REVIEW con mensaje accionable; los tests
del proyecto siguen en verde.

---

## 5. Reglas de ejecución

1. Todo pasa por el Hub — ninguna llamada a BC desde componentes de WorkPlanner.
2. La traducción de ids ocurre SOLO en el Mapping Engine (lección aprendida del flujo OTF:
   traducir dos veces rompe el modo estricto).
3. Los estados no facturables se verifican contra el código real de la vista, no se
   asumen (lección del `no_realizado` de las OTF).
4. Ningún secreto nuevo: se reutiliza la config y credenciales BC existentes.
5. `npm test`, `tsc -b` y `npm run build` en verde antes de cada push a main.
