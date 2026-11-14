-- ─────────────────────────────────────────────────────────────────────────
-- PREFLIGHT DE PRODUCCIÓN · importación del histórico de Plana (PR #492)
--
-- GENERADO. No se edita a mano: sale de las tres migraciones con
--   python3 scripts/produccion/generar-preflight-sql.py
--
-- SOLO LECTURA: son `select` y nada más. No crea, no borra y no modifica.
-- Se pega entero en el editor SQL de Supabase (proyecto de PRODUCCIÓN) y se
-- devuelve la tabla que sale.
--
-- Cómo se lee la columna `estado`:
--   PARA  → no se sigue adelante hasta entenderlo.
--   MIRA  → hay que mirarlo, puede estar bien.
--   OK    → comprobado.
--   DATO  → no es una comprobación, es información que hace falta.
--
-- Comprueba 23 tablas, 49 columnas y 5 funciones que las migraciones dan
-- por supuestas, las 29 firmas que redefinen y los 11 objetos que crean.
-- ─────────────────────────────────────────────────────────────────────────

with
-- Lo que las migraciones dan por supuesto que ya existe.
req_tabla(t) as (values ('autorizaciones_operaciones'), ('operaciones_neumaticos'), ('revisiones_neumaticos_detalle'), ('tc_cat_marcas_neumatico'), ('tc_cat_modelos_neumatico'), ('tc_cat_servicios'), ('tc_empresas'), ('tc_historial_montajes'), ('tc_incidencia_operaciones'), ('tc_incidencia_problemas'), ('tc_incidencias'), ('tc_intervencion_servicios'), ('tc_intervenciones'), ('tc_montajes_actuales'), ('tc_neumaticos'), ('tc_operacion_adjuntos'), ('tc_operacion_auditoria'), ('tc_operacion_estado_historial'), ('tc_operacion_movimientos'), ('tc_partes_guiados'), ('tc_posiciones_vehiculo'), ('tc_reservas_neumatico'), ('tc_vehiculos')),
req_col(t, c) as (values ('operaciones_neumaticos', 'destino'), ('operaciones_neumaticos', 'empresa_id'), ('operaciones_neumaticos', 'estado_anterior'), ('operaciones_neumaticos', 'fecha_operacion'), ('operaciones_neumaticos', 'id'), ('operaciones_neumaticos', 'intervencion_id'), ('operaciones_neumaticos', 'km_vehiculo'), ('operaciones_neumaticos', 'observaciones'), ('operaciones_neumaticos', 'posicion_destino_id'), ('operaciones_neumaticos', 'posicion_origen_id'), ('operaciones_neumaticos', 'source'), ('operaciones_neumaticos', 'status'), ('operaciones_neumaticos', 'tipo_operacion'), ('operaciones_neumaticos', 'vehiculo_id'), ('tc_empresas', 'id'), ('tc_intervencion_servicios', 'cantidad'), ('tc_intervencion_servicios', 'intervencion_id'), ('tc_intervencion_servicios', 'observaciones'), ('tc_intervencion_servicios', 'servicio'), ('tc_intervenciones', 'cerrada_at'), ('tc_intervenciones', 'empresa_id'), ('tc_intervenciones', 'fecha'), ('tc_intervenciones', 'id'), ('tc_intervenciones', 'mecanico_km'), ('tc_intervenciones', 'n_operaciones'), ('tc_intervenciones', 'numero'), ('tc_intervenciones', 'observaciones'), ('tc_intervenciones', 'resumen'), ('tc_intervenciones', 'vehiculo_id'), ('tc_neumaticos', 'activo'), ('tc_neumaticos', 'codigo_interno'), ('tc_neumaticos', 'control_individual'), ('tc_neumaticos', 'creado_automaticamente'), ('tc_neumaticos', 'empresa_id'), ('tc_neumaticos', 'estado'), ('tc_neumaticos', 'id'), ('tc_neumaticos', 'marca'), ('tc_neumaticos', 'medida'), ('tc_neumaticos', 'modelo'), ('tc_neumaticos', 'numero_interno'), ('tc_neumaticos', 'origen'), ('tc_neumaticos', 'posicion_id'), ('tc_neumaticos', 'vehiculo_id'), ('tc_operacion_auditoria', 'accion'), ('tc_operacion_auditoria', 'datos_anteriores'), ('tc_operacion_auditoria', 'motivo'), ('tc_operacion_auditoria', 'operacion_id'), ('tc_posiciones_vehiculo', 'id'), ('tc_vehiculos', 'id')),
req_fn(f) as (values ('tc_auth_empresa_id'), ('tc_generar_numero_interno'), ('tc_is_admin'), ('tc_is_superadmin'), ('tc_puede_ver_empresa')),
-- Las funciones que el PR REDEFINE: la firma tiene que coincidir EXACTA, o
-- `create or replace` crearía una segunda y PostgREST devolvería PGRST203.
redef(nombre, firma) as (values ('tc_anular_operacion', 'public.tc_anular_operacion(uuid, text)'), ('tc_deshacer_importacion', 'public.tc_deshacer_importacion(uuid, uuid[], boolean)'), ('tc_imp_ampliar_carga', 'public.tc_imp_ampliar_carga(uuid, boolean)'), ('tc_imp_ampliar_intervencion', 'public.tc_imp_ampliar_intervencion(uuid)'), ('tc_imp_anotar_bloqueado', 'public.tc_imp_anotar_bloqueado(uuid, uuid, text, jsonb, text)'), ('tc_imp_bloquear', 'public.tc_imp_bloquear(uuid, text)'), ('tc_imp_desfase_mano_obra', 'public.tc_imp_desfase_mano_obra(uuid)'), ('tc_imp_exigir_admin', 'public.tc_imp_exigir_admin(uuid)'), ('tc_imp_ficha_historica', 'public.tc_imp_ficha_historica(uuid, uuid, text, text, uuid, text, text, text)'), ('tc_imp_fijar_limite_km_dia', 'public.tc_imp_fijar_limite_km_dia(uuid, numeric)'), ('tc_imp_huella_estado', 'public.tc_imp_huella_estado(uuid)'), ('tc_imp_huella_intervalo', 'public.tc_imp_huella_intervalo(uuid)'), ('tc_imp_identificar_unidad', 'public.tc_imp_identificar_unidad(uuid, uuid, boolean, text)'), ('tc_imp_intervalo_duda_continuidad', 'public.tc_imp_intervalo_duda_continuidad(tc_reconstruccion_montajes)'), ('tc_imp_intervalo_duda_km', 'public.tc_imp_intervalo_duda_km(tc_reconstruccion_montajes)'), ('tc_imp_intervalo_en_medias', 'public.tc_imp_intervalo_en_medias(tc_reconstruccion_montajes)'), ('tc_imp_intervalo_motivos', 'public.tc_imp_intervalo_motivos(tc_reconstruccion_montajes)'), ('tc_imp_limite_km_dia', 'public.tc_imp_limite_km_dia(uuid)'), ('tc_imp_medianoche', 'public.tc_imp_medianoche(date)'), ('tc_imp_num', 'public.tc_imp_num(numeric)'), ('tc_imp_posiciones_norma', 'public.tc_imp_posiciones_norma(uuid, int, boolean)'), ('tc_imp_reconstruir_vehiculo', 'public.tc_imp_reconstruir_vehiculo(uuid)'), ('tc_imp_revisar_intervalo', 'public.tc_imp_revisar_intervalo(uuid, text, text, text)'), ('tc_importar_historico', 'public.tc_importar_historico(uuid, text, jsonb, boolean)'), ('tc_informes_inventario_marca_medida', 'public.tc_informes_inventario_marca_medida(uuid)'), ('tc_informes_inventario_por', 'public.tc_informes_inventario_por(uuid, text)'), ('tc_informes_inventario_resumen', 'public.tc_informes_inventario_resumen(uuid)'), ('tc_informes_montajes', 'public.tc_informes_montajes(uuid, date, date, text)'), ('tc_informes_recorridos_estimados', 'public.tc_informes_recorridos_estimados(uuid, date, date, uuid)')),
-- Lo que el PR CREA: si ya está, alguien lo aplicó antes o hay choque de nombres.
crea_tabla(t) as (values ('tc_importacion_bloqueados'), ('tc_importacion_cargas'), ('tc_importacion_eventos'), ('tc_importacion_intervenciones'), ('tc_importacion_lineas'), ('tc_importacion_lotes'), ('tc_reconstruccion_ajustes'), ('tc_reconstruccion_montajes'), ('tc_reconstruccion_revisiones')),
crea_vista(v) as (values ('tc_marcas_contadores'), ('tc_reconstruccion_intervalos')),

-- ── 1. A qué base se está mirando ────────────────────────────────────────
r1 as (
  select 1 ord, '1. Base' seccion, 'DATO' estado,
         'base=' || current_database() ||
         ' · tablas en public=' || (select count(*) from pg_tables where schemaname = 'public') ||
         ' · ' || substring(version() from 'PostgreSQL [0-9.]+') detalle
  union all
  select 1, '1. Base',
         case when coalesce(current_setting('mobilink.entorno', true), '') = 'pruebas'
              then 'PARA' else 'OK' end,
         case when coalesce(current_setting('mobilink.entorno', true), '') = 'pruebas'
              then 'esta base lleva la marca «pruebas»: NO es producción'
              else 'sin marca de entorno de pruebas (producción no la lleva)' end
),

-- ── 2. Las empresas, con su UUID ─────────────────────────────────────────
-- Plana se confirma por UUID, nunca por el nombre: hay nombres parecidos.
--
-- Va por `query_to_xml` y no como consulta normal a propósito: una tabla que
-- no existiera haría fallar el ENTERO al analizarlo, y entonces este
-- preflight no comprobaría nada en vez de comprobar lo que sí puede. El
-- `case` garantiza que la consulta de dentro solo se ejecuta si está la tabla.
emp(x) as (
  select case when to_regclass('public.tc_empresas') is null then null else query_to_xml(
      'select e.id::text || ''  '' || rpad(e.nombre, 28)'
      || case when to_regclass('public.tc_vehiculos') is not null
              then ' || ''  vehiculos='' || (select count(*) from tc_vehiculos v where v.empresa_id = e.id)'
              else '' end
      || case when to_regclass('public.tc_neumaticos') is not null
              then ' || ''  neumaticos='' || (select count(*) from tc_neumaticos n where n.empresa_id = e.id)'
              else '' end
      -- tableforest=false: un solo <table> raíz. Con `true` salen <row>
      -- sueltos, que no son un documento XML y xpath no los traga.
      || ' as d from tc_empresas e order by e.nombre', false, false, '') end
),
r2 as (
  -- Sin filas, `query_to_xml` devuelve un documento vacío y `xpath` se queja:
  -- se sustituye por una tabla vacía de verdad.
  select 2, '2. Empresas', 'DATO',
         unnest(xpath('/table/row/d/text()', coalesce(nullif(x::text, ''), '<table/>')::xml))::text
    from emp where x is not null
  union all
  select 2, '2. Empresas', 'PARA', 'no existe tc_empresas: ¿es esta la base de TyreControl?'
   where to_regclass('public.tc_empresas') is null
),

-- ── 3. Lo que tiene que existir y no existe ──────────────────────────────
r3 as (
  select 3, '3. Falta', 'PARA', 'falta la tabla ' || t
    from req_tabla where to_regclass('public.' || t) is null
  union all
  select 3, '3. Falta', 'PARA', 'falta la columna ' || t || '.' || c
    from req_col
   where to_regclass('public.' || t) is not null
     and not exists (select 1 from information_schema.columns i
                      where i.table_schema = 'public' and i.table_name = t and i.column_name = c)
  union all
  select 3, '3. Falta', 'PARA', 'falta la función ' || f
    from req_fn
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = f)
  union all
  select 3, '3. Falta', 'OK', 'están las 23 tablas, las 49 columnas y las 5 funciones que las migraciones dan por supuestas'
   where not exists (select 1 from req_tabla where to_regclass('public.' || t) is null)
     and not exists (select 1 from req_col
                      where to_regclass('public.' || t) is not null
                        and not exists (select 1 from information_schema.columns i
                                         where i.table_schema='public' and i.table_name=t and i.column_name=c))
     and not exists (select 1 from req_fn
                      where not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                         where n.nspname='public' and p.proname=f))
),

