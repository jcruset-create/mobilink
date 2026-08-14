-- ============================================================
-- Mobilink TyreControl — Snapshot del stock al cerrar la intervención.
--
-- Fase 5 del rediseño de Intervenciones y Operaciones
-- (docs/ANALISIS_FASE0_intervenciones_operaciones.md, §D.1 fase 5; §5 del
-- prompt, criterios D y F). Requiere: fases 1-4 y la Decisión 1 regularizada
-- (comprobado en producción: apuntes pendientes a cero).
--
-- QUÉ RESUELVE
--
-- El informe de una intervención de hace seis meses debe enseñar el stock DE
-- ENTONCES, no el de hoy (criterio F). Y debe poder decir el efecto exacto:
-- Antes · Montados · Devueltos · Después (criterio D).
--
-- CÓMO (y por qué así)
--
-- · Al cerrar, tc_stock_snapshot_intervencion guarda en la propia fila
--   (tc_intervenciones.stock_snapshot, jsonb) DOS cosas:
--
--   "lineas": el estado COMPLETO del stock de la empresa en ese momento, tal
--   cual lo devuelve tc_stock_almacen_empresa — la fuente canónica que ya
--   usan panel y APK; aquí no se inventa otra consulta. Se guarda completo y
--   no solo lo afectado porque el informe tiene que responder "cómo quedó el
--   stock", y porque un jsonb autocontenido sobrevive a renombrados o bajas
--   de productos. Está acotado: la función ya filtra a productos con
--   existencias (decenas de líneas, no miles).
--
--   "efecto": SOLO los productos que esta intervención tocó, con
--   antes/después POR ARITMÉTICA sobre sus propias operaciones
--   (antes_nuevo = después + montados_nuevo; antes_usado = después +
--   montados_usado − devueltos_usado). Derivarlo de las operaciones y no de
--   la diferencia entre dos fotos evita atribuirle a esta intervención lo
--   que otra sesión concurrente hiciera con el mismo producto.
--
-- · Qué cuenta como qué (todo determinista, nada de IA):
--   MONTADO desde almacén = operación montaje/sustitución con
--     estado_anterior = 'almacen' y ficha con almacen_producto_id.
--     Nuevo/usado por el marcador [USADO] que tc_montar_desde_almacen deja
--     en observaciones desde la Decisión 1.
--   DEVUELTO = desmontaje/sustitución con destino = 'almacen' (la ficha
--     vuelve como usado; el nuevo nunca vuelve por cantidades).
--   SIN CONTROL DE STOCK (montaje directo / catálogo) queda FUERA del efecto
--     por construcción: esas fichas no tienen almacen_producto_id, y el
--     informe (fase 6) las etiqueta aparte. Descartes y reciclaje no tocan
--     stock y tampoco entran.
--
-- · tc_stock_almacen_empresa exigía usuario autenticado, pero el cierre lo
--   ejecuta el SERVIDOR con clave de servicio (auth.uid() nulo). Se relaja
--   el chequeo SOLO para contextos sin usuario (servicio / SQL editor) y, a
--   cambio, se le revoca EXECUTE a anon: antes anon no podía usarla porque
--   el chequeo reventaba; ahora no puede ni llamarla. Para los usuarios
--   reales no cambia nada.
--
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

-- ── 1. La columna del snapshot ──────────────────────────────────────────────
alter table tc_intervenciones add column if not exists stock_snapshot jsonb;

comment on column tc_intervenciones.stock_snapshot is
  'Foto del stock al cierre: {capturado_at, fuente, lineas[], efecto[]}. '
  'lineas = tc_stock_almacen_empresa completa; efecto = productos tocados '
  'por esta intervención con antes/después. La escribe '
  'tc_stock_snapshot_intervencion desde el cierre.';

