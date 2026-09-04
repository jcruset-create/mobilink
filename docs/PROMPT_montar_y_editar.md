# Montar la rueda nueva, y poder corregir lo ya hecho

Prompt de trabajo. **Nada de esto está programado todavía.** Escrito después de
leer el código, no de imaginarlo: cada pieza que se cita aquí existe y se
nombra tal cual está en el repositorio.

---

## 1. Lo que se pide

> Falta la acción de montar la nueva o la usada en la posición que la
> desmontamos, deberíamos cogerla del almacén del cliente si tiene disponibles
> o del catálogo de neumáticos. También tenemos que hacer la foto obligatoria
> del número de serie de los neumáticos que vamos a montar, sea nuevo o usado.
> Yo haría debajo de la primera pantalla el mismo circuito: elegir la posición
> del neumático, se abre la pantalla, elegimos el neumático que vamos a montar
> del almacén del cliente si tiene, nuevo o usado, y después hacer la foto. Si
> es nuevo tiene que aparecer en el formulario. Si montamos 2 del mismo tipo
> los une en el formulario PDF.
>
> También quiero poder editar las operaciones ya realizadas desde el menú
> histórico, en la tablet y en la app de escritorio.

Son **dos trabajos distintos** y conviene no mezclarlos: el primero añade algo
que falta, el segundo toca cosas que ya están escritas en la base de datos. El
segundo es mucho más delicado de lo que parece, y la sección 5 explica por qué.

---

## 2. Lo que YA existe. No hay que inventar nada de esto

Media petición está hecha. Merece la pena decirlo con nombres, porque el riesgo
aquí no es no saber hacerlo: es hacerlo **otra vez, en paralelo**.

| Pieza | Dónde está | Qué hace |
|---|---|---|
| `tc_stock_almacen_empresa(p_empresa)` | RPC | Stock del almacén del cliente por producto, con `nuevo` y `usado` contados aparte |
| `TyreControlApi.stockAlmacenEmpresa()` | APK | Ya llama al anterior y devuelve `StockAlmacenLinea` |
| `tc_montar_desde_almacen(...)` | RPC | Monta desde el almacén, descuenta stock, elige la ficha del usado |
| `tc_montar_desde_catalogo(...)` | RPC | Monta SIN control de stock, marcando origen `catalogo_sin_stock` |
| `TyreControlApi.montarDesdeAlmacen()` / `montarDesdeCatalogo()` | APK | Ya envuelven las dos |
| `_ElegirReferencia` | `realizar_operacion_screen.dart` | Buscador del catálogo, ya escrito para la declaración |
| `cambio_neumatico_screen.dart` | APK | **Ya hace este circuito entero** para el cambio rápido: stock, nuevo/usado, identidad, montaje |
| `p_datos.numero_serie` / `p_datos.dot` | Los dos RPC de montaje | El número de serie entra AL CREAR la ficha; no hace falta migración |
| `pideIdentidad(empresa, medida)` | APK → `tc_identificacion_resuelve` | Si la empresa exige identificar esa medida |
| `agruparNuevos()` | `armarParte.ts` | **Ya agrupa los nuevos por marca+medida+modelo con su cantidad** |
| `tc_despachar_ejecucion` | RPC | Ya conoce los dos montajes: el parte guiado puede emitirlos como acción |

Consecuencia importante para el que programe esto: **«si montamos 2 del mismo
tipo los une en el formulario PDF» ya funciona.** `agruparNuevos` agrupa por
marca, medida y modelo y cuenta unidades. Lo que hay que hacer es comprobarlo
con dos montajes iguales, no escribirlo otra vez.

Y **«si es nuevo tiene que aparecer en el formulario» también**: la tabla de
nuevos del PDF se llena con las filas cuyo `es_nuevo` es cierto, y eso se
decide por el marcador `[USADO]` que los propios RPC de montaje escriben en las
observaciones de la operación cuando `p_condicion = 'usado'`. Hay que
**verificarlo**, no rehacerlo.

---

## 3. Trabajo A — montar en el parte guiado

### Cómo debe verse

Tal y como lo describe el usuario, y encaja con lo que la pantalla ya hace: en
el paso 3 («Las ruedas»), al tocar una rueda se abre su ficha. Hoy, si la rueda
tiene goma, ofrece *Solo revisar / Desmontar / Mover a otra posición / Reparar*.
Falta **Montar** para el hueco que deja un desmontaje dentro del mismo parte.

Ahora mismo la ficha decide qué acciones ofrecer con `_accionesPara({hayNeumatico})`:
con goma no ofrece montar, sin goma solo ofrece montar. Eso deja fuera el caso
real: **una rueda que se desmonta Y se sustituye**. Hay dos formas de resolverlo
y hay que elegir una:

