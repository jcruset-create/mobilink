-- ============================================================
-- Mobilink TyreControl — Un usuario CLIENTE solo se ve a sí mismo
--
-- Hasta ahora tc_usuarios_select dejaba ver a cualquiera de tu misma empresa.
-- Para un administrador o un técnico eso es necesario (gestionan usuarios);
-- para un cliente no: no tiene pantalla de usuarios y, aunque no la vea, el
-- dato era accesible por API. Un cliente pasa a ver ÚNICAMENTE su propia fila.
--
-- Lo que NO cambia (comprobado antes de tocar nada):
--   · El nombre del técnico en revisiones e incidencias. Los técnicos tienen
--     empresa_id de Mobilink, no del cliente, así que un cliente YA no los
--     veía con la política anterior. Esta migración no lo empeora.
--   · Su propio perfil. `id = auth.uid()` va el primero a propósito: el panel
--     carga el perfil de tc_usuarios nada más entrar, y si esa lectura fallara
--     el cliente no podría ni iniciar sesión.
--
-- Idempotente: drop policy if exists + create.
-- ============================================================

-- Helper: ¿el usuario actual es un cliente? SECURITY DEFINER para que la
-- función pueda leer tc_usuarios sin disparar la propia RLS (recursión).
create or replace function tc_is_cliente()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'cliente' and not es_superadmin
                   from tc_usuarios where id = auth.uid()), false)
$$;

drop policy if exists tc_usuarios_select on tc_usuarios;
create policy tc_usuarios_select on tc_usuarios for select
  using (
    -- 1) Siempre puedes verte a ti mismo: sin esto, nadie inicia sesión.
    id = auth.uid()
    -- 2) El super-admin lo ve todo.
    or tc_is_superadmin()
    -- 3) El resto (administrador, operador) ve su empresa. El cliente no
    --    entra por aquí: se queda solo con la regla 1.
    or (not tc_is_cliente() and empresa_id = tc_auth_empresa_id())
  );

grant execute on function tc_is_cliente() to authenticated;
