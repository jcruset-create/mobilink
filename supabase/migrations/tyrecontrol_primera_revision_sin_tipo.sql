-- ============================================================
-- Mobilink TyreControl — Primera revisión en la tablet de un vehículo sin tipo
--
-- Los 64 vehículos de Plana sin tipo se completan en la tablet, en su primera
-- revisión: tipo, uso, ejes y las ruedas que llevan. Poner el tipo
-- (tc_alta_operativa_tipo) y apuntar las ruedas (inventario inicial) ya se
-- podía. Lo que no: configurar los ejes, porque tc_alta_configurar_vehiculo
-- solo admitía vehículos creados en la propia tablet y pendientes de validar.
--
-- QUÉ CAMBIA
--
-- La puerta de tc_alta_configurar_vehiculo pasa a ser «vehículo activo, sin
-- ninguna rueda montada y sin ninguna revisión completada», venga de donde
-- venga. Entran los dados de alta por foto y los que no tenían tipo. Un
-- vehículo en servicio (con ruedas o con revisiones) sigue rechazado.
--
-- El resto de la función es idéntico. No cambia la estructura de ninguna
-- tabla, ni toca tc_montajes_actuales, tc_neumaticos, km_actual ni
-- config_ejes_id. La política tc_vehiculos_write se comprueba al final.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
-- Repetida, no hace nada. Si algo no cuadra, se deshace entera.
-- ============================================================

do $migracion$
declare
  v_pol_antes text;
  v_pol_despues text;
