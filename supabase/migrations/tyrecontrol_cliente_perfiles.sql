-- ─────────────────────────────────────────────────────────────────────────────
-- TyreControl · Usuarios de cliente, fase 2 · Perfiles dentro del rol cliente
--
-- Un usuario de cliente puede ser de tres maneras:
--
--   · flota       Responsable de flota: ve toda su empresa. Es lo que había y
--                 lo que sigue valiendo si no se elige nada.
--   · delegacion  Jefe de base: ve SOLO los vehículos de su delegación y lo
--                 que cuelga de ellos (neumáticos, revisiones, trabajos,
--                 partes, incidencias, alertas).
--   · director    Ve toda su empresa, pero el panel solo le enseña los
--                 informes. En la base de datos lee lo mismo que el
--                 responsable de flota: son datos de su propia empresa.
--
-- Cómo se hace, y por qué así:
--
--   1. `tc_usuarios.perfil_cliente`, con los tres valores. El perfil solo
--      significa algo en el rol cliente: a los demás se les deja vacío.
--   2. Dos funciones, `tc_cliente_por_delegacion()` y
--      `tc_cliente_delegacion_id()`, que dicen si quien pregunta es un jefe
--      de base y de cuál.
--   3. Una regla NUEVA y RESTRICTIVA de lectura en cada tabla que cuelga de
--      un vehículo. Las reglas que ya había NO se tocan: la nueva se suma a
--      ellas y solo estrecha. Para todo el que no sea jefe de base la regla
--      es «pasa», y se resuelve una vez por consulta, no por fila.
--
-- A técnicos, administradores y a los usuarios de cliente que ya existan no
-- les cambia nada: hoy no hay ningún jefe de base.
--
-- Si un jefe de base se queda sin delegación (se borra la base), deja de ver
-- vehículos: ante la duda, no ve.
--
-- Lo que NO resuelve, y queda apuntado:
--   · Los vehículos sin delegación asignada no los ve ningún jefe de base.
--   · Los informes que hace el servidor (PDF mensual, de flota, de
--     revisiones, de pendientes) no saben filtrar por delegación: el servidor
--     se los niega al jefe de base hasta que sepan.
--
-- Al final se prueba sola: convierte por un momento a un usuario real en
-- jefe de base de la delegación con más vehículos, comprueba como él lo que
-- ve, y lo deshace todo. Si algo no cuadra, no se aplica nada.
--
-- Se puede pegar entera en el editor SQL de Supabase y repetir sin miedo.
-- ─────────────────────────────────────────────────────────────────────────────

do $migracion$
declare
  v_mal      text;
  v_fn       text;
  r          record;
  v_cond     text;
  v_usuario  uuid;
  v_empresa  uuid;
  v_deleg    uuid;
  v_n        bigint;
  v_esperado bigint;
  v_total    bigint;
  -- tabla · tipo de regla · columna
  --   D  la fila lleva la delegación en esa columna
  --   V  la fila lleva el vehículo en esa columna
  --   W  como V, pero una fila sin vehículo es general y se sigue viendo
  --   I  cuelga de una incidencia        P  cuelga de un parte (intervención)
  --   X  no es de ningún vehículo: un jefe de base no la ve
  v_tablas constant text[] := array[
    'tc_vehiculos:D:delegacion_id',
    'tc_delegaciones:D:id',
    'tc_lotes_revision:D:delegacion_id',
    'operaciones_neumaticos:V:vehiculo_id',
    'revisiones_vehiculo:V:vehiculo_id',
    'revisiones_neumaticos_detalle:V:vehiculo_id',
    'tc_alertas_presion:V:vehiculo_id',
    'tc_avisos_presion:V:vehiculo_id',
    'tc_historial_montajes:V:vehiculo_id',
    'tc_incidencias:V:vehiculo_id',
    'tc_intervenciones:V:vehiculo_id',
    'tc_mantenimiento_realizadas:V:vehiculo_id',
    'tc_montajes_actuales:V:vehiculo_id',
    'tc_neumaticos:V:vehiculo_id',
    'tc_partes_guiados:V:vehiculo_id',
    'tc_planes_mantenimiento:V:vehiculo_id',
    'tc_presiones_objetivo:W:vehiculo_id',
    'tc_reconstruccion_montajes:V:vehiculo_id',
    'tc_reconstruccion_revisiones:V:vehiculo_id',
    'tc_reservas_neumatico:V:vehiculo_id',
    'tc_tacografo_intervenciones:V:vehiculo_id',
    'tc_tacografo_medida_propuesta:V:vehiculo_id',
    'tc_vehiculo_atributos_tecnicos:V:vehiculo_id',
    'tc_vehiculo_documentos:V:vehiculo_id',
    'tc_vehiculo_ejes:V:vehiculo_id',
    'tc_vehiculo_ficha_historial:V:vehiculo_id',
    'tc_vehiculo_presencia_base:V:vehiculo_id',
    'tc_vehiculo_presencia_historico:V:vehiculo_id',
    'tc_vehiculo_revision_flag:V:vehiculo_id',
    'tc_vehiculo_webfleet_estado:V:vehiculo_id',
    'tc_webfleet_alertas:V:vehiculo_id',
    'tc_lote_vehiculos:V:vehiculo_id',
    'tc_importacion_bloqueados:V:vehiculo_id',
    'tc_incidencia_operaciones:I:incidencia_id',
    'tc_importacion_eventos:P:intervencion_id',
    'tc_importacion_intervenciones:P:intervencion_id',
    'tc_importacion_lineas:P:intervencion_id',
    'tc_importacion_cargas:X:',
    'tc_importacion_lotes:X:',
    'tc_tacografo_lotes:X:',
    'tc_tacografo_bloqueados:X:',
    'tc_etiquetas_lote:X:',
    'tc_etiquetas_foto:X:',
    'tc_reconstruccion_ajustes:X:'
  ];
