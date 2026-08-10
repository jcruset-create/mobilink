# Mobilink Assist Lite — informe de estado y prompt de cierre

Este documento responde al encargo de "analizar, diseñar e implementar Mobilink
Assist Lite" con un hecho que cambia el plan: **Lite ya está construido**. De las
12 fases propuestas, las once primeras están implementadas y en el repositorio.
Volver a empezar duplicaría trabajo y arriesgaría lo que ya funciona.

Lo que sigue es, primero, qué hay de verdad (comprobado contra el código, no
contra la documentación), y después el prompt de lo que queda, que es la fase 12
más cinco huecos declarados.

---

## 1. Estado real de las 12 fases

| # | Fase | Estado | Dónde está |
| --- | --- | --- | --- |
| 1 | Análisis de la infraestructura | Hecho | [`docs/mobilink-assist-lite.md`](mobilink-assist-lite.md) §1 |
| 2 | Modelo Lite y permisos (FULL/LITE/EXTERNAL) | Hecho | `liteRules.ts` (`WORKSHOP_INTEGRATION_TYPES`, `WORKSHOP_TIER`), `connect_workshops.integrationType`, `features`, `liteSettings` |
| 3 | Conexión Central Pro ↔ Lite | Hecho | `server/connect/lite.ts` (1.238 líneas), `POST /api/connect/lite/*`, token `lite_<64 hex>` por dispositivo |
| 4 | App móvil básica | Hecho | `lite_app/lib` (2.929 líneas): login, bandeja, detalle, perfil |
| 5 | Máquina de estados compartida | Hecho | `LITE_FLOW`, `LITE_TRANSITIONS`, `canLiteTransition`; validada en servidor en `service.transition` |
| 6 | GPS y seguimiento en tiempo real | Hecho | `tracker.dart`, `shouldTrack`, `trackingIntervalSec`, `dedupePoints`, `isValidPoint`, `geofenceHint`; `SeguimientoLiteTab.tsx` en Central |
| 7 | Navegación y mapa | Hecho | `url_launcher` + `flutter_map`; `POST /assistances/:id/navigation` deja rastro en auditoría |
| 8 | Evidencias (fotos, observaciones, firma) | Hecho | `photos_screen.dart`, `signature_screen.dart`, `connect_assistance_files`, `connect_assistance_signatures` |
| 9 | Finalización y retorno | Hecho | `validateFinish`, `DEFAULT_FINISH_RULES`, estados `returning_to_workshop` y `at_workshop` |
| 10 | Modo offline | Hecho (parcial) | `queue.dart` + `connect_lite_actions` (idempotencia por `clientActionId`). **Fotos y firma no se encolan** |
| 11 | KPIs y auditoría | Hecho | `computeLiteKpis`, `statusQualityScore`, `connect_audit_logs` con `actorType = 'lite'` |
| 12 | Pruebas, endurecimiento y lanzamiento | En curso | Bloques A y B hechos; C a G pendientes |

Cobertura de pruebas actual: 23 pruebas unitarias de reglas de dominio
(`liteRules.test.ts`), dentro de las 310 del repositorio. No hay pruebas de
integración ni end-to-end.

---

## 2. Lo que falta de verdad

Siete huecos, ordenados por lo que bloquea a lo que mejora. Los tres primeros
impiden que Lite se pueda usar en la calle; los demás son deuda declarada.

### H1. La aplicación no se puede compilar — RESUELTO

> Cerrado por el bloque A. Se describe el problema tal y como estaba porque la
> causa raíz (el `.gitignore`) puede repetirse con la próxima app.


`lite_app/` contiene `lib/`, `pubspec.yaml` y `pubspec.lock`, y **nada más**. No
hay carpeta `android/` ni `ios/`, así que no hay `AndroidManifest.xml`, ni
`build.gradle`, ni identificador de aplicación, ni iconos, ni permisos
declarados. `flutter build apk` no tiene con qué trabajar.

Consecuencia directa: hoy no existe ningún APK de Lite y no puede existir. Los
permisos de ubicación y cámara que el código pide en tiempo de ejecución no
están declarados en ningún manifiesto.

