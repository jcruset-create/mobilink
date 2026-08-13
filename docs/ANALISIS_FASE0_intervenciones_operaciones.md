# Fase 0 — Análisis del rediseño de Intervenciones y Operaciones

> Entregable de la Fase 0 de `docs/PROMPT_intervenciones_operaciones.md`.
> Verificado contra el código de `main` el 13-08-2026 (commit `98403d0`).
> **No se ha tocado código.** Este documento espera la aprobación de Jordi
> antes de que empiece cualquier implementación.

Resumen en tres líneas:

1. Los hechos **[verificado]** del prompt siguen siendo ciertos, con dos
   matices nuevos (§A.3 y §A.4): una sustitución crea **dos** filas de
   operación, y la red de seguridad `tc_agrupar_operaciones_sueltas` también
   envuelve **operaciones planificadas sin ejecutar**, generando intervenciones
   falsas.
2. La decisión del §2 del prompt es **(b) vincular**, no absorber (§F).
3. El orden de fases propuesto es el del prompt con un cambio: la validación
   de transiciones en BD (parte de la fase 2) conviene hacerla en la fase 1,
   porque el vínculo prevista→ejecutada se apoya en ella (§D.0).

---

## A. Cómo funciona hoy

`docs/COMO_FUNCIONA_OPERACIONES.md` sigue siendo la descripción de referencia
y casi todo lo que dice es correcto. Aquí van solo las **correcciones y
precisiones** tras releer el código (el propio fichero queda corregido en este
mismo commit):

### A.1 Las fases 7 y 8 ya están hechas (el doc describía el estado anterior)

- `Operaciones.tsx` tiene ahora 473 líneas, no 413. Paginación de servidor de
  50 en 50 con total real (`listarOperacionesPagina`, `data.ts:1071`,
  `count: "exact"`), el contador enseña `1–50 de N` (`Operaciones.tsx:239`).
- El Excel exporta **todo lo que cumple el filtro** por bloques, con tope de
  seguridad de 10.000 filas y aviso si se trunca (`listarOperacionesTodas`,
  `data.ts:1098`; `Operaciones.tsx:101-126`).
- El modal de detalle ya no usa `.catch(() => [])`: usa `Promise.allSettled`
  y cada sección distingue "sin datos" de "no se ha podido cargar"
  (`Operaciones.tsx:74-90` y componente `Seccion`, `Operaciones.tsx:458`).
- La cabecera dice "Nº operación" con tooltip aclarando que no es el número de
  intervención (`Operaciones.tsx:247`).

### A.2 Quién llama a `tc_agrupar_operaciones_sueltas`

No la llama el servidor Node: la llaman **los clientes** directamente por RPC
al abrir un histórico — la APK (`supabase_service.dart:983`, en
`listarIntervencionesVehiculo`) y el panel (`data.ts:1017`, en
`listarIntervenciones`). Best-effort en ambos. La versión vigente es la de
`tyrecontrol_agrupar_sueltas_concurrencia.sql` (cerrojo advisory +
`for update skip locked`).

### A.3 Una sustitución son DOS filas de operación, no una con dos movimientos

`tc_sustituir_neumatico` (versión vigente: `tyrecontrol_stock_usado.sql:201`)
inserta una operación `sustitucion` para el neumático retirado y luego llama a
`tc_montar_desde_almacen`, que inserta **otra** operación `montaje`; acto
seguido la reetiqueta a `sustitucion` con una ventana de 5 segundos
(`stock_usado.sql:239-241`). La jerarquía "operación → 1..N movimientos" de
`tc_operacion_movimientos` existe en el esquema, pero hoy solo la rellenan
cuatro RPC: `tc_cambiar_posicion` / `tc_intercambiar_posiciones` /
correcciones (`operaciones_fase3.sql`), `tc_registrar_reparacion`
(`operaciones_fase4.sql`), `tc_permutar_plan` y `tc_aplicar_plan_trabajo`.
Montaje, desmontaje, sustitución y descarte **no escriben movimientos**.

Esto importa para el §2 del prompt: una operación prevista ("sustituir P1") no
se corresponde con una fila ejecutada, sino con **una o varias**. Es el
argumento central de la decisión F.

