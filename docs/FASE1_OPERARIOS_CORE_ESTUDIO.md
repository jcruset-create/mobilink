# Fase 1 — Estudio: Core como fuente única de operarios y usuarios

> Documento de estudio. **No se ha tocado código.** Pendiente de aprobación antes de Fase 2.
>
> Nota previa importante: el encargo menciona "Flutter/Firebase", pero el inventario confirma
> que **no hay Firebase en ningún punto del proyecto** (ni `google-services.json`, ni paquetes
> `firebase_*`, ni Firestore). Los backends reales son: **Postgres/SQLite del servidor Express**
> y **Supabase** (proyecto `qhbtpebfkckzmtdcutvv`). El plan se plantea sobre esa realidad.

---

## 1. Inventario — dónde vive cada identidad hoy

Existen **cinco almacenes de identidad independientes**, sin fuente única de verdad:

### A. Postgres/SQLite del servidor (`server/db.ts`) — modelo "taller"

| Tabla | Clave | Campos relevantes | Observaciones |
|---|---|---|---|
| `techs` (`server/db.ts:41-53`, `:460`) | **`name` TEXT UNIQUE** (clave de negocio; el `id` SERIAL no se usa) | `status`, `blocked`, `competencies`, `priorities`, `avatar`, `roadsideOperatorCode`, `workshopPin`, `phone`, `es_supervisor` | Sin `activo` (solo `blocked`). Dos PIN distintos en texto plano (`workshopPin`, `roadsideOperatorCode`) |
| `app_users` (`server/index.ts:7733`) | `id` TEXT | JSON `{name, password, role, allowedViews[]}` | Roles: `admin/supervisor/pantallas/tv75`. Contraseña en claro dentro del JSON |
| Usuarios por variables de entorno (`server/modules/users.ts`) | ninguna | `ADMIN_PASSWORD`, `SUPERVISOR_PASSWORD`, `SCREENS_PASSWORD`, `TV75_PASSWORD` | Solo contraseña, sin identidad |

### B. Supabase — maestro de empleados (`sea_employees`, `001_sea_core.sql:114-146`)

UUID PK, `nombre`, `apellidos`, `dni_nie`, `email`, `telefono`, `cargo`, `departamento`,
`rol` (default `operario`), **`codigo_operario` UNIQUE**, **`pin_hash`** (pgcrypto), `activo`,
`fecha_alta/baja`, `user_id → auth.users`. Con satélites por `employee_id` (vestuario,
consentimientos, competencias, certificaciones, autorizaciones).

**Este es el candidato natural a "Core".** Ya lo consumen Presencia, Safety y ToolControl.

### C. Supabase — tablas de usuario por módulo (duplicados institucionalizados)

| Tabla | Módulo | Nota |
|---|---|---|
| `app_usuarios` + `app_usuario_modulos` (`administracion_fase11_usuarios_unificados.sql`) | Administración (maestro "fase 11") | Ya intenta unificar: tiene `employee_id → sea_employees` y sincroniza hacia los espejos |
| `adm_usuarios` | Administración | Espejo |
| `tc_usuarios` + `tc_permisos_cliente` | TyreControl | Identidad propia; el PIN es la contraseña de Supabase Auth |
| `perfiles_usuario` | Almacén neumáticos | Identidad propia; `codigo_operario` hace de PIN **y** de contraseña |

### D. Connect Pro (`server/connect/schema.ts`)

- `connect_users` (`:155`): backoffice, `id` SERIAL, roles `superadmin…provider_user`, `active`.
- `connect_lite_users` (`:653`): operarios de talleres colaboradores — el propio esquema dice
  "equivalente a techs del core". `uuid`, `username`, `pinHash`+`pinSalt`, `role`, `active`.

### E. Nombres hardcodeados en código (deuda crítica)

- `src/modules/techConfig.ts:102-111` — `INITIAL_TECHS` (José, Iván, Alejandro, Jesús, Anthoni,
  David, Andrés, Albert, Ramón); reglas por nombre (`name === "Ramón"` en `:28` y en
  `src/modules/assignment.ts:170,454,488,509`).
