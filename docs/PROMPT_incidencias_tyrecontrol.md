# PROMPT — Gestión de incidencias en la revisión (APK TyreControl + panel)

> Prompt listo para implementar en `sea-tarragona`. Añade la gestión de **incidencias de neumático** al flujo de revisión de la app del operario (`tyrecontrol_app`), **sin tocar la revisión rápida actual**: la nueva gestión solo aparece cuando el técnico detecta una anomalía. Incluye tablas nuevas, pantallas de app, un menú "Incidencias" y su reflejo en el panel web.

## Principio rector

La revisión rápida de hoy **no cambia** para el caso "todo correcto". Solo se bifurca cuando hay anomalía. Tres cierres posibles de una revisión:

1. **Revisión correcta** (como ahora).
2. **Revisión con incidencias solucionadas** (se detectó y se reparó en la visita).
3. **Revisión finalizada con incidencia pendiente** (la revisión se cierra; la incidencia sigue abierta como entidad propia).

Regla clave: **el estado de la revisión y el estado de la incidencia son independientes**. La revisión nunca queda "abierta" esperando a que se resuelva una incidencia.

---

## Contexto ya construido (reutilizar, no reinventar)

### App `tyrecontrol_app` (Flutter, operario)
- `lib/screens/review_screen.dart`: flujo de medición rueda a rueda. Ya tiene `_finalizar()` → `TyreControlApi.completarRevision(id)` y **un único** botón "Finalizar revisión" (`_ReviewFooter`, ~línea 671). Al medir la última rueda ya ofrece finalizar (`_ofrecerFinalizar`).
- `lib/models/umbrales.dart`: `Umbrales` (profCrítica ≤ 1,6 mm → grave/rojo; profAviso ≤ 3,0 mm → ámbar) + `graveVisual = {pinchazo, corte, objeto_clavado}`. Métodos `evaluar()` → `TireStatus` y `esAnomalia()`. **Reutilizar como base del cálculo de gravedad.**
- `lib/models/models.dart`: `RevisionDetalleDraft` (profundidadMm, presionBar, estadoVisual, noAccesible, neumaticoAusente, observaciones, foto). `Neumatico`, `PosicionVehiculo`, `MontajeActual`.
- `lib/widgets/vehicle_layout_image.dart`: **esquema gráfico del vehículo con las ruedas coloreadas por `TireStatus`** y `onTap(posicion)`. Reutilizar para "seleccionar posición afectada".
- `lib/services/supabase_service.dart`: capa sobre Supabase (RLS/RPC). `crearRevision`, `guardarDetalleRevision`, `completarRevision`, `listarMontajesVehiculo`, `subirFotoRevision` (bucket `tc-revisiones-fotos`).
- Navegación: `home_screen.dart` con `NavigationBar` (Inicio, Revisiones, Herramientas, Sincronización, Perfil) + tiles en Inicio.
- **No hay cola offline en esta app** (a diferencia de la de asistencias). Ver "Offline" abajo.

### Panel web (`src/modules/tyrecontrol/`)
- Páginas existentes: `Operaciones`, `Autorizaciones`, `PlanificacionRevisiones`, `VehiculoDetalle` (sección Inspecciones), `DisponiblesRevisar`.
- `services/data.ts`: `listarOperaciones`, `listarAutorizacionesPendientes`, `listarOperacionesMantenimiento`, etc.

