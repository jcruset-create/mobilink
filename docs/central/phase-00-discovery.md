# Fase 0 — Discovery y auditoría · Mobilink Cash Central (MC Central)

- **Commit auditado:** `edd3139` (idéntico a `origin/main`: 0 commits de diferencia en ambos sentidos)
- **Rama:** `claude/mobilink-central-cash-uqk7t9`
- **Fecha:** 2026-08-20
- **Sustituye a:** una auditoría previa sobre `bc28e12` (13-ago-2026), **228 commits por detrás** y
  anterior a la entrega del módulo Mobilink Cash. Su hallazgo principal —«el dominio de caja física
  NO existe»— es falso en este commit. Ver apartado C.

### Ficheros leídos en profundidad

Completos: `server/core/auth.ts`, `server/core/auditoria.ts`, `docs/mobilink-cash.md`,
`supabase/migrations/saas_fase1_empresas_licencias.sql` (sección de empresas/centros/licencias).

Parciales (bloques citados + búsquedas dirigidas sobre el fichero entero):
`server/cash/schema.ts`, `server/cash/service.ts`, `server/cash/repository.ts`,
`server/cash/router.ts`, `server/cash/permissions.ts`, `server/cash/erp/worker.ts`,
`server/cash/erp/connector.ts`, `server/cash/domain/money.ts`, `server/cash/bankdeposits.ts`,
`server/cash/treasury.ts`, `server/cash/config.ts`, `server/cash/index.ts`,
`src/modules/cash/services/api.ts`, `server/index.ts`, `supabase/migrations/cash_fase*.sql`,
`server/integration-hub/**`.

No leídos: `server/cash/report.ts`, `server/cash/documents.ts`, `server/cash/storage.ts`,
`server/cash/domain/*` salvo `money.ts`, las 10 pantallas de `src/modules/cash/pages/`,
las migraciones `administracion_fase*.sql`, las apps Flutter. Ver apartado N.

---

## A. Current Architecture

**[HECHO]** El repositorio es un monolito con SPA React y ocho apps Flutter. No hay ORM: todo el
acceso a datos es SQL crudo sobre `pg.Pool` (`server/cash/repository.ts:25-26`).

- **Frontend:** React 18 + Vite 5 + Tailwind 4 + react-router 7 (`package.json`). El módulo de caja
  vive en `src/modules/cash/`, con entrada `CashApp.tsx` y cliente HTTP propio contra
  `const BASE = "/api/cash"` (`src/modules/cash/services/api.ts:24`).
- **Backend:** Express 5. `server/index.ts` es un monolito de ~17.200 líneas que monta los módulos;
  el de caja entra por una sola línea, `mountCash(app)` (`server/index.ts:16910`), que a su vez hace
  `app.use("/api/cash", createCashRouter())` (`server/cash/index.ts:17`). El esquema se aplica al
  arrancar con `prepararEsquema("Mobilink Cash", initCash)` (`server/index.ts:17330`) y el worker de
  salida arranca después (`server/index.ts:17346`).
- **Base de datos:** PostgreSQL (Supabase) con migraciones en `supabase/migrations/` (182 ficheros)
  **aplicadas a mano**, más un DDL idempotente `CREATE TABLE IF NOT EXISTS` ejecutado en el arranque
  (`server/cash/schema.ts:31` y siguientes). Hay además un SQLite local (`server/db.sqlite.ts`).
- **Autenticación:** Supabase Auth. `authenticate` resuelve el Bearer contra `supabase.auth.getUser`
  y carga el usuario de `app_usuarios`, dejando `req.authCtx` con `userId`, `empresaId` y
  `esSuperadmin` (`server/core/auth.ts:65-104`). Hay caché en memoria de 60 s del contexto y de la
  licencia (`auth.ts:50-57`). `requireModule("cash")` comprueba `app_licencia_activa` (`auth.ts:129-152`).
- **Cadena de middleware del módulo:** una sola línea gobierna todas las rutas —
  `r.use(authenticate, requireModule("cash"), cargarPermisosCaja)` (`server/cash/router.ts:260`)—
  y cada endpoint añade su `exigirPermiso(...)`.
- **Transaccionalidad:** `enTransaccion()` envuelve BEGIN/COMMIT/ROLLBACK
  (`server/cash/repository.ts:47-60`); toda operación que toca el stock bloquea antes la jornada con
  `SELECT * FROM cash_sessions WHERE id = $1 FOR UPDATE` (`repository.ts:259`).
- **Almacenamiento offline:** las apps Flutter usan Hive; **la SPA no tiene ninguno**. No aparecen
  `localStorage`, `indexedDB` ni cola de reintentos en `src/modules/cash/services/api.ts` (búsqueda
  sin resultados). El módulo de caja es online-only.
- **APIs:** REST bajo `/api/cash/*` definidas en `server/cash/router.ts` (1.625 líneas). No hay
  especificación OpenAPI ni contrato publicado. **UNKNOWN**: no se ha inventariado la lista completa
  de endpoints.
