-- ============================================================
-- Mobilink TyreControl — Corregir una operación ya hecha
--
-- QUÉ SE PUEDE CORREGIR, Y QUÉ NO
--
-- «Editar una operación» son tres cosas distintas, y solo una es segura:
--
--   (a) Corregir un DATO que no movió nada: la razón de sustitución, las
--       observaciones, el número de serie o el DOT mal leídos.
--   (b) Deshacer un MOVIMIENTO: «esa no era la rueda», «fue en el eje 3».
--   (c) Añadir lo que faltó.
--
-- Esta función hace SOLO (a). Y no por prudencia de más: si la goma que se
-- desmontó el lunes se montó el martes en otro camión, corregir el lunes
-- tendría que deshacer el martes, y nadie va a mirar eso a mano. Por eso
-- tc_deshacer_ultima_operacion solo deshace LA ÚLTIMA: es la única de la que
-- se sabe que no tiene nada encima. (c) es un parte nuevo.
--
-- POR QUÉ EL DESTINO NO ESTÁ EN LA LISTA
--
-- El destino vive en la operación y el estado de la goma en su ficha, y los
-- pone la misma RPC a la vez. Cambiar solo el destino dejaría a los dos
-- contando cosas distintas: el papel diría «Carcasa a Continental» y la goma
-- estaría en el almacén. Cambiar los dos ya es mover la rueda, o sea (b).
--
-- QUIÉN PUEDE
--
-- El administrador de la empresa, el superadministrador, y EL TÉCNICO QUE LA
-- HIZO. Es lo que se pidió: el que se equivoca escribiendo es el que está
-- delante del camión, y obligarle a llamar a la oficina para arreglar un
-- número de serie es la forma de que no se arregle nunca.
--
-- No se amplía ninguna política de tabla para conseguirlo. Esta función es
-- security definer y solo deja tocar cuatro campos de UNA operación: el
-- técnico no gana permiso sobre operaciones_neumaticos ni sobre
-- tc_neumaticos, gana permiso para esta corrección.
--
-- TODO QUEDA ESCRITO
--
-- Cada corrección deja una fila en tc_operacion_auditoria con lo que había,
-- lo que se puso, quién y por qué. El motivo es obligatorio: una corrección
-- sin motivo es indistinguible de un error.
--
-- Idempotente.
-- ============================================================

