# Propuesta: corregir un kilometraje de origen (NO implementada)

Esto es una propuesta. **No hay nada de esto programado** y no lo habrá hasta
que lo aprobéis. Se separa de la fase 3 a propósito: la fase 3 clasifica,
avisa y deja decidir a una persona si un recorrido se usa en estadísticas;
esto otro **cambia un dato de origen**, que es otra categoría de cosa.

## El problema que resolvería

El intervalo de 1445HWZ es el ejemplo. La lectura del 9 de febrero —127.424
km— no cuadra con las otras dos del mismo vehículo. Hoy, con la fase 3, se
puede:

- ver el aviso con las fechas, los kilómetros, los albaranes, los días, el
  ritmo y el límite;
- ver que hay un albarán bloqueado en medio que podría explicar parte;
- aceptar o rechazar el uso del intervalo, con motivo, usuario y fecha.

Lo que **no** se puede es lo que de verdad arreglaría el caso: decir «esa
lectura está mal, la buena es otra» y que los intervalos se recalculen. Hoy la
única salida es rechazar el intervalo, que deja el dato fuera pero no lo
corrige.

## Lo que NO se propone

- **No** corregir 127.424 a 727.424. Es una hipótesis —un 7 leído como 1— y
  sigue **pendiente de evidencia**. Un cambio de cuentakilómetros en esas
  fechas lo explicaría igual de bien, y entonces el valor correcto sería otro.
  Nadie ha visto el albarán en papel ni el cuadro del vehículo.
- **No** una corrección automática, ni masiva, ni deducida de los vecinos. El
  importador no corrige nada: eso lo hace una persona, caso por caso.
- **No** tocar el Excel ni las líneas de origen importadas. La lectura original
  se conserva siempre.
- **No** decir que toda la anomalía viene de febrero. Con las tres lecturas,
  el tramo abril→mayo es normal y el tramo febrero→abril no lo es; pero el
  tramo febrero→abril contiene el albarán bloqueado, así que **no se puede
  afirmar cuál de las dos lecturas es la mala, ni que solo haya una mala**.

## Lo que sí se propone

### 1. La lectura original no se toca nunca

Una corrección es una fila nueva, no un `update` encima del dato. Tabla nueva:

```
tc_importacion_km_correcciones
  id, empresa_id
  origen_sistema, origen_doc        ← el albarán al que pertenece la lectura
  intervencion_id                   ← sin FK: la corrección sobrevive al deshacer
  km_original    numeric not null   ← lo que decía el origen
  km_corregido   numeric not null   ← lo que dice la persona
  motivo         text not null      ← obligatorio
  evidencia      text               ← «albarán en papel», «cuadro del vehículo», «parte del conductor»
  usuario_id, creado_at
  anulada_at, motivo_anulacion      ← una corrección se puede retirar, no borrar
```

El kilometraje que usa la reconstrucción pasa a ser
`coalesce(<corrección vigente>, <lectura de origen>)`, y la ficha del vehículo
enseña **las dos**: «127.424 km (corregido a 727.424 el 12/10/2026 por … ·
motivo …)». Un dato corregido se tiene que ver corregido.

### 2. Recalcular solo lo afectado, y entero

Una corrección cambia los intervalos de **ese vehículo**: los que empiezan en
ese albarán y los que terminan en él. La reconstrucción ya es por vehículo e
idempotente (`tc_imp_reconstruir_vehiculo`), así que el recálculo es llamarla.
Lo que hay que añadir es que la corrección **también** invalide las decisiones
humanas que dependieran del dato viejo: eso ya funciona por la huella de
evidencia de la fase 3 —el kilometraje entra en ella—, así que una corrección
hace caducar automáticamente la aceptación anterior y pedir una revisión nueva.
Esto es una consecuencia del diseño actual, no código nuevo.

### 3. Las huellas, con cuidado y por separado

Aquí está el riesgo real, y es el motivo de que esto no vaya en la fase 3.

Hay **dos** huellas y hacen cosas distintas:

| Huella | Para qué | Qué pasaría con una corrección |
|---|---|---|
| `tc_importacion_intervenciones.huella_estado` | detectar que alguien ha modificado la intervención por fuera, para que deshacer no borre trabajo ajeno | el `mecanico_km` de la intervención **está dentro**. Si la corrección lo cambia, deshacer diría «modificada después de importarla» y conservaría la intervención |
| `tc_reconstruccion_montajes.revision_huella` | detectar que la evidencia de un intervalo ha cambiado, para que una aceptación no se arrastre | el kilometraje **está dentro**. La aceptación caduca, que es lo correcto |

La segunda se comporta bien sola. La primera no, y hay dos salidas:

- **(a) No tocar `mecanico_km`.** La corrección vive solo en su tabla y la
  reconstrucción la consulta. La intervención queda exactamente como se
  importó, la huella no se mueve y deshacer sigue siendo limpio. **Es la que
  recomiendo.**
- **(b) Tocar `mecanico_km` y recalcular la huella.** Más simple de leer en la
  base, pero exige recalcular la huella, y **recalcular una huella es
  exactamente el movimiento que puede tapar una modificación ajena**: si entre
  la importación y la corrección alguien había cambiado algo más, al recalcular
  se adopta ese cambio como si fuera nuestro y deshacer deja de detectarlo.
  Si se eligiera esta vía, la huella solo podría recalcularse **tras
  comprobar que la anterior era correcta**, que es la regla que ya usa
  `tc_imp_ampliar_carga`, y nunca a ciegas.

### 4. Permisos, empresa y concurrencia

Lo mismo que la revisión de intervalos, porque es más sensible, no menos:
`tc_imp_exigir_admin(empresa)`, el bloqueo de importación
(`tc_imp_bloquear`) para no corregir mientras se importa o se deshace, y
`for update` sobre lo que se vaya a leer y escribir.

### 5. Lo que habría que decidir antes de programar

1. **¿(a) o (b)?** Mi recomendación es (a): no tocar `mecanico_km`.
2. **¿Una corrección por albarán o por intervalo?** Propongo **por albarán**:
   la lectura del cuentakilómetros es del albarán, no del intervalo, y un
   albarán puede cerrar varios intervalos a la vez (en 1445HWZ cierra dos).
   Corregir por intervalo permitiría dejar el mismo albarán con dos
   kilometrajes distintos, que no tiene sentido.
3. **¿Qué evidencia se exige?** Propongo que el campo sea obligatorio y de
   texto libre, no una lista cerrada: la evidencia real es «lo he visto en el
   albarán en papel» o «me lo ha confirmado el conductor», y encerrarlo en
   una lista hace que se elija la opción más cercana en vez de contar lo que
   pasó.
4. **¿Se puede corregir el kilometraje de un albarán BLOQUEADO?** Propongo que
   no: un albarán bloqueado no está importado y su lectura no se usa para
   nada. Lo que sí se podría es desbloquearlo, y eso es otra ampliación
   distinta (la ingesta auditada de lo bloqueado), que tampoco está construida.