### A.4 La red de seguridad también envuelve operaciones SIN ejecutar

`tc_agrupar_operaciones_sueltas` filtra solo por `intervencion_id is null` y
antigüedad (>30 min). **No mira `status`.** Consecuencia real hoy: una
operación planificada desde el panel, a la media hora, queda envuelta en una
"intervención" de una línea cuyo resumen dice `Montaje` como si se hubiera
hecho. Lo mismo hace el endpoint de cierre: `POST
/api/tyrecontrol/intervencion/cerrar` agrupa las operaciones huérfanas del
vehículo desde `desde` filtrando solo `is_anulada` (`server/index.ts:1675`),
así que una prevista creada durante la sesión entraría en el resumen como
hecha. Hay que corregirlo en la fase 2 (§D.2).

### A.5 Cómo se forma hoy una intervención (ciclo completo)

1. El técnico abre la pantalla de Cambios. La "sesión" es un timestamp en
   memoria: `_abiertoEn = DateTime.now()`
   (`cambio_neumatico_screen.dart:69`). No existe fila de intervención aún.
2. Cada botón llama a su RPC de ejecución; las operaciones nacen huérfanas
   (`intervencion_id` null) con `status='completada'` por defecto.
3. Al pulsar **Finalizar**, la APK llama al endpoint de cierre con
   `desde=_abiertoEn`, `inicioAt`, `finAt` y las pausas
   (`supabase_service.dart:1122-1160`). El servidor recoge las huérfanas del
   vehículo desde `desde`, genera el resumen determinista (copia del de
   `resumenOperaciones.ts`), redacta el `resumen_ia`, calcula el plano
   "después", **crea** la `tc_intervenciones` (el `numero` OP-AAAA-NNNNNN lo
   pone el DEFAULT de la BD) y enlaza las operaciones
   (`server/index.ts:1657-1865`).
4. Lo que no pasa por Finalizar (panel, incidencias) lo recoge la red de
   seguridad de A.2 en la siguiente visita a un histórico.

Sobre §3.1 del prompt (tiempos): correcto, ya existen y ya se alimentan — la
APK manda `inicioAt`/`finAt`/pausas y el servidor calcula
`duracion_seg`/`trabajo_seg` (`server/index.ts:1821-1846`). El "INICIAR /
FINALIZAR" pedido en §7.6 **ya tiene equivalente**: abrir la pantalla de
Cambios y el botón Finalizar. No hay que añadir botones; hay que hacer que ese
inicio cree la intervención en BD (fase 3) en lugar de ser solo un timestamp
en memoria. Las intervenciones creadas por la red de seguridad no tienen
tiempos (solo heredan `created_at`), y es correcto que no los tengan.

### A.6 Versión vigente de cada RPC de ejecución

Varias migraciones redefinen los mismos RPC (se ejecutan a mano, en orden).
Para no partir de una versión vieja al tocarlos, esta es la definición vigente
de cada uno de los catorce:

| RPC | Fichero de la versión vigente |
|---|---|
| `tc_montar_desde_almacen` | `tyrecontrol_usados_por_ficha.sql:114` |
| `tc_montar_desde_catalogo` | `tyrecontrol_politica_identificacion.sql:314` |
| `tc_montar_fuera_almacen` | `tyrecontrol_fase23_stock_manual_y_fuera_almacen.sql:16` |
| `tc_desmontar_neumatico` | `tyrecontrol_papelera_reciclaje.sql:20` |
| `tc_sustituir_neumatico` | `tyrecontrol_stock_usado.sql:201` |
| `tc_cambiar_posicion` | `tyrecontrol_operaciones_fase3.sql:16` |
| `tc_intercambiar_posiciones` | `tyrecontrol_operaciones_fase3.sql:55` |
| `tc_corregir_posicion` | `tyrecontrol_operaciones_fase3.sql:99` |
| `tc_corregir_montado` | `tyrecontrol_operaciones_fase3.sql:148` |
| `tc_registrar_reparacion` | `tyrecontrol_operaciones_fase4.sql:22` |
| `tc_descartar_neumatico` | `tyrecontrol_fase8_operaciones.sql:450` |
| `tc_regularizar_desmontaje` | `tyrecontrol_regularizar_desmontaje.sql:109` |
| `tc_aplicar_plan_trabajo` | `tyrecontrol_plan_trabajo.sql:37` |
| `tc_permutar_plan` | `tyrecontrol_permutar_plan.sql:16` |

