/*
 * SEC-068 · CONTENCIÓN DE VISTAS — PREPARADA, **SIN APLICAR**
 *
 * Cubre 4 de las 14 vistas: las 4 cuya definición devolvió producción Y cuyo
 * único consumidor es el panel, autenticado. Las otras 10 NO se tocan aquí:
 * 9 no tienen definición conocida (se crearon a mano en el dashboard) y
 * `traspasos_auditoria_detalle` la consume una APK con la clave `anon`.
 *
 * ── QUÉ CIERRA ─────────────────────────────────────────────────────────────
 *
 * Con `anon` y sin privilegio alguno de aplicación, hoy se puede:
 *
 *   adm_ot_estado          leer todas las órdenes de trabajo y los nombres de
 *                          cliente, saltándose la RLS de las dos tablas
 *   tc_clientes_almacen    INSERTAR filas en `clientes` (RLS activa, sin grant)
 *   tc_productos_almacen   INSERTAR filas en `productos_neumaticos`
 *   tc_marcas_contadores   leer, INSERTAR, ACTUALIZAR y **BORRAR** el catálogo
 *                          de marcas de neumático
 *
 * Todo comprobado ejecutándolo contra PostgreSQL 17.6 con las definiciones y
 * las políticas reales: `bash scripts/probar-vistas-pg17.sh`.
 *
 * ── POR QUÉ NO SE APLICA `security_invoker` A TODAS ────────────────────────
 *
 * Es la corrección de manual y aquí sería un error en tres de las cuatro.
 *
 * `tc_clientes_almacen` y `tc_productos_almacen` llevan dentro
 * `where tc_is_admin()`, que es el control de acceso de TyreControl. Las
 * políticas de las tablas base son otras y de otro módulo:
 * `clientes_select_permitidos_o_admin` usa `usuario_actual_es_admin()`, que es
 * el de Almacén, y `productos_select_autenticado` exige
 * `usuario_actual_perfil_id() is not null`, o sea tener ficha de Almacén.
 *
 * Son dos modelos de administrador distintos. Con `security_invoker`, un
 * administrador de TyreControl que no tenga ficha de Almacén pasaría el
 * predicado de la vista y lo pararía la RLS de la tabla: la pantalla se
 * quedaría vacía sin ningún error visible. Conciliar los dos modelos es una
 * decisión de producto, no de esta migración.
 *
 * Por eso aquí se hace lo que NO depende de esa decisión: quitar la escritura
 * y quitar a `anon`. Es menos elegante y no se lleva nada por delante.
 *
 * `adm_ot_estado` sí lleva `security_invoker`, porque ahí los dos controles
 * son el mismo: las políticas de `adm_work_orders` y `adm_customers` usan
 * `adm_can_read()`, que es exactamente la puerta del módulo de administración
 * por la que ya entra la pantalla que la consume.
 *
 * ── LO QUE NO ARREGLA ──────────────────────────────────────────────────────
 *
 * `productos_neumaticos` tiene su propia política `anon_read_productos`
 * (`using (true)`), así que `anon` sigue leyendo esa tabla directamente
 * después de esto. Y `traspasos_auditoria` tiene `anon_read_auditoria`, que
 * expone `codigo_personal` sin necesidad de la vista.
 *
 * Esas dos son políticas de tabla, no de vista, y van con el hallazgo del
 * portal y las credenciales. Esta migración no las toca.
 */

begin;

-- ── 1) adm_ot_estado · que deje de prestar los privilegios del dueño ───────
-- Consumidor: src/modules/administracion/pages/EstadoOts.tsx, autenticado.
-- Con invoker, ese usuario queda sujeto a adm_can_read(), que es la puerta del
-- módulo por la que ya entra. `anon` deja de ver nada.
alter view adm_ot_estado set (security_invoker = true);
revoke all on adm_ot_estado from anon;
revoke insert, update, delete on adm_ot_estado from authenticated;

-- ── 2, 3, 4) Las tres de solo lectura · fuera la escritura y fuera anon ────
-- Los tres consumidores hacen `.select("*")` y nada más:
--   tc_clientes_almacen   src/modules/tyrecontrol/services/data.ts:74
--   tc_productos_almacen  src/modules/tyrecontrol/services/data.ts:87
--   tc_marcas_contadores  src/modules/tyrecontrol/services/data.ts:1567
-- Ninguno escribe, así que el privilegio de escritura no tiene por qué existir.

revoke all on tc_clientes_almacen from anon;
revoke insert, update, delete on tc_clientes_almacen from authenticated;

revoke all on tc_productos_almacen from anon;
revoke insert, update, delete on tc_productos_almacen from authenticated;

-- Esta es la urgente: hoy `anon` puede borrar el catálogo de marcas a través
-- de ella, porque la vista no tiene predicado y es actualizable.
revoke all on tc_marcas_contadores from anon;
revoke insert, update, delete on tc_marcas_contadores from authenticated;

-- ── 5) Que una vista nueva no nazca abierta ────────────────────────────────
-- Mismo razonamiento que con las tablas en la Fase 0: si no se cambia el
-- defecto, la lista vuelve a crecer sola.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;

commit;

/*
 * ── POSTCHECK ──────────────────────────────────────────────────────────────
 *
 * 1) Ninguna de las cuatro deja nada a `anon`, ni escritura a `authenticated`:
 *
 *   select c.relname,
 *          has_table_privilege('anon', c.oid, 'select')           as anon_lee,
 *          has_table_privilege('anon', c.oid, 'insert')           as anon_inserta,
 *          has_table_privilege('authenticated', c.oid, 'insert')  as auth_inserta,
 *          has_table_privilege('authenticated', c.oid, 'delete')  as auth_borra
 *     from pg_class c join pg_namespace n on n.oid = c.relnamespace
 *    where n.nspname = 'public'
 *      and c.relname in ('adm_ot_estado','tc_clientes_almacen',
 *                        'tc_productos_almacen','tc_marcas_contadores');
 *   -- Esperado: todo falso salvo el select de authenticated.
 *
 * 2) Y que adm_ot_estado quedó como invoker:
 *
 *   select relname, array_to_string(reloptions, ',') from pg_class
 *    where relname = 'adm_ot_estado';
 *   -- Esperado: security_invoker=true
 *
 * ── VUELTA ATRÁS ───────────────────────────────────────────────────────────
 *
 *   alter view adm_ot_estado reset (security_invoker);
 *   grant select, insert, update, delete on adm_ot_estado, tc_clientes_almacen,
 *     tc_productos_almacen, tc_marcas_contadores to anon, authenticated;
 *
 * Devuelve exactamente el agujero descrito arriba. Está escrito porque un plan
 * de vuelta atrás que no existe no se puede aprobar.
 */
