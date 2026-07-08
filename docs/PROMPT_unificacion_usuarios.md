# PROMPT — Unificación de usuarios + pantalla de gestión para administradores

> Prompt listo para usar en el repo `sea-tarragona`. Antes de programar, leer entero: define la tabla maestra de usuarios, la sincronización con los perfiles de cada módulo y la pantalla exclusiva de administradores para crear/editar/eliminar usuarios, asignar roles y dar acceso por módulo y pantalla.

---

## Contexto (verificado en el repo)

- Todos los módulos comparten el **mismo login** (`auth.users` de Supabase, enlace mágico por email), pero cada módulo tiene su **propia tabla de perfil desconectada**:

| Tabla | Módulo | Detalle |
|---|---|---|
| `adm_usuarios` | Administración | `id` = PK = FK a `auth.users` (obligatoria). Enum `adm_rol`: admin, administracion, recepcion, supervisor, tecnico |
| `tc_usuarios` | TyreControl | `id` = PK = FK a `auth.users`. Enum `tc_rol`: administrador, operador, cliente + `empresa_id`, `es_superadmin`, `acceso_apk`, `acceso_panel` |
| `sea_employees` | SEA Core (la consumen ToolControl, Safety y Presencia por FK) | `user_id` **opcional** → hay empleados sin login (solo PIN/código de operario) |
| `perfiles_usuario` | Almacén neumáticos | Sin migración versionada en el repo (creada en el dashboard). `user_id` nullable + tabla puente `usuario_clientes` |

- **No existe ningún trigger de sincronización entre ellas** (a diferencia de clientes, donde `clientes` es maestra y `adm_sync_cliente` sincroniza a `adm_customers`).
- Ya existen Edge Functions `admin-create-user` y `admin-update-user` en `supabase/functions/` (usan service role para crear/editar usuarios de Auth) — **leerlas y reutilizarlas** en lugar de inventar otro mecanismo.
- El módulo Administración (`src/modules/administracion/`) tiene el patrón de referencia: layout `AdminLayout`, guards por rol, `ui.tsx`, migraciones idempotentes `administracion_faseN_*.sql`.

## Objetivo

1. **Tabla maestra de usuarios de la aplicación** con sincronización automática hacia los perfiles de cada módulo (mismo patrón que clientes).
2. **Pantalla "Usuarios" solo para administradores** donde se pueda: crear, editar y eliminar usuarios; asignar rol por módulo; y marcar con **checkboxes** a qué módulos y pantallas accede cada uno.
3. **Login por usuario y contraseña** (ej.: usuario `Jordi`, contraseña `1234`), NO por email con enlace mágico. Un solo login da acceso a todos los módulos permitidos. El email queda solo como dato opcional de recuperación de contraseña para administradores.

## Modelo de login (usuario + contraseña sobre Supabase Auth)

Supabase Auth exige un email interno, así que:

- Cada usuario tiene un **nombre de usuario único** (`username`, ej. `Jordi`) guardado en `app_usuarios`. Al crear el usuario de Auth se usa un **email sintético interno** derivado del username (ej. `jordi@usuarios.sea`), invisible para el usuario, más la contraseña que teclee el administrador.
- **Pantalla de login unificada**: campos "Usuario" y "Contraseña". El frontend resuelve username → email sintético mediante una RPC `security definer` `app_login_email(p_username)` (devuelve solo el email interno del usuario activo, o null) y llama a `signInWithPassword`. Mensajes de error genéricos ("Usuario o contraseña incorrectos").
- **Contraseñas**: sin política compleja (el taller quiere PINs cortos tipo `1234`); configurar Supabase Auth con longitud mínima 4 si lo permite, o rellenar internamente hasta el mínimo con un sufijo determinista documentado en el código. Decidir al implementar y documentarlo.
- **Restablecer contraseña**: lo hace un **administrador** desde la pantalla de Usuarios (botón llave → pide la contraseña nueva → Edge Function `admin-update-user` con service role). Los administradores pueden además tener un **email real de recuperación** (campo opcional) para autoservicio vía `resetPasswordForEmail` si algún día se quiere; los usuarios normales no lo necesitan.
- **Sesión única**: la sesión de Supabase ya se comparte entre módulos (mismo cliente). Al entrar, el usuario accede directamente a cualquier módulo permitido sin volver a identificarse. Los logins por email de los módulos existentes se mantienen funcionando (no romper), pero el login nuevo es la puerta recomendada y se enlaza desde el panel.

