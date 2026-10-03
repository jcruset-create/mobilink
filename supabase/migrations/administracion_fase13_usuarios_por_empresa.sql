-- ============================================================
-- Administración — Fase 13: cada administrador ve los usuarios de SU empresa
--
-- La fase 12 cerró la ESCRITURA entre empresas: un administrador que no es
-- superadmin no puede editar usuarios de otra. La LECTURA se quedó abierta:
--
--   app_usuarios_select ... using ( id = auth.uid() or app_es_admin() )
--
-- `app_es_admin()` es cierto para el superadmin de Mobilink Y para el rol
-- `admin` de cualquier empresa cliente. Así que el administrador de un cliente
-- podía listar los usuarios de TODOS los demás: nombre, login, teléfono y
-- correo de recuperación. No se notaba porque la pantalla era una lista plana
-- dentro de Administración; al pasar a gestionarse por empresa, salta a la
-- vista.
--
-- A partir de aquí:
--   · superadmin de Mobilink: ve y gestiona todas las empresas;
--   · administrador de empresa: solo la suya;
--   · cualquier usuario: su propia fila, como hasta ahora.
--
-- La barrera está en la base y no en la pantalla: quien llame a la API con su
-- token tampoco verá nada de otra empresa.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── Helper: ¿soy el superadmin de Mobilink? ──────────────────
-- `app_es_admin()` mezcla superadmin y admin de empresa, y para repartir por
-- empresa hace falta distinguirlos.
create or replace function app_es_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_superadmin from app_usuarios where id = auth.uid() and activo), false)
$$;
grant execute on function app_es_superadmin() to authenticated;

-- El hub pregunta `app_es_admin()` para saber si enseñar «Mi empresa». Hoy
-- funcionaría por el permiso por defecto de PUBLIC, pero si alguien lo
-- revocara la tarjeta desaparecería sin dar ningún error. Se deja explícito.
grant execute on function app_es_admin() to authenticated;

-- ── Usuarios ─────────────────────────────────────────────────
drop policy if exists app_usuarios_select on app_usuarios;
create policy app_usuarios_select on app_usuarios for select
  using (
    id = auth.uid()
    or app_es_superadmin()
    or (app_es_admin() and empresa_id = app_empresa_actual())
  );

-- La escritura directa, con el mismo reparto. El alta normal pasa por
-- `app_guardar_usuario`, que es SECURITY DEFINER y lleva su propia
-- comprobación desde la fase 12; esto cubre a quien escriba por su cuenta.
drop policy if exists app_usuarios_write on app_usuarios;
create policy app_usuarios_write on app_usuarios for all
  using (
    app_es_superadmin()
    or (app_es_admin() and empresa_id = app_empresa_actual())
  )
  with check (
    app_es_superadmin()
    or (app_es_admin() and empresa_id = app_empresa_actual())
  );

-- ── Accesos por módulo ───────────────────────────────────────
-- La empresa no está en esta tabla -su `empresa_id` es otra cosa: la empresa
-- CLIENTE de TyreControl-, así que se mira la del dueño del acceso.
drop policy if exists app_usuario_modulos_select on app_usuario_modulos;
create policy app_usuario_modulos_select on app_usuario_modulos for select
  using (
    user_id = auth.uid()
    or app_es_superadmin()
    or (app_es_admin() and exists (
          select 1 from app_usuarios u
          where u.id = app_usuario_modulos.user_id
            and u.empresa_id = app_empresa_actual()))
  );

drop policy if exists app_usuario_modulos_write on app_usuario_modulos;
create policy app_usuario_modulos_write on app_usuario_modulos for all
  using (
    app_es_superadmin()
    or (app_es_admin() and exists (
          select 1 from app_usuarios u
          where u.id = app_usuario_modulos.user_id
            and u.empresa_id = app_empresa_actual()))
  )
  with check (
    app_es_superadmin()
    or (app_es_admin() and exists (
          select 1 from app_usuarios u
          where u.id = app_usuario_modulos.user_id
            and u.empresa_id = app_empresa_actual()))
  );

-- ── El alta se hace EN la empresa que se está mirando ────────
--
-- `app_guardar_usuario` sacaba la empresa de un usuario nuevo de la del
-- ADMINISTRADOR. Con la pantalla dentro de cada empresa eso es un error: el
-- superadmin de Mobilink, que es de SEA, daba de alta a alguien desde la ficha
-- de otro cliente y el usuario nacía en SEA.
--
-- Se añade `p_empresa_id` al final y con valor por defecto, así que quien la
-- llame como hasta ahora sigue funcionando igual. Reglas:
--   · un usuario que ya existe conserva su empresa; pedir otra es un error;
--   · un administrador de empresa solo puede dar de alta en la suya;
--   · el superadmin, en la que se le indique.
--
-- La firma cambia, así que se borra la antigua ANTES de crear la nueva: con
-- CREATE OR REPLACE quedarían las dos, y PostgREST no sabría a cuál llamar.
-- Va todo en una transacción para que no haya un instante sin función.

begin;

drop function if exists app_guardar_usuario(uuid, text, text, text, text, boolean, boolean, uuid, jsonb);

create or replace function app_guardar_usuario(
  p_id uuid,
  p_username text,
  p_nombre text,
  p_email_recuperacion text,
  p_telefono text,
  p_activo boolean,
  p_es_superadmin boolean,
  p_employee_id uuid,
  p_accesos jsonb,
  p_empresa_id uuid default null
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

  -- La empresa de un usuario que ya existe no se cambia desde aquí: pedirlo
  -- es un error, no algo que se ignore en silencio.
  if v_empresa_previa is not null and p_empresa_id is not null
     and p_empresa_id is distinct from v_empresa_previa then
    raise exception 'La empresa de un usuario no se cambia desde aquí';
  end if;

  -- Y un administrador de empresa solo da de alta en la suya.
  if p_empresa_id is not null and not v_soy_super
     and p_empresa_id is distinct from app_empresa_actual() then
    raise exception 'No puedes dar de alta usuarios en otra empresa';
  end if;

  select coalesce(
           v_empresa_previa,
           p_empresa_id,
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

commit;
