# Los 25 albaranes bloqueados

**Son exactamente 25** y **ninguno se importa**. Este fichero existe para poder
mirarlos uno a uno sin desbloquear nada: ni se crean sus operaciones, ni sus
fichas, ni ninguna cantidad.

La cuenta sale de la base después de importar los diez meses:

```sql
select count(*) from tc_importacion_bloqueados;   -- 25
```

Y cuadra con lo que devuelve cada lote al importarlo: 3+3+1+3+3+3+3+2+4+0 = 25.

De los 25, **7 contienen anotaciones de montaje de gomas**, así que son
evidencia de un posible montaje intermedio y marcan la continuidad de los
intervalos que los abarcan. Los otros 18 no interrumpen nada por sí solos.

## La tabla

«Filas de Hoja1» son las líneas del libro principal (`plana_2026_10_10.xlsx`)
de ese documento; «Filas de Hoja2», los movimientos de carcasa asociados al
mismo documento, cuando los hay.

| # | Documento | Matrícula | Fecha | Km de origen | ¿Posible montaje? | Filas de Hoja1 | Filas de Hoja2 |
|---|---|---|---|---|---|---|---|
| 1 | `B2_26 / 18` | — | 2026-01-03 | — | no | 10475 | — |
| 2 | `B2_26 / 196` | — | 2026-01-15 | — | no | 9984–9985 | 463–464 |
| 3 | `B2_26 / 220` | 9079JCB | 2026-01-17 | 428.398 | sí | 9918–9928 | — |
| 4 | `B2_26 / 668` | — | 2026-02-11 | 377.748 | sí | 8928–8934 | — |
| 5 | `B2_26 / 687` | — | 2026-02-12 | — | no | 8878 | — |
| 6 | `B2_26 / 722` | 3696JNX | 2026-02-13 | — | sí | 8832–8834 | 315 |
| 7 | `B2_26 / 1196` | — | 2026-03-13 | — | no | 7757 | — |
| 8 | `B2_26 / 1590` | 1445HWZ | 2026-04-07 | 739.964 | sí | 7080–7087 | — |
| 9 | `B2_26 / 1602` | — | 2026-04-07 | — | no | 7067 | — |
| 10 | `B2_26 / 1672` | 0767GWZ | 2026-04-10 | 1.159.938 | no | 6955–6962 | — |
| 11 | `B2_26 / 2126` | — | 2026-05-08 | — | no | 6037 | — |
| 12 | `B2_26 / 2314` | 2289HZN1316 | 2026-05-18 | 779.256 | no | 5575–5577 | — |
| 13 | `B2_26 / 2474` | 1127HMN | 2026-05-27 | 816.987 | sí | 5225–5234 | — |
| 14 | `B2_26 / 2637` | 5066HKC | 2026-06-04 | 720.859 | no | 4824–4829 | — |
| 15 | `B2_26 / 2757` | — | 2026-06-11 | — | no | 4603 | — |
| 16 | `B2_26 / 2927` | — | 2026-06-19 | — | no | 4274 | — |
| 17 | `B2_26 / 3194` | 1824HBB | 2026-07-03 | 1.322.668 | no | 3734–3738 | 192 |
| 18 | `B2_26 / 3348` | 5177GHJ | 2026-07-09 | 1.142.875 | no | 3514–3519 | — |
| 19 | `B2_26 / 3426` | — | 2026-07-15 | — | no | 3293 | — |
| 20 | `B2_26 / 3845` | — | 2026-08-10 | — | no | 2311 | — |
| 21 | `B2_26 / 4334` | 1312JJC | 2026-08-28 | 884.327 | sí | 1491–1496 | — |
| 22 | `B2_26 / 4257` | 9103KWW | 2026-09-01 | 374.426 | sí | 1386–1392 | — |
| 23 | `B2_26 / 4313` | — | 2026-09-07 | — | no | 1181 | — |
| 24 | `B2_26 / 4499` | 5239KVW | 2026-09-18 | — | no | 807–812 | — |
| 25 | `B2_26 / 4781` | 2452JDD | 2026-09-24 | 391.038 | no | 551–554 | — |

## El motivo de cada uno, literal

Tal como lo guarda `tc_importacion_bloqueados.motivo`, sin reescribir:

