-- ============================================================
-- Plana: periodicidad de revisión (60 días) a los 64 vehículos sin ella
--
-- El informe ejecutivo de Plana decía «64 vehículos sin periodicidad
-- configurada: no cuentan ni como al día ni como vencidos». Son todos
-- vehículos SIN TIPO: la periodicidad sale del tipo de vehículo, y sin tipo
-- no tenían ninguna. Jordi pide ponerles revisión como mínimo cada 2 meses.
--
-- Se pone en el propio vehículo (tc_vehiculos.revision_intervalo_dias = 60),
-- que es el valor que manda sobre el del tipo y el mismo que lleva el resto
-- de la flota. Cuando se les ponga tipo, seguirán con sus 60 días.
--
-- Solo estos 64, por matrícula, de Plana, activos y sin intervalo propio. No
-- toca el tipo, los km, los ejes ni ningún neumático.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
-- Repetida, no hace nada. Si algo no cuadra, se deshace entera.
-- ============================================================

do $migracion$
declare
  v_empresa constant uuid := 'a51c9662-4b6f-4681-8e2b-599e109659eb';  -- Empresa Plana S.L.
  v_matriculas constant text[] := array[
      '0046JFY',
      '0063KJW',
      '0128HYY',
      '0197KXT',
      '0686FSZ',
      '1761LWP',
      '1949JJR',
      '1956JJR',
      '1960JJR',
      '2001JJR',
      '2009JJR',
      '2135MGJ',
      '2171MHF',
      '2207MHF',
      '2380JBT',
      '2706KWW',
      '3152LWT',
      '3163LWT',
      '3213HSW',
      '3281KWL',
      '3361NSV',
      '3362NSV',
      '3363NSV',
      '3403KMS',
      '3432KMZ',
      '3445KMZ',
      '3748JNX',
      '3818KMZ',
      '3849HYZ',
      '4231JYJ',
      '4317JYJ',
      '4326JYJ',
      '4341JYJ',
      '4419KVZ',
      '4430KVZ',
      '4434KVZ',
      '5009HYZ',
      '5108JXX',
      '5751GHW',
      '5855NBC',
      '5871NMK',
      '5872NMK',
      '5873NMK',
      '5874NMK',
      '7378KWR',
      '7492HTY',
      '7523NNB',
      '7764KMB',
      '7986NBM',
      '8117NBC',
      '8773NMX',
      '8774NMX',
      '8775NMX',
      '9002KMR',
      '9005KMR',
      '9020KMR',
      '9182KWS',
      '9266KKK',
      '9421NBR',
      '9473KXB',
      '9474KSB',
      '9488KXB',
      '9986CDL',
      'B0432UG'
  ];
  v_encontrados int;
  v_cambiados int;
  v_quedan int;
begin
  if array_length(v_matriculas, 1) <> 64 then
    raise exception 'La lista tenía que traer 64 matrículas y trae %.', array_length(v_matriculas, 1);
  end if;

  select count(*) into v_encontrados
    from tc_vehiculos
   where empresa_id = v_empresa and activo and matricula = any(v_matriculas);
  if v_encontrados <> 64 then
    raise exception 'De las 64 matrículas solo hay % activas en Plana: no se toca nada.', v_encontrados;
  end if;

  update tc_vehiculos
     set revision_intervalo_dias = 60, updated_at = now()
   where empresa_id = v_empresa and activo and matricula = any(v_matriculas)
     and revision_intervalo_dias is null;
  get diagnostics v_cambiados = row_count;

  -- Comprobación: ninguno de los 64 se queda sin periodicidad efectiva.
  select count(*) into v_quedan
    from tc_vehiculos v
    left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
   where v.empresa_id = v_empresa and v.activo and v.matricula = any(v_matriculas)
     and coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) is null;
  if v_quedan > 0 then
    raise exception 'Siguen % vehículos sin periodicidad: se deshace todo.', v_quedan;
  end if;

  perform set_config('mobilink.resultado',
    format('Periodicidad de 60 días puesta a %s vehículos de Plana (%s ya la tenían).',
           v_cambiados, 64 - v_cambiados), false);
end $migracion$;

select current_setting('mobilink.resultado', true) as resultado;
