# Fases 19 y 20 — Entrega: reparto de efectivo entre cajas y rendimiento

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.42`
- El roadmap agrupa las fases 19 a 25 como «optimización y app móvil». Acoto la 19 como optimización
  del **reparto de efectivo** y la 20 como optimización de **rendimiento**, que es la otra lectura y
  además se puede medir.

---

## Fase 19 — Reparto de efectivo entre cajas

El problema que en una sola caja no existe: el taller de Reus lleva tres semanas acumulando monedas
de 1 € que no gasta, y el de Tarragona se queda sin ellas cada jueves. Hoy los dos van al banco por
separado — uno a soltar lo que le sobra y otro a pedir lo que le falta.

### Por qué NO ejecuta el traslado

**Propone, y solo eso.** Mover dinero entre cajas necesita un documento de tránsito con su estado
intermedio, como ya tienen los pedidos de cambio al banco: el dinero sale de una caja hoy y entra en
la otra mañana, y en medio **no está en ninguna de las dos**. Sin ese documento, el dinero en camino
se contaría en las dos cajas o en ninguna — que es exactamente el doble conteo que la fase 4 vino a
cerrar.

Ese documento es una fase por sí misma. Aquí se propone, alguien decide, y de momento se registra
como lo que el módulo ya sabe hacer: una salida en una caja y una entrada en la otra.

### Los tres criterios que hacen que una propuesta se siga o se ignore

1. **No se vacía a quien cede.** Sobrante es lo que pasa del colchón que esa caja necesita, no lo que
   tiene. Dejarla sin margen para socorrer a otra es cambiar el problema de sitio: la semana que
   viene la que llama es la que cedió.
2. **Menos viajes antes que reparto perfecto.** Es mejor un traslado que cubre el 80% que cuatro que
   cubren el 100%: alguien tiene que conducir. Por eso se empieza por quien más tiene de esa pieza.
3. **No se manda a nadie por cuatro monedas.** Por debajo de veinte piezas, al banco. Una propuesta
   que nadie va a seguir hace que se dejen de mirar todas las demás.

Y las piezas pequeñas primero: lo que se agota es la calderilla, los billetes se resuelven solos con
la recaudación del día. Lo que no se puede cubrir moviendo **se dice**, no se calla.

### Un detalle del reparto en piezas

«Le faltan 45 €» se convierte en piezas **en la proporción en que esa caja las gasta**, no a partes
iguales ni con las más grandes: una caja que devuelve sobre todo monedas de 1 € necesita monedas de
1 €, y mandarle el equivalente en piezas de 2 € la deja igual de bloqueada con el mismo dinero dentro.

---

## Fase 20 — Rendimiento, medido

No supuesto: **medido sobre datos con forma de producción**. La base de pruebas tiene 6.110 jornadas,
pero repartidas entre miles de cajas de un test cada una, así que no se parece a nada real. Se generó
un conjunto con la forma que tiene una red pequeña a los dos años:

**5 cajas · 3.650 jornadas · 73.000 operaciones · 365.000 movimientos**

### Lo que apareció

La consulta de consumo —la que hacen la predicción y el reparto por cada caja— **recorría la tabla
entera de movimientos**. No la parte de esa caja: las 365.000 filas. El coste crecía con el libro
mayor de toda la empresa en vez de con la historia de esa caja, **y el libro mayor no mengua nunca**.

### El arreglo y sus números

Un índice de cobertura, `(session_id, motivo, direccion) INCLUDE (valor_unitario_centimos, cantidad)`:

| Medida | Antes | Después |
|---|---|---|
| Consulta suelta | 52 ms, `Seq Scan` completo | **30 ms, `Index Only Scan`** |
| Llamada de la pantalla de reparto (5 cajas) | 230 ms | **140 ms** |

El 40% de mejora medido importa menos que el cambio de forma: con cincuenta cajas, la versión sin
índice serían ~2,3 s y seguiría empeorando cada mes con el libro mayor; la otra crece solo con lo que
esa caja haya hecho.

`INCLUDE` en vez de más columnas de clave porque no se busca por importe ni por cantidad, solo se
leen: así el índice ocupa menos y no se reordena por ellas.

### Dos cosas que conviene saber del banco de pruebas

- **El primer intento de medir no medía nada.** El reparto se salta las cajas sin arqueo proyectado y
  no había ninguno, así que salían 2 ms. Un banco de pruebas que no ejercita lo que dice medir da un
  número tranquilizador y falso.
- **También me bloqueé a mí mismo**: un `DO $$` de un intento anterior seguía vivo reteniendo la
  tabla y todo lo demás se quedaba esperando. Queda dicho por si vuelve a pasar.

---

## Verificación

| Comprobación | Resultado |
|---|---|
| Motor de reparto (unitarias, sin BD) | **8 / 8** |
| Suite completa, base **migrada** y **recién creada** | **1272 / 1272** en las dos |
| Migración del índice aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | `server/central` sin avisos |

## Lo que queda

- **El documento de traslado entre cajas**, con su estado en tránsito. Es lo que convertiría la
  propuesta en una operación de verdad, y es una fase por sí misma.
- **Pantalla de reparto**: la API está (`/redistribution`).
- **Medir el resto de pantallas** con este mismo banco de pruebas. Las que se midieron —histórico,
  KPIs, señales del Score— salen por debajo de 1 ms y no necesitan nada.
