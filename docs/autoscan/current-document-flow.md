# Cómo entra hoy una factura en Mobilink Cash

Fase 0 de AutoScan: **qué existe**, leído del código, no de la memoria. Todas
las referencias son a ficheros y funciones reales de este repositorio.

Escrito para responder a una pregunta concreta: si AutoScan tiene que dejar un
documento «en el mismo flujo actual», ¿cuál es ese flujo y dónde se engancha?

---

## 1. El hallazgo que cambia el diseño

**Hoy no existe una bandeja de documentos pendientes.** No hay ningún sitio al
que se pueda «soltar una factura» y que quede esperando a que alguien la mire.

El escaneo y el archivo del documento son **dos peticiones distintas separadas
por una decisión humana**, y el fichero solo se guarda cuando ya existe un
cobro al que colgarlo:

```
1. POST /api/cash/invoice-scan          (fichero)  → PROPUESTA
      ·  el fichero NO se guarda
      ·  solo queda una fila de rastro en cash_invoice_scans
                    ↓
2. una persona revisa, corrige y decide
                    ↓
3. POST /api/cash/collections                      → el COBRO
                    ↓
4. POST /api/cash/operations/:id/documents (fichero) → se ARCHIVA
```

El comentario del propio código lo dice (`server/cash/invoice-scan/service.ts`):

> Lo que no se guarda: el fichero. Ese se cuelga del cobro por la vía de
> siempre cuando el cobro existe, y duplicarlo aquí sería tener la factura de
> un cliente en dos sitios con dos ciclos de vida distintos.

Consecuencia para AutoScan: **el agente no puede limitarse a «entregar el
documento» a un flujo que continúe solo**, porque ese flujo no continúa solo —
espera a una persona, y si nadie llega, no queda nada. Hay que decidir dónde
espera el documento mientras tanto. Es la decisión central de la propuesta de
arquitectura.

---

## 2. Los tres endpoints implicados

### 2.1 Analizar una factura

`POST /api/cash/invoice-scan` — `server/cash/router.ts:1752`

| | |
|---|---|
| Permiso | `cash.collection.create_manual` |
| Cuerpo | `multipart/form-data`, campo `documento`, más `sessionId` opcional |
| Límite | 15 MB, 1 fichero (`subidaDocumento`, `router.ts:59`) |
| Servicio | `escanearFactura` — `server/cash/invoice-scan/service.ts` |
| Devuelve | `{ propuesta }`. **No cobra, no guarda el fichero.** |
| Síncrono | Sí: la petición espera a la IA |

El comentario de la ruta es explícito: *«La ruta es de escritura solo sobre su
propio rastro: no existe camino desde aquí a `cash_operations`»*.

### 2.2 Registrar el cobro

`POST /api/cash/collections` — `router.ts:1764`

Permiso `cash.collection.create_manual` o `cash.collection.create` según sea
manual o venga de la ERP. Es quien crea la operación, y desde hace poco quien
rechaza un cobro duplicado dentro de su transacción.

### 2.3 Archivar el justificante

`POST /api/cash/operations/:id/documents` — `router.ts:1052`

| | |
|---|---|
| Permiso | `cash.document.attach` |
| Servicio | `adjuntarDocumento` — `server/cash/documents.ts` |
| Duplicados | `duplicadosDe` (`documents.ts:557`) **avisa, no bloquea** |

Existe además `POST /api/cash/sessions/:id/documents` (`router.ts:1125`), que
cuelga un documento **de la jornada entera** y no de una operación. Es la vía
del «taco de facturas escaneado de una vez» y, como se verá, la pieza que más
se parece a lo que AutoScan necesita.

---

## 3. Dónde se guarda el fichero

`server/cash/storage.ts`. **Supabase Storage, bucket privado**, con enlaces
firmados que caducan. El bucket se crea solo la primera vez, como el resto del
esquema. Sin `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` el almacenamiento no
está disponible — las suites de pruebas cargan con una URL inválida a
propósito.

La URL **no se guarda nunca**: se firma al pedirla, para que un enlace copiado
hace un mes no abra la factura de un cliente.

---

## 4. Tablas

### `cash_operation_documents` — `schema.ts:483`

```
id, empresa_id,
operation_id   NULL = documento de la jornada entera, no de un cobro
session_id     NOT NULL, repetido a propósito para el informe de cierre
nombre, mime, tamano_bytes,
ruta           dentro del bucket; la URL no se guarda
sha256         huella del contenido
anulado, anulado_por, anulado_at_ms, anulado_motivo,
subido_por, subido_at_ms
```

Dos cosas que AutoScan hereda gratis:

- **`sha256` ya existe y ya se usa** para detectar duplicados de contenido
  (`duplicadosDe`), exactamente la regla que pide el punto 10 de la
  especificación. Hoy es un aviso, no una restricción.
- **`operation_id` admite NULL**, y ese es el hueco por el que un documento
  puede existir sin cobro. Pero `session_id` es `NOT NULL`: **todo documento
  pertenece a una jornada**, y eso condiciona a AutoScan más que ninguna otra
  cosa (ver §7).

