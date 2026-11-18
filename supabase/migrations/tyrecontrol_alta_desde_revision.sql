-- ============================================================
-- Mobilink TyreControl — Alta de vehículo desde «Nueva revisión»
--
-- QUÉ RESUELVE
--
-- Cuando el técnico empieza una revisión y la matrícula no está, la tablet
-- ofrece darlo de alta. Antes se comprueba con la FOTO de la matrícula, para
-- que un error de tecleo no acabe en un camión duplicado.
--
-- Hoy había dos huecos por donde se colaba el duplicado:
--
--   1. tc_alta_vehiculo_desde_parte comparaba con upper(trim(...)): «4721 LMN»
--      y «4721LMN» eran dos matrículas distintas y entraban dos vehículos.
--   2. Solo miraba la empresa del alta. Un camión dado de baja, o ya dado de
--      alta en otra flota, se volvía a crear sin decir nada.
--
-- QUÉ HACE
--
--   · tc_matricula_normalizada(text): mayúsculas y solo letras y números. La
--     misma regla que server/tyrecontrol/matricula.ts (normalizarMatricula).
--   · tc_matriculas_a_un_caracter(a, b): ¿se diferencian en un solo carácter?
--     (uno cambiado, uno de más o uno de menos). Para avisar de las parecidas.
--   · tc_comprobar_matricula(p_matricula): busca la matrícula, normalizada, en
--     las flotas que ve quien llama, incluidas las de baja, y las parecidas.
--     De las flotas que NO ve solo dice que existe, sin enseñar nada más.
--   · tc_alta_vehiculo_desde_parte: compara normalizado, guarda la matrícula
--     normalizada, se niega si está de baja o en otra flota, y guarda la foto
--     de la matrícula y si se tecleó a mano.
--   · tc_vehiculos: dos columnas nuevas, foto_matricula_path y
--     matricula_tecleada, para que oficina vea la prueba al validar.
--
-- LO QUE NO TOCA
--
-- Ni tc_montajes_actuales, ni tc_neumaticos, ni tc_vehiculo_ejes (salvo los
-- ejes del vehículo que se acaba de crear, como ya hacía la función), ni
-- config_ejes_id ni km_actual de ningún vehículo existente. Tampoco la política
-- tc_vehiculos_write: al final se comprueba que sigue exactamente igual.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
-- Repetida, no hace nada. Si algo no cuadra, se deshace entera.
-- ============================================================

do $migracion$
declare
  v_pol_antes text;
  v_pol_despues text;
  v_n int;
