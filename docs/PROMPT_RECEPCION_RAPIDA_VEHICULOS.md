# Recepción rápida de vehículos: APK → WorkPlanner

> **Principio fundamental: la captura automática propone, una persona valida.**
>
> Nada de lo que se describe aquí crea trabajo real por su cuenta. La APK
> recoge lo que ve el operario en el patio, el servidor lo guarda como
> *recepción pendiente*, y alguien en WorkPlanner decide si eso se convierte
> en un trabajo y con qué operación. Igual que los partes de trabajo
> escaneados: la IA lee, la persona firma.

Documento previo a la implementación. Fase 1 del encargo: entender los flujos
que ya existen antes de escribir una línea.

---

## 1. Situación actual

### 1.1 Cómo entra hoy un vehículo al taller

Hay tres puertas y ninguna sirve para el patio:

| Puerta | Quién | Dónde | Estado inicial |
|---|---|---|---|
| Alta manual en el panel | Admin/supervisor desde el navegador | `src/SeaTarragonaV1.tsx` | `espera` |
| Parte de trabajo escaneado | Oficina, PDF o captura | `src/modules/workplanner/PartesTrabajoPage.tsx` | `validacion` (propuesta) |
| "Crear tarea" en la APK | Solo supervisor | `taller_app/lib/screens/create_task_screen.dart` | `espera` |

La tercera es la más parecida a lo que se pide, y es justamente la que peor
encaja:

- `POST /api/taller-operator/jobs` (`server/index.ts:3329`) hace un `INSERT`
  crudo en `jobs` con `status = 'espera'`. **No pasa por el motor de
  asignación.** No propone nadie, no explica nada, no hay validación humana.
- Está restringida a `op.esSupervisor`. Un operario de patio no puede usarla.
- El formulario pide área, matrícula, motivo, cliente, taller y técnicos
  asignados: es un alta completa, no una recepción.

Es decir: **hoy no existe la figura "vehículo recibido pero todavía sin
trabajo"**. O hay trabajo o no hay nada.

### 1.2 Estados de trabajo existentes

```
espera → validacion → activo → parado → cerrado      (+ bloqueado)
```

`validacion` ya significa exactamente "propuesta pendiente de autorización
humana". Lo introdujo el flujo de partes de trabajo. **No hace falta inventar
un estado nuevo**: una recepción convertida nace en `validacion`.

### 1.3 Lo que la APK ya sabe hacer

`taller_app` (Flutter, 17 ficheros) tiene resuelto casi todo el andamiaje:

- **Login de operario** contra `POST /api/taller-operator/login`; las
  credenciales viajan luego en `x-operator-name` / `x-operator-pin`
  (`_authHeaders()` en `api_service.dart`).
- **Cámara y subida de fotos**: `enqueueUpload` → multipart a
  `POST /api/taller-operator/jobs/:id/files` → multer en memoria → Supabase
  Storage → URL pública en `job_files`.
- **Offline real**: Hive (`taller_cache`, `taller_outbox`), cambios optimistas
  sobre la caché y cola de reenvío `flushOutbox()`.
- **Idempotencia**: `OfflineStore.nuevaClave(prefijo)` genera la clave **al
  encolar**, no al enviar, y viaja en `x-idempotency-key`. El servidor la
  contrasta con `respuestaIdempotente` / `guardarIdempotencia` sobre
  `taller_idempotencia`.

### 1.4 Los dos defectos de la cola que hay que tener presentes

Leyendo `flushOutbox()` (`api_service.dart:436`) aparecen dos cosas que van a
estorbar y que no se pueden ignorar:

1. **`final jobId = item['jobId'] as int;` se ejecuta para *todos* los tipos de
   item, antes de mirar el tipo.** Una recepción no tiene `jobId`. Tal cual
   está, encolar una recepción **revienta la cola entera** con un cast fallido
   y bloquea también los cambios de estado y las fotos pendientes.
2. **En un error real del servidor el item se descarta en silencio**
   (el `else` del `status != 200` llama igualmente a `removePending`). Para un
   cambio de estado es discutible; para una recepción que el operario cree
   haber enviado, es pérdida de datos delante del cliente.

---

## 2. Componentes reutilizables (y lo que NO hay que reescribir)

