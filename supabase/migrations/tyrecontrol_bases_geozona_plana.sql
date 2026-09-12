-- ============================================================
-- SEA TyreControl — Geo-zonas de las bases (delegaciones) de Autocares Plana.
--
-- La base ES la delegación: el centro (lat/lng) y el radio viven en
-- tc_delegaciones (columnas base_lat / base_lng / base_radio_m; nacieron en
-- tyrecontrol_webfleet_bases_fase0.sql como webfleet_* y las renombra
-- tyrecontrol_bases_geozona_renombrado.sql, que hay que ejecutar ANTES). Ningún nombre ni
-- coordenada se escribe en código: sólo aquí, en datos.
--
-- Centros obtenidos de las posiciones reales de la flota (Movertis,
-- lastMessagePosition): 541 posiciones con menos de 1 h de antigüedad,
-- agrupadas por proximidad (400 m) y promediadas. Los seis racimos están
-- a kilómetros unos de otros, así que radios de 300 m no se solapan.
--
-- Idempotente: si la delegación ya existe (por nombre, para esa empresa)
-- sólo actualiza las tres columnas de la geo-zona; si no existe, la crea.
-- Si hay más de una delegación que encaje con el nombre, NO toca nada y lo
-- avisa por consola: ese caso se resuelve a mano.
-- ============================================================

do $$
declare
  v_empresa uuid := 'a51c9662-4b6f-4681-8e2b-599e109659eb';  -- Autocares Plana
  b         record;
  v_id      uuid;
  v_cuantas int;
begin
  if not exists (select 1 from tc_empresas where id = v_empresa) then
    raise exception 'La empresa % no existe en tc_empresas', v_empresa;
  end if;

  for b in
    select * from (values
      ('Reus',                    41.128928::numeric, 1.186083::numeric, 300),
      ('Vilanova',                41.245253::numeric, 1.717619::numeric, 300),
      ('Tarragona',               41.140732::numeric, 1.223497::numeric, 300),
      ('Calafell',                41.209785::numeric, 1.568234::numeric, 300),
      ('Hospitalet de l''Infant', 41.012087::numeric, 0.910091::numeric, 300),
      ('Barcelona',               41.346989::numeric, 2.122491::numeric, 300)
    ) as t(nombre, lat, lng, radio_m)
  loop
    select count(*) into v_cuantas
      from tc_delegaciones
     where empresa_id = v_empresa
       and nombre ilike '%' || b.nombre || '%';

    if v_cuantas > 1 then
      raise notice 'Base "%": % delegaciones encajan con ese nombre, no se toca nada', b.nombre, v_cuantas;
      continue;
    end if;

    if v_cuantas = 1 then
      update tc_delegaciones
         set base_lat     = b.lat,
             base_lng     = b.lng,
             base_radio_m = b.radio_m,
             updated_at       = now()
       where empresa_id = v_empresa
         and nombre ilike '%' || b.nombre || '%'
      returning id into v_id;
      raise notice 'Base "%": geo-zona actualizada en la delegación existente %', b.nombre, v_id;
    else
      insert into tc_delegaciones (empresa_id, nombre, base_lat, base_lng, base_radio_m)
      values (v_empresa, b.nombre, b.lat, b.lng, b.radio_m)
      returning id into v_id;
      raise notice 'Base "%": delegación creada %', b.nombre, v_id;
    end if;
  end loop;
end $$;

-- Comprobación: las seis bases con su geo-zona.
select nombre, base_lat, base_lng, base_radio_m, activo
  from tc_delegaciones
 where empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb'
 order by base_lat is null, nombre;