- **Integraciones:** `server/integration-hub/` con máquina de estados propia y `MANUAL_REVIEW` como
  cola de revisión (`server/integration-hub/domain/operation.ts:15,30`), independiente del outbox de caja.

## B. Current Functional Map

| Capacidad | Estado | Evidencia | Confianza | Nota |
|---|---|---|---|---|
| Sesión de caja (jornada) | `EXISTS` | `server/cash/schema.ts:121` (`cash_sessions`); estados DRAFT/OPEN/CLOSED/REOPENED | ALTA | Con fecha contable propia, no la del reloj |
| Arqueo | `EXISTS` | `server/cash/schema.ts:346,362` (`cash_counts`, `cash_count_lines`); `domain/arqueo.ts` | ALTA | Teórico vs contado por denominación |
| Denominaciones | `EXISTS` | `server/cash/schema.ts:31` (`cash_denominations`), `valor_centimos INTEGER` (l. 33) | ALTA | Sueltas, bolsas y cartuchos |
| Movimientos de efectivo | `EXISTS` | `server/cash/schema.ts:292` (`cash_denomination_movements`) | ALTA | Libro mayor de piezas; el stock se reconstruye sumándolo (`repository.ts:1-9`) |
| Cierre | `EXISTS` | `docs/mobilink-cash.md` §7 octies; `cash_sessions.cambio_final_centimos` (`schema.ts:144`) | ALTA | Reparte lo contado, no el teórico |
| Ingresos bancarios | `EXISTS` | `server/cash/schema.ts:614,648`; `server/cash/bankdeposits.ts:271-283` | ALTA | Cadena de remanentes con `FOR UPDATE` |
| Tesorería (cambio banco, entregas) | `EXISTS` | `server/cash/schema.ts:513,565`; `server/cash/treasury.ts:430,562,754` | ALTA | Asientos al mover el dinero, no al planificar |
| Multi-tenant (EMPRESA) | `EXISTS` | `empresa_id UUID NOT NULL` en todas las `cash_*` (`schema.ts:59,87,123,173,214,388`); `auth.ts:83` | ALTA | El `empresaId` sale del servidor, nunca del cliente |
| Multi-tenant (TENANT sobre empresa) | `DOES_NOT_EXIST` | `saas_fase1_empresas_licencias.sql:19` — `app_empresas` es el nivel más alto | ALTA | No hay agrupador por encima |
| Multi-tenant (ZONA) | `DOES_NOT_EXIST` | Sin tabla de zonas en `supabase/migrations/` | ALTA | Nivel del modelo target ausente |
| Vínculo CAJA → TALLER | `NEEDS_REFACTOR` | `cash_registers.centro TEXT NOT NULL DEFAULT ''` (`schema.ts:60`) frente a `app_centros` con PK uuid (`saas_fase1:39`) | ALTA | Texto libre; sin FK ni validación (`grep app_centros server/cash/*.ts` → 0) |
| Aislamiento por tenant validado en backend | `EXISTS` | `sesion.empresaId !== ctx.empresaId` en `service.ts:520,874,1024,1409,1498,2166` | ALTA | Comprobación explícita, no solo en cliente |
| RBAC de caja | `EXISTS` | `server/cash/permissions.ts:18-71` (22 permisos), `:85-118` (4 roles) | ALTA | `exigirPermiso` por endpoint (`permissions.ts:175`) |
| RBAC por centro/caja | `DOES_NOT_EXIST` | `rolDeCaja` consulta solo por `user_id` (`permissions.ts:141-144`) | ALTA | `app_usuario_modulos.centro_id` existe (`saas_fase1:70`) y cash lo ignora |
| Auth M2M (servicio↔servicio) | `DOES_NOT_EXIST` | Solo Bearer de usuario (`auth.ts:107-110`); sin OAuth2 ni API keys | ALTA | Bloquea Fase 12 |
| Outbox transaccional | `PARTIAL` | `cash_erp_outbox` (`schema.ts:420`); `encolarEventoErp(client, …)` dentro de la transacción (`service.ts:1619-1638`) | ALTA | Solo 2 emisores y solo hacia ERP. Ver G |
| Idempotencia | `EXISTS` | `idempotency_key TEXT NOT NULL UNIQUE` (`schema.ts:428`) + `ON CONFLICT DO NOTHING` (`service.ts:1636`) | ALTA | La clave es el número de operación |
| Reintentos con backoff | `EXISTS` | `Math.min(30_000 * 2 ** intentos, 3_600_000)` (`erp/worker.ts:27-28`) | ALTA | Techo de 1 h |
| Claim concurrente de la cola | `EXISTS` | `FOR UPDATE SKIP LOCKED` (`erp/worker.ts:68`) | ALTA | Soporta varias instancias |
| DLQ inspeccionable | `PARTIAL` | Estado `ERROR` tras `MAX_INTENTOS` (`worker.ts:150-154`) y `reintentarErrores` (`worker.ts:221`) | MEDIA | Hay estado terminal y relanzamiento; no se ha verificado pantalla propia |
| Versionado optimista | `DOES_NOT_EXIST` | Sin `aggregate_version` en `schema.ts` (búsqueda sin resultados) | ALTA | La concurrencia se resuelve con bloqueo pesimista |
| Auditoría | `PARTIAL` | `app_auditoria` vía `registrarAuditoria` (`core/auditoria.ts:18-42`); 35 llamadas en `server/cash/*` | ALTA | Best-effort y **fuera** de la transacción. Ver K/R2 |
| No borrado de asentado | `EXISTS` | Único `DELETE FROM` del módulo es sobre `cash_settings` (`config.ts:735`) | ALTA | Configuración, no transacciones |
| Adjuntos / evidencias | `EXISTS` | `cash_operation_documents` (`schema.ts:472`); bucket privado con URL firmada (`docs/mobilink-cash.md` §7 quater) | MEDIA | Fichero no leído |
| Notificaciones | `UNKNOWN` | No verificado en el módulo cash | BAJA | Existen sistemas en otros módulos; no auditados |
| Reporting | `PARTIAL` | `server/cash/report.ts` (1.170 líneas), `informeCierre`/`informeIngreso` (`router.ts:719,744`) | MEDIA | Informes por jornada; sin consolidación multi-caja |
| Autonomía offline de MC Local | `DOES_NOT_EXIST` | SPA sin almacenamiento local (ver A) | ALTA | Riesgo CRITICAL. Ver C y K/R1 |
| Consolidación multi-caja | `DOES_NOT_EXIST` | Todas las consultas parten de `registerId`/`sessionId` | ALTA | Es el objeto de MC Central |

