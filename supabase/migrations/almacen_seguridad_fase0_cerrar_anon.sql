-- ─────────────────────────────────────────────────────────────────────────────
-- Almacén · Seguridad, fase 0.4 · Cerrar el acceso sin iniciar sesión
--
-- Las tablas del almacén se podían leer —y varias modificar— con la clave
-- anónima, es decir, sin iniciar sesión: traspasos, movimientos de stock,
-- solicitudes de reposición, auditoría, usuarios activos y productos. Es un
-- resto de cuando la APK de Stock Flow no tenía login.
--
-- Hoy nadie lo necesita:
--   · La APK (>= 1.2.0) entra por /api/almacen/login-operario y abre sesión.
--   · La web del almacén entra con sesión.
--   · El servidor usa la clave de servicio.
-- Y las reglas para usuarios con sesión ya existen y son más finas (por
-- cliente y por ubicación). Esas NO se tocan.
--
-- Qué hace:
--   1. Quita las políticas que eran solo para `anon` en las seis tablas.
--   2. Quita a `anon` los permisos sobre esas tablas y sobre la vista
--      `traspasos_auditoria_detalle`.
--   3. ARREGLA un fallo que ya existía: `traspasos_auditoria` solo tenía
--      políticas para `anon`, así que una app con sesión no podía apuntar en
--      ella (al aceptar o recibir un traspaso, la auditoría fallaba). Se le
--      dan sus políticas de usuario con sesión: lee y apunta quien tiene
--      ficha de almacén, o un administrador.
--
-- Una política «para anon» no se aplica a quien tiene sesión, así que quitarla
-- no puede cambiar nada a un usuario que ha entrado con su usuario y PIN.
--
-- NO es `saas_fase1c_almacen_cerrar_anon.sql`: aquella además añadía una
-- política «cualquier usuario con sesión, todo», que hoy AFLOJARÍA las reglas
-- por cliente y ubicación que ya hay. No aplicar aquella.
--
-- Vuelta atrás: al final del fichero, comentada.
-- Se puede pegar entera en el editor SQL de Supabase y repetir sin miedo.
-- ─────────────────────────────────────────────────────────────────────────────

do $migracion$
declare
  v_tablas constant text[] := array[
    'traspasos', 'traspasos_auditoria', 'movimientos_stock',
    'solicitudes_reposicion', 'perfiles_usuario', 'productos_neumaticos'
  ];
  v_vista  constant text := 'traspasos_auditoria_detalle';
  v_mal    text;
  r        record;
  v_quitadas int := 0;