### Base de datos (Supabase, esquema real verificado)
- `revisiones_vehiculo`: `estado_revision` hoy solo usa `borrador` | `completada`. Campos: empresa_id, vehiculo_id, km_vehiculo, fecha_revision, tecnico_id, observaciones.
- `revisiones_neumaticos_detalle`: profundidad_mm, presion_bar, estado_visual (**hoy sin valores en producción**), foto_url, no_accesible, neumatico_ausente, `alerta_generada`, posicion_id, neumatico_id.
- `operaciones_neumaticos`: tipo_operacion (hoy: `montaje`, `revision_vehiculo`), posicion_origen/destino, montaje_origen/destino, motivo, estado_anterior/nuevo, destino, tecnico_id, coste_material, coste_mano_obra. **Base para registrar operaciones de reparación.**
- `tc_operaciones_mantenimiento`: catálogo (nombre, orden, activo).
- `autorizaciones_operaciones`: flujo de autorización (estado `pendiente`…). **Reutilizable para "pendiente de autorización".**
- `tc_vehiculo_webfleet_estado`: estado en base (`en_base`, …). Para "vehículo en base con incidencia".
- ⚠️ **Existe una tabla `incidencias` PERO es del módulo Almacén** (cliente_id, producto_id, traspaso_id). **NO reutilizar.** Crear tabla nueva con prefijo `tc_`.
- Convención RLS: `tc_puede_ver_empresa(empresa_id)` para SELECT; funciones `security definer set search_path=public`; operarios ven sus empresas vía `tc_operador_empresas`.

---

## Modelo de datos nuevo (migración `supabase/migrations/tyrecontrol_faseNN_incidencias.sql`)

### Tabla `tc_incidencias`
Una incidencia = una posición de neumático con uno o más problemas detectados en una revisión.

Campos propuestos:
- `id uuid pk`, `empresa_id`, `vehiculo_id`, `posicion_id`, `neumatico_id` (nullable), `revision_id` (origen), `revision_detalle_id` (nullable).
- `gravedad text` → `leve | importante | critica` (propuesta automática, editable).
- `estado text` → `detectada | pendiente_autorizacion | autorizada | planificada | pendiente_material | pendiente_vehiculo | en_curso | solucionada | cancelada | no_procede`.
- `detectada_por` (tecnico_id), `detectada_at`, `fecha_recomendada` (nullable), `autoriza_persona` (nullable).
- `medicion_inicial jsonb` (profundidad/presión/estado visual al detectar), `medicion_final jsonb` (al solucionar).
- `motivo_pendiente text` (enum de motivos rápidos, nullable), `motivo_observacion text`, `foto_url text` (opcional — decisión usuario 2026-07-16).
- `resuelta_at`, `resuelta_por`, `tiempo_intervencion_seg` (nullable).
- `seguimiento_revision_id` (nullable, para la revisión de comprobación posterior).
- `created_at`, `updated_at`.

### Tabla `tc_incidencia_problemas` (las "incidencias rápidas" seleccionadas)
Una incidencia puede tener **varios** problemas (multi-selección); cada problema puede resolverse por separado (solución parcial, sección 10).
- `id`, `incidencia_id fk`, `tipo text` (catálogo de la sección 1: `profundidad_baja`, `presion_baja`, `presion_alta`, `pinchazo`, `objeto_clavado`, `desgaste_irregular`, `desgaste_interior`, `desgaste_exterior`, `diferencia_gemelos`, `corte_grieta`, `dano_flanco`, `deformacion`, `valvula_danada`, `no_coincide_ficha`, `cambiado_posicion`, `no_identificado`, `necesita_sustitucion`, `necesita_reparacion`, `necesita_equilibrado`, `necesita_alineacion`, `otra`).
- `estado text` → `abierto | solucionado`, `operacion_id` (nullable, la operación que lo resolvió), `resuelto_at`.

### Cambios menores
- Ampliar el dominio de `revisiones_vehiculo.estado_revision` para admitir `completada_con_incidencias` y `completada_incidencia_pendiente` (decisión 1). Si hay CHECK constraint, actualizarlo; el código que hoy filtra por `completada` debe tratar los tres como "revisión cerrada".
- Enlazar `operaciones_neumaticos` con la incidencia: añadir columna `incidencia_id uuid null` (FK).
- RLS: SELECT con `tc_puede_ver_empresa(empresa_id)`; INSERT/UPDATE para operario de la empresa. Índices por `vehiculo_id`, `estado`, `gravedad`.

### RPCs (opcional, para el panel/contadores)
- `tc_incidencias_resumen()` → conteos por estado/gravedad y por empresa.