-- ── 4. Firmas: ¿la que hay es la que se va a redefinir? ──────────────────
sobre as (
  select r.nombre, r.firma,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = r.nombre) sobrecargas,
         to_regprocedure(r.firma) is not null exacta
    from redef r
),
r4 as (
  select 4, '4. Firmas', 'PARA',
         nombre || ': existe con OTRA firma (' || sobrecargas || ' sobrecarga(s)); la esperada es ' ||
         firma || '. Redefinir crearía una segunda y PostgREST daría PGRST203'
    from sobre where sobrecargas > 0 and not exacta
  union all
  select 4, '4. Firmas', 'MIRA',
         nombre || ': ya tiene ' || sobrecargas || ' sobrecargas en la base'
    from sobre where sobrecargas > 1 and exacta
  union all
  select 4, '4. Firmas', 'OK',
         (select count(*) from sobre where exacta)::text || ' de 29 firmas coinciden exactas; ' ||
         (select count(*) from sobre where sobrecargas = 0)::text || ' no existen todavía (las crea el PR)'
),

-- ── 5. Lo que el PR crea y YA está ───────────────────────────────────────
r5 as (
  select 5, '5. Ya existe', 'MIRA', 'la tabla ' || t || ' ya existe: ¿se importó antes?'
    from crea_tabla where to_regclass('public.' || t) is not null
  union all
  select 5, '5. Ya existe', 'MIRA', 'la vista ' || v || ' ya existe'
    from crea_vista where to_regclass('public.' || v) is not null
  union all
  select 5, '5. Ya existe', 'OK', 'ninguno de los 11 objetos que crea el PR existe todavía'
   where not exists (select 1 from crea_tabla where to_regclass('public.' || t) is not null)
     and not exists (select 1 from crea_vista where to_regclass('public.' || v) is not null)
),