-- ── 2. La fuente canónica, utilizable desde el contexto de servicio ─────────
-- Cuerpo IDÉNTICO al vigente (tyrecontrol_usados_por_ficha.sql, Decisión 1):
-- solo cambia el chequeo, que deja pasar los contextos SIN usuario.
create or replace function tc_stock_almacen_empresa(p_empresa uuid)
returns table(producto_id uuid, marca text, modelo text, medida text, nuevo numeric, usado numeric)
language plpgsql security definer set search_path = public as $$
declare v_cliente uuid;
begin
  -- auth.uid() nulo = clave de servicio (cierre de intervención) o SQL
  -- editor: no hay usuario que validar. anon no llega aquí: sin EXECUTE.
  if auth.uid() is not null
     and not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;

  return query
  with nuevos as (
    -- El nuevo sigue siendo cantidad en el libro de inventario.
    select ms.producto_id as pid,
           sum(case when ms.tipo='SALIDA' then -ms.cantidad else ms.cantidad end)::numeric as n
      from movimientos_stock ms
     where ms.cliente_id = v_cliente and ms.condicion = 'nuevo'
     group by ms.producto_id
  ),
  usados as (
    -- El usado es una goma concreta: se cuentan fichas, no apuntes.
    select p.id as pid, count(*)::numeric as u
      from tc_neumaticos n
      join productos_neumaticos p
        on p.id = coalesce(
             n.almacen_producto_id,
             (select p2.id from productos_neumaticos p2
               where p2.activo
                 and upper(p2.marca) = upper(n.marca)
                 and tc_medida_base(p2.medida) = tc_medida_base(n.medida)
               order by p2.id limit 1))
     where n.empresa_id = p_empresa
       and n.activo = true
       and n.estado in ('almacen','reservado')
     group by p.id
  )
  select p.id, p.marca, p.modelo, p.medida,
         coalesce(nv.n, 0), coalesce(us.u, 0)
    from productos_neumaticos p
    left join nuevos nv on nv.pid = p.id
    left join usados us on us.pid = p.id
   where coalesce(nv.n,0) <> 0 or coalesce(us.u,0) <> 0
   order by p.medida, p.marca;
end $$;

comment on function tc_stock_almacen_empresa(uuid) is
  'Stock por producto: el NUEVO por cantidades (movimientos_stock) y el USADO '
  'contando fichas de tc_neumaticos (Decisión 1, opción A). Fuente canónica '
  'del snapshot del informe. Llamable sin usuario (servicio); anon sin EXECUTE.';

do $$
declare r text;
begin
  foreach r in array array['anon'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function tc_stock_almacen_empresa(uuid) from %I', r);
    end if;
  end loop;
end $$;

-- ── 3. Capturar y guardar el snapshot ───────────────────────────────────────
create or replace function tc_stock_snapshot_intervencion(p_intervencion uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare i record; v_lineas jsonb; v_efecto jsonb; v_snap jsonb;
begin
  select * into i from tc_intervenciones where id = p_intervencion;
  if not found then raise exception 'Intervención no encontrada'; end if;
  -- Sin usuario = servicio (el cierre). Con usuario, el de siempre para VER.
  if auth.uid() is not null and not tc_puede_ver_empresa(i.empresa_id) then
    raise exception 'Sin permiso sobre esta intervención';
  end if;

  -- El estado completo, de la fuente canónica.
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', s.producto_id, 'marca', s.marca, 'modelo', s.modelo,
           'medida', s.medida, 'nuevo', s.nuevo, 'usado', s.usado)
         order by s.medida, s.marca), '[]'::jsonb)
    into v_lineas
    from tc_stock_almacen_empresa(i.empresa_id) s;

  -- El efecto de ESTA intervención, desde sus operaciones reales.
  with ops as (
    select o.tipo_operacion, o.estado_anterior, o.destino, o.observaciones,
           n.almacen_producto_id as producto_id,
           coalesce(p.marca, n.marca)   as marca,
           coalesce(p.modelo, n.modelo) as modelo,
           coalesce(p.medida, n.medida) as medida
      from operaciones_neumaticos o
      left join tc_neumaticos n on n.id = o.neumatico_id
      left join productos_neumaticos p on p.id = n.almacen_producto_id
     where o.intervencion_id = p_intervencion
       and not o.is_anulada and o.status = 'completada'
  ),
  tocado as (
    select producto_id, max(marca) as marca, max(modelo) as modelo, max(medida) as medida,
           count(*) filter (where tipo_operacion in ('montaje','sustitucion')
                              and estado_anterior = 'almacen'
                              and position('[USADO]' in coalesce(observaciones,'')) = 0) as montados_nuevo,
           count(*) filter (where tipo_operacion in ('montaje','sustitucion')
                              and estado_anterior = 'almacen'
                              and position('[USADO]' in coalesce(observaciones,'')) > 0) as montados_usado,
           count(*) filter (where tipo_operacion in ('desmontaje','sustitucion')
                              and estado_anterior = 'montado'
                              and destino = 'almacen') as devueltos_usado
      from ops
     where producto_id is not null  -- sin producto = sin control de stock: fuera del efecto
     group by producto_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producto_id', t.producto_id, 'marca', t.marca, 'modelo', t.modelo, 'medida', t.medida,
           'montados_nuevo', t.montados_nuevo, 'montados_usado', t.montados_usado,
           'devueltos_usado', t.devueltos_usado,
           'despues_nuevo', coalesce(s.nuevo, 0), 'despues_usado', coalesce(s.usado, 0),
           -- Antes por aritmética sobre las operaciones propias: inmune a lo
           -- que otras sesiones hicieran a la vez con el mismo producto.
           'antes_nuevo', coalesce(s.nuevo, 0) + t.montados_nuevo,
           'antes_usado', coalesce(s.usado, 0) + t.montados_usado - t.devueltos_usado)
         order by t.medida, t.marca), '[]'::jsonb)
    into v_efecto
    from tocado t
    left join tc_stock_almacen_empresa(i.empresa_id) s on s.producto_id = t.producto_id
   where t.montados_nuevo + t.montados_usado + t.devueltos_usado > 0;

  v_snap := jsonb_build_object(
    'capturado_at', now(),
    'fuente', 'tc_stock_almacen_empresa',
    'lineas', v_lineas,
    'efecto', v_efecto
  );

  update tc_intervenciones set stock_snapshot = v_snap where id = p_intervencion;
  return v_snap;
