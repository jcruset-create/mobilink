# Fase 4 — Entrega: posición global de efectivo sin doble conteo

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.28`

## La pregunta que ahora tiene respuesta

**¿Cuánto efectivo hay en la red y dónde está?** Con el total desglosado en tres partes que suman
exactamente el total, porque un número de dinero que no se puede comprobar no lo usa nadie:

| Parte | Qué es |
|---|---|
| **En los cajones** | Lo que hay ahora en cada caja |
| **Fuera del cajón** | Lo que se fue al banco a cambiar y lo que lleva alguien encima |
| **Esperando al banco** | Lo que los cierres apartaron y ningún ingreso ha recogido todavía |

## El hallazgo: el tránsito no se podía deducir

Lo primero fue comprobar si hacía falta emitir algo nuevo o bastaba con los eventos de la fase 2. No
bastaba, y por un motivo concreto: **el cambio al banco y la entrega a una persona se asientan los dos
como `CASH_DELIVERY`, y los dos vuelven como `MANUAL_IN`**, que es también el tipo de una entrada de
caja cualquiera. Vistos desde Central son indistinguibles.

Sin eventos propios, Central habría visto salir el dinero y no habría sabido que va a volver ni con
quién está mientras tanto. De ahí `TRANSIT_OPENED` y `TRANSIT_SETTLED`, emitidos en los cinco puntos
donde el dinero sale o vuelve: pedir cambio, recibirlo, cancelarlo, entregar dinero y liquidar.

## La regla que gobierna la suma

**Cada euro se cuenta en un sitio y solo en uno.** El módulo de caja asienta el dinero cuando se mueve
físicamente, no cuando se planea, y eso es lo que hace posible la cuenta:

- Lo que se fue al banco **ya salió** del cajón → está en tránsito.
- Los 50 € que lleva alguien **ya salieron** del cajón → están en tránsito.
- Lo que un cierre aparta para el banco **ya salió** del cajón → está pendiente, hasta que un ingreso
  lo recoge y lo concilia.

Sumarlos al cajón sería contarlos dos veces. No sumarlos sería perderlos — y es justo lo que hace que
un arqueo descuadre 200 € sin que nadie recuerde por qué.

Los eventos de tránsito **no tocan ningún contador de la jornada**, deliberadamente: el movimiento de
efectivo ya llegó como `OPERATION_REGISTERED` y descontó el cajón. Si además sumaran aquí, el mismo
billete contaría dos veces.

La prueba que fija todo esto: al sacar 50 € con una persona, el cajón baja 50, el tránsito sube 50 y
**el total de la red no se mueve ni un céntimo**. Cambia dónde está el dinero, no cuánto hay.

## Otras dos decisiones

**El tránsito se cierra por lo ENTREGADO, no por lo gastado.** En el caso del encargo —salen 50 €, la
factura es de 40 y devuelve 10— lo que dejó de estar en el cajón fueron los 50. Cerrarlo por los 40
dejaría 10 € eternamente «fuera» con alguien que ya devolvió el cambio.

**Los cierres conciliados dejan de contarse.** El alta y la anulación de un ingreso bancario llevan
la lista de cierres que agrupan, así que Central puede marcarlos y desmarcarlos sin preguntarle nada
a la caja. Sin esa marca, la posición seguiría contando billetes que están en el banco desde hace
semanas; deducirla preguntando rompería que Central se sostenga solo con sus eventos.

## Un fallo que solo aparece en una instalación nueva

Las consultas cruzaban `app_centros` para poner el nombre del taller. En una base **sin la fundación
SaaS** esa tabla no existe y el JOIN tumbaba la consulta entera: MC Central no arrancaba donde el
módulo de caja sí funciona. Ahora el JOIN se pone solo si la tabla está, como ya hacía
`cash/hierarchy.ts`. Salió al pasar la suite contra la base recién creada, no contra la migrada — que
es exactamente para lo que se pasan las dos.

## Qué se tocó

| Fichero | Qué |
|---|---|
| `supabase/migrations/central_fase4_posicion.sql` | Nuevo: `central_transits` y `central_sessions.conciliada` |
| `server/cash/events/emitter.ts` | Dos tipos de evento nuevos |
| `server/cash/treasury.ts` | Cinco emisiones de tránsito |
| `server/cash/bankdeposits.ts` | La anulación lleva ahora los cierres que libera |
| `server/central/schema.ts`, `ingest.ts` | Tabla, proyección y conciliación |
| `server/central/queries.ts` | `posicionGlobal`, `transitosAbiertos` y el JOIN condicional |
| `server/central/router.ts` | `GET /position` |
| `src/modules/central/**` | Pantalla «Posición de efectivo» |
| `server/central/central.integration.test.ts` | Dos pruebas |

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** | **1135 / 1135** |
| Suite completa, base **recién creada** | **1135 / 1135** |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| `bash scripts/check-versions.sh` | `package.json` SUBIDA (1.8.28) |
| ESLint sobre lo nuevo | Backend **sin avisos**; un aviso más en `CentralApp.tsx`, el mismo patrón de siempre |

## Lo que queda

- **Alertas** (fase 7): la pantalla enseña los días que lleva fuera cada tránsito, pero nadie avisa.
- **Posición por zona**: hoy el total es de la empresa; agrupar por zona es el siguiente corte natural.
- **El arqueo físico no entra en la posición**: Central suma lo que las cajas dicen que tienen, no lo
  que se ha contado. Cuadrar una cosa con la otra es la conciliación de la fase 14.
