# PROMPT — Neumáticos identificables: genérico, todo identificado, o mixto

> Documento para decidir ANTES de tocar código. Complementa a
> `PROMPT_almacen_usados_individual.md`: aquel se preguntaba qué pasa **al
> desmontar**; este parte de la regla de negocio real, que es más simple y
> más potente — **la identidad se captura AL MONTAR**. Si eso se hace bien, el
> almacén de usados con serie y milímetros sale prácticamente solo.

## La regla de negocio

TyreControl tiene que soportar **tres modos de trabajo**, y poder pasar de uno
a otro sin romper lo que ya hay:

| Modo | Qué significa |
|---|---|
| **Genérico** | Como hasta hoy: el neumático es una unidad de un producto, sin identidad propia |
| **Identificado** | Todos los neumáticos llevan número de serie o RFID, y se siguen uno a uno |
| **Mixto** | Algunos identificados y otros genéricos, conviviendo en la misma flota |

Y una condición que atraviesa los tres: **el neumático identificable se
identifica en el momento de montarlo**, tanto si se monta *con* gestión de
stock como *sin* ella.

---

## El modelo mixto YA EXISTE — y es el único que existe de verdad

Esto es lo primero que hay que entender, porque cambia el encuadre de todo lo
demás. **No hay que construir el modelo mixto: hay que ponerle una política
encima al que ya está funcionando.**

`control_individual` **no es un ajuste por empresa: es una columna de cada
neumático**. El modelo de datos siempre ha sido mixto por naturaleza — cada
goma decide por su cuenta si tiene identidad. Y desde el panel ya se está
usando:

| Dónde | Valor por defecto | Qué hace |
|---|---|---|
| `ModalMontarFueraAlmacen.tsx:20` | **`true`** | Montar fuera de almacén sale ya marcado como individual, con sus campos de DOT, serie y RFID |
| `ModalMontarDesdeFicha.tsx:29` | `false` | Casilla *«Controlar este neumático individualmente»* que el usuario marca o no |
| `ModalCopiarNeumatico.tsx:26` | hereda | Toma el valor del neumático de origen |
| `MontajesActuales.tsx:118` | `false` fijo | Nunca identifica |

Es decir: **en la misma flota ya conviven hoy gomas identificadas y gomas
genéricas.** Eso es exactamente el modelo mixto que se pide.

Lo que **no** existe son tres cosas, y son las que lo hacen frágil:

1. **No hay política.** La identidad la decide una casilla que alguien marca o
   no marca, montaje a montaje, sin criterio escrito en ninguna parte. Dos
   administrativos con el mismo cliente pueden hacerlo distinto el mismo día.
2. **La APK no participa.** `p_control_individual: false` fijo
   (`supabase_service.dart:740` y `:772`). El taller **solo puede crear
   genéricos**: toda la identidad que hay hoy la ha metido alguien a mano desde
   el panel.
3. **Un identificado no puede volver a montarse** — el fallo de la clave
   duplicada que se explica más abajo. Hoy no ha explotado **porque casi nadie
   usa la identidad**, y quien la usa monta gomas nuevas desde el panel.

> **Comprobar en producción antes de nada:** cuántos `tc_neumaticos` tienen
> `control_individual = true`, y cuántos de ellos llevan RFID o serie de
> verdad. Eso dice si el mixto se está usando en serio o si son cuatro fichas
> sueltas — y cambia la urgencia de la fase 2.

## Y las piezas de base también están puestas

No hay que inventar el concepto. Está montado desde `fase8`:

**En la tabla** (`supabase/migrations/tyrecontrol_fase8_operaciones.sql:51`):

```sql
add column if not exists control_individual    boolean not null default false,
add column if not exists creado_automaticamente boolean not null default false,
```

**En los dos RPC de montaje** — `tc_montar_desde_almacen` (con stock) y
`tc_montar_desde_catalogo` (sin stock) reciben `p_control_individual` y hacen
exactamente lo mismo con él:

