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
