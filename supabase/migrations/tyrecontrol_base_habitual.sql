-- ============================================================================
-- Base habitual de cada vehículo, calculada del histórico de estancias
--
-- ── Para qué ────────────────────────────────────────────────────────────────
--
-- En la ficha del vehículo hay una DELEGACIÓN (`tc_vehiculos.delegacion_id`),
-- que es su base: donde se le va a buscar para revisarlo. En Autocares Plana
-- está vacía en toda la flota, y rellenarla a mano para 700 autobuses no lo
-- va a hacer nadie.
--
-- Pero el dato ya existe. El barrido de presencia lleva meses anotando en
-- `tc_vehiculo_presencia_historico` cada estancia de cada vehículo en cada
-- base. Sumar las horas que ha pasado en cada una y quedarse con la que gana
-- es, literalmente, «dónde duerme este autobús».
--
-- ── Cómo se decide ──────────────────────────────────────────────────────────
--
-- Por HORAS en base dentro de una ventana (30 días por defecto), no por
-- número de estancias: una parada de diez minutos en otra base para dejar
-- pasaje no puede pesar lo mismo que una noche entera. Y solo el tiempo
-- OBSERVADO: `desde`..`hasta` ya vienen recortados a lo que el barrido vio,
-- y aquí se recortan además a la ventana.
--
-- La decisión es «clara» solo cuando la base que gana se lleva al menos el
-- 60 % de las horas en base Y suma al menos 24 h en la ventana. Si no, es
-- «dudosa» y NO se asigna: se enseña con la segunda opción al lado para que
-- lo decida una persona. Un autobús que reparte las noches entre dos bases
-- no tiene base habitual, y adivinarla sería peor que dejarla vacía.
--
-- Solo cuentan las bases activas: una delegación dada de baja no puede
-- volver a la ficha por la puerta de atrás.
--
-- ── Qué se escribe ──────────────────────────────────────────────────────────
--
-- `tc_asignar_base_habitual` SIMULA por defecto: devuelve lo que haría sin
-- tocar nada. Y por defecto solo rellena las fichas que tienen la base VACÍA:
-- lo que alguien puso a mano manda sobre lo que calcule esto. Con
-- `p_sobrescribir` se pisa también lo que había, y queda dicho en el
-- resultado qué se cambió y de qué a qué.
--
-- Idempotente: pasarlo dos veces seguidas no cambia nada la segunda.
-- ============================================================================

-- ── 1. El cálculo, sin escribir nada ────────────────────────────────────────
create or replace function tc_base_habitual(p_empresa uuid, p_dias integer default 30)
returns table (
  vehiculo_id          uuid,
  matricula            text,
  base_actual_id       uuid,
  base_actual          text,
  base_propuesta_id    uuid,
  base_propuesta       text,
  horas                numeric,   -- en la base propuesta
  horas_en_bases       numeric,   -- en cualquier base, dentro de la ventana
  cuota                numeric,   -- horas / horas_en_bases, 0..1
  estancias            integer,   -- en la base propuesta
  segunda_id           uuid,
  segunda              text,
  horas_segunda        numeric,
  decision             text       -- 'clara' | 'dudosa' | 'sin_datos'
)
language sql
stable
security definer
set search_path = public
set jit = off
as $$
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
       and h.estado = 'IN_BASE'
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
  segunda as (select * from ordenadas where puesto = 2)
  select ve.id,
         ve.matricula,
         ve.delegacion_id,
         da.nombre,
         p.delegacion_id,
         dp.nombre,
         round(p.horas, 1),
         round(p.horas_en_bases, 1),
         case when p.horas_en_bases > 0 then round(p.horas / p.horas_en_bases, 3) end,
         p.estancias,
         s.delegacion_id,
         ds.nombre,
         round(s.horas, 1),
         case
           when p.vehiculo_id is null then 'sin_datos'
           when p.horas >= 24 and p.horas / p.horas_en_bases >= 0.6 then 'clara'
           else 'dudosa'
         end
    from tc_vehiculos ve
    left join primera p  on p.vehiculo_id = ve.id
    left join segunda s  on s.vehiculo_id = ve.id
    left join tc_delegaciones da on da.id = ve.delegacion_id
    left join tc_delegaciones dp on dp.id = p.delegacion_id
    left join tc_delegaciones ds on ds.id = s.delegacion_id
   where ve.empresa_id = p_empresa
     and ve.activo
     and tc_puede_ver_empresa(p_empresa)
   order by
     case when p.vehiculo_id is null then 2
          when p.horas >= 24 and p.horas / p.horas_en_bases >= 0.6 then 0
          else 1 end,
     ve.matricula;
