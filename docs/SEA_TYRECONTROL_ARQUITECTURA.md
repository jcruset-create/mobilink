# SEA TyreControl — Gestión de Neumáticos de Flota (SaaS multiempresa)

> Documento de arquitectura y plan. **Fase 1: NO se programa nada de vehículos/neumáticos/RFID/BLE/IA/Webfleet.** Solo auth, usuarios, roles, layout, navegación y protección de rutas.

## 0. Contexto: qué reutilizamos de lo ya construido

La plataforma ya tiene módulos sobre **Supabase** con patrones que reaprovechamos:

| Ya existe | Reutilización en TyreControl |
|---|---|
| `@supabase/supabase-js` + `VITE_SUPABASE_URL/ANON_KEY` | Mismo proyecto Supabase, misma Auth (SSO entre módulos) |
| `RequireAuth` / `RequireRole` (almacen-neumaticos) | Patrón de guards de ruta |
| `usePermisosAlmacen` (perfil.rol admin/responsable/operario) | Patrón de hook de permisos por usuario |
| `sea-core`: Empresas, Empleados, Centros | Multiempresa: `empresas` ya modelada |
| `SeaHub` (`/sea`) | Punto de entrada / hub de módulos |
| Render (deploy actual) | Mismo pipeline `tsc -b && vite build` |
| Tailwind ya configurado | Reutilizable; añadimos shadcn/ui encima |

**Decisión clave:** un único proyecto Supabase y una única identidad (Supabase Auth). El resto de módulos siguen igual; TyreControl añade sus tablas con prefijo/esquema propio y sus RLS.

**Deuda técnica a corregir de paso:** hoy hay un `supabase.ts` **duplicado** en cada módulo. Creamos **un cliente compartido** (`src/lib/supabase.ts`) y un **AuthContext** único, y el nuevo módulo lo usa. Los módulos viejos se pueden migrar después sin prisa.

---

## 1. Arquitectura general

```
┌──────────────────────────────────────────────────────────┐
│                   Panel Web (React + Vite)                 │
│   Admin · Cliente (solo lectura) — Render (estático)       │
└───────────────┬───────────────────────────┬───────────────┘
                │                           │
                │  Supabase JS (Auth + RLS) │
                ▼                           ▼
┌──────────────────────────────────────────────────────────┐
│                        SUPABASE                            │
│  Auth · PostgreSQL (RLS) · Storage · Edge Functions        │
└───────────────┬───────────────────────────┬───────────────┘
                │                           │
                ▼                           ▼
┌───────────────────────────┐   ┌──────────────────────────┐
│  APK Operador (Capacitor)  │   │  Integraciones futuras    │
│  React + plugins BLE/RFID  │   │  Webfleet · IA/OCR (Edge) │
└───────────────────────────┘   └──────────────────────────┘
```

**Justificación de decisiones:**

1. **Supabase como backend (sin servidor Node propio para este módulo).** El módulo de taller usa Express+Postgres porque es tiempo-real/lógica compleja; TyreControl es CRUD multiempresa con permisos → RLS de Postgres hace el trabajo pesado de seguridad **en la base de datos**, no en el cliente. Menos código, menos superficie de error.
2. **RLS como frontera de seguridad real.** La APK y el panel usan la `anon key` (pública); lo que protege los datos es la RLS por `empresa_id`. Nunca se confía en el frontend.
3. **Capacitor para la APK (no Flutter).** El APK actual del taller es Flutter (otro lenguaje). Para TyreControl usamos **Capacitor** porque comparte el **mismo código React/TS** del panel → un solo equipo, un solo stack, reutilización de tipos, servicios y componentes. Los plugins BLE/RFID/cámara existen para Capacitor.
4. **TanStack Query** para todo acceso a datos: caché, reintentos, invalidación, offline-friendly (clave para la APK de campo).
5. **shadcn/ui + Tailwind**: componentes accesibles, sin dependencia de librería pesada, copiables y editables.
6. **Feature-based structure**: cada dominio (auth, usuarios, empresas…) encapsula sus componentes, hooks, servicios y tipos → escala sin convertirse en espagueti.
7. **Edge Functions** para operaciones privilegiadas: crear usuarios (necesita `service_role`, jamás en el cliente), y más adelante OCR/visión.

