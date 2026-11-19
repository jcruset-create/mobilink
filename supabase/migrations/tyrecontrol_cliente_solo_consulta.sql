-- ─────────────────────────────────────────────────────────────────────────────
-- TyreControl · Usuarios de cliente, fase 1 · El rol cliente, solo de consulta
--
-- Antes de dar de alta al primer usuario de un cliente (Plana), que el rol
-- `cliente` sea de verdad de solo lectura y no vea lo interno. Hoy, dentro de
-- su empresa, un usuario de cliente podía:
--
--   · leer las líneas de albarán importadas, CON PRECIOS (9.922 de Plana),
--     la tabla de precios por medida y las pausas de los técnicos;
--   · cambiar las presiones objetivo, que son las que disparan las alertas;
--   · subir, cambiar y borrar documentos y datos de la ficha técnica;
--   · pedir autorizaciones de operaciones y resolver incidencias;
--   · acabar con TODAS las empresas asignadas —y con ellas, permiso para
--     registrar operaciones— si alguien le marcaba la tablet o guardaba su
--     ficha con «todas las empresas».
--
-- Qué hace esta migración:
--
--   1. LECTURA. `tc_importacion_lineas`, `tc_precios_medida` y
--      `tc_pausas_trabajo`: un cliente no las lee.
--   2. ESCRITURA. Presiones objetivo, documentos y atributos de la ficha
--      técnica, su historial y las autorizaciones: un cliente no escribe.
--      Los documentos y atributos de SUS vehículos los sigue viendo.
--   3. `tc_resolver_incidencia_parcial`: rechaza al rol cliente.
--   4. ALTA A PRUEBA DE DESPISTES. Un usuario de cliente no puede tener
--      empresas asignadas ni acceso a la tablet: la base de datos se salta
--      esas filas y deja `acceso_apk` en falso, sin dar error, para que crear
--      una empresa nueva o guardar una ficha sigan funcionando.
--
-- A técnicos y administradores no les cambia nada: todas las condiciones
-- nuevas son «…y que no sea de rol cliente», y hoy no hay ningún usuario con
-- ese rol.
--
-- Lo que NO resuelve, y queda apuntado: los campos de coste de
-- `operaciones_neumaticos` (coste_material, coste_mano_obra, proveedor) y
-- `tc_neumaticos.coste_compra` siguen siendo legibles por quien ve la fila.
-- Hoy están vacíos en todas las empresas. El día que se empiecen a rellenar,
-- antes hay que sacarlos a una tabla aparte.
--
-- Al final se prueba sola: convierte por un momento a un usuario real en
-- cliente de una empresa con datos, comprueba como él lo que ve y lo que no
-- puede hacer, y lo deshace todo. Si algo no cuadra, no se aplica nada.
--
-- Se puede pegar entera en el editor SQL de Supabase y repetir sin miedo.
-- ─────────────────────────────────────────────────────────────────────────────

do $migracion$
declare
  v_mal      text;
  v_fn       text;
  v_def      text;
  v_usuario  uuid;
  v_empresa  uuid;
  v_n        bigint;
  v_esperado bigint;
  v_msg      text;
