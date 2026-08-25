# PROMPT — Tarifas y facturación para Mobilink Assist

> Diseño previo a programar nada. Objetivo: que las asistencias de Mobilink
> Assist (las del core, `roadside_assistances`) se tarifiquen y facturen con
> el mismo rigor que las de Central Pro — sin construir un segundo motor.

## 1. Qué hay hoy (verificado en el código, 25/08/2026)

- **`roadside_assistances` no tiene ni un campo de dinero.** Ni estimación,
  ni coste, ni factura. Toda la economía del core es el módulo de **cobros**
  (recobro): el operario apunta a mano `importe_total` / `importe_cobrado`
  con su método de pago. Es cobranza, no tarificación: el importe se lo
  inventa quien lo teclea.
- El solicitante existe (`solicitanteEmpresa/Nombre/Telefono/Autorizacion`)
  pero es **texto libre**: no enlaza con ninguna cuenta de cliente.
- Los técnicos de Assist son **flota propia** (APK `flutter_app`): no hay un
  taller tercero al que pagar en el caso general.
- **El puente core ↔ Connect ya existe**: una asistencia de Central asignada
  a un taller `assist` se INYECTA en `roadside_assistances`
  (`coreAssistanceId`), el worker sincroniza estados core → Connect, y
  `evidence.ts` unifica las fotos de ambos lados. Esas asistencias YA se
  tarifican: su dueño económico es la fila de Connect.
- El hueco es exactamente el contrario: una asistencia **nacida en Assist**
  (teléfono, WhatsApp) no tiene fila en Connect y por tanto ni tarifa, ni
  margen, ni facturación, ni auditoría.

## 2. Decisión central: espejo económico, NO segundo motor

El motor de Central Pro ya hace todo lo que Assist necesita: tres etapas
inmutables (estimación → forfait congelado → cierre), venta y compra,
contratos por cliente, conceptos con foto, ajustes auditados, facturación
por contraparte y exportación a ERP. Duplicarlo para el core sería mantener
dos verdades económicas que divergen a la primera corrección.

Lo que falta es **el puente en la dirección contraria**: cuando nace una
asistencia en Assist, se le crea su **espejo en Connect**
(`connect_assistances` con `coreAssistanceId` apuntando al core, centro de
control de SEA). A partir de ahí TODO lo ya construido funciona sin tocar el
motor: el `syncFromCore` existente le va pasando los estados, la pestaña
Tarificación del panel la enseña, los contratos del cliente le dan tarifa,
los conceptos con foto del técnico llegan por la unificación de evidencias,
y Facturación la agrupa y exporta.

Assist sigue siendo el dueño OPERATIVO (estados, técnico, tracking);
Connect es el dueño ECONÓMICO. Una sola verdad por dimensión.

## 3. El mapa de instantes (ya existen todos en el core)

REGLA DE NEGOCIO (dirección, 25/08/2026): **el tiempo de la asistencia
empieza al CREAR la asistencia y termina al LLEGAR el vehículo al taller.**
Es la base del forfait y de los tiempos extra.

| Etapa del motor | Instante en Assist | Campo |
|---|---|---|
| `estimate` | al crearla | `createdAtMs` |
| `locked` (forfait congelado) | al asignar técnico | `assignedAtMs` |
| `final` (regularización) | al llegar el vehículo al taller | `arrivedAtWorkshopMs` |

- El **instante contractual** del espejo (franja diurno/nocturno/festivo del
  forfait) es `createdAtMs`: el tiempo empieza ahí, lo dice la regla. El
  espejo nace con `serviceOrderedAtMs = createdAtMs` del core.
- La **duración** para los tiempos extra es
  `arrivedAtWorkshopMs − createdAtMs`, calculada por el sistema: el técnico
  NO teclea minutos. Solo aporta los kilómetros.
- Si el servicio termina SIN paso por taller (reparado in situ), el fin es
  `finishedAtMs`. Si tampoco existe, la duración queda nula y el cierre
  avisa (`DURATION_NOT_AVAILABLE`): nunca se inventa.
- La sincronización de estados core → Connect ya existe y mapea el resto.

## 4. El cliente: de texto libre a cuenta

`solicitanteEmpresa` (texto libre) no puede sostener un contrato. El alta de
Assist gana un **selector de cliente** contra `connect_clients` del centro
de SEA — el mismo catálogo que ya usa Central—, con el texto libre como
respaldo para lo no identificado:

- Con cliente elegido → el espejo nace con `clientId` y el contrato de venta
  de ese cliente le da tarifa.
- Sin cliente (particular de paso) → espejo sin `clientId`; la tarifa de
  venta sale `NO_TARIFF_PLAN` y el flujo es el de siempre: **cobros**. Un
  particular que paga en el acto no necesita contrato.

