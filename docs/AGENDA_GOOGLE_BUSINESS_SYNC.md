# Agenda → Google Business Profile: arquitectura de sincronización automática de horarios

> **Estado del documento:** diseño de arquitectura (no implementado todavía).
> **Ámbito:** Mobilink como *fuente única de verdad* del horario del negocio, con propagación
> automática y desatendida a Google Business Profile (GBP).
> **Audiencia:** quien vaya a implementarlo. Cada decisión lleva su justificación y su alternativa
> descartada.

---

## 0. Contexto: de dónde partimos en Mobilink

Antes de diseñar nada conviene fijar qué existe ya en este repositorio, porque el diseño no parte de cero.

**Lo que ya hay:**

| Pieza | Dónde | Qué aporta al problema |
|---|---|---|
| Configuración de agenda | `src/modules/agendaConfig.ts` | Horario semanal L–S con turno de mañana y tarde (partido), `holidays[]`, `specialDays[]`, cierre de sábados de agosto |
| API de agenda | `server/index.ts` (`/api/agenda-config`, `PUT`, `festivos-ia`) | Persistencia como JSON en `workshop_config` bajo la clave `agenda_config` |
| Búsqueda IA de festivos | `POST /api/agenda-config/festivos-ia` | Propone festivos nacionales/autonómicos/locales por ciudad y año, con `confidence` |
| Integration Hub | `server/integration-hub/**` | Capas DDD ya establecidas (`domain` / `application` / `infrastructure` / `connectors` / `workers`), registro de conectores, `integration_operations` + `integration_operation_logs`, worker de reintentos con Postgres como cola |
| Multi-tenant | `server/core/admin.ts`, `app_empresas`, `app_centros`, `app_licencias` | Empresas, centros de trabajo, licencias por módulo, SuperAdmin |
| Secretos | `server/integration-hub/infrastructure/secrets.ts` | `SecretsProvider` inyectable (env hoy, vault mañana) |

**Las cinco carencias que este diseño resuelve:**

1. **El horario vive como un blob JSON** en `workshop_config`, sin identidad por centro ni historial.
   No se puede auditar "quién cerró el 15 de agosto y cuándo".
2. **El modelo sólo admite dos turnos** (`morningStart/End`, `afternoonStart/End`). Es suficiente hoy,
   pero no expresa tres tramos ni un horario que cruza medianoche.
3. **No existen vacaciones, cierres excepcionales, aperturas extraordinarias ni cambios temporales**
   como conceptos de primera clase. Todo se fuerza a `specialDays` día a día, a mano.
4. **No hay ninguna integración con Google.** El horario se mantiene dos veces: en Mobilink y en GBP.
5. **`closedSaturdaysInAugust` es una regla de negocio incrustada en un booleano.** Es el síntoma de
   que faltaba un motor de reglas de calendario.

**Decisión de encaje:** esto se construye como un módulo nuevo del Integration Hub
(`connectors/marketing/google-business-profile/`) más un dominio propio de calendario
(`server/scheduling/`), y la `agendaConfig` actual se migra a él. El Hub ya impone el invariante que
nos interesa: *ningún módulo operativo habla directamente con un sistema externo*. La agenda no llamará
nunca a Google; publicará un evento de dominio y el Hub se encargará.

### 0.1 Nota sobre el stack pedido (Prisma / BullMQ / Redis)

El encargo pide los ejemplos de código con **Express + PostgreSQL + Prisma + BullMQ + Redis**, y así están
escritos en la §13. Conviene que sepas, antes de copiarlos, que **Mobilink hoy no usa ni Prisma, ni BullMQ, ni
Redis**: usa `pg` con SQL en crudo, esquemas idempotentes (`CREATE TABLE IF NOT EXISTS` en `schema.ts`) y
**Postgres como cola de trabajo** con claim atómico (`UPDATE ... WHERE status='RETRY_PENDING' RETURNING`),
tal y como está resuelto en `server/integration-hub/workers/IntegrationWorker.ts`.

No es un problema, pero es una bifurcación que hay que decidir a conciencia:

| Opción | Cuándo elegirla | Coste |
|---|---|---|
| **A. Seguir el stack actual** (pg + cola en Postgres) | Hasta ~1.000 negocios. Cero infraestructura nueva, cero coste de Redis, transaccionalidad perfecta con el *outbox* (§4.3) | Menos herramientas de serie: hay que escribir el backoff, el DLQ y el panel a mano (~400 líneas, ya casi escritas en el Hub) |
| **B. Adoptar BullMQ + Redis** (lo que pide el prompt) | A partir de miles de localizaciones, o cuando quieras *rate limiting* por grupo, *repeatable jobs*, deduplicación por `jobId` y Bull Board gratis | Un servicio más que operar y pagar; la escritura en BD y el encolado dejan de ser atómicos → el *outbox* pasa de recomendable a **obligatorio** |
| **C. Prisma** | Si vas a modelar 12 tablas nuevas relacionadas, el tipado y las migraciones versionadas compensan | Convivencia con `pg` en el mismo proceso; dos estilos de acceso a datos en el repo |

**Recomendación:** empezar por **A** con la arquitectura de **B** (mismos puertos, mismos casos de uso,
misma máquina de estados), de modo que cambiar de cola sea sustituir una implementación de
`SyncQueuePort`. La §13 da el código en BullMQ y la §13.7 el adaptador equivalente sobre Postgres para
que la migración sea un cambio de una línea en el contenedor de dependencias. Prisma sí lo adoptaría desde
el día uno **sólo para este módulo** (esquema aislado, sin tocar las tablas existentes).

---

## 1. Arquitectura

### 1.1 Principio rector: reconciliación declarativa, no propagación de eventos

Esta es **la** decisión estructural del diseño, y de ella dependen casi todas las demás.

El enfoque ingenuo es imperativo: *"el usuario añadió un festivo → llama a Google y añade ese festivo"*.
Se rompe enseguida:

- Si la llamada falla y el usuario ya hizo otros tres cambios, ¿en qué orden se reintenta?
- Si alguien edita en Google, el estado local y el remoto divergen y nadie se entera.
- Google exige reenviar **el array completo** de `specialHours` en cada `PATCH`: no existe "añade un día".
- Los días especiales caducan: el 2 de enero, las vacaciones del agosto anterior son basura que hay que retirar.

El enfoque correcto es **declarativo**, el mismo modelo mental que Kubernetes o Terraform:

```
estado deseado  = compilar(reglas de calendario del centro, ventana temporal)
estado observado = leer(Google)
si hash(deseado) ≠ hash(observado)  →  PATCH con el estado deseado completo
```

Consecuencias, todas buenas:

- **Idempotencia gratis.** Reintentar es seguro por construcción: se recalcula y se reenvía lo mismo.
- **Auto-reparación.** Si alguien tocó Google a mano, la siguiente reconciliación lo corrige (o lo detecta
  como conflicto, §9).
- **Coalescencia.** Diez ediciones seguidas del usuario producen **una** llamada a Google, no diez.
- **Caducidad resuelta.** El *job* nocturno recompila la ventana móvil y los días pasados desaparecen solos.
- **Simulacro fácil.** `validateOnly=true` sobre el estado deseado da un *dry-run* antes de tocar producción.

El precio: hay que escribir un **compilador de calendario** puro y bien probado. Es la pieza de mayor valor
del sistema y la única que exige tests exhaustivos (§13.3).

### 1.2 Diagrama de arquitectura

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                  FRONTEND                                        │
│                     React 18 + Vite + Tailwind (Mobilink)                        │
│                                                                                  │
│  AgendaConfigModal ▸ pestañas:                                                   │
│    Horario semanal │ Festivos │ Vacaciones │ Cierres │ Aperturas │ Estado Google  │
│                                                                                  │
│  · Vista previa del calendario efectivo (llama a /preview, no adivina)           │
│  · Badge de estado de sincronización en vivo (SSE/polling)                       │
│  · Resolución de conflictos (diff app ↔ Google lado a lado)                      │
└────────────────────────────────────┬─────────────────────────────────────────────┘
                                     │ HTTPS / JSON
┌────────────────────────────────────▼─────────────────────────────────────────────┐
│                          API — Express 5 (Node 22, TS)                           │
│                                                                                  │
│  interfaces/http ──▶ application (casos de uso) ──▶ domain (puro, sin I/O)        │
│         │                      │                                                 │
│         │                      ├── ScheduleCompiler   ◀── el corazón             │
│         │                      └── ConflictDetector                              │
│         │                                                                        │
│  Auth: sesión Mobilink + requireSupervisorRole + tenant scoping                   │
└─────────┬──────────────────────────────────────┬─────────────────────────────────┘
          │ escribe (una transacción)            │ lee
          ▼                                      ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        PostgreSQL 16  (fuente única de verdad)                    │
│                                                                                   │
│  business_locations · weekly_schedules · schedule_periods · calendar_rules        │
│  holiday_catalog · location_holiday_policies · google_accounts · google_locations │
│  sync_runs · sync_events(log) · sync_conflicts · outbox                           │
│                                                                                   │
│  ▸ La MISMA transacción escribe el cambio de negocio y la fila de `outbox`.        │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                        │ Outbox Relay (polling 1 s, FOR UPDATE SKIP LOCKED)
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                    COLA DE TRABAJOS — BullMQ sobre Redis 7                        │
│                                                                                   │
│   sync.location     jobId = "sync:loc:{locationId}"  ← deduplicado + debounce 30 s │
│   sync.reconcile    repeatable, cron nocturno escalonado por tenant               │
│   holidays.import   repeatable, anual (octubre) + bajo demanda                     │
│   google.pull       repeatable / disparado por Pub/Sub GOOGLE_UPDATE               │
│   sync.dlq          cola muerta: intervención humana                               │
│                                                                                   │
│   Backoff exponencial + jitter · rate limiter por cuenta de Google                 │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│              SYNC WORKER (proceso separado, escalable horizontalmente)             │
│                                                                                   │
│   1. Carga reglas del centro          5. PATCH regularHours / specialHours         │
│   2. Compila calendario efectivo      6. Verifica (re-GET) y guarda snapshot       │
│   3. Proyecta a payload de Google     7. Registra sync_run + sync_events           │
│   4. Compara hash vs snapshot         8. Si falla → clasifica error → reintento    │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                        │ OAuth 2.0 Bearer (token refrescado en caliente)
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE BUSINESS PROFILE APIs                               │
│                                                                                   │
│   mybusinessaccountmanagement.googleapis.com/v1   → accounts                      │
│   mybusinessbusinessinformation.googleapis.com/v1 → locations, patch, getGoogleUpdated │
│   mybusinessnotifications.googleapis.com/v1       → Pub/Sub (GOOGLE_UPDATE)        │
│   oauth2.googleapis.com/token                     → refresh de tokens              │
└───────────────────────────────────────────────────────────────────────────────────┘
                                        ▲
                                        │ Pub/Sub push → /webhooks/google/notifications
                                        │
┌───────────────────────────────────────┴───────────────────────────────────────────┐
│  OBSERVABILIDAD: pino (JSON, correlationId) · métricas Prometheus · alertas        │
│  Panel /admin/sync: colas, últimos runs, conflictos abiertos, tokens por caducar   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Componentes, uno a uno

**Frontend (React + Vite, ya existente).**
Aporta dos cosas que no son obvias:
- **Vista previa del calendario efectivo.** El usuario define reglas que se solapan (un festivo que cae en
  vacaciones, dentro de un cambio temporal). Si el frontend intenta reproducir la precedencia por su cuenta,
  acabará mintiendo. Llama a `POST /schedule/preview`, que ejecuta **el mismo compilador** que el worker.
  Una sola implementación de la verdad.
- **Estado de sincronización visible.** La sincronización es asíncrona; si el usuario guarda y no ve nada,
  asume que falló. Badge con `PENDING / SYNCING / SYNCED / CONFLICT / FAILED` y la hora del último éxito.

**Backend API (Express 5).** Fino a propósito: valida, autoriza, escribe en BD, emite el evento. **Nunca**
llama a Google en el ciclo de petición. Razón: la API de Google puede tardar segundos, fallar o estar sin
cuota; el usuario no debe esperar ni ver un error de Google al guardar su horario.

**Base de datos (PostgreSQL).** Fuente única de verdad *y* almacén de la cola en la variante A. Se apoya en
tres cosas de Postgres que resuelven problemas reales aquí: `jsonb` para los *snapshots* de Google,
`daterange` + índices GiST para detectar solapes de reglas, y `FOR UPDATE SKIP LOCKED` para el *outbox*.

**Servicio de sincronización (worker).** Proceso aparte del API. Motivo: el aislamiento de fallos. Un
worker que se atasca reintentando contra Google no puede degradar la agenda que usan los mostradores.
En Render son dos servicios; en local, un flag `RUN_WORKER_INLINE=1` los une para no complicar el desarrollo.

**Cola de trabajos.** Sí, es recomendable, y por cuatro razones concretas — no por moda:
1. *Debounce/coalescencia*: `jobId` estable + `delay` convierte 10 ediciones en 1 llamada.
2. *Reintentos con backoff* sin bloquear al usuario.
3. *Rate limiting* respetando la cuota de Google (300 QPM por proyecto, §11).
4. *Trabajos programados*: reconciliación nocturna e importación anual de festivos.

**Sistema de logs.** Tres niveles distintos, no uno:
- `sync_runs`: una fila por intento de sincronización (estado, duración, hashes, error).
- `sync_events`: traza fina dentro de un run (compilado, comparado, PATCH enviado, respuesta).
- Log de aplicación (pino, JSON) con `correlationId` propagado extremo a extremo — la misma convención que
  ya usa el Integration Hub.
Y por encima, `sync_conflicts` como bandeja de entrada humana.

**Reintentos.** Clasificados por tipo de error, nunca "reintentar todo 3 veces" (§4.5).

---

## 2. Modelo de datos

### 2.1 Diagrama de relaciones

```
app_empresas (existente)
     │ 1:N
     ▼
app_centros (existente) ──1:1── business_locations ──1:1── weekly_schedules
                                      │                          │ 1:N
                                      │                          ▼
                                      │                    schedule_periods
                                      │                  (turnos partidos: N por día)
                                      │ 1:N
                                      ├──────▶ calendar_rules ──1:N──▶ calendar_rule_periods
                                      │        (festivo, vacaciones, cierre,
                                      │         apertura extra, cambio temporal)
                                      │ 1:N
                                      ├──────▶ location_holiday_policies ──N:1──▶ holiday_catalog
                                      │ 1:N                                        (maestro compartido)
                                      ├──────▶ google_locations ──N:1──▶ google_accounts
                                      │                │ 1:N
                                      │                ├──▶ google_location_snapshots
                                      │                ├──▶ sync_runs ──1:N──▶ sync_events
                                      │                └──▶ sync_conflicts
                                      │
                                      └──────▶ outbox (eventos de dominio pendientes)
```

### 2.2 Decisiones de modelado que merecen defensa

**(a) `schedule_periods` como filas, no columnas `morning*`/`afternoon*`.**
El modelo actual (`agendaConfig.ts`) fija dos turnos en columnas. Un modelo de filas
(`day_of_week, start_minute, end_minute`) admite 1, 2, 3 o N tramos sin migración, y mapea **uno a uno** con
el `TimePeriod` de Google. Menos código de traducción, menos bugs. Alternativa descartada: guardar
`jsonb` con los tramos — pierde la validación de solapes en BD y no se puede consultar.

**(b) Minutos desde medianoche (`SMALLINT`) en vez de `TIME`.**
`08:30` → `510`. Motivos: aritmética trivial para detectar solapes, y permite `1500` (25:00) para expresar
un cierre después de medianoche sin ambigüedad. Se formatea a `HH:MM` sólo en los bordes.

**(c) Una tabla `calendar_rules` polimórfica en vez de `holidays` + `vacations` + `closures` + …**
Es la decisión más discutible, así que la argumento. Las cinco entidades del encargo (festivo, vacaciones,
cierre excepcional, apertura extraordinaria, cambio temporal) comparten **exactamente** la misma forma:
un rango de fechas, un efecto sobre el horario (cerrado / horario propio), una prioridad y unos metadatos.
El compilador las consume de forma uniforme. Con tablas separadas, cada compilación sería un `UNION` de cinco
consultas y añadir un sexto tipo tocaría el compilador. Con una sola tabla + `rule_type` + `priority`, añadir
"cierre por obras" es insertar una fila de catálogo.
*Contrapartida honesta:* se pierde la posibilidad de poner constraints `NOT NULL` específicas por tipo. Se
compensa con un `CHECK` por tipo y validación en el dominio (`CalendarRule.create()`).
`holiday_catalog` **sí** va aparte: es dato maestro compartido entre tenants, con otro ciclo de vida.

**(d) Snapshot del estado de Google (`google_location_snapshots`).**
Sin él no hay detección de conflictos ni no-ops: no sabrías si el estado remoto cambió por tu mano o por otra.
Guarda el `jsonb` devuelto por Google y su hash.

**(e) Tabla `outbox`.**
Con BullMQ, `db.commit()` y `queue.add()` no son atómicos: si el proceso muere entre ambos, el cambio se
guarda y **nunca se sincroniza** — el peor fallo posible, silencioso. La fila de outbox se escribe en la
misma transacción y un *relay* la publica después. Con la variante A (cola en Postgres) el outbox *es* la
cola y el problema no existe.

### 2.3 DDL (PostgreSQL)

Sigue la convención del repo: idempotente, apto para `server/scheduling/infrastructure/schema.ts`.

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LOCALIZACIONES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      INTEGER NOT NULL REFERENCES app_empresas(id) ON DELETE CASCADE,
  centro_id       INTEGER REFERENCES app_centros(id) ON DELETE SET NULL,
  nombre          TEXT    NOT NULL,
  timezone        TEXT    NOT NULL DEFAULT 'Europe/Madrid',   -- IANA, imprescindible
  pais            CHAR(2) NOT NULL DEFAULT 'ES',
  ccaa_code       TEXT,             -- 'CT', 'MD', 'AN'…  para festivos autonómicos
  provincia_code  TEXT,             -- '43'
  municipio_ine   TEXT,             -- '43148' (código INE) para los 2 festivos locales
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bl_empresa ON business_locations(empresa_id) WHERE activo;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. HORARIO SEMANAL BASE  (+ turnos partidos como filas)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  UUID NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL DEFAULT 1,   -- bloqueo optimista (§9)
  valid_from   DATE,                          -- NULL = vigente desde siempre
  valid_to     DATE,                          -- permite programar un cambio de horario a futuro
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, valid_from)
);

