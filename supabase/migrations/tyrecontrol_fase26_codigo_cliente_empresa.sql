-- ============================================================
-- SEA TyreControl — Fase 26: número/código de cliente en la ficha
-- de empresa, sincronizado con clientes.codigo del almacén (misma
-- lógica bidireccional de la Fase 25).
-- ============================================================

alter table tc_empresas add column if not exists codigo_cliente text;

-- ── Cliente -> empresa: añade codigo_cliente a la sincronización ──
create or replace function tc_sincronizar_empresa_desde_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update tc_empresas set
    nombre = new.nombre,
    cif = coalesce(new.nif, cif),
    telefono = new.telefono,
    email = new.email,
    activo = new.activo,
    codigo_cliente = new.codigo
  where cliente_almacen_id = new.id;

  if not found then
    insert into tc_empresas (nombre, cif, telefono, email, activo, cliente_almacen_id, codigo_cliente)
    values (new.nombre, new.nif, new.telefono, new.email, new.activo, new.id, new.codigo);
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_empresa_desde_cliente_upd on clientes;
create trigger trg_sync_empresa_desde_cliente_upd
  after update on clientes
  for each row
  when (
    pg_trigger_depth() < 2 and (
      new.nombre is distinct from old.nombre or
      new.nif is distinct from old.nif or
      new.telefono is distinct from old.telefono or
      new.email is distinct from old.email or
      new.activo is distinct from old.activo or
      new.codigo is distinct from old.codigo
    )
  )
  execute function tc_sincronizar_empresa_desde_cliente();

-- ── Empresa -> cliente: añade codigo_cliente a la sincronización ──
create or replace function tc_sincronizar_cliente_desde_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_empresa_principal uuid;
begin
  if new.cliente_almacen_id is not null then
    update clientes set
      nombre = new.nombre,
      nif = coalesce(new.cif, nif),
      telefono = new.telefono,
      email = new.email,
      activo = new.activo,
      codigo = coalesce(new.codigo_cliente, codigo)
    where id = new.cliente_almacen_id;
    return new;
  end if;

  begin
    select id into v_empresa_principal from empresas where nombre = 'Empresa principal';
    if v_empresa_principal is not null then
      insert into clientes (empresa_id, nombre, nif, telefono, email, activo, codigo)
      values (v_empresa_principal, new.nombre, new.cif, new.telefono, new.email, new.activo, new.codigo_cliente)
      returning id into new.cliente_almacen_id;

      update tc_empresas set cliente_almacen_id = new.cliente_almacen_id where id = new.id;
    end if;
  exception when others then
    null;
  end;

  return new;
end $$;

drop trigger if exists trg_sync_cliente_desde_empresa_upd on tc_empresas;
create trigger trg_sync_cliente_desde_empresa_upd
  after update on tc_empresas
  for each row
  when (
    pg_trigger_depth() < 2 and (
      new.nombre is distinct from old.nombre or
      new.cif is distinct from old.cif or
      new.telefono is distinct from old.telefono or
      new.email is distinct from old.email or
      new.activo is distinct from old.activo or
      new.codigo_cliente is distinct from old.codigo_cliente
    )
  )
  execute function tc_sincronizar_cliente_desde_empresa();

-- ── Backfill: rellena codigo_cliente de las empresas ya enlazadas ─
update tc_empresas e set codigo_cliente = c.codigo
from clientes c
where e.cliente_almacen_id = c.id and e.codigo_cliente is distinct from c.codigo;
