-- ============================================================
-- Mobilink Therefore — Fase 4: el buzón
--
-- Una tabla: una fila por pasada del listener IMAP, como
-- tc_checkpoint_ejecuciones. Es lo que permite contestar «¿está leyendo el
-- buzón?» sin entrar en el servidor. Una pasada sin correos también se
-- registra: que no haya nada que leer es información, y una tabla que sólo
-- crece cuando llega algo no distingue «tranquilo» de «caído».
--
-- Las credenciales del buzón NO van en la base: son variables de entorno del
-- servidor (THEREFORE_IMAP_*). En thf_config sólo viven la lista de
-- remitentes (buzon.remitentes) y el instante de activación
-- (buzon.activado_el), que el listener escribe una sola vez.
--
-- EQUIVALENTE EN CÓDIGO: server/therefore/schema.ts (initTherefore).
--
-- Requiere therefore_fase1.sql. Idempotente.
-- ============================================================

do $$
begin
  if to_regclass('public.thf_config') is null then
    raise exception 'Falta therefore_fase1.sql: ejecútalo antes que éste';
  end if;
end $$;

create table if not exists thf_buzon_pasadas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null,
  iniciada_at   timestamptz not null default now(),
  terminada_at  timestamptz,

  correos       integer not null default 0,
  procesados    integer not null default 0,
  ignorados     integer not null default 0,
  errores       integer not null default 0,

  -- El fallo de la pasada entera (no se pudo abrir el buzón). Los de cada
  -- correo van en "detalle".
  error         text,
  -- [{messageId, asunto, resultado, expedienteNumero?, error?}]
  detalle       jsonb not null default '[]',
  -- Quién la lanzó: el temporizador o el botón del panel.
  origen        text not null default 'temporizador'
                  check (origen in ('temporizador','manual'))
);
create index if not exists thf_buzon_pasadas_idx
  on thf_buzon_pasadas(empresa_id, iniciada_at desc);

do $$
begin
  if to_regclass('public.app_empresas') is not null
     and not exists (select 1 from pg_constraint where conname = 'thf_buzon_pasadas_empresa_fk') then
    alter table thf_buzon_pasadas
      add constraint thf_buzon_pasadas_empresa_fk
      foreign key (empresa_id) references app_empresas(id) on delete cascade;
  end if;
  raise notice 'OK: Therefore fase 4 (buzón)';
end $$;
