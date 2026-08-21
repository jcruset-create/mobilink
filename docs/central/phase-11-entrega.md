# Fase 11 — Entrega: Migration Center y saldo inicial

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.35`

## La decisión de fondo

Un día llevado en papel **no tiene detalle por pieza de cada cobro**. En el papel están el fondo con
el que se empezó, lo que se contó al cerrar y, con suerte, los totales del día. Qué monedas concretas
entraron en el cobro de las 11:40 no lo sabe nadie, y no se puede recuperar.

Ante eso hay dos salidas y una es mala:

- **Inventar el desglose** —repartir el total del día entre piezas plausibles— dejaría el libro mayor
  lleno de movimientos que nunca ocurrieron. Y el stock teórico se reconstruye sumando ese libro, así
  que serían mentiras con consecuencias, no adorno.
- **Registrar lo que sí consta**: el día cambió el cajón en estas piezas exactas, que es la
  diferencia entre lo contado al abrir y lo contado al cerrar. Eso es un hecho, está en el papel y
  cuadra por construcción.

Se hace lo segundo. Un día importado queda como **una sola operación neta** con el desglose real,
marcada con origen `IMPORT` para que nadie la confunda con un cobro de mostrador. Los totales del
papel —cobrado y pagado— van en el concepto y en la auditoría: informan sin fingir que son asientos.
Es la misma regla que el módulo ya aplica con las secciones: «un número inventado es peor que un
hueco declarado».

## Decisiones que sostienen el resto

**Idempotente por lote.** Cada día lleva `IMPORT:<lote>:<fecha>` como referencia externa y el que ya
está se salta. Es la diferencia entre una herramienta de migración que se puede reintentar y una que
hay que acertar a la primera **con dinero de verdad**. Hay una prueba que importa dos veces y
comprueba que solo hay una operación.

**Se ordena solo, del más antiguo al más reciente.** El cierre de cada día es el fondo del siguiente,
igual que pasó en el mostrador. La prueba los pasa a propósito en desorden.

**Un día sin movimiento no genera asiento.** Si el cajón no cambió, no hay nada que asentar; una
operación de cero solo ensuciaría el histórico.

**No se aparta nada para el banco.** Lo que se hiciera con ese dinero en su momento ya pasó y el
papel no lo dice. Inventar un ingreso bancario sería fabricar un movimiento que nadie puede
contrastar contra el extracto.

**La importación no puede inventar un descuadre.** El arqueo se guarda con lo contado del papel y
cuadra por construcción, porque el movimiento se calculó justo como esa diferencia.

## `INITIAL_BALANCE`: por qué no hay tipo nuevo

Se valoró añadir un tipo de operación `INITIAL_BALANCE` y se descartó: **el módulo ya lo representa
bien**. El fondo inicial de una jornada sin jornada anterior *es* el saldo declarado, y la fase 0 ya
avisó de que el arranque en frío estaba resuelto —se abren jornadas con fecha pasada heredando el
fondo acotado por fecha—.

Lo que faltaba era dejar constancia de que ese fondo **se declaró en vez de heredarse**, que es lo
que un auditor va a preguntar. `declararSaldoInicial` lo audita con su motivo, y **solo funciona si
la caja no tiene ninguna jornada**: a partir de la primera, el saldo sale de la anterior y declararlo
sería sobrescribir la historia.

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** y **recién creada** | **1175 / 1175** en las dos |
| `npx tsc` · `npm run build` | Correcto |

Cuatro pruebas: dos días encadenados importados en desorden y colocados en orden, con **las piezas
reales en el asiento**; repetir el lote no duplica; un día quieto no genera asiento; y el saldo
inicial se declara una vez y queda auditado.

**Sin migración de esquema:** la fase reutiliza `origen = 'IMPORT'`, que ya existía en el dominio, y
`external_system` / `external_document_id`, que ya existían en la tabla.

## Lo que queda

- **Pantalla de importación** con carga de CSV. Hoy es una llamada a la API; el formato del fichero
  depende de cómo lleve el papel cada taller y conviene verlo antes de fijarlo.
- **Vista previa antes de importar**: decir qué se va a crear y qué se va a saltar, sin escribir nada.
