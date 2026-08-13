# Cómo funciona hoy el módulo Operaciones (TyreControl)

> Estado del código a 13-08-2026. Escrito para poder pegarlo como contexto en un
> prompt de cambio: describe lo que **hay**, no lo que debería haber. Al final
> hay una sección de cosas que no encajan, separada a propósito de la
> descripción.

---

## 1. Qué es una operación

Una fila de **`operaciones_neumaticos`** es *un movimiento de un neumático*:
montarlo, quitarlo, cambiarlo de sitio, repararlo, tirarlo. Es la tabla de
trazabilidad del módulo y **nadie puede borrar de ella** — no hay policy de
`delete`, ni siquiera para superadmin. Lo que se hace con una operación
equivocada es anularla, que deja rastro.

Columnas que importan (`tyrecontrol_fase8_operaciones.sql` + `..._fase1.sql`):

| Grupo | Columnas |
|---|---|
| Qué y a quién | `tipo_operacion`, `empresa_id`, `vehiculo_id`, `neumatico_id`, `motivo`, `destino` |
| Dónde | `posicion_origen_id`, `posicion_destino_id`, `montaje_origen_id`, `montaje_destino_id` |
| Ciclo de vida | `status`, `prioridad`, `fecha_prevista`, `started_at`, `completed_at`, `cancelled_at` |
| Quién | `tecnico_id`, `created_by`, `assigned_by`, `source` |
| Dinero | `coste`, `coste_material`, `coste_mano_obra`, `proveedor` |
| Rastro | `numero_operacion`, `is_anulada`, `operacion_anulada_id`, `is_correccion`, `intervencion_id`, `incidencia_id` |

`tipo_operacion`, `motivo` y `destino` **ya no tienen CHECK**: la Fase 1 los
soltó a propósito para que los valores válidos vivan en catálogos editables
(`tc_cat_tipos_operacion`, `tc_cat_motivos`, `tc_cat_destinos`,
`tc_cat_tipos_reparacion`, `tc_cat_resultados_reparacion`). `status`,
`prioridad` y `source` sí siguen validados por CHECK, porque son estructurales.

### Tablas satélite

- **`tc_operacion_movimientos`** — una operación puede mover varios neumáticos
  (una sustitución son un desmontaje y un montaje; un intercambio, dos de cada).
  Cada pieza va aquí, con `orden`.
- **`tc_operacion_estado_historial`** — lo escribe **solo el trigger**
  `trg_op_log_estado`, en cada `UPDATE` que cambie `status`. No se escribe a mano.
- **`tc_operacion_auditoria`** — acciones sobre la operación (crear, anular,
  corregir…) con `motivo` y `datos_anteriores/nuevos`.
- **`tc_operacion_adjuntos`** — fotos, con bucket propio en Storage.
- **`tc_reservas_neumatico`** — un neumático apalabrado para un montaje futuro.
  Unique parcial: **un neumático no puede tener dos reservas activas**.

---

## 2. El ciclo de vida

Diez estados: `borrador`, `pendiente`, `planificada`, `asignada`, `en_proceso`,
`pausada`, `completada`, `cancelada`, `no_realizada`, `anulada`.

**El valor por defecto de `status` es `completada`.** No es un descuido: la
mayoría de operaciones se *registran después de hechas* — el técnico monta la
rueda y luego lo apunta. El flujo planificado es la excepción, no la norma.

Las transiciones que ofrece el panel están en `ACCIONES_ESTADO`
(`Operaciones.tsx:11`):

```
pendiente ──┐
planificada ┴─→ asignada ──→ en_proceso ──→ completada
                                 ↕
                              pausada
(pendiente | planificada | asignada | pausada) ──→ cancelada
```

**Ese grafo vive únicamente en el frontend.** `tc_cambiar_estado_operacion`
comprueba permisos y que el estado esté en la lista de diez, pero **no valida la
transición**: por RPC se puede pasar de `completada` a `pendiente` sin que nada
proteste.

Efectos secundarios del cambio de estado, esos sí en la base de datos:

- `en_proceso` → sella `started_at` (solo la primera vez).
- `completada` → sella `completed_at` y marca sus reservas activas como
  **consumidas**.
- `cancelada` / `no_realizada` / `anulada` → sella `cancelled_at` y **libera**
  las reservas.
