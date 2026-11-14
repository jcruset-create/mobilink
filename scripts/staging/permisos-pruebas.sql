-- Permisos de la base de PRUEBAS de TyreControl.
--
-- Sustituye al «grant all on all tables/sequences/functions in schema public
-- to anon, authenticated, service_role» que tenía construir-esquema.sh. Aquel
-- grant abría las 470 relaciones y las 266 funciones del esquema a los tres roles —
-- módulos que esta prueba ni toca incluidos— y encima dejaba puestos los
-- `alter default privileges`, así que todo lo que se creara después nacía
-- igual de abierto. La RLS no tapa eso: no se aplica a las funciones, no se
-- aplica a las tablas que no la tienen activada y no se aplica a las vistas
-- que no son `security_invoker`.
--
-- ESTO NO ES UNA COPIA DE LOS PERMISOS DE PRODUCCIÓN, y no debe presentarse
-- como tal. Es más estricto a propósito, en tres sitios: los permisos van por
-- nombre en vez de por default privileges, tres vistas pasan a
-- `security_invoker` (sección 5.b) y productos_neumaticos se queda en solo
-- lectura (sección 5). Lo que aquí sale CERRADO no demuestra que lo esté en
-- producción; lo que aquí FUNCIONA sí funcionará allí. El reparto exacto,
-- resultado por resultado, está en DIFERENCIAS_CON_PRODUCCION.md. Nada de
-- esto se lleva a producción con esta prueba: es una revisión aparte.
--
-- Aquí se concede, por nombre, solo lo que usa esta prueba:
--   · el panel de TyreControl           → rol `authenticated`
--   · los endpoints del servidor        → rol `service_role`
--   · lo que ya definen las migraciones → se repite tal cual (sección 7)
--   · los auxiliares de las políticas RLS y de los valores por defecto
-- Ningún `alter default privileges`. Ningún `grant ... on all ...`.
--
-- De dónde sale la lista: las llamadas `.from("…")` y `.rpc("…")` de
-- src/modules/tyrecontrol, src/services, src/lib, src/hooks y src/components
-- (panel) y de server/tyrecontrol, server/core y server/index.ts (servidor),
-- cruzadas con el catálogo de la base y con los `grant` de
-- supabase/migrations. La lista vive también en permisos-pruebas.json, y
-- 10-comprobar-permisos.sh vuelve a hacer el cruce y falla si este fichero se
-- ha quedado atrás.
--
--   psql "$DESTINO_URL" -v ON_ERROR_STOP=1 -f scripts/staging/permisos-pruebas.sql
--
-- Lo que NO se concede, a propósito:
--   · `anon` no recibe ninguna tabla ni vista, y solo las funciones que las
--     migraciones le conceden expresamente (el quiosco del operario y el
--     login por correo). El resto del panel entra con sesión.
--   · `clientes` no tiene RLS y no se concede a nadie. Las vistas
--     tc_clientes_almacen y tc_productos_almacen sí: no son
--     `security_invoker`, se ejecutan con permisos del dueño y llevan su
--     propia puerta `tc_is_admin()` dentro.
--   · Los módulos Seguridad, Presencia, Caja, Asistencia y Administración no
--     entran en esta prueba: el panel no recibe sus tablas y sus páginas
--     darán 403. Si alguna vez hiciera falta, se añade por nombre.
--   · Ninguna secuencia: todas las tablas de las secciones 2 a 4 tienen clave
--     primaria uuid. Si algún día una lleva un `serial`, hay que conceder su
--     secuencia por nombre y la comprobación 8.h lo avisará.

begin;

-- ── Guardián: esto solo se ejecuta en una base MARCADA como de pruebas ──
-- Es la segunda llave, no la única: el destino (DATABASE_URL y el proyecto
-- Supabase) lo comprueba scripts/staging/00-comprobar-destino.sh antes de
-- llegar aquí. La marca la pone 00-inicializar-destino.sh sobre una base
-- nueva y vacía, después de identificar el proyecto y comprobar que está
-- vacía; producción no la tiene y no se le pone.
do $guardian$
begin
  if coalesce(current_setting('mobilink.entorno', true), '') is distinct from 'pruebas' then
    raise exception 'Esta base no esta marcada como entorno de pruebas (mobilink.entorno = %). '
                    'Si es un proyecto nuevo, pasa primero por '
                    'scripts/staging/00-inicializar-destino.sh.',
                    coalesce(current_setting('mobilink.entorno', true), '(sin marca)');
  end if;
