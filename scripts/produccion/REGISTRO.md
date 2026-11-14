# Registro de la puesta en producción · histórico de Plana (PR #492)

Se rellena **en el momento**, un paso por fila. Si un paso no se ejecuta, se
dice por qué; no se deja en blanco. Vive en el repositorio y no en un chat
porque es lo que permite saber dónde se quedó la cosa dentro de tres semanas.

- **Base:** proyecto de producción `sea-tarragona` · PostgreSQL **17.6** · 486 tablas en `public`
- **Empresa del histórico:** Plana · `a51c9662-4b6f-4681-8e2b-599e109659eb`
  (confirmada por UUID, no por el nombre: hay once empresas más)
- **Código:** rama `claude/importacion-historico-plana`, `main` integrado, CI en verde.
  **Sin desplegar todavía**: el panel de producción aún no tiene la pantalla de importar.

## Pasos

| # | Paso | Cuándo | Resultado |
|---|---|---|---|
| 1 | Preflight de solo lectura | 2026-10-31 | **Sin un solo `PARA`**. 23 tablas, 49 columnas y 5 funciones requeridas: están. 3 de 29 firmas ya existían. Base virgen de importación. 8 disparadores, los esperados |
| 2 | Comparar las 4 definiciones vivas con el repositorio | 2026-10-31 | **Idénticas** las cuatro: la base no se ha desviado |
| 3 | Captura de la vuelta atrás | 2026-11-01 | 4 objetos guardados por el cliente (3 funciones + la vista) |
| 4 | Backup | 2026-11-01 | Hecho |
| 5 | Fotografía previa | 2026-11-01 20:54 UTC | Ver abajo |
| 6 | Ensayo `begin … rollback` en 17.6 | 2026-11-01 | **El editor de Supabase confirmó la transacción**: el `rollback` no surtió efecto y las tres migraciones quedaron APLICADAS. Ver abajo |
| 7 | Las tres migraciones | 2026-11-01 | Aplicadas por el camino del paso 6, no por decisión. Pendiente comprobar que están completas |
| 8 | Comprobación de completitud y fotografía posterior | 2026-11-01 22:01 UTC | `comprobar-migraciones.sql` **todo OK**: las tres migraciones están completas. Fotografía **idéntica** a la previa en los doce recuentos, y los cuatro `con_lote` a **0**. Ver abajo |
| 9 | Merge del PR y despliegue del panel | 2026-11-01 22:05 UTC | PR #492 mergeado en `aa2151ec` (código validado por CI: `c060aefe`). Render despliega el panel con la pantalla de importación |
| 10 | Primer mes importado y medido | 2026-11-03 08:50 UTC | **2026-01**: 158 intervenciones, 552 operaciones, 362 servicios, 149 fichas, 1.175 líneas, 5 bloqueados anotados. Nada escrito en las protegidas |
| 11 | Comprobación posterior | 2026-11-03 | La primera versión del script dio **seis PARAR falsos**: comparaba contra la fotografía de dos días antes y le echaba a la importación el trabajo de una tablet. Reescrito por enlace y por ventana. Ver abajo |
| 12 | Febrero y marzo | 2026-11-03 09:11 UTC | Cero PARAR |
| 13 | De abril a septiembre | 2026-11-03 09:25 UTC | Cero PARAR. **Octubre se deja fuera a propósito: el mes está incompleto en el fichero** |

## Lo importado · nueve meses, enero a septiembre de 2026

Fichero `plana 2026 10 10.xlsx`, una sola carga, nueve lotes mensuales, todos
en estado `aplicado`.

| Mes | Interv. | Operac. | Servicios | Fichas | Líneas |
|---|---:|---:|---:|---:|---:|
| 2026-01 | 158 | 552 | 362 | 149 | 1.175 |
| 2026-02 | 146 | 378 | 310 | 105 | 1.065 |
| 2026-03 | 161 | 470 | 331 | 109 | 1.063 |
| 2026-04 | 156 | 534 | 344 | 140 | 1.044 |
| 2026-05 | 154 | 634 | 320 | 202 | 1.107 |
| 2026-06 | 172 | 706 | 413 | 195 | 1.226 |
| 2026-07 | 168 | 642 | 378 | 163 | 1.240 |
| 2026-08 | 164 | 742 | 438 | 212 | 1.315 |
| 2026-09 | 158 | 556 | 345 | 144 | 1.103 |
| **Total** | **1.437** | **5.214** | **3.241** | **1.419** | **10.338** |

