# PROMPT — Los usuarios de TyreControl son los de Mobilink Core (misma contraseña)

> Documento de análisis y propuesta. **No se ha programado nada.** Hay preguntas
> abiertas al final; se implementa cuando estén contestadas.

Petición: *"Los usuarios deberían ser los mismos para TyreControl que los de
Core y tener la misma contraseña como lo hacemos."*

---

## 1. Lo que hay hoy (verificado en el repo)

### 1.1 Mobilink Core: usuario + PIN, tabla maestra `app_usuarios`

- Pantalla **Administración → Usuarios** (`src/modules/administracion/pages/UsuariosApp.tsx`).
- Tabla maestra `app_usuarios` (`id` = `auth.users.id`, `username` único,
  `nombre`, `email_recuperacion`, `telefono`, `activo`, `es_superadmin`,
  `employee_id` → `sea_employees`) y tabla de accesos `app_usuario_modulos`
  (`user_id`, `modulo`, `rol`, `pantallas`, `empresa_id`), una fila por módulo
  (`administracion`, `tyrecontrol`, `almacen`, `sea-core`, `toolcontrol`,
  `safety`, `presencia`).
- **Alta**: `POST /api/administracion/usuarios/crear-auth` crea el usuario de
  Supabase Auth con **email sintético** `<username>@usuarios.sea` y la
  contraseña que teclea el administrador. Luego `app_guardar_usuario` (RPC)
  guarda la ficha y los accesos.
- **Contraseña**: el administrador teclea un PIN corto (mínimo 4). El panel
  le añade **siempre** el sufijo interno `#SEA` antes de mandarlo a Supabase
  (`claveInterna()` en `src/modules/administracion/services/authClave.ts`),
  porque Supabase exige 6 caracteres. Es decir, en Supabase Auth la
  contraseña real es `1234#SEA` y el usuario solo conoce `1234`.
- **Login del panel** (`src/pages/AccesoPage.tsx`): usuario + contraseña →
  RPC `app_login_email(username)` devuelve el email sintético →
  `signInWithPassword(email, claveInterna(pin))`.
- **Restablecer**: `POST /api/administracion/usuarios/reset-password`, misma
  regla del sufijo.
- **Sincronización maestra → módulos** (migración
  `administracion_fase11_usuarios_unificados.sql`): triggers sobre
  `app_usuarios` y `app_usuario_modulos` llaman a `app_sync_acceso(user, modulo)`,
  que para `tyrecontrol` hace *upsert* en `tc_usuarios` con `empresa_id =
  coalesce(acceso.empresa_id, primera tc_empresas)`, `rol`, `es_superadmin`,
  `activo` y `acceso_panel = true`. **No toca `acceso_apk` ni
  `tc_operador_empresas`.**
- Solo puede gestionar usuarios quien es `app_usuarios.es_superadmin` o
  `adm_usuarios.rol = 'admin'` (`verificarAdminApp`). Un administrador de
  TyreControl que no sea de Administración **no** puede.

### 1.2 TyreControl: su propio alta, su propio login, PIN sin sufijo

- Pantalla **TyreControl → Usuarios** (`src/modules/tyrecontrol/pages/Usuarios.tsx`)
  con checkboxes Panel / APK, campo "PIN de la APK" solo si APK, y el texto
  "Sin contraseña: entra con enlace por email".
- **Alta**: `POST /api/tyrecontrol/usuarios` (`server/index.ts`, alrededor de
  la línea 16552) crea el usuario de Auth con el **email real** que se teclea
  y la contraseña **tal cual** (PIN de 4 sin sufijo; si no hay PIN, una
  aleatoria) e inserta **solo** `tc_usuarios`. **No pasa por `app_usuarios`**:
  estos usuarios no existen para Core.
- **Login del panel de TyreControl** (`src/modules/tyrecontrol/pages/Login.tsx`):
  enlace mágico por email (`signInWithOtp`). Distinto del login de Core.
- **Login de la APK** (`login_screen.dart` + `POST /api/tyrecontrol/login-operario`):
  nombre + **PIN de 4 dígitos**. El servidor busca en `tc_usuarios` por
  `nombre ilike` con `acceso_apk = true`, rellena `tc_operador_empresas` y
  devuelve el email; la APK hace `signInWithPassword(email, PIN)` **sin
  sufijo**. Por tanto la contraseña de Supabase de un técnico de la APK es
  literalmente `1234`.
- **Restablecer**: `POST /api/tyrecontrol/usuarios/:id/password`, mínimo 4,
  sin sufijo.
- Todas las políticas RLS de TyreControl (`tc_is_superadmin()`, `tc_is_admin()`,
  `tc_auth_empresa_id()`, `tc_operador_ve_empresa()`, `tc_puede_ver_empresa()`)
  y el guardia `requireTyreControlAdmin` del servidor leen **`tc_usuarios`**.
  `tc_usuarios.empresa_id` es `NOT NULL`.