end
$guardian$;

-- ── 0. Punto de partida ───────────────────────────────────────────────
-- PostgreSQL concede EXECUTE a PUBLIC en cada función nueva: las 266 del
-- esquema son ejecutables por cualquiera que pueda conectarse, `anon`
-- incluido, aunque nadie las haya concedido. Un `grant ... to authenticated`
-- no lo quita; hace falta el revoke.
revoke execute on all functions in schema public from public;
revoke create on schema public from public;

-- Y se retira lo que haya puesto la plataforma (los default privileges de
-- Supabase) o una pasada anterior del banco. Después se vuelve a conceder lo
-- que de verdad hace falta, incluido lo que definen las migraciones.
alter default privileges in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
revoke all on all tables     in schema public from anon, authenticated, service_role;
revoke all on all sequences  in schema public from anon, authenticated, service_role;
revoke all on all functions  in schema public from anon, authenticated, service_role;

-- ── 1. Entrar al esquema ──────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

-- ── 2. Tablas que el panel solo LEE (21) ───────────────────────────────
-- Catálogos, cargas de importación e históricos que escriben los disparadores
-- y los RPC `security definer`, nunca el panel por PostgREST.
grant select on
  app_usuario_modulos, tc_cat_aplicaciones_neumatico, tc_cat_destinos,
  tc_cat_ejes_neumatico, tc_cat_motivos, tc_cat_resultados_reparacion,
  tc_cat_tipos_operacion, tc_cat_tipos_reparacion, tc_historial_montajes,
  tc_importacion_cargas, tc_importacion_intervenciones, tc_incidencias,
  tc_intervenciones, tc_operacion_auditoria, tc_operacion_estado_historial,
  tc_operacion_movimientos, tc_operaciones_mantenimiento, tc_reservas_neumatico,
  tc_vehiculo_ejes, tc_vehiculo_presencia_base, tc_vehiculo_webfleet_estado
to authenticated, service_role;

-- ── 3. Tablas que el panel LEE Y ESCRIBE (55) ─────────────────────
-- La RLS de cada una —activada y con política, se comprueba en 8.a— es la que
-- decide a qué filas llega cada empresa.
grant select, insert, update, delete on
  autorizaciones_operaciones, operaciones_neumaticos, revisiones_neumaticos_detalle,
  revisiones_vehiculo, tc_cat_campos_ficha_tecnica, tc_cat_fabricantes,
  tc_cat_indices_carga, tc_cat_indices_velocidad, tc_cat_marcas_neumatico,
  tc_cat_marcas_vehiculo, tc_cat_marcas_vehiculo_tipos, tc_cat_medidas_neumatico,
  tc_cat_modelos_neumatico, tc_cat_motivos_fuera_almacen, tc_cat_motivos_pendiente,
  tc_cat_tipos_incidencia, tc_config_ejes, tc_config_ejes_marca,
  tc_config_identificacion, tc_config_identificacion_medida, tc_config_umbrales,
  tc_config_umbrales_categoria, tc_config_umbrales_medida, tc_delegaciones,
  tc_empresas, tc_etiquetas_foto, tc_etiquetas_lote,
  tc_fichas_genericas_neumaticos, tc_lote_vehiculos, tc_lotes_revision,
  tc_mantenimiento_realizadas, tc_medidas_tipo_vehiculo, tc_montajes_actuales,
  tc_neumaticos, tc_operacion_adjuntos, tc_operador_empresas,
  tc_permisos_cliente, tc_planes_mantenimiento, tc_plantilla_items,
  tc_plantillas_mantenimiento, tc_posiciones_vehiculo, tc_precios_medida,
  tc_presiones_objetivo, tc_referencias_neumatico, tc_tipos_llanta,
  tc_tipos_vehiculo, tc_usuarios, tc_vehiculo_atributos_tecnicos,
  tc_vehiculo_ficha_historial, tc_vehiculo_revision_flag, tc_vehiculos,
  tc_webfleet_alertas, tc_webfleet_config, tc_webfleet_sync_config,
  tyre_sizes
to authenticated, service_role;

