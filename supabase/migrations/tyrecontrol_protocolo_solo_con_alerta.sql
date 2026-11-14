-- El protocolo contra los falsos desgastes, solo cuando la última lectura da
-- alerta.
--
-- ── Qué cambia ───────────────────────────────────────────────────────────────
--
-- Hasta ahora la profundidad de TODAS las gomas era la mediana de sus tres
-- últimas lecturas. A partir de aquí:
--
--   · si la última lectura está por encima del mínimo —sea la única o venga
--     después de una alerta—, vale ELLA, tal cual, confirmada; es la que sale
--     en las alertas y en la ficha;
--   · si la última lectura está en el mínimo o por debajo —es decir, dispararía
--     la alerta—, decide el protocolo como hasta ahora: la mediana de las tres
--     últimas, y lo que no esté respaldado queda «por confirmar».
--
-- Así, una goma que dio alerta y la siguiente pasada del arco la lee bien, se
-- coge como buena. Y el ruido por encima del mínimo ya no se suaviza: se ve la
-- última lectura.
--
-- En Plana (medido en solo lectura): en rojo 64 → 53, por confirmar 22 → 17,
-- tarjetas 55 → 45. Las que salen son gomas cuya última pasada ya es buena (la
-- E1_IZQ del 4477MGP, que estaba a 4,0 y la última pasada leyó 13,9).
--
-- La misma regla está en el panel (services/protocoloProfundidad.ts,
-- `valorDeLaGoma`) y en la tablet (protocolo_profundidad.dart).
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
--
-- Igual que la anterior: un solo bloque que instala, se hace pasar por un
-- superadmin, un usuario de la empresa y un operador, cronometra con RLS, y si
-- no entra en el margen deja la versión que había. La función devuelve las
-- mismas columnas que la que había.

do $migracion$
declare
  c_limite_ms constant numeric := 4000;
  c_limite_operador_ms constant numeric := 7000;

  v_fn_protocolo text := $fn$create function tc_informes_alertas_vehiculos(p_empresa uuid default null)
