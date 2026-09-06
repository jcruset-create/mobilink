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

`POST /device` lleva, además del token push y los permisos, la versión de la
app y el estado de las colas (`queuePending`, `queueFailed`, `queueOldestAtMs`).
Con eso Central detecta en **Salud de Assist Lite** un móvil que lleva horas sin
poder subir sus evidencias, cosa que desde el móvil no ve nadie.

### Límites de uso

La API responde `429` con `Retry-After` si un dispositivo se desboca: 120
posiciones/min, 20 lotes/min, 60 fotografías/5 min, 20 firmas/5 min, 60
mensajes/min, 30 sincronizaciones/min y un tope general de 900/min. Están unas
diez veces por encima del uso normal, así que en la práctica solo los toca una
cola reenviándose en bucle. Ante un `429`, esperar los segundos que indica
`Retry-After` y reintentar; el `clientActionId` garantiza que nada se duplique.

## Modo sin conexión

`lib/services/queue.dart` mantiene una cola en Hive con los cambios de estado,
las observaciones y las posiciones GPS. Al recuperar cobertura se envían con
`POST /sync`. Si el estado oficial ya no admite el cambio, la operación queda
marcada como **conflicto** y se avisa al operario (no se oculta ni se fuerza).

`lib/services/file_queue.dart` hace lo propio con los binarios: la fotografía y
la firma se copian al almacenamiento privado de la app en cuanto se capturan
—la carpeta temporal la puede vaciar Android en cualquier momento, y la firma
solo vivía en memoria— y se suben solas al recuperar señal, con el mismo
`clientActionId`. El envío se corta al primer corte de red: insistir con el
resto solo gasta batería.

## Plataforma Android

`android/` **está en el repositorio** desde la versión 0.1.2. No hay que
ejecutar `flutter create`: la regla `*/android/` del `.gitignore` lo descartaba
en silencio y por eso durante un tiempo la APK no se podía compilar; ahora hay
una excepción explícita para `lite_app/android/`.

Lo que ya viene configurado: identificador `com.mobilink.assist_lite`, nombre
visible, icono y tema de arranque oscuro, permisos de INTERNET, ubicación fina
y aproximada, cámara y notificaciones, los `<queries>` de `url_launcher`
(`geo:`, `tel:`, `https:`; sin ellos los botones no hacen nada en Android 11+),
`ndkVersion` y la memoria del demonio de Gradle bajada a 2 GB, porque el valor
que genera Flutter (`-Xmx8G`) no cabe en equipos de 16 GB.

### Seguimiento con la pantalla bloqueada

El flujo de posiciones se arranca como **servicio en primer plano** de Android
(`AndroidSettings.foregroundNotificationConfig` en `tracker.dart`), con aviso
persistente que no se puede ocultar. Lo levanta el propio `geolocator`
—`GeolocatorLocationService` ya viene declarado con
`foregroundServiceType="location"` en el manifiesto del plugin—, así que no hay
ninguna dependencia extra ni de pago. De ahí los permisos `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_LOCATION` (obligatorio desde Android 14) y `WAKE_LOCK`.

**No** se declara `ACCESS_BACKGROUND_LOCATION`, y es deliberado: el servicio
arranca con la app en primer plano —el operario pulsa "En camino"— y en ese caso
basta el permiso de "mientras se usa la app". Pedir el de segundo plano
obligaría a pasar la revisión aparte de Google Play sin ganar nada.

Limitación conocida: el servicio mantiene el seguimiento con la pantalla
bloqueada y la app en segundo plano, pero **no sobrevive a que Android destruya
la actividad** por falta de memoria. `Tracker._vigilar` reabre el flujo cuando
detecta que se ha caído; el rastro del hueco no se recupera. La alternativa que
sí lo cubriría es un servicio con motor Flutter propio
(`flutter_background_geolocation`, de pago).

`google-services.json` y `key.properties` no están en el repositorio, que es
público: los inyecta la CI desde secretos.

## Plataforma iOS (App Store / TestFlight)

`ios/` está en el repositorio desde la versión 0.5.0. La app es **solo iPhone**
(`TARGETED_DEVICE_FAMILY = 1` en las tres configuraciones): no se declara nada
de iPad, ni orientaciones `~ipad`, ni iconos de iPad en el catálogo. Declarar
soporte de iPad a medias es lo que provoca el rechazo `90474 Invalid bundle`.

| | |
| --- | --- |
| Bundle id | `com.mobilink.assistlite` (Apple no admite `_`, así que no puede ser igual que el `com.mobilink.assist_lite` de Android) |
| Nombre visible | Mobilink Assist Lite |
| Mínimo | iOS 13.0, que es lo que piden `firebase_core` y `firebase_messaging`; el resto de plugins se conforman con menos |
| Flutter | 3.35.4, fijo también en Codemagic |