```sql
control_individual, creado_automaticamente, …
p_control_individual, not p_control_individual, …
dot          → case when p_control_individual then p_datos->>'dot'          else null end,
numero_serie → case when p_control_individual then p_datos->>'numero_serie' else null end,
rfid_epc     → case when p_control_individual then p_datos->>'rfid_epc'     else null end,
```

**Y la unicidad ya está garantizada** (`tyrecontrol_fase4.sql:39-41`):

```sql
unique (empresa_id, numero_serie) where numero_serie is not null   -- uq_tc_neu_serie
unique (rfid_epc)                 where rfid_epc     is not null   -- uq_tc_neu_rfid
```

con un trigger que convierte `''` en `NULL` para que los que no tienen dato no
choquen entre sí (`tyrecontrol_fix_rfid_serie_vacios.sql`).

Así que la base está toda puesta: la columna, el parámetro en los dos RPC, la
unicidad y la limpieza de vacíos. **Lo que falta no es fontanería, es
gobierno**: quién decide cuándo ese interruptor va a `true`, y qué pasa cuando
una goma identificada vuelve.

---

## Los tres ejes son independientes

Es la idea que hay que tener clara antes de programar. Hoy se mezclan dos
cosas que no tienen nada que ver:

| Eje | Valores | Quién lo decide |
|---|---|---|
| **Gestión de stock** | con stock (`tc_montar_desde_almacen`) / sin stock (`tc_montar_desde_catalogo`) | El producto: si existe en el almacén del cliente o solo en el catálogo |
| **Identidad** | genérico / identificable | Hoy: la casilla que marca quien monta desde el panel. Mañana: la **política** del cliente |
| **Condición** | nuevo / usado | El técnico, al montar |

Son **2 × 2 × 2 = 8 combinaciones**, todas legítimas:

```
con stock + genérico      + nuevo  ← funciona, y es lo mayoritario
con stock + genérico      + usado  ← funciona
con stock + identificable + nuevo  ← funciona hoy desde el panel
con stock + identificable + usado  ← ROTO: choca con uq_tc_neu_rfid al reencontrar
sin stock + genérico      + nuevo  ← funciona (catálogo)
sin stock + genérico      + usado  ← funciona
sin stock + identificable + nuevo  ← funciona hoy desde el panel
sin stock + identificable + usado  ← ROTO: mismo choque
```

Que un neumático sea identificable **no dice nada** sobre si descuenta stock, y
al revés. Los dos RPC tienen que soportar las cuatro combinaciones de su
columna, y hoy ya son simétricos en eso. Las dos filas marcadas como ROTO no
son funcionalidad pendiente: **son un fallo latente en producción**, y es lo
que viene ahora.

---

## El problema de fondo: montar SIEMPRE inserta una ficha nueva

Los dos RPC hacen, sin excepción:

```sql
v_numero := tc_generar_numero_interno();
insert into tc_neumaticos (…) values (…);
```

Con neumáticos genéricos eso es correcto: cada montaje es una unidad anónima
nueva y no hay nada que reencontrar. **Con identificables es directamente
incompatible.**

Escenario real, **reproducible hoy mismo desde el panel**, sin cambiar ni una
línea:

1. Se monta la goma RFID `E280…A1` en el 1234ABC. Se crea su ficha. ✅
2. Meses después se desmonta a almacén. La ficha queda con `estado='almacen'`.
3. Se vuelve a montar la misma goma en el 5678BCD. El RPC **inserta otra ficha
   con el mismo `rfid_epc`**… y salta:

```
ERROR: duplicate key value violates unique constraint "uq_tc_neu_rfid"
```

**El índice único, que está bien puesto, hace de red de seguridad: impide que
se duplique la identidad, pero a costa de reventar el montaje** con un error
crudo de Postgres en la cara del técnico. No es un fallo del índice: es que
«montar = insertar» y «neumático identificable» no pueden ser verdad a la vez.

