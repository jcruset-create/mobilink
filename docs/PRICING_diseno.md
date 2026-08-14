# Motor de Tarifas — FASE 2: Diseño

Documento de diseño previo a las migraciones. Nada de esto está implementado
todavía. Continúa [`PRICING_auditoria_arquitectura.md`](PRICING_auditoria_arquitectura.md).

---

## 1. Contexto confirmado

SEAS es un **centro de control** (caso A): recibe la petición de su cliente,
busca taller, el taller le factura el precio de compra y ella factura a su
cliente el precio de venta. Es además un comprador potencial de licencia, así
que convivirá con otros centros en la misma base.

De ahí, dos consecuencias que gobiernan todo lo demás:

1. **El multi-tenant deja de ser teórico.** Cerrar el aislamiento por centro de
   control es requisito previo, no mejora.
2. **Compra y venta son el mismo tarifario visto desde dos lados.** No son dos
   columnas de una tabla.

---

## 2. Decisión central: el tarifario no sabe si es de compra o de venta

En la auditoría propuse que cada regla llevara `purchase_price` y `sale_price`.
**Queda descartado.** Obligaría a duplicar los importes de SEAS en dos columnas
idénticas y a acordarse de cambiar las dos cuando suba un precio.

El modelo correcto:

- una **regla** produce **un único importe**;
- el **contrato** que apunta al tarifario es quien dice si ese importe es
  compra o venta.

```
connect_control_centers          (tenant — ya existe)
    ├── connect_clients          (ya existe)  ──┐
    └── connect_provider_companies (ya existe) ─┤
                                                ↓
                                    connect_contracts   role = sale | purchase
                                                ↓
                                    connect_tariff_plans        (neutro)
                                                ↓
                                    connect_tariff_versions     (vigencia + estado)
                                                ↓
                                    reglas, franjas, zonas, extras, neumáticos
```

Para SEAS: **una** versión "SEAS Nacional 2026", y dos contratos apuntando a
ella —el del cliente con `role='sale'`, el del taller con `role='purchase'`—.
Margen cero, correcto y explicable. El día que un taller pacte un 10 % menos,
su contrato apunta a otra versión: sin tocar código.

**Matiz importante:** una regla da un importe, pero una **línea de precio** sí
lleva las dos columnas, porque el mismo concepto (el forfait) se compra y se
vende. La línea guarda las dos reglas de origen por separado.

---

## 3. Esquema

Prefijo `connect_` para no partir el esquema en dos estilos. DDL idempotente en
`server/connect/pricing/schema.ts`, invocado desde `initConnect()`.

**Convenciones para todas las tablas nuevas:**

- `"controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id)`,
  con índice. Sin excepciones: es imposible insertar una fila huérfana.
- Importes `NUMERIC(14,4)`; porcentajes `NUMERIC(7,4)`. **Nunca `double`.**
- Tiempos en `BIGINT` de milisegundos, como el resto de Central.
- RLS activada con políticas por `controlCenterId` desde el primer día. El
  service role se las salta hoy, pero el día que algo se exponga por PostgREST
  la protección ya está escrita.

### 3.1 Contratos y tarifarios

```
connect_contracts
  id, controlCenterId, role ('sale'|'purchase'),
  clientId → connect_clients          (obligatorio si role='sale')
  providerCompanyId → connect_provider_companies (obligatorio si role='purchase')
  workshopId → connect_workshops      (opcional: acuerdo con un taller concreto)
  tariffPlanId, code, name, currency ('EUR'),
  validFromMs, validToMs, status ('draft'|'active'|'ended'),
  notes, createdAtMs, updatedAtMs
  CHECK: exactamente una contraparte según el role

connect_tariff_plans
  id, controlCenterId, code, name, description,
  currency, timezone ('Europe/Madrid'), calendarId,
  active, createdAtMs, updatedAtMs
  UNIQUE (controlCenterId, code)

connect_tariff_versions
  id, tariffPlanId, version ('2026'), status ('draft'|'published'|'archived'),
  validFromMs, validToMs, priority INTEGER DEFAULT 0,
  publishedAtMs, publishedByUserId, sourceDocument, notes
  UNIQUE (tariffPlanId, version)
```

Una versión `published` **no se modifica nunca**. Corregir un precio = nueva
versión. Es lo que hace reproducible una asistencia de hace tres años.

