# Fase 1 — Entrega: jerarquía, ámbitos y permisos

- **Rama:** `claude/mobilink-central-cash-uqk7t9` · **Versión:** `1.8.25`
- **Plan aprobado:** `docs/central/phase-01-plan.md`, con las cinco recomendaciones aceptadas.

## Lo que hace ahora el módulo y antes no

1. **Una caja pertenece a un taller de verdad.** `cash_registers.centro_id → app_centros`. Hasta aquí
   el taller era texto libre y «Tarragona» y «tarragona» eran dos talleres distintos.
2. **Hay zonas.** `app_zonas` agrupa talleres dentro de una empresa. Opcional: un taller único no
   tiene que inventarse una zona.
3. **El rol de caja tiene alcance.** `app_usuario_modulos.centro_id` —que existía sin usarse desde la
   fundación SaaS— limita a un usuario a las cajas de su taller.

## Decisiones que se tomaron por el camino

**El ámbito vacío significa «toda la empresa».** Es lo contrario de lo que pide el instinto de
seguridad, y es deliberado: el valor de una columna nueva lo hereda el censo entero de usuarios. Con
el criterio inverso, desplegar esta fase habría dejado a toda la plantilla sin poder abrir su caja el
lunes por la mañana. Nadie pierde acceso al desplegar; el ámbito se aprieta usuario a usuario.

**Una caja sin taller queda FUERA de todo ámbito.** Es la decisión más discutible de la entrega, así
que está fijada en una prueba. Lo contrario —dejarla accesible «porque no se sabe dónde está»—
convertiría cada caja que el backfill no supo emparejar en un agujero por el que se cuela todo el
mundo, y esos agujeros no se cierran solos porque nadie los ve.

**La comprobación de empresa y la de taller viven en la misma función.** `exigirJornadaPropia`
(`server/cash/hierarchy.ts`) sustituye a once `if` sueltos repetidos en tres ficheros. Si se hubiera
añadido la segunda comprobación a mano en cada uno, el duodécimo sitio se habría quedado sin ella. Un
ámbito que falla en una sola ruta no es un ámbito.

**El texto del centro NO se ha borrado.** `cash_registers.centro` sigue ahí y sigue escribiéndose,
sincronizado con el nombre del taller: lo leen los informes ya emitidos y es parte de la clave única
del alta de cajas. Retirarlo es trabajo de después de verificar el backfill contra datos reales.

**Todo nace NULLABLE.** El DDL de `schema.ts` se ejecuta en cada arranque, así que un `NOT NULL`
prematuro no rompe una migración: impide arrancar el proceso. Es el mismo fallo que ya costó un
incidente en este módulo con un CHECK de motivos.

**El backfill exige coincidencia única.** `app_centros` no impide dos talleres con el mismo nombre en
una empresa; con dos candidatos, emparejar sería una moneda al aire. Lo ambiguo queda sin asignar y
la pantalla lo avisa en la fila de la caja, en ámbar, al lado del nombre.

## Qué se tocó

| Fichero | Qué |
|---|---|
| `supabase/migrations/central_fase1_jerarquia.sql` | Nuevo: `app_zonas`, `app_centros.zona_id`, `cash_registers.centro_id` y backfill idempotente |
| `server/cash/schema.ts` | El mismo DDL, idempotente y sin FK hacia `app_*` cuando esas tablas no existen (base de pruebas) |
| `server/cash/hierarchy.ts` | Nuevo: zonas, talleres, `exigirAmbitoCaja` y `exigirJornadaPropia` |
| `server/cash/permissions.ts` | `rolDeCaja` devuelve rol **y** ámbito; `req.cashCentroId` |
| `server/cash/service.ts` | Ámbito en la apertura de jornada y en las seis comprobaciones de pertenencia |
| `server/cash/treasury.ts` | Las cinco comprobaciones de pertenencia, ahora compartidas |
| `server/cash/config.ts` | `centroId` en alta, edición y listado de cajas; listado recortado al ámbito |
| `server/cash/router.ts` | `/hierarchy`, `/zones`, `/centers/:id/zone`; ámbito en `bootstrap`, histórico y rutas con `registerId` |
| `src/modules/cash/**` | Tipos, API y selector de taller en Configuración, con aviso de caja sin asignar |
| `server/cash/cash.integration.test.ts` | Cuatro pruebas de ámbito |

## Verificación

| Comprobación | Resultado |
|---|---|
| `npx tsc` (servidor y app) | Sin errores |
| `npm run build` | Correcto |
| `npm test` | 801 pasan, 321 omitidas |
| `bash scripts/check-versions.sh` | `package.json` SUBIDA (1.8.25), el resto OK |
| ESLint | **No ejecutable en este repositorio**: `eslint.config.js` importa `@eslint/js`, que no está en `package.json` |
| Pruebas contra PostgreSQL real | **No ejecutadas**: no hay servidor de base de datos en este entorno. Las 321 omitidas incluyen las cuatro nuevas de ámbito |

Las dos últimas filas son lo que **no** se ha podido comprobar aquí, y conviene correrlas antes de
desplegar: `RUN_DB_TESTS=1 DATABASE_URL=… npm test` sobre una base desechable.

## Lo que queda para después

- **Endurecer:** `centro_id NOT NULL` y sustituir `UNIQUE (empresa_id, centro, nombre)` por la
  versión con `centro_id`. Solo cuando el backfill esté verificado sobre la base real (D5, sin
  responder todavía).
- **Retirar `centro TEXT`**, que hoy convive a propósito.
- **Pantalla de zonas.** La API está (`/zones`, `/centers/:id/zone`); la interfaz de administrarlas
  cae mejor en MC Central (fase 3) que en la configuración de la caja.
