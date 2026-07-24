# Mobilink Presencia (APK de fichaje)

App Flutter para que los empleados fichen entrada y salida desde el móvil.
Escribe en la tabla `pres_records` (Supabase) a través del backend Express,
así que los fichajes aparecen al momento en el módulo web **Presencia**.

## Funcionamiento

- **Login**: el empleado elige su nombre (lista de `sea_employees` activos) e
  introduce su PIN de 4 dígitos. La primera vez que entra, el PIN que ponga
  queda registrado como suyo (`pin_hash` con pgcrypto, RPC `pres_login`).
- **Pantalla principal**: reloj en tiempo real, estado de hoy
  (entrada / salida / duración) y un botón grande **Fichar entrada** (verde)
  o **Fichar salida** (rojo). Historial de los últimos 14 días.
- La sesión queda guardada (shared_preferences); no hace falta volver a entrar.

## Backend

Endpoints en `server/index.ts` (`/api/presencia-operator/*`):
`employees`, `login`, `hoy`, `fichar`, `historial`.
Auth por cabeceras `x-presencia-employee` + `x-presencia-pin`, verificadas
con el RPC `pres_login` de Supabase.

**Antes de usar la app hay que ejecutar a mano** la migración
`supabase/migrations/007_presencia_pin.sql` en Supabase > SQL Editor.

## Compilar

```
flutter create . --platforms android
flutter pub get
flutter build apk --release
```

APK al Escritorio con el nombre `Mobilink-Presencia-v1.0.0.apk`.
