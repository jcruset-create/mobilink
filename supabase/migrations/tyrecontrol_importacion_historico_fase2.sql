-- ============================================================================
-- Importación del histórico de albaranes · FASE 2
--
-- Amplía lo que ya hace tyrecontrol_importacion_historico.sql con tres cosas
-- que la casa ha confirmado como regla de negocio:
--
--   1. FICHA por cada unidad NUEVA importada, con el número interno del
--      sistema (tc_generar_numero_interno), marcada como identidad
--      RECONSTRUIDA: un número no demuestra qué rueda física era aquella.
--   2. SUSTITUCIÓN: todo montaje —nuevo, usado o recauchutado— desmonta al
--      ocupante anterior de esa posición. Se graban DOS operaciones por
--      unidad, entrada y salida, unidas por `grupo_sustitucion`. La salida
--      lleva `neumatico_id` nulo cuando no se sabe quién salió: el hecho del
--      desmontaje no depende de conocer la identidad.
--   3. INTERVALOS reconstruidos en tabla APARTE (tc_reconstruccion_montajes),
--      nunca en tc_historial_montajes, porque sus seis consumidores (coste
--      por km, ranking de marcas, recorrido, almacén de usados, la ficha del
--      panel y el reconocimiento de la APK) no saben distinguir un intervalo
--      estimado de uno real.
--
-- Lo que SIGUE sin hacer, igual que la fase 1: no toca tc_montajes_actuales,
-- tc_historial_montajes, movimientos_stock, revisiones ni km_actual. No monta
-- nada en el presente. No asigna destino a lo retirado si no consta.
--
-- Las tres certezas van separadas y cada una tiene su columna:
--   · el HECHO del desmontaje  → siempre, por la regla
--   · la POSICIÓN              → posicion_fuente: indicada/deducida/desconocida
--   · la IDENTIDAD del retirado → identidad_retirado: respaldada/reconstruida/desconocida
-- ============================================================================

-- ── 1. La ficha reconstruida ────────────────────────────────────────────────

alter table tc_neumaticos
  add column if not exists importacion_lote_id    uuid references tc_importacion_lotes(id) on delete restrict,
  add column if not exists origen_doc             text,
  add column if not exists origen_linea           text,
  add column if not exists grupo_origen           uuid,
  add column if not exists identidad_reconstruida boolean not null default false;

-- Recargar el mismo documento NO crea otra ficha ni consume otro número.
create unique index if not exists uq_neu_origen
  on tc_neumaticos (empresa_id, origen_linea) where origen_linea is not null;
create index if not exists idx_neu_imp_lote
  on tc_neumaticos (importacion_lote_id) where importacion_lote_id is not null;

comment on column tc_neumaticos.identidad_reconstruida is
  'La unidad existe porque un albarán histórico dice que se montó. El número interno la nombra; no prueba qué neumático físico era.';
comment on column tc_neumaticos.importacion_lote_id is
  'Vínculo con la importación. ES el criterio para separarla del inventario real: origen=''importacion_excel'' lo usan otras cargas.';

-- ── 2. Entrada y salida enlazadas ───────────────────────────────────────────

alter table operaciones_neumaticos
  add column if not exists grupo_sustitucion  uuid,
  add column if not exists identidad_retirado text
    check (identidad_retirado is null or identidad_retirado in ('respaldada','reconstruida','desconocida'));
create index if not exists idx_op_grupo_sust
  on operaciones_neumaticos (grupo_sustitucion) where grupo_sustitucion is not null;

comment on column operaciones_neumaticos.grupo_sustitucion is
  'Une la entrada y la salida de una misma sustitución. Explícito: nada de emparejar por ventanas de segundos.';
comment on column operaciones_neumaticos.identidad_retirado is
  'Solo en la fila de SALIDA. respaldada = consta quién salió; reconstruida = se deduce de la cadena; desconocida = no se sabe (neumatico_id nulo).';

-- ── 3. Alcance aplicado, para poder ampliar una carga antigua ───────────────

alter table tc_importacion_cargas add column if not exists alcance int not null default 1;
alter table tc_importacion_lotes  add column if not exists alcance int not null default 1;
alter table tc_importacion_intervenciones
  add column if not exists alcance        int not null default 1,
  add column if not exists neumatico_ids  uuid[] not null default '{}',
  add column if not exists salida_ids     uuid[] not null default '{}',
  add column if not exists ampliada_at    timestamptz;

comment on column tc_importacion_intervenciones.alcance is
  '1 = intervención, operaciones, servicios y líneas (fase 1). 2 = además fichas de las nuevas y salidas de sustitución (fase 2).';

-- Registro auditado de lo que se hace fuera de la importación inicial:
-- ampliaciones de alcance, identificaciones manuales y reaperturas.
create table if not exists tc_importacion_eventos (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references tc_empresas(id) on delete restrict,
  carga_id        uuid references tc_importacion_cargas(id) on delete set null,
  lote_id         uuid references tc_importacion_lotes(id) on delete set null,
  intervencion_id uuid,
  accion          text not null,
  detalle         jsonb,
  usuario_id      uuid default auth.uid(),
  creado_at       timestamptz not null default now()
);
create index if not exists idx_imp_eventos_carga on tc_importacion_eventos (carga_id, creado_at desc);

-- ── 4. Intervalos reconstruidos, en su propia tabla ─────────────────────────
--
-- NO es tc_historial_montajes y no debe volcarse en ella sin una decisión
-- explícita: aquí viven intervalos ESTIMADOS, y los informes de rendimiento
-- confirmado no los miran.
create table if not exists tc_reconstruccion_montajes (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id            uuid not null references tc_vehiculos(id) on delete cascade,
  posicion_id            uuid references tc_posiciones_vehiculo(id) on delete set null,
  neumatico_id           uuid references tc_neumaticos(id) on delete set null,
  -- Montaje
  fecha_montaje          date not null,
  km_montaje             numeric,
  km_montaje_conocido    boolean not null default false,
  lote_montaje_id        uuid references tc_importacion_lotes(id) on delete cascade,
  origen_doc_montaje     text,
  operacion_entrada_id   uuid references operaciones_neumaticos(id) on delete cascade,
  -- Desmontaje
  fecha_desmontaje       date,
  km_desmontaje          numeric,
  km_desmontaje_conocido boolean not null default false,
  -- Cómo están los kilómetros de este intervalo:
  --   'utilizables'   → hay valores en los dos extremos y permiten calcular
  --                     el recorrido (que puede ser 0).
  --   'ausentes'      → falta el kilometraje de uno o de los dos extremos.
  --   'incompatibles' → hay valores, pero no dan un recorrido válido
  --                     (kilometraje decreciente). Los valores NO se borran.
  --   'sin_cierre'    → el intervalo no está cerrado, así que no hay recorrido.
  km_estado              text not null default 'sin_cierre'
                         check (km_estado in ('utilizables','ausentes','incompatibles','sin_cierre')),
  recorrido_km           numeric,
  lote_desmontaje_id     uuid references tc_importacion_lotes(id) on delete set null,
  origen_doc_desmontaje  text,
  operacion_salida_id    uuid references operaciones_neumaticos(id) on delete set null,
  -- Certezas
  estado                 text not null default 'abierto'
                         check (estado in ('abierto','cerrado','interrumpido')),
  -- Qué es este intervalo:
  --   'unidad'    → hay una goma identificada (neumatico_id) y su recorrido
  --                 puede estimarse para ESA unidad.
  --   'ocupacion' → sabemos que esa POSICIÓN estuvo calzada entre dos fechas,
  --                 pero no qué goma la ocupaba. No es el recorrido de ningún
  --                 neumático: no se le pone ficha ficticia y la referencia de
  --                 la unidad histórica es su operación de entrada.
  clase                  text not null default 'ocupacion'
                         check (clase in ('unidad','ocupacion')),
  nivel                  text not null default 'estimado'
                         check (nivel in ('confirmado','estimado')),
  posicion_fuente        text,
  continuidad_desde      date,          -- fecha desde la que la continuidad es desconocida
  evidencia              text,
  revisar                boolean not null default false,
  motivo_revision        text,
  creado_at              timestamptz not null default now()
);
create index if not exists idx_recons_vehiculo on tc_reconstruccion_montajes (vehiculo_id, posicion_id, fecha_montaje);
create index if not exists idx_recons_lote on tc_reconstruccion_montajes (lote_montaje_id);
create index if not exists idx_recons_neumatico on tc_reconstruccion_montajes (neumatico_id) where neumatico_id is not null;

comment on table tc_reconstruccion_montajes is
  'Intervalos de montaje reconstruidos del histórico. SEPARADA de tc_historial_montajes a propósito: aquí hay intervalos estimados y no deben alimentar los informes de rendimiento confirmado.';
comment on column tc_reconstruccion_montajes.estado is
  'abierto = sin cierre registrado · cerrado = se sabe cuándo salió · interrumpido = un montaje sin posición rompió la continuidad y no se puede seguir atribuyendo recorrido.';
comment on column tc_reconstruccion_montajes.km_montaje_conocido is
  'Falso = kilómetros DESCONOCIDOS. Nunca se interpretan como cero.';

alter table tc_reconstruccion_montajes add column if not exists clase text not null default 'ocupacion';
alter table tc_reconstruccion_montajes add column if not exists km_estado text not null default 'sin_cierre';
alter table tc_reconstruccion_montajes add column if not exists recorrido_km numeric;
do $$ begin
  alter table tc_reconstruccion_montajes add constraint ck_recons_km_estado
    check (km_estado in ('utilizables','ausentes','incompatibles','sin_cierre'));
exception when duplicate_object then null; end $$;
comment on column tc_reconstruccion_montajes.km_estado is
  'utilizables / ausentes (falta un extremo) / incompatibles (hay valores pero el kilometraje decrece; se conservan) / sin_cierre. Un dato incompatible NUNCA se convierte en ausente.';
comment on column tc_reconstruccion_montajes.recorrido_km is
  'Solo cuando km_estado = utilizables. Puede ser 0: dos visitas el mismo día sin rodar es normal; con días de por medio, se marca para revisar.';
do $$ begin
  alter table tc_reconstruccion_montajes add constraint ck_recons_clase check (clase in ('unidad','ocupacion'));
exception when duplicate_object then null; end $$;
comment on column tc_reconstruccion_montajes.clase is
  'unidad = hay goma identificada y su recorrido puede estimarse. ocupacion = sabemos que la posición estuvo calzada, no qué goma: no es el rendimiento de ningún neumático.';

