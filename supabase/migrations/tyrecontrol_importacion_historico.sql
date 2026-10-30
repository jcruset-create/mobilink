-- ============================================================================
-- Importación del histórico de albaranes (Plana) como intervenciones
--
-- ── Qué es ──────────────────────────────────────────────────────────────────
--
-- Los albaranes del taller de 2026 están en un Excel: por cada albarán y
-- matrícula, líneas de «MONTA 2 CUBIERTAS NUEVAS 315/80R22.5», mano de obra,
-- contrapesas, revisión de flota… y, en otra hoja, las salidas del depósito
-- de neumáticos del cliente. Esto los convierte en lo que ya existe en
-- TyreControl: UNA tc_intervenciones por (empresa, albarán, matrícula), con
-- UNA fila de operaciones_neumaticos POR NEUMÁTICO y los servicios agregados
-- en tc_intervencion_servicios.
--
-- ── Lo que NUNCA hace ───────────────────────────────────────────────────────
--
-- No usa los RPC de montaje del taller: todos escriben tc_montajes_actuales
-- y pisarían lo que el autobús lleva HOY. Aquí se insertan las filas
-- directamente (comprobado: los triggers de operaciones_neumaticos no
-- escriben fuera en INSERT). No se crean fichas tc_neumaticos (neumatico_id
-- queda vacío: no se sabe qué goma era), ni montajes, ni movimientos de
-- stock, ni revisiones, ni se toca km_actual. No se crean vehículos: una
-- matrícula que no existe es una incidencia.
--
-- ── Cómo se reconoce el histórico ───────────────────────────────────────────
--
-- Por el vínculo con esta funcionalidad y nada más: `importacion_lote_id` en
-- la intervención, en cada operación y en cada servicio, con clave ajena a
-- tc_importacion_lotes. Ni `source='import'` (otras importaciones lo usan)
-- ni «tiene referencia de origen» valen como criterio.
--
-- ── Las dos huellas ─────────────────────────────────────────────────────────
--
-- `huella_origen`: lo que decía el Excel (la calcula el navegador sobre el
-- contenido normalizado del albarán). Misma identidad + misma huella = ya
-- presente; huella distinta = documento CAMBIADO, que se enseña y no se pisa.
--
-- `huella_estado`: lo que quedó GRABADO, calculado aquí releyendo las filas
-- tras el insert (con lo que pusieron los defaults). Deshacer la recalcula y,
-- si no coincide o hay filas añadidas, quitadas o relacionadas después, no
-- borra y dice por qué.
--
-- ── Hora desconocida ────────────────────────────────────────────────────────
--
-- Una intervención consta como cerrada por `cerrada_at`, y el albarán solo
-- trae fecha. Se pone la medianoche local de esa fecha y `hora_desconocida =
-- true`, que es lo que enseñan las pantallas. `created_at` es el momento real
-- de la importación, no se falsea.
-- ============================================================================

-- ── 1. Tablas de control ────────────────────────────────────────────────────

create table if not exists tc_importacion_cargas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references tc_empresas(id) on delete restrict,
  origen_sistema  text not null,
  fichero         text,
  sha256_fichero  text,
  estado          text not null default 'en_curso'
                  check (estado in ('en_curso','completa','con_errores','parcialmente_deshecha','deshecha')),
  resumen         jsonb,
  creado_por      uuid default auth.uid(),
  creado_at       timestamptz not null default now(),
  actualizado_at  timestamptz not null default now()
);
create index if not exists idx_imp_cargas_empresa on tc_importacion_cargas (empresa_id, creado_at desc);

create table if not exists tc_importacion_lotes (
  id              uuid primary key default gen_random_uuid(),
  carga_id        uuid not null references tc_importacion_cargas(id) on delete restrict,
  empresa_id      uuid not null references tc_empresas(id) on delete restrict,
  periodo         text not null,                       -- 'YYYY-MM'
  estado          text not null default 'aplicado'
                  check (estado in ('aplicado','parcialmente_deshecho','deshecho')),
  resumen         jsonb,
  aplicado_at     timestamptz not null default now(),
  deshecho_at     timestamptz
);
create index if not exists idx_imp_lotes_carga on tc_importacion_lotes (carga_id);

