-- ============================================================
-- Mobilink TyreControl — Alta de vehículo desde la tablet
--
-- POR QUÉ HACE FALTA
--
-- El flujo guiado del parte tiene que poder seguir cuando la matrícula no
-- está en TyreControl. Hoy no puede: tc_vehiculos_write (tyrecontrol_fase3.sql)
-- solo deja escribir a superadmin y al administrador de la empresa, y el
-- técnico —que es quien está delante del camión— queda fuera.
--
-- UNA PUERTA ESTRECHA, NO LA PARED
--
-- No se toca la política de tc_vehiculos. Se añade UNA función que crea un
-- vehículo de UNA forma concreta, con lo mínimo, marcándolo pendiente de
-- validar y dejando escrito quién lo creó. El operador no gana permiso sobre
-- la tabla: gana permiso para esta operación. Es el mismo patrón que
-- tc_crear_referencia_provisional para el catálogo.
--
-- Al final de este fichero hay una comprobación que TUMBA la migración si
-- alguien ha ampliado de paso la política de tc_vehiculos. La promesa de que
-- la puerta sigue siendo estrecha se verifica, no se confía.
--
-- LO QUE NO HAY QUE CREAR: LAS POSICIONES
--
-- Esto lo decíamos mal en los dos borradores del prompt, el tuyo y el mío:
-- «crear sus ejes y posiciones». No hay nada que crear.
--
--   create table tc_posiciones_vehiculo (
--     tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id) ...
--
-- Las posiciones cuelgan del TIPO DE VEHÍCULO, no del vehículo. Todos los
-- camiones del mismo tipo comparten el mismo esquema de ruedas, y los tipos
-- que ya existen ya tienen sus posiciones generadas. Dar de alta un vehículo
-- de un tipo existente NO genera ninguna posición.
--
-- Eso quita de encima el problema gordo que tenía este diseño: las posiciones
-- se generan con generarPosiciones() en TypeScript, en el servidor
-- (POST /api/tyrecontrol/tipos/:id/generar-posiciones), y una función de
-- PostgreSQL no puede llamarla. Habría hecho falta reescribir esa lógica en
-- SQL y mantener dos copias. No hace falta.
--
-- La consecuencia es que el operario elige un TIPO DE VEHÍCULO existente, no
-- inventa una configuración. Si ninguno encaja, el alta se rechaza con un
-- mensaje que lo dice: crear un tipo nuevo es otra cosa, la hace un
-- administrador, y sí genera posiciones.
--
-- Idempotente.
-- ============================================================

-- ── 1. De dónde salió cada vehículo ─────────────────────────────────────────
-- Aditivas y con defecto: nada de lo que ya escribe en esta tabla se entera.
alter table tc_vehiculos
  add column if not exists pendiente_validar boolean not null default false,
  add column if not exists creado_por        uuid,
  add column if not exists creado_desde      text;

alter table tc_vehiculos drop constraint if exists chk_veh_creado_desde;
alter table tc_vehiculos add constraint chk_veh_creado_desde
  check (creado_desde is null or creado_desde in ('panel','tablet','importacion'));

-- Son pocas filas, pero es justo lo que la pantalla de validación busca.
create index if not exists idx_tc_vehiculos_pendiente on tc_vehiculos (pendiente_validar)
  where pendiente_validar;

comment on column tc_vehiculos.pendiente_validar is
  'Nació en la tablet con lo mínimo. Un administrador tiene que completarle '
  'marca, modelo y delegación, o fusionarlo si ya estaba dado de alta con la '
  'matrícula escrita de otra manera.';

-- ── 2. El alta ──────────────────────────────────────────────────────────────
-- La versión de siete argumentos se retira: con un "create or replace" y un
-- argumento nuevo con defecto quedarían las DOS, y una llamada por nombre de
-- parámetro sería ambigua o iría a parar a la vieja sin medidas por eje.
drop function if exists tc_alta_vehiculo_desde_parte(uuid, text, uuid, uuid, uuid, text, numeric);

