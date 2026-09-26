# Tickets juntos en A4 — análisis y prompt (sin código)

Petición: *«cuando el escaneo sea de tickets se pueden unir todos en un mismo
A4, o los que quepan, bien organizados»*. Este documento es para revisarlo
**antes** de programar nada.

## A. Lo que hay hoy

- Los PDF que llevan justificantes detrás los monta **una sola función**,
  `montar(portada, anexos)` en `server/cash/report.ts`. Cada justificante se
  añade **tal cual**: un PDF, con todas sus páginas a su tamaño original, y
  una imagen, en una hoja A4 para ella sola.
- La usan tres informes:
  1. **Informe de cierre completo** (`informeCierre`): hoja del cierre más
     los escaneos del día. Desde la 1.81.0 lo que se imprime solo al cerrar
     es la hoja del cierre *sin* justificantes. El completo sigue en su botón.
  2. **PDF de la liquidación** (`expenseclaims/report.ts`): los tickets
     incluidos detrás.
  3. **Resguardo del ingreso bancario**: el comprobante sellado del banco
     detrás.
- Tus tickets son PDF escaneados **del tamaño del papel**, sin texto dentro:
  el bar mide 79×136 mm y los peajes de Autopistes 59×144 mm. Una hoja A4
  (210×297 mm) por cada uno es casi todo blanco. Al imprimirlos, una semana de
  Ivan son 8 hojas.
- En el proyecto ya están `pdf-lib`, que puede incrustar una página de otro PDF
  a cualquier escala y recortada, y `mupdf`, que puede rasterizar una página
  para ver dónde hay tinta. No hace falta ninguna dependencia nueva.

## B. Maqueta con tus tickets

Hecha fuera del repositorio, con los 8 tickets de la semana del 21/09 (sin el
peaje repetido), para tener números de verdad:

| Montaje | Hojas | Detalle |
|---|---|---|
| Hoy | **8** | un ticket por hoja |
| Juntos, sin recortar | **2** | 6 al 85 % + 2 al 100 % |
| Juntos, recortando, por columnas | **1** | los 8 al 70 % |
| Juntos, recortando, **por filas** | **1** | **los 8 al 77 %**, en orden de lectura y con rótulo corto |

El recorte importa: el escaneo del bar trae unos 15 mm de blanco arriba, y
quitarlo (dejando 2 mm de aire) deja el ticket en 68×119 mm y el peaje en
49×128 mm.

La primera maqueta enseñó dos cosas, ya resueltas en la segunda:

- Los **rótulos largos se pisaban** entre columnas: el nombre del fichero no
  cabe en 47 mm. Van cortos («Ticket 3 · 22/09 · 16,60 €») y cortados al ancho
  del ticket.
- **Por columnas** quedaba un tercio de hoja vacío. **Por filas** (izquierda a
  derecha, cada fila centrada) caben los mismos 8 al 77 % en vez del 70 %, y se
  lee en el orden natural. La propuesta es por filas.

### B bis. Agrupados por tipo y a tamaño real (100 %)

Pedido después: agrupar por concepto (dietas, autopista) y ver cuántos caben
sin reducir. Con el blanco recortado, márgenes de hoja de 8 mm y cabecera de
14 mm (zona útil de unos 194×275 mm):

| Tipo | Tamaño recortado | Caben por hoja al 100 % |
|---|---|---|
| Dietas (bar) | 68×119 mm | **4** (2 filas de 2) |
| Peajes (Autopistes) | 49×128 mm | **6** (2 filas de 3) |
| Peaje casi borrado | 48×134 mm | con otro de 128 mm debajo sí cabe; seis así, no |

Sin recortar el blanco serían 2 del bar o 3 peajes por hoja.

La semana de Ivan agrupada y al 100 % son **2 hojas**:
- Dietas: 4 tickets, 66,40 €.
- Peajes: 4 tickets, 15,88 €.

Cada hoja lleva en la cabecera el grupo, cuántos tickets son y su suma.

## C. Decisiones: lo que propongo y lo que necesito que decidas

0. **Agrupados por concepto de gasto**, cada grupo en sus hojas, con el total
   del grupo en la cabecera. Dentro del grupo, por fecha. Es lo que ya hace el
   PDF de la liquidación con los totales por concepto. En el cierre, el grupo
   es el tipo de operación (cobros, pagos, abonos) o el concepto del pago.
0 bis. ❓ **Escala: 100 % fijo o reducir para ahorrar hojas.** Al 100 %,
   2 hojas para esa semana. Reduciendo (mínimo 70 %), 1 hoja al 77 %
   mezclando grupos. Propuesta: **100 % por defecto**; solo se reduce si un
   ticket no cabe entero en la hoja (el del supermercado), y nunca por debajo
   del 70 %.

Las marcadas con ❓ son tuyas. Las demás son la propuesta por defecto.

1. **Qué es un ticket.** Se decide por página y **después de recortar el
   blanco**: una página es ticket si su contenido mide como mucho 105 mm de
   ancho (media A4) y cabe en la hoja sin bajar del 70 %. Así entra también el
   caso de un escáner que no recorta y deja un ticket pequeño en medio de un
   A4 blanco. Una factura A4 llena no se toca nunca.
   - Riesgo: la última hoja de una factura con solo los totales abajo
     recortaría a algo pequeño y se tomaría por ticket. Propuesta: que sea
     ticket solo si la página **original** mide menos de A5 (148×210 mm), o si
     tras recortar se queda en menos de un cuarto de A4. Se prueba con
     facturas reales de Genes antes de darlo por bueno.