| Necesidad | Ya existe | Fichero |
|---|---|---|
| Normalizar y buscar matrículas | `normalizarMatricula`, `patronBusquedaMatricula`, `coincideMatricula` | `server/tyrecontrol/matricula.ts` |
| Catálogo de operaciones | tabla `quick_templates` + `GET /api/quick-templates` + `normalizeQuickTemplateRow` | `server/index.ts:1523` |
| Motor de asignación | `allocateJobPure`, `getOrderedCandidatesForJob`, `getAssignmentReason`, `buildTechStats`, `buildTechLoadStats` | `src/modules/assignment.ts` |
| Explicar por qué se propone a alguien | `explicaPropuesta` | `src/modules/workplanner/PartesTrabajoPage.tsx` |
| Lectura por IA (OCR) | `extractJson({ images, archivos })` | `server/core/ai.ts` |
| Autenticación de operario | `requireTallerOperator` + `x-operator-name`/`x-operator-pin` | `server/index.ts` |
| Idempotencia | `respuestaIdempotente` / `guardarIdempotencia` | `server/index.ts` |
| Fotos | multer memoria → Supabase Storage → `job_files` | `server/index.ts:3530` |
| Vehículos conocidos | `roadside_vehicles`, `tc_vehiculos` | `server/db.ts:618` |
| Cola offline e idempotencia en cliente | `OfflineStore` | `taller_app/lib/services/offline_store.dart` |

**Prohibiciones explícitas que esto implica:**

- No se crea un catálogo de operaciones paralelo *hardcodeado*: la recepción
  ofrece `QuickTemplate`, que es lo que el taller ya mantiene.
- No se crea un quinto modelo de autenticación. Operario = credenciales de
  operario, sin excepciones.
- No se crea una APK nueva. Todo va dentro de `taller_app`.
- No se crea un módulo SaaS nuevo. Esto pertenece a `workplanner`.
- No se duplica la normalización de matrículas. Ya hubo tres copias de esa
  regla y ya costó un vehículo que se encontraba por una vía y no por otra.

---

## 3. Decisiones tomadas

Se documentan aquí para no volver a discutirlas en cada fase.

**D1 — La recepción es una entidad propia, no un `job` en estado raro.**
Tabla nueva `recepciones_vehiculo`. Meter recepciones dentro de `jobs` con un
estado inventado contaminaría todas las consultas, contadores y pantallas
existentes de WorkPlanner. El comportamiento actual se conserva intacto.

**D2 — La conversión reutiliza el camino web, no el de la APK.**
Es decir `allocateJobPure` → estado `validacion` con propuesta explicada,
como hace `PartesTrabajoPage`, y **no** el `INSERT` crudo a `espera` de
`POST /api/taller-operator/jobs`. Motivo: el principio fundamental. Una
recepción convertida es una propuesta, y una propuesta se valida.

**D3 — Convertir es atómico y sólo una vez.**
`INSERT` del job y `UPDATE` de la recepción en la misma transacción, y el
`UPDATE` es condicional (`WHERE estado = 'pendiente'`). Si dos personas pulsan
"convertir" a la vez, una gana y la otra recibe 409. Sin esto salen trabajos
duplicados para el mismo vehículo, que es precisamente el tipo de error que
nadie detecta hasta que hay dos técnicos en el mismo camión.

**D4 — El OCR nunca decide.**
La matrícula leída se le enseña al operario en un campo editable, con la
confianza y la foto al lado. El operario confirma o corrige. Nunca se envía
una matrícula OCR sin haberla mostrado.

**D5 — Cero importes en la APK.**
`QuickTemplate` trae `unitPrice`. El endpoint que sirve el catálogo a la APK
**recorta ese campo antes de responder**. Nada de precios, tarifas, importes,
márgenes ni facturación en la pantalla del técnico. Un test fija esto.

**D6 — La lógica va en módulos, no en `server/index.ts` ni en `SeaTarragonaV1.tsx`.**
Router propio montado desde `index.ts`; reglas puras en `src/modules/`.

**D7 — Ante la duda, se conserva el comportamiento actual.**
Ninguna fase modifica el flujo de partes de trabajo, el alta manual ni el
`POST /api/taller-operator/jobs` existente. Se añade al lado.

---

## 4. Tablas

