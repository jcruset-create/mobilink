-- ============================================================
-- Mobilink TyreControl — "Flota revisada" medida contra su periodicidad
--
-- El informe ejecutivo decía "FLOTA REVISADA 35% · 255 de 719 · 464 sin
-- revisar". Ese 35% se calculaba contra el periodo del informe, que por
-- defecto es el mes en curso. Si los vehículos se revisan cada dos meses, un
-- periodo de once días NUNCA va a dar un número bueno: ese 65% "sin revisar"
-- no es flota descuidada, es flota que no tocaba todavía.
--
-- Un porcentaje que siempre sale mal deja de mirarse, y con él se dejan de
-- mirar los vehículos que sí están vencidos de verdad.
--
-- Lo que se añade a la cabecera del informe, en la clave "cobertura":
--
--   al_dia        · su última revisión está dentro de su intervalo
--   proximos      · les toca en 15 días o menos
--   vencidos      · se les ha pasado la fecha
--   sin_revision  · no tienen ninguna revisión
--   sin_intervalo · nadie les ha dicho cada cuánto se revisan
--
-- El intervalo sale de tc_vehiculos.revision_intervalo_dias y, si está
-- vacío, del tipo (tc_tipos_vehiculo.revision_intervalo_dias). Es el mismo
-- criterio que ya usa tc_revision_estado() para "vencida / próxima", así que
-- el informe y la planificación cuentan lo mismo. Se calcula aquí dentro en
-- vez de llamar a esa función porque el informe filtra por empresa y ella no.
--
-- Lo de antes NO se quita: "revisados en el periodo" sigue en la cabecera,
-- que para medir la actividad de un mes es lo correcto. Lo que cambia es
-- cuál de los dos números es el titular.
--
-- CADA CUÁNTO SE REVISA no lo decide esta migración: se pone en el panel, en
-- Configuración (por tipo de vehículo) o en la ficha de un vehículo
-- concreto. Para una revisión bimestral son 60 días. Sin intervalo, un
-- vehículo cuenta como "sin_intervalo": no se le puede reclamar nada porque
-- nadie ha dicho cuándo le toca.
--
-- CÓMO ESTÁ HECHO: el informe que ya había pasa a llamarse
-- tc_informe_ejecutivo_base y tc_informe_ejecutivo se queda como un
-- envoltorio que le añade la cobertura. Así no hay que copiar aquí las
-- trescientas líneas del informe, que se quedarían atrás en cuanto alguien
-- toque el original. OJO: si algún día se vuelve a ejecutar la migración
-- vieja (tyrecontrol_informe_ejecutivo.sql), recrearía el original con su
-- nombre y se llevaría por delante este envoltorio; habría que volver a
-- pasar esta.
--
-- Idempotente.
-- ============================================================

-- ── 1. Apartar el informe actual ────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'tc_informe_ejecutivo_base')
  then
    alter function public.tc_informe_ejecutivo(uuid, date, date)
      rename to tc_informe_ejecutivo_base;
    raise notice 'El informe pasa a llamarse tc_informe_ejecutivo_base';
  else
    raise notice 'tc_informe_ejecutivo_base ya existía: no se renombra nada';
  end if;
end $$;

