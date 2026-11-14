# Alcance estadístico de la importación del histórico

Pregunta: **¿con esta importación se pueden obtener estadísticas de rendimiento
de los neumáticos montados y cantidades por marca y modelo?**

Respuesta corta: **no con los informes actuales**. La importación conserva
operaciones históricas (qué goma se puso, en qué vehículo, qué día, con qué
condición y, a veces, en qué eje), pero no crea fichas de neumático ni
montajes, y el módulo de informes calcula el rendimiento y las cantidades por
marca a partir de las fichas (`tc_neumaticos`), de los montajes
(`tc_montajes_actuales`, `tc_historial_montajes`) y de las revisiones. Los
datos importados permiten **recuentos de operaciones históricas** (por marca,
modelo, medida y condición) con una consulta nueva, que no existe hoy y que
queda fuera del alcance de este PR.

Comprobado con consultas reales sobre el esquema completo de pruebas
(`esquema_completo`, 48 operaciones históricas importadas de un lote de
octubre y otro de septiembre), no por lectura del código solamente.

## 1. Qué lee hoy cada estadística

| Estadística (panel) | RPC / tabla | ¿Lee las operaciones importadas? | Comprobación |
|---|---|---|---|
| Dashboard · tarjeta «Montajes» y resto de `op_*` | `tc_informes_kpis` → `operaciones_neumaticos` por empresa y `fecha_operacion` | **Sí, sin distinguirlas** | `op_montajes = 48`, todas históricas |
| Informes · Operaciones (total, por tipo, por motivo, evolución mensual) | `tc_informes_operaciones` → `operaciones_neumaticos` | **Sí, sin distinguirlas** | `total 48`, `por_tipo montaje 48`, `por_motivo "—" 48` |
| Informes · Económico (costes de operaciones) | `tc_informes_economico` → `operaciones_neumaticos.coste_*` | Entran, pero suman 0 € (no traen costes) | — |
| Dashboard / Inventario · neumáticos por marca, modelo, medida, estado | `tc_informes_inventario_por`, `tc_informes_inventario_marca_medida` → `tc_neumaticos` | **No** | con 14 montajes Hankook importados, el inventario por marca sigue siendo `— : 1` (la única ficha real) |
| Rankings · marcas y coste por km | `tc_informes_ranking_marcas`, `tc_informes_coste_km_neumatico` → `tc_neumaticos` + `tc_historial_montajes` + `tc_montajes_actuales` (las operaciones solo con `neumatico_id is not null`) | **No** | ranking de marcas: 0 filas; coste/km: 1 fila (la ficha real) |
| Ficha del neumático · «Kilómetros recorridos» | `tc_neumatico_recorrido` → `tc_historial_montajes` + `tc_montajes_actuales` | **No** (no hay ficha) | — |
| Ejecutivo, Alertas, Estado de flota, Desgaste, Presiones, Control de revisiones | revisiones + `tc_neumaticos` + `tc_vehiculos` | **No** | — |
| Productividad | `operaciones_neumaticos` con `tecnico_id is not null` | **No** (sin técnico) | — |
| APK · Analítica (`tc_prod_operaciones`) | `tc_intervenciones` con `fin_at` y `duracion_seg` | **No** | 49 intervenciones históricas, 0 con `fin_at` |
| Almacén de usados · `km_acumulados` | `tc_historial_montajes` | **No** | — |
| «Histórico de trabajos» de Análisis y estadísticas (PR #491) | módulo WorkPlanner, tabla `jobs` | **No** (otro módulo) | — |

No existe ningún informe que agrupe por `operaciones_neumaticos.marca_txt` /
`modelo_txt`, ni que calcule rendimiento por vehículo y posición.

## 2. Qué datos quedan disponibles tras la importación

En `operaciones_neumaticos` (vínculo `importacion_lote_id`), por cada goma:
`vehiculo_id`, `fecha_operacion` (fecha real del albarán, hora desconocida),
`condicion` (nueva / usada / recauchutada), `marca_txt` / `modelo_txt` /
`medida_txt` (texto del albarán; las usadas suelen traer solo medida),
`km_vehiculo` del albarán cuando lo hay, `posicion_destino_id` solo cuando se
dedujo (con `posicion_fuente = 'deducida'`) y `posicion_fuente =
'desconocida'` en el resto. En `tc_intervenciones`: albarán, vehículo, fecha,
`origen_sistema`, `origen_doc`; en `tc_intervencion_servicios`: servicios y
cantidades; en `tc_importacion_lineas`: la línea original.

Con una consulta nueva (no incluida) se obtiene, por ejemplo:

```sql
select marca_txt, modelo_txt, medida_txt, condicion, count(*)
from operaciones_neumaticos
where importacion_lote_id is not null and not is_anulada and tipo_operacion = 'montaje'
group by 1, 2, 3, 4;
-- esquema de pruebas: Hankook AH51 154M 295/80R22.5 nueva → 14; (sin marca) 295/80R22.5 usada → 18 …
```

Es decir: **cantidades de gomas puestas por marca, modelo, medida y condición,
por vehículo y por mes**, y **con qué servicios**. Sí.

## 3. Qué datos NO quedan disponibles

- **Rendimiento del neumático** (km recorridos, duración, fecha de montaje y
  desmontaje): no. Cada goma histórica no tiene ficha (`neumatico_id` nulo),
  no se escribe en `tc_historial_montajes` ni en `tc_montajes_actuales`, y el
  albarán no dice cuándo se desmontó ni con qué km. Solo hay km del vehículo
  en el momento del montaje (43 de 48 en pruebas) y ningún km de desmontaje.
  Calcular «km por goma» exigiría emparejar montajes sucesivos en la misma
  posición del mismo vehículo, y la posición solo se conoce **deducida** (2, 4
  o 6 nuevas de una referencia, con plano compatible) y nunca en usadas ni
  recauchutadas: no es fiable.
- **Trazabilidad de stock, coste de compra, profundidades, presiones**: no;
  no se tocan `movimientos_stock`, `tc_neumaticos`, revisiones ni `km_actual`.
- **Posición**: las operaciones con `posicion_fuente = 'desconocida'` no
  deben atribuirse a ninguna posición; las `deducida` deben enseñarse como
  deducidas (así lo hacen el panel, el modal de la ficha, el informe y el
  PDF), nunca como confirmadas.
- **Por marca y modelo en los informes actuales**: no, porque leen
  `tc_neumaticos`, donde la importación no crea nada (por diseño: sin fichas
  ficticias).

## 4. Diferenciación histórico / normal en los informes

El criterio es el vínculo `importacion_lote_id` (`shared/historicoAlbaran.ts`)
y lo aplican las listas, la ficha del vehículo, el informe y el PDF. **Los dos
RPC que sí leen `operaciones_neumaticos` sin filtrar** (`tc_informes_kpis`,
`tc_informes_operaciones`) **no lo aplican**: en el Dashboard y en Informes ·
Operaciones los montajes históricos se suman a los del taller en el rango de
fechas elegido (por defecto el mes en curso, así que solo afecta si el rango
cubre fechas con albaranes importados). Es decir, hoy esas dos cifras no
distinguen histórico de operación normal. No se ha cambiado porque son
funciones ajenas a esta funcionalidad y el alcance autorizado no lo incluye.

## 5. Cambios posteriores necesarios (propuesta, sin implementar)

1. **Separar el histórico en `tc_informes_kpis` y `tc_informes_operaciones`**:
   excluir las filas con `importacion_lote_id is not null` de los contadores
   actuales y devolverlas en claves aparte (`op_montajes_historicos`,
   `por_tipo_historico`…), con su tarjeta propia en el Dashboard y en
   Operaciones. Migración pequeña sobre dos funciones ajenas; conviene antes
   de la primera importación en producción si el Dashboard se consulta con
   rangos amplios.
2. **Informe «Histórico importado»** (nuevo RPC `tc_informes_historico` o
   similar): cantidades por marca / modelo / medida / condición, por vehículo,
   por mes y servicios, leyendo solo `operaciones_neumaticos` con
   `importacion_lote_id` y `tc_intervencion_servicios`; etiquetado como
   histórico y con las posiciones marcadas deducida / desconocida.
3. **Rendimiento por goma**: solo sería posible creando fichas de neumático
   y montajes a partir del histórico, cosa que este PR excluye expresamente
   (no neumáticos ficticios, no montajes). Si se quisiera, sería un proyecto
   aparte con reglas de emparejamiento y aceptación explícita de su margen de
   error.


---

## Fase 3: qué cambia en el alcance estadístico

Tres cosas, y conviene leerlas antes de dar cualquier media por buena.

**1. Un recorrido calculable ya no es automáticamente un recorrido usable.**
La clasificación de los kilómetros de un intervalo pasa a tener cuatro
estados, y los hace la máquina sin opinión humana:

| Estado | Qué significa | ¿Entra en las medias? |
|---|---|---|
| `utilizables` | hay kilometraje en los dos extremos, crece, y el ritmo diario es plausible | sí, si además la continuidad está limpia |
| `anomalos` | hay kilometraje en los dos extremos y crece, pero el ritmo diario supera el límite. **El recorrido se calcula y se guarda igual** | solo si una persona acepta los kilómetros |
| `ausentes` | falta el kilometraje de un extremo o de los dos | no |
| `incompatibles` | hay valores pero el kilometraje decrece. **Los dos valores se conservan** | no |

Y una marca aparte, `orden_desconocido`, para el **mismo día**: montaje y
desmontaje con la misma fecha y recorrido positivo. El recorrido se conserva,
pero **no se publica ningún «km/día»**, porque no se sabe en qué orden se
hicieron los trabajos ni cuánto tiempo pasó: los albaranes no traen hora de
trabajo y la intervención se importa con `hora_desconocida`. Comparar el
recorrido con el límite de un día sirve como comprobación auxiliar y se
presenta como tal, nunca como un ritmo observado. Un recorrido **cero** el
mismo día es lo normal y no genera ninguna anomalía por sí solo; uno positivo
queda fuera de las estadísticas hasta que alguien revise ese orden.

El criterio de plausibilidad es el **ritmo diario**, no el recorrido total:
180.000 km en tres años es creíble y 180.000 km en tres meses no, y el total
no distingue. El límite es configurable por empresa y arranca en **2.000
km/día**. Está escrito en el aviso de cada intervalo junto con el ritmo
calculado, los días, las fechas, los kilómetros y los albaranes: no es un
umbral escondido y se puede rebatir. Con cero días no se divide entre cero: se
compara el recorrido con el límite de un día y el aviso lo dice.

Un aviso de plausibilidad **no demuestra que el dato sea falso**. Es un
criterio de revisión.

**2. La decisión humana es otra cosa, y son DOS.** Una persona puede aceptar o
rechazar, con motivo obligatorio, usuario y fecha, en
`tc_reconstruccion_revisiones`, y lo hace en **uno de dos ámbitos**:

- `kilometros` → el recorrido es creíble y puede usarse como estimado;
- `continuidad` → la cadena de esa posición puede darse por limpia pese al
  documento bloqueado que hay dentro.

**Aceptar los kilómetros no abre la puerta de la continuidad**, y al revés
tampoco: son dos puertas y cada una tiene su llave. Rechazar **no** convierte
los kilómetros en ausentes ni en decrecientes: la clasificación sigue siendo
la que era y el recorrido sigue guardado. Aceptar permite usar el intervalo
como **estimado** y nunca lo convierte en rendimiento confirmado. Si la
evidencia del intervalo cambia después, la decisión caduca, queda constancia
de la invalidación y el intervalo vuelve a pedir revisión de ese ámbito; la
auditoría no se borra en ningún caso, tampoco al deshacer una importación, y
los roles de la aplicación no pueden escribir en ella (RLS de solo lectura más
los permisos revocados).

**3. Un albarán bloqueado dentro de un intervalo lo deja con la continuidad
pendiente.** Los 25 albaranes bloqueados siguen sin importarse: no se crean
sus operaciones, ni sus fichas, ni ninguna cantidad. Pero si uno de ellos cae
dentro de un intervalo y contiene anotaciones de montaje, la cadena de esa
posición **no se puede considerar limpia**, y el intervalo lo dice con el
documento y el motivo literal del bloqueo. No se elige posición ni eje: no se
sabe cuál fue. Y resolver el kilometraje de un intervalo no resuelve su
continuidad: son dos motivos distintos que se cuentan por separado.

### La cobertura, publicada con cada media

`tc_informes_recorridos_estimados` devuelve la media **y** lo que ha dejado
fuera: intervalos incluidos, excluidos por cada motivo, gomas identificadas
frente a ocupaciones de posición, y periodo y población analizados. Tres
reglas de lectura que van dentro del propio dato:

- **Tres identidades, no dos.** `respaldada` (una persona identificó el
  neumático físico), `reconstruida` (hay ficha, con su número interno, creada
  por la importación, pero nadie ha confirmado qué goma era) y `sin_ficha`.
  Las tres suman la población y **cada una tiene su media**: no se promedian
  juntas. El número interno de una ficha reconstruida **identifica un
  registro histórico y permite enlazarlo; no demuestra qué neumático físico
  estuvo montado todo el intervalo**. Y «sin identificación física» no es lo
  mismo que «sin ficha»: la ficha existe.
  **Con la carga de diez meses de Plana: 0 respaldadas, 1.452 reconstruidas y
  0 sin ficha.** Así que, hoy, ninguna media de esta reconstrucción es el
  rendimiento de un neumático concreto, y el informe lo dice con esas
  palabras.
- **Calculable no es elegible.** La cobertura publica el embudo: cuántos
  intervalos tienen un recorrido que se puede restar y cuántos pasan además
  los filtros de plausibilidad, continuidad y decisión humana. Con los diez
  meses: **52 calculables, 50 elegibles**.
- **Los motivos de exclusión se solapan.** Un intervalo puede ser anómalo Y
  tener continuidad pendiente: aparece en los dos. Por eso los motivos no
  suman el total y se publica además la lista de combinaciones, que sí suma.

### Los denominadores, y por qué son distintos

Cuatro cifras que se citan juntas y **no miden lo mismo**. Cada una con la
consulta que la sostiene, sobre la carga de diez meses:

| Cifra | Qué cuenta | Consulta |
|---|---|---|
| **1.511** | fichas creadas por la importación | `select count(*) from tc_neumaticos where importacion_lote_id is not null` |
| **1.452** | intervalos reconstruidos (uno por montaje **con posición**) | `select count(*) from tc_reconstruccion_montajes` |
| **66** | de esos intervalos, los que están **cerrados** | `… where estado = 'cerrado'` |
| **50** | los **elegibles** para las medias estimadas | `… where tc_imp_intervalo_en_medias(rm)` |

**Los 1.452 intervalos no son el total de fichas**, y la diferencia tiene una
explicación exacta. La cadena, de arriba abajo:

```
2.731 montajes históricos
  ├─ 1.511 nuevas  ──┬─ 1.452 con posición deducida  → 1.452 intervalos
  │                  └─    59 sin posición           → sin intervalo
  ├─   960 usadas        (nunca reciben posición deducida)
  └─   260 recauchutadas (nunca reciben posición deducida)
```

- **Ficha ≠ intervalo.** La ficha se crea para **cada montaje de goma
  nueva**: 1.511, ni una más (comprobado: todas las fichas de la importación
  cuelgan de un montaje `nueva`). Las usadas y las recauchutadas no reciben
  ficha; van a la bandeja de identificación.
- **El intervalo se abre solo si hay posición.** Un montaje sin posición no
  dice dónde fue la goma, así que no abre ocupación. De las 1.511 nuevas,
  **59 se montaron en vehículos cuyo plano no admitía la norma** (o en
  albaranes con varias referencias), se quedaron sin posición deducida y por
  tanto sin intervalo. 1.452 + 59 = 1.511.
- **Los montajes sin posición son 1.279** = 59 nuevas + 960 usadas + 260
  recauchutadas. 1.452 + 1.279 = 2.731.

De los **1.452 intervalos**: 1.056 abiertos, 330 interrumpidos y **66
cerrados**. Solo un intervalo cerrado puede tener recorrido.

De los **66 cerrados**: 52 tienen un recorrido que se puede calcular (50
utilizables + 2 anómalos) y 14 no (12 sin kilómetros + 2 incompatibles). De
esos 52, **50 son elegibles**: los 2 que se caen son los de 1445HWZ, por ritmo
no plausible **y** por continuidad pendiente a la vez.

```
1.452 intervalos → 66 cerrados → 52 con recorrido calculable → 50 elegibles
```

Que el informe publique los dos últimos números por separado (`embudo`) es a
propósito: **tener un recorrido que se puede restar no es poder usarlo**.

### Los números de la carga de diez meses, con la fase 3

| | |
|---|---|
| Intervalos reconstruidos | 1.452 (1.056 abiertos · 66 cerrados · 330 interrumpidos) |
| Con recorrido aritmético | 52 |
| **Entran en las medias tras todos los filtros** | **50** |
| Media de esos 50 | **24.588 km** (mediana 21.078 · de 736 a 73.901) |
| De los 50, identidad respaldada | **0**. Las 50 son fichas reconstruidas |
| Intervalos cerrados el mismo día | **0** (la regla del mismo día no se activa con estos datos) |
| Fuera de las medias | 1.402 |
| · sin cerrar | 1.386 |
| · continuidad pendiente | 334 |
| · kilómetros ausentes | 12 |
| · ritmo anómalo pendiente de validar | 2 |
| · kilometraje incompatible | 2 |
| Albaranes bloqueados anotados | 25 (7 con evidencia de posible montaje) |
| Intervalos con un bloqueado dentro | 4 (los 2 de 1445HWZ y los 2 de 9103KWW) |

Los motivos se solapan: 332 de los 334 con continuidad pendiente están además
sin cerrar, y los 2 anómalos tienen también continuidad pendiente. Las
combinaciones que publica el informe sí suman los 1.402.

Antes de la fase 3 esos 50 intervalos eran 52 y la media era **47.731 km**:
los dos intervalos de 1445HWZ, con 626.290 km cada uno, casi la duplicaban. La
mediana no se movía, que es lo que cabía esperar.

### Los planos que admiten la regla de las seis nuevas

La regla —2 al eje 1 y 4 al eje 2— se aplica cuando hay **una sola
referencia** y el plano tiene **exactamente 2 posiciones activas en el eje 1 y
4 en el eje 2**. Que exista un tercer eje no lo impide:

| Plano | 2 nuevas | 4 nuevas | 6 nuevas |
|---|---|---|---|
| 2+4 | eje 1 | eje 2 | 2+4 |
| 2+4+2 | eje 1 | eje 2 | 2+4, nada al eje 3 |
| 2+4+4 | eje 1 | eje 2 | 2+4, nada al eje 3 |
| 2+2 | eje 1 | no encaja | no encaja |
| sin plano | — | — | — |

Donde no encaja, la asignación queda pendiente de revisión y la posición se
registra como desconocida. El albarán se importa igual.