$$;

comment on function tc_base_habitual(uuid, integer) is
  'Base en la que cada vehículo activo ha pasado más horas en los últimos p_dias, '
  'según el histórico de presencia. «clara» = ≥60 % de las horas en base y ≥24 h; '
  'si no, «dudosa» (no se asigna sola). No escribe nada.';

-- ── 2. Ponerla en la ficha ──────────────────────────────────────────────────
create or replace function tc_asignar_base_habitual(
  p_empresa      uuid,
  p_dias         integer default 30,
  p_sobrescribir boolean default false,
  p_simular      boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cambios  jsonb;
  v_n        integer;
  v_dudosas  integer;
  v_sin      integer;
  v_ya       integer;
begin
  -- Escribe en las fichas: solo administradores de la empresa o superadmin.
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede asignar bases' using errcode = '42501';
  end if;

  -- Se consulta tc_base_habitual dos veces (recuento y escritura). Es STABLE
  -- y now() no cambia dentro de la transacción, así que las dos ven lo mismo.
  select count(*) filter (where decision = 'dudosa'),
         count(*) filter (where decision = 'sin_datos'),
         count(*) filter (where decision = 'clara' and base_actual_id is not null
                            and base_actual_id is distinct from base_propuesta_id
                            and not p_sobrescribir),
         -- Lo que cambiaría de verdad: decisión clara, y la ficha vacía (o se
         -- ha pedido pisar) y distinta de lo propuesto.
         count(*) filter (where decision = 'clara'
                            and base_propuesta_id is distinct from base_actual_id
                            and (base_actual_id is null or p_sobrescribir)),
         coalesce(jsonb_agg(jsonb_build_object(
             'vehiculo_id', vehiculo_id, 'matricula', matricula,
             'de', base_actual, 'a', base_propuesta,
             'horas', horas, 'cuota', cuota) order by matricula)
           filter (where decision = 'clara'
                     and base_propuesta_id is distinct from base_actual_id
                     and (base_actual_id is null or p_sobrescribir)), '[]'::jsonb)
    into v_dudosas, v_sin, v_ya, v_n, v_cambios
    from tc_base_habitual(p_empresa, p_dias);

  if not p_simular and v_n > 0 then
    update tc_vehiculos v
       set delegacion_id = t.base_propuesta_id
      from tc_base_habitual(p_empresa, p_dias) t
     where t.vehiculo_id = v.id
       and v.empresa_id = p_empresa
       and t.decision = 'clara'
       and t.base_propuesta_id is distinct from v.delegacion_id
       and (v.delegacion_id is null or p_sobrescribir);
    get diagnostics v_n = row_count;
  end if;

  return jsonb_build_object(
    'simulacion',   p_simular,
    'dias',         greatest(coalesce(p_dias, 30), 1),
    'asignadas',    v_n,
    'dudosas',      v_dudosas,
    'sin_datos',    v_sin,
    'respetadas',   v_ya,   -- tenían otra base a mano y no se ha pedido pisarla
    'cambios',      v_cambios
  );
end;
$$;

comment on function tc_asignar_base_habitual(uuid, integer, boolean, boolean) is
  'Pone en tc_vehiculos.delegacion_id la base habitual de tc_base_habitual, '
  'solo en las decisiones claras. Por defecto SIMULA (p_simular=true) y solo '
  'rellena fichas sin base (p_sobrescribir=false). Solo administradores.';

revoke all on function tc_base_habitual(uuid, integer) from public, anon;
revoke all on function tc_asignar_base_habitual(uuid, integer, boolean, boolean) from public, anon;
grant execute on function tc_base_habitual(uuid, integer) to authenticated, service_role;
grant execute on function tc_asignar_base_habitual(uuid, integer, boolean, boolean) to authenticated, service_role;
