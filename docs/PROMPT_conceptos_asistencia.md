# PROMPT — Conceptos de la asistencia (neumáticos y materiales)

> Diseño acordado ANTES de programar. Objetivo: que lo que se monta en el
> servicio (neumáticos, materiales) entre solo en la tarifa de cierre, sin
> pasar por ajuste manual ni salir como desviación en la auditoría económica.
>
> Vale igual para clientes con Lite que para clientes de Assist: el ciclo de
> vida del concepto es de la ASISTENCIA, no de la app. Cada canal (app Lite,
> operador en el panel en nombre del taller) ejecuta los mismos pasos contra
> la misma API.

## 1. El problema de hoy

El motor de tarifas ya sabe **valorar** un neumático (`resolverPrecioNeumatico`,
líneas `TIRE`/`ADDITIONAL_TIRE`/`MATERIAL` en `LineaPrecio`), y la ficha ya
permite **consultar** su precio (`POST /pricing/:id/tire`). Lo que no existe es
el registro de **qué se puso de verdad**. Resultado: cada neumático real se
mete hoy como ajuste manual, que queda marcado como desviación (correcto para
lo excepcional, absurdo para lo cotidiano).

## 2. Cómo va la asistencia de verdad (esto manda sobre el diseño)

**Caso A — cambio previsto.** Al crear la asistencia Central YA sabe que se va
a cambiar un neumático y CUÁL: lo asigna desde el catálogo en la propia
creación. El taller no elige nada: **confirma** que lo montó, y la
confirmación es **la foto de montaje** en el vehículo.

**Caso B — reparación.** Se va a reparar. El taller se lleva un neumático por
si acaso; ese neumático de contingencia NO es un concepto (es logística, no
facturación).
  - **B1 — se repara**: no se monta neumático. No hay concepto de neumático.
  - **B2 — no se puede reparar**: el taller monta el nuevo. Entonces sí
    **declara desde el catálogo** cuál montó, y lo justifica con la foto de
    montaje en el vehículo.

De aquí salen las tres reglas del diseño:

1. **El concepto nace en Central cuando se sabe de antemano** (caso A), y en
   el taller solo cuando la realidad se desvía del plan (caso B2).
2. **Sin foto de montaje no hay confirmación**, y sin confirmación no se
   factura. La foto es la prueba que sostiene la línea de la factura.
3. **Solo se factura lo confirmado.** Lo previsto y no confirmado no se cobra
   solo: se avisa.

## 3. Ciclo de vida del concepto

Estados: `previsto` → `confirmado` | `no_usado`.

- **`previsto`**: lo crea Central al dar de alta la asistencia (o después,
  mientras no esté cerrada), desde el catálogo. Caso A.
- **`confirmado`**: el taller (Lite) o el operador (panel, en nombre del
  taller) lo confirma **adjuntando la foto de montaje**. En el caso B2 el
  concepto se crea y confirma en el mismo acto, también con foto obligatoria.
- **`no_usado`**: lo previsto que al final no se montó (se reparó, se anuló el
  cambio). Lleva motivo. No se factura.

Al cerrar (`final`):
- `confirmado` → línea de tarifa, valorada a venta y compra.
- `previsto` sin resolver → **aviso `CONCEPT_NOT_CONFIRMED`** + estado
  `manual_review`: alguien tiene que mirar si se montó y falta la foto, o si
  hay que marcarlo como no usado. Nunca se cobra por defecto.

## 4. Decisión central: se declara el QUÉ, nunca el PRECIO

Central asigna y el taller confirma **conceptos del catálogo** (medida
normalizada con `medidaCanonica`, marca con `normalizarMarca`) y cantidades.
El precio lo pone SIEMPRE el tarifario publicado, en el cierre, con la
configuración congelada en `locked`. Un taller que pudiera declarar su precio
estaría escribiendo su propia factura.

Si el tarifario no tiene precio para ese concepto: importe **null** + aviso
(`TIRE_PRICE_NOT_FOUND` o el nuevo `MATERIAL_PRICE_NOT_FOUND`) + estado
`manual_review`. Nunca cero.

## 5. Modelo de datos

Tabla nueva `connect_assistance_concepts` (en `pricing/schema.ts`, con RLS
como el resto):

- `assistanceId`, `kind` (`TIRE` | `MATERIAL`)
- neumático: `size` + `brand` normalizadas contra el catálogo; material:
  `conceptCode` contra el catálogo de materiales del tarifario — nunca texto
  libre
- `quantity` (entera, > 0)
- `status` (`previsto` | `confirmado` | `no_usado`), `statusReason`
- `plannedBy` / `plannedAtMs` (quién lo asignó en Central)
- `confirmedBy` / `confirmedAtMs` / `confirmedVia` (`lite` | `panel`)
- `evidenceFileId` → el fichero de la foto de montaje (los ficheros ya viajan
  por `/files` con categoría; se añade la categoría `montaje`)
- `clientActionId` único por asistencia para la idempotencia de Lite
- `deletedAtMs` (se retira, no se borra: la lista debe poder explicarse)

## 6. Cuándo entra en la tarifa

- **`estimate` / `locked`**: los conceptos NO tocan el forfait. Lo previsto
  se ve desde el principio en la ficha (el operador sabe qué se pactó).
