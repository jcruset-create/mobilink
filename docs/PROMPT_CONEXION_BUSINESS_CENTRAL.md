# PROMPT — Conectar Mobilink con Microsoft Dynamics 365 Business Central

> Documento de encargo. **Todavía no es código.** Define cómo se conecta la app a Business
> Central (BC), qué hay ya hecho, qué falta, y qué decisiones necesita tomar el usuario antes
> de programar. Leer entero antes de tocar nada.

---

## 0. Punto de partida real (ya está en el repo)

No partimos de cero. Hoy existe:

| Pieza | Ruta | Estado |
|---|---|---|
| Contrato ERP común | `server/integration-hub/domain/connectors.ts` (`IErpConnector`) | hecho |
| Conector BC | `server/integration-hub/connectors/erp/business-central/BusinessCentralConnector.ts` | funcional + **modo simulación** |
| OAuth 2.0 client credentials | mismo fichero, `getAccessToken()` | hecho, **sin caché de token** |
| Proveedor de secretos | `server/integration-hub/infrastructure/secrets.ts` | solo variables de entorno |
| API Gateway | `server/integration-hub/api/router.ts` (`/api/v1/...`) | hecho, incl. `testConnection` |
| Panel de integraciones | `src/modules/integraciones/pages/PanelIntegraciones.tsx` | hecho (lectura + test) |
| Registro de conectores | `server/integration-hub/connectors/ConnectorRegistry.ts` | hecho |

**Invariante que sigue vigente:** ningún módulo operativo de Mobilink llama a BC directamente.
Todo pasa por el Integration Hub (ver `PROMPT_MOBILINK_INTEGRATION_HUB.md`, §2.2).

Consecuencia: **este encargo no crea un módulo nuevo**, completa el conector existente y lo
pasa de "simulación" a "producción".

---

## 1. Cómo se conecta técnicamente (arquitectura de la conexión)

```
App Mobilink (React / Flutter)
        │  nunca habla con BC
        ▼
Mobilink API (Express, server/index.ts)
        │
        ▼
Integration Hub  ──►  BusinessCentralConnector
                            │  1) token
                            ├──► https://login.microsoftonline.com/{aadTenantId}/oauth2/v2.0/token
                            │     grant_type=client_credentials
                            │     scope=https://api.businesscentral.dynamics.com/.default
                            │  2) datos
                            └──► https://api.businesscentral.dynamics.com/v2.0/{aadTenantId}/{entorno}/api/v2.0
                                  /companies({companyId})/customers | items | salesQuotes | ...
```

Tres decisiones ya tomadas y que **no se cambian** en este encargo:

1. **Autenticación:** OAuth 2.0 *client credentials* (aplicación-a-aplicación, sin usuario
   interactivo). Es lo correcto para un backend que trabaja de noche y sin sesión humana.
2. **API:** Business Central **API v2.0** (REST/OData, entidades estándar). No SOAP, no OData v4
   de páginas publicadas, salvo lo que se decida en §3.
3. **Secretos:** `client_id` / `client_secret` viven en el proveedor de secretos, **nunca** en BD
   ni en el repo. Convención actual de env:
   `IH_SECRET__<TENANT>__BUSINESS_CENTRAL__CLIENT_ID` (y fallback global sin tenant).

---

## 2. Trabajo previo en Microsoft (lo hace el usuario, no el código)

Sin esto no hay conexión posible. Pasos, en orden:

1. **Registrar la aplicación en Microsoft Entra ID** (antes Azure AD):
   Entra ID → App registrations → *New registration*. Tipo: *Accounts in this organizational
   directory only*. No necesita Redirect URI (es client credentials).
   → Anotar **Application (client) ID** y **Directory (tenant) ID**.
2. **Crear un client secret** (Certificates & secrets → New client secret).
   Anotar valor y **fecha de caducidad** (hay que rotarlo; ver §6).
3. **Permisos de API:** API permissions → *Dynamics 365 Business Central* →
   *Application permissions* → `API.ReadWrite.All` (y `Automation.ReadWrite.All` solo si se va a
   automatizar administración). Después **Grant admin consent**.
4. **Dar de alta la aplicación dentro de Business Central:**
   en BC, página *Microsoft Entra Applications* → nueva entrada con el Client ID, estado
   **Enabled**, y un conjunto de permisos (`D365 BUS FULL ACCESS` o uno restringido — ver §3.4).
   Este paso se olvida siempre y produce un 401 con token válido.
5. **Identificar entorno y empresa:** nombre del entorno (`Production`, `Sandbox`, …) y el
   **GUID de la company**, que se obtiene con
   `GET {baseUrl}/companies` una vez hay token.

