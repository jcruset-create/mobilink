# Fases 23 y 24 — Entrega: cancelar un traslado y avisar antes de quedarse sin cambio

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.44`
- Incluye la integración de `origin/main` (reparación de formato del arqueo, `server/cash/report.ts`
  y `taller_app` 0.6.1+65).

---

## Fase 23 — Cancelar un traslado en tránsito

La fase 21 dejó el traslado con dos finales: sale de una caja y entra en otra. Faltaba el tercero,
que en un taller pasa: **el dinero sale y el viaje no se hace**. El portador no llega a salir, el
taller de destino cierra antes, el coche no arranca. Sin una forma de deshacerlo, ese dinero se
queda en tránsito para siempre y el arqueo de origen cuadra en falso — le faltan las piezas que
físicamente siguen en el cajón.

### La regla que lo sostiene

**No se borra nada.** El traslado no desaparece: pasa a `CANCELADO` y se registra una entrada
`MANUAL_IN` en la caja de origen con **exactamente las mismas piezas que salieron**. Es el asiento
compensatorio de siempre, no un `DELETE`. El libro mayor conserva la salida, la vuelta y el motivo.

### Tres decisiones

- **Se exige motivo.** El texto del error lo dice sin rodeos: *"Cancelar un traslado exige decir por
  qué: el dinero ya había salido del cajón."* Un movimiento de vuelta sin explicación es la clase de
  apunte que nadie sabe justificar tres meses después.
- **Solo se cancela desde la caja de origen.** Se comprueba que la sesión que cancela pertenece al
  `origen_register_id` del traslado; si no, `TRASLADO_DE_OTRA_CAJA`. Sin esa comprobación, el dinero
  volvería a un cajón donde nunca estuvo — el espejo exacto del control que la fase 21 puso al
  recibir.
- **Solo se cancela lo que está `EN_TRANSITO`.** Lo ya recibido no se cancela: se corrige con un
  traslado de vuelta, que es lo que de verdad ocurrió físicamente.

Se cierra el tránsito emitiendo `TRANSIT_SETTLED` con motivo `CANCELADO`, así que Central deja de
contar ese importe en la posición global en la misma vuelta del ciclo, sin doble conteo.

La prueba que lo demuestra: origen manda 40 €, se cancela, y **el cajón de origen vuelve a tener
exactamente los 100 € iniciales, pieza a pieza**; y una sesión de otra caja que intenta cancelarlo
recibe `TRASLADO_DE_OTRA_CAJA`.

---

## Fase 24 — Dos avisos nuevos: autonomía y cola atascada

El motor de reglas de la fase 10 avisaba de descuadres, cajas sin cerrar y dinero pendiente de
banco: todo **hechos ya ocurridos**. Estas dos reglas avisan **antes**.

### `AUTONOMIA_DIAS` — días de cambio que quedan

Conecta la predicción de la fase 13 con el motor de reglas. La pregunta que responde no es "¿cuánta
calderilla hay?" sino **"¿para cuántos días da?"**, que es la que decide si hay que pedir cambio hoy
o el viernes. Doscientos euros en monedas son dos semanas en un taller y tres días en otro.

### `COLA_ATASCADA_MINUTOS` — salud del envío a Central

Mide **los minutos que lleva esperando lo más viejo** de las dos colas (`cash_event_outbox` y
`central_notifications`), no cuántos elementos hay pendientes. Por lo mismo que ya se decidió en la
pantalla de estado: cien pendientes de hace treinta segundos es una tarde normal, y tres de hace dos
días es una integración rota.

Es un dato **de la instalación, no de cada caja** — la cola es una sola. Se calcula una vez por
evaluación y se reparte a todas las cajas, para que la regla tenga ámbito de empresa como las demás
sin inventar un ámbito nuevo solo para ella.

### Los umbrales que saltan por debajo

Las reglas anteriores saltaban al **superar** un umbral. Estas dos saltan al **bajar** de él: quedan
menos de 3 días de autonomía, queda menos de X de calderilla. El motor lo resuelve con un conjunto
explícito en lugar de con un signo escondido en cada comparación:

```ts
const SALTAN_POR_DEBAJO = new Set<TipoRegla>(["CALDERILLA_MINIMA", "AUTONOMIA_DIAS"]);
```

`CALDERILLA_MINIMA` ya funcionaba así; al hacerlo explícito, esa asimetría deja de ser un caso
especial y pasa a ser una propiedad declarada del tipo de regla.

### Dos decisiones de coste y de robustez

- **Predecir cuesta**, así que solo se predice si hay alguna regla `AUTONOMIA_DIAS` activa. Una
  empresa que no use este aviso no paga una consulta por caja en cada vuelta del ciclo.
- **Que no se pueda medir la cola no impide evaluar lo demás.** Si la consulta falla, el dato queda a
  `null` y el motor sigue: sin dato no hay incidencia, que es exactamente lo que ya hacía con el
  resto de métricas.

Ambas se cierran solas (`SE_CIERRAN_SOLOS`): describen un estado en curso, no un hecho. En cuanto la
caja se repone o la cola se desatasca, la incidencia sobra.

---

## Comprobaciones

| Comprobación | Resultado |
| --- | --- |
| Suite completa (`mobilink_test`) | **1286 pasadas** |
| Suite completa (`mobilink_fresh`) | **1286 pasadas** |
| Pruebas de `server/central` (ambas BD) | **118 pasadas** |
| Motor de reglas (unitarias) | **16 pasadas** |
| `npx tsc` (`tsconfig.json` y `tsconfig.server.json`) | limpio |
| `npm run build` | correcto |
| `bash scripts/check-versions.sh` | `package.json` SUBIDA, resto OK |

### Un defecto encontrado y arreglado en las propias pruebas

Las pruebas de integración dejaban eventos `PENDING` en `cash_event_outbox` que **la ejecución
siguiente procesaba**, inflando la posición global (`expected 87500 to be 82500`). No era un fallo
del código de producción sino de aislamiento entre ejecuciones, y por eso era peor: aparecía y
desaparecía según el orden. Se limpian en `beforeAll`.

Por el mismo motivo **no se afirma el auto-cierre de `COLA_ATASCADA_MINUTOS`** en la prueba de
integración: sobre `mobilink_fresh` la cola está genuinamente atascada, así que la incidencia debe
seguir abierta. El mecanismo de auto-cierre ya queda demostrado por la prueba de tránsitos.

---

## Sin cambios de esquema

Ninguna de las dos fases añade tablas ni columnas: la cancelación usa `cash_transfers` y el libro
mayor existentes, y las reglas nuevas son dos valores más en la columna `tipo` de `central_rules`,
que no tiene `CHECK` cerrado. **No hay migración nueva que subir a Supabase.**

---

## Lo que sigue pendiente (de usuario, no de código)

- **D5** — volcado del esquema de producción, necesario antes de endurecer `centro_id` a `NOT NULL`.
- **`central_fase1_jerarquia.sql`** sin aplicar en Supabase (FK + backfill): la única migración
  estrictamente obligatoria.
- **R1** — la fase 25 (app móvil) sigue bloqueada: MC Local es una SPA de navegador sin
  almacenamiento offline, y el modelo objetivo exige autonomía sin red.