### 3.2 Reglas de servicio

```
connect_tariff_rules
  id, tariffVersionId, code, name,
  -- dimensiones; NULL = "cualquiera"
  serviceTypeCode, vehicleTypeCode, zoneId, timeBandId,
  dayClasses TEXT[]          -- p.ej. {holiday_national, holiday_local}; NULL = cualquiera
  minDistanceKm, maxDistanceKm, minDurationMin, maxDurationMin,
  -- importe (uno solo: el papel lo pone el contrato)
  amount NUMERIC(14,4),
  includedDistanceKm NUMERIC(10,2), includedDurationMin INTEGER,
  -- extras ligados
  extraDistanceExtraId, extraDurationExtraId,
  -- disparo de los extras (§16, configurable)
  extraTriggerType ('ALWAYS'|'THRESHOLD_PERCENT'|'THRESHOLD_ABSOLUTE'),
  extraThresholdPercent NUMERIC(7,4),
  priority INTEGER NOT NULL DEFAULT 0,
  active, createdAtMs
```

La "regla del 20 %" del §16 es un dato: `extraTriggerType='THRESHOLD_PERCENT'`,
`extraThresholdPercent=20`. No aparece en el código.

### 3.3 Franjas horarias

```
connect_tariff_time_bands
  id, controlCenterId, code, name,
  startMinute INTEGER, endMinute INTEGER,   -- minutos desde medianoche, hora local
  weekdays INTEGER[],                       -- 1=lunes … 7=domingo
  weekdayAnchor ('moment'|'band_start') DEFAULT 'moment',
  active
```

Cruce de medianoche: si `startMinute > endMinute`, la franja es
`[start, 1440) ∪ [0, end)`.

`weekdayAnchor` resuelve una ambigüedad real de "L-V 19:00–08:00": el sábado a
las 02:00, ¿es nocturno de viernes o ya es sábado? Con `moment` se mira el día
real (sábado, no encaja); con `band_start`, la noche pertenece al día en que
empezó. **Por defecto `moment`**, que es lo explicable a un operador. Hay que
confirmarlo contra el tarifario de SEAS antes de cargarlo.

### 3.4 Calendario y tipos de día

```
connect_calendars
  id, controlCenterId, code, name, country, active

connect_calendar_days
  id, calendarId, date DATE, scope ('national'|'regional'|'provincial'|'local'|'special'),
  regionCode, provinceCode, municipality,
  dayClass TEXT,              -- 'holiday' | 'christmas' | 'new_year' | libre
  name, yearly BOOLEAN, active
  UNIQUE (calendarId, date, scope, COALESCE(municipality,''))
```

El resolutor devuelve **una lista ordenada** de clases aplicables a una fecha y
un lugar, de la más específica a la más general. Para el 25 de diciembre:

```
['christmas', 'holiday_national', 'holiday', 'weekday_4']
```

Una regla casa si **alguna** de sus `dayClasses` está en la lista. La prioridad
decide cuál gana. Así el test del §37 (Navidad a las 22:00 → FESTIVOS EXTRA, no
NOCTURNO) sale de la configuración, no de un `if`.

El endpoint que ya existe (`/api/agenda-config/festivos-ia`, que propone los 14
festivos de un municipio) se reutiliza para **proponer** días; publicarlos sigue
siendo un acto manual.

### 3.5 Zonas

```
connect_tariff_zones
  id, controlCenterId, code, name,
  type ('COUNTRY'|'COUNTRY_GROUP'|'REGION'|'PROVINCE'|'CUSTOM'|'ROAD_NETWORK'|'PRIVATE_HIGHWAY'),
  priority, active

connect_tariff_zone_members
  id, zoneId, matchType ('country'|'region'|'province'|'postal_prefix'|'road'|'polygon'),
  value TEXT,               -- 'ES', '43', 'AP-7'…
  polygon JSONB             -- GeoJSON, para CUSTOM
```

**Limitación conocida:** la asistencia guarda `latitude`, `longitude` y
`address`, pero **no** provincia ni país. Para la v1 la zona se resuelve por
geocodificación inversa en el momento del bloqueo, y el resultado queda en el
snapshot para no repetir la llamada. Las zonas de polígono quedan modeladas
pero sin resolutor hasta una fase posterior; mientras tanto, no casan y se
avisa con `ZONE_NOT_RESOLVED`.

