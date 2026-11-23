-- ============================================================
-- Mobilink TyreControl — La «C» de comercial en el nombre de la referencia.
--
-- QUÉ PASABA
--
-- Una rueda de furgoneta se escribe «205/75 R16 C 113/111R»: la C dice que es
-- de uso comercial (más lonas, más carga). En el catálogo salía como
-- «205/75R16 113/111R», igual que se escribiría una de turismo, y quien la
-- busca por su nombre de siempre —el de la factura, el del flanco— no la
-- reconoce.
--
-- CUÁNDO LLEVA C
--
-- Medida métrica de llanta entera hasta 17" («205/75R16», «185R14») con
-- índice de carga DOBLE (113/111). Es la combinación que solo tiene la
-- rueda C:
--   · turismo: llanta entera pero índice simple → sin C;
--   · camión: índice doble pero llanta .5 (17.5, 19.5, 22.5) → sin C;
--   · LT americana («LT245/75R16») y diagonales («7.50R16») no encajan en la
--     forma métrica → sin C.
--
-- QUÉ CAMBIA
--
-- Solo el NOMBRE (referencia_completa). La medida se queda como está
-- («205/75R16»): los filtros por medida del vehículo, del eje y del almacén
-- siguen casando igual.
--
--   1. tc_sufijo_comercial(medida, índice doble) → 'C' o ''.
--   2. El disparador que calcula el nombre de tyre_sizes la añade.
--   3. Las combinaciones que ya existen se renombran, y con ellas el nombre de
--      sus referencias de modelo (tc_referencias_neumatico) y el de sus
--      productos de almacén enlazados que llevaban el nombre antiguo.
--      Si el nombre nuevo ya existiera (alguien la creó a mano con la C), esa
--      no se toca y se avisa: fusionar es otra decisión.
--
-- Idempotente: repetida, no hace nada.
-- ============================================================

create or replace function tc_sufijo_comercial(p_medida text, p_ic_doble text)
returns text language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_ic_doble, '')), '') is not null
     and upper(replace(coalesce(p_medida, ''), ' ', '')) ~ '^[0-9]{3}(/[0-9]{2})?R1[0-7]$'
    then 'C' else '' end
$$;

comment on function tc_sufijo_comercial(text, text) is
  'C si la rueda es comercial (furgoneta): medida métrica de llanta entera '
  'hasta 17" e índice de carga doble. Va pegada a la medida en el nombre: '
  '«205/75R16C 113/111R».';

create or replace function tc_tyre_size_referencia_trg() returns trigger
language plpgsql as $$
begin
  new.indice_carga_simple := upper(trim(new.indice_carga_simple));
  new.indice_carga_doble  := nullif(upper(trim(coalesce(new.indice_carga_doble, ''))), '');
  new.codigo_velocidad    := upper(trim(coalesce(new.codigo_velocidad, '')));
  new.referencia_completa := new.medida || tc_sufijo_comercial(new.medida, new.indice_carga_doble)
                             || ' ' || new.indice_carga_simple
                             || coalesce('/' || new.indice_carga_doble, '')
                             || coalesce(new.codigo_velocidad, '');
  return new;
end $$;

drop trigger if exists trg_tyre_size_referencia on tyre_sizes;
create trigger trg_tyre_size_referencia
  before insert or update of medida, indice_carga_simple, indice_carga_doble, codigo_velocidad
  on tyre_sizes for each row execute function tc_tyre_size_referencia_trg();

comment on function tc_tyre_size_referencia_trg() is
  'referencia_completa se calcula, no se escribe: medida (+C si es comercial) '
  '+ carga + velocidad.';

-- ── Renombrar lo que ya existe ──────────────────────────────────────────────
do $$
declare
  v_r record;
  v_nuevo text;
  v_combos int := 0;
  v_refs int := 0;
  v_prod int := 0;
  v_n int;
  v_choques text[] := '{}';
begin
  for v_r in
    select id, medida, referencia_completa as viejo,
           medida || tc_sufijo_comercial(medida, indice_carga_doble) || ' ' || indice_carga_simple
             || coalesce('/' || indice_carga_doble, '') || coalesce(codigo_velocidad, '') as nuevo
    from tyre_sizes
    where tc_sufijo_comercial(medida, indice_carga_doble) = 'C'
  loop
    continue when v_r.viejo = v_r.nuevo;
    if exists (select 1 from tyre_sizes where referencia_completa = v_r.nuevo and id <> v_r.id) then
      v_choques := v_choques || v_r.viejo;
      continue;
    end if;

    -- El disparador recalcula el nombre al tocar la medida.
    update tyre_sizes set medida = medida where id = v_r.id;
    v_combos := v_combos + 1;

    update tc_referencias_neumatico
       set referencia_completa = replace(referencia_completa, v_r.viejo, v_r.nuevo)
     where tyre_size_id = v_r.id
       and position(v_r.viejo in referencia_completa) > 0;
    get diagnostics v_n = row_count; v_refs := v_refs + v_n;

    if to_regclass('public.productos_neumaticos') is not null then
      update productos_neumaticos p
         set medida = v_r.nuevo
       where p.medida = v_r.viejo
         and p.referencia_neumatico_id in (select id from tc_referencias_neumatico where tyre_size_id = v_r.id);
      get diagnostics v_n = row_count; v_prod := v_prod + v_n;
    end if;
  end loop;

  raise notice 'C de comercial: % combinaciones, % referencias de modelo y % productos de almacén renombrados',
    v_combos, v_refs, v_prod;
  if array_length(v_choques, 1) > 0 then
    raise warning 'No renombradas porque ya existe la versión con C (son la misma rueda dos veces; fusionar a mano): %',
      array_to_string(v_choques, ', ');
  end if;
end $$;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  if tc_sufijo_comercial('205/75R16', '111') <> 'C'
     or tc_sufijo_comercial('185R14', '100') <> 'C'
     or tc_sufijo_comercial('205/55R16', null) <> ''
     or tc_sufijo_comercial('315/80R22.5', '150') <> ''
     or tc_sufijo_comercial('215/75R17.5', '124') <> ''
     or tc_sufijo_comercial('LT245/75R16', '116') <> '' then
    raise exception 'tc_sufijo_comercial no distingue bien las ruedas C';
  end if;

  select count(*) into n from tyre_sizes t
   where tc_sufijo_comercial(t.medida, t.indice_carga_doble) = 'C'
     and t.referencia_completa not like t.medida || 'C %'
     and not exists (select 1 from tyre_sizes o where o.id <> t.id
                      and o.referencia_completa = t.medida || 'C ' || t.indice_carga_simple
                          || coalesce('/' || t.indice_carga_doble, '') || coalesce(t.codigo_velocidad, ''));
  if n > 0 then
    raise exception 'Quedan % combinaciones comerciales sin la C en el nombre', n;
  end if;

  raise notice 'OK: la C de comercial va en el nombre de las referencias';
end $$;
