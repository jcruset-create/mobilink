-- ============================================================
-- Administración — Fase 12: la licencia manda en el alta de usuarios
--
-- Hasta ahora `app_guardar_usuario` aceptaba cualquier módulo. El acceso
-- se guardaba en `app_usuario_modulos`, pero `app_mis_modulos()` cruza con
-- `app_licencias` al entrar: el administrador veía el módulo marcado, el
-- usuario no lo veía en su hub, y no había nada que explicara por qué.
-- El `max_usuarios` de la licencia, además, no lo miraba nadie.
--
-- Tres reglas, decididas a propósito:
--
--   1) Un acceso NUEVO exige licencia vigente de la empresa del usuario.
--   2) Un acceso YA GUARDADO se conserva aunque su licencia haya vencido.
--      Editar el teléfono de alguien no puede quitarle accesos por un
--      vencimiento que nadie ha decidido; y si se renueva, sigue donde
--      estaba. Lo que se prohíbe es AÑADIR sobre una licencia vencida.
--   3) `max_usuarios` se cuenta sobre usuarios ACTIVOS: uno desactivado no
--      gasta licencia. El superadmin de Mobilink puede pasarse del aforo
--      -es quien la vende- y eso queda en `app_auditoria`.
--
-- Y el aislamiento entre empresas: un administrador de empresa gestiona
-- los usuarios de la suya; solo el superadmin cruza de una a otra.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── Licencias que le tocan a un usuario, para pintar la pantalla ──
--
-- Devuelve UNA FILA POR MÓDULO LICENCIADO de su empresa, con lo que hace
-- falta para explicarse: si está vigente, cuándo caduca y cuánto aforo
-- queda. Con p_user_id null responde por la empresa del administrador,
-- que es el caso del alta.
create or replace function app_licencias_usuario(p_user_id uuid default null)
returns table (
  modulo       text,
  estado       text,
  fecha_fin    date,
  vigente      boolean,
  max_usuarios integer,
  usados       integer
)
language sql stable security definer set search_path = public as $$
  with empresa as (
    select coalesce(
      (select u.empresa_id from app_usuarios u where u.id = p_user_id),
      app_empresa_actual(),
      '00000000-0000-4000-a000-000000000001'::uuid) as id
  )
  select
    l.modulo,
    l.estado,
    l.fecha_fin,
    (l.estado = 'activa'
      and l.fecha_inicio <= current_date
      and (l.fecha_fin is null or l.fecha_fin >= current_date)) as vigente,
    l.max_usuarios,
    (select count(*)::int
       from app_usuario_modulos m
       join app_usuarios u on u.id = m.user_id
      where m.modulo = l.modulo
        and u.empresa_id = (select id from empresa)
        and u.activo) as usados
  from app_licencias l
  where l.empresa_id = (select id from empresa)
    and app_es_admin()
  order by l.modulo, l.fecha_inicio desc
$$;
grant execute on function app_licencias_usuario(uuid) to authenticated;