Tampoco hay workflow de CI: `.github/workflows/` compila Assist y TyreControl,
no Lite.

### H2. Sin notificaciones push — CÓDIGO HECHO, FALTA EL ALTA EN FIREBASE

> El bloque B deja el código puesto en los dos lados. Queda una acción que solo
> puede hacer el dueño de la cuenta: dar de alta `com.mobilink.assist_lite` en
> el proyecto de Firebase y guardar su `google-services.json` como el secret
> `LITE_GOOGLE_SERVICES_BASE64`.


El backend ya envía FCM v1 (`server/core/push.ts`, `litePush.ts`) y guarda el
token del dispositivo. La aplicación **no lo recibe**: no hay `firebase_core` ni
`firebase_messaging` en `pubspec.yaml`, ni `google-services.json`.

Mientras tanto, `inbox_screen.dart` sondea cada 25 segundos. Eso significa que
una asistencia urgente puede tardar hasta 25 segundos en aparecer, sólo si la
aplicación está abierta y en primer plano; con la aplicación cerrada, no llega
nada. Para un producto de asistencia en carretera esto no es aceptable en
producción.

### H3. El seguimiento se detiene con la pantalla bloqueada (bloqueante en la práctica)

`tracker.dart` usa `geolocator` en primer plano. Android detiene la entrega de
posiciones cuando la aplicación pasa a segundo plano un rato o se bloquea la
pantalla, que es exactamente lo que hace un operario mientras conduce. Hace
falta un servicio en primer plano con notificación persistente — que además es
lo que exige la política de Google Play para ubicación en segundo plano, y que
encaja con el requisito de "aviso persistente mientras se comparte ubicación".

### H4. Sin pruebas de integración ni end-to-end

Las reglas puras están cubiertas. El ciclo real (Central asigna → Lite recibe →
estados → GPS → evidencias → firma → cierre → retorno) no se prueba nunca contra
una base de datos. El repositorio no tiene hoy un PostgreSQL de pruebas.

### H5. Fotos y firma no sobreviven a la falta de cobertura

`queue.dart` encola cambios de estado, observaciones, mensajes y posiciones. Las
fotografías y la firma no: se avisa al operario de que no hay conexión. Falta
copiar el binario a almacenamiento persistente y una cola de ficheros aparte.

### H6. El chat es de ida

La aplicación envía mensajes (`sendMessage`) y los lee al sondear (`messages`),
y Central los ve. Lo que falta es que la respuesta de Central llegue como aviso
al operario, que depende de H2.

### H7. iOS no existe

El código Dart es compatible, pero no hay proyecto iOS ni alta en App Store
Connect. El ecosistema hoy sólo publica Android.

---

## 3. Prompt para el cierre de Mobilink Assist Lite

> Copia desde aquí. Está escrito para ejecutarse sobre este repositorio, con el
> estado descrito arriba. Cada bloque termina en algo verificable.

---

### Contexto

Trabajas sobre el monolito Mobilink (Node/Express + React + PostgreSQL en
Supabase, APKs Flutter). **Mobilink Assist Lite ya está implementado**: backend
en `server/connect/lite.ts` y `liteRules.ts`, panel en
`src/modules/connectpro/`, aplicación en `lite_app/`. Las fases 1 a 11 del plan
están cerradas.

Tu trabajo es la fase 12 —pruebas, endurecimiento y lanzamiento— más los huecos
declarados. **No rediseñes lo que existe.** No crees una API paralela, no
dupliques la máquina de estados, no muevas el modelo de datos. Si crees que algo
del diseño actual está mal, dilo y espera respuesta en vez de reescribirlo.

Antes de tocar nada: `git fetch origin main && git pull`, y `bash
scripts/check-versions.sh`.

### Bloque A — Que la aplicación se pueda compilar — HECHO

Es lo primero porque sin esto nada de lo demás se puede probar en un teléfono.