create or replace function tc_corregir_operacion(
  p_operacion uuid,
  p_cambios   jsonb,
  p_motivo    text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o        record;
  n        record;
  v_antes  jsonb := '{}'::jsonb;
  v_nuevo  jsonb := '{}'::jsonb;
  v_motivo text;
  v_obs    text;
  v_serie  text;
  v_dot    text;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Hace falta decir por qué se corrige';
  end if;

  select * into o from operaciones_neumaticos where id = p_operacion;
  if not found then raise exception 'Operación no encontrada'; end if;

  -- Una operación anulada no se corrige: ya no cuenta para nada, y editarla
  -- daría a entender que vuelve a valer.
  if coalesce(o.is_anulada, false) then
    raise exception 'La operación está anulada: no se puede corregir';
  end if;

  -- Los coalesce NO son adorno: created_by y tecnico_id son nulables, y en SQL
  -- «null = algo» da NULL, no falso. Sin ellos, «false or false or NULL» vale
  -- NULL, el «if not (...)» no entra, y CUALQUIERA podía corregir una
  -- operación cuyo created_by estuviera vacío. Lo cazó el banco de pruebas.
  if not (tc_is_superadmin()
          or (tc_is_admin() and o.empresa_id = tc_auth_empresa_id())
          or coalesce(o.tecnico_id = auth.uid(), false)
          or coalesce(o.created_by = auth.uid(), false)) then
    raise exception 'Solo el técnico que la hizo o un administrador puede corregirla';
  end if;

  -- ── La razón ──
  -- Se comprueba contra el catálogo: aquí no se admite texto libre, que es
  -- justo lo que se quitó de la tablet hace nada.
  if p_cambios ? 'motivo' then
    v_motivo := nullif(btrim(p_cambios->>'motivo'), '');
    if v_motivo is not null
       and not exists (select 1 from tc_cat_motivos where codigo = v_motivo and activo) then
      raise exception 'La razón "%" no está en el catálogo', v_motivo;
    end if;
    if v_motivo is distinct from o.motivo then
      v_antes := v_antes || jsonb_build_object('motivo', o.motivo);
      v_nuevo := v_nuevo || jsonb_build_object('motivo', v_motivo);
      update operaciones_neumaticos set motivo = v_motivo, updated_at = now()
       where id = p_operacion;
    end if;
  end if;

  -- ── Las observaciones ──
  -- Los marcadores que otras piezas leen ([USADO], [DECLARADO]) NO se pueden
  -- borrar por aquí: el parte decide con ellos si una goma es nueva o si es
  -- lo que el camión ya llevaba, y perderlos cambiaría el papel sin que nadie
  -- lo pidiera. Se conservan los que hubiera.
  if p_cambios ? 'observaciones' then
    v_obs := nullif(btrim(p_cambios->>'observaciones'), '');
    foreach v_serie in array array['[USADO]', '[DECLARADO]'] loop
      if position(v_serie in coalesce(o.observaciones, '')) > 0
         and position(v_serie in coalesce(v_obs, '')) = 0 then
        v_obs := btrim(coalesce(v_obs, '') || ' ' || v_serie);
      end if;
    end loop;
    v_serie := null;
    if v_obs is distinct from o.observaciones then
      v_antes := v_antes || jsonb_build_object('observaciones', o.observaciones);
      v_nuevo := v_nuevo || jsonb_build_object('observaciones', v_obs);
      update operaciones_neumaticos set observaciones = v_obs, updated_at = now()
       where id = p_operacion;
    end if;
  end if;

  -- ── El número de serie y el DOT, en la ficha de la goma ──
  -- Están en tc_neumaticos, no en la operación: son de la rueda, no de lo que
  -- se le hizo. Por eso se corrigen desde aquí y no con un update a la tabla,
  -- que el técnico no puede hacer.
  if (p_cambios ? 'numero_serie' or p_cambios ? 'dot') and o.neumatico_id is not null then
    select * into n from tc_neumaticos where id = o.neumatico_id;
    if found then
      if p_cambios ? 'numero_serie' then
        v_serie := nullif(btrim(p_cambios->>'numero_serie'), '');
        if v_serie is distinct from n.numero_serie then
          -- El unique es (empresa_id, numero_serie): si ya lo lleva otra goma,
          -- se dice cuál en vez de soltar el error del índice.
          if v_serie is not null and exists (
            select 1 from tc_neumaticos
             where empresa_id = n.empresa_id and numero_serie = v_serie and id <> n.id) then
            raise exception 'El número de serie "%" ya está en otro neumático', v_serie;
          end if;
          v_antes := v_antes || jsonb_build_object('numero_serie', n.numero_serie);
          v_nuevo := v_nuevo || jsonb_build_object('numero_serie', v_serie);
          update tc_neumaticos set numero_serie = v_serie, updated_at = now() where id = n.id;
        end if;
      end if;
      if p_cambios ? 'dot' then
        v_dot := nullif(btrim(p_cambios->>'dot'), '');
        if v_dot is distinct from n.dot then
          v_antes := v_antes || jsonb_build_object('dot', n.dot);
          v_nuevo := v_nuevo || jsonb_build_object('dot', v_dot);
          update tc_neumaticos set dot = v_dot, updated_at = now() where id = n.id;
        end if;
      end if;
    end if;
  end if;

  -- Nada que cambiar no es un error, pero tampoco se apunta una corrección
  -- que no corrigió nada: el histórico se llenaría de ruido.
  if v_nuevo = '{}'::jsonb then
    return jsonb_build_object('cambiado', false);
  end if;

  insert into tc_operacion_auditoria (operacion_id, accion, datos_anteriores, datos_nuevos, motivo)
  values (p_operacion, 'corregir', v_antes, v_nuevo, btrim(p_motivo));

  return jsonb_build_object('cambiado', true, 'antes', v_antes, 'ahora', v_nuevo);
end $$;

comment on function tc_corregir_operacion(uuid, jsonb, text) is
  'Corrige DATOS de una operación ya hecha: razón, observaciones, número de '
  'serie y DOT. NO mueve neumáticos ni toca el stock, y no deja cambiar el '
  'destino (iría contra el estado de la goma). Puede el técnico que la hizo o '
  'un administrador. Deja rastro en tc_operacion_auditoria con motivo '
  'obligatorio.';

grant execute on function tc_corregir_operacion(uuid, jsonb, text) to authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare v_pol text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'tc_corregir_operacion') then
    raise exception 'No se ha creado tc_corregir_operacion';
  end if;

  -- DURO, Y ES EL IMPORTANTE: la escritura de tc_neumaticos NO se ha abierto.
  -- Toda la propuesta se sostiene en que el técnico corrige POR ESTA PUERTA y
  -- no gana la tabla entera. Si alguien amplía la política, esto se cae.
  select pg_get_expr(polwithcheck, polrelid) into v_pol
    from pg_policy where polname = 'tc_neu_write' and polrelid = 'tc_neumaticos'::regclass;
  if v_pol is null then
    raise exception 'Ha desaparecido la política tc_neu_write de tc_neumaticos';
  end if;
  if v_pol like '%operador%' then
    raise exception 'tc_neu_write se ha ampliado a operadores: la función acotada '
      'existe justamente para no tener que hacer eso';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_name = 'operaciones_neumaticos' and column_name = 'created_by') then
    raise exception 'Falta operaciones_neumaticos.created_by: es una de las dos formas '
      'de saber quién hizo la operación';
  end if;

  raise notice 'OK: el técnico puede corregir los datos de su operación sin que se '
    'abra la escritura de tc_neumaticos.';
end $$;
