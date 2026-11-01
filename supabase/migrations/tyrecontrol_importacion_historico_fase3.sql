-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Importación del histórico · fase 3                                      ║
-- ║  Plausibilidad de kilómetros, revisión humana auditada y continuidad     ║
-- ║  con documentos bloqueados                                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Qué añade, y por qué:
--
--   1. KILÓMETROS CALCULABLES frente a KILÓMETROS VÁLIDOS PARA ESTADÍSTICAS.
--      Hasta ahora un intervalo con los dos kilometrajes presentes y
--      crecientes entraba en las medias sin más. El histórico de Plana tiene
--      lecturas de cuentakilómetros que no describen un vehículo (la peor del
--      fichero: 97.754.729 km), y una de ellas ha llegado a un intervalo
--      cerrado: 626.290 km en 98 días. La aritmética es correcta; el dato no
--      es creíble. Se separan las dos cosas: el recorrido se SIGUE
--      calculando y guardando, y aparte se dice si es plausible.
--
--      El criterio es el RITMO DIARIO, no el recorrido total: 180.000 km en
--      tres años es creíble y 180.000 km en tres meses no, y el total no
--      distingue. El límite es configurable por empresa y arranca en 2.000
--      km/día. No es un umbral escondido: el aviso dice el límite que ha
--      aplicado, el ritmo que ha calculado y de dónde salen los números.
--
--      Un aviso de plausibilidad NO demuestra que el dato sea falso. Es un
--      criterio de revisión.
--
--   2. LA DECISIÓN HUMANA, SEPARADA DE LA CLASIFICACIÓN. La clasificación la
--      hace la máquina (ausentes / incompatibles / utilizables / anómalos) y
--      no cambia cuando una persona opina. La persona decide otra cosa: si
--      ese intervalo se usa para estadísticas (pendiente / aceptado /
--      rechazado), con motivo obligatorio, usuario y fecha. Rechazar un
--      recorrido NO convierte sus kilómetros en ausentes ni en decrecientes:
--      los valores y el recorrido siguen ahí.
--
--      Aceptar un intervalo permite usarlo como ESTIMADO. Nunca lo convierte
--      en rendimiento confirmado: esta tabla no alimenta esos informes.
--
--   3. SI CAMBIA LA EVIDENCIA, LA ACEPTACIÓN CADUCA. Cada decisión guarda la
--      huella de la evidencia sobre la que se tomó. Al rehacer la cadena, si
--      la evidencia es otra, la decisión deja de aplicarse, queda auditada
--      como invalidada y el intervalo vuelve a pedir revisión. La auditoría
--      no se borra nunca: rehacer cadenas o recalcular anomalías no puede
--      hacer desaparecer una decisión humana.
--
--   4. LOS ALBARANES BLOQUEADOS, COMO CONTEXTO DE CONTINUIDAD. Los 25
--      albaranes bloqueados siguen sin importarse: ni operaciones, ni fichas,
--      ni cantidades. Pero uno de ellos, dentro de un intervalo, es evidencia
--      de un posible montaje intermedio, y entonces la cadena no se puede
--      considerar limpia. Se guarda la referencia del documento y el motivo
--      que lo bloquea, y se avisa en los intervalos que lo abarcan. Si no se
--      sabe la posición —y no se sabe— no se elige un eje: se avisa en todos
--      los intervalos del vehículo que cruzan esa fecha y se dice que la
--      posición es desconocida.
--
--      Resolver el kilometraje de un intervalo NO resuelve su continuidad.
--      Son dos motivos distintos y se cuentan por separado.
--
--   5. LA COBERTURA DE LAS ESTADÍSTICAS, PUBLICADA. Ninguna media de
--      recorrido estimado se da sin decir sobre cuántos intervalos se ha
--      calculado, cuántos ha dejado fuera y por qué, cuántos son unidades
--      identificadas y cuántos ocupaciones de posición, y sobre qué periodo
--      y qué población. Un intervalo puede tener varios motivos de revisión
--      a la vez, así que los motivos NO se suman como si fueran excluyentes:
--      se publican los motivos (que se solapan) y también las combinaciones
--      (que sí suman).
--
-- Depende de: tyrecontrol_importacion_historico.sql (fase 1) y
--             tyrecontrol_importacion_historico_fase2.sql (fase 2).
-- Idempotente: se puede volver a aplicar.

-- ── 1. El límite de plausibilidad, configurable ─────────────────────────────
create table if not exists tc_reconstruccion_ajustes (
  empresa_id      uuid primary key references tc_empresas(id) on delete cascade,
  km_dia_maximo   numeric not null default 2000 check (km_dia_maximo > 0),
  actualizado_at  timestamptz not null default now(),
  actualizado_por uuid
);
comment on table tc_reconstruccion_ajustes is
  'Ajustes de la reconstrucción histórica por empresa. km_dia_maximo es el límite de plausibilidad del ritmo diario: por encima de él, un recorrido calculable se marca anómalo y pide revisión. No es una prueba de que el dato sea falso.';

alter table tc_reconstruccion_ajustes enable row level security;
drop policy if exists recons_ajustes_sel on tc_reconstruccion_ajustes;
create policy recons_ajustes_sel on tc_reconstruccion_ajustes for select using ( tc_puede_ver_empresa(empresa_id) );
grant select on tc_reconstruccion_ajustes to authenticated, service_role;

-- El valor por defecto vive en UN sitio: esta función. Si la empresa no ha
-- configurado nada, son 2.000 km/día.
create or replace function tc_imp_limite_km_dia(p_empresa uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select km_dia_maximo from tc_reconstruccion_ajustes where empresa_id = p_empresa), 2000);
$$;

