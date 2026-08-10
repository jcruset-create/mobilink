-- ============================================================
-- Mobilink TyreControl — tc_agrupar_operaciones_sueltas a prueba de
-- llamadas simultáneas
--
-- La función se va a llamar cada vez que alguien abra un histórico, así que
-- pasará a ejecutarse muchas veces y a menudo a la vez: dos técnicos, o un
-- técnico y el panel.
--
-- Tal y como estaba, dos ejecuciones simultáneas podían coger la MISMA
-- operación huérfana: las dos creaban su intervención, las dos hacían el
-- update, ganaba la última — y la otra intervención se quedaba vacía,
-- ocupando un número de parte que no corresponde a ningún trabajo. Justo el
-- hueco en la serie que se quería evitar.
--
-- Se arregla por partida doble:
--   · Un cerrojo de sesión: si ya hay otra consolidación en marcha, esta se
--     va sin hacer nada en vez de esperar. No pasa nada por saltársela, la
--     siguiente llamada recogerá lo que quede.
--   · `for update skip locked` sobre las filas, que es el cinturón por si
--     alguien llama a la función sin pasar por el cerrojo.
--
-- Idempotente.
-- ============================================================

create or replace function tc_agrupar_operaciones_sueltas(p_minutos int default 30)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_interv uuid; n int := 0;
begin
  -- Cerrojo de transacción: se suelta solo al terminar, pase lo que pase.
  if not pg_try_advisory_xact_lock(hashtext('tc_agrupar_operaciones_sueltas')) then
    return 0;
  end if;

  for r in
    select id, empresa_id, vehiculo_id, tecnico_id, fecha_operacion, tipo_operacion,
           neumatico_id, created_at
      from operaciones_neumaticos
     where intervencion_id is null
       and created_at < now() - make_interval(mins => p_minutos)
     order by created_at, id
       for update skip locked
  loop
    insert into tc_intervenciones (
      empresa_id, vehiculo_id, fecha, tecnico_id, resumen, n_operaciones,
      tipo_principal, n_neumaticos, created_at)
    values (
      r.empresa_id, r.vehiculo_id, r.fecha_operacion, r.tecnico_id,
      -- Resumen mínimo y honrado: lo que se sabe con certeza de una línea
      -- suelta. Las de una sesión de Cambios traen el suyo, mucho más rico.
      initcap(replace(r.tipo_operacion, '_', ' ')),
      1, r.tipo_operacion, case when r.neumatico_id is null then null else 1 end,
      -- La intervención hereda la fecha de la operación: si se pusiera now(),
      -- una operación de julio aparecería como de hoy en el histórico.
      r.created_at)
    returning id into v_interv;

    update operaciones_neumaticos set intervencion_id = v_interv where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function tc_agrupar_operaciones_sueltas(int) to authenticated;
