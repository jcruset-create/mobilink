# FASE 0 — Auditoría de `taller_app/` antes de generar la APK

> Informe previo a tocar código, según el encargo. Todo lo que sigue está verificado
> sobre el repositorio en su estado actual; donde hay una suposición, se dice.
> **No se ha modificado ningún fichero.**

---

## 1. Estado actual

### 1.1 `taller_app/` — lógica hecha, plataforma inexistente

```
taller_app/
├── README.md
├── pubspec.yaml        version: 0.1.0+1
├── pubspec.lock
└── lib/                11 ficheros, ~1.522 líneas
```

**No hay `android/`, no hay `ios/`, no hay `test/`.** Es literalmente `lib/` +
`pubspec.yaml`. El README lo asume y documenta el `flutter create .` pendiente.

| Fichero | Líneas | Contenido |
|---|---|---|
| `lib/config.dart` | 2 | `kBackendUrl = 'https://sea-tarragona.onrender.com'` |
| `lib/main.dart` | 73 | `TallerApp` + `SplashScreen` con auto-login desde `SharedPreferences` |
| `lib/theme.dart` | 89 | Tema propio (`AppColors.primary`) |
| `lib/workshops.dart` | 12 | Constantes de talleres |
| `lib/models/job.dart` | 63 | Modelo `Job` |
| `lib/screens/login_screen.dart` | 142 | Desplegable de técnicos + PIN |
| `lib/screens/home_screen.dart` | 322 | Lista de tareas, filtro por taller, salir |
| `lib/screens/task_detail_screen.dart` | 259 | Detalle, acciones de estado, fotos |
| `lib/screens/create_task_screen.dart` | 180 | Crear tarea (solo supervisor) |
| `lib/services/api_service.dart` | 291 | Capa REST completa |
| `lib/services/offline_store.dart` | 89 | Caché Hive + cola (`enqueueStatus`, `enqueueUpload`, `flushOutbox`) |

Dependencias declaradas: `http ^1.2.0`, `shared_preferences ^2.2.2`, `hive ^2.2.3` +
`hive_flutter ^1.1.0`, `image_picker ^1.1.2`, `flutter_image_compress ^2.3.0`,
`http_parser ^4.0.2`. **No hay dependencia de notificaciones push.**

### 1.2 Backend — completo y en producción

`/api/taller-operator/*` en `server/index.ts`, consumido hoy solo por esta app:

| Método | Ruta | Línea | Notas |
|---|---|---|---|
| GET | `/me` | 2654 | `{ name, esSupervisor }` |
| GET | `/jobs` | 2667 | Corte de 3 días; el operario ve los suyos, el supervisor todos |
| GET | `/techs` | 2695 | **403 si no es supervisor** |
| POST | `/jobs` | 2719 | Crear |
| PUT | `/jobs/:id/assign` | 2765 | Reasignar |
| PUT | `/jobs/:id/status` | 2793 | `activo` / `parado` / `cerrado` / `espera` |
| GET · POST | `/jobs/:id/files` | 2879 · 2911 | Fotos, subida multipart |

Autenticación: `x-roadside-operator-name` + `x-roadside-operator-code` contra
`techs.roadsideOperatorCode` (`getRoadsideOperatorFromRequest`, línea 1497). El login
devuelve además una sesión Supabase que la app usa como `Bearer` con refresco.

### 1.3 Entorno de esta sesión

**No hay Flutter ni Dart instalados en este contenedor** (solo Java 17). Los comandos
`flutter analyze`, `flutter test` y `flutter build apk --release` que exige la regla de
validación real **no se pueden ejecutar aquí**: se ejecutarán en el runner de GitHub
Actions, que es donde además está el keystore. Es la única desviación de la regla 4, y
conviene aceptarla explícitamente antes de empezar.

---

## 2. Reutilización

De **`flutter_app/` (Mobilink Assist, 1.8.1+29)**, que es de donde `taller_app` está
calcada:

| Qué se copia | Origen |
|---|---|
| Workflow completo de CI | `.github/workflows/build-assist-apk.yml` |
| Resolución de firma en Gradle | `flutter_app/android/app/build.gradle.kts` (lee `key.properties` con `rootProject.file`) |
| Patrón de cola offline | ya presente en `taller_app/lib/services/offline_store.dart` |
| Registro en descargas | `APK_APPS` en `server/index.ts:15985` + `public/descargas.html` (consume `/api/apps/list`) |

El workflow de Assist ya resuelve, y hay que conservarlo tal cual:

- Autoversionado del `pubspec.yaml` antes de compilar, con desbordamiento
  `1.8.9 → 1.9.0`, y `build number = github.run_number`.
