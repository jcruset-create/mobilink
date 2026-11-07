-- ============================================================
-- SEA TyreControl — Tacógrafo, fase 3: lo que hace falta para importar,
-- deshacer y poder responder «¿qué pasó con esta fila?».
--
-- Va aparte de `tyrecontrol_tacografo.sql` a propósito: aquélla se revisó y
-- se aplicó sola, y mezclar las dos habría obligado a revisar otra vez lo que
-- ya estaba comprobado.
--
-- ── Por qué el «deshacer» necesita columnas nuevas ──────────────────────────
--
-- Deshacer un lote es borrar lo que ese lote metió. Fácil de decir y fácil de
-- hacer mal: si alguien vinculó después una intervención que entró sin
-- vehículo, o aceptó una propuesta de medida que salió de ella, borrarla de
-- golpe se lleva por delante trabajo de una persona sin avisar.
--
-- Para poder negarse hace falta SABER que algo se tocó después, y eso no se
-- puede deducir de las columnas que hay: `importado_en` dice cuándo entró,
-- pero nada dice si cambió luego. De ahí `actualizado_en` y su disparador.
--
-- Es idempotente de principio a fin, como la anterior, y se puede envolver en
-- `begin … commit`.
-- ============================================================

-- ── 1 · Saber si una fila se tocó después de importarla ─────────────────────

alter table tc_tacografo_intervenciones
  add column if not exists actualizado_en timestamptz not null default now(),
  -- Cuándo y quién vinculó a mano una intervención que entró sin vehículo.
  -- Es trabajo de una persona: deshacer el lote no se lo puede llevar.
  add column if not exists vinculado_en   timestamptz,
  add column if not exists vinculado_por  uuid references tc_usuarios(id);

create or replace function tc_tacografo_marcar_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_tcg_interv_actualizado on tc_tacografo_intervenciones;
create trigger trg_tcg_interv_actualizado
  before update on tc_tacografo_intervenciones
  for each row execute function tc_tacografo_marcar_actualizado();


-- ── 2 · El estado de un lote ────────────────────────────────────────────────
--
-- Un lote deshecho NO se borra: se marca. El registro de que alguien importó
-- 1.744 filas y las deshizo media hora después es justo lo que hace falta
-- para entender qué pasó, y borrarlo lo perdería.

alter table tc_tacografo_lotes
  add column if not exists estado         text not null default 'aplicado',
  add column if not exists deshecho_en    timestamptz,
  add column if not exists deshecho_por   uuid references tc_usuarios(id),
  add column if not exists sistema_origen text not null default 'informe_intervenciones',
  -- La huella del fichero. Sirve para decir «éste ya lo pasaste el martes»
  -- antes de ponerse a cruzar nada.
  add column if not exists archivo_sha256 text,
  add column if not exists nota           text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tc_tacografo_lotes_estado_ck'
                    and conrelid = 'tc_tacografo_lotes'::regclass) then
    alter table tc_tacografo_lotes
      add constraint tc_tacografo_lotes_estado_ck
      check (estado in ('aplicado','deshecho'));
  end if;
end $$;

create index if not exists idx_tcg_lotes_empresa_estado
  on tc_tacografo_lotes (empresa_id, estado, created_at desc);


-- ── 3 · Qué filas NO entraron, y por qué ────────────────────────────────────
--
-- Un recuento de «bloqueadas: 7» no sirve para arreglar nada. Esto guarda la
-- fila, lo que traía y el motivo, igual que `tc_importacion_bloqueados` hace
-- con el histórico de albaranes.

create table if not exists tc_tacografo_bloqueados (
  id              uuid primary key default gen_random_uuid(),
  lote_id         uuid not null references tc_tacografo_lotes(id) on delete cascade,
  empresa_id      uuid not null references tc_empresas(id) on delete restrict,
  fila_origen     integer,
  id_origen       text,
  matricula       text,
  fecha           date,
  motivo          text not null,
  valor           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_tcg_bloq_lote on tc_tacografo_bloqueados (lote_id);
create index if not exists idx_tcg_bloq_empresa on tc_tacografo_bloqueados (empresa_id);

alter table tc_tacografo_bloqueados enable row level security;
drop policy if exists tcg_bloq_sel on tc_tacografo_bloqueados;
create policy tcg_bloq_sel on tc_tacografo_bloqueados for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tcg_bloq_wr on tc_tacografo_bloqueados;
create policy tcg_bloq_wr on tc_tacografo_bloqueados for all
  using ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );

comment on table tc_tacografo_bloqueados is
  'Filas del informe de tacógrafo que no se pudieron importar, con su motivo. Un recuento no sirve para arreglar nada; esto sí.';
comment on column tc_tacografo_intervenciones.actualizado_en is
  'Se mantiene por disparador. Deshacer un lote se niega si alguna de sus filas cambió después de importarse.';