## C. Gap Analysis

**[HECHO]** El punto de partida no es el que asumía el roadmap. MC Local **ya existe, está probado y
está en producción**: 32 ficheros en `server/cash/`, 24 tablas `cash_*`, seis migraciones
(`cash_fase1..6.sql`), diez pantallas y una suite con pruebas de dominio y de integración contra
PostgreSQL real (`server/cash/cash.integration.test.ts:15,21`, bajo `RUN_DB_TESTS=1`). La brecha
hacia MC Central, por impacto:

1. **No hay flujo de eventos hacia Central.** El outbox existente es del conector de ERP: se escribe
   en dos sitios (`service.ts:711` y `:1573`) y el segundo requiere además que la operación ya
   estuviera `SYNCED`. Sin ERP configurada no se emite nada, y nunca se emite por apertura, cierre,
   arqueo, tesorería ni ingreso bancario — que es justo lo que Central necesita supervisar. **La
   canalización hay que construirla; el patrón, no.**
2. **Falta la jerarquía intermedia.** El modelo llega a EMPRESA y se queda ahí. `cash_registers.centro`
   es texto libre (`schema.ts:60`) mientras `app_centros` existe con clave uuid (`saas_fase1:39`) y
   nadie los relaciona. Sin eso no hay «red de talleres» que supervisar ni agregación por zona.
3. **El RBAC no distingue centros.** `rolDeCaja` resuelve el rol por usuario y módulo
   (`permissions.ts:141-144`), así que un `cajero` lo es de todas las cajas de su empresa. Para una
   red con varios talleres esto es insuficiente, y `app_usuario_modulos.centro_id` ya está creado
   (`saas_fase1:70`) sin que el módulo lo consulte.
4. **La autonomía offline no se cumple hoy.** El apartado 4 la declara innegociable, y sin embargo
   MC Local es una SPA que muere sin red: el navegador no guarda nada. Hoy no rompe nada —Central no
   existe— pero el modelo target la exige, y añadirla después es mucho más caro. **El repositorio
   contradice el principio: gana el repositorio, y queda como hallazgo (K/R1).**
5. **No hay auth máquina-a-máquina.** MC Local↔MC Central tendría que autenticarse con un token de
   usuario, que es exactamente lo que no debe hacerse en un proceso desatendido.
6. **La auditoría no es inmutable ni transaccional.** `registrarAuditoria` traga sus errores
   (`core/auditoria.ts:41-43`) y escribe con `db`, no con el `client` de la transacción: una
   operación puede quedar asentada sin su línea de auditoría.

## D. Target Architecture — **[PROPUESTA]**

Compatible con el stack existente, sin librerías nuevas y sin tocar el motor de dominio de caja:

- **MC Local** = el módulo `server/cash/` actual, intacto en su semántica. Se le añade **un emisor de
  eventos de dominio** genérico, no acoplado a ERP.
- **`server/cash/events/`** — `cash_event_outbox` con el mismo contrato ya probado del outbox de ERP
  (`idempotency_key UNIQUE`, `estado`, `intentos`, `proximo_intento_ms`) escrito **dentro de la
  transacción** que ya abre `enTransaccion`. Es una generalización de `encolarEventoErp`
  (`service.ts:1619`), no un mecanismo nuevo.
- **`server/central/`** — módulo Express hermano, montado como `mountCash` (`server/cash/index.ts:17`),
  con su propio `initCentral()` idempotente y su router `/api/central/*`. Consume eventos y mantiene
  **read models** (`central_*`), nunca escribe en tablas `cash_*`.