- Keystore desde `MOBILINK_KEYSTORE_BASE64` + `MOBILINK_KEYSTORE_PASSWORD`, alias
  `mobilink`, escrito en `/tmp` y validado con `keytool` antes de compilar.
- **Verificación con `apksigner --print-certs` que falla el job si aparece
  `CN=Android Debug`**, y publicación de release condicionada a que el secret exista.
  Esto es lo que impide entregar una APK que no se pueda instalar encima de la anterior.
- Diagnóstico que imprime solo la longitud de los secretos, nunca su contenido.

---

## 3. Deuda técnica y duplicidades

**a) Dos credenciales para el mismo técnico.** `taller_app` autentica con
`techs.roadsideOperatorCode`; la pantalla web `/operario/taller`
(`src/pages/WorkshopOperatorPage.tsx`) usa `techs.workshopPin`, columna distinta y con
teclado numérico propio. El mismo técnico puede tener dos códigos para dos pantallas
que hacen casi lo mismo.

**b) Dos sistemas de fichaje.** Las pausas del taller
(`/api/workshop-operator/break/*`) afectan a los tiempos del trabajo; el módulo
Presencia escribe en `pres_records` (Supabase, sin pasar por Express) y su
`presencia_app` es un esqueleto sin `android/`. Un técnico no ficha jornada desde el
taller: solo marca pausas.

**c) `workshopId` ausente en el modelo de trabajos que consume la app.** El README lo
señala: la app filtra por taller en cliente sin que el backend lo devuelva.

**d) Sin tests.** No existe `taller_app/test/`. Con Flutter, `flutter test` sin
ficheros de test **termina en error**, así que el paso de tests del pipeline hay que
resolverlo: o se añade al menos un test real, o el paso se hace condicional. Yo añadiría
un test de humo del modelo `Job` y otro del `OfflineStore`, que además es lo que más
duele si se rompe.

**e) `applicationId` de Assist quedó en `com.example.sea_tarragona_operario`**, que es el
valor por defecto de Flutter y no debería replicarse. Los ids buenos del repo son
`com.mobilink.assist_lite` y `com.seatarragona.tyrecontrol_app`.

**f) Sin push.** No hay dependencia de FCM en `taller_app`, aunque el backend ya tiene
`register-token` para asistencias y `lite_app` sí lo usa.

---

## 4. Propuesta de arquitectura

**Autenticación.** Unificar en el PIN de taller (`techs.workshopPin`) y que el backend
lo acepte también en `/api/taller-operator/*`, manteniendo `roadsideOperatorCode`
como alternativa durante la transición para no romper nada. La migración es de datos,
no de código: rellenar el PIN de quien solo tenga código. **Esto es de la fase 2**; en
la fase 1 la app sigue con el login actual, que funciona.

**Sesión en tablet compartida.** La sesión identifica al técnico, no al dispositivo. El
cambio de operario borra la identidad pero **nunca la cola offline**, que debe ser del
dispositivo y llevar dentro de cada elemento quién lo generó. Si se mezclan, un cambio
de turno pierde trabajo hecho.

**Cola offline.** Mantener Hive, pero con **UUID generado en el cliente** por cada
operación y aceptado por el backend como clave de idempotencia. Hoy un reintento tras
un timeout puede duplicar el registro, porque el id lo pone el servidor. Es el cambio
menos vistoso y el más importante de todos.

**Presencia frente a tiempos de trabajo.** Dos cosas distintas y así deben quedar: la
jornada laboral va a Presencia (`pres_records`); las pausas productivas siguen en el
mecanismo del taller, que es el que alimenta el tiempo real del trabajo. Mezclarlas
haría que un café descuadre las nóminas.

**Firmas.** Imagen PNG asociada al trabajo por la vía de ficheros que ya existe
(`/jobs/:id/files`), con un tipo que la distinga de las fotos. No hace falta tabla nueva.

---

## 5. Impacto en ficheros (Fase 1)

**Crear**

1. `taller_app/android/**` — generado con `flutter create . --project-name taller_app --org com.mobilink`.
2. `taller_app/android/app/build.gradle.kts` — adaptar el de Assist para leer `key.properties`.
3. `taller_app/android/key.properties` — **solo en el runner**, nunca en git (verificar `.gitignore`).
4. `.github/workflows/build-taller-apk.yml` — copia del de Assist, cambiando rutas, prefijo y tag.
5. `taller_app/test/` — test de humo mínimo, para que `flutter test` no falle.

**Modificar**

6. `server/index.ts` — entrada `taller` en `APK_APPS` (línea 15985): prefijo
   `mobilink-taller-`, etiqueta `WorkPlanner Taller`, `releaseTag: "taller-v"`, y
   `pubspec: "taller_app/pubspec.yaml"` como repliegue.