CREATE TABLE IF NOT EXISTS schedule_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   UUID     NOT NULL REFERENCES weekly_schedules(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),  -- ISO: 1=lunes…7=domingo
  start_minute  SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute    SMALLINT NOT NULL CHECK (end_minute   BETWEEN 0 AND 1560), -- >1440 = cruza medianoche
  CHECK (end_minute > start_minute),
  UNIQUE (schedule_id, day_of_week, start_minute)
);
CREATE INDEX IF NOT EXISTS idx_sp_schedule_day ON schedule_periods(schedule_id, day_of_week);
-- Un día sin ninguna fila = CERRADO. No hace falta un flag `closed`: la ausencia lo dice.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FESTIVOS: catálogo maestro compartido entre tenants
--    (va antes que calendar_rules porque ésta lo referencia)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holiday_catalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pais          CHAR(2) NOT NULL DEFAULT 'ES',
  scope         TEXT NOT NULL CHECK (scope IN ('NATIONAL','REGIONAL','LOCAL')),
  ccaa_code     TEXT,          -- obligatorio si REGIONAL
  municipio_ine TEXT,          -- obligatorio si LOCAL
  fecha         DATE NOT NULL,
  anio          SMALLINT GENERATED ALWAYS AS (EXTRACT(YEAR FROM fecha)::SMALLINT) STORED,
  nombre        TEXT NOT NULL,
  source        TEXT NOT NULL,     -- 'nager.date' | 'boe' | 'ai' | 'manual'
  source_ref    TEXT,              -- URL / nº BOE
  confidence    TEXT NOT NULL DEFAULT 'alta',  -- alta|media|baja  (los locales por IA: baja)
  verified_at   TIMESTAMPTZ,
  verified_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pais, scope, COALESCE(ccaa_code,''), COALESCE(municipio_ine,''), fecha)
);
CREATE INDEX IF NOT EXISTS idx_hc_lookup ON holiday_catalog(pais, anio, scope);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REGLAS DE CALENDARIO  (festivos, vacaciones, cierres, aperturas, cambios)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE calendar_rule_type AS ENUM (
    'HOLIDAY',            -- festivo (nacional / autonómico / local)
    'VACATION',           -- vacaciones del negocio
    'CLOSURE',            -- cierre excepcional (avería, inventario, falta de personal…)
    'EXTRA_OPENING',      -- apertura extraordinaria (domingo abierto)
    'TEMPORARY_CHANGE',   -- horario de verano / obras: sustituye el semanal en un rango
    'SPECIAL'             -- día suelto con horario propio (24/12 hasta las 14:00)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE calendar_rule_effect AS ENUM (
    'CLOSED',             -- cerrado todo el día
    'CUSTOM_HOURS',       -- usa los tramos de calendar_rule_periods
    'OPEN_AS_USUAL'       -- excepción a una excepción (abrimos pese al festivo)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS calendar_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   UUID NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  rule_type     calendar_rule_type   NOT NULL,
  effect        calendar_rule_effect NOT NULL,
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,                     -- inclusivo; = starts_on si es un día
  priority      SMALLINT NOT NULL,                 -- mayor gana (§4.2)
  label         TEXT NOT NULL,                     -- "Vacaciones de agosto", "Avería compresor"
  reason_code   TEXT,                              -- STAFF_SHORTAGE | BREAKDOWN | INVENTORY | WEATHER…
  recurrence    TEXT NOT NULL DEFAULT 'NONE',      -- NONE | YEARLY  (Reyes cada año)
  holiday_id    UUID REFERENCES holiday_catalog(id) ON DELETE SET NULL,
  publish_to_google BOOLEAN NOT NULL DEFAULT TRUE, -- un cierre interno puede no ser público
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_cr_location_range
  ON calendar_rules (location_id, starts_on, ends_on);
-- Consultas del compilador: "reglas que solapan con [hoy, hoy+365]".
CREATE INDEX IF NOT EXISTS idx_cr_range_gist
  ON calendar_rules USING GIST (location_id, daterange(starts_on, ends_on, '[]'));

CREATE TABLE IF NOT EXISTS calendar_rule_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       UUID     NOT NULL REFERENCES calendar_rules(id) ON DELETE CASCADE,
  day_of_week   SMALLINT CHECK (day_of_week BETWEEN 1 AND 7),  -- NULL = aplica a todos los días del rango
  start_minute  SMALLINT NOT NULL,
  end_minute    SMALLINT NOT NULL,
  CHECK (end_minute > start_minute)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. POLÍTICA DE FESTIVOS POR CENTRO
-- ─────────────────────────────────────────────────────────────────────────────
-- Qué hace ESTE centro con ESE festivo. Sin fila = se aplica el default del centro.
CREATE TABLE IF NOT EXISTS location_holiday_policies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  UUID NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  holiday_id   UUID NOT NULL REFERENCES holiday_catalog(id)    ON DELETE CASCADE,
  treatment    TEXT NOT NULL CHECK (treatment IN ('CLOSED','REDUCED','CUSTOM','OPEN_AS_USUAL','IGNORE')),
  custom_periods JSONB,      -- [{startMinute:600,endMinute:840}] si CUSTOM/REDUCED
  decided_by   TEXT,
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, holiday_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. GOOGLE: cuentas OAuth y localizaciones vinculadas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         INTEGER NOT NULL REFERENCES app_empresas(id) ON DELETE CASCADE,
  google_account_id  TEXT NOT NULL,          -- "accounts/123456789"
  account_name       TEXT,                   -- nombre visible
  account_type       TEXT,                   -- PERSONAL | LOCATION_GROUP | ORGANIZATION
  email              TEXT NOT NULL,          -- cuenta que autorizó
  refresh_token_enc  BYTEA NOT NULL,         -- AES-256-GCM (§10) — NUNCA en claro
  refresh_token_kid  TEXT  NOT NULL,         -- id de la clave usada → permite rotarla
  access_token_enc   BYTEA,                  -- caché opcional
  access_token_exp   TIMESTAMPTZ,
  scopes             TEXT[] NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE|REVOKED|EXPIRED|NEEDS_REAUTH
  last_error         TEXT,
  connected_by       TEXT,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, google_account_id)
);

CREATE TABLE IF NOT EXISTS google_locations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id          UUID NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  google_account_id    UUID NOT NULL REFERENCES google_accounts(id)    ON DELETE CASCADE,
  google_location_name TEXT NOT NULL,        -- "locations/0123456789012345678"
  google_place_id      TEXT,
  title                TEXT,
  verification_state   TEXT,                 -- VERIFIED | UNVERIFIED  (afecta a si aplica el cambio)
  sync_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  conflict_policy      TEXT NOT NULL DEFAULT 'APP_WINS',   -- §9
  sync_status          TEXT NOT NULL DEFAULT 'PENDING',    -- PENDING|SYNCING|SYNCED|CONFLICT|FAILED|DISABLED
  desired_hash         TEXT,                 -- hash del payload que queremos
  observed_hash        TEXT,                 -- hash de lo que Google devolvió
  last_synced_at       TIMESTAMPTZ,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  UNIQUE (google_location_name),
  UNIQUE (location_id)                       -- 1 centro ↔ 1 ficha de Google
);
CREATE INDEX IF NOT EXISTS idx_gl_pending ON google_locations(sync_status)
  WHERE sync_enabled AND sync_status <> 'SYNCED';