create or replace function tc_imp_fijar_limite_km_dia(p_empresa uuid, p_limite numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform tc_imp_exigir_admin(p_empresa);
  if p_limite is null or p_limite <= 0 then
    raise exception 'El límite de kilómetros por día tiene que ser mayor que cero' using errcode = '22023';
  end if;
  insert into tc_reconstruccion_ajustes (empresa_id, km_dia_maximo, actualizado_por)
  values (p_empresa, p_limite, auth.uid())
  on conflict (empresa_id) do update
    set km_dia_maximo = excluded.km_dia_maximo, actualizado_at = now(), actualizado_por = excluded.actualizado_por;
  -- Cambiar el límite reclasifica: lo que era anómalo puede dejar de serlo y
  -- al revés. Las decisiones humanas NO se tocan (el límite no es evidencia).
  for v in select distinct vehiculo_id from tc_reconstruccion_montajes where empresa_id = p_empresa loop
    perform tc_imp_reconstruir_vehiculo(v.vehiculo_id);
  end loop;
  return p_limite;
end $$;

-- ── 2. Un número en un texto, sin depender del idioma del servidor ──────────
create or replace function tc_imp_num(p_valor numeric)
returns text language sql immutable set search_path = public as $$
  -- to_char con máscara deja siempre el punto decimal ('2000.'), y 'G' para
  -- los miles depende del idioma del servidor. Así que ni separador de miles
  -- ni punto colgando: el número y nada más.
  select case when p_valor is null then '—'
              else rtrim(rtrim(to_char(p_valor, 'FM99999999999990.99'), '0'), '.') end;
$$;

-- ── 3. Columnas nuevas del intervalo ────────────────────────────────────────
alter table tc_reconstruccion_montajes
  add column if not exists dias_intervalo   int,
  add column if not exists ritmo_km_dia     numeric,
  add column if not exists limite_km_dia    numeric,
  add column if not exists uso_estadistico  text not null default 'pendiente',
  add column if not exists revisado_por     uuid,
  add column if not exists revisado_at      timestamptz,
  add column if not exists revisado_motivo  text,
  add column if not exists revision_huella  text,
  add column if not exists continuidad_docs text[] not null default '{}',
  add column if not exists continuidad_motivo text,
  -- La continuidad se decide APARTE de los kilómetros. Aceptar que un
  -- kilometraje es creíble no dice nada sobre si faltó un montaje por medio.
  add column if not exists continuidad_decision text not null default 'pendiente',
  add column if not exists continuidad_revisada_por uuid,
  add column if not exists continuidad_revisada_at timestamptz,
  add column if not exists continuidad_motivo_revision text,
  add column if not exists continuidad_huella text,
  -- Montaje y desmontaje el MISMO día: no se sabe en qué orden ni cuánto
  -- tiempo pasó entre los dos, así que tampoco se puede hablar de ritmo.
  add column if not exists orden_desconocido boolean not null default false;

-- km_estado gana 'anomalos'. La restricción puede venir con el nombre que le
-- puso `create table` o con el que le pusimos a mano en la fase 2: se quitan
-- todas las que hablen de km_estado y se pone la buena.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'tc_reconstruccion_montajes'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%km_estado%'
  loop
    execute format('alter table tc_reconstruccion_montajes drop constraint %I', c.conname);
  end loop;
end $$;
alter table tc_reconstruccion_montajes add constraint ck_recons_km_estado
  check (km_estado in ('utilizables','anomalos','ausentes','incompatibles','sin_cierre'));

do $$ begin
  alter table tc_reconstruccion_montajes add constraint ck_recons_uso
    check (uso_estadistico in ('pendiente','aceptado','rechazado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table tc_reconstruccion_montajes add constraint ck_recons_continuidad
    check (continuidad_decision in ('pendiente','aceptada','rechazada'));
exception when duplicate_object then null; end $$;

comment on column tc_reconstruccion_montajes.km_estado is
  'Clasificación automática, sin opinión humana: utilizables (recorrido calculable y plausible) · anomalos (calculable pero el ritmo diario supera el límite; el recorrido SE CONSERVA) · ausentes (falta un extremo) · incompatibles (kilometraje decreciente; los valores SE CONSERVAN) · sin_cierre. Un dato incompatible nunca se convierte en ausente, y un anómalo nunca se borra.';
comment on column tc_reconstruccion_montajes.uso_estadistico is
  'Decisión HUMANA sobre los KILÓMETROS, separada de km_estado: pendiente / aceptado / rechazado. Rechazar no cambia los kilómetros ni el recorrido. Aceptar permite usar el intervalo como ESTIMADO, nunca como rendimiento confirmado. NO resuelve la continuidad: eso se decide aparte.';
comment on column tc_reconstruccion_montajes.continuidad_decision is
  'Decisión HUMANA sobre la CONTINUIDAD de la cadena, independiente de la de los kilómetros. Un intervalo con continuidad dudosa no entra en las medias aunque sus kilómetros estén aceptados.';
comment on column tc_reconstruccion_montajes.ritmo_km_dia is
  'recorrido_km / días del intervalo, SOLO cuando hay al menos un día. Con montaje y desmontaje el mismo día queda a NULL: no se conoce el ritmo diario y no se inventa uno.';
comment on column tc_reconstruccion_montajes.orden_desconocido is
  'Montaje y desmontaje el mismo día con recorrido positivo: no consta la hora ni el orden de los trabajos, así que no se puede saber cuánto rodó el vehículo entre los dos. El recorrido se conserva y no se usa en estadísticas sin revisión.';
comment on column tc_reconstruccion_montajes.continuidad_docs is
  'Albaranes BLOQUEADOS (no importados) con evidencia de un posible montaje dentro del intervalo. Su presencia impide considerar la cadena limpia. No se crean sus operaciones, fichas ni cantidades.';
comment on column tc_reconstruccion_montajes.revision_huella is
  'Huella de la evidencia sobre la que se tomó la decisión humana. Si la evidencia cambia, la decisión caduca y el intervalo vuelve a pedir revisión.';

-- ── 4. La auditoría de las revisiones, que sobrevive a todo ─────────────────
--
-- Sin claves ajenas a la operación ni al intervalo A PROPÓSITO: deshacer una
-- importación borra operaciones e intervalos, y la constancia de que una
-- persona decidió algo no puede desaparecer con ellos.
create table if not exists tc_reconstruccion_revisiones (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id          uuid not null,
  posicion_id          uuid,
  operacion_entrada_id uuid not null,       -- la clave estable del intervalo
  fecha_montaje        date not null,
  -- Sobre QUÉ se decide. Son dos cosas distintas y se auditan por separado:
  -- aceptar un kilometraje no dice nada sobre la continuidad de la cadena.
  ambito               text not null default 'kilometros'
                       check (ambito in ('kilometros','continuidad')),
  decision             text not null check (decision in ('aceptado','rechazado','invalidada')),
  motivo               text not null check (btrim(motivo) <> ''),
  km_estado            text,
  recorrido_km         numeric,
  ritmo_km_dia         numeric,
  limite_km_dia        numeric,
  continuidad_docs     text[],
  huella_evidencia     text not null,
  usuario_id           uuid,
  creado_at            timestamptz not null default now(),
  invalidada_at        timestamptz,
  motivo_invalidacion  text
);
alter table tc_reconstruccion_revisiones add column if not exists ambito text not null default 'kilometros';
do $$ begin
  alter table tc_reconstruccion_revisiones add constraint ck_recons_rev_ambito
    check (ambito in ('kilometros','continuidad'));
exception when duplicate_object then null; end $$;
create index if not exists idx_recons_rev_entrada on tc_reconstruccion_revisiones (operacion_entrada_id, ambito, creado_at desc);
create index if not exists idx_recons_rev_empresa on tc_reconstruccion_revisiones (empresa_id, creado_at desc);

comment on table tc_reconstruccion_revisiones is
  'Auditoría de las decisiones humanas sobre el uso estadístico de un intervalo reconstruido. Append-only y sin FK a operaciones ni intervalos: deshacer una importación no la borra. decision=invalidada la escribe el sistema cuando la evidencia cambia.';

-- Append-only DE VERDAD para los roles de la aplicación. Dos cerrojos, porque
-- uno solo no basta:
--   · se revocan insert/update/delete, y
--   · la RLS queda con política de SELECT y NINGUNA de escritura, así que
--     aunque alguien devuelva los permisos por su cuenta (en Supabase los
--     default privileges del esquema public los conceden), la RLS sigue
--     negando escribir.
-- Las funciones `security definer` sí escriben: corren como el dueño, que se
-- salta la RLS. Esa es la única vía para dejar constancia de una decisión.
alter table tc_reconstruccion_revisiones enable row level security;
drop policy if exists recons_rev_sel on tc_reconstruccion_revisiones;
create policy recons_rev_sel on tc_reconstruccion_revisiones for select using ( tc_puede_ver_empresa(empresa_id) );
revoke insert, update, delete, truncate on tc_reconstruccion_revisiones from authenticated, anon, service_role;
grant select on tc_reconstruccion_revisiones to authenticated, service_role;

-- ── 5. Albaranes bloqueados: la referencia y el motivo, nada más ────────────
--
-- NO se guardan cantidades. En el caso que ha motivado esto, la cantidad es
-- justo lo que está en duda («Uds. = 4: no se sabe si son 4 o 16»), así que
-- apuntarla sería inventarse un dato. Se guarda si el documento contiene
-- evidencia de un posible montaje (sí o no) y el motivo literal del bloqueo.
create table if not exists tc_importacion_bloqueados (
  id              uuid primary key default gen_random_uuid(),
  lote_id         uuid not null references tc_importacion_lotes(id) on delete cascade,
  empresa_id      uuid not null references tc_empresas(id) on delete restrict,
  origen_sistema  text not null,
  origen_doc      text not null,
  documento       text,
  matricula       text,
  vehiculo_id     uuid references tc_vehiculos(id) on delete set null,
  fecha           date,
  km_origen       numeric,
  motivo          text not null,
  posible_montaje boolean not null default false,
  creado_at       timestamptz not null default now(),
  unique (lote_id, origen_doc)
);
create index if not exists idx_imp_bloq_vehiculo on tc_importacion_bloqueados (vehiculo_id, fecha)
  where vehiculo_id is not null;

comment on table tc_importacion_bloqueados is
  'Albaranes que NO se importan, guardados como contexto de continuidad. Sin operaciones, sin fichas y sin cantidades: solo la referencia del documento, su fecha, su kilometraje de origen y el motivo que impide importarlo.';
comment on column tc_importacion_bloqueados.posible_montaje is
  'El documento contiene anotaciones de montaje de gomas, así que puede haber habido un montaje intermedio. No dice cuántas: esa es justamente la cantidad en duda.';

alter table tc_importacion_bloqueados enable row level security;
drop policy if exists imp_bloq_sel on tc_importacion_bloqueados;
create policy imp_bloq_sel on tc_importacion_bloqueados for select using ( tc_puede_ver_empresa(empresa_id) );
grant select on tc_importacion_bloqueados to authenticated, service_role;

-- ── 6. La huella de la evidencia de un intervalo ────────────────────────────
--
-- SOLO evidencia: fechas, kilómetros, documentos, operaciones, posición,
-- identidad y continuidad. NO entra la clasificación (km_estado, recorrido,
-- ritmo) porque se deriva de la evidencia, ni el límite, que no es evidencia:
-- cambiar el límite reclasifica, pero no invalida lo que una persona decidió.
create or replace function tc_imp_huella_intervalo(p_intervalo uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(jsonb_build_object(
    'pos',  rm.posicion_id, 'neu', rm.neumatico_id, 'clase', rm.clase,
    'fm',   rm.fecha_montaje, 'kmm', rm.km_montaje, 'oe', rm.operacion_entrada_id,
    'docm', rm.origen_doc_montaje,
    'fd',   rm.fecha_desmontaje, 'kmd', rm.km_desmontaje, 'os', rm.operacion_salida_id,
    'docd', rm.origen_doc_desmontaje,
    'est',  rm.estado, 'cont', rm.continuidad_desde,
    'bloq', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb) from unnest(rm.continuidad_docs) d)
  )::text)
  from tc_reconstruccion_montajes rm where rm.id = p_intervalo;
$$;
revoke all on function tc_imp_huella_intervalo(uuid) from public, anon;
grant execute on function tc_imp_huella_intervalo(uuid) to authenticated, service_role;

-- ── 7. ¿Entra este intervalo en las medias de recorrido estimado? ───────────
--
-- DOS PUERTAS INDEPENDIENTES, y cada una se abre con su propia llave:
--
--   1. KILÓMETROS. Tiene que haber un recorrido calculable, y si hay algo que
--      revisar —ritmo no plausible, o montaje y desmontaje el mismo día sin
--      saber el orden— hace falta una aceptación humana explícita del ámbito
--      «kilometros».
--   2. CONTINUIDAD. La cadena tiene que estar limpia, o alguien tiene que
--      haber aceptado explícitamente el ámbito «continuidad».
--
-- Y esto es lo importante: ACEPTAR EL KILOMETRAJE NO ABRE LA PUERTA DE LA
-- CONTINUIDAD. Que una lectura sea creíble no dice nada sobre si entre medias
-- hubo un montaje que no se ha importado. Un rechazo, en cualquiera de las
-- dos, cierra la puerta entera.
create or replace function tc_imp_intervalo_duda_km(p_intervalo tc_reconstruccion_montajes)
returns boolean language sql immutable set search_path = public as $$
  select p_intervalo.km_estado = 'anomalos' or p_intervalo.orden_desconocido;
$$;

create or replace function tc_imp_intervalo_duda_continuidad(p_intervalo tc_reconstruccion_montajes)
returns boolean language sql immutable set search_path = public as $$
  select p_intervalo.continuidad_desde is not null
      or coalesce(array_length(p_intervalo.continuidad_docs, 1), 0) > 0;
$$;

create or replace function tc_imp_intervalo_en_medias(p_intervalo tc_reconstruccion_montajes)
returns boolean language sql immutable set search_path = public as $$
  select p_intervalo.estado = 'cerrado'
     -- recorrido calculable
     and p_intervalo.km_estado in ('utilizables','anomalos')
     and p_intervalo.recorrido_km is not null
     -- puerta 1: los kilómetros
     and p_intervalo.uso_estadistico <> 'rechazado'
     and (not tc_imp_intervalo_duda_km(p_intervalo) or p_intervalo.uso_estadistico = 'aceptado')
     -- puerta 2: la continuidad, con su propia decisión
     and p_intervalo.continuidad_decision <> 'rechazada'
     and (not tc_imp_intervalo_duda_continuidad(p_intervalo) or p_intervalo.continuidad_decision = 'aceptada');
$$;

create or replace function tc_imp_intervalo_motivos(p_intervalo tc_reconstruccion_montajes)
returns text[] language sql immutable set search_path = public as $$
  select array_remove(array[
    case when p_intervalo.estado <> 'cerrado'              then 'sin_cierre' end,
    case when p_intervalo.km_estado = 'ausentes'           then 'km_ausentes' end,
    case when p_intervalo.km_estado = 'incompatibles'      then 'km_incompatibles' end,
    case when p_intervalo.km_estado = 'anomalos'
          and p_intervalo.uso_estadistico = 'pendiente'    then 'km_anomalos_pendientes' end,
    case when p_intervalo.km_estado = 'anomalos'
          and p_intervalo.uso_estadistico = 'rechazado'    then 'km_anomalos_rechazados' end,
    -- Mismo día: el recorrido existe, pero no se sabe el orden ni cuánto
    -- tiempo pasó. Es un motivo propio, no un «ritmo no plausible».
    case when p_intervalo.orden_desconocido
          and p_intervalo.uso_estadistico = 'pendiente'    then 'mismo_dia_orden_desconocido' end,
    case when p_intervalo.km_estado = 'utilizables'
          and not p_intervalo.orden_desconocido
          and p_intervalo.uso_estadistico = 'rechazado'    then 'rechazado_a_mano' end,
    case when tc_imp_intervalo_duda_continuidad(p_intervalo)
          and p_intervalo.continuidad_decision = 'pendiente' then 'continuidad_pendiente' end,
    case when p_intervalo.continuidad_decision = 'rechazada' then 'continuidad_rechazada' end
  ], null);
$$;

comment on function tc_imp_intervalo_motivos(tc_reconstruccion_montajes) is
  'Los motivos por los que un intervalo NO entra en las medias. Un intervalo puede tener VARIOS: no son excluyentes y no deben sumarse como si lo fueran. Para sumar están las combinaciones.';

-- ── 7bis. La vista que lee el panel ────────────────────────────────────────
--
-- El panel NO vuelve a calcular en JavaScript si un intervalo entra en las
-- medias ni por qué no: lo pregunta aquí. Dos implementaciones de la misma
-- regla acabarían divergiendo, y la que manda es la de la base.
--
-- `security_invoker = true` es obligatorio: una vista normal se ejecuta con
-- los permisos de su dueño y se salta la RLS de la tabla, lo que dejaría ver
-- intervalos de otras empresas.
create or replace view tc_reconstruccion_intervalos
  with (security_invoker = true) as
  select rm.*,
         tc_imp_intervalo_en_medias(rm) as en_medias,
         tc_imp_intervalo_motivos(rm)   as motivos_exclusion
    from tc_reconstruccion_montajes rm;
grant select on tc_reconstruccion_intervalos to authenticated, service_role;
comment on view tc_reconstruccion_intervalos is
  'tc_reconstruccion_montajes más en_medias y motivos_exclusion, calculados por las funciones de la base para que el panel no los recalcule por su cuenta.';

-- ── 8. Reconstruir la cronología, con plausibilidad y continuidad ───────────
--
-- Cambia respecto a la fase 2:
--   · clasifica el recorrido calculable en plausible o anómalo, guardando
--     siempre el recorrido, los días, el ritmo y el límite aplicado;
--   · con cero días no divide: compara el recorrido con el límite de un día;
--   · marca los intervalos que abarcan un albarán bloqueado con evidencia de
--     posible montaje, sin elegir posición ni eje;
--   · vuelve a aplicar las decisiones humanas auditadas, y las invalida —con
--     constancia— si la evidencia ya no es la misma.
create or replace function tc_imp_reconstruir_vehiculo(p_vehiculo uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  e record; o record; ev record; b record; it record; rv record;
  v_n int := 0; v_rota boolean; v_desde date;
  v_km numeric; v_km_ok boolean; v_revisar boolean; v_motivo text;
  v_km_estado text; v_recorrido numeric;
  v_dias int; v_ritmo numeric; v_limite numeric; v_orden_desc boolean;
  v_ident text; v_nivel text; v_mismo_dia boolean;
  v_empresa uuid; v_huella text; v_texto text; v_ambito text;
begin
  select empresa_id into v_empresa from tc_vehiculos where id = p_vehiculo;
  if v_empresa is null then return 0; end if;
  -- Un candado por VEHÍCULO, no por empresa y origen.
  --
  -- Rehacer la cadena es borrar los intervalos del vehículo y volver a
  -- crearlos. Dos sesiones haciéndolo a la vez en READ COMMITTED PODRÍAN
  -- duplicarlos: el DELETE de la segunda arranca con su propio snapshot y no
  -- ve las filas que acaba de insertar la primera, así que las deja y añade
  -- las suyas encima. Con dos sesiones reales no he conseguido provocarlo —la
  -- ventana es de milisegundos y la reconstrucción es rápida—, así que esto es
  -- una protección por si acaso, no el arreglo de un fallo reproducido. La
  -- importación ya se serializa con
  -- tc_imp_bloquear(empresa, origen), pero esta función también la llaman
  -- deshacer y el cambio de límite, y el candado de la importación no cubre
  -- esos caminos. Este sí, y es el del propio vehículo: dos vehículos
  -- distintos siguen pudiendo reconstruirse en paralelo.
  perform pg_advisory_xact_lock(hashtext('tc_recons:' || p_vehiculo::text));
  v_limite := tc_imp_limite_km_dia(v_empresa);

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
     order by o2.fecha_operacion, i.origen_doc, (o2.posicion_destino_id is null), o2.origen_linea
  loop
    if e.pos is null then
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

      v_ident := case
        when o.neumatico_id is null then 'desconocida'
        when coalesce((select identidad_reconstruida from tc_neumaticos where id = o.neumatico_id), true) then 'reconstruida'
        else 'respaldada' end;

      v_mismo_dia := exists (
        select 1 from tc_intervenciones i2
         where i2.vehiculo_id = p_vehiculo and i2.importacion_lote_id is not null
           and i2.fecha = e.fecha_operacion and i2.origen_doc <> e.doc);

      if v_rota then
        update tc_reconstruccion_montajes set
          estado = 'interrumpido', continuidad_desde = v_desde,
          km_estado = 'sin_cierre', recorrido_km = null,
          dias_intervalo = null, ritmo_km_dia = null, limite_km_dia = null,
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
        -- si sirven para calcular recorrido, y si el recorrido es plausible.
        v_km := e.km_vehiculo; v_km_ok := e.km_vehiculo is not null;
        v_dias := e.fecha_operacion - o.fecha_montaje;
        v_ritmo := null; v_orden_desc := false;
        if e.km_vehiculo is null or o.km_montaje is null then
          v_km_estado := 'ausentes'; v_recorrido := null; v_revisar := false;
          v_motivo := 'Kilómetros ausentes en ' ||
            case when e.km_vehiculo is null and o.km_montaje is null then 'los dos extremos'
                 when o.km_montaje is null then 'el montaje' else 'el desmontaje' end;
        elsif e.km_vehiculo < o.km_montaje then
          -- Decreciente: el dato existe y no se pierde, pero no da recorrido.
          v_km_estado := 'incompatibles'; v_recorrido := null; v_revisar := true;
          v_motivo := 'Kilometraje decreciente: ' || tc_imp_num(o.km_montaje) || ' en el montaje ('
            || to_char(o.fecha_montaje, 'DD/MM/YYYY') || ', albarán ' || coalesce(o.origen_doc_montaje, '—')
            || ') y ' || tc_imp_num(e.km_vehiculo) || ' en el desmontaje ('
            || to_char(e.fecha_operacion, 'DD/MM/YYYY') || ', albarán ' || coalesce(e.doc, '—') || ')';
        elsif v_dias = 0 then
          -- MONTAJE Y DESMONTAJE EL MISMO DÍA. El recorrido aritmético se
          -- conserva, pero NO se puede hablar de ritmo diario: no se sabe en
          -- qué orden se hicieron los trabajos ni cuánto tiempo pasó entre
          -- ellos, porque los albaranes no traen hora de trabajo (la
          -- intervención se importa con hora_desconocida). Así que
          -- ritmo_km_dia se queda a NULL: no se inventa un «km/día» que
          -- nadie ha observado.
          v_recorrido := e.km_vehiculo - o.km_montaje;
          v_ritmo := null;
          if v_recorrido = 0 then
            -- Dos visitas el mismo día sin rodar es lo normal. Un recorrido
            -- cero NO es una anomalía de kilometraje por sí solo.
            v_km_estado := 'utilizables'; v_orden_desc := false;
            v_revisar := false; v_motivo := null;
          else
            -- Recorrido positivo dentro del mismo día: hay que mirar el orden
            -- y la duración antes de usarlo en estadísticas.
            v_orden_desc := true; v_revisar := true;
            v_km_estado := case when v_recorrido > v_limite then 'anomalos' else 'utilizables' end;
            v_motivo := 'Montaje y desmontaje el mismo día (' || to_char(e.fecha_operacion, 'DD/MM/YYYY')
              || '): ' || tc_imp_num(v_recorrido) || ' km entre ' || tc_imp_num(o.km_montaje)
              || ' (albarán ' || coalesce(o.origen_doc_montaje, '—') || ') y ' || tc_imp_num(e.km_vehiculo)
              || ' (albarán ' || coalesce(e.doc, '—') || '). No consta la hora ni el orden de los trabajos, '
              || 'así que no se sabe cuánto rodó el vehículo entre los dos ni se puede calcular un ritmo diario. '
              || 'El recorrido se conserva y no se usa en estadísticas sin revisar ese orden.'
              || case when v_recorrido > v_limite then ' Comprobación auxiliar, que no es un ritmo observado: '
                   || tc_imp_num(v_recorrido) || ' km superan por sí solos el límite de un día ('
                   || tc_imp_num(v_limite) || ' km).' else '' end;
          end if;
        else
          v_recorrido := e.km_vehiculo - o.km_montaje;
          v_ritmo := v_recorrido / v_dias;
          if v_ritmo > v_limite then
            v_km_estado := 'anomalos'; v_revisar := true;
            v_motivo := 'Ritmo no plausible: ' || tc_imp_num(v_recorrido) || ' km entre el '
              || to_char(o.fecha_montaje, 'DD/MM/YYYY') || ' (' || tc_imp_num(o.km_montaje) || ' km, albarán '
              || coalesce(o.origen_doc_montaje, '—') || ') y el ' || to_char(e.fecha_operacion, 'DD/MM/YYYY')
              || ' (' || tc_imp_num(e.km_vehiculo) || ' km, albarán ' || coalesce(e.doc, '—') || '): '
              || v_dias || ' día(s), ' || tc_imp_num(round(v_ritmo)) || ' km/día, por encima del límite de '
              || tc_imp_num(v_limite) || ' km/día'
              || '. Es un aviso para revisar, no una prueba de que el dato sea falso: el recorrido se conserva y queda pendiente de validación.';
          else
            v_km_estado := 'utilizables';
            if v_recorrido = 0 then
              v_revisar := true;
              v_motivo := 'Mismo kilometraje (' || tc_imp_num(e.km_vehiculo) || ') tras '
                || v_dias || ' día(s): recorrido cero, conviene comprobarlo';
            else
              v_revisar := false; v_motivo := null;
            end if;
          end if;
        end if;
        v_nivel := case when v_ident = 'respaldada' then 'confirmado' else 'estimado' end;
        update tc_reconstruccion_montajes set
          estado = 'cerrado', nivel = v_nivel,
          fecha_desmontaje = e.fecha_operacion,
          km_desmontaje = v_km, km_desmontaje_conocido = v_km_ok,
          km_estado = v_km_estado, recorrido_km = v_recorrido,
          dias_intervalo = v_dias, ritmo_km_dia = v_ritmo, orden_desconocido = v_orden_desc,
          limite_km_dia = case when v_km_estado in ('utilizables','anomalos') then v_limite end,
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
      'abierto', 'estimado', case when e.neumatico_id is null then 'ocupacion' else 'unidad' end,
      e.posicion_fuente,
      e.neumatico_id is null,
      case when e.neumatico_id is null then 'Ocupación de la posición sin goma identificada: usada o recauchutada pendiente de identificar' end);
    v_n := v_n + 1;
  end loop;

  -- Desfase de mano de obra: un aviso, no un movimiento.
  for ev in select * from tc_imp_desfase_mano_obra(p_vehiculo) order by fecha loop
    update tc_reconstruccion_montajes
       set revisar = true,
           motivo_revision = coalesce(motivo_revision || ' · ', '')
             || 'Posible trabajo adicional de ruedas el ' || to_char(ev.fecha, 'DD/MM/YYYY')
             || ' (albarán ' || coalesce(ev.origen_doc, '—')
             || '): el albarán cobra más mano de obra de ruedas que gomas monta, sin decir posiciones ni movimiento'
     where vehiculo_id = p_vehiculo
       and (fecha_montaje = ev.fecha
            or fecha_desmontaje = ev.fecha
            or (estado = 'abierto' and fecha_montaje < ev.fecha));
  end loop;

  -- ── Albaranes bloqueados dentro del intervalo ────────────────────────────
  --
  -- No se importan y aquí no se importa nada: se anota que la cadena no
  -- puede considerarse limpia, con el documento y su motivo. NO se elige
  -- posición: no se sabe cuál fue, así que se avisa en todos los intervalos
  -- del vehículo que cruzan esa fecha.
  for b in
    select distinct on (origen_doc) origen_doc, documento, fecha, km_origen, motivo
      from tc_importacion_bloqueados
     where vehiculo_id = p_vehiculo and posible_montaje and fecha is not null
     order by origen_doc, creado_at desc
  loop
    v_texto := 'Posible montaje intermedio sin importar el ' || to_char(b.fecha, 'DD/MM/YYYY')
      || ' (albarán ' || coalesce(b.documento, b.origen_doc) || ', bloqueado'
      || case when b.km_origen is not null then '; su lectura de origen eran ' || tc_imp_num(b.km_origen) || ' km' else '' end
      || '): ' || b.motivo
      || '. No se sabe en qué posición fue, así que no se atribuye a ningún eje. La cadena de esta posición no puede considerarse limpia.';
    update tc_reconstruccion_montajes set
      continuidad_docs = (select array_agg(distinct d) from unnest(continuidad_docs || b.origen_doc) d),
      continuidad_motivo = nullif(concat_ws(' · ', nullif(continuidad_motivo, ''), v_texto), ''),
      revisar = true,
      motivo_revision = nullif(concat_ws(' · ', nullif(motivo_revision, ''), v_texto), '')
     where vehiculo_id = p_vehiculo
       and fecha_montaje < b.fecha
       and (fecha_desmontaje is null or b.fecha < fecha_desmontaje)
       and not (b.origen_doc = any(continuidad_docs));
  end loop;

  -- ── Las decisiones humanas auditadas se vuelven a aplicar ────────────
  --
  -- Las DOS, cada una en su ámbito. La auditoría no se toca nunca. Si la
  -- evidencia del intervalo ya no es la que había cuando se decidió, la
  -- decisión NO se arrastra: se invalida con constancia y el intervalo vuelve
  -- a pedir revisión de ese ámbito.
  for it in select id, operacion_entrada_id from tc_reconstruccion_montajes where vehiculo_id = p_vehiculo loop
    v_huella := tc_imp_huella_intervalo(it.id);
    foreach v_ambito in array array['kilometros','continuidad'] loop
      select * into rv from tc_reconstruccion_revisiones
        where operacion_entrada_id = it.operacion_entrada_id and ambito = v_ambito
          and invalidada_at is null and decision in ('aceptado','rechazado')
        order by creado_at desc limit 1;
      if not found then continue; end if;
      if v_huella = rv.huella_evidencia then
        if v_ambito = 'kilometros' then
          update tc_reconstruccion_montajes set
            uso_estadistico = rv.decision, revisado_por = rv.usuario_id, revisado_at = rv.creado_at,
            revisado_motivo = rv.motivo, revision_huella = v_huella
           where id = it.id;
        else
          update tc_reconstruccion_montajes set
            continuidad_decision = case rv.decision when 'aceptado' then 'aceptada' else 'rechazada' end,
            continuidad_revisada_por = rv.usuario_id, continuidad_revisada_at = rv.creado_at,
            continuidad_motivo_revision = rv.motivo, continuidad_huella = v_huella
           where id = it.id;
        end if;
      else
        update tc_reconstruccion_revisiones set
          invalidada_at = now(),
          motivo_invalidacion = 'La evidencia del intervalo ha cambiado después de la decisión: hace falta revisarlo otra vez'
         where id = rv.id;
        insert into tc_reconstruccion_revisiones (
          empresa_id, vehiculo_id, posicion_id, operacion_entrada_id, fecha_montaje,
          ambito, decision, motivo, km_estado, recorrido_km, ritmo_km_dia, limite_km_dia,
          continuidad_docs, huella_evidencia, usuario_id)
        select rm.empresa_id, rm.vehiculo_id, rm.posicion_id, rm.operacion_entrada_id, rm.fecha_montaje,
               v_ambito, 'invalidada',
               'La decisión anterior sobre ' || v_ambito || ' (' || rv.decision || ') deja de aplicarse: la evidencia del intervalo ha cambiado',
               rm.km_estado, rm.recorrido_km, rm.ritmo_km_dia, rm.limite_km_dia,
               rm.continuidad_docs, v_huella, null
          from tc_reconstruccion_montajes rm where rm.id = it.id;
        if v_ambito = 'kilometros' then
          update tc_reconstruccion_montajes set
            uso_estadistico = 'pendiente', revisado_por = null, revisado_at = null,
            revisado_motivo = null, revision_huella = null
           where id = it.id;
        else
          update tc_reconstruccion_montajes set
            continuidad_decision = 'pendiente', continuidad_revisada_por = null, continuidad_revisada_at = null,
            continuidad_motivo_revision = null, continuidad_huella = null
           where id = it.id;
        end if;
        update tc_reconstruccion_montajes set
          revisar = true,
          motivo_revision = nullif(concat_ws(' · ', nullif(motivo_revision, ''),
            'Había una decisión sobre ' || v_ambito || ' (' || rv.decision || ') que ya no vale: la evidencia del intervalo ha cambiado. Hace falta revisarlo otra vez.'), '')
         where id = it.id;
      end if;
    end loop;
  end loop;

  return v_n;
end $$;

-- ── 9. Revisar un intervalo: dos ámbitos, dos decisiones ──────────────────
--
-- `p_ambito` dice SOBRE QUÉ se decide, y no hay forma de decidir las dos
-- cosas de una vez a propósito:
--   · 'kilometros'  → el recorrido es creíble y puede usarse como estimado;
--   · 'continuidad' → la cadena de esa posición puede darse por limpia pese
--                     al documento bloqueado que hay dentro.
-- Aceptar el kilometraje de un intervalo NO resuelve su continuidad.
--
-- La firma anterior de esta función, de tres parámetros, se elimina antes de
-- crear la nueva: `create or replace` con otra lista de parámetros dejaría
-- DOS funciones con el mismo nombre y PostgREST respondería PGRST203 a todas
-- las llamadas. Esta función nació en esta misma fase y no está desplegada en
-- ninguna parte; el drop es por si alguien aplicó una versión anterior en una
-- base de pruebas.
drop function if exists tc_imp_revisar_intervalo(uuid, text, text);

create or replace function tc_imp_revisar_intervalo(
  p_intervalo uuid, p_ambito text, p_decision text, p_motivo text
) returns jsonb language plpgsql security definer set search_path = public as $$
-- rm es del TIPO de la tabla, no un record: así se puede pasar a las
-- funciones que reciben la fila entera (un record no se puede convertir).
declare rm tc_reconstruccion_montajes; v_origen text; v_huella text;
begin
  if p_ambito not in ('kilometros','continuidad') then
    raise exception 'El ámbito tiene que ser «kilometros» o «continuidad»' using errcode = '22023';
  end if;
  if p_decision not in ('aceptado','rechazado') then
    raise exception 'La decisión tiene que ser «aceptado» o «rechazado»' using errcode = '22023';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de la revisión es obligatorio' using errcode = '22023';
  end if;
  -- FOR UPDATE antes de comprobar nada: si otra sesión está rehaciendo la
  -- cadena de este vehículo o deshaciendo su lote, se espera.
  select * into rm from tc_reconstruccion_montajes where id = p_intervalo for update;
  if not found then raise exception 'El intervalo no existe' using errcode = '22023'; end if;
  perform tc_imp_exigir_admin(rm.empresa_id);
  select c.origen_sistema into v_origen
    from tc_importacion_lotes l join tc_importacion_cargas c on c.id = l.carga_id
   where l.id = rm.lote_montaje_id;
  if v_origen is not null then perform tc_imp_bloquear(rm.empresa_id, v_origen); end if;
  -- Se relee: el bloqueo puede haber esperado a una reconstrucción.
  select * into rm from tc_reconstruccion_montajes where id = p_intervalo for update;
  if not found then raise exception 'El intervalo ya no existe; no se ha registrado la revisión' using errcode = '22023'; end if;

  if p_ambito = 'kilometros' then
    if rm.km_estado not in ('utilizables','anomalos') or rm.recorrido_km is null then
      raise exception 'Este intervalo no tiene un recorrido que aceptar o rechazar (kilómetros %)', rm.km_estado
        using errcode = '22023';
    end if;
  else
    if not tc_imp_intervalo_duda_continuidad(rm) and p_decision = 'aceptado' then
      raise exception 'La continuidad de este intervalo no está en duda: no hay nada que aceptar'
        using errcode = '22023';
    end if;
  end if;

  v_huella := tc_imp_huella_intervalo(p_intervalo);
  insert into tc_reconstruccion_revisiones (
    empresa_id, vehiculo_id, posicion_id, operacion_entrada_id, fecha_montaje,
    ambito, decision, motivo, km_estado, recorrido_km, ritmo_km_dia, limite_km_dia,
    continuidad_docs, huella_evidencia, usuario_id)
  values (
    rm.empresa_id, rm.vehiculo_id, rm.posicion_id, rm.operacion_entrada_id, rm.fecha_montaje,
    p_ambito, p_decision, btrim(p_motivo), rm.km_estado, rm.recorrido_km, rm.ritmo_km_dia, rm.limite_km_dia,
    rm.continuidad_docs, v_huella, auth.uid());

  if p_ambito = 'kilometros' then
    update tc_reconstruccion_montajes set
      uso_estadistico = p_decision, revisado_por = auth.uid(), revisado_at = now(),
      revisado_motivo = btrim(p_motivo), revision_huella = v_huella
     where id = p_intervalo;
  else
    update tc_reconstruccion_montajes set
      continuidad_decision = case p_decision when 'aceptado' then 'aceptada' else 'rechazada' end,
      continuidad_revisada_por = auth.uid(), continuidad_revisada_at = now(),
      continuidad_motivo_revision = btrim(p_motivo), continuidad_huella = v_huella
     where id = p_intervalo;
  end if;

  select * into rm from tc_reconstruccion_montajes where id = p_intervalo;
  return jsonb_build_object(
    'intervalo_id', p_intervalo, 'ambito', p_ambito,
    'uso_estadistico', rm.uso_estadistico, 'continuidad_decision', rm.continuidad_decision,
    'km_estado', rm.km_estado, 'recorrido_km', rm.recorrido_km,
    'en_medias', tc_imp_intervalo_en_medias(rm),
    'motivos_exclusion', to_jsonb(tc_imp_intervalo_motivos(rm)),
    'aviso', case when p_ambito = 'kilometros'
      then 'Aceptar los kilómetros permite usar este intervalo como ESTIMADO. No lo convierte en rendimiento confirmado y NO resuelve su continuidad, que se decide aparte.'
      else 'Aceptar la continuidad dice que la cadena de esta posición puede darse por limpia pese al documento bloqueado. No dice nada sobre si el kilometraje es creíble.' end);
end $$;

-- ── 10. Importar: igual que la fase 2, anotando los bloqueados ─────────────
--
-- El único cambio respecto a la fase 2 es que un albarán bloqueado deja
-- constancia en tc_importacion_bloqueados. Sigue sin importarse: no se crean
-- sus operaciones, ni sus fichas, ni ninguna cantidad.
create or replace function tc_imp_anotar_bloqueado(
  p_lote uuid, p_empresa uuid, p_origen text, p_alb jsonb, p_motivo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_mat text; v_veh uuid; v_monta boolean;
begin
  v_mat := upper(regexp_replace(coalesce(p_alb->>'matricula',''), '\s+', '', 'g'));
  select id into v_veh from tc_vehiculos
   where empresa_id = p_empresa and upper(regexp_replace(matricula, '\s+', '', 'g')) = v_mat
   limit 1;
  -- ¿Hay evidencia de un posible montaje? Que el documento traiga anotaciones
  -- de gomas. CUÁNTAS no se apunta: en el caso que motivó esto, la cantidad
  -- es justo lo que está en duda.
  v_monta := exists (
    select 1 from jsonb_array_elements(coalesce(p_alb->'operaciones','[]'::jsonb)) o
     where o.value->>'condicion' in ('nueva','usada','recauchutada'));
  insert into tc_importacion_bloqueados (
    lote_id, empresa_id, origen_sistema, origen_doc, documento, matricula, vehiculo_id,
    fecha, km_origen, motivo, posible_montaje)
  values (
    p_lote, p_empresa, p_origen, p_alb->>'origen_doc', p_alb->>'documento', nullif(v_mat, ''), v_veh,
    nullif(p_alb->>'fecha','')::date, nullif(p_alb->>'km','')::numeric, p_motivo, v_monta)
  on conflict (lote_id, origen_doc) do update
    set motivo = excluded.motivo, posible_montaje = excluded.posible_montaje,
        vehiculo_id = excluded.vehiculo_id, fecha = excluded.fecha, km_origen = excluded.km_origen;
  -- Devuelve el vehículo solo si el documento puede haber traído un montaje:
  -- es el único caso en que hay que rehacer su cadena para avisar.
  return case when v_monta then v_veh end;
end $$;

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
  v_bveh       uuid;                             -- fase 3: vehículo de un albarán bloqueado
  v_bloq_unico boolean := false;
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
      -- Fase 3: el albarán NO se importa —ni operaciones, ni fichas, ni
      -- cantidades— pero se guarda su referencia y su motivo, porque si cae
      -- dentro de un intervalo es evidencia de que la cadena no está limpia.
      if not p_simular and v_doc is not null then
        v_bveh := tc_imp_anotar_bloqueado(v_lote, p_empresa, v_origen, alb, v_motivo);
        -- Si el documento bloqueado puede haber traído un montaje, la cadena
        -- de ese vehículo se rehace al final para que sus intervalos avisen.
        if v_bveh is not null and not (v_bveh = any(v_vehs)) then v_vehs := v_vehs || v_bveh; end if;
      end if;
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
    -- Fase 3: ¿este lote es el ÚNICO que guarda constancia de algún albarán
    -- bloqueado? Si lo es, no se borra aunque no haya creado nada: esa
    -- constancia es lo que permite avisar de una continuidad no resuelta. Si
    -- el documento ya está anotado en otro lote (una recarga), no aporta nada
    -- y el lote se va como siempre.
    v_bloq_unico := exists (
      select 1 from tc_importacion_bloqueados b
       where b.lote_id = v_lote
         and not exists (select 1 from tc_importacion_bloqueados b2
                          where b2.empresa_id = b.empresa_id and b2.origen_sistema = b.origen_sistema
                            and b2.origen_doc = b.origen_doc and b2.lote_id <> v_lote));
    if v_n_creadas = 0 and not v_bloq_unico then
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

-- ── 11. Deshacer: una revisión humana conserva la intervención ─────────────
--
-- Igual que la fase 2 y con una comprobación más. Y conviene decir qué
-- garantiza y qué no:
--
--   · DESHACER LIMPIO: borra lo que metió la importación —intervención,
--     entradas, salidas, servicios, líneas, fichas e intervalos— y deja
--     intacto todo lo anterior. La fotografía previa vuelve a cuadrar.
--   · DESHACER CON MODIFICACIONES O RELACIONES POSTERIORES: las
--     intervenciones conflictivas se CONSERVAN, con el motivo escrito en
--     tc_importacion_intervenciones.motivo_conservada, y el lote queda
--     «parcialmente deshecho». No se fuerza nada.
--
-- Dos cosas que deshacer NO hace, a propósito:
--   · NO devuelve el contador de números internos a su valor anterior. Un
--     NT-2026-000123 emitido no se reutiliza nunca: el hueco se queda en el
--     contador y eso es lo correcto en una numeración que se ha visto.
--   · NO revierte modificaciones humanas. Si alguien tocó una operación o
--     revisó un intervalo, eso no se deshace: se conserva y se explica.
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

      -- Fase 3: una decisión humana sobre el uso estadístico de un intervalo
      -- de esta importación es una modificación posterior, y las
      -- modificaciones humanas no se revierten en silencio: la intervención
      -- se conserva con su motivo. La auditoría se queda donde está.
      if exists (select 1 from tc_reconstruccion_revisiones rv
                  where rv.operacion_entrada_id = any(f.operacion_ids)
                    and rv.invalidada_at is null and rv.decision in ('aceptado','rechazado')) then
        v_motivos := array_append(v_motivos, 'Tiene intervalos reconstruidos con una revisión humana (aceptada o rechazada)'); end if;
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
      -- La constancia de los bloqueados de este lote se va con él: no queda
      -- contexto de continuidad de una importación que ya no existe.
      delete from tc_importacion_bloqueados where lote_id = p_lote;
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

-- ── 12. La cobertura de las estadísticas estimadas ─────────────────────────
--
-- Ninguna media sin su cobertura. Esta función devuelve la media Y lo que ha
-- dejado fuera, porque una media de recorrido sobre 50 intervalos de 2.731
-- montajes no es una media de rendimiento de flota y el informe tiene que
-- decirlo.
--
-- Tres reglas de presentación que están dentro del dato, no en la pantalla:
--
--   · UNIDADES Y OCUPACIONES NO SE MEZCLAN. Una ocupación es el recorrido de
--     una POSICIÓN entre dos fechas, no el de un neumático: no se promedia
--     junto a las unidades identificadas ni se presenta como rendimiento
--     individual de una goma.
--   · LOS MOTIVOS DE EXCLUSIÓN SE SOLAPAN. Un intervalo puede ser anómalo Y
--     tener continuidad pendiente: aparece en los dos motivos. Por eso
--     `motivos` NO suma el total y se publica además `combinaciones`, que sí.
--   · ESTO ES ESTIMADO. `nivel` lo dice en el propio dato. Los informes de
--     rendimiento confirmado no leen esta tabla.
create or replace function tc_informes_recorridos_estimados(
  p_empresa  uuid default null,
  p_desde    date default null,
  p_hasta    date default null,
  p_vehiculo uuid default null
) returns jsonb language sql security invoker stable set search_path = public as $$
  with rango as (
    select coalesce(p_desde, (select min(fecha_montaje) from tc_reconstruccion_montajes
                               where (p_empresa is null or empresa_id = p_empresa)
                                 and (p_vehiculo is null or vehiculo_id = p_vehiculo)),
                    current_date) as d1,
           coalesce(p_hasta, (select max(fecha_montaje) from tc_reconstruccion_montajes
                               where (p_empresa is null or empresa_id = p_empresa)
                                 and (p_vehiculo is null or vehiculo_id = p_vehiculo)),
                    current_date) as d2
  ),
  pobl as (
    -- TRES identidades distintas, y no se mezclan:
    --   respaldada   → una persona ha identificado el neumático físico;
    --   reconstruida → hay FICHA (con su número interno) creada por la
    --                  importación, pero nadie ha confirmado qué goma era;
    --   sin_ficha    → no hay ni ficha.
    -- «Sin identificación física» NO es lo mismo que «sin ficha»: la ficha
    -- existe, sirve para enlazar el registro histórico, y lo que no demuestra
    -- es qué neumático estuvo montado todo el intervalo.
    select rm.*,
           tc_imp_intervalo_en_medias(rm) as entra,
           tc_imp_intervalo_motivos(rm)   as motivos,
           tc_imp_intervalo_duda_km(rm)   as duda_km,
           tc_imp_intervalo_duda_continuidad(rm) as duda_cont,
           case when rm.neumatico_id is null then 'sin_ficha'
                when coalesce(n.identidad_reconstruida, true) then 'reconstruida'
                else 'respaldada' end     as identidad
      from tc_reconstruccion_montajes rm
      left join tc_neumaticos n on n.id = rm.neumatico_id, rango
     where (p_empresa is null or rm.empresa_id = p_empresa)
       and (p_vehiculo is null or rm.vehiculo_id = p_vehiculo)
       and rm.fecha_montaje between rango.d1 and rango.d2
  ),
  dentro as (select * from pobl where entra),
  fuera  as (select * from pobl where not entra)
  select jsonb_build_object(
    'nivel', 'estimado',
    'aviso', 'Recorridos ESTIMADOS reconstruidos del histórico. No son rendimiento confirmado y los informes de rendimiento no los usan.',
    'periodo', jsonb_build_object(
      'desde', (select d1 from rango), 'hasta', (select d2 from rango),
      'origen', case when p_desde is null and p_hasta is null then 'todo el histórico cargado' else 'rango pedido' end),
    'poblacion', jsonb_build_object(
      'intervalos',  (select count(*) from pobl),
      'vehiculos',   (select count(distinct vehiculo_id) from pobl),
      'posiciones',  (select count(distinct posicion_id) from pobl where posicion_id is not null),
      'cerrados',    (select count(*) from pobl where estado = 'cerrado'),
      'abiertos',    (select count(*) from pobl where estado = 'abierto'),
      'interrumpidos', (select count(*) from pobl where estado = 'interrumpido')),
    -- Tener un recorrido que se puede restar NO es lo mismo que poder usarlo.
    -- Se publican los dos números para que nadie confunda uno con el otro.
    'embudo', jsonb_build_object(
      'con_recorrido_aritmetico', (select count(*) from pobl
         where estado = 'cerrado' and km_estado in ('utilizables','anomalos') and recorrido_km is not null),
      'elegibles_tras_filtros',   (select count(*) from dentro),
      'que_es', 'con_recorrido_aritmetico son los intervalos cuyo recorrido se puede calcular. elegibles_tras_filtros son los que además pasan los filtros de plausibilidad, continuidad y decisión humana. El segundo es el que sostiene la media.'),
    'identidad', jsonb_build_object(
      'respaldada',    (select count(*) from pobl where identidad = 'respaldada'),
      'reconstruida',  (select count(*) from pobl where identidad = 'reconstruida'),
      'sin_ficha',     (select count(*) from pobl where identidad = 'sin_ficha'),
      'que_es', 'respaldada = una persona ha identificado el neumático físico · reconstruida = hay ficha de la importación, con su número interno, pero nadie ha confirmado qué goma era · sin_ficha = no hay ficha. Solo la primera es una unidad identificada; «sin identificación física» no es lo mismo que «sin ficha».'),
    'incluidos', jsonb_build_object(
      'n',             (select count(*) from dentro),
      'respaldada',    (select count(*) from dentro where identidad = 'respaldada'),
      'reconstruida',  (select count(*) from dentro where identidad = 'reconstruida'),
      'sin_ficha',     (select count(*) from dentro where identidad = 'sin_ficha'),
      'aceptados_km',         (select count(*) from dentro where uso_estadistico = 'aceptado'),
      'aceptados_continuidad',(select count(*) from dentro where continuidad_decision = 'aceptada')),
    -- Por identidad, nunca en un solo número.
    'recorrido', jsonb_build_object(
      'identidad_respaldada', (select jsonb_build_object(
          'n', count(*), 'media', round(avg(recorrido_km)),
          'mediana', round(percentile_cont(0.5) within group (order by recorrido_km)),
          'minimo', min(recorrido_km), 'maximo', max(recorrido_km), 'total_km', sum(recorrido_km),
          'que_es', 'Recorrido estimado de un neumático que una persona ha identificado. Lo único que se acerca al rendimiento de una goma, y sigue siendo estimado.')
        from dentro where identidad = 'respaldada'),
      'ficha_reconstruida', (select jsonb_build_object(
          'n', count(*), 'media', round(avg(recorrido_km)),
          'mediana', round(percentile_cont(0.5) within group (order by recorrido_km)),
          'minimo', min(recorrido_km), 'maximo', max(recorrido_km), 'total_km', sum(recorrido_km),
          'que_es', 'Recorrido de la posición con una ficha creada por la importación. El número interno enlaza el registro histórico; NO demuestra qué neumático estuvo montado todo el intervalo. No es rendimiento individual.')
        from dentro where identidad = 'reconstruida'),
      'ocupacion_sin_ficha', (select jsonb_build_object(
          'n', count(*), 'media', round(avg(recorrido_km)),
          'mediana', round(percentile_cont(0.5) within group (order by recorrido_km)),
          'minimo', min(recorrido_km), 'maximo', max(recorrido_km), 'total_km', sum(recorrido_km),
          'que_es', 'Recorrido de la POSICIÓN entre dos fechas, sin ninguna goma asociada. No es el rendimiento de ningún neumático.')
        from dentro where identidad = 'sin_ficha')),
    'excluidos', jsonb_build_object(
      'n', (select count(*) from fuera),
      'motivos_se_solapan', true,
      'nota', 'Un intervalo puede tener varios motivos: «motivos» no suma el total y sumarlos contaría intervalos dos veces. «combinaciones» sí suma.',
      'motivos', (select coalesce(jsonb_agg(jsonb_build_object('motivo', m, 'n', n) order by n desc, m), '[]'::jsonb)
                  from (select m, count(*) n from fuera, unnest(motivos) m group by m) x),
      'combinaciones', (select coalesce(jsonb_agg(jsonb_build_object('motivos', to_jsonb(motivos), 'n', n) order by n desc), '[]'::jsonb)
                        from (select motivos, count(*) n from fuera group by motivos) y)),
    'revision', jsonb_build_object(
      'km_pendientes',          (select count(*) from pobl where duda_km and uso_estadistico = 'pendiente'),
      'km_aceptados',           (select count(*) from pobl where uso_estadistico = 'aceptado'),
      'km_rechazados',          (select count(*) from pobl where uso_estadistico = 'rechazado'),
      'continuidad_pendientes', (select count(*) from pobl where duda_cont and continuidad_decision = 'pendiente'),
      'continuidad_aceptadas',  (select count(*) from pobl where continuidad_decision = 'aceptada'),
      'continuidad_rechazadas', (select count(*) from pobl where continuidad_decision = 'rechazada')),
    'limite_km_dia', (select max(limite_km_dia) from pobl)
  )
$$;

-- ── 13. El informe de montajes publica también la cobertura ────────────────
--
-- Misma firma que la fase 2 —cuatro parámetros, mismos tipos y mismo orden—
-- para que PostgREST no vea una sobrecarga. El cuerpo es el de la fase 2 con
-- una clave más: `recorridos_estimados`.
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
  ) || jsonb_build_object(
    -- Fase 3: ninguna media sin su cobertura, y en el mismo sitio donde se
    -- leen los recuentos de montajes.
    'recorridos_estimados', tc_informes_recorridos_estimados(p_empresa, p_desde, p_hasta, null))
$$;

-- ── 14. Permisos ───────────────────────────────────────────────────────────
revoke all on function tc_imp_limite_km_dia(uuid) from public, anon;
revoke all on function tc_imp_fijar_limite_km_dia(uuid, numeric) from public, anon;
revoke all on function tc_imp_revisar_intervalo(uuid, text, text, text) from public, anon;
revoke all on function tc_imp_anotar_bloqueado(uuid, uuid, text, jsonb, text) from public, anon;
revoke all on function tc_informes_recorridos_estimados(uuid, date, date, uuid) from public, anon;
grant execute on function tc_imp_limite_km_dia(uuid) to authenticated, service_role;
grant execute on function tc_imp_fijar_limite_km_dia(uuid, numeric) to authenticated, service_role;
grant execute on function tc_imp_revisar_intervalo(uuid, text, text, text) to authenticated, service_role;
grant execute on function tc_informes_recorridos_estimados(uuid, date, date, uuid) to authenticated, service_role;
-- Los auxiliares: a quien los necesita y a nadie más.
--
-- PostgreSQL concede EXECUTE a PUBLIC en toda función nueva, así que un
-- `grant … to authenticated` NO quita el acceso de los demás: hay que
-- revocarlo. La vista tc_reconstruccion_intervalos es security_invoker, de
-- modo que quien la consulta necesita ejecutar estos cuatro; por eso se
-- conceden a authenticated y service_role, y se quitan de public y anon.
revoke all on function tc_imp_intervalo_en_medias(tc_reconstruccion_montajes) from public, anon;
revoke all on function tc_imp_intervalo_motivos(tc_reconstruccion_montajes) from public, anon;
revoke all on function tc_imp_intervalo_duda_km(tc_reconstruccion_montajes) from public, anon;
revoke all on function tc_imp_intervalo_duda_continuidad(tc_reconstruccion_montajes) from public, anon;
revoke all on function tc_imp_num(numeric) from public, anon;
grant execute on function tc_imp_intervalo_en_medias(tc_reconstruccion_montajes) to authenticated, service_role;
grant execute on function tc_imp_intervalo_motivos(tc_reconstruccion_montajes) to authenticated, service_role;
grant execute on function tc_imp_intervalo_duda_km(tc_reconstruccion_montajes) to authenticated, service_role;
grant execute on function tc_imp_intervalo_duda_continuidad(tc_reconstruccion_montajes) to authenticated, service_role;
grant execute on function tc_imp_num(numeric) to authenticated, service_role;

-- Y los auxiliares de la FASE 1, que se quedaron con el EXECUTE para PUBLIC
-- que pone PostgreSQL por defecto. Ninguno debería poder llamarlo cualquiera:
--   · tc_imp_bloquear toma el candado de importación de una empresa, así que
--     quien pudiera llamarlo podría bloquear las importaciones ajenas;
--   · tc_imp_posiciones_norma es `security definer` y lee vehículos y planos,
--     de modo que con PUBLIC cualquiera podría consultar el plano de un
--     vehículo que no es suyo;
--   · tc_imp_exigir_admin y tc_imp_medianoche no los usa nadie de fuera.
-- Se dejan accesibles a service_role porque el servidor los usa por dentro.
revoke all on function tc_imp_bloquear(uuid, text) from public, anon;
revoke all on function tc_imp_exigir_admin(uuid) from public, anon;
revoke all on function tc_imp_medianoche(date) from public, anon;
revoke all on function tc_imp_posiciones_norma(uuid, int, boolean) from public, anon;
grant execute on function tc_imp_bloquear(uuid, text) to service_role;
grant execute on function tc_imp_exigir_admin(uuid) to service_role;
grant execute on function tc_imp_medianoche(date) to service_role;
grant execute on function tc_imp_posiciones_norma(uuid, int, boolean) to authenticated, service_role;