### 3.6 Extras

```
connect_tariff_extras
  id, tariffVersionId, code, name,
  calculationType ('FIXED'|'PER_UNIT'|'PER_KM'|'PER_MINUTE'|'PER_HOUR'|'PERCENTAGE'|'FORMULA'),
  amount NUMERIC(14,4), percentage NUMERIC(7,4),
  unit TEXT, appliesTo ('assistance'|'forfait'|'line'),
  conditions JSONB, priority, active
```

`FORMULA` queda declarado pero **sin evaluador** en la v1: si aparece, el motor
avisa y manda a revisión manual. Prefiero eso a un intérprete de expresiones a
medio hacer.

Cancelaciones (§31) son un extra con `calculationType='PERCENTAGE'`,
`appliesTo='forfait'` y `conditions={"requires":"service_ordered"}`.

### 3.7 Neumáticos

```
connect_tire_sizes    id, controlCenterId, width, aspectRatio, rimDiameter NUMERIC(4,1),
                      normalizedCode, active   UNIQUE (controlCenterId, normalizedCode)
connect_tire_brands   id, controlCenterId, code, name, normalizedName, active
connect_tire_brand_groups          id, tariffVersionId, code, name
connect_tire_brand_group_members   id, groupId, brandId

connect_tariff_tire_prices
  id, tariffVersionId, tireSizeId,
  brandId, brandGroupId,                 -- uno de los dos
  position ('STEER'|'DRIVE'|'TRAILER'|'ANY'),
  priceModel ('NET_PRICE'|'DISCOUNT_FROM_LIST'),
  netAmount NUMERIC(14,4),
  discountPercent NUMERIC(7,4), manufacturerPriceListId,
  priority, active

connect_manufacturer_price_lists   id, controlCenterId, brandId, name, validFromMs, validToMs
connect_manufacturer_tire_prices   id, priceListId, tireSizeId, model, listPrice NUMERIC(14,4)
```

El grupo de marca cuelga de **la versión tarifaria**, no de la marca: que
Hankook sea `IMPORT_1` para SEAS no obliga a que lo sea para otro cliente
(§27).

La normalización de medidas **no se reescribe**: se extrae `medidaCanonica()` /
`baseMedida()` de `src/modules/tyrecontrol/services/medidas.ts` a un módulo
compartido, para que Central y TyreControl escriban las medidas igual y un
puente futuro sea posible. Es lo que justifica tener catálogo propio en vez de
duplicar por duplicar.

### 3.8 Resultado de la tarificación

```
connect_assistance_pricings
  id, controlCenterId, assistanceId,
  stage ('estimate'|'locked'|'final'),
  status ('ok'|'manual_review'|'partial'),
  saleContractId, salePlanId, saleVersionId, saleRuleId,
  purchaseContractId, purchasePlanId, purchaseVersionId, purchaseRuleId,
  purchaseTotal, saleTotal, grossMargin, grossMarginPct, currency,
  snapshot JSONB NOT NULL,
  warnings JSONB, engineVersion TEXT, pricingRequestId TEXT,
  computedAtMs, computedByUserId
  UNIQUE (assistanceId, stage)

connect_assistance_price_lines
  id, controlCenterId, pricingId, lineNumber,
  kind ('FORFAIT'|'EXTRA_KM'|'EXTRA_TIME'|'TIRE'|'ADDITIONAL_TIRE'|'MATERIAL'
        |'CANCELLATION'|'ADMIN_FEE'|'TOLL'|'OTHER'),
  conceptCode, description, quantity NUMERIC(12,4), unit,
  purchaseUnitPrice, saleUnitPrice, purchaseTotal, saleTotal,
  saleRuleId, purchaseRuleId, extraId, metadata JSONB

connect_pricing_overrides
  id, controlCenterId, assistanceId, priceLineId,
  field, originalValue NUMERIC(14,4), newValue NUMERIC(14,4),
  reason TEXT NOT NULL, authorizedByUserId, authorizedAtMs
```

`UNIQUE (assistanceId, stage)` es lo que hace `lockTariff()` idempotente
(§51): `INSERT … ON CONFLICT DO NOTHING` y se devuelve el existente. Dos
eventos simultáneos no producen dos bloqueos.

