-- ============================================================
-- Mobilink TyreControl — Corregir el neumático registrado desde la revisión
--
-- EL PROBLEMA
--
-- El técnico llega a una rueda y la goma que hay puesta no es la que Mobilink
-- dice que hay. Hoy no puede hacer nada: la corrección existe (tc_corregir_
-- montado) pero solo la puede ejecutar un administrador desde el panel, y
-- quien ve la discrepancia es justo quien no puede arreglarla.
--
-- Esto NO es un trabajo de taller. No se monta ni se desmonta nada: se corrige
-- lo que Mobilink cree para que coincida con lo que hay. Cero trabajo, cero
-- coste, cero mano de obra.
--
-- QUÉ CAMBIA, y por qué cada cosa
--
-- 1. EL QUE SE CAE YA NO VUELVE AL ALMACÉN.
--
--    La versión anterior hacía esto:
--
--        -- el mal registrado vuelve a almacén (nunca estuvo realmente montado)
--        update tc_neumaticos set estado = 'almacen' ... where id = v_wrong.id;
--
--    Y eso fabrica stock que no existe. Que la ficha estuviera mal no
--    significa que la goma esté en la estantería: pudo retirarse, reciclarse,
--    montarse en otro vehículo, irse a reparar o perderse. Nadie lo sabe, y
--    dar por supuesto que está en el almacén hace que alguien vaya a buscarla
--    y no la encuentre, o peor, que se cuente como stock disponible.
--
--    Pasa a 'no_localizado', que ya era un estado válido y dice la verdad:
--    estaba fichado aquí, aquí no está, y dónde está no se sabe.
--
--    Cambia en los DOS sitios —la corrección del panel y la de la revisión—
--    porque el problema es el mismo: hoy el botón del panel también está
--    inventando stock.
--
-- 2. EL TÉCNICO PUEDE EJECUTARLA. Mismo patrón que tc_identificar_neumatico
--    (tyrecontrol_identificar_neumatico.sql), que ya resolvió esto: se acepta
--    además al operador asignado a la empresa.
--
-- 3. QUEDA ATADA A LA REVISIÓN en la que se detectó, con el método de
--    identificación y la foto si la hubo. Sin eso, dentro de seis meses la
--    corrección es un cambio sin explicación.
--
-- 4. EL TÉCNICO PUEDE DAR DE ALTA UNA REFERENCIA PROVISIONAL cuando la goma
--    que encuentra no está en el catálogo, sin salir de la revisión. Nace
--    marcada como pendiente de validar: un administrador la revisa después,
--    le corrige el nombre o la fusiona si ya existía escrita de otra manera.
--    No se abre la escritura del catálogo a todo el mundo —eso llenaría el
--    catálogo de duplicados en una semana—: se abre UNA función que crea de
--    una forma concreta y deja la marca de que hay que mirarla.
--
-- LO QUE NO HACE
--
-- No genera trabajo, ni coste, ni mano de obra, ni operación pendiente. El
-- tipo 'correccion_montado' ya está en tc_cat_tipos_operacion con
-- es_fisica = false, y la fila lleva is_correccion = true.
--
-- No encola nada: la corrección necesita red. Entre encolar y subir, otra
-- corrección puede haber tocado la misma posición, y resolver ese conflicto a
-- ciegas es peor que pedir cobertura para un caso que es raro.
--
-- Idempotente.
-- ============================================================

-- ── 1. Trazabilidad: de qué revisión salió y cómo se identificó ─────────────
-- Aditivas y con defecto: nada de lo que ya escribe en esta tabla se entera.
alter table operaciones_neumaticos
  add column if not exists revision_id           uuid references revisiones_vehiculo(id) on delete set null,
  add column if not exists metodo_identificacion text,
  add column if not exists foto_url              text;

alter table operaciones_neumaticos drop constraint if exists chk_op_metodo_ident;
alter table operaciones_neumaticos add constraint chk_op_metodo_ident
  check (metodo_identificacion is null or metodo_identificacion in ('busqueda','catalogo','foto_ia','manual'));

create index if not exists idx_op_neu_revision on operaciones_neumaticos (revision_id)
  where revision_id is not null;