- **Reutilización directa:** `enTransaccion`, `registrarAuditoria`, `authenticate` + `requireModule`,
  el patrón `FOR UPDATE SKIP LOCKED` del worker (`erp/worker.ts:68`) y el lenguaje visual de
  `administracion/components/ui.tsx` que ya reexporta `cash/components/ui.tsx`.
- **Licencia:** módulo `central` añadido al CHECK de `app_licencias`, igual que se hizo con `cash`
  (`cash_fase1.sql:332`).
- **Regla de dirección:** MC Local nunca consulta a Central de forma síncrona para operar. Central es
  un consumidor. Es lo que preserva la autonomía exigida en el apartado 4.

## E. Multi-Tenant Strategy — **[PROPUESTA]**

**[HECHO] de partida:** `app_empresas` → `app_centros` (FK a empresa, `saas_fase1:39-47`), y todas las
`cash_*` con `empresa_id`. El aislamiento se valida en backend con comparación explícita
(`service.ts:520`) y el `empresaId` sale de `app_usuarios`, nunca del cuerpo de la petición
(búsqueda de `body.empresa` / `query.empresa` en `server/cash/*.ts` → 0 resultados). **Esto ya cumple
la invariante «nunca solo en cliente».**

**[PROPUESTA]** Cerrar la jerarquía TENANT → EMPRESA → ZONA → TALLER → CAJA:

- `app_tenants` por encima de `app_empresas`, con `app_empresas.tenant_id`. **[SUPUESTO]** que hace
  falta: si un tenant nunca agrupará dos empresas, `tenant ≡ empresa` y el nivel sobra (ver M/Q1).
- `app_zonas (empresa_id, nombre)` y `app_centros.zona_id` nullable.
- `cash_registers.centro_id UUID REFERENCES app_centros(id)`, conviviendo con `centro TEXT` durante
  la migración.

**Compatibilidad de los datos existentes** — el punto delicado, porque hay cajas en producción:

1. Añadir `centro_id` **nullable**, sin tocar `centro`.
2. Backfill por coincidencia de nombre contra `app_centros` de la misma empresa; lo que no case queda
   a NULL y se resuelve desde Configuración.
3. `NOT NULL` solo cuando no queden nulos. **Nunca antes**: el DDL de arranque es idempotente y se
   ejecuta en cada despliegue (`server/index.ts:17330`), así que un `NOT NULL` prematuro **impide
   arrancar el servidor** — es el mismo fallo que ya ocurrió con un CHECK de motivos
   (`docs/mobilink-cash.md` §7 octies, «un CHECK lo recrea un único bloque de migración»).
4. `UNIQUE (empresa_id, centro, nombre)` (`schema.ts:70`) se sustituye al final, no al principio.

Índices: todo read model de Central lleva `(tenant_id, empresa_id, fecha)` como prefijo, que es el
orden en que se consultará.

## F. Data & Money Model

**[HECHO] — la invariante monetaria se cumple en el módulo de caja.** No hay ni un `float` ni un
`NUMERIC` en el dominio de caja:

| Tipo hallado | Dónde | Riesgo |
|---|---|---|
| `type Centimos = number`, entero validado con `Number.isSafeInteger` y techo de 100 M € | `server/cash/domain/money.ts:18,23,28` | **BAJO** — exacto hasta 2^53 |
| `valor_centimos INTEGER`, `fondo_objetivo_centimos INTEGER` | `server/cash/schema.ts:33,66` | BAJO |
| `fondo_inicial_centimos`, `contado_centimos`, `diferencia_centimos`, `cambio_final_centimos`, `ingreso_bancario_centimos`, `total_centimos` — todos `BIGINT` | `server/cash/schema.ts:136,141,142,144,145,185` | BAJO |
| Comentario normativo: «(BIGINT). Nunca NUMERIC ni DOUBLE» | `supabase/migrations/cash_fase1.sql:18` | BAJO — la regla está escrita en la migración |
| `numeric(12,2)` en las tablas `adm_*` del módulo Administración | `supabase/migrations/administracion_fase1.sql` | **UNKNOWN** — fuera del alcance leído; correcto como tipo, pero sin verificar su aritmética en cliente |

El fichero `money.ts:9-13` justifica la decisión: con enteros las comprobaciones de cuadre son
igualdades exactas y no comparaciones con tolerancia.

**[HECHO] — invariantes de saldo.** El stock teórico **no es una columna**: se reconstruye sumando
`cash_denomination_movements` de la jornada (`repository.ts:1-9`). Lo mismo el remanente de ingresos
bancarios, que es el `remanente_nuevo` del último ingreso confirmado, con la ecuación impuesta por un
`CHECK` de tabla (`docs/mobilink-cash.md` §7 quinquies). **No existe ningún contador acumulado que
pueda desincronizarse**, que es la mejor defensa posible contra el doble conteo.

