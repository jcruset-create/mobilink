# Especificación funcional y técnica — Integración bidireccional Business Central ↔ Mobilink WorkPlanner

> Versión 1.0 — preparada para iniciar el desarrollo. Sustituye el enfoque del documento
> `PROMPT_WORKPLANNER_BUSINESS_CENTRAL.md` en un punto clave: aquí **Business Central es el
> sistema maestro** (clientes, catálogo, precios, impuestos, pedidos, facturación) y
> WorkPlanner es el sistema operativo (planificar, ejecutar, capturar consumos). El flujo
> nace en BC, no en Mobilink.

---

## 1. Arquitectura recomendada

### 1.1 Principio

Se mantiene el invariante del Integration Hub: **WorkPlanner nunca habla con BC
directamente**. Toda lectura y escritura pasa por `/api/v1` del Hub, que ya aporta en
producción: conector BC robusto (OAuth2 con token cacheado, reintentos 429/5xx,
paginación, timeouts), Mapping Engine, máquina de estados con `MANUAL_REVIEW`
reprocesable, audit log y panel de operaciones.

```
   Business Central (MAESTRO)
   pedidos · catálogo · precios · impuestos · facturación
        ▲                                │
        │ escritura (líneas añadidas,    │ lectura (pedidos liberados,
        │ consumos, horas)               │ catálogo controlado, precios)
        │                                ▼
   ┌─────────────────────────────────────────────┐
   │        Mobilink Integration Hub             │
   │  BusinessCentralConnector (ya en prod)      │
   │  + SalesOrderSyncService   (nuevo, BC→WP)   │
   │  + CatalogSyncService      (nuevo, BC→WP)   │
   │  + ExecutionReturnService  (nuevo, WP→BC)   │
   │  Mapping Engine · operaciones · audit log   │
   └─────────────────────────────────────────────┘
        │                                ▲
        ▼                                │
   Mobilink WorkPlanner (OPERATIVO)
   OT locales · planificación · técnicos · partes de trabajo
   consumos · fotos · firma · incidencias
```

### 1.2 Modelo de comunicación

| Sentido | Mecanismo | Motivo |
|---|---|---|
| BC → WP (pedidos) | **Polling incremental** del Hub (worker cada N min, filtro por `lastModifiedDateTime`) + webhooks BC como acelerador opcional | Los webhooks de BC caducan (renovación cada ~3 días) y no son fiables como único canal; el polling garantiza consistencia, el webhook baja la latencia |
| BC → WP (catálogo) | Polling incremental nocturno + botón "Sincronizar ahora" | El catálogo cambia poco; no justifica tiempo real |
| WP → BC (consumos/líneas) | **Síncrono al confirmar el parte** con cola de reintentos detrás (máquina de estados existente) | El técnico necesita saber si la línea entró; si BC está caído, la operación queda `RETRY_PENDING` y el worker la reintenta |
| Precio en tiempo real | Síncrono bajo demanda (`GET` al Hub → BC) con caché corta (15 min) | Decisión §6: BC calcula el precio definitivo; WP solo muestra orientativo |

### 1.3 Qué se construye y qué se reutiliza

| Pieza | Estado |
|---|---|
| Conector BC (token, 429, paginación, lotes, ETags) | ✔ ya en producción |
| Mapping Engine + pestaña Mapeos | ✔ ya en producción |
| Máquina de estados + panel de operaciones + reproceso | ✔ ya en producción |
| `IntegrationWorker` (ciclo de reintentos) | ✔ ya en producción — se amplía con jobs de sincronización |
| Extensión AL en BC (campos y APIs a medida, §8) | ✖ nueva — requiere desarrollo AL y publicación de la extensión |
| Tablas locales de WP: `wp_orders`, `wp_order_lines`, `wp_executions`, `wp_catalog` | ✖ nuevas (migración SQL manual, pauta del proyecto) |
| Servicios del Hub: `SalesOrderSyncService`, `CatalogSyncService`, `ExecutionReturnService` | ✖ nuevos |
| UI WorkPlanner: bandeja de pedidos, planificador sobre OT sincronizadas, parte de trabajo con consumos | ✖ nueva |

---

## 2. Flujo completo del pedido (BC → WorkPlanner)

