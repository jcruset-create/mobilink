-- ⛔ SOLO PARA UN ENTORNO DE PRUEBAS. No es una migración.
--
-- Datos SINTÉTICOS con las configuraciones que la prueba de la importación
-- histórica necesita. Ni una fila viene de producción: las matrículas que
-- coinciden con las reales (1445HWZ, 4452MSG, 7724KBM…) son fichas vacías con
-- su plano de posiciones, creadas aquí, para poder reproducir los casos del
-- Excel. No traen kilómetros, ni montajes, ni histórico.
--
--   psql "$DESTINO_URL" -f scripts/staging/semilla-staging.sql
--
-- Se niega a ejecutarse en una base que no esté marcada como de pruebas.

\set ON_ERROR_STOP on
do $$ begin
  if coalesce(current_setting('mobilink.entorno', true), '') <> 'pruebas' then
    raise exception 'Esta base no está marcada como entorno de pruebas (mobilink.entorno). No se siembra nada.';
  end if;
end $$;

-- ── El catálogo de servicios, que NO viaja en el volcado ───────────────────
--
-- Son datos, y un `pg_dump --schema-only` no los trae. Sin ellos, la
-- importación bloquea TODOS los albaranes que lleven servicios con
-- «Servicio desconocido: …», comprobado. Los doce códigos son los que crea
-- la migración `tyrecontrol_parte_servicio.sql` en producción.
insert into tc_cat_servicios (codigo, nombre, unidad, orden, activo) values
  ('desmontar_montar_cubierta', 'Desmontar/Montar cubierta',               'unidad', 10, true),
  ('quitar_poner_rueda',        'Quitar y poner rueda del vehículo',       'unidad', 20, true),
  ('equilibrado',               'Equilibrados',                            'unidad', 30, true),
  ('valvulas',                  'Válvulas',                                'unidad', 40, true),
  ('alargaderas',               'Alargaderas',                             'unidad', 50, true),
  ('pinchazo',                  'Pinchazo',                                'unidad', 60, true),
  ('rayados',                   'Rayados',                                 'unidad', 70, true),
  ('alineacion_standard',       'Alineación de dirección (standard)',      'unidad', 80, true),
  ('alineacion_compleja',       'Alineación de dirección (compleja)',      'unidad', 90, true),
  ('salida_servicio_movil',     'Salida de servicio móvil',                'unidad', 100, true),
  ('horas_oficial_1a',          'Horas de oficial de 1ª (servicio móvil)', 'hora',   110, true),
  ('km_recorridos',             'Kilómetros recorridos',                   'km',     120, true)
on conflict (codigo) do nothing;

-- ── La empresa de pruebas ──────────────────────────────────────────────────
insert into tc_empresas (id, nombre)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Pruebas · flota sintética')
on conflict (id) do nothing;

-- ── Los planos: cada configuración que la prueba tiene que distinguir ─────
--
-- La regla de la casa es: 2 nuevas → eje 1; 4 nuevas → eje 2; 6 nuevas → 2 al
-- eje 1 y 4 al eje 2. Se aplica cuando hay UNA sola referencia y el eje 1
-- tiene exactamente 2 posiciones activas y el eje 2 exactamente 4. Que exista
-- un tercer eje NO lo impide: 2+4+2 y 2+4+4 también la admiten.
insert into tc_tipos_vehiculo (id, nombre) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'PRUEBAS · 2+4 (autocar)'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'PRUEBAS · 2+4+2 (camión 3 ejes)'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'PRUEBAS · 2+4+4 (tractora 4 ejes)'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'PRUEBAS · 2+2 (furgoneta)'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'PRUEBAS · sin plano de posiciones')
on conflict (id) do nothing;

insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado, interior_exterior, orden_visual, activo)
select t.id, p.codigo, p.eje, p.lado, p.ie, p.orden, true
  from (values
    -- 2+4
    ('bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'E1_IZQ',1,'izq',null,1),
    ('bbbbbbbb-0000-4000-8000-000000000001','E1_DER',1,'der',null,2),
    ('bbbbbbbb-0000-4000-8000-000000000001','E2_IZQ_EXT',2,'izq','ext',3),
    ('bbbbbbbb-0000-4000-8000-000000000001','E2_IZQ_INT',2,'izq','int',4),
    ('bbbbbbbb-0000-4000-8000-000000000001','E2_DER_INT',2,'der','int',5),
    ('bbbbbbbb-0000-4000-8000-000000000001','E2_DER_EXT',2,'der','ext',6),
    -- 2+4+2
    ('bbbbbbbb-0000-4000-8000-000000000002','E1_IZQ',1,'izq',null,1),
    ('bbbbbbbb-0000-4000-8000-000000000002','E1_DER',1,'der',null,2),
    ('bbbbbbbb-0000-4000-8000-000000000002','E2_IZQ_EXT',2,'izq','ext',3),
    ('bbbbbbbb-0000-4000-8000-000000000002','E2_IZQ_INT',2,'izq','int',4),
    ('bbbbbbbb-0000-4000-8000-000000000002','E2_DER_INT',2,'der','int',5),
    ('bbbbbbbb-0000-4000-8000-000000000002','E2_DER_EXT',2,'der','ext',6),
    ('bbbbbbbb-0000-4000-8000-000000000002','E3_IZQ',3,'izq',null,7),
    ('bbbbbbbb-0000-4000-8000-000000000002','E3_DER',3,'der',null,8),
    -- 2+4+4
    ('bbbbbbbb-0000-4000-8000-000000000003','E1_IZQ',1,'izq',null,1),
    ('bbbbbbbb-0000-4000-8000-000000000003','E1_DER',1,'der',null,2),
    ('bbbbbbbb-0000-4000-8000-000000000003','E2_IZQ_EXT',2,'izq','ext',3),
    ('bbbbbbbb-0000-4000-8000-000000000003','E2_IZQ_INT',2,'izq','int',4),
    ('bbbbbbbb-0000-4000-8000-000000000003','E2_DER_INT',2,'der','int',5),
    ('bbbbbbbb-0000-4000-8000-000000000003','E2_DER_EXT',2,'der','ext',6),
    ('bbbbbbbb-0000-4000-8000-000000000003','E3_IZQ_EXT',3,'izq','ext',7),
    ('bbbbbbbb-0000-4000-8000-000000000003','E3_IZQ_INT',3,'izq','int',8),
    ('bbbbbbbb-0000-4000-8000-000000000003','E3_DER_INT',3,'der','int',9),
    ('bbbbbbbb-0000-4000-8000-000000000003','E3_DER_EXT',3,'der','ext',10),
    -- 2+2
    ('bbbbbbbb-0000-4000-8000-000000000004','E1_IZQ',1,'izq',null,1),
    ('bbbbbbbb-0000-4000-8000-000000000004','E1_DER',1,'der',null,2),
    ('bbbbbbbb-0000-4000-8000-000000000004','E2_IZQ',2,'izq',null,3),
    ('bbbbbbbb-0000-4000-8000-000000000004','E2_DER',2,'der',null,4)
  ) p(tipo, codigo, eje, lado, ie, orden)
  join tc_tipos_vehiculo t on t.id = p.tipo
on conflict (tipo_vehiculo_id, codigo_posicion) do nothing;

-- ── Los vehículos, uno por caso de la prueba ──────────────────────────────
--
-- km_actual a 0 y origen_km 'manual' a propósito: la importación NO debe
-- tocar ni una cosa ni la otra, y así se ve si lo hace.
insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual, origen_km, activo)
values
  -- El caso de kilometraje anómalo con albarán bloqueado en medio.
  ('cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','1445HWZ',0,'manual',true),
  -- El caso con OR disponibles (evidencia complementaria, no obligatoria).
  ('cccccccc-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002','4452MSG',0,'manual',true),
  -- El albarán de referencia del parte: 2 nuevas + 2 usadas.
  ('cccccccc-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','7724KBM',0,'manual',true),
  -- 2+4+4: seis nuevas tienen que colocarse igual (el tercer eje no estorba).
  ('cccccccc-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000003','PRU244A',0,'manual',true),
  -- 2+2: seis nuevas NO encajan y la asignación queda pendiente.
  ('cccccccc-0000-4000-8000-000000000005','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000004','PRU22AA',0,'manual',true),
  -- Tipo sin plano: posiciones desconocidas, pero el albarán se importa.
  ('cccccccc-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000005','PRUSPLA',0,'manual',true),
  -- Vehículo sin tipo ninguno.
  ('cccccccc-0000-4000-8000-000000000007','aaaaaaaa-0000-4000-8000-000000000001',null,'PRUSTIP',0,'manual',true),
  -- Para el caso de varias referencias en el mismo albarán.
  ('cccccccc-0000-4000-8000-000000000008','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','PRUREFS',0,'manual',true),
  -- Para la prueba de conservación: tendrá montajes vivos y revisiones.
  ('cccccccc-0000-4000-8000-000000000009','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','PRUVIVO',123456,'manual',true)
on conflict (id) do nothing;

-- La matrícula que NO existe y que la simulación tiene que reportar como
-- vehículo no encontrado se queda sin crear a propósito: PRUNOEX.

-- ── Qué comprobar después de sembrar ─────────────────────────────────────
do $$
declare v_244 uuid := 'cccccccc-0000-4000-8000-000000000004';
        v_22  uuid := 'cccccccc-0000-4000-8000-000000000005';
begin
  raise notice 'Servicios en el catálogo: % (sin ellos la importación bloquea todo lo que lleve servicios)',
    (select count(*) from tc_cat_servicios where activo);
  raise notice 'Vehículos sembrados: %', (select count(*) from tc_vehiculos where empresa_id='aaaaaaaa-0000-4000-8000-000000000001');
  raise notice 'La matrícula PRUNOEX NO existe (es el caso de vehículo no encontrado): %',
    (select count(*) = 0 from tc_vehiculos where matricula='PRUNOEX');
  -- Si la fase 1 ya está aplicada, la norma de posiciones se puede comprobar aquí.
  if exists (select 1 from pg_proc where proname='tc_imp_posiciones_norma') then
    raise notice '2+4+4 con 6 nuevas de una referencia → % posiciones (esperado 6)',
      coalesce(array_length(tc_imp_posiciones_norma(v_244, 6, true), 1), 0);
    raise notice '2+2 con 6 nuevas → % (esperado NULL: el plano no la admite)',
      tc_imp_posiciones_norma(v_22, 6, true);
    raise notice '2+4+4 con 6 nuevas de VARIAS referencias → % (esperado NULL)',
      tc_imp_posiciones_norma(v_244, 6, false);
  else
    raise notice 'Las migraciones de la importación todavía no están aplicadas en esta base.';
  end if;
end $$;
