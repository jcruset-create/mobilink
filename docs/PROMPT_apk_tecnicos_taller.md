# PROMPT — APK para las tablets de los técnicos de taller

> Documento para pegar en ChatGPT (u otra sesión) y decidir el alcance **antes de
> programar**. Describe lo que ya existe en el repositorio `jcruset-create/mobilink`,
> cómo lo abordaría y qué funcionalidad tendría la app. Todo lo de la sección 1 está
> verificado sobre el código, no supuesto.

---

## 0. El encargo

Los técnicos del taller trabajan con **tablets**. Queremos una APK propia para ellos:
que vean lo que tienen que hacer, lo ejecuten y lo cierren sin pasar por la oficina.

Dos matices que condicionan todo el diseño:

- **No es un móvil.** Pantalla grande, apoyada o colgada, en horizontal, y muchas veces
  compartida entre varios técnicos del mismo puesto.
- **Manos sucias y con guantes.** Objetivos táctiles grandes, poca escritura, mucho
  botón. Y taller con cobertura irregular: tiene que aguantar sin red.

---

## 1. Punto de partida real (esto YA existe)

### 1.1 Ya hay una app de taller a medias: `taller_app/`

Es lo más importante de este documento. **No partimos de cero.**

`taller_app/` (Flutter, `version: 0.1.0+1`, 11 ficheros y ~1.500 líneas en `lib/`)
tiene la lógica de negocio prácticamente resuelta:

| Fichero | Qué hace |
|---|---|
| `lib/screens/login_screen.dart` | Desplegable de técnicos + PIN |
| `lib/screens/home_screen.dart` | Lista de tareas, filtro por taller, salir |
| `lib/screens/task_detail_screen.dart` | Detalle, acciones de estado y fotos con cámara |
| `lib/screens/create_task_screen.dart` | Crear tarea (solo supervisor) |
| `lib/services/api_service.dart` | Capa REST completa contra el backend |
| `lib/services/offline_store.dart` | Caché Hive + cola de subida (`flushOutbox`) |

**Lo que le falta es la parte de plataforma, no la de producto**: no existen
`taller_app/android/` ni `ios/`, así que **hoy no compila, no se firma y no se publica**.
Su propio README lo dice: hay que ejecutar `flutter create . --project-name taller_app
--org com.mobilink` y añadir a mano el permiso de cámara.

### 1.2 El backend para esta app ya está hecho