---

## 4. Resolución de reglas: determinismo

Es el punto donde un motor de tarifas se rompe en silencio. El orden **nunca**
puede venir del que devuelva PostgreSQL.

**Paso 1 — versión.** Contrato → plan → versiones con
`status='published' AND validFromMs <= t AND (validToMs IS NULL OR t < validToMs)`.
Orden: `priority DESC, validFromMs DESC, id ASC`. Si no hay ninguna:
`NO_TARIFF_PLAN`.

**Paso 2 — candidatas.** Reglas de esa versión cuyas dimensiones casan o son
`NULL` (comodín), y cuyos rangos de distancia y duración contienen el caso.

**Paso 3 — orden total.**

```
ORDER BY priority DESC, specificity DESC, id ASC
```

`specificity` = número de dimensiones no nulas de la regla. Se calcula en el
motor, no en SQL.

**Paso 4 — ambigüedad.** Si las dos primeras empatan en `priority` **y** en
`specificity`, se elige la de `id` menor —el resultado es siempre el mismo— y
se emite `AMBIGUOUS_RULES` con las dos candidatas. Ni se cae ni se calla: el
precio sale, y la configuración queda señalada para que alguien la arregle.

**Paso 5 — sin regla.** `NO_MATCHING_RULE`, `status='manual_review'`, **sin
precio inventado** (§39).

---

## 5. Las tres etapas

| Etapa | Cuándo | Qué fija | Distancia |
| --- | --- | --- | --- |
| `estimate` | Antes de asignar, por taller candidato | Nada | Estimada (haversine × 1,4) |
| `locked` | Al dar la orden de salida | Regla, forfait, incluidos | Ruta real |
| `final` | Al cerrar | Extras, neumáticos, materiales | Ruta real |

Cada una es una fila. **Ninguna sobrescribe a otra.** `final` referencia la
regla bloqueada y no vuelve a resolver el forfait: eso es lo que hace que el
viernes a las 22:17 siga valiendo 331 € aunque el técnico acabe el sábado a las
08:30 (§34).

**El momento contractual** (§17): no se añade el estado `SERVICE_ORDERED` a la
máquina —rompería la APK Lite, el core, los webhooks de partners y los KPIs—.
Se añade `serviceOrderedAtMs` a la asistencia, escrito en el mismo punto donde
hoy `finalizeAcceptedAssignment()` fija el taller, y la fila `locked` **es** el
registro de ese instante. Si algún día se quiere el estado explícito, se añade
con el histórico ya poblado.

---

## 6. Contrato del motor

```ts
interface PricingContext {
  assistanceId: number;
  controlCenterId: number;
  clientId: number | null;
  workshopId: number | null;
  serviceTypeCode: string;
  vehicleTypeCode: string;
  atMs: number;                 // instante contractual
  timezone: string;
  location: { lat: number; lng: number } | null;
  distanceKm: number | null;
  distanceSource: 'estimated' | 'routed';
  durationMin: number | null;
  items?: PricingItem[];        // neumáticos, materiales, extras
}

interface PricingResult {
  stage: 'estimate' | 'locked' | 'final';
  status: 'ok' | 'manual_review' | 'partial';
  currency: string;
  purchaseTotal: string | null; // decimal como texto; null = desconocido
  saleTotal: string | null;
  grossMargin: string | null;
  grossMarginPct: string | null;
  sale: ResolvedSide | null;
  purchase: ResolvedSide | null;
  lines: PriceLine[];
  warnings: PricingWarning[];
  explanation: PricingExplanation;
  engineVersion: string;
  pricingRequestId: string;
}
```

`purchaseTotal: null` significa **desconocido**, no cero. Un taller externo sin
acuerdo da venta calculada, compra nula y margen indeterminado, con
`PURCHASE_TARIFF_NOT_FOUND`. Nunca un cero que parezca un dato.

Funciones: `estimate()`, `resolveTariff()`, `lock()`, `finalize()`,
`calculateDistanceExtras()`, `calculateTimeExtras()`, `calculateTirePrice()`,
`calculateCancellation()`, `calculateExtras()`, `explain()`.

### Dónde vive

