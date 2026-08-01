# PROMPT — Jerarquía Empresas → Talleres → Unidades móviles en Central Pro

> Reorganización de las pantallas de red de Assist Central Pro para que
> reflejen la jerarquía real del negocio. Escrito antes de programar; revisar
> y ajustar lo marcado como **[DECISIÓN]** si procede.
>
> Decisiones ya tomadas por el usuario (28-07-2026):
> — Las delegaciones desaparecen: solo quedan talleres.
> — Dentro del taller, lista de operarios con ficha (datos y teléfono) para
>   llamarles directamente, ligada a los operarios reales de Mobilink Assist.

## Objetivo

Hoy **Empresas de asistencia**, **Talleres** y **Unidades móviles** son tres
apartados planos e independientes del menú. La jerarquía real es:

```
Empresa de asistencia (connect_provider_companies)
└── Taller (connect_workshops, FULL | LITE | EXTERNAL)
    ├── Unidad móvil (connect_mobile_units)
    └── Operario (techs del core / connect_lite_users / contacto manual)
```

La navegación debe contarla: entras en una empresa y ves sus talleres; entras
en un taller y ves sus unidades y sus operarios (con teléfono, para llamarles
directamente). Sin duplicar entidades ni romper lo que ya funciona.

**Las delegaciones (`connect_branches`) desaparecen de la interfaz**: el
taller es el único nodo entre empresa y unidades/operarios.

## Estado actual (análisis, no tocar sin leer)

### Modelo de datos — la jerarquía YA existe a medias

- `connect_workshops.providerCompanyId` → empresa. ✔ Ya enlazado.
- `connect_workshops.branchId` → delegación (opcional). ✔
- `connect_mobile_units.providerCompanyId` (NOT NULL) y `branchId`. ✔
- `connect_mobile_units` **NO tiene `workshopId`**: las unidades cuelgan de la
  empresa, no del taller. **Hueco nº 1 del modelo.**
- Los operarios de Assist (`techs` del core: nombre, teléfono, estado en vivo,
  `roadsideCapable`, `es_supervisor`) **NO tienen vínculo con taller**: el
  core nació monotaller. **Hueco nº 2 del modelo.**
- `connect_branches` (delegaciones): **DECIDIDO — desaparecen**. Taller y
  delegación eran conceptos solapados; queda solo el taller. La tabla no se
  borra (datos históricos), pero se retira toda su interfaz y sus altas. Si
  una empresa tenía delegaciones que en realidad eran talleres, se dan de
  alta como talleres.

### Pantallas actuales

| Página | Qué hace hoy | Destino |
| --- | --- | --- |
| `Empresas.tsx` (175 líneas) | Alta de empresa, autorizar/cerrar, delegaciones y tarifas inline | Se convierte en lista → ficha; el bloque de delegaciones se elimina |
| `Talleres.tsx` (347) | Lista plana con producto (FULL/LITE/EXTERNAL), red, panel Lite | Su contenido pasa a la ficha de empresa y a la ficha de taller |
| `UnidadesMoviles.tsx` (170) | Lista plana en vivo (estado, GPS, estado manual) | Sigue existiendo como vista transversal + aparece dentro de cada taller |

### Endpoints ya existentes (reutilizar, no duplicar)

- `GET /providers`, `GET /providers/:id/workshops`
  (`GET/POST /providers/:id/branches` se retiran junto con su interfaz)
- `GET /workshops`, `POST /workshops`, `PATCH /workshops/:id`
- `GET /workshops/:id/lite-users`, `/lite-devices`, `/kpis` (panel Lite)
- `GET /mobile-units` (todas), `PATCH /mobile-units/:id/{share,status}`
- Sincronización de unidades: `server/connect/mobileunits.ts` (deriva del core
  + Webfleet; upsert por `coreVehicleId`)

## Cambios de datos (mínimos e idempotentes)

1. `ALTER TABLE connect_mobile_units ADD COLUMN IF NOT EXISTS "workshopId" INTEGER;`
2. Backfill automático en la migración: si la empresa de la unidad tiene UN
   solo taller, asignarlo; si tiene varios, dejar NULL (se asigna a mano).