1. **Alta en BC.** Un administrativo crea el pedido de venta con servicios, materiales
   previstos, cantidades, precios, descuentos, impuestos, dimensiones y datos del cliente
   y del lugar de intervención.
2. **Marcado para WP.** El pedido se marca con el campo nuevo **`Enviar a WorkPlanner`**
   (extensión AL, §8.1). Alternativa por configuración: enviar automáticamente todo pedido
   de una serie/tipo concreto. El estado del pedido debe ser *Liberado* — un borrador no
   se envía.
3. **El Hub lo detecta** (polling incremental por `lastModifiedDateTime` +
   `workPlannerStatus = 'Pending'`) y crea/actualiza la OT local:
   - cabecera → `wp_orders` (cliente, dirección de intervención, fechas solicitadas,
     dimensiones, nº y GUID del pedido BC);
   - líneas → `wp_order_lines` (nº línea BC, tipo Item/Resource, nº artículo, descripción,
     cantidad prevista, UM, precio, descuento, IVA — todo copiado de BC, **no** calculado).
   - Marca en BC `workPlannerStatus = 'Synced'` + fecha (PATCH con ETag).
4. **Planificación en WP.** Sobre la OT local se asignan técnicos, fechas, horarios,
   vehículos y equipos, y duración prevista. Nada de esto viaja a BC (BC no es un
   planificador); solo se escribe en BC el estado agregado si se desea (§8.1,
   `workPlannerStatus = 'Planned' | 'InProgress' | 'Done'`).
5. **Ejecución.** Los técnicos registran horas, servicios realizados, consumos, materiales
   adicionales, gastos, incidencias, fotos, documentos, firma y observaciones → tablas
   `wp_executions` (+ ficheros en el bucket existente).
6. **Cierre del parte** → flujo de devolución (§3).

### 2.2 Reglas de re-sincronización de un pedido ya enviado

- Cambios en BC sobre líneas **no empezadas** en WP → se actualizan en `wp_order_lines`.
- Cambios sobre líneas **ya en ejecución** → no se pisan: se genera aviso en WP
  ("la línea 20000 cambió en BC") y la divergencia queda en el panel de operaciones.
- Pedido cancelado en BC → OT local pasa a `cancelada_por_erp` (no se borra; conserva lo
  ejecutado para su tratamiento manual).

---

## 3. Flujo de devolución (WorkPlanner → BC)

Al **confirmar el parte de trabajo** (acción explícita del técnico o del encargado, no un
autosave), el Hub construye la devolución:

| Registro en WP | Destino en BC | Cómo |
|---|---|---|
| Cantidad consumida = prevista | Actualiza `Qty. to Invoice`/`Quantity` de la línea original | PATCH línea del pedido |
| Consumo superior al previsto | PATCH cantidad de la línea original (caso 2, §7) | con validación AL |
| Producto adicional del catálogo | **Nueva línea** en el pedido BC, marcada `addedFromWorkPlanner = true` | POST línea |
| Servicio complementario del catálogo | Nueva línea tipo Item-servicio o Resource | POST línea |
| Horas trabajadas | Según decisión D1: línea de Resource en el pedido (defecto) o diario de proyectos | POST |
| Gastos | Línea de tipo cargo (Item Charge) o G/L Account, según D2 | POST |
| Material fuera de catálogo | **No viaja a BC.** Queda como *material pendiente de validar* (§5.4) | — |
| Fotos, firma, incidencias, observaciones | No van a BC (BC no es gestor documental). Enlace público del parte en `workPlannerReportUrl` (§8.1) | PATCH cabecera |

Reglas:
- **BC recalcula precio, descuento e impuestos** de toda línea añadida o modificada
  (decisión §6). WP envía artículo, cantidad y UM; el precio de WP viaja solo como
  referencia en un campo de la extensión (`wpIndicativePrice`) para contraste.
- Cada línea añadida lleva `addedFromWorkPlanner`, usuario, fecha y OT de origen —
  visible en BC en la subpágina de líneas (§8.1).
- La devolución es **una operación del Hub por parte confirmado** (no por línea): o entra
  todo, o queda en `RETRY_PENDING`/`MANUAL_REVIEW` con detalle por línea de qué entró y
  qué no (respuesta parcial auditada; ver caso 12).

---

## 4. Estrategia de sincronización del catálogo (catálogo controlado)