- `src/modules/workshopConstants.ts:17-96` — especialistas, orden por área y plantillas con
  arrays de nombres.
- `server/seed.ts:5-49,74-121` — seed de `techs` y plantillas por nombre.

### Pantallas de configuración de operarios/usuarios por módulo (a consolidar)

| Pantalla | Módulo | Almacén |
|---|---|---|
| `src/components/TecnicosView.tsx` | Core taller | `techs` (alta/edición/PIN/competencias) |
| `src/components/UsersScreen.tsx` | Core taller | `app_users` |
| `src/modules/administracion/pages/UsuariosApp.tsx` | Administración | `app_usuarios` + `app_usuario_modulos` |
| `src/modules/almacen-neumaticos/pages/UsuariosAlmacen.tsx` | Almacén | `perfiles_usuario` |
| `src/modules/tyrecontrol/pages/Usuarios.tsx` | TyreControl | `tc_usuarios` |
| `src/modules/connectpro/pages/Usuarios.tsx` | Connect Pro | `connect_users` |
| `src/modules/sea-core/pages/Empleados.tsx` + `EmpleadoDetalle.tsx` | SEA Core | `sea_employees` ✅ (CRUD canónico) |

### Apps móviles (todas solo *leen* identidad; ninguna tiene pantalla de alta)

| App | Fuente de identidad | Login | Clave usada |
|---|---|---|---|
| `taller_app` | `techs` vía Express | desplegable de nombres + PIN (`roadsideOperatorCode`) | **nombre** (string) |
| `flutter_app` (operario) | `techs` vía Express | nombre tecleado + PIN | **nombre** (string) |
| `presencia_app` | `sea_employees` vía Express (`pres_login`) | desplegable + PIN (¡el primer PIN tecleado se auto-registra!) | uuid |
| `safety_app` | mismos endpoints de presencia | desplegable + PIN | uuid |
| `toolcontrol_app` | `sea_employees` directo por RPC `tc_operator_login` | `codigo_operario` + PIN | uuid |
| `tyrecontrol_app` | `tc_usuarios` | nombre + PIN (PIN = contraseña de Auth) | uuid propio |
| `almacen_app` | `perfiles_usuario` | nombre + PIN (`codigo_operario`) | uuid propio |
| `lite_app` | `connect_lite_users` | taller + username + PIN (token bearer) | id entero propio |

---

## 2. Modelo actual de Core

Hay dos "cores" en competencia:

1. **`techs`** (Postgres del servidor): operativo de taller/asistencias. Clave = nombre.
   Sin bajas lógicas, PINs en claro, reglas de negocio ligadas a nombres literales.
2. **`sea_employees`** (Supabase): maestro de RRHH con uuid, `codigo_operario`, `pin_hash`,
   `activo`, roles y satélites. Ya alimenta 3 apps y 3 módulos web.

**Nada vincula `techs` con `sea_employees`.** El único puente existente entre almacenes es
`app_usuarios.employee_id → sea_employees`.

---

## 3. Conflictos detectados

1. **Mismo trabajador con IDs distintos**: puede existir como fila en `techs` (nombre),
   `sea_employees` (uuid), `perfiles_usuario` (uuid), `tc_usuarios` (uuid), `connect_lite_users`
   (int) y como literal en `workshopConstants.ts` — sin ninguna relación entre sí.
2. **Histórico clavado por nombre** (frágil, sin FK): `jobs.assignedNames`,
   `job_assignments.techName`, `job_files.techName`, `tech_breaks.techName`,
   `cobros.operario_name`, `quick_templates.allowedTechs/priorityOrder`,
   `roadside_*` (por `createdBy` texto o `roadsideOperatorCode`). Renombrar a una persona
   rompe su histórico.
3. **Histórico correcto por uuid** en Supabase: `pres_records`, `tc_tool_movements`, Safety —
   este patrón es el objetivo.
