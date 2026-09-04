-- ============================================================
-- Mobilink TyreControl — Guardar el parte guiado de una vez
--
-- POR QUÉ UNA SOLA FUNCIÓN
--
-- El requisito es «todo o nada»: si falla una parte del guardado, no deben
-- quedar datos parciales ni stock incoherente. Y desde Flutter contra Supabase
-- NO HAY TRANSACCIÓN DE CLIENTE: cuatro llamadas seguidas son cuatro
-- transacciones, y si la cuarta falla las tres primeras ya están escritas.
--
-- La única forma de cumplirlo es que todo ocurra dentro de UNA función, porque
-- el cuerpo de una función es una transacción. De ahí este fichero.
--
-- NO REIMPLEMENTA NADA
--
-- Las operaciones se ejecutan llamando a tc_ejecutar_en_intervencion, que es
-- la pieza que ya existe para esto: despacha a la RPC de verdad
-- (tc_montar_desde_almacen, tc_desmontar_neumatico, tc_cambiar_posicion…),
-- mantiene el contexto de la intervención y comprueba que lo insertado sea de
-- esa empresa y ese vehículo. Las reglas de stock, medidas y estados siguen
-- viviendo donde vivían.
--
-- LO QUE SÍ Y LO QUE NO ENTRA EN LA TRANSACCIÓN
--
-- Entra todo lo que, a medias, dejaría la base de datos mintiendo: la
-- revisión con sus mediciones, las operaciones con sus movimientos de stock,
-- las líneas de servicio y las firmas.
--
-- NO entra el cierre de la intervención. El cierre lo hace el endpoint que ya
-- existe (POST /api/tyrecontrol/intervencion/cerrar): redacta el resumen, pide
-- el texto a la IA, captura la foto del stock y asigna el número de parte.
-- Meter eso aquí obligaría a reescribir en SQL un montón de lógica que está en
-- TypeScript, y a mantener dos copias.
--
-- No pasa nada por dejarlo fuera, y es a propósito: el cierre es REPETIBLE
-- —tc_asignar_numero_intervencion es idempotente y el informe se puede
-- regenerar—, y una intervención sin cerrar es un estado normal del sistema,
-- no un dato corrupto. Lo que no puede quedar a medias es el stock, y eso sí
-- queda dentro.
--
-- LA DOBLE PULSACIÓN
--
-- La tablet genera una clave al abrir el borrador y la manda con el parte. Si
-- la petición llega dos veces —doble toque, reintento por red mala— la segunda
-- encuentra la clave y devuelve la MISMA intervención en vez de crear otra. La
-- clave es la llave primaria de una tabla, así que dos llamadas simultáneas se
-- serializan y la segunda espera y ve la primera.
--
-- Idempotente.
-- ============================================================

