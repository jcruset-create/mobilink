-- Seguimiento de RENDIMIENTO kilométrico de los neumáticos de algunos vehículos.
--
-- Lo pidió Jordi: marcar vehículos concretos (p. ej. 7523NNB, que lleva sus
-- gomas de origen) para saber cuántos km da cada milímetro y proyectar la vida
-- de cada goma hasta la retirada.
--
-- NO es `tc_vehiculos.en_seguimiento`, que ya existe y significa «cuenta en
-- revisiones e informes». Esto es otra cosa y vive en sus propias tablas.
--
--  1. tc_seguimiento_rendimiento: qué vehículos se siguen, desde cuándo y con
--     qué mínimo de retirada.
--  2. tc_rendimiento_neumatico_inicio: para cada goma, desde qué km del
--     vehículo se cuenta y con qué profundidad empezó.
--  3. tc_profundidad_origen_neumatico(): la profundidad de nuevo del catálogo.
--  4. tc_rendimiento_activar / tc_rendimiento_desactivar.
--  5. tc_rendimiento_datos(): los puntos (km, mm) de cada goma seguida. La
--     recta y la proyección se calculan en la web (services/rendimiento.ts),
--     donde están probadas.
--  6. Catálogo: Michelin X COACH Z 295/80R22.5 = 14,3 mm de origen (ficha
--     técnica de Michelin, 18/32"), solo si estaba vacía.
--
-- Solo LEE tc_neumaticos, tc_montajes_actuales y tc_vehiculos.km_actual. No
-- toca tc_vehiculo_ejes ni config_ejes_id. Idempotente.

create table if not exists tc_seguimiento_rendimiento (
  vehiculo_id        uuid primary key references tc_vehiculos(id) on delete cascade,
  empresa_id         uuid not null,
  desde_origen       boolean not null default false,
  km_inicio          numeric,
  fecha_inicio       date not null default current_date,
  minimo_retirada_mm numeric not null default 3 check (minimo_retirada_mm > 0 and minimo_retirada_mm < 20),
  activo             boolean not null default true,
  creado_por         uuid default auth.uid(),
  notas              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists tc_rendimiento_neumatico_inicio (
  neumatico_id           uuid not null references tc_neumaticos(id) on delete cascade,
  vehiculo_id            uuid not null references tc_vehiculos(id) on delete cascade,
  empresa_id             uuid not null,
  km_vehiculo_inicio     numeric not null check (km_vehiculo_inicio >= 0),
  profundidad_inicial_mm numeric not null check (profundidad_inicial_mm > 0 and profundidad_inicial_mm <= 30),
  fuente                 text not null default 'catalogo' check (fuente in ('catalogo', 'manual')),
  created_at             timestamptz not null default now(),
  primary key (neumatico_id, vehiculo_id)
);

alter table tc_seguimiento_rendimiento enable row level security;
alter table tc_rendimiento_neumatico_inicio enable row level security;
drop policy if exists tc_seguimiento_rendimiento_select on tc_seguimiento_rendimiento;
create policy tc_seguimiento_rendimiento_select on tc_seguimiento_rendimiento for select to authenticated
  using ((select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));
drop policy if exists tc_rendimiento_inicio_select on tc_rendimiento_neumatico_inicio;
create policy tc_rendimiento_inicio_select on tc_rendimiento_neumatico_inicio for select to authenticated
  using ((select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));
-- Escribir solo por las funciones de abajo (security definer).

-- La profundidad de nuevo según el catálogo: marca + modelo + medida.
create or replace function public.tc_profundidad_origen_neumatico(p_neumatico uuid)
 returns numeric
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select r.profundidad_dibujo_mm
    from tc_neumaticos n
    join tc_cat_marcas_neumatico ma on upper(trim(ma.nombre)) = upper(trim(coalesce(n.marca, '')))
    join tc_cat_modelos_neumatico mo on mo.marca_id = ma.id and upper(trim(mo.nombre)) = upper(trim(coalesce(n.modelo, '')))
    join tc_referencias_neumatico r on r.modelo_id = mo.id
    join tyre_sizes ts on ts.id = r.tyre_size_id
   where n.id = p_neumatico
     and tc_medida_base(ts.medida) = tc_medida_base(n.medida)
     and r.profundidad_dibujo_mm is not null
   order by r.activo desc
   limit 1
$function$;

create or replace function public.tc_rendimiento_activar(
  p_vehiculo uuid,
  p_desde_origen boolean,
  p_km_inicio numeric default null,
  p_fecha_inicio date default null,
  p_minimo_mm numeric default 3,
  p_profundidad_origen numeric default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_veh record; m record; v_prof numeric; v_km numeric; v_gomas int := 0; v_sin text[] := '{}';
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede poner un vehículo en seguimiento de rendimiento';
  end if;
  if p_profundidad_origen is not null and (p_profundidad_origen <= 0 or p_profundidad_origen > 30) then
    raise exception 'Profundidad de origen imposible: % mm', p_profundidad_origen;
  end if;
  if p_km_inicio is not null and p_km_inicio < 0 then raise exception 'Kilómetros de inicio imposibles'; end if;

  -- Antes de escribir nada: cada goma tiene que tener de dónde sacar su
  -- profundidad de origen.
  for m in
    select ma.neumatico_id, n.marca, n.modelo, n.medida, p.nombre as pos
      from tc_montajes_actuales ma join tc_neumaticos n on n.id = ma.neumatico_id
      join tc_posiciones_vehiculo p on p.id = ma.posicion_id
     where ma.vehiculo_id = p_vehiculo
  loop
    if p_profundidad_origen is null and tc_profundidad_origen_neumatico(m.neumatico_id) is null then
      v_sin := v_sin || format('%s (%s %s %s)', m.pos, m.marca, m.modelo, m.medida);
    end if;
  end loop;
  if array_length(v_sin, 1) > 0 then
    raise exception 'SIN_PROFUNDIDAD_ORIGEN: el catálogo no dice la profundidad de nuevo de: %. Indícala a mano.',
      array_to_string(v_sin, ', ');
  end if;

  insert into tc_seguimiento_rendimiento (vehiculo_id, empresa_id, desde_origen, km_inicio, fecha_inicio, minimo_retirada_mm, activo)
  values (p_vehiculo, v_veh.empresa_id, p_desde_origen,
          case when p_desde_origen then 0 else coalesce(p_km_inicio, v_veh.km_actual) end,
          coalesce(p_fecha_inicio, current_date), coalesce(p_minimo_mm, 3), true)
  on conflict (vehiculo_id) do update set
    desde_origen = excluded.desde_origen, km_inicio = excluded.km_inicio, fecha_inicio = excluded.fecha_inicio,
    minimo_retirada_mm = excluded.minimo_retirada_mm, activo = true, updated_at = now();

  for m in
    select ma.neumatico_id, ma.km_montaje
      from tc_montajes_actuales ma where ma.vehiculo_id = p_vehiculo
  loop
    v_prof := coalesce(p_profundidad_origen, tc_profundidad_origen_neumatico(m.neumatico_id));
    v_km := case when p_desde_origen then 0 else coalesce(p_km_inicio, m.km_montaje, v_veh.km_actual, 0) end;
    insert into tc_rendimiento_neumatico_inicio (neumatico_id, vehiculo_id, empresa_id, km_vehiculo_inicio, profundidad_inicial_mm, fuente)
    values (m.neumatico_id, p_vehiculo, v_veh.empresa_id, v_km, v_prof,
            case when p_profundidad_origen is null then 'catalogo' else 'manual' end)
    on conflict (neumatico_id, vehiculo_id) do update set
      km_vehiculo_inicio = excluded.km_vehiculo_inicio,
      profundidad_inicial_mm = excluded.profundidad_inicial_mm,
      fuente = excluded.fuente;
    v_gomas := v_gomas + 1;
  end loop;

  return jsonb_build_object('vehiculo_id', p_vehiculo, 'gomas', v_gomas);
end $function$;

create or replace function public.tc_rendimiento_desactivar(p_vehiculo uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_emp uuid;
begin
  select empresa_id into v_emp from tc_vehiculos where id = p_vehiculo;
  if not (tc_is_superadmin() or (tc_is_admin() and v_emp = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede quitar un vehículo del seguimiento de rendimiento';
  end if;
  -- Se apaga, no se borra: el punto de partida de cada goma se conserva por si
  -- se vuelve a activar.
  update tc_seguimiento_rendimiento set activo = false, updated_at = now() where vehiculo_id = p_vehiculo;
end $function$;

-- Los datos de cada goma montada en vehículos con seguimiento ACTIVO.
-- Una goma montada después de activar, sin punto de partida guardado, cuenta
-- desde su montaje y con la profundidad de nuevo del catálogo.
create or replace function public.tc_rendimiento_datos(p_vehiculo uuid default null, p_empresa uuid default null)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehiculo_id', v.id, 'matricula', v.matricula, 'numero_unidad', v.numero_unidad,
    'km_actual_vehiculo', v.km_actual,
    'desde_origen', s.desde_origen, 'fecha_inicio', s.fecha_inicio, 'minimo_mm', s.minimo_retirada_mm,
    'posicion_id', p.id, 'posicion', coalesce(p.nombre, p.codigo_posicion), 'eje', p.eje, 'orden', p.orden_visual,
    'neumatico_id', n.id, 'numero_interno', n.numero_interno,
    'marca', n.marca, 'modelo', n.modelo, 'medida', n.medida,
    'recauchutado', n.recauchutado, 'reesculturado', n.reesculturado,
    'profundidad_actual_mm', n.profundidad_actual_mm,
    'km_vehiculo_inicio', coalesce(i.km_vehiculo_inicio, case when s.desde_origen then 0 else ma.km_montaje end),
    'profundidad_inicial_mm', coalesce(i.profundidad_inicial_mm, tc_profundidad_origen_neumatico(n.id)),
    'fuente_inicio', coalesce(i.fuente, 'catalogo'),
    'puntos', coalesce((
      select jsonb_agg(jsonb_build_object('km_vehiculo', r.km_vehiculo, 'mm', d.profundidad_mm, 'fecha', r.fecha_revision)
                       order by r.km_vehiculo, r.fecha_revision)
        from revisiones_neumaticos_detalle d
        join revisiones_vehiculo r on r.id = d.revision_id
       where d.neumatico_id = n.id and r.vehiculo_id = v.id
         and r.estado_revision <> 'anulada'
         and d.profundidad_mm is not null and r.km_vehiculo is not null and r.km_vehiculo > 0
    ), '[]'::jsonb)
  ) order by v.matricula, p.orden_visual), '[]'::jsonb)
  from tc_seguimiento_rendimiento s
  join tc_vehiculos v on v.id = s.vehiculo_id
  join tc_montajes_actuales ma on ma.vehiculo_id = v.id
  join tc_neumaticos n on n.id = ma.neumatico_id
  join tc_posiciones_vehiculo p on p.id = ma.posicion_id
  left join tc_rendimiento_neumatico_inicio i on i.neumatico_id = n.id and i.vehiculo_id = v.id
  where s.activo
    and (p_vehiculo is null or v.id = p_vehiculo)
    and (p_empresa is null or v.empresa_id = p_empresa)
    and (tc_is_superadmin() or v.empresa_id = tc_auth_empresa_id() or tc_operador_ve_empresa(v.empresa_id))
$function$;

grant execute on function public.tc_rendimiento_activar(uuid, boolean, numeric, date, numeric, numeric) to authenticated;
grant execute on function public.tc_rendimiento_desactivar(uuid) to authenticated;
grant execute on function public.tc_rendimiento_datos(uuid, uuid) to authenticated;
grant execute on function public.tc_profundidad_origen_neumatico(uuid) to authenticated;

do $migracion$
declare v_ref int; v_tablas int;
begin
  -- Michelin X COACH Z 295/80R22.5: 18/32" = 14,3 mm de nuevo (ficha técnica).
  update tc_referencias_neumatico r set profundidad_dibujo_mm = 14.3, updated_at = now()
    from tc_cat_modelos_neumatico mo, tc_cat_marcas_neumatico ma, tyre_sizes ts
   where r.modelo_id = mo.id and mo.marca_id = ma.id and ts.id = r.tyre_size_id
     and upper(ma.nombre) = 'MICHELIN' and upper(mo.nombre) = 'X COACH Z'
     and tc_medida_base(ts.medida) = '295/80R22.5'
     and r.profundidad_dibujo_mm is null;
  get diagnostics v_ref = row_count;

  select count(*) into v_tablas from information_schema.tables
   where table_name in ('tc_seguimiento_rendimiento', 'tc_rendimiento_neumatico_inicio');
  if v_tablas <> 2 then raise exception 'Faltan las tablas de seguimiento de rendimiento'; end if;

  perform set_config('mobilink.resultado', format(
    'OK: seguimiento de rendimiento listo · %s referencia(s) X COACH Z con 14,3 mm de origen', v_ref), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