-- ── 4. Tablas que solo usa el SERVIDOR (15) ───────────────────────
-- Las toca server/index.ts con la service key. El panel no las pide, así que
-- `authenticated` no las recibe.
grant select, insert, update, delete on
  movimientos_stock, pres_records, sea_employees,
  sm_document_acknowledgements, sm_epi_assignments, sm_epi_requests,
  sm_epis, sm_safety_documents, sm_safety_meetings,
  sm_training_records, tc_incidencia_problemas, tc_intervencion_servicios,
  tc_partes_guiados, tc_vehiculo_documentos, tc_vehiculo_presencia_historico
to service_role;

-- ── 5. Excepción declarada: una tabla sin RLS ─────────────────────────
-- productos_neumaticos es el catálogo de neumáticos del módulo Almacén. No
-- está en supabase/migrations (se creó fuera), no tiene RLS, y el panel de
-- TyreControl la necesita para dos cosas: el embed
-- `producto_almacen:productos_neumaticos(...)` de la ficha del vehículo y
-- profundidadDibujoPorProducto(), que lee el catálogo entero sin filtrar por
-- empresa. Sin este grant, la ficha del vehículo revienta con «permission
-- denied for table productos_neumaticos» y no se puede probar nada.
--
-- Qué queda expuesto: marca, modelo, medida, dot y activo de todos los
-- productos, de todas las empresas de almacén. Qué NO se concede: insert,
-- update ni delete, a ningún rol.
--
-- Es una excepción, no la norma. La comprobación 8.a sigue parando la
-- transacción ante cualquier OTRA tabla sin RLS con permisos, y 8.b exige que
-- esta se quede en solo lectura. En el proyecto Supabase de pruebas, si la
-- tabla llega del volcado sin RLS, el aviso será el mismo y la decisión
-- —ponerle RLS en el módulo Almacén, o volver a declarar la excepción por
-- escrito— es de quien autorice el staging, no de este fichero.
grant select on productos_neumaticos to authenticated, service_role;

-- ── 5.b Vistas que se saltaban la RLS ─────────────────────────────────
-- Una vista se ejecuta con los permisos de su DUEÑO salvo que sea
-- `security_invoker`: se salta la RLS de las tablas que lee. En el esquema
-- hay tres vistas concedidas a `authenticated` por las migraciones que no la
-- tienen y que tampoco filtran por empresa dentro:
--   · tc_marcas_contadores cuenta neumáticos y vehículos sobre tc_neumaticos
--     sin filtrar: con permisos del dueño, un usuario de una empresa ve el
--     recuento de las demás.
--   · tc_tipos_plano_descuadrado es un diagnóstico sobre tc_tipos_vehiculo.
--   · adm_ot_estado cruza órdenes de trabajo y clientes del módulo de
--     Administración.
-- En la base de pruebas se pasan a `security_invoker` para que cuenten y
-- enseñen lo que la RLS de cada quien permita. Las dos primeras siguen
-- funcionando (sus tablas sí se conceden). adm_ot_estado dejará de responder,
-- porque las tablas de Administración no entran en esta prueba: eso es lo
-- correcto aquí, y si alguna vez hiciera falta se conceden por nombre.
--
-- Esto NO cambia las migraciones ni el proyecto de producción: es un ajuste
-- del entorno de pruebas, y queda anotado como hallazgo en
-- scripts/staging/README.md.
alter view tc_marcas_contadores       set (security_invoker = true);
alter view tc_tipos_plano_descuadrado set (security_invoker = true);
alter view adm_ot_estado              set (security_invoker = true);