CREATE TABLE IF NOT EXISTS google_location_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_location_id UUID NOT NULL REFERENCES google_locations(id) ON DELETE CASCADE,
  taken_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  origin             TEXT NOT NULL,   -- AFTER_PUSH | PULL | GOOGLE_UPDATE_NOTIFICATION
  payload            JSONB NOT NULL,  -- regularHours + specialHours + openInfo tal cual
  payload_hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gls_loc_time ON google_location_snapshots(google_location_id, taken_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SINCRONIZACIÓN: runs, eventos, conflictos, outbox
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_location_id  UUID NOT NULL REFERENCES google_locations(id) ON DELETE CASCADE,
  correlation_id      TEXT NOT NULL,        -- misma convención que el Integration Hub
  trigger             TEXT NOT NULL,        -- USER_EDIT|NIGHTLY|MANUAL|RETRY|GOOGLE_UPDATE|HOLIDAY_IMPORT
  status              TEXT NOT NULL,        -- RUNNING|SUCCESS|NO_OP|FAILED|SKIPPED|CONFLICT
  attempt             INTEGER NOT NULL DEFAULT 1,
  desired_hash        TEXT,
  observed_hash_before TEXT,
  observed_hash_after  TEXT,
  request_payload     JSONB,                -- exactamente lo enviado → permite reproceso fiel
  response_payload    JSONB,
  error_code          TEXT,                 -- INVALID_ARGUMENT|PERMISSION_DENIED|RATE_LIMIT|…
  error_message       TEXT,
  duration_ms         INTEGER,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sr_loc_time ON sync_runs(google_location_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sr_failed   ON sync_runs(status, started_at DESC) WHERE status = 'FAILED';

CREATE TABLE IF NOT EXISTS sync_events (
  id           BIGSERIAL PRIMARY KEY,
  sync_run_id  UUID REFERENCES sync_runs(id) ON DELETE CASCADE,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  level        TEXT NOT NULL DEFAULT 'INFO',   -- DEBUG|INFO|WARN|ERROR
  step         TEXT NOT NULL,                  -- COMPILE|DIFF|TOKEN|PATCH|VERIFY|RETRY
  message      TEXT NOT NULL,
  data         JSONB
);
CREATE INDEX IF NOT EXISTS idx_se_run ON sync_events(sync_run_id, at);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_location_id UUID NOT NULL REFERENCES google_locations(id) ON DELETE CASCADE,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  detected_by        TEXT NOT NULL,          -- NIGHTLY_PULL | PRE_PUSH_CHECK | GOOGLE_UPDATE
  app_payload        JSONB NOT NULL,
  google_payload     JSONB NOT NULL,
  diff               JSONB NOT NULL,         -- diferencias legibles, campo a campo
  status             TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN|RESOLVED_APP|RESOLVED_GOOGLE|IGNORED
  resolved_by        TEXT,
  resolved_at        TIMESTAMPTZ,
  resolution_note    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sc_open ON sync_conflicts(status, detected_at DESC) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS outbox (
  id             BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,     -- 'BusinessLocation'
  aggregate_id   UUID NOT NULL,
  event_type     TEXT NOT NULL,     -- 'ScheduleChanged'
  payload        JSONB NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,
  attempts       SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(created_at) WHERE published_at IS NULL;
```

### 2.4 Esquema Prisma equivalente (extracto)

```prisma
// prisma/schema.prisma  — sólo el módulo de scheduling
generator client { provider = "prisma-client-js" }
datasource db    { provider = "postgresql"; url = env("DATABASE_URL") }

enum CalendarRuleType   { HOLIDAY VACATION CLOSURE EXTRA_OPENING TEMPORARY_CHANGE SPECIAL }
enum CalendarRuleEffect { CLOSED CUSTOM_HOURS OPEN_AS_USUAL }
enum SyncStatus         { PENDING SYNCING SYNCED CONFLICT FAILED DISABLED }

model BusinessLocation {
  id             String   @id @default(uuid()) @db.Uuid
  empresaId      Int      @map("empresa_id")
  nombre         String
  timezone       String   @default("Europe/Madrid")
  pais           String   @default("ES") @db.Char(2)
  ccaaCode       String?  @map("ccaa_code")
  municipioIne   String?  @map("municipio_ine")
  activo         Boolean  @default(true)

  weeklySchedules  WeeklySchedule[]
  calendarRules    CalendarRule[]
  holidayPolicies  LocationHolidayPolicy[]
  googleLocation   GoogleLocation?

  @@map("business_locations")
  @@index([empresaId])
}

model WeeklySchedule {
  id         String   @id @default(uuid()) @db.Uuid
  locationId String   @map("location_id") @db.Uuid
  version    Int      @default(1)
  validFrom  DateTime? @map("valid_from") @db.Date
  validTo    DateTime? @map("valid_to")   @db.Date
  location   BusinessLocation @relation(fields: [locationId], references: [id], onDelete: Cascade)
  periods    SchedulePeriod[]

  @@map("weekly_schedules")
  @@unique([locationId, validFrom])
}

model SchedulePeriod {
  id          String @id @default(uuid()) @db.Uuid
  scheduleId  String @map("schedule_id") @db.Uuid
  dayOfWeek   Int    @map("day_of_week")   @db.SmallInt   // 1=lunes … 7=domingo
  startMinute Int    @map("start_minute")  @db.SmallInt
  endMinute   Int    @map("end_minute")    @db.SmallInt
  schedule    WeeklySchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)

  @@map("schedule_periods")
  @@unique([scheduleId, dayOfWeek, startMinute])
}

model CalendarRule {
  id          String   @id @default(uuid()) @db.Uuid
  locationId  String   @map("location_id") @db.Uuid
  ruleType    CalendarRuleType   @map("rule_type")
  effect      CalendarRuleEffect
  startsOn    DateTime @map("starts_on") @db.Date
  endsOn      DateTime @map("ends_on")   @db.Date
  priority    Int      @db.SmallInt
  label       String
  reasonCode  String?  @map("reason_code")
  recurrence  String   @default("NONE")
  publishToGoogle Boolean @default(true) @map("publish_to_google")
  location    BusinessLocation @relation(fields: [locationId], references: [id], onDelete: Cascade)
  periods     CalendarRulePeriod[]

  @@map("calendar_rules")
  @@index([locationId, startsOn, endsOn])
}

model GoogleLocation {
  id                 String     @id @default(uuid()) @db.Uuid
  locationId         String     @unique @map("location_id") @db.Uuid
  googleAccountId    String     @map("google_account_id") @db.Uuid
  googleLocationName String     @unique @map("google_location_name")
  syncEnabled        Boolean    @default(true) @map("sync_enabled")
  conflictPolicy     String     @default("APP_WINS") @map("conflict_policy")
  syncStatus         SyncStatus @default(PENDING) @map("sync_status")
  desiredHash        String?    @map("desired_hash")
  observedHash       String?    @map("observed_hash")
  lastSyncedAt       DateTime?  @map("last_synced_at")
  location           BusinessLocation @relation(fields: [locationId], references: [id], onDelete: Cascade)
  account            GoogleAccount    @relation(fields: [googleAccountId], references: [id], onDelete: Cascade)
  runs               SyncRun[]

  @@map("google_locations")
}
```

---

## 3. Integración con la API de Google Business Profile

> **Aviso de vigencia.** Google ha reorganizado estas APIs varias veces (la v4 monolítica se troceó en
> varias APIs v1). Los ejemplos siguen la familia **v1** vigente. Antes de implementar, contrasta los
> nombres de campo contra el *discovery document* real de tu proyecto — es la única fuente que no
> envejece:
> `curl https://mybusinessbusinessinformation.googleapis.com/$discovery/rest?version=v1`

### 3.0 El paso que bloquea el proyecto: la cuota

**Hazlo el primer día, no el último.** Un proyecto de Google Cloud recién creado tiene las Business
Profile APIs con **cuota 0 QPM**: puedes habilitarlas, pero **toda llamada devuelve 429**. Hay que
solicitar acceso mediante el formulario de la GBP API; una vez aprobado, la cuota pasa a **300 QPM**
por API y por proyecto. La aprobación es manual y puede tardar **semanas**.

Plan de trabajo mientras tanto: desarrollar contra un `SimulatedGoogleBusinessConnector` (el Hub ya usa
ese patrón: `SimulatedSupplierConnector`, `SimulatedCommunicationConnector`). Todo el sistema —compilador,
colas, reintentos, panel— se construye y se prueba sin cuota. El conector real se enchufa al final.

### 3.1 APIs implicadas

| API | Host | Para qué la usamos |
|---|---|---|
| Account Management | `mybusinessaccountmanagement.googleapis.com/v1` | Listar las cuentas que el usuario administra |
| Business Information | `mybusinessbusinessinformation.googleapis.com/v1` | **Leer y escribir horarios** (el 95 % del trabajo) |
| Notifications | `mybusinessnotifications.googleapis.com/v1` | Suscribirse a Pub/Sub para enterarse de cambios hechos en Google |
| OAuth 2.0 | `oauth2.googleapis.com` | Tokens |

### 3.2 OAuth 2.0

**Scope necesario:** uno solo, y es amplio — no hay un scope "sólo horarios".

```
https://www.googleapis.com/auth/business.manage
```

Implicación de diseño: ese token permite responder reseñas y editar la ficha entera. Por eso el token
se cifra en reposo, no se expone jamás al frontend y todo uso queda auditado (§10).

**Tipo de cliente:** *Web application* con `client_secret`. Descartado el flujo de dispositivo o el de
cliente público: el `refresh_token` debe vivir en el servidor.

**Paso 1 — Autorización.** El usuario supervisor pulsa "Conectar con Google" en Mobilink:

```
GET https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=1234567890-abc.apps.googleusercontent.com
  &redirect_uri=https://api.mobilink.app/api/google/oauth/callback
  &response_type=code
  &scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fbusiness.manage
  &access_type=offline          ← imprescindible: sin esto NO hay refresh_token
  &prompt=consent               ← fuerza a Google a devolver refresh_token también en reconexiones
  &include_granted_scopes=true
  &state=<CSRF aleatorio firmado + empresa_id>
```

Dos errores clásicos que este bloque evita: sin `access_type=offline` no recibes `refresh_token`, y sin
`prompt=consent` Google **no** lo reenvía si el usuario ya había autorizado antes — te quedas con un
`access_token` de una hora y la sincronización muere al día siguiente.

**Paso 2 — Canje del código.**

```http
POST /token HTTP/1.1
Host: oauth2.googleapis.com
Content-Type: application/x-www-form-urlencoded

code=4/0AeanS0b...&client_id=...&client_secret=...
&redirect_uri=https://api.mobilink.app/api/google/oauth/callback
&grant_type=authorization_code
```
```json
{
  "access_token": "ya29.a0Ae...",
  "expires_in": 3599,
  "refresh_token": "1//09xY...",
  "scope": "https://www.googleapis.com/auth/business.manage",
  "token_type": "Bearer"
}
```

El `refresh_token` se cifra (AES-256-GCM) y se guarda en `google_accounts.refresh_token_enc`. El
`access_token` se cachea en memoria/Redis con TTL `expires_in - 300 s`.

**Paso 3 — Refresco.** Automático, con margen de 5 minutos y *single-flight* (§10.2):

```http
POST /token HTTP/1.1
Host: oauth2.googleapis.com
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...&refresh_token=1//09xY...&grant_type=refresh_token
```

Si responde `400 invalid_grant`, el usuario revocó el acceso o cambió la contraseña: marcar la cuenta
`NEEDS_REAUTH`, **parar** la sincronización de todas sus localizaciones y avisar. Reintentar aquí es inútil
y sólo genera ruido.

### 3.3 Obtener el Location ID

Son dos llamadas. La primera devuelve las cuentas administradas:

```http
GET /v1/accounts?pageSize=20 HTTP/1.1
Host: mybusinessaccountmanagement.googleapis.com
Authorization: Bearer ya29.a0Ae...
```
```json
{
  "accounts": [
    { "name": "accounts/106861456783728394857",
      "accountName": "Talleres Mobilink S.L.",
      "type": "LOCATION_GROUP",
      "verificationState": "VERIFIED",
      "role": "OWNER" }
  ]
}
```

La segunda, las fichas de esa cuenta. **`readMask` es obligatorio** — sin él, `400`:

```http
GET /v1/accounts/106861456783728394857/locations
   ?readMask=name,title,storefrontAddress,regularHours,specialHours,openInfo,metadata
   &pageSize=100
Host: mybusinessbusinessinformation.googleapis.com
Authorization: Bearer ya29.a0Ae...
```
```json
{
  "locations": [
    {
      "name": "locations/09876543210987654321",
      "title": "Mobilink Taller Tarragona",
      "storefrontAddress": { "addressLines": ["Carrer Exemple 12"], "locality": "Tarragona" },
      "regularHours": {
        "periods": [
          { "openDay": "MONDAY", "openTime": { "hours": 8, "minutes": 30 },
            "closeDay": "MONDAY", "closeTime": { "hours": 13, "minutes": 30 } }
        ]
      },
      "openInfo": { "status": "OPEN", "canReopen": true },
      "metadata": { "hasGoogleUpdated": false, "canOperateLocalPost": true }
    }
  ],
  "nextPageToken": "CigKB..."
}
```

**El identificador que guardas es `name` completo** (`locations/09876543210987654321`), no el número
suelto: es lo que consumen todos los endpoints v1. Va a `google_locations.google_location_name`.

En el flujo de alta, Mobilink muestra esa lista y el usuario **empareja** cada ficha con su centro
(`app_centros`). Se puede pre-emparejar por similitud de dirección/nombre, pero la confirmación es
siempre humana: vincular la ficha equivocada significa publicar el horario de un taller en otro.

### 3.4 Modelo de horarios de Google

**`regularHours`** — el horario semanal. Cada `TimePeriod` es un tramo continuo, así que **el horario
partido son simplemente dos periodos del mismo día**. Encaja perfectamente con `schedule_periods`:

```json
{
  "regularHours": {
    "periods": [
      { "openDay": "MONDAY", "openTime": { "hours": 8, "minutes": 30 },
        "closeDay": "MONDAY", "closeTime": { "hours": 13, "minutes": 30 } },
      { "openDay": "MONDAY", "openTime": { "hours": 15 },
        "closeDay": "MONDAY", "closeTime": { "hours": 18, "minutes": 30 } }
    ]
  }
}
```

Tres detalles que causan bugs si no se conocen:

1. **`openDay` toma valores `MONDAY`…`SUNDAY`.** Un día sin ningún periodo = **cerrado**.
2. **Los ceros desaparecen.** `TimeOfDay` es proto3: `{"hours":15,"minutes":0}` vuelve como
   `{"hours":15}`, y las 00:00 como `{}`. **Normaliza siempre antes de comparar hashes**, o creerás
   que hay cambios donde no los hay y sincronizarás en bucle. (§13.4)
3. **Cruzar medianoche** se expresa con `closeDay` distinto de `openDay`: abrir viernes 20:00 y cerrar
   sábado 02:00 es `openDay: FRIDAY, closeDay: SATURDAY`. Por eso `end_minute` admite hasta 1560.

**`specialHours`** — las excepciones. Aquí va todo lo que no es el patrón semanal: festivos, vacaciones,
cierres, aperturas extraordinarias.

```json
{
  "specialHours": {
    "specialHourPeriods": [
      { "startDate": { "year": 2026, "month": 8, "day": 1 }, "closed": true },
      { "startDate": { "year": 2026, "month": 12, "day": 24 },
        "openTime":  { "hours": 8, "minutes": 30 },
        "endDate":   { "year": 2026, "month": 12, "day": 24 },
        "closeTime": { "hours": 14 } }
    ]
  }
}
```

**Restricciones que condicionan el diseño** (confirmadas en la documentación del recurso):

- **Cada periodo debe representar menos de 24 horas**, y `startDate`+`openTime` deben ser anteriores a
  `endDate`+`closeTime`. → **No puedes mandar "del 1 al 20 de agosto cerrado" como un solo periodo.**
  Hay que **expandir día a día**: 20 periodos con `closed: true`. Es la razón de ser de
  `expandRangeToDays()` en el compilador (§13.3).
- Un día con **horario partido especial** necesita **dos** periodos con la misma `startDate`.
- El array se envía **completo** en cada `PATCH`: no hay operación incremental. Confirma el enfoque
  declarativo de la §1.1.
- Google muestra los horarios especiales con un **horizonte limitado hacia el futuro** (del orden de un año)
  y los días pasados dejan de tener sentido. De ahí la **ventana móvil** y el *job* nocturno (§4.6).

**`openInfo`** — el estado global de la ficha:

```json
{ "openInfo": { "status": "OPEN" } }
```
Valores: `OPEN`, `CLOSED_TEMPORARILY`, `CLOSED_PERMANENTLY`.

**Criterio de uso — importante para el negocio:** `CLOSED_TEMPORARILY` no es "estoy de vacaciones", es
"este negocio no está operando". Google lo muestra de forma prominente y tiene impacto negativo en la
visibilidad local. Regla que propongo:

| Situación | Qué se envía |
|---|---|
| Vacaciones ≤ 30 días, cierre por avería, festivos | `specialHours` con `closed: true` |
| Cierre indefinido o > 60 días (reforma, traspaso) | `openInfo.status = CLOSED_TEMPORARILY` **con confirmación explícita del usuario en la UI** |
| Cese de actividad | `CLOSED_PERMANENTLY`, sólo manual, nunca automático |

El umbral es configurable (`google_locations`), pero el salto a `CLOSED_TEMPORARILY` **nunca** debe ser
automático sin que el usuario lo entienda: es la clase de "automatización útil" que hunde el SEO local
de un cliente y destruye la confianza en el producto.

**`moreHours`** — horarios secundarios (recogida, taller vs tienda). Fuera del alcance inicial, pero el
modelo lo admite: bastaría un `service_type` en `schedule_periods`.

### 3.5 Actualizar: ejemplos REST reales

**(a) Horario semanal.** `updateMask` acota qué se toca; **todo lo no listado queda intacto**.

```http
PATCH /v1/locations/09876543210987654321?updateMask=regularHours HTTP/1.1
Host: mybusinessbusinessinformation.googleapis.com
Authorization: Bearer ya29.a0Ae...
Content-Type: application/json

{
  "regularHours": {
    "periods": [
      { "openDay":"MONDAY","openTime":{"hours":8,"minutes":30},"closeDay":"MONDAY","closeTime":{"hours":13,"minutes":30} },
      { "openDay":"MONDAY","openTime":{"hours":15},"closeDay":"MONDAY","closeTime":{"hours":18,"minutes":30} },
      { "openDay":"TUESDAY","openTime":{"hours":8,"minutes":30},"closeDay":"TUESDAY","closeTime":{"hours":13,"minutes":30} },
      { "openDay":"TUESDAY","openTime":{"hours":15},"closeDay":"TUESDAY","closeTime":{"hours":18,"minutes":30} },
      { "openDay":"SATURDAY","openTime":{"hours":9},"closeDay":"SATURDAY","closeTime":{"hours":13} }
    ]
  }
}
```
Respuesta `200` con el objeto `Location` actualizado. *(Domingo no aparece → cerrado.)*

**(b) Horarios especiales, festivos, vacaciones y cierres — todos por el mismo campo.**

```http
PATCH /v1/locations/09876543210987654321?updateMask=specialHours HTTP/1.1
Host: mybusinessbusinessinformation.googleapis.com
Authorization: Bearer ya29.a0Ae...
Content-Type: application/json

{
  "specialHours": {
    "specialHourPeriods": [
      { "startDate":{"year":2026,"month":1,"day":6}, "closed": true },
      { "startDate":{"year":2026,"month":8,"day":1},  "closed": true },
      { "startDate":{"year":2026,"month":8,"day":2},  "closed": true },
      { "startDate":{"year":2026,"month":12,"day":24},
        "openTime":{"hours":8,"minutes":30},
        "endDate":{"year":2026,"month":12,"day":24},
        "closeTime":{"hours":14} },
      { "startDate":{"year":2026,"month":11,"day":8},
        "openTime":{"hours":10}, "endDate":{"year":2026,"month":11,"day":8}, "closeTime":{"hours":14} }
    ]
  }
}
```
Las cinco cosas del encargo —festivo (6/1), vacaciones (1–2/8, expandidas), horario reducido (24/12),
apertura extraordinaria en domingo (8/11)— viajan en **una sola llamada**, porque el compilador ya las
resolvió a un único calendario efectivo.

**(c) Ambos campos a la vez** (típico tras un cambio de horario base):

```http
PATCH /v1/locations/098765...?updateMask=regularHours,specialHours
```

**(d) Cierre temporal prolongado:**

```http
PATCH /v1/locations/098765...?updateMask=openInfo
Content-Type: application/json

{ "openInfo": { "status": "CLOSED_TEMPORARILY" } }
```

**(e) Simulacro antes de tocar producción** — soportado por el método `patch`:

```http
PATCH /v1/locations/098765...?updateMask=specialHours&validateOnly=true
```
Valida y **no** aplica. Se usa en el botón "Comprobar antes de publicar" y en el arranque de cada centro nuevo.

**(f) Ver la versión "actualizada por Google"** — base de la detección de conflictos (§9):

```http
GET /v1/locations/09876543210987654321:googleUpdated?readMask=regularHours,specialHours,openInfo
Host: mybusinessbusinessinformation.googleapis.com
```
```json
{
  "location": { "name": "locations/098...", "regularHours": { "periods": [ ... ] } },
  "diffMask": "regularHours",
  "pendingMask": ""
}
```
`diffMask` dice **exactamente qué campos cambió Google** respecto a tu versión. No hay que diferenciar a
mano: Google te lo entrega.

**(g) Suscripción a notificaciones** (para no depender sólo del *polling*):

```http
PATCH /v1/accounts/106861456783728394857/notificationSetting?updateMask=pubsubTopic,notificationTypes
Host: mybusinessnotifications.googleapis.com
Content-Type: application/json

{
  "pubsubTopic": "projects/mobilink-prod/topics/gbp-notifications",
  "notificationTypes": ["GOOGLE_UPDATE"]
}
```
Cuando llega un `GOOGLE_UPDATE`, el mensaje trae `locationName`; el webhook encola un `google.pull` para
esa ficha. Detección de conflictos **en minutos** en vez de en la siguiente pasada nocturna.

### 3.6 Errores frecuentes y qué significan

| HTTP / status | Causa real | Reacción del worker |
|---|---|---|
| `400 INVALID_ARGUMENT` | Periodo especial ≥ 24 h, fecha inválida, mask mal formado | **Permanente.** No reintentar. Conflicto/DLQ + aviso |
| `401 UNAUTHENTICATED` | Access token caducado | Refrescar y reintentar **una** vez |
| `403 PERMISSION_DENIED` | Perdiste el rol sobre la ficha, o cuota 0 | Permanente. `NEEDS_REAUTH` o revisar cuota |
| `404 NOT_FOUND` | Ficha borrada o migrada de cuenta | Desactivar `sync_enabled`, avisar |
| `429 RESOURCE_EXHAUSTED` | Cuota QPM superada | Backoff con jitter + bajar el rate limiter |
| `500 / 503` | Fallo transitorio de Google | Backoff exponencial |
| `200` pero el campo no cambia | Ficha no verificada, o el cambio entró en revisión | No es error: registrar `PENDING_REVIEW` y verificar con `getGoogleUpdated` |

Ese último caso es el más traicionero: **`200 OK` no garantiza que el cambio esté publicado.** De ahí el
paso de **verificación** (re-`GET` tras el `PATCH`) en el flujo de la §4.

---

## 4. Sincronización automática

### 4.1 Flujo completo

```
 ┌── USUARIO ──────────────────────────────────────────────────────────────────┐
 │  Edita horario / añade festivo / marca vacaciones                           │
 └───────────────────────────────┬─────────────────────────────────────────────┘
                                 ▼
 ┌── API (una sola transacción) ───────────────────────────────────────────────┐
 │  BEGIN                                                                      │
 │    validar (dominio) → guardar calendar_rules / schedule_periods            │
 │    INSERT INTO outbox (event_type='ScheduleChanged', locationId, corrId)    │
 │    UPDATE google_locations SET sync_status='PENDING'                        │
 │  COMMIT                        ← atómico: o se guarda todo, o nada          │
 │  202 Accepted { syncStatus: 'PENDING', correlationId }                      │
 └───────────────────────────────┬─────────────────────────────────────────────┘
                                 ▼
 ┌── OUTBOX RELAY (cada 1 s) ──────────────────────────────────────────────────┐
 │  SELECT … WHERE published_at IS NULL FOR UPDATE SKIP LOCKED LIMIT 100       │
 │  queue.add('sync.location', {...}, {                                        │
 │      jobId: `sync:loc:${locationId}`,   ← DEDUPLICACIÓN                     │
 │      delay: 30_000                       ← DEBOUNCE: agrupa ráfagas         │
 │  })                                                                         │
 │  UPDATE outbox SET published_at = now()                                     │
 └───────────────────────────────┬─────────────────────────────────────────────┘
                                 ▼
 ┌── SYNC WORKER ──────────────────────────────────────────────────────────────┐
 │  1. sync_runs ← RUNNING (correlationId, trigger, attempt)                   │
 │  2. Cargar reglas + horario base + políticas de festivos                    │
 │  3. COMPILAR calendario efectivo  [hoy, hoy+365]     ← función pura         │
 │  4. PROYECTAR a payload Google  →  desiredHash                              │
 │  5. GET ficha en Google          →  observedHash                            │
 │  6. ¿observedHash ≠ lastKnownHash?  → CONFLICTO (§9) → aplicar política     │
 │  7. ¿desiredHash == observedHash?   → NO_OP  (fin, sin llamar a PATCH)      │
 │  8. PATCH regularHours,specialHours                                         │
 │  9. VERIFICAR: re-GET → snapshot + observedHash                             │
 │ 10. sync_runs ← SUCCESS | NO_OP; google_locations ← SYNCED, last_synced_at  │
 └───────────────────────────────┬─────────────────────────────────────────────┘
                                 │ ✗ error
                                 ▼
 ┌── CLASIFICADOR DE ERRORES ──────────────────────────────────────────────────┐
 │  TRANSITORIO (429/5xx/red)  → reintento con backoff exponencial + jitter    │
 │  AUTH (401)                 → refrescar token → 1 reintento inmediato       │
 │  PERMANENTE (400/403/404)   → SIN reintento → sync.dlq + conflicto + aviso  │
 │  Tras N intentos            → sync.dlq, sync_status='FAILED', alerta        │
 └─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 El compilador de calendario y sus reglas de precedencia

Todo el sistema descansa en una función **pura**:

```
compile(weeklySchedule, rules[], holidayPolicies[], window) → EffectiveCalendar
```

`EffectiveCalendar` es un `Map<'YYYY-MM-DD', DayPlan>` donde `DayPlan = { closed, periods[], source }`.
`source` explica **por qué** ese día es así, y es lo que la UI enseña ("cerrado por: Vacaciones de agosto").

**Precedencia por defecto** (gana el número más alto). Es dato, no código: está en
`calendar_rules.priority`, así que un tenant puede cambiarla sin desplegar.

| Prioridad | Tipo | Racional |
|---|---|---|
| 0 | Horario semanal | El caso base |
| 10 | `TEMPORARY_CHANGE` | El horario de verano sustituye al base durante un rango |
| 20 | `HOLIDAY` | Un festivo cierra, salvo que decidas otra cosa |
| 30 | `SPECIAL` | Día concreto con horario propio (24/12) — más específico que un festivo |
| 40 | `VACATION` | Las vacaciones mandan sobre festivos y especiales |
| 50 | `EXTRA_OPENING` | Apertura extraordinaria: abre aunque tocase cerrar |
| 60 | `CLOSURE` | Un cierre por avería gana a todo. Si no puedes abrir, no abres |

**Empates:** a igual prioridad gana la regla con el rango **más corto** (más específica); si persiste el
empate, la creada más recientemente. Determinista y explicable.

**Casos que esta tabla resuelve bien:**
- Vacaciones 1–20 de agosto con el 15 (Asunción) dentro → cerrado igual, y el `source` dice "Vacaciones".
- Domingo abierto (`EXTRA_OPENING`, 50) que cae en festivo (20) → **abre**. Correcto: es exactamente lo
  que quiere decir "apertura extraordinaria".
- Avería (`CLOSURE`, 60) el mismo domingo de la apertura extraordinaria → **cierra**. También correcto.
- `OPEN_AS_USUAL` permite la excepción a la excepción: "estas vacaciones, el día 10 abrimos".

### 4.3 Por qué el patrón Outbox

Sin outbox, el código sería:

```ts
await prisma.calendarRule.create({ data });
await queue.add('sync.location', { locationId });   // ← si el proceso muere aquí…
```

…el usuario ve su cierre guardado, Google nunca se entera y **nadie detecta el fallo**. En un sistema cuyo
valor es "no tienes que entrar en Google", ese fallo silencioso es el peor posible.

Con outbox, escritura y evento son **una sola transacción**; el relay garantiza *at-least-once*, y como la
sincronización es idempotente (§1.1), entregar dos veces no hace daño. Es la combinación clásica:
*at-least-once delivery + idempotent consumer = efectivamente exactly-once*.

*Alternativa evaluada:* Postgres `LISTEN/NOTIFY`. Más simple, pero `NOTIFY` no es persistente: si no hay
oyente en ese instante, el aviso se pierde. Sirve como **acelerador** (despertar al relay sin esperar al
polling), no como garantía. Se puede añadir después.

### 4.4 Deduplicación y *debounce*

Un usuario configurando su verano genera 15 escrituras en 2 minutos. Sin control: 15 sincronizaciones,
15× cuota, y carreras en las que gana la que responda antes.

```ts
await queue.add('sync.location', { locationId }, {
  jobId: `sync:loc:${locationId}`,   // si ya hay uno esperando, no se crea otro
  delay: 30_000,                      // ventana de agrupación
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: false,                // los fallos se conservan para diagnóstico
});
```

Resultado: **una** sincronización, 30 s después de la última edición. El estado deseado se calcula en el
momento de ejecutar, así que siempre refleja el último cambio. Si el usuario quiere inmediatez, el botón
"Sincronizar ahora" encola con `delay: 0`.

**Anti-carrera:** un lock por localización (`Redlock`, o `pg_advisory_xact_lock(hashtext(locationId))` en la
variante A) impide que la reconciliación nocturna y una edición manual escriban a la vez.

### 4.5 Reintentos: por clase de error, nunca a ciegas

```ts
export const RETRY_POLICY = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 5_000 },  // 5 s, 10 s, 20 s, 40 s, 80 s, 160 s (+ jitter)
} satisfies JobsOptions;
```

| Clase | Ejemplos | Política |
|---|---|---|
| `TRANSIENT` | 429, 500, 503, `ETIMEDOUT`, `ECONNRESET` | Backoff exponencial + jitter, hasta 6 intentos |
| `AUTH` | 401 | Refrescar token, **1** reintento inmediato; si vuelve a fallar → `AUTH_FATAL` |
| `AUTH_FATAL` | `invalid_grant`, 403 | 0 reintentos. Cuenta `NEEDS_REAUTH`, parar sus localizaciones, avisar |
| `PERMANENT` | 400 `INVALID_ARGUMENT` | 0 reintentos. Es **nuestro** bug o dato inválido: DLQ + alerta a ingeniería |
| `NOT_FOUND` | 404 | 0 reintentos. `sync_enabled=false` + aviso al usuario |

El **jitter** no es cosmético: sin él, 500 localizaciones que fallan por un 503 de Google reintentan todas
en el mismo milisegundo y provocan el siguiente 429 (efecto manada).

**Circuit breaker por cuenta:** tras 5 fallos consecutivos de la misma `google_account`, se abre el circuito
durante 15 minutos. Evita quemar cuota compartida por culpa de un tenant con las credenciales rotas.

**Cola muerta (`sync.dlq`):** todo lo que agota reintentos o es permanente. Visible en `/admin/sync/dlq` con
botón "Reprocesar" — exactamente el patrón que ya existe en `IntegrationWorker.ts` con `RETRY_PENDING`.

### 4.6 Trabajos programados

| Job | Cadencia | Para qué |
|---|---|---|
| `sync.reconcile` | Diaria, 03:00–05:00 escalonado por tenant | **Imprescindible.** Recalcula la ventana móvil (los días pasados caducan), repara divergencias, detecta ediciones hechas en Google |
| `google.pull` | Cada 6 h + por Pub/Sub | Trae el estado remoto y detecta conflictos |
| `holidays.import` | Anual (15 de octubre) + manual | Importa el calendario laboral del año siguiente (§5) |
| `tokens.audit` | Diaria | Cuentas `NEEDS_REAUTH` o sin uso reciente → avisar antes de que rompa |
| `metrics.rollup` | Horaria | Alimenta el panel |

El escalonado del nocturno se hace con `delay = hash(tenantId) % ventana`: 10.000 localizaciones repartidas
en dos horas en vez de un pico a las 03:00 clavadas.

### 4.7 Máquina de estados

```
                    edición de usuario
                            │
  ┌──────────┐              ▼               ┌──────────┐
  │ SYNCED   │────────▶ PENDING ─────────▶ │ SYNCING  │
  └──────────┘                              └────┬─────┘
       ▲                                         │
       │ éxito / no-op                           ├── error transitorio ──▶ PENDING (reintento)
       └─────────────────────────────────────────┤
                                                 ├── error permanente ───▶ FAILED  ──▶ DLQ
                                                 └── divergencia ────────▶ CONFLICT ──▶ resolución (§9)

  DISABLED: sync_enabled = false (desvinculada o pausada por el usuario)
