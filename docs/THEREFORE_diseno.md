# Therefore — gestor de expedientes a partir del correo: diseño

Documento de diseño previo a la implementación. **Nada de esto está
implementado todavía.** Es el resultado de leer el repositorio con la pregunta
«¿dónde encaja esto sin estrenar nada?», y cada apartado dice qué se reutiliza y
por qué. Cuando el diseño esté aprobado, el plan de fases del final es el orden
de trabajo.

Principio que gobierna todo lo demás: **la unidad de trabajo es el expediente,
no el correo.** Un expediente agrupa N actuaciones, N notificaciones,
N documentos y N eventos. Therefore manda muchos correos por el mismo problema;
aquí se convierten en una cola de trabajo deduplicada, priorizada y trazable.

---

## A. Análisis del proyecto actual

### A.1 Stack

| Capa | Qué hay | Dónde |
|---|---|---|
| Backend | Express 5 + TypeScript ejecutado con `tsx`, PostgreSQL vía `pg` | `server/index.ts` (19 000 líneas, monolito) + módulos en `server/<modulo>/` |
| Base de datos | Un solo PostgreSQL (el de Supabase). El servidor entra con `pg` y **salta la RLS**; las apps Flutter y parte del panel entran con `supabase-js` y sí pasan por RLS | `server/db.ts`, `server/supabase.ts` |
| Frontend | React 18 + Vite + Tailwind 4 + react-router 7 + lucide-react. Sin react-query: `fetch` + `useEffect` | `src/App.tsx`, `src/modules/<modulo>/` |
| Autenticación SaaS | Sesión de Supabase Auth → `Authorization: Bearer` → `authenticate` (`server/core/auth.ts`) da `ctx.empresaId`, `ctx.userId`; `requireModule("<slug>")` comprueba la licencia en `app_licencias` | `server/core/auth.ts` |
| Permisos | `app_usuario_modulos (user_id, modulo, rol, pantallas, centro_id)`; cada módulo traduce el rol a permisos finos en su `permissions.ts` | `server/tacografos/permissions.ts`, `server/cash/permissions.ts` |
| Auditoría | `app_auditoria` (inmutable por trigger + huella SHA-256) vía `registrarAuditoria` / `registrarAuditoriaEnTransaccion`; y diarios por dominio (`assistance_events`) con el mismo candado | `server/core/auditoria.ts`, `server/eventlog/schema.ts` |
| Configuración | Variables de entorno para credenciales. Para lo ajustable, dos tablas clave/valor: `workshop_config (key, value)` global —con `server/satisfaction/config.ts` como implementación de referencia: `CLAVES` con punto, `POR_DEFECTO`, lector que nunca lanza— y `cash_settings (empresa_id, clave, valor)` por empresa | `server/satisfaction/config.ts`, `server/cash/schema.ts` |
| IA | **Capa única** `pedirIA()` con Responses API y esquema JSON estricto; el modelo sale de variables de entorno, nunca del código | `server/core/openaiService.ts` |
| Correo entrante | `imapflow` + `mailparser`, **en un solo fichero**. Un poller por buzón, una pasada cada N minutos, solo no leídos, `message_id UNIQUE` como segunda red. El buzón del CheckPoint está en **cdmon** (`imap.mobilink.es`, usuario y contraseña normales); Bridgestone reenvía allí su informe. No hay cliente de la API de Gmail (`google-auth-library` solo se usa para push FCM) | `server/checkpointMail.ts` → `tc_checkpoint_ejecuciones` |
| Correo: cabeceras e hilos | Helpers probados para `Message-ID`, `In-Reply-To`/`References`, asunto sin `Re:/Fwd:` y bandeja de «sin clasificar» | `server/correo/referencia.ts`, `server/correo/servicio.ts` |
| Correo saliente | `nodemailer` vía `getMailTransport()`, que devuelve `null` si no hay SMTP | `server/mail.ts` |
| Ficheros | Bucket **privado** de Supabase Storage creado al vuelo por el módulo, enlaces firmados de 15 min; en pruebas, disco bajo `server/uploads/` | `server/tacografos/storage.ts`, `server/cash/storage.ts` |
| PDF | `mupdf` (rasterizar para visión), `pdf-lib`/`pdfkit` (generar). **`pdf-parse` y `tesseract.js` están en `package.json` pero no se usan en ningún sitio.** El escaneo de facturas de Cash manda el PDF entero a la IA por data-URI | `server/cash/invoice-scan/`, `server/tyrecontrol/ficha-tecnica/pdfRasterizer.ts` |
| XML | **No hay ningún parser XML en el código.** `xml2js`, `@xmldom`, `sax` están en `node_modules` solo como dependencias transitivas | — |
| Cola de documentos | Bandeja AutoScan: estados en mayúsculas, `DESCARTADO` en vez de `DELETE`, dos índices únicos distintos (contenido por `sha256` vs idempotencia por petición), worker con `FOR UPDATE SKIP LOCKED` | `server/cash/autoscan/` |
| ERP | Business Central por el **Integration Hub** (`IErpConnector`, `BusinessCentralConnector` en modo simulación) y un contrato propio de Cash (`server/cash/erp/connector.ts`). Invariante: ningún módulo llama al ERP directamente | `server/integration-hub/`, `docs/PROMPT_CONEXION_BUSINESS_CENTRAL.md` |
| Jobs | No hay cola genérica. Cada módulo registra su `setInterval` en el arranque (`startCheckpointMail`, `startRecobrosNotifierChecker`…). Los que escriben usan outbox transaccional (`cash_event_outbox`) | `server/index.ts` ~19345 |
| Migraciones | **Dos mecanismos que conviven**: (1) DDL idempotente en `initX()` ejecutado en cada arranque por `prepararEsquema` — es lo que usan los módulos del servidor; (2) `supabase/migrations/*.sql` para pegar en el SQL Editor — es lo que usan los módulos que leen con `supabase-js` y RLS, y donde viven las FK hacia `app_*` y los CHECK de la lista de módulos | `ARCHITECTURE.md` §14 |
| Pruebas | vitest. Dominio puro sin base; integración **por HTTP contra PostgreSQL real** con `RUN_DB_TESTS=1`; el esquema se crea una vez en `vitest.setup.ts` replicando la cadena de arranque. La CI (`.github/workflows/tests.yml`) levanta Postgres 16 y **falla si las de integración no se ejecutan** | `vitest.config.ts`, `vitest.setup.ts` |
| Typecheck | `tsconfig.server.json` tiene un `include` explícito: **un módulo nuevo que no se añada no se comprueba** | `ARCHITECTURE.md` §14 |

### A.2 Convenciones que se van a respetar

- Dominio en castellano (`expedientes`, `actuaciones`, `notificaciones`),
  tablas con prefijo de módulo y `snake_case` (`tac_*`, `cash_*`, `adm_*`),
  valores de estado en mayúsculas.
- Módulo del servidor = carpeta con `index.ts` (mount), `schema.ts` (init),
  `router.ts` (solo forma), `permissions.ts`, `repository.ts`, `service.ts`,
  `domain/` (puro, sin base) y `*.test.ts` / `*.integration.test.ts` al lado.
  Es exactamente la forma de `server/tacografos/`, el módulo más reciente.
- `empresa_id UUID NOT NULL` **sin FK** hacia `app_empresas` en el DDL de
  arranque (la FK va en la migración de Supabase): las pruebas levantan una base
  sin la fundación SaaS. Es lo que hace Cash y lo explica en su esquema.
- El tenant sale de `ctx.empresaId`, nunca del cuerpo. 404, no 403.
- Un módulo nuevo se da de alta en **ocho sitios**: `tsconfig.server.json`,
  `vitest.setup.ts`, cadena `prepararEsquema` + `mount` + `start` de
  `server/index.ts`, migración que amplía el CHECK de
  `app_licencias.modulo` (molde: `supabase/migrations/saas_modulo_assist.sql`),
  `MODULOS_APP` (`src/modules/administracion/config/modulosApp.ts`),
  `ACCESOS_MODULOS` (`src/config/accesosModulos.tsx`), `ICONOS`/`COLORES`/`BASES`
  de `src/pages/InicioPage.tsx`, y `lazy()` + `<Route path="/therefore/*">` en
  `src/App.tsx`.
- Frontend de módulo = `XxxApp.tsx` con `Provider` + `Layout` + rutas hijas,
  `services/api.ts` como único sitio con `fetch` (`pedir<T>()` con
  `sessionHeaders()` **esperado con `await`**, `ApiError` con código),
  `contexts/` con `bootstrap → {rol, permisos, puede()}`, `types/` con
  `*_LABELS`/`*_COLORS`/`fmt*`, `pages/`, `components/`. Sin react-query:
  `useState` + `useCallback` + `useEffect`, filtro con `setTimeout` de 250 ms.
- Kit de UI **compartido de hecho**: `src/modules/administracion/components/ui.tsx`
  (`Pill`, `Modal`, `TableWrap`, `thCls`/`tdCls`, `EmptyRow`, `ErrorBox`,
  `Field`/`TextField`/`SelectField`, `btnPrimary`…), que Cash reexporta desde
  su propio `components/ui.tsx`. Tema oscuro slate + acento sky, Tailwind
  directo, sin `dark:`; chips `bg-<color>-500/20 text-<color>-300` (ámbar =
  pendiente, sky = en curso, esmeralda = resuelto, rosa = urgente/error,
  slate = cerrado). No hay toasts: `ErrorBox`/`Aviso` en línea y
  `window.confirm`.
