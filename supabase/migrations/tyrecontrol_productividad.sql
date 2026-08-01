-- ============================================================
-- Mobilink TyreControl — Control de Tiempos y Productividad
--
-- Cronometraje AUTOMATICO por marcas de tiempo (nunca cronometros en
-- memoria): inicio_at se pone al crear la revision / abrir el cambio y
-- fin_at al finalizar. Las pausas ("Pausar trabajo" con motivo) se
-- guardan en tc_pausas_trabajo y sus totales se denormalizan en la fila
-- padre al finalizar. Se cumple: duracion = trabajo + pausa.
--
-- Las estadisticas se calculan con agregados en Postgres (RPCs
-- tc_prod_revisiones / tc_prod_operaciones): la APK nunca carga las
-- filas en memoria, escala a cientos de miles de registros.
--
-- Ejecutar a mano en el SQL Editor. Idempotente.
-- ============================================================

-- ── 1) Tiempos en REVISIONES ─────────────────────────────────
alter table revisiones_vehiculo add column if not exists inicio_at      timestamptz;
alter table revisiones_vehiculo add column if not exists fin_at         timestamptz;
alter table revisiones_vehiculo add column if not exists duracion_seg   int;
alter table revisiones_vehiculo add column if not exists trabajo_seg    int;
alter table revisiones_vehiculo add column if not exists pausa_seg      int not null default 0;
alter table revisiones_vehiculo add column if not exists n_pausas       int not null default 0;
alter table revisiones_vehiculo add column if not exists tipo_revision  text
  check (tipo_revision in ('solo_profundidades','profundidades_presiones'));
alter table revisiones_vehiculo add column if not exists n_neumaticos   int;

-- Las revisiones existentes arrancan con su created_at como inicio.
update revisiones_vehiculo set inicio_at = created_at where inicio_at is null;
alter table revisiones_vehiculo alter column inicio_at set default now();

create index if not exists idx_rev_veh_fin on revisiones_vehiculo (fin_at);

-- ── 2) Tiempos en OPERACIONES (intervenciones) ───────────────
alter table tc_intervenciones add column if not exists inicio_at      timestamptz;
alter table tc_intervenciones add column if not exists fin_at         timestamptz;
alter table tc_intervenciones add column if not exists duracion_seg   int;
alter table tc_intervenciones add column if not exists trabajo_seg    int;
alter table tc_intervenciones add column if not exists pausa_seg      int not null default 0;
alter table tc_intervenciones add column if not exists n_pausas       int not null default 0;
alter table tc_intervenciones add column if not exists tipo_principal text;
alter table tc_intervenciones add column if not exists n_neumaticos   int;

create index if not exists idx_interv_fin on tc_intervenciones (fin_at);

-- ── 3) Pausas de trabajo ─────────────────────────────────────
create table if not exists tc_pausas_trabajo (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references tc_empresas(id) on delete restrict,
  tecnico_id    uuid references tc_usuarios(id) on delete set null,
  vehiculo_id   uuid references tc_vehiculos(id) on delete set null,
  contexto      text not null check (contexto in ('revision','operacion')),
  revision_id   uuid references revisiones_vehiculo(id) on delete cascade,
  motivo        text not null check (motivo in (
                  'esperando_cliente','esperando_autorizacion','esperando_neumaticos',
                  'esperando_material','esperando_operario','averia_maquinaria',
                  'descanso','otro')),
  observaciones text,
  inicio_at     timestamptz not null,
  fin_at        timestamptz not null,
  duracion_seg  int generated always as
                (greatest(0, extract(epoch from (fin_at - inicio_at))::int)) stored,
  created_at    timestamptz not null default now()
);
create index if not exists idx_pausas_empresa on tc_pausas_trabajo (empresa_id);
create index if not exists idx_pausas_tecnico on tc_pausas_trabajo (tecnico_id);
create index if not exists idx_pausas_inicio  on tc_pausas_trabajo (inicio_at);

alter table tc_pausas_trabajo enable row level security;
drop policy if exists tc_pausas_sel on tc_pausas_trabajo;
create policy tc_pausas_sel on tc_pausas_trabajo for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_pausas_wr on tc_pausas_trabajo;
create policy tc_pausas_wr on tc_pausas_trabajo for all
  using      ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );

-- ── 4) RPC: estadisticas de REVISIONES ───────────────────────
-- security invoker: la RLS de las tablas decide que ve cada usuario.
-- Filtros null = sin filtrar. Devuelve todos los bloques en un json.
create or replace function tc_prod_revisiones(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_tecnico uuid default null,
  p_tipo_vehiculo uuid default null,
  p_tipo text default null
) returns jsonb language sql stable as $$
with base as (
  select r.id, r.empresa_id, r.tecnico_id, r.vehiculo_id,
         r.duracion_seg, r.trabajo_seg, r.pausa_seg, r.n_pausas,
         r.tipo_revision, r.fin_at,
         u.nombre  as tecnico,
         e.nombre  as cliente,
         v.matricula,
         tv.nombre as tipo_vehiculo
  from revisiones_vehiculo r
  left join tc_usuarios u  on u.id = r.tecnico_id
  left join tc_empresas e  on e.id = r.empresa_id
  left join tc_vehiculos v on v.id = r.vehiculo_id
  left join tc_tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
  where r.fin_at is not null and r.duracion_seg is not null
    and r.estado_revision in ('completada','completada_con_incidencias','completada_incidencia_pendiente','enviada')
    and (p_desde is null or r.fecha_revision >= p_desde)
    and (p_hasta is null or r.fecha_revision <= p_hasta)
    and (p_empresa is null or r.empresa_id = p_empresa)
    and (p_tecnico is null or r.tecnico_id = p_tecnico)
    and (p_tipo_vehiculo is null or v.tipo_vehiculo_id = p_tipo_vehiculo)
    and (p_tipo is null or r.tipo_revision = p_tipo)
),
pausas as (
  select p.motivo, count(*) as n, sum(p.duracion_seg) as total_seg
  from tc_pausas_trabajo p
  where p.contexto = 'revision'
    and p.revision_id in (select id from base)
  group by p.motivo
)
select jsonb_build_object(
  'kpis', (select jsonb_build_object(
      'total', count(*),
      'media_seg', round(avg(duracion_seg)),
      'media_solo_prof', round(avg(duracion_seg) filter (where tipo_revision = 'solo_profundidades')),
      'media_prof_pres', round(avg(duracion_seg) filter (where tipo_revision = 'profundidades_presiones')),
      'total_seg', sum(duracion_seg),
      'media_trabajo_seg', round(avg(coalesce(trabajo_seg, duracion_seg))),
      'media_pausa_seg', round(avg(pausa_seg)),
      'pct_inactividad', case when sum(duracion_seg) > 0
          then round(100.0 * sum(pausa_seg) / sum(duracion_seg), 1) else 0 end,
      'media_pausas', round(avg(n_pausas), 1)
    ) from base),
  'tecnico_mas_revisiones', (select jsonb_build_object('nombre', tecnico, 'n', count(*))
      from base where tecnico is not null group by tecnico order by count(*) desc limit 1),
  'tecnico_mejor_media', (select jsonb_build_object('nombre', tecnico, 'media_seg', round(avg(duracion_seg)))
      from base where tecnico is not null group by tecnico having count(*) >= 2
      order by avg(duracion_seg) asc limit 1),
  'vehiculo_mayor_media', (select jsonb_build_object('matricula', matricula, 'media_seg', round(avg(duracion_seg)))
      from base where matricula is not null group by matricula order by avg(duracion_seg) desc limit 1),
  'por_tecnico', (select coalesce(jsonb_agg(t order by t->'n' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'tecnico', tecnico, 'n', count(*),
        'media_seg', round(avg(duracion_seg)),
        'min_seg', min(duracion_seg), 'max_seg', max(duracion_seg),
        'media_solo_prof', round(avg(duracion_seg) filter (where tipo_revision = 'solo_profundidades')),
        'media_prof_pres', round(avg(duracion_seg) filter (where tipo_revision = 'profundidades_presiones')),
        'media_trabajo_seg', round(avg(coalesce(trabajo_seg, duracion_seg))),
        'media_pausa_seg', round(avg(pausa_seg)),
        'pct_inactividad', case when sum(duracion_seg) > 0
            then round(100.0 * sum(pausa_seg) / sum(duracion_seg), 1) else 0 end,
        'n_pausas', sum(n_pausas)
      ) as t from base where tecnico is not null group by tecnico) s),
  'por_tipo_vehiculo', (select coalesce(jsonb_agg(t order by t->'n' desc), '[]'::jsonb) from (
      select jsonb_build_object('tipo', coalesce(tipo_vehiculo, '—'), 'n', count(*),
        'media_seg', round(avg(duracion_seg))) as t from base group by tipo_vehiculo) s),
  'matriz', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select jsonb_build_object('tecnico', tecnico, 'tipo', coalesce(tipo_vehiculo, '—'),
        'media_seg', round(avg(duracion_seg)), 'n', count(*)) as t
      from base where tecnico is not null group by tecnico, tipo_vehiculo) s),
  'evolucion', (select coalesce(jsonb_agg(t order by t->>'mes'), '[]'::jsonb) from (
      select jsonb_build_object('mes', to_char(fin_at, 'YYYY-MM'), 'n', count(*),
        'media_seg', round(avg(duracion_seg))) as t from base group by to_char(fin_at, 'YYYY-MM')) s),
  'por_cliente', (select coalesce(jsonb_agg(t order by t->'pct_inactividad' desc), '[]'::jsonb) from (
      select jsonb_build_object('cliente', cliente, 'n', count(*),
        'media_seg', round(avg(duracion_seg)),
        'media_pausa_seg', round(avg(pausa_seg)),
        'pct_inactividad', case when sum(duracion_seg) > 0
            then round(100.0 * sum(pausa_seg) / sum(duracion_seg), 1) else 0 end) as t
      from base where cliente is not null group by cliente) s),
  'por_motivo', (select coalesce(jsonb_agg(jsonb_build_object(
      'motivo', motivo, 'n', n, 'total_seg', total_seg) order by total_seg desc), '[]'::jsonb)
      from pausas)
)
$$;