### 1.3 Resultado: dos mundos que no coinciden

| | Core | TyreControl (alta propia) | TyreControl APK |
|---|---|---|---|
| Identificador | `username` | email real | `nombre` de `tc_usuarios` |
| Email en Auth | `<username>@usuarios.sea` | el real | el que tenga la ficha |
| Contraseña en Auth | `PIN#SEA` | PIN tal cual | PIN tal cual |
| Ficha maestra | `app_usuarios` | **no existe** | **no existe** |
| Quién lo da de alta | admin de Administración | admin de TyreControl | admin de TyreControl |

Lo que se ve en las capturas encaja con esto: en TyreControl hay 6 usuarios
mezclados de los tres orígenes. `jordi@usuarios.sea` (Jordi Cruset, Admin)
viene de Core; `apk-anthoni@seatyrecheck.app` y `apk-david@seatyrecheck.app`
son técnicos dados de alta desde TyreControl con email inventado;
`jcruset@gmail.com` y `jordi.cruset@gruposoledad.net` son altas antiguas por
email real. **Jordi tiene tres usuarios de Auth distintos**, y un técnico de
Core con PIN `1234` no puede entrar en la APK porque su contraseña real es
`1234#SEA`.

### 1.4 Otras APKs (para no romperlas)

Assist (`flutter_app`) y Taller (`taller_app`) entran por
`/api/roadside-operator/login` y `/api/taller-operator/login` con
`sea_employees` (PIN o código de operario), sin Supabase Auth. Almacén entra
por `/api/almacen/login-operario` con `perfiles_usuario.codigo_operario` y
reescribe la contraseña de Auth con el PIN en cada login. **Este prompt no las
toca**; se citan para dejar claro que "la misma contraseña" hoy solo es
compartible entre el panel de Core y TyreControl.

---

## 2. Propuesta (v1)

Principio: **`app_usuarios` es la única lista de usuarios. TyreControl no da
de alta usuarios; solo lee su espejo `tc_usuarios`, que se rellena solo.** La
contraseña es una y la misma: el PIN que teclea el administrador en Core,
guardado en Supabase como `PIN#SEA`, y **todas las puertas** (panel de Core,
panel de TyreControl y APK de TyreControl) aplican el mismo sufijo.

### 2.1 Base de datos (`supabase/migrations/administracion_fase12_tyrecontrol_desde_core.sql`)

1. `app_usuario_modulos` para `tyrecontrol` guarda además **`acceso_apk`**
   (boolean, default false). `acceso_panel` se deduce: si tiene el módulo,
   tiene panel.
2. `app_sync_acceso(..., 'tyrecontrol')` pasa a copiar también `acceso_apk`,
   y si el rol es `operador` deja `empresas_manual = false` para que el login
   de la APK siga rellenando `tc_operador_empresas` como hoy. Si la fila de
   `app_usuario_modulos` se borra o `activo = false`, el espejo queda
   `activo = false` y `acceso_apk = false` (no se borra: hay operaciones e
   intervenciones que apuntan al técnico).
3. `tc_usuarios.email` se sigue rellenando (con el email sintético) porque el
   login de la APK lo devuelve para hacer `signInWithPassword`.
4. **Backfill de los usuarios que solo existen en `tc_usuarios`**: se crea su
   `app_usuarios` + `app_usuario_modulos('tyrecontrol', rol, empresa_id,
   acceso_apk)` con `username` = parte local del email limpiada
   (`apk-anthoni` → `anthoni`). **No se toca su contraseña de Auth ni su
   email**: se marcan en una lista para que un administrador les ponga PIN
   desde Core (botón llave), y hasta entonces la APK los sigue aceptando
   con la contraseña antigua (ver 2.3). Las **duplicidades** (Jordi ×3) no
   se fusionan automáticamente: se listan en la salida de la migración y se
   deciden a mano (pregunta 3).
5. Las políticas RLS y las funciones `tc_*` **no cambian**: siguen leyendo
   `tc_usuarios`, que ahora es un espejo fiable. No se amplían permisos.

### 2.2 Servidor (`server/index.ts`)

1. `POST /api/tyrecontrol/usuarios` (alta) y `DELETE /api/tyrecontrol/usuarios/:id`
   **se retiran** (devuelven 410 con un mensaje que remite a Administración →
   Usuarios). `PATCH` de la ficha se mantiene solo para lo que es de
   TyreControl y no está en Core: `empresas_manual` y las empresas del
   operador. Rol, activo, empresa y acceso APK se editan en Core.
2. `POST /api/tyrecontrol/usuarios/:id/password` se retira igualmente: la
   contraseña se cambia en Core con la regla del sufijo. Si se mantiene por
   comodidad, tiene que aplicar **el mismo sufijo** que Core; no puede haber
   dos formatos.
