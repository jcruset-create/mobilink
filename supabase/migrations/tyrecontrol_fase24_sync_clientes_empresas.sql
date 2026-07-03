-- ============================================================
-- SEA TyreControl — Fase 24: sincronización automática de clientes
-- (Almacén) → empresas (TyreControl). El almacén es la fuente de
-- verdad: cada cliente de `clientes` se refleja como una tc_empresas
-- enlazada por cliente_almacen_id (Fase 5a), sin duplicar el enlace
-- manual ya existente en "Enlace con almacén" (que sigue funcionando
-- para casos ya enlazados a mano con otro nombre).
-- ============================================================

create or replace function tc_sincronizar_empresa_desde_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update tc_empresas set
    nombre = new.nombre,
    cif = coalesce(new.nif, cif),
    telefono = new.telefono,
    email = new.email,
    activo = new.activo
  where cliente_almacen_id = new.id;

  if not found then
    insert into tc_empresas (nombre, cif, telefono, email, activo, cliente_almacen_id)
    values (new.nombre, new.nif, new.telefono, new.email, new.activo, new.id);
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_empresa_desde_cliente on clientes;
create trigger trg_sync_empresa_desde_cliente
  after insert or update on clientes
  for each row execute function tc_sincronizar_empresa_desde_cliente();

-- ── Backfill: clientes existentes que aún no tienen empresa ─────
insert into tc_empresas (nombre, cif, telefono, email, activo, cliente_almacen_id)
select c.nombre, c.nif, c.telefono, c.email, c.activo, c.id
from clientes c
where not exists (select 1 from tc_empresas e where e.cliente_almacen_id = c.id);
