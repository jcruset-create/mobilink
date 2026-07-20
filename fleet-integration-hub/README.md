# Mobilink Fleet Integration Hub (FIH)

Monorepo TypeScript (NestJS + PostgreSQL + Prisma) para integrar la plataforma
de gestión de neumáticos con cualquier proveedor de gestión de flotas mediante
el patrón Adapter. Multi-tenant, con sincronización incremental, cifrado de
credenciales, reintentos tipados, webhooks y auditoría.

📄 **Informe completo de investigación y arquitectura:** [`../docs/INFORME_INTEGRACIONES_FLOTAS.md`](../docs/INFORME_INTEGRACIONES_FLOTAS.md)

## Estructura del monorepo

```
fleet-integration-hub/
├── packages/
│   ├── domain/        DTOs comunes, interfaz FleetProviderAdapter, errores tipados
│   └── adapters/      BaseFleetAdapter + registro + adaptadores:
│       ├── movertis/    · proveedor de ejemplo (client + mapper + adapter)
│       └── mte/         · Mobilink Telematics Engine (Teltonika propio) como proveedor
└── apps/
    └── api/           NestJS: conexiones, tenants, sync, webhooks + Prisma
```

## Puesta en marcha

```bash
cd fleet-integration-hub
npm install
npm run prisma:generate
npm run build
npm test                 # tests de adaptadores (sin red, fetch mockeado)

cp .env.example .env     # DATABASE_URL (Supabase) + FIH_ENCRYPTION_KEY
npx prisma migrate dev --schema apps/api/prisma/schema.prisma   # crea las tablas fih_*
npm run dev              # API en :8090
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/providers` | Catálogo de proveedores y capacidades |
| POST | `/api/v1/tenants` | Alta de empresa (multi-tenant) |
| POST | `/api/v1/connections` | Conectar tenant ↔ proveedor (valida credenciales, las cifra) |
| POST | `/api/v1/connections/:id/sync` | Sincronización manual |
| GET | `/api/v1/vehicles?tenantId=` | Vehículos canónicos |
| GET | `/api/v1/vehicles/:id/odometer` | Lecturas de odómetro (metros, fuente can/gps) |
| POST | `/webhooks/:connectionId` | Entrada genérica de webhooks de proveedores |

## Añadir un proveedor nuevo

1. `packages/adapters/src/<proveedor>/` con `*.client.ts` (HTTP), `*.mapper.ts`
   (normalización a DTOs de `@fih/domain`) y `*.adapter.ts` (extiende
   `BaseFleetAdapter`, declara `capabilities`).
2. Registrarlo en `packages/adapters/src/registry.ts`.
3. Tests con fetch mockeado en `packages/adapters/src/tests/`.

El resto (sync incremental, tokens, persistencia, API, webhooks) funciona sin cambios.
