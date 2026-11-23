-- ============================================================
-- Mobilink TyreControl — tc_medida_base entiende la «ZR».
--
-- «245/45ZR18» es la medida 245/45R18 de un neumático de alta velocidad: la
-- Z va delante de la R y no cambia la medida. La expresión de tc_medida_base
-- no la contemplaba y devolvía basura («24R5»), así que una medida escrita
-- con ZR no casaba con nada en las compatibilidades. Es la gemela de
-- baseMedida() en shared/medidas.ts, que se corrige igual.
--
-- Idempotente.
-- ============================================================

create or replace function tc_medida_base(p text)
returns text language plpgsql immutable as $$
declare t text; m text[];
begin
  t := upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g'));
  m := regexp_match(t, '([0-9]{2,3})(?:/([0-9]{2,3}))?Z?R?([0-9]{1,2}(?:[.,][0-9])?)');
  if m is null then return t; end if;
  return m[1] || coalesce('/' || m[2], '') || 'R' || replace(m[3], ',', '.');
end $$;

do $$
begin
  if tc_medida_base('245/45ZR18') <> '245/45R18'
     or tc_medida_base('245/45 ZR 18 100Y') <> '245/45R18'
     or tc_medida_base('385/65 R22.5 160K') <> '385/65R22.5'
     or tc_medida_base('13R22.5') <> '13R22.5' then
    raise exception 'tc_medida_base no normaliza bien: %', tc_medida_base('245/45ZR18');
  end if;
  raise notice 'OK: tc_medida_base entiende la ZR';
end $$;
