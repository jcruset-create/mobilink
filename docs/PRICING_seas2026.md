# SEAS 2026 contrastado con el documento original

Documento fuente: **`Asociados_2026_Mayo.pdf`** — "SEAS 24 Horas, S.L. — Tarifa
de Servicios Asociados", 9 páginas, en vigor desde el 1 de enero de 2026.

Hasta ahora los importes cargados venían del enunciado del encargo y estaban
marcados como pendientes de contrastar. Ya están contrastados. Este documento
recoge qué cambió, qué se decidió y qué sigue abierto.

## 1. Lo que cambió: son dos tarifarios, no uno

La página 3 publica **dos tablas distintas**: `TARIFA DE VENTA DE SEAS
ASISTENCIA` y `TARIFA DE COMPRA DE SEAS ASISTENCIA`. No coinciden.

| Forfait | Incluye | Venta | Compra | Margen |
|---|---|---:|---:|---:|
| Diurno proximidad | < 30 km / 1,5 h | 110 € | 125 € | **−15 €** |
| Diurno | 100 km / 3 h | 198 € | 170 € | 28 € |
| Nocturno | 100 km / 3 h | 331 € | 275 € | 56 € |
| Festivos | 100 km / 3 h | 331 € | 275 € | 56 € |
| Festivos extra (25 dic, 1 ene) | 100 km / 3 h | 424 € | 400 € | 24 € |

| Suplemento | Venta | Compra |
|---|---:|---:|
| Kilómetro adicional | 1,25 € | 1,10 € |
| Neumático adicional | 60 € | 50 € |
| Tiempo extra diurno (hora) | 50 € | 45 € |
| Tiempo extra nocturno/festivo (hora) | 80 € | 75 € |
| Anulación con salida realizada | 50 % | 50 % |

Esto **invalida el supuesto anterior** de que los precios de compra serían los
mismos que los de venta. Se cargan como dos planes tarifarios distintos
(`SEAS_NACIONAL_VENTA` y `SEAS_NACIONAL_COMPRA`); el contrato de venta apunta a
uno y el de compra al otro. El motor no cambió: ya estaba diseñado para que la
regla produzca un importe y el `role` del contrato decida de qué lado es.

## 2. El diurno proximidad da margen negativo

Venta 110 €, compra 125 €. SEAS paga al taller **15 € más** de lo que le cobra
a su cliente. Está así en el documento publicado y no es un error de
transcripción: las dos tablas son legibles y coherentes en el resto de líneas.

Se ha cargado tal cual. El motor calcula y enseña márgenes negativos sin
maquillarlos, y hay una prueba que lo fija (`seas2026.test.ts`) para que si
alguien cambia esos números sea a sabiendas.

**Pendiente de confirmar con SEAS.** Es el único número del documento que
parece un error de la fuente y no una decisión.

Lo mismo pasa en los neumáticos: **Barum, Dayton y Formula** tienen más
descuento en venta que en compra (Dayton, 45 % frente a 30 %), o sea que
también venden por debajo del coste.

## 3. La ventana de festivos, y la pregunta del nocturno resuelta

El documento define los festivos como una **ventana continua**: "VIERNES 19:00
A LUNES 08:00 Y FESTIVOS LOCALES". Eso responde la duda que quedaba abierta
desde la fase 7 sobre si el nocturno de lunes a viernes cubría la madrugada del
sábado: **no**, porque el viernes a las 19:00 ya ha empezado el fin de semana.

La ventana dura 61 horas y no cabe en una sola franja horaria, así que se ha
partido en tres puertas de entrada a la misma tarifa:

- `FESTIVO_ENTRADA` — franja viernes 19:00 → sábado 08:00.
- `FESTIVO` — clases de día `saturday`, `sunday` y `holiday`.
- `FESTIVO_SALIDA` — franja lunes 00:00 → 08:00.

Y el nocturno queda de **lunes a jueves** 19:00 → 08:00, con anclaje
`band_start`: un martes a las 02:00 pertenece a la franja que arrancó el lunes.

Las tres reglas de festivo llevan el mismo importe. Son tres y no una porque la
pantalla "por qué costó esto" explica mejor "fin de semana (viernes noche)" que
una condición retorcida.

> **Diferencia entre las dos tablas.** La ventana acaba el lunes a las 08:00 en
> venta y a las **07:30** en compra. Se han puesto las dos a las 08:00: en esa
> media hora el importe es idéntico (nocturno y festivo valen lo mismo en las
> dos tablas), así que la diferencia solo cambiaría la etiqueta. Pendiente de
> confirmar si el 07:30 es intencionado.