- Un `p_motivo` no sustituye las observaciones: se **concatena** con ` · `.

---

## 3. Las dos formas de crear una operación, que no se tocan

Esto es lo más importante para entender el módulo.

### Vía A — Planificar (panel)

Botón **"+ Nueva operación"** → `tc_planificar_operacion`. Crea la fila con
`status = 'planificada'` si lleva fecha prevista o técnico, y `'pendiente'` si
no. Opcionalmente reserva el neumático.

**No ejecuta nada.** El propio modal lo avisa: *"La operación queda
pendiente/planificada. Su ejecución física se registra al marcarla como
completada"*.

### Vía B — Ejecutar (APK y panel)

Los RPC que de verdad mueven neumáticos: `tc_montar_desde_almacen`,
`tc_montar_desde_catalogo`, `tc_montar_fuera_almacen`, `tc_desmontar_neumatico`,
`tc_sustituir_neumatico`, `tc_cambiar_posicion`, `tc_intercambiar_posiciones`,
`tc_registrar_reparacion`, `tc_descartar_neumatico`, `tc_corregir_posicion`,
`tc_corregir_montado`, `tc_regularizar_desmontaje`, `tc_aplicar_plan_trabajo`,
`tc_permutar_plan`.

Cada uno **crea su propia operación ya completada** (por el default de `status`)
además de tocar montajes, estado del neumático y stock del almacén.

### El hueco

**Ninguno de esos RPC acepta el id de una operación planificada.** No hay forma
de "ejecutar la operación #123": la Vía B siempre crea una fila nueva. Así que
si planificas un montaje y luego el técnico lo hace con la APK, quedan **dos
operaciones** en la tabla — la planificada, que sigue pendiente para siempre, y
la real. Marcar "Completar" en el panel cierra la primera **sin montar nada**.

---

## 4. Intervenciones: la sesión de trabajo

`tc_intervenciones` agrupa las operaciones de **una sesión de cambio** — lo que
el técnico hace hasta pulsar *Finalizar* en la APK. Guarda `resumen` (texto
determinista, lo genera `resumenOperaciones.ts`), `resumen_ia` (redacción con
IA), `n_operaciones`, y para el informe `montaje_antes` / `montaje_despues` /
`incidencias` en JSON.

El cierre lo hace el servidor: `POST /api/tyrecontrol/intervencion/cerrar`.

**Las operaciones sueltas.** Solo tienen `intervencion_id` las que pasan por
Finalizar. Las hechas desde el panel y las que salen de resolver una incidencia
nacen huérfanas, y no se pueden envolver al crearse porque panel y APK llaman a
los mismos RPC: la base de datos no sabe si una operación va suelta o pertenece
a una sesión que aún no ha terminado. Lo resuelve a posteriori
`tc_agrupar_operaciones_sueltas(30)`, que agrupa lo que lleve más de 30 minutos
huérfano. La llama el servidor al abrir un histórico, así que se cura sola.

### Dos numeraciones distintas

- `operaciones_neumaticos.numero_operacion` — `bigint` de una secuencia.
  Es lo que el panel pinta como `#1234`.
- `tc_intervenciones.numero` — `text`, formato `tc_generar_numero_operacion()`.

No son la misma serie ni están relacionadas.

---

## 5. La pantalla del panel (`Operaciones.tsx`, 413 líneas)

**Listado.** `listarOperaciones` sobre `operaciones_neumaticos`, orden
`created_at desc`, **tope fijo de 200 filas sin paginación**. Filtros por
empresa, vehículo, tipo, estado y rango de fechas — todos en servidor. El número
que sale junto a los filtros es `items.length`, o sea *lo que ha llegado*, no el
total que cumple el filtro.

**Columnas:** Nº, Fecha, Empresa, Vehículo, Tipo (chip de color por tipo,
`COLOR_TIPO`), Estado (chip + prioridad si no es normal), Neumático, Posición
(`origen → destino`), Km, Motivo, Destino, Coste, Acciones.

**Acciones por fila:** *Detalle* y los botones de transición que toque. Una
operación anulada no ofrece ninguno.

**Detalle** (modal) — carga en paralelo movimientos, adjuntos, historial de
estados y auditoría; cada uno con `.catch(() => [])`, así que **si una consulta
falla la sección sale vacía sin decir por qué**. Desde ahí se anula, exigiendo
motivo.

