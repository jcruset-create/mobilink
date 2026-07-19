# PROMPT — Renombrado a Mobilink + Mobilink Integration Hub

> Este documento es el **prompt maestro** para la siguiente fase de trabajo. No es código todavía;
> es el encargo que se ejecutará después. Léelo entero antes de tocar nada.

---

## 0. Contexto

La plataforma actual (proyecto `sea-tarragona`, sobre Supabase existente, con apps Flutter y
backend en Render) **cambia de nombre a `Mobilink`**. El renombrado debe ser completo pero
**no destructivo**: no rompe datos, integraciones ni despliegues en producción.

Sobre esa plataforma vamos a construir el **Mobilink Integration Hub**: el núcleo que conecta
Mobilink con ERP, proveedores, bases técnicas y servicios externos **sin acoplar la plataforma a
ningún sistema concreto**.

---

## 1. Tarea A — Renombrado `sea-tarragona` → `Mobilink`

**Objetivo:** que la marca del producto pase a ser "Mobilink" en todo lo visible y en la
identidad del código, sin romper nada en producción.

Reglas del renombrado:

1. **Nombre de producto / marca visible** (títulos de apps, splash, textos de UI, `README`,
   documentación, nombre mostrado): `Mobilink`.
2. **Identificadores técnicos** (nombres de paquete, `applicationId`, esquemas de Supabase,
   nombres de tablas ya existentes, URLs de despliegue, buckets): **NO se renombran ahora** si
   hacerlo implica migración de datos, cambio de bundle id publicado o rotura de despliegue.
   Se documenta la deuda técnica en una sección "Pendiente de renombrar" y se deja para una
   migración planificada aparte.
3. Cada app Flutter que cambie de nombre visible **sube versión** en su `pubspec.yaml` y el APK
   resultante va al Escritorio con nombre versionado (lo compila el usuario en otra sesión — aquí
   no se ejecuta `flutter build apk`).
4. Entregar al final una **lista exacta** de:
   - Qué se ha renombrado (archivo + qué texto).
   - Qué se ha dejado sin renombrar y por qué (deuda técnica).

**Antes de empezar el renombrado**, hacer un inventario (grep) de todas las apariciones de
`sea-tarragona`, `sea_tarragona`, `SEA`, `Tarragona` y clasificarlas en: marca visible /
identificador técnico / dato en BD. Presentar el inventario y confirmar el alcance antes de editar.

---

## 2. Tarea B — Mobilink Integration Hub

### 2.1 Objetivo

El Hub tendrá cuatro funciones principales:

1. **Recibir** información de sistemas externos.
2. **Normalizarla** al modelo de datos de Mobilink.
3. **Ejecutar** reglas de negocio y validaciones.
4. **Enviar** la información al sistema correspondiente.

Flujo de capas:

```
Apps Mobilink
      │
      ▼
Mobilink Core
      │
      ▼
Mobilink Integration Hub
      │
      ├── ERP Connectors
      ├── Technical Data Connectors
      ├── Supplier Connectors
      ├── Communication Connectors
      └── Telematics Connectors
```

### 2.2 Principio fundamental (invariante de diseño)

**Ningún módulo operativo de Mobilink se conecta directamente con Business Central, Autodata o un
recambista.** Siempre pasa por el Hub:

```
Gestión de Flotas → Integration Hub → Business Central
```

Esto permite cambiar de ERP o de proveedor sin tocar las apps de Mobilink. Toda propuesta de
implementación que rompa este invariante se rechaza.

---

### 2.3 Módulos del Hub

#### ERP Hub
Conectores previstos: Business Central, Dynamics NAV, SAP, Sage, Odoo, y otros por API/XML/CSV/EDI.

Interfaz común `IErpConnector`:
`GetCustomers()`, `GetCustomer()`, `GetProducts()`, `GetPrices()`, `GetStock()`,
`CreateSalesQuote()`, `CreateSalesOrder()`, `CreateDeliveryNote()`, `CreateInvoice()`,
`CreatePurchaseOrder()`, `CreateCustomer()`, `UpdateCustomer()`.

Primera implementación: **`BusinessCentralConnector`**.

#### Technical Data Hub
Conectores: Autodata, TecDoc, catálogos de fabricantes, bases VIN, identificación por matrícula.

Funciones: `IdentifyVehicle()`, `GetTechnicalSpecifications()`, `GetCompatibleParts()`,
`GetOeReferences()`, `GetRepairTimes()`, `GetMaintenancePlan()`, `GetTyreSpecifications()`.

#### Supplier Hub
Conectores para recambistas y distribuidores.

Funciones: `SearchPart()`, `GetPrice()`, `GetAvailability()`, `GetDeliveryTime()`,
`CreateSupplierCart()`, `CreatePurchaseOrder()`, `GetOrderStatus()`, `CancelOrder()`.