Se crean con `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` en
`server/db.ts` (no hay framework de migraciones) y con el SQL equivalente en
`supabase/migrations/workplanner_recepciones_vehiculo.sql`.

```sql
CREATE TABLE IF NOT EXISTS recepciones_vehiculo (
  id                  BIGINT PRIMARY KEY,
  "workshopId"        TEXT,
  matricula           TEXT NOT NULL,          -- tal y como la confirmó la persona
  "matriculaNormal"   TEXT NOT NULL,          -- normalizarMatricula(), para buscar
  "matriculaOcr"      TEXT,                   -- lo que leyó la IA, sin tocar
  "confianzaOcr"      DOUBLE PRECISION,
  "clienteNombre"     TEXT,
  "vehiculoId"        TEXT,                   -- si se reconoció uno conocido
  "vehiculoOrigen"    TEXT,                   -- 'roadside' | 'tyrecontrol' | null
  area                TEXT,
  "plantillaKey"      TEXT,                   -- quick_templates.key propuesta
  "operacionLabel"    TEXT,
  notas               TEXT,
  urgente             BOOLEAN NOT NULL DEFAULT FALSE,
  fotos               JSONB NOT NULL DEFAULT '[]'::jsonb,
  estado              TEXT NOT NULL DEFAULT 'pendiente',
    -- pendiente | convertida | descartada
  "operarioNombre"    TEXT NOT NULL,
  "creadaAtMs"        BIGINT NOT NULL,
  "resueltaAtMs"      BIGINT,
  "resueltaPor"       TEXT,
  "motivoDescarte"    TEXT,
  "jobId"             BIGINT,                 -- job creado al convertir
  "deletedAtMs"       BIGINT
);

CREATE INDEX IF NOT EXISTS recepciones_vehiculo_estado_idx
  ON recepciones_vehiculo(estado, "creadaAtMs" DESC);
CREATE INDEX IF NOT EXISTS recepciones_vehiculo_matricula_idx
  ON recepciones_vehiculo("matriculaNormal");
CREATE INDEX IF NOT EXISTS recepciones_vehiculo_workshop_idx
  ON recepciones_vehiculo("workshopId");
```

Notas de implementación obligatorias:

- **`pg` devuelve `BIGINT` como cadena.** `id`, `creadaAtMs`, `jobId`,
  `ptEntradaMs`… llegan como `string`. El normalizador de fila
  (`normalizeRecepcionRow`) los convierte, y hay un test que lo fija.
- **`ON CONFLICT` con `COALESCE`**: si se añade un upsert, los campos que no
  vengan en el cuerpo no se machacan a `null`.
- El borrado es lógico (`deletedAtMs`), como en `jobs`.

En `jobs` se añade una columna para poder volver hacia atrás:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS "recepcionId" BIGINT;
```

---

## 5. Endpoints

Router nuevo `server/recepciones/router.ts`, montado en `index.ts` con una
línea. Nada de esto se escribe dentro de `index.ts`.

### 5.1 Para la APK (auth de operario)

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/taller-operator/recepciones/catalogo` | `quick_templates` **sin `unitPrice`** + áreas + talleres |
| `GET` | `/api/taller-operator/recepciones/vehiculo?matricula=` | Busca en `roadside_vehicles` y `tc_vehiculos` con `patronBusquedaMatricula`; confirma con `coincideMatricula` |
| `POST` | `/api/taller-operator/recepciones` | Crea la recepción. **Idempotente** (`x-idempotency-key`) |
| `POST` | `/api/taller-operator/recepciones/:id/fotos` | Multipart, mismo camino que `job_files` |
| `POST` | `/api/taller-operator/recepciones/ocr-matricula` | Imagen → `extractJson` → `{ matricula, confianza }`. **Propone, no guarda** |
| `GET` | `/api/taller-operator/recepciones/mias` | Las que ha creado este operario, para que vea que llegaron |

