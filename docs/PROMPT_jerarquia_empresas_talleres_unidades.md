# PROMPT — Jerarquía Empresas → Talleres → Unidades móviles en Central Pro

> Reorganización de las pantallas de red de Assist Central Pro para que
> reflejen la jerarquía real del negocio. Escrito antes de programar; revisar
> y ajustar lo marcado como **[DECISIÓN]** si procede.

## Objetivo

Hoy **Empresas de asistencia**, **Talleres** y **Unidades móviles** son tres
apartados planos e independientes del menú. La jerarquía real es:

```
Empresa de asistencia (connect_provider_companies)
└── Taller / delegación (connect_workshops, FULL | LITE | EXTERNAL)
    └── Unidad móvil (connect_mobile_units)
```

La navegación debe contarla: entras en una empresa y ves sus talleres; entras
en un taller y ves sus unidades. Sin duplicar entidades ni romper lo que ya
funciona.

## Estado actual (análisis, no tocar sin leer)

### Modelo de datos — la jerarquía YA existe a medias

- `connect_workshops.providerCompanyId` → empresa. ✔ Ya enlazado.
- `connect_workshops.branchId` → delegación (opcional). ✔
- `connect_mobile_units.providerCompanyId` (NOT NULL) y `branchId`. ✔
- `connect_mobile_units` **NO tiene `workshopId`**: las unidades cuelgan de la
  empresa, no del taller. **Este es el único hueco real del modelo.**
- `connect_branches` (delegaciones) existe y se gestiona dentro de Empresas.
  **[DECISIÓN]** Talleres y delegaciones son conceptos casi solapados
  (SEA: taller = delegación). Propuesta: mantener `connect_branches` como
  dato administrativo (dirección fiscal de la delegación) y usar SIEMPRE el
  taller como nodo operativo. NO fusionarlas en esta fase.

### Pantallas actuales

| Página | Qué hace hoy | Destino |
| --- | --- | --- |
| `Empresas.tsx` (175 líneas) | Alta de empresa, autorizar/cerrar, delegaciones y tarifas inline | Se convierte en lista → ficha |
| `Talleres.tsx` (347) | Lista plana con producto (FULL/LITE/EXTERNAL), red, panel Lite | Su contenido pasa a la ficha de empresa y a la ficha de taller |
| `UnidadesMoviles.tsx` (170) | Lista plana en vivo (estado, GPS, estado manual) | Sigue existiendo como vista transversal + aparece dentro de cada taller |

### Endpoints ya existentes (reutilizar, no duplicar)

- `GET /providers`, `GET /providers/:id/branches`, `GET /providers/:id/workshops`
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
2. **Delegaciones** — lo que hoy está inline en Empresas.
3. **Unidades** — todas las unidades de la empresa, agrupadas por taller,
   con las columnas de la vista transversal.
4. **KPIs** — agregado de `GET /workshops/:id/kpis` de sus talleres.

### Ficha de taller (`/connect/empresas/:id/talleres/:wid`)

Cabecera: nombre, empresa (enlace de vuelta), producto, código Lite si LITE,
teléfono, coordenadas (enlace al mapa), red Mobilink.

Pestañas:
1. **Unidades móviles** — `GET /workshops/:wid/mobile-units` (endpoint nuevo,
   filtro de `/mobile-units` por `workshopId`). Misma tabla en vivo de
   `UnidadesMoviles.tsx` (extraer la tabla a un componente
   `TablaUnidades.tsx` y reutilizarla en las tres vistas). Acción "Mover a
   otro taller" (cc_admin).
   - Si el taller es LITE: en su lugar, dispositivos y operarios (lo que ya
     enseña `LitePanel`).
2. **Operarios Lite** (solo LITE) — panel actual.
3. **KPIs** — `GET /workshops/:wid/kpis` (ya existe).
4. **Asistencias** — últimas asistencias del taller
   (`GET /assistances?workshopId=` — añadir el filtro al endpoint listado).

## Backend nuevo (poco)

- `GET /api/connect/bo/workshops/:id/mobile-units` (operator)
- `PATCH /api/connect/bo/mobile-units/:id` acepta `workshopId` (cc_admin, auditado)
- `GET /api/connect/bo/assistances` acepta `?workshopId=`
- `GET /api/connect/bo/providers/:id` (ficha: empresa + contadores)
- Migración + backfill del punto anterior

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

1. Migración `workshopId` en unidades + backfill + sync heredando taller.
2. Endpoints nuevos (4).
3. Extraer `TablaUnidades.tsx` de `UnidadesMoviles.tsx` (sin cambio visual).
4. Ficha de taller (usa 2 y 3).
5. Ficha de empresa (usa la de taller).
6. Adelgazar `Empresas.tsx` a lista + enlaces; enlazar desde `Talleres.tsx` y
   `UnidadesMoviles.tsx`.
7. `npm run build`, typecheck del server y prueba visual de las tres rutas.

## Criterios de aceptación

- Desde Empresas se llega a un taller y a sus unidades sin usar el menú.
- Una unidad puede moverse de taller y queda auditado.
- El panel Lite completo funciona igual dentro de la ficha de taller.
- Las vistas transversales siguen operativas y enlazan a las fichas.
- Ningún dato se duplica: mismas tablas, mismos ids.