- **`final`**: `finalizar()` lee los `confirmado` y genera una línea por
  concepto, valorada a venta Y a compra (neumáticos vía
  `resolverPrecioNeumatico` con baremos/descuentos; materiales vía su extra).
  Etapa inmutable, como hasta ahora.
- **Después de `final`**: lo declarado tarde sigue yendo por ajuste manual
  auditado (`overrides.ts`), sin cambios. La espera del cierre automático
  (24 h por defecto) existe justo para que la confirmación llegue antes.
- **Cierre automático**: una asistencia con conceptos `previsto` sin resolver
  se cierra igual, pero sale en `manual_review` con su aviso — se ve, no se
  cuela.

## 7. API (canal-agnóstica: la misma semántica para Lite y para el panel)

- Panel (`backoffice.ts`):
  - `POST /pricing/:id/concepts` (rol `operator`): crear previsto (caso A) o
    crear+confirmar en nombre del taller (cliente Assist sin Lite, con la
    foto que llegue por el canal que sea).
  - `PATCH /pricing/:id/concepts/:cid`: confirmar (exige `evidenceFileId`),
    marcar no usado (exige motivo), corregir cantidad. Auditado con
    `auditConnect`; NO es override económico.
  - `GET` con origen, autor, estado y el precio que el tarifario le dará
    (reutilizando la consulta existente), para ver ANTES de cerrar si algo
    saldrá sin precio.
- Lite (`lite.ts`):
  - `GET /assistances/:id/concepts`: el taller ve lo previsto ("vas a montar
    este neumático").
  - `POST .../concepts/:cid/confirm`: confirma lo previsto; exige la foto
    (sube por `/files` categoría `montaje` y referencia el fileId).
  - `POST .../concepts`: caso B2 — declara+confirma el montado, del
    catálogo, con foto obligatoria.
  - Todo con `clientActionId` y dentro de `/sync` (cola offline).
- El `finish` de Lite NO cambia de contrato: hay APKs en la calle; una APK
  vieja debe poder cerrar exactamente igual que hoy.
- Solo se puede tocar la lista mientras no exista etapa `final` (409 con
  mensaje que apunte al ajuste manual).

## 8. UI

- **Lite**: en la ficha, sección "Neumático a montar" con lo previsto y el
  botón de confirmar que abre la cámara (o elige la foto de montaje ya
  subida). En el caso B2, "Montar neumático no previsto": selector contra el
  catálogo (medida autocompletada, marca, cantidad) + foto obligatoria. La
  pantalla de finalizar enseña el estado de los conceptos, pero NO bloquea el
  cierre (el circuito actual no puede romperse; lo pendiente sale como aviso
  al cerrar la tarifa).
- **Panel** (`TarificacionTab.tsx`): la lista con estado, origen, autor, foto
  enlazada y precio previsto de tarifa; asignar previstos (caso A) al crear o
  editar; confirmar/no-usado en nombre del taller para clientes sin Lite.
- **Alta de asistencia** (panel): al crearla con tipo "cambio de neumático",
  el formulario pide el neumático del catálogo — es el momento en que Central
  ya lo sabe.

## 9. Pruebas mínimas

1. Caso A completo: Central asigna neumático al crear → taller confirma con
   foto en Lite → cierre → línea TIRE valorada a venta y compra con la
   configuración congelada, estado `ok`.
2. Caso A sin confirmar: se cierra → SIN línea del neumático + aviso
   `CONCEPT_NOT_CONFIRMED` + `manual_review`. Nunca se cobra por defecto.
3. Caso B1: reparado, sin conceptos → cierre como hoy, sin avisos nuevos.
4. Caso B2: taller declara+confirma con foto → línea valorada; el intento de
   confirmar SIN foto se rechaza (422).
5. Concepto confirmado sin precio en tarifa → importes null + aviso +
   `manual_review`; jamás cero.
6. Operador corrige cantidad antes del cierre → el cierre usa la corregida;
   auditoría refleja quién y cuándo; NO aparece como override.
7. Reenvío del mismo `clientActionId` desde Lite (cola offline) → un solo
   apunte / una sola confirmación.
8. Tocar la lista tras `final` → 409; el ajuste manual sigue funcionando.
9. APK vieja (finish sin conceptos) → cierra igual que hoy.
10. Cierre automático con previsto sin resolver → cierra en `manual_review`
    con su aviso; el pase no revienta.

## 10. Fuera de alcance (a propósito)

- Precios declarados por el taller (ver §4).
- El neumático de contingencia que el taller lleva "por si acaso": logística,
  no facturación. No se registra como concepto.
- Stock/almacén del taller: esto tarifica, no gestiona inventario.

## 11. Abierto — decidir antes de programar

1. **La reparación en sí (caso B1): ¿va dentro del forfait o es un concepto
   de material facturable** (p. ej. "reparación de pinchazo" del catálogo)?
2. **Catálogo de materiales**: ¿existe ya la lista (válvulas, ecotasa,
   reparación…) o se monta sobre la marcha en el panel de Tarifas?
3. **Clientes de Assist**: ¿la confirmación la hace siempre el operador desde
   el panel con la foto recibida, o está previsto que la app Assist hable con
   la API de Connect más adelante? (Hoy `flutter_app` no usa `/api/connect`.)
