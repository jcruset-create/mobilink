-- ============================================================
-- SEA TyreControl — Fase 17: ficha técnica por modelo + referencia
-- comercial concreta (modelo + medida). Reutiliza tc_cat_modelos_neumatico
-- (Fase 9), tc_cat_marcas_neumatico/tc_cat_fabricantes (Fase 15) y
-- tyre_sizes (Fase 16) — no se duplica marca/modelo/medida.
-- ============================================================

-- ── 1. Datos técnicos constantes del modelo (eje/aplicación no ──
-- cambian entre medidas del mismo modelo, según lo confirmado) ──
alter table tc_cat_modelos_neumatico
  add column if not exists gama             text,
  add column if not exists eje_recomendado  text,
  add column if not exists aplicacion       text,
  add column if not exists tipo_vehiculo    text,
  add column if not exists m_s              boolean,
  add column if not exists tres_pmsf        boolean,
  add column if not exists reesculturable   boolean,
  add column if not exists recauchutable    boolean,
  add column if not exists foto_modelo_url  text;

alter table tc_cat_modelos_neumatico drop constraint if exists chk_modelo_eje;
alter table tc_cat_modelos_neumatico add constraint chk_modelo_eje
  check (eje_recomendado is null or eje_recomendado in ('direccion','traccion','remolque','mixto'));

alter table tc_cat_modelos_neumatico drop constraint if exists chk_modelo_tipo_vehiculo;
alter table tc_cat_modelos_neumatico add constraint chk_modelo_tipo_vehiculo
  check (tipo_vehiculo is null or tipo_vehiculo in (
    'camion','autobus','turismo','furgoneta','agricola','otr','industrial',
    'carretillas_elevadoras','multisegmento'
  ));

-- ── 2. Referencia comercial (modelo × medida concreta) ─────────
-- Los datos que sí varían por medida (profundidad, peso, presión…)
-- viven aquí, no en el modelo.
create table if not exists tc_referencias_neumatico (
  id                   uuid primary key default gen_random_uuid(),
  modelo_id            uuid not null references tc_cat_modelos_neumatico(id) on delete cascade,
  tyre_size_id          uuid not null references tyre_sizes(id) on delete restrict,
  profundidad_dibujo_mm numeric,
  llanta_recomendada    text,
  diametro_exterior_mm  numeric,
  revoluciones_km       numeric,
  carga_maxima_kg       numeric,
  presion_maxima_bar    numeric,
  peso_kg               numeric,
  referencia_completa   text not null unique,
  activo                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (modelo_id, tyre_size_id)
);
create index if not exists idx_tc_ref_neu_modelo on tc_referencias_neumatico (modelo_id);
create index if not exists idx_tc_ref_neu_tyre_size on tc_referencias_neumatico (tyre_size_id);

alter table tc_referencias_neumatico enable row level security;
drop policy if exists tc_ref_neu_select on tc_referencias_neumatico;
create policy tc_ref_neu_select on tc_referencias_neumatico for select using ( auth.uid() is not null );
drop policy if exists tc_ref_neu_write on tc_referencias_neumatico;
create policy tc_ref_neu_write on tc_referencias_neumatico for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

-- ── 3. Bucket de Storage para fotos de modelo (una por modelo, ──
-- válida para todas sus medidas) — mismo patrón que tc-marcas/tc-chasis.
insert into storage.buckets (id, name, public)
values ('tc-modelos-neumatico', 'tc-modelos-neumatico', true)
on conflict (id) do nothing;

drop policy if exists tc_modelos_img_read on storage.objects;
create policy tc_modelos_img_read on storage.objects for select
  using ( bucket_id = 'tc-modelos-neumatico' );
drop policy if exists tc_modelos_img_write on storage.objects;
create policy tc_modelos_img_write on storage.objects for insert
  with check ( bucket_id = 'tc-modelos-neumatico' and tc_is_superadmin() );
drop policy if exists tc_modelos_img_update on storage.objects;
create policy tc_modelos_img_update on storage.objects for update
  using ( bucket_id = 'tc-modelos-neumatico' and tc_is_superadmin() );
drop policy if exists tc_modelos_img_delete on storage.objects;
create policy tc_modelos_img_delete on storage.objects for delete
  using ( bucket_id = 'tc-modelos-neumatico' and tc_is_superadmin() );

