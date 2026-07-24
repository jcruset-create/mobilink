# Mobilink Taller (APK)

App de gestión de taller: **asignación de tareas** a operarios y **menú de operario**
para completarlas. Se conecta al backend Express (`https://sea-tarragona.onrender.com`)
mediante los endpoints `/api/taller-operator/*`.

## Puesta en marcha (primera vez)

Este repositorio incluye solo `lib/` y `pubspec.yaml`. Para generar las carpetas de
plataforma (android/ios) ejecuta desde la carpeta `taller_app/`:

```bash
flutter create . --project-name taller_app --org com.mobilink
flutter pub get
```

`flutter create .` NO sobrescribe `lib/` ni `pubspec.yaml` existentes; solo añade las
carpetas de plataforma que falten.

## Compilar el APK

```bash
flutter build apk --release
```

El APK queda en `build/app/outputs/flutter-apk/app-release.apk`. Renómbralo a
`mobilink-taller-vX.Y.Z.apk` (según la versión de `pubspec.yaml`) y muévelo al Escritorio.

## Roles y acceso
- Login por **nombre + PIN** (el PIN es `techs.roadsideOperatorCode`).
- El rol lo decide `techs.es_supervisor` en la base de datos:
  - **Supervisor** → pestañas "Mis tareas" + "Gestión", y botón "Crear tarea".
  - **Operario** → solo "Mis tareas".
- Antes de usarla: marcar `es_supervisor = true` a los supervisores y asegurar que todos
  los técnicos que la usen tengan un `roadsideOperatorCode` asignado.

## Estado actual (MVP)
- Login, lista de tareas, detalle con acciones (empezar/pausar/reanudar/finalizar),
  y creación/asignación (supervisor).
- Pendiente (fase 2): cola offline (Hive), adjuntar fotos, selector de taller.