begin
  -- ── Antes de tocar nada: que todo lo que se va a cambiar exista ───────────
  select string_agg(x.t, ', ') into v_mal
    from (select split_part(e, ':', 1) as t, split_part(e, ':', 3) as c
            from unnest(v_tablas) as e) x
   where not exists (select 1 from pg_class k
                      where k.relnamespace = 'public'::regnamespace
                        and k.relname = x.t and k.relkind = 'r' and k.relrowsecurity)
      or (x.c <> '' and not exists (
            select 1 from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = x.t and c.column_name = x.c));
  if v_mal is not null then
    raise exception 'Fase 2: faltan tablas o columnas, o no tienen RLS activado: %. No se toca nada.', v_mal;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tc_usuarios' and column_name = 'delegacion_id') then
    raise exception 'Fase 2: tc_usuarios no tiene delegacion_id. No se toca nada.';
  end if;

  -- ── 1. El perfil ──────────────────────────────────────────────────────────
  alter table public.tc_usuarios add column if not exists perfil_cliente text;
  alter table public.tc_usuarios drop constraint if exists tc_usuarios_perfil_cliente_chk;
  alter table public.tc_usuarios add constraint tc_usuarios_perfil_cliente_chk
    check (perfil_cliente is null or perfil_cliente in ('flota', 'delegacion', 'director'));
  comment on column public.tc_usuarios.perfil_cliente is
    'Solo en el rol cliente. flota (o vacío): toda la empresa. delegacion: solo su delegacion_id. director: toda la empresa, y el panel le enseña solo informes.';

  v_fn := $fn$
create or replace function public.tc_usuarios_perfil_cliente_valida()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  -- El perfil es cosa del rol cliente: a los demás se les quita, sin error.
  if new.rol::text <> 'cliente' or coalesce(new.es_superadmin, false) then
    new.perfil_cliente := null;
    return new;
  end if;
  if new.perfil_cliente = 'delegacion' then
    if new.delegacion_id is null then
      -- Si la delegación desaparece porque se ha borrado la base, se deja
      -- pasar: el jefe de base se queda sin ver nada hasta que le pongan otra.
      -- Lo que no se admite es guardarlo así a mano.
      if tg_op = 'UPDATE' and old.delegacion_id is not null and pg_trigger_depth() > 1 then
        return new;
      end if;
      raise exception 'Un jefe de base necesita una delegación' using errcode = '23514';
    end if;
    if not exists (select 1 from tc_delegaciones d
                    where d.id = new.delegacion_id and d.empresa_id = new.empresa_id) then
      raise exception 'Esa delegación no es de la empresa del usuario' using errcode = '23514';
    end if;
  end if;
  return new;
end $function$
$fn$;
  execute replace(v_fn, chr(13), '');
  drop trigger if exists tc_usuarios_perfil_cliente on public.tc_usuarios;
  create trigger tc_usuarios_perfil_cliente
    before insert or update on public.tc_usuarios
    for each row execute function public.tc_usuarios_perfil_cliente_valida();

  -- ── 2. Quién es jefe de base, y de cuál ───────────────────────────────────
  v_fn := $fn$