`server/index.ts` expone un bloque pensado explícitamente para móvil de taller,
`/api/taller-operator/*`, que hoy solo consume `taller_app`:

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/taller-operator/me` | `{ name, esSupervisor }` |
| GET | `/api/taller-operator/jobs` | Trabajos (corte de 3 días). El operario ve los suyos; el supervisor, todos |
| GET | `/api/taller-operator/techs` | Lista de técnicos — **403 si no es supervisor** |
| POST | `/api/taller-operator/jobs` | Crear trabajo |
| PUT | `/api/taller-operator/jobs/:id/assign` | Reasignar |
| PUT | `/api/taller-operator/jobs/:id/status` | `activo` / `parado` / `cerrado` / `espera` |
| GET · POST | `/api/taller-operator/jobs/:id/files` | Fotos del trabajo (multipart) |

Autenticación: cabeceras `x-roadside-operator-name` + `x-roadside-operator-code`
(validadas contra `techs.roadsideOperatorCode`), y además el login devuelve una sesión
Supabase que la app usa como `Bearer` con refresco.

### 1.3 Ya existe una pantalla web de operario de taller, con OTRO login

`src/pages/WorkshopOperatorPage.tsx` (`/operario/taller`, 585 líneas) es una interfaz
tipo kiosko con teclado numérico en pantalla. Autentica con **nombre + PIN numérico
contra `techs.workshopPin`**, que es una columna **distinta** de la que usa la app.
Permite consultar el trabajo asignado y registrar pausas (cigarro, café, descanso,
otro) contra `/api/workshop-operator/break/start|end`. No permite abrir ni cerrar
trabajos.

### 1.4 El pipeline de APK está resuelto y probado

`.github/workflows/` tiene `build-assist-apk.yml`, `build-lite-apk.yml` y
`build-tyrecontrol-apk.yml`, todos con el mismo molde: Java 17 + Flutter, autoincremento
de versión en `pubspec.yaml`, firma con los secretos `MOBILINK_KEYSTORE_BASE64` y
`MOBILINK_KEYSTORE_PASSWORD` (alias `mobilink`), **verificación con `apksigner` que
falla el job si el APK sale firmado como debug**, y publicación como GitHub Release.
El centro de descargas (`public/descargas.html` + `APK_APPS` en `server/index.ts`)
sirve los APKs por app.

**No hay workflow ni entrada de descargas para `taller`.**

### 1.5 La app de referencia madura es `flutter_app/`

`flutter_app/` (Mobilink Assist, `1.8.1+29`) es de donde `taller_app` está calcada:
mismo modelo de autenticación, mismo backend, mismo `offline_store` con Hive, firma
resuelta y CI propio. Es el patrón a seguir para todo lo que falte.

### 1.6 Fichajes: hoy hay dos sistemas desconectados

- Las **pausas** del operario de taller (`/api/workshop-operator/break/*`), que afectan
  al estado del técnico y a los tiempos del trabajo.
- El módulo **Presencia** (`src/modules/presencia`, tablas `sea_employees` y
  `pres_records` en Supabase, endpoints `/api/presencia-operator/*`), con una
  `presencia_app` que es un esqueleto sin `android/`.

Un técnico no ficha su jornada desde el taller: solo marca pausas.

---

## 2. Cómo lo haría

**Terminar `taller_app`, no empezar una app nueva.** El 70 % del trabajo de producto ya
está escrito y probado contra endpoints que existen. Empezar de cero significaría
reescribir la capa REST, el offline y las pantallas para acabar en el mismo sitio.

El orden que propongo:

**Fase 1 — Que exista el APK.** Generar `android/`, reservar `applicationId`
(`com.mobilink.taller`), icono y nombre visible "Mobilink Taller", permiso de cámara,
`build-taller-apk.yml` copiado del de Assist, entrada `taller` en `APK_APPS` y en el
centro de descargas. Al final de esta fase hay un APK firmado e instalable con lo que
ya está programado. Es poco trabajo y desbloquea probar en tablet real.

**Fase 2 — Adaptación a tablet.** Layout horizontal a dos columnas (lista de trabajos a
la izquierda, detalle a la derecha), tipografías y botones grandes, y modo "puesto de
trabajo": la tablet se queda encendida, el técnico se identifica con PIN y la sesión se
cierra sola tras X minutos de inactividad, porque la tablet es compartida.

**Fase 3 — Lo que hoy obliga a ir a la oficina.** Aquí es donde la app deja de ser un
visor y empieza a ahorrar trabajo: pausas, fichaje, materiales y firma del cliente
(detalle en la sección 3).

**Antes de la fase 3 hay que cerrar dos decisiones de fondo** (sección 4).

---

## 3. Funcionalidad propuesta

### Fase 1 — lo que ya está programado y solo hay que empaquetar

1. **Login** con desplegable de técnicos y PIN.
2. **Mis trabajos**: lista de lo asignado, con estado y prioridad.
3. **Detalle del trabajo**: matrícula, cliente, operación, tiempo previsto.
4. **Empezar / pausar / finalizar** el trabajo.
5. **Fotos** desde la cámara, con subida en segundo plano y cola offline.
6. **Supervisor**: crear tarea y reasignar técnico.

### Fase 2 — tablet

7. **Vista a dos columnas** en horizontal y objetivos táctiles grandes.
8. **Sesión de puesto compartido**: identificación rápida por PIN y cierre por
   inactividad.
9. **Indicador de conexión** siempre visible, con lo pendiente de subir. Si no hay red,
   se dice; no se finge que se ha guardado.

### Fase 3 — lo que aporta de verdad

10. **Pausas desde la app**, unificadas con las de `/operario/taller`, para que el
    tiempo real del trabajo salga bien sin que nadie lo teclee en oficina.
11. **Fichaje de jornada** (entrada y salida), decidiendo antes con qué sistema (§4.2).
12. **Materiales y recambios usados**: lo que hoy se apunta en papel y se pierde. Un
    selector sencillo contra el catálogo de almacén, con cantidad.
13. **Firma del cliente** en pantalla al cerrar el trabajo (la tablet es ideal para
    esto; en `flutter_app` ya hay firma implementada para asistencias).
14. **Avisos push** cuando se le asigna un trabajo nuevo o cambia una prioridad.
    Hay precedente en `lite_app` y en `/api/roadside-operator/register-token`.
15. **Checklist de la operación**: los pasos de la plantilla de entrada rápida marcables
    uno a uno, para operaciones con protocolo (revisión de tacógrafo, por ejemplo).

### Deliberadamente fuera

- Nada de precios ni cobros: el técnico no gestiona dinero en taller.
- Nada de agenda ni planificación: eso es WorkPlanner, en oficina.
- Sin gestión de clientes ni de flota.

---

## 4. Decisiones que hay que tomar antes de la fase 3

### 4.1 Un solo login de técnico, o dos

Hoy conviven `techs.roadsideOperatorCode` (que usa la app) y `techs.workshopPin` (que
usa la web kiosko). Un técnico puede tener dos códigos distintos para dos pantallas que
hacen casi lo mismo, y eso genera llamadas a oficina.

**Recomendación:** unificar en el PIN de taller y que la app lo acepte, migrando los
técnicos que solo tengan uno. Es un cambio pequeño en backend y elimina una confusión
permanente.

### 4.2 Qué es "fichar" para un técnico

Si el fichaje de la app escribe en `pres_records` (módulo Presencia), Presencia pasa a
ser la fuente única de jornada. Si escribe en el mecanismo de pausas del taller, seguimos
con dos verdades.

**Recomendación:** que la jornada vaya a Presencia y las pausas de trabajo sigan donde
están, dejando claro que son cosas distintas: una es laboral y la otra es productiva.

### 4.3 Tablet compartida o personal

Cambia el diseño de la sesión. Si es por puesto de trabajo, hace falta el cierre por
inactividad de la fase 2. Si cada técnico tiene la suya, la sesión puede ser permanente
y los push tienen sentido individual.

---

## 5. Entregables técnicos de la fase 1

1. `taller_app/android/` generado, `applicationId` `com.mobilink.taller`, nombre visible
   "Mobilink Taller", icono y permiso de cámara.
2. `.github/workflows/build-taller-apk.yml` copiado del de Assist, **incluida la
   verificación con `apksigner`** que impide publicar un APK firmado como debug.
3. Entrada `taller` en `APK_APPS` (`server/index.ts`) y en `public/descargas.html`,
   con prefijo `mobilink-taller-` y tag `taller-v`.
4. `workshopId` en el modelo de trabajos del backend, que el README de la app señala
   como pendiente para poder filtrar por taller.
5. Versión inicial `0.2.0+1` y primera release firmada.

## 6. Restricciones

- Español en toda la interfaz.
- Reutilizar `flutter_app/` como patrón: no inventar una arquitectura nueva.
- No tocar el panel web ni los endpoints existentes salvo lo indicado; la app se adapta
  al backend, no al revés.
- Todo lo que escriba en el servidor debe funcionar offline con la cola de `Hive` que ya
  existe: nunca perder un cierre de trabajo por falta de cobertura.
