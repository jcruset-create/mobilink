# Fase 1 — Estudio: Core como fuente única de operarios y usuarios

> **2026-11-23 · Fase C empezada por Recepciones (el más pequeño, 3/3 enlazados).**
> Recepciones era el caso limpio: el operario del muelle no teclea su nombre
> para firmar (lo elige de la lista y pone el PIN), así que leer el nombre de
> Core no toca ningún login.
>
> **Qué se ha hecho**
> - Lectura: `server/recepciones/repository.ts` cruza `rcp_operarios` con
>   `sea_employees` por `employee_id`. El nombre que se enseña es el de Core y,
>   si en Core está de baja, el operario no sale para firmar ni puede firmar.
>   Sin enlace, el de siempre.
> - Alta: con Core en la base, se elige la persona (por Nº o nombre) y el
>   nombre lo pone Core. `GET /api/recepciones/operarios/personas-core` da la
>   lista; esconde a quien ya es usuario de OTRA empresa (mismo criterio que
>   Cash). Una persona solo puede ser un operario.
> - Edición: el nombre de un enlazado no se cambia en Recepciones (409
>   `NOMBRE_EN_CORE`); centro, PIN y baja del módulo, igual que antes.
> - Sin Core en la base (`sea_employees` no existe), todo como antes.
> - `rcp_operarios.nombre` se sigue rellenando al dar de alta: es NOT NULL y
>   el respaldo si un día se desenlaza. No se borra nada (sin DROP).
> - No hace falta ninguna migración: `employee_id` ya lo puso
>   `core_enlace_modulos.sql`, y el arranque lo añade en bases sin ella.
>
> **Pendiente**
> - Almacén (5 de 7 sin enlazar): su APK entra comparando el nombre que
>   guarda `perfiles_usuario`; hay que decidir si el login pasa a mirar Core.
> - Las recepciones ya firmadas guardan el nombre de entonces
>   (`operario_nombre`): es histórico y no cambia.

> **2026-11-23 · Número de trabajador — Fase B hecha (enlazar trabajadores).**
> Estado en producción antes de empezar: los 21 empleados activos reales ya
> tienen número (copiado de `codigo_operario`, que es el de nóminas). Por
> enlazar: Taller 1, Administración 8, Almacén 7, Recepciones 3, TyreControl 7
> (2 administradores + 5 operadores). Cash ya estaba entero (10/10).
>
> **Qué se ha hecho**
> - `supabase/migrations/core_enlace_modulos.sql`: `employee_id` (FK a
>   `sea_employees`, `ON DELETE SET NULL`) en `perfiles_usuario`,
>   `rcp_operarios` y `tc_usuarios`. Sin triggers, sin copiar datos, sin DROP.
> - `server/core/enlaceTrabajadores.ts`: `GET /api/core/enlaces` y
>   `PUT /api/core/enlaces/:modulo/:id`, solo administradores. Una persona solo
>   puede ser un usuario de cada módulo (409 si ya lo es). No se enlaza a nadie
>   de baja. `app_usuarios` y `rcp_operarios` se filtran por la empresa cliente
>   del administrador (salvo superadmin).
> - Core → **Enlazar trabajadores**: una pestaña por módulo; se escribe el
>   número de trabajador, sale a quién corresponde y se confirma. Pista por
>   nombre marcada «por nombre — revisar».
> - Cash no tiene pestaña: ya enlaza con su propia lógica y está entero.
>
> **Orden en Supabase**
> 1. `core_enlace_modulos.sql` (idempotente; se salta la tabla que no exista).
> 2. Enlazar desde Core → Enlazar trabajadores.
> 3. Ver el avance con las consultas 5a–5c y 6d–6f de
>    `core_numero_trabajador_informe.sql`.
>
> **Pendiente de decidir**
> - Varios de los 8 usuarios de Administración pueden no ser plantilla
>   (oficina, cuentas de prueba): se dejan sin enlazar, no hay que forzarlo.
> - Fase C (los módulos leen la identidad de Core y dejan de crear personas):
>   empezar por el módulo que quede entero primero.