-- ── 6. RPC ────────────────────────────────────────────────────────────
-- Las que llama el panel (35) y que no conceden ya las migraciones.
grant execute on function tc_almacen_usados(p_empresa uuid) to authenticated;
grant execute on function tc_almacen_usados_resumen(p_empresa uuid) to authenticated;
grant execute on function tc_anular_operacion(p_operacion uuid, p_motivo text) to authenticated;
grant execute on function tc_aplicar_plan_trabajo(p_vehiculo uuid, p_acciones jsonb, p_km numeric, p_obs text) to authenticated;
grant execute on function tc_aplicar_plantilla(p_plantilla uuid, p_vehiculos uuid[]) to authenticated;
grant execute on function tc_cambiar_estado_operacion(p_operacion uuid, p_nuevo_estado text, p_tecnico uuid, p_motivo text) to authenticated;
grant execute on function tc_cambiar_posicion(p_montaje uuid, p_posicion_destino uuid, p_km numeric, p_obs text) to authenticated;
grant execute on function tc_completar_revision(p_revision uuid) to authenticated;
grant execute on function tc_corregir_posicion(p_montaje uuid, p_posicion_correcta uuid, p_obs text) to authenticated;
grant execute on function tc_descartar_neumatico(p_neumatico uuid, p_motivo text, p_obs text) to authenticated;
grant execute on function tc_desmontar_neumatico(p_montaje uuid, p_km numeric, p_motivo text, p_nuevo_estado text, p_obs text) to authenticated;
grant execute on function tc_finalizar_lote(p_lote uuid) to authenticated;
grant execute on function tc_intercambiar_posiciones(p_montaje_a uuid, p_montaje_b uuid, p_km numeric, p_obs text) to authenticated;
grant execute on function tc_liberar_reserva(p_reserva uuid, p_motivo text) to authenticated;
grant execute on function tc_migrar_usados_a_fichas(p_empresa uuid, p_simular boolean) to authenticated;
grant execute on function tc_montar_desde_almacen(p_vehiculo uuid, p_posicion uuid, p_producto_almacen uuid, p_control_individual boolean, p_datos jsonb, p_km numeric, p_fecha date, p_obs text) to authenticated;
grant execute on function tc_montar_desde_almacen(p_vehiculo uuid, p_posicion uuid, p_producto_almacen uuid, p_control_individual boolean, p_datos jsonb, p_km numeric, p_fecha date, p_obs text, p_forzar_medida boolean, p_condicion text) to authenticated;
grant execute on function tc_montar_desde_catalogo(p_vehiculo uuid, p_posicion uuid, p_referencia uuid, p_control_individual boolean, p_datos jsonb, p_km numeric, p_fecha date, p_obs text, p_forzar_medida boolean, p_condicion text, p_montaje_actual uuid, p_motivo_desmontaje text, p_destino_retirado text) to authenticated;
grant execute on function tc_montar_fuera_almacen(p_vehiculo uuid, p_posicion uuid, p_control_individual boolean, p_datos jsonb, p_motivo text, p_km numeric, p_fecha date, p_obs text) to authenticated;
grant execute on function tc_montar_neumatico(p_vehiculo uuid, p_neumatico uuid, p_posicion uuid, p_km numeric, p_fecha date, p_obs text) to authenticated;
grant execute on function tc_montar_neumatico(p_vehiculo uuid, p_neumatico uuid, p_posicion uuid, p_km numeric, p_fecha date, p_obs text, p_forzar_medida boolean) to authenticated;
grant execute on function tc_pendientes_identificar(p_empresa uuid) to authenticated;
grant execute on function tc_plan_estado() to authenticated;
grant execute on function tc_planificar_operacion(p_empresa uuid, p_tipo_operacion text, p_vehiculo uuid, p_neumatico uuid, p_posicion_destino uuid, p_fecha_prevista date, p_prioridad text, p_motivo text, p_tecnico uuid, p_obs text, p_reservar boolean) to authenticated;
grant execute on function tc_reesculturar_en_almacen(p_neumatico uuid, p_profundidad_mm numeric, p_obs text) to authenticated;
grant execute on function tc_registrar_reparacion(p_neumatico uuid, p_tipo_reparacion text, p_resultado text, p_proveedor text, p_coste numeric, p_km numeric, p_obs text) to authenticated;
grant execute on function tc_reparar_neumatico(p_neumatico uuid, p_motivo text, p_obs text) to authenticated;
grant execute on function tc_reservar_neumatico(p_neumatico uuid, p_operacion uuid, p_vehiculo uuid, p_posicion uuid, p_fecha_prevista date) to authenticated;
grant execute on function tc_resolver_incidencia_parcial(p_incidencia_id uuid, p_problema_ids uuid[], p_tipo text, p_medicion_final jsonb, p_material text, p_resultado text, p_observaciones text, p_foto_url text, p_tiempo_seg integer) to authenticated;
grant execute on function tc_revision_estado() to authenticated;
grant execute on function tc_rotar_neumatico(p_montaje_origen uuid, p_posicion_destino uuid) to authenticated;
grant execute on function tc_set_vehiculo_ejes(p_vehiculo uuid, p_ejes jsonb) to authenticated;
grant execute on function tc_sustituir_neumatico(p_montaje_actual uuid, p_ficha_generica uuid, p_control_individual boolean, p_datos jsonb, p_motivo_desmontaje text, p_destino_retirado text, p_km numeric, p_fecha date, p_obs text) to authenticated;
grant execute on function tc_sustituir_neumatico(p_montaje_actual uuid, p_producto_almacen uuid, p_control_individual boolean, p_datos jsonb, p_motivo_desmontaje text, p_destino_retirado text, p_km numeric, p_fecha date, p_obs text, p_forzar_medida boolean) to authenticated;
grant execute on function tc_sustituir_neumatico(p_montaje_actual uuid, p_producto_almacen uuid, p_control_individual boolean, p_datos jsonb, p_motivo_desmontaje text, p_destino_retirado text, p_km numeric, p_fecha date, p_obs text, p_forzar_medida boolean, p_condicion text) to authenticated;