### 4.1 Criterios de inclusión (se evalúan en BC, vía API a medida §8.2)

Un artículo/servicio entra en el catálogo de WP si y solo si:

1. `availableInWorkPlanner = true` (campo nuevo de la extensión AL en Item y Resource).
2. `Blocked = false` y `Sales Blocked = false`.
3. No caducado/descatalogado.
4. Si hay filtro por categoría configurado: `Item Category Code` ∈ lista permitida.
5. Si hay filtro por delegación/almacén/tipo de trabajo/perfil: se aplica en el Hub por
   tenant (tabla `wp_catalog_scope`), no en BC — BC no conoce los perfiles de técnico.

### 4.2 Qué se sincroniza de cada artículo

`number`, `displayName`, descripción ampliada, tipo (Item/Service/Resource), UM base +
UMs alternativas con factores de conversión, variantes (`itemVariants`), códigos de barras
(`itemReferences` / Item Reference), grupo de IVA (`VAT Prod. Posting Group` → % aplicable
por grupo de negocio del cliente), categoría, `lastModifiedDateTime`, precio de tarifa
base **solo como orientativo** (§6), y `availableInWorkPlanner`.

### 4.3 Mecánica

- **Carga inicial completa**: paginada (`$top` + `@odata.nextLink`, ya soportado por el
  conector), volcado a `wp_catalog` con `sync_run_id`.
- **Incremental**: cada noche + bajo demanda, `$filter=lastModifiedDateTime gt {marca}`.
  La marca de agua se guarda por tenant y entidad en `integration_sync_state` (tabla
  nueva: `tenant_id, entity, last_sync_ms, last_full_sync_ms, status`).
- **Bajas y bloqueos**: el incremental detecta `Blocked`/`availableInWorkPlanner=false` y
  marca la fila local `activo=false` (nunca DELETE: los consumos históricos referencian el
  artículo). Un artículo **eliminado** en BC no aparece en incrementales → un job semanal
  de conciliación compara los `number` locales activos contra BC y desactiva los huérfanos.
- **WorkPlanner no crea productos maestros.** El alta de un producto es siempre en BC.
  El flujo para el técnico es el de §5.4 (material pendiente de validar).

---

## 5. Tablas de mapeo e identificación

### 5.1 Mapeo de productos y servicios (`wp_catalog`)

| Campo | Origen | Notas |
|---|---|---|
| `bc_item_id` (GUID) | BC `items.id` | id estable para PATCH |
| `bc_number` | BC `items.number` | clave de negocio |
| `tipo` | Item / Service / Resource | |
| `descripcion`, `descripcion2` | BC | solo lectura |
| `um_base`, `ums_json` | BC units of measure | factores de conversión incluidos |
| `variantes_json` | BC itemVariants | código + descripción |
| `barcodes_json` | BC item references | para escaneo en campo |
| `grupo_iva` | BC | el % lo resuelve BC al facturar |
| `precio_orientativo`, `precio_orientativo_ms` | BC | mostrado con etiqueta "orientativo" |
| `activo` | derivado (§4.3) | |
| `bc_last_modified_ms`, `sync_run_id` | control incremental | |

### 5.2 Mapeo de líneas de pedido (`wp_order_lines`)

| Campo | Notas |
|---|---|
| `id` (WP) · `bc_order_id` (GUID) · `bc_line_id` (GUID) · `bc_document_no` · `bc_line_no` | identificación cruzada completa |
| `origen` | `'bc'` (venía en el pedido) / `'wp'` (añadida en campo) |
| `estado_sync` | `synced` / `pending_return` / `returned` / `rejected` / `conflict` |
| `qty_prevista`, `qty_consumida`, `um`, `variante` | |
| `precio_bc`, `descuento_bc`, `iva_bc` | copiados de BC, nunca calculados en WP |
| `usuario_wp`, `creado_ms`, `modificado_ms` | trazabilidad |
| `correlation_id` | enlaza con `integration_operations` (audit log ya existente) |

El historial de cambios se apoya en `integration_operation_logs` (ya existe): cada
sincronización es una operación con petición y respuesta persistidas.

---

## 6. Gestión de precios, descuentos e impuestos

**Decisión adoptada (la preferente del encargo): BC calcula el precio definitivo.**

- WP **muestra** el precio orientativo del catálogo (última tarifa base sincronizada) con
  etiqueta explícita "orientativo — el definitivo lo fija el ERP".