(Cadena de dependencias comprobada: `montar_buscar_o_crear` define
`tc_reenganchar_neumatico`; `politica_identificacion` la usa y añade
`tc_identificacion_para_montaje`; `usados_por_ficha` usa ambas y es la última
palabra sobre `tc_montar_desde_almacen` y `tc_stock_almacen_empresa`.)

Además: `tc_resolver_incidencia_parcial`
(`tyrecontrol_trazabilidad_operaciones.sql:29`) también inserta operaciones
(`reparacion` en sitio, con `incidencia_id`) — cualquier cambio transversal
sobre "quién inserta operaciones" tiene que contarla como el decimoquinto
insertador, junto con la escritura directa del panel para costes
(`actualizarCosteOperacion`) que solo hace update.

### A.7 Confirmaciones del resto de hechos [verificado] del prompt

Comprobados y ciertos a día de hoy: ninguno de los catorce RPC acepta id de
operación (`p_operacion` solo existe en `tc_cambiar_estado_operacion`,
`tc_anular_operacion` y `tc_auditar_operacion`); el grafo de transiciones vive
solo en `Operaciones.tsx:11-17` y `tc_cambiar_estado_operacion` no valida
transiciones (`operaciones_fase5.sql:74-76`); no hay policy de delete sobre
`operaciones_neumaticos` (`fase8_operaciones.sql:214`); la única referencia a
intervenciones en `pages/` está en `VehiculoDetalle.tsx` (no existe pantalla
de Intervenciones); el resumen está duplicado (`resumenOperaciones.ts:5-27`
vs `server/index.ts:1679-1691`); la Decisión 1 del stock está cerrada en
código (`tyrecontrol_usados_por_ficha.sql`, comprobación final incluida) y
`tc_montar_fuera_almacen` crea el neumático con
`origen='montaje_directo_cliente'` y exige `puede_montar_fuera_almacen` o
admin (`fase23:37,57`).

---

## B. Qué se conserva tal cual

- **El modelo de datos entero.** `tc_intervenciones` →
  `operaciones_neumaticos` → `tc_operacion_movimientos`, satélites
  (historial, auditoría, adjuntos, reservas), catálogos, y las dos
  numeraciones (`numero_operacion` bigint y `tc_intervenciones.numero` text;
  se aclaran en interfaz, no se tocan).
- **Los diez estados** y el CHECK `ck_op_status`, y el **default
  `'completada'`**: registrar-después-de-hecho sigue siendo la norma.
- **Los catorce RPC de ejecución** en su comportamiento actual cuando se les
  llama como hoy (sin parámetros nuevos). Solo se les añade cola opcional
  (§D). Su atomicidad y sus validaciones de permiso no se tocan.
- **RLS y permisos** tal como están (incluido "nadie borra operaciones").
- **`tc_agrupar_operaciones_sueltas`** como red de seguridad (con el arreglo
  de estado del §A.4).
- **El endpoint de cierre** y su reparto de responsabilidades (resumen
  determinista + IA que solo redacta, plano antes/después, tiempos).
- **La Decisión 1 del stock** (§3.2 del prompt): cerrada, no se reabre.
  `tc_stock_almacen_empresa` es la fuente canónica de stock.
- **El flujo de la APK**: abrir pantalla = empezar, Finalizar = cerrar. Ni un
  botón nuevo.
- **Las reservas** con su unique parcial y su ciclo activa/consumida/liberada.
- **Todo lo entregado en las fases 7 y 8** (paginación, Excel, errores del
  detalle).

---

## C. Qué causa el problema del §2, con las líneas

El diagnóstico del prompt es correcto. Las piezas exactas:

1. **La vía A no ejecuta.** `tc_planificar_operacion`
   (`operaciones_fase5.sql:27-60`) inserta con `status`
   `pendiente`/`planificada` y opcionalmente reserva. Nada más.