-- Las que solo llama el servidor con la service key (4).
grant execute on function tc_auth_empresa_id() to service_role;
grant execute on function tc_generar_numero_operacion() to service_role;
grant execute on function tc_is_admin() to service_role;
grant execute on function tc_is_superadmin() to service_role;

-- ── 7. Lo que definen las migraciones (91) ──────────────────────────
-- El revoke de la sección 0 se lleva por delante los grants que ponen las
-- propias migraciones, así que se repiten aquí tal cual están escritos en
-- supabase/migrations/*.sql. Esta es la parte que hay que respetar sin
-- interpretarla: si una migración concede una función a `anon` (el quiosco
-- del operario, el login por correo), se concede.
--
-- 10-comprobar-permisos.sh vuelve a extraerlos de las migraciones y falla si
-- esta lista no coincide.
grant execute on function app_es_admin() to authenticated;
grant execute on function app_es_superadmin() to authenticated;
grant execute on function app_licencias_usuario(uuid) to authenticated;
grant execute on function app_login_email(text) to anon, authenticated;
grant execute on function app_mis_modulos() to authenticated;
grant execute on function pres_login(uuid, text) to service_role;
grant execute on function sea_set_employee_pin(uuid, text) to service_role;
grant execute on function tc_agrupar_operaciones_sueltas(int) to authenticated;
grant execute on function tc_alta_operativa_recuentos(uuid) to authenticated;
grant execute on function tc_alta_operativa_tipo(uuid, uuid) to authenticated;
grant execute on function tc_alta_vehiculo_desde_parte(uuid, text, uuid, uuid, uuid, text, numeric, jsonb) to authenticated;
grant execute on function tc_asignar_base_habitual(uuid, integer, boolean, boolean) to authenticated, service_role;
grant execute on function tc_asignar_numero_intervencion(uuid) to authenticated;
grant execute on function tc_base_habitual(uuid, integer) to authenticated, service_role;
grant execute on function tc_cancelar_intervencion(uuid, text) to authenticated;
grant execute on function tc_corregir_montado(uuid, uuid, text, uuid, text, text) to authenticated;
grant execute on function tc_corregir_montado_nueva_ficha(uuid, text, text, text, text, text, text, uuid, text, text) to authenticated;
grant execute on function tc_corregir_operacion(uuid, jsonb, text) to authenticated;
grant execute on function tc_crear_referencia_provisional(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function tc_deshacer_importacion(uuid, uuid[], boolean) to authenticated, service_role;
grant execute on function tc_ejecutar_en_intervencion(uuid, text, jsonb, uuid) to authenticated;
grant execute on function tc_ejecutar_prevista(uuid, text, jsonb) to authenticated;
grant execute on function tc_eliminar_vehiculo(uuid) to authenticated;
grant execute on function tc_etiquetas_abrir_lote(uuid) to authenticated;
grant execute on function tc_guardar_parte_guiado(jsonb) to authenticated;
grant execute on function tc_imp_ampliar_carga(uuid, boolean) to authenticated, service_role;
grant execute on function tc_imp_bloquear(uuid, text) to service_role;
grant execute on function tc_imp_desfase_mano_obra(uuid) to authenticated, service_role;
grant execute on function tc_imp_exigir_admin(uuid) to service_role;
grant execute on function tc_imp_fijar_limite_km_dia(uuid, numeric) to authenticated, service_role;
grant execute on function tc_imp_huella_estado(uuid) to authenticated, service_role;
grant execute on function tc_imp_huella_intervalo(uuid) to authenticated, service_role;
grant execute on function tc_imp_identificar_unidad(uuid, uuid, boolean, text) to authenticated, service_role;
grant execute on function tc_imp_intervalo_duda_continuidad(tc_reconstruccion_montajes) to authenticated, service_role;
grant execute on function tc_imp_intervalo_duda_km(tc_reconstruccion_montajes) to authenticated, service_role;
grant execute on function tc_imp_intervalo_en_medias(tc_reconstruccion_montajes) to authenticated, service_role;
grant execute on function tc_imp_intervalo_motivos(tc_reconstruccion_montajes) to authenticated, service_role;
grant execute on function tc_imp_limite_km_dia(uuid) to authenticated, service_role;
grant execute on function tc_imp_medianoche(date) to service_role;
grant execute on function tc_imp_num(numeric) to authenticated, service_role;
grant execute on function tc_imp_posiciones_norma(uuid, int, boolean) to authenticated, service_role;
grant execute on function tc_imp_revisar_intervalo(uuid, text, text, text) to authenticated, service_role;
grant execute on function tc_importar_historico(uuid, text, jsonb, boolean) to authenticated, service_role;
grant execute on function tc_informe_control_revisiones(uuid, date, date) to authenticated;
grant execute on function tc_informe_ejecutivo(uuid, date, date) to authenticated;
grant execute on function tc_informes_alertas(uuid) to authenticated;
grant execute on function tc_informes_coste_km_neumatico(uuid) to authenticated;
grant execute on function tc_informes_desgaste(uuid) to authenticated;
grant execute on function tc_informes_economico(uuid, date, date) to authenticated;
grant execute on function tc_informes_estado_flota(uuid) to authenticated;
grant execute on function tc_informes_inventario_marca_medida(uuid) to authenticated;
grant execute on function tc_informes_inventario_por(uuid, text) to authenticated;
grant execute on function tc_informes_inventario_resumen(uuid) to authenticated, service_role;
grant execute on function tc_informes_kpis(uuid, date, date) to authenticated;
grant execute on function tc_informes_montajes(uuid, date, date, text) to authenticated, service_role;
grant execute on function tc_informes_operaciones(uuid, date, date) to authenticated;
grant execute on function tc_informes_presiones(uuid) to authenticated;
grant execute on function tc_informes_productividad(uuid, date, date) to authenticated;
grant execute on function tc_informes_profundidad_distribucion(uuid) to authenticated;
grant execute on function tc_informes_ranking_marcas(uuid) to authenticated;
grant execute on function tc_informes_ranking_vehiculos(uuid, text) to authenticated;
grant execute on function tc_informes_recorridos_estimados(uuid, date, date, uuid) to authenticated, service_role;
grant execute on function tc_iniciar_intervencion(uuid) to authenticated;
grant execute on function tc_inventario_inicial_finalizar(uuid, numeric, text) to authenticated;
grant execute on function tc_inventario_inicial_posicion(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function tc_is_cliente() to authenticated;
grant execute on function tc_neumatico_recorrido(uuid) to authenticated;
grant execute on function tc_norm_medida(text) to authenticated;
grant execute on function tc_op_devolver_tool(uuid, uuid, uuid) to anon;
grant execute on function tc_op_mis_herramientas(uuid) to anon;
grant execute on function tc_op_mover_tool(uuid, uuid, uuid) to anon;
grant execute on function tc_op_reportar_incidencia(uuid, uuid, text, text, uuid) to anon;
grant execute on function tc_op_usar_tool(uuid, uuid) to anon;
grant execute on function tc_operator_login(text, text) to anon;
grant execute on function tc_planificar_intervencion(uuid, uuid, date, uuid, text, text, jsonb) to authenticated;
grant execute on function tc_presencia_hist_cerrar(uuid[], timestamptz) to service_role;
grant execute on function tc_presencia_hist_extender(uuid[], timestamptz) to service_role;
grant execute on function tc_stock_almacen_empresa(uuid) to authenticated;
grant execute on function tc_stock_snapshot_intervencion(uuid) to authenticated;
grant execute on function tc_validar_referencia(uuid) to authenticated;
grant execute on function tc_validar_vehiculo(uuid) to authenticated;
grant select on adm_ot_estado to authenticated;
grant select on tc_clientes_almacen to authenticated;
grant select on tc_importacion_bloqueados to authenticated, service_role;
grant select on tc_marcas_contadores to authenticated;
grant select on tc_productos_almacen to authenticated;
grant select on tc_reconstruccion_ajustes to authenticated, service_role;
grant select on tc_reconstruccion_intervalos to authenticated, service_role;
grant select on tc_reconstruccion_montajes, tc_importacion_eventos to authenticated, service_role;
grant select on tc_reconstruccion_revisiones to authenticated, service_role;
grant select on tc_tipos_plano_descuadrado to authenticated;

-- ── 8. Auxiliares de las políticas RLS y de los valores por defecto ───
-- Las políticas RLS se evalúan con los permisos de quien hace la consulta: si
-- `authenticated` no puede ejecutar tc_puede_ver_empresa(), toda consulta a
-- una tabla con esa política falla con «permission denied for function». Y un
-- valor por defecto que llama a una función se ejecuta al insertar, también
-- con los permisos de quien inserta.
--
-- Va en bucle y no en grants sueltos porque hay módulos cuyas migraciones
-- viven en subcarpetas de supabase/migrations y no están en el banco local
-- (self_storage, por ejemplo): si su función no está, tampoco están sus
-- políticas, y saltarla es correcto. Lo que no se salta es la comprobación:
-- 8.g recalcula las funciones que usan las políticas de las tablas
-- concedidas y falla si falta alguna.
do $$
declare
  v_firma text;
  v_falta text[] := '{}';
begin
  foreach v_firma in array array[
    'adm_can_manage()', 'adm_can_read()',
    'adm_is_admin()', 'adm_rol_actual()',
    'app_empresa_actual()', 'app_es_admin()',
    'self_storage_current_customer_id()', 'tc_auth_empresa_id()',
    'tc_is_admin()', 'tc_is_cliente()',
    'tc_is_superadmin()', 'tc_operador_ve_empresa(emp uuid)',
    'tc_puede_ver_empresa(emp uuid)', 'tc_generar_numero_operacion()'
  ]
  loop
    begin
      execute format('grant execute on function public.%s to authenticated, service_role', v_firma);
    exception when undefined_function then
      v_falta := v_falta || v_firma;
    end;
  end loop;
  if cardinality(v_falta) > 0 then
    raise notice 'No estan en esta base (su modulo no se ha migrado aqui): %',
                 array_to_string(v_falta, ', ');
  end if;
end $$;

-- gen_random_uuid y uuid_generate_v4: en Supabase viven en el esquema
-- `extensions` y los valores por defecto resuelven a pg_catalog, pero en el
-- banco local pgcrypto y uuid-ossp se instalan en `public` y los tapan. Si
-- están ahí, hay que concederlas o cualquier INSERT falla.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'gen_random_uuid') then
    execute 'grant execute on function public.gen_random_uuid() to authenticated, service_role';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'uuid_generate_v4') then
    execute 'grant execute on function public.uuid_generate_v4() to authenticated, service_role';
  end if;
end $$;

-- ── 9. La auditoría de revisiones: lectura y nada más ─────────────────
-- tc_reconstruccion_revisiones es el registro de quién aceptó o rechazó un
-- kilometraje o una continuidad, y por qué. El panel la consulta; escribirla
-- solo puede hacerlo tc_imp_revisar_intervalo, que es `security definer`.
-- El `grant select` está en la sección 7 (lo pone la migración); el revoke se
-- repite aquí para que no lo deshaga nada de lo anterior.
revoke insert, update, delete, truncate on tc_reconstruccion_revisiones
  from anon, authenticated, service_role;

-- ── 10. Comprobaciones que paran la transacción ───────────────────────
do $$
declare
  v_malas text;
  v_vistas text;
  v_anon  text;
begin
  -- a) Ninguna tabla concedida a `authenticated` sin RLS activada y con al
  --    menos una política, salvo la excepción declarada de la sección 5.
  select string_agg(format('%s (rls=%s, politicas=%s)', c.relname, c.relrowsecurity,
                           (select count(*) from pg_policy p where p.polrelid = c.oid)), ', ')
    into v_malas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
    and has_table_privilege('authenticated', c.oid, 'select')
    and c.relname <> all (array['productos_neumaticos'])
    and (not c.relrowsecurity
         or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
  if v_malas is not null then
    raise exception 'Tablas concedidas a authenticated sin RLS util: %', v_malas;
  end if;

  -- b) Y la excepción declarada se queda en solo lectura.
  if has_table_privilege('authenticated', 'productos_neumaticos', 'insert')
     or has_table_privilege('authenticated', 'productos_neumaticos', 'update')
     or has_table_privilege('authenticated', 'productos_neumaticos', 'delete')
     or has_table_privilege('service_role',  'productos_neumaticos', 'insert') then
    raise exception 'La excepcion productos_neumaticos no tiene RLS: solo puede tener select';
  end if;

  -- c) Ninguna vista concedida a `authenticated` que se salte la RLS, salvo
  --    las dos del almacén, que filtran por tc_is_admin() dentro.
  select string_agg(c.relname, ', ') into v_vistas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and has_table_privilege('authenticated', c.oid, 'select')
    and c.relname not in ('tc_clientes_almacen','tc_productos_almacen')
    and coalesce((select true from unnest(c.reloptions) o
                  where o = 'security_invoker=true'), false) is not true;
  if v_vistas is not null then
    raise exception 'Vistas concedidas a authenticated sin security_invoker: %', v_vistas;
  end if;

  -- d) `anon` no tiene ni una tabla ni una vista.
  select string_agg(c.relname, ', ') into v_anon
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m')
    and has_table_privilege('anon', c.oid, 'select');
  if v_anon is not null then
    raise exception 'anon tiene permiso de lectura sobre: %', v_anon;
  end if;

  -- e) La auditoría no admite escritura directa desde ningún rol de la
  --    aplicación.
  if has_table_privilege('authenticated', 'tc_reconstruccion_revisiones', 'insert')
     or has_table_privilege('service_role', 'tc_reconstruccion_revisiones', 'update')
     or has_table_privilege('anon', 'tc_reconstruccion_revisiones', 'insert') then
    raise exception 'La auditoria tc_reconstruccion_revisiones admite escritura directa';
  end if;

  -- f) Ninguna función del esquema queda ejecutable por PUBLIC.
  select string_agg(p.proname, ', ') into v_malas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE');
  if v_malas is not null then
    raise exception 'Funciones ejecutables por PUBLIC: %', v_malas;
  end if;

  -- g) Toda función que use la política RLS de una tabla concedida a
  --    `authenticated` tiene que ser ejecutable por `authenticated`. Esto es
  --    lo que garantiza que no falte ningún auxiliar de la sección 8.
  select string_agg(distinct f.proname || '()', ', ') into v_malas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_policy pol on pol.polrelid = c.oid
  join pg_proc f on f.pronamespace = n.oid
  where n.nspname = 'public' and c.relkind in ('r','p')
    and has_table_privilege('authenticated', c.oid, 'select')
    and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
         coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
        ~ ('\m' || f.proname || '\s*\(')
    and not has_function_privilege('authenticated', f.oid, 'execute');
  if v_malas is not null then
    raise exception 'Las politicas RLS usan funciones que authenticated no puede ejecutar: %', v_malas;
  end if;

  -- h) Ninguna secuencia concedida: si aparece una, es que una tabla nueva
  --    lleva `serial` y hay que decidirlo a mano.
  select string_agg(c.relname, ', ') into v_malas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
    and (has_sequence_privilege('authenticated', c.oid, 'usage')
         or has_sequence_privilege('anon', c.oid, 'usage'));
  if v_malas is not null then
    raise exception 'Secuencias concedidas sin decidirlo: %', v_malas;
  end if;

  -- i) No quedan default privileges globales en el esquema. Son los que hacían
  --    que cada objeto nuevo naciera abierto, y el arranque de Express crea
  --    tablas (prepararEsquema).
  select string_agg(format('%s (dueno %s)', d.defaclobjtype, pg_get_userbyid(d.defaclrole)), ', ')
    into v_malas
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public'
    and exists (select 1 from aclexplode(d.defaclacl) a
                where pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role'));
  if v_malas is not null then
    raise exception 'Quedan default privileges en public para anon/authenticated/service_role: %. '
                    'Hay que retirarlos CONECTADO COMO EL ROL QUE LOS PUSO (el del parentesis): '
                    'alter default privileges in schema public revoke all on tables from '
                    'anon, authenticated, service_role; e igual para sequences y functions.',
                    v_malas;
  end if;

  raise notice 'Permisos de pruebas aplicados y comprobados.';
end $$;

commit;