**[HECHO] — no borrado.** El único `DELETE FROM` del módulo es sobre `cash_settings`
(`config.ts:735`), configuración y no transacciones. Las correcciones son compensatorias: el
descuadre del arqueo se asienta como un ajuste con operación propia y pieza a pieza, y el importe
nunca es cero (`docs/mobilink-cash.md` §7 octies).

**[PROPUESTA] — prevención del doble conteo en Central.** El riesgo aparece al agregar: el mismo
efectivo puede figurar en la caja de origen y en un traspaso en tránsito. Regla: la **posición global
es la suma de posiciones locales cerradas más los tránsitos declarados**, y un tránsito solo existe
si la caja origen ya asentó su salida. El precedente está en el módulo: el dinero que va al banco o
sale con un empleado **ya sale del stock teórico en el momento del asiento**, no cuando se planifica
(`docs/mobilink-cash.md` §7 ter). Central debe respetar exactamente ese criterio, o contará dos veces.

## G. Synchronization Protocol

**[HECHO] — el patrón target ya está construido, para ERP.**

- Outbox transaccional: `encolarEventoErp(client, …)` recibe el `PoolClient` de la transacción en
  curso (`service.ts:1619-1638`), así que el evento y el movimiento de dinero se confirman juntos o
  no se confirma ninguno.
- Idempotencia: `idempotency_key TEXT NOT NULL UNIQUE` (`schema.ts:428`) más `ON CONFLICT
  (idempotency_key) DO NOTHING` (`service.ts:1636`). La clave es el número de operación.
- Reintentos: `proximoIntentoMs = min(30_000 · 2^intentos, 3_600_000)` (`erp/worker.ts:27-28`), con
  `MAX_INTENTOS` y estado terminal `ERROR` (`worker.ts:150-154`).
- Concurrencia: `FOR UPDATE SKIP LOCKED` sobre la tanda (`worker.ts:68`) — soporta varias instancias
  de Render sin procesar dos veces la misma fila.
- Estados: `PENDING | SYNCING | SYNCED | ERROR | RETRY_PENDING | CANCELLED` (`schema.ts:431`).
- Relanzamiento manual: `reintentarErrores` devuelve a `RETRY_PENDING` con `intentos = 0`
  (`worker.ts:221`).

**[HECHO] — lo que falta.** Dos limitaciones, ambas de acoplamiento y no de diseño:

1. **Cobertura:** solo dos emisores (`service.ts:711`, `:1573`), y el segundo exige
   `erpSyncStatus === "SYNCED"`. Apertura, cierre, arqueo, tesorería, ingresos y ajustes no emiten nada.
2. **Condicionalidad:** el evento se encola dentro de un `if` que depende de que haya conector
   configurado (`service.ts:655,1571-1572`). Sin ERP, silencio absoluto.

**[HECHO] — no hay versionado optimista.** No existe `aggregate_version` en el esquema. La corrección
concurrente se logra con bloqueo pesimista de la jornada (`repository.ts:259`), decisión justificada
en el fichero: una caja física es un recurso único y la contención es irrelevante
(`repository.ts:17-21`).

**[PROPUESTA]**

- `cash_event_outbox` con la misma forma que `cash_erp_outbox`, emitido **siempre** y sin `if` de
  conector. `event_id` UUID como clave de deduplicación en destino; `Idempotency-Key` en la cabecera HTTP.
- Payload: `{ event_id, tenant_id, empresa_id, register_id, session_id, tipo, ocurrido_en_ms, actor, datos }`.
  `ocurrido_en_ms` es cuándo pasó, distinto de cuándo se envía — la misma distinción que el módulo ya
  hace entre `created_at_ms` y la fecha contable de la jornada (`docs/mobilink-cash.md` §7 sexies).
- **Versionado:** `aggregate_id = session_id` + `aggregate_version` incremental por jornada,
  asignado dentro del mismo bloqueo `FOR UPDATE` que ya existe, sin coste adicional de concurrencia.
- **Conflictos por tipo:** los eventos de caja son **hechos consumados**, no propuestas. Un cobro
  ocurrido no se rechaza: se acepta y, si contradice el estado de Central, se marca `SYNC_CONFLICT`
  para revisión humana. Solo las **políticas** viajan en sentido Central→Local, y ahí sí manda Central.
- **DLQ:** estado terminal `ERROR` ya existente, más una pantalla de inspección — el Integration Hub
  ya tiene el precedente con `MANUAL_REVIEW` (`integration-hub/domain/operation.ts:15,30`).

## H. Security & RBAC

**[HECHO]**

- Cuatro roles de caja —`consulta`, `cajero`, `responsable`, `admin`— traducidos a 22 permisos finos
  (`server/cash/permissions.ts:18-71`, `:74`, `:85-118`). No hay tabla de permisos paralela: el rol
  sale de `app_usuario_modulos` (`permissions.ts:141-144`).
- La separación `cash.configure` / `cash.denominations.configure` es deliberada y está justificada en
  el código: el catálogo de denominaciones no tiene columna de empresa, así que desactivar una moneda
  se la desactivaría a todas (`permissions.ts:34-48`).