> **Esto no es un riesgo futuro: es una bomba de relojería ya puesta.** Basta
> con que una goma montada con RFID desde «Montar fuera de almacén» —que sale
> marcada como individual **por defecto**— se desmonte y se vuelva a montar. No
> ha explotado todavía porque casi nadie usa la identidad, y quien la usa monta
> gomas nuevas. Y explica de paso por qué activar `p_control_individual` en la
> APK sin arreglar esto rompería la pantalla de Cambios el primer día.

---

## Cómo lo hacemos — cuatro piezas

### Pieza 1 — Dónde vive la política *(copiar un patrón que ya existe)*

Los tres modos no son tres códigos distintos: son **una política con
excepciones** puesta encima del mixto que ya existe. Genérico e identificado no
son modos aparte — son el mixto con la excepción vacía o con la excepción
puesta a todo. Lo que aporta esta pieza es que la decisión **deje de ser una
casilla que alguien marca a ojo** y pase a estar escrita en algún sitio.

El módulo ya tiene ese patrón resuelto para los umbrales de
profundidad (`tyrecontrol_informes_umbrales_categoria.sql:23-45`): una tabla
general por empresa, más tablas de excepción por medida y por categoría.

Se propone lo mismo, sin inventar nada:

```sql
-- General por empresa: el modo de trabajo del cliente.
create table tc_config_identificacion (
  empresa_id  uuid primary key references tc_empresas(id) on delete cascade,
  modo        text not null default 'generico'
              check (modo in ('generico','identificado','mixto')),
  -- En 'identificado': ¿se puede montar sin leer identidad?
  exigir_identidad boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- Excepción por medida, SOLO para el modo 'mixto'.
create table tc_config_identificacion_medida (
  empresa_id     uuid not null references tc_empresas(id) on delete cascade,
  medida         text not null,
  identificable  boolean not null default true,
  primary key (empresa_id, medida)
);
```

La resolución es una función de una línea de lógica, que es la que decide el
valor de `p_control_individual` **dentro del RPC** (no en la app):

```
modo = 'generico'     → false siempre
modo = 'identificado' → true  siempre
modo = 'mixto'        → lo que diga la excepción por medida; si no hay fila, false
```

**Por qué la decide el RPC y no la app:** hoy el valor lo pone quien llama —una
casilla en el panel, un `false` fijo en la APK—, así que la política dependería
de que todas las pantallas y todas las versiones de la APK instaladas estén al
día. Si la decide el servidor, un cliente puede cambiar de modo sin que nadie
actualice nada.

El parámetro se conserva en la firma como **anulación explícita**
(`null` = «aplica la política»), y esto no es opcional: los cuatro modales del
panel siguen mandando `true`/`false` a mano y **tienen que seguir funcionando
igual** el día que entre la política. Migrarlos a `null` es una decisión
posterior, modal a modal.

> **Alternativa a valorar:** que la excepción del modo mixto sea por
> **referencia/producto** en lugar de por medida. Es más fino (un modelo
> premium identificado y el resto no) pero obliga a mantener la marca en el
> catálogo, que tiene miles de filas. Por medida son diez o veinte valores y
> es lo que ya se hace con los umbrales. **Recomiendo empezar por medida** y
> añadir la excepción por referencia solo si el cliente la pide.

### Pieza 2 — Montar deja de ser «insertar» y pasa a ser «buscar o crear»

El cambio de verdad. Al principio de los dos RPC, cuando la política resuelva
identificable **y** venga identidad en `p_datos`:

```
1. Buscar por rfid_epc (índice único global).
2. Si no hay, buscar por (empresa_id, numero_serie).
3. Si aparece  → REUTILIZAR esa ficha: update estado='montado', vehiculo_id,
                 posicion_id. NO se inserta nada.
4. Si no       → insertar la ficha nueva, como hoy, con su identidad.
```

