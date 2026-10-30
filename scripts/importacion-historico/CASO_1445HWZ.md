# El caso 1445HWZ: qué dice el origen y qué no

Un intervalo reconstruido de **626.290 km en 98 días**. La aritmética es
correcta y el dato no es creíble. Este fichero es lo que se ha comprobado,
separado de lo que se supone.

## Las tres lecturas

Todas con `NºVEHICULO:953`, así que es el mismo vehículo.

| Fecha | Albarán | Km | ¿Importado? | Qué dice la anotación |
|---|---|---|---|---|
| 09/02/2026 | B2_26 / 614 | 127.424 | sí | `MONTA 2 CUBIERTAS NUEVAS:` · 2 Hankook AH51 295/80R22.5 |
| 07/04/2026 | B2_26 / 1590 | 739.964 | **no, bloqueado** | `MONTA0 4 CUBIERTAS RECAUCHUTADA 295/80X22.5 K25`, Uds. = 4: no se sabe si son 4 o 16 |
| 18/05/2026 | B2_26 / 2334 | 753.714 | sí | `MONTA 2 CUBIERTAS NUEVAS 295/80R22.5 AH51` · 2 Hankook AH51 |

| Tramo | Días | Diferencia | Ritmo |
|---|---|---|---|
| 09/02 → 07/04 | 57 | +612.540 | 10.746 km/día |
| 07/04 → 18/05 | 41 | +13.750 | 335 km/día |
| 09/02 → 18/05 (lo que ve el histórico) | 98 | +626.290 | 6.391 km/día |

## De dónde sale cada lectura, de verdad

Esto importa porque es fácil contar como tres fuentes lo que es una.

- **`plana_2026_10_10.xlsx`, Hoja1** es la fuente. Las 8 líneas del albarán
  B2_26/614 llevan el mismo valor en la columna `KMs`: eso es **una lectura
  repetida 8 veces en 8 líneas del mismo documento**, no ocho confirmaciones.
- **Hoja2** del mismo libro (movimientos de carcasa) confirma los dos
  movimientos de −2 unidades, con sus identificadores `DC_0013209` y
  `DC_0014478`. **No tiene columna de kilómetros**: no corrobora el
  kilometraje, solo que hubo salida de almacén.
- **`operaciones_relacionadas_plana.xlsx`** sí trae el kilometraje, pero es un
  fichero **derivado**: sus propias columnas `Fila Hoja1` y `Filas Hoja1`
  dicen de qué filas del libro principal sale cada registro. Que el valor
  aparezca ahí **no es corroboración independiente**: es el mismo dato copiado.

Conclusión: **la lectura de 127.424 km tiene una sola fuente**, y ninguna
evidencia independiente la confirma ni la desmiente.

## Lo que NO se afirma

- **No se corrige 127.424 a 727.424.** Que un 7 se lea como un 1 explicaría
  el caso —el tramo febrero→abril pasaría a 220 km/día, parecido a los 335 del
  tramo siguiente— pero es una **hipótesis sin evidencia**. Un cambio de
  cuentakilómetros en esas fechas lo explicaría igual de bien y el valor
  correcto sería entonces otro. Nadie ha visto el albarán en papel ni el
  cuadro del vehículo.
- **No se afirma que toda la anomalía venga de febrero.** El tramo que no
  cuadra es febrero→abril, y dentro de ese tramo está el albarán bloqueado.
  Con lo que hay no se puede decir cuál de las dos lecturas es la mala, ni que
  solo haya una mala.
- **No se desbloquea B2_26/1590.** Sigue entre los 25 albaranes excluidos. Su
  cantidad es justo lo que está en duda, y la ingesta auditada de lo bloqueado
  es una ampliación que **no está construida**.

## Qué hace el sistema hoy con el caso (fase 3)

Los dos intervalos del eje 1 quedan así, y los dos avisos salen a la vez:

```
km_estado             anomalos      ← calculable, pero el ritmo no es plausible
recorrido_km          626290        ← se conserva: no se borra ni se pone a cero
dias_intervalo        98
ritmo_km_dia          6390.71
limite_km_dia         2000
uso_estadistico       pendiente     ← decisión sobre los KILÓMETROS
continuidad_decision  pendiente     ← decisión sobre la CONTINUIDAD, aparte
continuidad_docs      {B2_26/1590|1445HWZ}
motivos               km_anomalos_pendientes, continuidad_pendiente
en_medias             false
```

Y el aviso, literal:

> Ritmo no plausible: 626290 km entre el 09/02/2026 (127424 km, albarán
> B2_26/614|1445HWZ) y el 18/05/2026 (753714 km, albarán B2_26/2334|1445HWZ):
> 98 día(s), 6391 km/día, por encima del límite de 2000 km/día. Es un aviso
> para revisar, no una prueba de que el dato sea falso: el recorrido se
> conserva y queda pendiente de validación. · Posible montaje intermedio sin
> importar el 07/04/2026 (albarán B2_26 / 1590, bloqueado; su lectura de
> origen eran 739964 km): La anotación «MONTA0 4 CUBIERTAS RECAUCHUTADA
> 295/80X22.5 K25» lleva Uds. = 4: no se sabe si son 4 o 16 neumáticos. No se
> sabe en qué posición fue, así que no se atribuye a ningún eje. La cadena de
> esta posición no puede considerarse limpia.

**Dos motivos distintos, dos decisiones distintas.** Y no es una forma de
hablar: son dos puertas con su propia llave. Aceptar el kilometraje deja
`uso_estadistico = aceptado` y el intervalo **sigue fuera de las medias**, con
el motivo `continuidad_pendiente` a la vista, hasta que alguien acepte también
la continuidad con su propio motivo. Las dos decisiones se auditan por
separado, cada una con su ámbito, y las dos caducan si la evidencia cambia.

Comprobado en el panel real: se aceptan los kilómetros con su motivo, el
intervalo sigue diciendo «fuera de las medias · continuidad pendiente», y solo
tras aceptar la continuidad —otro diálogo, otro motivo— pasa a «entra en las
medias», con las dos decisiones visibles por separado.

## El efecto de este caso en las medias

| | Intervalos | Media | Máximo |
|---|---|---|---|
| Antes de la fase 3 | 52 | **47.731 km** | 626.290 km |
| Con recorrido calculable, con la fase 3 | 52 | — | 626.290 km |
| **Elegibles tras todos los filtros** | **50** | **24.588 km** | 73.901 km |

Los dos números de la fase 3 son distintos a propósito: **52 intervalos tienen
un recorrido que se puede restar y solo 50 pasan los filtros**. Los dos que se
caen son los de 1445HWZ, y se caen por los dos motivos a la vez.

Dos registros de 52 casi duplicaban la media. La mediana no se movía (21.078
km en los dos casos), que es exactamente lo que cabe esperar de dos valores
extremos.

## Para cerrarlo de verdad hacen falta dos cosas que no están

1. **Ver el albarán B2_26/614 en papel o el cuentakilómetros del vehículo.**
   Es una comprobación física, no de software.
2. **Poder corregir una lectura de origen conservando la original.** Propuesta
   escrita y sin implementar en
   [`PROPUESTA_corregir_km_origen.md`](PROPUESTA_corregir_km_origen.md).

Mientras no estén, lo que el sistema puede hacer —y hace— es avisar con los
números a la vista y dejar que una persona decida, con motivo, usuario y
fecha.