alter table tc_reconstruccion_montajes enable row level security;
alter table tc_importacion_eventos enable row level security;
drop policy if exists recons_sel on tc_reconstruccion_montajes;
create policy recons_sel on tc_reconstruccion_montajes for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists imp_eventos_sel on tc_importacion_eventos;
create policy imp_eventos_sel on tc_importacion_eventos for select using ( tc_puede_ver_empresa(empresa_id) );

-- ── 4bis. La huella del estado, con lo que la reconstrucción deriva fuera ──
--
-- La huella existe para detectar cambios HUMANOS posteriores. La fase 2
-- escribe en las filas de salida al rehacer la cadena de un vehículo
-- (neumatico_id e identidad_retirado son datos DERIVADOS, no del albarán), y
-- eso no puede hacer que una intervención parezca manipulada. Se excluyen
-- esos dos campos de las salidas y el updated_at de todas: lo demás
-- —posición, condición, estado, anulación, km, observaciones— sigue dentro.
create or replace function tc_imp_huella_estado(p_intervencion uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(jsonb_build_object(
    'i', (select to_jsonb(i) - 'resumen_ia' - 'updated_at' from tc_intervenciones i where i.id = p_intervencion),
    'o', (select coalesce(jsonb_agg(
             (to_jsonb(o) - 'updated_at')
             - (case when o.tipo_operacion = 'desmontaje' then array['neumatico_id','identidad_retirado']
                     else array[]::text[] end)
             order by o.origen_linea, o.id), '[]'::jsonb)
            from operaciones_neumaticos o where o.intervencion_id = p_intervencion),
    's', (select coalesce(jsonb_agg(to_jsonb(s) order by s.servicio, s.id), '[]'::jsonb)
            from tc_intervencion_servicios s where s.intervencion_id = p_intervencion),
    'l', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'g', l.grupo_origen, 'inc', l.incidencia, 'iv', l.intervencion_id)
                                    order by l.origen_linea), '[]'::jsonb)
            from tc_importacion_lineas l where l.intervencion_id = p_intervencion)
  )::text);
$$;

-- ── 5. La ficha de una unidad nueva ─────────────────────────────────────────
--
-- Idempotente por (empresa, origen_linea): recargar el documento devuelve la
-- misma ficha y NO consume otro número interno. El número sale del generador
-- de la casa, tc_generar_numero_interno(), que es una escritura: por eso la
-- simulación no llama nunca aquí.
create or replace function tc_imp_ficha_historica(
  p_empresa uuid, p_lote uuid, p_doc text, p_linea text, p_grupo uuid,
  p_marca text, p_modelo text, p_medida text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num text;
begin
  select id into v_id from tc_neumaticos where empresa_id = p_empresa and origen_linea = p_linea;
  if found then return v_id; end if;

  v_num := tc_generar_numero_interno();
  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno,
    marca, modelo, medida,
    -- Ni montada ni en stock: no está disponible para montar y no suma
    -- existencias. Y nunca descartada, que sería afirmar que se tiró.
    estado, activo, vehiculo_id, posicion_id,
    origen, creado_automaticamente, control_individual, identidad_reconstruida,
    importacion_lote_id, origen_doc, origen_linea, grupo_origen
  ) values (
    p_empresa, v_num, v_num,
    nullif(btrim(coalesce(p_marca,'')),''), nullif(btrim(coalesce(p_modelo,'')),''), nullif(btrim(coalesce(p_medida,'')),''),
    'pendiente_clasificacion', true, null, null,
    'importacion_excel', true, false, true,
    p_lote, p_doc, p_linea, p_grupo
  ) returning id into v_id;
  return v_id;
end $$;