- Aplicación por endpoint con `exigirPermiso` (`permissions.ts:175-183`), sobre una cadena común
  (`router.ts:260`).
- Auditoría en `app_auditoria` con empresa, usuario, acción, entidad, detalle e IP
  (`core/auditoria.ts:18-42`); 35 puntos de llamada en `server/cash/*`.

**[HECHO] — debilidades verificadas**

- **Superadmin salta la licencia** (`auth.ts:144`) y es `admin` de caja sin fila
  (`permissions.ts:132`). Es coherente y está documentado, pero concentra poder sin segunda firma.
- **Caché de 60 s** del contexto y del rol (`auth.ts:52`, `permissions.ts:126`): revocar un permiso
  tarda hasta un minuto en surtir efecto.
- **`DEFAULT_EMPRESA_ID`**: un usuario que solo exista en `tc_usuarios` recibe la empresa por defecto
  (`auth.ts:88-104`). Es un puente declarado de la fase 1 de unificación, pero significa que la
  pertenencia a tenant de esos usuarios es una constante de entorno, no un dato.
- **`AUTH_MODE` dual por defecto** (`auth.ts:44-47`) y `protectWhenStrict` (`auth.ts:161-172`): hay
  rutas que solo se protegen en `strict`. **No afecta a `/api/cash/*`**, que exige token siempre
  (`router.ts:260`), pero sí al perímetro del proceso que alojaría a Central.
- **Auditoría best-effort y fuera de transacción** (`core/auditoria.ts:41-43`, usa `db` y no el
  `client`): puede perderse la traza de una operación que sí se asienta.

**[PROPUESTA]** Scopes por centro (`app_usuario_modulos.centro_id`, ya existente); rol nuevo
`supervisor` de solo lectura sobre varias cajas; auth M2M por `client_credentials` con secreto en el
gestor que el Integration Hub ya prevé (`integration-hub/infrastructure/schema.ts:29`); y auditoría
dentro de la transacción para lo que Fase 10 declare inmutable.

## I. Integration Hub & Services — **[PROPUESTA]**

**[HECHO]** Existe `server/integration-hub/` con dominio, repositorios, esquema, gestor de secretos y
worker, con máquina de estados y `MANUAL_REVIEW` (`integration-hub/domain/operation.ts:15,30`;
`api/router.ts:584-589`). El módulo de caja **no lo usa**: tiene su propio registro de conectores
(`server/cash/erp/registry.ts`) y su propio worker. **[SUPUESTO]** que la duplicación fue deliberada;
no se ha encontrado justificación escrita.

API canónica propuesta: `POST /api/central/events` (ingesta, `Idempotency-Key` obligatoria),
`GET /api/central/network` (posición global), `GET /api/central/sessions`, `POST /api/central/policies`.
Webhooks de salida reutilizando el patrón de outbox. Document Service: el módulo ya sube justificantes
a un **bucket privado con URL firmada de 15 minutos** (`docs/mobilink-cash.md` §7 quater), que es el
comportamiento correcto y debe extenderse, no rehacerse — falta el SHA-256 y el versionado que pide la
Fase 9. Notification Hub: **UNKNOWN**, no auditado.

## J. Resilience, Backup & DR — **[PROPUESTA]**

**[HECHO]** Despliegue en Render como Web Service Node (`README.md`, `render.yaml`), con
`server/backup-postgres.ts` y `server/restore-postgres.ts` en el repositorio y `scripts/backup.cjs`
en `package.json`. El contenedor es efímero, y el módulo ya lo tiene en cuenta: las imágenes van a
Supabase Storage precisamente porque el disco se pierde en el siguiente despliegue
(`docs/mobilink-cash.md` §7 bis). **UNKNOWN**: periodicidad real de las copias y si se ha probado
alguna restauración.

**[PROPUESTA]** RPO ≤ 5 min y RTO ≤ 1 h para Central; para MC Local, RPO 0 en lo asentado, porque la
verdad está en el libro mayor local y Central es derivable. Tras una caída larga, el re-sync debe ir
**limitado por tandas** —el worker ya procesa tandas pequeñas (`erp/worker.ts:6`)— para que mil
eventos acumulados no tumben la ingesta al volver la red.

## K. Risk Matrix