> **2026-11-23 · Número de trabajador por empresa — Fase A hecha.**
> Plan completo en `PROMPT_NUMERO_TRABAJADOR_CORE.md`. Sustituye al paso «el DNI
> como identificador único», que queda aparcado: el DNI sigue siendo un dato de
> la ficha, pero la clave para enlazar módulos es el número interno.
>
> **Qué se ha hecho**
> - `sea_employees.numero_trabajador` (TEXT, opcional) con índice único parcial
>   `(company_id, numero_trabajador)`. No se usa `codigo_operario`: es único en
>   toda la base y es el usuario de login de ToolControl.
> - `server/core/numeroTrabajador.ts`: `GET /api/core/empleados/numeros-trabajador`
>   y `PUT /api/core/empleados/:id/numero-trabajador`, solo administradores.
>   Repetido en la misma empresa → 409 diciendo con quién choca (solo se busca
>   dentro de esa empresa); sin empresa → 400; columna sin crear → 503.
> - Core → Empleados: columna «Nº», búsqueda por número y filtro «Sin número».
>   Ficha: tarjeta «Número de trabajador» para ponerlo o quitarlo. Las dos
>   pantallas funcionan igual que antes mientras la migración no esté ejecutada.
>
> **Orden en Supabase (SQL Editor, a mano)**
> 1. `core_numero_trabajador_informe.sql`, consultas 1, 2 y 5: empleados sin
>    empresa y cuántos operarios hay por enlazar en cada módulo.
> 2. Asignar empresa a los activos que no la tengan (Core → Empleados).
> 3. `core_numero_trabajador.sql` (idempotente; si hubiera repetidos, se para y
>    remite a la consulta 4 del informe).
> 4. Rellenar los números desde Core → Empleados → «Sin número». La consulta 3
>    del informe enseña el avance.
>
> **Pendiente de decidir**
> - Los ceros a la izquierda cuentan: «007» y «7» son números distintos. Si en
>   nóminas siempre van con ceros, conviene decidir un formato fijo.
> - `sea_companies` (empresa del empleado) no está relacionada con la empresa
>   cliente de la plataforma (`authCtx.empresaId`): cualquier administrador ve
>   y numera empleados de todas las `sea_companies`.
> - La web sigue escribiendo el resto de la ficha directamente en Supabase con
>   RLS `USING (true)`; solo el número pasa por el servidor.
> - `perfiles_usuario` no tiene `CREATE TABLE` en `supabase/migrations/`: su
>   esquema se ha deducido del código para el informe (consulta 5d).
> - Siguiente paso: Fase B (pantalla «Enlazar trabajadores»), empezando por Almacén.

> **Revisado el 2026-09-08.** El estudio original (secciones 1–7, más abajo) sigue siendo
> válido como inventario, pero se escribió antes de trabajar sobre el código. Lo que se
> aprendió después cambia el plan: **el sistema unificado ya existe y funciona**, así que
> esto no es diseñar algo nuevo sino terminar una migración a medias.

---

## 0. Estado real y plan vigente (2026-09-08)

### Lo que YA está montado

- `app_usuarios` + `app_usuario_modulos`: usuario único, con **rol y pantallas por módulo**.
- El login unificado de `/acceso` que los usa.
- **`app_usuarios.employee_id → sea_employees(id)`**: el puente entre el acceso y la
  persona ya está en el esquema (`administracion_fase11_usuarios_unificados.sql:25`).
- Superadmin de plataforma respetado por el hub y por los guardias de Administración,
  Almacén y TyreControl (`src/modules/superadmin.ts`).
- Alta y edición completas en **Administración → Usuarios** (`/administracion/usuarios`):
  crea la cuenta de Auth con la contraseña bien salada, asigna módulos, roles y pantallas.

### Lo que falta, y por qué

| Sistema | Estado | Bloqueo |
|---|---|---|
| `perfiles_usuario` (Almacén) | Isla: **sin ningún vínculo** con el resto | Ninguno — es el más fácil |
| `techs` (Taller) | **Sin vínculo**; clavada por `name`, no por id | Histórico por nombre en 7 tablas |
| `app_users` (Panel) | La **contraseña ES el token de sesión** | Hay que separar credencial de sesión primero |

### Plan por pasos

**Paso 1 — Almacén: el rol viene de Core.** `perfiles_usuario` deja de ser almacén de
identidad y pasa a ser **satélite del módulo** (ubicación, código de operario, clientes
asignados). El rol se lee de `app_usuario_modulos` (`modulo = 'almacen'`), con vuelta atrás
a `perfiles_usuario` mientras queden usuarios sin migrar. Los tres roles coinciden uno a uno
(`admin` / `responsable` / `operario`), así que no hace falta traducir nada.