```

---

## 5. Festivos: nacionales, autonómicos y locales

### 5.1 El problema real (España)

Cada trabajador tiene **14 festivos**: 8–9 nacionales, el resto autonómicos, y **2 locales** fijados por
cada ayuntamiento. Los locales son el problema: **no existe una fuente nacional consolidada y fiable**.
Los publica cada ayuntamiento o el boletín provincial, en PDF, con formatos distintos y fechas de
publicación distintas. Cualquier diseño que prometa festivos locales automáticos al 100 % está mintiendo.

Por eso la estrategia es **multi-fuente con confianza declarada y verificación humana para los locales** —
que es, por cierto, lo que ya insinúa el endpoint `festivos-ia` de este repo y su campo `confidence`.

### 5.2 Fuentes recomendadas, por capas

| Capa | Fuente | Cobertura | Coste | Confianza |
|---|---|---|---|---|
| 1 | **Nager.Date** (`date.nager.at/api/v3/PublicHolidays/{año}/ES`) | Nacionales + autonómicos (`counties: ["ES-CT"]`) | Gratis, sin API key | Alta para nacional, media para autonómico |
| 2 | **BOE — Resolución del calendario laboral** (se publica ~octubre para el año siguiente) | Nacionales + autonómicos, **oficial** | Gratis (API BOE / scraping) | **Máxima**. Es la referencia legal |
| 3 | **Boletines provinciales + sedes electrónicas municipales** | Locales | Gratis, esfuerzo alto | Alta, pero no automatizable de forma uniforme |
| 4 | **IA (el `festivos-ia` que ya existe)** | Los 2 locales del municipio | Coste por consulta | **Baja/media → requiere confirmación** |
| 5 | **Calendarific / Google Calendar API** (`es.spain#holiday@group.v.calendar.google.com`) | Nacionales, comodín | Freemium / gratis | Media. Google Calendar **no** trae locales |
| 6 | **Entrada manual** | Cualquiera | — | Máxima. Siempre disponible como última palabra |

**Estrategia por capas, en orden:** BOE (oficial) → Nager.Date (relleno/validación cruzada) → IA (locales,
marcados `confidence='baja'`) → confirmación del usuario → manual.

**Regla de oro:** un festivo con `confidence != 'alta'` y sin `verified_at` **se muestra en la app pero no
se publica en Google** hasta que un humano lo confirme. Cerrar un negocio un día equivocado por culpa de
una alucinación de un modelo es un daño real y directo al cliente. Este es el punto donde el diseño elige
deliberadamente ser conservador.

### 5.3 Flujo de importación anual

```
15 de octubre (job anual)  ─────▶  para cada país/CCAA/municipio en uso:
                                     1. BOE  → nacionales + autonómicos del año siguiente
                                     2. Nager.Date → validación cruzada
                                        ├─ coinciden → confidence='alta', verified_at=now()
                                        └─ discrepan → confidence='media' + revisión
                                     3. IA (festivos-ia) → 2 locales por municipio_ine
                                        └─ confidence='baja', verified_at=NULL
                                     4. UPSERT en holiday_catalog (idempotente por la UNIQUE)
                                     5. Para cada centro afectado:
                                        ├─ aplicar la política por defecto (normalmente CLOSED)
                                        └─ crear notificación: "Revisa los festivos de 2027 (2 locales
                                           por confirmar)"
                                     6. Sólo los verificados generan calendar_rules → sincronización
```

`holiday_catalog` es **compartido entre tenants**: 500 talleres en Tarragona comparten los mismos festivos.
Se importa **una vez** por ámbito, no 500. Con 10.000 negocios esto es la diferencia entre 20 consultas y
20.000.

### 5.4 Tratamiento por festivo

`location_holiday_policies.treatment` cubre justo lo que pide el encargo:

| Tratamiento | Qué hace | Payload a Google |
|---|---|---|
| `CLOSED` | Cerrado todo el día (por defecto) | `{ startDate, closed: true }` |
| `REDUCED` | Sólo mañana | Un periodo con los tramos reducidos |
| `CUSTOM` | Horario a medida, incluso partido | 1..N periodos ese día |
| `OPEN_AS_USUAL` | Se ignora el festivo, abre normal | **Nada** (manda `regularHours`) |
| `IGNORE` | Ni siquiera aparece en la agenda | Nada |

En la UI: lista de festivos del año con un desplegable por fila, un "aplicar a todos" y un aviso destacado
en los que están sin verificar.

```ts
// Ejemplo: Reyes cerrado, Nochebuena reducida
await holidayPolicyService.set(locationId, [
  { holidayId: reyes2027,      treatment: 'CLOSED' },
  { holidayId: nochebuena2027, treatment: 'CUSTOM',
    customPeriods: [{ startMinute: 510, endMinute: 840 }] },   // 08:30–14:00
]);
```

---

## 6. Vacaciones

Es el caso más sencillo de expresar y el que más trampas de API tiene.

**Lo que hace el usuario:** un selector de rango, "Del 1 al 20 de agosto", un motivo y guardar.

**Lo que ocurre por dentro:**

```ts
// 1. Una sola regla, un solo registro
await createCalendarRule({
  locationId,
  ruleType: 'VACATION',
  effect: 'CLOSED',
  startsOn: '2026-08-01',
  endsOn:   '2026-08-20',
  priority: 40,
  label: 'Vacaciones de agosto',
});

// 2. El compilador la expande a 20 DayPlan cerrados
// 3. El proyector genera 20 specialHourPeriods  ← obligatorio: Google no acepta
//    un periodo de más de 24 h (§3.4)
```

```json
{
  "specialHours": {
    "specialHourPeriods": [
      { "startDate": { "year": 2026, "month": 8, "day": 1 },  "closed": true },
      { "startDate": { "year": 2026, "month": 8, "day": 2 },  "closed": true },
      "… hasta el día 20 …",
      { "startDate": { "year": 2026, "month": 8, "day": 20 }, "closed": true }
    ]
  }
}
```

**Resultado en Google:** durante esos 20 días la ficha muestra **"Cerrado"** con la marca de horario
especial, sin tocar `openInfo` y sin penalización de visibilidad.

**Detalles que hay que resolver y suelen olvidarse:**

- **Días que ya estaban cerrados** (domingos, festivos dentro del rango): el compilador los deja cerrados;
  el proyector **no duplica** periodos. Los días que ya son cerrados por `regularHours` se pueden omitir
  para ahorrar tamaño de payload, aunque enviarlos explícitos es más claro para el usuario final. Opción
  configurable; por defecto, **enviarlos** (Google los muestra como "horario especial", que es información
  más útil que un simple hueco).
- **Vacaciones largas (> 30 días):** aviso en la UI proponiendo `CLOSED_TEMPORARILY` (§3.4), nunca automático.
- **Reapertura:** el día 21 no requiere ninguna acción. Al salirse del rango, el compilador vuelve al
  horario base y el nocturno retira los periodos ya pasados.
- **Vacaciones parciales** ("del 1 al 20 sólo por las tardes"): misma regla con `effect: 'CUSTOM_HOURS'` y
  los tramos que sí se abren.
- **Aviso a clientes:** la misma regla puede disparar un evento `VacationScheduled` que el módulo de
  comunicaciones del Hub use para avisar por WhatsApp a las citas afectadas. Sinergia con
  `CommunicationService.ts`, ya existente. **Y un control previo:** si hay citas confirmadas dentro del
  rango, la UI debe avisar **antes** de guardar.

---

## 7. Cierres excepcionales

Mismo mecanismo, distinta prioridad (60, la más alta) y un `reason_code` de catálogo:

| `reason_code` | Etiqueta UI | ¿Público en Google? |
|---|---|---|
| `STAFF_SHORTAGE` | Falta de personal | Sí (sólo "Cerrado", nunca el motivo) |
| `BREAKDOWN` | Avería | Sí |
| `INVENTORY` | Inventario | Sí |
| `WEATHER` | Temporal / alerta meteorológica | Sí |
| `TRAINING` | Formación | Sí |
| `PRIVATE_EVENT` | Evento privado | Configurable |
| `OTHER` | Otro | Sí |

**Decisión importante de privacidad:** el motivo **nunca** se envía a Google. Google sólo recibe "cerrado
ese día". El `reason_code` es para la analítica interna del negocio ("has cerrado 6 días por avería este
trimestre"). Publicar "cerrado por falta de personal" en la ficha pública sería un tiro en el pie del cliente.

**Cierre de hoy mismo, urgente.** Es el caso de uso crítico: el compresor se ha roto a las 9:00 y hay que
cerrar **ya**.

```ts
// Camino rápido: prioridad de cola + sin debounce
await createCalendarRule({ ruleType:'CLOSURE', effect:'CLOSED',
  startsOn: today, endsOn: today, priority: 60, reasonCode: 'BREAKDOWN',
  label: 'Avería en el compresor' });

await syncQueue.add('sync.location', { locationId, urgent: true }, {
  jobId: `sync:loc:${locationId}:urgent`,
  priority: 1,      // BullMQ: menor número = antes
  delay: 0,         // sin debounce: esto no espera 30 segundos
});
```

Además: cierre de **medio día** (`effect: 'CUSTOM_HOURS'` con sólo el tramo de mañana) y **cierre abierto**
(sin fecha de fin conocida) → se crea con `ends_on = hoy + 7` y un recordatorio diario "¿sigues cerrado?",
porque una regla sin fin que nadie revisa acaba dejando el negocio cerrado en Google para siempre.

---

## 8. Aperturas extraordinarias

Prioridad 50: gana al horario base, a los festivos y a las vacaciones; pierde sólo frente a un cierre.

```ts
// "Domingo 8 de noviembre, abierto de 10:00 a 14:00"
await createCalendarRule({
  locationId,
  ruleType: 'EXTRA_OPENING',
  effect:   'CUSTOM_HOURS',
  startsOn: '2026-11-08',
  endsOn:   '2026-11-08',
  priority: 50,
  label:    'Domingo comercial',
  periods: [{ startMinute: 600, endMinute: 840 }],   // 10:00–14:00
});
```

→ payload:

```json
{ "startDate": { "year": 2026, "month": 11, "day": 8 },
  "openTime":  { "hours": 10 },
  "endDate":   { "year": 2026, "month": 11, "day": 8 },
  "closeTime": { "hours": 14 } }
```

**Por qué sobrescribe bien:** el domingo no tiene periodos en `regularHours` (= cerrado), y
`specialHours` **siempre** prevalece sobre `regularHours` en Google. La sobreescritura la hace Google, no
nosotros; nosotros sólo garantizamos que el día aparece en `specialHours`.

Variantes cubiertas: apertura **partida** (dos periodos el mismo día), **serie** de domingos de diciembre
(cuatro reglas, o una regla con `calendar_rule_periods.day_of_week = 7` sobre el rango del mes), y
apertura extraordinaria que cae en festivo → abre (50 > 20), con el `source` del `DayPlan` explicándolo.

---

## 9. Prevención de conflictos

### 9.1 Cómo se detecta

Tres detectores complementarios:

1. **Comprobación previa al push.** Antes de cada `PATCH`, el worker hace `GET` y compara con
   `google_locations.observed_hash` (lo que dejamos la última vez). Si difiere, **alguien tocó Google**.
2. **Reconciliación nocturna.** Compara estado deseado vs remoto en todas las fichas. Coge lo que se
   escape entre pushes.
3. **Notificación Pub/Sub `GOOGLE_UPDATE` + `locations.getGoogleUpdated`.** Google avisa en minutos y su
   `diffMask` dice exactamente qué campos cambió (§3.5f). Es la detección más rápida y precisa.

### 9.2 Las cinco estrategias, con su análisis

**A. La app sobrescribe Google (`APP_WINS`).**
- *Cómo:* se ignora la divergencia, se hace `PATCH` con el estado deseado y se registra en `sync_events`.
- *A favor:* coherente con la premisa del encargo ("la app es la fuente única de verdad"). Simple,
  predecible, autorreparable, cero fricción para el usuario.
- *En contra:* destruye cambios legítimos hechos en Google. Si el encargado cerró por nieve desde el móvil
  a las 7:00, el nocturno lo revierte y el negocio aparece abierto estando cerrado.