-- ── 2. El envoltorio, que añade la cobertura ────────────────────────────────
create or replace function public.tc_informe_ejecutivo(
  p_empresa uuid default null,
  p_desde   date default null,
  p_hasta   date default null
)
returns jsonb
language sql
security invoker
stable
-- Mismo motivo que en la función base: sin esto, PostgreSQL se va casi cinco
-- segundos compilando el plan y el informe caduca. Está explicado a fondo en
-- la cabecera de tyrecontrol_informe_ejecutivo.sql. Y tiene que ir aquí
-- dentro: un `alter function` suelto lo borra el siguiente create or replace.
set jit = off
as $$
with veh as (
  select v.id, v.matricula,
         coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) as intervalo_dias
  from tc_vehiculos v
  left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
  where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
),
-- La última revisión COMPLETADA de cada vehículo, sin mirar el periodo del
-- informe: para saber si va al día importa cuándo se hizo, no desde dónde
-- se esté mirando.
ultima_rev as (
  select r.vehiculo_id, max(r.fecha_revision)::date as ultima
  from revisiones_vehiculo r
  where (p_empresa is null or r.empresa_id = p_empresa)
    and r.estado_revision = 'completada'
  group by r.vehiculo_id
),
periodicidad as (
  select
    v.id, v.matricula, v.intervalo_dias, u.ultima,
    case
      when v.intervalo_dias is null then 'sin_intervalo'
      when u.ultima is null         then 'sin_revision'
      when current_date > u.ultima + v.intervalo_dias then 'vencido'
      when (u.ultima + v.intervalo_dias) - current_date <= 15 then 'proximo'
      else 'al_dia'
    end as estado
  from veh v
  left join ultima_rev u on u.vehiculo_id = v.id
)
select public.tc_informe_ejecutivo_base(p_empresa, p_desde, p_hasta) || jsonb_build_object(
  'cobertura', jsonb_build_object(
    'total',         (select count(*) from periodicidad),
    'al_dia',        (select count(*) from periodicidad where estado = 'al_dia'),
    'proximos',      (select count(*) from periodicidad where estado = 'proximo'),
    'vencidos',      (select count(*) from periodicidad where estado = 'vencido'),
    'sin_revision',  (select count(*) from periodicidad where estado = 'sin_revision'),
    'sin_intervalo', (select count(*) from periodicidad where estado = 'sin_intervalo'),
    -- El intervalo que rige en la mayor parte de la flota, para poder
    -- escribir "al día (cada 60 días)" sin inventárselo.
    'intervalo_habitual', (
      select intervalo_dias from periodicidad
       where intervalo_dias is not null
       group by intervalo_dias order by count(*) desc, intervalo_dias limit 1),
    -- Por dónde empezar: los más pasados de fecha.
    'mas_vencidos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'matricula', matricula, 'ultima', ultima, 'dias_vencido', dias)
             order by dias desc), '[]'::jsonb)
      from (
        select matricula, ultima, current_date - (ultima + intervalo_dias) as dias
        from periodicidad where estado = 'vencido'
        order by dias desc limit 10) x)
  )
)
$$;

comment on function public.tc_informe_ejecutivo(uuid, date, date) is
  'Informe ejecutivo. La clave "cobertura" mide la flota contra SU '
  'periodicidad de revisión (intervalo del vehículo o, si no, del tipo), no '
  'contra el periodo del informe: con revisión bimestral, un informe mensual '
  'siempre daría un porcentaje malo.';

-- ── 3. Comprobación ─────────────────────────────────────────────────────────
do $$
declare j jsonb; c jsonb; n_sin int;
begin
  select public.tc_informe_ejecutivo(null, null, null) into j;
  c := j -> 'cobertura';
  if c is null then
    raise exception 'El informe no devuelve la cobertura';
  end if;
  -- Las cinco categorías son excluyentes y tienen que sumar la flota activa.
  if (c->>'al_dia')::int + (c->>'proximos')::int + (c->>'vencidos')::int
     + (c->>'sin_revision')::int + (c->>'sin_intervalo')::int <> (c->>'total')::int then
    raise exception 'Los estados de cobertura no suman el total de la flota';
  end if;
  -- Que el informe de siempre sigue entero.
  if j -> 'cabecera' is null then
    raise exception 'El envoltorio se ha comido el informe original';
  end if;

  n_sin := (c->>'sin_intervalo')::int;
  if n_sin > 0 then
    raise warning
      '% vehículos no tienen periodicidad de revisión: no cuentan ni como al día ni como vencidos. '
      'Se pone en Configuración (por tipo) o en la ficha del vehículo; para bimestral, 60 días.', n_sin;
  end if;

  raise notice 'OK: la cobertura se mide contra la periodicidad (al día %, próximos %, vencidos %, sin revisión %)',
    c->>'al_dia', c->>'proximos', c->>'vencidos', c->>'sin_revision';
end $$;