---

## 2. Estructura de carpetas (feature-based)

```
src/
├─ lib/
│  ├─ supabase.ts            # cliente único (compartido con otros módulos)
│  ├─ queryClient.ts         # TanStack Query config
│  └─ utils.ts               # cn(), helpers
├─ contexts/
│  └─ AuthContext.tsx        # sesión + perfil + empresa + rol
├─ types/
│  ├─ database.ts            # tipos generados de Supabase (supabase gen types)
│  ├─ auth.ts                # Rol, Perfil, PermisoCliente
│  └─ index.ts
├─ services/                 # capa de acceso a datos (Supabase)
│  ├─ auth.service.ts
│  ├─ usuarios.service.ts
│  ├─ empresas.service.ts
│  └─ permisos.service.ts
├─ hooks/
│  ├─ useAuth.ts
│  ├─ useUsuarios.ts         # TanStack Query wrappers
│  ├─ useEmpresas.ts
│  └─ usePermisos.ts
├─ components/
│  ├─ ui/                    # shadcn/ui (button, input, dialog, table…)
│  └─ common/                # DataTable, PageHeader, ConfirmDialog, EmptyState
├─ layouts/
│  ├─ AppLayout.tsx          # sidebar + topbar + <Outlet/>
│  └─ AuthLayout.tsx         # centrado para login
├─ routes/
│  ├─ AppRoutes.tsx          # definición de rutas
│  ├─ ProtectedRoute.tsx     # requiere sesión
│  └─ RoleRoute.tsx          # requiere rol/permiso
├─ features/
│  ├─ auth/                  # Login, recuperar, cambio password
│  ├─ dashboard/
│  ├─ usuarios/
│  ├─ empresas/
│  ├─ perfil/
│  └─ configuracion/
├─ pages/                    # ensambla features en páginas de ruta
└─ config/
   └─ navigation.ts          # menú lateral declarado por rol/permiso
```

> En el repo actual esto vive bajo `src/modules/tyrecontrol/` (patrón de los otros módulos) o como app nueva; se decide en Fase 0.

---

## 3. Modelo de datos (Fase 1)

Diseñado **multiempresa** desde el minuto uno. Toda tabla de negocio llevará `empresa_id`.

```sql
-- ── ENUM de roles ────────────────────────────────────────────
create type rol_usuario as enum ('administrador', 'operador', 'cliente');

-- ── EMPRESAS (tenant) ────────────────────────────────────────
create table empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  cif         text unique,
  telefono    text,
  email       text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── USUARIOS (perfil ligado a auth.users) ────────────────────
create table usuarios (
  id           uuid primary key references auth.users(id) on delete cascade,
  empresa_id   uuid not null references empresas(id) on delete restrict,
  nombre       text not null,
  email        text not null,
  rol          rol_usuario not null default 'cliente',
  activo       boolean not null default true,
  acceso_apk   boolean not null default false,
  acceso_panel boolean not null default true,
  created_at   timestamptz not null default now()
);
create index on usuarios (empresa_id);

-- ── PERMISOS DE CLIENTE (granular, solo lectura/exportación) ──
create table permisos_cliente (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  pantalla      text not null,            -- 'vehiculos','inspecciones','alertas','informes'...
  puede_ver     boolean not null default false,
  puede_exportar boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (usuario_id, pantalla)
);
create index on permisos_cliente (usuario_id);
```

**Justificación:**
- `usuarios.id` = `auth.users.id`: 1 fila de perfil por cuenta de Auth; no duplicamos identidad.
- `rol` como `enum`: integridad a nivel BD.
- `acceso_apk` / `acceso_panel`: separa dónde puede entrar cada quién (el operador solo APK; el cliente solo panel).
- `permisos_cliente`: control fino por pantalla para el rol *cliente* (solo lectura/exportación). El *administrador* no necesita filas aquí (acceso total por rol).

