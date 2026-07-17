-- ============================================================
-- SEA TyreControl — Devolución de usado: casar por marca + medida base
--
-- Al desmontar a almacén, si el neumático no venía de un producto de
-- almacén concreto (almacen_producto_id null), se busca un producto del
-- cliente con la MISMA marca y medida base y se acumula ahí el usado.
-- Así el neumático desmontado aparece siempre en el stock de usados.
-- Requiere: tyrecontrol_stock_usado.sql y tyrecontrol_medida_compatible_base.sql
-- (por la función tc_medida_base).
-- ============================================================

create or replace function tc_devolver_usado_a_stock(p_neumatico uuid, p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_neu record; v_prod record; v_cliente uuid; v_prod_id uuid;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then return; end if;
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;
  if v_cliente is null then return; end if;

  v_prod_id := v_neu.almacen_producto_id;

  -- Si no venía de un producto concreto, busca uno del cliente con la misma
  -- marca y medida base (para acumular el usado ahí).
  if v_prod_id is null and v_neu.marca is not null then
    select ms.producto_id into v_prod_id
    from movimientos_stock ms
    join productos_neumaticos p on p.id = ms.producto_id
    where ms.cliente_id = v_cliente
      and upper(p.marca) = upper(v_neu.marca)
      and tc_medida_base(p.medida) = tc_medida_base(v_neu.medida)
    group by ms.producto_id
    order by ms.producto_id
    limit 1;
  end if;
  -- Último recurso: cualquier producto activo del catálogo de almacén con esa
  -- marca+medida (aunque el cliente no tuviera movimientos aún).
  if v_prod_id is null and v_neu.marca is not null then
    select p.id into v_prod_id
    from productos_neumaticos p
    where p.activo = true
      and upper(p.marca) = upper(v_neu.marca)
      and tc_medida_base(p.medida) = tc_medida_base(v_neu.medida)
    order by p.id
    limit 1;
  end if;

  if v_prod_id is null then return; end if; -- no hay producto donde reponer

  select * into v_prod from productos_neumaticos where id = v_prod_id;
  if not found then return; end if;
  insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion, condicion, origen_movimiento, observaciones)
  values (v_prod.empresa_id, v_cliente, v_prod_id, 'ENTRADA', 1, 'USADOS', 'usado', 'desmontaje_tyrecontrol',
    'Devolución a stock (usado) - neumático ' || coalesce(v_neu.numero_interno,''));
end $$;