-- ── 6. Ampliar una intervención ya importada al alcance 2 ───────────────────
--
-- Idempotente: crea solo lo que falta. Por cada unidad montada deja
--   · su ficha, si es nueva y no la tiene,
--   · su fila de SALIDA, con identidad desconocida de entrada (la cadena la
--     resuelve después tc_imp_reconstruir_vehiculo),
--   · las dos unidas por grupo_sustitucion.
create or replace function tc_imp_ampliar_intervencion(p_intervencion uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e record; v_grupo uuid; v_neu uuid; v_sal uuid;
  v_neus uuid[] := '{}'; v_sals uuid[] := '{}';
begin
  for e in
    select o.*, i.origen_doc as doc
      from operaciones_neumaticos o join tc_intervenciones i on i.id = o.intervencion_id
     where o.intervencion_id = p_intervencion and o.importacion_lote_id is not null
       and o.tipo_operacion = 'montaje' and coalesce(o.is_anulada, false) = false
     order by o.origen_linea
  loop
    -- Ficha, solo para las nuevas. Usadas y recauchutadas se quedan sin ficha
    -- hasta que alguien las identifique a mano (tc_imp_identificar_unidad).
    if e.condicion = 'nueva' and e.neumatico_id is null then
      v_neu := tc_imp_ficha_historica(e.empresa_id, e.importacion_lote_id, e.doc, e.origen_linea, e.grupo_origen,
                                      e.marca_txt, e.modelo_txt, e.medida_txt);
      update operaciones_neumaticos set neumatico_id = v_neu, updated_at = now() where id = e.id;
      v_neus := v_neus || v_neu;
    end if;

    -- Salida: el ocupante anterior de esa posición, por la regla de la casa.
    if e.grupo_sustitucion is null then
      v_grupo := gen_random_uuid();
      update operaciones_neumaticos set grupo_sustitucion = v_grupo, updated_at = now() where id = e.id;
      insert into operaciones_neumaticos (
        empresa_id, vehiculo_id, intervencion_id, tipo_operacion, status, source,
        fecha_operacion, km_vehiculo, posicion_origen_id, posicion_fuente,
        estado_anterior, destino, observaciones,
        importacion_lote_id, origen_sistema, origen_linea, grupo_origen,
        grupo_sustitucion, identidad_retirado
      ) values (
        e.empresa_id, e.vehiculo_id, p_intervencion, 'desmontaje', 'completada', 'import',
        e.fecha_operacion, e.km_vehiculo, e.posicion_destino_id, e.posicion_fuente,
        -- estado_anterior = montado: es lo que separa la salida de la entrada
        -- en todas las pantallas que ya existen.
        'montado', null,
        '[HISTÓRICO RECONSTRUIDO] salida por sustitución',
        e.importacion_lote_id, e.origen_sistema, e.origen_linea || '·salida', e.grupo_origen,
        v_grupo, 'desconocida'
      ) returning id into v_sal;
      v_sals := v_sals || v_sal;
    end if;
  end loop;
  return jsonb_build_object('neumaticos', v_neus, 'salidas', v_sals);
end $$;

-- ── 6bis. Desfase de mano de obra de ruedas ────────────────────────────────
--
-- Un albarán que cobra más «quitar y poner rueda» que gomas monta puede
-- esconder trabajo adicional (una permuta, una rueda retirada para llegar a
-- otra, un reapriete facturado aparte). NO lo demuestra, y desde luego no
-- dice cuántas ruedas se movieron ni cuáles: la mano de obra se cobra por
-- criterios de taller, no por movimientos de goma.
--
-- Por eso esto es un AVISO y nada más: no crea movimientos, no inventa
-- posiciones y NO interrumpe ningún intervalo. Lo que sí interrumpe la
-- continuidad es un montaje real sin posición, o un movimiento explícito
-- cuya ubicación no se pueda determinar.
create or replace function tc_imp_desfase_mano_obra(p_vehiculo uuid)
returns table(fecha date, origen_doc text)
language sql stable security definer set search_path = public as $$
  select i.fecha, i.origen_doc
    from tc_intervenciones i
   where i.vehiculo_id = p_vehiculo and i.importacion_lote_id is not null
     and coalesce((select sum(s.cantidad) from tc_intervencion_servicios s
                    where s.intervencion_id = i.id and s.servicio = 'quitar_poner_rueda'), 0)
         > (select count(*) from operaciones_neumaticos o
             where o.intervencion_id = i.id and o.tipo_operacion = 'montaje'
               and coalesce(o.is_anulada, false) = false);
$$;
revoke all on function tc_imp_desfase_mano_obra(uuid) from public, anon;
grant execute on function tc_imp_desfase_mano_obra(uuid) to authenticated, service_role;

-- ── 7. Reconstruir la cronología de un vehículo ─────────────────────────────
--
-- Recorre TODOS los montajes históricos del vehículo por fecha y posición y
-- va abriendo y cerrando ocupaciones. Idempotente: borra lo suyo y lo rehace.
--
-- Reglas, en orden de importancia:
--   · El desmontaje es un HECHO (lo dice la regla de la casa). Lo que puede
--     faltar es la identidad de quien salió, y eso no lo inventa nadie.
--   · Un montaje SIN POSICIÓN no abre ocupación —no sabemos dónde fue— y
--     rompe la continuidad de lo que estuviera abierto: a partir de esa fecha
--     no se atribuye recorrido.
--   · DESFASE DE MANO DE OBRA: si un albarán cobra más «quitar y poner
--     rueda» que gomas monta, puede haber trabajo adicional. Es un AVISO
--     para revisar, no un movimiento: no interrumpe nada ni cuenta ruedas.
--   · Kilómetros ausentes o no crecientes → DESCONOCIDOS, nunca cero.
--   · El último intervalo de cada posición queda ABIERTO. No se cierra contra
--     tc_montajes_actuales.
create or replace function tc_imp_reconstruir_vehiculo(p_vehiculo uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  e record; o record; ev record;
  v_n int := 0; v_rota boolean; v_desde date;
  v_km numeric; v_km_ok boolean; v_revisar boolean; v_motivo text;
  v_km_estado text; v_recorrido numeric;
  v_ident text; v_nivel text; v_mismo_dia boolean;
begin
  delete from tc_reconstruccion_montajes where vehiculo_id = p_vehiculo;
  -- Las salidas vuelven a «no se sabe quién salió» antes de recalcular.
  update operaciones_neumaticos
     set neumatico_id = null, identidad_retirado = 'desconocida', updated_at = now()
   where vehiculo_id = p_vehiculo and importacion_lote_id is not null
     and tipo_operacion = 'desmontaje' and grupo_sustitucion is not null;

  for e in
    select o2.id, o2.empresa_id, o2.vehiculo_id, o2.fecha_operacion, o2.km_vehiculo,
           o2.posicion_destino_id as pos, o2.posicion_fuente, o2.neumatico_id,
           o2.importacion_lote_id, o2.grupo_sustitucion, i.origen_doc as doc
      from operaciones_neumaticos o2 join tc_intervenciones i on i.id = o2.intervencion_id
     where o2.vehiculo_id = p_vehiculo and o2.importacion_lote_id is not null
       and o2.tipo_operacion = 'montaje' and coalesce(o2.is_anulada, false) = false
     -- Dentro del mismo día y documento, primero lo que SÍ tiene posición:
     -- así un usado sin posición del mismo albarán no rompe la cadena del eje
     -- que acaban de calzar las nuevas de ese mismo albarán.
     order by o2.fecha_operacion, i.origen_doc, (o2.posicion_destino_id is null), o2.origen_linea
  loop
    if e.pos is null then
      -- Deja de ser un intervalo «abierto» (seguimos sabiendo dónde está la
      -- goma) y pasa a «interrumpido» (ya no lo sabemos). A partir de aquí no
      -- se le atribuye recorrido ni se le adjudica una salida.
      update tc_reconstruccion_montajes
         set estado = 'interrumpido',
             continuidad_desde = coalesce(continuidad_desde, e.fecha_operacion),
             revisar = true,
             motivo_revision = coalesce(motivo_revision || ' · ', '')
               || 'Continuidad desconocida desde ' || to_char(e.fecha_operacion, 'DD/MM/YYYY')
               || ': ese día se montó una goma sin posición en este vehículo'
       where vehiculo_id = p_vehiculo and estado = 'abierto'
         and fecha_montaje < e.fecha_operacion and continuidad_desde is null;
      continue;
    end if;

    select * into o from tc_reconstruccion_montajes
      where vehiculo_id = p_vehiculo and posicion_id = e.pos and estado = 'abierto'
        and fecha_montaje <= e.fecha_operacion
      order by fecha_montaje desc, creado_at desc limit 1;

    if found then
      v_rota := o.continuidad_desde is not null
        or exists (
          select 1 from operaciones_neumaticos x join tc_intervenciones xi on xi.id = x.intervencion_id
           where x.vehiculo_id = p_vehiculo and x.importacion_lote_id is not null
             and x.tipo_operacion = 'montaje' and coalesce(x.is_anulada, false) = false
             and x.posicion_destino_id is null
             and x.fecha_operacion > o.fecha_montaje and x.fecha_operacion <= e.fecha_operacion
             and xi.origen_doc <> e.doc)
        ;   -- el desfase de mano de obra NO rompe la cadena: es solo un aviso
      v_desde := coalesce(o.continuidad_desde, (
        select min(x.fecha_operacion) from operaciones_neumaticos x join tc_intervenciones xi on xi.id = x.intervencion_id
          where x.vehiculo_id = p_vehiculo and x.importacion_lote_id is not null
            and x.tipo_operacion = 'montaje' and coalesce(x.is_anulada, false) = false
            and x.posicion_destino_id is null
            and x.fecha_operacion > o.fecha_montaje and x.fecha_operacion <= e.fecha_operacion
            and xi.origen_doc <> e.doc));

      -- Quién salió: respaldada solo si su ficha la identificó una persona.
      v_ident := case
        when o.neumatico_id is null then 'desconocida'
        when coalesce((select identidad_reconstruida from tc_neumaticos where id = o.neumatico_id), true) then 'reconstruida'
        else 'respaldada' end;

      -- Dos albaranes del mismo vehículo el mismo día: orden desconocido.
      v_mismo_dia := exists (
        select 1 from tc_intervenciones i2
         where i2.vehiculo_id = p_vehiculo and i2.importacion_lote_id is not null
           and i2.fecha = e.fecha_operacion and i2.origen_doc <> e.doc);

      if v_rota then
        -- No se puede afirmar que saliera ESA goma: el intervalo queda
        -- interrumpido, sin fecha de salida y sin recorrido.
        update tc_reconstruccion_montajes set
          estado = 'interrumpido', continuidad_desde = v_desde,
          km_estado = 'sin_cierre', recorrido_km = null,
          revisar = true,
          motivo_revision = coalesce(motivo_revision || ' · ', '')
            || 'Interrumpido: entre el montaje y el ' || to_char(e.fecha_operacion, 'DD/MM/YYYY')
            || ' hubo un montaje sin posición en el vehículo',
          evidencia = 'Esta posición se volvió a calzar el ' || to_char(e.fecha_operacion, 'DD/MM/YYYY')
            || ' (albarán ' || coalesce(e.doc, '—') || '), pero la continuidad no está respaldada'
        where id = o.id;
        v_ident := 'desconocida';
      else
        -- Los kilómetros del cierre se CONSERVAN siempre; lo que cambia es
        -- si sirven para calcular recorrido.
        v_km := e.km_vehiculo; v_km_ok := e.km_vehiculo is not null;
        if e.km_vehiculo is null or o.km_montaje is null then
          v_km_estado := 'ausentes'; v_recorrido := null; v_revisar := false;
          v_motivo := 'Kilómetros ausentes en ' ||
            case when e.km_vehiculo is null and o.km_montaje is null then 'los dos extremos'
                 when o.km_montaje is null then 'el montaje' else 'el desmontaje' end;
        elsif e.km_vehiculo < o.km_montaje then
          -- Decreciente: el dato existe y no se pierde, pero no da recorrido.
          v_km_estado := 'incompatibles'; v_recorrido := null; v_revisar := true;
          v_motivo := 'Kilometraje decreciente: ' || o.km_montaje || ' en el montaje y ' || e.km_vehiculo || ' en el desmontaje';
        else
          v_km_estado := 'utilizables'; v_recorrido := e.km_vehiculo - o.km_montaje;
          -- Diferencia cero: normal si las dos visitas son el mismo día; con
          -- días de por medio, un vehículo que no rueda nada merece un vistazo.
          if v_recorrido = 0 and e.fecha_operacion > o.fecha_montaje then
            v_revisar := true;
            v_motivo := 'Mismo kilometraje (' || e.km_vehiculo || ') tras '
              || (e.fecha_operacion - o.fecha_montaje) || ' día(s): recorrido cero, conviene comprobarlo';
          else
            v_revisar := false; v_motivo := null;
          end if;
        end if;
        v_nivel := case when v_ident = 'respaldada' then 'confirmado' else 'estimado' end;
        update tc_reconstruccion_montajes set
          estado = 'cerrado', nivel = v_nivel,
          fecha_desmontaje = e.fecha_operacion,
          km_desmontaje = v_km, km_desmontaje_conocido = v_km_ok,
          km_estado = v_km_estado, recorrido_km = v_recorrido,
          lote_desmontaje_id = e.importacion_lote_id, origen_doc_desmontaje = e.doc,
          operacion_salida_id = (select s.id from operaciones_neumaticos s
                                  where s.grupo_sustitucion = e.grupo_sustitucion and s.tipo_operacion = 'desmontaje' limit 1),
          revisar = o.revisar or v_revisar or v_mismo_dia,
          motivo_revision = nullif(concat_ws(' · ', nullif(o.motivo_revision,''), v_motivo,
            case when v_mismo_dia then 'Dos albaranes del mismo vehículo ese día: orden desconocido' end), ''),
          evidencia = 'Cierre por el montaje del ' || to_char(e.fecha_operacion, 'DD/MM/YYYY')
            || ' en la misma posición (albarán ' || coalesce(e.doc, '—') || ')'
        where id = o.id;
      end if;

      update operaciones_neumaticos set
        neumatico_id = case when v_ident in ('reconstruida','respaldada') then o.neumatico_id end,
        identidad_retirado = v_ident, updated_at = now()
       where grupo_sustitucion = e.grupo_sustitucion and tipo_operacion = 'desmontaje';
    end if;

    insert into tc_reconstruccion_montajes (
      empresa_id, vehiculo_id, posicion_id, neumatico_id,
      fecha_montaje, km_montaje, km_montaje_conocido,
      lote_montaje_id, origen_doc_montaje, operacion_entrada_id,
      estado, nivel, clase, posicion_fuente, revisar, motivo_revision)
    values (
      e.empresa_id, p_vehiculo, e.pos, e.neumatico_id,
      e.fecha_operacion, e.km_vehiculo, e.km_vehiculo is not null,
      e.importacion_lote_id, e.doc, e.id,
      -- Sin ficha no es el intervalo de una goma: es la ocupación de una
      -- posición. La referencia de la unidad es operacion_entrada_id.
      'abierto', 'estimado', case when e.neumatico_id is null then 'ocupacion' else 'unidad' end,
      e.posicion_fuente,
      e.neumatico_id is null,
      case when e.neumatico_id is null then 'Ocupación de la posición sin goma identificada: usada o recauchutada pendiente de identificar' end);
    v_n := v_n + 1;
  end loop;

  -- Desfase de mano de obra: un aviso, no un movimiento. No cambia el estado
  -- de ningún intervalo ni afirma cuántas ruedas se tocaron.
  for ev in select * from tc_imp_desfase_mano_obra(p_vehiculo) order by fecha loop
    update tc_reconstruccion_montajes
       set revisar = true,
           motivo_revision = coalesce(motivo_revision || ' · ', '')
             || 'Posible trabajo adicional de ruedas el ' || to_char(ev.fecha, 'DD/MM/YYYY')
             || ' (albarán ' || coalesce(ev.origen_doc, '—')
             || '): el albarán cobra más mano de obra de ruedas que gomas monta, sin decir posiciones ni movimiento'
     where vehiculo_id = p_vehiculo
       and (fecha_montaje = ev.fecha            -- lo que se montó ese día
            or fecha_desmontaje = ev.fecha      -- y lo que se retiró ese día
            or (estado = 'abierto' and fecha_montaje < ev.fecha));
  end loop;
  return v_n;
end $$;


-- ── 8. Importar: la misma firma de siempre, ahora con fichas y salidas ──────
--
-- MISMA FIRMA que en la fase 1, a propósito: añadir un parámetro crearía una
-- segunda función y PostgREST rechazaría todas las llamadas actuales con
-- PGRST203 («could not choose the best candidate function»). El alcance
-- aplicado se guarda en la columna `alcance`, no en la firma.
--
-- La simulación sigue sin escribir NADA: no crea fichas y no llama al
-- generador de números internos.
create or replace function tc_importar_historico(
  p_empresa uuid, p_origen_sistema text, p_lote jsonb, p_simular boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_origen     text := nullif(btrim(p_origen_sistema), '');
  v_carga      uuid;
  v_lote       uuid;
  v_periodo    text := p_lote->>'periodo';
  v_forzar     text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_lote->'forzar_docs','[]'::jsonb)) x), '{}');
  alb          jsonb;
  r            jsonb;
  v_resultados jsonb := '[]'::jsonb;
  v_n_creadas  int := 0; v_n_presentes int := 0; v_n_cambiados int := 0;
  v_n_bloq     int := 0; v_n_dup int := 0;
  -- por albarán
  v_doc        text; v_mat text; v_veh uuid; v_fecha date; v_huella text;
  v_existente  record;
  v_motivo     text;
  v_interv     uuid;
  v_op_ids     uuid[]; v_srv_ids uuid[]; v_lin_ids uuid[];
  v_amp        jsonb;  v_vehs uuid[] := '{}';   -- fase 2: fichas, salidas y vehículos a reconstruir
  v_nuevas     int; v_refs int; v_pos uuid[]; v_pos_i int;
  op           jsonb; sv jsonb; ln jsonb;
  v_id         uuid;
  v_dup        record;