### Funciones helper (evitan recursión en RLS)

```sql
-- empresa del usuario conectado (SECURITY DEFINER: no dispara RLS de 'usuarios')
create or replace function auth_empresa_id()
returns uuid language sql stable security definer set search_path = public as $$
  select empresa_id from usuarios where id = auth.uid()
$$;

create or replace function auth_rol()
returns rol_usuario language sql stable security definer set search_path = public as $$
  select rol from usuarios where id = auth.uid()
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'administrador' from usuarios where id = auth.uid()), false)
$$;
```

### Trigger: crear perfil al registrarse (o vía Edge Function)

En SaaS multiempresa el alta la hace un **administrador** (no autoservicio), así que el perfil se crea desde una **Edge Function** con `service_role` (crea el `auth.user` + fila en `usuarios`). El trigger `on auth.users` queda como red de seguridad.

---

## 4. Row Level Security (RLS)

```sql
alter table empresas          enable row level security;
alter table usuarios          enable row level security;
alter table permisos_cliente  enable row level security;

-- EMPRESAS: admin ve/gestiona su empresa; (super-admin global se trata aparte)
create policy empresas_select on empresas for select
  using ( id = auth_empresa_id() );
create policy empresas_admin_all on empresas for all
  using ( is_admin() and id = auth_empresa_id() )
  with check ( is_admin() and id = auth_empresa_id() );

-- USUARIOS: cada uno ve su empresa; solo admin escribe
create policy usuarios_select on usuarios for select
  using ( empresa_id = auth_empresa_id() );
create policy usuarios_admin_write on usuarios for all
  using ( is_admin() and empresa_id = auth_empresa_id() )
  with check ( is_admin() and empresa_id = auth_empresa_id() );

-- PERMISOS_CLIENTE: admin gestiona los de su empresa; el propio cliente ve los suyos
create policy permisos_admin_all on permisos_cliente for all
  using ( is_admin() and exists (
    select 1 from usuarios u where u.id = permisos_cliente.usuario_id
      and u.empresa_id = auth_empresa_id() ) )
  with check ( is_admin() and exists (
    select 1 from usuarios u where u.id = permisos_cliente.usuario_id
      and u.empresa_id = auth_empresa_id() ) );
create policy permisos_self_select on permisos_cliente for select
  using ( usuario_id = auth.uid() );
```

**Principio:** *aislamiento por tenant* (`empresa_id`) + *principio de mínimo privilegio*. Un cliente jamás lee datos de otra empresa aunque manipule el frontend, porque la BD lo bloquea. Un administrador es admin **de su empresa**, no global (el super-admin de plataforma se modela luego con una tabla `plataforma_admins` o un claim JWT).

---

## 5. Autenticación y sesión

- **Supabase Auth** (email + password en Fase 1; magic link opcional).
- `AuthContext` carga: `session` (Supabase) → consulta `usuarios` del `auth.uid()` → expone `{ user, perfil, empresa, rol, permisos, loading }`.
- Se cachea con TanStack Query; `onAuthStateChange` refresca.
- **Separación panel/APK:** al iniciar sesión se comprueba `acceso_panel` (web) o `acceso_apk` (Capacitor). Si no tiene acceso a ese frontend → logout con aviso.

```
AuthContext
 ├─ supabase.auth.getSession()
 ├─ query 'usuarios' by auth.uid()  →  perfil, empresa_id, rol, acceso_*
 └─ query 'permisos_cliente' (solo rol cliente)
```

---

## 6. Sistema de roles y permisos (frontend)