2. **La vía B no conoce la vía A.** Los catorce RPC de §A.6 insertan su
   propia fila, que nace `completada` por el default
   (`operaciones_fase1.sql:15`). Ninguno acepta un id de operación prevista.
   Ejemplos concretos del insert: `usados_por_ficha.sql:241-246` (montaje),
   `papelera_reciclaje.sql:49-57` (desmontaje), `stock_usado.sql:223-241`
   (sustitución, dos filas).
3. **"Completar" miente.** El botón (`Operaciones.tsx:15`) llama a
   `accionEstado` (`Operaciones.tsx:146-150`) → `cambiarEstadoOperacion`
   (`data.ts:924`) → `tc_cambiar_estado_operacion`
   (`operaciones_fase5.sql:78-96`), que sella `completed_at`, consume las
   reservas y no mueve nada. El modal además lo promete al revés:
   *"Su ejecución física se registra al marcarla como completada"*
   (`Operaciones.tsx:337`).
4. **El grafo de estados no existe en BD.** `operaciones_fase5.sql:74-76`
   solo valida pertenencia a la lista de diez. `completada → pendiente` pasa.
5. **La sesión de la APK es un timestamp en memoria**
   (`cambio_neumatico_screen.dart:69`), no un `intervencion_id`; el cierre
   agrupa por "huérfanas del vehículo desde X" (`server/index.ts:1664-1673`),
   y la red de seguridad solo corre si alguien abre un histórico
   (`supabase_service.dart:983`, `data.ts:1017`) y envuelve también previstas
   (§A.4).
6. **El resumen está duplicado** (`resumenOperaciones.ts` vs
   `server/index.ts:1679-1691`), con una divergencia ya visible: la copia del
   servidor no conoce `correccion_posicion`/`correccion_montado` y usa la
   medida del neumático como último recurso de etiqueta, la del front usa el
   número interno.

---

## D. Cambios mínimos, por capa

Numerados por la fase de implementación a la que pertenecen (las fases del §8
del prompt; 7 y 8 ya entregadas).

### D.0 Propuesta de reordenación (pequeña)

El prompt permite cambiar el orden explicando por qué. Propongo mover la
**validación de transiciones en BD** (que el prompt sitúa en el flujo de la
fase 2 vía §4.6) al **final de la fase 1**, porque el vínculo
prevista→ejecutada de la fase 2 necesita que "cerrar la prevista" sea una
transición legal definida en BD antes de automatizarla. El resto queda igual:

```
1. Unificar intervención + operaciones  (+ grafo de estados en BD)
2. Eliminar duplicidad planificada/ejecutada  (vincular, §F)
3. Intervención activa en la APK
4. Planificación de intervenciones (panel)
5. Stock y snapshot        ← bloqueada hasta regularizar §3.2 en producción
6. Informe de intervención
```

### D.1 Base de datos

- **[fase 1]** `tc_intervenciones`: columna `cerrada_at timestamptz` (null =
  abierta). Backfill: todas las filas existentes se cierran con
  `coalesce(fin_at, created_at)` para que nada histórico parezca abierto.
  RPC nuevo `tc_iniciar_intervencion(p_vehiculo, p_obs…) returns uuid` que
  crea la fila con `inicio_at=now()` y devuelve id + número; si ya hay una
  abierta del mismo vehículo y técnico, la devuelve (idempotente: es lo que
  hace posible §4.2/§4.3 sin duplicar).
- **[fase 1]** Trigger de transiciones sobre `operaciones_neumaticos`
  (update de `status`): bloquear salir de estado terminal
  (`completada`/`cancelada`/`no_realizada`/`anulada`), con dos excepciones:
  `→ anulada` desde cualquiera (lo usa `tc_anular_operacion`,
  `operaciones_fase6.sql:23`) y las del grafo visible. `→ completada` se
  permite desde cualquier estado activo (la ejecución vinculada cierra una
  `planificada` sin pasar por `en_proceso`). El insert no se toca (el default
  `completada` es un insert, no una transición). Trigger y no solo RPC: un
  admin puede hacer update por tabla (policy `op_neu_update`) y la regla debe
  cumplirse igual.
