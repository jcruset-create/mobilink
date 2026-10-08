-- ============================================================================
-- RLS: lo que no depende de la fila, una vez por consulta y no una por fila
-- ============================================================================
-- El Dashboard con «Todas las empresas» fallaba con
--   canceling statement due to statement timeout
--
-- Las reglas de acceso de las tablas grandes (mediciones, revisiones,
-- neumáticos, operaciones, vehículos, montajes) llaman a tc_puede_ver_empresa,
-- tc_is_superadmin, tc_is_admin y tc_auth_empresa_id. Son SECURITY DEFINER, y
-- Postgres no puede «abrirlas» dentro de la consulta: las ejecuta UNA VEZ POR
-- FILA, y cada ejecución busca al usuario en tc_usuarios. Con las mediciones
-- del CheckPoint —una foto semanal de toda la flota— eso son decenas de miles
-- de búsquedas por cada informe, y la consulta pasa del tiempo máximo.
--
-- El arreglo es el que recomienda Supabase: envolver en (select …) lo que no
-- depende de la fila. Así Postgres lo calcula una vez al principio de la
-- consulta y reutiliza el resultado. ¿Es superadmin? se pregunta una vez, no
-- veinte mil.
--
-- LA REGLA NO CAMBIA. Cada política dice exactamente lo mismo que antes, con
-- las mismas condiciones en el mismo orden; solo cambia cuántas veces se
-- calcula. tc_operador_ve_empresa(empresa_id) se queda como está porque sí
-- depende de la fila (de qué empresa es), y va la última: a un superadmin ni
-- se le llega a preguntar.
--
-- Banco: supabase/pruebas/rls_una_vez_por_consulta.sql. Idempotente.
-- ============================================================================

-- ── Lectura: antes «tc_puede_ver_empresa(empresa_id)» ───────────────────────
-- tc_puede_ver_empresa(e) = superadmin OR e = mi empresa OR operador de e.

drop policy if exists rev_det_select on revisiones_neumaticos_detalle;
create policy rev_det_select on revisiones_neumaticos_detalle for select using (
  (select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

drop policy if exists rev_veh_select on revisiones_vehiculo;
create policy rev_veh_select on revisiones_vehiculo for select using (
  (select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

drop policy if exists tc_neu_select on tc_neumaticos;
create policy tc_neu_select on tc_neumaticos for select using (
  (select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

drop policy if exists op_neu_select on operaciones_neumaticos;
create policy op_neu_select on operaciones_neumaticos for select using (
  (select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

drop policy if exists tc_vehiculos_select on tc_vehiculos;
create policy tc_vehiculos_select on tc_vehiculos for select using (
  (select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

drop policy if exists tc_mont_select on tc_montajes_actuales;
create policy tc_mont_select on tc_montajes_actuales for select using (
  (select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

-- ── Escritura «for all»: también se evalúan al LEER ────────────────────────
-- Una política «for all» se suma (OR) a la de lectura en cada SELECT, así que
-- por mucho que se arregle la de lectura, esta seguiría ejecutándose fila a
-- fila. Mismas condiciones que tenían.

drop policy if exists rev_det_write on revisiones_neumaticos_detalle;
create policy rev_det_write on revisiones_neumaticos_detalle for all
  using ( (select tc_is_superadmin())
          or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id()))
          or tc_operador_ve_empresa(empresa_id) )
  with check ( (select tc_is_superadmin())
          or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id()))
          or tc_operador_ve_empresa(empresa_id) );

drop policy if exists rev_veh_write on revisiones_vehiculo;
create policy rev_veh_write on revisiones_vehiculo for all
  using ( (select tc_is_superadmin())
          or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id()))
          or tc_operador_ve_empresa(empresa_id) )
  with check ( (select tc_is_superadmin())
          or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id()))
          or tc_operador_ve_empresa(empresa_id) );

drop policy if exists tc_neu_write on tc_neumaticos;
create policy tc_neu_write on tc_neumaticos for all
  using ( (select tc_is_superadmin()) or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id())) )
  with check ( (select tc_is_superadmin()) or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id())) );

drop policy if exists tc_vehiculos_write on tc_vehiculos;
create policy tc_vehiculos_write on tc_vehiculos for all
  using ( (select tc_is_superadmin()) or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id())) )
  with check ( (select tc_is_superadmin()) or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id())) );

drop policy if exists tc_mont_write on tc_montajes_actuales;
create policy tc_mont_write on tc_montajes_actuales for all
  using ( (select tc_is_superadmin()) or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id())) )
  with check ( (select tc_is_superadmin()) or ((select tc_is_admin()) and empresa_id = (select tc_auth_empresa_id())) );

-- operaciones_neumaticos tiene insert/update separados (no «for all»): no se
-- evalúan al leer y no se tocan.