begin
  if to_regprocedure('public.tc_alta_configurar_vehiculo(uuid, text, jsonb)') is null then
    raise exception 'Falta tc_alta_configurar_vehiculo: pega antes tyrecontrol_alta_ejes_ruedas.sql.';
  end if;

  select pg_get_expr(polqual, polrelid) || ' | ' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
    into v_pol_antes from pg_policy where polname = 'tc_vehiculos_write';

  create or replace function tc_alta_configurar_vehiculo(
    p_vehiculo uuid,
    p_uso      text  default null,
    p_ejes     jsonb default '[]'::jsonb
  ) returns jsonb
  language plpgsql security definer set search_path = public as $f$
  declare
    v_veh record; v_e jsonb; v_eje int; v_ruedas int; v_medida uuid; v_llanta uuid;
    v_presion numeric; v_n int := 0; v_primero record;
  begin
    select * into v_veh from tc_vehiculos where id = p_vehiculo;
    if not found then raise exception 'Vehículo no encontrado'; end if;

    if not (tc_is_superadmin()
            or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id())
            or tc_operador_ve_empresa(v_veh.empresa_id)) then
      raise exception 'Sin permiso sobre este vehículo';
    end if;

    -- Una puerta estrecha: solo un vehículo que todavía no ha entrado en
    -- servicio en TyreControl, es decir, sin ninguna rueda montada y sin
    -- ninguna revisión completada. Es el caso del alta desde la foto y el de
    -- los vehículos sin tipo que se completan en su primera revisión. Los
    -- ejes de un vehículo en servicio se cambian en el panel, no desde el patio.
    if not v_veh.activo then
      raise exception 'El vehículo está dado de baja.';
    end if;
    if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo) then
      raise exception 'Este vehículo ya tiene ruedas apuntadas: los ejes ya no se cambian desde la '
        'tablet. Pídelo a oficina.';
    end if;
    if exists (select 1 from revisiones_vehiculo
                where vehiculo_id = p_vehiculo and estado_revision = 'completada') then
      raise exception 'Este vehículo ya tiene revisiones: los ejes ya no se cambian desde la '
        'tablet. Pídelo a oficina.';
    end if;
    if v_veh.tipo_vehiculo_id is null then
      raise exception 'El vehículo no tiene tipo: elige primero qué vehículo es.';
    end if;

    if p_uso is not null
       and p_uso not in ('larga_distancia', 'regional', 'urbano', 'distribucion', 'obra') then
      raise exception 'Uso no válido: %', p_uso;
    end if;

    if p_ejes is null or jsonb_typeof(p_ejes) <> 'array' then
      raise exception 'p_ejes tiene que ser una lista de ejes';
    end if;

    for v_e in select * from jsonb_array_elements(p_ejes) loop
      v_eje := nullif(v_e->>'eje', '')::int;
      -- El eje tiene que existir en el plano del tipo: las ruedas cuelgan de él.
      select count(*) into v_ruedas from tc_posiciones_vehiculo
       where tipo_vehiculo_id = v_veh.tipo_vehiculo_id and activo and eje = v_eje;
      if v_eje is null or v_ruedas = 0 then
        raise exception 'El eje % no existe en el plano de este vehículo.', v_e->>'eje';
      end if;

      v_medida := nullif(v_e->>'medida_id', '')::uuid;
      if v_medida is not null
         and not exists (select 1 from tc_cat_medidas_neumatico where id = v_medida and activo) then
        raise exception 'La medida del eje % no está en el catálogo o está dada de baja.', v_eje;
      end if;
      v_llanta := nullif(v_e->>'tipo_llanta_id', '')::uuid;
      if v_llanta is not null
         and not exists (select 1 from tc_tipos_llanta where id = v_llanta and activo) then
        raise exception 'La llanta del eje % no está en el catálogo o está dada de baja.', v_eje;
      end if;
      v_presion := nullif(v_e->>'presion_bar', '')::numeric;
      if v_presion is not null and (v_presion < 1 or v_presion > 15) then
        raise exception 'Presión objetivo imposible en el eje %: % bar.', v_eje, v_presion;
      end if;

      insert into tc_vehiculo_ejes (vehiculo_id, eje, ruedas, medida_id, tipo_llanta_id,
                                    directriz, motriz, elevable)
      values (p_vehiculo, v_eje, v_ruedas, v_medida, v_llanta,
              coalesce((v_e->>'directriz')::boolean, false),
              coalesce((v_e->>'motriz')::boolean, false),
              coalesce((v_e->>'elevable')::boolean, false))
      on conflict (vehiculo_id, eje) do update set
        ruedas = excluded.ruedas, medida_id = excluded.medida_id,
        tipo_llanta_id = excluded.tipo_llanta_id, directriz = excluded.directriz,
        motriz = excluded.motriz, elevable = excluded.elevable;

      -- La presión objetivo de ESTE vehículo en ese eje. Sin presión, se quita
      -- la suya y manda la del tipo, si la hay.
      delete from tc_presiones_objetivo where vehiculo_id = p_vehiculo and eje = v_eje;
      if v_presion is not null then
        insert into tc_presiones_objetivo (empresa_id, vehiculo_id, eje, presion_objetivo_bar)
        values (v_veh.empresa_id, p_vehiculo, v_eje, v_presion);
      end if;
      v_n := v_n + 1;
    end loop;

    -- La medida y la llanta del vehículo son las del primer eje: son las que
    -- salen en los listados. Si los ejes no llevan todos la misma, se marca.
    select medida_id, tipo_llanta_id into v_primero
      from tc_vehiculo_ejes where vehiculo_id = p_vehiculo order by eje limit 1;
    update tc_vehiculos set
      uso = p_uso,
      medida_id = coalesce(v_primero.medida_id, medida_id),
      tipo_llanta_id = coalesce(v_primero.tipo_llanta_id, tipo_llanta_id),
      medidas_por_eje = (select count(distinct medida_id) > 1 from tc_vehiculo_ejes
                          where vehiculo_id = p_vehiculo and medida_id is not null),
      updated_at = now()
     where id = p_vehiculo;

    return jsonb_build_object('vehiculo_id', p_vehiculo, 'uso', p_uso, 'ejes', v_n);
  end $f$;

  comment on function tc_alta_configurar_vehiculo(uuid, text, jsonb) is
    'Alta o primera revisión en la tablet: guarda el uso, los ejes (medida, llanta, '
    'direccional, motriz, elevable) y la presión objetivo por eje. Solo para un '
    'vehículo activo sin ruedas montadas y sin revisiones completadas.';

  revoke all on function tc_alta_configurar_vehiculo(uuid, text, jsonb) from public;
  grant execute on function tc_alta_configurar_vehiculo(uuid, text, jsonb) to authenticated;

  -- ── Comprobaciones ───────────────────────────────────────────────────────
  if (select count(*) from pg_proc where proname = 'tc_alta_configurar_vehiculo') <> 1 then
    raise exception 'Tiene que quedar UNA sola tc_alta_configurar_vehiculo.';
  end if;
  if position('creado_desde' in pg_get_functiondef('tc_alta_configurar_vehiculo(uuid, text, jsonb)'::regprocedure)) > 0 then
    raise exception 'La función sigue exigiendo que el vehículo venga de la tablet.';
  end if;
  select pg_get_expr(polqual, polrelid) || ' | ' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
    into v_pol_despues from pg_policy where polname = 'tc_vehiculos_write';
  if v_pol_despues is distinct from v_pol_antes then
    raise exception 'La política tc_vehiculos_write ha cambiado y no debía.';
  end if;

  perform set_config('mobilink.resultado',
    'Primera revisión sin tipo lista: los ejes se configuran en vehículos sin ruedas ni revisiones.', false);
end $migracion$;

select current_setting('mobilink.resultado', true) as resultado;
