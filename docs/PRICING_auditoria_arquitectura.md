# Motor de Tarifas — FASE 1: Auditoría de la arquitectura actual

**CURRENT ARCHITECTURE ANALYSIS**

Informe previo a cualquier línea de código. Todo lo que sigue está comprobado
contra el código y el esquema reales, no contra la documentación.

---

## 0. Resumen para decidir

Cinco conclusiones que condicionan el diseño y que conviene leer antes que nada:

1. **Central Pro no usa Supabase como base de datos ni RLS.** Usa Express +
   `pg` contra `DATABASE_URL` con credenciales de servicio. El requisito §49
   del encargo ("todas las entidades económicas protegidas mediante RLS") **no
   se puede cumplir tal cual** sin cambiar el modelo de acceso de todo el
   módulo. Hay alternativa equivalente y menos arriesgada (§4.1).
2. **El aislamiento multi-tenant hoy es nominal.** Existe
   `connect_control_centers` y los usuarios llevan `controlCenterId`, pero el
   listado de asistencias y la mayoría de consultas **no filtran por él**.
   Montar precios, costes y márgenes encima de eso significa que una segunda
   central vería los márgenes de la primera.
3. **Ya existe un tarifario, pero es del lado de la compra.**
   `connect_tariff_lines` (base + €/km por autorización de proveedor y tipo de
   servicio) alimenta `estimatedCost`. El encargo modela la jerarquía
   cliente→contrato→tarifario, que es el lado de la **venta**. Hacen falta las
   dos, y el modelo propuesto solo cubre una.
4. **El dinero está en coma flotante.** `estimatedCost`, `finalCost`,
   `baseAmount` y `perKmAmount` son `DOUBLE PRECISION`, justo lo que el §52
   prohíbe. Hay que migrarlo, y hay datos vivos.
5. **`SERVICE_ORDERED` no existe, y añadirlo como estado es caro.** La máquina
   de estados la comparten Central, el core, la APK Lite y los webhooks de
   partners. Se puede cumplir el requisito contractual sin tocarla (§4.4).

---

## 1. WHAT EXISTS — inventario

### 1.1 Stack y modelo de datos

| Pieza | Realidad |
| --- | --- |
| Backend | Node + TypeScript ejecutado con `tsx` (sin compilación), Express 5 |
| Base de datos | PostgreSQL (alojado en Supabase) vía `pg.Pool`, `server/db.ts` |
| Migraciones de Central Pro | DDL idempotente en `server/connect/schema.ts`, ejecutado al arrancar (`initConnect()`) |
| `supabase/migrations/` | 170 ficheros, pero **de otros módulos** (TyreControl, Almacén, Safety, Presencia, Administración). Ninguno toca `connect_*` |
| Cliente Supabase | Solo para Storage y auth (`server/supabase.ts`) y para los módulos del panel que sí van contra PostgREST |
| Edge Functions | 4, todas de gestión de usuarios y alertas por correo. Ninguna económica |
| Panel | React 19 + Vite + Tailwind; Central Pro en `src/modules/connectpro/` (25 páginas) |

**Consecuencia práctica:** hay *dos* mundos de datos en el mismo proyecto. El
de Central Pro (tablas `connect_*`, acceso por `pg` con service role, sin RLS)
y el de los módulos de taller (tablas `tc_*`, `adm_*`, acceso por PostgREST con
RLS y políticas). El motor de tarifas pertenece al primero.

### 1.2 Tablas de Central Pro relevantes

Existen 39 tablas `connect_*`. Las que tocan al motor:

| Tabla | Contenido | Uso para tarifas |
| --- | --- | --- |
| `connect_control_centers` | Centro de control (el tenant real) | **Raíz del multi-tenant** |
| `connect_users` | Usuarios y rol (`superadmin` > `cc_admin` > `supervisor` > `operator` > `analyst`; `provider_user` lateral) | Permisos §50 |
| `connect_clients` | Cliente del centro (nombre, CIF, SLA por defecto, prioridad) | **Cabecera de la jerarquía de venta** |
| `connect_provider_companies` / `connect_branches` | Empresa proveedora y sus delegaciones | Lado compra |
| `connect_provider_authorizations` | Relación centro ↔ proveedor, con `serviceTypes`, `validFromMs`/`validToMs`, preferencias | **Ya tiene vigencias**: patrón a imitar |
| `connect_tariff_lines` | `baseAmount` + `perKmAmount` por autorización y tipo de servicio | Tarifario de compra embrionario |
| `connect_assistances` | La asistencia. Incluye `estimatedCost`, `finalCost`, `costCurrency`, `costDetail`, `invoicedAtMs`, `clientId`, `controlCenterId` | Sujeto de la tarificación |
| `connect_status_history` | Append-only, `fromStatus`/`toStatus`/`occurredAtMs` | **Fuente de tiempos reales, ya inmutable** |
| `connect_assistance_backoffice` | Datos administrativos, incluidos `facturable`, `pendienteAutorizacion`, `garantia`, `interna`, `importeAcordado NUMERIC(10,2)`, `medidaNeumatico`, `ejeAfectado`, `posicionRueda` | Contexto económico y de neumático **ya capturado** |
| `connect_service_types` / `connect_vehicle_types` | Catálogos configurables por código | **Dimensiones de las reglas** |
| `connect_audit_logs` | Auditoría con `actorType`, `actorId`, `action`, `detail`, `ip` | Auditoría §23 |
| `connect_counters` | Contadores correlativos | Numeración de OT si hace falta |
| `connect_incidents` | Incluye el tipo `tariff_conflict` | Ya previsto el conflicto tarifario |

### 1.3 Lógica económica existente

Está toda en un sitio, y son **20 líneas**: `server/connect/service.ts`, dentro
de `finalizeAcceptedAssignment()`.

```
busca connect_tariff_lines por taller + tipo de servicio
estimatedCost = baseAmount + perKmAmount × distanceKm
costDetail    = "Base X € + Y €/km × Z km"
```

Con `distanceKm` sacado del `scoreBreakdown` de la asignación. Si no hay
tarifa, `estimatedCost` queda a null y la ficha dice "Sin tarifa aplicable"
—que, dicho sea de paso, ya cumple el §39: no inventa precio.

`finalCost` se introduce **a mano** desde la ficha (`PATCH /assistances/:id/costs`,
un `window.prompt`), auditado como `assistance.cost_set`, sin guardar el valor
anterior ni el motivo.

Facturación (`/billing/summary`, `/billing/lines`, `/billing/mark-invoiced`) es
un agregado de `COALESCE(finalCost, estimatedCost)` y una marca `invoicedAtMs`.
**No hay líneas económicas, ni órdenes de trabajo, ni impuestos.**

### 1.4 Máquina de estados

`server/connect/service.ts` (`TRANSITIONS`) y `liteRules.ts` (`LITE_TRANSITIONS`),
que deben mantenerse coherentes:

```
draft → pending → searching → awaiting_acceptance → assigned
      → technician_assigned → en_route → arrived → in_progress
      → finished → returning_to_workshop → at_workshop
```

Más `cancelled`, `no_coverage`, `assignment_failed`.

**No existe `SERVICE_ORDERED`.** El equivalente funcional es la entrada en
`assigned`, que es el momento en que `finalizeAcceptedAssignment()` fija el
taller, inyecta la asistencia en el core y —hoy ya— calcula `estimatedCost`.
Ese instante queda registrado en `connect_status_history`.

### 1.5 Distancia, ETA y rutas

Dos mecanismos, y no se usan para lo mismo:

- `server/connect/routing.ts` → `drivingRoute()`: Google Routes API v2, ruta
  real por carretera, con caché en memoria (90 s, recalcula si el vehículo se
  mueve más de 250 m). **Solo se usa en el mapa operativo.**
- `server/connect/service.ts` → `haversineKm()` × 1,4 a 60 km/h + 5 min:
  es lo que usa la **selección de talleres candidatos** y lo que acaba en
  `scoreBreakdown.distanceKm`, o sea lo que hoy alimenta el cálculo de coste.

Es decir: el coste actual se calcula con una distancia estimada en línea recta
corregida por un factor, no con ruta real.

### 1.6 Neumáticos