1. Genera el andamiaje de plataforma de `lite_app` con `flutter create
   --platforms=android --org <la que use flutter_app> .` sobre la carpeta
   existente, sin tocar `lib/`.
2. Identificador de aplicación propio, distinto del de Assist. Nombre visible:
   **Mobilink Assist Lite**.
3. Declara en `AndroidManifest.xml` exactamente los permisos que el código usa,
   ni uno más: ubicación precisa, ubicación en segundo plano (justificada),
   cámara, internet. Nada de almacenamiento externo si `image_picker` y
   `path_provider` no lo necesitan en la versión de Android objetivo.
4. Icono y pantalla de arranque de Lite.
5. Añade `.github/workflows/build-lite-apk.yml` siguiendo el patrón exacto de
   `build-assist-apk.yml`: mismo esquema de firma, mismo versionado, misma
   publicación del artefacto.

Verificable: el workflow produce un APK instalable y `flutter analyze` sigue sin
incidencias.

### Bloque B — Notificaciones push reales — HECHO (pendiente el alta en Firebase)

El backend ya envía; falta recibir.

1. Añade `firebase_core` y `firebase_messaging` a `lite_app`, con su
   `google-services.json`. **No metas el fichero en el repositorio**: inyéctalo
   en CI desde un secreto, como se haga ya para otras claves.
2. Registra el token en el alta de dispositivo que ya existe
   (`POST /device`) y renuévalo en `onTokenRefresh`. Un token inválido debe
   desactivarse en `connect_lite_devices`, no reintentarse eternamente.
3. Al tocar la notificación, abre directamente la asistencia, comprobando antes
   que la sesión sigue viva y que el operario tiene acceso a ella.
4. Reduce el sondeo de 25 s a un refresco de respaldo mucho más espaciado; no lo
   quites del todo, porque es la red de seguridad si el push falla.
5. Cubre los avisos que ya contempla el backend: nueva asistencia, modificación,
   cancelación, reasignación y mensaje de Central (esto último cierra H6).

Verificable: con la aplicación cerrada, asignar una asistencia desde Central Pro
hace sonar el teléfono y abrirla lleva a esa asistencia.

### Bloque C — Seguimiento con la pantalla bloqueada

1. Sustituye el seguimiento en primer plano por un servicio en primer plano de
   Android con notificación persistente que diga que se está compartiendo la
   ubicación. Evalúa `flutter_background_geolocation` frente a
   `foreground_service` + `geolocator` y **documenta por qué eliges uno**,
   incluyendo licencia y coste: el primero es de pago.
2. Respeta lo que ya decide `liteRules`: `shouldTrack` y `trackingIntervalSec`
   mandan sobre la frecuencia; no inventes una cadencia nueva en el cliente.
3. El servicio debe arrancar al entrar en `en_route` y pararse al llegar a
   `at_workshop` o al cerrarse la asistencia. Nunca debe seguir vivo sin
   asistencia activa.
4. Comprueba el consumo de batería en un trayecto real de al menos 30 minutos y
   deja el dato medido en la documentación.

Verificable: con el móvil bloqueado en el bolsillo durante un trayecto, Central
Pro ve el rastro continuo, sin huecos mayores que el intervalo configurado.

### Bloque D — Cola de ficheros sin cobertura

Cierra H5 con el mismo patrón que ya usa `queue.dart`.

1. Copia la fotografía o la firma a almacenamiento persistente de la aplicación
   en cuanto se captura, y encola la referencia, no el binario en memoria.
2. Reutiliza `clientActionId` para que el backend siga siendo idempotente: una
   foto reenviada no puede crear dos filas en `connect_assistance_files`.
3. Muestra el estado de cada evidencia: pendiente, subiendo, subida, fallida.
4. Limpia el fichero local sólo cuando el servidor confirma.

Verificable: en modo avión, hacer cuatro fotos y firmar; al recuperar cobertura
todo aparece en Central Pro una sola vez.

### Bloque E — Pruebas de verdad

1. Levanta un PostgreSQL de pruebas (contenedor en CI) y ejecuta contra él
   `initConnect()`. Sin esto no hay pruebas de integración posibles.
