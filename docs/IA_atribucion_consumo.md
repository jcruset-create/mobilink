# A quién se le apunta el consumo de IA

Tres cosas distintas que es fácil confundir, y por eso están separadas aquí:

- **Empresa de la sesión** — la del usuario que pulsa, resuelta contra
  `tc_usuarios` por `resolverAlcance` (`server/tyrecontrol/alcance.ts`).
- **Empresa propietaria** — la del registro sobre el que se trabaja: el
  vehículo, el documento, la intervención. Sale de la propia fila.
- **Empresa a la que se aplica la cuota** — la que viaja en `empresaId` hasta
  `pedirIA` y acaba en `ia_uso.empresa_id`. Es la que consume tope.

## Por operación

| Operación | Empresa de la sesión | Empresa propietaria | Cuota se aplica a | ¿Coinciden? |
|---|---|---|---|---|
| `resumen.vehiculo` | la del usuario | la del **vehículo** | la del **vehículo** | sí, y se comprueba: si no coinciden, 404 |
| `tyrecontrol.ficha-tecnica.ocr` | la del usuario | la del **documento** (`tc_vehiculo_documentos.empresa_id`, not null) | la del **documento** | sí |
| `tyrecontrol.informe-intervencion` | la del usuario | la de la **intervención** | la de la intervención; sin sesión abierta, ninguna | sí, cuando hay intervención |
| `asistente.preguntar` | la del usuario | — (pregunta sobre su propia flota) | la del **alcance validado** | sí |
| `tyrecontrol.flanco.leer` | la del usuario | — (solo llega una foto) | **la de la sesión** | **puede no coincidir** |
| `tyrecontrol.etiquetas.leer` | la del usuario | — | **la de la sesión** | **puede no coincidir** |
| `tyrecontrol.parte.leer` | la del usuario | — | **la de la sesión** | **puede no coincidir** |
| `tyrecontrol.parteProveedor.leer` | la del usuario | — | **la de la sesión** | **puede no coincidir** |
| Resto de la plataforma (Assist, Almacén, Cash, Therefore, tacógrafos, agenda…) | — | — | **ninguna** (`empresa_id = null`) | — |

## Dónde no coincide, y por qué

Los cuatro lectores de imagen reciben **una foto y nada más**. No hay en la
petición ningún registro que diga de quién es el neumático, así que el gasto
se imputa a la empresa del usuario que pulsa. Cuando ese usuario es un
operador de taller que trabaja para varios clientes, el consumo cae en **su**
empresa, no en la del cliente cuyo neumático está mirando.

No es un descuido: repartirlo de otra forma exige que el APK mande el
contexto del cliente en la petición, y eso no está en esta fase. Queda dicho
para que nadie lea esos números como gasto del cliente.

## Permisos del resumen: contra el vehículo, no contra la sesión

En `server/tyrecontrol/resumenVehiculo/router.ts`, por este orden:

1. Se lee `tc_vehiculos.empresa_id` del vehículo pedido.
2. Se llama a `resolverAlcance(userId, empresaDelVehiculo)`, que solo
   devuelve alcance si el usuario ya tenía acceso a **esa** empresa.
3. Se comprueba además `alcance.empresaId === empresaDelVehiculo`.
4. El interruptor `resumen_vehiculo_activo` se consulta para **esa** empresa.
5. La cuota se aplica a **esa** empresa.

Un vehículo de otro cliente responde **404**, igual que uno inexistente: no
se confirma ni que exista. Hay prueba de que el interruptor y la cuota se
miran contra la empresa del vehículo aunque el usuario sea un operador con
varias (`router.test.ts`).

Un detalle de interfaz, por si extraña: `GET /api/tyrecontrol/resumen-vehiculo/estado`
—el que decide si se pinta el botón— mira la empresa de la **sesión**, porque
en ese momento no hay vehículo. Para un operador con varias empresas, el
botón puede aparecer y luego una ficha concreta responder 403 si esa empresa
no lo tiene activado. La autorización real es la del punto 4; el `/estado` es
solo una pista para no ofrecer un botón que casi siempre fallaría.

## Esto no es facturación por cliente

`ia_uso` es un **contador de uso técnico**, y como reparto de costes tiene
tres agujeros conocidos:

1. Los cuatro lectores imputan a la empresa de la sesión (arriba).
2. Las llamadas de fuera de TyreControl van sin empresa: cuentan en el total
   y en el de nadie.
3. No se guardan euros ni tarifas, y los tokens de los intentos fallidos no
   los informa el proveedor, así que la suma de tokens es un **mínimo**, no
   el consumo exacto facturado.

Sirve para ver quién usa qué, detectar un disparo y poner topes. Para
facturar a un cliente, no.