begin
  -- ── Antes de tocar nada: que todo lo que se va a cambiar exista ───────────
  select string_agg(x.t || '.' || x.p, ', ') into v_mal
    from (values
      ('tc_importacion_lineas',          'imp_lineas_sel',           'SELECT'),
      ('tc_precios_medida',              'tc_precios_medida_select', 'SELECT'),
      ('tc_pausas_trabajo',              'tc_pausas_sel',            'SELECT'),
      ('tc_presiones_objetivo',          'tc_presiones_write',       'ALL'),
      ('tc_vehiculo_documentos',         'veh_doc_all',              'ALL'),
      ('tc_vehiculo_atributos_tecnicos', 'veh_attr_all',             'ALL'),
      ('tc_vehiculo_ficha_historial',    'ficha_hist_insert',        'INSERT'),
      ('autorizaciones_operaciones',     'auth_op_insert',           'INSERT')
    ) as x(t, p, c)
   where not exists (
     select 1 from pg_policies pp
      where pp.schemaname = 'public' and pp.tablename = x.t
        and pp.policyname = x.p and pp.cmd = x.c);
  if v_mal is not null then
    raise exception 'Fase 1: estas políticas no existen o no son del tipo esperado: %. No se toca nada.', v_mal;
  end if;

  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'tc_resolver_incidencia_parcial') <> 1 then
    raise exception 'Fase 1: tc_resolver_incidencia_parcial no existe o está sobrecargada. No se toca nada.';
  end if;

  -- ── 1. Lo que un cliente no lee ───────────────────────────────────────────
  -- `(select tc_is_cliente())` y no la llamada a secas: así Postgres la
  -- calcula una vez por consulta y no una por fila (son 11.000 líneas).
  alter policy imp_lineas_sel on public.tc_importacion_lineas
    using (tc_puede_ver_empresa(empresa_id) and not (select tc_is_cliente()));
  alter policy tc_precios_medida_select on public.tc_precios_medida
    using (tc_puede_ver_empresa(empresa_id) and not (select tc_is_cliente()));
  alter policy tc_pausas_sel on public.tc_pausas_trabajo
    using (tc_puede_ver_empresa(empresa_id) and not (select tc_is_cliente()));

  -- ── 2. Lo que un cliente no escribe ───────────────────────────────────────
  alter policy tc_presiones_write on public.tc_presiones_objetivo
    using (tc_is_superadmin() or (empresa_id is not null
           and empresa_id = tc_auth_empresa_id() and not (select tc_is_cliente())))
    with check (tc_is_superadmin() or (empresa_id is not null
           and empresa_id = tc_auth_empresa_id() and not (select tc_is_cliente())));

  -- Documentos y atributos tenían UNA política para todo. Se le pone el
  -- «no cliente» y se añade otra solo de lectura, para que el cliente siga
  -- viendo la ficha de sus vehículos.
  alter policy veh_doc_all on public.tc_vehiculo_documentos
    using (tc_puede_ver_empresa(empresa_id) and not (select tc_is_cliente()))
    with check (tc_puede_ver_empresa(empresa_id) and not (select tc_is_cliente()));
  drop policy if exists veh_doc_select on public.tc_vehiculo_documentos;
  create policy veh_doc_select on public.tc_vehiculo_documentos
    for select to authenticated
    using (tc_puede_ver_empresa(empresa_id));

  alter policy veh_attr_all on public.tc_vehiculo_atributos_tecnicos
    using (not (select tc_is_cliente()) and exists (
             select 1 from tc_vehiculos v
              where v.id = tc_vehiculo_atributos_tecnicos.vehiculo_id
                and tc_puede_ver_empresa(v.empresa_id)))
    with check (not (select tc_is_cliente()) and exists (
             select 1 from tc_vehiculos v
              where v.id = tc_vehiculo_atributos_tecnicos.vehiculo_id
                and tc_puede_ver_empresa(v.empresa_id)));
  drop policy if exists veh_attr_select on public.tc_vehiculo_atributos_tecnicos;
  create policy veh_attr_select on public.tc_vehiculo_atributos_tecnicos
    for select to authenticated
    using (exists (
             select 1 from tc_vehiculos v
              where v.id = tc_vehiculo_atributos_tecnicos.vehiculo_id
                and tc_puede_ver_empresa(v.empresa_id)));

  alter policy ficha_hist_insert on public.tc_vehiculo_ficha_historial
    with check (not (select tc_is_cliente()) and exists (
             select 1 from tc_vehiculos v
              where v.id = tc_vehiculo_ficha_historial.vehiculo_id
                and tc_puede_ver_empresa(v.empresa_id)));

  alter policy auth_op_insert on public.autorizaciones_operaciones
    with check (solicitado_por = auth.uid() and tc_puede_ver_empresa(empresa_id)
                and not (select tc_is_cliente()));

  -- ── 3. Resolver incidencias ───────────────────────────────────────────────
  -- La función es larga y cambia a menudo, así que no se copia aquí: se lee la
  -- que hay en la base y se le pone el freno justo después de su único
  -- `begin`. Si ya lo lleva, no se toca.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'tc_resolver_incidencia_parcial';
  if v_def !~ 'FRENO_CLIENTE' then
    if (select count(*) from regexp_matches(v_def, '\mbegin\M', 'gi')) <> 1 then
      raise exception 'Fase 1: tc_resolver_incidencia_parcial ya no tiene un único «begin»; hay que ponerle el freno a mano. No se toca nada.';
    end if;
    v_fn := regexp_replace(v_def, '\mbegin\M',
      E'begin\n  -- FRENO_CLIENTE: un usuario de cliente solo consulta.\n'
      || E'  if tc_is_cliente() then\n'
      || E'    raise exception ''Tu usuario es de consulta: no puede resolver incidencias'' using errcode = ''42501'';\n'
      || E'  end if;\n', 'i');
    execute v_fn;
  end if;

  -- ── 4. Alta a prueba de despistes ─────────────────────────────────────────
  v_fn := $fn$