-- ── 2. El vínculo en las tablas de siempre ──────────────────────────────────

alter table tc_intervenciones
  add column if not exists importacion_lote_id uuid references tc_importacion_lotes(id) on delete restrict,
  add column if not exists origen_sistema      text,
  add column if not exists origen_doc          text,
  add column if not exists hora_desconocida    boolean not null default false;
create unique index if not exists uq_interv_origen
  on tc_intervenciones (empresa_id, origen_sistema, origen_doc) where origen_doc is not null;
create index if not exists idx_interv_imp_lote on tc_intervenciones (importacion_lote_id) where importacion_lote_id is not null;

alter table operaciones_neumaticos
  add column if not exists importacion_lote_id uuid references tc_importacion_lotes(id) on delete restrict,
  add column if not exists origen_sistema      text,
  add column if not exists origen_linea        text,
  add column if not exists grupo_origen        uuid,
  add column if not exists condicion           text check (condicion is null or condicion in ('nueva','usada','recauchutada')),
  add column if not exists marca_txt           text,
  add column if not exists modelo_txt          text,
  add column if not exists medida_txt          text,
  add column if not exists posicion_fuente     text check (posicion_fuente is null or posicion_fuente in ('indicada','deducida','desconocida'));
create unique index if not exists uq_op_origen
  on operaciones_neumaticos (empresa_id, origen_sistema, origen_linea) where origen_linea is not null;
create index if not exists idx_op_imp_lote on operaciones_neumaticos (importacion_lote_id) where importacion_lote_id is not null;

alter table tc_intervencion_servicios
  add column if not exists importacion_lote_id uuid references tc_importacion_lotes(id) on delete restrict,
  add column if not exists grupo_origen        uuid;

comment on column tc_intervenciones.importacion_lote_id is
  'Vínculo con la importación del histórico de albaranes. Es EL criterio de «histórico importado»: ni source ni origen_doc valen solos.';
comment on column tc_intervenciones.hora_desconocida is
  'El albarán solo trae fecha: cerrada_at es la medianoche local de ese día y no una hora real.';
comment on column operaciones_neumaticos.posicion_fuente is
  'indicada = la traía el origen; deducida = por la norma 2→eje 1 / 4→eje 2 sobre el plano ACTUAL del tipo; desconocida = sin posición.';

-- ── 3. Líneas de origen, con sus importes, una sola vez ─────────────────────

create table if not exists tc_importacion_lineas (
  id               uuid primary key default gen_random_uuid(),
  lote_id          uuid not null references tc_importacion_lotes(id) on delete restrict,
  empresa_id       uuid not null references tc_empresas(id) on delete restrict,
  intervencion_id  uuid references tc_intervenciones(id) on delete restrict,
  origen_sistema   text not null,
  origen_doc       text not null,
  origen_linea     text not null,
  hoja             text not null check (hoja in ('H1','H2')),
  documento        text,
  matricula        text,
  fecha            date,
  hora_origen      timestamptz,
  km_origen        numeric,
  codigo           text,
  descripcion      text,
  familia          text,
  categoria        text,
  marca            text,
  uds              numeric,
  precio_unidad    numeric,
  pct_dto          numeric,
  importe_linea    numeric,
  pct_iva          numeric,
  estado_documento text,
  articulo         text,
  carcasa_mov      text,
  almacen          text,
  usuario_origen   text,
  tipo_mov         text check (tipo_mov is null or tipo_mov in ('salida','entrada')),
  papel            text not null check (papel in (
                     'anotacion','articulo','salida','entrada','carcasa_base','mano_obra_montaje',
                     'mano_obra','servicio','material','revision_flota','num_vehiculo','ignorada')),
  grupo_origen     uuid,
  incidencia       text,
  creado_at        timestamptz not null default now(),
  unique (empresa_id, origen_sistema, origen_linea)
);
create index if not exists idx_imp_lineas_lote on tc_importacion_lineas (lote_id);
create index if not exists idx_imp_lineas_interv on tc_importacion_lineas (intervencion_id);

