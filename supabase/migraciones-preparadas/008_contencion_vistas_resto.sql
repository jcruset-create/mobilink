/*
 * SEC-068 · CONTENCIÓN DE LAS DIEZ VISTAS RESTANTES — PREPARADA, **SIN APLICAR**
 *
 * Fichero aparte, y no una ampliación de `005`, a propósito: 005 quedó
 * aprobada en su alcance reducido y se mantiene congelada. Esto se revisa y se
 * decide por separado.
 *
 * ── LO QUE EL INVENTARIO COMPLETO (2026-09-27) AÑADIÓ ──────────────────────
 *
 * Las 14 vistas comparten lo mismo: dueño `postgres`, `security_invoker` sin
 * declarar, `check_option = NONE`, y `select, insert, update, delete` para
 * `anon` y para `authenticated`. Los dueños de las 15 tablas base son también
 * `postgres`, así que el salto de RLS es total en las 14.
 *
 * Dos cosas que no se sabían:
 *
 *   1. **`tc_tipos_plano_descuadrado` es actualizable e insertable.** Son
 *      CUATRO vistas escribibles, no tres. La cuarta no estaba en 005 porque su
 *      definición no estaba en el repositorio.
 *   2. **Nueve de las catorce no tienen ningún consumidor** en el panel, en las
 *      ocho APK, en el servidor ni en las Edge Functions.
 *
 * (Sobre `stock_actual`: se le atribuyó un consumidor en `SafetyDashboard.tsx`
 * y era falso. Lo que esa pantalla usa es la COLUMNA `stock_actual` de
 * `sm_epis`, que no tiene nada que ver. No tiene consumidor.)
 *
 * ── QUÉ HACE ESTE FICHERO ──────────────────────────────────────────────────
 *
 * Sobre las nueve sin consumidor: retirar a `anon` por completo, y retirar la
 * escritura a `authenticated` dejándole la lectura.
 *
 * Por qué no se retira también la lectura a `authenticated`: son vistas de
 * diagnóstico y de listado —descuadres de plano, modelos sin clasificar,
 * detalle de traspasos— que es plausible que alguien consulte a mano desde el
 * panel o desde el editor SQL. Quitar el `select` no cierra ningún agujero
 * (quien es `authenticated` ya pasa por sus propias políticas en la mayoría de
 * las bases) y sí puede romper un uso que el barrido no ve. La escritura, en
 * cambio, no la necesita nadie: ninguna es escribible por diseño, y dos de
 * ellas lo son por accidente de la actualizabilidad automática.
 *
 * ── LO QUE NO ENTRA AQUÍ ───────────────────────────────────────────────────
 *
 * `traspasos_auditoria_detalle` NO se toca. La consume `almacen_app` con la
 * clave `anon` y sin identidad, y además `traspasos_auditoria` expone
 * `codigo_personal` por su cuenta con `anon_read_auditoria`: cerrar la vista
 * sería cosmético. Va con el rediseño del portal (caso E).
 */

begin;

-- ── 1) La cuarta vista escribible, que 005 no podía conocer ────────────────
-- `tc_tipos_plano_descuadrado` sale de `tc_tipos_vehiculo` con un `where`, así
-- que PostgreSQL la considera actualizable. Sin `check_option`, un `insert` a
-- través de ella entra en `tc_tipos_vehiculo` igual que pasaba con
-- `tc_clientes_almacen`. Sin consumidor conocido, y escribible por `anon`.
revoke all on tc_tipos_plano_descuadrado from anon;
revoke insert, update, delete on tc_tipos_plano_descuadrado from authenticated;

-- ── 2) Las otras ocho sin consumidor ───────────────────────────────────────
revoke all on kpis_traspasos from anon;
revoke insert, update, delete on kpis_traspasos from authenticated;

revoke all on movimientos_stock_detalle from anon;
revoke insert, update, delete on movimientos_stock_detalle from authenticated;

revoke all on stock_actual from anon;
revoke insert, update, delete on stock_actual from authenticated;

revoke all on stock_actual_detalle from anon;
revoke insert, update, delete on stock_actual_detalle from authenticated;

revoke all on tc_modelos_aplicacion_sin_clasificar from anon;
revoke insert, update, delete on tc_modelos_aplicacion_sin_clasificar from authenticated;

revoke all on traspasos_detalle from anon;
revoke insert, update, delete on traspasos_detalle from authenticated;

revoke all on traspasos_lineas_detalle from anon;
revoke insert, update, delete on traspasos_lineas_detalle from authenticated;

revoke all on traspasos_resumen_lineas from anon;
revoke insert, update, delete on traspasos_resumen_lineas from authenticated;

commit;

/*
 * ── POSTCHECK ──────────────────────────────────────────────────────────────
 *
 * Ninguna de las nueve deja nada a `anon` ni escritura a `authenticated`
 * (esperado: 0 filas):
 *
 *   select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 *    where n.nspname = 'public' and c.relkind = 'v'
 *      and c.relname in ('kpis_traspasos','movimientos_stock_detalle','stock_actual',
 *            'stock_actual_detalle','tc_modelos_aplicacion_sin_clasificar',
 *            'tc_tipos_plano_descuadrado','traspasos_detalle',
 *            'traspasos_lineas_detalle','traspasos_resumen_lineas')
 *      and (has_table_privilege('anon', c.oid, 'select')
 *        or has_table_privilege('anon', c.oid, 'insert')
 *        or has_table_privilege('authenticated', c.oid, 'insert')
 *        or has_table_privilege('authenticated', c.oid, 'update')
 *        or has_table_privilege('authenticated', c.oid, 'delete'));
 *
 * Y las nueve conservan el `select` de `authenticated` (esperado: 9):
 *
 *   select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 *    where n.nspname = 'public' and c.relkind = 'v'
 *      and c.relname in (...las nueve...)
 *      and has_table_privilege('authenticated', c.oid, 'select');
 *
 * ── VUELTA ATRÁS ───────────────────────────────────────────────────────────
 *
 * Primero la restauración mínima: si una pantalla deja de leer una vista, se le
 * devuelve SOLO esa, y solo a `authenticated`:
 *
 *   grant select on public.<vista> to authenticated;
 *
 * El rollback completo devuelve el acceso de `anon` a las nueve, o sea el
 * agujero entero. Medida de emergencia:
 *
 *   grant select, insert, update, delete on kpis_traspasos, movimientos_stock_detalle,
 *     stock_actual, stock_actual_detalle, tc_modelos_aplicacion_sin_clasificar,
 *     tc_tipos_plano_descuadrado, traspasos_detalle, traspasos_lineas_detalle,
 *     traspasos_resumen_lineas to anon, authenticated;
 */
