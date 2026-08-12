# Prompt para ChatGPT — Extensión AL de WorkPlanner en Business Central (It.4) + rodaje en sandbox

> Copiar desde la línea siguiente hasta el final y pegarlo en ChatGPT. Es autocontenido:
> ChatGPT no tiene acceso a nuestro repositorio, así que incluye todo el contexto necesario.

---

Actúa como un desarrollador senior de extensiones AL para Microsoft Dynamics 365 Business
Central (cloud), con experiencia en table extensions, páginas API a medida, permission sets
y despliegue de extensiones per-tenant con VS Code y el AL Language extension.

## Contexto (ya construido, NO lo rediseñes)

Tenemos en producción una integración bidireccional entre Business Central y nuestro módulo
**Mobilink WorkPlanner**, a través de un middleware propio ("Integration Hub", Node.js). BC
es el sistema maestro (clientes, catálogo, precios, impuestos, pedidos, facturación);
WorkPlanner es el sistema operativo de campo (planificar técnicos, ejecutar, capturar
consumos). Ya funciona con la **API estándar v2.0** de BC:

- Autenticación: app de Microsoft Entra ID con client credentials, dada de alta en BC con
  `D365 BUS FULL ACCESS`.
- Catálogo: sincronización incremental de `items` por `lastModifiedDateTime` (filtro actual:
  `blocked = false` + lista de categorías en el middleware).
- Pedidos: bajan todos los `salesOrders` abiertos con `$expand=salesOrderLines`; WorkPlanner
  decide cuáles planificar.
- Devolución: al confirmar el parte, el middleware hace PATCH de `quantity` en líneas
  existentes (con etag) y POST de líneas nuevas **sin precio** (BC aplica tarifa e IVA).
- Entorno de pruebas: sandbox con la empresa demo **CRONUS ES**.

Las limitaciones de la API estándar que la extensión debe resolver:
1. No hay forma de marcar en BC qué artículos son aptos para trabajos de campo.
2. No hay forma de marcar qué pedidos deben enviarse a WorkPlanner (hoy bajan todos).
3. Las líneas añadidas desde campo no quedan identificadas como tales en BC.
4. No podemos consultar el precio efectivo por cliente (tarifas/descuentos) vía API estándar.
5. La app usa `D365 BUS FULL ACCESS`, que es demasiado permiso.

## Qué necesito que me ayudes a construir (paso a paso, iterativo)

Una extensión AL llamada **"Mobilink WorkPlanner Connector"** con:

### 1. Table extensions

- **Item** y **Resource**: campo `Available In WorkPlanner` (Boolean, editable en la ficha).
- **Sales Header** (Documento de venta): `Send to WorkPlanner` (Boolean),
  `WorkPlanner Status` (Enum: Pending, Synced, Planned, InProgress, Done),
  `WorkPlanner Order Id` (Code[20]), `WorkPlanner Last Sync` (DateTime),
  `WorkPlanner Report URL` (Text[250]).
- **Sales Line**: `Added From WorkPlanner` (Boolean, no editable a mano),
  `WP User` (Text[80]), `WP Timestamp` (DateTime), `WP Work Order Id` (Code[20]),
  `WP Indicative Price` (Decimal), `WP Needs Pricing` (Boolean).
- Page extensions para ver estos campos en la ficha de artículo, la lista/ficha de pedido
  y la subpágina de líneas (las líneas añadidas desde campo deben distinguirse a simple
  vista, por ejemplo con estilo o columna propia).

### 2. Páginas API a medida (namespace `mobilink`, group `workplanner`, version `v1.0`)

- **workPlannerCatalog** (lectura): artículos + recursos con
  `Available In WorkPlanner = true` y no bloqueados. Campos: systemId, number, displayName,
  type, itemCategoryCode, baseUnitOfMeasureCode, unitPrice, blocked, lastModifiedDateTime.
  Si es viable, incluir unidades de medida alternativas, variantes y códigos de barras
  (Item Reference) embebidos o como subpágina, para evitar N llamadas por artículo.
- **workPlannerOrders** (lectura + escritura parcial): pedidos con
  `Send to WorkPlanner = true`, con sus campos WP y dirección de envío, y las líneas como
  subpágina (incluidos los campos WP de línea). El middleware debe poder hacer PATCH de
  `WorkPlanner Status`, `WorkPlanner Order Id`, `WorkPlanner Last Sync` y
  `WorkPlanner Report URL`.
- **workPlannerOrderLines** (escritura): alta de líneas en un pedido con los campos
  `Added From WorkPlanner`, `WP User`, `WP Timestamp`, `WP Work Order Id`,
  `WP Indicative Price` — la API estándar no permite escribir campos de extensión, por eso
  existe esta página.