## Arquitectura de datos (migración `administracion_fase11_usuarios_unificados.sql`)

### Tabla maestra `app_usuarios`

- `id uuid` PK = FK a `auth.users(id) on delete cascade` (el maestro siempre tiene login; los empleados sin login siguen viviendo solo en `sea_employees`).
- `username text not null unique` (case-insensitive: índice único sobre `lower(username)`) — es el login visible (ej. `Jordi`).
- `nombre text not null` (nombre completo), `email_recuperacion text` (opcional, solo tiene sentido para administradores), `telefono text`, `activo boolean default true`, `es_superadmin boolean default false`.
- `employee_id uuid` FK **opcional** a `sea_employees(id)` para vincular con la ficha de empleado de SEA Core cuando exista.
- `created_at`, `updated_at`.

### Tabla de accesos `app_usuario_modulos`

- `id uuid` PK, `user_id uuid` FK a `app_usuarios on delete cascade`.
- `modulo text` check in `('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia')`.
- `rol text not null` — el rol **en la nomenclatura de ese módulo** (p. ej. para administracion: admin/administracion/recepcion/supervisor/tecnico; para tyrecontrol: administrador/operador/cliente).
- `pantallas text[]` — lista opcional de claves de pantalla permitidas; `null` = todas las del rol. Las claves son las de `config/navigation.ts` de cada módulo (p. ej. `cobros-dia`, `recobros`, `seguimiento`).
- `empresa_id uuid null` — solo para tyrecontrol (usuarios de tipo cliente van ligados a una `tc_empresa`).
- `unique (user_id, modulo)`.

### Sincronización maestra → módulos (triggers `security definer`)

Al insertar/actualizar en `app_usuarios` + `app_usuario_modulos`:

- **administracion**: upsert en `adm_usuarios` (id, nombre, email, rol, activo). Si se quita el acceso al módulo o se desactiva el usuario → `activo = false` (no borrar, por las FKs de historial).
- **tyrecontrol**: upsert en `tc_usuarios` (id, nombre, email, rol, empresa_id, activo). Si no se indica empresa, usar la empresa SEA por defecto (la primera de `tc_empresas`).
- **almacén**: ANTES de tocar `perfiles_usuario`, inspeccionar su esquema real en la base de datos (no está versionado); hacer el upsert con las columnas que existan de verdad (`user_id`, `nombre`, `rol`, `activo`, …). Si el esquema no encaja, dejar el almacén FUERA de la fase 1 de sincronización y anotarlo en el informe final.
- La sincronización es **unidireccional** (maestro → módulos). Las pantallas de usuarios antiguas de cada módulo se mantienen funcionando, pero la pantalla nueva es la vía recomendada.
- Backfill inicial: volcar a `app_usuarios` los usuarios ya existentes en `adm_usuarios` y `tc_usuarios` (unificando por id de auth; si la misma persona está en ambas, una sola fila maestra + dos filas de acceso).

### RPCs (security definer, solo superadmin/admin de administracion)

- `app_guardar_usuario(...)` — crea/edita la fila maestra + sus accesos y dispara la sincronización. La creación del usuario de **Auth** (si el email no existe) se hace vía la Edge Function `admin-create-user` desde el frontend ANTES de llamar a la RPC.
- `app_eliminar_usuario(p_id)` — borrado con dos niveles: si el usuario tiene historial en algún módulo (gestiones, cobros…), **desactivar en todas partes**; si está limpio, borrar filas de perfil y opcionalmente el usuario de Auth (vía Edge Function). Nunca romper FKs.

### RLS

- `app_usuarios` / `app_usuario_modulos`: SELECT y escritura solo para superadmin o rol `admin` de administración (helper `app_es_admin()` security definer). Cada usuario puede leer su propia fila y sus propios accesos (para el gating de pantallas).

## Pantalla "Usuarios" (solo administradores)

- Nueva entrada **"Usuarios"** en el menú del módulo Administración (`config/navigation.ts`), icono `Users` o `Shield`, visible SOLO para rol `admin` (guard `RoleRoute roles={[]}` + comprobación explícita de admin, como `formas-pago` pero más restrictiva).
- Ruta `/administracion/usuarios`, página `src/modules/administracion/pages/Usuarios.tsx`, estilo idéntico al resto del módulo (tabla compacta, modales de `ui.tsx`).

