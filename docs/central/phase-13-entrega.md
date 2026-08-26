# Fase 13 — Entrega: primer conector de ERP real (Business Central)

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.37`

## El motor de caja no cambia ni una línea

Era lo que prometía el diseño del módulo y se cumple: el conector implementa
`ICashErpConnector` y se registra por su clave. Nada más del módulo se ha tocado.

## Lo que NO se ha podido comprobar, y va primero

**No hay ningún inquilino de Business Central contra el que probar esto.** Las 21 pruebas usan un
transporte de mentira que devuelve cuerpos con la forma documentada de la API.

Antes de usarlo en producción hay que **confirmar contra el inquilino real** los nombres de las
entidades y el diario al que se contabiliza: varían con la versión y con la personalización de cada
instalación. Están todos juntos en la constante `ENTIDADES` para que se toquen en un sitio y no
repartidos por el fichero.

## El fallo que habría llegado a producción

Business Central da los importes como decimal (`1234.56`) y el módulo trabaja en céntimos enteros. La
conversión evidente, `Math.round(x * 100)`, **está mal**: `1.005 * 100` da `100.49999999999999`, que
redondea a 100 en vez de a 101.

Un céntimo de diferencia en un cobro no se nota; en el arqueo del día sí, y **nadie sabría de dónde
salió**. La conversión se hace sobre el texto, sin que el número pase por coma flotante, y hay una
prueba que compara el resultado con lo que devuelve `Math.round` para dejarlo fijado.

## Qué significa «aislado»

Que una ERP caída, lenta o que conteste cualquier cosa **no pueda estropear una caja**:

**Todo lleva plazo.** Sin `timeout`, una ERP que acepta la conexión y no responde deja la petición
colgada para siempre, y con ella el worker.

**Los fallos se clasifican**, y de eso depende que el outbox reintente lo que puede salir bien y se
rinda con lo demás:

| Respuesta | Clasificación | Por qué |
|---|---|---|
| Red, DNS, plazo agotado | Temporal | Puede ir bien al repetir |
| 429, 5xx | Temporal | «Ahora no», no «nunca» |
| 401 | Temporal, **tirando el testigo** | Casi siempre es que caducó; tratarlo como permanente mataría la integración cada vez que expirase |
| 400, 404, resto de 4xx | **Permanente** | No mejoran por insistir. Machacarlos seis veces solo retrasa que alguien lo mire, y la cola parece viva cuando está atascada |

**Los secretos no salen en los mensajes.** Un error de la ERP acaba en `last_error`, que se ve en
pantalla y queda en la base de datos. Hay dos pruebas que comprueban que ni el testigo ni el secreto
aparecen ahí.

## Idempotencia: preguntar antes de escribir

El outbox evita mandar dos veces, **pero no que la primera llegara y se perdiera la respuesta**. Por
eso antes de contabilizar se pregunta si el número de operación de Mobilink ya está en la ERP.

Y si esa comprobación falla, **no se contabiliza a ciegas**: se propaga el error y el outbox
reintenta. Suponer que no existe llevaría a contabilizar dos veces, que es justo lo que la
comprobación viene a evitar.

## Detalles menores que evitan fallos raros

- **El testigo se renueva un minuto antes de caducar.** Pedirlo justo al expirar deja una ventana en
  la que la ERP lo rechaza por unos segundos de desfase de reloj: un fallo aleatorio imposible de
  reproducir.
- **Un apunte sin importe se descarta** en vez de traerlo a medias. Un pendiente inventado saldría en
  la pantalla de cobros como una factura cobrable por una cantidad que no es.
- **El conector solo se registra si hay credenciales.** Registrarlo siempre lo haría aparecer en la
  pantalla de integración de instalaciones que no tienen Business Central, y quien lo eligiera se
  encontraría un fallo de configuración en vez de una lista de facturas.

## Verificación

| Comprobación | Resultado |
|---|---|
| Conector (unitarias, sin red ni BD) | **21 / 21** |
| Suite completa, base **migrada** y **recién creada** | **1208 / 1208** en las dos |
| `npx tsc` | Correcto |

**Sin migración de esquema**: el conector no añade tablas.

## Lo que queda

- **Probarlo contra un inquilino real** y ajustar `ENTIDADES`. Es el paso que no puedo dar yo.
- **Cobros parciales**: el modelo los admite; el conector contabiliza el importe que se le pase, pero
  no se ha verificado cómo los liquida Business Central.
- **Conciliar el asiento**: hoy se contabiliza en el diario. Aplicarlo contra la factura concreta es
  el siguiente paso, y depende de cómo trabaje cada instalación.