-- La fotografía de cada intervención importada: qué ids se crearon y cómo
-- quedaron. Es contra lo que compara «deshacer», nunca contra el Excel.
create table if not exists tc_importacion_intervenciones (
  intervencion_id  uuid primary key references tc_intervenciones(id) on delete restrict,
  lote_id          uuid not null references tc_importacion_lotes(id) on delete restrict,
  empresa_id       uuid not null references tc_empresas(id) on delete restrict,
  origen_doc       text not null,
  huella_origen    text not null,
  huella_estado    text not null,
  operacion_ids    uuid[] not null default '{}',
  servicio_ids     uuid[] not null default '{}',
  linea_ids        uuid[] not null default '{}',
  grabado_at       timestamptz not null default now(),
  -- Deshacer parcial: lo que se conservó y por qué.
  conservada_at    timestamptz,
  motivo_conservada text
);
create index if not exists idx_imp_interv_lote on tc_importacion_intervenciones (lote_id);

-- ── RLS: se lee como todo lo de la empresa; se escribe solo por los RPC ─────
alter table tc_importacion_cargas enable row level security;
alter table tc_importacion_lotes enable row level security;
alter table tc_importacion_lineas enable row level security;
alter table tc_importacion_intervenciones enable row level security;
drop policy if exists imp_cargas_sel on tc_importacion_cargas;
create policy imp_cargas_sel on tc_importacion_cargas for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists imp_lotes_sel on tc_importacion_lotes;
create policy imp_lotes_sel on tc_importacion_lotes for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists imp_lineas_sel on tc_importacion_lineas;
create policy imp_lineas_sel on tc_importacion_lineas for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists imp_interv_sel on tc_importacion_intervenciones;
create policy imp_interv_sel on tc_importacion_intervenciones for select using ( tc_puede_ver_empresa(empresa_id) );

-- ── 4. Utilidades ───────────────────────────────────────────────────────────

-- ¿Puede este usuario importar o deshacer en esta empresa?
create or replace function tc_imp_exigir_admin(p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_empresa is null then
    raise exception 'Sin empresa' using errcode = '22023';
  end if;
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador de la empresa puede importar o deshacer el histórico' using errcode = '42501';
  end if;
end $$;

-- Importar y deshacer toman ESTE mismo bloqueo: nunca corren a la vez para la
-- misma empresa y origen.
create or replace function tc_imp_bloquear(p_empresa uuid, p_origen text)
returns void language sql as $$
  select pg_advisory_xact_lock(hashtext(p_empresa::text || ':' || coalesce(p_origen, '')));
$$;

-- Medianoche local de una fecha. Convención, no hora real.
create or replace function tc_imp_medianoche(p_fecha date)
returns timestamptz language sql immutable as $$
  select (p_fecha::timestamp) at time zone 'Europe/Madrid';
$$;

-- La huella del ESTADO grabado: releída de las tablas, con todo lo que
-- pusieron defaults y triggers. Determinista: los arrays van ordenados.
create or replace function tc_imp_huella_estado(p_intervencion uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(jsonb_build_object(
    'i', (select to_jsonb(i) - 'resumen_ia' - 'updated_at' from tc_intervenciones i where i.id = p_intervencion),
    'o', (select coalesce(jsonb_agg(to_jsonb(o) order by o.origen_linea, o.id), '[]'::jsonb)
            from operaciones_neumaticos o where o.intervencion_id = p_intervencion),
    's', (select coalesce(jsonb_agg(to_jsonb(s) order by s.servicio, s.id), '[]'::jsonb)
            from tc_intervencion_servicios s where s.intervencion_id = p_intervencion),
    'l', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'g', l.grupo_origen, 'inc', l.incidencia, 'iv', l.intervencion_id)
                                    order by l.origen_linea), '[]'::jsonb)
            from tc_importacion_lineas l where l.intervencion_id = p_intervencion)
  )::text);
$$;

