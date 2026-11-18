-- ============================================================
-- Mobilink TyreControl — «No coincide» con goma nueva del catálogo
--
-- Fallo: al corregir el neumático registrado eligiendo una goma del catálogo,
-- la llamada moría con
--
--   null value in column "numero_interno" of relation "tc_neumaticos"
--   violates not-null constraint
--
-- Causa: `tc_corregir_montado_nueva_ficha` inserta la ficha sin
-- `numero_interno`, y esa columna es NOT NULL desde la Fase 8
-- (tyrecontrol_fase8_operaciones.sql). No hay ni default ni disparador que lo
-- rellene: TODAS las demás altas de ficha llaman a `tc_generar_numero_interno()`
-- a mano (montar desde almacén, desde catálogo, stock manual, usados,
-- importación…). Ésta se quedó sin hacerlo.
--
-- Afecta igual al panel y a la APK: las dos llaman a esta misma función, así
-- que el flujo del técnico —«esta rueda no es la fichada, es esta otra del
-- catálogo»— no podía guardar nada.
--
-- Qué cambia: se genera el número con la función de la casa y se usa también
-- como `codigo_interno`, que es lo que hacen el resto de altas. Nada más: ni
-- `origen` ni `control_individual` se tocan, para no cambiar de paso el
-- significado de una ficha mientras se arregla un fallo.
--
-- Idempotente.
-- ============================================================

create or replace function tc_corregir_montado_nueva_ficha(
  p_montaje uuid,
  p_marca text,
  p_modelo text,
  p_medida text,
  p_dot text default null,
  p_numero_serie text default null,
  p_obs text default null,
  p_revision uuid default null,
  p_metodo text default null,
  p_foto_url text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; v_neu uuid; v_op uuid; v_numero text;
begin
  select * into m from tc_montajes_actuales where id = p_montaje;
  if not found then raise exception 'Montaje no encontrado'; end if;
  if not (tc_is_superadmin()
          or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(m.empresa_id)) then
    raise exception 'Sin permiso para corregir el neumático de esta empresa';
  end if;
  if nullif(trim(coalesce(p_marca, '')), '') is null
     or nullif(trim(coalesce(p_medida, '')), '') is null then
    raise exception 'Hacen falta al menos marca y medida para dar de alta la goma encontrada';
  end if;

  -- El número interno es obligatorio y no se rellena solo. Mismo generador que
  -- el resto de altas, para que estas fichas lleven el NT-<año>-<secuencial>
  -- de siempre y no una numeración aparte.
  v_numero := tc_generar_numero_interno();

  -- Nace ya montada: es donde está. Se crea en 'almacen' y la corrección la
  -- pasa a 'montado' en la misma transacción, así que nunca queda suelta.
  insert into tc_neumaticos (empresa_id, numero_interno, codigo_interno,
                             marca, modelo, medida, dot, numero_serie, estado, activo)
  values (m.empresa_id, v_numero, v_numero,
          trim(p_marca), nullif(trim(coalesce(p_modelo, '')), ''),
          trim(p_medida), nullif(trim(coalesce(p_dot, '')), ''),
          nullif(trim(coalesce(p_numero_serie, '')), ''), 'almacen', true)
  returning id into v_neu;

  v_op := tc_corregir_montado(p_montaje, v_neu, p_obs, p_revision, p_metodo, p_foto_url);

  return jsonb_build_object('neumatico_id', v_neu, 'operacion_id', v_op);
end $$;

comment on function tc_corregir_montado_nueva_ficha(uuid, text, text, text, text, text, text, uuid, text, text) is
  'Da de alta la ficha de la goma encontrada Y corrige el montaje en la misma '
  'llamada. Juntas a propósito: una ficha que no llegue a montarse por un '
  'fallo de red quedaría contando como stock que no existe. El numero_interno '
  'se genera aquí: la columna es NOT NULL y no tiene default ni disparador.';

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare n int; def text;
begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'tc_corregir_montado_nueva_ficha';

  if n = 0 then
    raise exception 'No existe tc_corregir_montado_nueva_ficha';
  end if;

  -- Más de una = la que había desplegada tenía otra firma y acabamos de crear
  -- una sobrecarga en vez de reemplazarla. PostgREST no sabría cuál llamar y
  -- el fallo seguiría, así que esto NO se deja pasar en silencio.
  if n > 1 then
    raise exception 'Hay % versiones de tc_corregir_montado_nueva_ficha: la anterior tenía otra firma y esto ha creado una sobrecarga. Hay que borrar la vieja a mano.', n;
  end if;

  select pg_get_functiondef(p.oid) into def from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'tc_corregir_montado_nueva_ficha';

  if def not like '%numero_interno%' then
    raise exception 'tc_corregir_montado_nueva_ficha sigue sin rellenar numero_interno';
  end if;

  raise notice 'OK: la corrección con ficha nueva ya genera el número interno';
end $$;