- *Mitigación:* registrar **siempre** lo sobrescrito y notificarlo ("hemos restaurado el horario; se
  descartó un cambio hecho en Google el día X"). Sobrescribir en silencio es lo que hace que un cliente
  desconfíe del producto para siempre.

**B. Google sobrescribe la app (`GOOGLE_WINS`).**
- *Cómo:* se importa el estado remoto al modelo local.
- *A favor:* respeta al usuario que edita donde le apetece.
- *En contra:* **incompatible con el objetivo del proyecto.** Google no tiene el concepto de "vacaciones"
  ni de "cierre por avería": al importar, 20 días de vacaciones se convierten en 20 días especiales sueltos
  y se **pierde la intención**. La información degrada de forma irreversible. Además, la agenda de citas
  depende del horario local: un cambio en Google alteraría la disponibilidad de reservas sin control.
- *Veredicto:* **no recomendada** salvo en la importación inicial.

**C. Detección de conflictos sin resolución automática (`DETECT_ONLY`).**
- *Cómo:* se para la sincronización de esa ficha, se abre un `sync_conflicts` y se avisa.
- *A favor:* nunca se pierde información; el humano decide.
- *En contra:* la ficha se queda desincronizada mientras nadie mire. Con 10.000 negocios, la bandeja de
  conflictos se convierte en un cementerio.

**D. Confirmación manual (`MANUAL_CONFIRM`).**
- *Cómo:* C + una UI de resolución en dos columnas (app ↔ Google, diferencias resaltadas) con tres botones:
  *Mantener el de Mobilink* / *Adoptar el de Google* / *Fusionar*.
- *A favor:* el mejor equilibrio entre control y seguridad. La opción "Adoptar" reintroduce el cambio en el
  modelo local **con su semántica** (el usuario elige si aquello era un cierre, un festivo o unas vacaciones),
  lo que evita la degradación del caso B.
- *En contra:* requiere construir esa UI y que alguien la atienda.

**E. Sincronización bidireccional real.**
- *Cómo:* CRDT o *last-write-wins* por campo con marcas de tiempo.
- *A favor:* teóricamente lo más flexible.
- *En contra:* **desaconsejada aquí.** Google no expone marcas de tiempo por campo fiables ni un historial
  de quién cambió qué; sin eso, "bidireccional" degenera en "el último que escriba gana", que es peor que
  A porque es impredecible. Coste alto, beneficio dudoso.

### 9.3 Recomendación: híbrida, por campo y configurable

```
conflict_policy (por localización, con default por tenant):

  regularHours  → APP_WINS         · el horario semanal es intención de negocio, vive en Mobilink
  specialHours  → MANUAL_CONFIRM   · aquí es donde alguien cierra "por hoy" desde el móvil
  openInfo      → DETECT_ONLY      · nunca automático: impacto SEO alto
  otros campos  → sin gestión      · Mobilink no toca nombre, fotos, teléfono ni categorías
```

Racional: el horario semanal cambia poco y siempre por decisión de negocio → sobrescribir es seguro y
mantiene la promesa del producto. Los horarios especiales son justo donde ocurren las ediciones legítimas
de urgencia → merecen intervención humana. Y `openInfo` no se toca nunca sin permiso explícito.

Además, **el mejor conflicto es el que no ocurre**: durante el alta, la UI debe explicar con claridad que a
partir de ahora el horario se gestiona en Mobilink, y ofrecer un acceso directo a la pantalla de horarios
cuando alguien intente editarlo en Google. Y bloqueo optimista (`weekly_schedules.version`) para el
conflicto interno de dos usuarios de Mobilink editando a la vez.

### 9.4 Resolución en la UI

```
┌── Conflicto detectado · Mobilink Taller Tarragona ─────────────────────┐
│  Detectado: 12/08/2026 03:14 (reconciliación nocturna)                 │
│                                                                        │
│         EN MOBILINK                    EN GOOGLE                       │
│  Sáb 15/08  Cerrado (Vacaciones)  │  Sáb 15/08  09:00–13:00   ← difiere│
│  Lun 17/08  Cerrado (Vacaciones)  │  Lun 17/08  Cerrado          ✓     │
│                                                                        │
│  [Mantener Mobilink]  [Adoptar Google]  [Fusionar…]  [Ignorar]        │
│                                                                        │
│  ℹ Si adoptas el de Google se te pedirá clasificarlo (apertura         │
│    extraordinaria, cambio de horario…) para no perder el motivo.       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Seguridad

### 10.1 Tokens OAuth en reposo

**Nunca en claro, nunca en el frontend, nunca en logs.**

```ts
// infrastructure/crypto/TokenCipher.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

export class TokenCipher {
  constructor(private readonly keyring: Map<string, Buffer>, private readonly activeKid: string) {}

  encrypt(plain: string): { data: Buffer; kid: string } {
    const key = this.keyring.get(this.activeKid)!;
    const iv  = randomBytes(12);
    const c   = createCipheriv(ALGO, key, iv);
    const ct  = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    // iv(12) | tag(16) | ciphertext  → una sola columna BYTEA
    return { data: Buffer.concat([iv, c.getAuthTag(), ct]), kid: this.activeKid };
  }

  decrypt(blob: Buffer, kid: string): string {
    const key = this.keyring.get(kid);
    if (!key) throw new Error(`Clave desconocida: ${kid}`);   // rotación: kid antiguo aún disponible
    const d = createDecipheriv(ALGO, key, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
  }
}
```

- **La clave maestra sale del `SecretsProvider`** que ya existe en el Hub, no de la BD ni del repo. En
  producción, gestor de secretos real (Render env → Key Vault / Secrets Manager).
- **`kid` por fila** permite **rotar** la clave sin parar el sistema: se cifra con la nueva y se descifra
  con la que tocase; un job reencripta en segundo plano.
- **GCM** (autenticado) evita manipulaciones silenciosas del ciphertext.
- **Redacción en logs:** serializador de pino que borre `refresh_token`, `access_token`, `client_secret`,
  `authorization` en todo el árbol. Y un test que lo verifique — es exactamente el tipo de fuga que se cuela
  en un `console.error(error.response)`.

### 10.2 Renovación automática

```ts
// Un solo refresco concurrente por cuenta ("single-flight"):
// sin esto, 20 jobs en paralelo lanzan 20 refrescos y Google puede invalidar el token.
private readonly inFlight = new Map<string, Promise<string>>();

async getAccessToken(accountId: string): Promise<string> {
  const cached = await this.cache.get(`gbp:at:${accountId}`);
  if (cached) return cached;

  const running = this.inFlight.get(accountId);
  if (running) return running;

  const p = this.refresh(accountId).finally(() => this.inFlight.delete(accountId));
  this.inFlight.set(accountId, p);
  return p;
}
```
Con varias instancias del worker, el *single-flight* se refuerza con un lock distribuido en Redis
(`SET gbp:refresh:{id} NX PX 10000`).

### 10.3 Revocación

- **Iniciada por el usuario** ("Desconectar Google" en Mobilink):
  `POST https://oauth2.googleapis.com/revoke?token=<refresh_token>`, luego **borrado** de la fila
  (no basta con marcarla), `sync_enabled=false` en sus localizaciones y registro en `app_auditoria`.
- **Iniciada por Google** (usuario revoca desde su cuenta, cambia contraseña, expira): se manifiesta como
  `invalid_grant`. → `status='NEEDS_REAUTH'`, parar sincronizaciones, notificar al administrador del tenant
  con un enlace de reconexión. Sin reintentos: sólo generan ruido y bloquean la cola.
- **Baja del tenant:** revocar y borrar tokens forma parte del proceso de borrado de datos (GDPR).

### 10.4 Multiempresa y multiusuario

Se apoya en lo que ya existe (`empresa_id`, `es_superadmin`, `app_licencias`):

- **Aislamiento por tenant en cada consulta.** No confiar en el `WHERE` a mano: repositorio con
  `tenantId` obligatorio en la firma, y sesión de BD con `SET LOCAL app.tenant_id` + **RLS** en Postgres
  como red de seguridad. Un fallo aquí significa publicar el horario de una empresa en la ficha de otra:
  el peor bug imaginable en este sistema.
- **Una empresa puede tener varias cuentas de Google** y varios centros; un centro tiene exactamente una
  ficha (`UNIQUE (location_id)`).
- **Permisos** (sobre los roles existentes):

| Acción | Rol mínimo |
|---|---|
| Ver horario y estado de sincronización | Panel |
| Editar horario semanal / festivos / vacaciones | Supervisor |
| Crear cierre excepcional urgente | Supervisor (o Encargado, configurable) |
| Conectar/desconectar Google | Administrador de empresa |
| Resolver conflictos | Supervisor |
| Ver logs de sincronización de cualquier tenant | SuperAdmin |
| Reprocesar DLQ | SuperAdmin |

- **Auditoría:** toda escritura de calendario y toda operación OAuth van a `app_auditoria` (ya existe) con
  usuario, IP, entidad y detalle.

### 10.5 Otras medidas

- **`state` firmado** en el flujo OAuth (HMAC con TTL) → sin CSRF en el callback.
- **PKCE** aunque sea cliente confidencial: coste cero, defensa extra.
- **Verificación de la firma de Pub/Sub** en el webhook (JWT del *push subscription*), o token secreto en
  la URL. Un webhook abierto es un vector de denegación de servicio y de envenenamiento de datos.
- **Rate limit** en los endpoints de escritura de horarios por usuario y por tenant.
- **Principio de mínimo privilegio en la BD:** el worker no necesita `DELETE` sobre `app_empresas`.

---

## 11. Escalabilidad

### 11.1 La restricción dominante no es tu infraestructura, es la cuota de Google

**300 QPM por API y por proyecto** una vez aprobado (0 antes). Todo lo demás —Node, Postgres, Redis— se
queda corto de sobra frente a eso. Diseña contra esa cifra.

Coste por reconciliación completa de una ficha: 1 `GET` + 1 `PATCH` (+1 `GET` de verificación) ≈ **3 llamadas**.

| Escala | Fichas × 3 llamadas | A 300 QPM (5 QPS) | Veredicto |
|---|---|---|---|
| 10 | 30 | 6 s | Trivial |
| 100 | 300 | 1 min | Trivial |
| 1.000 | 3.000 | 10 min | Cabe en la ventana nocturna sin esfuerzo |
| 10.000 | 30.000 | **100 min** | Cabe en una ventana de 3 h, **pero sin margen** para picos ni reintentos |

Palancas cuando 10.000 empieza a apretar:

1. **No sincronizar lo que no cambió.** Con el hash del estado deseado, la mayoría de noches el 95 % de las
   fichas son `NO_OP` **sin ninguna llamada**: basta comparar `desired_hash` con `google_locations.desired_hash`
   almacenado. Sólo se llama a Google si el deseado cambió, o si toca una verificación periódica (p. ej.
   completa una vez por semana, escalonada). Esto convierte 30.000 llamadas/noche en ~1.500.
2. **Escalonar.** `delay = hash(tenant) % 3h` — reparte la carga y evita el pico de las 03:00.
3. **Rate limiter por cuenta de Google**, no global: `{ groupKey: googleAccountId }` en BullMQ.
4. **Varios proyectos de Google Cloud** si de verdad hiciera falta más cuota (con su aprobación cada uno),
   repartiendo tenants entre proyectos. Es la vía real de escalar más allá de 300 QPM.

### 11.2 Escalado por tramos

**10 negocios — un solo proceso.**
API + worker en el mismo servicio (`RUN_WORKER_INLINE=1`), cola en Postgres, sin Redis. Coste ~0.
*Justificación:* meter Redis y un worker separado aquí es complejidad sin beneficio.

**100 negocios — separar el worker.**
Dos servicios en Render (API y worker), Redis pequeño si ya se ha adoptado BullMQ. Índices de la §2.3.
Panel de sincronización operativo. Alertas por email a partir de X fallos.

**1.000 negocios — paralelismo y observabilidad.**
- `concurrency: 10–20` por worker, 2–3 réplicas.
- *Connection pooling* (PgBouncer o el pool de Supabase): 3 workers × 20 conexiones agota Postgres si no.
- Particionar `sync_events` y `sync_runs` por mes; retención 90 días con `DROP PARTITION` (barato) en lugar
  de `DELETE` (caro y genera *bloat*).
- Métricas Prometheus: `sync_duration_seconds`, `sync_failures_total{error_code}`, `queue_depth`,
  `google_api_calls_total`, `conflicts_open`.
- Caché de festivos: `holiday_catalog` es idéntico para miles de negocios → cachear por
  `(pais, ccaa, municipio, año)`.

**10.000 negocios — particionar y priorizar.**
- **Colas por prioridad:** `sync.urgent` (cierres de hoy) separada de `sync.bulk` (nocturno). Un cierre por
  avería no puede esperar detrás de 9.000 reconciliaciones rutinarias. **Esta es la decisión que más se
  nota en calidad percibida.**
- **Sharding por tenant** en varias instancias de Redis/worker si la cola se convierte en cuello de botella.
- **Compilación cacheada:** el resultado del compilador es determinista para
  `(reglas, versión, ventana)` → cachear por hash y evitar recompilar 10.000 calendarios cada noche.
- **Lecturas a réplica** para el panel y los informes.
- **Backpressure:** si la cola supera N trabajos, degradar la frecuencia del nocturno antes que reventar.
- **Multi-región** sólo si hay clientes fuera de Europa; hasta entonces, complejidad innecesaria.

### 11.3 Qué NO escala y hay que evitar desde el principio

- Un `setInterval` que recorre todos los negocios en un proceso.
- Compilar el calendario en el frontend (divergiría del worker).
- Guardar el horario como JSON en una tabla de configuración (el estado actual): no se puede indexar,
  ni auditar, ni consultar "qué negocios cierran mañana".
- `SELECT * FROM sync_events` sin partición ni retención: crece sin techo.
- Un único `access_token` compartido entre tenants (además de inseguro, imposible de revocar por cliente).

---

## 12. Ejemplos completos, de principio a fin

### 12.1 Cambio de horario semanal

```http
PUT /api/locations/8f2c.../weekly-schedule
Content-Type: application/json
X-Correlation-Id: b4c1e0f2-…

{
  "version": 7,
  "days": [
    { "dayOfWeek": 1, "periods": [ {"start":"08:30","end":"13:30"}, {"start":"15:00","end":"18:30"} ] },
    { "dayOfWeek": 2, "periods": [ {"start":"08:30","end":"13:30"}, {"start":"15:00","end":"18:30"} ] },
    { "dayOfWeek": 3, "periods": [ {"start":"08:30","end":"13:30"}, {"start":"15:00","end":"18:30"} ] },
    { "dayOfWeek": 4, "periods": [ {"start":"08:30","end":"13:30"}, {"start":"15:00","end":"18:30"} ] },
    { "dayOfWeek": 5, "periods": [ {"start":"08:30","end":"13:30"}, {"start":"15:00","end":"18:30"} ] },
    { "dayOfWeek": 6, "periods": [ {"start":"09:00","end":"13:00"} ] },
    { "dayOfWeek": 7, "periods": [] }
  ]
}
```
```json
202 Accepted
{ "scheduleId":"…", "version":8, "syncStatus":"PENDING",
  "correlationId":"b4c1e0f2-…", "estimatedSyncAt":"2026-07-25T10:31:04Z" }
```

```
10:30:34  INFO  schedule.updated      location=8f2c version=8 by=jordi periods=11
10:30:34  INFO  outbox.inserted       event=ScheduleChanged corr=b4c1e0f2
10:30:35  INFO  outbox.published      job=sync:loc:8f2c delay=30000
10:31:05  INFO  sync.started          run=a91f trigger=USER_EDIT attempt=1
10:31:05  DEBUG sync.compiled         days=365 rules=6 ms=12
10:31:05  DEBUG sync.projected        regular=11 special=23 desiredHash=sha256:4c1a…
10:31:06  INFO  sync.observed         observedHash=sha256:9be7… changed=true
10:31:06  INFO  sync.patch            mask=regularHours,specialHours bytes=3184
10:31:07  INFO  sync.verified         observedHash=sha256:4c1a… match=true
10:31:07  INFO  sync.success          run=a91f status=SUCCESS duration=2104ms
```

### 12.2 Añadir un festivo

```http
POST /api/locations/8f2c.../holidays
{ "date":"2026-12-08", "name":"La Inmaculada", "scope":"NATIONAL", "treatment":"CLOSED" }
```
→ `holiday_catalog` (upsert, compartido) → `location_holiday_policies` → `calendar_rules` (HOLIDAY, prio 20)
→ outbox → sync → un `specialHourPeriod` más:
```json
{ "startDate": { "year": 2026, "month": 12, "day": 8 }, "closed": true }
```

### 12.3 Vacaciones

```http
POST /api/locations/8f2c.../calendar-rules
{ "ruleType":"VACATION","effect":"CLOSED","startsOn":"2026-08-01","endsOn":"2026-08-20",
  "label":"Vacaciones de agosto" }
```
```json
201 Created
{ "ruleId":"…", "daysAffected":20, "appointmentsInRange":3,
  "warning":"Hay 3 citas confirmadas en ese rango",
  "googlePreview":{ "specialHourPeriodsAdded":20 }, "syncStatus":"PENDING" }
```
El aviso de las 3 citas **antes** de confirmar es el detalle que convierte una función correcta en una
función que la gente usa sin miedo.

### 12.4 Horario especial (Nochebuena)

```http
POST /api/locations/8f2c.../calendar-rules
{ "ruleType":"SPECIAL","effect":"CUSTOM_HOURS","startsOn":"2026-12-24","endsOn":"2026-12-24",
  "label":"Nochebuena","periods":[{"start":"08:30","end":"14:00"}] }
```
```json
{ "startDate":{"year":2026,"month":12,"day":24},
  "openTime":{"hours":8,"minutes":30},
  "endDate":{"year":2026,"month":12,"day":24},
  "closeTime":{"hours":14} }
```

### 12.5 Error de sincronización, reintento y resolución

```
03:14:02 INFO  sync.started    run=c73d location=8f2c trigger=NIGHTLY attempt=1
03:14:03 INFO  sync.patch      mask=specialHours bytes=4102
03:14:04 ERROR sync.failed     run=c73d http=429 code=RESOURCE_EXHAUSTED
                               class=TRANSIENT retryIn=5.4s (5s + jitter)
03:14:09 INFO  sync.started    run=c73d attempt=2
03:14:10 ERROR sync.failed     http=429 retryIn=11.2s
03:14:21 INFO  sync.started    attempt=3
03:14:23 INFO  sync.success    status=SUCCESS duration=1980ms totalAttempts=3
```

Caso permanente, sin reintento inútil:

```
03:20:11 ERROR sync.failed  http=400 code=INVALID_ARGUMENT
                            message="special hour period must be less than 24 hours"
                            class=PERMANENT retry=false
03:20:11 WARN  sync.dlq     run=e02a reason=PERMANENT_ERROR
03:20:11 INFO  conflict.opened id=… detectedBy=PRE_PUSH_CHECK
03:20:12 INFO  alert.sent   channel=email to=soporte@mobilink.app severity=HIGH
```
Un `INVALID_ARGUMENT` es **nuestro** bug (el proyector generó un periodo inválido), no un problema del
cliente: por eso va a ingeniería, no al usuario.

### 12.6 Consulta de historial

```http
GET /api/locations/8f2c.../sync-history?limit=5
```
```json
{ "runs": [
  { "id":"a91f","trigger":"USER_EDIT","status":"SUCCESS","attempt":1,"durationMs":2104,
    "startedAt":"2026-07-25T10:31:05Z","changed":["regularHours","specialHours"] },
  { "id":"c73d","trigger":"NIGHTLY","status":"SUCCESS","attempt":3,"durationMs":1980,
    "startedAt":"2026-07-25T03:14:21Z","previousErrors":["429 RESOURCE_EXHAUSTED ×2"] },
  { "id":"b55e","trigger":"NIGHTLY","status":"NO_OP","durationMs":410,
    "note":"Estado deseado idéntico al publicado" }
]}
```

---

## 13. Código (Node.js + TypeScript)

### 13.1 Estructura de carpetas

Sigue la disposición que el Integration Hub ya usa en este repo (`domain` / `application` /
`infrastructure` / `connectors` / `workers`), extendida con Clean Architecture:

```
server/
└── scheduling/                          # ← módulo nuevo, autocontenido
    │
    ├── domain/                          # SIN dependencias externas. Ni Prisma, ni Express, ni fetch.
    │   ├── model/
    │   │   ├── TimeRange.ts             # value object: minutos, solapes, validación
    │   │   ├── DayPlan.ts               # value object: día resuelto (cerrado / N tramos / origen)
    │   │   ├── WeeklySchedule.ts        # entidad
    │   │   ├── CalendarRule.ts          # entidad + invariantes por tipo
    │   │   ├── EffectiveCalendar.ts     # agregado resultado
    │   │   └── GoogleLocationLink.ts    # entidad: vínculo + estado de sync
    │   ├── services/
    │   │   ├── ScheduleCompiler.ts      # ★ función pura: reglas → calendario efectivo
    │   │   ├── GoogleHoursProjector.ts  # ★ función pura: calendario → payload de Google
    │   │   └── ConflictDetector.ts      # ★ función pura: deseado vs observado → diff
    │   ├── events/
    │   │   └── ScheduleChanged.ts
    │   ├── errors.ts
    │   └── ports/                       # interfaces (dependency inversion)
    │       ├── ScheduleRepository.ts
    │       ├── CalendarRuleRepository.ts
    │       ├── GoogleLocationRepository.ts
    │       ├── SyncRunRepository.ts
    │       ├── GoogleBusinessPort.ts    # lo que necesitamos de Google, en NUESTRO lenguaje
    │       ├── SyncQueuePort.ts         # BullMQ o Postgres detrás de esto
    │       └── ClockPort.ts             # el tiempo es una dependencia: se inyecta y se testea
    │
    ├── application/                     # casos de uso: orquestan, no deciden reglas
    │   ├── UpdateWeeklyScheduleUseCase.ts
    │   ├── CreateCalendarRuleUseCase.ts
    │   ├── ScheduleVacationUseCase.ts
    │   ├── SetHolidayPolicyUseCase.ts
    │   ├── SyncLocationHoursUseCase.ts   # ★ el corazón del worker
    │   ├── ReconcileAllUseCase.ts
    │   ├── ImportHolidaysUseCase.ts
    │   ├── ConnectGoogleAccountUseCase.ts
    │   ├── ResolveConflictUseCase.ts
    │   └── PreviewCalendarUseCase.ts
    │
    ├── infrastructure/
    │   ├── prisma/
    │   │   ├── client.ts
    │   │   ├── PrismaScheduleRepository.ts
    │   │   ├── PrismaCalendarRuleRepository.ts
    │   │   ├── PrismaGoogleLocationRepository.ts
    │   │   └── PrismaSyncRunRepository.ts
    │   ├── google/
    │   │   ├── GoogleBusinessProfileClient.ts   # HTTP puro
    │   │   ├── GoogleBusinessAdapter.ts         # implementa GoogleBusinessPort
    │   │   ├── GoogleOAuthService.ts            # tokens: canje, refresco, revocación
    │   │   ├── SimulatedGoogleAdapter.ts        # desarrollo sin cuota
    │   │   └── errors.ts                        # clasificación de errores
    │   ├── queue/
    │   │   ├── bullmq/BullSyncQueue.ts
    │   │   ├── postgres/PgSyncQueue.ts          # variante A (stack actual)
    │   │   └── OutboxRelay.ts
    │   ├── crypto/TokenCipher.ts
    │   ├── holidays/
    │   │   ├── NagerDateProvider.ts
    │   │   ├── BoeProvider.ts
    │   │   └── AiHolidayProvider.ts             # reutiliza el /festivos-ia existente
    │   ├── logging/logger.ts
    │   └── schema.ts                            # DDL idempotente (convención del repo)
    │
    ├── interfaces/
    │   ├── http/
    │   │   ├── scheduleController.ts
    │   │   ├── calendarRuleController.ts
    │   │   ├── googleOAuthController.ts
    │   │   ├── syncController.ts
    │   │   ├── googleWebhookController.ts       # Pub/Sub GOOGLE_UPDATE
    │   │   └── routes.ts
    │   └── dto/ (+ validación con zod)
    │
    ├── workers/
    │   ├── syncWorker.ts
    │   ├── reconcileWorker.ts
    │   ├── holidaysWorker.ts
    │   └── index.ts                             # arranque del proceso worker
    │
    ├── container.ts                             # composition root: aquí y sólo aquí se instancian
    └── index.ts
```

**Regla de dependencia (Clean Architecture):** las flechas apuntan siempre hacia dentro.
`interfaces → application → domain`, e `infrastructure → domain` (implementa sus puertos). El dominio no
importa nada de fuera. Test práctico: si `domain/` compila con `package.json` sin dependencias, está bien.

### 13.2 Dominio: value objects

```ts
// server/scheduling/domain/model/TimeRange.ts
import { InvalidTimeRangeError } from '../errors.js';

/** Tramo horario en minutos desde medianoche. 510 = 08:30. >1440 = cruza medianoche. */
export class TimeRange {
  private constructor(readonly startMinute: number, readonly endMinute: number) {}

  static create(startMinute: number, endMinute: number): TimeRange {
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
      throw new InvalidTimeRangeError('Los minutos deben ser enteros');
    }
    if (startMinute < 0 || startMinute > 1440) {
      throw new InvalidTimeRangeError(`Inicio fuera de rango: ${startMinute}`);
    }
    if (endMinute <= startMinute) {
      throw new InvalidTimeRangeError(`El fin (${endMinute}) debe ser posterior al inicio (${startMinute})`);
    }
    if (endMinute > 1560) {  // 26:00 — tope razonable para cierres de madrugada
      throw new InvalidTimeRangeError(`Fin fuera de rango: ${endMinute}`);
    }
    return new TimeRange(startMinute, endMinute);
  }

  static fromStrings(start: string, end: string): TimeRange {
    return TimeRange.create(TimeRange.parse(start), TimeRange.parse(end));
  }

  static parse(hhmm: string): number {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) throw new InvalidTimeRangeError(`Hora inválida: "${hhmm}"`);
    const [h, min] = [Number(m[1]), Number(m[2])];
    if (min > 59) throw new InvalidTimeRangeError(`Minutos inválidos: "${hhmm}"`);
    return h * 60 + min;
  }

  /** Cruza medianoche → el cierre cae en el día siguiente (Google: closeDay ≠ openDay). */
  get crossesMidnight(): boolean { return this.endMinute > 1440; }

  overlaps(other: TimeRange): boolean {
    return this.startMinute < other.endMinute && other.startMinute < this.endMinute;
  }

  toStrings(): { start: string; end: string } {
    const fmt = (t: number) =>
      `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    return { start: fmt(this.startMinute), end: fmt(this.endMinute) };
  }
}
```

```ts
// server/scheduling/domain/model/DayPlan.ts
import { TimeRange } from './TimeRange.js';

