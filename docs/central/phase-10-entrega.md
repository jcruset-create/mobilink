# Fase 10 — Entrega: auditoría inmutable, separación de funciones y reautenticación

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.34`
- Cierra **R2 (CRITICAL)**, **R10** y **R11** de la auditoría de la fase 0.

## El hallazgo: la auditoría no se estaba escribiendo

Antes de tocar nada, la comprobación: **`app_auditoria` no existía en ninguna de las dos bases de
prueba**. La crea la migración de la fundación SaaS, que se aplica a mano, y como `registrarAuditoria`
traga sus errores, **las 35 llamadas del módulo de caja fallaban en silencio**. Ninguna prueba lo
ejercitaba, así que nadie se enteró.

Ahora la crea `initCash` al arrancar, como todo lo demás del módulo. La misma suite que antes dejaba
cero líneas deja **423, todas con huella**.

## R2: la auditoría va dentro de la transacción del dinero

Estaba después del COMMIT y con la variante que se traga los errores: **una operación podía quedar
asentada sin ninguna línea que dijera quién la hizo**. Para el dinero, «se guardó pero no se sabe
quién» no es un estado aceptable — o consta entero o no consta.

`registrarAuditoriaEnTransaccion` escribe con el cliente de la transacción y **no traga nada**. Hay
una prueba que rompe la escritura de auditoría a propósito y comprueba que **el cobro no se guarda**.

Que esto sea seguro depende de que el INSERT no pueda fallar por los datos, y de ahí sale un cambio
que conviene mirar dos veces: **`app_auditoria` pierde su clave ajena**. Dos razones, y la segunda
vale por sí sola: una clave ajena podría deshacer un cobro que ya ocurrió físicamente; y una
auditoría que rechaza una línea porque su empresa ya no está es una auditoría que se pierde justo
cuando más falta hace. El registro sobrevive a su sujeto — para eso está.

> ⚠️ **Aplicar `central_fase10_auditoria.sql` con este despliegue, no después.** El DDL de arranque
> crea la tabla si falta, pero **no retira la clave ajena de una tabla que ya existe**. Con la clave
> puesta y la auditoría ya dentro de la transacción, un `empresa_id` que no estuviera en
> `app_empresas` tumbaría un cobro. Es improbable —el id sale de `app_usuarios`— pero es la clase de
> improbable que no compensa.

## La inmutabilidad, donde sí alcanza

Las políticas RLS ya permitían solo leer e insertar, **pero el servidor se conecta con `pg` y no pasa
por RLS**: un `UPDATE` sobre una línea de auditoría era perfectamente posible. Ahora lo impide un
disparador, que sí alcanza a todo el mundo, y el mensaje explica qué hacer en vez de solo negarse —
lo que corrige una línea equivocada es otra línea, nunca un `UPDATE`.

La huella es **por fila, no una cadena**. Conviene ser exacto con lo que eso cubre y lo que no: una
cadena detectaría también un borrado, pero obligaría a serializar **todas** las escrituras de
auditoría de la instalación, y la auditoría se escribe en cada operación de cada módulo. El borrado
ya lo impide el disparador; la huella cubre lo otro, que alguien cambie el contenido por fuera.

## R11: separación de funciones

**Quien hizo algo no puede ser quien lo deshace.** Se aplica a las dos acciones que borran el rastro
de un descuadre: anular una operación y reabrir una jornada cerrada. Por separado cada una es
legítima; encadenadas por la misma persona y sin testigo, son el camino clásico para cuadrar una caja
de la que ha salido dinero.

- **El superadministrador tampoco.** Salta las licencias y es admin de caja sin fila, pero eso es
  alcance, no impunidad. Era exactamente R11.
- **Un usuario sin identificar no pasa.** Es el criterio contrario al del ámbito de taller, donde
  vacío significa «toda la empresa»: aquí el vacío no es un permiso amplio, es desconocimiento.
- **Viene apagado.** En un taller de dos personas dejaría al único responsable sin poder anular nada,
  y acabarían compartiendo usuario — que es peor que no tener separación.

**Lo que no se ha hecho, y por qué:** no hay flujo de solicitud y aprobación con bandeja. Un mostrador
no puede quedarse esperando una aprobación con el cliente delante. La comprobación es inmediata —la
hace otra persona con permiso, en el momento— y cubre el riesgo sin parar la caja. La bandeja tiene
sentido el día que haya acciones que puedan esperar de verdad.

## Reautenticación

Una sesión abierta en el mostrador es una sesión abierta para cualquiera que pase por delante. Contra
eso no sirve el permiso: el permiso lo tiene quien dejó la pantalla puesta.

El verificador es **enchufable**, como el conector de ERP: la comprobación real va contra Supabase,
que no existe en las pruebas, y así la regla —diez minutos, qué acciones la piden, qué pasa al
caducar— se prueba sin levantar nada. La marca vive **en la base y no en memoria**: en Render hay
varias instancias, y con un mapa en memoria reautenticarse valdría o no según a quién le tocara
responder, que es la peor clase de fallo.

## R10: fuera la caché de permisos

Retirarle el permiso a alguien tardaba hasta un minuto. **No se puede arreglar invalidando la caché**:
los roles se escriben desde el navegador contra Supabase, así que el servidor no se entera, y un
endpoint para vaciarla solo alcanzaría a la instancia que atendiera esa llamada.

Se ha quitado. Cuesta una lectura por clave indexada en cada petición; compra que retirar el permiso
de mover dinero surta efecto en la siguiente.

## Verificación

| Comprobación | Resultado |
|---|---|
| Suite completa, base **migrada** y **recién creada** | **1171 / 1171** en las dos |
| Líneas de auditoría escritas por la suite | **423** (antes: 0) |
| Migración aplicada dos veces | Sin error |
| `npx tsc` · `npm run build` | Correcto |
| ESLint | Sin avisos nuevos en `cash`, `central` ni `core` |

Nueve pruebas nuevas, entre ellas: el `UPDATE` y el `DELETE` sobre auditoría se rechazan **con la
misma conexión que usa el módulo**; una auditoría rota deshace el cobro; y con SoD encendido quien
cobró no puede anular pero otra persona sí.

## Lo que queda

- **Backfill de huellas** de las líneas anteriores. Como con los justificantes, conviene decidir
  antes si una huella calculada hoy significa algo.
- **Interruptores en la pantalla**: SoD y reautenticación se encienden por ajuste; falta el sitio
  donde pulsarlos.
- **Reautenticación en más acciones**: hoy la piden anular y reabrir.