| # | Documento | Motivo, literal |
|---|---|---|
| 1 | `B2_26 / 18` | Línea sin matrícula |
| 2 | `B2_26 / 196` | Línea sin matrícula |
| 3 | `B2_26 / 220` | «MONTA 2 CUBIERTAS NUEVAS:» sin la línea del neumático ni una salida del depósito que la respalde · Descuadre en nueva 225/75R16 121R120 4S: anotado 4, artículo 6, salida — |
| 4 | `B2_26 / 668` | Línea sin matrícula |
| 5 | `B2_26 / 687` | Línea sin matrícula |
| 6 | `B2_26 / 722` | La salida del depósito es del 2026-02-16 y el albarán del 2026-02-13 |
| 7 | `B2_26 / 1196` | Línea sin matrícula |
| 8 | `B2_26 / 1590` | La anotación «MONTA0 4 CUBIERTAS RECAUCHUTADA 295/80X22.5 K25» lleva Uds. = 4: no se sabe si son 4 o 16 neumáticos |
| 9 | `B2_26 / 1602` | Línea sin matrícula |
| 10 | `B2_26 / 1672` | Carcasa «295/80X22.5 INSA K25 BASE 1ª» ×4 sin un montaje recauchutado que cuadre |
| 11 | `B2_26 / 2126` | Línea sin matrícula |
| 12 | `B2_26 / 2314` | Matrícula no válida: 2289HZN1316 |
| 13 | `B2_26 / 2474` | «MONTA 2 CUBIERTAS NUEVAS:» sin la línea del neumático ni una salida del depósito que la respalde · Descuadre en nueva 205/75R16 RA58 113R111: anotado 4, artículo 6, salida — |
| 14 | `B2_26 / 2637` | Carcasa «295/80X22.5 INSA K25 BASE 1ª» ×4 sin un montaje recauchutado que cuadre |
| 15 | `B2_26 / 2757` | Línea sin matrícula |
| 16 | `B2_26 / 2927` | Línea sin matrícula |
| 17 | `B2_26 / 3194` | Mano de obra de montaje (1) insuficiente para 2 neumáticos y hay 1 grupo(s) sin anotación: revisar |
| 18 | `B2_26 / 3348` | Carcasa «295/80X22.5 INSA K25 BASE 1ª» ×4 sin un montaje recauchutado que cuadre |
| 19 | `B2_26 / 3426` | Línea sin matrícula |
| 20 | `B2_26 / 3845` | Línea sin matrícula |
| 21 | `B2_26 / 4334` | La anotación «MONTA 2 CUBIERTAS USADAS:» lleva Uds. = 2: no se sabe si son 2 o 4 neumáticos |
| 22 | `B2_26 / 4257` | Carcasa «295/80X22.5 INSA K25 BASE 1ª» ×4 sin un montaje recauchutado que cuadre |
| 23 | `B2_26 / 4313` | Línea sin matrícula |
| 24 | `B2_26 / 4499` | Mano de obra de montaje (2) insuficiente para 4 neumáticos y hay 1 grupo(s) sin anotación: revisar |
| 25 | `B2_26 / 4781` | Carcasa «295/80X22.5 INSA K25 BASE 1ª» ×4 sin un montaje recauchutado que cuadre |

## Por qué están bloqueados, agrupado

| Motivo | Albaranes |
|---|---|
| línea sin matrícula | 12 |
| carcasa de recauchutado sin montaje que cuadre | 5 |
| anotación de montaje sin artículo ni salida que la respalde | 2 |
| unidades ambiguas en la anotación | 2 |
| mano de obra insuficiente para las gomas anotadas | 2 |
| la salida del depósito no cuadra con la fecha del albarán | 1 |
| matrícula no válida | 1 |
| **Total** | **25** |

## Lo que NO se hace con ellos

- No se importan: cero intervenciones, cero operaciones, cero fichas.
- No se apunta ninguna cantidad. En varios de ellos la cantidad es justo lo
  que está en duda, así que escribirla sería inventarse el dato.
- No se desbloquea ninguno. Hacerlo requiere decidir a mano qué dice cada
  documento, y esa es la **ingesta auditada**, que no está construida.

Lo que sí se guarda de cada uno: la referencia del documento, su fecha, su
lectura de kilómetros de origen y el motivo literal, en
`tc_importacion_bloqueados`. Con eso, un intervalo que abarque uno de los que
pueden traer montaje queda con la **continuidad pendiente** y lo dice.