- Sin pruebas de componentes React en todo el repo: la lógica de filtrado y
  derivación del panel va en `services/*.ts` puros con su `.test.ts`.

### A.3 Lo que ya existe y se reutiliza tal cual

| Necesidad del módulo | Pieza existente |
|---|---|
| Escuchar un buzón y no procesar dos veces | `checkpointMail.ts` (molde), `message_id UNIQUE` con `ON CONFLICT DO NOTHING` (como `assistance_messages`) |
| Normalizar `Message-ID`, `References`, asunto | `server/correo/referencia.ts` tal cual |
| Extraer datos de un PDF/XML con confianza por campo | `invoice-scan/` (extractor como PUERTO, extracción cruda en texto, `normalize.ts` con tests, umbrales `RELLENAR/REVISAR/VACIO`) |
| IA con esquema estricto | `pedirIA({ proposito: "documento", esquema })` |
| Historial inmutable | trigger de huella + candado `BEFORE UPDATE OR DELETE` de `assistance_events` |
| Auditoría con usuario | `registrarAuditoria` / `registrarAuditoriaEnTransaccion` |
| Permisos por rol | `app_usuario_modulos` + `cargarPermisos`/`exigirPermiso` |
| Configuración ajustable por empresa | tabla clave/valor tipo `cash_settings` |
| Numeración propia (`INC-000452`) | contador tipo `cash_document_counters` |
| Ficheros privados | `storage.ts` de Tacógrafos (bucket privado + disco en pruebas) |
| Contrato ERP | `IErpConnector` del Integration Hub (a ampliar) |
| Bandeja de trabajo | `src/modules/connectpro/pages/Asistencias.tsx` (lista), `ColasOperativas.tsx` (pestañas con contador), `tyrecontrol/pages/Incidencias.tsx` (pestaña por estado) |
| Detalle con pestañas y timeline | `src/modules/connectpro/pages/FichaAsistencia.tsx` (cabecera + `TABS`), `src/components/TimelineAsistencia.tsx` (raíl con puntos de color) |
| Formato de fechas e importes | `fmtFecha`/`fmtFechaHora`/`fmtEur` de `administracion/types`, céntimos con `cash/utils/money.ts` |

### A.4 Lo que NO existe y hay que decidir (detalle en I)

- Acceso al buzón donde llegan los correos de Therefore. Lo que ya se usa es
  IMAP con contraseña contra cdmon; contra Gmail haría falta una contraseña
  de aplicación (2FA). No hay cliente de la API de Gmail.
- Un parser XML: hay que **añadir una dependencia directa** (`fast-xml-parser`
  o promocionar `xml2js`) y saber el formato que adjunta Therefore.
- Extraer texto de PDF: `pdf-parse` está declarado y sin usar; se estrena
  aquí (o se rasteriza con `mupdf` y va a la IA como visión, que es lo que
  hace la ficha técnica de TyreControl).
- Si el cuerpo llega como `text/plain` o solo como HTML.
- Un lote de correos reales anonimizados para fijar el parser con pruebas.
- `docs/PROMPT_avisos_presion_por_correo.md` ya fijó el criterio para un
  segundo consumidor del mismo buzón: **regex determinista para la plantilla,
  IA solo como respaldo marcado como tal, y no escribir un segundo sistema
  de correo**. Este diseño lo sigue.

---

## B. Arquitectura propuesta adaptada a Mobilink

### B.1 Un módulo del servidor, un módulo del panel

```
server/therefore/                      src/modules/therefore/
├── index.ts        mountTherefore     ├── ThereforeApp.tsx
├── schema.ts       initTherefore      ├── contexts/ThereforeContext.tsx
├── router.ts       /api/therefore/*   ├── layouts/ThereforeLayout.tsx
├── permissions.ts  rol → permisos     ├── services/api.ts
├── repository.ts   SQL                ├── types/index.ts
├── service.ts      casos de uso       ├── pages/Bandeja.tsx
├── buzon.ts        listener IMAP      ├── pages/Expediente.tsx
├── ingesta.ts      pipeline por correo├── pages/Revision.tsx
├── storage.ts      .eml y adjuntos    ├── pages/Configuracion.tsx
├── domain/         PURO, sin base     └── components/
│   ├── parser/            (texto → estructura)      ├── TablaExpedientes.tsx
│   │   ├── plantilla.ts   campos fijos de Therefore ├── FiltrosBandeja.tsx
│   │   ├── actuaciones.ts albaranes + acción        ├── ChipEstado.tsx / ChipPrioridad.tsx
│   │   ├── importes.ts    «-45,63» → céntimos       ├── Actuaciones.tsx
│   │   └── confianza.ts   umbral → REQUIERE_REVISION├── TimelineNotificaciones.tsx
│   ├── normalizar.ts      → CorreoNormalizado       ├── Documento.tsx
│   ├── dedupe.ts          candidatos → puntuación   ├── Adjuntos.tsx
│   ├── prioridad.ts       score → prioridad         ├── Historico.tsx
│   ├── estados.ts         transiciones              └── DecisionPendiente.tsx
│   └── comparar.ts        correo vs documento
├── adjuntos/
│   ├── extractor.ts   PUERTO (como invoice-scan)
│   ├── extractorIA.ts pedirIA + esquema estricto
│   ├── pdfTexto.ts    pdf-parse (texto primero, IA después)
│   └── xml.ts         xml2js → DocumentoExtraido
├── erp/
│   ├── puerto.ts      ConsultaAlbaranesErp (interfaz)
│   └── sinErp.ts      implementación «no hay datos»
└── *.test.ts, therefore.integration.test.ts
```

### B.2 Pipeline

```
Buzón IMAP (Gmail)
   │  buzon.ts: una pasada cada N min, solo no leídos, lote de 20
   ▼
ingesta.ts  ─── procesarCorreo(fuente: Buffer)  ← el MISMO punto de entrada
   │            para el buzón, para importar .eml a mano y para las pruebas
   ├─ 1. mailparser → cabeceras, texto, adjuntos
   ├─ 2. guardar .eml en storage (nunca se pierde el original)
   ├─ 3. INSERT thf_notificaciones ON CONFLICT (message_id) DO NOTHING
   │        └─ 0 filas → ya procesado → fin (idempotencia)
   ├─ 4. domain/parser  → CorreoParseado (con confianza por campo)
   ├─ 5. adjuntos/      → thf_adjuntos (sha256) + thf_documentos (si se extrae)
   ├─ 6. domain/normalizar → CorreoNormalizado
   ├─ 7. repository.candidatos() → domain/dedupe.puntuar()
   ├─ 8. decisión:
   │        ≥ 70  → fusionar (service.fusionar)
   │        40–69 → thf_decisiones POSIBLE_DUPLICADO (humano)
   │        < 40  → service.crearExpediente
   │        (+ CAMBIO_INSTRUCCION / RECLAMACION_RESUELTO / REQUIERE_REVISION)
   ├─ 9. domain/prioridad → recalcular
   └─ 10. thf_eventos + app_auditoria
   Todo de 3 a 10 en UNA transacción. Si algo falla: rollback, la
   notificación no existe, el correo se queda sin leer y se reintenta.
   Si falla el PARSER (no la base): se guarda la notificación con
   estado_proceso = 'ERROR_PARSER' y el texto íntegro; se marca leído; se
   reprocesa desde el panel cuando el parser esté arreglado.
```

Dos reglas heredadas de `checkpointMail.ts` y de `correo/servicio.ts`:

1. **Lo que no se entiende no se descarta.** Un correo de Therefore que el
   parser no sabe leer queda como notificación sin expediente, en la bandeja
   de revisión, con su texto original.
2. **El buzón no es la cola de reintentos.** Como el `.eml` se guarda entero,
   arreglar el parser y pulsar «Reprocesar» basta; no hace falta pedir a
   nadie que reenvíe nada.

### B.3 Qué NO se estrena

- Ni framework de colas, ni ORM, ni librería de componentes, ni segundo
  sistema de permisos, ni cliente nuevo de correo. El listener es un
  `setInterval` registrado en el arranque, como los otros doce.
- Ni un modelo de IA elegido en código: `pedirIA` decide por variable de
  entorno.
- Ni una tabla de configuración genérica nueva: una `thf_config` clave/valor
  **por empresa** (los pesos de dedupe y prioridad son de cada instalación,
  así que `cash_settings` es el molde y no `workshop_config`, que es global),
  con la forma de `server/satisfaction/config.ts`: `CLAVES`, `POR_DEFECTO`,
  lector que nunca lanza y devuelve los defectos si la base falla.
- Fechas en `TIMESTAMPTZ` y no en `BIGINT` ms como Tacógrafos y Cash: es una
  desviación deliberada. Este módulo hace aritmética de fechas en SQL
  (antigüedad, ventana de candidatos, autocierre) y su espejo en
  `supabase/migrations` usa `timestamptz` como todas las tablas `adm_*`/`tc_*`;
  `app_auditoria`, que también escribe el servidor, ya va en `TIMESTAMPTZ`.

### B.4 Dónde entra la IA y dónde no