3. En `mobileunits.ts` (sync desde el core): al crear una unidad nueva,
   heredar el `workshopId` del taller cuyo `coreWorkshopId` coincida con el
   del vehículo del core, si se puede resolver.
4. `PATCH /mobile-units/:id` acepta `workshopId` (mover una unidad de taller,
   auditado con `auditConnect`).
5. Las unidades de un taller LITE no vienen de Webfleet: son los dispositivos
   de los operarios. **No** crear filas en `connect_mobile_units` para Lite;
   la ficha del taller Lite ya enseña sus dispositivos.
6. **Operarios** — `ALTER TABLE techs ADD COLUMN IF NOT EXISTS "workshopId" TEXT;`
   (mismo formato que `connect_workshops.coreWorkshopId`). Backfill: si solo
   hay un taller FULL con `coreWorkshopId`, asignar ese a todos los `techs`
   (caso SEA). Editable después desde la ficha del taller (cc_admin).
7. **Contactos manuales de taller** (para talleres EXTERNAL y teléfonos extra
   de cualquier taller): tabla nueva `connect_workshop_contacts`
   (`id, workshopId, name, phone, role TEXT, notes, active, createdAtMs,
   updatedAtMs`). Alta/edición desde la ficha del taller (operator).

## Navegación y pantallas

### Menú lateral