Con esto se arregla de golpe el problema 2 del documento anterior (la ficha
huérfana en almacén), porque el neumático que vuelve **es el mismo registro**:
conserva su `tc_historial_montajes`, sus operaciones, su coste y sus km. La
trazabilidad completa —«esta goma estuvo en el 1234ABC, pasó por almacén y
ahora va en el 5678BCD»— sale sola, sin ninguna tabla nueva.

**Y aquí aparece la conexión con el stock:** si la ficha reutilizada estaba en
`estado='almacen'`, esa unidad **ya se contabilizó** cuando entró. Volver a
descontarla dejaría el stock en negativo. Regla: se descuenta stock **solo
cuando se crea ficha nueva** (o cuando la que se reutiliza no venía del
almacén). Esto es exactamente el doble conteo de la Decisión 1 del otro
documento, visto desde el otro lado — **y refuerza la Opción A**: si el
identificable ya es su propia unidad de stock, no tiene sentido sumarle además
un `+1` anónimo.

### Pieza 3 — La captura en la APK, dentro del flujo que ya hay

No hace falta pantalla nueva. Hoy, al soltar una tarjeta de stock sobre una
posición (`cambio_neumatico_screen.dart:466`), si es usado se abre
`_pedirProfundidad()` y se piden los milímetros. **Ese mismo diálogo es el
sitio**: se le añaden los campos de identidad cuando la política lo pida.

```
┌─ Montar en E1_IZQ ──────────────────┐
│  Profundidad actual   [ 9,0 ] mm    │  ← ya existe
│  ─────────────────────────────────  │
│  RFID   [E280…A1  ] [📡 Leer]       │  ← nuevo, si identificable
│  Serie  [          ]                │  ← nuevo, si identificable
└─────────────────────────────────────┘
```

El botón **Leer** ya está resuelto: `RfidService.leerEpc()`
(`tyrecontrol_app/lib/services/rfid_service.dart:67`) habla con la sonda TLGX3,
que el técnico ya lleva encima y que ya se engancha sola. Es la pieza con menos
trabajo de todas y la que más cambia la experiencia: **una lectura y la goma
queda identificada de por vida**.

Un detalle importante de UX: si al leer el RFID el servidor **reencuentra** una
ficha existente, la APK debería decirlo — *«Reconocido: NT-2025-000412, 9 mm,
venía del 1234ABC»*. Es la confirmación de que la trazabilidad funciona, y
evita que el técnico piense que ha montado una goma cualquiera.

Y el mismo diálogo vale para el camino sin stock (`_montarSinStock`,
línea 1588), que hoy ya llama a `_pedirProfundidad()` igual. **Una sola pieza
de interfaz cubre las dos vías**, que es justo lo que pide el negocio.

### Pieza 4 — Identificar lo que ya está montado

Al subir la cobertura de identidad, la mayor parte de la flota está montada sin
ella — y con la APK creando solo genéricos, esa mayoría crece cada día. Sin un
camino para arreglarlo, el cliente tendría que esperar a que caiga cada rueda
para que se identifique: años.

Hace falta una acción **«Identificar esta rueda»** desde
`tire_detail_screen.dart`, con su RPC:

```sql
tc_identificar_neumatico(p_neumatico uuid, p_rfid text, p_serie text, p_dot text)
```

que pone `control_individual = true`, escribe la identidad y deja constancia en
`operaciones_neumaticos`. Sin desmontar nada. Es lo que convierte el cambio de
modo en algo gradual: el técnico va identificando en las revisiones normales, y
el informe puede decir cuánto lleva identificado el cliente.

---

## Los casos conflictivos — esto es lo que hay que decidir

Son las preguntas de negocio de verdad. El código sale solo una vez respondidas.

### C1. El RFID leído ya existe y consta MONTADO en otro vehículo

El sistema cree que esa goma está puesta en el 9999ZZZ y el técnico la tiene en
la mano frente al 1234ABC. Casi siempre significa que **el desmontaje del otro
camión no se registró**. Opciones:

- **a)** Bloquear: *«Ese RFID está montado en el 9999ZZZ, posición E2_DER»*.
  Seguro, pero deja al técnico atascado con la rueda en la mano.
