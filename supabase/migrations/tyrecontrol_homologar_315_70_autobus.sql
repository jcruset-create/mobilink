-- Homologa la medida 315/70R22.5 para el tipo de vehículo «autobus».
--
-- Al informar las gomas que ya llevaba el 7764KMB (tipo autobus), las 6
-- posiciones se rechazaron con «MEDIDA_INCOMPATIBLE: 315/70R22.5 no está
-- homologada para este tipo de vehículo». El tipo autobus solo tenía
-- 315/80, 295/80, 12R22.5, 275/70 y 305/70 R22.5, y 315/70R22.5 es una medida
-- habitual en autobús (y la que lleva ese vehículo de verdad).
--
-- Solo añade una fila a tc_medidas_tipo_vehiculo. No toca vehículos,
-- neumáticos ni montajes. Idempotente: se puede pegar dos veces.

do $migracion$
declare
  v_tipo uuid;
  v_medida uuid;
  v_antes int;
begin
  select id into v_tipo from tc_tipos_vehiculo where lower(nombre) = 'autobus' limit 1;
  if v_tipo is null then raise exception 'No existe el tipo de vehículo autobus'; end if;

  select id into v_medida from tc_cat_medidas_neumatico
   where tc_medida_base(valor) = tc_medida_base('315/70R22.5') order by valor limit 1;
  if v_medida is null then raise exception 'La medida 315/70R22.5 no está en el catálogo de medidas'; end if;

  select count(*) into v_antes from tc_medidas_tipo_vehiculo where tipo_vehiculo_id = v_tipo;

  if not exists (select 1 from tc_medidas_tipo_vehiculo where tipo_vehiculo_id = v_tipo and medida_id = v_medida) then
    insert into tc_medidas_tipo_vehiculo (tipo_vehiculo_id, medida_id) values (v_tipo, v_medida);
  end if;

  -- Autocomprobación.
  if not tc_medida_compatible(v_tipo, '315/70R22.5') then
    raise exception 'Tras la migración 315/70R22.5 sigue sin estar homologada para autobus';
  end if;

  perform set_config('mobilink.resultado',
    format('OK: autobus pasa de %s a %s medidas homologadas; 315/70R22.5 ya es compatible',
           v_antes, (select count(*) from tc_medidas_tipo_vehiculo where tipo_vehiculo_id = v_tipo)), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