```
server/connect/pricing/
  money.ts        aritmética decimal          — puro, con pruebas
  timeBands.ts    franjas y cruce de noche    — puro
  calendar.ts     clases de día               — puro
  rules.ts        resolución y determinismo   — puro
  extras.ts       tipos de cálculo            — puro
  tires.ts        NET_PRICE / DISCOUNT        — puro
  engine.ts       orquestación                — puro
  repository.ts   acceso a datos              — con base
  service.ts      etapas, idempotencia        — con base
  routes.ts       HTTP bajo /api/connect/bo/pricing
  schema.ts       DDL idempotente
```

El mismo reparto que `liteRules.ts` (puro, 23 pruebas) frente a `lite.ts`. Todo
lo que decide precios se prueba sin base de datos.

### Precisión

Sin dependencias nuevas: representación interna en **enteros escalados a 4
decimales** (`bigint`), con `parse`, `format`, `add`, `mul`, `pct` y redondeo
**half-up a 2 decimales al cerrar cada línea**, documentado. Nunca `number`
para dinero.

---

## 7. API

Siguiendo el patrón del backoffice, no una arquitectura nueva:

```
POST   /api/connect/bo/pricing/estimate      operator
POST   /api/connect/bo/pricing/lock          operator   (idempotente)
POST   /api/connect/bo/pricing/finalize      operator   (idempotente)
POST   /api/connect/bo/pricing/tire          operator
GET    /api/connect/bo/pricing/:assistanceId operator
GET    /api/connect/bo/pricing/:assistanceId/explain  operator
POST   /api/connect/bo/pricing/override      supervisor
… administración de tarifarios                cc_admin
```

Permisos sobre el `rbac.ts` que ya existe: operador consulta, supervisor
autoriza modificaciones económicas, cc_admin crea y publica versiones.

---

## 8. Errores y observabilidad

`NO_TARIFF_PLAN`, `NO_MATCHING_RULE`, `AMBIGUOUS_RULES`,
`TIRE_PRICE_NOT_FOUND`, `ZONE_NOT_RESOLVED`, `HOLIDAY_LOOKUP_FAILED`,
`DISTANCE_NOT_AVAILABLE`, `PURCHASE_TARIFF_NOT_FOUND`,
`FORMULA_NOT_SUPPORTED`.

Ninguno se traduce en precio cero. Los que impiden calcular dejan la
tarificación en `manual_review`; los que solo degradan el resultado lo dejan en
`partial` con su aviso.

Cada ejecución lleva `pricingRequestId`, `engineVersion` y tiempo de ejecución,
y se contabiliza en la infraestructura de métricas que ya existe
(`liteMetrics`), sin datos personales.

---

## 9. No romper lo que funciona

`finalizeAcceptedAssignment()` calcula hoy `estimatedCost` con
`connect_tariff_lines`. El plan:

1. El motor se llama **primero**. Si devuelve `ok`, se usa.
2. Si no hay tarifario configurado, **se mantiene el cálculo actual** y se
   marca el origen en `costDetail`.
3. `connect_tariff_lines` queda de solo lectura, y se ofrece migrarla a
   contratos de compra cuando el motor esté validado.

Ninguna asistencia se queda sin coste por estrenar el motor.

---

## 10. Pruebas de la FASE 6

Los casos del §56, más los del enunciado: bloqueo nocturno del viernes 22:17
que sobrevive al cierre del sábado (§34), proximidad del martes a 22 km (§35),
festivo local que gana al diurno (§36), Navidad que gana al nocturno (§37),
neumático por medida/marca/posición (§38) y tarifa no encontrada (§39). Más:
cruce de medianoche, cambio de hora de marzo y octubre, regla del 20 %,
idempotencia de `lock`, versionado, snapshot reproducible y **aislamiento entre
dos centros de control**.

---

## 11. Pendiente de confirmar antes de la FASE 3

1. **Filtro por centro de control**: primero el recuento de asistencias sin
   `controlCenterId`, luego el relleno, luego el filtro. Te enseño el recuento
   antes de tocar nada.
2. **`weekdayAnchor`** de las franjas nocturnas: ¿el sábado a las 02:00 es
   nocturno de viernes o sábado? Hay que mirarlo en el tarifario de SEAS.
3. **Tarifario fuente de SEAS 2026** (PDF o Excel) para la FASE 7. Los importes
   del enunciado sirven de guía, pero el §33 pide contrastarlos contra el
   documento antes de cargar el *seed* definitivo.