- **b)** Corregir solo: desmontar del otro vehículo automáticamente, dejando la
  operación registrada como regularización. La realidad manda sobre la base.
- **c)** Preguntar: enseñar el conflicto y dejar que el técnico confirme.

> Recomiendo **c**, cayendo en **b** al confirmar. Bloquear sin salida es lo que
> hace que la gente deje de usar la herramienta.

### C2. El RFID existe pero en OTRA empresa

`uq_tc_neu_rfid` es **global, sin `empresa_id`** — a propósito, porque un RFID
es único en el mundo. Pero una goma puede cambiar de cliente (venta de camión,
cambio de flota). ¿Se traspasa la ficha cambiando `empresa_id`, llevándose la
historia? ¿O se bloquea porque nadie debería ver la historia de otro cliente?

Ojo: aquí hay una **implicación de privacidad entre clientes**. Si se traspasa,
el cliente nuevo hereda dónde estuvo montada esa goma antes. Puede ser deseable
(es la trazabilidad completa) o no serlo en absoluto.

### C3. La política dice genérico y el técnico lee un RFID igualmente

Propuesta: **guardarlo siempre**. «Identificable» debería significar
*obligatorio*, no *permitido*. Un dato que el técnico se ha molestado en
capturar no se tira. Esto hace además que el modo mixto sea el estado natural
—hay identidad donde la hubo— y que el paso a identificado sea suave.

### C4. Identificable, pero el técnico no puede leer nada

Etiqueta rota, sin serie legible, sonda sin batería. El flag
`exigir_identidad` de la política decide:

- `true` → no se puede montar sin identidad. Duro, pero es lo que quiere quien
  paga por trazabilidad total.
- `false` → se monta como genérico y **queda pendiente de identificar**, con un
  listado de pendientes para cerrarlo después.

¿Cuál es el comportamiento por defecto?

### C5. ¿Qué manda, el RFID o la serie?

Si el técnico teclea una serie que apunta a la ficha A y lee un RFID que apunta
a la ficha B, hay dos gomas distintas reclamando ser la misma. Propuesta:
**el RFID manda** (es único global y no se teclea mal), y la discrepancia se
avisa en vez de resolverse en silencio.

---

## Trampas del código a tener presentes

1. **`chk_tc_neu_origen` se ha redefinido tres veces** —
   `fase8_operaciones.sql:56`, `stock_usado.sql:19`,
   `montar_desde_catalogo.sql:14`— y cada `drop constraint` + `add constraint`
   tiene que **repetir la lista entera** de valores. Si esta tanda añade
   orígenes (`almacen_identificado`, `catalogo_identificado`… si es que hacen
   falta), hay que arrastrar todos los anteriores o los montajes viejos dejan de
   validar.

2. **Firmas duplicadas de los RPC.** Ya pasó:
   `tyrecontrol_profundidad_manual.sql:62-95` documenta tres versiones de
   `tc_montar_desde_almacen` conviviendo en producción, una de las cuales
   perdía la profundidad **en silencio**. Al cambiar la firma para la política,
   **dropear las viejas explícitamente** y dejar el mismo
   `do $$ … raise warning` de comprobación al final.

3. **El trigger de vacíos es imprescindible.** Ya pasó con el panel: el
   formulario «Montar fuera de almacén» mandaba `""` en RFID y serie cuando no
   se rellenaban, y dos neumáticos sin RFID chocaban en el índice único
   (`tyrecontrol_fix_rfid_serie_vacios.sql`, la cabecera lo cuenta entero). La
   APK caerá en lo mismo en cuanto tenga los campos. El trigger
   `tc_neumaticos_normaliza_vacios` ya lo cubre — **no hay que puentearlo** con
   `insert … on conflict` ni cosas por el estilo.

4. **`creado_automaticamente = not p_control_individual`** ya distingue «ficha
   que se inventó el sistema» de «ficha real de un neumático que alguien tuvo
   en la mano». Sirve tal cual para los informes de cobertura; no hace falta
   columna nueva.

