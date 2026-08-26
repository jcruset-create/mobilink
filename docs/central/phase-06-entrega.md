# Fase 6 — Entrega: cambio y arqueos consolidados

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.30`

## Por qué esta fase era más pequeña de lo que decía el roadmap

El motor de denominaciones, cartuchos, bolsas, arqueo y propuesta de pedido al banco **ya estaba
entregado** en el módulo de caja, y la auditoría de la fase 0 lo dejó dicho. Lo que faltaba era verlo
de toda la red a la vez, y para eso hacía falta una sola cosa: que los eventos de arqueo llevaran el
detalle **por pieza**, porque hasta ahora solo llevaban totales.

## Las dos preguntas que ahora tienen respuesta

**¿Qué caja se está quedando sin calderilla?** Con solo los totales no se puede contestar: una caja
con un billete de 50 € y cuatro monedas tiene 50,40 € y no puede devolver un cambio de 3 €. La
pantalla ordena las cajas por lo que tienen **en monedas**, que es lo que se acaba en un mostrador —
los billetes siempre entran.

**¿En qué piezas descuadra la red?** Un descuadre de 20 € puede ser un billete que no está o veinte
monedas de un euro mal contadas. **No son el mismo problema: lo primero se busca, lo segundo se
recuenta.** El importe total nunca lo dice.

## Decisiones

**La foto sale del último arqueo, no del stock teórico.** El teórico es correcto por construcción —el
libro mayor no se desincroniza— pero el arqueo es lo que alguien ha contado con la mano. Para decidir
si un taller se queda sin monedas, la foto buena es la contada.

**Se pisa, no se acumula.** `central_denomination_stock` guarda cuánto hay AHORA en cada caja, no la
historia de los arqueos: esa está entera en `central_events` y se puede reconstruir. Un arqueo que
llega tarde no pisa una foto más reciente — la condición está en el `ON CONFLICT`, no en el código.

**El consolidado cuenta las cajas a cero.** Que la red tenga 400 monedas de 10 c no sirve de nada si
están todas en un taller y en el otro no queda ninguna. Un total sin ese contador engaña, así que va
en la misma tabla.

**Los eventos anteriores a esta fase no traen `lineas`, y entonces no se toca nada.** Mejor una foto
vieja que ninguna.

## Qué se tocó

| Fichero | Qué |
|---|---|
| `supabase/migrations/central_fase6_cambio.sql` | Nueva: `central_denomination_stock` |
| `server/cash/service.ts` | El arqueo emite el detalle por pieza |
| `server/central/schema.ts`, `ingest.ts` | Tabla y proyección, sin pisar fotos más nuevas |
| `server/central/queries.ts` | `cambioEnRed`, `cajasSinCambio`, `descuadresPorPieza` |
| `server/central/router.ts` | `GET /change` |
| `src/modules/central/**` | Pantalla «Cambio» |
| `server/central/central.integration.test.ts` | Dos pruebas |

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** y **recién creada** | **1139 / 1139** en las dos |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | Backend sin avisos; el patrón conocido en la pantalla |

## Lo que queda

- **Proponer el pedido al banco desde Central**: el motor existe (`domain/restock.ts`, sin modelo de
  lenguaje, a propósito) pero se invoca caja por caja.
- **Avisar** de la caja que se queda sin cambio: fase 7.
