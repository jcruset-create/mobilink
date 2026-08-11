# Mobilink Assist Lite

Informe técnico, decisiones de arquitectura, plan de implementación y
documentación operativa del producto **Mobilink Assist Lite**: la versión
ligera para talleres colaboradores que reciben asistencias de **Mobilink Assist
Central Pro** sin tener contratado Mobilink Assist completo.

---

## 1. Análisis de la infraestructura existente

### 1.1 Arquitectura encontrada

Monolito Node/Express + React (Vite) + PostgreSQL (Supabase), desplegado en
Render, con APKs Flutter que hablan con el mismo backend.

| Capa | Tecnología | Ubicación |
| --- | --- | --- |
| Backend | Express + TypeScript (tsx), un proceso | `server/index.ts` (~14 000 líneas) + módulos |
| Base de datos | PostgreSQL (Supabase), SQL a pelo con `pg` | `server/db.ts` (core), `server/connect/schema.ts` (Central Pro) |
| Panel web | React 19 + Vite + Tailwind + react-router | `src/modules/*` |
| Central Pro | Módulo propio con API y panel separados | `server/connect/*`, `src/modules/connectpro/*` |
| APKs | Flutter (una por producto) | `flutter_app`, `taller_app`, `toolcontrol_app`, `presencia_app`, `safety_app` |
| Almacenamiento | Supabase Storage (bucket `roadside`) | `server/supabase.ts` |
| Tiempo real | SSE sobre un bus en memoria | `server/connect/bus.ts` → `/api/connect/bo/events` |
| Push | FCM v1 con cuenta de servicio | estaba embebido en `index.ts`; ahora en `server/core/push.ts` |
| Licencias / SaaS | Módulo propio multiempresa | `server/licenses/*`, `server/core/admin.ts` |

### 1.2 Modelo de asistencias (dos capas, ya existentes)

- **Core** (`roadside_assistances`): la asistencia que ve el técnico de un
  taller con Mobilink Assist. Estados en castellano: `pendiente`, `asignada`,
  `en_camino`, `en_punto`, `inicio_reparacion`, `finalizada`,
  `en_camino_base`, `llegada_taller`, `cancelada`.
- **Central Pro** (`connect_assistances`): la asistencia del centro de control,
  con partner, cliente, SLA, coste, incidencias, comunicaciones y un historial
  append-only (`connect_status_history`). Estados en inglés.

`server/connect/service.ts` es el corazón: máquina de estados (`transition`),
motor de asignación con scoring, inyección al core (`injectIntoCore`) y
sincronización core → Connect (`syncFromCore`, cada pocos segundos).

### 1.3 Talleres y tipos de integración

`connect_workshops.integrationType` ya distinguía dos productos:

- `assist`: taller con Mobilink Assist → la asistencia se **inyecta** en
  `roadside_assistances` y los estados se sincronizan solos.
- `external`: taller sin digitalizar → Central actualiza los estados a mano
  (`POST /assistances/:id/manual-status`).

**Este es exactamente el eje donde encaja Lite**, sin inventar un modelo nuevo.

### 1.4 Autenticación

Tres esquemas coexistentes, todos reutilizables:

1. **Sesión unificada Supabase** para el panel web (`server/core/auth.ts` →
   `authenticate`), con roles Connect en `connect_users` (`rbac.ts`).
2. **API key de partner** (`mkc_live_...`, hash SHA-256) para la API B2B.
3. **Cabeceras de operario** en las APKs (`x-roadside-operator-name` +
   código, `x-presencia-employee` + PIN).

### 1.5 Componentes reutilizables detectados

| Necesidad de Lite | Se reutiliza |
| --- | --- |
| Modelo de asistencia | `connect_assistances` (sin duplicar) |
| Máquina de estados | `service.ts / transition()` |
| Historial y KPIs | `connect_status_history` |
| Auditoría | `connect_audit_logs` |
| Alertas y SLA | `connect_alerts`, worker de SLA |
| Comunicaciones | `connect_communications` |
| Tiempo real | `bus.ts` (SSE al panel) |
| Almacenamiento | bucket `roadside` de Supabase |
| Push | FCM v1 (extraído a `server/core/push.ts`) |
| Mapas panel | Leaflet / react-leaflet |
| Mapas APK | `flutter_map` + `latlong2` |
| Patrón de APK | `flutter_app` (geolocator, signature, hive, image_picker) |

