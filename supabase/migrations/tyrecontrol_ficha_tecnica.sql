-- ============================================================
-- SEA TyreControl - FICHA TECNICA del vehiculo (fases 1 y 2)
--
-- Digitalizacion de la ficha tecnica: se adjunta el PDF o se fotografian
-- las paginas, se pasa por OCR y los datos se revisan antes de tocar la
-- ficha del vehiculo.
--
-- IMPORTANTE sobre la configuracion de ejes: tc_config_ejes.nombre YA usa
-- la nomenclatura de TyreControl (neumaticos por eje, de delante atras:
-- 2x2x2, 2x4, 2x2x4...) y tc_vehiculo_ejes ya guarda un eje por fila. Aqui
-- solo se completan los atributos que faltaban de cada eje y se anade la
-- nomenclatura convencional del fabricante como dato INFORMATIVO.
-- ============================================================

-- ── 1. Atributos que faltaban en cada eje ───────────────────
alter table tc_vehiculo_ejes add column if not exists directriz boolean not null default false;
alter table tc_vehiculo_ejes add column if not exists motriz    boolean not null default false;
alter table tc_vehiculo_ejes add column if not exists elevable  boolean not null default false;

-- ── 2. Nomenclatura convencional del fabricante (informativa) ─
-- Nunca sustituye a la configuracion operativa (tc_config_ejes): solo se
-- guarda tal cual venga en el documento, o marcada como inferida.
alter table tc_vehiculos add column if not exists config_convencional text;
alter table tc_vehiculos add column if not exists config_convencional_origen text
  check (config_convencional_origen is null
         or config_convencional_origen in ('documento','inferido','manual'));

-- ── 3. Documentos del vehiculo ──────────────────────────────
create table if not exists tc_vehiculo_documentos (
  id             uuid primary key default gen_random_uuid(),
  vehiculo_id    uuid not null references tc_vehiculos(id) on delete cascade,
  empresa_id     uuid not null references tc_empresas(id) on delete restrict,
  tipo           text not null default 'ficha_tecnica',
  file_url       text,
  storage_path   text not null,
  nombre_original text,
  mime_type      text,
  paginas        int,
  tamano_bytes   bigint,
  hash_sha256    text,
  fecha_emision  date,
  ocr_estado     text not null default 'pendiente'
                 check (ocr_estado in ('pendiente','procesando','ok','error')),
  ocr_confianza  numeric,
  ocr_error      text,
  ocr_datos      jsonb,          -- JSON crudo devuelto por el OCR
  version        int not null default 1,
  vigente        boolean not null default true,
  sustituye_a    uuid references tc_vehiculo_documentos(id) on delete set null,
  es_duplicado   boolean not null default false,
  subido_por     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_veh_doc_vehiculo on tc_vehiculo_documentos (vehiculo_id);
-- Solo un documento vigente por vehiculo y tipo.
create unique index if not exists idx_veh_doc_vigente
  on tc_vehiculo_documentos (vehiculo_id, tipo) where vigente;

-- ── 4. Atributos tecnicos extensibles ───────────────────────
-- Para los datos de la ficha que no tienen columna propia (V.9 norma de
-- emisiones, niveles sonoros, homologaciones...). Asi no se crea una
-- columna nueva por cada codigo del documento.
create table if not exists tc_vehiculo_atributos_tecnicos (
  id                uuid primary key default gen_random_uuid(),
  vehiculo_id       uuid not null references tc_vehiculos(id) on delete cascade,
  documento_id      uuid references tc_vehiculo_documentos(id) on delete set null,
  codigo_origen     text,        -- "V.9", "F.1"...
  etiqueta_origen   text,        -- "Norma de emisiones"
  clave_normalizada text,        -- "norma_emisiones"
  valor_bruto       text,
  valor_normalizado text,
  tipo_valor        text,        -- texto | numero | fecha | booleano
  unidad            text,
  confianza         numeric,
  estado            text not null default 'detectado'
                    check (estado in ('detectado','pendiente','validado','rechazado','conflicto')),
  pagina            int,
  validado_por      uuid,
  validado_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_veh_attr_vehiculo on tc_vehiculo_atributos_tecnicos (vehiculo_id);
create index if not exists idx_veh_attr_doc on tc_vehiculo_atributos_tecnicos (documento_id);

-- ── 5. RLS: solo dentro de la empresa del vehiculo ──────────
alter table tc_vehiculo_documentos enable row level security;
alter table tc_vehiculo_atributos_tecnicos enable row level security;

drop policy if exists veh_doc_all on tc_vehiculo_documentos;
create policy veh_doc_all on tc_vehiculo_documentos for all to authenticated
  using (tc_puede_ver_empresa(empresa_id))
  with check (tc_puede_ver_empresa(empresa_id));

drop policy if exists veh_attr_all on tc_vehiculo_atributos_tecnicos;
create policy veh_attr_all on tc_vehiculo_atributos_tecnicos for all to authenticated
  using (exists (select 1 from tc_vehiculos v
                  where v.id = vehiculo_id and tc_puede_ver_empresa(v.empresa_id)))
  with check (exists (select 1 from tc_vehiculos v
                       where v.id = vehiculo_id and tc_puede_ver_empresa(v.empresa_id)));

-- ── 6. Bucket PRIVADO ───────────────────────────────────────
-- A diferencia de los demas buckets, este NO es publico: una ficha tecnica
-- lleva VIN y datos del titular. Se sirve con URL firmada desde el backend.
insert into storage.buckets (id, name, public)
values ('tc-documentos', 'tc-documentos', false)
on conflict (id) do nothing;