-- ── 2. Catálogo: lo que nace en una revisión nace a prueba ──────────────────
alter table tc_cat_marcas_neumatico    add column if not exists pendiente_validar boolean not null default false;
alter table tc_cat_modelos_neumatico   add column if not exists pendiente_validar boolean not null default false;
alter table tc_referencias_neumatico   add column if not exists pendiente_validar boolean not null default false;
alter table tc_cat_marcas_neumatico    add column if not exists creado_por uuid;
alter table tc_cat_modelos_neumatico   add column if not exists creado_por uuid;
alter table tc_referencias_neumatico   add column if not exists creado_por uuid;

-- Para la pantalla de validación: son pocas filas, pero se buscan por esto.
create index if not exists idx_tc_ref_pendiente on tc_referencias_neumatico (pendiente_validar)
  where pendiente_validar;
create index if not exists idx_tc_modelo_pendiente on tc_cat_modelos_neumatico (pendiente_validar)
  where pendiente_validar;
create index if not exists idx_tc_marca_pendiente on tc_cat_marcas_neumatico (pendiente_validar)
  where pendiente_validar;

-- ── 3. La corrección ────────────────────────────────────────────────────────
-- Se BORRA y se recrea porque cambia la firma: añadir argumentos no reemplaza
-- la función, crea una segunda, y la vieja seguiría mandando gomas al almacén.
drop function if exists tc_corregir_montado(uuid, uuid, text);