- Para presupuestar en campo con precisión hay un endpoint síncrono
  `GET /api/v1/erp/prices?customer=&items=` que pregunta a BC el precio aplicable a ese
  cliente (tarifas, descuentos de cliente) con caché de 15 min. Si BC no responde, WP
  enseña el orientativo y lo marca.
- Al devolver líneas (§3), WP **no envía precio**: BC aplica tarifa del cliente,
  descuentos e IVA al insertar la línea. El precio que WP mostró viaja en
  `wpIndicativePrice` (campo de extensión) solo para contraste y auditoría.
- Impuestos: WP nunca calcula IVA. Muestra el % del grupo cuando lo conoce, como
  información.

## 6.bis Gestión de inventario

- WP muestra disponibilidad **informativa** (`inventory` del artículo, del incremental o
  bajo demanda) — nunca reserva stock: la reserva/el picking es de BC.
- Consumo con stock insuficiente (caso 7): la línea entra igualmente en el pedido — el
  trabajo ya se hizo; la rotura de stock es un problema logístico de BC, no del parte.
  BC avisará por sus propios mecanismos. El Hub marca la operación con warning auditado.

---

## 7. Casos que debe resolver la integración

| # | Escenario | Resolución |
|---|---|---|
| 1 | El pedido ya contiene todo | El parte confirma cantidades; PATCH de `Qty.` si difieren; sin líneas nuevas |
| 2 | Consumo superior al previsto | PATCH de la cantidad en la línea original. Si BC lo rechaza (validación AL, p. ej. límite de crédito), la operación queda `MANUAL_REVIEW` con el mensaje de BC |
| 3 | Producto adicional existente | Nueva línea marcada `addedFromWorkPlanner`; BC pone precio |
| 4 | Servicio complementario existente | Igual que 3, tipo servicio/Resource |
| 5 | Producto bloqueado tras sincronizar | El POST de línea falla con el error de BC → `MANUAL_REVIEW` accionable ("artículo bloqueado en el ERP"); el incremental siguiente lo desactiva del catálogo local |
| 6 | Producto sin precio para el cliente | La línea entra con precio 0 y **flag de revisión** (`wpNeedsPricing = true`, campo de extensión); lista de trabajo en BC para el administrativo antes de facturar |
| 7 | Sin existencias | Ver §6.bis: la línea entra; warning auditado |
| 8 | Material fuera de catálogo | NO viaja a BC. Se guarda como `wp_pending_materials` (descripción, foto, cantidad, técnico) y genera dos salidas: aviso al administrativo para crear el artículo en BC, y al crearse + sincronizarse, conversión asistida de la línea pendiente en línea real |
| 9 | Pedido enviado/liberado/facturado/cerrado | Antes de devolver, el Hub relee el estado del pedido. Si ya no admite líneas (facturado/cerrado), la devolución queda `MANUAL_REVIEW` con dos salidas manuales: crear pedido complementario o abono/cargo. Nunca se fuerza |
| 10 | Dos técnicos añaden el mismo producto a la vez | Las devoluciones son operaciones serializadas por OT en el worker (cola por `correlation group`); dos líneas iguales son dos líneas legítimas en BC — se detecta el duplicado *potencial* y se avisa en el parte, pero no se bloquea (pueden ser dos consumos reales) |
| 11 | WP pierde la conexión | El parte se guarda local; la devolución queda `RETRY_PENDING`; el `IntegrationWorker` (existente) reintenta con backoff. El técnico ve "pendiente de enviar al ERP", no un error |
| 12 | BC rechaza una línea por validación funcional | Respuesta parcial: las líneas aceptadas quedan `returned`, la rechazada `rejected` con el mensaje de BC traducido; la operación global `MANUAL_REVIEW`; el reproceso reintenta **solo** las rechazadas (idempotencia por `bc_line_id`/`external key`) |

---

## 8. Extensión AL en Business Central (desarrollo a medida necesario)

La API estándar v2.0 no cubre todo. Se necesita una extensión AL (publicada vía
AppSource interno o directamente en el entorno) con:

### 8.1 Campos nuevos (table extensions)

