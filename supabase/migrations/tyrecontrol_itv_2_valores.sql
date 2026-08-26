-- ============================================================
-- SEA TyreControl - Modulo ficha tecnica ITV (2/3): valores por vehiculo
--
-- Extiende tc_vehiculo_atributos_tecnicos (que ya existia) para que sea
-- la fuente de la verdad de la ficha tecnica: enlace real al maestro,
-- valor normalizado tipado y trazabilidad de quien lo confirmo.
--
-- Requiere haber ejecutado antes tyrecontrol_itv_1_maestro.sql
-- ============================================================

alter table tc_vehiculo_atributos_tecnicos
  add column if not exists campo_ficha_id          uuid,
  add column if not exists valor_json              jsonb,
  add column if not exists valor_numero            numeric,
  add column if not exists valor_fecha             date,
  add column if not exists valor_booleano          boolean,
  add column if not exists origen                  text not null default 'manual',
  add column if not exists verificado_manualmente  boolean not null default false;

alter table tc_vehiculo_atributos_tecnicos drop constraint if exists fk_atributos_campo_ficha;
alter table tc_vehiculo_atributos_tecnicos
  add constraint fk_atributos_campo_ficha
  foreign key (campo_ficha_id) references tc_cat_campos_ficha_tecnica (id) on delete restrict;

alter table tc_vehiculo_atributos_tecnicos drop constraint if exists chk_atributos_origen;
alter table tc_vehiculo_atributos_tecnicos add constraint chk_atributos_origen check (
  origen in ('manual','ocr','importacion','api')
);

-- ── Backfill: enlazar las filas que ya existen con el maestro ──────
update tc_vehiculo_atributos_tecnicos a
   set campo_ficha_id = c.id
  from tc_cat_campos_ficha_tecnica c
 where a.campo_ficha_id is null
   and a.clave_normalizada is not null
   and c.clave = a.clave_normalizada;

-- Las que venian del OCR sin clave normalizada, por codigo de la ficha.
update tc_vehiculo_atributos_tecnicos a
   set campo_ficha_id = c.id
  from tc_cat_campos_ficha_tecnica c
 where a.campo_ficha_id is null
   and a.codigo_origen is not null
   and upper(trim(c.codigo)) = upper(trim(a.codigo_origen));

update tc_vehiculo_atributos_tecnicos
   set origen = 'ocr'
 where documento_id is not null and origen = 'manual';

update tc_vehiculo_atributos_tecnicos
   set verificado_manualmente = true
 where estado = 'validado';

-- ── Un solo valor por vehiculo y campo ─────────────────────────────
-- Antes de crear el unique hay que quedarse con la fila mas reciente de
-- cada par; las anteriores se borran (no habia unique y podia duplicar).
delete from tc_vehiculo_atributos_tecnicos a
 using tc_vehiculo_atributos_tecnicos b
 where a.campo_ficha_id is not null
   and a.campo_ficha_id = b.campo_ficha_id
   and a.vehiculo_id    = b.vehiculo_id
   and (a.updated_at, a.id) < (b.updated_at, b.id);

create unique index if not exists uq_atributos_vehiculo_campo
  on tc_vehiculo_atributos_tecnicos (vehiculo_id, campo_ficha_id)
  where campo_ficha_id is not null;

create index if not exists idx_atributos_vehiculo  on tc_vehiculo_atributos_tecnicos (vehiculo_id);
create index if not exists idx_atributos_campo     on tc_vehiculo_atributos_tecnicos (campo_ficha_id);
create index if not exists idx_atributos_documento on tc_vehiculo_atributos_tecnicos (documento_id);
create index if not exists idx_veh_docs_vehiculo   on tc_vehiculo_documentos (vehiculo_id);

notify pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────────
-- drop index if exists uq_atributos_vehiculo_campo;
-- alter table tc_vehiculo_atributos_tecnicos
--   drop constraint if exists fk_atributos_campo_ficha,
--   drop constraint if exists chk_atributos_origen,
--   drop column if exists campo_ficha_id, drop column if exists valor_json,
--   drop column if exists valor_numero,   drop column if exists valor_fecha,
--   drop column if exists valor_booleano, drop column if exists origen,
--   drop column if exists verificado_manualmente;
