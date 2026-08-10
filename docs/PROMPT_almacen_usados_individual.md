# PROMPT — El almacén de usados tiene que guardar neumáticos, no cantidades

> Documento para decidir ANTES de tocar código. Lo que se pide no es una
> pantalla nueva: es un cambio en cómo el almacén entiende qué es una unidad.
> Hoy el almacén cuenta *piezas intercambiables*; se pide que guarde
> *neumáticos concretos, cada uno con su historia y sus milímetros*.

## Lo que se pide

1. Si el neumático se controla por matrícula, DOT o RFID, al guardarlo en el
   **almacén del cliente** tiene que entrar **individualmente**, y ya con la
   **profundidad que le queda**.
2. Si además se ha **reesculturado después de desmontarlo**, tiene que existir
   un **almacén de usados** consultable, **ordenado por número de serie y/o por
   profundidad**.

---

## Cómo está montado hoy

TyreControl vive sobre **dos mundos que no se hablan**, y ahí está todo el
problema.

### Mundo 1 — `tc_neumaticos`: sí tiene identidad

`supabase/migrations/tyrecontrol_fase4.sql` — una fila por neumático físico:

```
numero_serie · dot · rfid_epc · marca · modelo · medida
profundidad_actual_mm · profundidad_actualizada_en · reesculturado
girado_en_llanta · estado ('almacen','reservado','montado','reparacion','descartado')
```

Este mundo ya sabe lo que se pide: quién es el neumático y cuánto dibujo le
queda. La columna `profundidad_actualizada_en`
(`supabase/migrations/tyrecontrol_profundidad_manual.sql:26`) incluso resuelve
ya el conflicto entre «lo que midió la sonda» y «lo que tecleó el técnico».

### Mundo 2 — `movimientos_stock`: solo cuenta unidades

El almacén del cliente es un **libro de cantidades**, no un registro de piezas:

```
empresa_id · cliente_id · producto_id · tipo ('ENTRADA'|'SALIDA')
cantidad · ubicacion · condicion ('nuevo'|'usado')
```

`condicion` se añadió en `supabase/migrations/tyrecontrol_stock_usado.sql` para
que el usado no se mezcle con el nuevo. Fue el paso correcto, pero se quedó a
medias: **separa el usado del nuevo, pero sigue sin distinguir un usado de
otro**. No hay `numero_serie`, ni `dot`, ni `rfid_epc`, ni
`profundidad_actual_mm` en ninguna parte del stock.

### La costura entre los dos

`tc_devolver_usado_a_stock`
(`supabase/migrations/tyrecontrol_stock_usado.sql:143`, reescrita en
`tyrecontrol_devolver_usado_match.sql`) es el único puente. Al desmontar a
almacén hace exactamente esto:

```sql
insert into movimientos_stock (…, tipo, cantidad, ubicacion, condicion, …)
values (…, 'ENTRADA', 1, 'USADOS', 'usado', …);
```

**+1 unidad anónima en la ubicación `USADOS`.** El neumático entra en el
almacén habiendo perdido por el camino su serie, su DOT, su RFID, su
profundidad y su historia. En la observación queda el `numero_interno` como
texto libre — es un rastro, no un enlace.

---

## Los cinco problemas concretos

### 1. El mismo neumático existe dos veces

Al desmontar a almacén, `tc_desmontar_neumatico`
(`tyrecontrol_stock_usado.sql:196`) hace dos cosas a la vez:

- deja la fila de `tc_neumaticos` viva con `estado='almacen'`, conservando
  identidad y profundidad;
- suma `+1` anónimo al stock de usados.

La misma goma está contada **dos veces**: como neumático identificado en
`tc_neumaticos` y como unidad anónima en `movimientos_stock`. Cualquier
inventario que sume los dos mundos sale mal.

### 2. Volver a montar un usado **inventa un neumático nuevo**

`tc_montar_desde_almacen` no busca al neumático que ya está en el almacén:
hace `insert into tc_neumaticos` con un `numero_interno` recién generado
(`tyrecontrol_stock_usado.sql:95`). Consecuencias:

- El neumático desmontado se queda **huérfano para siempre** en
  `estado='almacen'`: nadie lo volverá a montar nunca, porque montar crea otro.
- La cadena se rompe: no se puede responder *«esta goma estuvo en el 1234ABC,
  pasó por almacén y ahora va en el 5678BCD»*. Con ella se pierden el coste por
  neumático, los km reales y la vida útil — justo lo que justifica llevar
  control individual.

### 3. Desde la APK **nunca** se guarda la identidad

`tyrecontrol_app/lib/services/supabase_service.dart:740` y `:772`:

```dart
'p_control_individual': false,
```

Está fijado a `false` en los dos caminos (almacén y catálogo). Dentro del RPC,
ese `false` hace que `numero_serie`, `rfid_epc`, `indice_carga` y demás se
graben como `null`. Es decir: **el técnico, que es el único que tiene el
neumático en la mano y la sonda TLGX3 con lector RFID
(`tyrecontrol_app/lib/services/rfid_service.dart:67`, `leerEpc`), es
precisamente quien no puede registrar la identidad.**