### 1.6 Riesgos técnicos e incompatibilidades detectadas

| # | Riesgo | Tratamiento |
| --- | --- | --- |
| R1 | `finished` era terminal en Connect; faltaban "vuelta al taller" y "en taller" | Se amplía la máquina de estados y se acota el polling de `syncFromCore` a 48 h para no arrastrar asistencias cerradas |
| R2 | El core mapeaba `en_camino_base` y `llegada_taller` a `finished`: se perdía el final del ciclo también para talleres FULL | Corregido: ahora mapean a los estados nuevos |
| R3 | Los operarios de un taller colaborador no pueden tener cuenta Supabase | Actor propio (`connect_lite_users`) con PIN derivado por PBKDF2, igual que `techs` en el core |
| R4 | Sin cobertura en carretera | Cola local idempotente + `POST /sync` + conflictos visibles |
| R5 | Reloj del dispositivo manipulable | Los KPIs usan **siempre** marcas del servidor; la hora del dispositivo se guarda como dato y se avisa del desfase en el historial |
| R6 | Fuga de datos entre talleres | Toda consulta filtra por `workshopId` de la sesión; los operarios solo ven lo suyo o lo no asignado |
| R7 | Las APKs del ecosistema aún no integran Firebase | Resuelto: la app integra `firebase_messaging` y el sondeo se queda de red de seguridad. Falta el alta en Firebase, ver §9 |
| R8 | Privacidad del seguimiento | Solo se rastrea en asistencia activa y en estados concretos; validado en cliente **y** servidor |

---

## 2. Decisiones de arquitectura

1. **Lite no inyecta al core.** `connect_assistances` es la única fuente de
   verdad. Un taller colaborador no debe generar filas en el core de otra
   empresa. La APK habla con Central Pro directamente.
2. **Los estados son los mismos.** Se amplía la máquina de Connect en lugar de
   crear un juego paralelo, de modo que FULL, LITE y EXTERNAL producen la misma
   línea temporal y los mismos KPIs.
3. **El producto es un atributo del taller, no una entidad nueva.**
   `integrationType` ∈ `assist | lite | external` → `FULL | LITE | EXTERNAL`.
   Cambiarlo no migra datos: el taller conserva id, historial, KPIs, operarios,
   valoraciones y documentos.
4. **Reglas puras separadas del transporte.** `server/connect/liteRules.ts` no
   importa la base de datos: se prueba con Vitest y documenta el contrato que
   la APK replica en local.
5. **Idempotencia en todo lo que la APK puede reenviar.** `clientActionId` +
   `connect_lite_actions`.
6. **Minimización de datos.** La APK recibe lo justo; el push solo lleva
   identificadores; `externalMetadata` del partner nunca sale de Central.

---

## 3. Cambios de base de datos

Todas las migraciones son idempotentes y se ejecutan solas al arrancar
(`initConnect()`); **no hay que ejecutar SQL a mano**.

### Columnas nuevas en tablas existentes

| Tabla | Columna | Para qué |
| --- | --- | --- |
| `connect_workshops` | `liteCode` (único) | Código que el operario teclea en la app |
| | `liteSettings` | Geovallas, reglas de cierre, privacidad del seguimiento |
| | `features` | Feature flags por taller |
| `connect_assistances` | `liteUserId`, `liteUserName` | Operario responsable |
| | `acceptedAtMs` | KPI de aceptación |
| | `operatorLat/Lng/AccuracyM/SpeedKmh/LocationAtMs` | Última posición conocida |
| | `resultCode`, `resolutionNotes`, `odometerKm`, `workedMinutes` | Cierre reportado |

### Tablas nuevas

