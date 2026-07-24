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

Tras generar `android/`, añade el permiso de cámara en
`android/app/src/main/AndroidManifest.xml` (dentro de `<manifest>`, fuera de `<application>`):

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

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

## Estado actual
- Login, lista de tareas, detalle con acciones (empezar/pausar/reanudar/finalizar),
  y creación/asignación (supervisor).
- **Offline (Hive)**: la lista se cachea; los cambios de estado hechos sin cobertura se
  encolan y se reenvían solos al recuperar la conexión (aviso en la cabecera).
- **Fotos**: adjuntar foto por trabajo (cámara + compresión); las fotos hechas offline
  también se encolan.
- Pendiente: selector de taller Tarragona/Reus (requiere añadir `workshopId` al modelo
  de trabajos en el backend).