create or replace function public.tc_cliente_por_delegacion()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select u.rol::text = 'cliente' and not coalesce(u.es_superadmin, false)
                          and u.perfil_cliente = 'delegacion'
                     from tc_usuarios u where u.id = auth.uid()), false)
$function$
$fn$;
  execute replace(v_fn, chr(13), '');

  v_fn := $fn$
create or replace function public.tc_cliente_delegacion_id()
 returns uuid language sql stable security definer set search_path to 'public'
as $function$
  select u.delegacion_id from tc_usuarios u
   where u.id = auth.uid() and u.rol::text = 'cliente'
     and not coalesce(u.es_superadmin, false) and u.perfil_cliente = 'delegacion'
$function$
$fn$;
  execute replace(v_fn, chr(13), '');

  -- La que usarán las funciones y el servidor para preguntar por un vehículo.
  v_fn := $fn$
create or replace function public.tc_cliente_ve_vehiculo(p_vehiculo uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select not tc_cliente_por_delegacion()
      or exists (select 1 from tc_vehiculos v
                  where v.id = p_vehiculo and v.delegacion_id = tc_cliente_delegacion_id())
$function$
$fn$;
  execute replace(v_fn, chr(13), '');

  revoke all on function public.tc_cliente_por_delegacion() from public, anon;
  revoke all on function public.tc_cliente_delegacion_id() from public, anon;
  revoke all on function public.tc_cliente_ve_vehiculo(uuid) from public, anon;
  grant execute on function public.tc_cliente_por_delegacion() to authenticated, service_role;
  grant execute on function public.tc_cliente_delegacion_id() to authenticated, service_role;
  grant execute on function public.tc_cliente_ve_vehiculo(uuid) to authenticated, service_role;

  -- ── 3. La regla restrictiva, tabla por tabla ──────────────────────────────
  -- Las reglas de lectura que ya había siguen como estaban. Esta se suma:
  -- «o no eres jefe de base, o la fila es de tu delegación». Lo primero va
  -- en un sub-select para que se calcule una vez por consulta.
  for r in select split_part(e, ':', 1) as t, split_part(e, ':', 2) as k, split_part(e, ':', 3) as c
             from unnest(v_tablas) as e
  loop
    v_cond := case r.k
      when 'D' then format('%I = (select public.tc_cliente_delegacion_id())', r.c)
      when 'V' then format('%I in (select v.id from public.tc_vehiculos v where v.delegacion_id = (select public.tc_cliente_delegacion_id()))', r.c)
      when 'W' then format('%1$I is null or %1$I in (select v.id from public.tc_vehiculos v where v.delegacion_id = (select public.tc_cliente_delegacion_id()))', r.c)
      when 'I' then format('%I in (select i.id from public.tc_incidencias i)', r.c)
      when 'P' then format('%I in (select i.id from public.tc_intervenciones i)', r.c)
      when 'X' then 'false'
    end;
    if v_cond is null then
      raise exception 'Fase 2: tipo de regla desconocido para %', r.t;
    end if;
    execute format('drop policy if exists cliente_por_delegacion on public.%I', r.t);
    execute format(
      'create policy cliente_por_delegacion on public.%I as restrictive for select to public '
      || 'using ((not (select public.tc_cliente_por_delegacion())) or (%s))', r.t, v_cond);
  end loop;

  -- ── Comprobación: está todo puesto ────────────────────────────────────────
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and policyname = 'cliente_por_delegacion' and permissive = 'RESTRICTIVE';
  if v_n <> array_length(v_tablas, 1) then
    raise exception 'Fase 2: se esperaban % reglas y hay %', array_length(v_tablas, 1), v_n;
  end if;

  -- ── Prueba, con un usuario de verdad, y se deshace ────────────────────────
  select u.id into v_usuario from tc_usuarios u
   where u.activo and not coalesce(u.es_superadmin, false) and u.rol::text <> 'cliente'
   order by u.acceso_apk, u.created_at limit 1;
  select v.empresa_id, v.delegacion_id into v_empresa, v_deleg
    from tc_vehiculos v where v.delegacion_id is not null
   group by 1, 2 order by count(*) desc limit 1;

  if v_usuario is null or v_deleg is null then
    raise notice 'Fase 2: no hay usuario o delegación con vehículos con los que probar; se aplica sin la prueba de comportamiento.';
  else
    begin
      select count(*) into v_total from tc_vehiculos where empresa_id = v_empresa;
      select count(*) into v_esperado from tc_vehiculos where empresa_id = v_empresa and delegacion_id = v_deleg;

      -- Un jefe de base sin delegación no se puede guardar.
      begin
        update tc_usuarios set rol = 'cliente', empresa_id = v_empresa,
               perfil_cliente = 'delegacion', delegacion_id = null
         where id = v_usuario;
        raise exception 'Fase 2 (prueba): se ha guardado un jefe de base sin delegación';
      exception when sqlstate '23514' then null;
      end;

      update tc_usuarios set rol = 'cliente', empresa_id = v_empresa,
             perfil_cliente = 'delegacion', delegacion_id = v_deleg
       where id = v_usuario;
      -- La fase 1 ya le quita las empresas asignadas a quien pasa a cliente;
      -- aquí se asegura, para que la prueba mida solo la regla nueva.
      delete from tc_operador_empresas where usuario_id = v_usuario;

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_usuario::text, true);
      set local role authenticated;

      -- Jefe de base: sus vehículos y ni uno más.
      select count(*) into v_n from tc_vehiculos;
      if v_n <> v_esperado then
        reset role;
        raise exception 'Fase 2 (prueba): el jefe de base ve % vehículos y su delegación tiene %', v_n, v_esperado;
      end if;
      select count(*) into v_n from tc_delegaciones;
      if v_n <> 1 then
        reset role;
        raise exception 'Fase 2 (prueba): el jefe de base ve % delegaciones', v_n;
      end if;
      -- Y nada de lo que cuelga de un vehículo que no sea suyo.
      select (select count(*) from revisiones_vehiculo rv
               where rv.vehiculo_id not in (select id from tc_vehiculos))
           + (select count(*) from tc_montajes_actuales m
               where m.vehiculo_id not in (select id from tc_vehiculos))
           + (select count(*) from operaciones_neumaticos o
               where o.vehiculo_id not in (select id from tc_vehiculos))
           + (select count(*) from tc_intervenciones i
               where i.vehiculo_id is null or i.vehiculo_id not in (select id from tc_vehiculos))
           + (select count(*) from tc_neumaticos n where n.vehiculo_id is null)
           + (select count(*) from tc_importacion_lotes)
        into v_n;
      if v_n <> 0 then
        reset role;
        raise exception 'Fase 2 (prueba): el jefe de base lee % filas que no son de su delegación', v_n;
      end if;
      select tc_cliente_ve_vehiculo((select id from tc_vehiculos limit 1))::int into v_n;
      if v_esperado > 0 and v_n is distinct from 1 then
        reset role;
        raise exception 'Fase 2 (prueba): tc_cliente_ve_vehiculo niega un vehículo propio';
      end if;
      reset role;

      -- Responsable de flota y director: toda su empresa.
      update tc_usuarios set perfil_cliente = 'director', delegacion_id = null where id = v_usuario;
      set local role authenticated;
      select count(*) into v_n from tc_vehiculos;
      reset role;
      if v_n <> v_total then
        raise exception 'Fase 2 (prueba): el director ve % vehículos y su empresa tiene %', v_n, v_total;
      end if;
      update tc_usuarios set perfil_cliente = null where id = v_usuario;
      set local role authenticated;
      select count(*) into v_n from tc_vehiculos;
      reset role;
      if v_n <> v_total then
        raise exception 'Fase 2 (prueba): el responsable de flota ve % vehículos y su empresa tiene %', v_n, v_total;
      end if;

      -- Quien no es cliente pierde el perfil al guardarse.
      update tc_usuarios set rol = 'operador', perfil_cliente = 'delegacion', delegacion_id = v_deleg
       where id = v_usuario;
      if (select perfil_cliente from tc_usuarios where id = v_usuario) is not null then
        raise exception 'Fase 2 (prueba): un técnico se ha quedado con perfil de cliente';
      end if;

      raise exception using errcode = 'MB001', message = 'prueba superada';
    exception when sqlstate 'MB001' then
      reset role;
    end;
  end if;

  raise notice 'Fase 2 · perfiles de cliente: % tablas con la regla del jefe de base. Responsable de flota y director ven toda su empresa.', array_length(v_tablas, 1);
end
$migracion$;