| Tabla | Contenido |
| --- | --- |
| `connect_lite_users` | Operarios y administradores del taller (PIN con PBKDF2 + sal) |
| `connect_lite_devices` | Dispositivos, sesión (hash del token), permisos, token push, versión de la app y estado de su cola offline |
| `connect_assistance_tracks` | Rastro GPS con precisión, velocidad, rumbo y estado |
| `connect_assistance_files` | Evidencias con categoría, MIME, tamaño, SHA-256 y coordenadas |
| `connect_assistance_signatures` | Firma, firmante, documento y consentimiento |
| `connect_lite_actions` | Idempotencia de operaciones de la APK (se caducan a los 30 días) |
| `connect_counters` | Contadores correlativos (nº de expediente) |

---

## 4. Máquina de estados

```
assigned → technician_assigned → en_route → arrived → in_progress → finished
                                                 ↘ finished (sin intervención)
finished → returning_to_workshop → at_workshop     (opcional)
```

| Connect | Core (Assist) | APK Lite |
| --- | --- | --- |
| `assigned` | `pendiente` | Recibida |
| `technician_assigned` | `asignada` | Asignada |
| `en_route` | `en_camino` | En camino |
| `arrived` | `en_punto` | En punto |
| `in_progress` | `inicio_reparacion` | Trabajando |
| `finished` | `finalizada` | Finalizada |
| `returning_to_workshop` | `en_camino_base` | Vuelta al taller |
| `at_workshop` | `llegada_taller` | En taller |

Las transiciones se validan **en el servidor** (`liteRules.canLiteTransition` +
`service.transition`). No se puede saltar estados. Central Pro puede corregir
un estado con `POST /assistances/:id/manual-status`, y queda auditado con el
actor y el nivel de producto del taller.

Cada cambio registra: estado anterior y nuevo, hora del **servidor**, hora del
dispositivo (y su desfase si supera 2 min), usuario, taller, asistencia,
dispositivo, coordenadas, precisión, origen (`manual` / `geofence` / `offline`)
y observaciones.

---

## 5. API

Base: `/api/connect/lite` — `Authorization: Bearer lite_<64 hex>`.
El listado completo está en [`lite_app/README.md`](../lite_app/README.md).

Idempotencia (`clientActionId`) en: cambios de estado, aceptación, rechazo,
observaciones, mensajes, fotografías, firma, cierre y sincronización offline.

Eventos de dominio: se publican sobre la infraestructura existente
(`connect_status_history` + `bus.ts` + webhooks de partner), sin crear un
sistema paralelo. `AssistanceStatusChanged` equivale a `assistance.<estado>`,
que ya viajaba a los partners por webhook.

---

## 6. KPIs

Se calculan en el backend con marcas de tiempo del servidor
(`liteRules.computeLiteKpis`), iguales para FULL, LITE y EXTERNAL:

asignación→aceptación, aceptación→en camino, desplazamiento,
asignación→llegada, espera en punto, tiempo de trabajo, tiempo total, vuelta al
taller, ciclo completo, cumplimiento de SLA, ratio de aceptación y rechazo,
servicios finalizados y no resueltos, y **calidad de actualización de estados**
(penaliza cada corrección manual de Central).

Consulta: `GET /api/connect/bo/workshops/:id/kpis?days=30` y, por servicio,
`GET /api/connect/bo/assistances/:id/lite`.

---

## 7. Seguridad y privacidad

- Token opaco por dispositivo; solo se guarda su hash. PIN con PBKDF2
  (60 000 iteraciones) + sal por usuario.
- Bloqueo tras 10 intentos fallidos por IP+usuario en 15 minutos, y un límite
  de 40 intentos por IP cada 5 minutos con acierto o sin él, que es lo que
  frena el sondeo de usuarios.
- **Límites de uso en toda la API**, no solo en el login: ventana deslizante
  por dispositivo con topes por familia (120 posiciones/min, 20 lotes/min,
  60 fotografías/5 min, 20 firmas/5 min, 60 mensajes/min, 30 sincronizaciones
  /min, 60 cambios de estado/min) y un tope general de 900/min. Al superarlos
  se responde `429` con `Retry-After`. Los topes están alrededor de diez veces
  por encima del uso real de un operario: frenan una APK en bucle, no a nadie
  trabajando. Los rechazos no cuentan para la ventana, así que insistir no
  alarga el bloqueo.