> ⚠️ La APK de almacén (`almacen_app`) entra por `/api/almacen/login-operario` contra
> `perfiles_usuario.codigo_operario`. **Ese camino no se toca en este paso**: la tabla sigue
> viva y la APK sigue funcionando.

**Comprobación antes de desplegar.** Como Core pasa a mandar, quien tenga rol distinto en las
dos tablas cambia de permisos. Esta consulta saca la lista para revisarla:

```sql
select u.email,
       a.username,
       m.rol            as rol_core,
       p.rol            as rol_ficha_almacen,
       case
         when m.rol is null then 'entra por la ficha (sin migrar)'
         when p.rol is null then 'solo Core'
         when m.rol = p.rol then 'coinciden'
         else 'CAMBIA: mandará el de Core'
       end as efecto
from perfiles_usuario p
full outer join app_usuario_modulos m
  on m.user_id = p.user_id and m.modulo = 'almacen'
left join app_usuarios a on a.id = coalesce(m.user_id, p.user_id)
left join auth.users  u on u.id = coalesce(m.user_id, p.user_id)
where p.activo is not false
order by efecto, a.username;
```

Las filas con `CAMBIA` son las únicas que hay que mirar: o se corrige el rol en
Administración → Usuarios, o se acepta el nuevo.

**Efecto secundario conocido.** Un usuario con acceso en Core pero **sin ficha** de almacén
entra, pero se queda sin `ubicacion`, así que las operaciones ligadas a una ubicación concreta
le quedan cerradas (salvo que sea admin). Antes no entraba en absoluto, así que no es una
regresión; simplemente indica que a esa persona le falta su ficha del módulo.

**Paso 2 — Técnicos: vincular `techs` con la persona.** Añadir `techs.employee_id`, casar por
nombre normalizado y sacar informe de no-casados. El histórico (partes, pausas, cobros,
asistencias) **se queda apuntando por nombre**: solo se añade el id para las lecturas nuevas.
Después, la pantalla *Técnicos* edita únicamente lo operativo y la identidad viene de Core.
Es el paso que más ahorra en el día a día: elimina la tercera alta.

**Paso 3 — Panel de taller (bloqueante).** En `app_users` la contraseña se entrega como
`adminToken` y se reenvía en cada petición (`server/index.ts`, `login-sso`). Mientras siga
así no se puede fusionar. Orden obligado:
1. Separar credencial de sesión: hashear la contraseña e introducir tokens propios con
   caducidad (ver `docs/SEGURIDAD_CREDENCIALES.md`, apartado A).
2. Los roles del panel (`admin`/`supervisor`/`pantallas`/`tv75`) pasan a ser un módulo más en
   `app_usuario_modulos`. El servidor ya sabe resolver el rol desde la sesión unificada.
3. Las pantallas de TV necesitan lo suyo: **token de dispositivo**, no un usuario con
   contraseña.

**Paso 4 — Una sola alta. HECHO (14-09-2026).** Core → Empleados crea la persona y desde su
ficha, pestaña **Acceso**, se le da usuario, contraseña y módulos. Escribe en `app_usuarios`
con `employee_id` ya vinculado, así que la cuenta y la ficha nacen unidas y no hay que pasar
por Administración → Usuarios. Las dos pantallas comparten el editor de accesos
(`src/modules/administracion/components/AccesosModulos.tsx`) para que añadir un módulo al
catálogo las actualice a la vez.

Al hacerlo salió a la luz que `app_guardar_usuario` **nunca rellenaba `app_usuarios.empresa_id`**,
que la fase SaaS 1 había declarado `not null` después. Toda alta o edición de usuario fallaba con
`null value in column "empresa_id"`. Lo arregla
`supabase/migrations/administracion_fase11b_usuario_empresa.sql`, que además impide con un índice
único que un mismo empleado acabe con dos cuentas.

### Lo que NO se unifica

Los clientes de TyreControl (`tc_usuarios` con `rol = 'cliente'`) y los usuarios de Connect
Pro. **No son plantilla propia**: son terceros —flotas, talleres colaboradores— con otro ciclo
de vida. Meterlos en el mismo saco complica el modelo sin ganar nada.

---

## Estudio original (2026-07-28)


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
