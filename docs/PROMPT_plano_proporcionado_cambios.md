# PROMPT — El plano del camión sale estirado en la pantalla de Cambios

> Documento de opciones para decidir ANTES de tocar código. El estiramiento no
> es un descuido: se puso a propósito y resuelve un problema real. Quitarlo sin
> más devuelve ese problema. Hay que elegir con qué se sustituye.

## El síntoma

En `Cambiar · 2222ABC`, sobre una tablet en horizontal, el camión sale
ensanchado: las ruedas parecen ovaladas y el chasis, gordo. En la pantalla de
**Revisión** el mismo vehículo sale bien.

## Por qué pasa

`tyrecontrol_app/lib/screens/cambio_neumatico_screen.dart:661` — `_plano()`:

```dart
double ox = 0, oy = 0, iw = w, ih = h;   // ← ocupa TODA el área disponible
if (_ejesSeparados) { …contain… }        // solo la imagen especial respeta aspecto
…
Image.network(_imagenChasis!, width: iw, height: ih, fit: BoxFit.fill)
```

Con la imagen normal, el rectángulo de dibujo es el área entera y `BoxFit.fill`
deforma lo que haga falta para llenarlo. El comentario del código dice para qué
se hizo: *«se estira a todo el alto para separar los ejes y aprovechar la
tablet vertical»*. Y ahí está la clave: **se pensó para la tablet en
vertical**.

- **Tablet en vertical** — el área es alta y estrecha. La imagen (aspecto ≈0,62,
  vertical) se estira **a lo alto**: los ejes se separan, las tarjetas dejan de
  pisarse. Es el efecto que se buscaba y funciona.
- **Tablet en horizontal** (la de la foto) — el área es ancha y baja. La misma
  fórmula estira **a lo ancho**. Nadie quería eso: es el camión gordo.

No hay bloqueo de orientación en la app (`main.dart` no llama a
`SystemChrome.setPreferredOrientations`), así que las dos situaciones son reales
y el técnico se encuentra una u otra según cómo agarre la tablet.

Por comparación, `widgets/vehicle_layout_image.dart:104-113` (el plano de
Revisión) siempre respeta el aspecto. Por eso allí las ruedas salen redondas:
**Cambios es la única pantalla que deforma**.

## Un dato que quita miedo

Las tarjetas de posición se colocan en **porcentaje del rectángulo de la
imagen** (`_coords` + `_tarjetaPosicion`, línea 697). Cambiar el tamaño de ese
rectángulo **no descalibra nada**: las tarjetas siguen a la imagen. La
calibración hecha en el panel web sigue valiendo con cualquiera de las opciones
de abajo.

El remap `_remapCambioY` (línea 713) solo actúa cuando `_ejesSeparados` es
true, y ese camino ya respeta el aspecto hoy. Ninguna opción lo toca salvo la 3.

---

## Opciones

### Opción A — Respetar siempre el aspecto (`contain` puro)

Aplicar a la imagen normal el mismo cálculo que ya tiene la de ejes separados.

- **Coste**: borrar la condición `if (_ejesSeparados)`. Cinco minutos.
- **A favor**: ruedas redondas siempre; una sola regla en toda la app; Cambios
  y Revisión pasan a verse igual.
- **En contra**: en vertical se pierde lo que el estiramiento aportaba. La
  imagen queda más baja, los ejes más juntos y **las tarjetas de un mismo eje
  pueden solaparse** — que es el problema que el estiramiento venía a tapar. En
  horizontal deja franjas negras a los lados (eso es inofensivo).

### Opción B — Estirar solo en vertical y con tope ★ recomendada

Una regla que distingue las dos situaciones en vez de tratarlas igual:

> La imagen **nunca se ensancha** más de lo que le toca. **Sí puede crecer a lo
> alto**, hasta un tope (p. ej. ×1,6), y solo si sobra alto.

En la práctica:

```
partir de contain → (iwC, ihC)
ih = min(altoDisponible, ihC * K)      // K ≈ 1,6
iw = iwC                                // el ancho no se toca jamás
```

- **En horizontal** contain ya llena el alto, así que no hay margen: sale
  `contain` puro y **el camión deja de estar gordo**.
- **En vertical** sigue estirándose a lo alto igual que hoy, pero acotado: los
  ejes se separan sin que la deformación se dispare.
- **Coste**: unas líneas en `_plano()`. Una constante `K` que se ajusta mirando.
- **En contra**: sigue habiendo deformación en vertical, solo que controlada.
  Es un compromiso, no una solución perfecta. Si al probarla en vertical
  `K = 1,6` se ve raro, se baja; con `K = 1` es exactamente la opción A.

### Opción C — Imagen de ejes separados para todos los tipos de vehículo

El mecanismo bueno **ya existe**: `imagen_chasis_cambio_url` en el tipo de
vehículo, con los ejes ya separados en la propia foto y el remap de tarjetas.
Donde está configurada, el plano sale proporcionado Y con los ejes espaciados.
Es la solución de verdad; lo que falta es cobertura.

- **A favor**: el mejor resultado posible. Cero deformación y ejes separados.
- **En contra**: hay que **editar una foto por tipo de vehículo** (rígido 2
  ejes, tráiler, 3 ejes…) y recalibrar. Y hoy las constantes del remap
  (`_kCambioSegs`, línea 719) están **escritas a mano para una imagen concreta**
  de 1024 px: para generalizar habría que guardar esos tramos en la base de
  datos junto a la imagen, no en el código.
- **Realista**: es un proyecto, no un arreglo. Y mientras tanto los tipos sin
  imagen especial siguen estirados.

### Opción D — Que el usuario mande (zoom y arrastre)

Envolver el plano en un `InteractiveViewer`: proporcionado siempre, y el
técnico amplía donde quiera trabajar.

- **En contra**: la pantalla ya usa **arrastrar y soltar** para llevar ruedas al
  almacén y a la papelera. Meter pan/zoom encima compite por el mismo gesto y
  es una fuente segura de arrastres fallidos. **Desaconsejada aquí.**

---

## Recomendación

**B ahora, C cuando toque.** B quita el camión gordo hoy con un cambio pequeño
y sin perder lo que el estiramiento daba en vertical. C es el destino, pero
pide trabajo de foto y de datos que no se despacha en una tarde.

Si al ver B en vertical se prefiere la limpieza a la separación, se pone
`K = 1` y queda la opción A sin escribir más código.

## Cómo se comprueba (sin esto no vale)

1. Abrir **Cambios** en un vehículo **sin** `imagen_chasis_cambio_url`, con la
   tablet en horizontal: las ruedas redondas y el chasis con su proporción.
2. La misma pantalla en vertical: los ejes siguen separados y **las tarjetas de
   un mismo eje no se pisan**.
3. Un vehículo **con** imagen de ejes separados: igual que antes del cambio
   (esa rama no se toca).
4. Arrastrar una rueda al almacén y a la papelera: sigue funcionando.
5. Comparar el mismo vehículo en **Revisión** y en **Cambios**: mismo camión,
   misma pinta.