- Aislamiento por taller en **todas** las consultas; un operario solo actúa
  sobre sus asistencias o sobre las aún no asignadas de su taller.
- Desactivar un usuario o cambiarle el PIN revoca sus sesiones abiertas.
- Subidas: whitelist de MIME, 12 MB, normalización con `sharp`, SHA-256 de
  integridad y ruta de almacenamiento no adivinable.
- Seguimiento GPS solo durante asistencia activa y en los estados definidos.
  Mientras dura, un servicio en primer plano muestra un aviso permanente que no
  se puede ocultar: nadie comparte su posición sin saberlo. Al detenerse el
  seguimiento, el aviso desaparece.
- No se pide `ACCESS_BACKGROUND_LOCATION`. El servicio arranca con la app en
  primer plano —el operario acaba de pulsar "En camino"—, y en ese caso Android
  permite seguir recibiendo posiciones con el permiso de "mientras se usa la
  app". Pedir el de segundo plano obligaría a pasar la revisión aparte de
  Google Play sin ganar nada.
- Auditoría en `connect_audit_logs` con `actorType = 'lite'`: login (y login
  fallido), logout, aceptación, rechazo, cambios de estado, correcciones,
  navegación abierta, evidencias añadidas y eliminadas, firma, observaciones,
  mensajes, sincronizaciones y revocación de dispositivos.

### Datos personales en registros y retención

Revisado en el bloque F. Tres sitios filtraban datos a los registros del
servidor y se han corregido:

- el cuerpo de error de la Routes API de Google repite origen y destino, es
  decir dónde está el cliente averiado;
- el `error_message` del geocodificador repite la dirección consultada;
- el objeto de error de `fetch` en los envíos push arrastra la petición
  entera, y ahí viaja el token del dispositivo.

Ahora se registra solo el código de estado o el mensaje. El resto de trazas de
Connect y Lite ya registraban únicamente `error.message`.

`connect_lite_actions` guarda la respuesta completa de cada operación para que
reenviarla sea idempotente, y esa respuesta incluye nombre y teléfono del
cliente. Su razón de ser es que una APK sin cobertura reintente, cosa que
ocurre en horas: **se caducan a los 30 días** (`purgeLiteActions`, que ejecuta
el worker una vez por hora).

Pendiente conocido: las evidencias y las firmas se guardan en el bucket con URL
pública no adivinable. Es el mismo esquema que usa Mobilink Assist para el
resto de asistencias; cambiarlo a URL firmadas afecta a todo el ecosistema y no
se ha tocado aquí.

---

## 8. Observabilidad

Central Pro → **Salud de Assist Lite** (`/api/connect/bo/lite/health`, rol
`analyst` o superior). Reúne lo que el encargo pide vigilar:

| Qué | De dónde sale |
| --- | --- |
| Fallos de API por endpoint, con p50 y p95 | Contadores del proceso, última hora |
| Posiciones descartadas por inválidas | Contadores del proceso |
| Avisos push que no llegan a ningún dispositivo | Contadores del proceso |
| Conflictos de estado de la cola offline, por taller | Contadores del proceso |
| Colas offline atascadas, por dispositivo | La APK las informa en `POST /device` |
| Versiones de la APK en uso | `connect_lite_devices.appVersion` |
| Dispositivos activos sin token push | `connect_lite_devices` |
| Servicios activos sin señal de GPS (>15 min) | `connect_assistances` |

Dos advertencias que la propia página muestra:

- Los contadores viven **en memoria del proceso**: un despliegue los pone a
  cero y, con más de una instancia en Render, cada una lleva los suyos. Para el
  histórico persistente está la auditoría.
- Un `429` se cuenta como freno, no como fallo. Si contara como error, el
  propio límite de uso dispararía alarmas falsas.

