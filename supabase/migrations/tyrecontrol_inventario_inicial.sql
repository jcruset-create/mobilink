-- ============================================================
-- SEA TyreControl — Inventario inicial de un vehículo.
--
-- Cuando un camión entra en TyreControl, sus gomas YA ESTÁN PUESTAS. Alguien
-- las compró y las montó antes, quizá hace dos años. Apuntarlas no es una
-- venta, ni un trabajo facturable, ni una salida de almacén: es reconocer lo
-- que ya está ahí.
--
-- ── Por qué esto NO copia el montaje ────────────────────────────────────────
--
-- Porque `tc_montar_desde_catalogo` ya hace bien lo difícil: comprueba el
-- permiso, que la posición sea del tipo del vehículo, que no esté ya ocupada y
-- que la medida esté homologada; genera el número interno; y —esto es lo que
-- importa aquí— NO descuenta stock ni genera coste: lo dice su propia
-- cabecera, «sin descuento de stock».
--
-- Copiar esas cien líneas para cambiarles una etiqueta habría creado un
-- segundo montaje que envejecería por su cuenta: el día que se arreglara una
-- validación en uno, el otro se quedaría atrás. Así que esta función LLAMA a
-- la de siempre y después reetiqueta lo que distingue al inventario inicial:
--
--   origen = 'carga_inicial'   (valor que ya existía en el check de
--                               tc_neumaticos.origen y que nadie usaba)
--   y la observación de la operación, para que en el histórico se lea que esa
--   goma no se montó ese día: se encontró montada.
--
-- ── La medición va a una revisión de verdad ─────────────────────────────────
--
-- No se inventa una tabla de mediciones iniciales. La profundidad y la presión
-- van donde van siempre, `revisiones_neumaticos_detalle`, colgando de una
-- revisión en estado 'borrador' que se cierra al terminar el inventario. Así
-- el primer dato de cada goma entra en el histórico por la misma puerta que
-- todos los demás, y los informes de desgaste lo ven sin saber nada de esto.
--
-- ── La presión NO medida es NULL ────────────────────────────────────────────
--
-- Nunca cero. Un cero es una presión: significa rueda desinflada, y mentiría
-- en cada informe que la mire. Lo que no se ha medido se guarda como ausencia.
--
-- Reversible con `drop function`. No altera ninguna tabla.
-- ============================================================

