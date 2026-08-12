-- ============================================================
-- Mobilink TyreControl — La revisión es bimestral: 60 días
--
-- Sin periodicidad, el informe no puede decir si un vehículo va al día: no
-- cuentan ni como al día ni como vencidos, y "flota al día" se queda sin
-- denominador.
--
-- DÓNDE SE PONE: en el TIPO de vehículo, no en cada vehículo.
--
-- El intervalo se lee del vehículo y, si está vacío, del tipo. Ponerlo en los
-- 719 vehículos uno a uno funcionaría hoy y sería un estorbo mañana: el día
-- que la periodicidad cambie habría que volver a tocarlos todos, y cualquier
-- vehículo nuevo nacería sin ella. En el tipo se pone una vez, lo heredan
-- todos y los que nazcan después, y sigue pudiéndose poner otra cosa a un
-- vehículo concreto desde su ficha.
--
-- Solo se rellena lo que está VACÍO. Si alguien le puso 90 días a un tipo o a
-- un vehículo, fue queriendo y no se le pisa: al final se avisa de cuáles
-- son para que se revisen a mano.
--
-- Idempotente.
-- ============================================================

-- ── 1. Los tipos ────────────────────────────────────────────────────────────
update tc_tipos_vehiculo
   set revision_intervalo_dias = 60
 where revision_intervalo_dias is null;

-- ── 2. Los vehículos sin tipo ───────────────────────────────────────────────
--
-- Un vehículo sin tipo no hereda nada, así que a ése sí hay que ponérselo
-- encima. Son los que se quedarían fuera de la cuenta sin darse cuenta.
update tc_vehiculos
   set revision_intervalo_dias = 60
 where revision_intervalo_dias is null
   and tipo_vehiculo_id is null;

-- ── 3. Comprobación ─────────────────────────────────────────────────────────
do $$
declare
  n_sin int; n_tipos int; r record; lista text := '';
begin
  -- Ningún vehículo activo puede quedarse sin saber cuándo le toca.
  select count(*) into n_sin
    from tc_vehiculos v
    left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
   where v.activo
     and coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) is null;
  if n_sin > 0 then
    raise exception '% vehículos activos siguen sin periodicidad', n_sin;
  end if;

  select count(*) into n_tipos from tc_tipos_vehiculo where revision_intervalo_dias = 60;

  -- Lo que NO se ha tocado porque ya tenía otra cosa puesta a mano.
  for r in
    select 'tipo ' || coalesce(descripcion, nombre) as que, revision_intervalo_dias as dias
      from tc_tipos_vehiculo where revision_intervalo_dias is not null and revision_intervalo_dias <> 60
    union all
    select 'vehículo ' || matricula, revision_intervalo_dias
      from tc_vehiculos where revision_intervalo_dias is not null and revision_intervalo_dias <> 60
    order by 1
  loop
    lista := lista || r.que || ': ' || r.dias || ' días  ';
  end loop;
  if lista <> '' then
    raise warning 'Esto ya tenía otra periodicidad puesta a mano y no se ha tocado: %', lista;
  end if;

  raise notice 'OK: revisión cada 60 días (% tipos). Ningún vehículo activo se queda sin periodicidad', n_tipos;
end $$;
