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
| R7 | Las APKs del ecosistema aún no integran Firebase | El backend ya envía push; la app sondea cada 25 s hasta que se añada `firebase_messaging` (pendiente, ver §8) |
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
| `connect_lite_devices` | Dispositivos, sesión (hash del token), permisos y token push |
| `connect_assistance_tracks` | Rastro GPS con precisión, velocidad, rumbo y estado |
| `connect_assistance_files` | Evidencias con categoría, MIME, tamaño, SHA-256 y coordenadas |
| `connect_assistance_signatures` | Firma, firmante, documento y consentimiento |
| `connect_lite_actions` | Idempotencia de operaciones de la APK |
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
- Bloqueo tras 10 intentos fallidos por IP+usuario en 15 minutos.
- Aislamiento por taller en **todas** las consultas; un operario solo actúa
  sobre sus asistencias o sobre las aún no asignadas de su taller.
- Desactivar un usuario o cambiarle el PIN revoca sus sesiones abiertas.
- Subidas: whitelist de MIME, 12 MB, normalización con `sharp`, SHA-256 de
  integridad y ruta de almacenamiento no adivinable.
- Seguimiento GPS solo durante asistencia activa y en los estados definidos;
  la app muestra permanentemente que está compartiendo ubicación.
- Auditoría en `connect_audit_logs` con `actorType = 'lite'`: login (y login
  fallido), logout, aceptación, rechazo, cambios de estado, correcciones,
  navegación abierta, evidencias añadidas y eliminadas, firma, observaciones,
  mensajes, sincronizaciones y revocación de dispositivos.

---

## 8. Estado de la implementación

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
  `com.mobilink.assist_lite`, los permisos que el codigo usa, icono y tema de
  arranque oscuro. Antes no existia: la regla `*/android/` del `.gitignore` lo
  descartaba en silencio y por eso la APK no se podia compilar.
- Workflow `build-lite-apk.yml`: compila, firma con la clave de la casa,
  comprueba que no salga firmada en depuracion y publica la release
  `assist-lite-vX.Y.Z+N`.
- Alta en el centro de descargas (`/descargas.html`).
- 23 pruebas unitarias de las reglas de dominio (`npm test`).

### Pendiente (declarado, no oculto)

1. **Notificaciones push: falta el alta en Firebase.** El código ya está en los
   dos lados (backend con FCM v1 y app con `firebase_core` +
   `firebase_messaging`). Lo que falta es dar de alta la app
   `com.mobilink.assist_lite` en el proyecto de Firebase y guardar su
   `google-services.json` como secret `LITE_GOOGLE_SERVICES_BASE64`. Hasta
   entonces la APK se compila igual, sin avisos, y la app lo dice en Perfil.
2. **Pruebas de integración y end-to-end.** Las reglas están cubiertas con
   tests unitarios; el flujo completo contra base de datos requiere levantar
   un Postgres de pruebas, que hoy el repositorio no tiene.
3. **Seguimiento en segundo plano con pantalla bloqueada.** `geolocator`
   funciona en primer plano y con la app en segundo plano reciente; para
   garantizarlo con el móvil bloqueado hace falta un servicio en primer plano
   Android (`flutter_background_geolocation` o `foreground_service`).
4. **iOS.** El código es compatible, pero el ecosistema solo publica Android
   hoy; falta el alta en App Store Connect.
5. **Reintento automático de fotos y firma sin cobertura.** Hoy se avisa
   claramente al operario en lugar de encolarlas (requiere copiar el binario a
   almacenamiento persistente y una cola de archivos aparte).

---

## 9. Despliegue

No hay pasos manuales de base de datos: al desplegar, `initConnect()` crea
tablas y columnas nuevas.

### Variables de entorno

Todas ya existían salvo las dos últimas, opcionales:

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | PostgreSQL |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Storage y auth |
| `SUPABASE_ROADSIDE_BUCKET` | Bucket de evidencias (por defecto `roadside`) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON de la cuenta de servicio para push |
| `FIREBASE_PROJECT_ID` | *(opcional)* proyecto FCM si difiere del JSON |