Las métricas son agregadas por endpoint y por taller: **no guardan ningún dato
de cliente**, ni identificadores de asistencia. La etiqueta de endpoint usa el
patrón de ruta (`POST /assistances/:id/files`), no la URL real.

---

## 9. Estado de la implementación

### Entregado y verificado

- Máquina de estados ampliada, mapeo del core corregido y sincronización acotada.
- Esquema completo de Lite (migraciones idempotentes).
- API `/api/connect/lite` completa (sesión, bandeja, estados, GPS, evidencias,
  firma, cierre, mensajes, offline, historial).
- Gestión desde Central Pro: nivel de producto por taller, código Lite,
  operarios, dispositivos, revocación de sesiones, KPIs agregados.
- Pestaña **Seguimiento** en la ficha: mapa con el rastro, posición del
  operario con aviso de "desactualizada", estado del dispositivo y sus
  permisos, evidencias, firma, cierre y KPIs; corrección de estados auditada.
- APK `lite_app` completa (`flutter analyze` sin incidencias).
- Andamiaje Android de `lite_app` (`android/`), con identificador propio
  `com.mobilink.assist_lite`, los permisos que el código usa, icono y tema de
  arranque oscuro. Antes no existía: la regla `*/android/` del `.gitignore` lo
  descartaba en silencio y por eso la APK no se podía compilar.
- Workflow `build-lite-apk.yml`: compila, firma con la clave de la casa,
  comprueba que no salga firmada en depuración y publica la release
  `assist-lite-vX.Y.Z+N`. Alta en el centro de descargas (`/descargas.html`).
- **Push (bloque B)**: `lite_app/lib/services/push.dart`, registro y refresco
  de token, avisos de asignación, cancelación y mensaje de Central. El código
  está completo en los dos lados; falta el alta en Firebase (ver pendientes).
- **Cola de evidencias sin cobertura (bloque D)**: fotografías y firma se
  copian a almacenamiento persistente de la app y se suben solas al recuperar
  señal, con el mismo `clientActionId`, así que nunca se duplican. Antes se le
  pedía al operario que repitiera la foto más tarde.
- **Pruebas de integración contra PostgreSQL real (bloque E)**: 22 casos que
  recorren el ciclo completo por HTTP contra el router real, más el workflow
  `tests.yml` con un contenedor de PostgreSQL desechable y un guardián que
  falla si las de integración no llegan a ejecutarse.
- **Seguimiento con la pantalla bloqueada (bloque C)**: el flujo de posiciones
  se arranca como servicio en primer plano de Android, con notificación
  persistente "Compartiendo ubicación durante la asistencia". Lo levanta el
  propio `geolocator` (`GeolocatorLocationService`, ya declarado con
  `foregroundServiceType="location"`), así que **no hace falta ninguna
  dependencia de pago**. Un vigilante reabre el flujo si se cae. Sin esto,
  Android dejaba de entregar posiciones a los pocos minutos de bloquear la
  pantalla y el rastro llegaba a Central con agujeros.
- **Endurecimiento y observabilidad (bloque F)**: límites de uso, página de
  salud, revisión de datos personales en registros y retención de
  `connect_lite_actions` (todo detallado en §7 y §8).
- **Typecheck del servidor** (`tsconfig.server.json`, sobre `server/connect`):
  el backend se ejecuta con `tsx`, que borra los tipos sin comprobarlos, así
  que hasta ahora un error de tipos en `server/` llegaba a producción.
- Pruebas: 88 unitarias del módulo Connect —23 de reglas de Lite, 7 de límites,
  10 de métricas, 18 de importación de talleres, 11 de catálogo y 19 de
  búsqueda geográfica— más las 22 de integración.

### Pendiente (declarado, no oculto)

1. **Notificaciones push: falta el alta en Firebase.** El código está completo
   en los dos lados. Lo que falta es dar de alta `com.mobilink.assist_lite` en
   el proyecto de Firebase, guardar su `google-services.json` como secret
   `LITE_GOOGLE_SERVICES_BASE64` en GitHub, y poner `FIREBASE_SERVICE_ACCOUNT`
   en Render. Hasta entonces la APK se compila igual, sin avisos, y la app lo
   dice en Perfil. **Es trabajo de administración, no de programación.**
