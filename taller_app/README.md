# WorkPlanner Taller (Android e iOS)

App para las **tablets de los técnicos**: ver las tareas asignadas, empezarlas,
pausarlas y cerrarlas, con fotos del trabajo y cola offline. Se conecta al backend
Express (`https://sea-tarragona.onrender.com`) por los endpoints
`/api/taller-operator/*`.

- **applicationId**: `com.mobilink.taller` — **inmutable**: cambiarlo obliga a
  desinstalar la app de todas las tablets.
- **Nombre visible**: WorkPlanner Taller.
- Firmada con el keystore de la casa, el mismo que Assist y TyreControl, así que cada
  versión se instala encima de la anterior.

## Cómo se publica

No se compila a mano: lo hace `.github/workflows/build-taller-apk.yml`.

- Se dispara solo con cualquier cambio en `taller_app/**`, o a mano desde la pestaña
  Actions (`workflow_dispatch`).
- Sube la versión del `pubspec.yaml`, pasa `flutter analyze` y `flutter test`, compila
  el APK firmado y **comprueba con `apksigner` que no ha salido firmado como debug**.
- Publica una GitHub Release `taller-vX.Y.Z+N` y deja el APK disponible en el centro de
  descargas (`/descargas.html`), que lo encuentra por el prefijo `mobilink-taller-`.

La clave de firma llega de los secretos `MOBILINK_KEYSTORE_BASE64` y
`MOBILINK_KEYSTORE_PASSWORD`. **Nunca** se guarda en el repositorio: `key.properties`
y los `.keystore` están en `.gitignore`.

## iOS

La app existió solo para Android durante 272 entregas. El proyecto `ios/` se
añadió después, así que aquí no hay historia que respetar: los valores de abajo
son los definitivos y los dos primeros son **inmutables** una vez subida la app.

| | |
|---|---|
| Bundle id | `com.mobilink.taller` |
| Nombre visible | WorkPlanner Taller |
| Mínimo | iOS 13.0, que es lo que pide el motor de Flutter 3.35.4; los plugins de esta app se conforman con menos |
| Flutter | 3.35.4, fijo también en Codemagic |

El bundle id coincide con el `applicationId` de Android, pero **por decisión, no
porque sea el mismo dato**: son dos identificadores de dos tiendas distintas y
cada uno es inmutable por su cuenta. En las otras apps de la casa ni siquiera
coinciden (`flutter_app` es `com.example.sea_tarragona_operario` en Android y
`com.mobilink.assist` en iOS).

El mínimo de iOS y la versión de Flutter van atados: Flutter 3.47 sube el mínimo
del motor a iOS 15 y entonces `pod install` falla con «required a higher minimum
deployment target». Se cambian los dos a la vez —proyecto y `Podfile`— o no se
cambia ninguno.

El `Podfile` va **commiteado**. Flutter solo lo genera al compilar en un Mac, y
el workflow hace `cd ios && pod install` en su segundo paso: sin el fichero, ese
paso muere antes de empezar.

### Permisos

Solo los que el código pide de verdad. Un texto de uso sobrante es motivo de
rechazo, y un permiso sin texto no es que se rechace: iOS **cierra la app** en
cuanto se pide.

| Clave | Quién lo usa |
|---|---|
| `NSCameraUsageDescription` | `image_picker` — la foto de la matrícula al recibir un vehículo y las fotos del trabajo |
| `NSPhotoLibraryUsageDescription` | `image_picker` — adjuntar imágenes ya hechas |

### Subir a TestFlight

Lo hace el workflow `ios-taller-testflight` de `codemagic.yaml`, independiente de
los de Mobilink Assist, Assist Lite y TyreControl. Pide el número de build a App
Store Connect (último de TestFlight + 1), pasa la versión de tienda por flag
—el `version:` del pubspec es la numeración de la APK y **no se toca**, bajarla
convertiría la siguiente APK en una actualización «hacia atrás» que Android no
instalaría—, comprueba que `export_options.plist` existe antes de compilar y que
el `.ipa` existe después, y lo copia a `$HOME/ipa_output` para que `artifacts:`
lo encuentre con `working_directory` puesto.

No se dispara con cada empujón a `main`, a diferencia de la APK: los minutos de
Mac se pagan y una subida a TestFlight es una decisión. Se pide con una etiqueta
sobre el commit que se quiera subir, o desde el botón de la UI de Codemagic:

```bash
git tag taller-ios-1 && git push origin taller-ios-1
```

Antes del primer build hacen falta tres cosas **fuera del repositorio**:

1. el App ID `com.mobilink.taller` dado de alta en Apple Developer,
2. la ficha de la app en App Store Connect con ese mismo bundle id,
3. que la clave de App Store Connect llamada **Mobilink Assist** en Codemagic
   tenga acceso a esa app (rol App Manager o superior). Se reutiliza esa clave,
   como ya hace Assist Lite: una clave de API es del equipo de Apple, no de una
   app. A cambio, el día que caduque se paran las cuatro entregas a la vez.

Si falta cualquiera de las tres, el build para en el paso del número de build con
el motivo escrito, en vez de morir cuarenta minutos después al firmar.

En local, en un Mac:

```bash
flutter pub get
cd ios && pod install && cd ..
flutter build ipa --release --build-name=1.0 --build-number=1
```

## Desarrollo en local

```bash
cd taller_app
flutter pub get
flutter analyze --no-fatal-infos
flutter test
flutter run           # con una tablet o emulador conectado
```

Sin `key.properties`, `flutter build apk --release` compila igualmente pero firmado con
la clave de depuración: sirve para probar, **no** para instalar encima de una versión
publicada.

## Estructura

```
lib/
├── config.dart                 URL del backend
├── main.dart                   arranque y auto-login
├── theme.dart                  colores (fondo slate-900, primario red-600)
├── models/job.dart             modelo de trabajo
├── screens/                    login, lista, detalle, crear tarea
└── services/
    ├── api_service.dart        capa REST
    └── offline_store.dart      caché Hive y cola de envíos
test/
└── job_test.dart               normalización de los trabajos que llegan del backend
```

## Pendiente

- **Icono de iOS**: hoy lleva el de Flutter por defecto. El de Android es de
  192x192 y estirarlo a los 1024x1024 que pide Apple queda borroso, así que hace
  falta el original en vectorial o en alta resolución. Para TestFlight interno no
  bloquea; para la App Store pública sí es motivo de rechazo.
- Adaptación a tablet: dos columnas en horizontal y sesión de puesto compartido.
- Unificar el login con el PIN de taller (`techs.workshopPin`), hoy usa el código de
  operario.
- `workshopId` en el modelo del backend, para filtrar por taller desde el servidor.
- Avisos push al asignar un trabajo.

Contexto y decisiones: `docs/AUDITORIA_apk_taller_fase0.md` y
`docs/PROMPT_apk_tecnicos_taller.md`.