- **Sales Header**: `Send to WorkPlanner` (bool), `WorkPlanner Status`
  (Pending/Synced/Planned/InProgress/Done/enum), `WorkPlanner Order Id`,
  `WorkPlanner Report URL`, `WorkPlanner Last Sync`.
- **Sales Line**: `Added From WorkPlanner` (bool), `WP User`, `WP Timestamp`,
  `WP Work Order Id`, `WP Indicative Price`, `WP Needs Pricing` (bool).
- **Item / Resource**: `Available In WorkPlanner` (bool, con control en la ficha).
- Page extensions para ver/editar estos campos en las páginas de pedido y artículo.

### 8.2 APIs a medida (páginas API en AL, namespace propio `mobilink/workplanner/v1.0`)

| API | Motivo (por qué no vale la estándar) |
|---|---|
| `workPlannerOrders` (lectura) | filtra por `Send to WorkPlanner` + estado, y expone dimensiones y dirección de intervención en una sola llamada |
| `workPlannerOrderLines` (lectura/escritura) | expone los campos WP de la línea; la estándar no permite escribir campos de extensión |
| `workPlannerCatalog` (lectura) | artículos+recursos con el filtro §4.1 resuelto en BC, con UMs, variantes y barcodes embebidos (evita 4 llamadas por artículo) |
| `workPlannerPrices` (lectura) | precio aplicable cliente+artículo+cantidad+fecha usando la lógica de tarifas real de BC (Price Calculation), inaccesible por la API estándar |
| acción `markSynced` (bound action) | transición de estado atómica con validación |

Hasta que la extensión esté publicada, el Hub puede empezar con las APIs estándar
(`salesOrders`, `salesOrderLines`, `items`) y una convención temporal (p. ej. un prefijo
en `externalDocumentNumber`), aceptando las limitaciones — el diseño del Hub no cambia.

### 8.3 Ejemplos JSON

Pedido hacia WP (respuesta de `workPlannerOrders`):

```json
{
  "id": "a1b2c3d4-...",
  "number": "PV-002401",
  "customerNumber": "10000",
  "customerName": "Transportes Pérez SL",
  "workPlannerStatus": "Pending",
  "interventionAddress": "Pol. Ind. Norte, nave 7, Tarragona",
  "requestedDeliveryDate": "2026-08-10",
  "dimensions": [{ "code": "DELEGACION", "value": "TGN" }],
  "lines": [
    {
      "lineId": "e5f6...", "lineNo": 10000, "type": "Item",
      "number": "1896-S", "description": "Pastillas freno eje delantero",
      "quantity": 2, "unitOfMeasure": "UDS", "unitPrice": 82.5,
      "discountPercent": 5, "vatProdPostingGroup": "IVA21"
    },
    {
      "lineId": "f7a8...", "lineNo": 20000, "type": "Resource",
      "number": "MO-MECANICA", "description": "Mano de obra mecánica",
      "quantity": 1.5, "unitOfMeasure": "HORA", "unitPrice": 45
    }
  ]
}
```

Devolución de una línea añadida en campo (POST del Hub a `workPlannerOrderLines`):

```json
{
  "documentId": "a1b2c3d4-...",
  "type": "Item",
  "number": "3417-B",
  "quantity": 1,
  "unitOfMeasure": "UDS",
  "addedFromWorkPlanner": true,
  "wpUser": "tecnico.garcia",
  "wpWorkOrderId": "WP-000873",
  "wpTimestamp": "2026-08-10T11:42:07+02:00",
  "wpIndicativePrice": 37.9
}
```

Respuesta parcial del Hub al confirmar un parte (caso 12):

```json
{
  "status": "MANUAL_REVIEW",
  "correlationId": "COR-20260810-000031",
  "lines": [
    { "wpLineId": 91, "result": "returned", "bcLineNo": 30000 },
    { "wpLineId": 92, "result": "rejected",
      "error": "BC_VALIDATION: El artículo 5544-X está bloqueado para venta" }
  ]
}
```

---

## 9. Seguridad

- Se reutiliza la app de Entra ID existente (client credentials + secretos en
  `IH_SECRET__BUSINESS_CENTRAL__*`); ningún secreto nuevo en código o BD.
- La extensión AL define un **permission set propio** (`MOBILINK WP`) limitado a las
  tablas y páginas API del namespace — sustituir `D365 BUS FULL ACCESS` por este set en la
  entrada de Entra de BC cuando la extensión esté desplegada (principio de mínimo
  privilegio).
