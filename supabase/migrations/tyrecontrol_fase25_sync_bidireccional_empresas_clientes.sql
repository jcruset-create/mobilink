-- ============================================================
-- SEA TyreControl — Fase 25: sincronización BIDIRECCIONAL entre
-- clientes (Almacén) y tc_empresas (TyreControl). Incluye de nuevo
-- la función/trigger de la Fase 24 (cliente -> empresa) por si esa
-- migración no llegó a ejecutarse, añade el sentido contrario
-- (empresa -> cliente), protege ambos triggers contra bucles
-- infinitos con pg_trigger_depth(), y hace el backfill de lo que
-- falte en ambas direcciones.
-- ============================================================

-- ── 1. Cliente -> empresa (Fase 24, redefinida por si no existía) ─
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

-- Postgres no permite comparar OLD en el WHEN de un trigger que
-- también dispare por INSERT (OLD no existe en un INSERT), así que
-- se separa en dos triggers: uno para INSERT (sin condición de
-- cambio, solo la de profundidad) y otro para UPDATE.
drop trigger if exists trg_sync_empresa_desde_cliente on clientes;
drop trigger if exists trg_sync_empresa_desde_cliente_ins on clientes;
drop trigger if exists trg_sync_empresa_desde_cliente_upd on clientes;

create trigger trg_sync_empresa_desde_cliente_ins
  after insert on clientes
  for each row
  when (pg_trigger_depth() < 2)
  execute function tc_sincronizar_empresa_desde_cliente();

create trigger trg_sync_empresa_desde_cliente_upd
  after update on clientes
  for each row
  when (
    pg_trigger_depth() < 2 and (
      new.nombre is distinct from old.nombre or
      new.nif is distinct from old.nif or
      new.telefono is distinct from old.telefono or
      new.email is distinct from old.email or
      new.activo is distinct from old.activo
    )
  )
  execute function tc_sincronizar_empresa_desde_cliente();

-- ── 2. Empresa -> cliente: si una tc_empresas se crea directamente ─
-- en TyreControl (sin venir de un cliente ya existente), se crea su
-- cliente equivalente en el almacén, en la empresa de almacén
-- "Empresa principal". Si ya estaba enlazada, solo actualiza sus datos.
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
      activo = new.activo
    where id = new.cliente_almacen_id;
    return new;
  end if;

  -- Empresa creada directamente en TyreControl: le creamos su
  -- cliente de almacén (best-effort; si falla no bloquea la empresa).
  begin
    select id into v_empresa_principal from empresas where nombre = 'Empresa principal';
    if v_empresa_principal is not null then
      insert into clientes (empresa_id, nombre, nif, telefono, email, activo)
      values (v_empresa_principal, new.nombre, new.cif, new.telefono, new.email, new.activo)
      returning id into new.cliente_almacen_id;

      update tc_empresas set cliente_almacen_id = new.cliente_almacen_id where id = new.id;
    end if;
  exception when others then
    null;
  end;

  return new;
end $$;

drop trigger if exists trg_sync_cliente_desde_empresa on tc_empresas;
drop trigger if exists trg_sync_cliente_desde_empresa_ins on tc_empresas;
drop trigger if exists trg_sync_cliente_desde_empresa_upd on tc_empresas;

create trigger trg_sync_cliente_desde_empresa_ins
  after insert on tc_empresas
  for each row
  when (pg_trigger_depth() < 2)
  execute function tc_sincronizar_cliente_desde_empresa();

create trigger trg_sync_cliente_desde_empresa_upd
  after update on tc_empresas
  for each row
  when (
    pg_trigger_depth() < 2 and (
      new.nombre is distinct from old.nombre or
      new.cif is distinct from old.cif or
      new.telefono is distinct from old.telefono or
      new.email is distinct from old.email or
      new.activo is distinct from old.activo
    )
  )
  execute function tc_sincronizar_cliente_desde_empresa();

-- ── 3. Backfill: clientes del almacén sin empresa en TyreControl ──
insert into tc_empresas (nombre, cif, telefono, email, activo, cliente_almacen_id)
select c.nombre, c.nif, c.telefono, c.email, c.activo, c.id
from clientes c
where not exists (select 1 from tc_empresas e where e.cliente_almacen_id = c.id);

-- ── 4. Backfill: empresas de TyreControl sin cliente en el almacén ─
-- (creadas directamente en TyreControl antes de esta fase), en la
-- empresa de almacén "Empresa principal".
-- Se desactiva momentáneamente el trigger cliente->empresa para este
-- backfill puntual: si no, cada cliente recién creado aquí dispararía
-- a su vez una empresa duplicada (la empresa original ya existe, solo
-- le falta el enlace).
alter table clientes disable trigger trg_sync_empresa_desde_cliente_ins;

do $$
declare v_empresa_principal uuid; v_empresa record; v_cliente_id uuid;
begin
  select id into v_empresa_principal from empresas where nombre = 'Empresa principal';
  if v_empresa_principal is not null then
    for v_empresa in select * from tc_empresas where cliente_almacen_id is null loop
      insert into clientes (empresa_id, nombre, nif, telefono, email, activo)
      values (v_empresa_principal, v_empresa.nombre, v_empresa.cif, v_empresa.telefono, v_empresa.email, v_empresa.activo)
      returning id into v_cliente_id;

      update tc_empresas set cliente_almacen_id = v_cliente_id where id = v_empresa.id;
    end loop;
  end if;
end $$;

alter table clientes enable trigger trg_sync_empresa_desde_cliente_ins;