2. **El servicio en primer plano no sobrevive a que Android mate la
   actividad.** Es la limitación conocida del enfoque gratuito: mantiene el
   seguimiento con la pantalla bloqueada y la app en segundo plano, que es el
   caso real, pero si el sistema destruye la actividad por falta de memoria el
   flujo muere. El vigilante lo reabre en cuanto la app vuelve, y el rastro
   perdido en ese hueco no se recupera. La alternativa que sí lo cubre es un
   servicio con motor Flutter propio (`flutter_background_geolocation`, de
   pago). Conviene comprobar en un trayecto real si el hueco llega a darse.
3. **El estado de la cola offline aún no llega de los móviles instalados.** El
   backend y la página de salud están listos; la APK lo empieza a informar a
   partir de la próxima versión compilada. Hasta entonces la tabla de colas
   atascadas sale vacía, que **no es lo mismo que "todo bien"**.
4. **iOS.** El código es compatible, pero el ecosistema solo publica Android
   hoy; falta el alta en App Store Connect.
5. **Prueba end-to-end con dispositivo real.** Las de integración cubren el
   ciclo por HTTP contra base de datos; el recorrido físico con un móvil
   (push recibido con la app cerrada, GPS durante un trayecto, fotos sin
   cobertura) no se ha hecho todavía y depende de los puntos 1 y 2.
6. **Chat bidireccional.** El taller escribe y Central lo lee; la respuesta de
   Central llega ya como aviso push, pero no hay hilo de conversación en la
   ficha del operario.

---

## 10. Despliegue

No hay pasos manuales de base de datos: al desplegar, `initConnect()` crea
tablas y columnas nuevas. Todas las migraciones son idempotentes.

### Variables de entorno

| Variable | Uso | ¿Obligatoria? |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL | Sí |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Storage y auth | Sí |
| `SUPABASE_ROADSIDE_BUCKET` | Bucket de evidencias (por defecto `roadside`) | No |
| `FIREBASE_SERVICE_ACCOUNT` | JSON de la cuenta de servicio, en una línea | Solo para push |
| `FIREBASE_PROJECT_ID` | Proyecto FCM si difiere del JSON | No |
| `GOOGLE_MAPS_API_KEY` | Geocodificación y ETAs por carretera | No |

Todas están en `.env.example` y en `render.yaml` con `sync: false`, es decir
que su valor se pega en el dashboard de Render y nunca entra en el repositorio,
**que es público**.

Secretos de GitHub Actions que usa el workflow de la APK:

| Secret | Uso |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Firma de la APK con la clave de la casa |
| `LITE_GOOGLE_SERVICES_BASE64` | `google-services.json` de `com.mobilink.assist_lite` |

Sin el keystore el workflow compila pero no publica release; sin el
`google-services.json` publica una APK **sin notificaciones**, y avisa de ello
en el resumen del build y en la pantalla de Perfil de la app.

### Distribución de la APK: firma y reparto

- **Firma**: clave de la casa (el mismo keystore que el resto de APKs de
  Mobilink), inyectada en CI desde secretos. Ni el keystore ni
  `key.properties` ni `google-services.json` están en el repositorio: están en
  `.gitignore` porque el repositorio es público. El workflow comprueba
  explícitamente que la APK no salga firmada en depuración.
- **Reparto: fuera de Play Store, por descarga directa.** Cada build publica
  una release `assist-lite-vX.Y.Z+N` y el centro de descargas
  (`/descargas.html`) sirve siempre la última. El taller instala desde ahí
  habilitando "orígenes desconocidos" una sola vez.
- **Por qué no Play Store, hoy**: es una aplicación de uso interno para
  talleres colaboradores, no para público general, y publicar en Play exige
  ficha, política de privacidad publicada y —en cuanto se active el
  seguimiento con pantalla bloqueada— la revisión de permiso de ubicación en
  segundo plano, que Google somete a un proceso aparte. La alternativa
  ordenada cuando haga falta es **Google Play con distribución interna
  (internal app sharing o canal cerrado)**, no la ficha pública.