### 5.2 Para WorkPlanner (auth de panel)

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/recepciones?estado=&workshopId=` | Bandeja, paginada |
| `GET` | `/api/recepciones/:id` | Detalle con fotos y propuesta |
| `PUT` | `/api/recepciones/:id` | Corregir matrícula, cliente, área, plantilla, notas |
| `POST` | `/api/recepciones/:id/convertir` | Crea el job en `validacion` y marca la recepción. Transaccional y condicional |
| `POST` | `/api/recepciones/:id/descartar` | `estado = 'descartada'` + `motivoDescarte` |

**Nunca** se expone un endpoint que sustituya la colección completa. No existe
`PUT /api/recepciones`. Cada recepción se toca por su id.

---

## 6. Flujo en la APK

Pestaña nueva **"Recepción"** en el `TabBar` de `home_screen.dart`, visible
para cualquier operario (no sólo supervisores: el que recibe el coche en el
patio no suele serlo).

```
[Foto de la matrícula]  ← opcional, la cámara ya está montada
        ↓  (si hay foto) OCR
[Matrícula: 1234-ABC]   ← SIEMPRE editable, con la foto al lado
        ↓
¿Vehículo conocido?  → sí: se rellenan cliente y datos, se muestra de dónde salen
                     → no: campo de cliente libre
        ↓
[Área]  [Operación propuesta ▾]   ← de quick_templates, SIN precios
        ↓
[Urgente ☐]  [Notas]  [+ Fotos del estado del vehículo]
        ↓
              [ Enviar a recepción ]
        ↓
"Recibido. Pendiente de validar en oficina."
```

Lo que el operario **no** ve en ningún momento: precios, tarifas, importes,
márgenes, facturación. Ni en el catálogo, ni en el resumen, ni en "mías".

---

## 7. Flujo de recepción en WorkPlanner

Sección nueva `recepciones` en `WorkPlannerApp.tsx`, junto a `partes`, con su
entrada en el menú y su `<Route>`. Página
`src/modules/workplanner/RecepcionesPage.tsx`, siguiendo las convenciones de
`PartesTrabajoPage` (paleta oscura, paneles ámbar para lo que falta por
decidir, confirmación antes de crear).

Bandeja → tarjeta por recepción con matrícula, cliente, hora, operario que la
creó y miniaturas. Detalle → todo editable, propuesta de técnico calculada con
`allocateJobPure` sobre estadísticas reales (`buildTechStats` /
`buildTechLoadStats`) y explicada con `explicaPropuesta`, más dos botones:
**Convertir en trabajo** y **Descartar** (con motivo).

Si la matrícula vino de OCR y nadie la ha tocado, la ficha lo dice con un aviso
ámbar. Es un dato propuesto, no confirmado.

---

## 8. Conversión a WorkPlanner

```
POST /api/recepciones/:id/convertir
  BEGIN
    SELECT ... FROM recepciones_vehiculo WHERE id=$1 AND estado='pendiente' FOR UPDATE
      → si no hay fila: 409 "ya convertida o descartada"
    INSERT INTO jobs (... status='validacion', "recepcionId"=$id ...)
    UPDATE recepciones_vehiculo
       SET estado='convertida', "jobId"=..., "resueltaAtMs"=..., "resueltaPor"=...
     WHERE id=$1 AND estado='pendiente'
      → si rowCount = 0: ROLLBACK, 409
    -- las fotos de la recepción se copian a job_files (referencia, no re-subida)
  COMMIT