export type DayPlanSource =
  | { kind: 'WEEKLY' }
  | { kind: 'RULE'; ruleId: string; ruleType: string; label: string };

/** Un día ya resuelto: la salida del compilador. Inmutable. */
export class DayPlan {
  private constructor(
    readonly date: string,               // 'YYYY-MM-DD'
    readonly periods: readonly TimeRange[],
    readonly source: DayPlanSource,
  ) {}

  static closed(date: string, source: DayPlanSource): DayPlan {
    return new DayPlan(date, [], source);
  }

  static open(date: string, periods: TimeRange[], source: DayPlanSource): DayPlan {
    // Orden estable + validación de solapes: dos tramos solapados producirían
    // un payload que Google rechaza con INVALID_ARGUMENT.
    const sorted = [...periods].sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].overlaps(sorted[i])) {
        throw new Error(`Tramos solapados en ${date}`);
      }
    }
    return new DayPlan(date, sorted, source);
  }

  get isClosed(): boolean { return this.periods.length === 0; }

  equals(other: DayPlan): boolean {
    return this.periods.length === other.periods.length
      && this.periods.every((p, i) =>
           p.startMinute === other.periods[i].startMinute &&
           p.endMinute   === other.periods[i].endMinute);
  }
}
```

### 13.3 El compilador (la pieza clave)

```ts
// server/scheduling/domain/services/ScheduleCompiler.ts
import { DayPlan } from '../model/DayPlan.js';
import { TimeRange } from '../model/TimeRange.js';
import type { WeeklySchedule } from '../model/WeeklySchedule.js';
import type { CalendarRule } from '../model/CalendarRule.js';

export interface CompileWindow { from: string; to: string }   // 'YYYY-MM-DD', inclusivo

export type EffectiveCalendar = ReadonlyMap<string, DayPlan>;

/**
 * Función PURA: mismas entradas → misma salida. Sin BD, sin red, sin Date.now().
 * Es lo que permite testearla exhaustivamente y cachear su resultado por hash.
 */