begin
  perform tc_imp_exigir_admin(p_empresa);
  if v_origen is null then raise exception 'Falta el sistema de origen' using errcode = '22023'; end if;
  if v_periodo is null or v_periodo !~ '^\d{4}-\d{2}$' then
    raise exception 'Falta el periodo del lote (YYYY-MM)' using errcode = '22023';
  end if;
  perform tc_imp_bloquear(p_empresa, v_origen);

  if not p_simular then
    v_carga := (p_lote->>'carga_id')::uuid;
    if v_carga is null then
      insert into tc_importacion_cargas (empresa_id, origen_sistema, fichero, sha256_fichero)
      values (p_empresa, v_origen, p_lote->>'fichero', p_lote->>'sha256_fichero')
      returning id into v_carga;
    else
      perform 1 from tc_importacion_cargas where id = v_carga and empresa_id = p_empresa and origen_sistema = v_origen for update;
      if not found then raise exception 'La carga no existe o no es de esta empresa' using errcode = '22023'; end if;
    end if;
    insert into tc_importacion_lotes (carga_id, empresa_id, periodo) values (v_carga, p_empresa, v_periodo)
    returning id into v_lote;
  end if;

  for alb in select * from jsonb_array_elements(coalesce(p_lote->'albaranes', '[]'::jsonb)) loop
    v_doc := alb->>'origen_doc'; v_mat := upper(regexp_replace(coalesce(alb->>'matricula',''), '\s+', '', 'g'));
    v_fecha := (alb->>'fecha')::date; v_huella := alb->>'huella_origen';
    v_motivo := null; v_interv := null; v_op_ids := '{}'; v_srv_ids := '{}'; v_lin_ids := '{}';

    if v_doc is null or v_huella is null or v_fecha is null then
      v_motivo := 'Albarán sin identidad, fecha o huella';
    elsif nullif(alb->>'bloqueante','') is not null then
      v_motivo := alb->>'bloqueante';
    end if;

    -- ¿Ya está? Misma identidad: misma huella = presente; distinta = cambiado.
    select i.id, ii.huella_origen into v_existente
      from tc_intervenciones i left join tc_importacion_intervenciones ii on ii.intervencion_id = i.id
     where i.empresa_id = p_empresa and i.origen_sistema = v_origen and i.origen_doc = v_doc;
    if found then
      if v_existente.huella_origen = v_huella then
        v_n_presentes := v_n_presentes + 1;
        v_resultados := v_resultados || jsonb_build_object('origen_doc', v_doc, 'estado', 'ya_presente', 'intervencion_id', v_existente.id);
      else
        v_n_cambiados := v_n_cambiados + 1;
        v_resultados := v_resultados || jsonb_build_object('origen_doc', v_doc, 'estado', 'cambiado', 'intervencion_id', v_existente.id,
          'motivo', 'El albarán ya se importó con otro contenido. No se sobrescribe: deshaz esa intervención y vuelve a cargar, o ignóralo.');
      end if;
      continue;
    end if;

    -- El vehículo se resuelve AQUÍ, por matrícula dentro de la empresa. No se
    -- acepta un id del navegador.
    if v_motivo is null then
      select id into v_veh from tc_vehiculos
       where empresa_id = p_empresa and upper(regexp_replace(matricula, '\s+', '', 'g')) = v_mat;
      if v_veh is null then
        v_motivo := 'Vehículo no encontrado en la empresa: ' || coalesce(v_mat, '(sin matrícula)');
      elsif (select count(*) from tc_vehiculos where empresa_id = p_empresa and upper(regexp_replace(matricula, '\s+', '', 'g')) = v_mat) > 1 then
        v_motivo := 'Matrícula ambigua en la empresa: ' || v_mat;
      end if;
    end if;

    -- Servicios del catálogo, y cantidades > 0.
    if v_motivo is null then
      for sv in select * from jsonb_array_elements(coalesce(alb->'servicios','[]'::jsonb)) loop
        if not exists (select 1 from tc_cat_servicios where codigo = sv->>'servicio') then
          v_motivo := 'Servicio desconocido: ' || coalesce(sv->>'servicio','?'); exit;
        end if;
        if coalesce((sv->>'cantidad')::numeric, 0) <= 0 then v_motivo := 'Servicio con cantidad no positiva'; exit; end if;
      end loop;
    end if;
    if v_motivo is null then
      for op in select * from jsonb_array_elements(coalesce(alb->'operaciones','[]'::jsonb)) loop
        if op->>'condicion' not in ('nueva','usada','recauchutada') or nullif(op->>'origen_linea','') is null then
          v_motivo := 'Operación sin condición o sin referencia de origen'; exit;
        end if;
      end loop;
    end if;

    -- Duplicado probable: misma fecha, mismas operaciones (condición+medida,
    -- en cantidad) y mismos servicios en una intervención que no es de esta
    -- importación. No se importa salvo que venga en forzar_docs.
    if v_motivo is null and not (v_doc = any(v_forzar)) then
      for v_dup in
        select i.id from tc_intervenciones i
         where i.empresa_id = p_empresa and i.vehiculo_id = v_veh and i.fecha = v_fecha
           and i.origen_doc is null
      loop
        if (select coalesce(jsonb_agg(jsonb_build_object('c', x.c, 'm', x.m, 'n', x.n) order by x.c, x.m), '[]'::jsonb)
              from (select coalesce(o.condicion, case when o.observaciones like '%[USADO]%' then 'usada' else 'nueva' end) c,
                           coalesce(o.medida_txt, n.medida) m, count(*) n
                      from operaciones_neumaticos o left join tc_neumaticos n on n.id = o.neumatico_id
                     where o.intervencion_id = v_dup.id and o.tipo_operacion = 'montaje' and not o.is_anulada
                     group by 1, 2) x)
           = (select coalesce(jsonb_agg(jsonb_build_object('c', y.c, 'm', y.m, 'n', y.n) order by y.c, y.m), '[]'::jsonb)
                from (select o.value->>'condicion' c, o.value->>'medida' m, count(*) n
                        from jsonb_array_elements(coalesce(alb->'operaciones','[]'::jsonb)) o(value) group by 1, 2) y)
          and (select coalesce(jsonb_agg(jsonb_build_object('s', s.servicio, 'q', s.cantidad) order by s.servicio), '[]'::jsonb)
                 from tc_intervencion_servicios s where s.intervencion_id = v_dup.id)
            = (select coalesce(jsonb_agg(jsonb_build_object('s', s.value->>'servicio', 'q', (s.value->>'cantidad')::numeric) order by s.value->>'servicio'), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(alb->'servicios','[]'::jsonb)) s)
        then
          v_n_dup := v_n_dup + 1;
          v_resultados := v_resultados || jsonb_build_object('origen_doc', v_doc, 'estado', 'duplicado_probable',
            'intervencion_id', v_dup.id,
            'motivo', 'Ya hay una intervención de este vehículo ese día con las mismas operaciones y servicios. No se importa salvo que lo confirmes.');
          v_motivo := '__dup__'; exit;
        end if;
      end loop;
      if v_motivo = '__dup__' then continue; end if;
    end if;

    if v_motivo is not null then
      v_n_bloq := v_n_bloq + 1;
      v_resultados := v_resultados || jsonb_build_object('origen_doc', v_doc, 'estado', 'bloqueado', 'motivo', v_motivo);
      continue;
    end if;

    -- La norma de posiciones: total de NUEVAS del albarán y si son una sola
    -- referencia. Se calcula aquí, no se acepta del navegador.
    select count(*), count(distinct (coalesce(o.value->>'marca',''), coalesce(o.value->>'modelo',''), coalesce(o.value->>'medida','')))
      into v_nuevas, v_refs
      from jsonb_array_elements(coalesce(alb->'operaciones','[]'::jsonb)) o where o.value->>'condicion' = 'nueva';
    v_pos := tc_imp_posiciones_norma(v_veh, v_nuevas, v_refs = 1);

    if p_simular then
      v_n_creadas := v_n_creadas + 1;
      v_resultados := v_resultados || jsonb_build_object('origen_doc', v_doc, 'estado', 'se_crearia',
        'operaciones', jsonb_array_length(coalesce(alb->'operaciones','[]'::jsonb)),
        'servicios', jsonb_array_length(coalesce(alb->'servicios','[]'::jsonb)),
        'lineas', jsonb_array_length(coalesce(alb->'lineas','[]'::jsonb)),
        'posiciones_deducidas', coalesce(array_length(v_pos, 1), 0));
      continue;
    end if;

    -- ── Escribir ────────────────────────────────────────────────────────────
    insert into tc_intervenciones (empresa_id, vehiculo_id, fecha, cerrada_at, hora_desconocida, numero,
                                   resumen, observaciones, n_operaciones, mecanico_km,
                                   importacion_lote_id, origen_sistema, origen_doc)
    values (p_empresa, v_veh, v_fecha, tc_imp_medianoche(v_fecha), true,
            -- Número legible y único sin consumir el contador del taller.
            left(coalesce(alb->>'documento', v_doc), 40) || ' · ' || v_mat,
            alb->>'resumen', alb->>'observaciones',
            jsonb_array_length(coalesce(alb->'operaciones','[]'::jsonb)),
            nullif(alb->>'km','')::numeric,
            v_lote, v_origen, v_doc)
    returning id into v_interv;

    v_pos_i := 0;
    for op in select o.value from jsonb_array_elements(coalesce(alb->'operaciones','[]'::jsonb)) o order by o.value->>'origen_linea' loop
      v_id := null;
      if op->>'condicion' = 'nueva' and v_pos is not null then
        v_pos_i := v_pos_i + 1; v_id := v_pos[v_pos_i];
      end if;
      insert into operaciones_neumaticos (empresa_id, vehiculo_id, intervencion_id, tipo_operacion, status, source,
        fecha_operacion, km_vehiculo, posicion_destino_id, posicion_fuente, condicion, marca_txt, modelo_txt, medida_txt,
        observaciones, importacion_lote_id, origen_sistema, origen_linea, grupo_origen)
      values (p_empresa, v_veh, v_interv, 'montaje', 'completada', 'import',
        v_fecha, nullif(alb->>'km','')::numeric, v_id,
        case when v_id is not null then 'deducida' else 'desconocida' end,
        op->>'condicion', nullif(op->>'marca',''), nullif(op->>'modelo',''), nullif(op->>'medida',''),
        op->>'observaciones', v_lote, v_origen, op->>'origen_linea', nullif(op->>'grupo','')::uuid)
      returning id into v_id;
      v_op_ids := v_op_ids || v_id;
    end loop;

    for sv in select * from jsonb_array_elements(coalesce(alb->'servicios','[]'::jsonb)) loop
      insert into tc_intervencion_servicios (intervencion_id, servicio, cantidad, observaciones, importacion_lote_id, grupo_origen)
      values (v_interv, sv->>'servicio', (sv->>'cantidad')::numeric, sv->>'observaciones', v_lote, nullif(sv->>'grupo','')::uuid)
      returning id into v_id;
      v_srv_ids := v_srv_ids || v_id;
    end loop;

    for ln in select * from jsonb_array_elements(coalesce(alb->'lineas','[]'::jsonb)) loop
      insert into tc_importacion_lineas (lote_id, empresa_id, intervencion_id, origen_sistema, origen_doc, origen_linea, hoja,
        documento, matricula, fecha, hora_origen, km_origen, codigo, descripcion, familia, categoria, marca, uds,
        precio_unidad, pct_dto, importe_linea, pct_iva, estado_documento, articulo, carcasa_mov, almacen, usuario_origen,
        tipo_mov, papel, grupo_origen, incidencia)
      values (v_lote, p_empresa, v_interv, v_origen, v_doc, ln->>'origen_linea', ln->>'hoja',
        ln->>'documento', ln->>'matricula', nullif(ln->>'fecha','')::date, nullif(ln->>'hora_origen','')::timestamptz,
        nullif(ln->>'km','')::numeric, ln->>'codigo', ln->>'descripcion', ln->>'familia', ln->>'categoria', ln->>'marca',
        nullif(ln->>'uds','')::numeric, nullif(ln->>'precio_unidad','')::numeric, nullif(ln->>'pct_dto','')::numeric,
        nullif(ln->>'importe_linea','')::numeric, nullif(ln->>'pct_iva','')::numeric, ln->>'estado_documento',
        ln->>'articulo', ln->>'carcasa_mov', ln->>'almacen', ln->>'usuario_origen', nullif(ln->>'tipo_mov',''),
        coalesce(ln->>'papel','ignorada'), nullif(ln->>'grupo','')::uuid, ln->>'incidencia')
      returning id into v_id;
      v_lin_ids := v_lin_ids || v_id;
    end loop;

    -- FASE 2: ficha de cada unidad nueva y salida por sustitución. Se hace
    -- ANTES de la fotografía para que la huella incluya lo que de verdad
    -- quedó grabado.
    v_amp := tc_imp_ampliar_intervencion(v_interv);
    if not (v_veh = any(v_vehs)) then v_vehs := v_vehs || v_veh; end if;

    -- La fotografía, releída de lo grabado.
    insert into tc_importacion_intervenciones (intervencion_id, lote_id, empresa_id, origen_doc, huella_origen, huella_estado,
                                               operacion_ids, servicio_ids, linea_ids,
                                               alcance, neumatico_ids, salida_ids)
    values (v_interv, v_lote, p_empresa, v_doc, v_huella, tc_imp_huella_estado(v_interv), v_op_ids, v_srv_ids, v_lin_ids,
            2,
            coalesce((select array_agg((x)::uuid) from jsonb_array_elements_text(v_amp->'neumaticos') x), '{}'),
            coalesce((select array_agg((x)::uuid) from jsonb_array_elements_text(v_amp->'salidas') x), '{}'));

    v_n_creadas := v_n_creadas + 1;
    v_resultados := v_resultados || jsonb_build_object('origen_doc', v_doc, 'estado', 'creada', 'intervencion_id', v_interv,
      'operaciones', array_length(v_op_ids, 1), 'servicios', coalesce(array_length(v_srv_ids, 1), 0),
      'lineas', coalesce(array_length(v_lin_ids, 1), 0), 'posiciones_deducidas', coalesce(array_length(v_pos, 1), 0),
      'fichas', jsonb_array_length(coalesce(v_amp->'neumaticos','[]'::jsonb)),
      'salidas', jsonb_array_length(coalesce(v_amp->'salidas','[]'::jsonb)));
  end loop;

  r := jsonb_build_object('simulacion', p_simular, 'carga_id', v_carga, 'lote_id', v_lote, 'periodo', v_periodo,
    'creadas', v_n_creadas, 'ya_presentes', v_n_presentes, 'cambiados', v_n_cambiados,
    'bloqueados', v_n_bloq, 'duplicados_probables', v_n_dup, 'albaranes', v_resultados);

  if not p_simular then
    if v_n_creadas = 0 then
      -- Una recarga sin nada nuevo no deja rastro: ni lote vacío ni carga
      -- vacía (si la carga se abrió en esta misma llamada).
      delete from tc_importacion_lotes where id = v_lote;
      if (p_lote->>'carga_id') is null then delete from tc_importacion_cargas where id = v_carga; v_carga := null; end if;
      v_lote := null;
      r := r || jsonb_build_object('carga_id', v_carga, 'lote_id', v_lote);
    else
      -- Cronología del vehículo: abre y cierra ocupaciones con TODOS sus
      -- montajes históricos, no solo los de este lote.
      for v_id in select unnest(v_vehs) loop perform tc_imp_reconstruir_vehiculo(v_id); end loop;
      update tc_importacion_lotes set resumen = r - 'albaranes', alcance = 2 where id = v_lote;
      -- Los albaranes bloqueados o cambiados no son un error de la carga: se
      -- enseñan en la vista previa y se deciden a mano. La carga está completa
      -- en cuanto sus lotes se han aplicado.
      update tc_importacion_cargas set actualizado_at = now(), estado = 'completa',
             alcance = greatest(alcance, 2) where id = v_carga;
    end if;
  end if;
  return r;