-- La norma de posiciones, sobre el plano ACTUAL del tipo del vehículo:
--   2 nuevas → eje 1, 4 nuevas → eje 2, solo si ese eje tiene exactamente
--   esas posiciones activas y TODAS las nuevas son la misma referencia.
-- Devuelve los ids de posición en orden visual, o nada (sin posición).
create or replace function tc_imp_posiciones_norma(p_vehiculo uuid, p_nuevas int, p_una_referencia boolean)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_tipo uuid; v_e1 uuid[]; v_e2 uuid[]; v_ids uuid[];
begin
  -- La norma de la casa, y solo con UNA referencia en el albarán:
  --   2 nuevas → el eje 1 entero (direccional).
  --   4 nuevas → el eje 2 entero (tracción).
  --   6 nuevas → 2 al eje 1 y 4 al eje 2, es decir el vehículo calzado entero.
  -- Si el plano del vehículo no encaja con esos números, no se deduce nada.
  if not p_una_referencia or p_nuevas not in (2, 4, 6) then return null; end if;
  select tipo_vehiculo_id into v_tipo from tc_vehiculos where id = p_vehiculo;
  if v_tipo is null then return null; end if;
  select array_agg(id order by orden_visual, codigo_posicion) filter (where eje = 1),
         array_agg(id order by orden_visual, codigo_posicion) filter (where eje = 2)
    into v_e1, v_e2
    from tc_posiciones_vehiculo
   where tipo_vehiculo_id = v_tipo and activo;
  v_ids := case p_nuevas
             when 2 then v_e1
             when 4 then v_e2
             else case when coalesce(array_length(v_e1, 1), 0) = 2 and coalesce(array_length(v_e2, 1), 0) = 4
                       then v_e1 || v_e2 end
           end;
  if coalesce(array_length(v_ids, 1), 0) <> p_nuevas then return null; end if;
  return v_ids;
end $$;

-- ── 5. Importar (o simular) un lote ─────────────────────────────────────────
--
-- p_lote:
-- { "periodo": "2026-10", "carga_id": uuid|null, "fichero": "...", "sha256_fichero": "...",
--   "forzar_docs": ["B2_26/4905|7724KBM"],       ← duplicados probables que el usuario acepta
--   "albaranes": [ {
--     "origen_doc": "B2_26/4905|7724KBM", "documento": "B2_26/4905", "matricula": "7724KBM",
--     "fecha": "2026-10-10", "km": 268659, "huella_origen": "…",
--     "resumen": "…", "observaciones": "…", "estado_documento": "Pendiente",
--     "bloqueante": null | "motivo",             ← el navegador ya lo clasificó; aquí se respeta y se vuelve a comprobar lo que se puede
--     "operaciones": [ { "origen_linea": "…|u1/2", "grupo": uuid, "condicion": "nueva",
--                        "marca": "Hankook", "modelo": "AH51 156L", "medida": "315/80R22.5", "observaciones": "…" } ],
--     "servicios":   [ { "servicio": "equilibrado", "cantidad": 2, "grupo": uuid } ],
--     "lineas":      [ { "origen_linea": "…", "hoja": "H1", "papel": "anotacion", "codigo": "…", … } ]
--   } ] }
--
-- La simulación NO escribe nada: ni filas, ni numeración (no se llama a
-- ninguna secuencia ni generador). Devuelve por albarán qué pasaría.

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

    -- La fotografía, releída de lo grabado.
    insert into tc_importacion_intervenciones (intervencion_id, lote_id, empresa_id, origen_doc, huella_origen, huella_estado,
                                               operacion_ids, servicio_ids, linea_ids)
    values (v_interv, v_lote, p_empresa, v_doc, v_huella, tc_imp_huella_estado(v_interv), v_op_ids, v_srv_ids, v_lin_ids);

    v_n_creadas := v_n_creadas + 1;
    v_resultados := v_resultados || jsonb_build_object('origen_doc', v_doc, 'estado', 'creada', 'intervencion_id', v_interv,
      'operaciones', array_length(v_op_ids, 1), 'servicios', coalesce(array_length(v_srv_ids, 1), 0),
      'lineas', coalesce(array_length(v_lin_ids, 1), 0), 'posiciones_deducidas', coalesce(array_length(v_pos, 1), 0));
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
      update tc_importacion_lotes set resumen = r - 'albaranes' where id = v_lote;
      -- Los albaranes bloqueados o cambiados no son un error de la carga: se
      -- enseñan en la vista previa y se deciden a mano. La carga está completa
      -- en cuanto sus lotes se han aplicado.
      update tc_importacion_cargas set actualizado_at = now(), estado = 'completa' where id = v_carga;
    end if;
  end if;
  return r;