- **MDM**: no se usa ninguno. Si algún grupo (por ejemplo Grupo Soledad) tiene
  su propio MDM, la APK firmada se le puede entregar para que la distribuya
  por su canal; no requiere ningún cambio.
- **Actualizaciones**: no hay actualización automática. La versión que informa
  cada dispositivo se ve en **Salud de Assist Lite**, y por ahí se detecta
  quién se ha quedado atrás.

### Alta de un taller Lite

1. Central Pro → **Talleres** → producto **Mobilink Assist Lite**.
   Se genera automáticamente el **código de taller** (p. ej. `TALLERSUR-7431`).
2. **Gestionar Lite** → añadir usuarios (nombre, usuario, PIN de 4-8 dígitos,
   rol operario o administrador del taller).
3. Entregar al taller: código, usuario y PIN, y el enlace de descarga del APK.
4. Asignarle asistencias como a cualquier otro taller de la red.

---

## 11. Manual para el taller

> Una página. Se puede imprimir y entregar con el código de taller.

### Antes de empezar

- **Instalar**: abrir el enlace de descarga que ha dado la central, permitir la
  instalación desde el navegador e instalar el APK.
- **Permisos**: al primer arranque la app pide **ubicación** y **cámara**. En
  ubicación basta con *Mientras se usa la app*: durante el servicio aparece un
  aviso permanente en la barra de notificaciones y el rastro sigue llegando
  aunque se bloquee la pantalla. También hay que aceptar las
  **notificaciones**: es como suena el aviso de una asistencia nueva.
- **Batería**: si el móvil tiene ahorro de energía agresivo (Xiaomi, Huawei,
  Samsung), excluir la app de la optimización de batería. Si no, Android la
  duerme y deja de reportar.

### El día a día

1. **Entrar**: código de taller, usuario y PIN.
2. **Pendientes**: aparecen las asistencias que envía la central. Abrir y
   pulsar **Aceptar**, o **Rechazar** indicando el motivo. Si no se acepta a
   tiempo, la central la ofrece a otro taller.
3. **En camino**: al pulsarlo empieza a compartirse la ubicación con la
   central y aparece el aviso permanente "Compartiendo ubicación durante la
   asistencia". **No se puede quitar mientras dura el servicio, y es a
   propósito**: es la garantía de que nadie comparte su posición sin saberlo.
   Desde ahí se abre la navegación hacia el punto.
4. **En punto**: al llegar, la app lo sugiere sola si el GPS es fiable; el
   operario confirma.
5. **Trabajando**: hacer las fotografías por categoría (vehículo, daños,
   trabajo, documentación) y añadir observaciones. Cuantas más, menos
   discusiones después.
6. **Finalizar**: indicar el resultado, la observación de resolución y, si el
   taller lo exige, la firma del cliente, las fotos mínimas o los kilómetros.
   Si falta algo, la app dice exactamente qué.
7. **Vuelta al taller** y **En taller**: cierran el ciclo. Al llegar se detiene
   el seguimiento y deja de consumirse batería.

### Sin cobertura

Se puede seguir trabajando con normalidad: cambios de estado, observaciones,
fotografías y firma se guardan en el móvil y se envían solos al recuperar
señal, una sola vez. En la bandeja aparece cuántas cosas quedan por enviar.

Si la central había cambiado la asistencia mientras tanto, la app **avisa del
conflicto en lugar de sobrescribir**: entonces hay que mirar cuál es el estado
bueno.

### Cuándo llamar a la central

- El vehículo no está donde dice la asistencia, o no se localiza.
- Hace falta autorización para algo que no estaba previsto.
- La app dice "sesión caducada o revocada": la central la ha cerrado y hay que
  volver a entrar.
- Quedan evidencias sin enviar y ya han pasado horas con cobertura.

### Privacidad