### 4. Un neumático en almacén **no se puede reesculturar**

La reescultura es hoy una acción del plan de trabajo
(`supabase/migrations/tyrecontrol_plan_trabajo.sql:135`):

```sql
update tc_neumaticos n set profundidad_actual_mm = coalesce(x.valor, …),
                           reesculturado = true
  from … join tc_montajes_actuales m on m.id = x.montaje
```

Exige un `tc_montajes_actuales`, y la cabecera del fichero lo dice sin rodeos:
*«El reesculturado y el giro se hacen EN EL CAMION: la rueda no sale del
vehículo»*. Es una decisión de diseño, no un olvido. Pero **lo que se pide es
justo el caso contrario**: reesculturar después de desmontar, con la goma ya en
el almacén. Hoy no hay ningún camino para eso — ni RPC, ni pantalla.

### 5. No existe la pantalla de almacén de usados

- `src/modules/tyrecontrol/pages/Neumaticos.tsx` lista `tc_neumaticos` con
  filtro por estado, pero es el maestro de neumáticos de la empresa, no un
  almacén: no ordena por profundidad ni separa lo reesculturado.
- `src/modules/almacen-neumaticos/pages/StockOperativo.tsx` es cantidades por
  producto: por definición no puede enseñar series ni milímetros.
- `listarNeumaticosDisponibles` (`src/modules/tyrecontrol/services/data.ts:476`)
  ya trae los de `estado in ('almacen','reservado')`… y **ninguna pantalla la
  usa** para esto.

El dato está a medias en la base; lo que falta es unificarlo y enseñarlo.

---

## Qué hay que decidir

### Decisión 1 — Dónde vive la unidad individual *(la importante)*

**Opción A — `tc_neumaticos` es la unidad; `movimientos_stock` solo valora.**
El neumático desmontado no genera `+1` anónimo: se queda en `tc_neumaticos` con
`estado='almacen'` y un `ubicacion_almacen`. El stock de usados **se calcula
contando filas de `tc_neumaticos`**, no sumando movimientos.

- ✅ Una sola verdad. Mata el doble conteo (problema 1) de raíz.
- ✅ La identidad y la profundidad ya están ahí: no hay que duplicar columnas.
- ✅ El histórico (`tc_historial_montajes`) sigue colgando del mismo `id`.
- ⚠️ Hay que **desactivar `tc_devolver_usado_a_stock`** y migrar los `USADOS`
  ya acumulados en producción, que hoy no se pueden casar con su neumático
  (solo queda el `numero_interno` en la observación — recuperable, pero a mano).
- ⚠️ El módulo de almacén (`almacen-neumaticos`) tendría que leer de
  TyreControl para el usado. Hoy no lo hace.

**Opción B — `movimientos_stock` gana columnas de identidad.**
Añadir `neumatico_id`, `numero_serie`, `profundidad_mm` a los movimientos de
`condicion='usado'`.

- ✅ El almacén sigue siendo el dueño de su stock; menos cambios de reparto.
- ❌ Duplica el dato que ya está en `tc_neumaticos` → dos sitios que pueden
  discrepar, y discreparán en cuanto alguien reesculture.
- ❌ No arregla el doble conteo: solo lo hace más difícil de ver.
- ❌ `movimientos_stock` es un libro de asientos; meterle estado mutable
  (la profundidad cambia con cada reescultura) va contra su diseño.

**Opción C — Tabla nueva `tc_stock_usado`,** una fila por goma en almacén, con
FK a `tc_neumaticos`.

- ✅ No toca ninguno de los dos mundos.
- ❌ Un tercer sitio donde vive la profundidad. Es la opción A con una tabla de
  más en medio.

> **Recomendación: A.** Es la única que deja una sola fuente de verdad, y el
> trabajo ya hecho (`profundidad_actualizada_en`, `estado='almacen'`,
> `tc_historial_montajes`) está construido para ella. Las otras dos crean el
> problema que `tyrecontrol_profundidad_manual.sql` acaba de costar arreglar:
> dos datos compitiendo por decir cuántos milímetros quedan.

### Decisión 2 — Qué neumáticos van individualizados

`p_control_individual` ya existe pero llega siempre `false`. Hay que decidir el
criterio y **quién lo decide**:

- **a)** Todo lo usado va individual; lo nuevo sigue por cantidad. *(Encaja con
  lo pedido: el problema aparece al desmontar.)*
- **b)** Por empresa: interruptor en `tc_empresas`.
- **c)** Por medida/producto: solo camión, no turismo.

Y en la APK: al desmontar a almacén, **¿se obliga a leer RFID o teclear serie?**
¿Se permite «no lo sé» y queda pendiente de identificar?

### Decisión 3 — Reesculturar fuera del camión

Hoy solo existe dentro de `tc_aplicar_plan_trabajo`. Hace falta:

- un RPC `tc_reesculturar_en_almacen(p_neumatico, p_profundidad_mm, p_obs)`
  que exija `estado='almacen'`, escriba `profundidad_actual_mm` (el trigger
  actualizará `profundidad_actualizada_en` solo) y marque `reesculturado=true`;
- una operación registrada en `operaciones_neumaticos` con el tipo
  `'reesculturado'` **que ya está dado de alta**
  (`tyrecontrol_plan_trabajo.sql:32`), para que aparezca en el histórico y en el
  informe ejecutivo, que ya cuenta reesculturados
  (`tyrecontrol_informe_ejecutivo.sql:217`);
- decidir si se puede reesculturar **dos veces** la misma goma. Hoy
  `reesculturado` es un `boolean`: no distingue una reescultura de tres. ¿Se
  deja como está, o pasa a contador `reesculturas int`?

### Decisión 4 — Qué enseña la pantalla de usados

Lo pedido es «ordenados por número de serie y/o profundidad». A concretar:

- Columnas: serie · DOT · RFID · marca/modelo/medida · **mm actuales** ·
  reesculturado · último vehículo · fecha de desmontaje · ubicación.
- Orden y filtros: por profundidad (descendente, para elegir la que mejor case
  con el eje), por serie, por medida, por reesculturado sí/no.
- Semáforo de mm: **reutilizar `src/modules/tyrecontrol/utils/profundidad.ts`**,
  que ya aplica la misma regla que la APK — no inventar umbrales nuevos.
- ¿Panel, APK o los dos? El técnico que busca una rueda usada para montar la
  necesita **en la APK**, no en el panel.

### Decisión 5 — Montar un usado identificado

Cuando la pantalla de usados existe, montar deja de ser «elige producto +
teclea mm» y pasa a ser «elige **esta** goma». Eso significa un RPC nuevo
—`tc_montar_neumatico_existente(p_neumatico, p_vehiculo, p_posicion, …)`— que
**reutiliza la fila** en vez de crear otra, y que respeta lo que
`tc_montar_desde_almacen` ya hace bien: comprobación de permisos, medida
homologada con `tc_medida_compatible`, autorización si se fuerza, y el asiento
en `operaciones_neumaticos`.

Ojo con `tyrecontrol_profundidad_manual.sql:62-95`: hubo **tres firmas** de
`tc_montar_desde_almacen` conviviendo en producción y una de ellas perdía la
profundidad en silencio. Al añadir el RPC nuevo, **una firma y solo una**, y
comprobarlo con el mismo `do $$ … raise warning` del final de ese fichero.

---

## Orden propuesto

| Fase | Qué entra | Por qué primero |
|---|---|---|
| 1 | Identidad al desmontar: `p_control_individual` real desde la APK, lectura RFID/serie, `ubicacion_almacen` en `tc_neumaticos` | Sin esto no hay nada que listar |
| 2 | Fin del doble conteo: `tc_devolver_usado_a_stock` deja de sumar anónimos; stock de usados = filas de `tc_neumaticos` | Es la corrección de datos; cuanto antes, menos que migrar |
| 3 | Pantalla de almacén de usados (panel + APK), ordenable por serie y profundidad | Lo que se ve y se pidió |
| 4 | `tc_reesculturar_en_almacen` + su reflejo en la pantalla | Necesita 1 y 3 hechos |
| 5 | `tc_montar_neumatico_existente`: cerrar el ciclo reutilizando la goma | Cierra la trazabilidad completa |

## Antes de programar, comprobar en producción

1. Cuántas entradas `ubicacion='USADOS'` hay ya acumuladas y cuántas se pueden
   casar con su `numero_interno` desde `observaciones`.
2. Cuántas filas de `tc_neumaticos` están en `estado='almacen'` **huérfanas**
   (creadas por un desmontaje y nunca vueltas a montar). Es la medida exacta
   del problema 2.
3. Si algún cliente ya usa `numero_serie` o `rfid_epc` con datos reales, o
   están todos a `null` — decide si la fase 1 arranca de cero o migra algo.

---

## Preguntas abiertas para el cliente

- El **DOT** identifica la semana de fabricación, no la unidad: dos gomas del
  mismo lote comparten DOT. Para identificar de verdad hacen falta **serie o
  RFID**. ¿Se asume, o hay que generar una etiqueta propia (el `numero_interno`
  ya existe y es único) cuando no haya ninguno de los dos?
- La **matrícula** identifica el vehículo, no el neumático: en cuanto la goma
  entra en el almacén deja de valer. Sirve como *procedencia* («venía del
  1234ABC»), y así está planteada aquí. ¿Es lo que se espera?
- Un usado desmontado, ¿es del **cliente** que lo traía o pasa a un fondo común
  del almacén? Hoy `tc_neumaticos.empresa_id` dice que es del cliente, y
  `movimientos_stock.cliente_id` también. Si se quiere poder montar el usado de
  un cliente en el camión de otro, eso es un cambio aparte y bastante más
  gordo.
