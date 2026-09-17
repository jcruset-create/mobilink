# Therefore — expedientes, actuaciones y albaranes a partir del correo: diseño

Documento de diseño del módulo Therefore, con las secciones A–O que pide el
encargo. Es el resultado de leer el repositorio con una sola pregunta: «¿dónde
encaja esto sin estrenar nada?». Cada apartado dice qué se reutiliza, qué se
toca y por qué.

> **Estado: las FASES 1, 2, 3a, 3b, 4a, 4b y 5 están implementadas** (ver §O). Queda el ajuste con documentos reales (N.3) y el alta del ERP por sociedad. Existen los
> expedientes, las actuaciones, el histórico, los permisos, la numeración, la
> API, la bandeja y el detalle; entra el correo —notificaciones, adjuntos,
> deduplicación con pesos configurables, decisiones humanas y pantalla de
> revisión—; y el **parser lee el correo tal cual llega**: clasifica, saca los
> campos de la plantilla y convierte el bloque «Información Adicional» en
> actuaciones, calibrado contra un corpus de veinte correos reales.
>
> Lo que **no** existe todavía: el **buzón IMAP** que traiga los correos solo, y
> el **análisis del albarán dentro del PDF**. Las secciones que los describen
> —G, H, I— siguen siendo diseño.

Principio que gobierna todo: **la unidad de trabajo es el expediente, no el
correo.** Un expediente agrupa N actuaciones, N notificaciones, N documentos,
N albaranes analizados y N eventos. Therefore manda muchos correos por el
mismo problema y un PDF con cinco albaranes cuando pide uno; aquí se convierte
en una cola de trabajo deduplicada, priorizada, trazable y con el albarán ya
localizado y desglosado.

---

## A. Análisis de la arquitectura actual

### A.1 Stack y piezas