2. Integración, sobre base de datos real: Central asigna a un taller Lite → la
   asistencia aparece en la bandeja → aceptar → recorrer los siete estados →
   posiciones GPS → evidencias → firma → cierre → retorno. Comprueba en cada
   paso lo que ve Central, no sólo lo que devuelve la API.
3. Casos que hoy no cubre nadie y que son los que rompen en la calle:
   sin cobertura, GPS denegado, token caducado, mismo cambio de estado enviado
   dos veces, reasignación en mitad del servicio, cancelación mientras el
   operario conduce, y **un taller intentando leer una asistencia de otro**
   (este debe fallar con 403 y quedar en auditoría).
4. Extiende `liteRules.test.ts` con los KPIs que el encargo pide y hoy no
   calcula `computeLiteKpis`: ratio de cancelación, valoración y calidad de
   señal GPS. Si decides que alguno no aplica, dilo y no lo implementes a
   medias.

Verificable: `npm test` en verde, incluyendo los nuevos casos, y CI ejecutando
las pruebas de integración.

### Bloque F — Endurecimiento y observabilidad

1. Revisa `rate limiting` en `/api/connect/lite/*`. Hoy hay bloqueo por intentos
   fallidos de login; comprueba que también lo hay en subida de ficheros y envío
   de posiciones.
2. Monitorización de lo que el encargo pide y hoy no se mide: fallos de API por
   endpoint, posiciones perdidas, notificaciones fallidas, colas offline
   atascadas, conflictos de estado y versiones antiguas de la aplicación en uso.
3. Verifica que en los registros no acaba ningún dato personal, token, firma ni
   documento completo.

### Bloque G — Documentación y entrega

1. Actualiza `docs/mobilink-assist-lite.md`: mueve a "entregado" lo que se
   cierre y deja en "pendiente" lo que quede, sin maquillarlo.
2. Documenta el despliegue de la APK: firma, distribución, y si va por Play
   Store o por MDM.
3. Variables de entorno y secretos nuevos, en `.env.example` y en `render.yaml`.
4. Manual de una página para el taller, ampliando el que ya existe en §10.

### Reglas de trabajo

- Prueba después de cada bloque; no acumules seis bloques sin ejecutar nada.
- No rompas Assist ni Central Pro: son el mismo backend y la misma base de
  datos. Si tocas `service.ts` o `schema.ts`, di qué efecto tiene en los
  talleres FULL.
- Migraciones idempotentes, aplicadas al arrancar. Nada de SQL a mano.
- No des por terminado un bloque con botones sin función, datos simulados o
  estados que no lleguen de verdad a Central Pro.
- Si algo del encargo choca con la infraestructura, dilo antes de implementarlo
  a medias.

### Criterios de aceptación de la fase 12

- Existe un APK de Mobilink Assist Lite instalable, generado por CI.
- Una asistencia asignada desde Central Pro suena en el teléfono con la
  aplicación cerrada.
- El rastro GPS llega completo con la pantalla bloqueada durante un trayecto
  real.
- Fotos y firma hechas sin cobertura acaban en Central Pro, una sola vez.
- El ciclo completo pasa en pruebas de integración contra base de datos.
- Un taller no puede leer ni tocar la asistencia de otro, y el intento queda
  auditado.
- La documentación dice la verdad sobre lo que queda pendiente.

---

## 4. Qué NO se debe reabrir

Estos puntos del encargo ya están resueltos y volver a tocarlos es riesgo puro:

- La máquina de estados y su equivalencia con el core (`LITE_FLOW`, mapeo en
  `service.ts`). Los siete estados del encargo ya existen con esos nombres.
- El modelo de taller FULL/LITE/EXTERNAL como atributo, no como entidad: cambiar
  de producto ya no migra datos, que es justo lo que pide la fase 23.
- La decisión de que Lite no inyecta en el core y `connect_assistances` es la
  única fuente de verdad.
- La idempotencia por `clientActionId`.
- El aislamiento por taller en todas las consultas.
