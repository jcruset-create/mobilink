-- El protocolo contra los falsos desgastes: la mediana de las tres últimas
-- lecturas, y lo que no esté confirmado se mide a mano.
--
-- ── El caso ─────────────────────────────────────────────────────────────────
--
-- Una goma del 4310JYJ, pasada a pasada por el arco:
--
--     8,6 · 8,6 · 8,6 · 10,7 · 8,0 · 8,1 · 9,2 · 8,7 · 8,5 · 1,8
--
-- Dos lecturas imposibles, y la última es una de ellas. Las dos revisiones
-- están COMPLETAS —midieron las seis ruedas—, así que la regla de las
-- revisiones incompletas no las para. Quedándose con la última, una goma de
-- 8,5 mm salía a 1,8 y con un «cambiar ya».
--
-- En toda la flota, desde junio: la mitad de las lecturas se mueve 0,3 mm o
-- menos respecto a la anterior, el 95 % menos de 1,2 mm, y un 2 % salta más de
-- 2 mm. De las alertas que había, 19 estaban desmentidas por las lecturas
-- anteriores y 9 gomas gastadas de verdad NO salían, tapadas por un pico hacia
-- arriba.
--
-- ── La regla ────────────────────────────────────────────────────────────────
--
-- El valor de una goma es la MEDIANA de sus tres últimas lecturas —de revisión
-- completa, y siguiendo a la posición desde el montaje, como hasta ahora—.
--
--   tres lecturas      la de en medio; la última queda PENDIENTE si se aparta
--                      más de 2 mm
--   dos que coinciden  la última
--   dos que no         la anterior, y la última pendiente
--   una sola           ella, sin confirmar
--
-- La medición A MANO manda: la de un técnico no espera confirmación, y lo
-- anterior a ella deja de contar. Se sabe que es a mano porque la revisión
-- tiene técnico; las del arco no lo tienen.
--
-- Los 2 mm salen del ruido medido: dejan pasar el 95 % y paran los disparates.
--
-- ── Lo que devuelve de más ──────────────────────────────────────────────────
--
-- `profundidad_mm` pasa a ser el valor dado por bueno, y se añaden:
--
--   confirmada        si otra lectura, o un técnico, lo respalda
--   pendiente_mm      la última lectura, cuando NO es la que se ha dado por buena
--   pendiente_fecha   de cuándo es
--
-- Con eso la pantalla decide: rojo si el valor bajo está confirmado; «por
-- confirmar» si lo bajo es un valor sin respaldo o una lectura pendiente. Lo
-- que está por confirmar va a la lista de ruedas para medir con sonda.
--
-- ── Lo que cambia en Plana ──────────────────────────────────────────────────
--
--     en rojo          81 → 64
--     por confirmar     0 → 22
--     tarjetas         54 → 55
--
-- `tc_informes_alertas` NO se toca esta vez: sigue con la última lectura. Ya no
-- pinta profundidades en ninguna pantalla —solo da los vehículos sin revisar—.
--
-- ── Se prueba sola ──────────────────────────────────────────────────────────
--
-- Mismo bloque único que las dos anteriores: instala, se hace pasar por un
-- superadmin, un usuario de la empresa y un operador, cronometra con RLS, y si
-- no entra en el margen deja la versión que había.

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
  presion_aviso_at timestamptz
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
           (count(*) over w = count(d.profundidad_mm) over w) as completa
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    window w as (partition by d.revision_id)
  ),
  buenas as (
    select x.neumatico_id, x.posicion_id, x.vehiculo_id, x.profundidad_mm, x.fecha_revision, x.created_at
    from medidas x
    where x.completa and x.profundidad_mm is not null
  ),
  atribuidas as (
    -- Las lecturas guardadas a nombre del neumático...
    select b.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at
    from buenas b
    where b.neumatico_id is not null
    union all
    -- ...y las de SU POSICIÓN posteriores al día en que se montó en ella, estén
    -- a nombre de quien estén o de nadie. Una goma que se da de alta tarde,
    -- con su fecha de montaje real, tiene sus mediciones a nombre de la
    -- anterior; y hay revisiones que guardan la fila sin neumático.
    --
    -- POSTERIORES, no «desde»: la lectura del mismo día del montaje suele ser
    -- la de la goma VIEJA, medida justo antes de cambiarla. Heredarla le
    -- pondría un «cambiar ya» a un neumático recién estrenado.
    select mo.neumatico_id, b.profundidad_mm, b.fecha_revision, b.created_at
    from buenas b
    join tc_montajes_actuales mo
      on mo.vehiculo_id = b.vehiculo_id and mo.posicion_id = b.posicion_id
    where b.fecha_revision > mo.fecha_montaje
      and b.neumatico_id is distinct from mo.neumatico_id
  ),
  ult as (
    select distinct on (a.neumatico_id)
           a.neumatico_id, a.profundidad_mm, a.fecha_revision
    from atribuidas a
    order by a.neumatico_id, a.fecha_revision desc, a.created_at desc
  ),
  ruedas as (
    select v.id as vehiculo_id, v.matricula, v.numero_unidad,
           tv.nombre as tipo_vehiculo,
           ce.nombre as config_ejes,
           coalesce(ce.imagen_chasis_url, tv.imagen_chasis_url) as imagen_chasis_url,
           p.id as posicion_id, p.codigo_posicion, p.eje, p.lado, p.interior_exterior,
           m.neumatico_id, coalesce(n.codigo_interno, n.numero_serie) as codigo, n.medida,
           u.profundidad_mm, u.fecha_revision,
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
           sum(case when (r.profundidad_mm is not null and r.profundidad_mm <= r.minimo_mm)
                      or r.presion_aviso_at is not null
                    then 1 else 0 end) over (partition by r.vehiculo_id) as incidencias
    from ruedas r
  )
  select vehiculo_id, matricula, numero_unidad, tipo_vehiculo, config_ejes, imagen_chasis_url,
         posicion_id, codigo_posicion, eje, lado, interior_exterior,
         neumatico_id, codigo, medida,
         profundidad_mm, minimo_mm, fecha_revision,
         presion_bar, presion_recomendada_bar, desviacion_pct, presion_avisos, presion_aviso_at
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
        v_medicion := 'RESERVA: se ha dejado la versión que había, sin el protocolo. '
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
            message = 'La versión con el protocolo no entra en el margen. ' || v_medicion;
        end if;
      end loop;

      v_medicion := 'OK, con el protocolo. ' || v_medicion;
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

-- El resultado de la prueba y las cifras: 64 en rojo y 22 por confirmar, y la
-- E2_DER_EXT del 4310JYJ en 8,5 mm con el 1,8 pendiente.
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