export function compileSchedule(
  weekly: WeeklySchedule,
  rules: readonly CalendarRule[],
  window: CompileWindow,
): EffectiveCalendar {
  const calendar = new Map<string, DayPlan>();

  // Índice fecha → reglas aplicables. Se expanden los rangos una sola vez.
  const rulesByDate = indexRulesByDate(rules, window);

  for (const date of eachDay(window.from, window.to)) {
    const dow = isoDayOfWeek(date);                       // 1=lunes … 7=domingo
    const applicable = rulesByDate.get(date) ?? [];

    if (applicable.length === 0) {
      // Caso base: el horario semanal.
      const periods = weekly.periodsFor(dow);
      calendar.set(date, periods.length
        ? DayPlan.open(date, periods, { kind: 'WEEKLY' })
        : DayPlan.closed(date, { kind: 'WEEKLY' }));
      continue;
    }

    // Precedencia: prioridad ↓, luego rango más corto (más específico), luego más reciente.
    const winner = [...applicable].sort((a, b) =>
      b.priority - a.priority
      || a.spanInDays - b.spanInDays
      || b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    const source = {
      kind: 'RULE' as const,
      ruleId: winner.id, ruleType: winner.ruleType, label: winner.label,
    };

    switch (winner.effect) {
      case 'CLOSED':
        calendar.set(date, DayPlan.closed(date, source));
        break;

      case 'OPEN_AS_USUAL': {
        // Excepción a la excepción: se vuelve al horario semanal, pero el origen
        // queda registrado para que la UI pueda explicarlo.
        const periods = weekly.periodsFor(dow);
        calendar.set(date, periods.length
          ? DayPlan.open(date, periods, source)
          : DayPlan.closed(date, source));
        break;
      }

      case 'CUSTOM_HOURS': {
        const periods = winner.periodsFor(dow);
        calendar.set(date, periods.length
          ? DayPlan.open(date, periods, source)
          : DayPlan.closed(date, source));   // CUSTOM sin tramos ese día = cerrado
        break;
      }
    }
  }

  return calendar;
}

function indexRulesByDate(
  rules: readonly CalendarRule[],
  window: CompileWindow,
): Map<string, CalendarRule[]> {
  const index = new Map<string, CalendarRule[]>();
  for (const rule of rules) {
    for (const date of rule.expandToDates(window)) {   // gestiona recurrencia YEARLY
      if (date < window.from || date > window.to) continue;
      const bucket = index.get(date);
      if (bucket) bucket.push(rule);
      else index.set(date, [rule]);
    }
  }
  return index;
}

/** Iterador de días en UTC: sin sorpresas de horario de verano al sumar 24 h. */
export function* eachDay(from: string, to: string): Generator<string> {
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

export function isoDayOfWeek(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();   // 0=domingo
  return d === 0 ? 7 : d;                                // → 7=domingo (ISO-8601)
}
```

> **Nota sobre zonas horarias.** El compilador trabaja con **fechas civiles** (`YYYY-MM-DD`) y **minutos
> locales**, nunca con instantes UTC. Es lo correcto: "abrimos a las 8:30" significa 8:30 hora local
> siempre, cambie o no el horario de verano. Por eso se itera en UTC (para que sumar 24 h nunca salte ni
> repita un día) pero se interpreta en local. Confundir estas dos cosas es el bug clásico de todo sistema
> de horarios, y aparece dos veces al año.

### 13.4 El proyector a Google

```ts
// server/scheduling/domain/services/GoogleHoursProjector.ts
import { createHash } from 'node:crypto';
import type { EffectiveCalendar } from './ScheduleCompiler.js';
import type { WeeklySchedule } from '../model/WeeklySchedule.js';

const GOOGLE_DAYS = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'] as const;

export interface GoogleTimeOfDay { hours?: number; minutes?: number }
export interface GoogleTimePeriod {
  openDay: string; openTime: GoogleTimeOfDay; closeDay: string; closeTime: GoogleTimeOfDay;
}
export interface GoogleSpecialHourPeriod {
  startDate: { year: number; month: number; day: number };
  endDate?:  { year: number; month: number; day: number };
  openTime?: GoogleTimeOfDay; closeTime?: GoogleTimeOfDay;
  closed?: boolean;
}
export interface GoogleHoursPayload {
  regularHours: { periods: GoogleTimePeriod[] };
  specialHours: { specialHourPeriods: GoogleSpecialHourPeriod[] };
}

/** minutos → TimeOfDay. Se omiten los ceros: es como los devuelve Google (proto3). */
function toTimeOfDay(minute: number): GoogleTimeOfDay {
  const t: GoogleTimeOfDay = {};
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  if (h) t.hours = h;
  if (m) t.minutes = m;
  return t;
}

export function projectRegularHours(weekly: WeeklySchedule): GoogleTimePeriod[] {
  const periods: GoogleTimePeriod[] = [];
  for (let dow = 1; dow <= 7; dow++) {
    for (const range of weekly.periodsFor(dow)) {
      const openDay  = GOOGLE_DAYS[dow - 1];
      // Cierre después de medianoche → el día de cierre es el siguiente.
      const closeDay = range.crossesMidnight ? GOOGLE_DAYS[dow % 7] : openDay;
      periods.push({
        openDay,  openTime:  toTimeOfDay(range.startMinute),
        closeDay, closeTime: toTimeOfDay(range.endMinute),
      });
    }
  }
  return periods;   // un día sin periodos = cerrado, no hay que decir nada más
}

/**
 * Días que se desvían del patrón semanal → specialHours.
 * CADA periodo cubre UN día: Google rechaza periodos de ≥ 24 h (§3.4).
 */
export function projectSpecialHours(
  calendar: EffectiveCalendar,
  weekly: WeeklySchedule,
): GoogleSpecialHourPeriod[] {
  const out: GoogleSpecialHourPeriod[] = [];

  for (const [date, plan] of [...calendar.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (plan.source.kind === 'WEEKLY') continue;          // no se desvía: nada que decir
    if (weekly.matchesDay(date, plan)) continue;          // coincide con el semanal: ruido

    const [year, month, day] = date.split('-').map(Number);
    const startDate = { year, month, day };

    if (plan.isClosed) {
      out.push({ startDate, closed: true });
      continue;
    }
    // Horario partido especial → un periodo por tramo, misma fecha.
    for (const range of plan.periods) {
      out.push({
        startDate,
        openTime:  toTimeOfDay(range.startMinute),
        endDate:   startDate,
        closeTime: toTimeOfDay(range.endMinute),
      });
    }
  }
  return out;
}

/**
 * Hash canónico del payload. Sin esto no hay detección de no-ops ni de conflictos.
 * La normalización (claves ordenadas, ceros omitidos) es imprescindible: si no,
 * {"hours":15} y {"hours":15,"minutes":0} darían hashes distintos y el sistema
 * sincronizaría en bucle contra Google gastando cuota sin cambiar nada.
 */
export function hashPayload(payload: GoogleHoursPayload): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== 0 && v !== false)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}
```

### 13.5 Puertos

```ts
// server/scheduling/domain/ports/GoogleBusinessPort.ts
import type { GoogleHoursPayload } from '../services/GoogleHoursProjector.js';

export interface GoogleAccountRef { accountId: string }

export interface GoogleBusinessPort {
  listAccounts(ref: GoogleAccountRef): Promise<Array<{ name: string; accountName: string }>>;
  listLocations(ref: GoogleAccountRef, googleAccountName: string):
    Promise<Array<{ name: string; title: string; address?: string }>>;

  /** Estado actual de horarios de una ficha. */
  readHours(ref: GoogleAccountRef, locationName: string): Promise<GoogleHoursPayload>;

  /** PATCH de horarios. `validateOnly` para simulacro. */
  updateHours(
    ref: GoogleAccountRef, locationName: string,
    payload: GoogleHoursPayload, opts?: { validateOnly?: boolean },
  ): Promise<GoogleHoursPayload>;

  /** Versión modificada por Google + diffMask (detección de conflictos). */
  getGoogleUpdated(ref: GoogleAccountRef, locationName: string):
    Promise<{ payload: GoogleHoursPayload; diffMask: string[] }>;

  setOpenInfoStatus(
    ref: GoogleAccountRef, locationName: string,
    status: 'OPEN' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY',
  ): Promise<void>;
}
```

```ts
// server/scheduling/domain/ports/SyncQueuePort.ts
export interface EnqueueSyncOptions {
  urgent?: boolean;        // sin debounce, cola prioritaria
  delayMs?: number;
  correlationId: string;
  trigger: 'USER_EDIT' | 'NIGHTLY' | 'MANUAL' | 'RETRY' | 'GOOGLE_UPDATE' | 'HOLIDAY_IMPORT';
}

export interface SyncQueuePort {
  enqueueLocationSync(locationId: string, opts: EnqueueSyncOptions): Promise<void>;
}
```

El puerto habla **nuestro** lenguaje, no el de Google. Cambiar a Apple Business Connect o a Bing Places
sería escribir otro adaptador; ni el dominio ni los casos de uso se enteran. Es el mismo invariante que ya
sostiene el Integration Hub.

### 13.6 Cliente de Google Business Profile

```ts
// server/scheduling/infrastructure/google/GoogleBusinessProfileClient.ts
import { classifyGoogleError, GoogleApiError } from './errors.js';
import type { GoogleOAuthService } from './GoogleOAuthService.js';
import type { Logger } from 'pino';

const BUSINESS_INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const ACCOUNT_MGMT  = 'https://mybusinessaccountmanagement.googleapis.com/v1';

export class GoogleBusinessProfileClient {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly log: Logger,
    private readonly timeoutMs = 15_000,
  ) {}

  private async request<T>(
    accountId: string, url: string, init: RequestInit = {}, retriedAuth = false,
  ): Promise<T> {
    const token = await this.oauth.getAccessToken(accountId);
    const ctrl  = AbortSignal.timeout(this.timeoutMs);

    const res = await fetch(url, {
      ...init,
      signal: ctrl,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 401 && !retriedAuth) {
      // Token caducado justo entre el caché y la llamada: refrescar y reintentar UNA vez.
      this.log.warn({ accountId }, 'google.401 → refrescando token');
      await this.oauth.invalidate(accountId);
      return this.request<T>(accountId, url, init, true);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new GoogleApiError(
        res.status, classifyGoogleError(res.status, body), body,
        `${init.method ?? 'GET'} ${new URL(url).pathname}`,
      );
    }

    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  listAccounts(accountId: string) {
    return this.request<{ accounts?: Array<{ name: string; accountName: string }> }>(
      accountId, `${ACCOUNT_MGMT}/accounts?pageSize=100`,
    );
  }

  async listLocations(accountId: string, googleAccountName: string) {
    const readMask = 'name,title,storefrontAddress,regularHours,specialHours,openInfo,metadata';
    const all: any[] = [];
    let pageToken: string | undefined;

    do {
      const qs = new URLSearchParams({ readMask, pageSize: '100' });
      if (pageToken) qs.set('pageToken', pageToken);
      const page = await this.request<{ locations?: any[]; nextPageToken?: string }>(
        accountId, `${BUSINESS_INFO}/${googleAccountName}/locations?${qs}`,
      );
      all.push(...(page.locations ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return all;
  }

  getLocation(accountId: string, locationName: string) {
    const readMask = 'name,title,regularHours,specialHours,openInfo';
    return this.request<any>(
      accountId, `${BUSINESS_INFO}/${locationName}?readMask=${readMask}`,
    );
  }

  patchHours(
    accountId: string, locationName: string,
    body: { regularHours?: unknown; specialHours?: unknown },
    opts: { validateOnly?: boolean } = {},
  ) {
    const masks = Object.keys(body).join(',');          // 'regularHours,specialHours'
    const qs = new URLSearchParams({ updateMask: masks });
    if (opts.validateOnly) qs.set('validateOnly', 'true');

    return this.request<any>(accountId, `${BUSINESS_INFO}/${locationName}?${qs}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  getGoogleUpdated(accountId: string, locationName: string) {
    const readMask = 'regularHours,specialHours,openInfo';
    return this.request<{ location: any; diffMask?: string; pendingMask?: string }>(
      accountId, `${BUSINESS_INFO}/${locationName}:googleUpdated?readMask=${readMask}`,
    );
  }
}
```

```ts
// server/scheduling/infrastructure/google/errors.ts
export type ErrorClass = 'TRANSIENT' | 'AUTH' | 'AUTH_FATAL' | 'PERMANENT' | 'NOT_FOUND';

export class GoogleApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorClass: ErrorClass,
    readonly body: string,
    readonly operation: string,
  ) {
    super(`[${errorClass}] ${operation} → HTTP ${httpStatus}`);
    this.name = 'GoogleApiError';
  }
  get retryable(): boolean { return this.errorClass === 'TRANSIENT' || this.errorClass === 'AUTH'; }
}

export function classifyGoogleError(status: number, body: string): ErrorClass {
  if (status === 429 || status >= 500) return 'TRANSIENT';
  if (status === 401) return 'AUTH';
  if (status === 403) return body.includes('quota') || body.includes('Quota')
    ? 'TRANSIENT'     // cuota agotada: es temporal
    : 'AUTH_FATAL';   // permisos revocados: reintentar no sirve de nada
  if (status === 404) return 'NOT_FOUND';
  return 'PERMANENT'; // 400 INVALID_ARGUMENT y demás: es nuestro bug, no lo repitas 6 veces
}
```

### 13.7 Cola y outbox

```ts
// server/scheduling/infrastructure/queue/bullmq/BullSyncQueue.ts
import { Queue, type JobsOptions } from 'bullmq';
import type { SyncQueuePort, EnqueueSyncOptions } from '../../../domain/ports/SyncQueuePort.js';

export const SYNC_QUEUE = 'sync.location';
export const DLQ        = 'sync.dlq';

export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: false,           // los fallos se conservan: son el material de diagnóstico
};

export class BullSyncQueue implements SyncQueuePort {
  constructor(private readonly queue: Queue) {}

  async enqueueLocationSync(locationId: string, opts: EnqueueSyncOptions): Promise<void> {
    await this.queue.add(
      SYNC_QUEUE,
      { locationId, correlationId: opts.correlationId, trigger: opts.trigger },
      {
        ...DEFAULT_JOB_OPTS,
        // jobId estable = deduplicación. 10 ediciones seguidas → 1 sincronización.
        jobId:    opts.urgent ? `sync:loc:${locationId}:urgent:${opts.correlationId}`
                              : `sync:loc:${locationId}`,
        delay:    opts.urgent ? 0 : (opts.delayMs ?? 30_000),
        priority: opts.urgent ? 1 : 10,
      },
    );
  }
}
```

```ts
// server/scheduling/infrastructure/queue/OutboxRelay.ts
import type { Pool } from 'pg';
import type { SyncQueuePort } from '../../domain/ports/SyncQueuePort.js';
import type { Logger } from 'pino';

/**
 * Publica los eventos de dominio pendientes. SKIP LOCKED permite varias
 * instancias sin duplicar trabajo ni bloquearse entre sí.
 */
export class OutboxRelay {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly pool: Pool,
    private readonly queue: SyncQueuePort,
    private readonly log: Logger,
    private readonly intervalMs = 1_000,
  ) {}

  start(): void { this.timer = setInterval(() => void this.tick(), this.intervalMs); }
  stop():  void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        SELECT id, aggregate_id, event_type, payload, correlation_id
          FROM outbox
         WHERE published_at IS NULL
         ORDER BY id
         LIMIT 100
           FOR UPDATE SKIP LOCKED
      `);

      for (const row of rows) {
        await this.queue.enqueueLocationSync(row.aggregate_id, {
          correlationId: row.correlation_id,
          trigger: row.payload?.urgent ? 'MANUAL' : 'USER_EDIT',
          urgent:  Boolean(row.payload?.urgent),
        });
        await client.query('UPDATE outbox SET published_at = now() WHERE id = $1', [row.id]);
      }

      await client.query('COMMIT');
      if (rows.length) this.log.debug({ count: rows.length }, 'outbox.published');
    } catch (err) {
      await client.query('ROLLBACK');
      // No se marca como publicado → se reintenta en el siguiente tick. At-least-once.
      this.log.error({ err }, 'outbox.relay.failed');
    } finally {
      client.release();
    }
  }
}
```

**Variante A (stack actual del repo), para sustituir BullMQ sin tocar nada más:**

```ts
// server/scheduling/infrastructure/queue/postgres/PgSyncQueue.ts
export class PgSyncQueue implements SyncQueuePort {
  constructor(private readonly pool: Pool) {}

  async enqueueLocationSync(locationId: string, opts: EnqueueSyncOptions): Promise<void> {
    // El índice único parcial hace de deduplicación: si ya hay un trabajo pendiente
    // para esta localización, sólo se adelanta su fecha de ejecución.
    await this.pool.query(`
      INSERT INTO sync_jobs (location_id, run_at, trigger, correlation_id, status, priority)
      VALUES ($1, now() + ($2 || ' milliseconds')::interval, $3, $4, 'PENDING', $5)
      ON CONFLICT (location_id) WHERE status = 'PENDING'
      DO UPDATE SET run_at   = LEAST(sync_jobs.run_at, EXCLUDED.run_at),
                    priority = LEAST(sync_jobs.priority, EXCLUDED.priority)
    `, [locationId, opts.urgent ? 0 : (opts.delayMs ?? 30_000),
        opts.trigger, opts.correlationId, opts.urgent ? 1 : 10]);
  }
}
```
El worker reclama con el mismo patrón que `IntegrationWorker.ts` ya usa:
`UPDATE sync_jobs SET status='RUNNING' WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT 5) RETURNING *`.

### 13.8 Caso de uso de sincronización (el corazón)

```ts
// server/scheduling/application/SyncLocationHoursUseCase.ts
import { compileSchedule } from '../domain/services/ScheduleCompiler.js';
import { projectRegularHours, projectSpecialHours, hashPayload }
  from '../domain/services/GoogleHoursProjector.js';
import { detectConflict } from '../domain/services/ConflictDetector.js';
import { GoogleApiError } from '../infrastructure/google/errors.js';
import type { /* puertos */ } from '../domain/ports/index.js';

export interface SyncInput {
  locationId: string;
  correlationId: string;
  trigger: 'USER_EDIT' | 'NIGHTLY' | 'MANUAL' | 'RETRY' | 'GOOGLE_UPDATE' | 'HOLIDAY_IMPORT';
  attempt: number;
}
export type SyncOutcome =
  | { status: 'SUCCESS';  runId: string; changed: string[] }
  | { status: 'NO_OP';    runId: string }
  | { status: 'SKIPPED';  runId: string; reason: string }
  | { status: 'CONFLICT'; runId: string; conflictId: string };

/** Ventana móvil: Google sólo muestra horarios especiales cercanos, y los pasados sobran. */
const WINDOW_DAYS_AHEAD  = 365;
const WINDOW_DAYS_BEHIND = 7;      // pequeño margen: cambios de última hora sobre ayer

export class SyncLocationHoursUseCase {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly rules: CalendarRuleRepository,
    private readonly links: GoogleLocationRepository,
    private readonly runs: SyncRunRepository,
    private readonly google: GoogleBusinessPort,
    private readonly clock: ClockPort,
    private readonly log: Logger,
  ) {}

  async execute(input: SyncInput): Promise<SyncOutcome> {
    const log = this.log.child({ correlationId: input.correlationId, locationId: input.locationId });

    const link = await this.links.findByLocationId(input.locationId);
    if (!link)              return this.skip(input, 'Sin ficha de Google vinculada');
    if (!link.syncEnabled)  return this.skip(input, 'Sincronización desactivada');

    const run = await this.runs.start({
      googleLocationId: link.id, correlationId: input.correlationId,
      trigger: input.trigger, attempt: input.attempt,
    });

    try {
      // 1 · ESTADO DESEADO ────────────────────────────────────────────────
      const window = this.clock.window(WINDOW_DAYS_BEHIND, WINDOW_DAYS_AHEAD);
      const [weekly, calendarRules] = await Promise.all([
        this.schedules.findActiveByLocation(input.locationId),
        this.rules.findPublishableInWindow(input.locationId, window),
      ]);

      const calendar = compileSchedule(weekly, calendarRules, window);
      const desired  = {
        regularHours: { periods: projectRegularHours(weekly) },
        specialHours: { specialHourPeriods: projectSpecialHours(calendar, weekly) },
      };
      const desiredHash = hashPayload(desired);
      await this.runs.event(run.id, 'COMPILE', 'Calendario compilado', {
        days: calendar.size, rules: calendarRules.length,
        regular: desired.regularHours.periods.length,
        special: desired.specialHours.specialHourPeriods.length,
      });

      // 2 · ESTADO OBSERVADO ──────────────────────────────────────────────
      const ref = { accountId: link.googleAccountId };
      const observed = await this.google.readHours(ref, link.googleLocationName);
      const observedHash = hashPayload(observed);

      // 3 · ¿ALGUIEN TOCÓ GOOGLE? ─────────────────────────────────────────
      if (link.observedHash && link.observedHash !== observedHash) {
        const conflict = detectConflict(desired, observed, link.conflictPolicy);
        if (conflict.requiresHumanDecision) {
          const saved = await this.links.openConflict(link.id, desired, observed, conflict.diff);
          await this.runs.finish(run.id, { status: 'CONFLICT', observedHashBefore: observedHash });
          log.warn({ runId: run.id }, 'sync.conflict');
          return { status: 'CONFLICT', runId: run.id, conflictId: saved.id };
        }
        // APP_WINS: se sobrescribe, PERO queda registrado. Nunca en silencio.
        await this.runs.event(run.id, 'DIFF', 'Cambio externo sobrescrito (APP_WINS)', conflict.diff);
      }

      // 4 · NO-OP: el ahorro que hace escalable el sistema ────────────────
      if (desiredHash === observedHash) {
        await this.links.markSynced(link.id, desiredHash, observedHash, this.clock.now());
        await this.runs.finish(run.id, { status: 'NO_OP', desiredHash, observedHashAfter: observedHash });
        return { status: 'NO_OP', runId: run.id };
      }

      // 5 · PATCH ─────────────────────────────────────────────────────────
      await this.runs.event(run.id, 'PATCH', 'Enviando a Google', { desiredHash });
      await this.google.updateHours(ref, link.googleLocationName, desired);

      // 6 · VERIFICAR: 200 OK no garantiza publicación (ficha sin verificar, revisión…)
      const after     = await this.google.readHours(ref, link.googleLocationName);
      const afterHash = hashPayload(after);
      const applied   = afterHash === desiredHash;

      await this.links.markSynced(link.id, desiredHash, afterHash, this.clock.now());
      await this.runs.finish(run.id, {
        status: 'SUCCESS', desiredHash, observedHashBefore: observedHash,
        observedHashAfter: afterHash, requestPayload: desired,
        note: applied ? undefined : 'Enviado pero aún no reflejado (posible revisión de Google)',
      });

      log.info({ runId: run.id, applied }, 'sync.success');
      return { status: 'SUCCESS', runId: run.id, changed: ['regularHours', 'specialHours'] };

    } catch (err) {
      const isGoogle = err instanceof GoogleApiError;
      await this.runs.finish(run.id, {
        status: 'FAILED',
        errorCode:    isGoogle ? err.errorClass : 'INTERNAL',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      await this.links.registerFailure(link.id, err instanceof Error ? err.message : String(err));

      // Sólo se relanza si tiene sentido reintentar: así BullMQ no repite
      // seis veces un 400 que nunca va a funcionar.
      if (isGoogle && !err.retryable) {
        this.log.error({ err, runId: run.id }, 'sync.permanent_failure');
        return { status: 'SKIPPED', runId: run.id, reason: err.message };
      }
      throw err;
    }
  }

  private async skip(input: SyncInput, reason: string): Promise<SyncOutcome> {
    const run = await this.runs.startAndSkip(input, reason);
    return { status: 'SKIPPED', runId: run.id, reason };
  }
}
```

### 13.9 Worker

```ts
// server/scheduling/workers/syncWorker.ts
import { Worker, type Job } from 'bullmq';
import { SYNC_QUEUE } from '../infrastructure/queue/bullmq/BullSyncQueue.js';
import { buildContainer } from '../container.js';

export function startSyncWorker(connection: { host: string; port: number }) {
  const { syncLocationHours, dlq, log } = buildContainer();

  const worker = new Worker(
    SYNC_QUEUE,
    async (job: Job) => syncLocationHours.execute({
      locationId:    job.data.locationId,
      correlationId: job.data.correlationId,
      trigger:       job.data.trigger,
      attempt:       job.attemptsMade + 1,
    }),
    {
      connection,
      concurrency: Number(process.env.SYNC_CONCURRENCY ?? 10),
      // Respeta la cuota de Google (300 QPM ≈ 5 QPS; 3 llamadas por job → margen amplio)
      limiter: { max: 60, duration: 60_000 },
    },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    log.error({ jobId: job.id, attempt: job.attemptsMade, err: err.message }, 'sync.job.failed');
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await dlq.add('dead', { ...job.data, lastError: err.message, attempts: job.attemptsMade });
      log.error({ jobId: job.id }, 'sync.job.dlq');
      // → alerta al canal de operaciones
    }
  });

  worker.on('completed', (job, result) =>
    log.info({ jobId: job.id, status: result?.status }, 'sync.job.completed'));

  return worker;
}
```

```ts
// server/scheduling/workers/reconcileWorker.ts — el nocturno
export function registerReconcileJob(queue: Queue) {
  return queue.add('reconcile.all', {}, {
    repeat: { pattern: '0 3 * * *', tz: 'Europe/Madrid' },
    jobId: 'reconcile:all',
  });
}

export async function reconcileAll(deps: Deps): Promise<void> {
  const BATCH = 500;
  let cursor: string | undefined;

  do {
    const page = await deps.links.pageEnabled(cursor, BATCH);
    for (const link of page.items) {
      // Escalonado determinista: reparte la carga en 3 h en vez de un pico a las 03:00
      const delayMs = hashToRange(link.id, 0, 3 * 60 * 60 * 1000);
      await deps.queue.enqueueLocationSync(link.locationId, {
        correlationId: `nightly-${deps.clock.today()}-${link.id}`,
        trigger: 'NIGHTLY',
        delayMs,
      });
    }
    cursor = page.nextCursor;
  } while (cursor);
}
```

### 13.10 Controladores

```ts
// server/scheduling/interfaces/http/scheduleController.ts
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const periodSchema = z.object({
  start: z.string().regex(/^\d{1,2}:\d{2}$/),
  end:   z.string().regex(/^\d{1,2}:\d{2}$/),
});

const updateWeeklySchema = z.object({
  version: z.number().int().nonnegative(),
  days: z.array(z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    periods: z.array(periodSchema).max(4),   // 4 tramos ya es mucho; más, sospechoso
  })).length(7),
});

export function scheduleRoutes(deps: Deps): Router {
  const router = Router();

  router.put('/locations/:locationId/weekly-schedule',
    requireSupervisorRole,
    async (req, res) => {
      const parsed = updateWeeklySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
      }
      const correlationId = (req.header('X-Correlation-Id') ?? randomUUID());

      try {
        const result = await deps.updateWeeklySchedule.execute({
          locationId: req.params.locationId,
          tenantId:   req.session.empresaId,        // aislamiento multi-tenant obligatorio
          userId:     req.session.username,
          correlationId,
          ...parsed.data,
        });

        // 202: la escritura está confirmada; la sincronización con Google va aparte.
        // Devolver 200 sugeriría que Google ya está actualizado, y sería mentira.
        return res.status(202).json({
          scheduleId: result.scheduleId,
          version:    result.version,
          syncStatus: 'PENDING',
          correlationId,
        });
      } catch (err) {
        if (err instanceof VersionConflictError) {
          return res.status(409).json({
            error: 'El horario fue modificado por otro usuario',
            currentVersion: err.currentVersion,
          });
        }
        deps.log.error({ err, correlationId }, 'schedule.update.failed');
        return res.status(500).json({ error: 'No se pudo guardar el horario' });
      }
    });

  // Vista previa: el frontend NO recalcula la precedencia por su cuenta.
  router.post('/locations/:locationId/schedule/preview',
    protectWhenStrict(requirePanelRole),
    async (req, res) => {
      const preview = await deps.previewCalendar.execute({
        locationId: req.params.locationId,
        tenantId:   req.session.empresaId,
        from: req.body.from, to: req.body.to,
        draftRules: req.body.draftRules,   // reglas aún sin guardar → "¿qué pasaría si…?"
      });
      res.json(preview);
    });

  return router;
}
```

```ts
// server/scheduling/application/UpdateWeeklyScheduleUseCase.ts
export class UpdateWeeklyScheduleUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: ClockPort) {}

  async execute(input: UpdateWeeklyScheduleInput): Promise<{ scheduleId: string; version: number }> {
    // Validación en el DOMINIO, no en el controlador: solapes, tramos inválidos…
    const schedule = WeeklySchedule.fromInput(input.days);

    // Una transacción: cambio + evento. O ambos, o ninguno.
    return this.uow.transaction(async (tx) => {
      const current = await tx.schedules.findActiveByLocation(input.locationId, input.tenantId);
      if (current && current.version !== input.version) {
        throw new VersionConflictError(current.version);   // bloqueo optimista
      }

      const saved = await tx.schedules.save(input.locationId, schedule, {
        expectedVersion: input.version, updatedBy: input.userId,
      });

      await tx.outbox.append({
        aggregateType: 'BusinessLocation',
        aggregateId:   input.locationId,
        eventType:     'ScheduleChanged',
        correlationId: input.correlationId,
        payload: { scheduleId: saved.id, version: saved.version },
      });

      await tx.links.markPending(input.locationId);
      await tx.audit.record({ /* app_auditoria: quién, qué, cuándo, desde dónde */ });

      return { scheduleId: saved.id, version: saved.version };
    });
  }
}
```

### 13.11 Composition root

```ts
// server/scheduling/container.ts — el único sitio donde se hace `new`
export function buildContainer() {
  const log    = createLogger();
  const prisma = getPrismaClient();
  const pool   = getPgPool();

  const cipher = new TokenCipher(loadKeyring(), process.env.TOKEN_ACTIVE_KID!);
  const oauth  = new GoogleOAuthService(prisma, cipher, log);

  // Sin cuota de Google todavía → simulador. Todo lo demás es idéntico.
  const google: GoogleBusinessPort = process.env.GOOGLE_GBP_ENABLED === 'true'
    ? new GoogleBusinessAdapter(new GoogleBusinessProfileClient(oauth, log))
    : new SimulatedGoogleAdapter(log);

  const queue: SyncQueuePort = process.env.QUEUE_DRIVER === 'bullmq'
    ? new BullSyncQueue(new Queue(SYNC_QUEUE, { connection: redisConn() }))
    : new PgSyncQueue(pool);

  const syncLocationHours = new SyncLocationHoursUseCase(
    new PrismaScheduleRepository(prisma),
    new PrismaCalendarRuleRepository(prisma),
    new PrismaGoogleLocationRepository(prisma),
    new PrismaSyncRunRepository(prisma),
    google,
    new SystemClock('Europe/Madrid'),
    log,
  );

  return { syncLocationHours, queue, google, oauth, log, /* … */ };
}
```

### 13.12 Tests

El compilador y el proyector son puros: se prueban sin BD, sin red y sin *mocks*. Ahí es donde deben
concentrarse los tests, porque ahí es donde están las reglas de negocio.

```ts
// server/scheduling/domain/services/ScheduleCompiler.test.ts
import { describe, it, expect } from 'vitest';   // ya está en el repo