**Coste.** Se editan `coste_material` y `coste_mano_obra`; la columna muestra la
suma. Los clientes lo ven pero no pueden editarlo. Existe además una columna
`coste` suelta que la pantalla solo usa al exportar, como respaldo.

**Reservas activas** — modal aparte, listado y botón de liberar.

**Exportar Excel** — genera el `.xlsx` en el navegador con las filas que hay
cargadas en pantalla. Hereda el tope de 200.

**Rol cliente** (`rol === 'cliente'` y no superadmin): empresa fijada a la suya,
sin selector de empresa, sin editar costes y sin anular.

---

## 6. Permisos

RLS de `operaciones_neumaticos`:

- **select**: `tc_puede_ver_empresa(empresa_id)`.
- **insert**: superadmin, admin de esa empresa, u operador que la vea.
- **update**: solo superadmin y admin de la empresa. **Un operador no puede
  actualizar una operación por tabla** — únicamente a través de los RPC, que son
  `security definer`.
- **delete**: no existe la policy. Nadie borra.

Los RPC repiten la comprobación por su cuenta
(`tc_is_superadmin() or (tc_is_admin() and …) or tc_operador_ve_empresa(…)`),
porque al ser `security definer` se saltan la RLS.

---

## 7. Cosas que no encajan

Separadas de la descripción a propósito: son observaciones al leer el código,
no encargos.

1. **Planificar y ejecutar son dos mundos** (§3). Es el problema de fondo. Una
   operación planificada nunca se convierte en la real; "Completar" desde el
   panel cierra la ficha sin mover un neumático, y el listado acaba con
   duplicados.
2. **El grafo de estados vive en el frontend.** Cualquier otro cliente del RPC
   puede saltárselo.
3. **200 filas sin paginación**, y el contador de la pantalla dice cuántas han
   llegado, no cuántas hay. Con el volumen actual ya se están ocultando
   operaciones.
4. **El Excel exporta lo cargado**, no lo filtrado. Mismo tope.
5. **`.catch(() => [])` en las cuatro cargas del detalle**: un fallo de permisos
   o de red se ve igual que "no hay nada".
6. **Dos numeraciones** para lo mismo a ojos del usuario (§4).
7. **`coste` convive con `coste_material` + `coste_mano_obra`** sin una regla
   escrita de cuál manda.
8. **`tc_agrupar_operaciones_sueltas` depende de que alguien abra un histórico.**
   Si nadie lo abre, las operaciones quedan huérfanas indefinidamente.

---

## 8. Ficheros

| Qué | Dónde |
|---|---|
| Pantalla | `src/modules/tyrecontrol/pages/Operaciones.tsx` |
| Consultas y RPC | `src/modules/tyrecontrol/services/data.ts` (`listarOperaciones`, `planificarOperacion`, `cambiarEstadoOperacion`, `anularOperacion`, `listarReservas`…) |
| Resumen en texto | `src/modules/tyrecontrol/services/resumenOperaciones.ts` |
| Tipos y etiquetas | `src/modules/tyrecontrol/types/index.ts` |
| Tabla y RLS | `supabase/migrations/tyrecontrol_fase8_operaciones.sql` |
| Ciclo de vida, satélites, catálogos | `supabase/migrations/tyrecontrol_operaciones_fase1.sql` |
| Posiciones y correcciones | `..._operaciones_fase3.sql` |
| Reparaciones y adjuntos | `..._operaciones_fase4.sql` |
| Planificar / estados / reservas | `..._operaciones_fase5.sql` |
| Anular y auditar | `..._operaciones_fase6.sql` |
| Intervenciones | `tyrecontrol_intervenciones.sql`, `tyrecontrol_numero_operacion.sql`, `tyrecontrol_trazabilidad_operaciones.sql` |
| Deshacer | `tyrecontrol_deshacer_cambio.sql` |
| APK | `tyrecontrol_app/lib/screens/cambio_neumatico_screen.dart`, `historial_operaciones_screen.dart`, `lib/services/supabase_service.dart` |
| Cierre de intervención | `server/index.ts` → `POST /api/tyrecontrol/intervencion/cerrar` |
