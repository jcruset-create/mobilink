-- Seguimiento de rendimiento: el coste de cada goma, para sacar el € por km.
--
--   1. Columna coste_eur en tc_rendimiento_neumatico_inicio (euros, sin IVA o
--      con, lo que se ponga; puede ir vacía).
--   2. tc_rendimiento_ajustar_inicio acepta "coste_eur" por rueda: sin la
--      clave conserva el que hubiera, con null lo borra.
--   3. tc_rendimiento_datos devuelve 'coste_eur' (el del seguimiento o, si no
--      hay, el «Coste» de la ficha del neumático) y 'coste_de_ficha'.
--      Definiciones de producción del 27/11/2026 con esas líneas añadidas.
--
-- No escribe en tc_neumaticos (coste_compra solo se lee), tc_montajes_actuales,
-- tc_vehiculo_ejes, config_ejes_id ni km_actual. Idempotente.

alter table tc_rendimiento_neumatico_inicio add column if not exists coste_eur numeric;
alter table tc_rendimiento_neumatico_inicio drop constraint if exists tc_rendimiento_inicio_coste_ok;
alter table tc_rendimiento_neumatico_inicio add constraint tc_rendimiento_inicio_coste_ok
  check (coste_eur is null or (coste_eur >= 0 and coste_eur < 100000));

CREATE OR REPLACE FUNCTION public.tc_rendimiento_ajustar_inicio(p_vehiculo uuid, p_inicios jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp uuid; e jsonb; v_neu uuid; v_km numeric; v_prof numeric; v_excl boolean; v_coste numeric; v_hay_coste boolean; v_n int := 0;
begin
  select empresa_id into v_emp from tc_vehiculos where id = p_vehiculo;
  if v_emp is null then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_emp = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede cambiar el inicio del seguimiento';
  end if;
  if not exists (select 1 from tc_seguimiento_rendimiento where vehiculo_id = p_vehiculo) then
    raise exception 'Este vehículo no está en seguimiento de rendimiento';
  end if;
  if jsonb_typeof(p_inicios) is distinct from 'array' then raise exception 'Formato de inicios no válido'; end if;

  for e in select * from jsonb_array_elements(p_inicios) loop
    v_neu := (e->>'neumatico_id')::uuid;
    v_km := (e->>'km')::numeric;
    v_prof := (e->>'profundidad_mm')::numeric;
    v_excl := coalesce((e->>'excluido')::boolean, false);
    -- Sin la clave, el coste que hubiera se conserva; con null, se borra.
    v_hay_coste := e ? 'coste_eur';
    v_coste := nullif(e->>'coste_eur', '')::numeric;
    if not exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and neumatico_id = v_neu) then
      raise exception 'El neumático % no está montado en este vehículo', v_neu;
    end if;
    if v_km is null or v_km < 0 or v_km > 5000000 then raise exception 'Km de inicio imposibles: %', v_km; end if;
    if v_prof is null or v_prof <= 0 or v_prof > 30 then raise exception 'Profundidad de inicio imposible: % mm', v_prof; end if;
    if v_coste is not null and (v_coste < 0 or v_coste >= 100000) then raise exception 'Coste imposible: % €', v_coste; end if;
    insert into tc_rendimiento_neumatico_inicio (neumatico_id, vehiculo_id, empresa_id, km_vehiculo_inicio, profundidad_inicial_mm, fuente, excluido, coste_eur)
    values (v_neu, p_vehiculo, v_emp, v_km, v_prof, 'manual', v_excl, v_coste)
    on conflict (neumatico_id, vehiculo_id) do update set
      km_vehiculo_inicio = excluded.km_vehiculo_inicio,
      profundidad_inicial_mm = excluded.profundidad_inicial_mm,
      fuente = 'manual',
      excluido = excluded.excluido,
      coste_eur = case when v_hay_coste then excluded.coste_eur else tc_rendimiento_neumatico_inicio.coste_eur end;
    v_n := v_n + 1;
  end loop;

  -- «Desde origen» solo si todas las gomas montadas siguen empezando en 0.
  update tc_seguimiento_rendimiento s set
    desde_origen = not exists (
      select 1 from tc_montajes_actuales ma
        join tc_rendimiento_neumatico_inicio i on i.neumatico_id = ma.neumatico_id and i.vehiculo_id = ma.vehiculo_id
       where ma.vehiculo_id = p_vehiculo and i.km_vehiculo_inicio > 0 and not i.excluido),
    km_inicio = coalesce((
      select min(i.km_vehiculo_inicio) from tc_montajes_actuales ma
        join tc_rendimiento_neumatico_inicio i on i.neumatico_id = ma.neumatico_id and i.vehiculo_id = ma.vehiculo_id
       where ma.vehiculo_id = p_vehiculo and not i.excluido), s.km_inicio),
    updated_at = now()
  where s.vehiculo_id = p_vehiculo;

  return jsonb_build_object('vehiculo_id', p_vehiculo, 'gomas', v_n);
end $function$;