4. **Semántica de PIN incompatible por app**: texto plano (`techs`), `crypt()` hash
   (`sea_employees`), PIN = contraseña de Supabase Auth (tyrecontrol),
   PIN = `codigo_operario` visible (almacén), PIN con salt propio (lite). Además presencia
   auto-registra el primer PIN que se teclee (riesgo de suplantación en altas nuevas).
5. **Estados incompatibles**: `activo` (Supabase) vs `blocked` (techs) vs `active` (connect).
6. **Permisos por módulo en tres formatos**: `allowedViews[]` (app_users),
   `app_usuario_modulos.modulo/rol/pantallas`, `tc_permisos_cliente`.
7. **Usuarios de backoffice triplicados**: `app_users` + variables de entorno + `app_usuarios`.

---

## 4. Modelo unificado propuesto

**Core = `sea_employees` (Supabase) como única identidad de persona**, extendida; y
`app_usuario_modulos` como única tabla de asignación de módulos/roles. No se crea una tabla
nueva: se consolida sobre lo que ya es maestro.

```
sea_employees (persona única, uuid)
  ├── identidad: nombre, apellidos, dni_nie, email, telefono, foto
  ├── laboral: cargo, departamento, fecha_alta/baja, activo
  ├── credenciales: codigo_operario UNIQUE, pin_hash, user_id → auth.users
  └── operativa taller (nuevas columnas): es_supervisor, competencies jsonb,
      priorities jsonb, avatar, phone_movil, status operativo (o tabla satélite)

app_usuario_modulos (por empleado y módulo)
  └── employee_id, modulo ∈ {taller, almacen, tyrecontrol, toolcontrol,
      safety, presencia, administracion, connect, agenda}, rol, pantallas[]
```

Reglas:

- El **uuid de `sea_employees` es el identificador universal**; `codigo_operario` es la clave
  humana de login en APKs; el nombre pasa a ser solo dato de presentación.
- Un único PIN por persona (`pin_hash` con pgcrypto). Desaparecen `workshopPin`,
  `roadsideOperatorCode` como credencial, `codigo_operario`-como-PIN de almacén y el
  PIN-contraseña de tyrecontrol.
- `activo` es el único estado de baja; `blocked`/estado operativo de taller se mantienen como
  estado *operativo*, no de identidad.
- La tabla `techs` **no se elimina a corto plazo**: se convierte en *proyección/caché* del Core
  con una columna nueva `employee_id uuid` que la vincula (el planificador de taller sigue
  funcionando igual).
- Los módulos con clientela externa (`tc_usuarios` clientes de TyreControl, `connect_users`,
  `connect_lite_users` de talleres colaboradores) **quedan fuera del Core de operarios**: son
  usuarios de terceros, no plantilla propia. Solo los *operarios internos* de esos módulos migran.

---

## 5. Plan de migración (incremental, sin perder histórico)

**Paso 0 — Congelar altas fuera de Core.** Las pantallas `TecnicosView`, `UsuariosAlmacen`,
`Usuarios` (tyrecontrol, para operarios internos) dejan de crear; solo `Empleados.tsx` da altas.

**Paso 1 — Vincular sin migrar.** Script SQL (ejecución manual, pauta del proyecto) que añade
`techs.employee_id`, `perfiles_usuario.employee_id`, `tc_usuarios.employee_id` y los rellena por
casación de nombre normalizado (+`codigo_operario` donde exista). Informe de no-casados para
resolución manual. **Ningún dato histórico se toca**: el vínculo permite traducir nombre ↔ uuid.

**Paso 2 — Backfill de histórico.** Añadir columnas `employee_id` (nullable) junto a las claves
por nombre (`job_assignments`, `tech_breaks`, `cobros`, `job_files`, `roadside_*`) y rellenarlas
vía el vínculo del paso 1. Las columnas de nombre se conservan (histórico intacto); las lecturas
nuevas prefieren `employee_id` con fallback a nombre.

**Paso 3 — Unificar credenciales.** Migrar PINs al `pin_hash` de Core (los PIN en claro de
`techs` se pueden hashear directamente; los de almacén/tyrecontrol requieren reset comunicado).
Corregir el auto-registro de PIN de presencia (solo admisible si `pin_hash IS NULL` y con alta
supervisada).