1. **Desmontar y montar como dos acciones de la misma rueda.** El operario
   marca «Desmontar», rellena razón, destino y fotos, y debajo aparece «Y monto
   esta»: elige del almacén o del catálogo y hace la foto del serie de la que
   entra. Es lo que pide el usuario («debajo de la primera pantalla el mismo
   circuito»).
2. **Una acción «Sustituir»** que pida las dos cosas de golpe. Se parece más a
   `tc_sustituir_neumatico`, que existe, pero rompe la simetría con lo ya
   escrito y obliga a rehacer la validación.

**Recomendación: la 1.** Reutiliza todo lo que ya hay y el parte sigue siendo
una lista de acciones independientes, que es como lo guarda
`tc_guardar_parte_guiado`.

### De dónde sale la goma que entra

El usuario lo dice claro y el orden importa:

1. **Del almacén del cliente**, si tiene disponibles. Es lo que descuenta stock
   y lo que hace que el inventario cuadre. Se listan las líneas de
   `tc_stock_almacen_empresa` con sus existencias de nuevo y de usado.
2. **Del catálogo**, si no hay. Monta sin control de stock, y así queda marcado
   (`catalogo_sin_stock`), que es justo lo que el panel necesita para saber que
   esa goma no salió de ningún sitio contado.

Lo que NO hay que hacer: enseñar el catálogo primero, ni mezclarlos en una sola
lista. Si se montan del catálogo gomas que estaban en el almacén, el stock del
cliente se queda con existencias que ya no están, y eso no se descubre hasta
cuadrar un inventario.

**Duda que hay que resolver antes de programar:** si el almacén tiene stock de
esa medida pero el operario elige el catálogo igualmente, ¿se le deja? Yo diría
que sí pero avisando («hay 4 en el almacén del cliente»), porque el que está
delante del camión ve cosas que el sistema no. Pero es una decisión de negocio.

### La foto del número de serie de la que entra

Obligatoria, sea nueva o usada. Igual que la de la que sale, que ya está hecha:
se hace la foto, se sube, el lector de flanco propone el número de serie y el
DOT, y el técnico confirma o corrige en un campo editable.

La diferencia con la de salida es **dónde aterriza**: aquí no hace falta ninguna
migración, porque los dos RPC de montaje aceptan `p_datos.numero_serie` y
`p_datos.dot` y crean la ficha del neumático ya con ellos.

**Cuidado con esto y hay que comprobarlo antes:** `tc_neumaticos` tiene índices
únicos parciales sobre `numero_serie` y `rfid_epc`
(`tyrecontrol_fix_rfid_serie_vacios.sql`). Si la IA lee mal dos ruedas iguales y
propone el mismo número, el segundo montaje **falla y se cae el parte entero**,
porque todo va en una transacción. Antes de dar esto por bueno hay que decidir
qué pasa en ese caso: lo razonable es avisar en la tablet cuando dos ruedas del
mismo parte llevan el mismo serie, antes de guardar, y no descubrirlo al final.

---

## 4. Trabajo A, la parte de la base de datos

Muy poca, y esa es la buena noticia.

Las acciones del parte guiado se despachan por `tc_ejecutar_en_intervencion`,
que ya conoce `tc_montar_desde_almacen` y `tc_montar_desde_catalogo`. La tablet
solo tiene que emitir una acción más en la lista, después del desmontaje de esa
misma rueda.

Hay **un detalle de orden** que no se puede pasar por alto: dentro de un parte,
para una misma posición, el desmontaje tiene que ir ANTES del montaje. Si no,
`tc_montar_desde_almacen` levanta «La posición ya tiene un neumático montado» y
se deshace el parte entero. Hoy `_acciones()` recorre las ruedas y emite una
acción por rueda; con dos acciones por rueda hay que garantizar el orden, y
hay que **probarlo en el banco**, no confiar en que el mapa las devuelva en
orden.

---

## 5. Trabajo B — editar operaciones ya realizadas

Aquí es donde hay que parar y hablar, porque «editar» significa tres cosas muy
distintas y solo una de ellas es fácil.

### Lo que hay hoy

- **`tc_anular_operacion(operacion, motivo)`** — marca la operación como
  anulada, deja rastro en `tc_operacion_auditoria` y libera reservas. **NO
  deshace el movimiento**: la goma sigue desmontada, el stock sigue descontado.
  Solo administradores.
- **`tc_deshacer_ultima_operacion(vehiculo, desde)`** — esta sí revierte de
  verdad, stock incluido, pero solo **la última** operación del vehículo. Es una
  pila: no sirve para corregir algo de hace tres días.