Por condición: 1.419 nuevas · 933 usadas · 255 recauchutadas. Identidad del
retirado: 58 reconstruida, 2.549 desconocida, **0 respaldada**.

Contadores: `numero_interno` 1.788 (ha avanzado con las 1.419 fichas, sin
reutilizar huecos); `numero_operacion` **344, sin tocar**.

### Lo que la comprobación dio en verde

Nada protegido apunta al histórico (0 montajes actuales, 0 historial y 0
mediciones sobre una ficha importada), nada se escribió en las protegidas
dentro del segundo de cada lote, ningún periodo cargado dos veces, ninguna
ficha con vehículo o posición, ninguna operación con coste, sin intervención
o que no venga marcada `source = 'import'`.

### Kilómetros: 58 intervalos cerrados de 1.230

| | Intervalos |
|---|---:|
| Utilizables | **44** |
| Anómalos (ritmo no plausible) | 2 |
| Ausentes (falta un extremo) | 10 |
| Incompatibles (km decrecientes) | 2 |
| Abiertos | 916 |
| Interrumpidos | 256 |

Media **25.304 km**, mediana **21.078**, de 995 a 73.901. En el banco la
media salió 24.588 y la mediana **21.078, idéntica**.

Ninguna decisión humana tomada: los 1.230 siguen en `pendiente`.

### Los dos casos a revisar

**1445HWZ**, el conocido, reproducido exacto: 626.290 km en 98 días, 6.391
km/día contra un límite de 2.000, y el aviso nombra además el posible
montaje intermedio del albarán bloqueado B2_26/1590 del 07/04. No se corrige
nada y no se desbloquea nada.

**6087KYT**, que el banco no tenía: kilometraje **decreciente**, 367.500 al
montar el 07/09 y 269.098 al desmontar el 14/09. Se conservan los dos
valores originales, no se convierten en ausentes, y el intervalo queda fuera
de las medias. Hay además dos albaranes del mismo vehículo ese día con orden
desconocido.

Marcados para revisar: 256 con continuidad desconocida y 116 con posible
trabajo adicional de ruedas. Ninguno de los dos interrumpe nada por sí solo.

### Los 58 bloqueados

16 salida de depósito con fecha que no cuadra · 12 línea sin matrícula ·
**9 vehículo no encontrado en la empresa** · 5 carcasa de recauchutado sin
montaje que cuadre · 2 «MONTA 2 CUBIERTAS NUEVAS» sin la línea del
neumático · 14 el resto.

Las cinco matrículas que la base no conoce: **3403KMZ, 6549NHY, 7785LCD,
5401LPW, 6081GVZ**. Tres llevan medidas de turismo (195/65R15, 235/40R19,
225/55R18), así que probablemente son coches o furgonetas que el taller
atendió y que no están en la flota de TyreControl. Si alguna es un camión
que falta, se da de alta y se vuelve a pasar el fichero: la importación es
idempotente y esos albaranes entran solos.

## Lección del paso 11: no se comprueba contra una fotografía

La primera versión del script guardaba los recuentos de antes y comparaba.
Dio **seis PARAR y los seis eran falsos**: entre la fotografía y la
comprobación habían pasado dos días, la flota había trabajado, y el script
le atribuía a la importación 2.214 mediciones hechas por una tablet.

Un recuento congelado solo vale si nadie usa el sistema mientras tanto, y
eso aquí no pasa. Se comprueba por **enlace** —que nada protegido apunte a
algo que creó la importación— y por **ventana** —que en el segundo del lote
no se escribiera nada—, que es lo que aguanta con el taller trabajando.

## Fotografía previa · 2026-11-01 20:54 UTC

| Tabla | Filas | ¿La toca la importación? |
|---|---:|---|
| `movimientos_stock` | 93 | no |
| `tc_montajes_actuales` | 4.800 | no |
| `tc_historial_montajes` | 253 | no |
| `revisiones_vehiculo` | 17.589 | no |
| `revisiones_neumaticos_detalle` | 107.890 | no |
| `tc_vehiculos` | 909 | no |
| `tc_contadores_numero_operacion` | 1 | no (ni la fila ni su valor) |
| `operaciones_neumaticos` | 605 | **sí** |
| `tc_intervenciones` | 350 | **sí** |
| `tc_intervencion_servicios` | 6 | **sí** |
| `tc_neumaticos` | 5.060 | **sí** |
| `tc_contadores_numero_interno` | 1 | la fila no; **su valor sí avanza** |