CREATE OR REPLACE FUNCTION public.tc_rendimiento_datos(p_vehiculo uuid DEFAULT NULL::uuid, p_empresa uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehiculo_id', v.id, 'matricula', v.matricula, 'numero_unidad', v.numero_unidad,
    -- El km del vehículo HOY: el mayor entre su km_actual, el de su última
    -- revisión con km y el último odómetro mensual de la telemática. Hay
    -- vehículos cargados del Excel con km_actual = 0 cuya revisión de hoy
    -- marca 17.343 km; con el km_actual solo, sus gomas «no habían recorrido».
    'km_actual_vehiculo', nullif(greatest(
      coalesce(v.km_actual, 0),
      coalesce((select max(r2.km_vehiculo) from revisiones_vehiculo r2
                 where r2.vehiculo_id = v.id and r2.estado_revision is distinct from 'anulada'), 0),
      coalesce((select max(mm.final_odometer_km) from integration_vehicle_monthly_mileage mm
                 where mm.mobilink_id = v.id::text and mm.sync_status = 'ok'), 0)
    ), 0),
    'desde_origen', s.desde_origen, 'fecha_inicio', s.fecha_inicio, 'minimo_mm', s.minimo_retirada_mm,
    'posicion_id', p.id, 'posicion', coalesce(p.nombre, p.codigo_posicion), 'eje', p.eje, 'orden', p.orden_visual,
    'neumatico_id', n.id, 'numero_interno', n.numero_interno,
    'marca', n.marca, 'modelo', n.modelo, 'medida', n.medida,
    -- La referencia del catálogo (por equivalencia o por texto): para agrupar
    -- «COACHZ», «XCOACH» y «X COACH Z» como el mismo neumático.
    'ref_marca', rc.marca, 'ref_modelo', rc.modelo, 'ref_medida', rc.medida,
    'recauchutado', n.recauchutado, 'reesculturado', n.reesculturado,
    -- La profundidad de HOY: la de la ficha o la de la última revisión
    -- completada, la que sea MÁS RECIENTE (la misma regla que el plano,
    -- `profundidadVigente`). Una revisión no toca la ficha del neumático, así
    -- que con la ficha sola el rendimiento seguía enseñando lo de antes de la
    -- revisión (5871NMK: 8 mm del inventario en vez de los 10,5 medidos).
    'profundidad_actual_mm', coalesce((
      select d.profundidad_mm
        from revisiones_neumaticos_detalle d
        join revisiones_vehiculo r on r.id = d.revision_id
       where d.neumatico_id = n.id
         and r.estado_revision like 'completada%'
         and d.profundidad_mm is not null
         and coalesce(r.medido_at, r.created_at) > coalesce(n.profundidad_actualizada_en, '-infinity'::timestamptz)
       order by coalesce(r.medido_at, r.created_at) desc
       limit 1
    ), n.profundidad_actual_mm),
    'km_vehiculo_inicio', coalesce(i.km_vehiculo_inicio, case when s.desde_origen then 0 else ma.km_montaje end),
    'profundidad_inicial_mm', coalesce(i.profundidad_inicial_mm, tc_profundidad_origen_neumatico(n.id)),
    'fuente_inicio', coalesce(i.fuente, 'catalogo'),
    -- Marcada «sin seguimiento» (sin datos fiables): se devuelve para poder
    -- volver a activarla, pero las pantallas no la cuentan.
    'excluido', coalesce(i.excluido, false),
    -- El coste de la goma: el puesto en el seguimiento o, si no, el «Coste»
    -- de su ficha (tc_neumaticos.coste_compra, solo se lee).
    'coste_eur', coalesce(i.coste_eur, n.coste_compra),
    'coste_de_ficha', i.coste_eur is null and n.coste_compra is not null,
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
  left join lateral (
    select ma3.nombre as marca, mo3.nombre as modelo, ts3.medida as medida
      from tc_referencias_neumatico r3
      join tc_cat_modelos_neumatico mo3 on mo3.id = r3.modelo_id
      join tc_cat_marcas_neumatico ma3 on ma3.id = mo3.marca_id
      left join tyre_sizes ts3 on ts3.id = r3.tyre_size_id
     where r3.id = tc_referencia_de_neumatico(n.id)
  ) rc on true
  where s.activo
    and (p_vehiculo is null or v.id = p_vehiculo)
    and (p_empresa is null or v.empresa_id = p_empresa)
    and (tc_is_superadmin() or v.empresa_id = tc_auth_empresa_id() or tc_operador_ve_empresa(v.empresa_id))
$function$;

do $migracion$
begin
  if position('coste_eur' in pg_get_functiondef('public.tc_rendimiento_datos(uuid,uuid)'::regprocedure)) = 0
     or position('coste_eur' in pg_get_functiondef('public.tc_rendimiento_ajustar_inicio(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'Las funciones no han quedado con el coste';
  end if;
  perform set_config('mobilink.resultado', 'OK: ya se puede poner el coste de cada goma en el seguimiento.', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
