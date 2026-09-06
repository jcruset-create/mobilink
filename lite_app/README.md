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

## Icono

El original está en `assets/icono_app.png` (1024×1024, sin canal alfa) y de ahí
salen los dos juegos:

* **iOS** — `ios/Runner/Assets.xcassets/AppIcon.appiconset`: el arte entero, tal
  cual. La máscara de Apple redondea más que el marco del propio dibujo, así que
  se come las esquinas negras y no queda ribete.
* **Android** — `mipmap-*/ic_launcher.png` es el arte entero (lanzadores
  antiguos) y `drawable-*/ic_launcher_foreground.png` es el contenido recortado
  sobre transparente, sin el marco, que lo pone el sistema.

El primer plano adaptativo va al **76 % de su lienzo**, y no es un número
caprichoso: con el `inset` del 16 % de `mipmap-anydpi-v26/ic_launcher.xml`
queda en 55 de los 108 dp, que es lo que cabe **entero** dentro del círculo de
72 dp con el que recorta el lanzador de Pixel. Más grande y la línea «ASSIST
LITE» se queda fuera por abajo. El fondo lo pone `ic_launcher_background`
(slate-900), el mismo del arte.

Tampoco se usa `flutter_launcher_icons`, y también a propósito: regenera el
catálogo de iOS con las entradas de iPad, que es justo lo que aquí se ha
quitado (la app es solo iPhone). Para rehacer los iconos se parte de
`assets/icono_app.png` y se respetan los tamaños que ya hay.

De `assets/` solo se empaquetan los dos logotipos (`pubspec.yaml`). Los dos
iconos, no: son la fuente de los ficheros de Android e iOS, no algo que la app
cargue en marcha, y meterlos en la APK sería casi un mega por nada.

## Logotipo

`assets/logo_horizontal.png` — el logotipo completo, con el lema, sobre fondo
transparente. Se usa en las dos portadas: la pantalla de arranque
(`main.dart`) y el login.

`assets/logo_cabecera.png` — el mismo, **sin el lema**, para la barra de la
bandeja. A 26 px de alto la línea «asistencias en carretera para talleres
furgón móviles» no se lee y solo ensucia; el nombre del taller sigue debajo,
que es el dato que el operario necesita ver.

El fondo se quitó por color (el original venía sobre un degradado azul marino),
no recortando a mano: se marca como fondo lo que cae en el rango del degradado
y se deja todo lo demás, así las ventanillas y las ruedas del furgón —oscuras,
pero fuera de ese rango— no se agujerean.

## Acceso: condiciones, taller recordado y Face ID

El objetivo de este flujo es que el operario abra la app y esté dentro. Tres
piezas, en `lib/services/preferencias.dart` (ajustes del móvil),
`lib/services/secure_store.dart` (llavero) y `lib/services/biometria.dart`.

### Primera instalación

```
abrir → condiciones → permiso de ubicación → taller + usuario + PIN → ¿Face ID?
```

`onboarding_screen.dart` se enseña una sola vez y **es la que pide la
ubicación**, justo después de aceptar. Antes el permiso se pedía en mitad del
login, mientras el operario escribía su PIN: ahí el diálogo se contesta que no
sin leerlo, y en iOS **no hay segunda oportunidad** —la única salida es
Ajustes—. Se pide solo «mientras se usa la app», que es lo que necesita el
seguimiento; nunca «siempre».

Decir que no NO bloquea nada: se sigue al login y la app funciona, con el aviso
de la bandeja explicando qué se pierde.

### Accesos siguientes

```
abrir → Face ID → dentro
```

El código de taller se rellena solo (`Recordar el taller en este móvil`, marcado
de serie; se borra con la X del campo o desde Perfil). Es un dato de
organización, no una credencial: sin usuario y PIN no abre nada.

Si el operario activó la biometría, `bloqueo_screen.dart` pide Face ID / huella
al arrancar. **No reintenta solo**: si falla o se cancela queda el botón, y
debajo «Entrar con usuario y PIN». Reintentar en bucle es la forma más rápida
de que el sistema bloquee la biometría por intentos fallidos y deje al operario
fuera con una avería esperando.

### Qué se guarda y dónde

| Dato | Dónde | Por qué |
| --- | --- | --- |
| Token de sesión | **Llavero** (Keychain / Keystore) | Es la credencial, y ahora la abre una huella |
| Usuario, taller, configuración | `shared_preferences` | Datos de trabajo, no secretos |
| Código de taller recordado | `shared_preferences` | No da acceso por sí solo |
| PIN | **En ninguna parte** | Nunca se guarda, ni cifrado |

El token se movió de `shared_preferences` al llavero con migración: quien ya
tenía sesión abierta sigue dentro tras actualizar.

Y una consecuencia del llavero que hay que atajar a mano: **en iOS sobrevive a
desinstalar la app**. Borrarla y reinstalarla —lo primero que se prueba cuando
algo va mal— dejaría el token dentro y la app entraría sola con una sesión que
el operario creía cerrada. `Session.restore` lo detecta porque las
preferencias sí se borran con la app: un token sin nada que lo acompañe solo
puede ser basura de la instalación anterior, así que se tira y se pide login.
Actualizar no cae ahí, que es lo que protege la migración.

Al cerrar sesión se olvida la biometría (esa cara abría *esa* sesión), pero el
taller recordado se queda: es del móvil, no de la persona.

### Lo que esto obliga en cada plataforma

* **iOS** — `NSFaceIDUsageDescription` en el `Info.plist`. Sin ese texto, iOS
  mata la app al pedir Face ID. Touch ID no necesita clave propia.
* **Android** — `minSdk` sube de 21 a **24**, que es lo que exige
  `local_auth_android` (`flutter_secure_storage` pide 23), y `MainActivity`
  pasa a `FlutterFragmentActivity`, porque el diálogo de huella se dibuja como
  fragmento. Más el permiso `USE_BIOMETRIC`, que es «normal»: no saca diálogo
  ni da acceso a los datos biométricos.

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