## 4. Neumáticos

Se han cargado las tres tablas de las páginas 5, 6 y 7:

- **Precios netos por medida y posición** (páginas 6 y 7), para Hankook,
  Continental, Bridgestone, Pirelli, Goodyear y Dunlop, más tres grupos —
  1ª Europeas, Importación 1 e Importación 2— con sus 42 marcas.
- **Descuentos sobre el baremo del fabricante** (página 5) para las 17 marcas
  de la tabla, con porcentaje distinto en compra y en venta. Van sin medida y
  con prioridad más baja que los netos, porque el documento dice que son las
  "condiciones aplicables a todos los neumáticos que **no** figuran con precio
  neto".

### Las celdas vacías no son ceros

El PDF tiene celdas en blanco y celdas con "0,00 €". Las dos significan que no
hay precio para esa combinación, **no que el neumático sea gratis**. Ninguna se
ha cargado: donde el documento no dice un precio, el catálogo no tiene fila, el
motor devuelve nulo y la asistencia va a revisión manual.

Hay una prueba que recorre las dos versiones cargadas y comprueba que no existe
ni un solo precio neto menor o igual que cero.

### Un fallo del motor que salió al cargar los datos reales

Con los datos de muestra no se veía: una línea de neumático **sin precio** hacía
que la tarifa quedara en `partial` en vez de `manual_review`, porque el total
salía bien —esa línea sumaba cero— y el estado solo miraba el total. La factura
habría salido corta por un importe que nadie había decidido.

Corregido: ahora cualquier línea sin precio de venta manda la tarifa a revisión
manual, que es lo que el propio documento de SEAS pide para el neumático sin
tarifa.

## 5. Lo que el documento trae y NO se ha cargado, y por qué

| Qué | Página | Por qué no |
|---|---|---|
| **GTI**, 100 € de venta y sin compra | 3 | El motor no tiene el concepto. Hay que decidir qué es y si es una línea más o un servicio aparte. |
| **Rápeles** por volumen anual (5/6/8/10 % según 25/50/100/150 camiones, excluyendo GTI) | 3 | Es un descuento sobre el acumulado del año, no sobre el servicio. Necesita un concepto nuevo. |
| **Stop & Go**, servicios en taller | 4 | Son servicios de taller, no asistencia en carretera. Hoy ninguna asistencia lleva ese tipo de servicio: se cargaría configuración inalcanzable. |
| **Tarifas internacionales** C1/C2/C3 y autopistas de Francia e Italia | 4, 8 | El resolutor de zonas asume España porque la asistencia no guarda país ni provincia (limitación declarada en `PRICING_auditoria_arquitectura.md` §3.5). Esas reglas no podrían dispararse nunca. |
| **Llantas y equilibrados** | 5 | Catálogo de producto, no tarifa de asistencia. |
| **Tarjeta SEAS 5 / SEAS 7** | 9 | Producto de seguro con su propia lógica de pólizas y límites. |
| **Columna GRUPO** (1..8) de la tabla de descuentos | 5 | No se ha podido cruzar con los grupos de precio neto, y hay valores dobles ("3,1"). No se inventa. |
| Sanción del 5 % por no notificar el fin del servicio (máx. 10 €) y cargo de 35 € por compensación de margen | 2 | Son penalizaciones contractuales, no tarifa. |

## 6. Lo que hay que confirmar antes de publicar

Las versiones se han cargado como **BORRADOR**. No facturan nada hasta que
alguien las publique a conciencia. Antes de hacerlo:

1. El margen negativo del diurno proximidad (110 venta / 125 compra).
2. Los descuentos invertidos de Barum, Dayton y Formula.
3. Si el 07:30 del lunes en la tabla de compra es intencionado.
4. La posición de las medidas 435/50R19.5 y 445/45R19.5: la tabla de compra no
   la trae y se les ha puesto **remolque**, que es la que llevan en la de
   venta.
5. Los festivos autonómicos y locales, que no están: el calendario cargado es
   solo el estatal de 2026.

## 7. Cómo se carga

```bash
npm run tarifa:cargar -- --centro=<id> --tarifario=seas2026-venta
npm run tarifa:cargar -- --centro=<id> --tarifario=seas2026-compra
```

Sin `--publicar` quedan como borrador. Volver a ejecutarlo es seguro: una
versión publicada no se toca, porque cambiarla alteraría el importe de
asistencias ya facturadas con ella.