El correo de Therefore es una **plantilla**: «Código Proveedor:», «Razón
Social:», «Número Factura:», «Importe:» van siempre igual. Eso se lee con
expresiones regulares, es determinista y se prueba. La IA entra **solo** en
dos sitios, y en los dos con esquema estricto y confianza por campo:

1. El bloque libre «Información Adicional» **cuando** el parser determinista
   no consigue asignar acción a todos los albaranes (líneas ambiguas,
   prosa sin cabeceras «Grabar/Modificar»).
2. Los adjuntos PDF, tras intentar `pdf-parse` (declarado en `package.json`,
   se estrena aquí): si el texto extraído basta para localizar número, fecha,
   total y albarán con regex, no se llama a la IA. Si no, se manda el PDF
   como en `invoice-scan`. Un PDF escaneado sin capa de texto va siempre a
   la IA.

Sin `OPENAI_API_KEY` el módulo **funciona**: lo que la IA habría resuelto
queda como `REQUIERE_REVISION`. Nunca se inventa un dato.

---

## C. Modelo de datos definitivo

Prefijo `thf_`. Todo con `empresa_id UUID NOT NULL` (tenant SaaS,
`ctx.empresaId`). El código de empresa de Therefore («007») es **otro campo**:
`empresa_codigo TEXT`. No son lo mismo: el primero es quién usa Mobilink, el
segundo es la sociedad del ERP a la que se refiere el correo.

### C.1 `thf_expedientes`

```sql
CREATE TABLE IF NOT EXISTS thf_expedientes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL,
  numero             TEXT NOT NULL,             -- INC-000452 / APR-000031 (contador propio)
  empresa_codigo     TEXT NOT NULL DEFAULT '',  -- «007»
  empresa_nombre     TEXT NOT NULL DEFAULT '',  -- «Comercial Sea_New»
  tipo               TEXT NOT NULL CHECK (tipo IN ('INCIDENCIA_ALBARAN','APROBACION_FACTURA','OTRO')),
  estado             TEXT NOT NULL DEFAULT 'NUEVO'
                     CHECK (estado IN ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO','RESUELTO','CERRADO')),
  prioridad          TEXT NOT NULL DEFAULT 'NORMAL'
                     CHECK (prioridad IN ('BAJA','NORMAL','ALTA','CRITICA')),
  prioridad_score    INTEGER NOT NULL DEFAULT 0,
  prioridad_manual   TEXT,                      -- si alguien la fija a mano, gana
  requiere_revision  BOOLEAN NOT NULL DEFAULT false,

  proveedor_codigo   TEXT,
  proveedor_nombre   TEXT,
  cuenta_contable    TEXT,
  factura_numero     TEXT,
  factura_fecha      DATE,
  importe_centimos   BIGINT,                    -- con signo; -4563 = abono de 45,63
  moneda             TEXT NOT NULL DEFAULT 'EUR',
  caso_referencia    TEXT,                      -- «Caso 74824» de Therefore, si viene

  fecha_primera_notificacion TIMESTAMPTZ NOT NULL,
  fecha_ultima_notificacion  TIMESTAMPTZ NOT NULL,
  numero_notificaciones      INTEGER NOT NULL DEFAULT 1,
  numero_reclamaciones       INTEGER NOT NULL DEFAULT 0,  -- nivel_reclamacion
  urgente                    BOOLEAN NOT NULL DEFAULT false,
  tarea_vencida              BOOLEAN NOT NULL DEFAULT false,

  asignado_usuario_id      UUID,
  fecha_inicio_gestion     TIMESTAMPTZ,
  fecha_resolucion         TIMESTAMPTZ,
  resuelto_por_usuario_id  UUID,
  fecha_cierre             TIMESTAMPTZ,
  observaciones            TEXT NOT NULL DEFAULT '',

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX IF NOT EXISTS thf_exp_empresa_factura_idx  ON thf_expedientes (empresa_id, empresa_codigo, factura_numero);
CREATE INDEX IF NOT EXISTS thf_exp_proveedor_factura_idx ON thf_expedientes (empresa_id, proveedor_codigo, factura_numero);
CREATE INDEX IF NOT EXISTS thf_exp_estado_prioridad_idx  ON thf_expedientes (empresa_id, estado, prioridad);
CREATE INDEX IF NOT EXISTS thf_exp_ultima_notif_idx      ON thf_expedientes (empresa_id, fecha_ultima_notificacion DESC);
CREATE INDEX IF NOT EXISTS thf_exp_asignado_idx          ON thf_expedientes (empresa_id, asignado_usuario_id) WHERE asignado_usuario_id IS NOT NULL;
```

Decisiones:

- **Importes en céntimos con signo**, `BIGINT`. Es el criterio de Cash
  (`domain/money.ts`) y evita el 0,1 + 0,2. El signo se conserva: un abono es
  negativo (caso 10).
- **`prioridad` y `prioridad_score` se guardan**, no se calculan al leer: la
  bandeja filtra y ordena por ellos con índice. Se recalculan en cada evento
  del expediente y en una pasada diaria (los días abiertos cambian solos).
- **`prioridad_manual`** existe porque un gestor puede saber algo que el
  score no sabe. Si está, gana; el score sigue calculándose y se enseña.
- **`numero` propio** (`INC-`/`APR-` + secuencia por empresa) con contador
  `thf_contadores (empresa_id, serie, last_seq)`; el UUID sigue siendo la
  clave. Es lo que la gente cita por teléfono.
- «Reclamado» **no es estado**: es `numero_reclamaciones > 0`, tal como pide el
  encargo. La pestaña «Reclamados» de la bandeja es un filtro, no un estado.

### C.2 `thf_actuaciones`

```sql
CREATE TABLE IF NOT EXISTS thf_actuaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  expediente_id     UUID NOT NULL REFERENCES thf_expedientes(id) ON DELETE CASCADE,
  tipo_accion       TEXT NOT NULL CHECK (tipo_accion IN ('GRABAR','MODIFICAR','REVISAR','ANULAR','GESTIONAR','APROBAR','OTRO')),
  albaran           TEXT,                        -- NULL en actuaciones sin albarán (aprobar factura)
  albaran_normalizado TEXT,                      -- sin ceros a la izquierda ni espacios, para cruzar
  importe_centimos  BIGINT,                      -- lo que DICE EL CORREO; nunca se corrige
  estado            TEXT NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (estado IN ('PENDIENTE','EN_PROCESO','BLOQUEADA','RESUELTA','DESCARTADA')),
  obligatoria       BOOLEAN NOT NULL DEFAULT true,
  resultado         TEXT,                        -- texto libre de quien la resolvió
  erp_referencia    TEXT,                        -- nº de albarán/asiento en el ERP
  erp_estado        JSONB,                       -- última respuesta del adaptador ERP
  erp_consultado_at TIMESTAMPTZ,
  confianza         NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  origen_notificacion_id UUID,                   -- el correo que la introdujo
  iniciada_por_usuario_id  UUID,
  iniciada_at       TIMESTAMPTZ,
  resuelta_por_usuario_id  UUID,
  resuelta_at       TIMESTAMPTZ,
  observaciones     TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thf_act_expediente_idx ON thf_actuaciones (expediente_id);
CREATE INDEX IF NOT EXISTS thf_act_albaran_idx    ON thf_actuaciones (empresa_id, albaran_normalizado);
-- Un mismo albarán con la misma acción no se repite dentro de un expediente
-- (es la garantía del caso 12: «789 nuevo, 123 y 456 existentes»).
CREATE UNIQUE INDEX IF NOT EXISTS thf_act_unica_idx
  ON thf_actuaciones (expediente_id, tipo_accion, albaran_normalizado)
  WHERE albaran_normalizado IS NOT NULL AND estado <> 'DESCARTADA';
```

- Se añade **`APROBAR`** a los tipos iniciales: una aprobación de factura es
  una actuación resoluble («aprobada en Therefore el día X por Y») y sin ella
  el expediente de aprobación no tendría nada que resolver. Es una ampliación
  de la lista, no un cambio.
- **`DESCARTADA`** es el estado de una actuación que un cambio de instrucción
  dejó sin efecto («mantener anterior» descarta la nueva, «aceptar nueva»
  descarta la anterior). No se borra: es historia.
- `albaran_normalizado` existe porque Therefore escribe `0804210` y el ERP
  `804210`, y el cruce tiene que dar el mismo albarán.

### C.3 `thf_notificaciones`

