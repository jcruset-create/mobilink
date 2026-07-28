# PROMPT — Mobilink WorkPlanner

> Prompt maestro del módulo **Mobilink WorkPlanner**. No es código todavía; es el encargo que se
> ejecutará en la siguiente fase. Léelo entero y confirma el alcance antes de tocar nada.

---

## 0. Contexto (ya construido)

- El hub de entrada es `/inicio` (`src/pages/InicioPage.tsx`): rejilla de tarjetas por módulo
  (Empresas y licencias, Licencias, Assist Central Pro, Panel de taller…), catálogo en
  `MODULOS_APP` (`src/modules/administracion/config/modulosApp.ts`) y permisos en
  `app_usuario_modulos`.
- El panel de taller (`src/SeaTarragonaV1.tsx`) contiene las vistas internas definidas en
  `src/modules/permissions.ts` (`AppView`), entre ellas **`operativo2` ("Operativo 2")** y
  **`agenda` ("Agenda")** — ojo: también existe `agenda2` ("Agenda 2").
- `SeaTarragonaV1` ya acepta la prop `initialView`; la ruta `/operativo2` en `App.tsx` es el
  precedente exacto: `<SeaTarragonaV1 initialView="operativo2" />`. Lo mismo se hace con
  `/asistencias`.

## 1. Objetivo

Crear en el menú de `/inicio` un módulo llamado **Mobilink WorkPlanner** que agrupe, dentro de
un layout propio con menú lateral/topbar, cuatro secciones:

1. **Operativo 2** — la vista `operativo2` actual del panel de taller, integrada.
2. **Agenda** — la vista de agenda actual del panel de taller, integrada.
3. **Análisis y estadísticas** — *placeholder* (fase futura).
4. **Configuración** — *placeholder* (fase futura).

**Alcance de esta fase:** solo Operativo 2 y Agenda funcionales. Estadísticas y Configuración
aparecen en el menú, preparadas (entrada visible, ruta creada), pero muestran una pantalla
"Próximamente" y no contienen lógica.

## 2. Qué construir

### 2.1 Tarjeta en `/inicio`

- Nueva tarjeta "Mobilink WorkPlanner" en `InicioPage.tsx`, con el mismo estilo que las
  existentes (icono lucide, p. ej. `CalendarClock` o `ClipboardList`; descripción corta:
  "Planificación del trabajo: operativo, agenda y análisis"), botón **Entrar** →
  `/workplanner`.
- Añadir `workplanner` a `MODULOS_APP` con rol único de acceso y pantallas `operativo2`,
  `agenda`, `estadisticas`, `configuracion`, para el gating por `app_usuario_modulos`
  (superadmin lo ve siempre, como el resto).

### 2.2 Módulo `src/modules/workplanner/`

Seguir el patrón de módulos existentes: `config/navigation.ts`, `pages/`, layout propio
(oscuro slate + acento sky, enlace "Inicio" y botón Salir como los demás módulos).

Rutas bajo `/workplanner/*` en `App.tsx`:

| Ruta | Contenido en esta fase |
|---|---|
| `/workplanner` | redirección a `/workplanner/operativo2` |
| `/workplanner/operativo2` | `SeaTarragonaV1` con `initialView="operativo2"` |
| `/workplanner/agenda` | `SeaTarragonaV1` con `initialView` de la agenda |
| `/workplanner/estadisticas` | pantalla "Próximamente" (placeholder) |
| `/workplanner/configuracion` | pantalla "Próximamente" (placeholder) |

- El menú del módulo muestra las cuatro entradas; Estadísticas y Configuración con distintivo
  "Próximamente" (o atenuadas) pero navegables a su placeholder, de modo que la estructura de
  navegación quede lista para las fases siguientes.
- **Integración de las vistas**: reutilizar `SeaTarragonaV1` vía `initialView` (mismo mecanismo
  que `/operativo2` y `/asistencias`), sin duplicar ni extraer todavía el código de esas vistas.
  Si el header propio de `SeaTarragonaV1` choca visualmente con el layout del módulo, la opción
  mínima es aceptarlo en esta fase y documentarlo; extraer las vistas a componentes propios es
  deuda para otra fase.
- **Punto a confirmar antes de programar**: cuál de las dos agendas integra WorkPlanner —
  `agenda` ("Agenda") o `agenda2` ("Agenda 2"). Por defecto se integrará la que esté en uso
  real hoy en el panel; confirmar con el usuario.

### 2.3 Lo que NO se hace en esta fase