La ubicación se comparte **solo durante una asistencia activa** y en los
estados de camino, trabajo y vuelta. Fuera de eso, la app no envía posición: al
llegar al taller el seguimiento se detiene y el aviso desaparece de la barra de
notificaciones, que es la señal de que ya no se está compartiendo nada.

---

## 12. Archivos añadidos o modificados

**Backend**

- `server/connect/liteRules.ts` *(nuevo)* — reglas puras.
- `server/connect/liteRules.test.ts` *(nuevo)* — 23 pruebas.
- `server/connect/lite.ts` *(nuevo)* — API de la APK.
- `server/connect/litePush.ts` *(nuevo)* — avisos a dispositivos del taller.
- `server/connect/liteLimits.ts` + `.test.ts` *(nuevos)* — límites de uso.
- `server/connect/liteMetrics.ts` + `.test.ts` *(nuevos)* — métricas.
- `server/connect/lite.integration.test.ts` *(nuevo)* — ciclo completo contra
  PostgreSQL real.
- `server/core/push.ts` *(nuevo)* — FCM v1 compartido.
- `server/connect/schema.ts` — tablas y columnas de Lite.
- `server/connect/service.ts` — estados nuevos, mapeo del core, sin inyección
  para talleres Lite, push al asignar y al cancelar, nº de expediente automático.
- `server/connect/backoffice.ts` — gestión de talleres Lite, usuarios,
  dispositivos, seguimiento, KPIs y `/lite/health`.
- `server/connect/worker.ts` — caducidad horaria de `connect_lite_actions`.
- `server/connect/index.ts` — monta `/api/connect/lite`.
- `server/db.ts` — arreglos de esquema (ver nota más abajo).

**Panel Central Pro**

- `src/modules/connectpro/types.ts` — estados y niveles de producto.
- `src/modules/connectpro/pages/Talleres.tsx` — producto por taller y panel Lite.
- `src/modules/connectpro/pages/FichaAsistencia.tsx` — pestaña Seguimiento.
- `src/modules/connectpro/pages/SaludLite.tsx` *(nuevo)* — página de salud.
- `src/modules/connectpro/components/SeguimientoLiteTab.tsx` *(nuevo)*.

**APK**

- `lite_app/` *(nuevo)* — aplicación Flutter completa, con `android/`,
  `services/push.dart` y `services/file_queue.dart`.

**Infraestructura**

- `.github/workflows/build-lite-apk.yml` *(nuevo)* — compila, firma y publica.
- `.github/workflows/tests.yml` *(nuevo)* — pruebas con PostgreSQL desechable.
- `tsconfig.server.json` *(nuevo)* — typecheck del backend.

**Nota sobre `server/db.ts`.** Las pruebas de integración destaparon dos fallos
que no eran de Lite y afectaban a todo el proyecto: `initDb()` hacía `ALTER
TABLE` de `whatsapp_capture_messages` antes de crearla, y la tabla `payments`
no la creaba nadie desde el código —existía solo en la base de producción,
hecha a mano en su día—. Con las dos cosas, **el proyecto no se podía levantar
desde cero**. En la base que ya existe los arreglos son un no-op.

---

## 13. Recomendaciones para siguientes versiones

1. Cerrar el alta en Firebase y comprobar el push de extremo a extremo con un
   móvil real.
2. Si en un trayecto real se ve que Android llega a matar la actividad y el
   rastro se corta, valorar `flutter_background_geolocation` (de pago), que
   levanta un motor Flutter propio y sobrevive a eso. Hoy no está justificado
   pagarlo sin haberlo medido.
3. Persistir las métricas de salud: hoy se pierden en cada despliegue. Un
   volcado horario a una tabla bastaría para tener tendencia.
4. Ampliar `tsconfig.server.json` al resto de `server/` según se vayan
   arreglando los errores de tipos que arrastra.
5. Portal web Lite para el administrador del taller (misma API, sin instalar
   nada) para asignar operarios desde un ordenador.
6. Autoconversión LITE → FULL guiada desde Central, aprovechando que el cambio
   ya no requiere migración de datos.
7. Firma con sello de tiempo cualificado si algún cliente lo exige por contrato.