```sql
CREATE TABLE IF NOT EXISTS thf_notificaciones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL,
  expediente_id         UUID REFERENCES thf_expedientes(id) ON DELETE SET NULL, -- NULL mientras espera decisión o falló el parser
  message_id            TEXT NOT NULL,          -- cabecera RFC Message-ID
  gmail_message_id      TEXT,                   -- X-GM-MSGID (imapflow: emailId), si el servidor es Gmail
  gmail_thread_id       TEXT,                   -- X-GM-THRID (imapflow: threadId)
  in_reply_to           TEXT,
  fecha_email           TIMESTAMPTZ NOT NULL,
  remitente             TEXT NOT NULL DEFAULT '',
  destinatario          TEXT NOT NULL DEFAULT '',
  asunto                TEXT NOT NULL DEFAULT '',
  texto_original        TEXT NOT NULL,          -- text/plain o html→texto; NUNCA se borra ni se edita
  html_original         TEXT,                   -- si vino en HTML, tal cual
  eml_storage_path      TEXT,                   -- el .eml entero en el bucket
  tipo_notificacion     TEXT NOT NULL DEFAULT 'SOLICITUD'
                        CHECK (tipo_notificacion IN ('SOLICITUD','RECORDATORIO','RECLAMACION','TAREA_VENCIDA','CAMBIO_INSTRUCCION','APROBACION','OTRO')),
  urgente_detectado     BOOLEAN NOT NULL DEFAULT false,
  persona_solicitante   TEXT,
  fecha_solicitud_texto TEXT,                   -- «02/09/2026» tal como venía
  hash_contenido        TEXT NOT NULL,          -- sha256 del texto normalizado (misma petición reenviada)
  parseado              JSONB,                  -- CorreoParseado con confianzas: la evidencia
  estado_proceso        TEXT NOT NULL DEFAULT 'PROCESADA'
                        CHECK (estado_proceso IN ('PROCESADA','PENDIENTE_DECISION','ERROR_PARSER','IGNORADA')),
  error_proceso         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, message_id)
);
CREATE INDEX IF NOT EXISTS thf_notif_expediente_idx ON thf_notificaciones (expediente_id, fecha_email);
CREATE INDEX IF NOT EXISTS thf_notif_hash_idx       ON thf_notificaciones (empresa_id, hash_contenido);
CREATE INDEX IF NOT EXISTS thf_notif_proceso_idx    ON thf_notificaciones (empresa_id, estado_proceso) WHERE estado_proceso <> 'PROCESADA';
```

- **`message_id` es la clave de idempotencia** y va en un `UNIQUE` de base, no
  en un «¿ya existe?» previo: dos pasadas del listener a la vez pasarían las
  dos por la comprobación (misma lección que `correo/servicio.ts`).
- `gmail_message_id` / `gmail_thread_id` se rellenan si el servidor IMAP los
  da (Gmail lo hace con la extensión `X-GM-EXT-1`, que `imapflow` expone como
  `emailId`/`threadId`). Si el buzón no fuera Gmail, quedan a NULL y nada se
  rompe: el `Message-ID` RFC es el que manda.
- `tipo_notificacion` lo decide el **dedupe**, no el parser: el mismo texto es
  `SOLICITUD` si crea expediente y `RECLAMACION` si llega sobre uno abierto.
  `RECORDATORIO` es la segunda notificación sin marca de urgencia ni palabras
  de reclamación; `RECLAMACION` la que lleva «reclamación», «urgente»,
  «seguimos sin», o es la tercera o posterior. Las palabras clave van en
  `thf_config` (`parser.palabras_reclamacion`).

### C.4 `thf_adjuntos`

```sql
CREATE TABLE IF NOT EXISTS thf_adjuntos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  notificacion_id  UUID NOT NULL REFERENCES thf_notificaciones(id) ON DELETE CASCADE,
  expediente_id    UUID REFERENCES thf_expedientes(id) ON DELETE SET NULL,
  nombre_archivo   TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  tamano_bytes     INTEGER NOT NULL,
  tipo_documento   TEXT NOT NULL DEFAULT 'OTRO'
                   CHECK (tipo_documento IN ('PDF_FACTURA','PDF_ABONO','XML_FACTURA','OTRO')),
  hash_archivo     TEXT NOT NULL,              -- sha256 hex del binario
  storage_path     TEXT NOT NULL,              -- <empresa>/<hash[0:2]>/<hash>.<ext>: el mismo fichero se guarda UNA vez
  parsed           BOOLEAN NOT NULL DEFAULT false,
  parse_error      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notificacion_id, hash_archivo)
);
CREATE INDEX IF NOT EXISTS thf_adj_hash_idx       ON thf_adjuntos (empresa_id, hash_archivo);
CREATE INDEX IF NOT EXISTS thf_adj_expediente_idx ON thf_adjuntos (expediente_id);
```

El `storage_path` **es el hash**: Therefore reenvía el mismo PDF cuatro veces
y se guarda una. La fila de `thf_adjuntos` sí se repite por notificación,
porque «este correo traía este PDF» es un hecho de cada correo.

### C.5 `thf_documentos` (documento contable normalizado)

```sql
CREATE TABLE IF NOT EXISTS thf_documentos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID NOT NULL,
  expediente_id     UUID NOT NULL REFERENCES thf_expedientes(id) ON DELETE CASCADE,
  adjunto_id        UUID REFERENCES thf_adjuntos(id) ON DELETE SET NULL,
  hash_archivo      TEXT NOT NULL,              -- para no extraer dos veces el mismo fichero
  tipo_documento    TEXT NOT NULL CHECK (tipo_documento IN ('FACTURA','ABONO','ALBARAN','OTRO')),
  numero_documento  TEXT,
  fecha_documento   DATE,
  proveedor_nombre  TEXT,
  proveedor_nif     TEXT,
  cliente_nombre    TEXT,
  cliente_nif       TEXT,
  base_centimos     BIGINT,
  iva_centimos      BIGINT,
  total_centimos    BIGINT,                     -- con signo
  moneda            TEXT NOT NULL DEFAULT 'EUR',
  albaran_principal TEXT,
  albaranes         JSONB NOT NULL DEFAULT '[]', -- todos los que cite el documento
  caso_referencia   TEXT,
  origen            TEXT NOT NULL CHECK (origen IN ('XML','PDF_TEXTO','PDF_IA')),
  confianza         JSONB NOT NULL DEFAULT '{}', -- por campo, como invoice-scan
  datos_json        JSONB NOT NULL DEFAULT '{}', -- la extracción cruda entera
  validacion        TEXT NOT NULL DEFAULT 'SIN_COMPARAR'
                    CHECK (validacion IN ('SIN_COMPARAR','VALIDADO','DISCREPANCIA')),
  discrepancias     JSONB NOT NULL DEFAULT '[]', -- [{campo, correo, documento}]
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (expediente_id, hash_archivo)
);
```

Regla (caso 9): `comparar.ts` cruza importe y albarán del correo con los del
documento. Si difieren, `validacion = 'DISCREPANCIA'` y la lista
`discrepancias` dice campo, valor del correo y valor del documento. **El
expediente y la actuación conservan lo que decía el correo.** Nadie corrige
en silencio; la pantalla enseña los dos.

### C.6 `thf_eventos` (histórico inmutable)

```sql
CREATE TABLE IF NOT EXISTS thf_eventos (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      UUID NOT NULL,
  expediente_id   UUID,                         -- NULL para eventos de notificación huérfana
  notificacion_id UUID,
  actuacion_id    UUID,
  tipo            TEXT NOT NULL,
  actor_tipo      TEXT NOT NULL DEFAULT 'sistema' CHECK (actor_tipo IN ('sistema','usuario')),
  usuario_id      UUID,
  usuario_nombre  TEXT,
  datos_anteriores JSONB,
  datos_nuevos     JSONB,
  descripcion     TEXT NOT NULL DEFAULT '',     -- una frase para la timeline
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  huella          TEXT
);
CREATE INDEX IF NOT EXISTS thf_ev_expediente_idx ON thf_eventos (expediente_id, occurred_at);
-- Mismo trigger de huella y mismo candado BEFORE UPDATE OR DELETE que assistance_events.
```

Tipos: `EXPEDIENTE_CREADO`, `CORREO_RECIBIDO`, `DOCUMENTO_ANADIDO`,
`DUPLICADO_DETECTADO`, `DUPLICADO_FUSIONADO`, `RECLAMACION_RECIBIDA`,
`PRIORIDAD_MODIFICADA`, `USUARIO_ASIGNADO`, `ACTUACION_ANADIDA`,
`ACTUACION_INICIADA`, `ACTUACION_BLOQUEADA`, `ACTUACION_RESUELTA`,
`ACTUACION_DESCARTADA`, `CAMBIO_INSTRUCCION_DETECTADO`,
`CAMBIO_INSTRUCCION_DECIDIDO`, `DISCREPANCIA_DETECTADA`,
`REQUIERE_REVISION`, `REVISION_RESUELTA`, `EXPEDIENTE_RESUELTO`,
`EXPEDIENTE_REABIERTO`, `EXPEDIENTE_CERRADO`, `RECLAMACION_SOBRE_RESUELTO`,
`ESTADO_MODIFICADO`, `OBSERVACION_ANADIDA`.

Además, **toda acción de usuario** escribe también en `app_auditoria` con
`registrarAuditoria` (`accion = 'therefore.<evento>'`): es el registro
transversal de la plataforma y no se estrena uno paralelo. `thf_eventos` es
la timeline del expediente; `app_auditoria`, la de la plataforma. Igual que
Assist con `assistance_events`.

### C.7 `thf_decisiones` (lo que espera a una persona)