```ts
// types/auth.ts
export type Rol = 'administrador' | 'operador' | 'cliente';

// config/navigation.ts  — menú declarado, filtrado por rol/permiso
export const NAV: NavItem[] = [
  { key:'dashboard',    label:'Dashboard',     icon:LayoutDashboard, roles:['administrador','cliente'] },
  { key:'usuarios',     label:'Usuarios',      icon:Users,           roles:['administrador'] },
  { key:'empresas',     label:'Empresas',      icon:Building2,       roles:['administrador'] },
  { key:'configuracion',label:'Configuración', icon:Settings,        roles:['administrador'] },
  { key:'perfil',       label:'Perfil',        icon:User,            roles:['administrador','cliente'] },
];
```

- `ProtectedRoute`: exige sesión.
- `RoleRoute roles={[...]}`: exige rol.
- Para el **cliente**, además, cada pantalla comprueba `permisos_cliente.puede_ver` (y `puede_exportar` para botones de exportar).
- El **operador** no entra al panel web (se bloquea por `acceso_panel=false`); su interfaz es la APK.

Doble capa: **UI** (oculta lo no permitido, UX) + **RLS** (seguridad real). Nunca solo UI.

---

## 7. Layout y navegación

- `AuthLayout`: pantalla centrada para login/recuperación.
- `AppLayout`: **sidebar** (menú filtrado por rol/permiso) + **topbar** (empresa activa, nombre usuario, rol, cerrar sesión) + `<Outlet/>`.
- Responsive: sidebar colapsable en móvil/tablet (mismo layout sirve para web y para la APK en Fase futura).
- Consistente con el estilo actual (Tailwind) + shadcn/ui.

---

## 8. Pantallas de Fase 1

| Pantalla | Rol | Contenido |
|---|---|---|
| Login | público | email/password, recuperar contraseña |
| Dashboard | admin, cliente | tarjetas resumen (placeholders en Fase 1) |
| Usuarios | admin | CRUD usuarios de la empresa + asignar rol, acceso_apk/panel, permisos_cliente |
| Empresas | admin | datos de la empresa (multiempresa: alta futura de tenants) |
| Perfil | todos (panel) | datos propios, cambio de contraseña |
| Configuración | admin | ajustes de empresa/plataforma |

---

## 9. Integraciones futuras (arquitectura preparada, sin implementar)

- **Bluetooth / RFID:** en la APK (Capacitor) vía plugins; capa `services/devices/` con interfaz abstracta (`TireReader`) para no acoplar. Los datos leídos entran por los mismos servicios Supabase.
- **Webfleet:** Edge Function que hace de proxy (guarda credenciales en secretos de Supabase), sincroniza vehículos/posiciones a tablas propias. Igual que ya se hace con Webfleet en el taller.
- **IA / OCR / visión:** Edge Function que recibe imagen (Storage) → llama al modelo → escribe resultado. El frontend solo sube a Storage y consulta el resultado.

Todas comparten: **RLS por empresa**, **Storage con políticas por empresa**, **Edge Functions con `service_role`**.

---

## 10. Plan de desarrollo por fases

**Fase 0 — Cimientos (setup)**
- Cliente Supabase único + AuthContext + QueryClient.
- shadcn/ui init, tema, componentes base (`DataTable`, `PageHeader`, `ConfirmDialog`).
- Estructura de carpetas.

**Fase 1 — Auth + Usuarios + Roles (ESTE ENCARGO)**
- SQL: `empresas`, `usuarios`, `permisos_cliente`, enums, funciones, RLS.
- Edge Function `crear-usuario` (service_role).
- Login, guards (`ProtectedRoute`/`RoleRoute`), separación panel/APK.
- Layout + sidebar por rol.
- Pantallas: Login, Dashboard (placeholder), Usuarios (CRUD), Empresas, Perfil, Configuración.
- Deploy en Render.

**Fase 2 — Núcleo de flota:** vehículos, ejes, posiciones, clientes.
**Fase 3 — Neumáticos:** stock, marcas/medidas, ciclo de vida (nuevo→recauchutado→baja), historial por posición.
**Fase 4 — Inspecciones/Operaciones:** APK Capacitor operador, offline-first, fotos a Storage.
**Fase 5 — RFID + Bluetooth** (lectura profundidad/presión).
**Fase 6 — Webfleet** (sincronización de flota).
**Fase 7 — IA/OCR** (lectura de matrícula/DOT, visión de desgaste).
**Fase 8 — Alertas, informes, panel cliente** (KPIs, exportaciones).

