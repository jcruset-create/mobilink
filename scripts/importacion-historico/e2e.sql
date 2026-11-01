-- lotes_json llega como variable de psql (-v lotes_json=...)
create temp table lotes as select value as lote from jsonb_array_elements(:'lotes_json'::jsonb);
\echo --- simulación (solo lectura)
select r->>'periodo' periodo, r->>'creadas' se_crearian, r->>'bloqueados' bloq, r->>'duplicados_probables' dup from (select tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote, true) r from lotes) x;
select count(*) intervenciones_tras_simular, (select count(*) from tc_importacion_cargas) cargas_tras_simular from tc_intervenciones;
\echo --- importar lote a lote (misma carga)
do $$ declare l record; r jsonb; a jsonb; c uuid; begin
  for l in select lote from lotes order by lote->>'periodo' loop
    r := tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', l.lote || jsonb_build_object('carga_id', c), false);
    c := (r->>'carga_id')::uuid;
    raise notice '% creadas=% bloq=% presentes=%', r->>'periodo', r->>'creadas', r->>'bloqueados', r->>'ya_presentes';
    for a in select * from jsonb_array_elements(r->'albaranes') loop
      if a->>'estado' = 'bloqueado' then raise notice '   bloqueado %: %', a->>'origen_doc', a->>'motivo'; end if;
    end loop;
  end loop;
end $$;
\echo --- B2_26/4905
select i.numero, i.fecha, i.cerrada_at, i.hora_desconocida, i.mecanico_km, i.n_operaciones, i.importacion_lote_id is not null as vinculo from tc_intervenciones i where i.origen_doc='B2_26/4905|7724KBM';
select o.condicion, o.marca_txt, o.modelo_txt, o.medida_txt, p.codigo_posicion, o.posicion_fuente, o.km_vehiculo, o.status, o.source from operaciones_neumaticos o left join tc_posiciones_vehiculo p on p.id=o.posicion_destino_id join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/4905|7724KBM' order by o.origen_linea;
select s.servicio, s.cantidad from tc_intervencion_servicios s join tc_intervenciones i on i.id=s.intervencion_id where i.origen_doc='B2_26/4905|7724KBM' order by 1;
select papel, count(*), sum(importe_linea) from tc_importacion_lineas l join tc_intervenciones i on i.id=l.intervencion_id where i.origen_doc='B2_26/4905|7724KBM' group by 1 order by 1;
\echo --- recuentos por albarán
select i.origen_doc, i.n_operaciones, (select count(*) from operaciones_neumaticos o where o.intervencion_id=i.id and o.posicion_destino_id is not null) con_posicion, (select count(*) from tc_intervencion_servicios s where s.intervencion_id=i.id) srv, (select count(*) from tc_importacion_lineas l where l.intervencion_id=i.id) lin from tc_intervenciones i order by i.fecha, i.origen_doc;
\echo --- fotografía igual
select foto() = (select antes from _foto) as datos_actuales_intactos, (select km_actual from tc_vehiculos where matricula='7724KBM') km_actual_7724;
\echo --- recarga
select r->>'periodo' periodo, r->>'creadas' creadas, r->>'ya_presentes' presentes from (select tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', lote, false) r from lotes) x;
\echo --- cambiado: 4905 con otra huella
select r->'albaranes'->0->>'estado' estado from (select tc_importar_historico('00000000-0000-0000-0000-0000000000e1','genes', jsonb_build_object('periodo','2026-10','albaranes', jsonb_build_array((select a || jsonb_build_object('huella_origen','otra') from lotes, jsonb_array_elements(lote->'albaranes') a where a->>'origen_doc'='B2_26/4905|7724KBM'))), true) r) x;
\echo --- deshacer parcial: anular una operación de 4310 y deshacer su lote
update operaciones_neumaticos set status='anulada', is_anulada=true where id = (select o.id from operaciones_neumaticos o join tc_intervenciones i on i.id=o.intervencion_id where i.origen_doc='B2_26/4310|9005KMR' limit 1);
select r->>'borradas' borradas, r->>'conservadas' conservadas, r->>'estado' estado, (select string_agg(d->>'origen_doc'||': '||(d->'motivos')::text, ' | ') from jsonb_array_elements(r->'detalle') d where d->>'resultado'='conservada') conservadas_detalle
  from (select tc_deshacer_importacion((select importacion_lote_id from tc_intervenciones where origen_doc='B2_26/4310|9005KMR'), '{}', false) r) x;
select estado carga_estado from tc_importacion_cargas;
\echo --- deshacer el resto de lotes
do $$ declare l record; begin for l in select id from tc_importacion_lotes where estado='aplicado' loop perform tc_deshacer_importacion(l.id, '{}', false); end loop; end $$;
select (select count(*) from tc_intervenciones) quedan_interv, (select count(*) from operaciones_neumaticos) quedan_ops, (select count(*) from tc_importacion_lineas) quedan_lineas, (select string_agg(estado,',') from tc_importacion_cargas) carga;
select origen_doc, n_operaciones from tc_intervenciones;
select foto() = (select antes from _foto) as datos_actuales_intactos;