end $$;

-- ── 9. Ampliar una carga antigua (alcance 1 → 2) ────────────────────────────
--
-- Para las cargas que se importaron antes de esta fase: añade SOLO lo que
-- falta —fichas y salidas— sin duplicar entradas, servicios, líneas ni
-- intervenciones. Antes de tocar nada comprueba que la intervención no se ha
-- modificado por fuera: si la huella no cuadra, se deja como está y se dice
-- por qué. La huella solo se recalcula cuando la anterior era correcta, para
-- no tapar cambios humanos.
create or replace function tc_imp_ampliar_carga(p_carga uuid, p_simular boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; f record; v_amp jsonb; v_vehs uuid[] := '{}'; v_veh uuid; v_id uuid;
  v_ampliadas int := 0; v_saltadas int := 0; v_fichas int := 0; v_salidas int := 0;
  v_detalle jsonb := '[]'::jsonb; v_motivo text; v_huella text;
begin
  select * into c from tc_importacion_cargas where id = p_carga;
  if not found then raise exception 'La carga no existe' using errcode = '22023'; end if;
  perform tc_imp_exigir_admin(c.empresa_id);
  perform tc_imp_bloquear(c.empresa_id, c.origen_sistema);

  for f in
    select fi.* from tc_importacion_intervenciones fi
      join tc_importacion_lotes l on l.id = fi.lote_id
     where l.carga_id = p_carga and fi.conservada_at is null
     order by fi.origen_doc
     for update of fi
  loop
    v_motivo := null;
    if f.alcance >= 2 then
      v_motivo := 'Ya ampliada';
    elsif not exists (select 1 from tc_intervenciones where id = f.intervencion_id) then
      v_motivo := 'La intervención ya no existe';
    else
      v_huella := tc_imp_huella_estado(f.intervencion_id);
      if v_huella <> f.huella_estado then
        v_motivo := 'Modificada después de importarla: la huella del estado no coincide';
      end if;
    end if;

    if v_motivo is not null then
      v_saltadas := v_saltadas + 1;
      v_detalle := v_detalle || jsonb_build_object('origen_doc', f.origen_doc, 'resultado', 'sin_ampliar', 'motivo', v_motivo);
      continue;
    end if;

    if p_simular then
      v_ampliadas := v_ampliadas + 1;
      v_fichas := v_fichas + (select count(*) from operaciones_neumaticos o
                               where o.intervencion_id = f.intervencion_id and o.importacion_lote_id is not null
                                 and o.tipo_operacion = 'montaje' and o.condicion = 'nueva' and o.neumatico_id is null
                                 and coalesce(o.is_anulada,false) = false);
      v_salidas := v_salidas + (select count(*) from operaciones_neumaticos o
                                 where o.intervencion_id = f.intervencion_id and o.importacion_lote_id is not null
                                   and o.tipo_operacion = 'montaje' and o.grupo_sustitucion is null
                                   and coalesce(o.is_anulada,false) = false);
      v_detalle := v_detalle || jsonb_build_object('origen_doc', f.origen_doc, 'resultado', 'se_ampliaria');
      continue;
    end if;

    v_amp := tc_imp_ampliar_intervencion(f.intervencion_id);
    v_fichas  := v_fichas  + jsonb_array_length(coalesce(v_amp->'neumaticos','[]'::jsonb));
    v_salidas := v_salidas + jsonb_array_length(coalesce(v_amp->'salidas','[]'::jsonb));
    update tc_importacion_intervenciones set
      alcance = 2, ampliada_at = now(),
      neumatico_ids = neumatico_ids || coalesce((select array_agg((x)::uuid) from jsonb_array_elements_text(v_amp->'neumaticos') x), '{}'),
      salida_ids    = salida_ids    || coalesce((select array_agg((x)::uuid) from jsonb_array_elements_text(v_amp->'salidas') x), '{}'),
      -- Solo ahora, y porque la anterior cuadraba, se refresca la huella.
      huella_estado = tc_imp_huella_estado(f.intervencion_id)
     where intervencion_id = f.intervencion_id;

    select vehiculo_id into v_veh from tc_intervenciones where id = f.intervencion_id;
    if v_veh is not null and not (v_veh = any(v_vehs)) then v_vehs := v_vehs || v_veh; end if;

    insert into tc_importacion_eventos (empresa_id, carga_id, lote_id, intervencion_id, accion, detalle)
    values (c.empresa_id, p_carga, f.lote_id, f.intervencion_id, 'ampliar_alcance',
            jsonb_build_object('fichas', v_amp->'neumaticos', 'salidas', v_amp->'salidas'));
    v_ampliadas := v_ampliadas + 1;
    v_detalle := v_detalle || jsonb_build_object('origen_doc', f.origen_doc, 'resultado', 'ampliada');
  end loop;

  if not p_simular then
    for v_id in select unnest(v_vehs) loop perform tc_imp_reconstruir_vehiculo(v_id); end loop;
    update tc_importacion_lotes set alcance = 2
      where carga_id = p_carga and not exists (
        select 1 from tc_importacion_intervenciones fi where fi.lote_id = tc_importacion_lotes.id and fi.alcance < 2);
    update tc_importacion_cargas set alcance = case when exists (
        select 1 from tc_importacion_lotes l where l.carga_id = p_carga and l.alcance < 2) then 1 else 2 end,
      actualizado_at = now() where id = p_carga;
  end if;

  return jsonb_build_object('simulacion', p_simular, 'carga_id', p_carga, 'ampliadas', v_ampliadas,
    'sin_ampliar', v_saltadas, 'fichas', v_fichas, 'salidas', v_salidas, 'detalle', v_detalle);
end $$;

-- ── 10. Bandeja: identificar una usada o recauchutada ───────────────────────
--
-- Acción MANUAL y auditada. O se enlaza una ficha que ya existe, o se crea
-- una sola vez. Nunca por parecido de marca, medida o cercanía en el tiempo:
-- eso son pistas para la persona, no una decisión del sistema.
create or replace function tc_imp_identificar_unidad(
  p_operacion uuid, p_neumatico uuid default null, p_crear boolean default false, p_motivo text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; i record; v_neu uuid;
begin
  select * into o from operaciones_neumaticos where id = p_operacion for update;
  if not found then raise exception 'La operación no existe' using errcode = '22023'; end if;
  perform tc_imp_exigir_admin(o.empresa_id);
  if o.importacion_lote_id is null then raise exception 'Esta operación no es del histórico importado' using errcode = '22023'; end if;
  if o.tipo_operacion <> 'montaje' then raise exception 'Solo se identifica la unidad que entra' using errcode = '22023'; end if;
  if o.neumatico_id is not null then raise exception 'Esta unidad ya tiene ficha' using errcode = '22023'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'Hace falta decir en qué se basa la identificación' using errcode = '22023'; end if;

  if p_neumatico is not null then
    select * into i from tc_neumaticos where id = p_neumatico for update;
    if not found then raise exception 'La ficha no existe' using errcode = '22023'; end if;
    if i.empresa_id <> o.empresa_id then raise exception 'La ficha es de otra empresa' using errcode = '22023'; end if;
    if exists (select 1 from tc_montajes_actuales m where m.neumatico_id = p_neumatico) then
      raise exception 'Esa ficha está montada ahora mismo: no puede ser esta unidad histórica' using errcode = '22023'; end if;
    if exists (select 1 from operaciones_neumaticos x where x.neumatico_id = p_neumatico
                 and x.importacion_lote_id is not null and x.tipo_operacion = 'montaje' and x.id <> p_operacion
                 and x.fecha_operacion = o.fecha_operacion) then
      raise exception 'Esa ficha ya figura montada ese mismo día en otra operación' using errcode = '22023'; end if;
    v_neu := p_neumatico;
  elsif p_crear then
    select * into i from tc_intervenciones where id = o.intervencion_id;
    v_neu := tc_imp_ficha_historica(o.empresa_id, o.importacion_lote_id, i.origen_doc, o.origen_linea, o.grupo_origen,
                                    o.marca_txt, o.modelo_txt, o.medida_txt);
  else
    raise exception 'Hay que enlazar una ficha o pedir que se cree' using errcode = '22023';
  end if;

  update operaciones_neumaticos set neumatico_id = v_neu, updated_at = now() where id = p_operacion;
  insert into tc_importacion_eventos (empresa_id, lote_id, intervencion_id, accion, detalle)
  values (o.empresa_id, o.importacion_lote_id, o.intervencion_id, 'identificar_unidad',
          jsonb_build_object('operacion', p_operacion, 'neumatico', v_neu, 'creada', p_neumatico is null, 'motivo', p_motivo));
  perform tc_imp_reconstruir_vehiculo(o.vehiculo_id);
  return jsonb_build_object('operacion', p_operacion, 'neumatico_id', v_neu, 'creada', p_neumatico is null);
end $$;


-- ── 11. Deshacer, ahora también con fichas, salidas e intervalos ───────────
--
-- Misma firma. Añade:
--   · las fichas creadas por la carga, que NO se borran si alguien las
--     identificó, las montó o las usó desde la aplicación;
--   · las salidas de sustitución;
--   · los intervalos, que se rehacen por vehículo: deshacer un lote REABRE
--     el intervalo que ese lote cerraba en otro lote.
create or replace function tc_deshacer_importacion(
  p_lote uuid, p_excluir uuid[] default '{}', p_simular boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lote      record;
  f           record;
  v_motivos   text[];
  v_huella    text;
  v_borradas  int := 0; v_conservadas int := 0;
  v_detalle   jsonb := '[]'::jsonb;
  v_quedan    int;
  v_vehs      uuid[] := '{}'; v_veh uuid; v_id uuid;   -- fase 2
begin
  select l.*, c.origen_sistema into v_lote
    from tc_importacion_lotes l join tc_importacion_cargas c on c.id = l.carga_id
   where l.id = p_lote;
  if not found then raise exception 'El lote no existe' using errcode = '22023'; end if;
  perform tc_imp_exigir_admin(v_lote.empresa_id);
  perform tc_imp_bloquear(v_lote.empresa_id, v_lote.origen_sistema);
  if v_lote.estado = 'deshecho' then
    return jsonb_build_object('simulacion', p_simular, 'lote_id', p_lote, 'estado', 'deshecho', 'borradas', 0, 'conservadas', 0, 'detalle', '[]'::jsonb);
  end if;

  -- Bloqueo por fila, en orden fijo: lote → fotografías → intervenciones →
  -- operaciones → servicios → líneas.
  perform 1 from tc_importacion_lotes where id = p_lote for update;
  perform 1 from tc_importacion_intervenciones where lote_id = p_lote for update;
  perform 1 from tc_intervenciones i where i.importacion_lote_id = p_lote or i.id in (select intervencion_id from tc_importacion_intervenciones where lote_id = p_lote) for update;
  perform 1 from operaciones_neumaticos o where o.importacion_lote_id = p_lote or o.intervencion_id in (select intervencion_id from tc_importacion_intervenciones where lote_id = p_lote) for update;
  perform 1 from tc_intervencion_servicios s where s.importacion_lote_id = p_lote or s.intervencion_id in (select intervencion_id from tc_importacion_intervenciones where lote_id = p_lote) for update;
  perform 1 from tc_importacion_lineas l where l.lote_id = p_lote for update;
  -- Fase 2: fichas reconstruidas e intervalos del lote.
  perform 1 from tc_neumaticos n where n.importacion_lote_id = p_lote for update;
  perform 1 from tc_reconstruccion_montajes rm where rm.lote_montaje_id = p_lote or rm.lote_desmontaje_id = p_lote for update;

  for f in select * from tc_importacion_intervenciones where lote_id = p_lote and conservada_at is null order by origen_doc loop
    v_motivos := '{}';

    if f.intervencion_id = any(coalesce(p_excluir, '{}')) then
      v_motivos := array_append(v_motivos, 'Excluida a petición del usuario');
    else
      if not exists (select 1 from tc_intervenciones where id = f.intervencion_id) then
        v_motivos := array_append(v_motivos, 'La intervención ya no existe (borrada fuera de esta importación)');
      else
        v_huella := tc_imp_huella_estado(f.intervencion_id);
        if v_huella <> f.huella_estado then v_motivos := array_append(v_motivos, 'Modificada después de importarla (la huella del estado no coincide)'); end if;
      end if;
      -- Añadidas / quitadas.
      if exists (select 1 from operaciones_neumaticos o where o.intervencion_id = f.intervencion_id
                   and not (o.id = any(f.operacion_ids)) and not (o.id = any(f.salida_ids))) then
        v_motivos := array_append(v_motivos, 'Tiene operaciones añadidas después'); end if;
      if (select count(*) from operaciones_neumaticos where id = any(f.salida_ids)) <> coalesce(array_length(f.salida_ids, 1), 0) then
        v_motivos := array_append(v_motivos, 'Le faltan salidas de sustitución de la importación'); end if;
      if (select count(*) from operaciones_neumaticos where id = any(f.operacion_ids)) <> coalesce(array_length(f.operacion_ids, 1), 0) then
        v_motivos := array_append(v_motivos, 'Le faltan operaciones de la importación'); end if;
      if exists (select 1 from tc_intervencion_servicios s where s.intervencion_id = f.intervencion_id and not (s.id = any(f.servicio_ids))) then
        v_motivos := array_append(v_motivos, 'Tiene servicios añadidos después'); end if;
      if (select count(*) from tc_intervencion_servicios where id = any(f.servicio_ids)) <> coalesce(array_length(f.servicio_ids, 1), 0) then
        v_motivos := array_append(v_motivos, 'Le faltan servicios de la importación'); end if;
      if (select count(*) from tc_importacion_lineas where id = any(f.linea_ids)) <> coalesce(array_length(f.linea_ids, 1), 0) then
        v_motivos := array_append(v_motivos, 'Le faltan líneas de origen'); end if;
      -- Relaciones posteriores (las de operaciones anuladas, corregidas, etc.
      -- ya cambian la huella; esto es lo que cuelga de ellas).
      if exists (select 1 from tc_operacion_adjuntos where operacion_id = any(f.operacion_ids)) then v_motivos := array_append(v_motivos, 'Tiene adjuntos'); end if;
      if exists (select 1 from tc_operacion_movimientos where operacion_id = any(f.operacion_ids)) then v_motivos := array_append(v_motivos, 'Tiene movimientos'); end if;
      if exists (select 1 from tc_operacion_estado_historial where operacion_id = any(f.operacion_ids)) then v_motivos := array_append(v_motivos, 'Tiene historial de estados'); end if;
      if exists (select 1 from tc_operacion_auditoria where operacion_id = any(f.operacion_ids)) then v_motivos := array_append(v_motivos, 'Tiene auditoría'); end if;
      if exists (select 1 from autorizaciones_operaciones where operacion_id = any(f.operacion_ids)) then v_motivos := array_append(v_motivos, 'Tiene autorizaciones'); end if;
      if exists (select 1 from tc_reservas_neumatico where operacion_id = any(f.operacion_ids)) then v_motivos := array_append(v_motivos, 'Tiene reservas'); end if;
      if exists (select 1 from operaciones_neumaticos where operacion_anulada_id = any(f.operacion_ids) or operacion_prevista_id = any(f.operacion_ids)) then
        v_motivos := array_append(v_motivos, 'Otras operaciones la referencian'); end if;
      if exists (select 1 from tc_partes_guiados where intervencion_id = f.intervencion_id) then v_motivos := array_append(v_motivos, 'Tiene un parte guiado'); end if;
      -- Incidencias: en el esquema real la operación que resuelve un problema
      -- cuelga de tc_incidencia_problemas.operacion_id y la sustitución de
      -- tc_incidencia_operaciones.operacion_neumatico_id (las dos sin acción
      -- al borrar, así que bloquearían el delete con un error feo).
      if exists (select 1 from tc_incidencia_problemas where operacion_id = any(f.operacion_ids))
         or exists (select 1 from tc_incidencia_operaciones where operacion_neumatico_id = any(f.operacion_ids)) then
        v_motivos := array_append(v_motivos, 'Tiene incidencias'); end if;

      -- Fase 2: las fichas creadas por esta importación. Una ficha que
      -- después alguien identificó, montó o usó ya no es «nuestra» y no se
      -- borra: se conserva con su motivo.
      if coalesce(array_length(f.neumatico_ids, 1), 0) > 0 then
        if exists (select 1 from tc_neumaticos n where n.id = any(f.neumatico_ids)
                     and (n.identidad_reconstruida = false or n.control_individual
                          or n.numero_serie is not null or n.dot is not null or n.rfid_epc is not null)) then
          v_motivos := array_append(v_motivos, 'Alguna ficha fue identificada después'); end if;
        if exists (select 1 from tc_neumaticos n where n.id = any(f.neumatico_ids) and n.estado <> 'pendiente_clasificacion') then
          v_motivos := array_append(v_motivos, 'Alguna ficha cambió de estado'); end if;
        if exists (select 1 from tc_montajes_actuales m where m.neumatico_id = any(f.neumatico_ids))
           or exists (select 1 from tc_historial_montajes h where h.neumatico_id = any(f.neumatico_ids)) then
          v_motivos := array_append(v_motivos, 'Alguna ficha se ha montado desde la aplicación'); end if;
        if exists (select 1 from revisiones_neumaticos_detalle d where d.neumatico_id = any(f.neumatico_ids))
           or exists (select 1 from tc_incidencias x where x.neumatico_id = any(f.neumatico_ids))
           or exists (select 1 from tc_operacion_movimientos mv where mv.neumatico_id = any(f.neumatico_ids))
           or exists (select 1 from tc_reservas_neumatico rs where rs.neumatico_id = any(f.neumatico_ids)) then
          v_motivos := array_append(v_motivos, 'Alguna ficha está referida por revisiones, incidencias o reservas'); end if;
        -- Referida por operaciones AJENAS a la importación: eso sí protege.
        -- Una salida histórica de otro lote NO protege: ese vínculo lo pusimos
        -- nosotros al reconstruir la cadena y se recalcula al deshacer.
        if exists (select 1 from operaciones_neumaticos x where x.neumatico_id = any(f.neumatico_ids)
                     and x.intervencion_id is distinct from f.intervencion_id
                     and not (x.importacion_lote_id is not null and x.tipo_operacion = 'desmontaje')) then
          v_motivos := array_append(v_motivos, 'Alguna ficha la usa una operación ajena a la importación'); end if;
      end if;
    end if;

    if coalesce(array_length(v_motivos, 1), 0) > 0 then
      v_conservadas := v_conservadas + 1;
      v_detalle := v_detalle || jsonb_build_object('intervencion_id', f.intervencion_id, 'origen_doc', f.origen_doc,
                                                   'resultado', 'conservada', 'motivos', to_jsonb(v_motivos));
      if not p_simular then
        update tc_importacion_intervenciones set conservada_at = now(), motivo_conservada = array_to_string(v_motivos, ' · ')
         where intervencion_id = f.intervencion_id;
      end if;
      continue;
    end if;

    v_borradas := v_borradas + 1;
    v_detalle := v_detalle || jsonb_build_object('intervencion_id', f.intervencion_id, 'origen_doc', f.origen_doc, 'resultado', 'borrada');
    if not p_simular then
      -- Orden: líneas → operaciones → servicios → fotografía → intervención.
      -- La intervención la última: su FK en operaciones es SET NULL y una
      -- operación huérfana la convertiría tc_agrupar_operaciones_sueltas en
      -- otra intervención.
      select vehiculo_id into v_veh from tc_intervenciones where id = f.intervencion_id;
      if v_veh is not null and not (v_veh = any(v_vehs)) then v_vehs := v_vehs || v_veh; end if;
      delete from tc_importacion_lineas where id = any(f.linea_ids);
      -- Fase 2, en orden: intervalos → salidas → entradas → fichas.
      delete from tc_reconstruccion_montajes
        where operacion_entrada_id = any(f.operacion_ids) or operacion_salida_id = any(f.salida_ids);
      delete from operaciones_neumaticos where id = any(f.salida_ids);
      delete from operaciones_neumaticos where id = any(f.operacion_ids);
      -- Si otra carga cerró su intervalo con estas fichas, ese vínculo se
      -- suelta y queda constancia: el intervalo del otro lote vuelve a estar
      -- abierto cuando se rehaga la cadena del vehículo, unas líneas más
      -- abajo. No se toca nada más de ese lote.
      if exists (select 1 from operaciones_neumaticos x where x.neumatico_id = any(f.neumatico_ids)) then
        insert into tc_importacion_eventos (empresa_id, lote_id, intervencion_id, accion, detalle)
        select v_lote.empresa_id, p_lote, f.intervencion_id, 'reabrir_intervalo',
               jsonb_build_object('salidas', coalesce(jsonb_agg(jsonb_build_object('operacion', x.id, 'lote', x.importacion_lote_id)), '[]'::jsonb))
          from operaciones_neumaticos x where x.neumatico_id = any(f.neumatico_ids);
        update operaciones_neumaticos set neumatico_id = null, identidad_retirado = 'desconocida', updated_at = now()
         where neumatico_id = any(f.neumatico_ids);
      end if;
      delete from tc_reconstruccion_montajes where neumatico_id = any(f.neumatico_ids);
      delete from tc_neumaticos where id = any(f.neumatico_ids);
      delete from tc_intervencion_servicios where id = any(f.servicio_ids);
      delete from tc_importacion_intervenciones where intervencion_id = f.intervencion_id;
      delete from tc_intervenciones where id = f.intervencion_id;
    end if;
  end loop;

  if not p_simular then
    -- Las cadenas de los vehículos tocados se rehacen enteras: si este lote
    -- cerraba un intervalo de OTRO lote, ese intervalo vuelve a quedar
    -- abierto, y si quedaba interrumpido se recalcula.
    for v_id in select unnest(v_vehs) loop perform tc_imp_reconstruir_vehiculo(v_id); end loop;
    -- Líneas del lote sin intervención (albaranes solo de tacógrafo, etc.)
    -- se van si no queda nada conservado; si queda, se mantienen con lo suyo.
    select count(*) into v_quedan from tc_importacion_intervenciones where lote_id = p_lote;
    if v_quedan = 0 then
      delete from tc_importacion_lineas where lote_id = p_lote;
      update tc_importacion_lotes set estado = 'deshecho', deshecho_at = now() where id = p_lote;
    else
      update tc_importacion_lotes set estado = 'parcialmente_deshecho', deshecho_at = now() where id = p_lote;
    end if;
    update tc_importacion_cargas c set actualizado_at = now(),
      estado = case
        when not exists (select 1 from tc_importacion_lotes where carga_id = c.id and estado <> 'deshecho') then 'deshecha'
        when exists (select 1 from tc_importacion_lotes where carga_id = c.id and estado <> 'aplicado') then 'parcialmente_deshecha'
        else c.estado end
      where c.id = v_lote.carga_id;
  end if;

  return jsonb_build_object('simulacion', p_simular, 'lote_id', p_lote, 'borradas', v_borradas, 'conservadas', v_conservadas,
    'estado', case when p_simular then null when v_conservadas = 0 then 'deshecho' else 'parcialmente_deshecho' end,
    'detalle', v_detalle);
end $$;

-- ── 12. Informe «Montajes de neumáticos» ───────────────────────────────────
--
-- Cuenta UNIDADES QUE ENTRAN. Cuatro sustituciones son cuatro montajes,
-- cuatro desmontajes y ocho registros: las salidas se enseñan aparte y no
-- inflan el recuento.
--
-- Qué es una unidad que entra:
--   · histórico → tipo 'montaje' con vínculo de importación;
--   · normal    → 'montaje' o 'sustitucion' que NO venga de 'montado'
--                 (en una sustitución las dos filas se tipan igual y es
--                 estado_anterior lo que separa la que entra de la que sale,
--                 la misma regla que usan la ficha de intervención y el PDF).
-- Fuera, siempre: anuladas, correcciones y lo declarado en el parte.
--
-- Función NUEVA, con nombre propio: no se toca la firma de
-- tc_informes_kpis ni la de tc_informes_operaciones, que seguirían
-- devolviendo exactamente lo de hoy, y así PostgREST no ve sobrecargas.
create or replace function tc_informes_montajes(
  p_empresa uuid default null,
  p_desde   date default null,
  p_hasta   date default null,
  p_origen  text default 'ambos'
) returns jsonb language sql security invoker stable as $$
  with rango as (
    select coalesce(p_desde, date_trunc('month', now())::date) as d1, coalesce(p_hasta, now()::date) as d2
  ),
  base as (
    select o.*, (o.importacion_lote_id is not null) as es_historico
      from operaciones_neumaticos o, rango
     where (p_empresa is null or o.empresa_id = p_empresa)
       and o.fecha_operacion between rango.d1 and rango.d2
  ),
  utiles as (
    select * from base
     where coalesce(is_anulada, false) = false
       and coalesce(status, 'completada') = 'completada'
       and coalesce(is_correccion, false) = false
       and coalesce(observaciones, '') not like '%[DECLARADO]%'
       and coalesce(observaciones, '') not like '%declarado en el parte%'
  ),
  entradas as (
    select u.*,
      case when es_historico then coalesce(nullif(btrim(u.marca_txt), ''), 'No informado')
           else coalesce(nullif(btrim(n.marca), ''), 'No informado') end as marca,
      case when es_historico then coalesce(nullif(btrim(u.modelo_txt), ''), 'No informado')
           else coalesce(nullif(btrim(n.modelo), ''), 'No informado') end as modelo,
      case when es_historico then coalesce(nullif(btrim(u.medida_txt), ''), 'No informado')
           else coalesce(nullif(btrim(n.medida), ''), 'No informado') end as medida,
      coalesce(u.condicion,
               case when coalesce(u.observaciones,'') like '%[USADO]%' then 'usada' else 'nueva' end) as cond,
      case when coalesce(u.posicion_destino_id, u.posicion_origen_id) is null then 'desconocida'
           when u.posicion_fuente = 'deducida' then 'deducida'
           else 'registrada' end as clase_posicion
      from utiles u
      left join tc_neumaticos n on n.id = u.neumatico_id
     where (u.es_historico and u.tipo_operacion = 'montaje')
        or (not u.es_historico and u.tipo_operacion in ('montaje','sustitucion')
            and u.estado_anterior is distinct from 'montado')
  ),
  ent as (
    select * from entradas
     where p_origen = 'ambos'
        or (p_origen = 'historico' and es_historico)
        or (p_origen = 'normal' and not es_historico)
  ),
  salidas as (
    select u.*, (u.importacion_lote_id is not null) as hist from utiles u
     where u.tipo_operacion = 'desmontaje'
        or (u.tipo_operacion = 'sustitucion' and u.estado_anterior = 'montado')
  )
  select jsonb_build_object(
    'desde', (select d1 from rango), 'hasta', (select d2 from rango), 'origen', p_origen,
    'total',            (select count(*) from ent),
    'total_historico',  (select count(*) from ent where es_historico),
    'total_normal',     (select count(*) from ent where not es_historico),
    'desmontajes',      (select count(*) from salidas),
    'desmontajes_historico', (select count(*) from salidas where hist),
    'registros',        (select count(*) from ent) + (select count(*) from salidas),
    'por_condicion', (select coalesce(jsonb_agg(jsonb_build_object('condicion', cond, 'n', n, 'historico', nh, 'normal', nn) order by n desc), '[]'::jsonb)
                      from (select cond, count(*) n, count(*) filter (where es_historico) nh, count(*) filter (where not es_historico) nn
                              from ent group by cond) x),
    'por_referencia', (select coalesce(jsonb_agg(jsonb_build_object('marca', marca, 'modelo', modelo, 'medida', medida,
                                                                    'condicion', cond, 'n', n, 'historico', nh, 'normal', nn)
                                                 order by n desc, marca, modelo), '[]'::jsonb)
                       from (select marca, modelo, medida, cond, count(*) n,
                                    count(*) filter (where es_historico) nh, count(*) filter (where not es_historico) nn
                               from ent group by marca, modelo, medida, cond) x),
    'por_vehiculo', (select coalesce(jsonb_agg(jsonb_build_object('vehiculo_id', vid, 'matricula', mat, 'n', n,
                                                                  'nuevas', nu, 'usadas', us, 'recauchutadas', re)
                                               order by n desc, mat), '[]'::jsonb)
                     from (select e.vehiculo_id vid, coalesce(v.matricula, '—') mat, count(*) n,
                                  count(*) filter (where cond = 'nueva') nu,
                                  count(*) filter (where cond = 'usada') us,
                                  count(*) filter (where cond = 'recauchutada') re
                             from ent e left join tc_vehiculos v on v.id = e.vehiculo_id
                            group by e.vehiculo_id, v.matricula) x),
    'evolucion', (select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'n', n, 'historico', nh, 'normal', nn) order by mes), '[]'::jsonb)
                  from (select to_char(date_trunc('month', fecha_operacion), 'YYYY-MM') mes, count(*) n,
                               count(*) filter (where es_historico) nh, count(*) filter (where not es_historico) nn
                          from ent group by 1) x),
    'por_posicion', (select coalesce(jsonb_agg(jsonb_build_object('clase', clase_posicion, 'n', n) order by n desc), '[]'::jsonb)
                     from (select clase_posicion, count(*) n from ent group by clase_posicion) x),
    'excluidas', jsonb_build_object(
      'anuladas',    (select count(*) from base where coalesce(is_anulada,false)
                        and (tipo_operacion in ('montaje','sustitucion'))),
      'correcciones',(select count(*) from base where coalesce(is_correccion,false)),
      'declaradas',  (select count(*) from base where coalesce(observaciones,'') like '%[DECLARADO]%'
                        or coalesce(observaciones,'') like '%declarado en el parte%'),
      'no_completadas', (select count(*) from base where coalesce(status,'completada') <> 'completada'
                        and coalesce(is_anulada,false) = false))
  )