```sql
CREATE TABLE IF NOT EXISTS thf_decisiones (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('POSIBLE_DUPLICADO','CAMBIO_INSTRUCCION','RECLAMACION_SOBRE_RESUELTO','REQUIERE_REVISION','ERROR_PARSER')),
  notificacion_id    UUID NOT NULL REFERENCES thf_notificaciones(id) ON DELETE CASCADE,
  expediente_id      UUID REFERENCES thf_expedientes(id) ON DELETE CASCADE,   -- el afectado, si lo hay
  candidatos         JSONB NOT NULL DEFAULT '[]', -- [{expediente_id, numero, score, motivos[]}]
  detalle            JSONB NOT NULL DEFAULT '{}', -- p.ej. {albaran, anterior:'GRABAR', nueva:'MODIFICAR'}
  estado             TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','DECIDIDA')),
  decision           TEXT,                        -- FUSIONAR | CREAR_NUEVO | ACEPTAR_NUEVA | MANTENER_ANTERIOR | BLOQUEAR | REABRIR | CONFIRMAR_RESUELTO | CREAR_RELACIONADO | CORREGIR | IGNORAR
  decidida_por_usuario_id UUID,
  decidida_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thf_dec_pendientes_idx ON thf_decisiones (empresa_id, estado, created_at) WHERE estado = 'PENDIENTE';
```

Es la «bandeja de excepciones» del módulo, con el mismo criterio que
`server/excepciones`: cada fila es una cosa que se puede resolver, con lo que
le pasa escrito al lado. Sin esta tabla, «posible duplicado» tendría que
vivir como un estado del expediente, y no lo es.

### C.8 `thf_config`, `thf_contadores`, `thf_buzon_pasadas`

```sql
CREATE TABLE IF NOT EXISTS thf_config (
  empresa_id UUID NOT NULL, clave TEXT NOT NULL, valor TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, clave)
);
CREATE TABLE IF NOT EXISTS thf_contadores (
  empresa_id UUID NOT NULL, serie TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, serie)
);
CREATE TABLE IF NOT EXISTS thf_buzon_pasadas (        -- como tc_checkpoint_ejecuciones
  id BIGSERIAL PRIMARY KEY, empresa_id UUID NOT NULL,
  inicio TIMESTAMPTZ NOT NULL, fin TIMESTAMPTZ,
  correos INTEGER NOT NULL DEFAULT 0, nuevos INTEGER NOT NULL DEFAULT 0,
  fusionados INTEGER NOT NULL DEFAULT 0, a_revision INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0, error TEXT
);
```

Claves de `thf_config` (con su valor por defecto en `domain/config.ts`,
tipadas y validadas; la tabla solo guarda lo que se cambia):

| Clave | Defecto |
|---|---|
| `dedupe.peso.misma_factura` … `dedupe.peso.proveedor_diferente` | 50, 45, 20, 15, 10, 10, 10, −40, −40, −20 |
| `dedupe.umbral.fusionar` / `dedupe.umbral.revisar` | 70 / 40 |
| `dedupe.ventana_dias` | 120 |
| `prioridad.peso.dias_abierto` / `reclamaciones` / `urgente` / `tarea_vencida` | 2 / 10 / 25 / 15 |
| `prioridad.umbral.alta` / `critica` / `baja` | 40 / 70 / 10 |
| `parser.umbral_confianza` | 0.80 |
| `parser.palabras_urgente` / `parser.palabras_reclamacion` | `urgente,urgent` / `reclamaci,seguimos sin,segunda vez,de nuevo,todavía no` |
| `buzon.remitentes` | lo que se decida (filtro de remitente Therefore) |
| `expediente.dias_autocierre` | 30 (RESUELTO → CERRADO sin actividad; 0 = nunca) |
| `empresas.<codigo>` | nombre de la sociedad («007» → «Comercial Sea_New») |

---

## D. Algoritmo de deduplicación definitivo

Vive en `domain/dedupe.ts`, **puro**: entra el correo normalizado, la lista de
candidatos y los pesos; sale una decisión explicada. Sin base, sin red.

### D.1 Candidatos (repository, una consulta)

Expedientes de la misma `empresa_id` cuya `fecha_ultima_notificacion` esté
dentro de `dedupe.ventana_dias`, y que cumplan **al menos una**:

- mismo `empresa_codigo` y mismo `factura_numero`;
- mismo `proveedor_codigo` y mismo `factura_numero`;
- alguna actuación con `albaran_normalizado` en la lista del correo;
- algún adjunto con el mismo `hash_archivo`;
- alguna notificación con el mismo `hash_contenido` o el mismo
  `gmail_thread_id`.

Se incluyen los `RESUELTO`/`CERRADO` de la ventana: hacen falta para el caso
13. Los estados abiertos y cerrados se puntúan igual; **qué se hace** con el
resultado depende del estado (D.4).

### D.2 Puntuación por candidato

```
+ misma_factura        (empresa_codigo + factura_numero iguales)         +50
+ mismo_albaran        (por cada albarán del correo presente en el cand.) +45, tope una vez
+ mismo_proveedor      (proveedor_codigo igual; si falta, nombre normalizado igual) +20
+ mismo_importe        (importe del correo == importe del expediente, con signo) +15
+ misma_empresa        (empresa_codigo igual)                            +10
+ mismo_documento      (hash de PDF/XML ya visto en el candidato)        +10
+ misma_accion         (albarán común con la misma acción)               +10
+ mismo_hilo           (gmail_thread_id o In-Reply-To al candidato)      +30  ← añadido, ver abajo
− factura_diferente    (los dos tienen factura y difieren)               −40
− proveedor_diferente  (los dos tienen código y difieren)                −20
− tipo_incompatible    (INCIDENCIA_ALBARAN vs APROBACION_FACTURA)        −40
```

Dos desviaciones respecto a la propuesta inicial, y el porqué:

1. **«Acción incompatible» no resta cuando el albarán coincide.** Con la
   tabla literal, «GRABAR 2028359553» seguido de «MODIFICAR 2028359553»
   daría 45 + 10 + 20 − 40 = 35 → expediente nuevo, que es justo lo que el
   apartado 11 prohíbe. Un albarán ya conocido con otra acción **es un
   cambio de instrucción sobre el mismo expediente**, no otro expediente. El
   −40 se reserva para la incompatibilidad de **tipo** (una aprobación de
   factura y una incidencia de albarán nunca se fusionan aunque compartan
   proveedor).
2. **Se añade «mismo hilo» (+30).** Gmail agrupa las reclamaciones de
   Therefore en el hilo del primer correo, y es la señal más barata y más
   fiable que hay. Peso configurable como los demás; no basta por sí solo
   para fusionar (30 < 40) porque hay hilos reutilizados.

Cada sumando se anota en `motivos[]` con su texto («misma factura
0000123514», «albarán 802316 ya en INC-452»). Es lo que enseña la pantalla de
revisión y lo que se guarda en `thf_decisiones.candidatos`: «lo dijo el
algoritmo» no es respuesta, como en el enrutado de Central.

### D.3 Aprobaciones de factura

Para `category = APROBACION_FACTURA` la clave es exacta y no hay puntuación:
`(empresa_codigo, proveedor_codigo, factura_numero)`. Si existe expediente
`APROBACION_FACTURA` con esa terna en la ventana → fusionar siempre (score
100). «Aprobación → Tarea vencida → Tarea vencida → Tarea vencida» son un
expediente y cuatro notificaciones (caso 8); cada «tarea vencida» pone
`tarea_vencida = true` y suma al score de prioridad.

Si falta `proveedor_codigo` en el correo de aprobación, se cae a la
puntuación general de D.2.

### D.4 Decisión

```
mejor = candidato con mayor puntuación (desempate: el más reciente)

si mejor.score >= umbral.fusionar (70):
    si mejor.estado in (RESUELTO, CERRADO):
        → thf_decisiones RECLAMACION_SOBRE_RESUELTO  (caso 13; NO se reabre solo)
        → notificación PENDIENTE_DECISION, expediente_id = mejor
    si no:
        → fusionar en mejor (D.5)
si umbral.revisar (40) <= score < umbral.fusionar:
    → thf_decisiones POSIBLE_DUPLICADO con TODOS los candidatos >= 40
    → notificación PENDIENTE_DECISION, sin expediente
si score < 40:
    → crear expediente nuevo
```

Además, con independencia del camino: si algún campo del parser queda por
debajo de `parser.umbral_confianza`, el expediente (nuevo o fusionado) se
marca `requiere_revision = true` y se abre una decisión `REQUIERE_REVISION`
(caso 12). Un albarán ambiguo **no se inventa**: se guarda tal cual en
`parseado`, no se crea actuación, y la decisión dice «el correo cita
“2028359553 / 2028359535” y no sé cuál».

### D.5 Fusionar

En una transacción sobre el expediente destino:

1. Enlazar la notificación (`expediente_id`), `numero_notificaciones + 1`,
   `fecha_ultima_notificacion = fecha_email`.
2. Clasificar la notificación: `RECORDATORIO` / `RECLAMACION` /
   `TAREA_VENCIDA` / `CAMBIO_INSTRUCCION`. Si es `RECLAMACION` o
   `TAREA_VENCIDA`: `numero_reclamaciones + 1`, evento
   `RECLAMACION_RECIBIDA`.
3. `urgente = urgente OR urgente_detectado`; `tarea_vencida` igual.
4. Por cada actuación del correo:
   - mismo albarán **y** misma acción ya en el expediente → nada (caso 3);
   - albarán nuevo → `INSERT` (caso 7, evento `ACTUACION_ANADIDA`);
   - mismo albarán **y** acción distinta → **no se toca** la actuación
     existente; se abre `thf_decisiones CAMBIO_INSTRUCCION` con
     `{albaran, anterior, nueva}`, la notificación pasa a tipo
     `CAMBIO_INSTRUCCION`, evento `CAMBIO_INSTRUCCION_DETECTADO`, y el
     expediente pasa a `BLOQUEADO` hasta que alguien decida (caso 5).
