# Mobilink Assist Lite (APK talleres colaboradores)

App Flutter para talleres que reciben asistencias de **Mobilink Assist Central
Pro** pero no tienen contratado Mobilink Assist completo. Usa el GPS del móvil
o la tablet del operario: no hace falta instalar un GPS en el vehículo ni una
aplicación de escritorio en el taller.

Los estados son exactamente los mismos que en Mobilink Assist completo:
Asignada → En camino → En punto → Trabajando → Finalizada → Vuelta al taller →
En taller.

## Auth

Login con **código de taller + usuario + PIN** (`POST /api/connect/lite/login`).
El backend devuelve un token opaco por dispositivo que se envía como
`Authorization: Bearer lite_...`. Solo se guarda el token; el PIN no se
almacena nunca en el dispositivo, y en el servidor se guarda derivado con
PBKDF2.

Los usuarios y sus PIN los crea la central desde **Talleres → Gestionar Lite**.

## API

Todo cuelga de `/api/connect/lite` (`server/connect/lite.ts`):

| Acción | Endpoint |
| --- | --- |
| Login / logout / perfil | `POST /login`, `POST /logout`, `GET /me` |
| Configuración y catálogos | `GET /config` |
| Dispositivo y permisos | `POST /device` |
| Bandeja y detalle | `GET /assistances?scope=`, `GET /assistances/:id` |
| Aceptar / rechazar | `POST /assistances/:id/accept`, `/reject` |
| Asignar operario (admin) | `POST /assistances/:id/assign-operator` |
| Cambio de estado | `POST /assistances/:id/status` |
| Ubicación | `POST /assistances/:id/location`, `/locations-batch` |
| Evidencias | `POST|GET /assistances/:id/files`, `DELETE .../files/:fileId` |
| Firma | `POST /assistances/:id/signature` |
| Cierre | `POST /assistances/:id/finish` |
| Observaciones y mensajes | `POST /assistances/:id/notes`, `/messages` |
| Cola offline | `POST /sync` |

Todas las operaciones que modifican datos aceptan `clientActionId`: reenviar
la misma operación no la duplica.

## Modo sin conexión

`lib/services/queue.dart` mantiene una cola en Hive con los cambios de estado,
las observaciones y las posiciones GPS. Al recuperar cobertura se envían con
`POST /sync`. Si el estado oficial ya no admite el cambio, la operación queda
marcada como **conflicto** y se avisa al operario (no se oculta ni se fuerza).

Las fotografías y la firma necesitan conexión en el momento de subirlas; si
falla, la app lo dice claramente en vez de fingir que se han guardado.

## Generar la plataforma Android (una sola vez)

El repo solo versiona `lib/` + `pubspec.yaml`. Antes de compilar:

```bash
cd lite_app
flutter create . --org com.seatarragona --project-name lite_app --platforms android
flutter pub get
```

Después hay que añadir a `android/app/src/main/AndroidManifest.xml`, dentro de
`<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Y el nombre visible de la app en `<application android:label="Mobilink Assist Lite">`.

Dentro de `<queries>` hay que declarar los esquemas que abre `url_launcher`
(`geo:` para navegación, `tel:` para llamar y `https:` para la política de
privacidad); si no, los botones no hacen nada en Android 11+.

Además, en `android/app/build.gradle.kts`:

```kotlin
android {
    ndkVersion = "27.0.12077973"   // lo exigen url_launcher_android y geolocator
    ...
}
```

Y en `android/gradle.properties`, bajar la memoria del demonio de Gradle: el
valor que genera Flutter (`-Xmx8G -XX:MaxMetaspaceSize=4G`) no cabe en equipos
de 16 GB y el demonio muere a mitad de compilación.

```properties
org.gradle.jvmargs=-Xmx2G -XX:MaxMetaspaceSize=1G -XX:ReservedCodeCacheSize=256m -XX:+HeapDumpOnOutOfMemoryError
```

## Compilar

```bash
flutter build apk --release
```

Si una compilación anterior se ha quedado a medias, Windows deja bloqueado
`build/`: parar el demonio (`android\gradlew.bat --stop`), borrar la carpeta
`build` y repetir.

Copiar al Escritorio como `mobilink-assist-lite-<versión>.apk` (la versión sale
de `pubspec.yaml`, p. ej. `mobilink-assist-lite-0.1.0.apk`). Verificar con
`aapt` que la versión embebida es la esperada antes de copiar.

## Notificaciones push

El backend ya sabe enviar avisos (`server/core/push.ts` + `litePush.ts`,
FCM v1 con `FIREBASE_SERVICE_ACCOUNT`) y guarda el token de cada dispositivo en
`connect_lite_devices.fcmToken`. La app **todavía no registra token**: mientras
tanto refresca la bandeja cada 25 s y al volver a primer plano.

Para activarlas hay que añadir `firebase_core` + `firebase_messaging` al
`pubspec.yaml`, el `google-services.json` del proyecto y llamar a
`POST /device` con el `fcmToken`. Ninguna otra APK del ecosistema lo hace aún,
así que conviene hacerlo a la vez para todas.
