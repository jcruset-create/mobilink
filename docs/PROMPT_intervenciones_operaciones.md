# Prompt — Rediseño de Intervenciones y Operaciones (Mobilink TyreControl)

> Prompt listo para pegar en una sesión de Claude Code sobre el repo `mobilink`.
> Léelo entero antes de tocar nada. La descripción del módulo tal y como está
> hoy vive en **`docs/COMO_FUNCIONA_OPERACIONES.md`**: es contexto obligatorio.
>
> Los hechos marcados **[verificado]** se comprobaron contra el código el
> 13-08-2026. Si al leer el repo encuentras que alguno ya no es cierto, dilo
> antes de seguir: significa que otra sesión ha tocado el módulo.

---

## 0. La regla que manda sobre todas las demás

**No reconstruyas TyreControl.** No crees un segundo sistema de operaciones, ni
dupliques stock, neumáticos, almacenes, intervenciones, incidencias o reservas.
La prioridad es **reutilizar, conectar y corregir lo que ya existe**.

No inventes botones, estados, tablas ni flujos. Antes de modificar algo, léelo.

---

## 1. El modelo conceptual

```
CLIENTE → VEHÍCULO → INTERVENCIÓN → OPERACIONES → MOVIMIENTOS
```

- **Intervención**: una sesión real de trabajo sobre un vehículo. Contiene 1..N
  operaciones.
- **Operación**: una actuación concreta (sustituir P1, intercambiar P3↔P4,
  reparar P6). Contiene 1..N movimientos.
- **Movimiento**: el desplazamiento de *un* neumático. Una sustitución son dos:
  el viejo vehículo→almacén, el nuevo almacén→vehículo.

**[verificado]** Esta jerarquía **ya está bien representada** en el modelo de
datos: `tc_intervenciones` → `operaciones_neumaticos` (vía `intervencion_id`) →
`tc_operacion_movimientos` (vía `operacion_id`, con `orden`). No la cambies.
Lo que falla no es el modelo, es cómo se rellena.

---

## 2. El problema de fondo: planificar y ejecutar son dos mundos

Esto es lo único que hay que arreglar de verdad. Todo lo demás se deriva.

**[verificado]** Hoy existen dos vías que no se tocan:

- **Vía A — planificar.** `tc_planificar_operacion` crea la fila en `pendiente`
  o `planificada`. No mueve nada.
- **Vía B — ejecutar.** Catorce RPC (`tc_montar_desde_almacen`,
  `tc_desmontar_neumatico`, `tc_sustituir_neumatico`, `tc_cambiar_posicion`,
  `tc_intercambiar_posiciones`, `tc_registrar_reparacion`,
  `tc_descartar_neumatico`, `tc_corregir_posicion`, `tc_corregir_montado`,
  `tc_regularizar_desmontaje`, `tc_aplicar_plan_trabajo`, `tc_permutar_plan`,
  `tc_montar_desde_catalogo`, `tc_montar_fuera_almacen`) mueven el neumático y
  **crean su propia operación ya completada**, porque `status` tiene
  `default 'completada'`.

**[verificado] Ninguno de esos catorce acepta el id de una operación
planificada.** No hay forma de "ejecutar la operación #123".

Consecuencias reales, no hipotéticas:

- Planificas *Sustituir P1* (#100, planificada). El técnico la hace con la APK
  (#127, completada). Quedan **dos filas** para un solo trabajo, y la #100 se
  queda pendiente para siempre.
- Pulsar **"Completar"** en el panel llama a `tc_cambiar_estado_operacion`, que
  solo cambia `status` y consume reservas: **cierra la ficha sin montar nada**,
  pese a que el modal promete que ahí se registra la ejecución física.

### Lo que hay que conseguir

```
1 necesidad = 1 operación lógica = 1 ejecución = 1 histórico
```

La operación prevista debe **convertirse** en la ejecutada, o quedar vinculada a
ella de forma inequívoca, conservando: fecha prevista, técnico asignado,
prioridad, origen, incidencia relacionada, reserva, historial, movimientos
reales, neumático realmente usado, estado final, tiempos y auditoría.

**Decide y justifica** cuál de las dos formas es más segura:

- **(a) Absorber**: los RPC de ejecución aceptan un `p_operacion` opcional; si
  viene, actualizan esa fila en vez de insertar una nueva.
- **(b) Vincular**: siguen insertando, pero enlazan la ejecutada con la prevista
  (`operacion_prevista_id`) y cierran la prevista como `completada`.

(a) da un histórico más limpio; (b) es menos invasiva sobre catorce RPC en
producción y conserva la traza de que hubo un plan. Elige una, explica por qué,
y aplícala de forma consistente en los catorce.

---

## 3. Correcciones a lo que se creía del sistema

Estas cinco cosas **no** son como se asumía. Ajusta el plan en consecuencia.

### 3.1 Los tiempos de intervención YA EXISTEN — no hay que crearlos

**[verificado]** `tc_intervenciones` ya tiene:

```
inicio_at timestamptz · fin_at timestamptz · duracion_seg int
pausa_seg int · n_pausas int · trabajo_seg int
n_neumaticos int · tipo_principal text
montaje_antes jsonb · montaje_despues jsonb · incidencias jsonb
imagen_chasis text · numero text · resumen text · resumen_ia text
```

El apartado de tiempos es **integración**, no construcción. Revisa quién los
rellena hoy y asegúrate de que INICIAR/FINALIZAR los alimentan. No añadas
columnas paralelas.

### 3.2 El doble conteo del stock — RESUELTO en código, pendiente de regularizar

**[verificado, corregido el 13-08-2026]** Una versión anterior de este documento
lo daba por abierto basándose en el comentario de
`tyrecontrol_almacen_usados.sql` ("Decisión 1, todavía sin responder"). Una
migración **posterior**, `tyrecontrol_usados_por_ficha.sql`, la cierra con la
regla:

> · NUEVO → sigue en `movimientos_stock`, por cantidades.
> · USADO → es la ficha de `tc_neumaticos`. Ni entra ni sale de `movimientos_stock`.

Ya implementado y cableado: `tc_devolver_usado_a_stock` es NO-OP (con
comprobación que revienta si alguien vuelve a meter el insert), montar un usado
consume una ficha (`tc_elegir_usado_almacen`), y `tc_stock_almacen_empresa` —
que ya llaman panel y APK — cuenta nuevos por movimientos y usados por fichas.
**Esa función es la fuente canónica para la sección de stock del informe.**

Lo que queda es **operativo, no de código**: comprobar que la migración está
aplicada en producción y ejecutar `tc_migrar_usados_a_fichas(empresa, false)`
por empresa para poner a cero los apuntes viejos del doble conteo (a mano, por
diseño: es un asiento en el inventario del cliente). La pantalla *Almacén de
usados* enseña el desfase pendiente en la tarjeta "Apuntes pendientes".

Las fases 5 y 6 quedan desbloqueadas en cuanto la regularización esté hecha. El
snapshot del informe debe leer de `tc_stock_almacen_empresa`, no inventar otra
consulta.

### 3.3 En el panel NO existe pantalla de Intervenciones

**[verificado]** La única referencia a intervenciones en `pages/` está dentro de
`VehiculoDetalle.tsx`. La vista de Intervenciones es **construcción nueva**, no
evolución de una pantalla existente. Dimensiona el trabajo con eso en mente.

### 3.4 La lógica del resumen está duplicada

**[verificado]** El mismo mapa de verbos (`montaje → Montado/Montados`…) vive en
dos sitios: `src/modules/tyrecontrol/services/resumenOperaciones.ts` y, copiado,
dentro del endpoint `POST /api/tyrecontrol/intervencion/cerrar` en
`server/index.ts`. Antes de añadir un tercer generador de texto, unifica los dos.

### 3.5 "Sin control de stock" es `tc_montar_fuera_almacen`

**[verificado]** El montaje que no toca el almacén es `tc_montar_fuera_almacen`,
que crea el neumático con `origen = 'montaje_directo_cliente'` y
`control_individual` según el caso. Requiere el permiso
`puede_montar_fuera_almacen` del usuario (o admin/superadmin).

El informe **nunca** debe decir que ese neumático salió del almacén del cliente,
ni debe restarlo del stock. Etiqueta: `SIN CONTROL DE STOCK`.

---

## 4. Comportamiento pedido

### 4.1 Intervención planificada (panel)

Crear **Nueva intervención** con cliente, vehículo, fecha prevista, prioridad,
técnico, observaciones, N operaciones previstas y reservas cuando corresponda.

### 4.2 Intervención espontánea (APK)

No obligar a planificar. El técnico abre vehículo → inicia intervención → opera
→ finaliza. **Si no hay intervención abierta, se crea automáticamente.**

### 4.3 Operaciones adicionales

Una operación no prevista detectada durante el trabajo se añade a la
intervención **activa**. No se crea otra intervención.

### 4.4 Intervención activa en la APK

**[verificado]** Hoy la APK no mantiene un `intervencion_id` de sesión: las
operaciones nacen huérfanas y las recoge después
`tc_agrupar_operaciones_sueltas(30)`, que además **solo se ejecuta cuando
alguien abre un histórico**. Si nadie lo abre, quedan huérfanas indefinidamente.

La APK debe conocer su `intervencion_id` en todo momento y usarlo en cada
operación. `tc_agrupar_operaciones_sueltas` **se conserva como red de
seguridad** para lo antiguo y para caídas, pero deja de ser la vía principal.

### 4.5 Incidencias

```
REVISIÓN → INCIDENCIA → OPERACIÓN NECESARIA → INTERVENCIÓN → EJECUCIÓN
```

La operación ejecutada debe seguir vinculada a la incidencia original
(`incidencia_id`, que ya existe). Sin duplicados.

### 4.6 Estados y transiciones

Conserva los diez estados actuales. El flujo visible debe ser:

```
PLANIFICADA → ASIGNADA → EN PROCESO → COMPLETADA
                            ↕ PAUSADA
(PLANIFICADA | ASIGNADA) → CANCELADA
```

**[verificado]** Hoy ese grafo vive **solo en el frontend**
(`Operaciones.tsx:11`). `tc_cambiar_estado_operacion` valida permisos y que el
estado esté entre los diez, pero **no valida la transición**: por RPC se puede
ir de `completada` a `pendiente`.

Mueve la validación de transiciones al RPC. El frontend puede seguir ocultando
botones, pero la regla se cumple en la base de datos.

### 4.7 Finalizar

Al cerrar, comprobar y **mostrar** lo que queda pendiente en vez de ocultarlo:

```
Quedan 2 operaciones previstas sin realizar:
  - Sustituir P5
  - Reparar P6
```

Si permitir o no el cierre con pendientes: **mira primero qué hace hoy el
sistema** y respétalo. No inventes una regla de negocio nueva.

---

## 5. El informe

Objetivo: que lo entienda alguien que no sabe de neumáticos. No puede parecer un
volcado de base de datos. Debe responder: sobre qué vehículo se trabajó, por
qué, qué se hizo, qué neumáticos se usaron, qué pasó con los retirados, cómo
quedó el vehículo, cómo quedó el stock, y si queda algo pendiente.

**Regla innegociable sobre la IA:** puede *redactar*, nunca *decidir*. Los
hechos —operaciones, motivos, cantidades, neumáticos, estados, destinos, stock,
incidencias— salen siempre de datos estructurados. La IA solo convierte datos en
prosa. Las tablas de stock se calculan a partir de movimientos reales, **nunca
por IA**.

### Página 1 — ejecutiva

Cabecera (intervención, cliente, vehículo, fecha, técnico, km, inicio, fin,
duración, estado), resumen en lenguaje normal, indicadores visuales
(`4 SUSTITUIDOS · 2 NUEVOS · 2 USADOS · 3 RECUPERADOS`), esquema del vehículo y
resultado final.

El esquema debe usar **la configuración real del vehículo** y la nomenclatura de
posiciones que ya usa TyreControl (reutiliza `VehicleLayout.tsx` /
`imagen_chasis`). Nada genérico. Diferenciar visualmente: cambiado, movido,
reparado, sin actuación, requiere atención.

### Neumáticos usados y retirados

Montados: marca, modelo, medida, nuevo/usado y **origen** (almacén del cliente /
sin control de stock / otros ya existentes). Retirados: qué pasó con ellos,
usando los **destinos ya configurados**, sin inventar ninguno.

### Stock — sujeto a §3.2

Por medida → marca/modelo → nuevo/usado → cantidad. Y cuando se pueda, el efecto
exacto: `Antes · Montados · Devueltos · Después`.

**Snapshot al cierre**: el informe de hace seis meses debe seguir mostrando el
stock de entonces, no el de hoy. Analiza qué es más robusto —guardar solo las
medidas/modelos afectados o el estado completo— y justifica la elección. No
dupliques información sin necesidad.

### Fotos

Asociadas a la operación que explican (antes/después, posición, neumático), no
una galería suelta. Reutiliza `tc_operacion_adjuntos` si su modelo lo permite;
si no, di qué le falta.

### Tres niveles, una sola fuente

`RÁPIDO` (1 página, dirección/cliente) · `COMPLETO` (responsable de flota) ·
`TRAZABILIDAD` (IDs, timestamps, movimientos, correcciones, anulaciones,
historial, auditoría). **Los tres salen de los mismos datos.** No montes tres
sistemas.

Los indicadores de stock bajo pueden prepararse, pero **sin umbrales
inventados**: configurables por cliente o no existen.

---

## 6. Deuda a corregir de paso

**[verificado]** en el listado de operaciones del panel:

- **Tope fijo de 200 filas sin paginación**, y el contador muestra las cargadas,
  no las que cumplen el filtro. Implementa paginación de servidor y un total
  real.
- **El Excel exporta solo lo cargado.** Debe exportar todo lo que cumpla el
  filtro, con una estrategia eficiente (no traer 50.000 filas al navegador).
- **Las cuatro cargas del modal de detalle usan `.catch(() => [])`**: un fallo
  de permisos o de red se ve igual que "no hay datos". Distínguelos sin romper
  la interfaz.
- **Dos numeraciones** (`operaciones_neumaticos.numero_operacion` bigint y
  `tc_intervenciones.numero` text) que no son la misma serie. Deja clarísimo en
  la interfaz cuál identifica la intervención y cuál la operación. No elimines
  ninguna sin migración segura.

---

## 7. Invariantes que no se pueden romper

1. **Atomicidad.** Nunca "operación completada pero stock sin actualizar", ni
   "stock descontado pero neumático sin montar". Revisa los RPC y mantén la
   transaccionalidad.
2. **Trazabilidad.** Nunca `DELETE` de operaciones. **[verificado]** no existe
   policy de delete y así debe seguir. Lo incorrecto se anula o se corrige.
3. **RLS y permisos.** Respeta `tc_puede_ver_empresa`, `tc_is_superadmin`,
   `tc_is_admin`, `tc_operador_ve_empresa`. Los RPC `security definer` deben
   seguir validando por su cuenta: se saltan la RLS. Nunca confiar en el frontend.
4. **Reservas.** `planificada → reservado`, `ejecutada → consumida`,
   `cancelada → liberada`. Mantén el unique parcial: un neumático no puede tener
   dos reservas activas.
5. **Compatibilidad hacia atrás.** Hay operaciones antiguas sin
   `intervencion_id` e intervenciones antiguas. Todo debe seguir funcionando.
   Migraciones progresivas, nunca destructivas sobre históricos.
6. **La APK no puede ralentizarse.** Conserva los botones actuales. Solo añade
   INICIAR / FINALIZAR intervención si no hay ya una acción equivalente —
   compruébalo antes.

---

## 8. Cómo trabajar

### Fase 0 — Análisis, ANTES de tocar código

Entrega un documento con:

- **A.** Cómo funciona hoy (tablas, RPC, servicios, pantallas, flujos,
  permisos). Parte de `docs/COMO_FUNCIONA_OPERACIONES.md` y corrígelo donde haga
  falta.
- **B.** Qué se conserva tal cual.
- **C.** Qué causa el problema (§2), con las líneas concretas.
- **D.** Cambios mínimos, separados en: Base de datos · Backend · Panel · APK ·
  Informes.
- **E.** Riesgos e incompatibilidades.
- **F.** Tu decisión sobre **absorber vs vincular** (§2), razonada. (La del
  stock ya está tomada e implementada — §3.2.)

**Para en seco después de la Fase 0 y espera aprobación.** No implementes nada
hasta que se valide el análisis.

### Fases de implementación

```
1. Unificar intervención + operaciones
2. Eliminar la duplicidad planificada/ejecutada
3. Intervención activa en la APK
4. Planificación de intervenciones
5. Stock y snapshot     ← requiere la regularización de §3.2 hecha en producción
6. Informe de intervención
7. Paginación y Excel
8. Trazabilidad y manejo de errores
```

Si ves un orden técnicamente más seguro, cámbialo **explicando por qué**. Cada
fase se entrega por separado, con sus tests, y se despliega antes de empezar la
siguiente.

### Tests

No basta con el frontend. Valida también la lógica SQL/RPC:

planificación · ejecución · reservas · cancelación · operación adicional ·
transiciones de estado (incluidas las **ilegales**, que deben fallar) ·
intervención espontánea · stock nuevo · stock usado · sin control de stock ·
devolución al almacén · descarte · snapshot · permisos · **ausencia de
duplicados** · cierre de intervención · operaciones antiguas sin intervención.

---

## 9. Criterios de aceptación

| | Escenario | Resultado exigido |
|---|---|---|
| **A** | Planificar intervención con 3 operaciones, asignar técnico, reservar, ejecutar desde APK, finalizar | 1 intervención, 3 operaciones, **0 duplicados** |
| **B** | Técnico abre vehículo, inicia, hace 4 operaciones, finaliza | 1 intervención, 4 operaciones |
| **C** | Intervención con 2 previstas + 1 adicional durante el trabajo | 1 intervención, 3 operaciones |
| **D** | Stock 4 nuevos/2 usados; se montan 2 nuevos y se devuelve 1 usado | Informe: 2 nuevos, 3 usados |
| **E** | Montar 1 neumático sin control de stock | Operación registrada, neumático montado, **stock sin cambios**, informe marca `SIN CONTROL DE STOCK` |
| **F** | Abrir la intervención 6 meses después | Muestra el stock **de entonces**, no el actual |
| **G** | Revisión → incidencia → operación prevista → ejecución | La operación final sigue vinculada a la incidencia original |

El escenario **D** solo es demostrable con la regularización de §3.2 hecha en
producción. Si no lo está, dilo en lugar de dar por bueno un número que no se
sostiene.

---

## 10. Ficheros de partida

| Qué | Dónde |
|---|---|
| Cómo funciona hoy | `docs/COMO_FUNCIONA_OPERACIONES.md` |
| Pantalla de operaciones | `src/modules/tyrecontrol/pages/Operaciones.tsx` |
| Consultas y RPC | `src/modules/tyrecontrol/services/data.ts` |
| Resumen en texto (copia 1) | `src/modules/tyrecontrol/services/resumenOperaciones.ts` |
| Resumen en texto (copia 2) | `server/index.ts` → `POST /api/tyrecontrol/intervencion/cerrar` |
| Tabla, RLS, numeración interna | `supabase/migrations/tyrecontrol_fase8_operaciones.sql` |
| Ciclo de vida, satélites, catálogos | `..._operaciones_fase1.sql` |
| Posiciones y correcciones | `..._operaciones_fase3.sql` |
| Reparaciones y adjuntos | `..._operaciones_fase4.sql` |
| Planificar / estados / reservas | `..._operaciones_fase5.sql` |
| Anular y auditar | `..._operaciones_fase6.sql` |
| Intervenciones y agrupación | `tyrecontrol_intervenciones.sql`, `tyrecontrol_numero_operacion.sql`, `tyrecontrol_trazabilidad_operaciones.sql` |
| **Stock: la regla nuevos/usados (Decisión 1)** | `tyrecontrol_usados_por_ficha.sql` — léelo entero; `tyrecontrol_almacen_usados.sql` da el contexto previo |
| Montaje sin control de stock | `tyrecontrol_fase23_stock_manual_y_fuera_almacen.sql` |
| APK | `tyrecontrol_app/lib/screens/cambio_neumatico_screen.dart`, `historial_operaciones_screen.dart`, `lib/services/supabase_service.dart` |
| Plano del vehículo | `src/modules/tyrecontrol/components/VehicleLayout.tsx` |

---

## 11. Convenciones del repositorio

Las de `CLAUDE.md`, sin excepciones:

- `git fetch origin main` y `git pull` **antes** de empezar. Si la rama se ha
  quedado atrás, integra `main` y resuelve conflictos antes de programar.
- `bash scripts/check-versions.sh` antes de cada commit y de cada push.
- Los `pubspec.yaml` los gestiona CI: **no los toques**. `package.json` sí se
  sube a mano.
- CI ejecuta **`npx tsc -b` Y `npx tsc -p tsconfig.server.json`**. No son
  equivalentes: pasa los dos antes de dar nada por bueno.
- Toda migración: idempotente y terminada en un bloque de comprobación que
  `raise exception` si no se cumplió lo que promete.