- Multi-tenant del Hub intacto: config, secretos, mapeos y marcas de agua por `tenantId`.
- Los técnicos no tienen acceso al Hub admin: la app de campo llama a endpoints de negocio
  (`/api/v1/erp/...`) con la sesión normal de Mobilink; `ADMIN_TOKEN` solo para
  administración.
- Redacción de credenciales en `request_payload`/`response_payload` del audit log
  (pendiente ya identificado en el prompt de conexión — se hace en esta fase).

## 10. Rendimiento

- Catálogo: incremental por `lastModifiedDateTime`, nunca full salvo inicial/conciliación.
  Página de 100 (`Prefer: odata.maxpagesize`, ya soportado).
- `workPlannerCatalog` embebe UMs/variantes/barcodes → 1 llamada por página en lugar de
  ~4 por artículo.
- Devoluciones agrupadas por parte (una operación, N líneas), serializadas por OT.
- Caché de precios 15 min por (cliente, artículo).
- Polling de pedidos: cada 5 min por defecto, configurable por tenant; webhook opcional
  para bajar latencia sin subir la frecuencia de polling.

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| La extensión AL requiere partner/publicación y tarda | Arrancar con API estándar + convención (§8.2 último párrafo); la extensión llega en paralelo |
| `customerName` libre en WP actual vs nº cliente BC | En este modelo el cliente **viene de BC** con el pedido — desaparece el problema para OT sincronizadas; persiste solo en OT locales heredadas |
| Pedido modificado en BC durante la ejecución | Reglas §2.2 + ETags (ya implementados) |
| Doble facturación (línea devuelta dos veces) | Idempotencia por `bc_line_id` + `estado_sync`; el reproceso solo reintenta `rejected` |
| Deriva de catálogo (borrados silenciosos) | Job semanal de conciliación (§4.3) |
| Webhooks BC caducados | El polling es el canal de verdad; el webhook solo acelera |
| Sandbox vs producción | Todo se rueda primero contra el sandbox actual (CRONUS ES); el cambio de entorno es solo config del conector |

## 12. Plan de pruebas de integración

Contra sandbox (CRONUS ES), en este orden:

1. **Catálogo**: full inicial → marca de agua; modificar un artículo en BC → incremental lo
   trae; bloquear un artículo → se desactiva localmente; artículo con 2 UMs y variante →
   conversiones correctas.
2. **Pedido → WP**: crear pedido con 2 líneas (Item + Resource), marcar para WP → OT local
   con líneas exactas (precio, descuento, IVA copiados); modificar línea en BC antes de
   ejecutar → se actualiza; cancelar pedido → OT `cancelada_por_erp`.
3. **Devolución**: confirmar parte igual al previsto → PATCH de cantidades; consumo extra
   → cantidad actualizada; producto adicional → línea nueva marcada; material fuera de
   catálogo → `wp_pending_materials`, nada en BC.
4. **Errores**: BC apagado (secreto inválido) al confirmar → `RETRY_PENDING` → restaurar →
   reproceso OK; pedido facturado antes de la devolución → `MANUAL_REVIEW` con opciones;
   línea rechazada por validación → parcial + reproceso de solo la rechazada.
5. **Concurrencia**: dos partes del mismo pedido confirmados a la vez → operaciones
   serializadas, sin duplicados no intencionados.
6. **Regresión**: `npm test`, `tsc -b`, `npm run build` en verde; los flujos ya en
   producción (OTF → presupuesto) intactos.

## 13. Orden de construcción propuesto

1. **It. 1 — Catálogo controlado** (§4) con API estándar: tablas locales, sync inicial +
   incremental, panel básico. *Sin dependencia de AL.*
2. **It. 2 — Pedido BC → OT WorkPlanner** (§2) con API estándar + convención temporal.
3. **It. 3 — Devolución de consumos** (§3) con los casos 1-4, 11 y 12.
4. **It. 4 — Extensión AL** (§8): campos, APIs a medida, permission set; el Hub conmuta
   de la convención temporal a las APIs propias (cambio de config, no de diseño).
5. **It. 5 — Casos finos** (5-10), precios en tiempo real, conciliación semanal.

Cada iteración con su Definition of Done verificado contra sandbox antes de pasar a la
siguiente.