begin
  -- ── Antes de tocar nada ───────────────────────────────────────────────────
  select string_agg(t, ', ') into v_mal from unnest(v_tablas) t
   where to_regclass('public.' || t) is null;
  if v_mal is not null then
    raise exception 'Fase 0.4: faltan estas tablas, no se toca nada: %', v_mal;
  end if;

  -- Sin RLS, quitar las políticas de anon no cerraría nada; y quitarle los
  -- permisos sí, pero conviene saberlo antes.
  select string_agg(c.relname, ', ') into v_mal from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname = any (v_tablas)
     and not c.relrowsecurity;
  if v_mal is not null then
    raise exception 'Fase 0.4: estas tablas no tienen RLS activada, hay que mirarlo antes: %', v_mal;
  end if;

  -- Quien tiene sesión tiene que seguir teniendo con qué trabajar: cada tabla
  -- (menos la de auditoría, que se arregla aquí) ya debe tener su política de
  -- lectura para usuarios con sesión. Si no, cerrar anon dejaría la tabla
  -- inservible y habría que entender por qué funcionaba.
  select string_agg(t, ', ') into v_mal from unnest(v_tablas) t
   where t <> 'traspasos_auditoria'
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t
          and p.cmd in ('SELECT', 'ALL')
          and (p.roles && array['authenticated', 'public']::name[]));
  if v_mal is not null then
    raise exception 'Fase 0.4: estas tablas no tienen política de lectura para usuarios con sesión: %. No se toca nada.', v_mal;
  end if;

  if not has_function_privilege('authenticated', 'public.usuario_actual_es_admin()', 'execute')
     or not has_function_privilege('authenticated', 'public.usuario_actual_perfil_id()', 'execute') then
    raise exception 'Fase 0.4: authenticated no puede ejecutar las funciones de permisos del almacén. No se toca nada.';
  end if;

  -- ── 3. La auditoría, para quien tiene sesión ──────────────────────────────
  drop policy if exists traspasos_auditoria_select_con_ficha on public.traspasos_auditoria;
  create policy traspasos_auditoria_select_con_ficha on public.traspasos_auditoria
    for select to authenticated
    using (usuario_actual_es_admin() or usuario_actual_perfil_id() is not null);

  drop policy if exists traspasos_auditoria_insert_con_ficha on public.traspasos_auditoria;
  create policy traspasos_auditoria_insert_con_ficha on public.traspasos_auditoria
    for insert to authenticated
    with check (usuario_actual_es_admin() or usuario_actual_perfil_id() is not null);

  grant select, insert on public.traspasos_auditoria to authenticated;

  -- ── 1. Fuera las políticas que eran SOLO para anon ────────────────────────
  for r in
    select p.tablename, p.policyname from pg_policies p
     where p.schemaname = 'public' and p.tablename = any (v_tablas)
       and p.roles = array['anon']::name[]
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    v_quitadas := v_quitadas + 1;
  end loop;

  -- ── 2. Y los permisos de anon ─────────────────────────────────────────────
  for r in select unnest(v_tablas) t loop
    execute format('revoke all on public.%I from anon', r.t);
  end loop;
  if to_regclass('public.' || v_vista) is not null then
    execute format('revoke all on public.%I from anon', v_vista);
  end if;

  -- ── Comprobar ─────────────────────────────────────────────────────────────
  select string_agg(t, ', ') into v_mal from unnest(v_tablas || v_vista) t
   where to_regclass('public.' || t) is not null
     and (has_table_privilege('anon', 'public.' || t, 'select')
       or has_table_privilege('anon', 'public.' || t, 'insert')
       or has_table_privilege('anon', 'public.' || t, 'update')
       or has_table_privilege('anon', 'public.' || t, 'delete'));
  if v_mal is not null then
    raise exception 'Fase 0.4: anon sigue teniendo permisos en: %', v_mal;
  end if;

  select string_agg(p.tablename || '.' || p.policyname, ', ') into v_mal from pg_policies p
   where p.schemaname = 'public' and p.tablename = any (v_tablas) and 'anon' = any (p.roles);
  if v_mal is not null then
    raise exception 'Fase 0.4: quedan políticas que nombran a anon: %', v_mal;
  end if;

  select string_agg(t, ', ') into v_mal from unnest(v_tablas) t
   where not has_table_privilege('authenticated', 'public.' || t, 'select');
  if v_mal is not null then
    raise exception 'Fase 0.4: los usuarios con sesión se han quedado sin lectura en: %', v_mal;
  end if;

  raise notice 'Fase 0.4 · almacén: % políticas de anon quitadas; 6 tablas y la vista cerradas a quien no tiene sesión.', v_quitadas;
end
$migracion$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VUELTA ATRÁS. Solo si alguna tablet con una APK anterior a la 1.2.0 se queda
-- fuera. Deja el acceso sin sesión exactamente como estaba el 15/11/2026.
-- Quitar los «--» y pegar.
--
-- grant select, insert, update on public.traspasos, public.traspasos_auditoria,
--   public.movimientos_stock, public.solicitudes_reposicion to anon;
-- grant select on public.perfiles_usuario, public.productos_neumaticos,
--   public.traspasos_auditoria_detalle to anon;
-- create policy anon_insert_movimientos on public.movimientos_stock for insert to anon with check (true);
-- create policy anon_read_movimientos on public.movimientos_stock for select to anon using (true);
-- create policy anon_read_activos on public.perfiles_usuario for select to anon using (activo = true);
-- create policy anon_read_productos on public.productos_neumaticos for select to anon using (true);
-- create policy anon_read_solicitudes on public.solicitudes_reposicion for select to anon using (true);
-- create policy anon_update_solicitudes on public.solicitudes_reposicion for update to anon using (true) with check (true);
-- create policy anon_insert_traspasos on public.traspasos for insert to anon with check (true);
-- create policy anon_read_traspasos on public.traspasos for select to anon using (true);
-- create policy anon_update_traspasos on public.traspasos for update to anon using (true) with check (true);
-- create policy anon_insert_auditoria on public.traspasos_auditoria for insert to anon with check (true);
-- create policy anon_read_auditoria on public.traspasos_auditoria for select to anon using (true);
-- ─────────────────────────────────────────────────────────────────────────────
