# Permisos económicos y ajustes manuales

La política vive en `server/connect/pricing/permissions.ts`, en una sola tabla
y sin dependencias, para que se pueda leer de una vez en lugar de
reconstruirla juntando quince `requireConnectRole` repartidos por el router.

## Quién ve qué, quién toca qué

| | superadmin | cc_admin | supervisor | operator | analyst | provider_user |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Ver precio de venta | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Ver precio de compra | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ver margen | ✓ | ✓ | ✓ | — | ✓ | — |
| Ajustar un importe | ✓ | ✓ | hasta un límite | — | — | — |
| Publicar una tarifa | ✓ | ✓ | — | — | — | — |
| Exportar facturación | ✓ | ✓ | — | — | — | — |

La fila que sostiene todo lo demás es la de `provider_user`, que es el taller:
**ve lo que le pagan y nada más**. Enseñarle el precio de venta o el margen es
enseñarle cuánto gana la central por encima de él, y eso no se arregla después.

El recorte se hace **al salir**, no al calcular: el motor necesita las dos
patas para el margen aunque quien pregunta no vaya a verlo.

## El límite de ajuste

Un operador no toca dinero: opera. Un supervisor ajusta lo razonable de un
turno. Por encima de eso hace falta el administrador de la central.

El límite del supervisor son **150 €** por defecto y se cambia por centro de
control, porque lo que es razonable depende del tamaño de los servicios de cada
central — 150 € es mucho en turismos y poco en camión:

```json
{ "pricing": { "limiteAjusteSupervisor": 400 } }
```

en la columna `settings` de `connect_control_centers`.

Se mira el **valor absoluto** de la diferencia. Un límite que solo controlara
las subidas dejaría pasar los descuentos, que es justo por donde se escapa el
margen.

## Qué pasa al ajustar un importe

1. **Sin motivo no hay ajuste** (mínimo cinco caracteres). No es burocracia:
   dentro de seis meses, cuando el cliente pregunte por qué esa asistencia
   costó 300 y no 331, el motivo es la única respuesta posible.
2. Se guarda una fila en `connect_pricing_overrides` con el importe anterior,
   el nuevo, el motivo y quién lo autorizó.
3. Los totales se **vuelven a sumar desde las líneas**, no se le suma la
   diferencia al total guardado: si algo se descuadró antes, sumar arrastra el
   descuadre y volver a sumar lo corrige.
4. La tarifa pasa a `manual_review` y se le añade el aviso `MANUAL_OVERRIDE`,
   para que nadie la dé por buena sin mirarla.
5. **El snapshot NO se reescribe.** Sigue diciendo lo que dijo el tarifario.

Ese último punto es el que hace que la pantalla pueda enseñar a la vez lo que
calculó el motor y lo que decidió una persona. Si el ajuste pisara el snapshot,
la explicación mentiría sobre el cálculo y la diferencia —que es justo la
información que interesa— quedaría fundida en un número nuevo del que ya no se
sabe nada.

**Lo ya exportado a facturación no se puede ajustar.** Cambiarlo descuadraría
con lo que salió al ERP. Hay que deshacer la exportación primero
(`DELETE /billing/mark-exported/:id`), que también queda auditado.

## Auditoría económica

`GET /pricing/audit` y la pestaña **Económica** de Auditoría responden la
pregunta que hace un director: cuánto dinero se ha apartado de lo que dice la
tarifa, quién lo ha apartado y con qué motivo.

Los totales suman **diferencias**, no importes finales. Un ajuste de 331 a 330
mueve un euro, no trescientos treinta, y una lista ordenada por importe final
pondría arriba los servicios caros en vez de los ajustes grandes.

En venta, una desviación negativa es dinero que se ha dejado de cobrar. En
compra, una positiva es dinero que se ha pagado de más.

## Un arreglo que salió por el camino

El informe PDF de la asistencia imprimía el coste del servicio. Desde que el
motor de tarifas rellena `finalCost`, ese número es el precio de **venta**, y
el informe archivado se sube al almacenamiento **con URL pública** y se adjunta
al expediente del taller.

Es decir: el taller —y cualquiera con el enlace— habría visto el precio al que
la central factura a su cliente.

Ahora `buildConnectReportPdf()` solo imprime importes si se le piden, y solo se
le piden desde la ruta autenticada del panel. El informe archivado sale sin
ellos: cuenta lo que pasó, y el dinero va en la factura.