### Listado

Columnas: **usuario** (login, con badge Superadmin si aplica), nombre completo, activo (píldora), y una columna "Accesos" con chips por módulo (p. ej. `Administración · admin`, `TyreControl · operador`; si tiene todos, un chip único "Todos los módulos"). Buscador por usuario/nombre. Botones por fila: **llave** (restablecer contraseña al momento, pide la nueva en un mini-modal), editar, eliminar (con confirmación y aviso de si se desactivará en vez de borrar).

### Modal crear/editar usuario

1. **Datos de acceso**: usuario (login, único), nombre completo, contraseña (al crear: campo obligatorio; al editar: botón "Restablecer"), email de recuperación (opcional, indicado como "solo administradores"), teléfono, activo, superadmin (checkbox con aviso), vínculo opcional con empleado de SEA Core (select de `sea_employees` activos).
2. **Accesos por módulo**: una tarjeta por módulo con:
   - Toggle de acceso (activado = tiene fila en `app_usuario_modulos`).
   - Select de **rol** con los roles propios de ese módulo.
   - **Checkboxes de pantallas** en rejilla (checkbox clásico cuadrado + etiqueta, NO píldoras): todas marcadas por defecto = `pantallas: null`; al desmarcar alguna se guarda la lista explícita de las marcadas. Las claves y etiquetas salen de un catálogo estático `MODULOS_APP` en `src/modules/administracion/config/modulosApp.ts` (módulo → roles → pantallas), para no importar código de otros módulos.
   - Para tyrecontrol con rol `cliente`: select de empresa (`tc_empresas`).
3. **Crear**: llamar a la Edge Function `admin-create-user` (revisar su contrato actual y adaptarse) con el email sintético derivado del username y la contraseña indicada; después `app_guardar_usuario`. Sin emails al usuario: el administrador le comunica usuario y contraseña de palabra.

### Aplicar las pantallas permitidas (gating)

- **Módulo Administración** (obligatorio en esta fase): `navigation.ts` y las rutas filtran también por `app_usuario_modulos.pantallas` — si la lista no es null y la pantalla no está, ni aparece en el menú ni deja entrar por URL. Cargar los accesos en `AdminAuthContext` junto al perfil.
- **Resto de módulos** (TyreControl, Almacén…): en esta fase basta con sincronizar rol/activo; el gating fino por pantalla en esos módulos se deja anotado como fase futura (no tocar su código salvo lo imprescindible).

## Entregables

1. Migración `administracion_fase11_usuarios_unificados.sql` (tablas con `username`, helpers, RPC `app_login_email`, triggers de sync, RPCs de guardado/borrado, RLS, backfill de `adm_usuarios`/`tc_usuarios` generando username a partir del nombre). Idempotente, para pegar en el SQL Editor.
2. **Pantalla de login unificada** usuario + contraseña (estética del módulo, como la maqueta aprobada), enlazada desde el panel; los logins antiguos por email siguen funcionando.
3. `pages/Usuarios.tsx` + `config/modulosApp.ts` + servicios en `data.ts` + entrada de menú y ruta (solo admin), con checkboxes de pantallas y botón llave de restablecer contraseña.
4. Gating por pantallas dentro del módulo Administración.
5. Actualizar `docs/administracion.md` (sección "Usuarios unificados": cómo dar de alta, cómo restablecer contraseñas, qué se sincroniza y qué no).
6. `npm run build` limpio, subir versión en `src/version.ts`, commit + push (deploy Render).

## Restricciones

- **No romper nada existente**: las tablas y pantallas de usuarios de cada módulo siguen funcionando; la sincronización solo añade/actualiza. Nada de borrar tablas ni renombrar enums.
- Inspeccionar el esquema real de `perfiles_usuario` en la BD (con la conexión `DATABASE_URL` del `.env`, solo lectura) antes de escribir su parte del trigger; si no encaja, excluir el almacén de la fase 1 y decirlo claramente.
- Leer las Edge Functions `admin-create-user`/`admin-update-user` antes de usarlas; no crear otras nuevas si sirven las existentes.
- Migración idempotente, español en toda la interfaz, mismo estilo visual del módulo.
- Trabajar por fases y compilar antes de dar por cerrada cada una.