---

## DECISIONES CONFIRMADAS (bloqueadas para Fase 1)

1. **Ubicación:** módulo dentro de este repo → `src/modules/tyrecontrol/`, ruta `/tyrecontrol/*`, reutilizando **cliente Supabase único**, AuthContext y componentes. Se registra en `App.tsx` como los demás módulos.
2. **Super-admin global de SEA:** SÍ. Existe un administrador de plataforma que gestiona **todas** las empresas, además del *administrador* por empresa. Se modela con `usuarios.es_superadmin` + helper `is_superadmin()`; la RLS le da acceso global.
3. **Altas de usuarios:** solo por administrador vía **Edge Function `crear-usuario`** (`service_role`). Sin auto-registro público.
4. **UI:** seguimos **solo con Tailwind** (sin shadcn/ui). `components/ui/` = primitivos propios en Tailwind (Button, Input, Select, Dialog, Table…), consistentes con el resto del repo.
5. **APK operador:** **Flutter** (igual que el `flutter_app/` actual), **no** Capacitor. El operador de neumáticos será una app Flutter que habla con Supabase (`supabase_flutter`). El panel web sigue en React.

### Ajustes derivados de las decisiones

**Modelo de datos — añadir super-admin:**
```sql
alter table usuarios add column es_superadmin boolean not null default false;

create or replace function is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_superadmin from usuarios where id = auth.uid()), false)
$$;
```

**RLS — el super-admin ve/gestiona todas las empresas** (se añade `is_superadmin() or …` a cada política):
```sql
-- EMPRESAS
create policy empresas_select on empresas for select
  using ( is_superadmin() or id = auth_empresa_id() );
create policy empresas_write on empresas for all
  using ( is_superadmin() or (is_admin() and id = auth_empresa_id()) )
  with check ( is_superadmin() or (is_admin() and id = auth_empresa_id()) );

-- USUARIOS
create policy usuarios_select on usuarios for select
  using ( is_superadmin() or empresa_id = auth_empresa_id() );
create policy usuarios_write on usuarios for all
  using ( is_superadmin() or (is_admin() and empresa_id = auth_empresa_id()) )
  with check ( is_superadmin() or (is_admin() and empresa_id = auth_empresa_id()) );

-- PERMISOS_CLIENTE: idéntico patrón, anteponiendo is_superadmin()
```
Reglas: *super-admin* = global; *administrador* = admin de su empresa; *cliente* = solo lectura de su empresa; *operador* = solo APK. El super-admin, además, puede **crear empresas** y el primer administrador de cada una.

**Frontend — jerarquía de acceso:**
- `es_superadmin` → ve un selector de empresa y todas las pantallas de admin.
- Rol `administrador` → su empresa.
- Menú lateral: añade entrada **"Empresas"** solo visible para super-admin (alta/edición de tenants); el admin normal solo ve la ficha de SU empresa.

**APK Flutter (Fase 4+, preparación):**
- App Flutter separada (o pantalla nueva en el flujo del `flutter_app` actual) usando `supabase_flutter` para Auth + datos, con RLS por empresa.
- Login por `acceso_apk`; offline con almacenamiento local (Hive/Isar) + cola de sincronización, igual que ya hicimos en el APK del taller.

## Siguiente entrega (cuando digas "programa Fase 1")
1. Migración SQL definitiva (tablas + enum + funciones + RLS + trigger) lista para pegar en Supabase.
2. Edge Function `crear-usuario`.
3. Esqueleto del módulo `src/modules/tyrecontrol/`: cliente Supabase compartido, AuthContext, rutas protegidas, layout + sidebar por rol, y pantallas Login / Dashboard / Usuarios / Empresas / Perfil / Configuración (Usuarios y Empresas funcionales; el resto con estructura).
4. Registro de rutas en `App.tsx`.
```