returns table (
  vehiculo_id uuid,
  matricula text,
  numero_unidad text,
  tipo_vehiculo text,
  config_ejes text,
  imagen_chasis_url text,
  posicion_id uuid,
  codigo_posicion text,
  eje integer,
  lado text,
  interior_exterior text,
  neumatico_id uuid,
  codigo text,
  medida text,
  profundidad_mm numeric,
  minimo_mm numeric,
  fecha_revision date,
  presion_bar numeric,
  presion_recomendada_bar numeric,
  desviacion_pct numeric,
  presion_avisos integer,
  presion_aviso_at timestamptz,
  confirmada boolean,
  pendiente_mm numeric,
  pendiente_fecha date
)
language sql
stable
set jit to 'off'
set work_mem to '16MB'
as $function$
  with medidas as (
    -- Una sola pasada por el detalle: de cada fila se sabe, con una ventana
    -- sobre su revisión, si esa revisión midió todas sus ruedas.
    select d.neumatico_id, d.posicion_id, rv.vehiculo_id, d.profundidad_mm,
           rv.fecha_revision, rv.created_at,
           -- La midió un técnico y no el arco: su lectura no espera confirmación.
           (rv.tecnico_id is not null) as manual,
           (count(*) over w = count(d.profundidad_mm) over w) as completa
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    window w as (partition by d.revision_id)
  ),
  buenas as (
    select x.neumatico_id, x.posicion_id, x.vehiculo_id, x.profundidad_mm, x.fecha_revision, x.created_at, x.manual
    from medidas x
    where x.completa and x.profundidad_mm is not null
  ),
  atribuidas as (
    -- Las lecturas guardadas a nombre del neumático...
    select b.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at, b.manual
    from buenas b
    where b.neumatico_id is not null
    union all
    -- ...y las de SU POSICIÓN posteriores al día en que se montó en ella.
    select mo.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at, b.manual
    from buenas b
    join tc_montajes_actuales mo
      on mo.vehiculo_id = b.vehiculo_id and mo.posicion_id = b.posicion_id
    where b.fecha_revision > mo.fecha_montaje
      and b.neumatico_id is distinct from mo.neumatico_id
  ),
  ord as (
    select a.neumatico_id, a.profundidad_mm, a.fecha_revision, a.manual,
           row_number() over (partition by a.neumatico_id
                              order by a.fecha_revision desc, a.created_at desc) as k
    from atribuidas a
  ),
  tres as (
    -- Las tres últimas lecturas de cada goma, en columnas: u1 es la más reciente.
    select o.neumatico_id,
           max(o.profundidad_mm) filter (where o.k = 1) as u1,
           max(o.profundidad_mm) filter (where o.k = 2) as u2,
           max(o.profundidad_mm) filter (where o.k = 3) as u3,
           coalesce(bool_or(o.manual) filter (where o.k = 1), false) as m1,
           coalesce(bool_or(o.manual) filter (where o.k = 2), false) as m2,
           max(o.fecha_revision) filter (where o.k = 1) as f1,
           max(o.fecha_revision) filter (where o.k = 2) as f2,
           max(o.fecha_revision) filter (where o.k = 3) as f3
    from ord o
    where o.k <= 3
    group by o.neumatico_id
  ),
  ventana as (
    -- La medición a mano manda: lo anterior a la manual más reciente no cuenta,
    -- así que la ventana se corta en ella.
    select t.*,
           case when t.m1 then 1
                when t.m2 then 2
                when t.u3 is not null then 3
                when t.u2 is not null then 2
                else 1 end as n
    from tres t
  ),
  mediana as (
    select w.*,
           case when w.n = 3
                then w.u1 + w.u2 + w.u3 - greatest(w.u1, w.u2, w.u3) - least(w.u1, w.u2, w.u3)
           end as med
    from ventana w
  ),
  ult as (
    -- El protocolo, igual que en services/protocoloProfundidad.ts:
    --   tres lecturas    → la mediana; la última queda pendiente si se aparta > 2 mm
    --   dos que coinciden → la última
    --   dos que no        → la anterior, y la última pendiente
    --   una               → ella, sin confirmar (salvo que sea a mano)
    select c.neumatico_id,
           c.valor as profundidad_mm,
           case when c.valor = c.u1 then c.f1 when c.valor = c.u2 then c.f2 else c.f3 end as fecha_revision,
           c.confirmada,
           case when c.hay_pendiente then c.u1 end as pendiente_mm,
           case when c.hay_pendiente then c.f1 end as pendiente_fecha,
           -- La última lectura, tal cual: si no deja la goma en el mínimo, es la que vale.
           c.u1 as ultima_mm, c.f1 as ultima_fecha
    from (
      select m.*,
             case when m.n = 1 then m.u1
                  when m.n = 2 then case when abs(m.u1 - m.u2) <= 2 then m.u1 else m.u2 end
                  else m.med end as valor,
             case when m.n = 1 then m.m1
                  when m.n = 2 then (abs(m.u1 - m.u2) <= 2 or m.m2)
                  else true end as confirmada,
             case when m.n = 1 then false
                  when m.n = 2 then abs(m.u1 - m.u2) > 2
                  else abs(m.u1 - m.med) > 2 end as hay_pendiente
      from mediana m
    ) c
  ),
  ruedas as (
    select v.id as vehiculo_id, v.matricula, v.numero_unidad,
           tv.nombre as tipo_vehiculo,
           ce.nombre as config_ejes,
           coalesce(ce.imagen_chasis_url, tv.imagen_chasis_url) as imagen_chasis_url,
           p.id as posicion_id, p.codigo_posicion, p.eje, p.lado, p.interior_exterior,
           m.neumatico_id, coalesce(n.codigo_interno, n.numero_serie) as codigo, n.medida,
           u.profundidad_mm as prot_mm, u.fecha_revision as prot_fecha, u.confirmada as prot_confirmada,
           u.pendiente_mm as prot_pendiente_mm, u.pendiente_fecha as prot_pendiente_fecha,
           u.ultima_mm, u.ultima_fecha,
           coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm,
                    tc_profundidad_minima_por_llanta(n.medida), 1.6) as minimo_mm,
           pr.presion_bar, pr.presion_recomendada_bar, pr.desviacion_pct,
           pr.avisos as presion_avisos, pr.ultimo_aviso_at as presion_aviso_at
    from tc_vehiculos v
    join tc_tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
    join tc_posiciones_vehiculo p on p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo
    left join tc_config_ejes ce on ce.id = v.config_ejes_id
    left join tc_montajes_actuales m on m.vehiculo_id = v.id and m.posicion_id = p.id
    left join tc_neumaticos n on n.id = m.neumatico_id
    left join ult u on u.neumatico_id = m.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = v.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = v.empresa_id
         and tc_norm_medida(um.medida) = tc_norm_medida(n.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(n.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = v.empresa_id
         and uc.categoria = cm.categoria
    left join lateral (
      select a.presion_bar, a.presion_recomendada_bar, a.desviacion_pct, a.avisos, a.ultimo_aviso_at
      from tc_alertas_presion a
      where a.vehiculo_id = v.id and a.posicion_id = p.id and a.estado = 'abierta'
      order by a.ultimo_aviso_at desc nulls last
      limit 1
    ) pr on true
    where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  decididas as (
    -- El protocolo SOLO cuando la última lectura dispararía la alerta. Si la
    -- última está por encima del mínimo —sea la única o venga después de una
    -- alerta—, vale ella tal cual y es la que se ve. Si está en el mínimo o por
    -- debajo, decide el protocolo: la mediana de las tres últimas, y lo que no
    -- esté respaldado queda «por confirmar».
    select r.*,
           case when r.ultima_mm <= r.minimo_mm then r.prot_mm else r.ultima_mm end as profundidad_mm,
           case when r.ultima_mm <= r.minimo_mm then r.prot_fecha else r.ultima_fecha end as fecha_revision,
           case when r.ultima_mm is null then null
                when r.ultima_mm <= r.minimo_mm then r.prot_confirmada
                else true end as confirmada,
           case when r.ultima_mm <= r.minimo_mm then r.prot_pendiente_mm end as pendiente_mm,
           case when r.ultima_mm <= r.minimo_mm then r.prot_pendiente_fecha end as pendiente_fecha
    from ruedas r
  ),
  con_incidencias as (
    select r.*,
           -- Cuenta la goma en su mínimo (confirmada o no), la que tiene una
           -- lectura baja pendiente de confirmar y el aviso de presión.
           sum(case when (r.profundidad_mm is not null and r.profundidad_mm <= r.minimo_mm)
                      or (r.pendiente_mm is not null and r.pendiente_mm <= r.minimo_mm)
                      or r.presion_aviso_at is not null
                    then 1 else 0 end) over (partition by r.vehiculo_id) as incidencias
    from decididas r
  )
  select vehiculo_id, matricula, numero_unidad, tipo_vehiculo, config_ejes, imagen_chasis_url,
         posicion_id, codigo_posicion, eje, lado, interior_exterior,
         neumatico_id, codigo, medida,
         profundidad_mm, minimo_mm, fecha_revision,
         presion_bar, presion_recomendada_bar, desviacion_pct, presion_avisos, presion_aviso_at,
         confirmada, pendiente_mm, pendiente_fecha
  from con_incidencias
  where incidencias > 0
  order by matricula, eje, lado desc, interior_exterior nulls first;
$function$$fn$;

  v_fn_anterior text := $fn$create function tc_informes_alertas_vehiculos(p_empresa uuid default null)
returns table (
  vehiculo_id uuid,
  matricula text,
  numero_unidad text,
  tipo_vehiculo text,
  config_ejes text,
  imagen_chasis_url text,
  posicion_id uuid,
  codigo_posicion text,
  eje integer,
  lado text,
  interior_exterior text,
  neumatico_id uuid,
  codigo text,
  medida text,
  profundidad_mm numeric,
  minimo_mm numeric,
  fecha_revision date,
  presion_bar numeric,
  presion_recomendada_bar numeric,
  desviacion_pct numeric,
  presion_avisos integer,
  presion_aviso_at timestamptz,
  confirmada boolean,
  pendiente_mm numeric,
  pendiente_fecha date
)
language sql
stable
set jit to 'off'
set work_mem to '16MB'
as $function$
  with medidas as (
    -- Una sola pasada por el detalle: de cada fila se sabe, con una ventana
    -- sobre su revisión, si esa revisión midió todas sus ruedas.
    select d.neumatico_id, d.posicion_id, rv.vehiculo_id, d.profundidad_mm,
           rv.fecha_revision, rv.created_at,
           -- La midió un técnico y no el arco: su lectura no espera confirmación.
           (rv.tecnico_id is not null) as manual,
           (count(*) over w = count(d.profundidad_mm) over w) as completa
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    window w as (partition by d.revision_id)
  ),
  buenas as (
    select x.neumatico_id, x.posicion_id, x.vehiculo_id, x.profundidad_mm, x.fecha_revision, x.created_at, x.manual
    from medidas x
    where x.completa and x.profundidad_mm is not null
  ),
  atribuidas as (
    -- Las lecturas guardadas a nombre del neumático...
    select b.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at, b.manual
    from buenas b
    where b.neumatico_id is not null
    union all
    -- ...y las de SU POSICIÓN posteriores al día en que se montó en ella.
    select mo.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at, b.manual
    from buenas b
    join tc_montajes_actuales mo
      on mo.vehiculo_id = b.vehiculo_id and mo.posicion_id = b.posicion_id
    where b.fecha_revision > mo.fecha_montaje
      and b.neumatico_id is distinct from mo.neumatico_id
  ),
  ord as (
    select a.neumatico_id, a.profundidad_mm, a.fecha_revision, a.manual,
           row_number() over (partition by a.neumatico_id
                              order by a.fecha_revision desc, a.created_at desc) as k
    from atribuidas a
  ),
  tres as (
    -- Las tres últimas lecturas de cada goma, en columnas: u1 es la más reciente.
    select o.neumatico_id,
           max(o.profundidad_mm) filter (where o.k = 1) as u1,
           max(o.profundidad_mm) filter (where o.k = 2) as u2,
           max(o.profundidad_mm) filter (where o.k = 3) as u3,
           coalesce(bool_or(o.manual) filter (where o.k = 1), false) as m1,
           coalesce(bool_or(o.manual) filter (where o.k = 2), false) as m2,
           max(o.fecha_revision) filter (where o.k = 1) as f1,
           max(o.fecha_revision) filter (where o.k = 2) as f2,
           max(o.fecha_revision) filter (where o.k = 3) as f3
    from ord o
    where o.k <= 3
    group by o.neumatico_id
  ),
  ventana as (
    -- La medición a mano manda: lo anterior a la manual más reciente no cuenta,
    -- así que la ventana se corta en ella.
    select t.*,
           case when t.m1 then 1
                when t.m2 then 2
                when t.u3 is not null then 3
                when t.u2 is not null then 2
                else 1 end as n
    from tres t
  ),
  mediana as (
    select w.*,
           case when w.n = 3
                then w.u1 + w.u2 + w.u3 - greatest(w.u1, w.u2, w.u3) - least(w.u1, w.u2, w.u3)
           end as med
    from ventana w
  ),
  ult as (
    -- El protocolo, igual que en services/protocoloProfundidad.ts:
    --   tres lecturas    → la mediana; la última queda pendiente si se aparta > 2 mm
    --   dos que coinciden → la última
    --   dos que no        → la anterior, y la última pendiente
    --   una               → ella, sin confirmar (salvo que sea a mano)
    select c.neumatico_id,
           c.valor as profundidad_mm,
           case when c.valor = c.u1 then c.f1 when c.valor = c.u2 then c.f2 else c.f3 end as fecha_revision,
           c.confirmada,
           case when c.hay_pendiente then c.u1 end as pendiente_mm,
           case when c.hay_pendiente then c.f1 end as pendiente_fecha
    from (
      select m.*,
             case when m.n = 1 then m.u1
                  when m.n = 2 then case when abs(m.u1 - m.u2) <= 2 then m.u1 else m.u2 end
                  else m.med end as valor,
             case when m.n = 1 then m.m1
                  when m.n = 2 then (abs(m.u1 - m.u2) <= 2 or m.m2)
                  else true end as confirmada,
             case when m.n = 1 then false
                  when m.n = 2 then abs(m.u1 - m.u2) > 2
                  else abs(m.u1 - m.med) > 2 end as hay_pendiente
      from mediana m
    ) c
  ),
  ruedas as (
    select v.id as vehiculo_id, v.matricula, v.numero_unidad,
           tv.nombre as tipo_vehiculo,
           ce.nombre as config_ejes,
           coalesce(ce.imagen_chasis_url, tv.imagen_chasis_url) as imagen_chasis_url,
           p.id as posicion_id, p.codigo_posicion, p.eje, p.lado, p.interior_exterior,
           m.neumatico_id, coalesce(n.codigo_interno, n.numero_serie) as codigo, n.medida,
           u.profundidad_mm, u.fecha_revision, u.confirmada, u.pendiente_mm, u.pendiente_fecha,
           coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm,
                    tc_profundidad_minima_por_llanta(n.medida), 1.6) as minimo_mm,
           pr.presion_bar, pr.presion_recomendada_bar, pr.desviacion_pct,
           pr.avisos as presion_avisos, pr.ultimo_aviso_at as presion_aviso_at
    from tc_vehiculos v
    join tc_tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
    join tc_posiciones_vehiculo p on p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo
    left join tc_config_ejes ce on ce.id = v.config_ejes_id
    left join tc_montajes_actuales m on m.vehiculo_id = v.id and m.posicion_id = p.id
    left join tc_neumaticos n on n.id = m.neumatico_id
    left join ult u on u.neumatico_id = m.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = v.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = v.empresa_id
         and tc_norm_medida(um.medida) = tc_norm_medida(n.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(n.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = v.empresa_id
         and uc.categoria = cm.categoria
    left join lateral (
      select a.presion_bar, a.presion_recomendada_bar, a.desviacion_pct, a.avisos, a.ultimo_aviso_at
      from tc_alertas_presion a
      where a.vehiculo_id = v.id and a.posicion_id = p.id and a.estado = 'abierta'
      order by a.ultimo_aviso_at desc nulls last
      limit 1
    ) pr on true
    where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  con_incidencias as (
    select r.*,
           -- Cuenta la goma en su mínimo (confirmada o no), la que tiene una
           -- lectura baja pendiente de confirmar y el aviso de presión.
           sum(case when (r.profundidad_mm is not null and r.profundidad_mm <= r.minimo_mm)
                      or (r.pendiente_mm is not null and r.pendiente_mm <= r.minimo_mm)
                      or r.presion_aviso_at is not null
                    then 1 else 0 end) over (partition by r.vehiculo_id) as incidencias
    from ruedas r
  )
  select vehiculo_id, matricula, numero_unidad, tipo_vehiculo, config_ejes, imagen_chasis_url,
         posicion_id, codigo_posicion, eje, lado, interior_exterior,
         neumatico_id, codigo, medida,
         profundidad_mm, minimo_mm, fecha_revision,
         presion_bar, presion_recomendada_bar, desviacion_pct, presion_avisos, presion_aviso_at,
         confirmada, pendiente_mm, pendiente_fecha
  from con_incidencias
  where incidencias > 0
  order by matricula, eje, lado desc, interior_exterior nulls first;
$function$$fn$;

  v_empresa uuid;
  v_usuario uuid;
  v_quien text;
  v_t0 timestamptz;
  v_ms_vehiculos numeric;
  v_ms_informe numeric;
  v_n bigint;
  v_limite numeric;
  v_medicion text := '';
  v_intento int;
  v_fn text;
begin
  -- Pegado desde Windows el texto llega con CRLF: se le quita a todo lo que se
  -- va a comparar o a ejecutar.
  v_fn_protocolo := replace(v_fn_protocolo, chr(13), '');
  v_fn_anterior := replace(v_fn_anterior, chr(13), '');

  select rv.empresa_id into v_empresa
    from revisiones_vehiculo rv group by rv.empresa_id order by count(*) desc limit 1;

  -- Intento 1: con el protocolo, medida. Intento 2: la que había.
  for v_intento in 1..2 loop
    begin
      if v_intento = 1 then
        v_fn := v_fn_protocolo;
      else
        v_fn := v_fn_anterior;
      end if;

      -- 1. La función de las tarjetas. Se quita antes: `create or replace` no
      --    deja cambiar las columnas de vuelta y ya ha tenido varias formas.
      execute 'drop function if exists tc_informes_alertas_vehiculos(uuid)';
      execute v_fn;
      execute 'grant execute on function tc_informes_alertas_vehiculos(uuid) to authenticated';
      execute 'grant execute on function tc_informes_alertas_vehiculos(uuid) to service_role';

      -- La que había no se mide: ya pasó esta misma prueba al instalarse.
      if v_intento = 2 then
        v_medicion := 'RESERVA: se ha dejado la versión que había (protocolo en todas las gomas). '
                      || v_medicion;
        exit;
      end if;

      -- 3. La prueba: como la aplicación, con RLS y con usuarios de verdad.
      v_medicion := '';
      foreach v_quien in array array['superadmin', 'de la empresa', 'operador'] loop
        v_usuario := case v_quien
          when 'superadmin' then (select u.id from tc_usuarios u where u.es_superadmin order by u.id limit 1)
          when 'de la empresa' then (select u.id from tc_usuarios u
                                      where u.empresa_id = v_empresa and not u.es_superadmin order by u.id limit 1)
          else (select oe.usuario_id from tc_operador_empresas oe where oe.empresa_id = v_empresa order by 1 limit 1)
        end;
        continue when v_usuario is null;

        perform set_config('request.jwt.claims',
                           json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
        set local role authenticated;

        v_t0 := clock_timestamp();
        select count(*) into v_n from tc_informes_alertas_vehiculos(v_empresa);
        v_ms_vehiculos := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

        v_t0 := clock_timestamp();
        select count(*) into v_n from tc_informes_alertas(v_empresa);
        v_ms_informe := round(extract(epoch from clock_timestamp() - v_t0) * 1000);

        reset role;

        v_medicion := v_medicion || format('%s: tarjetas %s ms, informe %s ms. ', v_quien, v_ms_vehiculos, v_ms_informe);

        -- El límite va a una variable: un `case … then` dentro de la condición
        -- de un `if` le corta la condición al analizador de PL/pgSQL.
        v_limite := c_limite_ms;
        if v_quien = 'operador' then
          v_limite := c_limite_operador_ms;
        end if;
        if greatest(v_ms_vehiculos, v_ms_informe) > v_limite then
          raise exception using errcode = 'MB001',
            message = 'La versión nueva no entra en el margen. ' || v_medicion;
        end if;
      end loop;

      v_medicion := 'OK: protocolo solo cuando la última lectura da alerta. ' || v_medicion;
      exit;

    exception when sqlstate 'MB001' then
      -- El sub-bloque se ha deshecho entero —funciones y rol incluidos—: se
      -- guarda lo medido y se pasa al intento 2.
      v_medicion := sqlerrm;
    end;
  end loop;

  perform set_config('mobilink.medicion', v_medicion, false);
  raise notice '%', v_medicion;
end
$migracion$;

-- El resultado de la prueba y las cifras. Medido en solo lectura antes de
-- escribirla: 53 en rojo, 17 por confirmar, 45 tarjetas; la E2_DER_EXT del
-- 4310JYJ sigue en 8,5 mm con el 1,8 pendiente, porque su última lectura (1,8)
-- sí da alerta.
--
-- Las columnas nuevas se leen por `to_jsonb` y no por su nombre: si la prueba
-- ha dejado la versión de reserva, esas columnas no existen, y nombrarlas daría
-- un error que —yendo todo en una transacción— se llevaría por delante hasta
-- el mensaje que dice que se ha quedado la de reserva.

select current_setting('mobilink.medicion', true) as medicion,
       count(*) filter (where profundidad_mm <= minimo_mm and coalesce((f->>'confirmada')::boolean, true)) as en_rojo,
       count(*) filter (where not (profundidad_mm <= minimo_mm and coalesce((f->>'confirmada')::boolean, true))
                          and (profundidad_mm <= minimo_mm or (f->>'pendiente_mm')::numeric <= minimo_mm)) as por_confirmar,
       count(distinct vehiculo_id) as tarjetas,
       max(profundidad_mm || coalesce(' (pendiente ' || (f->>'pendiente_mm') || ')', ''))
         filter (where matricula = '4310JYJ' and codigo_posicion = 'E2_DER_EXT') as la_del_4310jyj
  from (select r.vehiculo_id, r.matricula, r.codigo_posicion, r.profundidad_mm, r.minimo_mm, to_jsonb(r) as f
          from tc_informes_alertas_vehiculos('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid) r) x;