create or replace function tc_corregir_montado(
  p_montaje uuid,
  p_neumatico_correcto uuid,
  p_obs text default null,
  p_revision uuid default null,
  p_metodo text default null,
  p_foto_url text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare m record; v_wrong record; v_ok record; v_op uuid;
begin
  select * into m from tc_montajes_actuales where id = p_montaje;
  if not found then raise exception 'Montaje no encontrado'; end if;

  -- El técnico asignado a la empresa también corrige: es quien está delante de
  -- la rueda. Mismo criterio que tc_identificar_neumatico.
  if not (tc_is_superadmin()
          or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(m.empresa_id)) then
    raise exception 'Sin permiso para corregir el neumático de esta empresa';
  end if;

  if p_neumatico_correcto = m.neumatico_id then
    raise exception 'El neumático indicado ya es el registrado';
  end if;

  select * into v_wrong from tc_neumaticos where id = m.neumatico_id;
  select * into v_ok    from tc_neumaticos where id = p_neumatico_correcto;
  if not found then raise exception 'Neumático correcto no encontrado'; end if;
  if v_ok.empresa_id <> m.empresa_id then raise exception 'El neumático correcto es de otra empresa'; end if;
  if v_ok.estado = 'montado' or exists (select 1 from tc_montajes_actuales where neumatico_id = p_neumatico_correcto) then
    raise exception 'El neumático correcto ya figura montado en otra posición';
  end if;
  if v_ok.estado = 'descartado' then raise exception 'El neumático correcto está descartado'; end if;

  -- La revisión, si viene, tiene que ser de este vehículo: atarla a otra
  -- contaría la corrección donde no pasó.
  if p_revision is not null and not exists (
    select 1 from revisiones_vehiculo r
     where r.id = p_revision and r.vehiculo_id = m.vehiculo_id
  ) then
    raise exception 'La revisión indicada no es de este vehículo';
  end if;

  -- El mal registrado NO vuelve al almacén: no sabemos dónde está.
  -- Ver la cabecera de este fichero.
  update tc_neumaticos
     set estado = 'no_localizado', vehiculo_id = null, posicion_id = null, updated_at = now()
   where id = v_wrong.id;

  update tc_neumaticos
     set estado = 'montado', vehiculo_id = m.vehiculo_id, posicion_id = m.posicion_id, updated_at = now()
   where id = v_ok.id;

  update tc_montajes_actuales set neumatico_id = p_neumatico_correcto where id = m.id;

  insert into operaciones_neumaticos (
    empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo,
    destino, tecnico_id, observaciones, is_correccion,
    revision_id, metodo_identificacion, foto_url)
  values (
    m.empresa_id, m.vehiculo_id, p_neumatico_correcto, 'correccion_montado', m.posicion_id,
    m.id, null, current_date, 'error_montaje', coalesce(v_ok.estado, 'almacen'), 'montado',
    'vehiculo', auth.uid(),
    coalesce(p_obs, '') || ' [CORRECCIÓN DE MONTADO · sale nº '
      || coalesce(v_wrong.numero_interno, '?') || ' → no localizado]',
    true, p_revision, p_metodo, p_foto_url)
  returning id into v_op;

  insert into tc_operacion_movimientos (
    operacion_id, neumatico_id, movimiento_tipo, destino_vehiculo_id, destino_posicion_id,
    estado_anterior, estado_nuevo, orden)
  values
    (v_op, v_wrong.id, 'correccion', null, null, 'montado', 'no_localizado', 1),
    (v_op, v_ok.id,    'correccion', m.vehiculo_id, m.posicion_id, coalesce(v_ok.estado, 'almacen'), 'montado', 2);

  return v_op;
end $$;

comment on function tc_corregir_montado(uuid, uuid, text, uuid, text, text) is
  'Corrige QUÉ neumático hay en una posición. No es una operación de taller: '
  'es_fisica=false e is_correccion=true, cero coste y cero mano de obra. El '
  'que estaba mal registrado pasa a no_localizado, NO al almacén: que la ficha '
  'estuviera mal no significa que la goma esté en la estantería.';

-- ── 4. Referencia provisional creada desde la revisión ──────────────────────
--
-- Reutiliza marca, modelo y medida cuando ya existen —comparando NORMALIZADO,
-- que es lo que evita que "MICHELIN", "Michelin" y "michelin" acaben siendo
-- tres marcas— y solo marca como pendiente lo que crea de cero. Si la
-- referencia ya existía, la devuelve tal cual sin tocar su estado: encontrar
-- algo que ya estaba validado no lo pone en duda.
create or replace function tc_crear_referencia_provisional(
  p_empresa uuid,
  p_marca text,
  p_modelo text,
  p_medida text,
  p_carga_simple text default null,
  p_carga_doble text default null,
  p_velocidad text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_marca uuid; v_modelo uuid; v_size uuid; v_ref uuid;
  v_marca_txt text; v_modelo_txt text; v_medida_txt text;
  v_carga text; v_doble text; v_vel text;
  v_creada_marca boolean := false; v_creado_modelo boolean := false;
  v_creada_size boolean := false; v_creada_ref boolean := false;
begin
  if not (tc_is_superadmin()
          or (tc_is_admin() and p_empresa = tc_auth_empresa_id())
          or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;

  v_marca_txt  := nullif(trim(coalesce(p_marca, '')), '');
  v_modelo_txt := nullif(trim(coalesce(p_modelo, '')), '');
  v_medida_txt := nullif(trim(coalesce(p_medida, '')), '');
  if v_marca_txt is null or v_modelo_txt is null or v_medida_txt is null then
    raise exception 'Hacen falta marca, modelo y medida para crear una referencia';
  end if;

  v_carga := nullif(upper(trim(coalesce(p_carga_simple, ''))), '');
  v_doble := nullif(upper(trim(coalesce(p_carga_doble, ''))), '');
  v_vel   := coalesce(nullif(upper(trim(coalesce(p_velocidad, ''))), ''), '');
  if v_carga is null then
    raise exception 'Hace falta el índice de carga: la medida sin él no identifica un neumático';
  end if;

  -- MARCA: se busca normalizada, se crea con el texto tal cual lo escribió el
  -- técnico. Corregir la grafía es trabajo del administrador al validar.
  select id into v_marca from tc_cat_marcas_neumatico
   where tc_marca_normalizada(nombre) = tc_marca_normalizada(v_marca_txt)
   order by pendiente_validar asc, created_at asc limit 1;
  if v_marca is null then
    insert into tc_cat_marcas_neumatico (nombre, activo, pendiente_validar, creado_por)
    values (v_marca_txt, true, true, auth.uid()) returning id into v_marca;
    v_creada_marca := true;
  end if;

  -- MODELO dentro de esa marca.
  select id into v_modelo from tc_cat_modelos_neumatico
   where marca_id = v_marca and upper(regexp_replace(nombre, '\s|-', '', 'g'))
                              = upper(regexp_replace(v_modelo_txt, '\s|-', '', 'g'))
   order by pendiente_validar asc, created_at asc limit 1;
  if v_modelo is null then
    insert into tc_cat_modelos_neumatico (marca_id, nombre, activo, pendiente_validar, creado_por)
    values (v_marca, v_modelo_txt, true, true, auth.uid()) returning id into v_modelo;
    v_creado_modelo := true;
  end if;

  -- MEDIDA: tyre_sizes ya tiene disparador que calcula referencia_completa, así
  -- que aquí no se compone el nombre a mano — se dejaría torcido.
  select id into v_size from tyre_sizes
   where activo
     and tc_medida_normalizada(medida) = tc_medida_normalizada(v_medida_txt)
     and upper(trim(indice_carga_simple)) = v_carga
     and coalesce(nullif(upper(trim(coalesce(indice_carga_doble, ''))), ''), '') = coalesce(v_doble, '')
     and coalesce(upper(trim(coalesce(codigo_velocidad, ''))), '') = v_vel
   limit 1;
  if v_size is null then
    insert into tyre_sizes (medida, indice_carga_simple, indice_carga_doble, codigo_velocidad, activo)
    values (v_medida_txt, v_carga, v_doble, v_vel, true) returning id into v_size;
    v_creada_size := true;
  end if;

  -- REFERENCIA (modelo × medida). El unique es (modelo_id, tyre_size_id).
  select id into v_ref from tc_referencias_neumatico
   where modelo_id = v_modelo and tyre_size_id = v_size limit 1;
  if v_ref is null then
    insert into tc_referencias_neumatico (
      modelo_id, tyre_size_id, referencia_completa, activo, pendiente_validar, creado_por)
    select v_modelo, v_size,
           (select nombre from tc_cat_marcas_neumatico where id = v_marca) || ' '
             || v_modelo_txt || ' ' || t.referencia_completa,
           true, true, auth.uid()
      from tyre_sizes t where t.id = v_size
    returning id into v_ref;
    v_creada_ref := true;
  end if;

  return jsonb_build_object(
    'referencia_id', v_ref, 'modelo_id', v_modelo, 'marca_id', v_marca, 'tyre_size_id', v_size,
    'referencia_completa', (select referencia_completa from tc_referencias_neumatico where id = v_ref),
    'pendiente_validar', (select pendiente_validar from tc_referencias_neumatico where id = v_ref),
    'creado', jsonb_build_object(
      'marca', v_creada_marca, 'modelo', v_creado_modelo,
      'medida', v_creada_size, 'referencia', v_creada_ref));
end $$;

comment on function tc_crear_referencia_provisional(uuid, text, text, text, text, text, text) is
  'Da de alta una referencia desde una revisión sin abrir la escritura del '
  'catálogo. Reutiliza marca/modelo/medida comparando normalizado y solo marca '
  'pendiente_validar lo que crea de cero. Un administrador la valida después.';

-- ── 4b. La goma encontrada tampoco existe como ficha ────────────────────────
--
-- Identificarla por el flanco da una REFERENCIA de catálogo (marca, modelo,
-- medida). Lo que hay en la rueda es una UNIDAD FÍSICA concreta, que es otra
-- cosa: dos gomas del mismo modelo y medida son dos fichas distintas.
--
-- Y el técnico no puede crear fichas: la RLS de tc_neumaticos pide admin. Sin
-- esto, el flujo de la foto llega hasta el final y no puede guardar nada.
--
-- Se crea la ficha Y se corrige el montaje en la MISMA llamada, a propósito:
-- una ficha suelta que no llega a montarse por un fallo de red quedaría de
-- huérfana en el inventario, contando como stock que no existe.
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
declare m record; v_neu uuid; v_op uuid;
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

  -- Nace ya montada: es donde está. Se crea en 'almacen' y la corrección la
  -- pasa a 'montado' en la misma transacción, así que nunca queda suelta.
  insert into tc_neumaticos (empresa_id, marca, modelo, medida, dot, numero_serie, estado, activo)
  values (m.empresa_id, trim(p_marca), nullif(trim(coalesce(p_modelo, '')), ''),
          trim(p_medida), nullif(trim(coalesce(p_dot, '')), ''),
          nullif(trim(coalesce(p_numero_serie, '')), ''), 'almacen', true)
  returning id into v_neu;

  v_op := tc_corregir_montado(p_montaje, v_neu, p_obs, p_revision, p_metodo, p_foto_url);

  return jsonb_build_object('neumatico_id', v_neu, 'operacion_id', v_op);
end $$;

comment on function tc_corregir_montado_nueva_ficha(uuid, text, text, text, text, text, text, uuid, text, text) is
  'Da de alta la ficha de la goma encontrada Y corrige el montaje en la misma '
  'llamada. Juntas a propósito: una ficha que no llegue a montarse por un '
  'fallo de red quedaría contando como stock que no existe.';

-- ── 5. Validar lo que creó el técnico ───────────────────────────────────────
create or replace function tc_validar_referencia(p_referencia uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_modelo uuid; v_marca uuid;
begin
  if not (tc_is_superadmin() or tc_is_admin()) then
    raise exception 'Sólo un administrador valida referencias del catálogo';
  end if;
  select r.modelo_id, m.marca_id into v_modelo, v_marca
    from tc_referencias_neumatico r join tc_cat_modelos_neumatico m on m.id = r.modelo_id
   where r.id = p_referencia;
  if v_modelo is null then raise exception 'Referencia no encontrada'; end if;

  update tc_referencias_neumatico set pendiente_validar = false, updated_at = now() where id = p_referencia;
  -- El modelo deja de estar en duda cuando no le queda ninguna referencia sin
  -- validar: validar una medida no dice nada de las otras.
  update tc_cat_modelos_neumatico set pendiente_validar = false
   where id = v_modelo and not exists (
     select 1 from tc_referencias_neumatico r where r.modelo_id = v_modelo and r.pendiente_validar);
  update tc_cat_marcas_neumatico set pendiente_validar = false
   where id = v_marca and not exists (
     select 1 from tc_cat_modelos_neumatico mo where mo.marca_id = v_marca and mo.pendiente_validar);
end $$;

grant execute on function tc_corregir_montado(uuid, uuid, text, uuid, text, text) to authenticated;
grant execute on function tc_crear_referencia_provisional(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function tc_corregir_montado_nueva_ficha(uuid, text, text, text, text, text, text, uuid, text, text) to authenticated;
grant execute on function tc_validar_referencia(uuid) to authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  -- DURO: la firma nueva tiene que existir, y la vieja de 3 argumentos NO.
  -- Si sobreviviera, PostgREST podría resolver a ella y seguiría mandando
  -- gomas al almacén sin que nadie se enterase.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'tc_corregir_montado'
                    and p.pronargs = 6) then
    raise exception 'No se ha creado tc_corregir_montado con los 6 argumentos';
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tc_corregir_montado';
  if v_n <> 1 then
    raise exception 'Hay % versiones de tc_corregir_montado: la vieja mandaba al almacén', v_n;
  end if;

  -- DURO: que no haya quedado ni rastro del 'almacen' en el cuerpo, que es el
  -- fallo que esta migración viene a arreglar.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'tc_corregir_montado'
                and p.prosrc like '%''almacen'', vehiculo_id = null%') then
    raise exception 'tc_corregir_montado sigue devolviendo al almacén el neumático mal registrado';
  end if;

  -- DURO: las columnas de trazabilidad.
  if not exists (select 1 from information_schema.columns
                  where table_name = 'operaciones_neumaticos' and column_name = 'revision_id') then
    raise exception 'Falta operaciones_neumaticos.revision_id';
  end if;

  -- DURO: el tipo de operación tiene que seguir siendo NO física, que es lo
  -- que sostiene "esto no es un trabajo de taller".
  if not exists (select 1 from tc_cat_tipos_operacion
                  where codigo = 'correccion_montado' and es_fisica = false) then
    raise exception 'correccion_montado no está marcado como es_fisica=false';
  end if;

  -- DURO: 'no_localizado' tiene que ser un estado válido del neumático, o la
  -- corrección reventaría en el primer uso.
  begin
    perform 1 from tc_neumaticos where estado = 'no_localizado';
  exception when others then
    raise exception 'no_localizado no es un estado válido de tc_neumaticos';
  end;

  -- AVISO: referencias que ya estaban pendientes de validar de una pasada
  -- anterior. No es un fallo, pero conviene que alguien las mire.
  select count(*) into v_n from tc_referencias_neumatico where pendiente_validar;
  if v_n > 0 then
    raise warning 'Hay % referencia(s) del catálogo pendientes de validar. Verlas: select referencia_completa from tc_referencias_neumatico where pendiente_validar;', v_n;
  end if;

  raise notice 'OK: la corrección se puede hacer desde la revisión, el neumático mal registrado pasa a no_localizado (no al almacén) y el técnico puede crear referencias provisionales.';
end $$;
