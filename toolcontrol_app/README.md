# Mobilink ToolControl — App de técnicos (APK)

App móvil para los técnicos del módulo ToolControl: escanear el QR de una
herramienta o máquina, **utilizar / devolver / mover** herramientas y
**reportar incidencias**. Habla directamente con Supabase (anon key) mediante
las RPCs de la migración `supabase/migrations/007_toolcontrol_operarios.sql`.

## Puesta en marcha (primera vez)

Este repositorio incluye solo `lib/` y `pubspec.yaml`. Para generar las carpetas
de plataforma (android/ios) ejecuta desde la carpeta `toolcontrol_app/`:

```bash
flutter create . --project-name toolcontrol_app --org com.mobilink
flutter pub get
```

`flutter create .` NO sobrescribe `lib/` ni `pubspec.yaml` existentes; solo añade
las carpetas de plataforma que falten.

Tras generar `android/`, añade el permiso de cámara (lo necesita `mobile_scanner`)
en `android/app/src/main/AndroidManifest.xml` (dentro de `<manifest>`, fuera de
`<application>`):

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

## Compilar el APK

```bash
flutter build apk --release
```

El APK queda en `build/app/outputs/flutter-apk/app-release.apk`. Renómbralo a
`mobilink-toolcontrol-v1.0.0.apk` (según la versión de `pubspec.yaml`) y muévelo
al Escritorio.

## Pasos manuales antes de usarla

1. **Ejecutar la migración 007** en el SQL Editor de Supabase:
   `supabase/migrations/007_toolcontrol_operarios.sql` (crea las RPCs
   `tc_operator_login`, `tc_op_usar_tool`, `tc_op_devolver_tool`,
   `tc_op_mover_tool`, `tc_op_reportar_incidencia` y `tc_op_mis_herramientas`).

2. **Asignar código de operario y PIN** a cada técnico en `sea_employees`.
   El PIN se guarda cifrado con pgcrypto. Ejemplo (PIN `1234` para el
   empleado con código `OP01`):

   ```sql
   UPDATE sea_employees
   SET codigo_operario = 'OP01',
       pin_hash = crypt('1234', gen_salt('bf')),
       activo = true
   WHERE id = '<uuid-del-empleado>';
   ```

## QR soportados

- URL del panel web: `https://<dominio>/qr/herramienta/<uuid>` y
  `https://<dominio>/qr/maquina/<uuid>`.
- UUID crudo (se interpreta como herramienta).

## Funcionalidad

- **Login** por código de operario + PIN de 4 dígitos (RPC `tc_operator_login`);
  sesión guardada en local (`shared_preferences`).
- **Home**: escanear QR, buscador de herramientas por código/nombre y lista
  "Mis herramientas en uso".
- **Detalle de herramienta**: ficha con estado, ubicación y categoría; acciones
  según estado — Utilizar (disponible), Devolver con selector de ubicación
  (en uso), Mover ubicación y Reportar incidencia (gravedad baja/media/alta).
- **Máquinas** escaneadas: solo ficha + reportar incidencia.