| ID | Riesgo | Categoría | Severidad | Probabilidad | Evidencia | Mitigación | Fase |
|---|---|---|---|---|---|---|---|
| R1 | MC Local no sobrevive sin red: la SPA no tiene almacenamiento offline, y el apartado 4 lo exige | técnico | **CRITICAL** | Alta | Sin `localStorage`/`indexedDB`/cola en `src/modules/cash/services/api.ts` | Decidir pronto si MC Local pasa a app (Flutter, como las otras ocho) o si se acepta online-only y se documenta la excepción | Q2 / Fase 3 |
| R2 | Una operación puede asentarse sin su línea de auditoría | financiero | **CRITICAL** | Media | `core/auditoria.ts:41-43` traga el error y usa `db`, no el `client` de la transacción | Auditar dentro de la transacción para las acciones que Fase 10 declare inmutables | Fase 10 |
| R3 | Doble conteo al agregar posición global si Central suma tránsitos ya descontados en origen | financiero | **CRITICAL** | Media | `cash_change_orders` / `cash_advances` asientan al mover (`schema.ts:513,565`) | Posición global = locales cerradas + tránsitos declarados, con el asiento de origen como única fuente | Fase 4 |
| R4 | No hay canal de eventos: sin ERP configurada el outbox no emite nada | técnico | **HIGH** | Alta | `service.ts:655,711,1571-1573` — encolado bajo `if (conector)` | `cash_event_outbox` independiente del conector | Fase 2 |
| R5 | `cash_registers.centro` es texto libre: agregar por taller hoy es agrupar cadenas | migración | **HIGH** | Alta | `schema.ts:60` frente a `app_centros` (`saas_fase1:39`); 0 referencias a `app_centros` en `server/cash/*.ts` | `centro_id` nullable → backfill → `NOT NULL`, en ese orden | Fase 1 |
| R6 | `NOT NULL` o CHECK prematuro en el DDL de arranque impide arrancar el servidor | operativo | **HIGH** | Media | DDL idempotente en cada despliegue (`server/index.ts:17330`); precedente real con `BAG_OPENED` (`docs/mobilink-cash.md` §7 octies) | Columnas nuevas siempre nullable; endurecer en una migración posterior verificada | Fase 1 |
| R7 | Migraciones aplicadas a mano, sin registro de cuáles se aplicaron: deriva repo↔producción | operativo | **HIGH** | Alta | 182 ficheros en `supabase/migrations/`; sin tabla de control verificada | Inventariar el esquema real antes de la Fase 1 (Q7) | Fase 1 |
| R8 | Sin auth M2M: MC Local↔Central tendría que usar un token de usuario | técnico | **HIGH** | Alta | `auth.ts:107-110`; sin OAuth2 ni API keys en el repo | `client_credentials` con el gestor de secretos ya previsto | Fase 12 |
| R9 | Rol de caja sin ámbito de centro: un cajero lo es de todas las cajas de su empresa | operativo | MEDIUM | Alta | `permissions.ts:141-144`; `centro_id` sin usar (`saas_fase1:70`) | Ámbito por centro en el rol | Fase 1 |
| R10 | Revocar permisos tarda hasta 60 s por las cachés en memoria | operativo | MEDIUM | Media | `auth.ts:52`, `permissions.ts:126` | Invalidación explícita al cambiar rol o licencia | Fase 10 |
| R11 | Superadmin salta licencia y es admin de caja sin fila | operativo | MEDIUM | Media | `auth.ts:144`, `permissions.ts:132` | Segunda firma (SoD) para acciones sensibles | Fase 10 |
| R12 | `DEFAULT_EMPRESA_ID`: la pertenencia a tenant de usuarios no unificados es una variable de entorno | migración | MEDIUM | Media | `auth.ts:38-40,88-104` | Cerrar la unificación antes de multi-tenant real | Fase 1 |
| R13 | Dos mecanismos de integración conviviendo (Integration Hub y `cash/erp`) | técnico | LOW | Alta | `server/integration-hub/**` frente a `server/cash/erp/registry.ts` | Decidir cuál es canónico antes de añadir un tercero | Fase 12 |

## L. Roadmap Review

Ajustes justificados por hallazgos concretos de esta auditoría:

- **Fase 1** — El trabajo no es «implementar multi-tenant»: `empresa_id` está en todas las tablas
  `cash_*` y validado en backend (`service.ts:520`). Lo real es **ZONA + vínculo CAJA→TALLER**
  (R5) y el ámbito por centro del RBAC (R9), más el inventario del esquema de producción (R7).
- **Fase 2** — No se parte de cero: idempotencia, backoff y `SKIP LOCKED` están escritos y probados
  (`erp/worker.ts:27-28,68`). El trabajo es **desacoplar el outbox de la ERP** (R4) y añadir
  `aggregate_version`, hoy inexistente.
- **Fase 3** — Cambia de naturaleza. El roadmap asumía construir MC Local; MC Local existe. El MVP de
  Central es **consumir y consolidar**, y es la fase donde debe decidirse R1.
- **Fase 4** — Añadir explícitamente la regla anti-doble-conteo de los tránsitos (R3), que el módulo
  ya modela y que un agregador ingenuo contaría dos veces.
- **Fase 6** — Reducible. Denominaciones, arqueos y gestión de cambio están entregados, incluidos
  cartuchos, bolsas y la propuesta de pedido al banco sin modelo de lenguaje
  (`domain/restock.ts`, `domain/cartridges.ts`). Queda la vista consolidada.
- **Fase 9** — Parte hecha: bucket privado y URL firmada de 15 min ya existen. Falta SHA-256 y versionado.
- **Fase 10** — Debe incluir R2 (auditoría transaccional), R10 y R11.
- **Fase 11** — `INITIAL_BALANCE` es **menos urgente de lo previsto**: el módulo ya sabe abrir jornadas
  con fecha pasada y hereda el fondo del día anterior acotando por fecha
  (`docs/mobilink-cash.md` §7 sexies). El arranque en frío ya está resuelto.
