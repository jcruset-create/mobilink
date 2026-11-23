-- ============================================================
-- Mobilink TyreControl — Base habitual: contar los aparcados y la última posición
--
-- Jordi abrió «Base habitual» para Mobilink Tarragona y salieron los 16
-- «Sin datos». Dos motivos:
--
--   1. Solo se contaban las horas IN_BASE (dentro y emitiendo). Un vehículo
--      aparcado en la base con el motor apagado deja de emitir y pasa a
--      STALE_POSITION aunque su última posición esté dentro: justo las noches,
--      que son lo que más dice de cuál es su base, no contaban. Ahora cuentan
--      las dos, siempre que la última posición caiga dentro de una base.
--   2. Mobilink Tarragona empezó a barrerse el 19/11/2026: no tiene días de
--      histórico. Sin horas, ahora se propone la base de su ÚLTIMA posición,
--      como DUDOSA: se enseña, pero «Asignar» no la pone sola.
--
-- Solo cambia el cálculo (tc_base_habitual, que solo lee). No escribe en
-- ninguna tabla; asignar sigue siendo tc_asignar_base_habitual, sin cambios,
-- y sigue asignando solo las decisiones claras.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
-- Repetida, no hace nada. Si algo no cuadra, se deshace entera.
-- ============================================================

begin;

create or replace function public.tc_base_habitual(p_empresa uuid, p_dias integer DEFAULT 30)
 RETURNS TABLE(vehiculo_id uuid, matricula text, base_actual_id uuid, base_actual text, base_propuesta_id uuid, base_propuesta text, horas numeric, horas_en_bases numeric, cuota numeric, estancias integer, segunda_id uuid, segunda text, horas_segunda numeric, decision text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET jit TO 'off'
as $function$
  with ventana as (
    select now() - make_interval(days => greatest(coalesce(p_dias, 30), 1)) as desde,
           now() as hasta
  ),
  -- Horas observadas en cada base, recortadas a la ventana. Una estancia
  -- abierta llega hasta su última muestra (`visto_at`), nunca hasta ahora.
  tramos as (
    select h.vehiculo_id, h.delegacion_id,
           extract(epoch from (
             least(coalesce(h.hasta, h.visto_at), v.hasta) - greatest(h.desde, v.desde)
           )) / 3600.0 as horas
      from tc_vehiculo_presencia_historico h
      cross join ventana v
      join tc_delegaciones d on d.id = h.delegacion_id and d.activo
     where h.empresa_id = p_empresa
       -- Dentro de la base con posición reciente, o con la última posición
       -- dentro y sin emitir: aparcado con el motor apagado. Es justo el
       -- tiempo que más dice de cuál es su base (las noches).
       and h.estado in ('IN_BASE', 'STALE_POSITION')
       and h.delegacion_id is not null
       and coalesce(h.hasta, h.visto_at) > v.desde
       and h.desde < v.hasta
  ),
  por_base as (
    select vehiculo_id, delegacion_id,
           sum(horas)::numeric as horas,
           count(*)::integer   as estancias
      from tramos
     where horas > 0
     group by vehiculo_id, delegacion_id
  ),
  ordenadas as (
    select pb.*,
           sum(horas) over (partition by vehiculo_id) as horas_en_bases,
           row_number() over (partition by vehiculo_id order by horas desc, estancias desc, delegacion_id) as puesto
      from por_base pb
  ),
  primera as (select * from ordenadas where puesto = 1),
  segunda as (select * from ordenadas where puesto = 2),
  -- Sin horas en la ventana (empresa recién conectada a la telemática): la
  -- base de su última posición, si cae dentro de una. Se propone como dudosa,
  -- así que se enseña pero no se asigna sola.
  ultima as (
    select pb.vehiculo_id, pb.delegacion_id
      from tc_vehiculo_presencia_base pb
      join tc_delegaciones d on d.id = pb.delegacion_id and d.activo
     where pb.estado in ('IN_BASE', 'STALE_POSITION')
  )
  select ve.id,
         ve.matricula,
         ve.delegacion_id,
         da.nombre,
         coalesce(p.delegacion_id, u.delegacion_id),
         coalesce(dp.nombre, du.nombre),
         round(p.horas, 1),
         round(p.horas_en_bases, 1),
         case when p.horas_en_bases > 0 then round(p.horas / p.horas_en_bases, 3) end,
         p.estancias,
         s.delegacion_id,
         ds.nombre,
         round(s.horas, 1),
         case
           when p.vehiculo_id is null and u.delegacion_id is not null then 'dudosa'
           when p.vehiculo_id is null then 'sin_datos'
           when p.horas >= 24 and p.horas / p.horas_en_bases >= 0.6 then 'clara'
           else 'dudosa'
         end
    from tc_vehiculos ve
    left join primera p  on p.vehiculo_id = ve.id
    left join segunda s  on s.vehiculo_id = ve.id
    left join ultima u   on u.vehiculo_id = ve.id
    left join tc_delegaciones du on du.id = u.delegacion_id
    left join tc_delegaciones da on da.id = ve.delegacion_id
    left join tc_delegaciones dp on dp.id = p.delegacion_id
    left join tc_delegaciones ds on ds.id = s.delegacion_id
   where ve.empresa_id = p_empresa
     and ve.activo
     and tc_puede_ver_empresa(p_empresa)
   order by
     case when p.vehiculo_id is null and u.delegacion_id is null then 2
          when p.vehiculo_id is null then 1
          when p.horas >= 24 and p.horas / p.horas_en_bases >= 0.6 then 0
          else 1 end,
     ve.matricula;
$function$;

do $comprobacion$
begin
  if (select count(*) from pg_proc where proname = 'tc_base_habitual') <> 1 then
    raise exception 'Tiene que quedar UNA sola tc_base_habitual.';
  end if;
  if position('STALE_POSITION' in pg_get_functiondef('tc_base_habitual'::regproc)) = 0 then
    raise exception 'tc_base_habitual no cuenta los aparcados.';
  end if;
  perform set_config('mobilink.resultado',
    'Base habitual: cuenta los aparcados en base y propone la última posición si no hay histórico.', false);
end $comprobacion$;

commit;

select current_setting('mobilink.resultado', true) as resultado;