create or replace function tc_alta_vehiculo_desde_parte(
  p_empresa       uuid,
  p_matricula     text,
  p_tipo          uuid,
  p_config_ejes   uuid    default null,
  p_medida        uuid    default null,
  p_numero_unidad text    default null,
  p_km            numeric default null,
  -- Medidas por eje: [{"eje":1,"medida_id":"…"}, …]. Es opcional; lo normal es
  -- que todos los ejes lleven la misma y baste p_medida.
  p_ejes          jsonb   default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_mat text; v_id uuid; v_pos int; v_tipo record; v_existente record;
  v_e jsonb; v_n_ejes int := 0;
begin
  if not (tc_is_superadmin()
          or (tc_is_admin() and p_empresa = tc_auth_empresa_id())
          or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso para dar de alta vehículos en esta empresa';
  end if;

  -- Igual que crearVehiculo en el panel: sin espacios y en mayúsculas. Si aquí
  -- se normalizara de otra manera, la misma matrícula entraría dos veces según
  -- por dónde se diera de alta.
  v_mat := upper(trim(coalesce(p_matricula, '')));
  if v_mat = '' then raise exception 'Hace falta la matrícula'; end if;

  -- YA EXISTE: no es un error, es el caso normal cuando dos técnicos coinciden
  -- o cuando el de antes escribió la matrícula con un espacio. Se devuelve el
  -- que hay para que el parte siga con él, en vez de reventar el flujo.
  --
  -- Y se comprueba así, y no "buscar y luego insertar": entre las dos cosas
  -- cabe otra tablet. El unique (empresa_id, matricula) es quien lo garantiza;
  -- esto solo evita el error cuando ya se sabe de antes.
  select id, pendiente_validar into v_existente
    from tc_vehiculos where empresa_id = p_empresa and matricula = v_mat;
  if found then
    return jsonb_build_object(
      'vehiculo_id', v_existente.id, 'matricula', v_mat, 'ya_existia', true,
      'pendiente_validar', v_existente.pendiente_validar);
  end if;

  -- EL TIPO manda, porque de él cuelgan las posiciones.
  select * into v_tipo from tc_tipos_vehiculo where id = p_tipo;
  if not found then raise exception 'Tipo de vehículo no encontrado'; end if;
  if not v_tipo.activo then
    raise exception 'El tipo de vehículo "%" está dado de baja', v_tipo.nombre;
  end if;

  -- SIN POSICIONES NO SE DA DE ALTA. Un vehículo sin esquema de ruedas no
  -- puede sostener un parte: las tablas de desmontados y montados quedarían
  -- sin posición, y una fila sin posición no alimenta el histórico. Antes de
  -- crear un vehículo inservible, se dice qué falta y quién lo arregla.
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
  -- La medida del vehículo es tc_cat_medidas_neumatico, NO tyre_sizes: son dos
  -- catálogos distintos y tc_vehiculos.medida_id apunta al primero.
  if p_medida is not null
     and not exists (select 1 from tc_cat_medidas_neumatico where id = p_medida) then
    raise exception 'Medida no encontrada';
  end if;
  if p_km is not null and p_km < 0 then
    raise exception 'Los kilómetros no pueden ser negativos';
  end if;

  -- Las medidas por eje se validan ANTES de crear nada: si una es inventada,
  -- mejor que no salga el vehículo a que salga con los ejes a medias.
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

  -- Nace pendiente de validar y con su procedencia. Marca, modelo, delegación
  -- y llanta se quedan vacíos a propósito: son nulables, y preguntárselos al
  -- operario en el arcén es la forma de que abandone y lo apunte en papel.
  insert into tc_vehiculos (
    empresa_id, matricula, tipo_vehiculo_id, config_ejes_id, medida_id,
    numero_unidad, km_actual, origen_km, activo,
    pendiente_validar, creado_por, creado_desde)
  values (
    p_empresa, v_mat, p_tipo, p_config_ejes, p_medida,
    nullif(trim(coalesce(p_numero_unidad, '')), ''),
    coalesce(p_km, 0), 'manual', true,
    true, auth.uid(), 'tablet')
  returning id into v_id;

  -- ── Las medidas por eje ──
  -- Van por aquí y no por tc_set_vehiculo_ejes porque esa pide administrador,
  -- y ampliarla para que la llame un operario abriría la edición de los ejes
  -- de CUALQUIER vehículo. Aquí solo se escriben los del que se acaba de
  -- crear, en la misma llamada y en la misma transacción.
  if v_n_ejes > 0 then
    for v_e in select * from jsonb_array_elements(p_ejes) loop
      insert into tc_vehiculo_ejes (vehiculo_id, eje, medida_id)
      values (v_id, (v_e->>'eje')::int, nullif(v_e->>'medida_id','')::uuid)
      -- El mismo eje dos veces en la lista: manda el último, no revienta.
      on conflict (vehiculo_id, eje) do update set medida_id = excluded.medida_id;
    end loop;
    update tc_vehiculos set medidas_por_eje = true where id = v_id;
  end if;

  return jsonb_build_object(
    'vehiculo_id', v_id, 'matricula', v_mat, 'ya_existia', false,
    'pendiente_validar', true, 'posiciones', v_pos, 'ejes', v_n_ejes,
    'tipo', v_tipo.nombre, 'configuracion_ejes', v_tipo.configuracion_ejes);
end $$;

comment on function tc_alta_vehiculo_desde_parte(uuid, text, uuid, uuid, uuid, text, numeric, jsonb) is
  'Da de alta un vehículo desde la tablet con lo mínimo para sostener un parte, '
  'sin abrir la escritura de tc_vehiculos. Nace pendiente_validar con su '
  'creador. Con p_ejes guarda además la medida de cada eje (tc_vehiculo_ejes), '
  'que desde la tablet no se puede escribir de otra forma. No genera '
  'posiciones: cuelgan del tipo de vehículo, que ya las tiene. Si la matrícula '
  'ya existe devuelve la que hay en vez de fallar.';

-- ── 3. Validarlo desde el panel ─────────────────────────────────────────────
create or replace function tc_validar_vehiculo(p_vehiculo uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  -- Validar es cosa del administrador, igual que en el catálogo. Si lo pudiera
  -- validar quien lo creó, la marca de "pendiente" no querría decir nada.
  if not (tc_is_superadmin() or (tc_is_admin() and v.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Sólo un administrador valida vehículos';
  end if;
  update tc_vehiculos
     set pendiente_validar = false, updated_at = now()
   where id = p_vehiculo;
end $$;

grant execute on function tc_alta_vehiculo_desde_parte(uuid, text, uuid, uuid, uuid, text, numeric, jsonb) to authenticated;
grant execute on function tc_validar_vehiculo(uuid) to authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare v_n int; v_pol text;
begin
  -- DURO: la función tiene que existir con sus ocho argumentos, y SOLO ella.
  -- Dos versiones conviviendo harían que una llamada por nombre de parámetro
  -- fuese ambigua, o peor: que fuera a parar a la vieja sin medidas por eje.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tc_alta_vehiculo_desde_parte';
  if v_n <> 1 then
    raise exception 'Hay % versiones de tc_alta_vehiculo_desde_parte; tiene que haber una', v_n;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and p.proname = 'tc_alta_vehiculo_desde_parte'
                    and p.pronargs = 8) then
    raise exception 'No se ha creado tc_alta_vehiculo_desde_parte con los 8 argumentos';
  end if;

  -- DURO: la tabla de ejes y su unique, del que depende el "on conflict".
  if not exists (select 1 from pg_constraint
                  where conrelid = 'tc_vehiculo_ejes'::regclass and contype = 'u') then
    raise exception 'Falta el unique (vehiculo_id, eje) de tc_vehiculo_ejes';
  end if;

  -- DURO, Y ES EL IMPORTANTE: la política de tc_vehiculos NO se ha tocado.
  -- Toda la propuesta se sostiene en que la puerta es estrecha; si alguien
  -- amplía de paso la escritura de la tabla, esto tiene que caerse.
  select pg_get_expr(polwithcheck, polrelid) into v_pol
    from pg_policy where polname = 'tc_vehiculos_write'
     and polrelid = 'tc_vehiculos'::regclass;
  if v_pol is null then
    raise exception 'Ha desaparecido la política tc_vehiculos_write';
  end if;
  if v_pol like '%operador%' then
    raise exception 'La política tc_vehiculos_write se ha ampliado a operadores: '
      'la función acotada existe justamente para no tener que hacer eso';
  end if;

  -- DURO: las columnas de procedencia.
  if not exists (select 1 from information_schema.columns
                  where table_name = 'tc_vehiculos' and column_name = 'pendiente_validar') then
    raise exception 'Falta tc_vehiculos.pendiente_validar';
  end if;

  -- DURO: que las posiciones sigan colgando del TIPO. Si algún día pasaran a
  -- colgar del vehículo, esta función se queda corta y hay que revisarla.
  if not exists (select 1 from information_schema.columns
                  where table_name = 'tc_posiciones_vehiculo'
                    and column_name = 'tipo_vehiculo_id') then
    raise exception 'tc_posiciones_vehiculo ya no cuelga del tipo: '
      'tc_alta_vehiculo_desde_parte da por hecho que sí y hay que revisarla';
  end if;

  -- AVISO: tipos activos sin posiciones. No es un fallo de esta migración,
  -- pero son tipos con los que el alta desde la tablet va a fallar.
  select count(*) into v_n from tc_tipos_vehiculo t
   where t.activo
     and not exists (select 1 from tc_posiciones_vehiculo p
                      where p.tipo_vehiculo_id = t.id and p.activo);
  if v_n > 0 then
    raise warning 'Hay % tipo(s) de vehículo activos sin posiciones generadas. '
      'El alta desde la tablet los rechazará. Verlos: select nombre from '
      'tc_tipos_vehiculo t where t.activo and not exists (select 1 from '
      'tc_posiciones_vehiculo p where p.tipo_vehiculo_id = t.id and p.activo);', v_n;
  end if;

  select count(*) into v_n from tc_vehiculos where pendiente_validar;
  raise notice 'OK: el técnico puede dar de alta un vehículo desde la tablet sin '
    'que se abra la escritura de tc_vehiculos. % pendiente(s) de validar.', v_n;
end $$;