- **Fase 12** — Presupuestar auth M2M completa (R8) y decidir antes qué mecanismo de integración es
  canónico (R13).

## M. Blocking Questions

| ID | Pregunta | Por qué bloquea la Fase 1 | Opciones | Recomendación por defecto |
|---|---|---|---|---|
| Q1 | ¿Hace falta un TENANT por encima de `app_empresas`? | Determina si la Fase 1 añade una tabla y una columna a todas las `cash_*`, o ninguna | (a) `tenant ≡ empresa`; (b) `app_tenants` nuevo | **(a)**: `app_empresas` ya es el nivel de aislamiento y funciona. Añadir un nivel sin dueño real es coste sin beneficio |
| Q2 | ¿MC Local sigue siendo la SPA web u obtiene app propia con outbox local? | Decide si la autonomía offline del apartado 4 se cumple o se declara excepción | (a) SPA online-only; (b) app Flutter como las otras ocho | **(a) por ahora**, documentando la excepción: una caja de mostrador tiene red cableada. Reabrir si aparece un punto sin conectividad |
| Q3 | ¿`cash_registers.centro` migra a FK contra `app_centros`? | Sin esto no hay agregación por taller ni zona | (a) FK con backfill por nombre; (b) seguir con texto | **(a)**, con la secuencia nullable→backfill→NOT NULL de E |
| Q4 | ¿El rol de caja pasa a tener ámbito de centro? | Cambia el contrato de `rolDeCaja` y toda la cadena de permisos | (a) ámbito por centro; (b) seguir por empresa | **(a)**: `centro_id` ya existe en `app_usuario_modulos` sin usarse |
| Q5 | ¿Outbox nuevo para eventos o se generaliza `cash_erp_outbox`? | Es el contrato del que dependen las fases 2–5 | (a) tabla nueva `cash_event_outbox`; (b) generalizar la existente | **(a)**: la existente tiene `connector_key` y `operation_id` con FK; mezclar dominios en una cola en producción es riesgo innecesario |
| Q6 | ¿Central va en el mismo proceso Express o en servicio aparte? | Condiciona despliegue, `render.yaml` y el perímetro de auth | (a) mismo proceso, módulo hermano; (b) servicio separado | **(a)**: es el patrón de todos los módulos y evita necesitar auth M2M en Fase 3 |
| Q7 | ¿Se inventaría el esquema real de producción antes de migrar? | Las migraciones se aplican a mano; puede haber deriva | (a) sí, volcado previo; (b) confiar en el repositorio | **(a)**: media hora de trabajo frente a una migración que falla en el arranque (R6) |
| Q8 | ¿`AUTH_MODE` pasa a `strict` antes de exponer Central? | Central hereda el perímetro del proceso que la aloja | (a) `strict` antes; (b) seguir en `dual` | **(a)** si Central va en el mismo proceso (Q6-a); es la consecuencia directa de esa elección |

## N. Supuestos y lagunas

**[SUPUESTO]**

- S1 — Que hace falta un nivel TENANT por encima de empresa. No hay nada en el repositorio que lo
  pida; viene del enunciado. Resolver con Q1.
- S2 — Que la duplicación entre `server/integration-hub/` y `server/cash/erp/` fue deliberada. No se
  ha encontrado justificación escrita. Resolver leyendo el histórico o preguntando.
- S3 — Que las tablas `adm_*` con `numeric(12,2)` no participarán en MC Central. Si participan, hay
  que auditar su aritmética en cliente antes.
- S4 — Que el bucket privado y la firma de 15 minutos funcionan como documenta `docs/mobilink-cash.md`;
  verificado en documentación, no leído en `server/cash/storage.ts`.

**UNKNOWN** (qué haría falta para resolverlo)

- Esquema real de la base de producción — un volcado de `information_schema`; el repositorio no puede
  responderlo porque las migraciones se aplican a mano (R7).
- Lista completa de endpoints `/api/cash/*` — leer `server/cash/router.ts` entero (1.625 líneas).
- Notification Hub y estado de las notificaciones — no auditado en esta fase.
- Si existe pantalla de inspección del outbox en error — `reintentarErrores` existe
  (`erp/worker.ts:221`); no se ha buscado su interfaz.
- Periodicidad real de copias de seguridad y si se ha probado una restauración.
- Comportamiento de `server/cash/report.ts`, `documents.ts`, `storage.ts` y de las 10 pantallas del
  módulo: no leídos.
- Motor de dominio salvo `money.ts`: la corrección de `change.ts`, `arqueo.ts`, `cartridges.ts`,
  `restock.ts` y `depositswap.ts` se ha tomado de `docs/mobilink-cash.md` y de la existencia de sus
  ficheros de prueba, **no de leer el código**.

**Caveat de alcance:** no se ejecutó `git pull` (Regla Cero prohíbe mutar el árbol). `HEAD` coincidía
con `origin/main` en el momento de la auditoría, pero `main` se mueve a menudo.