end $$;

-- ── 6. Deshacer, con todas las comprobaciones ───────────────────────────────
--
-- Una transacción. Mismo bloqueo que importar. Luego se bloquean POR FILA
-- (for update) lote, fotografías, intervenciones, operaciones, servicios y
-- líneas: cualquier update de otra pantalla espera, y cualquier INSERT con
-- clave ajena hacia esas filas (adjuntos, incidencias, movimientos, nuevos
-- servicios u operaciones de la intervención) también, porque necesita
-- FOR KEY SHARE sobre el padre. Después se valida; si algo no cuadra no se
-- borra NADA de esa intervención y se devuelve el motivo. Con p_excluir se
-- conservan las conflictivas y la carga queda «parcialmente deshecha».

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
      if exists (select 1 from operaciones_neumaticos o where o.intervencion_id = f.intervencion_id and not (o.id = any(f.operacion_ids))) then
        v_motivos := array_append(v_motivos, 'Tiene operaciones añadidas después'); end if;
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
      delete from tc_importacion_lineas where id = any(f.linea_ids);
      delete from operaciones_neumaticos where id = any(f.operacion_ids);
      delete from tc_intervencion_servicios where id = any(f.servicio_ids);
      delete from tc_importacion_intervenciones where intervencion_id = f.intervencion_id;
      delete from tc_intervenciones where id = f.intervencion_id;
    end if;
  end loop;

  if not p_simular then
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

revoke all on function tc_importar_historico(uuid, text, jsonb, boolean) from public, anon;
revoke all on function tc_deshacer_importacion(uuid, uuid[], boolean) from public, anon;
grant execute on function tc_importar_historico(uuid, text, jsonb, boolean) to authenticated, service_role;
grant execute on function tc_deshacer_importacion(uuid, uuid[], boolean) to authenticated, service_role;
revoke all on function tc_imp_huella_estado(uuid) from public, anon;
grant execute on function tc_imp_huella_estado(uuid) to authenticated, service_role;

-- ── Anular frente a deshacer ────────────────────────────────────────────────
-- Deshacer una importación borra operaciones. Si alguien anulaba una de ellas
-- en ese mismo instante, la versión anterior de tc_anular_operacion la leía
-- sin bloquearla, esperaba en el UPDATE al commit del deshacer, actualizaba
-- CERO filas y seguía como si nada (la auditoría quedaba con operacion_id
-- nulo y el panel decía «anulada»). Ahora la fila se lee FOR UPDATE: si
-- deshacer la está borrando, se espera; si al llegar ya no existe, se dice
-- claramente y no se anula nada. El resto de la función no cambia.
create or replace function tc_anular_operacion(p_operacion uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare o record; v_filas int;
begin
  if p_motivo is null or trim(p_motivo) = '' then raise exception 'El motivo de anulación es obligatorio'; end if;
  select * into o from operaciones_neumaticos where id = p_operacion for update;
  if not found then raise exception 'La operación ya no existe; no se ha realizado la anulación'; end if;
  -- anular es una acción sensible: solo admin/superadmin
  if not (tc_is_superadmin() or (tc_is_admin() and o.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede anular operaciones';
  end if;
  if o.is_anulada then raise exception 'La operación ya está anulada'; end if;

  update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = p_operacion;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'La operación ya no existe; no se ha realizado la anulación'; end if;

  insert into tc_operacion_auditoria (operacion_id, accion, datos_anteriores, motivo)
  values (p_operacion, 'anular', jsonb_build_object('status', o.status, 'tipo', o.tipo_operacion), p_motivo);

  -- libera cualquier reserva asociada que siguiera activa
  update tc_reservas_neumatico set status = 'liberada', liberado_at = now(), liberado_por = auth.uid(),
    motivo_liberacion = 'operación anulada'
    where operacion_id = p_operacion and status = 'activa';
end $$;