$$;

-- ── 13. Permisos ───────────────────────────────────────────────────────────
revoke all on function tc_imp_ficha_historica(uuid, uuid, text, text, uuid, text, text, text) from public, anon;
revoke all on function tc_imp_ampliar_intervencion(uuid) from public, anon;
revoke all on function tc_imp_reconstruir_vehiculo(uuid) from public, anon;
revoke all on function tc_imp_ampliar_carga(uuid, boolean) from public, anon;
revoke all on function tc_imp_identificar_unidad(uuid, uuid, boolean, text) from public, anon;
revoke all on function tc_informes_montajes(uuid, date, date, text) from public, anon;
grant execute on function tc_imp_ampliar_carga(uuid, boolean) to authenticated, service_role;
grant execute on function tc_imp_identificar_unidad(uuid, uuid, boolean, text) to authenticated, service_role;
grant execute on function tc_informes_montajes(uuid, date, date, text) to authenticated, service_role;
grant select on tc_reconstruccion_montajes, tc_importacion_eventos to authenticated, service_role;

-- ── 14. Inventario: las fichas históricas no son existencias ───────────────
--
-- Son fichas para dar identidad a un montaje de hace años, no gomas que
-- estén en una estantería. Los recuentos de inventario las dejan fuera por
-- el VÍNCULO con la importación, no por `origen`, que lo usan otras cargas.
-- Mismas firmas: ni una sobrecarga nueva, las llamadas actuales no cambian.
--
-- Los cuatro contadores por estado de tc_informes_kpis (montados, almacén,
-- reparación, descartados) no hacen falta tocarlos: una ficha histórica está
-- en 'pendiente_clasificacion' y no entra en ninguno. El que sí contaba todo
-- era 'neumaticos_total'.
create or replace function public.tc_informes_inventario_por(
  p_empresa uuid default null, p_dim text default 'marca'
) returns table(etiqueta text, total bigint) language sql security invoker stable as $$
  select coalesce(
    case p_dim
      when 'marca'  then n.marca
      when 'modelo' then n.modelo
      when 'medida' then n.medida
      when 'estado' then n.estado
      else n.marca
    end, '—') as etiqueta,
    count(*)::bigint as total
  from tc_neumaticos n
  where (p_empresa is null or n.empresa_id = p_empresa)
    and n.importacion_lote_id is null
  group by 1
  order by 2 desc, 1;