5. Adjuntos y documentos: se guardan; si el `hash_archivo` ya estaba en el
   expediente, se enlaza la fila de adjunto pero no se vuelve a extraer.
6. Si el expediente estaba en `NUEVO` sigue en `NUEVO`; en cualquier otro
   estado abierto se mantiene. Un expediente no retrocede por recibir correo.
7. Recalcular prioridad (E.3). Evento `CORREO_RECIBIDO` siempre.

### D.6 Decisiones humanas

| Decisión | Efecto |
|---|---|
| `POSIBLE_DUPLICADO` → **Fusionar en X** | D.5 sobre X |
| → **Crear nuevo** | crear expediente con la notificación |
| `CAMBIO_INSTRUCCION` → **Aceptar nueva** | actuación anterior `DESCARTADA` (motivo), nueva `PENDIENTE`; expediente vuelve al estado anterior al bloqueo |
| → **Mantener anterior** | nada cambia; se anota; expediente vuelve al estado anterior |
| → **Consultar / bloquear** | expediente sigue `BLOQUEADO`; observación obligatoria |
| `RECLAMACION_SOBRE_RESUELTO` → **Reabrir** | `RESUELTO` → `PENDIENTE`, `fecha_resolucion = NULL`, evento `EXPEDIENTE_REABIERTO`, y se aplica D.5 |
| → **Confirmar que continúa resuelto** | notificación enlazada al expediente, tipo `RECLAMACION`, contador sube, estado no cambia |
| → **Crear incidencia relacionada** | expediente nuevo con `observaciones` «relacionado con INC-452» y evento cruzado en los dos |
| `REQUIERE_REVISION` → **Corregir** | el usuario completa/corrige los campos (albarán, acción, importe); se crean las actuaciones que faltaban; `requiere_revision = false` |
| `ERROR_PARSER` → **Reprocesar** / **Ignorar** | vuelve a pasar por el pipeline desde el `.eml`; o `IGNORADA` con motivo |

Todas quedan en `thf_decisiones` (quién, cuándo, qué) y en `thf_eventos`, y
en `app_auditoria`.

---

## E. Flujo de procesamiento

### E.1 Listener (`buzon.ts`)

Copia de `checkpointMail.ts` con cuatro cambios:

- Variables `THEREFORE_IMAP_HOST/PORT/USER/PASS/CARPETA/MIN` y
  `THEREFORE_EMPRESA_ID` (el tenant al que se asignan los correos; hoy hay una
  empresa, SEA). Apagado sin credenciales, como el CheckPoint.
- Se pide a `imapflow` `emailId` y `threadId` en el `fetch` (Gmail los da;
  cdmon no, y entonces quedan a NULL).
- `Message-ID`, `In-Reply-To` y `References` pasan por
  `server/correo/referencia.ts` (`normalizarMessageId`,
  `referenciasDeCabecera`, `asuntoBase`) antes de guardarse.
- Cada pasada deja una fila en `thf_buzon_pasadas`, y hay un botón
  «Revisar buzón ahora» (`POST /api/therefore/buzon/revisar`, permiso admin).

Como en el CheckPoint, un correo que falla **por la base** se queda sin leer y
se reintenta; uno que falla **por el parser** se marca leído porque ya está
guardado entero (E.2).

Filtro de remitente: solo se procesan correos cuyo `From` coincida con
`buzon.remitentes`; el resto se marca leído y se ignora (o se guarda como
`IGNORADA` si se prefiere ver qué llegó: decisión pendiente I.4).

### E.2 Ingesta (`ingesta.ts`) — un correo

Es una función `procesarCorreo(empresaId, fuente: Buffer, origen: 'buzon' |
'importacion')`. La usan el listener, el endpoint de importación manual
(`POST /api/therefore/importar`, multipart `.eml`, para cargar el histórico de
seis meses) y las pruebas de integración (que así **no necesitan IMAP**).

Pasos: los diez de B.2. Reglas:

- **Transacción única** de la notificación al evento. Un fallo de base deja
  el correo sin leer y sin rastro; la siguiente pasada lo reintenta.
- **Un fallo del parser no es un fallo de base**: se captura, se guarda la
  notificación con `ERROR_PARSER` + `error_proceso` + texto íntegro + `.eml`
  y se abre una decisión `ERROR_PARSER`. El correo se marca leído. Nunca se
  pierde.
- **La IA es opcional en cada paso**: si `hayIA()` es falso o `pedirIA` no
  devuelve `ok`, ese campo queda con confianza 0 → `REQUIERE_REVISION`.
- El `.eml` y los adjuntos se suben a storage **antes** del `INSERT`; si la
  transacción se deshace, quedan ficheros huérfanos por su hash, que es
  inocuo y se reaprovecha en el reintento.

### E.3 Prioridad (`domain/prioridad.ts`)

```
score = dias_abierto * 2 + reclamaciones * 10 + urgente * 25 + tarea_vencida * 15
prioridad = score >= 70 ? CRITICA : score >= 40 ? ALTA : score >= 10 ? NORMAL : BAJA
```

Pesos y umbrales de `thf_config`. Se recalcula: al crear, al fusionar, al
decidir, al cambiar de estado, y en una **pasada diaria** (`setInterval`
cada hora que recalcula los abiertos cuya fecha de cálculo no es hoy; el
mismo molde de `startRecobrosNotifierChecker`). Si `prioridad_manual` está
puesta, `prioridad = prioridad_manual` y el score se sigue guardando. Cambio
de prioridad → evento `PRIORIDAD_MODIFICADA` con anterior/nueva.

### E.4 Estados (`domain/estados.ts`)

```
NUEVO ──(alguien lo abre / se asigna)──► PENDIENTE ──(1ª actuación iniciada)──► EN_PROCESO
  │                                         ▲   │                                   │
  │                                         │   └──(decisión pendiente)──► BLOQUEADO ┘
  │                                         │              │ (decidida) ▲
  └────────────────────────────────────────►│◄─────────────┘            │
                                            │                            │
  (todas las actuaciones obligatorias RESUELTA o DESCARTADA) ──► RESUELTO ──(30 días o a mano)──► CERRADO
                                            ▲                       │
                                            └──── REABRIR ──────────┴────────────────────────────┘
```

- `RESUELTO` es **automático** cuando la última actuación obligatoria se
  resuelve, y también manual con motivo (para un expediente `OTRO` sin
  actuaciones). Que sea automático es lo que pide el encargo; Mobilink no
  tiene una regla contraria (en Assist el cierre también deriva de los
  pasos).
- `BLOQUEADO` guarda en `observaciones`/evento el estado al que volver.
- `CERRADO` no admite correo nuevo sin decisión (D.4).
- Transiciones inválidas → 409 con código, como `ErrorTacografos`.

### E.5 API (`router.ts`, todo bajo `authenticate` + `requireModule("therefore")` + `cargarPermisos`)

```
GET    /api/therefore/bootstrap                      rol, permisos, config, contadores de pestañas
GET    /api/therefore/expedientes?estado&prioridad&empresa&proveedor&accion&usuario&reclamado&urgente&desde&hasta&texto&pestana
GET    /api/therefore/expedientes/:id                 expediente + actuaciones + notificaciones + adjuntos + documentos + eventos + decisiones
PATCH  /api/therefore/expedientes/:id                 asignar, prioridad_manual, observaciones
POST   /api/therefore/expedientes/:id/estado          {estado, motivo}   (reabrir, cerrar, resolver a mano)
POST   /api/therefore/expedientes/:id/actuaciones     añadir a mano
POST   /api/therefore/actuaciones/:id/iniciar | resolver | bloquear | descartar   {resultado?, erp_referencia?, motivo?}
GET    /api/therefore/decisiones?estado=PENDIENTE
POST   /api/therefore/decisiones/:id                  {decision, expediente_id?, correccion?, motivo?}
GET    /api/therefore/adjuntos/:id/url                enlace firmado 15 min (como Tacógrafos)
POST   /api/therefore/notificaciones/:id/reprocesar
POST   /api/therefore/importar                        multipart .eml (uno o varios)   [admin]
POST   /api/therefore/buzon/revisar                   [admin]
GET    /api/therefore/buzon/pasadas                   [admin]
GET/PUT /api/therefore/config                          [admin]
GET    /api/therefore/actuaciones/:id/erp             consulta al adaptador ERP (fase 5; hoy «sin datos»)
```

Permisos (`permissions.ts`, roles en `app_usuario_modulos`):

| Rol | Permisos |
|---|---|
| `consulta` | `therefore.view` |
| `gestor` | + `expediente.edit`, `actuacion.manage`, `decision.resolve`, `expediente.reopen` |
| `admin` | + `config.edit`, `buzon.manage`, `importar` |

### E.6 Adaptador ERP (`erp/puerto.ts`)

```ts
export type EstadoAlbaranErp = {
  existe: boolean; grabado: boolean; contabilizado: boolean;
  importeCentimos: number | null; facturaAsociada: string | null;
  consultadoAt: string; fuente: string;
};
export interface ConsultaAlbaranesErp {
  consultarAlbaran(ctx: { empresaId: string; empresaCodigo: string }, albaran: string): Promise<EstadoAlbaranErp | null>;
}
```

