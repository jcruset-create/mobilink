# PROMPT — Crear asistencias desde la APK (usuarios administradores)

Copia este prompt en una sesión de Claude Code sobre el repositorio `sea-tarragona` para implementar la funcionalidad completa.

---

## Contexto

En la APK Mobilink Assist (`flutter_app/`) los operarios entran con nombre + código individual (`techs.roadsideOperatorCode`, endpoint `POST /api/roadside-operator/login` en `server/index.ts`). Hoy las asistencias solo se crean desde el panel web de oficina (`src/components/RoadsideAssistanceView.tsx`, `POST /api/roadside-assistances`).

Queremos que ciertos operarios (administradores) puedan **crear asistencias directamente desde la APK**, por ejemplo cuando reciben el aviso por teléfono estando fuera de la oficina.

## 1. Base de datos

- Añadir columna `roadsideAdmin BOOLEAN DEFAULT FALSE` a la tabla `techs` (migración automática en `server/db.ts`, patrón `ADD COLUMN IF NOT EXISTS` como `roadsideOperatorCode`).
- No hace falta tabla nueva: las asistencias creadas desde la APK van a `roadside_assistances` como las demás.

## 2. Backend (`server/index.ts`)

- `POST /api/roadside-operator/login`: incluir `isAdmin: techs.roadsideAdmin` en la respuesta.
- Nuevo endpoint `POST /api/roadside-operator/assistances` protegido con `requireRoadsideOperator`:
  - Verificar en BD que el operario autenticado tiene `roadsideAdmin = true`; si no, 403.
  - Campos aceptados (mismos nombres que el POST de oficina): `customerName`, `customerPhone`, `address`, `googleMapsUrl`, `latitude`, `longitude`, `plate`, `plateRemolque`, `vehicleDescription`, `priority`, `notes`.
  - Extras propios de la APK:
    - `useCurrentLocation: true` + `latitude`/`longitude` del GPS del móvil → rellenar coordenadas y dirección por geocodificación inversa (Nominatim, como el webhook de WhatsApp).
    - `selfAssign: true` → `assignedTechName` = operario autenticado, estado inicial `asignada`; si no, estado `pendiente` para que oficina asigne.
  - Reutilizar la lógica del POST de oficina: generación de `trackingToken`, evento inicial en `roadside_assistance_events` (con `createdBy: 'apk'`), extracción de coordenadas de `googleMapsUrl` si viene.
- Panel de asistencias web (`RoadsideAssistanceView.tsx`): en la gestión de códigos de operario, añadir un interruptor "Administrador APK" que actualice `roadsideAdmin` (endpoint PUT existente de códigos de operario, ampliado).

## 3. APK (`flutter_app/`)

- Guardar `isAdmin` del login en `SharedPreferences` (junto al nombre/código actuales, `services/api_service.dart`).
- En la pantalla de asistencias (`screens/assistances_screen.dart`): si `isAdmin`, mostrar botón flotante «+ Nueva asistencia».
- Nueva pantalla `screens/create_assistance_screen.dart` con el formulario:
  - Cliente y teléfono (teclado telefónico).
  - Ubicación: tres opciones — usar GPS actual (geolocator, ya en el proyecto), pegar enlace de Google Maps, o escribir dirección.
  - Matrícula camión y matrícula remolque (opcionales, mayúsculas automáticas).
  - Descripción del vehículo, prioridad (normal/urgente), notas.
  - Interruptor «Asignármela a mí» (por defecto activado).
  - Validación mínima: cliente o teléfono + alguna forma de ubicación.
- Al crear con éxito: volver al listado y refrescar; si `selfAssign`, la asistencia aparece ya en la lista del operario.
- Modo offline: si no hay conexión, guardar el borrador en Hive (patrón de `services/offline_store.dart`) y reintentar al recuperar conexión, como las fotos en segundo plano.

## 4. Versionado y entrega

- Subir versión en `flutter_app/pubspec.yaml` (siguiente sobre la actual, hoy 1.6.4+22).
- Compilar `flutter build apk --release` y copiar a `C:\Users\Jordi\Desktop\apk\Mobilink_Assist_v<version>.apk`.
- Si Gradle falla con AccessDenied: `.\gradlew --stop`, borrar `flutter_app/build` y reintentar.
- Commit + push a `main` (Render despliega el servidor automáticamente).

## Criterios de aceptación

1. Un operario sin `roadsideAdmin` no ve el botón y el endpoint le devuelve 403 aunque lo llame a mano.
2. Un administrador crea una asistencia con GPS actual en menos de 1 minuto y le queda autoasignada en estado `asignada`.
3. La asistencia creada desde la APK se ve en el panel web con su enlace de seguimiento operativo y su evento inicial `createdBy: 'apk'`.
4. Crear sin conexión no pierde datos: el borrador se envía al volver la cobertura.