| Capa | Qué hay | Dónde |
|---|---|---|
| Backend | Express 5 + TypeScript con `tsx`, PostgreSQL vía `pg`. Un monolito (`server/index.ts`, 19 000 líneas) y módulos autocontenidos en `server/<modulo>/` | `server/index.ts`, `server/tacografos/`, `server/cash/` |
| Base de datos | Un solo PostgreSQL (el de Supabase). El servidor entra con `pg` y **salta la RLS**; las apps Flutter y parte del panel entran con `supabase-js` y sí pasan por RLS | `server/db.ts`, `server/supabase.ts` |
| Migraciones | **Sin herramienta.** DDL idempotente en `initX()` ejecutado en cada arranque por `prepararEsquema(nombre, fn)`; espejo opcional en `supabase/migrations/<modulo>_<fase>.sql` para el SQL Editor (obligatorio si el frontend lee la tabla con `supabase-js`, y donde van las FK a `app_*` y los CHECK de la lista de módulos) | `ARCHITECTURE.md` §14, `server/tacografos/schema.ts` |
| Usuarios y auth | Supabase Auth → `Authorization: Bearer` → `authenticate` deja `req.authCtx = {userId, empresaId, esSuperadmin}`; `requireModule("<slug>")` comprueba la licencia en `app_licencias`. **Sin rol en el contexto**: el rol lo resuelve cada módulo | `server/core/auth.ts` |
| Permisos | `app_usuario_modulos (user_id, modulo, rol, pantallas, centro_id)` + `permissions.ts` por módulo (`PERMISOS`, `POR_ROL`, `cargarPermisos`, `exigirPermiso`), sin caché | `server/tacografos/permissions.ts` |
| Auditoría | `app_auditoria` inmutable (trigger + huella SHA-256) vía `registrarAuditoria` (no lanza) / `registrarAuditoriaEnTransaccion` (lanza); diarios de dominio con el mismo candado (`assistance_events`) | `server/core/auditoria.ts`, `server/eventlog/schema.ts` |
| Configuración | Env para credenciales. Ajustes en tablas clave/valor: `workshop_config (key, value)` global con `server/satisfaction/config.ts` como implementación de referencia (`CLAVES`, `POR_DEFECTO`, lector que nunca lanza); `cash_settings (empresa_id, clave, valor)` por empresa | `server/satisfaction/config.ts`, `server/cash/schema.ts` |
| Adjuntos y ficheros | Bucket **privado** de Supabase Storage creado al vuelo por el módulo, enlaces firmados de 15 min, disco bajo `server/uploads/` en pruebas (`*_STORAGE_LOCAL=1`); `sha256` como identidad y para detectar duplicados (`UNIQUE (empresa_id, sha256)` parcial) | `server/tacografos/storage.ts`, `server/cash/documents.ts` |
| PDF | **`mupdf` 1.28** (WASM, ya en producción): rasteriza páginas para visión en `pdfRasterizer.ts`; y `page.toStructuredText().asJSON()` devuelve **bloques → líneas con `bbox`, fuente, `x/y` y texto** por página (comprobado). `pdf-lib`/`pdfkit` para generar. **`pdf-parse` y `tesseract.js` están en `package.json` sin ningún uso** | `server/tyrecontrol/ficha-tecnica/pdfRasterizer.ts` |
| XML | Ningún parser XML en el código; `xml2js`/`@xmldom`/`sax` solo como transitivas | — |
| IA | **Capa única** `pedirIA()` (Responses API, esquema JSON estricto, modelo por env, reintentos solo ante error técnico, nunca lanza). Puerto `ExtractorFacturas` inyectable en el escaneo de Cash; extracción cruda en texto, normalización aparte con tests; confianza por campo con umbrales RELLENAR/REVISAR/VACIO | `server/core/openaiService.ts`, `server/cash/invoice-scan/` |
| Correo entrante | `imapflow` + `mailparser` en **un** fichero: poller cada N min, solo no leídos, lote de 20, `message_id UNIQUE`; un correo que falla se queda sin leer. El buzón del CheckPoint está en **cdmon** (`imap.mobilink.es`). No hay API de Gmail (`google-auth-library` es solo para push FCM) | `server/checkpointMail.ts` |
| Correo: cabeceras e hilos | `normalizarMessageId`, `referenciasDeCabecera`, `asuntoBase`; entrada con `ON CONFLICT DO NOTHING` sobre índice único parcial; bandeja «sin clasificar» | `server/correo/referencia.ts`, `server/correo/servicio.ts` |
| Correo saliente | `nodemailer` vía `getMailTransport()`, `null` si no hay SMTP | `server/mail.ts` |
| Integraciones externas | Integration Hub con puertos (`IErpConnector`, `ITechnicalConnector`…), `ConnectorRegistry`, secretos por env `IH_SECRET__…`, operaciones con estados y reintentos («el Hub nunca pierde una operación») | `server/integration-hub/` |
| ERP | Business Central. Dos contratos: Integration Hub (clientes, artículos, pedidos; BC en modo simulación) y Cash (`ICashErpConnector` + `DocumentoExterno`, `vendorLedgerEntries`; sin inquilino real). **Ninguno llega a los albaranes de compra.** Invariante: ningún módulo llama a BC directamente | `docs/PROMPT_CONEXION_BUSINESS_CENTRAL.md`, `server/cash/erp/` |
| Jobs / colas | Sin cola genérica ni cron. `setInterval` por módulo registrado en `app.listen`; **tabla como cola** con `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, lote pequeño, `intentos`, estados en mayúsculas, `timer.unref()` | `server/cash/autoscan/worker.ts`, `server/cash/erp/worker.ts` |
| Errores y logging | Clase de error por módulo (`ErrorCaja`, `ErrorTacografos`) con `codigo` + `estado` HTTP en fichero propio sin importar la base; envoltorio `ruta(fn)` que traduce a `{error, code}` y 500 genérico; `console.error("[Módulo] …")`; los logs de IA omiten prompt y respuesta | `server/cash/errors.ts`, `server/tacografos/router.ts` |
| Frontend | React 18 + Vite + Tailwind 4 + react-router 7 + lucide. Sin react-query. Módulo = `XxxApp.tsx` (Provider + Layout + rutas), `services/api.ts` único `fetch` con `sessionHeaders()`, `contexts/` con `bootstrap → {rol, permisos, puede()}`. Kit de UI **compartido de hecho**: `administracion/components/ui.tsx` (Cash lo reexporta). Tema slate + sky, sin `dark:`. Sin pruebas de componentes | `src/modules/tacografos/`, `src/modules/cash/components/ui.tsx` |
| Pruebas | vitest. Dominio puro sin base; integración **por HTTP contra PostgreSQL real** con `RUN_DB_TESTS=1`, esquema creado una vez en `vitest.setup.ts`; CI levanta Postgres 16 y **falla si las de integración no se ejecutan** | `vitest.config.ts`, `.github/workflows/tests.yml` |
| Typecheck | `tsconfig.server.json` con `include` explícito: **un módulo nuevo que no se añada no se comprueba** | `ARCHITECTURE.md` §14 |

### A.2 Búsquedas hechas

- **«Therefore»**: cero apariciones en `*.ts`, `*.md`, `*.sql`. Es un módulo nuevo.
- **Parsers de documentos**: `invoice-scan/` (factura → IA), `tacografos/importar.ts` (anexo II desde xlsx), `tacografos/pdfTexto.ts` (extractor de texto **solo para PDF generados por ese módulo**, no sirve aquí), `ficha-tecnica/ocrService.ts` (visión con confianza por campo), `tyrecontrol/flanco/`. Ninguno localiza un albarán dentro de una factura ni extrae líneas de artículos.
- **Expediente / incidencia / notificación / reclamación**: `tac_expedientes`, `tc_incidencias` (+ `tc_incidencia_problemas`), `adm_notificaciones`, `adm_recovery_cases`. Sirven de referencia de nombres y estados; ninguna se reutiliza como tabla.
- **Bandeja de decisiones humanas**: `server/excepciones` (Assist) y `correo/sinClasificar`. Se copia el criterio, no la tabla.

### A.3 Convenciones que se respetan

- Dominio en castellano, tablas con prefijo de módulo y `snake_case`, valores de estado en mayúsculas, `empresa_id UUID NOT NULL` **sin FK** en el DDL de arranque (las pruebas levantan una base sin la fundación SaaS), tenant desde `ctx.empresaId` y nunca del cuerpo, 404 y no 403.
- Un módulo nuevo se da de alta en **diez sitios**. Ocho se deducen leyendo otro módulo; los **dos primeros no**, y costaron un fallo real al implementar la fase 1 (ver nota abajo):
  1. `MODULOS_LICENCIABLES` en `server/db.ts` — reconstruye el CHECK de `app_licencias.modulo` y `app_usuario_modulos.modulo` en cada arranque.
  2. `MODULOS` en `server/central/schema.ts` — lo reconstruye **otra vez**, y su DROP y su ADD no van en la misma transacción.
  3. `tsconfig.server.json` (`include`), 4. `vitest.setup.ts`, 5. cadena `prepararEsquema` + `mount` de `server/index.ts`, 6. migración del CHECK (molde `saas_modulo_assist.sql`), 7. `MODULOS_APP`, 8. `ACCESOS_MODULOS`, 9. `ICONOS`/`COLORES`/`BASES` de `InicioPage.tsx`, 10. `lazy()` + ruta en `App.tsx`.

  > **La lista de módulos vive en TRES sitios que se pisan.** Los dos de código
  > se ejecutan en cada arranque; el de la migración, a mano. Si a uno le falta
  > un módulo y ya existe una fila con ese valor, su `ALTER TABLE` falla. En
  > `db.ts` el DO block es atómico y no pasa nada grave; en
  > `central/schema.ts` el `DROP CONSTRAINT` y el `ADD CONSTRAINT` son dos
  > consultas sueltas, así que **la tabla se queda sin restricción** y el error
  > sólo aparece en el log del despliegue, porque `prepararEsquema` lo traga.
  > Lo destapó la prueba de integración de la fase 1, que es donde apareció la
  > primera fila con `modulo = 'therefore'`.
- `docs/PROMPT_avisos_presion_por_correo.md` ya fijó el criterio para consumir correo automático: **regex determinista para la plantilla, IA solo como respaldo y marcada como tal, y no escribir un segundo sistema de correo.**

---

## B. Componentes reutilizables

| Necesidad | Se reutiliza | Cómo |
|---|---|---|
| Escuchar un buzón sin procesar dos veces | `checkpointMail.ts` | Copia del molde: config por env, apagado sin credenciales, una pasada llamable a mano + `setInterval` |
| Cabeceras de correo | `correo/referencia.ts` | Import directo: `normalizarMessageId`, `referenciasDeCabecera`, `asuntoBase`, `normalizarDireccion` |
| Idempotencia por `Message-ID` | patrón de `assistance_messages` | `INSERT … ON CONFLICT DO NOTHING RETURNING id`; 0 filas = ya procesado |
| Texto y posiciones del PDF | `mupdf` (ya dependencia directa) | `toStructuredText("preserve-whitespace").asJSON()` por página → líneas con `bbox`; `rasterizarPdf` cuando no hay capa de texto |
| IA con esquema estricto | `pedirIA()` | `proposito: "documento"`, data-URI, nunca URL pública; `hayIA()` decide si existe el respaldo |
| Puerto de extracción inyectable | `invoice-scan/extractor.ts` | Misma forma: un tipo función, implementación IA e implementación falsa para pruebas |
| Confianza por campo y umbrales | `invoice-scan/validate.ts` | `CampoPropuesto<T>` con `RELLENAR/REVISAR/VACIO` → aquí `OK/REVISAR/VACIO` |
| Importes en céntimos con signo | `cash/domain/money.ts` (servidor) y `cash/utils/money.ts` (panel) | `Centimos`, `aCentimos("‑45,63")`, `eurosConSigno` |
| Cola de trabajo asíncrona | `cash/autoscan/worker.ts` | `FOR UPDATE SKIP LOCKED`, lote, `intentos`, estados, `unref()` |
| Ficheros privados | `tacografos/storage.ts` | Copia con bucket `therefore-correo`, `THEREFORE_STORAGE_LOCAL` |
| Historial inmutable | trigger de huella y candado de `assistance_events` | Mismo par de triggers sobre `thf_eventos` |
| Auditoría con usuario | `registrarAuditoria` | `accion = 'therefore.<evento>'` en cada acción de usuario |
| Permisos | `tacografos/permissions.ts` | Copia con roles `consulta` / `gestor` / `admin` |
| Config por empresa | `cash_settings` + forma de `satisfaction/config.ts` | `thf_config`, `CLAVES`, `POR_DEFECTO`, lector que nunca lanza |
| Numeración propia | `cash_document_counters` | `thf_contadores (empresa_id, serie, last_seq)` → `INC-000452`, `APR-000031` |
| Error de módulo y envoltorio de ruta | `cash/errors.ts`, `tacografos/router.ts` | `ErrorTherefore(codigo, mensaje, estado, detalle)`, `ruta(fn)` |
| Panel: lista, detalle, timeline | `connectpro/pages/Asistencias.tsx`, `FichaAsistencia.tsx`, `components/TimelineAsistencia.tsx`, `tyrecontrol/pages/Incidencias.tsx` | Molde de bandeja con pestañas y contador, detalle con `TABS`, raíl con puntos |
| Panel: kit de UI y formato | `administracion/components/ui.tsx`, `administracion/types` (`fmtFecha`, `fmtFechaHora`, `fmtEur`), `cash/utils/money.ts` | Reexportar desde `therefore/components/ui.tsx` como hace Cash |
| Contrato ERP | `IErpConnector` (Integration Hub) + vocabulario `DocumentoExterno` (Cash) | Se amplía con métodos opcionales; no se inventa un tercer contrato |

**Componentes que se modifican** (solo alta del módulo, sin cambio de comportamiento):
`server/index.ts` (3 líneas: import, `prepararEsquema`, `mount` + `start`),
`tsconfig.server.json`, `vitest.setup.ts`, `.env.example`, `src/App.tsx`,
`src/pages/InicioPage.tsx`, `src/config/accesosModulos.tsx`,
`src/modules/administracion/config/modulosApp.ts`, y una migración nueva que
amplía el CHECK de módulos. `IErpConnector` gana métodos **opcionales** en la
fase de ERP; ninguna implementación existente tiene que cambiar.

**Componentes nuevos**: todo `server/therefore/`, todo `src/modules/therefore/`,
dos ficheros en `supabase/migrations/`.

---

## C. Arquitectura definitiva

### C.1 Ficheros

```
server/therefore/
├── index.ts          initTherefore, mountTherefore, startThereforeWorkers
├── schema.ts         DDL idempotente (D)
├── router.ts         /api/therefore/* — solo forma, authenticate + requireModule + cargarPermisos
├── permissions.ts    consulta / gestor / admin
├── errors.ts         ErrorTherefore (sin base)
├── repository.ts     todo el SQL, empresa_id en cada WHERE
├── service.ts        casos de uso: crear, fusionar, decidir, transiciones
├── config.ts         CLAVES, POR_DEFECTO, leerConfig(empresaId) — nunca lanza
├── buzon.ts          listener IMAP (molde checkpointMail)
├── ingesta.ts        procesarCorreo(empresaId, eml, origen)  ← ÚNICO punto de entrada
├── storage.ts        .eml y adjuntos en bucket privado, por hash
├── domain/           PURO: sin base, sin red, sin IA
│   ├── correo/       parser del EMAIL (E)
│   │   ├── plantilla.ts      campos fijos de Therefore
│   │   ├── actuaciones.ts    albaranes + acción + importe + indicador
│   │   ├── importes.ts       «‑45,63», «199.95e», «1.234,56» → céntimos
│   │   └── confianza.ts      umbrales → requiereRevision
│   ├── normalizar.ts         CorreoParseado → CorreoNormalizado
│   ├── dedupe.ts             candidatos + pesos → decisión explicada (F)
│   ├── prioridad.ts          score → prioridad
│   ├── estados.ts            transiciones de expediente y actuación
│   ├── albaran.ts            normalizarAlbaran, compararAlbaranes (H.2)
│   ├── documento/            parser de DOCUMENTOS (G, H)
│   │   ├── modelo.ts         PaginaTexto, LineaTexto, SeccionAlbaran, LineaArticulo…
│   │   ├── tabla.ts          detección de cabecera de columnas y filas
│   │   ├── descuentos.ts     «60% + 10%» → [{orden, porcentaje, raw}]
│   │   ├── secciones.ts      localizar y delimitar albaranes (multipágina)
│   │   ├── lineas.ts         extraer líneas de una sección con confianza
│   │   ├── complementarios.ts matrícula, bastidor, observaciones, pedido…
│   │   ├── conceptos.ts      portes, tasas, totales: reconocer para EXCLUIR
│   │   └── parsers/          registro extensible (G.3)
│   │       ├── index.ts      seleccionarParser(texto) — desacoplado
│   │       └── generico.ts   GenericInvoiceParser
│   └── validaciones.ts       ALBARAN_MATCH, IMPORTE, LINEAS… (I)
├── documentos/       infraestructura del análisis (no puro)
│   ├── texto.ts      mupdf → PaginaTexto[] con bbox; esEscaneado()
│   ├── extractorIA.ts        respaldo: sección o página → pedirIA con esquema
│   ├── xml.ts        (cuando se conozca el formato)
│   ├── analisis.ts   analizarActuacion(): resolver documento → parser → validar → persistir
│   └── worker.ts     cola thf_albaranes_analizados (K)
├── erp/
│   ├── puerto.ts     ConsultaAlbaranesErp (interfaz)
│   └── sinErp.ts     «sin datos»
├── fixtures/         .eml y .pdf generados/anonimizados para pruebas
└── *.test.ts, therefore.integration.test.ts

src/modules/therefore/
├── ThereforeApp.tsx, contexts/ThereforeContext.tsx, layouts/ThereforeLayout.tsx
├── services/api.ts, services/bandeja.ts (+ .test.ts), types/index.ts
├── components/ui.tsx (reexporta Administración) + ChipEstado, ChipPrioridad,
│   TablaExpedientes, FiltrosBandeja, Actuaciones, AlbaranAnalizado, LineasAlbaran,
│   Validaciones, TimelineNotificaciones, Documentos, Historico, DecisionPendiente
└── pages/Bandeja.tsx, Expediente.tsx, Revision.tsx, Configuracion.tsx
```

### C.2 Pipeline (adaptación de la «arquitectura objetivo» del prompt)

```
Buzón IMAP ──► buzon.ts ──► ingesta.procesarCorreo(eml)        [síncrono, una transacción]
                               ├─ mailparser → cabeceras, texto, adjuntos
                               ├─ storage: .eml y adjuntos por sha256
                               ├─ INSERT thf_notificaciones ON CONFLICT DO NOTHING → 0 filas = fin
                               ├─ domain/correo (Email Parser) → domain/normalizar (Normalizer)
                               ├─ repository.candidatos → domain/dedupe (Deduplication Engine)
                               ├─ service: crear / fusionar / thf_decisiones
                               ├─ actuaciones + thf_adjuntos + thf_eventos
                               └─ ENCOLAR: una fila thf_albaranes_analizados PENDIENTE por
                                  actuación con albarán y con documento candidato

documentos/worker.ts (cada 15 s, lote pequeño, SKIP LOCKED)     [asíncrono]
   └─ documentos/analisis.analizarActuacion(id)
        ├─ Document Resolver: qué adjunto del expediente mirar (PDF; XML si existe)
        ├─ documentos/texto: mupdf → páginas con líneas y bbox (o rasterizar → IA si escaneado)
        ├─ parsers.seleccionarParser → GenericInvoiceParser (Delivery Note Finder + Extractor)
        │     secciones.localizar(albarán solicitado) → delimitar (multipágina)
        │     lineas.extraer(sección) + descuentos + complementarios + conceptos excluidos
        ├─ domain/validaciones (Validator) → OK / REVISAR / ERROR + filas thf_validaciones
        └─ persistir: thf_albaranes_analizados, thf_albaran_lineas, _descuentos, evento ALBARAN_ANALIZADO

Mobilink UI ◄── /api/therefore/*                ERP Adapter (erp/puerto.ts) ── futuro
```

La recepción del correo **no espera** al análisis del PDF (prompt §44): el
expediente y la actuación existen en cuanto se procesa el correo; el albarán
analizado llega segundos después y, si falla, la actuación sigue siendo
gestionable con «Análisis: ERROR» (§45).

### C.3 Qué NO se estrena

Ni cola genérica, ni ORM, ni librería de componentes, ni segundo sistema de
permisos, ni cliente nuevo de correo, ni parser de PDF nuevo (`mupdf` ya está),
ni modelo de IA elegido en código. La única dependencia nueva posible es un
parser XML, y solo cuando se conozca el formato (N).

---

## D. Modelo de datos definitivo

Prefijo `thf_`. Todo con `empresa_id UUID NOT NULL` (tenant SaaS). El código
de sociedad de Therefore («007») es `empresa_codigo TEXT`: **no es el
tenant**, es la empresa del ERP a la que se refiere el correo. Importes en
**céntimos con signo** (`BIGINT`). Fechas en `TIMESTAMPTZ` (desviación
deliberada respecto a los `_ms` de Tacógrafos y Cash: este módulo hace
aritmética de fechas en SQL —antigüedad, ventana de candidatos, autocierre— y
su espejo en `supabase/migrations` es `timestamptz` como todas las `adm_*`/`tc_*`).

### D.1 `thf_expedientes`

```sql
id UUID PK, empresa_id UUID NOT NULL, numero TEXT NOT NULL,          -- INC-000452 / APR-000031
empresa_codigo TEXT NOT NULL DEFAULT '', empresa_nombre TEXT NOT NULL DEFAULT '',
tipo TEXT CHECK (tipo IN ('INCIDENCIA_ALBARAN','APROBACION_FACTURA','OTRO')),
estado TEXT DEFAULT 'NUEVO' CHECK (estado IN ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO','RESUELTO','CERRADO')),
prioridad TEXT DEFAULT 'NORMAL' CHECK (prioridad IN ('BAJA','NORMAL','ALTA','CRITICA')),
prioridad_score INTEGER DEFAULT 0, prioridad_manual TEXT,            -- si está, gana
requiere_revision BOOLEAN DEFAULT false,                             -- algo del expediente está en REVISAR
proveedor_codigo TEXT, proveedor_nombre TEXT, cuenta_contable TEXT,
factura_numero TEXT, factura_fecha DATE, importe_centimos BIGINT, moneda TEXT DEFAULT 'EUR',
caso_referencia TEXT,
fecha_primera_notificacion TIMESTAMPTZ NOT NULL, fecha_ultima_notificacion TIMESTAMPTZ NOT NULL,
-- Cero, y no uno: un expediente creado a mano todavía no tiene ningún correo
-- detrás. La ingesta pone 1 al enlazar la primera notificación.
numero_notificaciones INTEGER DEFAULT 0, numero_reclamaciones INTEGER DEFAULT 0,   -- nivel_reclamacion
urgente BOOLEAN DEFAULT false, tarea_vencida BOOLEAN DEFAULT false,
asignado_usuario_id UUID, fecha_inicio_gestion TIMESTAMPTZ,
fecha_resolucion TIMESTAMPTZ, resuelto_por_usuario_id UUID, fecha_cierre TIMESTAMPTZ,
observaciones TEXT DEFAULT '', created_at, updated_at, UNIQUE (empresa_id, numero)
```
Índices: `(empresa_id, empresa_codigo, factura_numero)`, `(empresa_id, proveedor_codigo, factura_numero)`,
`(empresa_id, estado, prioridad)`, `(empresa_id, fecha_ultima_notificacion DESC)`,
`(empresa_id, requiere_revision) WHERE requiere_revision`.

«Reclamado» no es estado: es `numero_reclamaciones > 0`. `requiere_revision`
es un agregado derivado (se recalcula) para poder filtrar la bandeja sin
un join a validaciones.

### D.2 `thf_actuaciones`

```sql
id UUID PK, empresa_id, expediente_id UUID NOT NULL → thf_expedientes ON DELETE CASCADE,
tipo_accion TEXT CHECK (IN ('GRABAR','MODIFICAR','REVISAR','GESTIONAR','ANULAR','APROBAR','OTRO')),
albaran_solicitado TEXT,               -- tal cual venía en el correo («0501234»)
albaran_normalizado TEXT,              -- clave de cruce (H.2)
importe_centimos BIGINT,               -- lo que dice el correo; nunca se corrige
indicador_adicional TEXT,              -- «T2»: se conserva, no se interpreta
estado TEXT DEFAULT 'PENDIENTE' CHECK (IN ('PENDIENTE','EN_PROCESO','BLOQUEADA','RESUELTA','DESCARTADA')),
obligatoria BOOLEAN DEFAULT true, resultado TEXT,
erp_referencia TEXT, erp_estado JSONB, erp_consultado_at TIMESTAMPTZ,
confianza NUMERIC(3,2) DEFAULT 1.00, origen_notificacion_id UUID,
iniciada_por_usuario_id UUID, iniciada_at, resuelta_por_usuario_id UUID, resuelta_at,
observaciones TEXT DEFAULT '', created_at, updated_at
```
Índices: `(expediente_id)`, `(empresa_id, albaran_normalizado)`, y
`UNIQUE (expediente_id, tipo_accion, albaran_normalizado) WHERE albaran_normalizado IS NOT NULL AND estado <> 'DESCARTADA'`
(garantía del prompt §17: «789 nuevo, 123 y 456 existentes»).

`APROBAR` se añade a los tipos: una aprobación de factura es una actuación
resoluble y sin ella el expediente `APROBACION_FACTURA` no tendría nada que
resolver. `DESCARTADA` es lo que deja un cambio de instrucción: no se borra.

### D.3 `thf_notificaciones`

```sql
id UUID PK, empresa_id, expediente_id UUID NULL → thf_expedientes ON DELETE SET NULL,  -- NULL mientras espera decisión
message_id TEXT NOT NULL,               -- RFC Message-ID normalizado
gmail_message_id TEXT, gmail_thread_id TEXT, in_reply_to TEXT,   -- X-GM-MSGID / X-GM-THRID si el servidor es Gmail
fecha_email TIMESTAMPTZ NOT NULL, remitente TEXT, destinatario TEXT, asunto TEXT,
texto_original TEXT NOT NULL,           -- NUNCA se borra ni se edita
html_original TEXT, eml_storage_path TEXT,
tipo_notificacion TEXT DEFAULT 'SOLICITUD' CHECK (IN ('SOLICITUD','RECORDATORIO','RECLAMACION','TAREA_VENCIDA','CAMBIO_INSTRUCCION','APROBACION','OTRO')),
urgente_detectado BOOLEAN DEFAULT false, persona_solicitante TEXT, fecha_solicitud_texto TEXT,
hash_contenido TEXT NOT NULL,           -- sha256 del texto normalizado
parseado JSONB,                         -- CorreoParseado con confianzas: la evidencia
estado_proceso TEXT DEFAULT 'PROCESADA' CHECK (IN ('PROCESADA','PENDIENTE_DECISION','ERROR_PARSER','IGNORADA')),
error_proceso TEXT, created_at,
UNIQUE (empresa_id, message_id)
```
Índices: `(expediente_id, fecha_email)`, `(empresa_id, hash_contenido)`,
`(empresa_id, gmail_thread_id)`, `(empresa_id, estado_proceso) WHERE estado_proceso <> 'PROCESADA'`.

El prompt pide `gmail_message_id UNIQUE`. Aquí el **único es `message_id`**
(RFC), porque es lo que existe en cualquier buzón; `gmail_message_id` se
rellena cuando el servidor IMAP es Gmail y lleva su propio índice único
parcial. Si se elige la opción (a) del buzón (N.1), los dos existen siempre.

### D.4 `thf_adjuntos`

```sql
id UUID PK, empresa_id, notificacion_id UUID NOT NULL → CASCADE, expediente_id UUID NULL → SET NULL,
nombre_archivo TEXT, mime_type TEXT, tamano_bytes INTEGER,
tipo_documento TEXT DEFAULT 'OTRO' CHECK (IN ('PDF_FACTURA','PDF_ABONO','XML_FACTURA','OTRO')),
hash_archivo TEXT NOT NULL, storage_path TEXT NOT NULL,   -- <empresa>/<hash[0:2]>/<hash>.<ext>: el mismo fichero se guarda UNA vez
paginas INTEGER, tiene_texto BOOLEAN,                     -- lo que dijo mupdf
parsed BOOLEAN DEFAULT false, parse_error TEXT, created_at,
UNIQUE (notificacion_id, hash_archivo)
```
Índices: `(empresa_id, hash_archivo)`, `(expediente_id)`.

### D.5 `thf_documentos` (documento contable normalizado, por fichero)

```sql
id UUID PK, empresa_id, expediente_id UUID NOT NULL → CASCADE, adjunto_id UUID → SET NULL,
hash_archivo TEXT NOT NULL,
tipo_documento TEXT CHECK (IN ('FACTURA','ABONO','ALBARAN','OTRO')),
numero_documento TEXT, fecha_documento DATE,
proveedor_nombre TEXT, proveedor_nif TEXT, cliente_nombre TEXT, cliente_nif TEXT,
base_centimos BIGINT, iva_centimos BIGINT, total_centimos BIGINT, moneda TEXT DEFAULT 'EUR',
albaranes_detectados JSONB DEFAULT '[]',   -- [{numero_documento, normalizado, pagina_inicio, pagina_fin}]
origen TEXT CHECK (IN ('XML','PDF_TEXTO','PDF_IA')), parser_usado TEXT,
confianza JSONB DEFAULT '{}', metadata_json JSONB DEFAULT '{}',   -- extracción cruda entera
validacion TEXT DEFAULT 'SIN_COMPARAR' CHECK (IN ('SIN_COMPARAR','VALIDADO','DISCREPANCIA')),
discrepancias JSONB DEFAULT '[]', created_at, updated_at,
UNIQUE (expediente_id, hash_archivo)
```
Es la **cabecera** del documento (factura entera). Los albaranes que contiene
se analizan por actuación en D.6. El correo y el documento se comparan
(`comparar.ts`) y **nunca se sobrescribe** el dato del correo.

### D.6 `thf_albaranes_analizados` (entidad neutral, vale para toda acción)

```sql
id UUID PK, empresa_id, expediente_id UUID NOT NULL, actuacion_id UUID NOT NULL → CASCADE,
adjunto_id UUID → SET NULL, documento_id UUID → SET NULL,
numero_solicitado TEXT NOT NULL,        -- raw_incident_delivery_note
numero_documento TEXT,                  -- raw_pdf_delivery_note («ENT-770199-0501234»)
numero_normalizado TEXT,                -- normalized_delivery_note
confianza_match NUMERIC(3,2), resultado_match TEXT CHECK (IN ('MATCH','UNCERTAIN','NO_MATCH')),
fecha DATE, matricula TEXT, bastidor TEXT, observaciones TEXT,
importe_incidencia_centimos BIGINT,     -- copia del de la actuación en el momento del análisis
importe_lineas_centimos BIGINT,         -- SUM(importe_linea)
diferencia_centimos BIGINT,             -- lineas - incidencia
estado_analisis TEXT CHECK (IN ('OK','REVISAR','ERROR')),
estado_proceso TEXT DEFAULT 'PENDIENTE' CHECK (IN ('PENDIENTE','PROCESANDO','COMPLETADO','ERROR')),
intentos INTEGER DEFAULT 0, error TEXT,
pagina_inicio INTEGER, pagina_fin INTEGER, parser_usado TEXT, origen TEXT,   -- PDF_TEXTO | PDF_IA | XML
metadata_json JSONB DEFAULT '{}',       -- centro, delegación, pedido, taller, km, marca/modelo, conceptos_adicionales[], secciones_vecinas
created_at, updated_at
```
Índices: `(actuacion_id)`, `(empresa_id, estado_proceso) WHERE estado_proceso IN ('PENDIENTE','ERROR')`,
`(expediente_id)`. Una fila por **intento vivo**: reanalizar crea otra fila y
la anterior queda como histórico (`metadata_json.sustituida_por`), porque la
comparación «antes/después» de un parser corregido es justo lo que hay que
poder enseñar.

### D.7 `thf_albaran_lineas` y `thf_albaran_linea_descuentos`

```sql
thf_albaran_lineas:
id UUID PK, empresa_id, albaran_analizado_id UUID NOT NULL → CASCADE, numero_linea INTEGER NOT NULL,
referencia TEXT, descripcion TEXT, cantidad NUMERIC(12,3), precio_unitario_centimos BIGINT,
importe_centimos BIGINT,
confianza_referencia, confianza_descripcion, confianza_cantidad, confianza_precio, confianza_importe NUMERIC(3,2),
confianza_descuentos NUMERIC(3,2), cuadra_aritmetica BOOLEAN,   -- cantidad·precio·(1‑d1)·(1‑d2) ≈ importe
raw_text TEXT NOT NULL, pagina INTEGER, bbox JSONB,             -- {x,y,w,h} en puntos de página
metadata_json JSONB DEFAULT '{}', created_at,
UNIQUE (albaran_analizado_id, numero_linea)

thf_albaran_linea_descuentos:
id UUID PK, linea_id UUID NOT NULL → CASCADE, orden INTEGER NOT NULL,
porcentaje NUMERIC(6,3), raw_value TEXT NOT NULL,
UNIQUE (linea_id, orden)
```
`60% + 10%` son dos filas ordenadas, y `raw_value` conserva lo impreso.
**Nunca** se colapsa a 64 %.

### D.8 `thf_validaciones`

```sql
id UUID PK, empresa_id, expediente_id UUID NOT NULL, actuacion_id UUID, albaran_analizado_id UUID,
tipo TEXT CHECK (IN ('ALBARAN_MATCH','IMPORTE','LINEAS','DESCUENTOS','CAMPOS_CRITICOS','SEPARACION_ALBARANES','DOCUMENTO','CORREO_VS_DOCUMENTO')),
estado TEXT CHECK (IN ('OK','REVISAR','ERROR')),
mensaje TEXT NOT NULL,                  -- escrito para la pantalla
valor_esperado TEXT, valor_obtenido TEXT, metadata_json JSONB DEFAULT '{}', created_at
```
Índices: `(albaran_analizado_id)`, `(expediente_id, estado) WHERE estado <> 'OK'`.
Es lo que explica **por qué** algo está en REVISAR.

### D.9 `thf_eventos`, `thf_decisiones`, `thf_config`, `thf_contadores`, `thf_buzon_pasadas`

- `thf_eventos`: `expediente_id, notificacion_id, actuacion_id, albaran_analizado_id, tipo, actor_tipo ('sistema'|'usuario'), usuario_id, usuario_nombre, datos_anteriores JSONB, datos_nuevos JSONB, descripcion, occurred_at, huella` + trigger de huella + candado `BEFORE UPDATE OR DELETE` (L).
- `thf_decisiones`: lo que espera a una persona: `tipo IN ('POSIBLE_DUPLICADO','CAMBIO_INSTRUCCION','RECLAMACION_SOBRE_RESUELTO','REQUIERE_REVISION','ERROR_PARSER')`, `notificacion_id`, `expediente_id`, `candidatos JSONB` (con puntuación y motivos), `detalle JSONB`, `estado ('PENDIENTE'|'DECIDIDA')`, `decision`, `decidida_por_usuario_id`, `decidida_at`.
- `thf_config (empresa_id, clave, valor, updated_at)` PK compuesta.
- `thf_contadores (empresa_id, serie, last_seq)`.
- `thf_buzon_pasadas`: una fila por pasada del listener (como `tc_checkpoint_ejecuciones`).

### D.10 Claves de `thf_config` (defectos en `config.ts`; la tabla solo guarda cambios)

| Clave | Defecto |
|---|---|
| `dedupe.peso.misma_factura / mismo_albaran / mismo_proveedor / mismo_importe / misma_empresa / mismo_documento / misma_accion / mismo_hilo` | 50 / 45 / 20 / 15 / 10 / 10 / 10 / 30 |
| `dedupe.peso.factura_diferente / proveedor_diferente / tipo_incompatible` | −40 / −20 / −40 |
| `dedupe.umbral.fusionar / revisar`, `dedupe.ventana_dias` | 70 / 40, 120 |
| `prioridad.peso.dias_abierto / reclamaciones / urgente / tarea_vencida` | 2 / 10 / 25 / 15 |
| `prioridad.umbral.baja / alta / critica` | 10 / 40 / 70 |
| `parser.umbral_confianza`, `parser.palabras_urgente`, `parser.palabras_reclamacion` | 0.80, `urgente,urgent`, `reclamaci,seguimos sin,segunda vez,de nuevo,todavía no` |
| `albaran.umbral_match` / `albaran.umbral_incierto` | 0.90 / 0.60 |
| `albaran.tolerancia_centimos` | 2 (solo redondeos) |
| `albaran.umbral_confianza_campo` | 0.85 |
| `albaran.max_intentos`, `albaran.max_paginas` | 3, 60 |
| `albaran.cabeceras` (sinónimos de «Albarán») | `albarán,albaran,alb.,nº albarán,n. albarán,delivery note,entrega,ENT-` |
| `albaran.columnas.*` (sinónimos por columna) | referencia: `ref,referencia,artículo,código`; cantidad: `cant,cantidad,uds,unid`; precio: `precio,p.unit,pvp`; descuento: `dto,dto.,desc,descuento`; importe: `importe,total,neto` |
| `albaran.conceptos_globales` | `portes,transporte,tasa,recargo,rappel,base imponible,iva,total factura,subtotal,suma` |
| `buzon.remitentes`, `expediente.dias_autocierre`, `empresas.<codigo>` | (decisión N), 30, nombre de la sociedad |

Las listas de sinónimos están en configuración **para que un proveedor nuevo
se atienda sin desplegar** cuando basta con una palabra; cuando no basta, se
escribe un parser específico (G.3).

---

## E. Parser de email

Vive en `domain/correo/`, puro y con pruebas. Entra `{asunto, texto}` (el
texto ya en plano: `mailparser` da `text`, y si solo hay HTML, `html-to-text`
que ya trae) y sale `CorreoParseado`:

```ts
type CorreoParseado = {
  categoria: Campo<'INCIDENCIA_ALBARAN'|'APROBACION_FACTURA'|'TAREA_VENCIDA'|'OTRO'>;
  empresaCodigo: Campo<string>; empresaNombre: Campo<string>;
  proveedorCodigo, proveedorNombre, cuentaContable, facturaNumero, facturaFecha: Campo<string>;
  importeCentimos: Campo<number>; moneda: Campo<string>;
  urgente: boolean; palabrasReclamacion: string[];
  persona: Campo<string>; fechaSolicitudTexto: Campo<string>;
  actuaciones: ActuacionParseada[];   // {accion: Campo<TipoAccion>, albaran: Campo<string>, importeCentimos?: Campo<number>, indicador?: string, raw: string}
  albaranesAmbiguos: string[];        // líneas con número que no se pudo asignar
  origen: 'PLANTILLA' | 'HEURISTICA' | 'IA';
};
type Campo<T> = { valor: T | null; confianza: number; raw?: string };
```

Tres capas, en este orden, y cada una solo rellena lo que la anterior dejó
vacío:

1. **Plantilla** (`plantilla.ts`, confianza 0.99): las etiquetas fijas de
   Therefore — `Empresa <código> <nombre>`, `Código Proveedor:`, `Razón
   Social:`, `Cuenta Contable:`, `Número Factura:`, `Fecha Factura:`,
   `Importe:` — y la categoría por la primera línea (`Incidencia en factura
   recibida`, `Aprobación de factura`, `Tarea vencida`). `URGENTE` en línea
   propia o en el asunto; `dd/mm/aaaa Nombre` como persona y fecha.
2. **Heurística de actuaciones** (`actuaciones.ts`, confianza 0.90–0.95):
   el bloque «Información Adicional» se recorre línea a línea con una
   **acción vigente**: una línea que es solo un verbo de acción (`Grabar`,
   `Grabar:`, `Modificar`, `Revisar`, `Anular`, `Gestionar`, con o sin dos
   puntos, con o sin acento, en cualquier caja) cambia la acción vigente; una
   línea que empieza por un número de 5–13 dígitos (con guiones o puntos
   opcionales) es un albarán bajo la acción vigente, y lo que la sigue en la
   misma línea se descompone en **importe** (`199.95e`, `17,87 €`, `137.08€`)
   e **indicador adicional** (lo que quede: `T2`), que se conserva sin
   interpretar. Un verbo en prosa («por favor grabar el siguiente albarán»,
   «necesitamos que grabéis») también fija la acción vigente, con confianza
   0.90. Varios albaranes en una línea separados por coma o espacio se
   admiten. Un número sin acción vigente → `albaranesAmbiguos` (no se
   inventa). «Varios albaranes» con acciones distintas se resuelven porque la
   acción vigente cambia por bloque.
3. **IA como respaldo** (`origen: 'IA'`, confianza la que declare el modelo
   con tope 0.85): solo si tras 1 y 2 quedan `albaranesAmbiguos` o la
   categoría es `OTRO` con números en el texto. Esquema estricto con la misma
   forma de `ActuacionParseada`. Sin `OPENAI_API_KEY` se salta.

`normalizar.ts` convierte a lo que entiende el dominio: céntimos con signo
(`importes.ts` admite `‑45,63`, `-45.63`, `199.95e`, `1.234,56 €`, `(45,63)`),
`albaran_normalizado` (H.2), fecha ISO, proveedor sin sufijos societarios para
comparar. `confianza.ts` aplica `parser.umbral_confianza`: cualquier campo
crítico (albarán, acción, factura, importe) por debajo → `requiereRevision`.

`tipo_notificacion` **no lo decide el parser** sino el dedupe (F.5): el mismo
texto es `SOLICITUD` si crea expediente y `RECLAMACION` si cae sobre uno
abierto.

---

## F. Deduplicación

`domain/dedupe.ts`, puro: entra el correo normalizado, los candidatos y los
pesos; sale `{decision, mejor, candidatos: [{id, numero, estado, score, motivos[]}], cambiosInstruccion[], actuacionesNuevas[]}`.

### F.1 Candidatos (una consulta en `repository.ts`)

Expedientes de la misma `empresa_id` con `fecha_ultima_notificacion` dentro
de `dedupe.ventana_dias` que cumplan **al menos una**: misma `empresa_codigo`
+ `factura_numero`; mismo `proveedor_codigo` + `factura_numero`; alguna
actuación con `albaran_normalizado` en la lista del correo; algún adjunto con
el mismo `hash_archivo`; alguna notificación con el mismo `hash_contenido` o
el mismo `gmail_thread_id`/`in_reply_to`. Se incluyen `RESUELTO`/`CERRADO`.

### F.2 Puntuación

```
+50 misma factura (empresa_codigo + factura_numero)   +45 mismo albarán (una vez aunque coincidan varios)
+20 mismo proveedor (código; si falta, nombre normalizado)   +15 mismo importe (con signo)
+10 misma empresa   +10 mismo documento (hash)   +10 misma acción sobre albarán común
+30 mismo hilo (gmail_thread_id / In-Reply-To)          ← añadido
−40 factura diferente (ambos la tienen y difieren)   −20 proveedor diferente (ídem)
−40 tipo incompatible (INCIDENCIA_ALBARAN vs APROBACION_FACTURA)   ← redefinido
```

Dos desviaciones deliberadas respecto a la tabla del prompt:

1. **«Acción incompatible» no resta cuando el albarán coincide.** Con la
   tabla literal, `GRABAR 9011223344` seguido de `MODIFICAR 9011223344` daría
   45 + 10 + 20 − 40 = 35 → expediente nuevo, justo lo que §16 prohíbe. Un
   albarán conocido con otra acción **es un cambio de instrucción sobre el
   mismo expediente**. El −40 se reserva para la incompatibilidad de tipo.
2. **«Mismo hilo» (+30)**: Gmail agrupa las reclamaciones de Therefore en el
   hilo del primer correo. Es la señal más barata y fiable, pero sola no
   fusiona (30 < 40).

Cada sumando se anota en `motivos[]` con texto («misma factura 0000555111»,
«albarán 802316 ya en INC-452»): es lo que enseña la pantalla de revisión y lo
que se guarda en `thf_decisiones.candidatos`.

### F.3 Aprobaciones

Para `APROBACION_FACTURA` y `TAREA_VENCIDA` la clave es exacta:
`(empresa_codigo, proveedor_codigo, factura_numero)` → si existe un
`APROBACION_FACTURA` con esa terna en la ventana, fusionar (score 100). Si
falta el código de proveedor, se cae a F.2. «Aprobación + 3 tareas vencidas»
= 1 expediente, 4 notificaciones, `tarea_vencida = true`.

### F.4 Decisión

```
mejor = mayor score (desempate: más reciente)
score >= 70 y mejor abierto        → fusionar (F.5)
score >= 70 y mejor RESUELTO/CERRADO → thf_decisiones RECLAMACION_SOBRE_RESUELTO; NO se reabre
40 <= score < 70                   → thf_decisiones POSIBLE_DUPLICADO con todos los >= 40; notificación sin expediente
score < 40                         → crear expediente
```
En cualquier camino: campos críticos bajo umbral → `requiere_revision` +
decisión `REQUIERE_REVISION`; albarán ambiguo → sin actuación, se guarda en
`parseado.albaranesAmbiguos` y se pide a una persona.

### F.5 Fusionar (una transacción)

1. Enlazar notificación; `numero_notificaciones + 1`; `fecha_ultima_notificacion`.
2. Clasificar: `TAREA_VENCIDA` si la categoría lo dice; `RECLAMACION` si hay
   palabras de reclamación, urgencia, o es la tercera o posterior;
   `RECORDATORIO` si no. `RECLAMACION`/`TAREA_VENCIDA` → `numero_reclamaciones + 1`.
3. `urgente |= urgente_detectado`; `tarea_vencida` igual.
4. **Comparación a nivel de actuación** (§17): por cada actuación del correo:
   mismo albarán y misma acción → nada; albarán nuevo → `INSERT` +
   `ACTUACION_ANADIDA` + encolar análisis; mismo albarán y acción distinta →
   la existente **no se toca**, `thf_decisiones CAMBIO_INSTRUCCION`
   `{albaran, anterior, nueva}`, notificación `CAMBIO_INSTRUCCION`, expediente
   `BLOQUEADO` hasta decidir.
5. Adjuntos: se registran; un hash ya visto en el expediente no se vuelve a
   extraer; si un adjunto nuevo es PDF y hay actuaciones sin análisis o con
   análisis `ERROR` por «documento no disponible», se reencolan.
6. El expediente no retrocede de estado por recibir correo.
7. Recalcular prioridad; evento `EMAIL_RECIBIDO` / `RECLAMACION_RECIBIDA`.

### F.6 Decisiones humanas

| Decisión | Efecto |
|---|---|
| POSIBLE_DUPLICADO → Fusionar en X / Crear nuevo | F.5 sobre X / crear |
| CAMBIO_INSTRUCCION → Aceptar nueva | anterior `DESCARTADA`, nueva `PENDIENTE` (+ análisis reencolado), desbloquear |
| → Mantener anterior | nada cambia; anotar; desbloquear |
| → Bloquear / consultar | sigue `BLOQUEADO`, observación obligatoria |
| RECLAMACION_SOBRE_RESUELTO → Reabrir | `RESUELTO` → `PENDIENTE`, evento, luego F.5 |
| → Confirmar resuelto | notificación enlazada como `RECLAMACION`, contadores suben, estado igual |
| → Crear relacionado | expediente nuevo con evento cruzado en ambos |
| REQUIERE_REVISION → Corregir | el usuario fija albarán/acción/importe; se crean actuaciones y se encola análisis |
| ERROR_PARSER → Reprocesar / Ignorar | desde el `.eml` guardado / `IGNORADA` con motivo |

---

## G. Parser de documentos

### G.1 Texto primero, OCR solo si hace falta (§50)

`documentos/texto.ts` abre el PDF con `mupdf` y devuelve
`PaginaTexto[] = {numero, ancho, alto, lineas: LineaTexto[]}` con
`LineaTexto = {texto, x, y, w, h, fuente, tamano}` ordenadas por `y` y luego
`x`. Es lo que ya hace `pdfRasterizer.ts` pero pidiendo texto estructurado
en vez de píxeles. `esEscaneado(paginas)` es verdadero cuando la suma de
caracteres por página no llega a un mínimo (`albaran.min_chars_pagina`, 40):
solo entonces se rasteriza (`rasterizarPdf`, ya existe) y la **página** va a
`pedirIA` con visión y el esquema de G.4. Un PDF digital nunca se degrada a
imagen.

Salvaguardas: `albaran.max_paginas` (60) y tamaño máximo (15 MB, como
`invoice-scan`); por encima, `ERROR` con mensaje claro.

### G.2 XML

Cuando se conozca el formato (N.5): `documentos/xml.ts` produce el mismo
`DocumentoExtraido` que el parser de PDF, con `origen = 'XML'` y confianza
1.0 en los campos que el XML declara. Un XML **gana** al PDF para la cabecera
de la factura (número, fecha, totales); para las líneas del albarán se usa
si las trae desglosadas por albarán, y si no, el PDF. Ambas fuentes se
guardan.

### G.3 Arquitectura de parsers (§49)

```ts
interface ParserDocumento {
  clave: string;                                     // 'generico', 'proveedor-x'…
  aplica(doc: DocumentoTexto): number;               // 0..1: cuánto reconoce este formato
  extraerCabecera(doc): CabeceraDocumento;           // número, fecha, proveedor, totales
  localizarAlbaranes(doc): SeccionAlbaran[];         // TODOS los del documento, delimitados
  extraerLineas(seccion): LineaArticulo[];
  extraerComplementarios(seccion): DatosComplementarios;
}
```

`parsers/index.ts` → `seleccionarParser(doc, registro)`: llama a `aplica()`
de cada parser registrado y elige el de mayor puntuación **siempre que
supere al genérico por un margen** (`albaran.margen_parser_especifico`,
0.15); si ninguno lo supera, el genérico. La selección no sabe de
actuaciones, expedientes ni rutas: recibe texto, devuelve parser. Un parser
de proveedor se registra en `parsers/index.ts` y puede **heredar** del
genérico sobrescribiendo solo lo que difiere (p. ej. cómo se escribe la
cabecera de albarán). El nombre del parser usado se guarda en
`parser_usado` en documento, albarán y líneas.

Hoy solo existe `generico.ts`. **No se escribe ningún parser específico sin
un documento real que lo justifique** (§48, §49).

### G.4 IA como respaldo, no como primera opción

`extractorIA.ts` implementa el mismo contrato de `extraerLineas` y
`extraerComplementarios` sobre **la sección ya delimitada** (texto de la
sección, o imagen de las páginas de la sección si es escaneado), con esquema
estricto: líneas `{referencia, descripcion, cantidad, precio, descuentos_raw,
importe, confianza_*}` **como texto impreso**, igual que `invoice-scan`. Se
usa cuando el genérico no encuentra cabecera de tabla o extrae cero líneas
en una sección que sí tiene texto, y siempre marca `origen = 'PDF_IA'` y
tope de confianza 0.85: una línea leída por IA nunca sale `OK` sin que la
aritmética cuadre (H.4). La localización del albarán (H.1–H.2) **no** se
delega a la IA: es determinista o es `REVISAR`.

---

## H. Parser de albaranes

### H.1 Localizar y delimitar (`secciones.ts`)

1. **Aplanar el documento**: las páginas se concatenan en una sola secuencia
   de `LineaTexto` con su `pagina`. Antes se retiran las **líneas repetidas
   de cabecera y pie**: texto idéntico en la misma `bbox` (±2 pt) en dos o
   más páginas (logotipo, «Página n de m», datos fiscales). Así un albarán
   que empieza al final de una página y sigue en la siguiente es una sección
   continua (§23, caso 14).
2. **Marcas de albarán**: una línea que contiene un sinónimo de
   `albaran.cabeceras` seguido (en la misma línea o en la siguiente dentro
   de la misma banda `y`) de un identificador `[A-Z]{0,4}[-\s]?\d{3,}([-\s]\d+)*`
   es una marca. La lista de sinónimos es configurable; el patrón del
   identificador es genérico (§48).
3. **Secciones**: cada marca abre una sección que termina cuando: empieza la
   siguiente marca; empieza una sección inequívoca de totales de factura
   (`conceptos.ts`: «Base imponible», «Total factura», «IVA» **a nivel de
   documento**, que se distinguen de una línea de artículo por no tener
   referencia ni cantidad); o termina el documento. Las líneas anteriores a
   la primera marca no pertenecen a ningún albarán (cabecera de factura).
4. Cada sección guarda `pagina_inicio`, `pagina_fin`, `numero_documento`
   (raw), su `bbox` de inicio y las **secciones vecinas** (anterior y
   siguiente) para la validación de separación (I).

Si el documento no tiene ninguna marca pero sí tabla de artículos, se crea
una única sección «documento entero» con `numero_documento = null`: el
match será `UNCERTAIN` como mucho, nunca `MATCH`.

### H.2 Normalización y comparación del número (`domain/albaran.ts`)

```
normalizarAlbaran("ENT-770199-0501234") → { completo: "ENT7701990501234", nucleo: "501234", segmentos: ["ENT","770199","0501234"] }
normalizarAlbaran("0501234")            → { completo: "0501234",           nucleo: "501234", segmentos: ["0501234"] }
```
Mayúsculas, sin espacios ni guiones ni puntos; `nucleo` = último segmento
numérico sin ceros a la izquierda. `compararAlbaranes(solicitado, documento)`
devuelve `{resultado, confianza}`:

| Caso | Confianza | Resultado |
|---|---|---|
| `completo` iguales | 1.00 | MATCH |
| mismo `nucleo`, mismos dígitos salvo ceros a la izquierda | 0.95 | MATCH |
| el solicitado es un segmento entero del documento (`0501234` ∈ `ENT-770199-0501234`) | 0.92 | MATCH |
| el solicitado es sufijo del `completo` del documento con ≥ 6 dígitos y el carácter anterior es separador o letra | 0.85 | UNCERTAIN (≥ `umbral_incierto`) |
| coincidencia parcial menor, o distancia de edición 1 en el núcleo | 0.40 | NO_MATCH, pero se anota como «parecido» |
| nada | 0 | NO_MATCH |

Umbrales configurables (`albaran.umbral_match` 0.90, `albaran.umbral_incierto`
0.60). **Dos albaranes parecidos** (`0501234` y `0501235`) no se confunden:
la comparación exige igualdad del núcleo, no similitud (caso 13). Si en el
documento hay **dos secciones** que dan MATCH con el mismo solicitado
(albarán repetido en la factura), el resultado baja a UNCERTAIN con mensaje.

### H.3 Extraer líneas (`tabla.ts`, `lineas.ts`)

1. **Cabecera de columnas**: dentro de la sección (o justo antes de la
   primera marca, si la tabla es única para todo el documento) se busca la
   línea con ≥ 3 sinónimos de columnas (`albaran.columnas.*`). Su `x` por
   palabra define las **columnas**: cada celda de una fila se asigna a la
   columna cuyo rango `x` la contiene o está más cerca. Si no hay cabecera,
   se intenta el **modo posicional**: referencia = primer token que parece
   código (`\d{6,}` o `[A-Z0-9-]{5,}`), importe = último número con dos
   decimales, cantidad = primer número pequeño con decimales antes del
   precio, descuento = tokens con `%`; todo con confianza 0.70.
2. **Filas**: una `LineaTexto` de la sección es candidata a artículo si
   tiene un importe al final (número con dos decimales, con o sin €) y algo
   de texto antes. Las líneas de continuación (descripción que salta de
   línea, sin números) se pegan a la anterior. Una fila que solo tiene texto
   de `albaran.conceptos_globales` y un importe **no es artículo**: va a
   `metadata_json.conceptos_adicionales` (§32, caso 22).
3. **Descuentos** (`descuentos.ts`): la celda de descuento se parte por `+`,
   `,` o espacios; cada trozo `\d+(,\d+)?\s*%` es un descuento con `orden`;
   `raw_value` es la celda entera. `60% + 10%` → dos filas. Nada se
   multiplica (§27).
4. **Comprobación aritmética por línea** (`cuadra_aritmetica`):
   `cantidad × precio × Π(1 − dᵢ)` redondeado a céntimo, contra `importe`,
   con `albaran.tolerancia_centimos`. Si cuadra, la confianza de referencia,
   cantidad, precio, descuento e importe sube a ≥ 0.95 (los cinco valores se
   corroboran mutuamente). Si no cuadra, ninguno pasa de 0.80 y la línea
   entra en REVISAR con validación `LINEAS`. Es la salvaguarda contra un
   número mal leído (§52): un `77,50` leído como `77,56` deja de cuadrar.
5. **Referencia dudosa** (caso 17): sin token de referencia, o con uno que
   mezcla dígitos y letras raras (`O`/`0`, `I`/`1`) en una columna donde
   todas las demás son numéricas → `referencia = null`, confianza 0.30,
   REVISAR. Nunca se corrige a mano por el parser.
6. Cada línea conserva `raw_text`, `pagina`, `bbox` y `parser_usado` (§51).

### H.4 Complementarios (`complementarios.ts`)

Dentro de la sección (y, para matrícula y bastidor, también en la banda de
texto inmediatamente anterior a la primera línea de artículo): matrícula
(patrón español moderno `\d{4}\s?[BCDFGHJKLMNPRSTVWXYZ]{3}` y antiguos con
provincia), bastidor (17 caracteres sin I/O/Q), fecha junto a la marca de
albarán, y etiquetas `Pedido`, `Centro`, `Delegación`, `Taller`, `Km`,
`Marca/Modelo`, `Observaciones` / `Obs.` seguidas de valor. Lo etiquetado
que no tenga columna va a `metadata_json` (§28): no se pierde nada por no
tener sitio.

### H.5 Ejemplo de referencia (§35, solo como fixture)

Con el fixture generado con esos valores: sección `ENT-770199-0501234`
(MATCH 0.92 por segmento), 4 líneas, `27,90 + 186,00 + 31,90 + 63,36 =
336,18`, cada línea cuadra (`77,50 × 0,4 × 0,9 = 29,196 → 27,90`), matrícula
`4417KDT`, bastidor `WZ10A2BCDEF345678`, observación `ENTREGAR EN TGNA.`,
`diferencia = +63,35` frente a `199,95` → validación `IMPORTE` en REVISAR con
el mensaje literal del prompt, estado del análisis `REVISAR`. Ninguno de
esos valores aparece en código de producción: la suma se calcula.

---

## I. Validaciones

`domain/validaciones.ts` recibe el albarán analizado, sus líneas, la
actuación y las secciones vecinas, y devuelve `Validacion[]`; el estado del
análisis es el peor de todas (`ERROR > REVISAR > OK`).

| Tipo | OK | REVISAR | ERROR |
|---|---|---|---|
| `DOCUMENTO` | PDF abierto, texto o imagen obtenidos | — | sin adjunto, > páginas/tamaño, PDF corrupto, sin texto ni IA disponible |
| `ALBARAN_MATCH` | MATCH ≥ umbral_match | UNCERTAIN, o dos secciones coinciden | NO_MATCH en todas las secciones («albarán no encontrado») |
| `SEPARACION_ALBARANES` | sección con inicio y fin claros, sin líneas huérfanas entre el fin y la siguiente marca | fin por «fin de documento» con otra marca después de líneas sin cabecera; líneas pegadas al borde de página sin continuación reconocida; sección «documento entero» | — |
| `LINEAS` | ≥ 1 línea y todas cuadran | 0 líneas con texto en la sección; alguna no cuadra; línea leída por IA | 0 líneas y sin texto |
| `DESCUENTOS` | todos parseados | celda de descuento con texto no reconocido | — |
| `CAMPOS_CRITICOS` | referencia, cantidad, precio, importe ≥ `umbral_confianza_campo` en todas las líneas | alguna por debajo o `null` | — |
| `IMPORTE` | `|diferencia| ≤ tolerancia` o sin importe en la actuación | diferencia mayor: «Existe un descuadre entre el importe indicado en la incidencia y las líneas del albarán. Requiere revisión.» | — |
| `CORREO_VS_DOCUMENTO` | factura/importe del correo = cabecera del documento | difieren (se guardan ambos) | — |

Cada validación guarda `valor_esperado` / `valor_obtenido` y `metadata_json`
(páginas, bbox, líneas afectadas). **No se intenta explicar** una diferencia
de importe con portes o tasas (§31–32): los conceptos globales se enseñan
aparte como información.

`requiere_revision` del expediente = existe alguna validación no OK viva, o
alguna decisión pendiente, o `requiere_revision` del parser de correo.

---

## J. UI

Ruta `/therefore/*`, lazy en `App.tsx`, tarjeta en el hub, tema slate/sky.

### J.1 Bandeja (`pages/Bandeja.tsx`)

Pestañas con contador (filtros, no estados): **Pendientes**
(`NUEVO`+`PENDIENTE`+`BLOQUEADO`), **Urgentes**, **Reclamados**
(`numero_reclamaciones > 0` abiertos), **En proceso**, **Revisar**
(`requiere_revision` o decisiones pendientes), **Resueltos**. Tabla
ordenable: `● | Expediente | Fecha | Empresa | Tipo | Proveedor | Factura |
Actuaciones | Recl. | Antigüedad | Asignado | Estado`; en «Actuaciones»,
hasta dos (`GRABAR 802316 · MODIFICAR 0804210`) con un punto de color por
estado de análisis, y «+1». Filtros: estado, prioridad, empresa, proveedor,
acción, usuario, reclamado, urgente, **requiere revisión**, rango de fechas,
texto. Botones: «Revisar buzón», «Importar .eml» (admin).

### J.2 Detalle (`pages/Expediente.tsx`)

Cabecera: número, título derivado (`GRABAR ALBARÁN 9011223344` o `3
ACTUACIONES`), chips `URGENTE`, `n reclamaciones`, `n días abierto`,
proveedor, factura, importe con signo; acciones Asignar / Prioridad / Estado.
Banner de decisiones pendientes con sus botones (F.6). Pestañas:
**Resumen · Actuaciones · Albaranes analizados · Documentos · Notificaciones
· Validaciones · Histórico**.

### J.3 Actuaciones (`components/Actuaciones.tsx`)

Una tarjeta por actuación: albarán, acción, importe del correo, indicador
adicional (tal cual), estado, **Análisis: OK / REVISAR / ERROR / pendiente**,
botones `Iniciar` `Resolver` `Bloquear` `Revisar` (este último abre el
albarán analizado) y `Reanalizar`; `erp_referencia` editable; bloque ERP
(«sin datos del ERP» hoy).

### J.4 Albarán analizado (`components/AlbaranAnalizado.tsx`, `LineasAlbaran.tsx`)

Común a toda acción, con un **encabezado que cambia según la acción** (§41):
`GRABAR` → «Datos para entrada manual en ERP»; `MODIFICAR` → «Datos del
documento para modificación en ERP» (con hueco para la futura comparación
PDF vs ERP); `REVISAR`/`GESTIONAR`/`ANULAR` → «Albarán estructurado». Debajo:
acción, proveedor, factura, albarán solicitado, albarán localizado (con
confianza), fecha; tabla `Referencia | Descripción | Cantidad | Precio |
Descuento | Importe` con los descuentos encadenados tal cual (`60% + 10%`),
**celdas dudosas marcadas** (ámbar, con la confianza en tooltip) y las
`null` en rojo «sin leer»; fila de suma calculada; matrícula, bastidor,
observaciones; datos adicionales de `metadata_json`; conceptos globales
aparte con la nota «no incluidos en la suma». Cada línea tiene un enlace
«ver en PDF» que abre el visor en la página y resalta el `bbox` (el PDF va
por enlace firmado; el resalte se pinta encima con la `bbox` guardada).

### J.5 Validaciones (`components/Validaciones.tsx`)

Lista por albarán analizado: `Coincidencia albarán`, `Importe incidencia /
Suma líneas / Diferencia` (signo y color), `Separación de albaranes`,
`Campos dudosos: n`, `Líneas`, `Descuentos`, `Documento`, y el estado
general. Cada fila enseña `valor_esperado` / `valor_obtenido` y el mensaje.

### J.6 Documentos, notificaciones, histórico, revisión, configuración

Documentos: adjuntos con tipo, hash corto, «venía en n correos», enlace, y
la cabecera extraída con `VALIDADO/DISCREPANCIA` frente al correo.
Notificaciones: timeline con raíl de puntos (`02/09 10:14 Solicitud original
· Daniel G`, `14/09 17:00 URGENTE · Reclamación #3`), cada una desplegable con
el texto original íntegro. Histórico: `thf_eventos` con actor y
anterior → nuevo. `pages/Revision.tsx`: decisiones pendientes agrupadas por
tipo, con candidatos, puntuación y motivos. `pages/Configuracion.tsx`
(admin): pesos, umbrales, sinónimos, remitentes, sociedades, estado del
buzón y últimas pasadas.

### J.7 Componentes y datos

`components/ui.tsx` reexporta el kit de Administración y añade `ChipEstado`,
`ChipPrioridad`, `ChipAnalisis`; fechas con `fmtFecha`/`fmtFechaHora`;
importes con `eurosConSigno`. La derivación de pestañas, contadores y orden
va en `services/bandeja.ts` puro con `.test.ts` (sin pruebas de componentes,
como el resto del repo).

---

## K. Procesamiento asíncrono

No hay cola genérica; se usa **el patrón del proyecto**: la tabla es la cola.

- **Cola**: `thf_albaranes_analizados.estado_proceso`
  (`PENDIENTE → PROCESANDO → COMPLETADO | ERROR`) + `intentos`.
- **Encolado**: la ingesta del correo crea la fila `PENDIENTE` por cada
  actuación con albarán en la misma transacción del expediente. Sin adjunto
  PDF todavía, la fila se crea igual y sale `ERROR` «documento no
  disponible»; cuando llegue un adjunto (F.5.5) se reencola.
- **Worker** (`documentos/worker.ts`, copia de `autoscan/worker.ts`): cada
  15 s, lote de 3 (una IA por sección como mucho), `UPDATE … SET
  estado_proceso='PROCESANDO', intentos = intentos + 1 WHERE id = (SELECT id
  … WHERE estado_proceso='PENDIENTE' ORDER BY created_at FOR UPDATE SKIP
  LOCKED LIMIT 1)`: seguro con varias instancias en Render. `unref()`,
  `startThereforeWorkers` / `stopThereforeWorkers`, y `procesarPendientes(n)`
  exportado para que las pruebas lo llamen sin temporizador.
- **Reintentos**: un `ERROR` técnico (IA caída, storage no responde) vuelve
  a `PENDIENTE` hasta `albaran.max_intentos`; un `ERROR` de dominio (albarán
  no encontrado) es terminal y se enseña. `POST
  /actuaciones/:id/reanalizar` crea una fila nueva `PENDIENTE` y deja la
  anterior como histórico. Una fila `PROCESANDO` con más de 10 minutos se
  considera huérfana (instancia reiniciada) y vuelve a `PENDIENTE` en la
  siguiente pasada.
- **Otros temporizadores**: listener IMAP (cada `THEREFORE_IMAP_MIN`
  minutos) y recálculo de prioridad + autocierre (cada hora, solo sobre lo
  que no se recalculó hoy). Los tres se registran en `app.listen` de
  `server/index.ts` como los demás.
- **Errores** (§45): un fallo del análisis nunca toca el expediente ni la
  actuación; se guarda en `error` con contexto (adjunto, página, parser,
  paso) y en `thf_validaciones DOCUMENTO`, y `console.error("[Therefore] …")`
  sin volcar contenido del documento.

---

## L. Auditoría

Dos registros, como en Assist:

- **`thf_eventos`**: timeline del expediente, inmutable (huella + candado).
  Tipos: `EXPEDIENTE_CREADO`, `EMAIL_RECIBIDO`, `DOCUMENTO_PROCESADO`,
  `DUPLICADO_DETECTADO`, `DUPLICADO_FUSIONADO`, `RECLAMACION_RECIBIDA`,
  `PRIORIDAD_MODIFICADA`, `USUARIO_ASIGNADO`, `ACTUACION_ANADIDA`,
  `ACTUACION_INICIADA`, `ACTUACION_BLOQUEADA`, `ACTUACION_RESUELTA`,
  `ACTUACION_DESCARTADA`, `ALBARAN_ANALIZADO`, `ANALISIS_ERROR`,
  `VALIDACION_FALLIDA`, `CAMBIO_INSTRUCCION`, `CAMBIO_INSTRUCCION_DECIDIDO`,
  `REQUIERE_REVISION`, `REVISION_RESUELTA`, `EXPEDIENTE_RESUELTO`,
  `EXPEDIENTE_REABIERTO`, `EXPEDIENTE_CERRADO`, `RECLAMACION_SOBRE_RESUELTO`,
  `ESTADO_MODIFICADO`, `OBSERVACION_ANADIDA`. Siempre con `actor_tipo`,
  `usuario_id`, `datos_anteriores`, `datos_nuevos` y una `descripcion` para
  la pantalla.
- **`app_auditoria`**: toda acción de usuario vía `registrarAuditoria`
  (`accion = 'therefore.<evento>'`, `entidad`, `entidad_id`, `detalle`). Es el
  registro transversal de la plataforma; no se estrena uno paralelo.
- **Trazabilidad de la extracción** (§51): en documento, albarán y línea se
  guardan `parser_usado`, `origen`, `pagina`, `bbox`, `raw_text` y
  `confianza`; el `metadata_json` del albarán conserva la extracción cruda y
  las secciones vecinas. Con eso se reconstruye de dónde salió cada celda.

---

## M. Tests

### M.1 Unitarias (puras, `domain/**/*.test.ts`)

- `correo/plantilla`, `correo/actuaciones`, `correo/importes`,
  `correo/confianza`: los patrones de §2 (bloques, varios albaranes por
  línea, prosa, `199.95e T2`, ambiguos).
- `dedupe`: cada peso; casos 3, 5, 6, 7, 8, 24; pesos alterados; empate.
- `prioridad`, `estados`, `albaran` (tabla completa de H.2, incluidos
  parecidos y ceros), `descuentos`, `tabla` (cabecera y modo posicional),
  `secciones` (marcas, totales, cabecera/pie repetidos, multipágina),
  `lineas` (aritmética, continuación, referencia dudosa, conceptos globales),
  `complementarios`, `validaciones`, `comparar`.
- Panel: `services/bandeja.test.ts`.

### M.2 Fixtures

`server/therefore/fixtures/`: `.eml` anonimizados (cuando los haya; hasta
entonces, sintéticos con la plantilla de §1) y **PDF generados en las
pruebas con `pdf-lib`** (como hace Tacógrafos): un albarán, cinco albaranes,
albarán partido entre dos páginas con cabecera y pie repetidos, segundo
albarán inmediatamente después del primero, concepto global tras las líneas,
descuentos encadenados, albaranes `0501234`/`0501235`, referencia ilegible,
y el caso de referencia de §35 con sus cuatro líneas y datos complementarios.
Generarlos en la prueba garantiza que ningún valor real queda en el repo.

### M.3 Integración (`therefore.integration.test.ts`, HTTP + PostgreSQL, `RUN_DB_TESTS=1`, `THEREFORE_STORAGE_LOCAL=1`, sin `OPENAI_API_KEY`)

| Caso | Comprobación |
|---|---|
| 1 | 1 expediente, 1 actuación `GRABAR 9011223344`, importe `‑4563`, cola con 1 fila |
| 2 | mismo `.eml` dos veces → 1 notificación, 1 expediente, 1 actuación, 1 fila de cola |
| 3 | segundo correo → mismo expediente, 2 notificaciones, `RECORDATORIO`/`RECLAMACION`, 1 actuación |
| 4 | «URGENTE» → `urgente`, `prioridad_score` sube, `PRIORIDAD_MODIFICADA` |
| 5 | GRABAR → MODIFICAR mismo albarán → `CAMBIO_INSTRUCCION`, `BLOQUEADO`, actuación intacta; aceptar → `DESCARTADA` + nueva |
| 6 | 1 expediente, 3 actuaciones con su acción |
| 7 | 4ª actuación `GRABAR 999`, sin duplicar (índice único) |
| 8 | aprobación + 3 vencidas → 1 `APROBACION_FACTURA`, 4 notificaciones |
| 9 | `‑45,63 €` → `‑4563` en expediente, actuación y documento |
| 10 | PDF de un albarán → `COMPLETADO`, `OK`, todas las líneas, suma calculada |
| 11 | PDF de cinco, se pide uno → solo sus líneas; `SEPARACION_ALBARANES` OK |
| 12 | `0501234` vs `ENT-770199-0501234` → MATCH ≥ 0.9 |
| 13 | `0501234` y `0501235` en el PDF → se coge el correcto; el otro anotado como parecido |
| 14 | albarán partido en dos páginas → todas las líneas, `pagina_inicio ≠ pagina_fin` |
| 15 | `60% + 10%` → dos filas ordenadas con `raw_value` |
| 16 | importe distinto → validación `IMPORTE` REVISAR con el mensaje literal, `diferencia = +6335` en el fixture de §35 |
| 17 | referencia ilegible → `referencia = null`, REVISAR, sin inventar |
| 18 | cantidad ilegible → REVISAR |
| 19 | albarán ausente → `ERROR` con «albarán no encontrado»; el expediente y la actuación siguen gestionables |
| 20 | dos albaranes solicitados → dos filas de análisis independientes |
| 21 | segundo albarán pegado al primero → sin mezclar líneas |
| 22 | «Portes» tras las líneas → en `conceptos_adicionales`, no como artículo, no sumado |
| 23 | `MODIFICAR` → mismo análisis completo; solo cambia `tipo_accion` |
| 24 | reclamación tras `RESUELTO` → decisión, estado igual; reabrir → `PENDIENTE` + evento |
| + | aislamiento por `empresa_id` (404), permisos (403), `UPDATE thf_eventos` lanza, parser roto → `ERROR_PARSER` reprocesable, fila `PROCESANDO` huérfana vuelve a `PENDIENTE` |

El análisis se ejecuta en las pruebas llamando a `procesarPendientes()`,
sin temporizador. La CI ya exige que las de integración se ejecuten; añadir
este fichero las cubre sin tocar el workflow.

### M.4 Regresión

`npm test` entero, `npx tsc -b`, `npx tsc -p tsconfig.server.json`, `npx vite
build` antes de cada push; `bash scripts/check-versions.sh` antes de cada
commit. Ningún test existente se toca: el módulo no modifica tablas ni
rutas existentes.

---

## N. Riesgos

**Decisiones que no se pueden tomar leyendo el repositorio:**

1. **Buzón.** (a) IMAP a la cuenta de Gmail con contraseña de aplicación y
   una etiqueta puesta por filtro (da `gmail_message_id`/`gmail_thread_id`;
   recomendado); (b) reenvío automático por filtro a un buzón de cdmon como
   el CheckPoint (conserva el `Message-ID` original, sin ids de Gmail); (c)
   API de Gmail con OAuth (nada en el repo). El diseño funciona con (a) y (b).
2. **Histórico**: los `.eml` de seis meses (exportación) o la etiqueta
   entera sin leer para que el listener la vacíe.
3. **Muestras reales**: 15–20 correos con sus PDF y XML, anonimizados. Sin
   ellos, las fases 2 y 3 se calibran contra fixtures sintéticos y **habrá
   una pasada de ajuste del parser genérico** con documentos reales. Es el
   riesgo principal del módulo.
4. **Correos que no encajan**: ¿`IGNORADA` visible o descarte? El diseño los guarda.
5. **XML**: formato y dependencia (`fast-xml-parser` propuesta).
6. **HTML vs texto** en el cuerpo.
7. **ERP**: ¿BC expone albaranes de compra? ¿Es BC el ERP de estas sociedades («Genes» aparece en Cash)?
8. **Sociedades**: cuántos códigos y si todos son del tenant SEA.
9. **Roles** (`consulta`/`gestor`/`admin`) y autocierre a 30 días.
10. **IA sobre correo y documentos con datos de proveedores**: va por data-URI como en Cash; confirmar que está bien.

**Riesgos técnicos y cómo se evitan:**

- **Parser genérico frente a formatos reales**: cabeceras, columnas y
  conceptos por configuración; parsers específicos registrables; IA como
  respaldo marcado; y sobre todo, **lo dudoso sale REVISAR**, nunca OK.
- **Mezclar líneas de albaranes vecinos**: la sección termina en la
  siguiente marca; validación `SEPARACION_ALBARANES`; caso 21 en CI.
- **Falsos positivos de fusión**: la factura pesa más que nada, los motivos
  se enseñan, y desde una notificación se puede «crear relacionado».
- **Regresión en lo existente**: el módulo no modifica ninguna tabla, ruta
  ni pantalla existentes; los ocho puntos de alta son adiciones. `mupdf` se
  usa con la misma API que `pdfRasterizer.ts`. `IErpConnector` solo gana
  métodos opcionales.
- **Coste y latencia de IA**: solo como respaldo, por sección, lote de 3.
- **`server/index.ts` de 19 000 líneas**: tres líneas nuevas.
- **Doble DDL** (`schema.ts` + `.sql`): se mantienen iguales, como Tacógrafos.
- **Render con varias instancias**: `SKIP LOCKED` y `PROCESANDO` huérfano.
- **Carga masiva del histórico**: por lotes desde el panel o por el listener.

---

## O. Fases de implementación

Cada fase es un PR mergeable con CI verde, y el módulo es usable al final.

**Fase 1 — Cimientos. HECHA.**
`server/therefore/{index,schema,errors,permissions,repository,service,router,config}.ts`,
`domain/{estados,prioridad,albaran}.ts` con sus pruebas, `erp/{puerto,sinErp}.ts`,
alta en los diez sitios, migraciones (`therefore_fase1.sql`,
`saas_modulo_therefore.sql`). Panel: `ThereforeApp`, contexto, layout, bandeja
con pestañas y filtros, detalle con actuaciones e histórico, configuración de
la prioridad, tarjeta en el hub. 115 pruebas: 54 de dominio puro, 44 de
integración por HTTP contra PostgreSQL (aislamiento entre empresas, permisos
por rol, transiciones, numeración, importe negativo, índice único de
actuaciones e inmutabilidad del histórico) y 17 de los ayudantes del panel.

Tres cosas salieron distintas de lo previsto, y conviene saber por qué:

- **El esquema de esta fase son CINCO tablas, no las diez de §D.** Se crean
  `thf_expedientes`, `thf_actuaciones`, `thf_eventos`, `thf_contadores` y
  `thf_config`. Las del correo y las del análisis llegan con el código que las
  escribe: una tabla vacía que nadie toca es una promesa sin cumplir en medio
  del esquema, y además nadie sabría si su DDL es correcto hasta usarla.
- **No hay variables de entorno nuevas.** Estaban previstas en esta fase, pero
  las de IMAP y almacenamiento no hacen falta hasta que haya buzón y ficheros,
  y la configuración de la prioridad vive en la base. Se añadirán a
  `.env.example` en su fase, con su código al lado.
- **El alta del módulo son diez sitios y no ocho** (ver §A.3): la lista de
  módulos también se reconstruye desde `server/db.ts` y
  `server/central/schema.ts` en cada arranque.

**Fase 2 — Correo, ingesta, dedupe. HECHA.**
`domain/dedupe.ts` (puntuación, decisión, plan de fusión y clasificación de la
notificación), `ingesta.ts`, `decisiones.ts`, las tablas `thf_notificaciones`,
`thf_adjuntos` y `thf_decisiones`, la función SQL `thf_normalizar_id`, las rutas
`POST /correos`, `GET /expedientes/:id/notificaciones`, `GET /decisiones` y
`POST /decisiones/:id`, dos permisos nuevos, los pesos del deduplicador en la
configuración, y en el panel la pantalla de Revisión y la pestaña de Correos del
expediente. Migración `therefore_fase2.sql`. 93 pruebas nuevas: 42 de dominio
puro y 51 de integración por HTTP contra PostgreSQL (los casos 1–9 y 24).

Cuatro cosas salieron distintas de lo previsto:

- **La ingesta recibe CAMPOS, no un `.eml`.** El parser del texto libre se ha
  separado y se queda para cuando haya correos reales con los que calibrarlo
  (N.3). No es un recorte: permite que la idempotencia, la deduplicación, los
  cambios de instrucción y los contadores de reclamaciones estén probados y en
  uso antes de que exista una línea de parser, y que el día que el parser falle
  se sepa que el fallo es suyo. `buzon.ts` y `storage.ts` van con él, en la
  fase 4.
- **La normalización de identificadores está escrita DOS veces**, en
  TypeScript y en SQL (`thf_normalizar_id`), porque la consulta de candidatos
  tiene que cruzar `0000555111` con `555111` sin traerse a Node los
  expedientes de la ventana entera. Hay una prueba de integración que pasa la
  misma lista de valores por las dos y exige el mismo resultado: o coinciden,
  o la CI se pone roja.
- **Una decisión por cambio de instrucción y ACTUACIÓN, no por correo.** Un
  mismo correo puede cambiar la instrucción de tres albaranes, y aceptar una y
  mantener otra es una respuesta razonable. De ahí la columna `actuacion_id` de
  `thf_decisiones` y el `COALESCE` de su índice único (en PostgreSQL dos NULL
  son distintos, así que sin él las decisiones sin actuación no se
  deduplicarían entre sí).
- **`thf_notificaciones.parseado` guarda la entrada entera**, no sólo lo que
  dijera el parser. Un correo que espera una decisión hay que poder volver a
  aplicarlo cuando alguien decida, días después; reconstruir sus campos del
  texto en ese momento sería inventárselos. Si falta, la decisión lo dice y
  pide reprocesar el correo, en vez de adivinar.

**Fase 3a — Parser del correo. HECHA.**
`domain/correo/{texto,importes,plantilla,acciones,index}.ts`, la ruta
`POST /correos/texto`, dos columnas nuevas en `thf_actuaciones`
(`accion_texto` y `orden`) y la migración `therefore_fase3.sql`. 54 pruebas de
dominio con valores inventados, 9 invariantes contra el corpus real —que no se
versiona y por eso se saltan en la CI— y 10 de integración por HTTP.

Calibrado contra **veinte correos reales**. Lo que enseñaron:

- **Las dos convenciones de número conviven en el mismo correo.** La plantilla
  escribe el total a la española (`3.217,66`) y la persona el importe del
  albarán a la inglesa (`1010.07€`). La regla que lo resuelve sin adivinar: con
  los dos separadores, el último es el decimal. Queda un caso ambiguo de verdad
  —tres dígitos detrás de un separador solo— y ahí se baja la confianza en vez
  de elegir en silencio, que es como se cuela un error de tres ceros.
- **Una cabecera manda sobre la prosa.** «Necesitamos que gestionéis los
  siguientes albaranes:» seguido de `GRABAR` es una petición de GRABAR: lo
  primero es el saludo. Una acción sacada de la prosa que no ha recogido ningún
  número desaparece en cuanto llega una cabecera explícita.
- **El matiz de la instrucción no se puede tirar.** `MODIFICAR` y
  `MODIFICAR FECHA` normalizan a la misma acción, y quien lo grabe en el ERP
  necesita saber que lo que cambia es la fecha. De ahí `accion_texto`.
- **Una tarea vencida no pide trabajo nuevo.** Es el mismo, que sigue sin
  hacerse. Si generara su propia actuación, una aprobación desatendida acabaría
  con cinco «aprobar» idénticos. Y por el mismo motivo `planDeFusion` dejó de
  crear siempre las acciones sin albarán: ahora cuentan como repetidas cuando
  ya hay una viva igual.
- **`created_at` no sirve para ordenar.** Su valor por defecto es `now()`, que
  es la hora de INICIO DE LA TRANSACCIÓN, así que las cuatro actuaciones de un
  correo nacen con el mismo instante y el desempate caía en un UUID aleatorio:
  «graba éste y cambia la fecha de estos tres» salía barajado. De ahí `orden`.

Lo que el parser NO hace, y es la mitad del trabajo: no inventa. Un número sin
acción no se convierte en actuación —se anota como ambiguo—, y una acción sin
número sale incompleta y pide revisión. Hay una prueba contra el corpus real
que falla si algún albarán devuelto no está escrito, letra por letra, en el
correo.

**Fase 3b — Análisis de albaranes. HECHA.**
`documentos/{texto,analisis,worker,extractorIA,servicio}.ts`, `storage.ts`,
`domain/documento/{tipos,conceptos,secciones,tabla,descuentos,lineas,complementarios,generico,index}.ts`,
`domain/validaciones.ts`, las cinco tablas de D.5–D.8, cuatro rutas
(`POST /expedientes/:id/documentos`, `GET /expedientes/:id/analisis`,
`POST /actuaciones/:id/reanalizar`, `GET /albaranes/:id/documento`), los
umbrales `albaran.*` en la configuración, y en el panel las pestañas Albaranes
y Validaciones con las celdas dudosas marcadas. Migración
`therefore_fase3b.sql`, comprobada columna a columna contra el arranque.
112 pruebas nuevas: 39 del dominio con las páginas escritas a mano, 15 de las
validaciones, 12 sobre PDF generados en la propia prueba, 12 de los ayudantes
del panel, 19 de integración por HTTP con los casos 10–23, y las de la cola.

Cuatro cosas salieron distintas de lo previsto:

- **El PDF se lee CARÁCTER A CARÁCTER, no por las «líneas» que agrupa mupdf.**
  mupdf junta el texto por proximidad: en una fila de albarán pega la
  referencia con la descripción —van seguidas— y deja el importe aparte —va
  lejos—, de modo que la referencia acaba dentro de la descripción sin que
  nada falle. `walk()` da la posición exacta de cada carácter; con eso se
  construyen las palabras de verdad, cada una con su `x`, y la rejilla deja de
  ser una estimación. Y un detalle que costó un rato: mupdf entrega los
  caracteres en ORDEN DE DIBUJO, no de lectura. Hay que repartirlos por altura
  y ordenar cada fila por `x` ANTES de formar palabras, o el final de una fila
  se pega al principio de otra.
- **`domain/albaran.ts` ya hacía H.2 desde la fase 1.** No se ha reescrito:
  `elegirAlbaran` es exactamente lo que hacía falta, incluido bajar a
  UNCERTAIN cuando el mismo albarán aparece dos veces.
- **La IA lee las celdas, nunca localiza el albarán.** Y su lectura pasa por el
  MISMO `extraerLineas` que el camino determinista, con techo 0,85: lo único
  que aporta el modelo es el contenido de las celdas; la aritmética, los
  descuentos y la confianza los calcula el código ya probado.
- **El pie de la factura no cuenta como líneas huérfanas.** La primera versión
  contaba lo que quedaba tras el último albarán como «sin asignar», y todo
  documento bien formado salía en revisión por mala separación. Sólo cuentan
  cuando hay otra marca de albarán detrás. Lo destapó la prueba de integración
  del caso 10, no una unitaria.

Lo que NO se ha hecho, y por qué: **ningún parser específico de proveedor**
(§48–49: no hay ningún documento real que lo justifique; el corpus de correos
no trae los PDF), **ni el visor con resalte del `bbox`** —se guarda el `bbox`
de cada línea y el PDF se abre por enlace firmado, pero pintar el rectángulo
encima exige un visor de PDF embebido que el panel no tiene y merece su
propia decisión—, ni XML (N.5 sigue sin respuesta).

**Fase 4a — El buzón. HECHA.** `buzon.ts` sobre el molde de
`checkpointMail.ts`, la tabla `thf_buzon_pasadas`, las claves de texto
`buzon.remitentes` y `buzon.activado_el`, tres rutas (`GET /buzon`,
`PUT /buzon/remitentes`, `POST /buzon/revisar`) y la sección del buzón en
Configuración con el botón «Revisar buzón ahora». `aCorreoEntrante` salió del
router a `ingesta.ts`: dos puertas —importar a mano y el buzón— y un solo
camino. Migración `therefore_fase4.sql`. 13 pruebas: 7 puras y 6 de
integración con un buzón falso que compone MIME real con nodemailer, contra
PostgreSQL.

Decisiones tomadas al implementarlo:

- **Sólo lo no leído y posterior a la activación** (N.1/N.2, elegido por el
  cliente: «sólo los nuevos»). `buzon.activado_el` se escribe UNA vez y un
  reinicio no lo mueve. La comparación fina lleva **cinco minutos de margen**
  porque la cabecera `Date` la pone el reloj del remitente, no el nuestro.
- **La empresa del SaaS va por variable de entorno** (`THEREFORE_IMAP_EMPRESA_ID`):
  el correo dice la sociedad (007…) pero no el tenant, y adivinarlo abriría
  expedientes en la empresa equivocada sin que nada fallara.
- **Un correo que falla se queda sin leer** y se reintenta; lo que no es de
  Therefore se ignora, se marca leído y consta en la pasada (N.4: se guarda
  la constancia, no el correo).
- **Las credenciales no están en la base**: `THEREFORE_IMAP_*` en el
  servidor, como el CheckPoint. La pantalla dice si está leyendo, no cómo.

**Fase 4b — Trabajo diario. HECHA.** `diario.ts` (recálculo de prioridad y
autocierre, cada hora, sólo sobre lo que no se recalculó hoy), `exportar.ts`
(la bandeja a Excel con `xlsx`), la carga del histórico a propósito
(`POST /buzon/historico`, con fecha) y el `.eml` importado a mano
(`POST /correos/eml`), los dos por el mismo `procesarFuente` que el
temporizador. La columna `thf_expedientes.recalculado_el` y el CHECK de
`thf_buzon_pasadas.origen` ampliado a `historico` y `eml`. Migración
`therefore_fase4b.sql`. Panel: «Exportar Excel» e «Importar .eml» en la
bandeja, días de autocierre y carga del histórico en Configuración. 13
pruebas: 5 puras de la exportación, 6 de integración del trabajo diario y 2
más del buzón.

Tres decisiones tomadas al implementarlo:

- **Cada hora, no cada día.** Render reinicia el servidor cuando quiere, y un
  temporizador diario que arranca a las 15:00 hace su primera pasada mañana a
  las 15:00. La pasada sólo mira lo que no se recalculó HOY (`recalculado_el`,
  un DATE), así que repetirla cada hora no cuesta nada y garantiza que algún
  día se haga.
- **El autocierre respeta al que espera.** Un RESUELTO con una decisión
  pendiente no se cierra: es el caso 24, y cerrarlo por antigüedad sería
  enterrar la pregunta con el expediente. Y se relee bloqueado antes de
  cerrar, por si alguien lo reabrió entre la lista y el cierre.
- **El histórico es una acción aparte**, con fecha, que hay que pedir y
  repetir hasta que salga a cero. Lo anterior a la activación no entra nunca
  por accidente. El `.eml` importado no lleva suelo de fecha ni filtro de
  remitente: quien lo importa ya ha decidido que es de Therefore.

**Lo que sigue pendiente y no depende de código:** el ajuste del parser
genérico con los primeros correos y PDF reales que entren por el buzón (N.3).
Es el riesgo principal del módulo y no se puede hacer hasta que entren.

**Fase 5 — ERP. HECHA.** Método opcional `getPurchaseReceipt` en
`IErpConnector` (contrato del Hub, `connectors.ts`), implementado en el
conector de Business Central (`purchaseReceipts` filtrado por el número de
albarán del proveedor, con `$expand` de las líneas). Adaptador
`therefore/erp/hub.ts` que resuelve el conector del tenant por el registro
del Hub y traduce el recibo a `EstadoAlbaran` (céntimos, líneas), caso de uso
`erp/consultar.ts` (`POST /actuaciones/:id/consultar-erp`), comparación pura
en `domain/comparar.ts` (líneas del PDF contra líneas del ERP por
referencia: IGUAL, DIFIERE con los campos, FALTA_EN_ERP, SOBRA_EN_ERP,
SIN_REFERENCIA, y la diferencia total en céntimos) y el resultado en
`thf_actuaciones.erp_estado` / `erp_consultado_at` con evento
`ERP_CONSULTADO`. Panel: botón «Consultar en el ERP» en la actuación y un
bloque con las dos versiones, línea a línea. 31 pruebas: 9 puras de la
comparación, 6 del adaptador, 12 del conector y 4 de integración del caso
de uso.

Tres decisiones tomadas al implementarlo (N.7 sigue sin respuesta formal y
se ha dejado configurable en vez de adivinar):

- **El campo por el que BC guarda el número del proveedor es configuración**
  (`purchaseReceiptVendorField`, por defecto `vendorShipmentNumber`), y la
  sociedad de Therefore (007…) se mapea a la `company` de BC con la clave
  `erp.company.<codigo>` de `thf_config`. Ni el módulo ni el conector
  presuponen cómo está dado de alta el ERP del cliente.
- **«No lo sé» y «no existe» son cosas distintas.** Sin conector, en modo
  simulación o con error de red la consulta devuelve `null` y la actuación
  no cambia de estado; sólo un ERP que responde puede decir `existe: false`.
  Confundir ambas sería marcar como inexistente lo que no se pudo mirar.
- **La comparación enseña las dos versiones, no decide.** Tolerancia de dos
  céntimos, sin emparejamiento aproximado de referencias: la misma
  referencia repetida se compara en orden. Lo que difiere lo resuelve la
  persona; el módulo sólo se lo pone delante.

Sigue sin código: dar de alta el conector de BC del cliente en el Hub y la
clave `erp.company.<codigo>` por sociedad, cuando el cliente entregue los
datos del ERP (N.7).

**Ajuste con documentos reales (N.3), primera tanda. HECHO.** Con las cinco
primeras facturas y abonos reales —dos proveedores, plantillas distintas— el
parser genérico fallaba en todo lo que no se puede inventar sin papel delante:

- **Marcas.** «ALB:0501234» sin espacio no era marca; ahora `alb:` está en
  las cabeceras por defecto y todas se buscan por palabra entera (por la
  izquierda). El identificador admite puntos («01.123456»). Una etiqueta
  corta justo encima de la marca («REF: …») es la primera línea del albarán.
- **El pie en dos filas.** Hay plantillas con los títulos («IMPORTE BRUTO …
  BASE IMPONIBLE … TOTAL») en una fila y los importes en la de abajo. La
  fila de títulos, sin ningún importe, cierra la sección; y la cabecera del
  documento (número, fecha, totales) lee el valor que hay DEBAJO de la
  etiqueta cuando no lo hay detrás. «factura» dentro de un correo
  electrónico ya no es una etiqueta: se buscan palabras enteras.
- **«Suma y sigue» / «Suma anterior»** no son el pie ni una línea: se
  ignoran, y el albarán sigue en la página siguiente. El pie legal que
  «flota» (a distinta altura en cada página) se retira igualmente si es un
  párrafo largo idéntico sin importes; «Página 1 de 2» se reconoce por la
  palabra.
- **Lo que no es línea.** Una fila con cantidad y sin importe («SE ANULA
  PULMÓN 1,00», «CASO 4711») es una nota del albarán y va a observaciones.
  Un título de bloque sin importe («TASAS Y OTROS CONCEPTOS») abre un bloque
  de conceptos. Las tasas ambientales (NFU, ecovalor, ecotasa…) se
  reconocen contenidas, no sólo al principio. Una descripción sólo continúa
  en la fila de abajo si la de arriba llenaba su columna; si no, lo de abajo
  es una nota (el nombre de la flota, el taller).
- **Columnas que no existen.** Sin columna de referencia, la referencia no
  está «sin leer»: no existe, y el panel la pinta como ausente. Sin columna
  de descripción, el texto bajo «Referencia» es la descripción.
- **Vehículo.** Matrícula de remolque (R/S + 4 dígitos + 3 letras); en una
  fila de artículo sólo se lee etiquetada, porque «CF1100 A/T» de un
  neumático tiene forma de matrícula antigua.
- **Correo contra papel.** «N-123456» y «N0000123456» son la misma factura:
  se comparan sin ceros de relleno y vale que uno termine en el otro.

Lo que se ha visto y NO se ha tocado, porque el correo manda: el nombre y el
NIF del emisor que saca la cabecera son heurísticos y en estas plantillas
cogen el bloque del cliente; la comparación es contra lo que dijo Therefore.
Y la tasa ambiental de una factura con varios albaranes cae en el último,
que es donde está impresa: se enseña aparte y no se suma.

Los documentos reales viven en `server/therefore/fixtures/originales/`,
ignorada por Git; las pruebas reproducen cada caso con datos inventados.

**Remitentes por dominio.** `buzon.remitentes` admite dominios además de
direcciones: «@proveedor.com» (con arroba o sin ella al escribirlo) acepta
cualquier buzón de ese dominio y de sus subdominios. Lo que no es ni
dirección ni dominio se sigue descartando al guardar.

**Ajuste con documentos reales (N.3), segunda tanda: la plantilla de ERP.**
Un tercer proveedor factura con una plantilla que no se parece a las dos
anteriores, y que rompía el parser de cinco maneras a la vez:

- **El artículo va desglosado en varias filas.** Precio bruto en la fila del
  artículo y debajo una por cada descuento, una con el neto y otra con la
  ecotasa. Leídas como líneas sueltas, el albarán sumaba el bruto Y los
  descuentos. Ahora esas filas MODIFICAN la línea de arriba: los descuentos
  se le añaden y el neto pasa a ser su importe, que es lo que se paga y lo
  que suma.
- **«Total» a secas remata cada artículo.** Antes cerraba la sección, así
  que el albarán se acababa en su primera línea y el resto de la factura
  quedaba huérfano. Se separan los totales del DOCUMENTO —que cierran— de
  los de una línea —que no—, y los totales de cabecera se leen desde el pie
  del documento hacia abajo, no desde el principio.
- **El signo va detrás: «192,80-».** Lo leía en positivo, que convierte un
  descuento en un cargo. Y las fechas llevan puntos («15.09.2026»), que
  tienen la forma de un número con decimales: se quitan antes de preguntar
  si una fila lleva importes.
- **Descuentos que se suman en vez de encadenarse.** 40 % y 8,5 % sobre el
  bruto, no el segundo sobre lo que deja el primero. Se acepta la
  convención que explique el importe impreso y, cuando el papel imprime
  cuánto descuenta cada uno, mandan esos importes: no hay nada que deducir.
- **Geometría.** El hueco entre una columna de texto y la de al lado es de
  la de texto —una descripción crece hacia la derecha y un número no llega
  tan a la izquierda—, porque si no el final de las descripciones largas se
  iba a la columna de la cantidad y no había ni una cosa ni la otra. Hay
  columna de «Posición» y la unidad («1 UN») viaja pegada a la cantidad. En
  el recuadro de totales, cada cifra es del título más cercano aunque no se
  solapen ni por un punto.

Con eso, las tres plantillas de las cinco primeras facturas y las de este
proveedor dan MATCH en todos los albaranes probados, con la aritmética de
todas las líneas cuadrando y los totales de cabecera leídos.

**Descarga de documentos para revisión.** En Configuración, «Descargar
documentos para revisión» baja en un zip los PDF cuyo análisis vigente quedó
en REVISAR o ERROR en los últimos N días (`GET /documentos/revision?dias=`),
cada uno con el expediente, el albarán pedido y el estado en el nombre, más
un `indice.csv` con el motivo. Es el corpus para las siguientes tandas de
N.3 sin ir expediente a expediente. Sólo `therefore.config.edit` y con
auditoría: lleva precios de compra. El zip se escribe a mano
(`server/therefore/zip.ts`, método «store», sin dependencias): lo de dentro
ya está comprimido.

**Pestaña «Documentos» (tras el primer correo real).** El PDF que viene con
el correo se ve dentro del expediente: la pestaña lista los adjuntos
(nombre, tamaño, fecha) y enseña el elegido en un visor incrustado, con
«Abrir en otra pestaña» al lado. El enlace sigue siendo firmado y con
caducidad (`GET /adjuntos/:id/documento`), se pide cada vez que se elige un
documento y no se guarda con la lista. Los adjuntos de la pestaña «Correos»
también se abren. Y un arreglo de paso: el «Ver el PDF» de los albaranes
abría la ventana DESPUÉS de pedir el enlace, y el navegador la bloqueaba
sin decir nada; ahora se abre vacía con el clic y se le pone la URL cuando
llega.

Orden: 1 → 2 → 3 → 4 → 5, hecho. Las decisiones N.1–N.3 se necesitan
para la fase 3: sin correos reales no se calibra un parser, y afinarlo contra
ejemplos inventados da un 100 % de acierto que se desmorona con el primer
correo de verdad.