---

## Cálculo automático de gravedad (proponer, editable)

Basado en `umbrales.dart` + tipo de problema + medición. Reglas iniciales (configurables por umbral):
- **Crítica**: profundidad ≤ límite legal configurado (1,6 mm) · daño grave en flanco · deformación · neumático incompatible/no coincide con ficha · pinchazo con pérdida activa.
- **Importante**: profundidad próxima al límite (≤ 3,0 mm) · pérdida lenta de aire · desgaste irregular acusado · válvula deteriorada · necesita sustitución/reparación a corto plazo.
- **Leve**: presión ligeramente baja/alta (dentro de margen) · diferencia pequeña entre gemelos · desgaste irregular inicial.

La APK **propone** la gravedad; el técnico puede subirla/bajarla. Guardar tanto la propuesta como la final si difiere.

---

## Flujo en la APK

### A. Bifurcación al finalizar (`review_screen.dart`)
Sustituir el botón único por **dos botones grandes** cuando la medición ha terminado:
- **Finalizar revisión** (verde) — habilitado siempre; si hay ruedas en rojo/ámbar, mostrarlo pero recomendar el otro.
- **⚠ Revisión con incidencia** (ámbar/rojo, muy visible) — abre el flujo de incidencias.

Si `umbrales.esAnomalia()` marcó alguna rueda, **preseleccionar** ese botón / resaltarlo.

### B. Selección de posición + incidencias
1. Mostrar el **esquema del vehículo** (`VehicleLayoutImage`) con las ruedas anómalas ya marcadas por color. `onTap` → seleccionar posición.
2. Para la posición elegida: **grid de incidencias rápidas** (catálogo de la sección 1), **multi-selección**.
3. La APK **propone la gravedad**; el técnico puede cambiarla.
4. Repetir para otras posiciones si hace falta.

### C. Pregunta principal
"¿Quieres solucionar las incidencias ahora?" con:
- **Solucionar ahora** → abre operaciones de mantenimiento **filtradas** por los problemas seleccionados.
- **Dejar pendiente** → formulario corto (sección 6) y cierra la revisión.
- (Secundario) **Solucionar solo algunas** → permite marcar qué problemas se resuelven y cuáles quedan pendientes (sección 10).

### D. "Solucionar ahora"
- Mostrar **solo las operaciones relacionadas** con los problemas (mapa problema→operaciones). Catálogo de operaciones: corregir presión, reparar pinchazo, cambiar válvula, sustituir neumático, cambiar posición, intercambiar, equilibrar, solicitar alineación, reapretar, actualizar neumático instalado, otra.
- Cada operación pide sus datos (p. ej. inflar → presión final; reparar pinchazo → tipo, material, presión final, foto opcional, resultado; sustituir → neumático retirado/instalado, medida/marca/modelo, procedencia, profundidad inicial, presión final).
- Al completar: marcar el problema como `solucionado`, registrar `operaciones_neumaticos` (con `incidencia_id`), guardar medición inicial/final y tiempo.
- Reutilizar en lo posible los RPC de montaje/sustitución que ya usa el panel (`operaciones_neumaticos`).

### E. Cierres
- **Todos los problemas solucionados** → revisión "con incidencias solucionadas" (guardar historial completo: incidencia, operación, técnico, fecha, medición inicial/final, tiempo, fotos, observaciones). No aparece en pendientes.
- **Quedan problemas** → crear incidencia(s) pendiente(s); revisión "finalizada con incidencia pendiente".

### F. Formulario "Dejar pendiente" (corto)
Campos: incidencia (ya seleccionada), posición, gravedad, acción recomendada, **motivo** (rápidos: falta autorización cliente, falta neumático, falta material, no hay tiempo, vehículo debe salir, requiere taller, pendiente presupuesto, pendiente unidad móvil, no se puede acceder, otro), **foto opcional** (decisión usuario 2026-07-16), observación, fecha recomendada, persona que autoriza (si aplica).

