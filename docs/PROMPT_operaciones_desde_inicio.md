# PROMPT — Entrar a Operaciones desde la pantalla de Inicio

> Documento de diseño para aprobar ANTES de programar. Hay una decisión que
> tomar (la de la sección "Lo que no se puede saltar") y una ambigüedad de
> palabras que conviene aclarar; el resto es reutilizar lo que ya hay.

## Objetivo

Que el técnico pueda entrar a la pantalla de **Cambios** desde Inicio, sin dar
el rodeo de `Vehículos → ficha del vehículo → Cambiar`. Un acceso más, debajo
de "Nueva revisión", que lleve a la misma pantalla de siempre con las mismas
funciones.

---

## Lo que ya existe y NO hay que rehacer

| Pieza | Dónde |
|---|---|
| Identificar el vehículo (búsqueda, RFID, foto de la matrícula) | `IdentifyVehicleScreen` |
| La pantalla de Cambios entera | `CambioNeumaticoScreen(vehiculoId:)` |
| Que las incidencias se carguen solas | Ya lo hace desde `ed1f986` |

Ese último punto es el que abarata este trabajo. Hasta hace poco, Cambios
dependía de que quien la abriera le pasara las incidencias del vehículo: desde
la ficha no se las pasaba nadie y por eso las averías se quedaban abiertas.
Ahora la pantalla las carga por su cuenta, así que **entrar desde Inicio se
comporta igual que entrar desde cualquier otro sitio**. Sin ese arreglo previo,
este acceso nuevo habría heredado el mismo fallo.

---

## Lo que no se puede saltar: elegir el vehículo

La pantalla de Cambios necesita un `vehiculoId`. No hay forma de "ir directo"
desde Inicio sin decir antes sobre qué camión se trabaja.

Entiendo que lo que sobra es **la ficha**, no la identificación. Hoy el camino
es `Vehículos → lista → ficha → botón Cambiar`: cuatro pasos, y la ficha
enseña ITV, plan de mantenimiento e histórico que no pintan nada cuando vas a
cambiar una rueda.

**Propuesta**: reutilizar la pantalla de identificar vehículo que ya usa "Nueva
revisión" y, en cuanto se elige el camión, entrar directamente en Cambios.

```
HOY      Inicio → Vehículos → lista → ficha → Cambiar → Cambios
NUEVO    Inicio → Operaciones → identificar → Cambios
```

Se pasa de cuatro pasos a dos, y el de identificar ya sabe buscar por
matrícula, leer el RFID y sacar la matrícula de una foto.

### ¿Y la pantalla de confirmación?

"Nueva revisión" mete un paso más entre identificar y trabajar
(`ConfirmVehicleScreen`), donde se pide el kilometraje y si se verifican
presiones. **Para Operaciones no hace falta**:

- No hay nada que preguntar: los kilómetros y el plan de trabajo se deciden
  dentro de la propia pantalla de Cambios.
- Abrir Cambios no escribe nada. Solo el botón *Finalizar* guarda. Entrar en el
  camión equivocado y salir no deja rastro, al revés que una revisión.
- La matrícula está en la cabecera todo el rato ("Cambiar · 2222ABC"), así que
  el error se ve enseguida.

---

## La ambigüedad: ¿pestaña o botón?

En la app "pestaña" puede ser dos cosas distintas, y conviene decidirlo antes:

1. **Un botón grande en Inicio**, debajo de "Nueva revisión", como
   Planificación o Incidencias. Es lo que describe el encargo ("en la pantalla
   principal, debajo de nueva revisión").
2. **Una pestaña en la barra de abajo**, junto a Inicio, Revisiones,
   Herramientas, Sincronización y Perfil.

**Recomiendo la 1.** La barra de abajo ya tiene cinco pestañas y en una tablet
de 10" añadir una sexta empieza a apretar los rótulos. Y hay un motivo de
fondo: las pestañas de abajo son sitios donde *estar*, mientras que Operaciones
es una acción que empieza y termina — encaja con "Nueva revisión", que también
es un botón y no una pestaña.

Si aun así se prefiere la barra de abajo, se hace, pero entonces la pestaña
tendría que mostrar la lista de vehículos y no la pantalla de Cambios, porque
una pestaña no puede recibir un vehículo.

---

## Cómo quedaría

**Inicio**, debajo de "Nueva revisión":

```
┌─────────────────────────────────────┐
│  ⊕  Nueva revisión                  │   ← primario, como ahora
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  🔧  Operaciones                     │   ← NUEVO
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  📅  Planificación                   │
└─────────────────────────────────────┘
```

El icono conviene que sea el mismo que ya identifica la operación en el resto
de la app, no uno nuevo.

**Al pulsar**: la pantalla de identificar vehículo, con el título cambiado para
que se sepa a qué se va ("Operaciones · elige el vehículo"), y al elegir, dentro
de Cambios.

**Al terminar**: *Finalizar* vuelve a Inicio, no a la pantalla de identificar.
Y al volver hay que refrescar el contador de incidencias de la pestaña, porque
una operación puede haber cerrado alguna — igual que hace hoy el botón de
Incidencias.

---

## Qué NO cambia

- La pantalla de Cambios: ni una función nueva, ni una menos. Entrar desde
  Inicio o desde la ficha lleva exactamente al mismo sitio.
- El botón "Cambiar" de la ficha del vehículo se queda donde está. Quien entre
  por ahí sigue teniendo su camino.
- Nada de la base de datos ni del panel.

---

## Lo que hay que vigilar

**Sin cobertura no funciona.** La pantalla de Cambios va directa a Supabase: no
tiene almacén offline ni cola de sincronización, al revés que las revisiones.
Esto ya pasa hoy entrando desde la ficha, así que el acceso nuevo no lo empeora
— pero lo hace más visible, porque desde Inicio el técnico lo intentará sin
haber cargado antes nada del vehículo. La pantalla de identificar ya avisa
("Sin conexión: busca por matrícula exacta o elige un vehículo reciente").
Conviene comprobar que el aviso se entiende también viniendo por aquí.

**Vehículo sin plano configurado.** Cambios enseña "Este vehículo no tiene
plano configurado" y poco más. Desde la ficha eso se veía venir; desde Inicio,
no. No es un fallo nuevo, pero es el caso que más va a desconcertar.

---

## Criterios de aceptación

1. Desde Inicio, "Operaciones" → identificar vehículo → Cambios, sin pasar por
   la ficha ni por la pantalla de confirmación.
2. La pantalla de Cambios se comporta igual que entrando desde la ficha:
   permutar, reesculturar, montar de stock y sin stock, almacén, papelera y el
   botón "Ya solucionado".
3. Al finalizar una operación se vuelve a Inicio y el contador de incidencias
   queda al día.
4. Cancelar en la pantalla de identificar devuelve a Inicio sin dejar nada a
   medias.
5. El botón "Cambiar" de la ficha sigue funcionando igual.
6. Sin cobertura, el aviso de la pantalla de identificar se ve y se entiende.
