# WorkPlanner Taller (APK)

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

- Adaptación a tablet: dos columnas en horizontal y sesión de puesto compartido.
- Unificar el login con el PIN de taller (`techs.workshopPin`), hoy usa el código de
  operario.
- `workshopId` en el modelo del backend, para filtrar por taller desde el servidor.
- Avisos push al asignar un trabajo.

Contexto y decisiones: `docs/AUDITORIA_apk_taller_fase0.md` y
`docs/PROMPT_apk_tecnicos_taller.md`.