create or replace function public.tc_cliente_sin_empresas_asignadas()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  -- Una fila aquí da permiso de ESCRITURA en esa empresa. A un usuario de
  -- cliente se le salta, sin error: así crear una empresa nueva (que reparte
  -- filas a los técnicos) o guardar una ficha con «todas las empresas» siguen
  -- funcionando y sencillamente no le dan nada.
  if exists (select 1 from tc_usuarios u
              where u.id = new.usuario_id
                and u.rol::text = 'cliente' and not coalesce(u.es_superadmin, false)) then
    return null;
  end if;
  return new;
end $function$
$fn$;
  execute replace(v_fn, chr(13), '');

  v_fn := $fn$
create or replace function public.tc_cliente_sin_tablet()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.rol::text = 'cliente' and not coalesce(new.es_superadmin, false) then
    if tg_when = 'BEFORE' then
      -- La tablet es para trabajar, y un cliente solo consulta.
      new.acceso_apk := false;
    else
      -- Si antes era técnico, se le quitan las empresas que tuviera.
      delete from tc_operador_empresas where usuario_id = new.id;
    end if;
  end if;
  return new;
end $function$
$fn$;
  execute replace(v_fn, chr(13), '');

  -- Son de disparador: nadie tiene por qué llamarlas a mano.
  revoke execute on function public.tc_cliente_sin_empresas_asignadas() from public, anon, authenticated;
  revoke execute on function public.tc_cliente_sin_tablet() from public, anon, authenticated;

  drop trigger if exists tc_operador_empresas_no_cliente on public.tc_operador_empresas;
  create trigger tc_operador_empresas_no_cliente
    before insert or update on public.tc_operador_empresas
    for each row execute function public.tc_cliente_sin_empresas_asignadas();

  drop trigger if exists tc_usuarios_cliente_sin_tablet on public.tc_usuarios;
  create trigger tc_usuarios_cliente_sin_tablet
    before insert or update on public.tc_usuarios
    for each row execute function public.tc_cliente_sin_tablet();

  drop trigger if exists tc_usuarios_cliente_sin_empresas on public.tc_usuarios;
  create trigger tc_usuarios_cliente_sin_empresas
    after insert or update of rol, es_superadmin on public.tc_usuarios
    for each row execute function public.tc_cliente_sin_tablet();

  -- Por si ya hubiera alguno (hoy no hay): se pone al día.
  delete from tc_operador_empresas o
   using tc_usuarios u
   where u.id = o.usuario_id and u.rol::text = 'cliente' and not coalesce(u.es_superadmin, false);
  update tc_usuarios set acceso_apk = false
   where rol::text = 'cliente' and not coalesce(es_superadmin, false) and acceso_apk;

  -- ── Prueba, con un usuario de verdad, y se deshace ────────────────────────
  -- Se elige un usuario normal (mejor uno sin tablet) y la empresa con más
  -- líneas de albarán, que es donde se ve si el cierre funciona.
  select u.id into v_usuario from tc_usuarios u
   where u.activo and not coalesce(u.es_superadmin, false) and u.rol::text <> 'cliente'
   order by u.acceso_apk, u.created_at limit 1;
  select l.empresa_id into v_empresa from tc_importacion_lineas l
   group by 1 order by count(*) desc limit 1;
  if v_empresa is null then
    select v.empresa_id into v_empresa from tc_vehiculos v group by 1 order by count(*) desc limit 1;
  end if;

  if v_usuario is null or v_empresa is null then
    raise notice 'Fase 1: no hay usuario o empresa con los que probar; se aplica sin la prueba de comportamiento.';
  else
    begin
      -- Pasa a ser cliente de esa empresa. Tiene que salir de aquí sin
      -- tablet y sin empresas asignadas.
      update tc_usuarios set rol = 'cliente', empresa_id = v_empresa, acceso_apk = true
       where id = v_usuario;
      insert into tc_operador_empresas (usuario_id, empresa_id) values (v_usuario, v_empresa)
        on conflict do nothing;

      if (select acceso_apk from tc_usuarios where id = v_usuario) then
        raise exception 'Fase 1 (prueba): un cliente se ha quedado con acceso a la tablet';
      end if;
      if exists (select 1 from tc_operador_empresas where usuario_id = v_usuario) then
        raise exception 'Fase 1 (prueba): un cliente se ha quedado con empresas asignadas';
      end if;

      select count(*) into v_esperado from tc_vehiculos where empresa_id = v_empresa;

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_usuario::text, true);
      set local role authenticated;

      -- Lo suyo lo sigue viendo…
      select count(*) into v_n from tc_vehiculos;
      if v_n <> v_esperado then
        reset role;
        raise exception 'Fase 1 (prueba): el cliente ve % vehículos y su empresa tiene %', v_n, v_esperado;
      end if;
      -- …y lo interno no.
      select (select count(*) from tc_importacion_lineas)
           + (select count(*) from tc_precios_medida)
           + (select count(*) from tc_pausas_trabajo) into v_n;
      if v_n <> 0 then
        reset role;
        raise exception 'Fase 1 (prueba): el cliente sigue leyendo % filas de albaranes, precios o pausas', v_n;
      end if;
      -- No cambia presiones ni documentos (las filas ni las alcanza).
      with t as (update tc_presiones_objetivo set empresa_id = empresa_id returning 1)
        select count(*) into v_n from t;
      if v_n <> 0 then
        reset role;
        raise exception 'Fase 1 (prueba): el cliente ha podido tocar % presiones objetivo', v_n;
      end if;
      with t as (update tc_vehiculo_documentos set empresa_id = empresa_id returning 1)
        select count(*) into v_n from t;
      if v_n <> 0 then
        reset role;
        raise exception 'Fase 1 (prueba): el cliente ha podido tocar % documentos', v_n;
      end if;
      -- Ni resuelve incidencias: tiene que pararle el freno, no otra cosa.
      begin
        -- Se la llama con todo a nulo, sea cual sea su lista de parámetros.
        execute (
          select format('select public.tc_resolver_incidencia_parcial(%s)',
                        string_agg(format('null::%s', t.tipo::regtype), ', ' order by t.n))
            from pg_proc p, unnest(p.proargtypes::oid[]) with ordinality as t(tipo, n)
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'tc_resolver_incidencia_parcial');
        v_msg := 'no ha dado error';
      exception when others then
        v_msg := sqlerrm;
      end;
      reset role;
      if v_msg !~ 'es de consulta' then
        raise exception 'Fase 1 (prueba): resolver incidencias no ha parado al cliente (%).', v_msg;
      end if;

      -- Todo bien: se deshace la prueba entera.
      raise exception using errcode = 'MB001', message = 'prueba superada';
    exception when sqlstate 'MB001' then
      reset role;
    end;
  end if;

  raise notice 'Fase 1 · rol cliente: solo consulta. Sin albaranes, precios ni pausas; sin escribir; sin tablet ni empresas asignadas.';
end
$migracion$;