2. **Nunca se amplía y nunca se baja del 70 %.** El texto de un ticket
   térmico mide unos 2,5 mm; al 70 % queda en 1,75 mm, que se lee impreso.
   Según C.0 bis, la escala es el 100 % salvo que un ticket no quepa. Un ticket
   más largo de lo que cabe al 70 % (el de un supermercado de 60 cm) sigue
   como hoy, en su hoja.
3. **El recorte no pinta nada encima del escaneo.** Solo se quita blanco de los
   bordes, con 2 mm de aire. Si el recorte sale raro (menos del 30 % de la
   página o la página entera sin tinta), no se recorta.
4. **Cada ticket lleva un rótulo pequeño encima, fuera del escaneo.** Corto y
   cortado a su ancho. En el cierre: número de operación e importe, por
   ejemplo «TAR1-P-26-017 · 82,28 €». En la liquidación: «Ticket 3 · 22/09 ·
   5,03 €». Hoy los escaneos van sin marca a propósito, para no tapar la
   factura. Con el rótulo fuera, esa regla se mantiene.
5. **Cada hoja de mosaico lleva cabecera**: caja o liquidación, fecha y número
   de hoja, como la portada. Si se separan las hojas, cada una se identifica
   sola.
6. ❓ **Tickets y facturas A4 mezclados en el cierre.** El informe va por
   operaciones, y en un día hay tickets y facturas A4 alternados. Dos opciones:
   - **(a) Recomendada:** facturas A4 en su orden y, al final, todos los
     tickets juntos en mosaico, en su orden y con su rótulo de operación.
     Gasta menos papel, y el rótulo dice de qué operación es cada uno.
   - (b) Respetar el orden estricto: cada factura A4 corta el mosaico en
     curso. Es más fiel al orden, pero salen hojas de tickets a medio llenar.
7. ❓ **Fotos (JPG/PNG).** Una foto de móvil no dice cuánto mide el ticket de
   verdad, así que no se sabe a qué escala ponerla. Propuesta: fase 1 solo para
   PDF (que es lo que da el escáner). Las fotos siguen como hoy, una por hoja.
   Si hacéis muchas fotos de tickets, se estudia aparte.
8. ❓ **En qué informes.** Propuesta: los tres (cierre completo, liquidación,
   ingreso). ¿Quieres además un botón «Imprimir tickets del día» que saque
   solo el mosaico?
9. **Un justificante que no se puede leer** (roto, cifrado o que ya no está)
   no tumba el informe, igual que hoy. Ocupa una casilla del mosaico con el
   aviso, en vez de una hoja entera.
10. **El fichero original no se toca.** Solo cambia cómo se monta el PDF. El
    escaneo guardado, su huella (duplicados) y el justificante del pago siguen
    igual.

## D. Prompt para implementar (cuando lo apruebes)

> Implementa el montaje de tickets en mosaico A4 para los informes de Mobilink
> Cash, según `docs/PROMPT_tickets_en_a4.md` (decisiones de la sección C tal y
> como hayan quedado).
>
> 1. **Dominio puro** `server/cash/domain/mosaico.ts`: entra una lista de
>    tamaños (ancho y alto en puntos, ya recortados) y los márgenes de A4;
>    salen hojas con, para cada ticket, posición, escala y hueco del rótulo.
>    Sin E/S. Reglas: por grupos (C.0), cada grupo empieza hoja; reparto por
>    filas, cada fila centrada; escala según C.0 bis (100 % por defecto,
>    nunca ampliar, mínimo 0,70); el orden de entrada se respeta en orden de
>    lectura; nada se solapa ni se sale de los
>    márgenes; lo que no cabe ni al 70 % se devuelve como «hoja propia».
> 2. **Recorte** `server/cash/recorteTicket.ts`: con `mupdf`, rasteriza la
>    página a baja resolución y devuelve la caja con tinta (umbral de gris,
>    ignorar motas de menos del 0,5 % de la fila o columna, 2 mm de aire). Si
>    sale raro, devuelve la página entera. Respeta `/Rotate` y `CropBox`.
> 3. **`montar()`**: opción para agrupar. Clasifica cada página (ticket o no,
>    decisión C.1), aplica C.6, dibuja el rótulo cortado a su ancho (C.4) y la
>    cabecera (C.5), y usa `embedPage` con la caja recortada. Las páginas que
>    no son ticket y las imágenes (C.7) van como hoy.
> 4. **Informes**: cierre completo, liquidación e ingreso, cada uno con sus
>    rótulos.
> 5. **Pruebas**:
>    - Unitarias del reparto: sin solapes, dentro de márgenes, escala entre
>      0,70 y 1, orden y máximo por hoja. Casos reales: 8 tickets de 68×119 y
>      49×128 mm en una hoja; un ticket de 60 cm en hoja propia; una factura A4
>      intacta.
>    - Integración de `montar` con PDF de tamaño ticket, contando páginas.
>    - Rasterizado del resultado para mirarlo.
>    - Mutaciones.
> 6. Documentación en `docs/mobilink-cash.md` (§7 quater) y versión.

## E. Criterio de aceptación

- La semana de Ivan sale en el PDF de la liquidación en **2 hojas al 100 %**
  (dietas y peajes), o en 1 al 77 % si se elige reducir.
- Todos los importes, fechas y números de ticket se leen en la hoja impresa.
- Una factura A4 de Genes sale igual que hoy.
- El informe de cierre de un día normal usa claramente menos hojas que hoy.