### Las tres cosas que puede querer decir «editar»

**(a) Corregir un DATO que no movió nada.** La razón de sustitución, el destino,
las observaciones, el número de serie o el DOT mal leídos, la profundidad
apuntada, el coste. Nada de esto cambió dónde está la goma.

**(b) Deshacer un MOVIMIENTO.** «Esta rueda no era la que desmontamos», «se
montó en el eje 2 y fue en el 3». Esto sí mueve gomas y stock.

**(c) Añadir lo que faltó.** «Se me olvidó apuntar que también cambiamos la del
eje 3.»

**(a) es segura. (b) es peligrosa. (c) es un parte nuevo.**

Por qué (b) es peligrosa, con un ejemplo concreto: si el lunes se desmontó una
goma y volvió al almacén como usada, y el martes esa misma goma se montó en
otro camión, «editar» el desmontaje del lunes tendría que deshacer también el
montaje del martes. Nadie va a mirar eso a mano, y la base de datos no lo
impide. Por eso `tc_deshacer_ultima_operacion` solo deshace la última: es la
única que se sabe que no tiene nada encima.

Y hay una trampa más pequeña pero real en (a): **el destino y el estado del
neumático son dos columnas distintas.** El destino («Carcasa a Continental») se
guarda en la operación; el estado de la goma (`pendiente_recauchutado`) está en
su ficha. Cambiar solo el destino deja las dos contando cosas distintas. O se
cambian los dos, o el desplegable de destino no se puede editar.

### Lo que propongo para la primera versión

Que el usuario lo confirme, porque es una decisión suya:

- **Sí:** corregir razón, observaciones, número de serie, DOT y profundidad.
  Con motivo obligatorio y rastro en `tc_operacion_auditoria`, que ya existe
  para esto.
- **Sí:** anular una operación con motivo — que es lo que ya hace el panel—,
  dejando claro en la pantalla que **anular no devuelve la goma a su sitio**.
  Hoy eso no se dice en ninguna parte y es justo lo que la gente asume.
- **No todavía:** cambiar la posición, el neumático o el destino de una
  operación ya hecha. Eso es deshacer y rehacer, y necesita su propio diseño.
- **No:** editar nada de una intervención **cerrada y facturada**. Hace falta
  saber si eso existe como estado.

### Quién puede

Hoy anular es solo de administradores, y tiene sentido. Pero el usuario pide
poder editar **desde la tablet**, donde quien está es el técnico. Hay que
decidir:

- ¿El técnico corrige lo suyo del mismo día y el administrador cualquier cosa?
- ¿O toda corrección es del administrador y en la tablet solo se consulta?

**No se amplía `tc_neu_write` ni ninguna política de tabla para resolver esto.**
Si hace falta que el técnico corrija, se hace con una función acotada y
`security definer`, como ya se hizo con el alta de vehículos y con el número de
serie del parte.

---

## 6. Preguntas que necesito contestadas antes de programar

1. Si hay stock en el almacén del cliente, ¿se puede montar del catálogo
   igualmente (avisando), o se bloquea?
2. Al montar del almacén un **usado**, ¿hay que pedir la profundidad real
   medida? El RPC la acepta (`profundidad_actual_mm`) y sin ella la ficha nace
   sin milímetros.
3. Editar: ¿de acuerdo con dejar la primera versión en «corregir datos y
   anular», sin mover gomas?
4. ¿Quién puede corregir desde la tablet: el técnico que lo hizo, o solo
   administradores?
5. ¿Existe un estado «facturado» a partir del cual no se toca nada?

---

## 7. Lo que NO entra en esta primera versión

- Deshacer o rehacer movimientos de una operación antigua.
- Editar una intervención cerrada más allá de corregir datos.
- Cualquier catálogo, almacén o sistema de fotos nuevo. Los que hay son los que
  hay.
- Ampliar permisos de tabla para que el técnico pueda editar.

---

## 8. Cómo se comprobará

Nada de esto se da por bueno porque compile.

- **Banco del parte guiado** (`supabase/pruebas/parte_guiado_guardar.sql`):
  desmontar y montar la misma rueda en un solo parte, comprobando el orden;
  montar del almacén descontando stock; montar del catálogo sin tocarlo; dos
  montajes iguales agrupados en el PDF con cantidad 2.
- **PDF**: generar uno con dos montajes nuevos iguales y **mirarlo**
  rasterizado, que es como se ha cazado todo lo del papel hasta ahora.
- **Flutter**: `analyze` limpio y compilación.
- **Lo que no se puede probar aquí** y hay que decirlo al entregar: el stock
  real del cliente y la lectura de la IA sobre fotos de verdad. El entorno de
  desarrollo no llega al Supabase de producción.
