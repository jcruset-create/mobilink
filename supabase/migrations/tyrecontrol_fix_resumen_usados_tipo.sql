-- ============================================================
-- Mobilink TyreControl — Arreglo: tc_almacen_usados_resumen nunca funcionó.
--
-- El 400 que devolvía en producción era el error 42804 de Postgres:
--   "structure of query does not match function result type"
--
-- La función declara `unidades_stock numeric`, pero movimientos_stock.cantidad
-- es entera, así que sum(case … cantidad …) devuelve BIGINT, y RETURN QUERY
-- exige coincidencia exacta de tipos. tc_stock_almacen_empresa esquiva esto
-- mismo con casts ::numeric explícitos (por eso el stock de panel y APK sí
-- funciona); a esta se le olvidaron.
--
-- Nadie lo vio hasta hoy porque la pantalla envolvía la llamada en un
-- .catch(() => null): las tarjetas y el aviso de regularización de la
-- Decisión 1 simplemente no salían. Ese silencio se quitó en el panel
-- 1.3.40, el error dio la cara, y este fichero lo cura.
--
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

create or replace function tc_almacen_usados_resumen(p_empresa uuid)
returns table(fichas bigint, con_identidad bigint, reesculturadas bigint, unidades_stock numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_cliente uuid;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;
  return query
  select
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado')),
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado')
        and (n.rfid_epc is not null or n.numero_serie is not null)),
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado')
        and n.reesculturado),
    -- El cast es el arreglo: sum() sobre una cantidad entera da bigint y la
    -- columna declarada es numeric. Mismo patrón que tc_stock_almacen_empresa.
    coalesce((select sum(case when ms.tipo = 'SALIDA' then -ms.cantidad else ms.cantidad end)::numeric
                from movimientos_stock ms
               where ms.cliente_id = v_cliente and ms.condicion = 'usado'), 0);
end $$;

comment on function tc_almacen_usados_resumen(uuid) is
  'Cuántas gomas hay en almacén según tc_neumaticos y cuántas según '
  'movimientos_stock. Si no cuadran, es el doble conteo de la Decisión 1.';

-- ── Comprobación ────────────────────────────────────────────────────────────
-- (El 42804 solo se manifiesta al ejecutar la consulta, y desde el SQL Editor
-- no se puede llamar a la función por el chequeo de permisos: se verifica que
-- el cast está, y la prueba de ejecución real se hizo en local con esquema
-- replicado y cantidad entera, como en producción.)
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'tc_almacen_usados_resumen';
  if n <> 1 then raise exception 'Hay % versiones de tc_almacen_usados_resumen (se esperaba 1)', n; end if;
  select count(*) into n from pg_proc
   where proname = 'tc_almacen_usados_resumen' and prosrc like '%::numeric%';
  if n <> 1 then raise exception 'tc_almacen_usados_resumen sigue sin el cast ::numeric'; end if;
  raise notice 'OK: tc_almacen_usados_resumen con el tipo bien casado';
end $$;