### Alta de un taller Lite

1. Central Pro → **Talleres** → producto **Mobilink Assist Lite**.
   Se genera automáticamente el **código de taller** (p. ej. `TALLERSUR-7431`).
2. **Gestionar Lite** → añadir usuarios (nombre, usuario, PIN de 4-8 dígitos,
   rol operario o administrador del taller).
3. Entregar al taller: código, usuario y PIN, y el APK.
4. Asignarle asistencias como a cualquier otro taller de la red.

---

## 10. Manual básico para el taller

1. **Entrar**: código de taller, usuario y PIN. Aceptar el permiso de
   ubicación (mejor "permitir siempre") y el de cámara.
2. **Pendientes**: aparecen las asistencias que envía la central. Abrir y
   pulsar **Aceptar** (o **Rechazar** indicando el motivo).
3. **En camino**: al pulsarlo empieza a compartirse la ubicación con la
   central. Se puede abrir la navegación hacia el punto.
4. **En punto**: al llegar, la app lo sugiere sola si el GPS es fiable; el
   operario confirma.
5. **Trabajando**: hacer fotografías por categoría y añadir observaciones.
6. **Finalizar**: indicar resultado, observación de resolución y, si el taller
   lo exige, firma del cliente, fotos mínimas o kilómetros.
7. **Vuelta al taller** y **En taller**: cierran el ciclo. Al llegar se detiene
   el seguimiento.

Sin cobertura se puede seguir trabajando: los cambios se guardan y se envían
solos al recuperar señal. Si la central ya había cambiado la asistencia, la app
avisa del conflicto en lugar de sobrescribir.

---

## 11. Archivos añadidos o modificados

**Backend**

- `server/connect/liteRules.ts` *(nuevo)* — reglas puras.
- `server/connect/liteRules.test.ts` *(nuevo)* — 23 pruebas.
- `server/connect/lite.ts` *(nuevo)* — API de la APK.
- `server/connect/litePush.ts` *(nuevo)* — avisos a dispositivos del taller.
- `server/core/push.ts` *(nuevo)* — FCM v1 compartido.
- `server/connect/schema.ts` — tablas y columnas de Lite.
- `server/connect/service.ts` — estados nuevos, mapeo del core, sin inyección
  para talleres Lite, push al asignar, nº de expediente automático.
- `server/connect/backoffice.ts` — gestión de talleres Lite, usuarios,
  dispositivos, seguimiento y KPIs.
- `server/connect/index.ts` — monta `/api/connect/lite`.

**Panel Central Pro**

- `src/modules/connectpro/types.ts` — estados y niveles de producto.
- `src/modules/connectpro/pages/Talleres.tsx` — producto por taller y panel Lite.
- `src/modules/connectpro/pages/FichaAsistencia.tsx` — pestaña Seguimiento.
- `src/modules/connectpro/components/SeguimientoLiteTab.tsx` *(nuevo)*.

**APK**

- `lite_app/` *(nuevo)* — aplicación Flutter completa.

---

## 12. Recomendaciones para siguientes versiones

1. Integrar Firebase en todas las APKs a la vez y aprovechar el push ya
   preparado en el backend.
2. Servicio en primer plano para el seguimiento con pantalla bloqueada, con
   notificación persistente ("compartiendo ubicación") que además cumple las
   políticas de Google Play.
3. Chat bidireccional real: hoy el taller escribe y Central lee; falta que la
   respuesta de Central llegue como aviso al operario.
4. Portal web Lite para el administrador del taller (misma API, sin instalar
   nada) para asignar operarios desde un ordenador.
5. Autoconversión LITE → FULL guiada desde Central, aprovechando que el cambio
   ya no requiere migración de datos.
6. Firma con sello de tiempo cualificado si algún cliente lo exige por contrato.