3. `POST /api/tyrecontrol/login-operario` sigue igual (busca por nombre en
   `tc_usuarios` con `acceso_apk`). Se añade a la respuesta `formato:
   "core"` cuando el usuario existe en `app_usuarios`, para que la APK sepa
   si aplicar el sufijo (ver 2.3).
4. `verificarAdminApp` **no se amplía**: gestionar usuarios sigue siendo cosa
   de Administración. Si Jordi quiere que un administrador de TyreControl
   pueda dar de alta técnicos, hay que decirlo (pregunta 4); la forma limpia
   sería darle el módulo `administracion` con la pantalla `usuarios` y nada
   más, no abrir `verificarAdminApp`.

### 2.3 APK de TyreControl

- La pantalla de PIN se queda como está (nombre + 4 dígitos).
- `signInOperario` prueba `signInWithPassword(email, pin + "#SEA")` si el
  servidor dice `formato: "core"`, y si no, el PIN tal cual (usuarios
  antiguos aún sin PIN puesto desde Core). Cuando el administrador le ponga
  PIN desde Core, `formato` pasa a `core` y el usuario sigue entrando con
  sus 4 dígitos sin enterarse. El sufijo es una constante de la APK igual
  que lo es del panel; **no es un secreto** (solo rellena longitud), pero se
  documenta en el mismo sitio que `claveInterna()`.
- El nombre que se teclea en la APK es `tc_usuarios.nombre`, que el espejo
  copia de `app_usuarios.nombre`. Se recomienda que el `login-operario`
  acepte también el `username` (más corto y único), buscando primero por
  `username` en `app_usuarios` y luego por `nombre`.

### 2.4 Panel de TyreControl

- **Usuarios** pasa a ser de solo lectura con un botón "Gestionar en
  Administración → Usuarios" (mismo patrón que se quiere para toda la casa).
  Se conserva la edición de "empresas del operador" (`empresas_manual` y
  `tc_operador_empresas`), que es propia de TyreControl.
- **Login** (`Login.tsx`, enlace mágico) se sustituye por un enlace a
  `/acceso` (el login unificado de Core). El enlace mágico deja de ofrecerse:
  con email sintético no hay a quién mandarlo.
- En Core, el bloque `tyrecontrol` del modal de usuario gana el checkbox
  **"APK"** (además del rol y la empresa que ya tiene).

### 2.5 Lo que NO se hace en v1

- No se fusionan cuentas duplicadas automáticamente.
- No se tocan Assist, Taller, Almacén ni `sea_employees`.
- No se rediseña el modelo de roles de TyreControl (`administrador`,
  `operador`, `cliente`) ni las RLS.
- No se guarda ninguna contraseña en claro en ninguna tabla.

---

## 3. Entregables y pruebas

1. Migración `administracion_fase12_tyrecontrol_desde_core.sql`, idempotente,
   con banco `supabase/pruebas/usuarios_tyrecontrol_desde_core.sql` (alta en
   Core → aparece en `tc_usuarios` con `acceso_apk`; quitar módulo →
   `activo=false`; backfill de un `tc_usuarios` huérfano; no se amplía
   `tc_neu_write` ni ninguna política).
2. Servidor: rutas retiradas, `login-operario` con `formato`, test en
   `server/rutasTyreControl.test.ts` o nuevo.
3. Panel: modal de Core con "APK"; Usuarios de TyreControl en solo lectura;
   `Login.tsx` redirigiendo a `/acceso`.
4. APK: `signInOperario` con sufijo condicional. `flutter analyze`, `flutter
   test`, y APK compilada por la CI antes de decir que funciona.
5. `docs/` con la nota de la regla del sufijo compartida por panel y APK.

---

## 4. Preguntas antes de programar

1. **Contraseña = PIN de Core con sufijo `#SEA`** en todas las puertas. ¿Vale,
   o prefieres quitar el sufijo en todas partes bajando la longitud mínima
   de Supabase Auth a 4? (Lo segundo obliga a cambiar la contraseña de todos
   los usuarios de Core; lo primero solo la de los técnicos antiguos de
   TyreControl, y de forma transparente.)
2. **¿Se retira el alta de usuarios en TyreControl** (queda solo Core) o
   prefieres mantener las dos pantallas y que la de TyreControl escriba en
   `app_usuarios`? Propuesta: retirarla.
3. **Duplicados de Jordi** (`jordi@usuarios.sea`, `jcruset@gmail.com`,
   `jordi.cruset@gruposoledad.net`): ¿cuál se queda? Propuesta: el de Core
   (`jordi`), y las otras dos fichas se desactivan reasignando sus
   operaciones al que queda solo si hace falta.
4. **¿Quién gestiona usuarios?** Hoy solo Administración. ¿Un administrador
   de TyreControl tiene que poder dar de alta técnicos? Propuesta: no en v1.
5. **Nombre de entrada en la APK**: ¿se entra con el `username` de Core
   (`anthoni`) o con el nombre completo como hasta ahora? Propuesta: aceptar
   los dos.