-- ── 6. ¿Hay ya datos de una importación anterior? ────────────────────────
r6 as (
  select 6, '6. Importado', 'MIRA',
         'tc_importacion_lotes existe con ' ||
         (select count(*) from information_schema.tables
           where table_schema='public' and table_name='tc_importacion_lotes')::text ||
         ' definición: revisa los lotes antes de nada'
   where to_regclass('public.tc_importacion_lotes') is not null
  union all
  select 6, '6. Importado', 'OK', 'no hay tablas de importación: la base está virgen para esto'
   where to_regclass('public.tc_importacion_lotes') is null
),

-- ── 7. Disparadores de las tablas que la importación escribe ─────────────
-- Un trigger que nadie esperaba puede mover stock o tocar el montaje actual
-- cuando se inserte una operación histórica.
r7 as (
  select 7, '7. Triggers', 'DATO',
         c.relname || ' · ' || t.tgname || ' · ' || p.proname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and n.nspname = 'public'
     and c.relname in ('operaciones_neumaticos', 'tc_intervenciones',
                       'tc_intervencion_servicios', 'tc_neumaticos')
),

-- ── 8. Lo que este preflight NO comprueba ────────────────────────────────
r8 as (
  select 8, '8. Sin comprobar', 'MIRA', m
    from (values
      ('el backup: hay que hacerlo y verificarlo aparte'),
      ('que PostgREST aguante el lote grande en una sola llamada'),
      ('los planos reales de cada vehículo, que usa la deducción de posiciones'),
      ('el contenido del Excel: eso lo concilia el panel al subirlo')
    ) x(m)
)
select seccion, estado, detalle
  from (select * from r1 union all select * from r2 union all select * from r3
        union all select * from r4 union all select * from r5 union all select * from r6
        union all select * from r7 union all select * from r8) todo
 order by ord,
          case estado when 'PARA' then 0 when 'MIRA' then 1 when 'OK' then 2 else 3 end,
          detalle;
