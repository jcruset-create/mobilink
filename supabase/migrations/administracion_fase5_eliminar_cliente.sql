-- ============================================================
-- SEA Administración — Fase 5
-- Eliminar clientes desde Administración (solo rol admin).
-- Borra en la tabla maestra 'clientes'; el espejo adm_customers
-- cae en cascada. Bloquea el borrado si el cliente tiene
-- movimientos en Administración o en otros módulos.
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

create or replace function adm_eliminar_cliente(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if adm_rol_actual() <> 'admin' then
    raise exception 'Solo el rol Admin puede eliminar clientes';
  end if;

  if exists (select 1 from adm_payments where customer_id = p_id)
     or exists (select 1 from adm_invoices where customer_id = p_id)
     or exists (select 1 from adm_work_orders where customer_id = p_id)
     or exists (select 1 from adm_payment_tracking where customer_id = p_id)
     or exists (select 1 from adm_recovery_cases where customer_id = p_id) then
    raise exception 'El cliente tiene movimientos (cobros, facturas, OTs o expedientes). No se puede eliminar; desactívalo o déjalo sin seguimiento.';
  end if;

  begin
    delete from cliente_contactos where cliente_id = p_id;
    delete from clientes where id = p_id; -- cascada: elimina también adm_customers
  exception when foreign_key_violation then
    raise exception 'El cliente tiene datos vinculados en otros módulos (almacén, etc.) y no se puede eliminar.';
  end;
end $$;
