-- ============================================================
-- SEA TyreControl — Planificación de revisiones periódicas (Fase 1).
--
-- Plan de mantenimiento por vehículo con VARIAS operaciones periódicas
-- (revisión general, neumáticos, ITV, tacógrafo, aceite, frenos…), cada
-- una con su frecuencia (días/meses/km/horas/fecha fija/combinado →
-- "lo que venza primero"). Cálculo automático de la próxima revisión,
-- estado y prioridad. Reutiliza tc_vehiculos, tc_empresas, tc_delegaciones
-- (bases), tc_usuarios (técnicos) y el km del vehículo.
--
-- No borra nada existente. El intervalo simple (revision_intervalo_dias)
-- se migra a un plan "Revisión general" y deja de usarse.
-- ============================================================

-- ── 1. Catálogo de operaciones (tipos de revisión) ──────────────────────────
create table if not exists tc_operaciones_mantenimiento (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  orden       int not null default 100,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into tc_operaciones_mantenimiento (nombre, orden) values
  ('Revisión general', 10),
  ('Revisión de neumáticos', 20),
  ('Control de presiones', 30),
  ('Medición de profundidades', 40),
  ('Inspección visual', 50),
  ('Alineación', 60),
  ('Engrase', 70),
  ('Cambio de aceite', 80),
  ('Cambio de filtros', 90),
  ('Revisión de frenos', 100),
  ('Revisión de tacógrafo', 110),
  ('ITV', 120),
  ('Revisión de elementos de seguridad', 130)
on conflict (nombre) do nothing;

-- ── 2. Planes de mantenimiento (una fila por vehículo × operación) ──────────
create table if not exists tc_planes_mantenimiento (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references tc_empresas(id) on delete cascade,     -- cliente (para RLS)
  vehiculo_id       uuid not null references tc_vehiculos(id) on delete cascade,
  operacion_id      uuid not null references tc_operaciones_mantenimiento(id),
  nombre            text,                 -- nombre personalizado (si null, se usa el de la operación)
  descripcion       text,
  -- Frecuencia: se rellenan los que apliquen; si hay varios, vence el primero.
  frecuencia_dias   int,                  -- días/semanas (semanas = n*7)
  frecuencia_meses  int,                  -- meses/años (años = n*12)
  frecuencia_km     int,
  frecuencia_horas  int,
  fecha_fija        date,                 -- fecha fija concreta (ITV, etc.)
  -- Última realización
  ultima_fecha      date,
  ultima_km         numeric,
  ultima_horas      numeric,
  -- Próxima (calculada; editable manualmente → ajuste_manual)
  proxima_fecha     date,
  proxima_km        numeric,
  proxima_horas     numeric,
  ajuste_manual     boolean not null default false,
  margen_aviso_dias int not null default 15,
  prioridad_manual  text check (prioridad_manual in ('critica','alta','media','baja','sin')),
  estado_manual     text check (estado_manual in ('planificada','en_curso','realizada','cancelada','no_aplicable','vehiculo_no_disponible')),
  delegacion_id     uuid references tc_delegaciones(id) on delete set null,   -- base habitual
  tecnico_id        uuid references tc_usuarios(id) on delete set null,
  observaciones     text,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_by        uuid
);
create index if not exists idx_planes_mant_vehiculo on tc_planes_mantenimiento (vehiculo_id) where activo;
create index if not exists idx_planes_mant_empresa  on tc_planes_mantenimiento (empresa_id) where activo;
create index if not exists idx_planes_mant_operacion on tc_planes_mantenimiento (operacion_id);

-- ── 3. Registro de revisiones realizadas (historial de mantenimiento) ───────
create table if not exists tc_mantenimiento_realizadas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references tc_empresas(id) on delete cascade,
  vehiculo_id   uuid not null references tc_vehiculos(id) on delete cascade,
  plan_id       uuid references tc_planes_mantenimiento(id) on delete set null,
  operacion_id  uuid references tc_operaciones_mantenimiento(id),
  fecha         date not null default current_date,
  tecnico_id    uuid references tc_usuarios(id) on delete set null,
  km            numeric,
  horas         numeric,
  resultado     text check (resultado in ('correcta','correcta_obs','requiere_reparacion','incompleta','no_disponible','reprogramar','inmovilizar')),
  observaciones text,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
create index if not exists idx_mant_realizadas_vehiculo on tc_mantenimiento_realizadas (vehiculo_id, fecha desc);

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
alter table tc_operaciones_mantenimiento enable row level security;
alter table tc_planes_mantenimiento      enable row level security;
alter table tc_mantenimiento_realizadas  enable row level security;

drop policy if exists oper_mant_select on tc_operaciones_mantenimiento;
create policy oper_mant_select on tc_operaciones_mantenimiento for select using ( true );
drop policy if exists oper_mant_write on tc_operaciones_mantenimiento;
create policy oper_mant_write on tc_operaciones_mantenimiento for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists planes_mant_select on tc_planes_mantenimiento;
create policy planes_mant_select on tc_planes_mantenimiento for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists planes_mant_write on tc_planes_mantenimiento;
create policy planes_mant_write on tc_planes_mantenimiento for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists mant_realizadas_select on tc_mantenimiento_realizadas;
create policy mant_realizadas_select on tc_mantenimiento_realizadas for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists mant_realizadas_write on tc_mantenimiento_realizadas;
create policy mant_realizadas_write on tc_mantenimiento_realizadas for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

-- ── 5. Función central: estado + prioridad + próxima efectiva por plan ──────
-- security invoker → aplica la RLS del usuario. "Lo que venza primero" entre
-- fecha y km: el estado toma el peor de los dos.
create or replace function tc_plan_estado()
returns table (
  plan_id            uuid,
  vehiculo_id        uuid,
  empresa_id         uuid,
  operacion_id       uuid,
  proxima_fecha_efec date,
  proxima_km_efec    numeric,
  dias_restantes     int,
  km_restantes       numeric,
  estado             text,
  prioridad          text
)
language sql security invoker stable
set search_path = public as $$
  with base as (
    select
      p.id, p.vehiculo_id, p.empresa_id, p.operacion_id, p.activo,
      p.margen_aviso_dias, p.prioridad_manual, p.estado_manual, p.ajuste_manual,
      v.km_actual,
      -- próxima fecha efectiva
      case
        when p.ajuste_manual then p.proxima_fecha
        when p.fecha_fija is not null then p.fecha_fija
        when p.ultima_fecha is not null and p.frecuencia_meses is not null then (p.ultima_fecha + (p.frecuencia_meses || ' months')::interval)::date
        when p.ultima_fecha is not null and p.frecuencia_dias  is not null then p.ultima_fecha + p.frecuencia_dias
        else null
      end as prox_fecha,
      -- próxima km efectiva
      case
        when p.ajuste_manual then p.proxima_km
        when p.ultima_km is not null and p.frecuencia_km is not null then p.ultima_km + p.frecuencia_km
        else null
      end as prox_km
    from tc_planes_mantenimiento p
    join tc_vehiculos v on v.id = p.vehiculo_id
  ),
  calc as (
    select b.*,
      case when b.prox_fecha is not null then (b.prox_fecha - current_date) end as dias_rest,
      case when b.prox_km is not null then (b.prox_km - b.km_actual) end as km_rest
    from base b
  )
  select
    c.id, c.vehiculo_id, c.empresa_id, c.operacion_id,
    c.prox_fecha, c.prox_km, c.dias_rest, c.km_rest,
    -- estado
    case
      when not c.activo then 'no_aplicable'
      when c.estado_manual is not null then c.estado_manual
      when (c.dias_rest is not null and c.dias_rest < 0) or (c.km_rest is not null and c.km_rest < 0) then 'atrasada'
      when c.dias_rest = 0 then 'vence_hoy'
      when (c.dias_rest is not null and c.dias_rest <= c.margen_aviso_dias)
           or (c.km_rest is not null and c.km_rest <= 1000) then 'proxima'
      when c.prox_fecha is null and c.prox_km is null then 'correcta'
      else 'correcta'
    end as estado,
    -- prioridad (manual > calculada)
    coalesce(c.prioridad_manual,
      case
        when not c.activo or c.estado_manual in ('cancelada','no_aplicable') then 'sin'
        when (c.dias_rest is not null and c.dias_rest < -30) then 'critica'
        when (c.dias_rest is not null and c.dias_rest < 0) then 'alta'
        when (c.dias_rest is not null and c.dias_rest <= 7) or (c.km_rest is not null and c.km_rest <= 1000) then 'media'
        else 'baja'
      end
    ) as prioridad
  from calc c;
$$;

-- ── 6. Migración del intervalo simple → plan "Revisión general" ─────────────
-- Para cada vehículo activo con intervalo (propio o del tipo) y sin plan aún.
insert into tc_planes_mantenimiento (empresa_id, vehiculo_id, operacion_id, frecuencia_dias, ultima_fecha)
select v.empresa_id, v.id, og.id,
       coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias),
       (select max(r.fecha_revision) from revisiones_vehiculo r where r.vehiculo_id = v.id and r.estado_revision = 'completada')
from tc_vehiculos v
left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
cross join (select id from tc_operaciones_mantenimiento where nombre = 'Revisión general' limit 1) og
where v.activo
  and coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) is not null
  and not exists (select 1 from tc_planes_mantenimiento pm where pm.vehiculo_id = v.id and pm.operacion_id = og.id);
