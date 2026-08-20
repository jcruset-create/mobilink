# Fase 1 — Jerarquía, ámbitos y permisos · Plan e impacto

- **Commit de partida:** `b63134c` (rama `claude/mobilink-central-cash-uqk7t9`), sobre `edd3139`
- **Estado:** propuesta. **No se ha escrito código.** El protocolo exige confirmación antes de implementar.
- **Base:** `docs/central/phase-00-discovery.md`

---

## 1. Qué es realmente la Fase 1 tras la auditoría

El roadmap la enunciaba como «multi-tenant, jerarquía, scopes y permisos». La Fase 0 demostró que
**la mitad ya está hecha**: `empresa_id UUID NOT NULL` en las 24 tablas `cash_*`, el `empresaId`
resuelto en servidor y nunca leído del cliente, y comparación explícita de pertenencia en seis puntos
de `service.ts`. Reimplementar eso sería trabajo destructivo.

Lo que falta es la jerarquía **por debajo** de la empresa, que es la que MC Central necesita para
agregar:

| # | Trabajo | Por qué | Riesgo Fase 0 |
|---|---|---|---|
| 1 | `cash_registers.centro` (texto libre) → FK a `app_centros` | Sin esto, «agrupar por taller» es agrupar cadenas de texto | R5 HIGH |
| 2 | Nivel ZONA entre empresa y centro | El modelo target lo pide; hoy no existe | — |
| 3 | Ámbito por centro en el rol de caja | Un `cajero` lo es hoy de todas las cajas de su empresa | R9 MEDIUM |
| 4 | Inventario del esquema real de producción **antes** de migrar | Las migraciones se aplican a mano | R7 HIGH |

**No entra en la Fase 1**: el canal de eventos (Fase 2), ninguna pantalla de Central (Fase 3), ni la
auditoría transaccional (Fase 10, R2). Tampoco `app_tenants` — ver decisión D1.

## 2. Decisiones que necesito confirmadas antes de tocar código

Son las preguntas bloqueantes de la Fase 0 que afectan a esta fase. **Si te parecen bien las cinco opciones recomendadas, no
hace falta que contestes una por una: dime «adelante» y ejecuto.**

| # | Decisión | Recomendación | Consecuencia de aceptarla |
|---|---|---|---|
| D1 (Q1) | ¿TENANT por encima de `app_empresas`? | **No.** `tenant ≡ empresa` | Cero columnas nuevas en las 24 tablas `cash_*`. Si algún día un grupo agrupa dos empresas, se añade entonces con datos reales delante |
| D2 (Q3) | ¿`centro` pasa a FK? | **Sí**, con `centro_id` nullable → backfill → endurecer | Se conserva `centro TEXT` durante toda la fase; nada se rompe si el backfill no casa |
| D3 (Q4) | ¿Ámbito por centro en el rol? | **Sí**, usando `app_usuario_modulos.centro_id`, que ya existe sin usarse | `centro_id NULL` = toda la empresa (comportamiento actual). Nadie pierde acceso al desplegar |
| D4 | ¿Zona obligatoria? | **No.** `app_centros.zona_id` nullable | Una empresa de un solo taller no tiene que inventarse una zona |
| D5 (Q7) | ¿Inventario del esquema de producción antes de migrar? | **Sí**, y lo necesito de ti | Ver §5: es lo único que no puedo hacer yo |

## 3. Análisis de impacto

**Radio de alcance real, medido:** `centro` aparece en `server/cash/config.ts` (alta y edición de
cajas, `:31,47,86-123,144-251`), en `server/cash/report.ts:148,185` y en cinco ficheros del front
(`types/index.ts`, `layouts/CashLayout.tsx`, `services/api.ts`, `pages/Configuracion.tsx`,
`pages/JornadaActual.tsx`, `Historico.tsx`, `Informes.tsx`). **No aparece en `service.ts`,
`repository.ts`, `treasury.ts` ni `bankdeposits.ts`**: el dinero no depende del centro. Eso hace la
migración mucho menos arriesgada de lo que aparenta.

**Lo que NO se toca, y conviene decirlo:**

- **La numeración de documentos.** El código de caja (`TAR1-IB-26-001`) se calcula **una vez, al dar
  de alta la caja**, y se guarda en `cash_registers.codigo` (`config.ts:104,119-123`). El fichero
  `domain/registercode.ts:9-12` explica por qué vive aparte. Cambiar el centro a FK no reescribe ni
  un número ya emitido.
