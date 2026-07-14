-- ============================================================
-- SEA TyreControl — Fase 32: sync clientes → empresas resistente
-- a re-importaciones del almacén.
--
-- Problema: la importación de clientes del almacén borra y recrea
-- clientes con id NUEVO. El trigger de la fase 24 solo casaba por
-- cliente_almacen_id, así que cada recreación insertaba una
-- tc_empresas duplicada (caso real: ENCATRANS por triplicado, con
-- los vehículos colgando de la antigua).
--
-- Solución: si no hay empresa con ese enlace, antes de insertar se
-- intenta RE-ENLAZAR por nombre una empresa cuyo enlace quedó
-- huérfano (su cliente ya no existe) o nulo. Prefiere la activa y
-- más antigua (la que tiene los vehículos). Solo si tampoco hay
-- candidata se crea una empresa nueva.
-- ============================================================

create or replace function tc_sincronizar_empresa_desde_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 1) Enlace directo (comportamiento original)
  update tc_empresas set
    nombre = new.nombre,
    cif = coalesce(new.nif, cif),
    telefono = new.telefono,
    email = new.email,
    activo = new.activo
  where cliente_almacen_id = new.id;
  if found then return new; end if;

  -- 2) Re-enlazar por nombre una empresa con enlace huérfano o sin enlace
  --    (la importación del almacén recrea clientes con id nuevo)
  update tc_empresas e set
    cliente_almacen_id = new.id,
    nombre = new.nombre,
    cif = coalesce(new.nif, e.cif),
    telefono = new.telefono,
    email = new.email,
    activo = new.activo
  where e.id = (
    select e2.id from tc_empresas e2
    where lower(trim(e2.nombre)) = lower(trim(new.nombre))
      and (e2.cliente_almacen_id is null
           or not exists (select 1 from clientes c where c.id = e2.cliente_almacen_id))
    order by e2.activo desc, e2.created_at asc
    limit 1
  );
  if found then return new; end if;

  -- 3) Cliente realmente nuevo → empresa nueva
  insert into tc_empresas (nombre, cif, telefono, email, activo, cliente_almacen_id)
  values (new.nombre, new.nif, new.telefono, new.email, new.activo, new.id);
  return new;
end $$;

-- ── Reconciliación única: clientes actuales sin empresa enlazada ──
-- Aplica la misma lógica del trigger a los clientes ya existentes,
-- para curar los enlaces rotos por importaciones pasadas.
do $$
declare c record;
begin
  for c in
    select cl.* from clientes cl
    where not exists (select 1 from tc_empresas e where e.cliente_almacen_id = cl.id)
  loop
    update tc_empresas e set
      cliente_almacen_id = c.id,
      nombre = c.nombre,
      cif = coalesce(c.nif, e.cif),
      telefono = c.telefono,
      email = c.email,
      activo = c.activo
    where e.id = (
      select e2.id from tc_empresas e2
      where lower(trim(e2.nombre)) = lower(trim(c.nombre))
        and (e2.cliente_almacen_id is null
             or not exists (select 1 from clientes c2 where c2.id = e2.cliente_almacen_id))
      order by e2.activo desc, e2.created_at asc
      limit 1
    );
    if not found then
      insert into tc_empresas (nombre, cif, telefono, email, activo, cliente_almacen_id)
      values (c.nombre, c.nif, c.telefono, c.email, c.activo, c.id);
    end if;
  end loop;
end $$;