-- ── 4. Precarga: ~30 referencias Hankook, sin inventar datos ────
-- técnicos que no conocemos (profundidad/peso/presión quedan NULL).
do $$
declare v_hankook uuid; v_ah51 uuid; v_dh51 uuid; v_th31 uuid; v_al50 uuid; v_dl50 uuid;
begin
  select id into v_hankook from tc_cat_marcas_neumatico where nombre = 'Hankook';
  if v_hankook is null then return; end if;

  -- Modelos (se actualiza la clasificación si el modelo ya existía de antes,
  -- por ejemplo si se creó a mano desde Configuración)
  insert into tc_cat_modelos_neumatico (marca_id, nombre, gama, eje_recomendado, aplicacion, tipo_vehiculo)
  values (v_hankook, 'AH51', 'SmartFlex', 'direccion', 'regional', 'camion')
  on conflict (marca_id, nombre) do update set gama = excluded.gama,
    eje_recomendado = excluded.eje_recomendado, aplicacion = excluded.aplicacion, tipo_vehiculo = excluded.tipo_vehiculo
  returning id into v_ah51;

  insert into tc_cat_modelos_neumatico (marca_id, nombre, gama, eje_recomendado, aplicacion, tipo_vehiculo)
  values (v_hankook, 'DH51', 'SmartFlex', 'traccion', 'regional', 'camion')
  on conflict (marca_id, nombre) do update set gama = excluded.gama,
    eje_recomendado = excluded.eje_recomendado, aplicacion = excluded.aplicacion, tipo_vehiculo = excluded.tipo_vehiculo
  returning id into v_dh51;

  insert into tc_cat_modelos_neumatico (marca_id, nombre, gama, eje_recomendado, aplicacion, tipo_vehiculo)
  values (v_hankook, 'TH31+', 'SmartFlex', 'remolque', 'regional', 'camion')
  on conflict (marca_id, nombre) do update set gama = excluded.gama,
    eje_recomendado = excluded.eje_recomendado, aplicacion = excluded.aplicacion, tipo_vehiculo = excluded.tipo_vehiculo
  returning id into v_th31;

  insert into tc_cat_modelos_neumatico (marca_id, nombre, gama, eje_recomendado, aplicacion, tipo_vehiculo)
  values (v_hankook, 'AL50', 'SmartLine', 'direccion', 'larga_distancia', 'camion')
  on conflict (marca_id, nombre) do update set gama = excluded.gama,
    eje_recomendado = excluded.eje_recomendado, aplicacion = excluded.aplicacion, tipo_vehiculo = excluded.tipo_vehiculo
  returning id into v_al50;

  insert into tc_cat_modelos_neumatico (marca_id, nombre, gama, eje_recomendado, aplicacion, tipo_vehiculo)
  values (v_hankook, 'DL50', 'SmartLine', 'traccion', 'larga_distancia', 'camion')
  on conflict (marca_id, nombre) do update set gama = excluded.gama,
    eje_recomendado = excluded.eje_recomendado, aplicacion = excluded.aplicacion, tipo_vehiculo = excluded.tipo_vehiculo
  returning id into v_dl50;

  -- Referencias: cruce modelo x medida ya existente en tyre_sizes (Fase 16).
  -- AH51 (dirección): 315/80, 315/70, 295/80, 385/65, 385/55, 435/50, 445/45
  insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa)
  select v_ah51, ts.id, 'Hankook AH51 ' || ts.referencia_completa
  from tyre_sizes ts
  where ts.medida in ('315/80 R22.5','315/70 R22.5','295/80 R22.5','385/65 R22.5','385/55 R22.5','435/50 R19.5','445/45 R19.5')
  on conflict (modelo_id, tyre_size_id) do nothing;

  -- DH51 (tracción): 315/80, 315/70, 315/60, 295/80
  insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa)
  select v_dh51, ts.id, 'Hankook DH51 ' || ts.referencia_completa
  from tyre_sizes ts
  where ts.medida in ('315/80 R22.5','315/70 R22.5','315/60 R22.5','295/80 R22.5')
  on conflict (modelo_id, tyre_size_id) do nothing;

  -- TH31+ (remolque): 385/65, 385/55, 435/50, 445/45, 13 R22.5, 12 R22.5
  insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa)
  select v_th31, ts.id, 'Hankook TH31+ ' || ts.referencia_completa
  from tyre_sizes ts
  where ts.medida in ('385/65 R22.5','385/55 R22.5','435/50 R19.5','445/45 R19.5','13 R22.5','12 R22.5')
  on conflict (modelo_id, tyre_size_id) do nothing;

  -- AL50 (dirección larga distancia): 315/70, 295/80, 275/70, 245/70 R19.5
  insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa)
  select v_al50, ts.id, 'Hankook AL50 ' || ts.referencia_completa
  from tyre_sizes ts
  where ts.medida in ('315/70 R22.5','295/80 R22.5','275/70 R22.5','245/70 R19.5')
  on conflict (modelo_id, tyre_size_id) do nothing;

  -- DL50 (tracción larga distancia): 315/70, 295/80, 305/70, 265/70 R19.5, 285/70 R19.5
  insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa)
  select v_dl50, ts.id, 'Hankook DL50 ' || ts.referencia_completa
  from tyre_sizes ts
  where ts.medida in ('315/70 R22.5','295/80 R22.5','305/70 R22.5','265/70 R19.5','285/70 R19.5')
  on conflict (modelo_id, tyre_size_id) do nothing;
end $$;