`sinErp.ts` devuelve `null` y la pantalla dice «sin datos del ERP».

Hoy hay **dos** contratos ERP y ninguno llega a los albaranes de compra: el
del Integration Hub (`IErpConnector`: clientes, artículos, pedidos de venta y
compra; BC en modo simulación) y el de Cash (`ICashErpConnector` con
`DocumentoExterno`, orientado a documentos económicos: `customerLedgerEntries`
/ `vendorLedgerEntries`, sin inquilino real contra el que probar). La
implementación real se hará **ampliando `IErpConnector`** del Integration Hub
con métodos opcionales (`getPurchaseReceipt?`, `getPurchaseInvoice?`, como
`getProviders?`), reutilizando el vocabulario `DocumentoExterno` de Cash para
la factura, y un adaptador fino en `erp/integrationHub.ts`. Así se respeta el
invariante «ningún módulo llama a BC directamente» y **no se inventa un
tercer contrato**. No se implementa ahora: no se sabe qué entidad de BC
expone los albaranes de compra ni si el ERP de estas sociedades es BC (I.7).

---

## F. Pantallas y componentes

Ruta `/therefore/*`, lazy en `App.tsx`, tarjeta en el hub. Tema slate/sky.

### F.1 Bandeja (`pages/Bandeja.tsx`)

```
THEREFORE                                           [Revisar buzón] [Importar .eml]
┌──────────┬──────────┬────────────┬────────────┬──────────┬───────────┐
│Pendientes│ Urgentes │ Reclamados │ En proceso │ Revisión │ Resueltos │
│    23    │    4     │     7      │     5      │   (3)    │           │
└──────────┴──────────┴────────────┴────────────┴──────────┴───────────┘
Filtros: estado · prioridad · empresa · proveedor · acción · usuario · reclamado · urgente · fechas · texto
```

Tabla (ordenable por prioridad y antigüedad; por defecto prioridad desc,
última notificación desc):

`● | Expediente | Fecha | Empresa | Tipo | Proveedor | Factura | Actuaciones | Recl. | Antigüedad | Asignado | Estado`

- «Actuaciones» enseña hasta dos (`GRABAR 802316 · MODIFICAR 0804210`) y
  «+1».
- Las pestañas son **filtros con contador**, no estados: Pendientes =
  `NUEVO`+`PENDIENTE`+`BLOQUEADO`; Urgentes = `urgente`; Reclamados =
  `numero_reclamaciones > 0` y abierto; En proceso = `EN_PROCESO`; Revisión =
  decisiones pendientes; Resueltos = `RESUELTO`+`CERRADO`.
- Bandeja vacía se dice con palabras (criterio de `BandejaExcepcionesPage`).

### F.2 Detalle (`pages/Expediente.tsx`)

```
INC-452 · GRABAR ALBARÁN 2028359553                    [Asignar ▾] [Prioridad ▾] [Estado ▾]
URGENTE · 3 reclamaciones · 12 días abierto · Neumáticos Soledad · Fra. 0000123514 · −45,63 €
┌─ Cambio de instrucción detectado ───────────────────────────────────────────┐
│ Anterior: GRABAR 2028359553   Nueva: MODIFICAR 2028359553                  │
│ [Aceptar nueva] [Mantener anterior] [Consultar / bloquear]                  │
└─────────────────────────────────────────────────────────────────────────────┘
Resumen | Actuaciones | Documento | Notificaciones | Adjuntos | Histórico
```

- **Actuaciones**: una tarjeta por fila: albarán, acción, importe del correo,
  estado, quién, `[Iniciar] [Resolver] [Bloquear]`, campo `erp_referencia`,
  y el bloque ERP («sin datos del ERP» hoy).
- **Documento**: los campos extraídos frente a los del correo, con
  `VALIDADO` / `DISCREPANCIA` por campo y el origen (XML / PDF texto / PDF IA)
  y la confianza.
- **Notificaciones**: timeline (`02/09 10:14 Solicitud original · Daniel G`,
  `08/09 08:42 Recordatorio`, `14/09 17:00 URGENTE · Reclamación #3`), cada
  una desplegable con el texto original íntegro.
- **Adjuntos**: nombre, tipo, tamaño, hash corto, «ya venía en 3 correos»,
  enlace firmado.
- **Histórico**: `thf_eventos` con actor y anterior → nuevo.
- Las decisiones pendientes del expediente salen como **banner** arriba, con
  sus botones. Es lo que evita que alguien trabaje sobre una instrucción
  que ya ha cambiado.

### F.3 Revisión (`pages/Revision.tsx`)

Lista de `thf_decisiones` pendientes, agrupadas por tipo, cada una con el
texto del correo y los candidatos con su puntuación y motivos. Los botones
son los de D.6.

### F.4 Configuración (`pages/Configuracion.tsx`, admin)

Pesos y umbrales de dedupe y prioridad, palabras clave, remitentes, empresas
del ERP (código → nombre), estado del buzón y últimas pasadas.

### F.5 Componentes

`components/ui.tsx` **reexporta** el kit de Administración
(`Pill`, `Modal`, `TableWrap`, `thCls`/`tdCls`, `EmptyRow`, `ErrorBox`,
`Field`/`TextField`/`SelectField`, `btnPrimary`…), como hace Cash, y añade
solo lo propio: `ChipEstado`, `ChipPrioridad` (● rosa/ámbar/sky/slate),
`TablaExpedientes`, `FiltrosBandeja`, `Actuaciones`,
`TimelineNotificaciones` (raíl con puntos, molde de `TimelineAsistencia`),
`Documento`, `Adjuntos`, `Historico`, `DecisionPendiente`. Fechas con
`fmtFecha`/`fmtFechaHora` de Administración; importes en céntimos con
`eurosConSigno` de `cash/utils/money.ts`. La derivación de pestañas y
contadores va en `services/bandeja.ts` puro con su `.test.ts`.

---

## G. Plan de migraciones

1. **`server/therefore/schema.ts` → `initTherefore()`**: todo el DDL de C,
   idempotente (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   índices con `.catch()` y aviso), trigger de huella y candado de
   `thf_eventos`. Se encadena en `server/index.ts` después de
   `initTacografos` (`prepararEsquema("Therefore", initTherefore)`) y se
   añade a `vitest.setup.ts` en la misma posición.
2. **`supabase/migrations/therefore_fase1.sql`**: el mismo DDL para pegar en
   el SQL Editor, más las FK a `app_empresas`/`app_usuarios` que el DDL de
   arranque no pone, y RLS **solo lectura** por empresa por si alguna app
   lee con `supabase-js` (hoy ninguna). Comprobación final con `DO $$ … $$`
   como las demás.
3. **`supabase/migrations/saas_modulo_therefore.sql`**: reconstruye los CHECK
   de `app_licencias.modulo` y `app_usuario_modulos.modulo` con la unión de
   lo que hay + `therefore` (copia de `saas_modulo_assist.sql`), y siembra la
   licencia sin caducidad para SEA
   (`00000000-0000-4000-a000-000000000001`).
4. Sin cambios en tablas existentes. Sin backfill: el histórico entra por
   `POST /api/therefore/importar` con los `.eml` exportados de Gmail, que
   pasa por el mismo pipeline y por tanto deduplica.
5. Storage: bucket privado `therefore-correo` creado al vuelo
   (`asegurarBucket`, como Tacógrafos); `THEREFORE_STORAGE_LOCAL=1` en
   pruebas.
6. Variables de entorno nuevas en `.env.example`: `THEREFORE_IMAP_*`,
   `THEREFORE_EMPRESA_ID`, `THEREFORE_CORREO_BUCKET`,
   `THEREFORE_STORAGE_LOCAL`. Ninguna credencial en base.

---

## H. Estrategia de pruebas

### H.1 Dominio (puras, `server/therefore/domain/*.test.ts`)

- `parser/plantilla.test.ts`: campos fijos, con acentos y sin ellos, con
  «Importe: -45,63» / «−45,63 €» / «45.63» / «1.234,56»; fecha `dd/mm/aaaa`.
- `parser/actuaciones.test.ts`: un albarán; varios bajo «Grabar»; bloques
  «Grabar» + «Modificar:»; albarán con importe en la misma línea; albarán
  con ceros a la izquierda; línea ambigua («2028359553 / 2028359535») →
  sin actuación + confianza baja.
- `parser/confianza.test.ts`: umbral → `requiereRevision`.
- `dedupe.test.ts`: cada peso por separado; combinaciones de los casos 3, 5,
  6, 7, 8, 11 y 13; pesos alterados desde config; empate.
- `prioridad.test.ts`: la fórmula, los umbrales, `prioridad_manual`.
- `estados.test.ts`: la tabla de transiciones entera, válidas e inválidas.
- `comparar.test.ts`: correo vs documento, signo, tolerancia cero,
  discrepancia por albarán y por importe (caso 9, caso 10).
- `adjuntos/xml.test.ts` con un XML de muestra; `pdfTexto.test.ts` con un
  PDF pequeño generado en la prueba.

### H.2 Integración (`therefore.integration.test.ts`, HTTP + PostgreSQL, `RUN_DB_TESTS=1`)