-- ── 5) RPC: estadisticas de OPERACIONES ──────────────────────
create or replace function tc_prod_operaciones(
  p_desde date default null,
  p_hasta date default null,
  p_empresa uuid default null,
  p_tecnico uuid default null,
  p_tipo_vehiculo uuid default null,
  p_tipo text default null
) returns jsonb language sql stable as $$
with base as (
  select i.id, i.empresa_id, i.tecnico_id, i.vehiculo_id,
         i.duracion_seg, i.trabajo_seg, i.pausa_seg, i.n_pausas,
         i.tipo_principal, i.n_operaciones, i.n_neumaticos, i.fin_at,
         u.nombre  as tecnico,
         e.nombre  as cliente,
         v.matricula,
         tv.nombre as tipo_vehiculo
  from tc_intervenciones i
  left join tc_usuarios u  on u.id = i.tecnico_id
  left join tc_empresas e  on e.id = i.empresa_id
  left join tc_vehiculos v on v.id = i.vehiculo_id
  left join tc_tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
  where i.fin_at is not null and i.duracion_seg is not null
    and (p_desde is null or i.fecha >= p_desde)
    and (p_hasta is null or i.fecha <= p_hasta)
    and (p_empresa is null or i.empresa_id = p_empresa)
    and (p_tecnico is null or i.tecnico_id = p_tecnico)
    and (p_tipo_vehiculo is null or v.tipo_vehiculo_id = p_tipo_vehiculo)
    and (p_tipo is null or i.tipo_principal = p_tipo)
),
pausas as (
  select p.motivo, count(*) as n, sum(p.duracion_seg) as total_seg
  from tc_pausas_trabajo p
  where p.contexto = 'operacion'
    and (p_desde is null or p.inicio_at::date >= p_desde)
    and (p_hasta is null or p.inicio_at::date <= p_hasta)
    and (p_empresa is null or p.empresa_id = p_empresa)
    and (p_tecnico is null or p.tecnico_id = p_tecnico)
  group by p.motivo
)
select jsonb_build_object(
  'kpis', (select jsonb_build_object(
      'total', count(*),
      'media_seg', round(avg(duracion_seg)),
      'total_seg', sum(duracion_seg),
      'media_trabajo_seg', round(avg(coalesce(trabajo_seg, duracion_seg))),
      'media_pausa_seg', round(avg(pausa_seg)),
      'pct_inactividad', case when sum(duracion_seg) > 0
          then round(100.0 * sum(pausa_seg) / sum(duracion_seg), 1) else 0 end,
      'media_pausas', round(avg(n_pausas), 1)
    ) from base),
  'operacion_mas_frecuente', (select jsonb_build_object('tipo', tipo_principal, 'n', count(*))
      from base where tipo_principal is not null group by tipo_principal order by count(*) desc limit 1),
  'operacion_mayor_duracion', (select jsonb_build_object('tipo', tipo_principal, 'media_seg', round(avg(duracion_seg)))
      from base where tipo_principal is not null group by tipo_principal order by avg(duracion_seg) desc limit 1),
  'tecnico_mas_operaciones', (select jsonb_build_object('nombre', tecnico, 'n', count(*))
      from base where tecnico is not null group by tecnico order by count(*) desc limit 1),
  'tecnico_mejor_media', (select jsonb_build_object('nombre', tecnico, 'media_seg', round(avg(duracion_seg)))
      from base where tecnico is not null group by tecnico having count(*) >= 2
      order by avg(duracion_seg) asc limit 1),
  'por_tipo_operacion', (select coalesce(jsonb_agg(t order by t->'n' desc), '[]'::jsonb) from (
      select jsonb_build_object('tipo', coalesce(tipo_principal, '—'), 'n', count(*),
        'media_seg', round(avg(duracion_seg))) as t from base group by tipo_principal) s),
  'por_tecnico', (select coalesce(jsonb_agg(t order by t->'n' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'tecnico', tecnico, 'n', count(*),
        'media_seg', round(avg(duracion_seg)),
        'min_seg', min(duracion_seg), 'max_seg', max(duracion_seg),
        'media_trabajo_seg', round(avg(coalesce(trabajo_seg, duracion_seg))),
        'media_pausa_seg', round(avg(pausa_seg)),
        'pct_inactividad', case when sum(duracion_seg) > 0
            then round(100.0 * sum(pausa_seg) / sum(duracion_seg), 1) else 0 end,
        'n_pausas', sum(n_pausas)
      ) as t from base where tecnico is not null group by tecnico) s),
  'por_tipo_vehiculo', (select coalesce(jsonb_agg(t order by t->'n' desc), '[]'::jsonb) from (
      select jsonb_build_object('tipo', coalesce(tipo_vehiculo, '—'), 'n', count(*),
        'media_seg', round(avg(duracion_seg))) as t from base group by tipo_vehiculo) s),
  'matriz', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select jsonb_build_object('tecnico', tecnico, 'tipo', coalesce(tipo_principal, '—'),
        'media_seg', round(avg(duracion_seg)), 'n', count(*)) as t
      from base where tecnico is not null group by tecnico, tipo_principal) s),
  'evolucion', (select coalesce(jsonb_agg(t order by t->>'mes'), '[]'::jsonb) from (
      select jsonb_build_object('mes', to_char(fin_at, 'YYYY-MM'), 'n', count(*),
        'media_seg', round(avg(duracion_seg))) as t from base group by to_char(fin_at, 'YYYY-MM')) s),
  'por_cliente', (select coalesce(jsonb_agg(t order by t->'pct_inactividad' desc), '[]'::jsonb) from (
      select jsonb_build_object('cliente', cliente, 'n', count(*),
        'media_seg', round(avg(duracion_seg)),
        'media_pausa_seg', round(avg(pausa_seg)),
        'pct_inactividad', case when sum(duracion_seg) > 0
            then round(100.0 * sum(pausa_seg) / sum(duracion_seg), 1) else 0 end) as t
      from base where cliente is not null group by cliente) s),
  'por_motivo', (select coalesce(jsonb_agg(jsonb_build_object(
      'motivo', motivo, 'n', n, 'total_seg', total_seg) order by total_seg desc), '[]'::jsonb)
      from pausas)
)
$$;
