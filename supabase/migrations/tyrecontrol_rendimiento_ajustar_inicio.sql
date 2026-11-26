-- Seguimiento de rendimiento: cambiar a mano el punto de partida de cada goma
-- (km del vehículo y profundidad al empezar), y marcar «Por dónde rueda» al
-- activar un seguimiento.
--
--   1. tc_rendimiento_ajustar_inicio(vehículo, inicios): guarda el km y la
--      profundidad de inicio de las gomas MONTADAS en ese vehículo. Solo
--      administradores de la empresa (o super-admin). La fuente pasa a
--      «manual». Si alguna goma ya no empieza en 0, el seguimiento deja de
--      decir «desde origen».
--   2. Al activar (o reactivar) un seguimiento de rendimiento, el vehículo se
--      marca también en «Por dónde rueda». Y se marcan ya los activos que
--      faltaban (los activados después de la migración de ayer).
--
-- Solo escribe en tc_rendimiento_neumatico_inicio, tc_seguimiento_rendimiento
-- y tc_analisis_vias_vehiculo. No toca tc_neumaticos, tc_montajes_actuales
-- (solo se lee), tc_vehiculo_ejes, config_ejes_id ni km_actual.
-- Idempotente: se puede pegar dos veces.

create or replace function public.tc_rendimiento_ajustar_inicio(p_vehiculo uuid, p_inicios jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_emp uuid; e jsonb; v_neu uuid; v_km numeric; v_prof numeric; v_n int := 0;
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
    if not exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and neumatico_id = v_neu) then
      raise exception 'El neumático % no está montado en este vehículo', v_neu;
    end if;
    if v_km is null or v_km < 0 or v_km > 5000000 then raise exception 'Km de inicio imposibles: %', v_km; end if;
    if v_prof is null or v_prof <= 0 or v_prof > 30 then raise exception 'Profundidad de inicio imposible: % mm', v_prof; end if;
    insert into tc_rendimiento_neumatico_inicio (neumatico_id, vehiculo_id, empresa_id, km_vehiculo_inicio, profundidad_inicial_mm, fuente)
    values (v_neu, p_vehiculo, v_emp, v_km, v_prof, 'manual')
    on conflict (neumatico_id, vehiculo_id) do update set
      km_vehiculo_inicio = excluded.km_vehiculo_inicio,
      profundidad_inicial_mm = excluded.profundidad_inicial_mm,
      fuente = 'manual';
    v_n := v_n + 1;
  end loop;

  -- «Desde origen» solo si todas las gomas montadas siguen empezando en 0.
  update tc_seguimiento_rendimiento s set
    desde_origen = not exists (
      select 1 from tc_montajes_actuales ma
        join tc_rendimiento_neumatico_inicio i on i.neumatico_id = ma.neumatico_id and i.vehiculo_id = ma.vehiculo_id
       where ma.vehiculo_id = p_vehiculo and i.km_vehiculo_inicio > 0),
    km_inicio = coalesce((
      select min(i.km_vehiculo_inicio) from tc_montajes_actuales ma
        join tc_rendimiento_neumatico_inicio i on i.neumatico_id = ma.neumatico_id and i.vehiculo_id = ma.vehiculo_id
       where ma.vehiculo_id = p_vehiculo), s.km_inicio),
    updated_at = now()
  where s.vehiculo_id = p_vehiculo;

  return jsonb_build_object('vehiculo_id', p_vehiculo, 'gomas', v_n);
end $function$;
revoke all on function public.tc_rendimiento_ajustar_inicio(uuid, jsonb) from public, anon;
grant execute on function public.tc_rendimiento_ajustar_inicio(uuid, jsonb) to authenticated, service_role;

-- 2. Seguimiento activo → también «Por dónde rueda».
create or replace function public.tc_seguimiento_marca_vias()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.activo and (tg_op = 'INSERT' or old.activo is distinct from true) then
    insert into tc_analisis_vias_vehiculo (vehiculo_id, empresa_id, activo, creado_por)
    values (new.vehiculo_id, new.empresa_id, true, auth.uid())
    on conflict (vehiculo_id) do update set activo = true, updated_at = now();
  end if;
  return new;
end $function$;
revoke all on function public.tc_seguimiento_marca_vias() from public, anon, authenticated;

drop trigger if exists tc_seguimiento_marca_vias on tc_seguimiento_rendimiento;
create trigger tc_seguimiento_marca_vias
  after insert or update of activo on tc_seguimiento_rendimiento
  for each row execute function public.tc_seguimiento_marca_vias();

insert into tc_analisis_vias_vehiculo (vehiculo_id, empresa_id, activo, creado_por)
select s.vehiculo_id, s.empresa_id, true, null
  from tc_seguimiento_rendimiento s
 where s.activo
on conflict (vehiculo_id) do nothing;

do $migracion$
declare v_marcados int;
begin
  if to_regprocedure('public.tc_rendimiento_ajustar_inicio(uuid,jsonb)') is null then
    raise exception 'No se ha creado tc_rendimiento_ajustar_inicio';
  end if;
  select count(*) into v_marcados from tc_analisis_vias_vehiculo where activo;
  perform set_config('mobilink.resultado',
    format('OK: ya se puede cambiar el inicio del seguimiento por rueda; %s vehículos marcados en «Por dónde rueda».', v_marcados), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
