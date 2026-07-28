# PROMPT — Mobilink WorkPlanner

> Este documento es el **prompt maestro** del módulo WorkPlanner. No es código todavía; es el
> encargo que se ejecutará en una fase posterior. Léelo entero y confirma el alcance antes de
> tocar nada.

---

## 0. Contexto (ya construido)

- La agenda actual vive en el panel de taller (`src/components/AgendaView.tsx`) con trabajos
  programados (`ScheduledJob`, helpers en `src/modules/scheduledJobHelpers.ts`,
  `src/modules/useScheduledJobs.ts` y los helpers V2 `scheduledJobV2*`).
- El estado de los operarios/técnicos se gestiona en `src/modules/techStatus.ts` (estados:
  disponible, refuerzo, ocupado, nodisponible, permiso, vacaciones, baja, otro_taller,
  supervisor) con bloqueos duros en `HARD_BLOCKED_TECH_STATUSES` y horarios en
  `techStatusScheduleHelpers.ts`.
- La jerarquía Empresas > Talleres > Unidades y Operarios ya existe (módulo Central Pro,
  commits recientes).
- El hub de entrada por permisos es `/inicio` (`src/pages/InicioPage.tsx`) con el catálogo de
  módulos en `src/modules/administracion/config/modulosApp.ts` (`MODULOS_APP`) y permisos en
  `app_usuario_modulos`.

## 1. Objetivo

**WorkPlanner** es la vista de planificación de trabajo por operario y por día/semana: un
tablero que cruza la agenda de trabajos programados con la disponibilidad real de los operarios,
para poder asignar, mover y equilibrar la carga sin salir de una sola pantalla.

No sustituye a la agenda del panel de taller; la complementa con una vista orientada a
**capacidad y asignación**, no a la cola del día.

## 2. Qué construir

### 2.1 Módulo `src/modules/workplanner/`

Seguir el patrón de los módulos existentes (p. ej. `tyrecontrol`): `config/navigation.ts`,
`pages/`, `services/`, `types/`.

Pantallas (fase 1):

1. **Planificador semanal** (`/workplanner/semana`)
   - Rejilla operarios (filas) × días de la semana (columnas).
   - Cada celda muestra los trabajos programados del operario ese día (chips con hora,
     matrícula/cliente y fase, reutilizando `getScheduledJobCurrentPhaseLabel`).
   - Los días en que el operario tiene un estado de `HARD_BLOCKED_TECH_STATUSES`
     (vacaciones, baja…) se pintan bloqueados y no admiten asignación.
   - Drag & drop (o mover con menú contextual como fallback) de un trabajo entre operarios y
     días: reutilizar las mutaciones existentes de asignación (`assignmentMutations.ts`,
     `useScheduledJobs.ts`), sin duplicar lógica de escritura.
   - Indicador de carga por celda (nº de trabajos / umbral configurable) con colores
     verde/ámbar/rojo.

2. **Vista día** (`/workplanner/dia`)
   - Mismo cruce pero con franjas horarias, para el reparto fino del día siguiente.

3. **Sin asignar** (panel lateral en ambas vistas)
   - Trabajos programados sin operario: origen de los drag & drop.

### 2.2 Integración con la plataforma

- Añadir `workplanner` a `MODULOS_APP` con rol único de acceso (`ROL_ACCESO`) y pantallas
  `semana`, `dia`.
- Tarjeta en `/inicio` como el resto de módulos; gating por `app_usuario_modulos`.
- Rutas en `App.tsx` bajo `/workplanner/*` con layout propio (topbar oscura slate + acento sky,
  enlace "Inicio", botón Salir), como los demás módulos.

### 2.3 Datos

- **No crear tablas nuevas en fase 1**: leer y escribir sobre las estructuras existentes de
  trabajos programados y estado de técnicos, a través de los helpers/APIs actuales.
- Cargas en paralelo y suscripción/refresco igual que la agenda (reutilizar `useAutoSync` si
  aplica). Ningún acceso directo a Supabase desde componentes: siempre vía `services/`.

## 3. Entregables

1. Módulo `src/modules/workplanner/` + rutas + tarjeta en `/inicio` + entrada en `MODULOS_APP`.
2. `npm run build` limpio y tests de los helpers puros nuevos (cálculo de carga, agrupación
   operario×día) siguiendo el patrón de `agendaConfig.test.ts`.
3. Versión en `src/version.ts`, commit + push.
4. Lista final: qué se ha reutilizado de la agenda y qué helpers nuevos se han añadido.

## 4. Restricciones

- No tocar la agenda actual del panel de taller ni su flujo de escritura: WorkPlanner escribe
  por las mismas mutaciones, no por caminos nuevos.
- No renombrar identificadores técnicos existentes (misma regla que el renombrado Mobilink).
- Español en toda la UI, mismo estilo visual que `/inicio` y Administración.
- Fase 1 sin apps móviles: solo web. La versión para `android-tecnicos`/Flutter queda como
  deuda documentada.