**Paso 4 — Redirigir lecturas módulo a módulo** (orden de menor a mayor riesgo):
1. Safety y Presencia — ya leen Core; solo consolidar el modelo tipado compartido.
2. ToolControl — ya lee Core; sin cambios de datos.
3. Almacén — login pasa a `codigo_operario`+PIN de Core; `perfiles_usuario` queda como vista de
   compatibilidad y su pantalla de usuarios se elimina.
4. TyreControl (operarios internos) — login de operario contra Core; clientes siguen en
   `tc_usuarios`.
5. Taller/asistencias — los endpoints `/api/techs*` y `/api/roadside-operator/*` resuelven por
   `employee_id`; `TecnicosView` pasa a editar solo la capa operativa (competencias, estado)
   leyendo la identidad de Core.
6. Eliminar hardcodeos: `INITIAL_TECHS`, reglas `name === "Ramón"` → flags/competencias en
   datos, plantillas por uuid.

**Paso 5 — Limpieza.** Eliminar pantallas de configuración duplicadas
(`UsuariosAlmacen.tsx`, alta en `TecnicosView`, `UsersScreen` → fusionado con `UsuariosApp`),
espejos `adm_usuarios`/`perfiles_usuario` (vistas de compatibilidad primero, borrado después),
y usuarios por variables de entorno.

Cada paso es desplegable por separado y reversible (columnas nuevas nullable + fallback a la
clave antigua hasta el paso 5).

---

## 6. Cambios por módulo (resumen)

| Módulo | Se elimina | Pasa a leer de Core |
|---|---|---|
| Taller core | alta de técnicos en `TecnicosView`, `UsersScreen`, seed de nombres | identidad+PIN; `techs` queda como capa operativa vinculada por `employee_id` |
| Almacén | `UsuariosAlmacen.tsx`, login por `codigo_operario`-en-claro | login Core (`codigo_operario`+`pin_hash`) |
| TyreControl | alta de operarios internos en `Usuarios.tsx` | operarios internos desde Core; clientes no cambian |
| Presencia / Safety / ToolControl | nada (ya usan Core) | endurecer registro de PIN |
| Administración | espejos `adm_usuarios` | `app_usuarios.employee_id` obligatorio para plantilla |
| Connect Pro / Lite | nada (usuarios de terceros, fuera de alcance) | opcional: vincular técnicos propios por `employee_id` |
| Apps Flutter | duplicación de `config.dart` y modelos | modelo `Employee` común y login unificado `codigo_operario`+PIN |

---

## 7. Riesgos

1. **Histórico por nombre**: si la casación nombre→uuid falla (tildes, "José"/"Jose"), el
   backfill deja huecos → por eso el paso 1 exige informe de no-casados y validación manual.
2. **Reset de PIN en almacén/tyrecontrol**: cambia la experiencia de login; requiere
   comunicación a los operarios y ventana de convivencia.
3. **APKs desplegadas**: las apps antiguas seguirán llamando a los endpoints actuales; hay que
   mantener compatibilidad (fallback por nombre) hasta que todas las apps suban de versión.
4. **`tc_usuarios`/`perfiles_usuario` con RLS y Auth de Supabase**: el login sintético
   (`apk-…@mobilink-almacen.app`) depende de esas tablas; cambiar el login exige revisar las
   políticas RLS asociadas.
5. **Reglas de negocio por nombre** (`Ramón`, especialistas): convertirlas a datos puede alterar
   asignaciones si los flags no se replican exactamente; requiere verificación con los tests de
   `assignment` existentes.
6. **Doble base (Postgres servidor vs Supabase)**: el vínculo `techs.employee_id` cruza bases;
   la sincronización debe ser tolerante a caídas (misma pauta que el Integration Hub).

---

**Siguiente paso:** aprobación de este documento. Con el visto bueno se ejecuta la Fase 2 en el
orden del apartado 5, empezando por los scripts SQL de vinculación (ejecución manual del usuario).