No hay catálogo de neumáticos en Central Pro. Sí lo hay, y bueno, en TyreControl:

- `tc_productos_almacen` (marca, modelo, medida), `tc_medidas`, catálogo de
  presiones por marca+modelo+medida.
- **Normalización de medidas ya resuelta y probada**: `tc_medida_normalizada()`
  como disparador en la base, y su gemela `medidaCanonica()` en
  `src/modules/tyrecontrol/services/medidas.ts`, más `baseMedida()` para
  comparar ignorando índices de carga y velocidad. Convierte `315/80 R 22,5` y
  `295/80R22-5` a forma canónica sin duplicar.
- Posiciones de rueda y configuraciones de eje, en `posicionesDesdeConfig.ts`.

Pero está en el **otro mundo de datos**: esquema distinto, acceso por PostgREST
con RLS, tenant por `empresa_id`. Central Pro no lo consulta hoy.

En Central, lo único que hay es texto libre: `connect_assistance_backoffice.medidaNeumatico`,
`ejeAfectado`, `posicionRueda`.

### 1.7 Festivos y horarios

Existe `src/modules/agendaConfig.ts`: horario semanal, festivos con `yearly`,
cierres especiales y hasta lógica de puentes. Y un endpoint que propone el
calendario laboral de un municipio con IA (`/api/agenda-config/festivos-ia`,
14 festivos: nacionales + autonómicos + 2 locales).

Pero es **la agenda de un taller**: se guarda como JSON de configuración, está
pensada para decidir si el taller abre, y no distingue ámbito
(nacional/autonómico/provincial/local) de forma consultable. No sirve como
calendario tarifario multi-ámbito, aunque el endpoint de IA sí es reutilizable
para **poblar** uno.

### 1.8 Zona horaria

`server/index.ts` tiene `AGENDA_TIME_ZONE` (por defecto `Europe/Madrid`),
`getZonedDateTimeParts()` y `getTimeZoneOffsetMs()`. Funciones puras y
reutilizables, hoy atrapadas dentro de un fichero de 12.000 líneas.

### 1.9 ERP

`server/integration-hub/` está bien montado: dominio, conectores, registro,
workers. Business Central implementado con presupuestos, pedidos de venta
(`createSalesOrder`), pedidos de compra y sincronización de catálogo. Su
dominio ya tiene `tenantId`, `WorkOrderId` y líneas con cantidad y precio.

**No está conectado con Central Pro.** No hay puente entre una asistencia y un
pedido de venta.

### 1.10 Seguridad y multi-tenant

- Autenticación: sesión Supabase → `authenticate` → `req.authCtx` → `rbac.ts`
  resuelve `connect_users` → `req.connectUser` con rol y `controlCenterId`.
- Autorización por rol: `requireConnectRole("operator" | "supervisor" | "cc_admin" | ...)`,
  jerárquica. **Funciona y es suficiente para los permisos del §50.**
- Aislamiento por tenant: `controlCenterId` aparece 21 veces en
  `backoffice.ts`, pero **el listado de asistencias no lo usa**: filtra por
  estado, taller o partner, nunca por centro. `backofficeData.ts` tampoco.
- RLS sobre tablas `connect_*`: **ninguna**. Cero políticas.

En la práctica hoy hay un solo centro de control, así que no se nota. En cuanto
haya dos, y con márgenes de por medio, sí.

---

## 2. WHAT WILL BE REUSED

No hay que inventar nada de esto:

| Se reutiliza | Para qué |
| --- | --- |
| `connect_control_centers` | Tenant del motor. No crear `organizations` |
| `connect_clients` | Cliente. No crear `customers` |
| `connect_provider_authorizations` | Patrón de vigencia (`validFromMs`/`validToMs`) y contrato del lado compra |
| `connect_service_types`, `connect_vehicle_types` | Dimensiones de las reglas, ya configurables desde Configuración |
| `connect_status_history` | Tiempos reales. Ya es append-only e inmutable |
| `connect_audit_logs` | Toda la auditoría del motor |
| `rbac.ts` | Permisos: operador consulta, supervisor autoriza, cc_admin publica |
| `routing.ts` → `drivingRoute()` | Distancia real por carretera, con su caché |
| `medidaCanonica()` / `baseMedida()` | Normalización de medidas de neumático (§24), ya probada en producción |
| `getZonedDateTimeParts()` | Resolución de franjas en la zona horaria correcta (§53) |
| `connect_counters` | Numeración correlativa |
| Patrón `connect_lite_actions` | Idempotencia por `clientActionId` (§51) |
| `connect_assistance_backoffice` | Ya trae `facturable`, `garantia`, `interna`, `importeAcordado`, medida y posición del neumático |
| `connect_incidents` tipo `tariff_conflict` | Flujo de revisión manual (§39) |
| Integration Hub | Salida a ERP, sin duplicar conectores |

---

## 3. WHAT NEEDS TO CHANGE

### 3.1 Precisión económica (bloqueante)

`estimatedCost`, `finalCost`, `connect_tariff_lines.baseAmount` y `perKmAmount`
son `DOUBLE PRECISION`. Migración a `NUMERIC(12,4)` para importes y
`NUMERIC(7,4)` para porcentajes. Hay datos vivos: la migración debe ser
`ALTER TABLE ... TYPE NUMERIC USING`, idempotente, y verificable.

### 3.2 Aislamiento por centro de control

Antes de exponer márgenes hay que cerrar el filtro por `controlCenterId` en el
listado de asistencias y en las consultas de facturación. Es un cambio de
comportamiento que puede ocultar filas a quien hoy las ve, así que necesita
decisión explícita, no lo hago por mi cuenta.

### 3.3 Distancia

Hoy el coste usa haversine × 1,4. Para tarificar con kilómetros incluidos y
extras hay que usar ruta real (`drivingRoute()`), y decidir el recorrido
contractual (§14: taller → punto → taller). Cada llamada a Routes API se
factura: hay que definir cuándo se pide ruta real y cuándo basta la estimación.

### 3.4 Momento contractual

**Recomendación: no añadir un estado nuevo.** Añadir `SERVICE_ORDERED` a
`TRANSITIONS` obliga a tocar `LITE_TRANSITIONS`, la APK, el mapeo con el core,
los webhooks de partners y los KPIs, y a migrar el histórico. En su lugar:

- una marca de tiempo `serviceOrderedAtMs` en la asistencia, escrita en el
  mismo punto en que hoy se ejecuta `finalizeAcceptedAssignment()`;
- el snapshot de tarifa como registro explícito de ese instante.

Cumple el requisito contractual (el forfait se congela en la orden de salida)
sin desestabilizar nada. Si más adelante se quiere el estado explícito, se
añade con el histórico ya poblado.

### 3.5 Cálculo de coste actual

`finalizeAcceptedAssignment()` debe dejar de calcular precios a mano y pasar a
llamar al motor. Mientras el motor no tenga tarifario configurado para un caso,
debe **caer al comportamiento actual** para no romper lo que hoy funciona.

### 3.6 `finalCost` manual

El `window.prompt` sin motivo ni valor anterior incumple el §23. Pasa a ser un
override auditado con `original_value`, `new_value`, `reason`, `authorized_by`,
y permiso de supervisor.

---

## 4. WHAT WILL BE CREATED

### 4.1 Decisión previa: RLS

El encargo pide RLS. Central Pro accede con service role por `pg`: **RLS no
protegería nada** ahí (el rol de servicio la salta), y aplicarla obligaría a
reescribir el acceso a datos de todo el módulo.

Propongo el equivalente defendible:

- `controlCenterId` obligatorio y con índice en **todas** las tablas nuevas;
- una capa de acceso única para las tablas económicas que exija el tenant del
  `req.connectUser` en cada consulta —no repartido por endpoints—;
- pruebas de aislamiento multi-tenant como criterio de aceptación (§56);
- y RLS **sí** si algún día estas tablas se exponen por PostgREST.

Si prefieres RLS de verdad desde el principio, hay que hablarlo: implica
cambiar el modelo de acceso de Central Pro y es una fase en sí misma.

### 4.2 Modelo propuesto

Nomenclatura `connect_*` para no partir el esquema en dos estilos.