Respuesta **normalizada** (contrato de salida):

```json
{
  "supplierId": "SUP-001",
  "supplierPartNumber": "TEXTAR-12345",
  "manufacturerReference": "12345",
  "oeReferences": ["34116859066"],
  "unitCost": 82.5,
  "currency": "EUR",
  "availableQuantity": 6,
  "estimatedDelivery": "2026-07-20T10:00:00+02:00",
  "validUntil": "2026-07-19T18:00:00+02:00"
}
```

#### Communication Hub
Integraciones: Email, SMS, WhatsApp Business, Microsoft Teams, Outlook, push.

Funciones: `SendQuote()`, `SendAppointment()`, `SendWorkOrderStatus()`, `RequestApproval()`,
`RequestSignature()`, `SendInvoiceNotification()`.

#### Telematics Hub
Para: GPS, tacógrafos, sensores, TPMS, RFID, localización de técnicos y de vehículos.

---

### 2.4 Modelo de integración (síncrono + asíncrono)

**Tiempo real (API síncrona)** — respuesta inmediata: consultar stock, consultar precio, crear
presupuesto, identificar vehículo, consultar piezas compatibles, reservar artículo.

```
Mobilink → Integration Hub → Sistema externo → Respuesta
```

**Asíncrono (colas de mensajes)** — segundo plano: sincronización masiva de artículos,
actualización de clientes, importación de facturas, estados de pedidos, actualización de
catálogos, procesamiento de webhooks.

```
Evento Mobilink → Message Queue → Integration Worker → Sistema externo
```

---

### 2.5 Componentes técnicos

- **API Gateway** — punto único de entrada. Ejemplos de rutas:
  `/api/v1/erp/customers`, `/api/v1/erp/sales-quotes`, `/api/v1/technical/vehicles/identify`,
  `/api/v1/technical/parts/search`, `/api/v1/suppliers/offers`, `/api/v1/communications/messages`.
- **Connector Registry** — qué conectores tiene activos cada cliente (ERP, base técnica,
  proveedores, mensajería).
- **Mapping Engine** — traduce códigos externos (Business Central, referencia OE, TecDoc, código
  de proveedor) a un **único registro de producto Mobilink**.
- **Rules Engine** — reglas configurables. Ejemplos:
  - `cliente = Premium → priorizar recambio OEM`
  - `stock local > 0 → no consultar proveedores`
  - `reparación afecta a frenos → requerir validación humana`
  - `presupuesto > 2.000 € → requerir aprobación de gerente`
- **Queue Manager** — reintentos, errores temporales, procesos pendientes, sistemas caídos,
  eventos duplicados.
- **Audit Log** — cada integración registra: quién inició, sistema origen, sistema destino,
  fecha/hora, petición, respuesta, resultado, error, nº de reintentos.

---

### 2.6 Identificadores comunes

Toda operación usa identificadores compartidos: `TenantId`, `CustomerId`, `VehicleId`,
`WorkOrderId`, `ChecklistId`, `IncidentId`, `QuoteId`, `MovementId`, `IntegrationOperationId`,
`CorrelationId`.

El **`CorrelationId`** permite seguir todo el flujo de principio a fin. Ejemplo:

```json
{
  "correlationId": "COR-20260719-000125",
  "workOrderId": "OT-000548",
  "checklistId": "CHK-000892",
  "incidentId": "INC-000145",
  "businessCentralQuoteId": "PRES-001258"
}
```

---

### 2.7 Flujo completo del checklist (caso de referencia)

1. Técnico revisa frenos.
2. Checklist marca "No conforme".
3. Mobilink crea una incidencia.
4. Technical Hub identifica el vehículo.
5. TecDoc/Autodata devuelve referencias.
6. Supplier Hub consulta precios y stock.
7. Rules Engine selecciona la propuesta.
8. ERP Hub consulta artículos y tarifas.
9. Business Central crea el presupuesto.
10. Communication Hub lo envía al cliente.
11. Cliente acepta.
12. ERP Hub convierte el presupuesto en pedido.
13. Supplier Hub crea el pedido de compra si es necesario.
14. Mobilink actualiza la OT y la agenda.

---

### 2.8 Seguridad (requisitos no negociables)

Cada cliente de Mobilink queda **completamente aislado**:

- Multiempresa por `TenantId`.
- OAuth 2.0 + tokens de corta duración.
- Cifrado de credenciales; **secretos fuera del código fuente**.
- Control de permisos por conector.
- Registro de accesos.
- Cifrado en tránsito y en almacenamiento.
- Firma de webhooks.
- Listas de IP autorizadas cuando proceda.

**Las credenciales de cada proveedor van en un gestor de secretos, no directamente en Supabase.**

---

### 2.9 Gestión de errores

El Hub **nunca pierde una operación**. Ejemplo con Business Central caído:

```
PENDING → Reintento 1 → Reintento 2 → Reintento 3 → MANUAL_REVIEW
```

Estados: `RECEIVED`, `VALIDATING`, `PROCESSING`, `COMPLETED`, `FAILED`, `RETRY_PENDING`,
`MANUAL_REVIEW`, `CANCELLED`.

Debe existir un **panel de integraciones** para ver y relanzar operaciones fallidas.

---

### 2.10 Base de datos inicial

Tablas: `integration_connectors`, `integration_connector_configs`, `integration_credentials`,
`integration_operations`, `integration_operation_logs`, `integration_errors`,
`integration_mappings`, `integration_webhooks`, `integration_events`, `integration_retries`,
`supplier_offers`, `external_product_references`.

`integration_operations` (columnas): `id`, `tenant_id`, `connector_id`, `operation_type`,
`source_system`, `target_system`, `correlation_id`, `request_payload`, `response_payload`,
`status`, `retry_count`, `created_at`, `completed_at`, `error_code`, `error_message`.

> **Nota de proceso:** las migraciones SQL de estas tablas se dejan como scripts para que el
> usuario las ejecute a mano (misma pauta que el resto del proyecto). No se ejecutan aquí.

---

### 2.11 Panel de administración

Permite: activar/desactivar conectores, introducir credenciales, probar conexión, configurar
empresas y almacenes, mapear artículos y clientes, ver operaciones y errores, reprocesar
operaciones, configurar reglas, consultar consumo de API, configurar límites y alertas.

---

### 2.12 Estructura recomendada del backend

```
mobilink-integration-hub/
├── api/
├── application/
│   ├── commands/
│   ├── queries/
│   └── services/
├── domain/
│   ├── entities/
│   ├── interfaces/
│   └── events/
├── connectors/
│   ├── erp/
│   │   └── business-central/
│   ├── technical/
│   │   ├── autodata/
│   │   └── tecdoc/
│   ├── suppliers/
│   └── communications/
├── infrastructure/
│   ├── database/
│   ├── queues/
│   ├── security/
│   └── logging/
├── workers/
├── webhooks/
└── tests/
```

---

## 3. Plan por fases (MVP — no integrar todo de golpe)

- **Fase 1 — Business Central:** clientes, artículos, tarifas, stock, presupuestos de venta,
  pedidos de venta, albaranes, facturas, pedidos de compra.
- **Fase 2 — Technical Hub:** identificación de vehículo, referencias OE, recambios compatibles,
  tiempos de reparación, medidas técnicas.
- **Fase 3 — Supplier Hub:** un único recambista al principio — precio, stock, entrega, creación
  de pedido.
- **Fase 4 — Automatización del checklist:**
  `Checklist → Incidencia → Recambio compatible → Oferta de proveedor → Presupuesto Business Central`.

---

## 4. Primera entrega funcional (Definition of Done de la fase 1)

**Caso a demostrar:** desde una OT de Mobilink se crea una línea de servicio y materiales en un
presupuesto de Business Central, se recupera el número de presupuesto y se guarda la relación
entre ambos sistemas.

Entrada:

```json
{
  "tenantId": "TENANT-001",
  "workOrderId": "OT-000548",
  "customerId": "CLI-00125",
  "vehicleId": "VEH-00874",
  "lines": [
    { "externalProductId": "PAST-VOL-001", "quantity": 1 },
    { "externalProductId": "MO-FRENOS", "quantity": 1.5 }
  ]
}
```

Respuesta:

```json
{
  "status": "COMPLETED",
  "mobilinkQuoteId": "MQ-000258",
  "businessCentralQuoteNumber": "PRES-001258",
  "correlationId": "COR-20260719-000125"
}
```

**Prioridad inmediata:** construir el **contrato común de conectores** (`IErpConnector` y modelos
normalizados) y el **`BusinessCentralConnector`**. Todo lo demás se apoya después sobre esa base.

---

## 5. Cómo ejecutar este encargo (instrucciones para la sesión de programación)

1. **No renombrar identificadores técnicos publicados ni datos de BD** sin plan de migración; solo
   marca visible + identidad de código nuevo.
2. **Respetar el invariante 2.2**: nada operativo llama directo a un sistema externo.
3. **Empezar por contratos, no por implementación**: primero `domain/interfaces` y modelos
   normalizados; luego `BusinessCentralConnector`; luego persistencia y colas.
4. **Migraciones SQL = scripts para ejecución manual del usuario.**
5. **Versionado y APK** según pauta del proyecto (subir versión en `pubspec`, APK al Escritorio
   versionado, compilación en otra sesión).
6. **Auto-push a main** al terminar cambios estables (Render auto-despliega), salvo migraciones y
   secretos.
7. Entregar al cierre: inventario del renombrado, lista de tablas creadas, contrato de conectores
   y estado de la primera entrega funcional.
```
