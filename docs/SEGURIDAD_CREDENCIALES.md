# Credenciales — estado y deuda pendiente

Registro de los arreglos de credenciales y de lo que queda abierto.
Última actualización: 28-07-2026.

---

## Arreglado

### 1. Presencia registraba como válido el primer PIN que se tecleara

**Qué pasaba.** `pres_login` (`supabase/migrations/007_presencia_pin.sql`) asignaba el PIN al
empleado si aún no tenía uno (`pin_hash IS NULL`). Como la lista de empleados del selector de
login es pública (`GET /api/presencia-operator/employees`), cualquiera podía abrir la app,
elegir a un compañero sin PIN y quedarse con su identidad. Afectaba a Presencia y a Safety
(que usa los mismos endpoints). Los fichajes son registro de jornada laboral: ese dato no
sostenía una discusión con un empleado ni una inspección.

**Qué se ha hecho.**
- `supabase/migrations/008_presencia_pin_seguro.sql`: `pres_login` solo verifica; sin
  `pin_hash` no hay acceso. Nueva función `sea_set_employee_pin`, ejecutable solo por
  `service_role`.
- `PUT /api/sea-core/employees/:id/pin` y `GET /api/sea-core/employees/pin-status`
  (`server/index.ts`), protegidos con `verificarAdminApp`.
- Tarjeta "PIN de las apps de operario" en la ficha de empleado
  (`src/modules/sea-core/pages/EmpleadoDetalle.tsx`): asignar, cambiar y revocar. El PIN nunca
  se muestra, solo se sustituye.

> **Orden de despliegue.** Primero el backend, después la migración SQL. Al revés, los
> empleados sin PIN se quedan sin acceso y sin pantalla donde asignárselo. Tras ejecutarla,
> usa la consulta del final del script para ver quién se queda sin acceso.

### 2. PIN del portal de taller guardado en claro

**Qué pasaba.** `techs."workshopPin"` se guardaba y comparaba en texto plano
(`SELECT ... WHERE name = $1 AND "workshopPin" = $2`). Quien viera la base los veía todos.

**Qué se ha hecho.** Nuevas columnas `workshopPinHash` / `workshopPinSalt` (PBKDF2, ver
`server/core/credentials.ts`). La verificación acepta todavía los PIN heredados en claro y, en
el primer login correcto, los re-guarda hasheados y borra el valor en claro: **nadie se queda
fuera y el dato desaparece solo**. El endpoint de asignación guarda ya solo el hash. La UI solo
asigna el PIN, nunca lo mostraba, así que ninguna pantalla se ve afectada.

### 3. Algoritmo de hasheo unificado

`server/core/credentials.ts` centraliza el PBKDF2 que ya usaba Connect Lite. `lite.ts` delega
en él conservando sus exports. Hay un test (`credentials.test.ts`) que **falla si el algoritmo
cambia**, porque eso invalidaría los PIN ya guardados de `connect_lite_users`.

---

## Pendiente — requiere decisión

### A. La contraseña de `app_users` es el token de sesión

**Por qué no se ha arreglado con los otros.** No es solo que la contraseña esté en claro dentro
del JSONB: es que **funciona como token de sesión**. En `POST /api/login-sso` el servidor
devuelve `adminToken: panelUser.password`, el frontend lo guarda y lo manda en cada petición
como `x-admin-token`, y el rol se resuelve buscando al usuario *por contraseña*
(`findDbUserByPassword(token)`). Hashear la contraseña rompe el flujo entero, porque el valor
en claro tiene que poder entregarse en el login.

**Qué haría falta:** separar credencial de sesión — hashear la contraseña e introducir tokens
de sesión propios (aleatorios, con caducidad y revocación). Toca todo el camino de auth del
panel y el `localStorage` del frontend. Es un trabajo acotado pero **no de horas**, y hecho a
medias deja a todo el mundo fuera del panel.

**Mitigación mientras tanto:** las contraseñas del panel no deben reutilizarse en ningún otro
sitio, porque quien tenga acceso a la base las ve.

### B. `techs."roadsideOperatorCode"` hace de código y de PIN a la vez

Se compara en claro para el login de las APKs de asistencias (`flutter_app`, `taller_app`),
pero **también es un identificador que las pantallas de administración listan y muestran**
(`GET /api/roadside-operator/techs`, asignación desde el panel). Hashearlo rompería esas
pantallas. El arreglo correcto es separar las dos funciones: un código de operario visible y
un PIN aparte hasheado — un cambio de diseño, no un parche.

### C. Cinco semánticas de PIN distintas

Sigue habiendo, según la app: `crypt()` de pgcrypto (`sea_employees`), PBKDF2 con salt
(`connect_lite_users`, ahora también `techs`), PIN que es la contraseña de Supabase Auth
(TyreControl), y `codigo_operario` haciendo de PIN (Almacén). La unificación está planteada en
`docs/FASE1_OPERARIOS_CORE_ESTUDIO.md`.