create or replace function tc_inventario_inicial_posicion(
  p_vehiculo  uuid,
  p_posicion  uuid,
  p_referencia uuid,
  p_datos     jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_veh        record;
  v_empresa    uuid;
  v_revision   uuid;
  v_neumatico  uuid;
  v_montaje    record;
  v_profundidad numeric;
  v_presion    numeric;
  v_serie      text;
  v_dot        text;
  v_total      int;
  v_hechas     int;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;

  if not (tc_is_superadmin()
          or (tc_is_admin() and v_empresa = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso sobre este vehículo';
  end if;

  -- La profundidad es obligatoria: es el dato por el que existe TyreControl.
  -- La presión no, porque no siempre se lleva el manómetro.
  v_profundidad := nullif(p_datos->>'profundidad_mm', '')::numeric;
  if v_profundidad is null then
    raise exception 'Falta la profundidad: sin ella la goma no se puede seguir.';
  end if;
  if v_profundidad < 0 or v_profundidad > 30 then
    raise exception 'Profundidad imposible: % mm.', v_profundidad;
  end if;
  v_presion := nullif(p_datos->>'presion_bar', '')::numeric;
  if v_presion is not null and (v_presion <= 0 or v_presion > 15) then
    raise exception 'Presión imposible: % bar.', v_presion;
  end if;
  v_serie := nullif(trim(p_datos->>'numero_serie'), '');
  v_dot   := nullif(trim(p_datos->>'dot'), '');

  -- Un número de serie repetido se avisa en cristiano en vez de dejar que
  -- reviente el índice único con un mensaje de Postgres.
  if v_serie is not null and exists (
       select 1 from tc_neumaticos
        where empresa_id = v_empresa and numero_serie = v_serie and activo) then
    raise exception 'Ese número de serie (%) ya está en otro neumático de esta empresa.', v_serie;
  end if;

  -- La revisión inicial: una por vehículo mientras dure el inventario. Se
  -- busca antes de crear, así que reanudar un borrador no abre otra.
  select id into v_revision from revisiones_vehiculo
   where vehiculo_id = p_vehiculo and estado_revision = 'borrador'
   order by created_at desc limit 1;
  if v_revision is null then
    insert into revisiones_vehiculo (empresa_id, vehiculo_id, tecnico_id, estado_revision, observaciones)
    values (v_empresa, p_vehiculo, auth.uid(), 'borrador', 'Inventario inicial del vehículo')
    returning id into v_revision;
  end if;

  select * into v_montaje from tc_montajes_actuales
   where vehiculo_id = p_vehiculo and posicion_id = p_posicion;

  if found then
    -- La posición ya tiene goma: esto es una CORRECCIÓN de la medición, no un
    -- montaje nuevo. Cambiar el neumático de una posición ya informada tiene
    -- su propio camino (`tc_corregir_montado`) y no se duplica aquí.
    v_neumatico := v_montaje.neumatico_id;
  else
    -- Se monta con la de siempre. `usado` y no `nuevo` porque la goma lleva
    -- rodando: su profundidad es la medida, no la de dibujo del catálogo.
    v_neumatico := tc_montar_desde_catalogo(
      p_vehiculo, p_posicion, p_referencia,
      true,                                   -- control individual: cada goma es una
      jsonb_build_object('numero_serie', v_serie, 'dot', v_dot,
                         'profundidad_actual_mm', v_profundidad::text),
      null,                                   -- km: los pone la revisión, no el montaje
      current_date,
      'Inventario inicial: la goma ya estaba montada',
      false,                                  -- no se fuerza ninguna medida
      'usado');

    -- Lo que distingue al inventario inicial de un montaje de catálogo.
    update tc_neumaticos set origen = 'carga_inicial', updated_at = now()
     where id = v_neumatico;
    update operaciones_neumaticos
       set estado_anterior = 'inventario_inicial',
           observaciones = 'Inventario inicial: la goma ya estaba montada cuando el vehículo entró en TyreControl. No es una venta ni un trabajo facturable.'
     where neumatico_id = v_neumatico and tipo_operacion = 'montaje';
  end if;

  -- La medición, en su sitio de siempre. El unique (revision_id, posicion_id)
  -- hace que repetir la petición corrija en vez de duplicar.
  insert into revisiones_neumaticos_detalle (
    revision_id, empresa_id, vehiculo_id, neumatico_id, posicion_id,
    profundidad_mm, presion_bar, metodo_profundidad, metodo_presion,
    observaciones, foto_url)
  values (
    v_revision, v_empresa, p_vehiculo, v_neumatico, p_posicion,
    v_profundidad, v_presion, 'manual',
    -- Sin presión no hay método de presión: un 'manual' ahí diría que alguien
    -- la midió a mano, que es justo lo contrario de lo que pasó.
    case when v_presion is null then null else 'manual' end,
    nullif(trim(p_datos->>'observaciones'), ''), nullif(trim(p_datos->>'foto_url'), ''))
  on conflict (revision_id, posicion_id) do update set
    neumatico_id       = excluded.neumatico_id,
    profundidad_mm     = excluded.profundidad_mm,
    presion_bar        = excluded.presion_bar,
    metodo_profundidad = excluded.metodo_profundidad,
    metodo_presion     = excluded.metodo_presion,
    observaciones      = excluded.observaciones,
    foto_url           = coalesce(excluded.foto_url, revisiones_neumaticos_detalle.foto_url);

  select count(*)::int into v_total
    from tc_posiciones_vehiculo where tipo_vehiculo_id = v_veh.tipo_vehiculo_id and activo;
  select count(*)::int into v_hechas
    from revisiones_neumaticos_detalle
   where revision_id = v_revision and profundidad_mm is not null;

  return jsonb_build_object(
    'revision_id', v_revision,
    'neumatico_id', v_neumatico,
    'numero_interno', (select numero_interno from tc_neumaticos where id = v_neumatico),
    'hechas', v_hechas, 'total', v_total,
    'presion_medida', v_presion is not null);
end $$;

comment on function tc_inventario_inicial_posicion(uuid, uuid, uuid, jsonb) is
  'Apunta el neumático que YA ESTABA montado en una posición, con su medición '
  'inicial. Llama a tc_montar_desde_catalogo (que no descuenta stock) y '
  'reetiqueta el origen como carga_inicial. La profundidad es obligatoria; la '
  'presión no medida se guarda como NULL, nunca como cero. Repetir la '
  'petición corrige la medición en vez de duplicarla.';

grant execute on function tc_inventario_inicial_posicion(uuid, uuid, uuid, jsonb) to authenticated;

-- ============================================================
-- Cerrar el inventario inicial.
--
-- Comprueba que el plano está cubierto ANTES de dar el vehículo por operativo:
-- un camión marcado como listo con dos ruedas sin informar es peor que uno
-- que sigue en la cola, porque nadie vuelve a mirarlo.
--
-- Lo que NO bloquea, a propósito: la presión (no siempre se mide) y los datos
-- de oficina (marca, modelo, bastidor). Eso está escrito en el encargo y aquí
-- se cumple: no se consultan siquiera.
--
-- Idempotente: si la revisión ya está cerrada, contesta lo mismo y no vuelve a
-- escribir. Un doble toque en «Finalizar» no crea dos revisiones iniciales.
-- ============================================================

create or replace function tc_inventario_inicial_finalizar(
  p_vehiculo uuid,
  p_km       numeric default null,
  p_origen_km text   default 'manual'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_veh      record;
  v_revision record;
  v_total    int;
  v_con_goma int;
  v_medidas  int;
  v_faltan   text;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin()
          or (tc_is_admin() and v_veh.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_veh.empresa_id)) then
    raise exception 'Sin permiso sobre este vehículo';
  end if;

  -- Doble toque: la revisión ya cerrada se devuelve tal cual.
  select * into v_revision from revisiones_vehiculo
   where vehiculo_id = p_vehiculo and estado_revision = 'completada'
     and observaciones = 'Inventario inicial del vehículo'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('revision_id', v_revision.id, 'ya_estaba', true);
  end if;

  select * into v_revision from revisiones_vehiculo
   where vehiculo_id = p_vehiculo and estado_revision = 'borrador'
   order by created_at desc limit 1;
  if not found then
    raise exception 'No hay ningún inventario empezado para este vehículo.';
  end if;

  select count(*)::int into v_total
    from tc_posiciones_vehiculo where tipo_vehiculo_id = v_veh.tipo_vehiculo_id and activo;
  if v_total = 0 then raise exception 'Este vehículo no tiene plano.'; end if;

  select count(*)::int into v_con_goma
    from tc_montajes_actuales where vehiculo_id = p_vehiculo;
  if v_con_goma < v_total then
    -- Se dice CUÁLES faltan, no solo cuántas: con ocho posiciones, «faltan 2»
    -- obliga a repasarlas todas.
    select string_agg(p.codigo_posicion, ', ' order by p.orden_visual) into v_faltan
      from tc_posiciones_vehiculo p
     where p.tipo_vehiculo_id = v_veh.tipo_vehiculo_id and p.activo
       and not exists (select 1 from tc_montajes_actuales m
                        where m.vehiculo_id = p_vehiculo and m.posicion_id = p.id);
    raise exception 'Faltan neumáticos por informar en: %', v_faltan;
  end if;

  select count(*)::int into v_medidas
    from revisiones_neumaticos_detalle
   where revision_id = v_revision.id and profundidad_mm is not null;
  if v_medidas < v_total then
    select string_agg(p.codigo_posicion, ', ' order by p.orden_visual) into v_faltan
      from tc_posiciones_vehiculo p
     where p.tipo_vehiculo_id = v_veh.tipo_vehiculo_id and p.activo
       and not exists (select 1 from revisiones_neumaticos_detalle d
                        where d.revision_id = v_revision.id and d.posicion_id = p.id
                          and d.profundidad_mm is not null);
    raise exception 'Faltan profundidades en: %', v_faltan;
  end if;

  update revisiones_vehiculo
     set estado_revision = 'completada',
         km_vehiculo = coalesce(p_km, km_vehiculo),
         origen_km   = coalesce(p_origen_km, origen_km),
         tecnico_id  = coalesce(tecnico_id, auth.uid()),
         updated_at  = now()
   where id = v_revision.id;

  -- Los km del vehículo solo suben, nunca bajan: una lectura más baja que la
  -- que ya había suele ser un dedazo o un cambio de cuadro, y sobrescribirla
  -- en silencio estropearía el cálculo de desgaste de todas sus gomas.
  if p_km is not null and p_km > coalesce(v_veh.km_actual, 0) then
    update tc_vehiculos set km_actual = p_km, origen_km = coalesce(p_origen_km, 'manual'),
                            updated_at = now()
     where id = p_vehiculo;
  end if;

  return jsonb_build_object('revision_id', v_revision.id, 'ya_estaba', false,
                            'posiciones', v_total, 'km', p_km);
end $$;

comment on function tc_inventario_inicial_finalizar(uuid, numeric, text) is
  'Cierra el inventario inicial: exige neumático y profundidad en TODAS las '
  'posiciones del plano y dice cuáles faltan. La presión y los datos de '
  'oficina no bloquean. Idempotente: un doble toque no crea dos revisiones. '
  'Los km del vehículo solo se actualizan si la lectura es mayor que la que '
  'ya había.';

grant execute on function tc_inventario_inicial_finalizar(uuid, numeric, text) to authenticated;
