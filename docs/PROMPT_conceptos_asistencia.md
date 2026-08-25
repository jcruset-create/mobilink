# PROMPT — Conceptos de la asistencia (neumáticos y materiales)

> Diseño acordado ANTES de programar. Objetivo: que lo que el taller pone
> (neumáticos, materiales) entre solo en la tarifa de cierre, sin pasar por
> ajuste manual ni salir como desviación en la auditoría económica.

## 1. El problema de hoy

El motor de tarifas ya sabe **valorar** un neumático (`resolverPrecioNeumatico`,
líneas `TIRE`/`ADDITIONAL_TIRE`/`MATERIAL` en `LineaPrecio`), y la ficha ya
permite **consultar** su precio (`POST /pricing/:id/tire`). Lo que no existe es
el paso anterior: **nadie declara qué se puso**. Resultado: cada neumático real
se mete hoy como ajuste manual, que queda marcado como desviación (correcto
para lo excepcional, absurdo para lo cotidiano).

## 2. Decisión central: se declara el QUÉ, nunca el PRECIO

Quien declara —taller u operador— dice **qué concepto y cuántas unidades**.
El precio lo pone SIEMPRE el tarifario publicado, en el momento del cierre,
con la configuración congelada en `locked`. Un taller que pudiera declarar su
precio estaría escribiendo su propia factura.

Si el tarifario no tiene precio para ese concepto: importe **null** + aviso
(`TIRE_PRICE_NOT_FOUND` o el nuevo `MATERIAL_PRICE_NOT_FOUND`) + estado
`manual_review`. Nunca cero: un cero es un dato, y un dato falso es peor que
la ausencia de dato.

## 3. Quién declara: LOS DOS tipos de usuario, una sola lista

Una única lista de conceptos por asistencia, compartida. Cada apunte guarda
su origen (`lite` | `panel`) y quién lo hizo.

- **Taller (Lite)**: declara durante el servicio o al finalizar. Es quien
  sabe qué puso.
- **Operador (panel, pestaña Tarificación)**: ve la misma lista, puede
  añadir, corregir cantidad o retirar un apunte (p. ej. el taller declaró
  la medida mal por teléfono). Toda corrección queda auditada
  (`auditConnect`), pero NO es un override económico: corregir la lista
  antes de cerrar es operación normal, no desviación.

## 4. Modelo de datos

Tabla nueva `connect_assistance_concepts` (en `pricing/schema.ts`, con RLS
como el resto):

- `assistanceId`, `kind` (`TIRE` | `MATERIAL`)
- neumático: `size` (normalizada con `medidaCanonica`), `brand`
  (`normalizarMarca`) — mismas normalizaciones que catálogo y panel, para
  que "315 80 22.5" y "315/80R22.5" sean el mismo neumático
- material: `conceptCode` contra un catálogo de materiales del tarifario
  (los extras con `lineKind` de material) — no texto libre
- `quantity` (entera, > 0), `source` (`lite`|`panel`), `declaredBy`,
  `createdAtMs`, `deletedAtMs` (se retira, no se borra: la lista debe poder
  explicarse después)
- `clientActionId` único por asistencia para la idempotencia de Lite

## 5. Cuándo entra en la tarifa

- **`estimate` / `locked`**: los conceptos NO tocan el forfait. Se declaran
  cuando se sabe, se valoran al cerrar.
- **`final`**: `finalizar()` lee la lista viva y genera una línea por
  concepto, valorada a venta Y a compra (neumáticos vía
  `resolverPrecioNeumatico` con baremos/descuentos; materiales vía su
  extra). Etapa inmutable, como hasta ahora.
- **Después de `final`**: lo declarado tarde sigue yendo por ajuste manual
  auditado (`overrides.ts`), sin cambios. La espera del cierre automático
  (24 h por defecto) existe justo para que lo declarado tarde llegue antes
  del cierre.

## 6. API

- Lite (`lite.ts`): `GET/POST/DELETE /assistances/:id/concepts`, con
  `clientActionId`, dentro de `/sync` para la cola offline. El endpoint
  `finish` NO cambia de contrato: hay APKs en la calle; una APK vieja debe
  poder cerrar exactamente igual que hoy.
- Panel (`backoffice.ts`): `GET/POST/DELETE /pricing/:id/concepts`, rol
  mínimo `operator`; `provider_user` solo lectura de los suyos.
- Solo se puede declarar mientras la asistencia no tenga etapa `final`
  (409 si ya está cerrada, con mensaje que apunte al ajuste manual).

## 7. UI

- **Lite** (`finish_screen.dart` + ficha): sección "Qué has puesto" —
  medida (autocompletada contra el catálogo), marca, cantidad; materiales
  desde lista, no texto libre. Visible también antes de finalizar. La
  pantalla de cierre enseña la lista para confirmar, pero declararla no es
  requisito bloqueante de `validateFinish` (el circuito actual no puede
  romperse).
- **Panel** (`TarificacionTab.tsx`): la lista con origen y autor de cada
  apunte, edición hasta el cierre, y el precio que el tarifario les dará
  (reutilizando la consulta que ya existe) — así el operador ve ANTES de
  cerrar si algo va a salir sin precio.

## 8. Pruebas mínimas

1. Taller declara 2 neumáticos en Lite → cierre → dos líneas TIRE con venta
   y compra del tarifario congelado, estado `ok`.
2. Concepto sin precio en tarifa → línea con importes null + aviso +
   `manual_review`; jamás cero.
3. Operador corrige cantidad antes del cierre → el cierre usa la corregida;
   auditoría refleja quién y cuándo; NO aparece como override.
4. Reenvío del mismo `clientActionId` desde Lite (cola offline) → un solo
   apunte.
5. Declarar tras `final` → 409; el ajuste manual sigue funcionando.
6. APK vieja (finish sin conceptos) → cierra igual que hoy.
7. Cierre automático: asistencia con conceptos declarados dentro de la
   espera → se valoran; el pase no revienta por un concepto sin precio.

## 9. Fuera de alcance (a propósito)

- Precios declarados por el taller (ver §2).
- Fotos del neumático como evidencia del concepto (lo evidencial ya viaja
  por `/files`; enlazarlo puede venir después).
- Stock/almacén del taller: esto tarifica, no gestiona inventario.