```

El job nace en `validacion`, nunca en `activo`. La persona que valida en la
pantalla de siempre es quien lo pone en marcha. La propuesta de técnico viaja
en el job como propuesta, con su explicación.

---

## 9. OCR de matrícula

Se reutiliza `extractJson` de `server/core/ai.ts` con `images`. Contrato:

```ts
{ matricula: string | null, confianza: number }   // 0..1
```

Reglas:

- La respuesta pasa por `normalizarMatricula` antes de devolverse.
- Si `confianza < 0.7` o la matrícula normalizada tiene menos de 4 caracteres,
  se devuelve `null` y la APK pide que se escriba a mano.
- El OCR **nunca** escribe en la base. Sólo responde.
- Si la IA falla o no hay clave configurada, el flujo sigue: la matrícula se
  teclea. El OCR es una comodidad, no una dependencia.
- Se guardan `matriculaOcr` y `confianzaOcr` junto a la matrícula confirmada,
  para poder medir después si el OCR merece la pena.

---

## 10. Funcionamiento offline

Tipo nuevo en el outbox: `'recepcion'`, con la clave generada **al encolar**
(`nuevaClave('rc')`), como manda `OfflineStore`.

Dos arreglos imprescindibles en `flushOutbox()`, ambos derivados de §1.4:

1. Mover el `jobId` dentro de las ramas que lo usan, en vez de castearlo para
   todos los items. Hoy un item sin `jobId` tumba la cola completa.
2. Para el tipo `'recepcion'`, distinguir errores: **4xx** (la petición está
   mal, reintentar no la va a arreglar) → se descarta y se avisa; **5xx y red**
   → se conserva y se reintenta. Nunca descartar en silencio una recepción.

El cambio del punto 1 se hace **sin alterar el comportamiento de `status` ni de
`upload_file`**: siguen exactamente igual.

La recepción encolada se ve en la APK como "pendiente de enviar", con el
contador de `OfflineStore.pendingCount` que ya existe.

---

## 11. Casos límite

| Caso | Qué se hace |
|---|---|
| Matrícula vacía | 400. Es el único campo obligatorio |
| Matrícula < 4 caracteres | Se acepta como texto, pero no se busca vehículo (`patronBusquedaMatricula` devuelve `null`: traería media tabla) |
| Misma matrícula recibida dos veces el mismo día | Se permite, pero la bandeja lo marca en ámbar. Un camión puede entrar dos veces; duplicar el aviso es peor que no darlo |
| Reintento de la cola | Idempotencia por `x-idempotency-key`: devuelve la recepción ya creada, no crea otra |
| Dos personas convierten a la vez | `UPDATE` condicional: una gana, la otra 409 |
| Vehículo en `roadside_vehicles` y en `tc_vehiculos` | Gana `roadside_vehicles` (es el propio) y se indica el origen |
| Foto sin Supabase configurado | La recepción se crea igual, sin fotos, y se registra el fallo. Perder la foto no puede perder la recepción |
| `plantillaKey` que ya no existe | Se conserva el texto en `operacionLabel` y la ficha pide elegir plantilla antes de convertir |
| Recepción de un taller distinto al del usuario | Se filtra por `workshopId` como en el resto de WorkPlanner |
| Operario no supervisor | **Puede** crear recepciones (a diferencia de `POST /jobs`). No puede convertirlas |

---

## 12. Estrategia de tests

**Lógica pura, sin base de datos** (`src/modules/recepcionVehiculo.ts`):
normalización, decisión de vehículo conocido, validez del OCR por confianza,
construcción del job a partir de la recepción, criterio de "posible duplicado".
Estos tests **no importan `server/db.ts`** —que lanza al importarse sin
`DATABASE_URL`— y existe ya un test de arquitectura en `server/therefore/` que
vigila exactamente ese error; se replica el criterio.

**Normalización de fila**: un test que fija que `BIGINT` llega como cadena y
sale como número.

**Sin precios**: un test que pasa un `QuickTemplate` con `unitPrice` por el
serializador del catálogo de la APK y comprueba que el campo no aparece. Es la
clase de garantía que sólo se nota cuando se rompe.

**Conversión**: test de la función pura que arma el job (estado `validacion`,
`recepcionId` puesto, propuesta explicada).

**Flutter**: `flutter analyze` y `flutter test` sobre `taller_app`, con un test
del outbox que encola una recepción junto a un cambio de estado y comprueba
que la cola no se rompe (la regresión de §1.4).

**Validación de todo el árbol: `npx tsc -b`.** No `tsc -p tsconfig.json`, que
es un fichero de solución con sólo `references`, no compila nada y pasa siempre
en verde. Ese atajo ya tumbó un despliegue en Render.

Ningún test se "arregla" borrándolo ni relajándolo.

---

## 13. Orden de trabajo

1. ~~Investigación y este documento~~
2. Modelo: tablas en `db.ts` + migración + tipos + lógica pura + tests
3. API: router `server/recepciones/`, montado desde `index.ts`
4. Conversión a job (transaccional, condicional)
5. Web: bandeja + detalle en `workplanner`
6. APK: pestaña de recepción
7. Offline: tipo `recepcion` en el outbox + los dos arreglos de `flushOutbox`
8. OCR de matrícula
9. Integración con vehículo/cliente conocidos
10. QA: `npx tsc -b`, tests, `flutter analyze`, `check-versions.sh`, PR