## 5. El lado de compra: flota propia

En el caso general NO hay compra: el técnico es de la casa. El motor ya
contempla el lado ausente — compra nula con aviso, margen indeterminado —
pero conviene decidir entre:

- **(a) Sin compra** (recomendado para arrancar): la venta sale del contrato
  del cliente; el margen contra coste interno se analiza fuera del motor.
- **(b) Tarifa de coste interno**: un tarifario de "compra" que modele el
  coste de flota (km, hora) para tener margen por servicio desde el primer
  día. Es exactamente un plan más + un contrato de compra a una empresa
  "SEA flota propia". El motor no distingue.

La opción (b) se puede añadir después sin tocar código: es configuración.

DECIDIDO (25/08/2026): **(a), sin compra.** La venta sale del contrato del
cliente; el coste de flota propia queda fuera del motor por ahora.

## 6. Cobros y tarifa se refuerzan

El módulo de cobros sigue siendo el camino del particular, pero deja de
teclearse el importe a ciegas: el cobro puede **pre-rellenarse con la
estimación del motor** (o el cierre si ya existe), y la diferencia entre lo
tarifado y lo cobrado queda visible en la auditoría económica. Hoy esa
diferencia ni se conoce.

## 7. Piezas a construir (todas fuera del motor)

1. **Espejo al crear** (`server/`): al dar de alta una asistencia en Assist,
   crear la `connect_assistance` con `coreAssistanceId`, centro de SEA,
   `clientId` si se eligió, y disparar la estimación. Idempotente: una
   asistencia core tiene como mucho un espejo (índice único ya existente
   sobre `coreAssistanceId`).
2. **Bloqueo al asignar**: cuando el core asigna técnico, congelar el
   forfait del espejo (mismo servicio `bloquear()` de siempre).
3. **Cierre**: al terminar en el core, cerrar la tarifa del espejo con los
   km/minutos que Assist recoja (hoy el core no los pide: añadirlos al
   cierre del técnico es parte de esto, con la misma guarda anti
   cuentakilómetros que Lite).
4. **Selector de cliente** en el alta de Assist (web) + columna
   `clientId` en el espejo. El texto libre se conserva tal cual.
5. **Cobros pre-rellenados** con la tarifa del espejo cuando exista.
6. **Panel**: la ficha de Assist enlaza a la pestaña Tarificación del espejo
   (que ya existe). Nada nuevo que construir ahí.
7. **Asistencias históricas**: NO se les crea espejo retroactivo. Sin datos
   de entonces, tarificarlas hoy inventaría importes.

## 8. Pruebas mínimas

1. Alta en Assist con cliente → espejo con estimación; asignar técnico →
   forfait congelado (franja resuelta al `createdAtMs`, que es cuando
   empieza el tiempo); llegada al taller con km del técnico → cierre con la
   duración `createdAtMs → arrivedAtWorkshopMs` y los extras que toquen;
   sin compra (§5).
2. Alta sin cliente → espejo sin contrato de venta, `NO_TARIFF_PLAN`,
   y el cobro manual sigue funcionando como hoy.
3. Una asistencia INYECTADA desde Central NO gana un segundo espejo (ya es
   ella misma la fila de Connect): el puente inverso la ignora.
4. Idempotencia: reintentar el alta no duplica espejos.
5. El cobro pre-rellenado coincide con la tarifa y se puede corregir a mano
   (con la diferencia visible).

## 9. Fuera de alcance (a propósito)

- Tocar el motor de tarifas: cero cambios en `pricing/`.
- Migrar asistencias históricas.
- Facturación de particulares (siguen por cobros).
- La APK del técnico: fase posterior (ver km/minutos al cierre, §7.3, que
  sí requiere una pantalla mínima o campo en la web).

## 10. Decisiones tomadas (25/08/2026)

1. **Sin compra** (§5a): flota propia, la venta sale del contrato del
   cliente. El coste interno se podrá modelar después como configuración.
2. **Mismo plan SEAS para todos los clientes de Assist**: sus contratos de
   venta apuntan a `SEAS_NACIONAL_VENTA`. Si algún cliente pacta otra cosa,
   se le carga su plan y su contrato con más prioridad: el motor ya lo hace.
3. **Los kilómetros los aporta el técnico** (APK Assist / ficha). Los
   minutos NO se teclean: la duración es `createdAtMs →
   arrivedAtWorkshopMs`, calculada por el sistema (regla del §3).

## 11. Activación segura

El espejo se enciende con un interruptor por centro
(`settings.assistMirror`), apagado de fábrica: hasta activarlo, nada cambia
en producción. Al activarlo solo se espejan asistencias creadas a partir de
ese momento — nunca retroactivo (§7.7).