-- ── 1. El registro de lo ya guardado ────────────────────────────────────────
create table if not exists tc_partes_guiados (
  -- La clave la genera la tablet, no la base de datos: tiene que existir ANTES
  -- de la primera llamada para que la segunda pueda reconocerla.
  clave           uuid primary key,
  intervencion_id uuid not null references tc_intervenciones(id) on delete cascade,
  revision_id     uuid references revisiones_vehiculo(id) on delete set null,
  vehiculo_id     uuid references tc_vehiculos(id) on delete set null,
  creado_por      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_partes_guiados_interv on tc_partes_guiados (intervencion_id);

alter table tc_partes_guiados enable row level security;
drop policy if exists partes_guiados_sel on tc_partes_guiados;
create policy partes_guiados_sel on tc_partes_guiados for select using (
  exists (select 1 from tc_intervenciones i
           where i.id = intervencion_id and tc_puede_ver_empresa(i.empresa_id)));
-- La escritura va solo por la función, que es security definer. Nadie inserta
-- aquí a mano: una clave inventada haría creer que un parte ya se guardó.

comment on table tc_partes_guiados is
  'Claves de idempotencia de los partes guiados. La tablet genera la clave al '
  'abrir el borrador; si el guardado llega dos veces, la segunda devuelve la '
  'misma intervención en vez de crear otra.';

-- ── 2. El guardado ──────────────────────────────────────────────────────────
create or replace function tc_guardar_parte_guiado(p_parte jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_clave    uuid;
  v_veh      record;
  v_ya       record;
  v_rev      uuid;
  v_int      uuid;
  v_numero   text;
  v_km       numeric;
  v_avisos   text[] := '{}';
  v_med      jsonb;
  v_acc      jsonb;
  v_srv      jsonb;
  v_n_acc    int := 0;
  v_n_med    int := 0;
  v_cab      jsonb := '{}'::jsonb;
begin
  v_clave := nullif(p_parte->>'clave', '')::uuid;
  if v_clave is null then
    raise exception 'Falta la clave del parte: sin ella un reintento crearía un parte duplicado';
  end if;

  -- YA GUARDADO. Se comprueba antes de tocar nada. La llave primaria hace que
  -- dos llamadas a la vez se serialicen: la segunda espera y ve esta fila.
  select * into v_ya from tc_partes_guiados where clave = v_clave;
  if found then
    select numero into v_numero from tc_intervenciones where id = v_ya.intervencion_id;
    return jsonb_build_object(
      'intervencion_id', v_ya.intervencion_id, 'revision_id', v_ya.revision_id,
      'numero', v_numero, 'ya_guardado', true, 'avisos', to_jsonb(v_avisos));
  end if;

  select * into v_veh from tc_vehiculos where id = (p_parte->>'vehiculo_id')::uuid;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin()
          or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_veh.empresa_id)) then
    raise exception 'Sin permiso para guardar partes de esta empresa';
  end if;

  v_km := nullif(p_parte->>'km', '')::numeric;
  if v_km is not null then
    if v_km < 0 then raise exception 'Los kilómetros no pueden ser negativos'; end if;
    -- Un kilometraje a la baja NO se rechaza: puede ser un cuentakilómetros
    -- cambiado, o el de antes se equivocó. Se avisa y decide una persona;
    -- bloquear el parte por esto dejaría al operario sin poder cerrarlo.
    if v_km < v_veh.km_actual then
      v_avisos := v_avisos || format(
        'Los kilómetros indicados (%s) son menores que los registrados (%s)',
        v_km, v_veh.km_actual);
    end if;
  end if;

  -- ── La revisión, con sus mediciones ──
  -- Va primero porque lo que el operario mide es el estado ANTES de tocar
  -- nada. Si se guardara después de las operaciones, la profundidad de una
  -- goma desmontada se habría medido sobre una rueda que ya no está ahí.
  if jsonb_array_length(coalesce(p_parte->'mediciones', '[]'::jsonb)) > 0 then
    insert into revisiones_vehiculo (
      empresa_id, vehiculo_id, km_vehiculo, origen_km, fecha_revision,
      tecnico_id, estado_revision, observaciones)
    values (
      v_veh.empresa_id, v_veh.id, v_km, 'manual', current_date,
      auth.uid(), 'completada', p_parte->>'observaciones')
    returning id into v_rev;

    for v_med in select * from jsonb_array_elements(p_parte->'mediciones') loop
      -- La posición tiene que ser del TIPO de este vehículo. Sin esto, una
      -- medición podría acabar en la rueda de otro camión.
      if not exists (
        select 1 from tc_posiciones_vehiculo
         where id = (v_med->>'posicion_id')::uuid
           and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
        raise exception 'La posición % no es de este vehículo', v_med->>'posicion_id';
      end if;

      insert into revisiones_neumaticos_detalle (
        revision_id, empresa_id, vehiculo_id, neumatico_id, posicion_id,
        profundidad_mm, presion_bar, metodo_profundidad, metodo_presion,
        estado_visual, observaciones, foto_url, no_accesible, neumatico_ausente)
      values (
        v_rev, v_veh.empresa_id, v_veh.id,
        nullif(v_med->>'neumatico_id', '')::uuid, (v_med->>'posicion_id')::uuid,
        nullif(v_med->>'profundidad_mm', '')::numeric,
        nullif(v_med->>'presion_bar', '')::numeric,
        coalesce(v_med->>'metodo_profundidad', 'manual'),
        coalesce(v_med->>'metodo_presion', 'manual'),
        nullif(v_med->>'estado_visual', ''), nullif(v_med->>'observaciones', ''),
        nullif(v_med->>'foto_url', ''),
        coalesce((v_med->>'no_accesible')::boolean, false),
        coalesce((v_med->>'neumatico_ausente')::boolean, false))
      -- Dos mediciones de la misma posición en el mismo parte: manda la última
      -- que el operario tecleó, no la primera.
      on conflict (revision_id, posicion_id) do update set
        profundidad_mm = excluded.profundidad_mm,
        presion_bar    = excluded.presion_bar,
        estado_visual  = excluded.estado_visual,
        observaciones  = excluded.observaciones,
        foto_url       = excluded.foto_url;
      v_n_med := v_n_med + 1;
    end loop;
  end if;

  -- ── La intervención y sus operaciones ──
  v_int := (tc_iniciar_intervencion(v_veh.id)->>'id')::uuid;

  for v_acc in select * from jsonb_array_elements(coalesce(p_parte->'acciones', '[]'::jsonb)) loop
    -- No se reimplementa ninguna operación: se despacha a la que ya existe,
    -- con el contexto de la intervención puesto. Si una falla, la excepción
    -- sube y se deshace TODO lo de este parte, mediciones incluidas.
    perform tc_ejecutar_en_intervencion(
      v_int, v_acc->>'rpc', coalesce(v_acc->'args', '{}'::jsonb));
    v_n_acc := v_n_acc + 1;
  end loop;

  -- ── Servicios facturables ──
  -- Se reemplazan enteros: si el parte se reintenta con otra clave, no deja
  -- líneas de un intento anterior sumando de más.
  if p_parte ? 'servicios' then
    delete from tc_intervencion_servicios where intervencion_id = v_int;
    for v_srv in select * from jsonb_array_elements(p_parte->'servicios') loop
      if coalesce((v_srv->>'cantidad')::numeric, 0) > 0 then
        insert into tc_intervencion_servicios (intervencion_id, servicio, cantidad, observaciones)
        values (v_int, v_srv->>'servicio', (v_srv->>'cantidad')::numeric,
                nullif(v_srv->>'observaciones', ''))
        on conflict (intervencion_id, servicio) do update set
          cantidad = excluded.cantidad, observaciones = excluded.observaciones;
      end if;
    end loop;
  end if;

  -- ── Cabecera, firmas y tiempos del mecánico ──
  update tc_intervenciones set
    observaciones        = coalesce(nullif(p_parte->>'observaciones', ''), observaciones),
    lugar_servicio       = coalesce(nullif(p_parte->>'lugar_servicio', ''), lugar_servicio),
    orden_flota          = coalesce(nullif(p_parte->>'orden_flota', ''), orden_flota),
    firma_cliente_url    = coalesce(nullif(p_parte->>'firma_cliente_url', ''), firma_cliente_url),
    firma_cliente_nombre = coalesce(nullif(p_parte->>'firma_cliente_nombre', ''), firma_cliente_nombre),
    firma_cliente_dni    = coalesce(nullif(p_parte->>'firma_cliente_dni', ''), firma_cliente_dni),
    firma_tecnico_url    = coalesce(nullif(p_parte->>'firma_tecnico_url', ''), firma_tecnico_url),
    firma_tecnico_nombre = coalesce(nullif(p_parte->>'firma_tecnico_nombre', ''), firma_tecnico_nombre),
    firmado_at           = case when p_parte->>'firma_cliente_url' is not null
                                 or p_parte->>'firma_tecnico_url' is not null
                                then now() else firmado_at end,
    mecanico_inicio_at   = coalesce(nullif(p_parte->>'mecanico_inicio_at', '')::timestamptz, mecanico_inicio_at),
    mecanico_fin_at      = coalesce(nullif(p_parte->>'mecanico_fin_at', '')::timestamptz, mecanico_fin_at),
    mecanico_km          = coalesce(nullif(p_parte->>'mecanico_km', '')::numeric, mecanico_km)
  where id = v_int;

  -- ── Los km del vehículo ──
  -- Solo hacia arriba: un cuentakilómetros que baja se avisa (arriba) pero no
  -- se escribe encima del bueno.
  if v_km is not null and v_km > v_veh.km_actual then
    update tc_vehiculos
       set km_actual = v_km, origen_km = 'manual', updated_at = now()
     where id = v_veh.id;
  end if;

  -- ── Y la marca de que este parte ya está guardado ──
  insert into tc_partes_guiados (clave, intervencion_id, revision_id, vehiculo_id, creado_por)
  values (v_clave, v_int, v_rev, v_veh.id, auth.uid());

  select numero into v_numero from tc_intervenciones where id = v_int;

  return jsonb_build_object(
    'intervencion_id', v_int, 'revision_id', v_rev, 'numero', v_numero,
    'ya_guardado', false, 'operaciones', v_n_acc, 'mediciones', v_n_med,
    'avisos', to_jsonb(v_avisos));
end $$;

comment on function tc_guardar_parte_guiado(jsonb) is
  'Escribe un parte guiado entero en UNA transacción: revisión con mediciones, '
  'intervención con operaciones (despachadas a las RPC que ya existen), '
  'servicios, cabecera y firmas. No cierra la intervención: eso lo hace el '
  'endpoint del servidor, que redacta el informe y asigna número, y es '
  'repetible. La clave que manda la tablet hace que un reintento devuelva el '
  'mismo parte en vez de crear otro.';

grant execute on function tc_guardar_parte_guiado(jsonb) to authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'tc_guardar_parte_guiado') then
    raise exception 'No se ha creado tc_guardar_parte_guiado';
  end if;

  -- DURO: la clave tiene que ser llave primaria. Es lo que serializa dos
  -- llamadas simultáneas; con un índice normal la doble pulsación crearía dos
  -- partes y nadie se enteraría.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'tc_partes_guiados'::regclass and contype = 'p') then
    raise exception 'tc_partes_guiados.clave no es llave primaria: la doble pulsación crearía dos partes';
  end if;

  -- DURO: las piezas que se reutilizan tienen que existir. Si alguien las
  -- renombra, esto se cae aquí y no en el arcén con el cliente delante.
  if not exists (select 1 from pg_proc where proname = 'tc_ejecutar_en_intervencion') then
    raise exception 'Falta tc_ejecutar_en_intervencion, que es quien despacha las operaciones';
  end if;
  if not exists (select 1 from pg_proc where proname = 'tc_iniciar_intervencion') then
    raise exception 'Falta tc_iniciar_intervencion';
  end if;

  -- DURO: la tabla de servicios y el unique del que depende el "on conflict".
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'tc_intervencion_servicios'::regclass and contype = 'u') then
    raise exception 'Falta el unique (intervencion_id, servicio): hace falta para el on conflict';
  end if;

  -- DURO: el unique de las mediciones, por lo mismo.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'revisiones_neumaticos_detalle'::regclass and contype = 'u') then
    raise exception 'Falta el unique (revision_id, posicion_id) de revisiones_neumaticos_detalle';
  end if;

  select count(*) into v_n from tc_partes_guiados;
  raise notice 'OK: el parte guiado se guarda de una vez y un reintento no duplica. % parte(s) guiado(s) registrados.', v_n;
end $$;