describe('ScheduleCompiler · precedencia', () => {
  it('las vacaciones ganan al horario semanal', () => {
    const cal = compileSchedule(weeklyLunToSab, [vacacionesAgosto], win('2026-08-01','2026-08-31'));
    expect(cal.get('2026-08-05')!.isClosed).toBe(true);
    expect(cal.get('2026-08-25')!.isClosed).toBe(false);   // fuera del rango
  });

  it('la apertura extraordinaria gana al festivo', () => {
    const cal = compileSchedule(weekly, [festivo8nov, aperturaDomingo8nov], win('2026-11-01','2026-11-30'));
    const dia = cal.get('2026-11-08')!;
    expect(dia.isClosed).toBe(false);
    expect(dia.periods[0].toStrings()).toEqual({ start: '10:00', end: '14:00' });
  });

  it('el cierre por avería gana a la apertura extraordinaria', () => {
    const cal = compileSchedule(weekly, [aperturaDomingo8nov, averia8nov], win('2026-11-01','2026-11-30'));
    expect(cal.get('2026-11-08')!.isClosed).toBe(true);
    expect(cal.get('2026-11-08')!.source).toMatchObject({ ruleType: 'CLOSURE' });
  });

  it('OPEN_AS_USUAL abre un día dentro de las vacaciones', () => {
    const cal = compileSchedule(weekly, [vacacionesAgosto, abrimosEl10], win('2026-08-01','2026-08-31'));
    expect(cal.get('2026-08-10')!.isClosed).toBe(false);
    expect(cal.get('2026-08-11')!.isClosed).toBe(true);
  });
});

describe('GoogleHoursProjector', () => {
  it('expande las vacaciones a un periodo por día (Google rechaza ≥24 h)', () => {
    const cal = compileSchedule(weekly, [vacaciones1al20], win('2026-08-01','2026-08-31'));
    const special = projectSpecialHours(cal, weekly);
    const cerrados = special.filter(p => p.closed);
    expect(cerrados).toHaveLength(20);
    expect(cerrados.every(p => !p.endDate || p.endDate.day === p.startDate.day)).toBe(true);
  });

  it('el horario partido son dos periodos del mismo día', () => {
    expect(projectRegularHours(weeklyPartido).filter(p => p.openDay === 'MONDAY')).toHaveLength(2);
  });

  it('el hash ignora los ceros omitidos (evita sincronizar en bucle)', () => {
    const a = { regularHours: { periods: [{ openDay:'MONDAY', openTime:{hours:15},
                 closeDay:'MONDAY', closeTime:{hours:18,minutes:30} }] },
                specialHours: { specialHourPeriods: [] } };
    const b = structuredClone(a);
    (b.regularHours.periods[0].openTime as any).minutes = 0;   // como lo devuelve Google
    expect(hashPayload(a)).toBe(hashPayload(b));
  });
});
```

Y por encima: tests de integración del caso de uso con el `SimulatedGoogleAdapter` (incluidos escenarios de
429, 400 y conflicto), más contract tests grabados contra la API real cuando llegue la cuota.

---

## 14. Buenas prácticas y justificación de cada decisión

### 14.1 Clean Architecture

**Cómo se aplica:** cuatro anillos (`domain` → `application` → `infrastructure`/`interfaces`) con la regla
de dependencia apuntando siempre hacia dentro. El dominio no conoce Express, ni Prisma, ni `fetch`.

**Por qué aquí concretamente:** la API de Google Business Profile **ya ha cambiado dos veces** (v3 → v4 →
familia v1) y volverá a cambiar. Si `ScheduleCompiler` importara el SDK de Google, cada reorganización de
Google obligaría a reescribir la lógica de negocio. Con la inversión de dependencias, un cambio de API es
un archivo nuevo en `infrastructure/google/`.

**Alternativa descartada:** arquitectura en capas clásica (controller → service → repository) con el modelo
de Google filtrándose hacia arriba. Más rápida de escribir, pero acopla las reglas de negocio a un tercero
sobre el que no tienes ningún control. Aquí el tercero es notoriamente inestable: no compensa.

**Coste asumido:** más archivos e indirección. Para un CRUD simple sería sobreingeniería; para un sistema
con un motor de reglas, dos fuentes de verdad en conflicto y un tercero volátil, se paga solo.

### 14.2 SOLID

| Principio | Dónde se ve | Qué evita |
|---|---|---|
| **S**RP | `ScheduleCompiler` sólo compila; `GoogleHoursProjector` sólo traduce; `SyncLocationHoursUseCase` sólo orquesta | El clásico `GoogleSyncService` de 800 líneas que nadie se atreve a tocar |
| **O**CP | Añadir `CLOSURE_BY_STRIKE` es una fila de catálogo; añadir Bing Places es un adaptador nuevo | Modificar el compilador cada vez que el negocio inventa un tipo de cierre |
| **L**SP | `SimulatedGoogleAdapter` y `GoogleBusinessAdapter` son intercambiables **de verdad**: mismos errores, misma semántica | Que los tests pasen con el simulador y todo reviente en producción |
| **I**SP | `GoogleBusinessPort` expone 6 métodos, no los 200 de la API | Mocks gigantes y acoplamiento a superficie que no usas |
| **D**IP | Los casos de uso reciben puertos; el `container` decide implementaciones | No poder testear sin Redis, sin Postgres y sin conexión a Google |

### 14.3 Domain-Driven Design

**Lenguaje ubicuo.** Los nombres del código son los del negocio, en el idioma del negocio cuando aporta:
*horario semanal*, *festivo*, *vacaciones*, *cierre excepcional*, *apertura extraordinaria*. Un
`EXTRA_OPENING` no es "un `specialHourPeriod` con horas": es una decisión comercial. Mantener esa distinción
es lo que permite que la §9 pueda rechazar la estrategia "Google gana" con un argumento sólido — porque
Google no tiene ese vocabulario y al importar se pierde.

**Agregados y sus fronteras.** `BusinessLocation` es la raíz de agregado: horario semanal y reglas de
calendario sólo se modifican a través de ella, lo que hace que "no puede haber tramos solapados en un día"
sea un invariante garantizado y no una comprobación olvidada en un endpoint. `GoogleLocationLink` es un
agregado **aparte** a propósito: su ciclo de vida (tokens, estado de sync, conflictos) es independiente del
calendario, y no queremos que un fallo de Google bloquee la edición del horario.

**Value objects.** `TimeRange` y `DayPlan` son inmutables y se validan al crearse. Consecuencia práctica:
es **imposible** que exista en memoria un `TimeRange` con fin anterior al inicio. La validación deja de ser
un `if` que alguien puede olvidar.

**Eventos de dominio.** `ScheduleChanged`, `VacationScheduled`, `SyncFailed`, `ConflictDetected`. Desacoplan
"lo que pasó en el negocio" de "quién reacciona". Mañana, el módulo de citas podrá suscribirse a
`VacationScheduled` para reprogramar reservas sin que el calendario sepa que existe.

**Servicios de dominio.** El compilador no encaja en ninguna entidad (opera sobre varias): es un servicio
de dominio puro, no un "manager" con estado.

**Lo que NO aplicamos:** ni event sourcing ni CQRS. El historial completo lo dan `sync_runs` y
`app_auditoria`; reconstruir el estado desde un log de eventos añadiría una complejidad enorme para un
problema —"¿cuál es el horario de este taller?"— que una fila en una tabla responde perfectamente.

### 14.4 Repository Pattern

**Aplicado:** un repositorio por agregado, con interfaz en `domain/ports` e implementación Prisma en
`infrastructure/prisma`.

**Justificación real, más allá del dogma:**
1. **Testabilidad.** Los casos de uso se prueban con repositorios en memoria: los tests corren en
   milisegundos y sin Docker.
2. **Aislamiento multi-tenant.** El `tenantId` es obligatorio en la firma del repositorio. No es posible
   escribir por descuido una consulta sin filtrar — el compilador de TypeScript lo impide. En un sistema
   donde una fuga de tenant significa publicar el horario de una empresa en la ficha de otra, esto no es
   purismo: es un control de seguridad.
3. **Migración A→B sin dolor.** Sustituir `PrismaScheduleRepository` por `PgScheduleRepository` no toca
   ningún caso de uso.

**Unit of Work** para la atomicidad cambio+outbox: sin él, el patrón outbox no puede garantizar nada.

**Contrapartida honesta:** el repositorio puede empujar hacia consultas genéricas ineficientes. Regla:
métodos con intención de negocio (`findPublishableInWindow`), no `findAll()` + filtrado en memoria. Y para
los informes del panel, saltarse el repositorio con SQL directo es legítimo: es una preocupación de lectura,
no del dominio.

### 14.5 Event Driven Architecture: dónde sí y dónde no

**Sí, dentro del proceso** (eventos de dominio + outbox + cola). El acoplamiento temporal entre "guardar el
horario" y "actualizar Google" es exactamente el problema que resuelve: el usuario no debe esperar a Google
ni sufrir sus fallos.

**No, entre servicios distribuidos.** Nada de Kafka ni de un bus de eventos entre microservicios. Mobilink es
un monolito modular y debe seguir siéndolo: con este volumen, un bus distribuido añadiría consistencia
eventual, trazabilidad difícil y coste operativo a cambio de nada.

**Elección deliberada — orquestación, no coreografía.** El `SyncLocationHoursUseCase` orquesta pasos
explícitos (compilar → leer → comparar → escribir → verificar) en lugar de encadenar eventos. Un flujo
coreografiado sería más "elegante" y **mucho** más difícil de depurar cuando un cliente pregunta por qué su
horario no aparece en Google. Aquí la trazabilidad vale más que el desacoplamiento.

### 14.6 Resumen de decisiones técnicas

| Decisión | Elegido | Alternativa | Por qué |
|---|---|---|---|
| Modelo de sincronización | Reconciliación declarativa | Propagación de deltas | Idempotente, autorreparable, y Google exige el array completo de todos modos |
| Momento de la llamada | Asíncrona (cola) | Síncrona en el `PUT` | El usuario no debe esperar ni ver errores de un tercero |
| Publicación de eventos | Outbox transaccional | `queue.add()` tras el commit | Evita el fallo silencioso "guardado pero nunca sincronizado" |
| Agrupación | `jobId` + `delay` 30 s | Sincronizar cada cambio | 15 ediciones → 1 llamada; ahorra cuota y evita carreras |
| Detección de no-op | Hash canónico | `PATCH` siempre | ~95 % de las noches no hay cambios: es lo que hace viable 10.000 negocios |
| Reintentos | Clasificados por tipo de error | 3 intentos para todo | Reintentar un `400` seis veces es ruido; no reintentar un `429` es perder el cambio |
| Vacaciones en Google | `specialHours` día a día | Un periodo largo / `CLOSED_TEMPORARILY` | Google rechaza periodos ≥24 h; `CLOSED_TEMPORARILY` daña el SEO local |
| Conflictos | Híbrido por campo | Siempre "la app gana" | El horario semanal es intención de negocio; los especiales son urgencias legítimas |
| Reglas de calendario | Tabla única polimórfica | Una tabla por tipo | El compilador las trata igual; añadir un tipo es una fila, no un despliegue |
| Horas | Minutos desde medianoche | `TIME` / `TIMESTAMP` | Aritmética trivial, y admite cierres pasada la medianoche |
| Festivos locales | IA + confirmación humana | Automático puro | No existe fuente fiable; cerrar un día equivocado es un daño real al cliente |
| Zona horaria | Fecha civil + minutos locales | Instantes UTC | "Abrimos a las 8:30" es local siempre; UTC rompe dos veces al año |
| Cola | Postgres → BullMQ | BullMQ desde el día 1 | Menos infra hasta ~1.000 negocios; el puerto hace que migrar sea trivial |
| Tokens | AES-256-GCM con `kid` | Texto plano / cifrado sin rotación | Rotar la clave sin parada, y `business.manage` es un scope demasiado potente |

### 14.7 Observabilidad como requisito, no como extra

Un sistema que actúa **solo, de noche, sobre la ficha pública de un cliente** necesita poder responder a
"¿por qué el horario de mi negocio en Google dice esto?" en menos de un minuto. Mínimo exigible:

- `correlationId` propagado extremo a extremo (ya es convención en el Integration Hub).
- Cada `sync_run` guarda el `request_payload` exacto → se puede reproducir el estado enviado.
- El `DayPlan.source` explica **por qué** cada día es como es → la UI puede decir "cerrado por: Vacaciones
  de agosto" en vez de "cerrado".
- Alertas con umbral, no por evento: "más del 5 % de sincronizaciones fallando en 15 min", "conflictos
  abiertos > 20", "cuentas `NEEDS_REAUTH` > 0", "profundidad de cola > 5.000".
- SLO propuesto: **95 % de los cambios reflejados en Google en menos de 5 minutos**; 99,5 % en 24 h
  (gracias al nocturno).

### 14.8 Riesgos conocidos y mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Aprobación de cuota denegada o lenta** | Bloquea todo el proyecto | Solicitarla el día 1; desarrollar con simulador; el producto sigue teniendo valor sin Google (agenda interna) |
| Google reorganiza la API otra vez | Reescritura del adaptador | Puerto propio + contract tests; sólo cambia `infrastructure/google/` |
| Fichas sin verificar: el `PATCH` no se aplica | El usuario cree que sincronizó | Verificación post-`PATCH` y estado `PENDING_REVIEW` explícito en la UI |
| Festivos locales erróneos por IA | Cerrar un día equivocado | Nunca se publican sin verificación humana |
| Usuario edita en Google en paralelo | Cambios revertidos | Política híbrida (§9) + registro visible de lo sobrescrito |
| Cambio de horario de verano (DST) | Horarios desplazados una hora | Fechas civiles + minutos locales, nunca UTC; tests con fechas de cambio de hora |
| Token revocado sin avisar | Sincronización muerta y silenciosa | `tokens.audit` diario + notificación al administrador del tenant |
| Reglas contradictorias del usuario | Calendario inesperado | Precedencia explícita y determinista + vista previa antes de guardar |

### 14.9 Hoja de ruta sugerida

| Fase | Alcance | Resultado |
|---|---|---|
| **0** | Solicitar cuota GBP + crear proyecto Cloud + pantalla OAuth | Desbloquea el camino crítico (semanas de espera) |
| **1** | Modelo de datos + migración de `agendaConfig` → tablas nuevas + compilador + tests | Mobilink es ya la fuente única de verdad, aunque sin Google |
| **2** | UI completa: semanal, festivos, vacaciones, cierres, aperturas + vista previa | Valor entregado al cliente **sin depender de Google** |
| **3** | OAuth + vinculación de fichas + `SimulatedGoogleAdapter` | Flujo completo probado sin cuota |
| **4** | Adaptador real + cola + worker + reintentos + panel de sincronización | Sincronización automática en producción |
| **5** | Reconciliación nocturna + detección y resolución de conflictos + Pub/Sub | Robustez y autorreparación |
| **6** | Importación de festivos multi-fuente + verificación | Automatización del calendario laboral |
| **7** | Escalado: métricas, particionado, colas por prioridad, rate limiting por cuenta | Preparado para miles de negocios |

El orden no es casual: **las fases 1 y 2 entregan valor real aunque la cuota de Google nunca llegue.** Es la
forma de que el camino crítico externo no bloquee al equipo ni al cliente.

---

## Anexo · Referencias

- [Method: locations.patch — Business Profile APIs](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch)
- [REST Resource: accounts.locations](https://developers.google.com/my-business/reference/rest/v4/accounts.locations)
- [Method: locations.getGoogleUpdated](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/getGoogleUpdated)
- [Package google.mybusiness.businessinformation.v1](https://developers.google.com/my-business/reference/businessinformation/rpc/google.mybusiness.businessinformation.v1)
- [Usage limits — Business Profile APIs](https://developers.google.com/my-business/content/limits)
- [Prerequisites — Business Profile APIs](https://developers.google.com/my-business/content/prereqs)
- [Manage Google Updates](https://developers.google.com/my-business/content/accept-or-reject-updates)
- [Work with location data](https://developers.google.com/my-business/content/location-data)
- [SpecialHours — referencia de la librería cliente Java](https://googleapis.dev/java/google-api-services-mybusinessbusinessinformation/latest/com/google/api/services/mybusinessbusinessinformation/v1/model/SpecialHours.html)
- [Cómo configurar horarios especiales (Ayuda de Google Business Profile)](https://support.google.com/business/answer/6303076)
- [Nager.Date — API pública de festivos](https://date.nager.at/api/v3/PublicHolidays/2026/ES)

**Documentos internos relacionados:** `PROMPT_MOBILINK_INTEGRATION_HUB.md` (§2.3 contratos de conectores,
§2.5 gestor de colas, §2.8 secretos), `server/integration-hub/workers/IntegrationWorker.ts` (patrón de
reintentos ya implementado en el repositorio).