---

## Menú "Incidencias" (APK)

- Nuevo acceso visible en Inicio (y/o pestaña) con **contador** ("Incidencias 12").
- Cuatro pestañas: **Pendientes · Planificadas · En curso · Solucionadas**.
- **Tarjeta de incidencia**: matrícula + cliente + base; posición; profundidad/medición; icono de gravedad; fecha detección; días pendiente; estado de autorización; si el vehículo está **en base** (Webfleet); fotos (vehículo/neumático).
- Botones: **Solucionar · Ver detalle · No disponible · Reprogramar**.
- **Orden por defecto**: 1) críticas, 2) vehículos en base, 3) autorizadas, 4) más antiguas, 5) pend. autorización, 6) pend. material.
- **Colores**: rojo=crítica, naranja=importante, amarillo=leve, azul=planificada, verde=solucionada.
- Si Webfleet dice que un vehículo con incidencia está en base → destacar "Vehículo en base con incidencia pendiente" + botón "Solucionar ahora".

### Solucionar una incidencia pendiente (sin repetir la revisión)
Al pulsar "Solucionar" abrir **directo** vehículo+posición+incidencia: confirmar → operación → mantenimiento → resultado → medición final → confirmar. Ejemplo sustitución: abre directamente el proceso (retirado, motivo, destino, instalado, medida/marca/modelo, procedencia, profundidad inicial, presión final).

### Solución parcial
Marcar un problema como solucionado y mantener otros abiertos **sin duplicar** la incidencia; mostrar qué acciones siguen abiertas.

### Revisión de seguimiento (opcional)
Al cerrar una incidencia, ofrecer "Crear revisión de seguimiento" con fecha automática configurable (p. ej. pinchazo→7 días, desgaste irregular→15 días, gemelos→próxima visita). Se materializa como un **`tc_planes_mantenimiento`** con `proxima_fecha` (decisión 6), enlazado en `tc_incidencias.seguimiento_revision_id`. Fase 3.

---

## Panel web (reflejo, fase posterior o en paralelo)
- Página **Incidencias** en `src/modules/tyrecontrol/`: mismas pestañas y tarjetas, filtros por empresa/base/gravedad/estado, enlace a la ficha del vehículo.
- En `VehiculoDetalle`: sección de incidencias del vehículo (abiertas/históricas).
- Integrar con `Autorizaciones` existente cuando la incidencia esté `pendiente_autorizacion`.

---

## Offline / sincronización
La app de asistencias tiene cola persistente (Hive outbox); **`tyrecontrol_app` hoy no**. La detección y el guardado de incidencias deben ser robustos a cortes:
- **Mínimo viable**: escribir incidencias/operaciones directo a Supabase (como el resto de la app hoy) y manejar el error de red mostrando reintento; no bloquear el cierre de la revisión.
- **Recomendado**: portar el patrón outbox de `flutter_app` (cola + reintentos + idempotencia por `clientActionId`) para incidencias, operaciones y fotos. **Decidir alcance en fase 1.**

---

## Decisiones tomadas (fijadas — "tú decide", 2026-07-15)