Cuadra con el preflight: 909 = 807 Plana + 85 ENCATRANS + 16 Mobilink + 1
Canteras, y 5.060 = 4.410 + 559 + 85 + 6.

Que las seis primeras no se muevan no es una esperanza: en las tres
migraciones hay **cero** `insert` y `update` contra ellas.

## Fotografía posterior a las migraciones · 2026-11-01 22:01 UTC

Los doce recuentos, **iguales** a los de las 20:54: 93 · 4.800 · 253 ·
17.589 · 107.890 · 909 · 605 · 350 · 6 · 5.060 · 1 · 1.

Dos lecturas distintas, y las dos importan:

- **Las migraciones no han tocado datos.** Han creado tablas, columnas y
  funciones; las seis tablas protegidas no han movido una fila.
- **Todavía no hay nada importado.** `con_lote` = 0 en las cuatro tablas con
  columna de lote (`operaciones_neumaticos`, `tc_intervenciones`,
  `tc_intervencion_servicios`, `tc_neumaticos`): ninguna fila lleva
  `importacion_lote_id`. Punto de partida limpio con el esquema nuevo puesto.

Cuidado al leer el CSV: el script ordena **por nombre de tabla**, así que la
primera fila es `movimientos_stock` (93) y `tc_montajes_actuales` es la
décima (4.800). Es fácil cruzarlos al transcribirlos a mano; la lista de
arriba es la buena.

## Lo que se espera después de importar los diez meses

`operaciones_neumaticos` 605 → ~3.336 · `tc_intervenciones` 350 → ~1.868 ·
`tc_intervencion_servicios` 6 → ~3.400 · `tc_neumaticos` 5.060 → más las
fichas históricas. Todo el incremento, con `importacion_lote_id`.

Cuatro de cada cinco operaciones de la base pasarán a ser históricas. Por eso
el filtro del vínculo de importación en los informes de inventario no es un
detalle, y por eso **después del primer mes se miran los informes antes de
seguir con el segundo**.

## El ensayo que no se deshizo

El ensayo envolvía las tres migraciones en `begin … rollback` para probarlas
en la versión real sin dejar rastro. Al terminar, la comprobación de después
del `rollback` dio **false, false, false**: las tablas y las funciones
seguían ahí.

Qué pasó: el editor SQL de Supabase no respeta un `rollback` escrito dentro
del script —ejecuta las sentencias con confirmación automática—, así que cada
DDL quedó confirmado según se ejecutaba.

Qué significa: las tres migraciones están **aplicadas en producción**. Es a
donde íbamos de todas formas, pero sin la decisión explícita y, sobre todo,
**sin saber si quedaron completas**: si una sentencia hubiera fallado a
mitad, lo anterior se habría quedado puesto igual. Por eso el paso siguiente
es `comprobar-migraciones.sql`, que mira una a una las 9 tablas, las 2
vistas, las 29 firmas, las 22 columnas y la RLS.

Si algo falta, se arregla volviendo a pasar la migración que lo crea: las
tres son idempotentes. Probado: quitando a mano una función y una columna, la
comprobación las señala, y reaplicando la migración vuelven a estar.

**La lección, para la próxima**: en el editor de Supabase no se puede ensayar
nada con `begin … rollback`. Lo que se pegue ahí, se aplica. El backup previo
dejó de ser una formalidad.

## Lo que no se ha podido probar aquí

Producción va en PostgreSQL **17.6** y en la máquina de desarrollo solo hay
16: no hay paquete de 17, el repositorio oficial está bloqueado por la red y
no hay demonio de Docker. Por eso existe el ensayo `begin … rollback`, que
prueba las tres migraciones **en la base de verdad y en su versión de
verdad** sin dejar rastro.

## Si hay que volver atrás

1. `vuelta-atras-produccion.sql` → el fichero guardado en el paso 3.
2. `deshacer-migraciones.sql` → borra lo que las migraciones crean.

En ese orden, y con las dos guardas que trae el segundo: se niega si quedan
lotes importados (eso lo deshace `tc_deshacer_importacion`) y se niega si las
definiciones de siempre no se han restaurado. Viaje de ida y vuelta probado
contra el esquema reconstruido: 3.570 objetos antes, 3.570 después, cero
diferencias.
