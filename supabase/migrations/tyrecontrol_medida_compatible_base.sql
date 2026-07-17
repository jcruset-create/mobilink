-- ============================================================
-- SEA TyreControl — Homologación de medida por MEDIDA BASE
--
-- tc_medida_compatible comparaba la medida completa del producto
-- (con índice y espacios, p.ej. "385/65 R22.5 164K") contra la medida
-- homologada canónica ("385/65R22.5"), y nunca casaban → "no homologada".
-- Ahora compara solo la MEDIDA BASE (ancho/perfil R diámetro), ignorando
-- índices de carga/velocidad y espacios.
-- ============================================================

-- Medida base canónica: ancho[/perfil]Rdiámetro (sin índices ni espacios).
create or replace function tc_medida_base(p text)
returns text language plpgsql immutable as $$
declare t text; m text[];
begin
  t := upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g'));
  m := regexp_match(t, '([0-9]{2,3})(?:/([0-9]{2,3}))?R?([0-9]{1,2}(?:[.,][0-9])?)');
  if m is null then return t; end if;
  return m[1] || coalesce('/' || m[2], '') || 'R' || replace(m[3], ',', '.');
end $$;

create or replace function tc_medida_compatible(p_tipo_vehiculo uuid, p_medida text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    not exists (select 1 from tc_medidas_tipo_vehiculo where tipo_vehiculo_id = p_tipo_vehiculo)
    or exists (
      select 1 from tc_medidas_tipo_vehiculo mtv
      join tc_cat_medidas_neumatico m on m.id = mtv.medida_id
      where mtv.tipo_vehiculo_id = p_tipo_vehiculo
        and tc_medida_base(m.valor) = tc_medida_base(p_medida)
    )
$$;