- **[fase 2]** `operaciones_neumaticos.operacion_prevista_id uuid references
  operaciones_neumaticos(id)` + índice. RPC auxiliar
  `tc_vincular_ejecucion(p_ejecutada, p_prevista)`: valida misma empresa,
  prevista no anulada y en estado activo; copia a la ejecutada lo que la
  ejecución no trae (`fecha_prevista`, `prioridad`, `tecnico_id` asignado,
  `incidencia_id`, `motivo` si falta); cierra la prevista como `completada`
  (consumiendo reservas, mismo efecto que hoy en
  `operaciones_fase5.sql:90-92`); apunta auditoría en las dos.
- **[fase 2]** ~~Los catorce RPC ganan `p_operacion_prevista`~~ **Como se
  implementó de verdad** (`tyrecontrol_vincular_prevista_ejecucion.sql`): los
  catorce RPC quedan **intactos**; un despachador
  `tc_ejecutar_prevista(prevista, rpc, args)` valida el plan, deja su id en
  un ajuste local de la transacción, llama al RPC de siempre y cierra el plan
  al volver; un trigger BEFORE INSERT estampa `operacion_prevista_id` y copia
  la herencia (incidencia, fecha prevista, prioridad, motivo) en cada fila
  insertada con el ajuste puesto. Mismo contrato, cero reescritura de RPC en
  producción y sin el problema de sobrecargas de §E.1 (que era el riesgo 1).
  En sustitución y planes, **todas** las filas resultantes quedan vinculadas
  a la misma prevista.