$$;

create or replace function public.tc_informes_inventario_marca_medida(p_empresa uuid default null)
returns table(marca text, medida text, total bigint) language sql security invoker stable as $$
  select coalesce(n.marca, '—'), coalesce(n.medida, '—'), count(*)::bigint
  from tc_neumaticos n
  where (p_empresa is null or n.empresa_id = p_empresa)
    and n.importacion_lote_id is null
  group by 1, 2
  order by 3 desc, 1, 2;
$$;

create or replace view tc_marcas_contadores as
select
  m.id,
  (select count(*) from tc_cat_modelos_neumatico mo where mo.marca_id = m.id and mo.activo) as num_modelos,
  (select count(*) from tc_neumaticos n where n.marca = m.nombre and n.importacion_lote_id is null) as num_neumaticos,
  (select count(distinct n.vehiculo_id) from tc_neumaticos n where n.marca = m.nombre and n.vehiculo_id is not null and n.importacion_lote_id is null) as num_vehiculos
from tc_cat_marcas_neumatico m;
grant select on tc_marcas_contadores to authenticated;

-- Una función nueva para el total de inventario sin histórico, para que el
-- Dashboard pueda enseñarlo bien sin tocar la firma ni el contrato de
-- tc_informes_kpis (su 'neumaticos_total' sigue significando lo de siempre).
create or replace function public.tc_informes_inventario_resumen(p_empresa uuid default null)
returns jsonb language sql security invoker stable as $$
  select jsonb_build_object(
    'neumaticos_reales',    (select count(*) from tc_neumaticos n
                              where (p_empresa is null or n.empresa_id = p_empresa) and n.importacion_lote_id is null),
    'fichas_historicas',    (select count(*) from tc_neumaticos n
                              where (p_empresa is null or n.empresa_id = p_empresa) and n.importacion_lote_id is not null),
    'unidades_sin_ficha',   (select count(*) from operaciones_neumaticos o
                              where (p_empresa is null or o.empresa_id = p_empresa)
                                and o.importacion_lote_id is not null and o.tipo_operacion = 'montaje'
                                and o.neumatico_id is null and coalesce(o.is_anulada,false) = false));
$$;
revoke all on function tc_informes_inventario_resumen(uuid) from public, anon;
grant execute on function tc_informes_inventario_resumen(uuid) to authenticated, service_role;