- **El motor de dominio.** Ni una línea: no conoce centros.
- **El libro mayor de piezas.** Ningún asiento se toca.

**Riesgos de la migración y cómo se evitan:**

1. **`NOT NULL` prematuro impide arrancar el servidor** (R6). El DDL de `schema.ts` se ejecuta en
   cada despliegue (`server/index.ts:17330`), y ya hubo un incidente así con un CHECK. Mitigación:
   toda columna nueva nace nullable y se endurece en una migración posterior, verificada contra la
   base real.
2. **`UNIQUE (empresa_id, centro, nombre)`** (`schema.ts:70`) es la clave del `ON CONFLICT` del alta
   de cajas (`config.ts:121`). Se sustituye **al final**, no al principio; hasta entonces convive.
3. **Backfill que no casa.** Se empareja por nombre normalizado dentro de la misma empresa; lo que no
   case queda a NULL y se resuelve desde Configuración, con un aviso en pantalla. Nunca se adivina.
4. **Cajas con `centro = ''`** (el DEFAULT, `schema.ts:60`): quedan a NULL. Es el caso mayoritario
   esperable en la instalación actual, de un solo taller.

## 4. Plan de ejecución

Cada paso deja el sistema funcionando. Se puede parar entre cualquiera de ellos.

1. **`supabase/migrations/central_fase1_jerarquia.sql`** — `app_zonas (id, empresa_id, nombre,
   activa)`; `app_centros.zona_id` nullable; `cash_registers.centro_id` nullable. Solo aditivo.
2. **`server/cash/schema.ts`** — las mismas columnas en el DDL idempotente, nullable, para que una
   base nueva salga igual que una migrada.
3. **Backfill** dentro de la migración: emparejar `cash_registers.centro` con `app_centros.nombre`
   por nombre normalizado y misma empresa. Sin coincidencia → NULL.
4. **`server/cash/config.ts`** — el alta y la edición de cajas aceptan `centroId`; se sigue
   escribiendo `centro` con el nombre del centro para no romper informes ni el `ON CONFLICT`.
5. **`server/cash/permissions.ts`** — `rolDeCaja` devuelve además el `centro_id` de
   `app_usuario_modulos` (`:141-144`), y un `exigirAmbitoCaja` comprueba que la caja de la petición
   cae dentro del ámbito. `centro_id NULL` = toda la empresa, que es lo de hoy.
6. **`server/central/zonas.ts` + rutas** — CRUD mínimo de zonas bajo `/api/cash/config` (aún no hay
   módulo Central montado; crearlo es Fase 3).
7. **Front** — selector de centro en `pages/Configuracion.tsx` y aviso visible en las cajas sin
   centro asignado.
8. **Tests** — dominio del emparejamiento del backfill (puro, sin BD) y ampliación de
   `cash.integration.test.ts` con dos casos: un cajero con ámbito de centro no ve la caja de otro
   centro, y uno sin ámbito las ve todas.
9. **Documentación** — `docs/central/phase-01-*.md` y nota en `docs/mobilink-cash.md`.

Endurecer a `NOT NULL` y sustituir el índice único **no entra en esta fase**: se hace cuando el
backfill esté verificado sobre la base real.

## 5. Lo único que no puedo hacer yo

El inventario del esquema de producción (D5, R7). Las migraciones se aplican a mano y el repositorio
no puede decirme qué se aplicó. Necesito el resultado de:

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_name like 'cash_%' or table_name like 'app_%'
order by table_name, ordinal_position;

select id, empresa_id, centro, nombre, codigo, activa from cash_registers;
select id, empresa_id, nombre from app_centros;
```

Con eso confirmo que el backfill casará antes de escribirlo. Sin eso puedo programar igual, pero la
migración va a ciegas y el paso 3 podría dejar todas las cajas a NULL.

## 6. Verificación antes de entregar

`npm test` (las 975 pruebas actuales más las nuevas), `npm run build` para el typecheck,
`bash scripts/check-versions.sh`, y una comprobación explícita de que el arranque del servidor aplica
el DDL sin error sobre una base que ya tiene datos — que es el fallo que más ha dolido en este módulo.