5. **`profundidad_actualizada_en`** y su trigger
   (`tyrecontrol_profundidad_manual.sql`) siguen mandando: al reutilizar una
   ficha, la profundidad que teclee el técnico al montar **debe** pasar por
   `profundidad_actual_mm` para que el trigger la feche y gane a la medición
   vieja. Si se escribe por otro camino, vuelve el bug de los 16 mm.

6. **Hay cuatro sitios en el panel que ya escriben `control_individual`** —
   `ModalMontarFueraAlmacen`, `ModalMontarDesdeFicha`, `ModalCopiarNeumatico` y
   `MontajesActuales`— con criterios distintos y uno de ellos (`FueraAlmacen`)
   con `true` por defecto. **Ninguno puede dejar de funcionar** al entrar la
   política, y conviene decidir de una vez si sus valores se respetan como
   anulación manual o se migran a `null` para que mande la política.

---

## Orden propuesto

**El orden cambia respecto a lo que parecía al principio.** Como el mixto ya
existe y ya está roto para el usado, «buscar o crear» deja de ser preparación
para lo nuevo y pasa a ser **corrección de un fallo en producción**. Va primero.

| Fase | Qué entra | Se puede entregar solo |
|---|---|---|
| 1 | **«Buscar o crear» en los dos RPC** + regla de descuento de stock. Arregla el choque de clave duplicada que ya existe. Sin identidad que buscar, se comporta igual que hoy | ✅ |
| 2 | Política: tablas + función de resolución + pantalla en Configuración. Arranca respetando lo que cada modal manda hoy → **cero cambio de comportamiento** | ✅ |
| 3 | Captura en la APK: campos + botón Leer RFID + aviso de «reconocido». Es lo que deja de convertir cada montaje de taller en un genérico | ✅ |
| 4 | Resolución de conflictos C1/C2 según lo decidido | ✅ |
| 5 | «Identificar esta rueda» sobre lo ya montado + listado de pendientes | ✅ |
| 6 | Almacén de usados por serie y profundidad (el otro documento) — que a estas alturas es **solo la pantalla**, porque el dato ya existe | ✅ |

Las fases 1 y 2 son invisibles para el usuario: arreglan y preparan sin cambiar
nada de lo que ve hoy. Es lo que permite subirlas sin riesgo y decidir lo demás
con calma.

**Antes de la fase 1, mirar producción:** cuántos `tc_neumaticos` tienen
`control_individual = true`, cuántos de ellos llevan RFID o serie real, y si
alguno de esos ya ha pasado por almacén. Ese último número dice si el fallo del
duplicado es teórico o si a alguien ya le ha reventado un montaje sin que
llegara el aviso.

---

## Preguntas abiertas para el cliente

- **¿Quién decide el modo, y con qué grano?** ¿Por empresa cliente entera, o
  puede una misma empresa llevar identificadas solo las tractoras y genéricos
  los remolques? *(La propuesta de por-medida cubre lo segundo.)*
- **¿Qué se hace con la identidad que ya hay?** El mixto lleva tiempo en
  marcha decidido a ojo desde el panel. Si un cliente pasa a modo `generico`,
  ¿esas gomas pierden la identidad, o se respeta lo ya capturado? *(La
  propuesta de C3 —guardar siempre lo que se lea— dice que se respeta.)*
- **¿Serie o RFID?** ¿Se aceptan las dos, o el cliente que va a identificado se
  compromete a poner RFID a todo? Cambia mucho el diálogo de la APK.
- **El DOT no identifica**: dos gomas del mismo lote comparten DOT. Sirve como
  dato de fabricación, no como identificador — está tratado así en toda la
  propuesta. Confirmar que se entiende igual.
- **C2, el traspaso entre clientes**, es la única pregunta con implicaciones de
  privacidad. Conviene responderla antes de la fase 2, porque condiciona si el
  «buscar» filtra por `empresa_id` o no.