El mínimo de iOS y la versión de Flutter van atados: Flutter 3.47 sube el
mínimo del motor a iOS 15 y entonces `pod install` falla con «required a higher
minimum deployment target». Se cambian los dos a la vez —proyecto y Podfile— o
no se cambia ninguno.

### Permisos

Solo los que el código pide de verdad; un texto de uso sobrante es motivo de
rechazo y un permiso sin texto revienta la app al pedirlo.

| Clave | Quién lo usa |
| --- | --- |
| `NSCameraUsageDescription` | `lib/services/camara.dart` (evidencias) |
| `NSPhotoLibraryUsageDescription` | `Camara.elegirDeGaleria` desde `photos_screen.dart` |
| `NSLocationWhenInUseUsageDescription` | `lib/services/tracker.dart` |
| `UIBackgroundModes: location` | el equivalente del servicio en primer plano de Android |
| `ITSAppUsesNonExemptEncryption = false` | solo HTTPS del sistema, sin criptografía propia |

**No** se pide el permiso de ubicación «siempre», igual que en Android no se
declara `ACCESS_BACKGROUND_LOCATION`: el seguimiento lo arranca el operario con
la app delante y con `allowBackgroundLocationUpdates` basta para que iOS siga
entregando posiciones con la pantalla bloqueada. Mientras dura, el sistema
enseña el indicador azul, que hace de aviso permanente.

`PrivacyInfo.xcprivacy` va registrado en el target Runner: sin tracking, sin
APIs de motivo obligatorio propias, y los datos que sí se recogen (nombre,
identificador de sesión, ubicación precisa, fotos y firma) vinculados al
operario y solo para el funcionamiento de la app.

### Subir a TestFlight

Lo hace el workflow `ios-lite-testflight` de `codemagic.yaml`, independiente de
los de Mobilink Assist y TyreControl. Pide el número de build a App Store
Connect (último de TestFlight + 1), pasa la versión de tienda por flag —el
`version:` del pubspec es la numeración de la APK y no se toca—, comprueba que
`export_options.plist` existe antes de compilar y que el `.ipa` existe después,
y lo copia a `$HOME/ipa_output` para que `artifacts:` lo encuentre con
`working_directory` puesto.

Antes del primer build hacen falta tres cosas fuera del repositorio:

1. el App ID `com.mobilink.assistlite` en Apple Developer,
2. la ficha de la app en App Store Connect con ese mismo bundle id,
3. la integración de App Store Connect en Codemagic llamada exactamente
   **Mobilink Assist Lite**.

En local, en un Mac:

```bash
flutter pub get
cd ios && pod install && cd ..
flutter build ipa --release --build-name=1.0 --build-number=1
```

### Avisos push en iPhone

Falta lo mismo que en Android y una cosa más: dar de alta
`com.mobilink.assistlite` en el proyecto de Firebase, guardar su
`GoogleService-Info.plist` (que **no** va al repositorio, es público) y subir a
Firebase la clave de APNs. Hasta entonces `Firebase.initializeApp()` falla, se
registra y la app se queda con el sondeo de la bandeja, exactamente igual que
la APK sin `google-services.json`.

## Compilar

Lo normal es **no compilar a mano**: el workflow `build-lite-apk.yml` compila,
firma con la clave de la casa, comprueba que no salga firmada en depuración y
publica la release `assist-lite-vX.Y.Z+N`, que aparece en `/descargas.html`.

En local:

```bash
flutter pub get
flutter build apk --release
```

Sale sin firmar con la clave de producción y sin notificaciones (falta el
`google-services.json`), así que sirve para probar, no para repartir.

Si una compilación anterior se ha quedado a medias, Windows deja bloqueado
`build/`: parar el demonio (`android\gradlew.bat --stop`), borrar la carpeta
`build` y repetir.

## Notificaciones push

La app integra `firebase_core` + `firebase_messaging` (`lib/services/push.dart`)
y registra su token en `POST /device`, incluido el refresco. El backend envía
con FCM v1 (`server/core/push.ts` + `litePush.ts`, con
`FIREBASE_SERVICE_ACCOUNT`) y limpia los tokens que FCM rechaza.

Lo que falta es el **alta en Firebase**: dar de alta
`com.mobilink.assist_lite` y guardar su `google-services.json` como secret
`LITE_GOOGLE_SERVICES_BASE64`. Sin él la APK se compila igual, sin avisos: la
bandeja sondea cada 25 s en vez de cada 2 minutos, y la pantalla de Perfil dice
cuál de los dos casos es.
