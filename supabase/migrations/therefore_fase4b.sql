-- ============================================================
-- Mobilink Therefore — Fase 4b: trabajo diario
--
-- Dos retoques, ninguna tabla nueva:
--
--   thf_expedientes.recalculado_el   Cuándo se recalculó por última vez la
--                                    prioridad. Un DATE, no un TIMESTAMPTZ:
--                                    la pregunta es «¿ya se hizo hoy?» y los
--                                    puntos por antigüedad cambian una vez al
--                                    día.
--
--   thf_buzon_pasadas.origen         Se admite además 'historico' (la carga a
--                                    propósito de lo anterior a la activación)
--                                    y 'eml' (un correo importado a mano). Se
--                                    rehace el CHECK porque PostgreSQL no lo
--                                    amplía en sitio.
--
-- EQUIVALENTE EN CÓDIGO: server/therefore/schema.ts (initTherefore).
--
-- Requiere therefore_fase4.sql. Idempotente.
-- ============================================================

do $$
begin
  if to_regclass('public.thf_buzon_pasadas') is null then
    raise exception 'Falta therefore_fase4.sql: ejecútalo antes que éste';
  end if;
end $$;

alter table thf_expedientes add column if not exists recalculado_el date;

alter table thf_buzon_pasadas drop constraint if exists thf_buzon_pasadas_origen_check;
alter table thf_buzon_pasadas add constraint thf_buzon_pasadas_origen_check
  check (origen in ('temporizador','manual','historico','eml'));

do $$
begin
  raise notice 'OK: Therefore fase 4b (trabajo diario)';
end $$;