**Jerarquía.** La del encargo solo cubre la venta. Propongo un mismo motor con
dos direcciones, distinguidas por un campo `side` (`sale` | `purchase`):

```
connect_control_centers            (tenant, ya existe)
   ├── connect_clients             (ya existe)         → contratos de VENTA
   └── connect_provider_companies  (ya existe)         → contratos de COMPRA
                    ↓
        connect_contracts          (nuevo)
                    ↓
        connect_tariff_plans       (nuevo)
                    ↓
        connect_tariff_versions    (nuevo: valid_from, valid_to, status, priority)
                    ↓
        reglas (varias familias)
```

Así el margen sale de comparar dos resoluciones del mismo motor sobre la misma
asistencia, en vez de meter compra y venta en la misma fila —que es lo que hace
hoy `connect_tariff_lines` y lo que impide tener tarifas de compra por
proveedor y de venta por cliente a la vez.

**Tablas nuevas** (nombres provisionales, a fijar en FASE 2):

| Tabla | Motivo |
| --- | --- |
| `connect_contracts` | Contrato cliente/proveedor con vigencia |
| `connect_tariff_plans` | Tarifario ("SEAS Nacional") |
| `connect_tariff_versions` | Versión con vigencia, estado (`draft`/`published`/`archived`) y prioridad |
| `connect_tariff_service_rules` | Regla: servicio × vehículo × zona × tipo de día × franja × distancia × tiempo → compra y venta |
| `connect_tariff_time_bands` | Franjas, con soporte de cruce de medianoche y días de la semana |
| `connect_tariff_zones` + `_members` | Zonas geográficas (país, grupo, región, provincia, personalizada, red viaria) |
| `connect_calendars` + `connect_calendar_days` | Festivos por ámbito y tipo (nacional/autonómico/provincial/local/especial) |
| `connect_tariff_extras` | Extras genéricos con tipo de cálculo (fijo, por unidad, por km, por minuto, por hora, porcentaje, fórmula) |
| `connect_tire_sizes`, `connect_tire_brands`, `connect_tire_brand_groups` + `_members` | Catálogo normalizado de neumático |
| `connect_tariff_tire_prices` | Precio por medida × marca/grupo × posición, en modo `NET_PRICE` o `DISCOUNT_FROM_LIST` |
| `connect_manufacturer_price_lists` + `_prices` | Baremos de fabricante versionados |
| `connect_assistance_pricings` | Una fila por etapa (`estimate` / `locked` / `final`), con el snapshot JSONB |
| `connect_assistance_price_lines` | Líneas económicas con compra, venta, cantidad, unidad y regla de origen |
| `connect_pricing_overrides` | Modificaciones manuales con motivo y autorizador |

**Servicio de dominio**: `server/connect/pricing/` con el motor puro separado
del acceso a datos, para poder probarlo sin base de datos —el mismo patrón que
`liteRules.ts` (23 pruebas) frente a `lite.ts`.

---

## 5. RIESGOS

| # | Riesgo | Impacto | Mitigación |
| --- | --- | --- | --- |
| R1 | Migrar dinero de `double` a `numeric` con datos vivos | Alto | `USING` explícito, idempotente, comparación de sumas antes/después |
| R2 | Cerrar el filtro por centro de control oculta filas que hoy se ven | Alto | Decisión explícita del usuario; medir antes cuántas filas cambian |
| R3 | El motor sustituye el cálculo actual y deja asistencias sin coste | Alto | Fallback al cálculo actual mientras no haya tarifario aplicable |
| R4 | Coste de Google Routes al tarificar cada candidato | Medio | Ruta real solo al bloquear y al cerrar; estimación para comparar candidatos |
| R5 | Ambigüedad de reglas (dos con la misma prioridad) | Medio | Orden determinista total y error explícito `AMBIGUOUS_RULES`, nunca desempate por orden de PostgreSQL |
| R6 | Duplicar el catálogo de neumáticos con TyreControl | Medio | Catálogo propio en Central pero **misma normalización**; puente posterior si interesa |
| R7 | Festivos mal cargados → tarifa equivocada un día señalado | Medio | Calendario versionado, revisión antes de publicar, y el endpoint de IA solo propone |
| R8 | `schema.ts` crece sin control (ya 880 líneas) | Bajo | El bloque de tarifas en su propio fichero, invocado desde `initConnect()` |
| R9 | Cambiar la máquina de estados rompe Lite, core y partners | Alto | No se toca (§3.4) |
| R10 | Zona horaria mal resuelta en el cambio de hora | Medio | Resolver siempre con `Intl` sobre la zona del servicio, nunca sumando offsets fijos; pruebas en marzo y octubre |