- Ninguna tabla nueva ni cambio en Supabase.
- No se toca el panel de taller ni sus rutas actuales (`/`, `/operativo2`, `/asistencias`
  siguen igual).
- Nada de lógica en Estadísticas ni Configuración: solo menú + placeholder.
- Solo web; sin cambios en apps Flutter/Android.

## 3. Entregables

1. Tarjeta "Mobilink WorkPlanner" en `/inicio` + entrada `workplanner` en `MODULOS_APP`.
2. Módulo `src/modules/workplanner/` con layout, navegación de 4 entradas y las 4 rutas
   (2 funcionales + 2 placeholders).
3. `npm run build` limpio, versión en `src/version.ts`, commit + push.
4. Nota final: qué se ha reutilizado tal cual y qué queda como deuda (extracción de vistas,
   contenido de Estadísticas y Configuración).

## 3 bis. Fase 2 — modo embebido y licencia propia (aplicada)

- `SeaTarragonaV1` acepta la prop `embebido`: oculta su cabecera de título/versión y su barra
  de conmutación de vistas, y deja de ser `sticky` para no chocar con la topbar del módulo.
  El panel de taller en `/`, `/panel`, `/operativo2` y `/asistencias` no cambia (sin la prop).
- WorkPlanner aporta la única navegación (4 secciones) y su propio botón **Salir**, que cierra
  la sesión de plataforma y el login interno del panel.
- **Licenciamiento independiente**: `workplanner` es un módulo más de `app_licencias`
  (migración `supabase/migrations/saas_fase1c_modulo_workplanner.sql`), separado de `taller`.
  Tener WorkPlanner no implica tener el panel de taller ni al revés. El acceso directo por URL
  a `/workplanner/*` valida permiso + licencia vía `app_mis_modulos`; sin licencia se muestra
  "Módulo no disponible". El selector de licencias de `/admin/empresas` ya lo incluye.

## 3 ter. Fase 3 — extracción de vistas (parcial, aplicada)

Aplicado:

- **`src/components/Operativo2View.tsx`**: la vista Operativo 2 sale de las 415 líneas inline
  de `SeaTarragonaV1` a un componente propio con props explícitas (datos, derivados y las 18
  acciones del ciclo de trabajo). Copia mecánica, sin cambios de comportamiento.
- En modo embebido el panel hace **early-return** de la vista pedida: WorkPlanner ya no monta
  el resto del JSX del panel. `Operativo2View` acepta `embebido` (fluye en el layout en vez de
  ser un overlay `fixed` que tapaba la topbar) y oculta su barra de navegación al panel.
- La agenda ya era un componente propio (`AgendaView`) y también entra por early-return.
- `onVolverModulo`: "Volver" de la agenda devuelve a WorkPlanner, no al panel.
- Corregido: el login SSO pisaba `initialView`, así que entrar directo a `/workplanner/agenda`
  aterrizaba en Operativo 2.

### Pendiente para vender WorkPlanner realmente suelto

1. **Motor de datos compartido.** Las dos vistas siguen necesitando el núcleo del panel
   (carga de jobs/techs, `useScheduledJobs` con `allocateJob`, y las 18 acciones). Son ~4.400
   líneas y 438 declaraciones en `SeaTarragonaV1`. Extraerlas a un hook `useWorkshopEngine`
   compartido es la fase siguiente; hacerlo de golpe y sin tests es arriesgado, así que debe ir
   por partes y con verificación en cada corte.
2. **Autenticación del panel.** `POST /api/login-sso` (server/index.ts:9927) devuelve 404
   "Tu usuario no tiene acceso al panel de taller" salvo que el usuario exista como usuario del
   panel o sea superadmin, y las vistas visibles dependen de su `allowedViews`. Un cliente que
   solo contrate WorkPlanner necesita, o bien un usuario de panel con `operativo2`/`agenda2`,
   o bien que el endpoint conceda acceso por licencia de `workplanner`. Esto último implica
   decidir **qué token de escritura recibe** ese usuario (hoy `adminToken` es la contraseña de
   un usuario de panel o `ADMIN_PASSWORD`): es una decisión de seguridad, no un detalle técnico.

## 4. Restricciones

- Español en toda la UI, mismo estilo visual que `/inicio` y el resto de módulos.
- WorkPlanner no es un control de seguridad: el gating real sigue siendo el de cada vista.
- No renombrar identificadores técnicos existentes (misma regla que el renombrado Mobilink).
