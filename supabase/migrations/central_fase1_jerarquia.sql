-- MC Central · Fase 1 — jerarquía: ZONA → TALLER → CAJA
--
-- Todo lo de aquí es ADITIVO y todas las columnas nacen NULLABLE. Es
-- deliberado: el DDL equivalente de `server/cash/schema.ts` se ejecuta en CADA
-- arranque del servidor, así que un NOT NULL puesto antes de tiempo no da un
-- error de migración: **impide arrancar el proceso**. Ya pasó en este módulo
-- con un CHECK de motivos que reventaba al existir el primer asiento
-- `BAG_OPENED`. Endurecer es una migración posterior, cuando el backfill esté
-- verificado contra los datos reales.
--
-- Equivalente en código: server/cash/schema.ts (bloque «Jerarquía»).

-- ── 1) Zonas ────────────────────────────────────────────────────────────────
-- Agrupación de talleres dentro de una empresa. Opcional: una empresa de un
-- solo taller no tiene por qué inventarse una zona.
create table if not exists app_zonas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references app_empresas(id) on delete cascade,
  nombre      text not null,
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_app_zonas_empresa on app_zonas (empresa_id, activa);

-- El nombre es único DENTRO de la empresa, no en toda la instalación: dos
-- empresas pueden tener cada una su zona «Norte» sin saber la una de la otra.
create unique index if not exists idx_app_zonas_nombre
  on app_zonas (empresa_id, lower(nombre));

-- ── 2) Centro → zona ────────────────────────────────────────────────────────
alter table app_centros
  add column if not exists zona_id uuid references app_zonas(id) on delete set null;

-- `on delete set null` y no cascade: borrar una zona reorganiza el mapa, no
-- borra talleres. Un taller sin zona sigue siendo un taller.
create index if not exists idx_app_centros_zona on app_centros (zona_id);

-- ── 3) Caja → centro ────────────────────────────────────────────────────────
-- Hasta ahora `cash_registers.centro` era TEXTO LIBRE, así que agrupar por
-- taller era agrupar cadenas. La columna de texto SE CONSERVA durante toda la
-- fase: la usan los informes (`server/cash/report.ts`) y el `ON CONFLICT
-- (empresa_id, centro, nombre)` del alta de cajas. Quitarla es trabajo de
-- después de verificar el backfill.
alter table cash_registers
  add column if not exists centro_id uuid references app_centros(id);

create index if not exists cash_registers_centro_idx on cash_registers (centro_id);

-- ── 4) Backfill ─────────────────────────────────────────────────────────────
-- Empareja por nombre normalizado (sin tildes, sin mayúsculas, sin espacios de
-- sobra) dentro de la MISMA empresa.
--
-- Lo que no case queda a NULL y se resuelve a mano desde Configuración. No se
-- adivina: asignar una caja al taller equivocado es peor que dejarla sin
-- asignar, porque el error viaja después a todos los informes consolidados y
-- nadie lo vuelve a mirar.
--
-- Idempotente: solo toca las filas que aún están a NULL, así que reejecutarlo
-- no deshace ninguna asignación hecha a mano.
-- Un detalle que importa: `app_centros` no impide dos talleres con el mismo
-- nombre en la misma empresa, así que se exige coincidencia ÚNICA. Con dos
-- candidatos el emparejamiento sería una moneda al aire, y una caja asignada
-- al taller equivocado descuadra todos los informes consolidados de después.
with normalizado as (
  select id,
         empresa_id,
         upper(translate(btrim(nombre),
           'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
           'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')) as clave
    from app_centros
),
unico as (
  select empresa_id, clave, min(id) as centro_id
    from normalizado
   group by empresa_id, clave
  having count(*) = 1
)
update cash_registers c
   set centro_id = u.centro_id
  from unico u
 where c.centro_id is null
   and c.centro <> ''
   and u.empresa_id = c.empresa_id
   and u.clave = upper(translate(btrim(c.centro),
         'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
         'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'));