7. `taller_app/android/app/src/main/AndroidManifest.xml` — permisos y nombre visible.
8. `taller_app/pubspec.yaml` — versión inicial `0.2.0+1`.
9. `taller_app/README.md` — sustituir las instrucciones manuales por el flujo de CI.

**`public/descargas.html` no hace falta tocarlo**: se alimenta de `/api/apps/list`, así
que con dar de alta la app en `APK_APPS` aparece sola.

**Sobre el `applicationId`:** el encargo propone `com.mobilink.workplanner.taller`. La
convención del repositorio es más corta (`com.mobilink.assist_lite`), así que sugiero
**`com.mobilink.taller`**. No es una preferencia estética: el id es **inmutable una vez
publicado** —lo advierte el propio `build.gradle.kts` de Lite—, así que conviene
elegirlo ahora y no heredar un nombre largo por inercia. Decisión tuya; si prefieres el
largo, se pone y no se vuelve a tocar.

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `flutter create` sobrescribe algo de `lib/` | No lo hace (solo añade plataformas), pero se ejecuta con el árbol limpio y se revisa el diff antes de commitear |
| `flutter test` sin tests rompe el pipeline | Añadir test de humo en la misma fase 1 |
| APK firmada como debug por un secret mal pegado | Ya resuelto en el workflow de Assist: `apksigner` falla el job. Copiarlo **entero**, no resumido |
| El nuevo workflow dispara builds de Assist o TyreControl | Filtrar `paths:` a `taller_app/**` y al propio workflow |
| Publicar con `applicationId` provisional | Fijarlo antes de la primera release: es inmutable |
| Romper `/operario/taller` o los endpoints | La fase 1 no toca ni el panel web ni la API; el único cambio en `server/index.ts` es añadir una entrada al registro de descargas |
| No poder validar en local | Los tres comandos corren en el runner; el primer build se lanza a mano con `workflow_dispatch` antes de anunciar nada |

---

## 7. Matriz de clasificación de los añadidos propuestos

| Añadido | Clasificación | Por qué |
|---|---|---|
| **Fotografías obligatorias pre/post** | **Alta prioridad** | Es la defensa ante reclamaciones por daños, y la app ya hace fotos con cola offline: es configuración, no desarrollo |
| **Tiempos estándar vs. reales** | **Alta prioridad** | El dato ya existe (`standardMinutes` en el trabajo y el tiempo real que mide el panel). Solo hay que mostrarlo, y es lo que convierte la app en información de gestión |
| **Plantillas de incidencias** | **Alta prioridad** | Sin ellas la incidencia se escribe en texto libre con guantes, es decir, no se escribe |
| **Lectura de matrícula/VIN por cámara** | Es interesante | Ahorra teclear la matrícula, que es el error más común. Pero necesita OCR fiable con suciedad y contraluz: hay que probarlo antes de prometerlo. Empezar por matrícula, que es formato conocido; el VIN es más difícil |
| **Aprobación del cliente por móvil** | Es interesante | Encaja con la propuesta de trabajos adicionales y ya hay precedente de enlaces con token en asistencias. Depende de que exista antes el flujo de propuestas |
| **Vista de carga de puestos** | Es interesante | Útil para el jefe de taller, pero es una pantalla de WorkPlanner, no de la tablet del técnico. Si se hace, que sea allí |
| **Consulta de manuales y vídeos** | Futuro | Valioso pero implica gestión documental que hoy no existe. Sin un repositorio de contenidos detrás, es una carpeta de PDFs |
| **Dictado por voz** | Futuro | Suena ideal para manos ocupadas, pero un taller es ruidoso y el reconocimiento castellano con jerga técnica falla. Probar con una nota de voz adjunta antes que con transcripción |
| **Control de herramientas** | No recomendable *aquí* | Ya existe el módulo ToolControl con su propia app. Duplicarlo en la de taller crea dos inventarios que se contradicen. Si hace falta, se enlaza |

---

## 8. Qué hace falta para arrancar la Fase 1

Tres decisiones y un permiso:

1. **`applicationId` definitivo**: `com.mobilink.taller` (recomendado) o
   `com.mobilink.workplanner.taller`.
2. **Nombre visible**: el encargo dice "WorkPlanner Taller"; el `pubspec` y el README
   dicen "Mobilink Taller". Hay que elegir uno.
3. **Aceptar que la validación real ocurre en CI**, no en esta sesión, por no haber
   Flutter en el entorno.

Con eso, la fase 1 es acotada y de bajo riesgo: no toca la app por dentro, solo la
envuelve para que se pueda compilar, firmar y distribuir.