**Empezar siempre en un entorno Sandbox.** No se apunta a Production hasta que la primera
entrega funcional pase en sandbox.

---

## 3. Decisiones que necesito del usuario antes de programar

Responder estas preguntas evita rehacer trabajo. Si alguna no se responde, se implementa la
opción marcada como *defecto* y se documenta el supuesto.

1. **¿Un solo BC o uno por empresa/tenant de Mobilink?**
   Afecta a si la config vive por tenant en `integration_connector_configs` (ya soportado) o si
   hay un único BC global. *Defecto: por tenant.*
2. **¿Qué entorno y qué company se usan primero?** Nombre del entorno + nombre de la empresa.
3. **¿Los artículos y clientes ya existen en BC, o Mobilink puede crearlos?**
   Si Mobilink no crea maestros, `createCustomer` queda desactivado por configuración y una
   OT con cliente no mapeado va a `MANUAL_REVIEW` en vez de inventar un cliente en BC.
   *Defecto: Mobilink NO crea maestros.*
4. **Precios:** ¿basta el `unitPrice` del artículo (lo que hace hoy el conector) o hay que
   respetar listas/grupos de precio por cliente y descuentos de línea? Si hay tarifas por
   cliente, la API v2.0 estándar no las expone bien y hay que decidir entre
   `salesPrices`/páginas publicadas a medida (AL) o dejar que BC recalcule el precio al crear
   la línea. *Defecto: no enviar precio y dejar que lo calcule BC.*
5. **Mano de obra:** ¿la mano de obra es un artículo tipo servicio en BC, o un recurso?
   Determina si las líneas van con `lineType: "Item"` o `"Resource"`.
6. **¿Qué documento crea Mobilink?** Presupuesto de venta (fase 1) → ¿pedido al aceptar? →
   ¿albarán/factura los hace BC por su cuenta? *Defecto: Mobilink crea presupuesto y, al
   aceptar, pedido. Albarán y factura se quedan en BC.*
7. **Numeración y trazabilidad:** ¿se escribe el nº de OT de Mobilink en
   `externalDocumentNumber` del documento BC? *Defecto: sí.*
8. **Sincronización de maestros:** ¿lectura en vivo por operación, o caché/sincronización
   nocturna de clientes y artículos? *Defecto: lectura en vivo + caché corta; sincronización
   nocturna en una fase posterior.*

---

## 4. Qué hay que programar (alcance de este encargo)

Ordenado por prioridad. Nada de esto rompe el modo simulación: si no hay credenciales, el
conector debe seguir simulando exactamente igual que hoy.

### 4.1 Robustez de la conexión (bloqueante)
- **Caché de token en memoria por `(tenantId, aadTenantId)`**, con expiración según `expires_in`
  menos un margen de seguridad. Hoy se pide un token nuevo en *cada* llamada: con 30 artículos
  eso son 30 tokens.
- **Reintentos y `429`:** respetar `Retry-After`, tratar `429` y `5xx` como `transient` (ya hay
  `IntegrationError.transient`, el worker ya reintenta). Backoff exponencial con tope.
- **Timeout** por petición (`AbortController`) — hoy una llamada colgada cuelga la operación.
- **Paginación:** las lecturas de `customers`/`items` devuelven solo la primera página. Seguir
  `@odata.nextLink` y usar `Prefer: odata.maxpagesize`.
- **Concurrencia optimista:** los `PATCH` mandan `If-Match: *`. Cambiar a usar el `@odata.etag`
  leído, para no pisar cambios hechos en BC.
- **Escapado OData correcto** en los `$filter` (una comilla simple en un código de artículo
  rompe hoy la consulta; en OData se escapa duplicándola, no con `encodeURIComponent`).
- **Lecturas por lote:** `getPrices`/`getStock` hacen una llamada por artículo. Agrupar con
  `$filter=number in (...)` o `or`, en lotes.

### 4.2 Configuración y credenciales desde el panel
- Formulario en `PanelIntegraciones.tsx` para `baseUrl`, `aadTenantId`, `companyId`,
  `defaultCurrency` y moneda/entorno → persistir vía `upsertConnectorConfig` (ya existe).
- **Selector de company:** botón que llame a `GET /companies` y liste las empresas del entorno,
  para no pedir un GUID a mano.
- **Introducción de secretos:** el panel **no** guarda `client_secret` en BD. Dos opciones y
  hay que elegir una:
  - (a) el secreto se pone como variable de entorno en Render (lo que ya soporta el código), y
    el panel solo muestra si está presente o no; *defecto*
  - (b) se añade un `SecretsProvider` cifrado (clave maestra en env, secreto cifrado en BD).
