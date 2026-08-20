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

Todo ejecutado contra **PostgreSQL 16 real**, en dos bases distintas y a propósito:

| Comprobación | Resultado |
|---|---|
| `npx tsc` (servidor y app) | Sin errores |
| `npm run build` | Correcto |
| Suite completa sobre base **migrada** (con la clave ajena puesta) | **1122 de 1122**, ninguna omitida |
| Suite completa sobre base **recién creada** (sin fundación SaaS) | **1122 de 1122** |
| Migración aplicada dos veces seguidas | 1.ª: 352 cajas emparejadas · 2.ª: 0 filas. Idempotente |
| DDL de arranque sobre base ya migrada (riesgo R6) | Arranca sin error |
| `bash scripts/check-versions.sh` | `package.json` SUBIDA (1.8.25), el resto OK |
| ESLint | **No ejecutable**: `eslint.config.js` importa `@eslint/js`, que no está en `package.json`. Ajeno a esta fase |

```bash
RUN_DB_TESTS=1 DATABASE_URL=postgres://…/base_desechable npm test
```

### Semántica del backfill, comprobada con datos

| Texto del centro | Resultado | Por qué |
|---|---|---|
| `tarragona` | → taller «Tarragona» | Se ignoran mayúsculas |
| `Alcañiz` | → taller «Alcañiz» | Se ignoran las tildes |
| `DUPLICADO` | **sin asignar** | Había dos talleres con ese nombre: emparejar sería una moneda al aire |
| `reus` | **sin asignar** | No existe ese taller |
| *(vacío)* | **sin asignar** | Nada que emparejar |

### Dos fallos que solo aparecieron al ejecutarlo de verdad

Merece la pena dejarlos escritos, porque los dos habrían llegado a producción:

1. **La migración no compilaba.** El backfill usaba `min(id)` sobre un `uuid`, y **PostgreSQL no
   tiene `min()` para uuid**: la migración entera fallaba al ejecutarla. Se sustituyó por
   `(array_agg(id))[1]`. El `tsc` no puede ver esto —es SQL en una cadena— y solo lo caza ejecutarlo.
2. **Las pruebas de ámbito pasaban por el motivo equivocado.** Usaban uuid inventados de taller, que
   la base de pruebas aceptaba porque allí `centro_id` no lleva clave ajena. En una base migrada, que
   sí la lleva, reventaban. Ahora crean el taller de verdad cuando `app_centros` existe. **Una prueba
   que solo pasa donde no hay integridad referencial no prueba nada.**

## Lo que queda para después

- **Endurecer:** `centro_id NOT NULL` y sustituir `UNIQUE (empresa_id, centro, nombre)` por la
  versión con `centro_id`. Solo cuando el backfill esté verificado sobre la base real (D5, sin
  responder todavía).
- **Retirar `centro TEXT`**, que hoy convive a propósito.
- **Pantalla de zonas.** La API está (`/zones`, `/centers/:id/zone`); la interfaz de administrarlas
  cae mejor en MC Central (fase 3) que en la configuración de la caja.
