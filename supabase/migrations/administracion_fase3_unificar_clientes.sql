-- ============================================================
-- SEA Administración — Fase 3
-- Unifica los clientes de toda la aplicación:
--   · 'clientes' (almacén) queda como tabla MAESTRA.
--   · 'adm_customers' pasa a ser su ficha económica 1:1 (mismo id).
--   · Trigger: cambios en 'clientes' se reflejan solos en Administración.
--   · RPC adm_guardar_cliente: crear/editar desde Administración escribe
--     en la maestra + campos económicos.
-- Incluye la fase 2 (customer_code), por si no se aplicó.
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── Fase 2 incluida: nº de cliente ───────────────────────────
alter table adm_customers add column if not exists customer_code text;
create index if not exists idx_adm_customers_code on adm_customers (customer_code);

-- ── 1) Si se creó algún cliente solo en Administración, pasarlo a la maestra ──
insert into clientes (id, empresa_id, codigo, nombre, nif, telefono, email, activo)
select a.id,
       (select id from empresas order by created_at nulls last limit 1),
       a.customer_code, a.name, a.tax_id, a.phone, a.email, true
from adm_customers a
where not exists (select 1 from clientes c where c.id = a.id);

-- ── 2) Volcar los clientes de la maestra a Administración ────
insert into adm_customers (id, name, customer_code, tax_id, phone, email)
select c.id, c.nombre, c.codigo, c.nif, c.telefono, c.email
from clientes c
on conflict (id) do update set
  name          = excluded.name,
  customer_code = excluded.customer_code,
  tax_id        = excluded.tax_id,
  phone         = excluded.phone,
  email         = excluded.email;

-- ── 3) Enlace 1:1 (adm_customers.id = clientes.id) ───────────
do $$ begin
  alter table adm_customers
    add constraint adm_customers_id_clientes_fk
    foreign key (id) references clientes(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- ── 4) Sincronización automática clientes → adm_customers ───
create or replace function adm_sync_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into adm_customers (id, name, customer_code, tax_id, phone, email)
  values (new.id, new.nombre, new.codigo, new.nif, new.telefono, new.email)
  on conflict (id) do update set
    name          = excluded.name,
    customer_code = excluded.customer_code,
    tax_id        = excluded.tax_id,
    phone         = excluded.phone,
    email         = excluded.email;
  return new;
end $$;

drop trigger if exists trg_adm_sync_cliente on clientes;
create trigger trg_adm_sync_cliente
  after insert or update of nombre, codigo, nif, telefono, email on clientes
  for each row execute function adm_sync_cliente();

-- ── 5) Crear/editar cliente desde Administración ─────────────
-- Escribe la identidad en la maestra 'clientes' (el trigger actualiza el
-- espejo) y los campos económicos en adm_customers.
create or replace function adm_guardar_cliente(
  p_id uuid,
  p_nombre text,
  p_codigo text,
  p_nif text,
  p_telefono text,
  p_email text,
  p_payment_method text,
  p_has_direct_debit boolean,
  p_requires_tracking boolean,
  p_expected_days integer,
  p_admin_email text,
  p_admin_phone text,
  p_payment_contact text,
  p_credit_limit numeric,
  p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_empresa uuid;
begin
  if not adm_can_manage() then
    raise exception 'Sin permiso para gestionar clientes';
  end if;
  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'El nombre es obligatorio';
  end if;

  if v_id is null then
    select id into v_empresa from empresas order by created_at nulls last limit 1;
    insert into clientes (empresa_id, codigo, nombre, nif, telefono, email, activo)
    values (v_empresa, p_codigo, p_nombre, p_nif, p_telefono, p_email, true)
    returning id into v_id;
  else
    update clientes set
      codigo = p_codigo, nombre = p_nombre, nif = p_nif,
      telefono = p_telefono, email = p_email
    where id = v_id;
    if not found then
      raise exception 'Cliente no encontrado';
    end if;
  end if;

  update adm_customers set
    payment_method            = p_payment_method,
    has_direct_debit          = coalesce(p_has_direct_debit, false),
    requires_payment_tracking = coalesce(p_requires_tracking, true),
    expected_payment_days     = coalesce(p_expected_days, 30),
    admin_email               = p_admin_email,
    admin_phone               = p_admin_phone,
    payment_contact_name      = p_payment_contact,
    internal_credit_limit     = p_credit_limit,
    economic_notes            = p_notes
  where id = v_id;

  return v_id;
end $$;
