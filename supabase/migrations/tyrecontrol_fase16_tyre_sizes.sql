-- ============================================================
-- SEA TyreControl — Fase 16: tabla maestra "tyre_sizes" (referencia
-- completa: medida + índice de carga simple/doble + código de
-- velocidad). Se enlaza a tc_cat_medidas_neumatico (Fase 9/14) para
-- no repetir la medida en cada marca — tyre_sizes es la variante de
-- carga/velocidad de una medida ya existente en el catálogo maestro.
-- ============================================================

create table if not exists tyre_sizes (
  id                   uuid primary key default gen_random_uuid(),
  medida_id            uuid references tc_cat_medidas_neumatico(id) on delete restrict,
  referencia_completa  text not null unique,
  medida               text not null,
  ancho                numeric not null,
  perfil               numeric,
  diametro_llanta      numeric not null,
  indice_carga_simple  text not null,
  indice_carga_doble   text,
  codigo_velocidad     text not null,
  activo               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_tyre_sizes_medida_id on tyre_sizes (medida_id);
create index if not exists idx_tyre_sizes_medida on tyre_sizes (medida);
create index if not exists idx_tyre_sizes_diametro on tyre_sizes (diametro_llanta);
create index if not exists idx_tyre_sizes_codigo_velocidad on tyre_sizes (codigo_velocidad);

alter table tyre_sizes enable row level security;
drop policy if exists tyre_sizes_select on tyre_sizes;
create policy tyre_sizes_select on tyre_sizes for select using ( auth.uid() is not null );
drop policy if exists tyre_sizes_write on tyre_sizes;
create policy tyre_sizes_write on tyre_sizes for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

-- ── Precarga: 45 referencias del catálogo de camión/autobús ────
-- Los componentes (ancho/perfil/diámetro/cargas/velocidad) se
-- introducen ya separados; "medida" y "referencia_completa" se
-- generan a partir de ellos para garantizar el formato normalizado
-- exacto (evita errores de tecleo en 45 referencias literales).
with datos(ancho, perfil, diametro, carga_simple, carga_doble, codigo) as (
  values
    (315,80,22.5,156,150,'K'), (315,80,22.5,154,150,'M'), (315,80,22.5,154,150,'L'),
    (315,70,22.5,154,150,'L'), (315,70,22.5,156,150,'L'), (315,70,22.5,154,150,'M'),
    (315,60,22.5,154,148,'L'), (315,60,22.5,152,148,'M'), (315,60,22.5,154,150,'K'),
    (295,80,22.5,152,148,'M'), (295,80,22.5,154,149,'M'), (295,80,22.5,152,148,'L'),
    (295,60,22.5,150,147,'K'), (295,60,22.5,150,147,'L'), (295,60,22.5,150,147,'M'),
    (275,70,22.5,148,145,'L'), (275,70,22.5,150,145,'M'), (275,70,22.5,148,145,'K'),
    (385,65,22.5,160,null,'K'), (385,65,22.5,160,null,'J'), (385,65,22.5,164,null,'K'), (385,65,22.5,158,null,'L'),
    (385,55,22.5,160,null,'K'), (385,55,22.5,160,null,'J'), (385,55,22.5,158,null,'L'), (385,55,22.5,160,null,'L'),
    (445,65,22.5,169,null,'K'), (445,65,22.5,169,null,'J'),
    (445,45,19.5,160,null,'J'), (445,45,19.5,160,null,'K'),
    (435,50,19.5,160,null,'J'), (435,50,19.5,160,null,'K'),
    (305,70,22.5,152,148,'M'), (305,70,22.5,154,150,'L'), (305,70,22.5,152,148,'L'),
    (285,70,19.5,150,148,'J'), (285,70,19.5,148,145,'L'),
    (265,70,19.5,143,141,'J'), (265,70,19.5,143,141,'K'),
    (245,70,19.5,136,134,'M'), (245,70,19.5,141,140,'J'),
    (13,null,22.5,154,150,'K'), (13,null,22.5,156,150,'K'),
    (12,null,22.5,152,148,'K'), (12,null,22.5,152,148,'L')
),
calculado as (
  select
    ancho, perfil, diametro, carga_simple, carga_doble, codigo,
    case when perfil is null
      then ancho::text || ' R' || diametro::text
      else ancho::text || '/' || perfil::text || ' R' || diametro::text
    end as medida,
    case when carga_doble is null then carga_simple::text else carga_simple::text || '/' || carga_doble::text end as cargas
  from datos
)
insert into tyre_sizes (medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad, referencia_completa)
select medida, ancho, perfil, diametro, carga_simple::text, carga_doble::text, codigo,
  medida || ' ' || cargas || codigo
from calculado
on conflict (referencia_completa) do nothing;

-- ── Enlace con el catálogo maestro de medidas (sin duplicar) ───
-- Crea en tc_cat_medidas_neumatico las medidas que falten (mismo
-- formato sin espacio que usa el resto de la app) y enlaza tyre_sizes.
insert into tc_cat_medidas_neumatico (valor)
select distinct replace(t.medida, ' ', '')
from tyre_sizes t
where not exists (
  select 1 from tc_cat_medidas_neumatico c where c.valor = replace(t.medida, ' ', '')
)
on conflict (valor) do nothing;

update tyre_sizes t set medida_id = c.id
  from tc_cat_medidas_neumatico c
  where t.medida_id is null and c.valor = replace(t.medida, ' ', '');

-- Backfill ancho/perfil/diametro en las medidas recién creadas (mismo
-- patrón de la Fase 14, por si alguna es nueva en tc_cat_medidas_neumatico).
update tc_cat_medidas_neumatico
set ancho = (regexp_match(valor, '^(\d+)\s*/'))[1]::numeric
where ancho is null and valor ~ '^\d+\s*/';
update tc_cat_medidas_neumatico
set perfil = (regexp_match(valor, '/\s*(\d+)'))[1]::numeric
where perfil is null and valor ~ '/\s*\d+';
update tc_cat_medidas_neumatico
set diametro = (regexp_match(valor, 'R\s*(\d+(\.\d+)?)', 'i'))[1]::numeric
where diametro is null and valor ~* 'R\s*\d';