- **workPlannerPrices** (lectura, la más delicada): dado cliente + artículo + cantidad +
  fecha, devolver el **precio unitario efectivo y el descuento de línea** que BC aplicaría,
  usando el motor real de cálculo de precios (Price Calculation Mgt. / V16). Explícame las
  opciones de implementación (query, página API sobre tabla temporal, codeunit expuesta
  como acción OData unbound) con pros y contras antes de escribir código.

### 3. Validaciones de negocio

- Al insertar una línea vía `workPlannerOrderLines`: si el artículo no tiene precio para el
  cliente, poner `WP Needs Pricing = true` en lugar de rechazar (el administrativo lo revisa
  antes de facturar).
- Impedir el alta vía API en pedidos con estado que no admita cambios, devolviendo un error
  claro (el middleware lo traduce a revisión manual).

### 4. Permission set

- `MOBILINK WP`: lo mínimo para que la aplicación de Entra opere SOLO con estas páginas API
  y las tablas implicadas (lectura de Item/Resource/Customer, lectura-escritura acotada de
  Sales Header/Line). El objetivo es retirar `D365 BUS FULL ACCESS` de la entrada de la app
  en la página *Microsoft Entra Applications* de BC y asignar este set.

### 5. Despliegue

- Guíame para: preparar el proyecto AL en VS Code (app.json con id ranges 50100-50149,
  target Cloud), compilar, publicar en el **sandbox** (per-tenant extension), probar, y el
  procedimiento de publicación en producción cuando toque.

## Cómo quiero trabajar

1. Empieza por un **plan de objetos** (tablas, páginas, enums, codeunits, permission set,
   con sus IDs) y valídalo conmigo antes de escribir AL.
2. Después ve **objeto por objeto**: código AL completo y compilable de cada uno, con
   comentarios breves en español, esperando mi confirmación ("compila", "error X") antes
   del siguiente.
3. No inventes nombres de campos ni de páginas distintos de los de arriba: el middleware ya
   espera exactamente esos (contratos JSON acordados). Si algo de la lista es inviable o
   tiene una alternativa claramente mejor en AL, dímelo explícitamente antes de cambiarlo.
4. Yo trabajo en Windows con VS Code; el sandbox ya existe y tengo permisos de administrador.
5. Al terminar cada bloque dame una **prueba concreta** que pueda hacer yo (en la UI de BC o
   con una llamada HTTP de ejemplo con placeholders, nunca con credenciales reales) para
   verificar que funciona antes de seguir.

## Ejemplo del JSON que el middleware espera poder enviar a workPlannerOrderLines

```json
{
  "documentId": "<GUID del pedido>",
  "lineType": "Item",
  "number": "3417-B",
  "quantity": 1,
  "addedFromWorkPlanner": true,
  "wpUser": "tecnico.garcia",
  "wpWorkOrderId": "WP-000873",
  "wpTimestamp": "2026-08-10T11:42:07Z",
  "wpIndicativePrice": 37.9
}
```

## Al final: plan de rodaje en sandbox

Cuando la extensión esté publicada en el sandbox, guíame paso a paso (pantalla a pantalla
en BC) por este plan de pruebas, en orden, y ayúdame a interpretar cualquier fallo:

1. **Catálogo controlado**: marcar 3 artículos y 1 recurso con `Available In WorkPlanner`;
   comprobar que `workPlannerCatalog` devuelve exactamente esos; bloquear uno y comprobar
   que desaparece.
2. **Pedido marcado**: crear un pedido con 2 líneas (artículo + recurso), marcar
   `Send to WorkPlanner`; comprobar que `workPlannerOrders` lo devuelve con sus líneas y
   que un pedido sin marcar NO aparece.
3. **Estado de vuelta**: hacer PATCH de `WorkPlanner Status` a `Synced` y comprobar que se
   ve en la ficha del pedido.
4. **Línea de campo**: insertar una línea vía `workPlannerOrderLines` con
   `addedFromWorkPlanner = true`; comprobar en la subpágina de líneas que queda identificada,
   con precio calculado por BC y `WP Indicative Price` guardado aparte.
5. **Sin precio**: repetir con un artículo sin precio para ese cliente; comprobar
   `WP Needs Pricing = true` y que la línea entra con precio 0.
6. **Pedido cerrado**: facturar el pedido e intentar insertar otra línea vía API; comprobar
   que el error es claro y controlado.
7. **Precio efectivo**: pedir a `workPlannerPrices` el precio de un artículo con tarifa
   especial para un cliente y comprobar que coincide con el que BC pone al insertar la línea.
8. **Permisos mínimos**: cambiar la app de Entra a `MOBILINK WP`, repetir 1-7 y confirmar
   que todo sigue funcionando y que un endpoint fuera del alcance (p. ej. borrar un cliente)
   falla por permisos.

Empieza por el punto 1 de "Cómo quiero trabajar": el plan de objetos.