1. **`estado_revision`** → **Se añaden dos estados nuevos**: `completada_con_incidencias` y `completada_incidencia_pendiente` (además de `borrador`/`completada`). Motivo: una revisión con incidencia **no** debe constar como "correcta"; queda trazabilidad para informes. La UI y los informes derivan el matiz del propio estado, no de un conteo.
2. **Offline** → **Fase 1 escribe directo a Supabase** con manejo de error visible y reintento manual, **sin bloquear el cierre** de la revisión (la incidencia/medición ya quedan en local si falla el envío). La **foto del pendiente (opcional)** se sube con reintento ligero (persistir archivo + reintentar), no con cola completa. **La cola outbox completa (idempotencia por `clientActionId`, reintentos automáticos) se porta en Fase 2**, cuando entran operaciones y más fotos. Rationale: no frenar la fase 1 con infraestructura que rinde más en el flujo de "solucionar".
3. **Autorización** → **La incidencia se autogestiona con su propio `estado`** (`pendiente_autorizacion`, `autorizada`, …) en fases 1-2. La integración con `autorizaciones_operaciones` (flujo de autorización de operaciones ya existente) se hace en **Fase 3**, solo para operaciones que la requieran. Evita acoplar de más al principio.
4. **Umbrales de gravedad** → **Globales fijos** de `umbrales.dart` (1,6 / 3,0 mm) en fases 1-2. La configuración por empresa/eje (tabla de umbrales) se pospone (fase futura, no bloqueante).
5. **Presión objetivo** → **No se autodetecta presión en fase 1**. Como hoy no hay presión objetivo por vehículo/posición, los problemas `presion_baja`/`presion_alta` los **marca el técnico manualmente** (con la presión medida guardada). Añadir "presión objetivo por eje/posición" (para autodetección y para la operación "corregir presión" con objetivo) se hace en **Fase 2** junto al flujo de solucionar. La gravedad automática de fase 1 se calcula sobre **profundidad + tipo de problema + estado visual**, no sobre presión.
6. **Revisión de seguimiento** → Se materializa como **`tc_planes_mantenimiento`** con `proxima_fecha` (así aparece en Planificación y hereda los KPIs y el "en base" de Webfleet ya existentes). Se implementa en **Fase 3**. Se guarda el enlace en `tc_incidencias.seguimiento_revision_id` / al plan creado.
7. **Alcance Fase 1** → **Confirmado**: detección + selección de posición/problemas/gravedad + "Dejar pendiente" + cierre con incidencia pendiente + menú "Incidencias" (pestaña Pendientes, tarjeta, contador). **"Solucionar ahora" completo va en Fase 2.**

> Con estas decisiones, la migración de Fase 1 crea `tc_incidencias` + `tc_incidencia_problemas`, amplía `revisiones_vehiculo.estado_revision` (2 estados nuevos) y añade `operaciones_neumaticos.incidencia_id` (nullable, se usará en Fase 2). No se toca presión objetivo ni umbrales por empresa todavía.

---

## Plan por fases (propuesto)

- **Fase 1 — Detección y pendientes**: migración `tc_incidencias` + `tc_incidencia_problemas` + 2 estados nuevos de `estado_revision` + `operaciones_neumaticos.incidencia_id`; bifurcación de botones en `review_screen`; selección posición+problemas+gravedad (auto sobre profundidad+visual, decisión 5); "Dejar pendiente" con formulario y foto opcional (envío directo + reintento, decisión 2); cierre con incidencia pendiente; menú "Incidencias" (pestaña Pendientes + tarjeta + contador). **Sin "solucionar ahora".**
- **Fase 2 — Solucionar**: "Solucionar ahora" en la revisión y desde el menú (operaciones filtradas, registro en `operaciones_neumaticos` con `incidencia_id`, medición inicial/final, fotos, tiempo); solución parcial; cierre "con incidencias solucionadas". Incluye: **presión objetivo por eje/posición** (decisión 5) y **cola outbox** portada de asistencias (decisión 2).
- **Fase 3 — Estados avanzados y panel**: autorización (integración con `autorizaciones_operaciones`, decisión 3), planificación, pendiente material/vehículo; orden por prioridad + Webfleet en base; **revisión de seguimiento** como plan (decisión 6); página Incidencias en el panel web y sección en la ficha del vehículo.
- **Transversal**: versionar `pubspec.yaml` y generar APK versionado en cada entrega (norma del repo).

## Entregables por fase
- Migración(es) SQL en `supabase/migrations/` (aplicar con `pg` + `DATABASE_URL`, como las fases 32/33).
- Pantallas/servicios en `tyrecontrol_app/lib/`.
- (Fase 3) Página web en `src/modules/tyrecontrol/`.
- APK release en el Escritorio con nombre versionado (`SEA_TyreControl_vX.Y.Z+B.apk`).
