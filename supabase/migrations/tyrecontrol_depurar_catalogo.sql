-- «🧹 Depurar catálogo»: que las gomas de flota encajen con una referencia del
-- catálogo sin tocar las gomas.
--
-- Solo 3.043 de 6.801 gomas activas encajaban con una referencia: en flota el
-- modelo va escrito con el índice pegado («AH51 154M»), con erratas
-- («XMUILTI») o con otro nombre. En vez de reescribir tc_neumaticos (prohibido)
-- se guarda una EQUIVALENCIA: «así está escrito en flota → esta referencia».
--
--  1. tc_cat_equivalencias_flota (nueva): marca, modelo y medida tal como están
--     en flota (upper + btrim, '' si vacío) → referencia_id.
--  2. tc_cat_parecidos_distintos (nueva): pares de modelos o medidas que se
--     parecen pero son distintos (HD3 / HD3+), para no volver a enseñarlos.
--  3. tc_referencia_de_neumatico(): la referencia de una goma; primero por
--     equivalencia y, si no, por marca + modelo + medida como hasta ahora.
--  4. tc_profundidad_origen_neumatico(): mira primero la equivalencia. Sin
--     equivalencia devuelve EXACTAMENTE lo mismo que antes.
--
-- Solo LEE tc_neumaticos. No toca tc_montajes_actuales, tc_vehiculo_ejes,
-- config_ejes_id ni tc_vehiculos.km_actual. Idempotente.

create table if not exists tc_cat_equivalencias_flota (
  id            uuid primary key default gen_random_uuid(),
  marca_texto   text not null default '' check (marca_texto = upper(btrim(marca_texto))),
  modelo_texto  text not null default '' check (modelo_texto = upper(btrim(modelo_texto))),
  medida_texto  text not null default '' check (medida_texto = upper(btrim(medida_texto))),
  referencia_id uuid not null references tc_referencias_neumatico(id) on delete cascade,
  creado_por    uuid,
  created_at    timestamptz not null default now(),
  constraint ux_tc_cat_equivalencias_flota unique (marca_texto, modelo_texto, medida_texto)
);
create index if not exists ix_tc_cat_equivalencias_flota_ref on tc_cat_equivalencias_flota (referencia_id);
alter table tc_cat_equivalencias_flota enable row level security;
drop policy if exists tc_cat_equivalencias_flota_select on tc_cat_equivalencias_flota;
create policy tc_cat_equivalencias_flota_select on tc_cat_equivalencias_flota for select to authenticated using (true);
-- Escribir: solo el servidor (superadmin), con la clave de servicio.

create table if not exists tc_cat_parecidos_distintos (
  tipo       text not null check (tipo in ('modelo', 'medida')),
  a          uuid not null,
  b          uuid not null,
  creado_por uuid,
  created_at timestamptz not null default now(),
  primary key (tipo, a, b),
  check (a < b)
);
alter table tc_cat_parecidos_distintos enable row level security;
drop policy if exists tc_cat_parecidos_distintos_select on tc_cat_parecidos_distintos;
create policy tc_cat_parecidos_distintos_select on tc_cat_parecidos_distintos for select to authenticated using (true);

create or replace function public.tc_referencia_de_neumatico(p_neumatico uuid)
 returns uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select e.referencia_id
       from tc_neumaticos n
       join tc_cat_equivalencias_flota e
         on e.marca_texto = upper(btrim(coalesce(n.marca, '')))
        and e.modelo_texto = upper(btrim(coalesce(n.modelo, '')))
        and e.medida_texto = upper(btrim(coalesce(n.medida, '')))
      where n.id = p_neumatico),
    (select r.id
       from tc_neumaticos n
       join tc_cat_marcas_neumatico ma on upper(trim(ma.nombre)) = upper(trim(coalesce(n.marca, '')))
       join tc_cat_modelos_neumatico mo on mo.marca_id = ma.id and upper(trim(mo.nombre)) = upper(trim(coalesce(n.modelo, '')))
       join tc_referencias_neumatico r on r.modelo_id = mo.id
       join tyre_sizes ts on ts.id = r.tyre_size_id
      where n.id = p_neumatico
        and tc_medida_base(ts.medida) = tc_medida_base(n.medida)
      order by r.activo desc
      limit 1)
  )
$function$;
grant execute on function public.tc_referencia_de_neumatico(uuid) to authenticated;

-- La profundidad de nuevo: primero por equivalencia; si no, la consulta de antes tal cual.
create or replace function public.tc_profundidad_origen_neumatico(p_neumatico uuid)
 returns numeric
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select r.profundidad_dibujo_mm
       from tc_neumaticos n
       join tc_cat_equivalencias_flota e
         on e.marca_texto = upper(btrim(coalesce(n.marca, '')))
        and e.modelo_texto = upper(btrim(coalesce(n.modelo, '')))
        and e.medida_texto = upper(btrim(coalesce(n.medida, '')))
       join tc_referencias_neumatico r on r.id = e.referencia_id
      where n.id = p_neumatico),
    (select r.profundidad_dibujo_mm
       from tc_neumaticos n
       join tc_cat_marcas_neumatico ma on upper(trim(ma.nombre)) = upper(trim(coalesce(n.marca, '')))
       join tc_cat_modelos_neumatico mo on mo.marca_id = ma.id and upper(trim(mo.nombre)) = upper(trim(coalesce(n.modelo, '')))
       join tc_referencias_neumatico r on r.modelo_id = mo.id
       join tyre_sizes ts on ts.id = r.tyre_size_id
      where n.id = p_neumatico
        and tc_medida_base(ts.medida) = tc_medida_base(n.medida)
        and r.profundidad_dibujo_mm is not null
      order by r.activo desc
      limit 1)
  )
$function$;

do $migracion$
declare v_eq int;
begin
  if to_regclass('public.tc_cat_equivalencias_flota') is null then raise exception 'Falta tc_cat_equivalencias_flota'; end if;
  if to_regclass('public.tc_cat_parecidos_distintos') is null then raise exception 'Falta tc_cat_parecidos_distintos'; end if;
  if to_regprocedure('public.tc_referencia_de_neumatico(uuid)') is null then raise exception 'Falta tc_referencia_de_neumatico'; end if;
  select count(*) into v_eq from tc_cat_equivalencias_flota;
  perform set_config('mobilink.resultado',
    format('OK: depurar catálogo listo (%s equivalencias guardadas)', v_eq), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