---

## 6. POSIBLES CONFLICTOS

1. **`connect_tariff_lines` vs. el modelo nuevo.** Se queda, se migra o
   convive. Recomiendo migrarla a una versión tarifaria de compra por
   proveedor, y dejar la tabla vieja de solo lectura una temporada.
2. **Dos catálogos de neumáticos** (TyreControl y Central). Justificable
   porque son tenants y propósitos distintos, pero hay que decidirlo, no
   dejarlo pasar.
3. **Dos calendarios de festivos** (agenda del taller y calendario tarifario).
   No son lo mismo y no deben unificarse: uno dice si el taller abre, el otro
   qué se cobra.
4. **`importeAcordado`** en el back office ya es un precio pactado a mano. Hay
   que decidir si es un override del motor o un dato informativo.
5. **Facturación actual** suma `COALESCE(finalCost, estimatedCost)`. Cuando
   existan líneas, esa suma debe pasar a salir de las líneas, o los totales no
   cuadrarán.

---

## 7. PLAN DE IMPLEMENTACIÓN

Ajustado a las 12 fases del encargo, con las dependencias reales:

| Fase | Contenido | Depende de |
| --- | --- | --- |
| **0** | Decisiones abiertas (§8) | Usuario |
| 1 | Esta auditoría | — |
| 2 | Diseño detallado: nombres de tablas, claves, índices, contrato del motor | 0 |
| 3 | Migraciones: `numeric`, tablas nuevas, índices. Sin lógica | 2 |
| 4 | Dominio puro: resolución de regla, franjas, festivos, zonas, prioridades. **Sin base de datos, con pruebas** | 3 |
| 5 | Motor v1: `estimate`, `lock`, `final`, líneas, snapshot, explicación | 4 |
| 6 | Batería de pruebas del §56 | 5 |
| 7 | SEAS 2026 como *seed* de datos, contrastado contra el tarifario fuente | 6 |
| 8 | Integración en la asistencia: estimación al asignar, bloqueo en la orden de salida, final al cerrar. Con fallback | 7 |
| 9 | Neumáticos: catálogo, normalización, dos modelos de precio | 5 |
| 10 | UI: tarjeta de tarificación y "explicar tarifa" | 8 |
| 11 | Líneas económicas → OT → salida ERP | 8 |
| 12 | Overrides, permisos y auditoría económica | 8 |

Después de cada fase: `npm test`, `npx tsc -b`, `npx tsc -p tsconfig.server.json`,
y comprobación de que el flujo actual de asistencias sigue intacto.

---

## 8. DECISIONES ABIERTAS

No empiezo la FASE 2 sin estas cinco:

1. **RLS o aislamiento por capa de acceso** (§4.1). Cambia el alcance.
2. **Filtro por centro de control** (§3.2): ¿lo cierro ahora, sabiendo que
   puede ocultar filas que hoy se ven?
3. **Compra y venta**: ¿confirmas el modelo de dos direcciones sobre el mismo
   motor, con la compra colgando del proveedor y la venta del cliente?
4. **Distancia**: ¿ruta real (facturable) en el bloqueo y el cierre, y
   estimación para comparar candidatos?
5. **Neumáticos**: ¿catálogo propio en Central, o puente a TyreControl?

Y una advertencia sobre los datos del §33: los importes del encargo (110 /
198 / 331 / 424 €) se describen como **venta nacional camión**. No hay precios
de compra en el enunciado, y el §21 exige margen. Sin la columna de compra del
tarifario fuente, el motor funcionará pero el margen saldrá vacío en el caso de
prueba. Necesito esos datos antes de la FASE 7.
