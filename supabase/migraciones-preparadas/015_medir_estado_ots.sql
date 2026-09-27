/*
 * ¿POR QUÉ ESTÁ VACÍA `adm_ot_estado`? — SOLO LECTURA
 *
 * Se ejecuta en el editor SQL, que entra como `postgres`. Ese rol es el dueño
 * de las tablas, así que **no pasa por la RLS**: los recuentos que devuelve
 * son los totales REALES, no los que ve un usuario.
 *
 * Esa es justamente la medición que falta. Distingue:
 *
 *   A · `adm_can_read()` falso para la sesión
 *   B · `adm_can_read()` cierto pero 0 filas visibles en `adm_work_orders`
 *   C · hay filas, pero el JOIN con `adm_customers` las elimina
 *   D · otra política o filtro adicional
 *   E · **la tabla está vacía y no hay nada que ver**  ← no estaba en la lista
 *
 * E se comprueba primero porque es la más barata y la que nadie ha mirado: la
 * pantalla dice literalmente «No hay órdenes de trabajo», y `EstadoOts.tsx`
 * distingue error de vacío (`if (err) setError(...) else setOts(...)`), así que
 * lo que se ve es «cero filas SIN error». Con los permisos descartados por el
 * postcheck de 014, un cero sin error también lo produce una tabla vacía.
 */

select jsonb_build_object(
'meta', jsonb_build_object('fecha_utc', now()),

-- ── E · ¿hay algo que ver? ───────────────────────────────────────────────
-- Totales reales, sin RLS de por medio.
'totales_reales', jsonb_build_object(
  'adm_work_orders', (select count(*) from adm_work_orders),
  'adm_customers',   (select count(*) from adm_customers),
  'adm_ot_estado',   (select count(*) from adm_ot_estado)),

-- ── C · ¿el JOIN se come las filas? ──────────────────────────────────────
-- La vista hace `join adm_customers c on c.id = wo.customer_id`, que es INNER:
-- una OT cuyo cliente no exista desaparece de la vista.
'integridad_del_join', jsonb_build_object(
  'ots_totales', (select count(*) from adm_work_orders),
  'ots_con_cliente_existente', (select count(*) from adm_work_orders wo
                                 where exists (select 1 from adm_customers c where c.id = wo.customer_id)),
  'ots_con_customer_id_nulo', (select count(*) from adm_work_orders where customer_id is null),
  'ots_huerfanas', (select count(*) from adm_work_orders wo
                     where wo.customer_id is not null
                       and not exists (select 1 from adm_customers c where c.id = wo.customer_id))),

-- ── D · ¿hay más políticas de las que creemos? ───────────────────────────
'politicas', jsonb_build_object(
  'adm_work_orders', (select coalesce(jsonb_agg(jsonb_build_object(
      'politica', policyname, 'cmd', cmd, 'permisiva', permissive,
      'roles', roles, 'using', qual) order by policyname),'[]'::jsonb)
    from pg_policies where schemaname='public' and tablename='adm_work_orders'),
  'adm_customers', (select coalesce(jsonb_agg(jsonb_build_object(
      'politica', policyname, 'cmd', cmd, 'permisiva', permissive,
      'roles', roles, 'using', qual) order by policyname),'[]'::jsonb)
    from pg_policies where schemaname='public' and tablename='adm_customers')),

-- Una política RESTRICTIVE se combina con AND y puede anular a las demás.
-- Si aparece alguna aquí, es la explicación de D.
'politicas_restrictivas', (select coalesce(jsonb_agg(
    tablename || '.' || policyname order by tablename, policyname),'[]'::jsonb)
  from pg_policies
 where schemaname='public' and permissive = 'RESTRICTIVE'
   and tablename in ('adm_work_orders','adm_customers')),

'force_rls', jsonb_build_object(
  'adm_work_orders', (select relforcerowsecurity from pg_class c join pg_namespace n
                        on n.oid=c.relnamespace where n.nspname='public' and c.relname='adm_work_orders'),
  'adm_customers',   (select relforcerowsecurity from pg_class c join pg_namespace n
                        on n.oid=c.relnamespace where n.nspname='public' and c.relname='adm_customers')),

-- ── A · la evaluación lógica por usuario ─────────────────────────────────
-- Sin falsificar auth.uid(): reproduce el predicado con el id como literal.
'evaluacion_por_usuario', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'nombre', u.nombre, 'rol', u.rol::text, 'activo', u.activo,
    'adm_can_read_equivalente',
      coalesce((select x.rol::text from adm_usuarios x where x.id = u.id and x.activo),'')
        in ('admin','administracion','recepcion','supervisor')
  ) order by u.nombre),'[]'::jsonb)
  from adm_usuarios u),

-- ── El veredicto, donde se puede dar sin la sesión ───────────────────────
'veredicto', (select case
   when (select count(*) from adm_work_orders) = 0
     then 'E · adm_work_orders está VACÍA. La pantalla dice la verdad y no hay ningún fallo de autorización que investigar.'
   when (select count(*) from adm_work_orders wo
          where exists (select 1 from adm_customers c where c.id = wo.customer_id)) = 0
     then 'C · hay OTs, pero NINGUNA tiene un cliente existente: el INNER JOIN de la vista las elimina todas.'
   when exists (select 1 from pg_policies where schemaname='public'
                 and permissive='RESTRICTIVE' and tablename in ('adm_work_orders','adm_customers'))
     then 'D · hay una política RESTRICTIVE que se combina con AND y puede estar anulando el acceso.'
   else 'A o B · hay datos y el JOIN es sano, así que el filtro ocurre en la RLS para ESA sesión. Hace falta la medición desde el navegador.'
 end)
) as diagnostico_estado_ots;