-- ── Alta y edición de usuarios, con la licencia por delante ──
create or replace function app_guardar_usuario(
  p_id uuid,
  p_username text,
  p_nombre text,
  p_email_recuperacion text,
  p_telefono text,
  p_activo boolean,
  p_es_superadmin boolean,
  p_employee_id uuid,
  p_accesos jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_acc jsonb;
  v_pantallas text[];
  v_empresa uuid;
  v_empresa_previa uuid;
  v_modulo text;
  v_soy_super boolean;
  v_ya_tenia boolean;
  v_tope integer;
  v_usados integer;
  v_nuevos text[] := '{}';
begin
  if not app_es_admin() then
    raise exception 'Solo un administrador puede gestionar usuarios';
  end if;
  if p_id is null then raise exception 'Falta el id del usuario de Auth'; end if;
  if p_username is null or length(trim(p_username)) < 2 then
    raise exception 'El nombre de usuario debe tener al menos 2 caracteres';
  end if;
  if exists (select 1 from app_usuarios where lower(username) = lower(trim(p_username)) and id <> p_id) then
    raise exception 'Ya existe un usuario con ese nombre';
  end if;
  -- un empleado de Core no puede tener dos cuentas: la ficha del empleado y
  -- la pantalla de Usuarios escriben sobre la misma fila.
  if p_employee_id is not null and exists (
    select 1 from app_usuarios where employee_id = p_employee_id and id <> p_id
  ) then
    raise exception 'Ese empleado ya tiene una cuenta de acceso';
  end if;

  select coalesce(es_superadmin, false) into v_soy_super
  from app_usuarios where id = auth.uid();
  v_soy_super := coalesce(v_soy_super, false);

  select empresa_id into v_empresa_previa from app_usuarios where id = p_id;

  select coalesce(
           v_empresa_previa,
           app_empresa_actual(),
           '00000000-0000-4000-a000-000000000001'::uuid)
    into v_empresa;

  -- Cada administrador, con los suyos. Sin esto, un admin de una empresa
  -- cliente podría editar usuarios de otra con solo saberse el id.
  if not v_soy_super
     and v_empresa_previa is not null
     and v_empresa_previa is distinct from app_empresa_actual() then
    raise exception 'Ese usuario es de otra empresa';
  end if;

  insert into app_usuarios (id, username, nombre, email_recuperacion, telefono, activo, es_superadmin, employee_id, empresa_id)
  values (p_id, trim(p_username), trim(p_nombre), nullif(trim(coalesce(p_email_recuperacion,'')),''),
          nullif(trim(coalesce(p_telefono,'')),''), coalesce(p_activo, true),
          coalesce(p_es_superadmin, false), p_employee_id, v_empresa)
  on conflict (id) do update set
    username = excluded.username,
    nombre = excluded.nombre,
    email_recuperacion = excluded.email_recuperacion,
    telefono = excluded.telefono,
    activo = excluded.activo,
    es_superadmin = excluded.es_superadmin,
    employee_id = excluded.employee_id;

  -- Licencia: solo para lo que se AÑADE ahora. Lo que ya estaba guardado
  -- pasa sin preguntar, aunque su licencia haya vencido (regla 2).
  for v_acc in select jsonb_array_elements(coalesce(p_accesos,'[]'::jsonb)) loop
    v_modulo := v_acc->>'modulo';
    select exists (
      select 1 from app_usuario_modulos where user_id = p_id and modulo = v_modulo
    ) into v_ya_tenia;

    if not v_ya_tenia then
      if not app_licencia_activa(v_empresa, v_modulo) then
        raise exception 'Tu empresa no tiene licencia vigente de %, así que no se puede dar ese acceso', v_modulo;
      end if;
      v_nuevos := v_nuevos || v_modulo;
    end if;
  end loop;

  -- quitar accesos que ya no están en la lista
  delete from app_usuario_modulos
  where user_id = p_id
    and modulo not in (select jsonb_array_elements(coalesce(p_accesos,'[]'::jsonb))->>'modulo');

  -- upsert de los accesos indicados
  for v_acc in select jsonb_array_elements(coalesce(p_accesos,'[]'::jsonb)) loop
    if jsonb_typeof(v_acc->'pantallas') = 'array' then
      select array_agg(x) into v_pantallas from jsonb_array_elements_text(v_acc->'pantallas') as x;
    else
      v_pantallas := null;
    end if;
    insert into app_usuario_modulos (user_id, modulo, rol, pantallas, empresa_id)
    values (p_id, v_acc->>'modulo', v_acc->>'rol', v_pantallas, nullif(v_acc->>'empresa_id','')::uuid)
    on conflict (user_id, modulo) do update
      set rol = excluded.rol, pantallas = excluded.pantallas, empresa_id = excluded.empresa_id;
  end loop;

  -- Aforo: se cuenta DESPUÉS de guardar, porque el que se acaba de dar de
  -- alta también ocupa plaza. Si se pasa, el raise deshace la transacción
  -- entera y el usuario no queda a medias.
  foreach v_modulo in array v_nuevos loop
    select max(l.max_usuarios) into v_tope
    from app_licencias l
    where l.empresa_id = v_empresa and l.modulo = v_modulo and l.estado = 'activa'
      and l.fecha_inicio <= current_date
      and (l.fecha_fin is null or l.fecha_fin >= current_date);

    if v_tope is not null then
      select count(*)::int into v_usados
      from app_usuario_modulos m
      join app_usuarios u on u.id = m.user_id
      where m.modulo = v_modulo and u.empresa_id = v_empresa and u.activo;

      if v_usados > v_tope then
        if v_soy_super then
          -- El superadmin vende la licencia: puede pasarse, pero queda dicho.
          insert into app_auditoria (empresa_id, user_id, accion, entidad, entidad_id, detalle)
          values (v_empresa, auth.uid(), 'licencia.aforo_superado', 'app_usuario_modulos', p_id::text,
                  jsonb_build_object('modulo', v_modulo, 'tope', v_tope, 'usados', v_usados));
        else
          raise exception 'La licencia de % es para % usuarios y ya hay %', v_modulo, v_tope, v_usados;
        end if;
      end if;
    end if;
  end loop;

  return p_id;
end $$;

-- ── Regularizar lo que YA está en uso ────────────────────────
--
-- Hay módulos que nunca se sembraron como licencia -`central` y `tacografos`
-- aparecen en los CHECK pero en ningún INSERT-, y hasta hoy daba igual: el
-- alta de usuarios no miraba la licencia. A partir de ahora sí, así que sin
-- esto el primer día nadie podría dar un acceso nuevo a esos módulos.
--
-- La regla es conservadora: se crea licencia SOLO donde ya hay alguien
-- usándolo. No regala módulos; pone por escrito lo que la empresa ya tiene
-- concedido, que es justo lo que se estaba dando por bueno en silencio.
insert into app_licencias (empresa_id, modulo)
select distinct u.empresa_id, m.modulo
from app_usuario_modulos m
join app_usuarios u on u.id = m.user_id
where not exists (
  select 1 from app_licencias l
  where l.empresa_id = u.empresa_id and l.modulo = m.modulo
);