end $$;

comment on function tc_stock_snapshot_intervencion(uuid) is
  'Captura y guarda en la intervención la foto del stock (completa, de '
  'tc_stock_almacen_empresa) y el efecto de la intervención con '
  'antes/después. La llama el cierre; reejecutarla regenera la foto.';

grant execute on function tc_stock_snapshot_intervencion(uuid) to authenticated;
do $$
declare r text;
begin
  foreach r in array array['anon'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function tc_stock_snapshot_intervencion(uuid) from %I', r);
    end if;
  end loop;
end $$;

-- ── 4. Auto-test (rollback al final: no persiste nada) ──────────────────────
--
-- Aquí solo la mecánica sin depender de productos_neumaticos (sus columnas
-- obligatorias varían entre entornos): el escenario D completo (4 nuevos/2
-- usados → montar 2 nuevos, devolver 1 usado → 2 y 3) está probado en local
-- con esquema replicado; ver el commit de la fase 5.
do $$
declare v_emp uuid; v_int uuid; v_snap jsonb;
begin
  begin
    insert into tc_empresas (nombre) values ('TEST fase5 snapshot (rollback)') returning id into v_emp;
    insert into tc_intervenciones (empresa_id, cerrada_at) values (v_emp, now()) returning id into v_int;

    -- Empresa sin enlace de almacén: el snapshot es honesto (vacío), no un error.
    v_snap := tc_stock_snapshot_intervencion(v_int);
    if v_snap->'lineas' is null or v_snap->'efecto' is null then
      raise exception 'FALLO: el snapshot no trae lineas/efecto';
    end if;
    if (select stock_snapshot from tc_intervenciones where id = v_int) is null then
      raise exception 'FALLO: el snapshot no se ha guardado en la intervención';
    end if;

    -- La fuente canónica es llamable sin usuario (contexto de servicio).
    perform tc_stock_almacen_empresa(v_emp);

    raise exception 'TC_TEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'TC_TEST_ROLLBACK' then raise; end if;
  end;
  raise notice 'Auto-test del snapshot de stock: OK (todo revertido)';
end $$;

-- ── 5. Comprobación ─────────────────────────────────────────────────────────
do $$
declare n int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'tc_intervenciones' and column_name = 'stock_snapshot'
  ) then
    raise exception 'Falta tc_intervenciones.stock_snapshot';
  end if;

  select count(*) into n from pg_proc where proname = 'tc_stock_snapshot_intervencion';
  if n <> 1 then raise exception 'Hay % versiones de tc_stock_snapshot_intervencion (se esperaba 1)', n; end if;

  -- El snapshot lee de la fuente canónica, no inventa otra consulta.
  select count(*) into n from pg_proc
   where proname = 'tc_stock_snapshot_intervencion' and prosrc like '%tc_stock_almacen_empresa%';
  if n <> 1 then raise exception 'El snapshot no lee de tc_stock_almacen_empresa'; end if;

  -- La fuente canónica conserva la Decisión 1 (usados por fichas) y admite
  -- el contexto de servicio.
  select count(*) into n from pg_proc
   where proname = 'tc_stock_almacen_empresa'
     and prosrc like '%tc_neumaticos%' and prosrc like '%movimientos_stock%'
     and prosrc like '%auth.uid() is not null%';
  if n <> 1 then raise exception 'tc_stock_almacen_empresa ha perdido la Decisión 1 o el contexto de servicio'; end if;

  -- anon no puede ni llamarlas (si el rol existe).
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege('anon', 'tc_stock_almacen_empresa(uuid)', 'execute')
       or has_function_privilege('anon', 'tc_stock_snapshot_intervencion(uuid)', 'execute') then
      raise exception 'anon no debería poder ejecutar las funciones de stock';
    end if;
  end if;

  raise notice 'OK: snapshot de stock al cierre instalado (columna, captura, fuente canonica en contexto de servicio)';
end $$;