### `cash_invoice_scans`

El rastro de cada escaneo: qué se propuso, con qué confianza, qué hizo después
la persona (`anotarConfirmacion`) y, si falló, por qué. No guarda el fichero.

---

## 5. El análisis: OCR e IA

`server/cash/invoice-scan/`, cinco piezas con una separación deliberada entre
**leer** y **decidir**:

| Fichero | Qué hace |
|---|---|
| `extractor.ts` | Puerto `ExtractorFacturas` + `extractorIA`. Manda el documento al modelo |
| `normalize.ts` | Convierte lo leído en datos: importes en céntimos, fechas, matrículas, y **enmascara tarjetas** |
| `classifier.ts` | Propone forma de cobro. **Sin base de datos, sin red, sin IA** |
| `validate.ts` | Umbrales de confianza: rellenar 0,9 / revisar 0,7 |
| `service.ts` | Orquesta, comprueba duplicados y deja el rastro |

La IA entra por `pedirIA` (`server/core/openaiService.ts`), la única capa de IA
de la plataforma: Responses API, `json_schema` estricto, PDFs e imágenes por
data-URI, con tiempo límite, reintento y respaldo.

El clasificador tiene una regla que AutoScan no debe poder tocar:

> **NO HAY TPV ≠ ES EFECTIVO**

Y decide por **reglas de la empresa que miran CAMPOS**, no texto suelto: en la
factura B0020000580, cobrada por un TPV de BBVA, el ticket imprime «LBL : Visa
CaixaBank». Una regla sobre el texto la clasificaría mal.

---

## 6. Autenticación, empresa y centro

```
authenticate                (server/core/auth.ts)
      ↓  Bearer de Supabase → app_usuarios → empresa
cargarPermisosCaja          (server/cash/permissions.ts)
      ↓  rol del módulo → permisos
exigirPermiso("cash.…")
```

- **Empresa**: sale del usuario, nunca del cuerpo de la petición.
- **Centro**: `req.cashCentroId`. `exigirAmbitoCaja` (`hierarchy.ts:322`)
  comprueba el `centro_id` de la **caja**, no de la petición.
- **21 permisos `cash.*`** sobre cuatro roles: consulta, cajero, responsable,
  admin.

Todo el modelo de autorización asume **una persona con sesión**. No hay hoy
ningún concepto de máquina, credencial de servicio ni clave de API. Es el
segundo hueco grande que AutoScan tiene que llenar.

---

## 7. La restricción que manda: todo cuelga de una jornada

`cash_operation_documents.session_id` es `NOT NULL`. Y una jornada:

- pertenece a una caja (`cash_registers`), que pertenece a un centro;
- se abre y se cierra a mano;
- **fuera del horario no hay ninguna abierta.**

Un escáner, en cambio, no sabe de jornadas. Alguien puede escanear a las 20:40
con la caja ya cerrada, o un lunes por la mañana antes de abrirla.

Esto obliga a responder, antes de escribir código:

> Un documento que llega por AutoScan cuando no hay jornada abierta, ¿dónde
> espera?

Las tres salidas posibles están en `architecture-proposal.md`. La que no vale
es abrir una jornada desde el agente: abrir caja es un acto con fondo inicial y
responsable, y una máquina no puede firmarlo.

---

## 8. Qué se puede reutilizar tal cual

| Pieza | Dónde | Para qué en AutoScan |
|---|---|---|
| `escanearFactura` | `invoice-scan/service.ts` | El análisis entero. **No se replica** |
| `subirDocumento` / bucket privado | `storage.ts` | Guardar el PDF |
| `sha256` + `duplicadosDe` | `documents.ts:557` | Duplicados por contenido |
| Límite 15 MB, 1 fichero | `router.ts:59` | Mismo límite, sin discrepancias |
| `registrarAuditoria(EnTransaccion)` | `core/auditoria.ts` | Auditoría, sin crear otro sistema |
| Worker con `setInterval` | `erp/worker.ts:232` | Patrón de cola ya probado en el proyecto |
| `enTransaccion` | `repository.ts` | Nada de registros huérfanos |
| Componentes de interfaz | `components/ui.tsx` | Tarjetas, tablas, distintivos, modales |

Y una pieza que resultó ser el precedente exacto de lo que hace falta:

**`server/cash/reauth.ts` y el patrón de puerto enchufable.** El verificador de
claves, el conector de ERP y el directorio de usuarios están todos detrás de
una interfaz para poder probar la regla sin levantar la infraestructura. La
credencial de dispositivo de AutoScan debería seguir el mismo patrón.

---

## 9. Qué NO se debe tocar

- **`invoice-scan/classifier.ts`** — decide dinero y no habla con nadie. Su
  valor está en que se puede probar entero.
- **La transacción de `registrarOperacion`** (`service.ts`) — bloqueo de
  jornada, validación de efectivo, duplicados. AutoScan no crea cobros.
- **`POST /operations/:id/documents`** — la carga manual sigue igual.
  AutoScan es una vía **adicional**.
- **El contrato de `/api/cash`** — 104 endpoints con consumidores internos.