begin
  if to_regclass('public.tc_vehiculos') is null
     or to_regprocedure('public.tc_is_superadmin()') is null
     or to_regprocedure('public.tc_operador_ve_empresa(uuid)') is null
     or to_regprocedure('public.tc_auth_empresa_id()') is null then
    raise exception 'No se toca nada: faltan tc_vehiculos o las funciones de permisos.';
  end if;

  select pg_get_expr(polqual, polrelid) || ' | ' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
    into v_pol_antes
    from pg_policy where polname = 'tc_vehiculos_write';

  -- ── 1. Columnas nuevas ───────────────────────────────────────────────────
  alter table tc_vehiculos add column if not exists foto_matricula_path text;
  alter table tc_vehiculos add column if not exists matricula_tecleada boolean not null default false;
  comment on column tc_vehiculos.foto_matricula_path is
    'Foto de la matrícula hecha en la tablet al darlo de alta (bucket tc-revisiones-fotos).';
  comment on column tc_vehiculos.matricula_tecleada is
    'La matrícula se escribió a mano porque la foto no se pudo leer: oficina la revisa al validar.';

  -- ── 2. Normalizar ────────────────────────────────────────────────────────
  create or replace function tc_matricula_normalizada(p text)
  returns text language sql immutable as $f$
    select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g')
  $f$;

  -- ── 3. ¿A un carácter? ───────────────────────────────────────────────────
  -- Distancia de edición 1, escrita a mano: fuzzystrmatch no está instalado y
  -- para matrículas de 7 u 8 caracteres no hace falta.
  create or replace function tc_matriculas_a_un_caracter(a text, b text)
  returns boolean language plpgsql immutable as $f$
  declare
    la int := length(a); lb int := length(b); i int := 1;
    corto text; largo text;
  begin
    if a is null or b is null or a = b then return false; end if;
    if abs(la - lb) > 1 then return false; end if;
    if la = lb then
      -- Un solo carácter cambiado.
      while i <= la and substr(a, i, 1) = substr(b, i, 1) loop i := i + 1; end loop;
      return substr(a, i + 1) = substr(b, i + 1);
    end if;
    -- Uno de más o de menos: quitando ese carácter del largo queda el corto.
    if la < lb then corto := a; largo := b; else corto := b; largo := a; end if;
    while i <= length(corto) and substr(corto, i, 1) = substr(largo, i, 1) loop i := i + 1; end loop;
    return substr(corto, i) = substr(largo, i + 1);
  end $f$;

  -- ── 4. Comprobar antes del alta ──────────────────────────────────────────
  create or replace function tc_comprobar_matricula(p_matricula text)
  returns jsonb
  language plpgsql stable security definer set search_path = public as $f$
  declare
    v_norm text := tc_matricula_normalizada(p_matricula);
    v_exactas jsonb; v_parecidas jsonb; v_oculta boolean;
  begin
    if auth.uid() is null then raise exception 'No autenticado'; end if;
    if length(v_norm) < 4 then
      raise exception 'La matrícula «%» es demasiado corta para buscarla', p_matricula;
    end if;

    with vistos as (
      select v.id, v.matricula, v.empresa_id, e.nombre as empresa, v.activo,
             v.numero_unidad, v.pendiente_validar,
             coalesce(t.descripcion, t.nombre) as tipo, t.configuracion_ejes,
             tc_matricula_normalizada(v.matricula) as norm
        from tc_vehiculos v
        left join tc_empresas e on e.id = v.empresa_id
        left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
       where tc_is_superadmin()
          or v.empresa_id = tc_auth_empresa_id()
          or tc_operador_ve_empresa(v.empresa_id)
    )
    select
      coalesce(jsonb_agg(to_jsonb(x) - 'norm') filter (where x.norm = v_norm), '[]'::jsonb),
      coalesce(jsonb_agg(to_jsonb(x) - 'norm') filter (where tc_matriculas_a_un_caracter(x.norm, v_norm)), '[]'::jsonb)
      into v_exactas, v_parecidas
      from (select id as vehiculo_id, matricula, empresa_id, empresa, activo, numero_unidad,
                   pendiente_validar, tipo, configuracion_ejes, norm
              from vistos order by activo desc, matricula) x;

    -- De las flotas que no ve, solo si existe. Ni cuál ni qué vehículo es.
    select exists (select 1 from tc_vehiculos v
                    where tc_matricula_normalizada(v.matricula) = v_norm
                      and not (tc_is_superadmin()
                               or v.empresa_id = tc_auth_empresa_id()
                               or tc_operador_ve_empresa(v.empresa_id)))
      into v_oculta;

    return jsonb_build_object(
      'normalizada', v_norm,
      'exactas', v_exactas,
      'parecidas', (select coalesce(jsonb_agg(p), '[]'::jsonb)
                      from (select p from jsonb_array_elements(v_parecidas) p limit 5) s),
      'en_flota_no_visible', v_oculta);
  end $f$;

  comment on function tc_comprobar_matricula(text) is
    'Antes de dar de alta desde la tablet: busca la matrícula normalizada en las '
    'flotas de quien llama (también las de baja) y las que se diferencian en un '
    'carácter. De otras flotas solo dice si existe.';

  -- ── 5. El alta, con la matrícula normalizada y la foto ───────────────────
  -- Se quita la versión de 8 argumentos: dos versiones conviviendo harían que
  -- una llamada por nombre fuese ambigua o fuera a parar a la vieja.
  drop function if exists tc_alta_vehiculo_desde_parte(uuid, text, uuid, uuid, uuid, text, numeric, jsonb);

  create or replace function tc_alta_vehiculo_desde_parte(
    p_empresa            uuid,
    p_matricula          text,
    p_tipo               uuid,
    p_config_ejes        uuid    default null,
    p_medida             uuid    default null,
    p_numero_unidad      text    default null,
    p_km                 numeric default null,
    p_ejes               jsonb   default null,
    p_foto_matricula     text    default null,
    p_matricula_tecleada boolean default false
  ) returns jsonb
  language plpgsql security definer set search_path = public as $f$
  declare
    v_mat text; v_id uuid; v_pos int; v_tipo record; v_existente record;
    v_e jsonb; v_n_ejes int := 0;
  begin
    if not (tc_is_superadmin()
            or (tc_is_admin() and p_empresa = tc_auth_empresa_id())
            or tc_operador_ve_empresa(p_empresa)) then
      raise exception 'Sin permiso para dar de alta vehículos en esta empresa';
    end if;

    -- La misma regla que el servidor: «4721-lmn» y «4721 LMN» son 4721LMN.
    v_mat := tc_matricula_normalizada(p_matricula);
    if v_mat = '' then raise exception 'Hace falta la matrícula'; end if;

    -- YA EXISTE en esta flota: si está activo se devuelve para seguir con él
    -- (dos técnicos a la vez, o una matrícula escrita con espacio). Si está de
    -- baja no se crea otro: reactivarlo es cosa de oficina.
    select id, activo, pendiente_validar into v_existente
      from tc_vehiculos
     where empresa_id = p_empresa and tc_matricula_normalizada(matricula) = v_mat
     order by activo desc
     limit 1;
    if found then
      if not v_existente.activo then
        raise exception 'La matrícula % está dada de baja en esta flota. Avisa a oficina para reactivarla.', v_mat;
      end if;
      return jsonb_build_object(
        'vehiculo_id', v_existente.id, 'matricula', v_mat, 'ya_existia', true,
        'pendiente_validar', v_existente.pendiente_validar);
    end if;

    -- EN OTRA FLOTA: una matrícula es un solo camión. Si ya está en otra flota,
    -- o ha cambiado de cliente o es un error; en los dos casos decide oficina.
    if exists (select 1 from tc_vehiculos
                where empresa_id <> p_empresa and tc_matricula_normalizada(matricula) = v_mat) then
      raise exception 'La matrícula % ya está dada de alta en otra flota. Avisa a oficina.', v_mat;
    end if;

    select * into v_tipo from tc_tipos_vehiculo where id = p_tipo;
    if not found then raise exception 'Tipo de vehículo no encontrado'; end if;
    if not v_tipo.activo then
      raise exception 'El tipo de vehículo "%" está dado de baja', v_tipo.nombre;
    end if;

    select count(*) into v_pos from tc_posiciones_vehiculo
     where tipo_vehiculo_id = p_tipo and activo;
    if v_pos = 0 then
      raise exception 'El tipo "%" no tiene posiciones generadas todavía. '
        'Tiene que generarlas un administrador desde el panel antes de dar de '
        'alta vehículos de este tipo.', v_tipo.nombre;
    end if;

    if p_config_ejes is not null
       and not exists (select 1 from tc_config_ejes where id = p_config_ejes) then
      raise exception 'Configuración de ejes no encontrada';
    end if;
    if p_medida is not null
       and not exists (select 1 from tc_cat_medidas_neumatico where id = p_medida) then
      raise exception 'Medida no encontrada';
    end if;
    if p_km is not null and p_km < 0 then
      raise exception 'Los kilómetros no pueden ser negativos';
    end if;

    if p_ejes is not null and jsonb_typeof(p_ejes) <> 'array' then
      raise exception 'p_ejes tiene que ser una lista de {eje, medida_id}';
    end if;
    for v_e in select * from jsonb_array_elements(coalesce(p_ejes, '[]'::jsonb)) loop
      if coalesce((v_e->>'eje')::int, 0) < 1 then
        raise exception 'Número de eje no válido: %', v_e->>'eje';
      end if;
      if nullif(v_e->>'medida_id','') is not null
         and not exists (select 1 from tc_cat_medidas_neumatico
                          where id = (v_e->>'medida_id')::uuid) then
        raise exception 'Medida del eje % no encontrada', v_e->>'eje';
      end if;
      v_n_ejes := v_n_ejes + 1;
    end loop;

    insert into tc_vehiculos (
      empresa_id, matricula, tipo_vehiculo_id, config_ejes_id, medida_id,
      numero_unidad, km_actual, origen_km, activo,
      pendiente_validar, creado_por, creado_desde,
      foto_matricula_path, matricula_tecleada)
    values (
      p_empresa, v_mat, p_tipo, p_config_ejes, p_medida,
      nullif(trim(coalesce(p_numero_unidad, '')), ''),
      coalesce(p_km, 0), 'manual', true,
      true, auth.uid(), 'tablet',
      nullif(trim(coalesce(p_foto_matricula, '')), ''), coalesce(p_matricula_tecleada, false))
    returning id into v_id;

    if v_n_ejes > 0 then
      for v_e in select * from jsonb_array_elements(p_ejes) loop
        insert into tc_vehiculo_ejes (vehiculo_id, eje, medida_id)
        values (v_id, (v_e->>'eje')::int, nullif(v_e->>'medida_id','')::uuid)
        on conflict (vehiculo_id, eje) do update set medida_id = excluded.medida_id;
      end loop;
      update tc_vehiculos set medidas_por_eje = true where id = v_id;
    end if;

    return jsonb_build_object(
      'vehiculo_id', v_id, 'matricula', v_mat, 'ya_existia', false,
      'pendiente_validar', true, 'posiciones', v_pos, 'ejes', v_n_ejes,
      'tipo', v_tipo.nombre, 'configuracion_ejes', v_tipo.configuracion_ejes);
  end $f$;

  comment on function tc_alta_vehiculo_desde_parte(uuid, text, uuid, uuid, uuid, text, numeric, jsonb, text, boolean) is
    'Da de alta un vehículo desde la tablet con lo mínimo, sin abrir la escritura '
    'de tc_vehiculos. Compara la matrícula normalizada; si existe activa en la '
    'flota la devuelve, si está de baja o en otra flota se niega. Guarda la foto '
    'de la matrícula y si se tecleó. Nace pendiente_validar con su creador.';

  revoke all on function tc_comprobar_matricula(text) from public;
  grant execute on function tc_comprobar_matricula(text) to authenticated;
  grant execute on function tc_matricula_normalizada(text) to authenticated;
  grant execute on function tc_matriculas_a_un_caracter(text, text) to authenticated;
  grant execute on function tc_alta_vehiculo_desde_parte(uuid, text, uuid, uuid, uuid, text, numeric, jsonb, text, boolean) to authenticated;

  -- ── Comprobaciones ───────────────────────────────────────────────────────
  if tc_matricula_normalizada(' 4721-lmn ') <> '4721LMN' then
    raise exception 'tc_matricula_normalizada no normaliza bien.';
  end if;
  if not tc_matriculas_a_un_caracter('4721LMN', '4721LNN')      -- uno cambiado
     or not tc_matriculas_a_un_caracter('4721LMN', '472LMN')    -- uno de menos
     or not tc_matriculas_a_un_caracter('4721LMN', '47211LMN')  -- uno de más
     or tc_matriculas_a_un_caracter('4721LMN', '4721LMN')       -- la misma no
     or tc_matriculas_a_un_caracter('4721LMN', '4712LMN')       -- dos cambiados no
     or tc_matriculas_a_un_caracter('4721LMN', '1234BCD') then
    raise exception 'tc_matriculas_a_un_caracter no distingue bien.';
  end if;

  select count(*) into v_n from pg_proc where proname = 'tc_alta_vehiculo_desde_parte';
  if v_n <> 1 then
    raise exception 'Tiene que quedar UNA sola tc_alta_vehiculo_desde_parte y hay %.', v_n;
  end if;

  select pg_get_expr(polqual, polrelid) || ' | ' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
    into v_pol_despues
    from pg_policy where polname = 'tc_vehiculos_write';
  if v_pol_despues is distinct from v_pol_antes then
    raise exception 'La política tc_vehiculos_write ha cambiado y no debía.';
  end if;

  perform set_config('mobilink.resultado',
    'Alta desde revisión lista: matrícula normalizada, comprobación de parecidas y foto de la matrícula.', false);
end $migracion$;

select current_setting('mobilink.resultado', true) as resultado;