Un fixture por caso obligatorio como `.eml` en `server/therefore/fixtures/`
(anonimizados), inyectados por `procesarCorreo()` o por
`POST /api/therefore/importar`, con `THEREFORE_STORAGE_LOCAL=1` y **sin**
`OPENAI_API_KEY` (la IA no entra en la CI; el parser determinista tiene que
bastar para los fixtures):

| Caso | Comprobación |
|---|---|
| 1 | 1 expediente `INCIDENCIA_ALBARAN`, 1 actuación `GRABAR 2028359553`, importe `-4563`, evento `EXPEDIENTE_CREADO` |
| 2 | mismo `.eml` dos veces → 1 notificación, 1 expediente, 1 actuación; la segunda llamada devuelve «ya procesado» |
| 3 | segundo correo mismo albarán → mismo expediente, 2 notificaciones, tipo `RECORDATORIO`/`RECLAMACION`, 1 actuación |
| 4 | reclamación con «URGENTE» → `urgente = true`, `prioridad_score` sube, evento `PRIORIDAD_MODIFICADA` |
| 5 | GRABAR 123 → MODIFICAR 123 → decisión `CAMBIO_INSTRUCCION`, expediente `BLOQUEADO`, actuación original intacta; decidir «aceptar» → anterior `DESCARTADA`, nueva `PENDIENTE` |
| 6 | GRABAR 123 / GRABAR 456 / MODIFICAR 789 → 1 expediente, 3 actuaciones con su acción |
| 7 | segundo correo GRABAR 123/456/999 → 4ª actuación `GRABAR 999`, las otras sin duplicar (índice único) |
| 8 | aprobación + 3 tareas vencidas misma factura → 1 `APROBACION_FACTURA`, 4 notificaciones, `tarea_vencida = true` |
| 9 | PDF con total distinto al correo → `thf_documentos.validacion = DISCREPANCIA`, expediente conserva el importe del correo |
| 10 | `-45,63 €` → `importe_centimos = -4563` en expediente, actuación y documento |
| 11 | resolver las actuaciones → `RESUELTO`; nuevo correo → decisión `RECLAMACION_SOBRE_RESUELTO`, estado sigue `RESUELTO`; «reabrir» → `PENDIENTE` + evento |
| 12 | albarán ambiguo → sin actuación, `requiere_revision`, decisión `REQUIERE_REVISION`; «corregir» crea la actuación |
| + | aislamiento: un usuario de otra `empresa_id` recibe 404 en el expediente; sin permiso → 403 en las acciones; parser roto (fixture corrupto) → `ERROR_PARSER` con texto guardado y reprocesable |
| + | inmutabilidad: `UPDATE thf_eventos` lanza excepción |

La CI ya exige que las de integración se ejecuten de verdad; añadir este
fichero las cubre sin tocar el workflow.

### H.3 Lo que no se prueba en CI

El listener IMAP y la IA. El primero se prueba a mano contra el buzón real
con «Revisar buzón ahora»; la segunda, con un script de un solo uso sobre los
fixtures que compare la salida del parser determinista con la de la IA.

---

## I. Riesgos y decisiones pendientes

Lo que **no se puede decidir leyendo el repositorio**:

1. **Buzón.** ¿Qué cuenta recibe los correos de Therefore? Opciones: (a) IMAP
   directo a esa cuenta de Gmail con contraseña de aplicación (exige 2FA) y
   una etiqueta «Therefore» puesta por filtro, leída como carpeta IMAP; da
   `gmail_message_id` y `gmail_thread_id` (recomendado); (b) reenvío
   automático por filtro de Gmail a un buzón de cdmon, como hace hoy el
   CheckPoint con Bridgestone: el reenvío automático conserva el
   `Message-ID` original, pero no habrá ids de Gmail y un reenvío manual sí
   lo cambia; (c) API de Gmail con OAuth (no hay nada en el repo; más
   trabajo y más secretos). El diseño funciona con (a) y (b); asume (a).
2. **Histórico.** Para cargar los seis meses hacen falta los `.eml`
   (exportación de Gmail/Takeout o la carpeta IMAP entera). Con (a) basta con
   apuntar el listener a la etiqueta y dejar `seen: false` en todos.
3. **Muestras reales.** Sin 15–20 correos reales anonimizados (con sus PDF y
   XML) el parser se escribe a ciegas. Es el bloqueo principal de la fase 2.
4. **Correos de Therefore que no encajan** (avisos de sistema, otros
   flujos): ¿se guardan como `IGNORADA` para verlos, o se descartan? El
   diseño los guarda.
5. **Formato del XML.** ¿Facturae 3.2? ¿Exportación de Therefore? Decide
   `adjuntos/xml.ts` y qué dependencia se añade (`fast-xml-parser`,
   pequeña y sin dependencias, es la propuesta). Hasta verlo, solo PDF.
6. **HTML vs texto.** Si Therefore manda solo HTML, el parser trabaja sobre
   `html-to-text` (ya en `node_modules` vía mailparser) y hay que fijar las
   reglas de saltos de línea con muestras.
7. **ERP.** ¿Business Central expone los albaranes de compra
   (`purchaseReceipts`) en la API v2.0 que usa el conector? ¿O el ERP de
   estas sociedades es otro (Cash habla de «Genes»)? Sin respuesta, el
   adaptador queda en `sinErp`.
8. **Empresas.** ¿Cuántos códigos de sociedad hay («007» y cuáles más)? ¿Todos
   son del mismo tenant SEA? El diseño asume un tenant y N sociedades.
9. **Roles.** `consulta` / `gestor` / `admin` es una propuesta. ¿Quién
   resuelve actuaciones: administración, o también taller?
10. **Autocierre.** 30 días de `RESUELTO` a `CERRADO`, ¿o solo a mano?
11. **IA sobre el cuerpo del correo.** Los correos llevan razón social y
    cuenta contable de proveedores. Va por data-URI como en Cash y no se
    guarda en el proveedor, pero conviene confirmarlo.
12. **Prioridad automática vs manual.** Si un gestor fija `CRITICA` a mano y
    llegan tres reclamaciones más, ¿se mantiene la manual? El diseño dice sí.

Riesgos técnicos:

- **Parser frágil.** Therefore puede cambiar la plantilla. Mitigación:
  fixtures + `ERROR_PARSER` que no pierde nada + `REQUIERE_REVISION`.
- **Falsos positivos de fusión.** Un proveedor con muchas facturas del mismo
  importe. Mitigación: la factura pesa más que nada, los motivos se enseñan,
  y una fusión se puede deshacer creando un expediente relacionado desde la
  notificación (fase 4).
- **`server/index.ts`** tiene 19 000 líneas; el módulo no añade nada ahí
  salvo dos líneas (init + mount + start).
- **Doble mecanismo de migraciones**: el DDL vive en dos sitios
  (`schema.ts` y `.sql`) y hay que mantenerlos iguales, como ya pasa con
  Tacógrafos.
- **Carga del histórico en una petición.** Cientos de `.eml` por
  `POST /importar` en un solo `multipart` pueden pasar el timeout de Render.
  Se importa por lotes desde el panel (el endpoint devuelve el resultado
  por fichero) o, con la opción (a) del buzón, dejando la etiqueta entera
  sin leer y que el listener la vacíe a 20 por pasada.

---

## J. Plan de implementación por fases

Cada fase es un PR mergeable con CI verde y el módulo utilizable al final.

**Fase 1 — Cimientos (sin correo)**
`server/therefore/{index,schema,permissions,repository,router}.ts`,
`domain/{estados,prioridad,config}.ts` con tests, alta en `tsconfig.server.json`,
`vitest.setup.ts`, cadena de arranque, migraciones G.1–G.3, `.env.example`.
Panel: `ThereforeApp`, contexto, layout, Bandeja y Detalle leyendo la API,
tarjeta en hub y accesos. Los expedientes se crean a mano por la API para
probar la bandeja. Integración: aislamiento, permisos, transiciones.

**Fase 2 — Parser + ingesta + dedupe**
`domain/parser/*`, `domain/{normalizar,dedupe,comparar}.ts`, `ingesta.ts`,
`storage.ts`, `POST /importar`, `thf_decisiones` y la pantalla Revisión.
Fixtures reales anonimizados. Casos 1–8, 10–12 en integración. Aquí se
carga el histórico y se calibran pesos con datos reales.

**Fase 3 — Buzón + adjuntos**
`buzon.ts` (IMAP, pasadas, botón), `adjuntos/{extractor,extractorIA,pdfTexto,xml}.ts`,
`thf_documentos`, bloque Documento y Adjuntos en el detalle, caso 9.
Pasada diaria de prioridad. Autocierre.

**Fase 4 — Trabajo diario**
Decisiones humanas completas (D.6) con sus banners, reabrir, crear
relacionado, corregir revisión, observaciones, asignación, histórico
completo, configuración en pantalla, filtros guardados, exportación a
Excel de la bandeja (`xlsx` ya está).

**Fase 5 — ERP**
`erp/puerto.ts` y `sinErp.ts` llegan en la fase 1 (es una interfaz);
aquí se implementa contra el Integration Hub cuando I.7 tenga respuesta:
consulta por actuación, `erp_estado` en la tarjeta, y —solo si se decide—
«resolver desde el ERP» cuando el albarán ya conste grabado.

Orden de dependencias: 1 → 2 → 3 → 4; 5 cuando haya ERP. Las fases 2 y 3
son las que necesitan las muestras de I.3.