- **Empresas de asistencia** pasa a ser la entrada principal de la red.
- **Talleres** y **Unidades móviles** SE MANTIENEN en el menú como vistas
  transversales (el operador las usa para buscar "¿qué unidades hay libres
  ahora?" sin pasar por empresa). **[DECISIÓN]** Si se prefiere menú más
  corto, degradarlas a pestañas dentro de Empresas; propuesta: mantenerlas.

### Rutas nuevas (react-router, dentro de `/connect`)

```
/connect/empresas                    → lista de empresas (como hoy, más compacta)
/connect/empresas/:id                → FICHA DE EMPRESA (nueva)
/connect/empresas/:id/talleres/:wid  → FICHA DE TALLER (nueva)
```

`/connect/talleres` y `/connect/unidades` siguen funcionando; sus filas
enlazan a las fichas nuevas (`Ver empresa`, `Ver taller`).

### Ficha de empresa (`/connect/empresas/:id`)

Cabecera: nombre, estado, autorización (autorizar/cerrar aquí), contacto,
tarifas (botón que abre el editor actual `TarifasEditor`).

Pestañas:
1. **Talleres** — los talleres de la empresa con lo que hoy enseña
   `Talleres.tsx`: producto (selector FULL/LITE/EXTERNAL), red Mobilink,
   radio, score, botón "Gestionar Lite" (reutilizar `LitePanel` tal cual) y
   alta de taller nuevo (ya con `providerCompanyId` fijado).
2. **Unidades** — todas las unidades de la empresa, agrupadas por taller,
   con las columnas de la vista transversal.
3. **KPIs** — agregado de `GET /workshops/:id/kpis` de sus talleres.

(Sin pestaña de delegaciones: han desaparecido.)

### Ficha de taller (`/connect/empresas/:id/talleres/:wid`)

Cabecera: nombre, empresa (enlace de vuelta), producto, código Lite si LITE,
teléfono, coordenadas (enlace al mapa), red Mobilink.

Pestañas:
1. **Operarios** — lista unificada con ficha por operario: nombre, teléfono
   con enlace `tel:` (botón grande "Llamar"), rol y estado. La fuente depende
   del producto del taller, pero la tarjeta es la misma:
   - **FULL** → `techs` del core (vía `techs.workshopId` ↔
     `connect_workshops.coreWorkshopId`): estado en vivo (libre / en trabajo /
     en asistencia con nº de expediente), `roadsideCapable`, supervisor.
     Ligados de verdad: son los mismos operarios que ve Mobilink Assist, no
     una copia.
   - **LITE** → `connect_lite_users`: rol, último acceso, dispositivos.
   - **EXTERNAL** → `connect_workshop_contacts` (contactos manuales).
   - En cualquier taller se pueden añadir además contactos manuales
     (encargado, centralita…) desde esta misma pestaña.
   Endpoint unificado: `GET /workshops/:wid/operators` →
   `{ name, phone, role, source: "assist"|"lite"|"contact", status, extra }`.
2. **Unidades móviles** — `GET /workshops/:wid/mobile-units` (endpoint nuevo,
   filtro de `/mobile-units` por `workshopId`). Misma tabla en vivo de
   `UnidadesMoviles.tsx` (extraer la tabla a un componente
   `TablaUnidades.tsx` y reutilizarla en las tres vistas). Acción "Mover a
   otro taller" (cc_admin).
   - Si el taller es LITE: en su lugar, dispositivos de los operarios (lo que
     ya enseña `LitePanel`).
3. **KPIs** — `GET /workshops/:wid/kpis` (ya existe).
4. **Asistencias** — últimas asistencias del taller
   (`GET /assistances?workshopId=` — añadir el filtro al endpoint listado).

## Backend nuevo (poco)

- `GET /api/connect/bo/workshops/:id/mobile-units` (operator)
- `GET /api/connect/bo/workshops/:id/operators` (operator) — lista unificada
  techs / lite_users / contactos según el producto del taller
- `POST/PATCH /api/connect/bo/workshops/:id/contacts` (operator) — contactos manuales
- `PATCH /api/connect/bo/mobile-units/:id` acepta `workshopId` (cc_admin, auditado)
- `PATCH /api/connect/bo/techs/:id` — solo `workshopId` (cc_admin, auditado):
  mover un operario de Assist a otro taller
- `GET /api/connect/bo/assistances` acepta `?workshopId=`
- `GET /api/connect/bo/providers/:id` (ficha: empresa + contadores)
- Migraciones + backfills de los puntos 1, 6 y 7
- Retirar `GET/POST /providers/:id/branches` (y su UI)

## Reglas

- **No duplicar componentes**: `LitePanel`, `TarifasEditor` y la tabla de
  unidades se extraen/reutilizan, no se copian.
- **No romper enlaces**: `/connect/talleres` y `/connect/unidades` deben
  seguir cargando (hay usuarios con marcadores).
- Roles como hasta ahora: ver = analyst, operar = operator, editar = cc_admin.
- Auditar: mover unidad de taller, cambio de producto, autorización.
- Los talleres sin empresa (`providerCompanyId` NULL) deben seguir visibles:
  en la lista transversal y bajo un bloque "Sin empresa asignada" con acción
  de asignarla (PATCH ya lo permite).

## Orden de implementación

1. Migraciones: `workshopId` en unidades y en `techs`, tabla
   `connect_workshop_contacts`, backfills; sync de unidades heredando taller.
2. Endpoints nuevos (operators, contacts, mobile-units por taller, movers,
   filtro de asistencias, ficha de empresa).
3. Extraer `TablaUnidades.tsx` de `UnidadesMoviles.tsx` (sin cambio visual).
4. Ficha de taller con pestaña Operarios primero (usa 2 y 3).
5. Ficha de empresa (usa la de taller).
6. Adelgazar `Empresas.tsx` a lista + enlaces (eliminando delegaciones);
   enlazar desde `Talleres.tsx` y `UnidadesMoviles.tsx`.
7. `npm run build`, typecheck del server y prueba visual de las tres rutas.

## Criterios de aceptación

- Desde Empresas se llega a un taller, a sus unidades y a sus operarios sin
  usar el menú.
- En la ficha del taller, cada operario tiene su tarjeta con teléfono y botón
  de llamada; los de un taller FULL son los mismos `techs` que ve Mobilink
  Assist (mismo id, estado en vivo), no una copia.
- Se pueden añadir contactos manuales a cualquier taller (imprescindible para
  los EXTERNAL, que no tienen operarios digitales).
- Una unidad puede moverse de taller y queda auditado; un operario de Assist
  también.
- No queda ningún rastro de delegaciones en la interfaz (ni pestaña, ni alta,
  ni columna), aunque la tabla siga en la base de datos.
- El panel Lite completo funciona igual dentro de la ficha de taller.
- Las vistas transversales siguen operativas y enlazan a las fichas.
- Ningún dato se duplica: mismas tablas, mismos ids.