- **[fase 2]** `tc_cambiar_estado_operacion`: para tipos con
  `es_fisica = true` en `tc_cat_tipos_operacion`, rechazar `→ completada` a
  mano con un mensaje que diga cómo se hace ("la ejecución se registra desde
  el vehículo"); las no físicas (correcciones) y los tipos fuera de catálogo
  siguen como hoy.
- **[fase 2]** `tc_agrupar_operaciones_sueltas`: añadir
  `and status = 'completada'` (arregla §A.4 sin tocar nada más). El endpoint
  de cierre filtra igual.
- **[fase 3]** Los catorce RPC ganan también `p_intervencion uuid default
  null` (misma mecánica de sobrecarga); si viene, la operación nace con ese
  `intervencion_id` en el propio insert.
- **[fase 5]** Snapshot de stock al cierre (§F del informe, decisión aparte
  documentada en la fase 5; propuesta preliminar: guardar en la intervención
  el resultado completo de `tc_stock_almacen_empresa` — ya viene filtrado a
  productos con existencias — marcando las líneas afectadas; es
  autocontenido, acotado y sobrevive a renombrados de productos).
- Toda migración: idempotente + bloque final de comprobación con
  `raise exception` (convención del repo).

### D.2 Backend (`server/index.ts`)

- **[fase 1]** Unificar el resumen: extraer el generador a un módulo
  compartido por `src` y `server` (los dos tsconfig deben compilarlo:
  `npx tsc -b` **y** `npx tsc -p tsconfig.server.json`), y que
  `resumenOperaciones.ts` y el endpoint de cierre lo importen. Antes de
  añadir el tercer redactor (informe, fase 6) — como manda §3.4.
- **[fase 2/3]** El endpoint de cierre acepta `intervencionId` opcional: si
  viene, cierra **esa** intervención (sella `cerrada_at`, actualiza resumen,
  tiempos, planos) y enlaza solo sus operaciones; si no viene, se comporta
  como hoy (compatibilidad con APKs viejas). En ambos casos deja de agrupar
  filas no completadas.
- **[fase 4/§4.7]** Al cerrar, consultar las operaciones previstas de la
  intervención (y del vehículo) que siguen activas y devolverlas en la
  respuesta para que la APK/panel las **muestre**. Hoy el sistema permite
  cerrar con pendientes (de hecho las ignora): se respeta esa regla — se
  informa, no se bloquea.

### D.3 Panel

- **[fase 2]** `Operaciones.tsx`: quitar la promesa falsa del modal
  (`:337`); el botón "Completar" de operaciones físicas pasa a llevar al
  flujo de ejecución real (el detalle del vehículo, donde ya están los RPC),
  con la prevista preseleccionada para el vínculo; en el listado, una
  prevista cerrada por vínculo enseña su ejecutada (`operacion_prevista_id`)
  y viceversa.
- **[fase 4]** Pantalla nueva **Intervenciones** (construcción nueva,
  §3.3): listado con `numero`, estado abierta/cerrada, filtros; "Nueva
  intervención" con cliente, vehículo, fecha prevista, prioridad, técnico,
  observaciones y N operaciones previstas (cada una vía
  `tc_planificar_operacion` con el `intervencion_id` de la nueva
  intervención) y reservas opcionales.
- **[fase 6]** Informe (tres niveles, una fuente), reutilizando
  `VehicleLayout.tsx` / `imagen_chasis` y `tc_stock_almacen_empresa`.

### D.4 APK

- **[fase 3]** `cambio_neumatico_screen`: al cargar, llamar a
  `tc_iniciar_intervencion` y guardar el id en el estado de la pantalla;
  pasarlo en cada RPC (`p_intervencion`); Finalizar manda `intervencionId`
  al endpoint de cierre. Si `tc_iniciar_intervencion` falla (sin red, BD
  vieja), la pantalla sigue exactamente como hoy: huérfanas + red de
  seguridad. Cero botones nuevos, cero pasos extra para el técnico.
- **[fase 3]** Operación adicional (§4.3): al operar sobre un vehículo con
  intervención abierta, usarla (la idempotencia de
  `tc_iniciar_intervencion` lo da gratis).
- Pantallas de histórico: sin cambios (la red de seguridad sigue).

### D.5 Informes

- **[fase 6]** Página ejecutiva + neumáticos usados/retirados (con
  `SIN CONTROL DE STOCK` para `origen='montaje_directo_cliente'` /
  `'catalogo_sin_stock'`) + stock según §3.2 + fotos vía
  `tc_operacion_adjuntos` (su modelo ya asocia foto→operación con
  `file_type` antes/después: **sirve tal cual**; lo único que le falta es
  uso desde la APK, no columnas). Detalle completo al llegar la fase.

---

## E. Riesgos e incompatibilidades

1. **Sobrecarga de funciones en PostgREST.** Añadir parámetros con default a
   un RPC existente crea una segunda función con el mismo nombre; PostgREST
   devuelve error de ambigüedad para llamadas sin los parámetros nuevos.
   Mitigación: cada migración hace `drop function <firma vieja>` en la misma
   transacción y el bloque de comprobación verifica que queda **una** versión
   (patrón que ya usa `usados_por_ficha.sql:377`).
2. **Partir de la versión equivocada de un RPC.** Con 5 definiciones
   históricas de `tc_montar_desde_almacen` en el repo, editar la que no toca
   revertiría la Decisión 1 en silencio. Mitigación: la tabla §A.6 es la
   lista canónica; cada migración nueva parte de ese fichero y las
   comprobaciones finales verifican los marcadores críticos (p. ej. que
   `tc_montar_desde_almacen` sigue llamando a `tc_elegir_usado_almacen`).
3. **APKs viejas conviviendo con BD nueva.** Los parámetros nuevos tienen
   default null y el endpoint de cierre conserva el modo "sin
   intervencionId", así que una APK sin actualizar funciona igual que hoy.
   Riesgo residual: mezcla de técnico con APK nueva y panel viejo sobre el
   mismo vehículo — cubierto porque cada camino es independiente.
4. **El trigger de transiciones contra datos históricos.** Solo valida
   `UPDATE` de `status`, nunca inserts ni filas quietas, así que el histórico
   no se ve afectado. Hay que testear explícitamente las transiciones
   ilegales (deben fallar) y `→ anulada` desde `completada` (debe seguir
   funcionando: lo usa la anulación).
5. **Restringir "Completar" puede sorprender.** Alguien puede estar usando
   hoy "Completar" como apunte administrativo de trabajos hechos fuera del
   sistema. La restricción solo aplica a tipos físicos y el mensaje de error
   explica la alternativa; si ese uso resulta legítimo, la salida es
   registrar la ejecución con `tc_regularizar_desmontaje`/correcciones, que
   para eso existen. A validar con Jordi en la fase 2.
6. **Dos sesiones simultáneas sobre el mismo vehículo.** Hoy el cierre por
   barrido se llevaría las operaciones del otro técnico. Con
   `intervencion_id` de sesión esto **mejora** (cada operación nace en su
   intervención); el riesgo queda confinado al modo compatibilidad.
7. **Fase 5 bloqueada por operaciones, no por código.** El escenario D de
   aceptación no es demostrable hasta ejecutar
   `tc_migrar_usados_a_fichas(empresa, false)` por empresa en producción
   (§3.2 del prompt). Si al llegar la fase 5 no está hecho, se dirá — no se
   darán por buenos números que no se sostienen.
8. **El resumen compartido entre dos tsconfig.** El módulo unificado tiene
   que compilar en `tsc -b` y en `tsc -p tsconfig.server.json` (targets y
   opciones distintas): sin dependencias de DOM ni de paths con alias.

---

## F. Decisión: (b) VINCULAR, no absorber

Elijo **(b) vincular**: los RPC de ejecución siguen insertando sus filas y,
cuando reciben `p_operacion_prevista`, enlazan la ejecutada con la prevista
(`operacion_prevista_id`) y cierran la prevista como `completada` consumiendo
su reserva. Razones, por peso:

1. **La granularidad no es 1:1 y absorber lo exige.** Una prevista "sustituir
   P1" produce hoy **dos** filas de ejecución (§A.3); `tc_aplicar_plan_trabajo`
   y `tc_permutar_plan`, N. Para absorber habría que decidir cuál de las N
   filas "es" la prevista y reconstruir el retag de 5 segundos de la
   sustitución — es decir, rediseñar los insertadores, justo lo que la regla 0
   del prompt prohíbe. El vínculo N→1 modela la realidad sin tocar la forma
   de las filas.
2. **Es append-only, como todo el módulo.** La filosofía del sistema es "lo
   incorrecto se anula, nunca se borra ni se reescribe". Absorber convierte la
   fila prevista en otra cosa (update masivo de una docena de campos, con el
   historial de estados como único rastro del plan); vincular deja el plan
   intacto como documento (qué se pidió, para cuándo, con qué prioridad) y la
   ejecución como hecho (qué pasó de verdad). La trazabilidad exigida en §2
   —fecha prevista, técnico, origen, incidencia, reserva, movimientos,
   tiempos— queda repartida sin pérdida: lo previsto en la prevista, lo
   ejecutado en la ejecutada, y el auxiliar copia a la ejecutada lo que le
   falte para que las consultas de una sola fila funcionen.
3. **Menos superficie de regresión en producción.** Absorber cambia el camino
   del insert de catorce RPC `security definer` atómicos y probados (afecta
   también al insert de stock, autorizaciones, montajes). Vincular añade una
   llamada opcional al final; con `p_operacion_prevista` null, el binario de
   los RPC se comporta idéntico a hoy — la compatibilidad hacia atrás
   (invariante 5) es trivial de demostrar.
4. **El duplicado desaparece igual.** El criterio "0 duplicados" se cumple
   porque la prevista deja de quedar pendiente para siempre: se cierra en la
   misma transacción que la ejecución, y el listado la enseña como
   "planificada → ejecutada en #N". No hay dos filas *vivas* para un trabajo;
   hay un plan cerrado y su ejecución, enlazados — que además es la traza que
   (a) perdería.

Contra de (b) asumido: el histórico tiene más filas que con (a). Se mitiga en
la interfaz (colapsar/etiquetar el par), no en los datos.

---

## Qué toca ahora

**Nada, hasta que Jordi valide este análisis.** Con la aprobación, la
siguiente entrega es la **Fase 1 — Unificar intervención + operaciones**
(D.1 fase 1 + D.2 fase 1: `cerrada_at` + `tc_iniciar_intervencion` + trigger
de transiciones + resumen unificado), con sus tests SQL y de front, pasando
`npx tsc -b` y `npx tsc -p tsconfig.server.json`.