- **Botón "Probar conexión"** visible por conector, que use el endpoint existente y muestre
  el mensaje real de BC (incluido "falta dar de alta la app en BC").

### 4.3 Mapeo de datos
- Tabla `integration_mappings` (ya prevista) usada de verdad para:
  `cliente Mobilink ↔ nº cliente BC`, `artículo Mobilink ↔ nº artículo BC`, y almacén.
- Si una OT llega con un cliente o artículo **sin mapear**, la operación **no se inventa nada**:
  va a `MANUAL_REVIEW` con un error legible en el panel.
- Guardar la relación inversa al crear el presupuesto: `workOrderId ↔ businessCentralQuoteId` +
  `correlationId`.

### 4.4 Errores con diagnóstico útil
Traducir los fallos típicos de BC a mensajes accionables en el panel, no a "error 401":

| Situación | Diagnóstico que debe mostrar |
|---|---|
| 401 con token OK | La app no está dada de alta / habilitada en BC (§2.4) |
| 403 | Falta el permission set en BC o el admin consent en Entra |
| 404 en `/companies(...)` | `companyId` o nombre de entorno incorrectos |
| `AADSTS7000215` | client_secret inválido o caducado |
| `AADSTS700016` | client_id no existe en ese tenant de Entra |
| 429 | Límite de peticiones de BC; se reintenta con `Retry-After` |

### 4.5 Pruebas
- Tests de `BusinessCentralConnector` con `fetch` mockeado: token cacheado, 429 + `Retry-After`,
  paginación, alta de presupuesto con 2 líneas, error 401 mapeado.
- Los tests **no** llaman a BC real. `npm test` (vitest) debe seguir verde sin credenciales.

---

## 5. Definition of Done

La conexión se considera hecha cuando, contra un **sandbox real de BC**:

1. `POST /api/v1/erp/connectors/business-central/test-connection` devuelve
   `{ ok: true, message: "Conexión con Business Central correcta" }` **sin** modo simulación.
2. Desde una OT de Mobilink se crea un presupuesto de venta en BC con líneas de material y de
   mano de obra, y Mobilink guarda `businessCentralQuoteNumber` + `correlationId`.
3. El panel de integraciones muestra la operación en `COMPLETED`, con petición y respuesta
   auditadas, y el nº de presupuesto de BC clicable/copiable.
4. Apagando BC (o con secreto inválido) la operación pasa por
   `RETRY_PENDING → MANUAL_REVIEW` y **no se pierde**, y el panel la puede relanzar.
5. Sin credenciales, todo sigue funcionando en simulación (`simulated: true`).

---

## 6. Seguridad y operación (no negociable)

- `client_secret` **nunca** en el repo, ni en logs, ni en el `request_payload` auditado —
  redactar credenciales y tokens antes de persistir en `integration_operation_logs`.
- Caducidad del secreto: dejar documentada la fecha y un aviso en el panel cuando falten
  < 30 días (el fallo por secreto caducado es el incidente más común de esta integración).
- Aislamiento por `TenantId` en config, secretos, mapeos y operaciones.
- `ADMIN_TOKEN` obligatorio en producción para los endpoints de administración del Hub
  (hoy, si no está definido, no bloquea — aceptable en desarrollo, no en Render).

---

## 7. Fuera de alcance de este encargo

- Webhooks entrantes de BC hacia Mobilink (estados de pedido, facturas pagadas) → fase posterior.
- Sincronización masiva nocturna de artículos y clientes → fase posterior.
- Otros ERP (NAV, SAP, Sage, Odoo): no se implementan, pero **nada de lo que se haga aquí puede
  quedar dentro del contrato común** si es específico de BC.
- Extensiones AL propias dentro de BC: solo si la decisión §3.4 lo exige.

---

## 8. Cómo ejecutar el encargo

1. Empezar por §4.1 (robustez) — es lo que hace viable todo lo demás.
2. Después §4.2 y §4.3 (configuración + mapeo), que es lo que permite al usuario conectar sin
   tocar código.
3. Migraciones SQL: **scripts para ejecución manual del usuario**, como en el resto del proyecto.
4. No cambiar el contrato `IErpConnector` para acomodar rarezas de BC; si BC necesita algo
   propio, va en la config del conector.
5. Entregar al cierre: qué se ha implementado, qué decisiones de §3 se respondieron, qué
   supuestos se asumieron, y el resultado de la prueba de conexión.
