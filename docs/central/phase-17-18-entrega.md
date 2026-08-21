# Fases 17 y 18 — Entrega: tesorería predictiva y Cash Health Score

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.41`
- El roadmap enuncia estas fases en una línea («tesorería predictiva, Cash Health Score»), así que el
  alcance lo acoto aquí y lo digo.

---

## Fase 17 — Tesorería predictiva

**Qué se ha acotado:** predecir *cuándo se queda sin cambio cada caja* y *cuánto hay que llevarle*,
con antelación para que alguien pase por el banco antes de que el problema exista.

### Sin modelo de lenguaje, por la misma razón de siempre

`cash/domain/restock.ts` ya lo dejó dicho y aquí se mantiene: el libro mayor registra cada moneda que
ha salido, así que el consumo **es un dato, no una estimación**. Una fórmula da siempre la misma
respuesta para los mismos datos, se prueba y se audita. Un modelo daría respuestas distintas para el
mismo caso, y en dinero eso es un defecto.

### Lo que sí hay que modelar: el día de la semana

Una caja de taller no gasta igual el martes que el sábado. La media plana predice mal justo el día
que importa: si el sábado se gasta el triple, la media dice que aguanta y **el sábado a mediodía no
hay cambio**.

El consumo se calcula por día de la semana, y solo se cae en la media general cuando ese día no se ha
repetido al menos tres veces — con una sola muestra, «los sábados se gastan 80 €» no es un patrón: es
un sábado.

### Dos decisiones más

- **Con menos de cinco jornadas no se predice**: se dice que no hay datos. Una predicción con dos días
  detrás parece igual de firme que una con dos meses, y ahí está el peligro.
- **Se avisa el día antes de quedarse sin**, no el mismo día. El banco tiene horario y la caja
  también; avisar el mismo día es avisar tarde.

### El fallo que cazó una prueba

El historial contaba **todas** las salidas del cajón, y ahí entraba el **cambio final que se deja para
mañana**. Una caja que cierra con 300 € en monedas aparecía gastando 300 € diarios, y la predicción
**mandaba al banco todos los días a por un dinero que no se había gastado: estaba en el cajón**.

Ahora solo cuentan los movimientos que son consumo de verdad —el cambio dado al cliente, los pagos y
las salidas manuales—, y quedan fuera el cierre, el ingreso bancario y las aperturas de cartucho, que
son movimientos internos de valor neto cero.

---

## Fase 18 — Cash Health Score

Un número del 0 al 100 por caja, taller y red. Cuatro decisiones lo definen:

**Un número solo no vale: va con sus motivos.** Un 62 no dice nada; lo que hace falta saber es por qué
es 62 y qué lo arregla. La puntuación devuelve siempre la lista de lo que ha restado y cuánto,
ordenada de lo que más pesa a lo que menos — que es el orden en que hay que atenderlo. Es la misma
regla del motor de pedidos al banco: una propuesta que no se entiende no se corrige, se ignora.

**Se resta desde 100, no se suma desde 0.** Sumar puntos por portarse bien premia el volumen: una caja
que mueve mucho sacaría mejor nota que una pequeña impecable, y la pregunta no es cuánto factura sino
si está sana.

**El descuadre se mide en proporción a lo que mueve la caja.** Veinte euros descuadrados en una caja
que mueve doscientos es grave; los mismos veinte en una que mueve veinte mil es ruido. En absoluto,
el indicador solo diría cuál es la caja más grande. Y aparte cuenta **cada cuánto** descuadra: un
descuadre gordo un día es un incidente, descuadrar poco todos los días es un procedimiento que no se
sigue, y el importe no distingue una cosa de la otra.

**Cada factor tiene tope.** Sin topes, un descuadre enorme se llevaría la puntuación a cero y taparía
que además lleva tres semanas sin cerrar: el cero absorbe lo demás y se pierde qué atender primero.

**Y sin datos no es un cero.** Una caja recién dada de alta no tiene puntuación: un cero la pondría la
primera de la lista de problemas sin haber hecho nada, y un cien diría que está perfecta sin haberla
mirado. En la media del grupo no entra ni como cero ni como cien.

**La puntuación de un taller es la media de sus cajas, no una ponderación por dinero.** Ponderando por
importe, una caja pequeña y desastrosa desaparecería detrás de una grande impecable — y la caja por la
que se escapa el dinero suele ser precisamente la pequeña.

---

## Verificación

| Comprobación | Resultado |
|---|---|
| Motor de predicción (unitarias, sin BD) | **10 / 10** |
| Motor de puntuación (unitarias, sin BD) | **12 / 12** |
| Suite completa, base **migrada** y **recién creada** | **1264 / 1264** en las dos |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | `server/central` sin avisos |

**Sin migración de esquema:** las dos fases se calculan sobre proyecciones que ya existían.

## Lo que queda

- **Pantalla** de predicción y de salud: la API está (`/forecast`, `/forecast/:id`, `/score`).
- **Enlazar la predicción con el motor de pedidos al banco** (`domain/restock.ts`), que ya sabe
  componer qué tubos pedir: hoy dice cuánto falta en euros, no en qué piezas.
- **Una regla de la fase 7 sobre la predicción**, para que avise sola cuando una caja baje de dos días
  de autonomía en vez de esperar a que alguien mire la pantalla.
