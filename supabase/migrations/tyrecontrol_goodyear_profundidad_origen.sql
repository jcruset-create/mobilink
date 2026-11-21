-- Profundidad de NUEVO (profundidad_dibujo_mm) de 10 referencias Goodyear.
--
-- Las 37 referencias Goodyear del catálogo la tenían vacía, y sin ella una
-- goma no puede entrar en el seguimiento de rendimiento sin escribirla a mano.
--
-- Solo entran las que tienen la cifra para ESE modelo y ESA medida en una
-- ficha de distribuidor (Heuver / Tirecoach). Las fichas oficiales de
-- Goodyear no se pudieron abrir desde aquí, así que cada fila deja anotado
-- de dónde sale en `verificacion_notas` y la URL en `fuente_corroboracion_url`
-- (solo si estaba vacía). Las dudosas (generación GEN-2 no confirmada, unidades
-- no claras) NO entran: mejor vacío que un número que no es suyo.
--
-- Solo rellena valores vacíos. No toca neumáticos, montajes ni vehículos.
-- Idempotente: la segunda vez no cambia nada.

do $migracion$
declare
  v_fila record; v_n int; v_total int := 0; v_faltan text[] := '{}';
begin
  for v_fila in
    select * from (values
      ('KMAX T',                '385/55R22.5', 14.4, 'https://www.heuver.com/product/b38555225gykkmx01/385-55r22-5-goodyear-kmax-t-160k-158l-tl-m-s'),
      ('KMAX T',                '385/65R22.5', 17.7, 'https://www.heuver.com/product/b38565225gykkmx00/385-65r22-5-goodyear-kmax-t-160k-158l-tl'),
      ('KMAX T',                '425/65R22.5', 16.2, 'https://www.heuver.com/product/b42565225gykkmx00/425-65r22-5-goodyear-kmax-t-165k-20pr-tl-m-s'),
      ('ULTRA GRIP MAX D',      '295/60R22.5', 17.6, 'https://www.heuver.com/webshop/product/b29560225gykugm01/295-60r22-5-goodyear-ultragrip-max-d-150k-149l-16pr-tl-m-s-3pmsf'),
      ('KMAX S HL',             '315/60R22.5', 12.5, 'https://www.heuver.com/product/b31560225gylkmx02/315-60r22-5-goodyear-kmax-s-154-148l-16pr-hl-tl-m-s'),
      ('FUELMAX D PERFORMANCE', '315/70R22.5', 15.9, 'https://www.heuver.com/webshop/product/b31570225gylflm01/315-70r22-5-goodyear-fuelmax-d-154l-152m-tl-performance-m-s-3pmsf'),
      ('KMAX T GEN-2 HL',       '385/65R22.5', 17.6, 'https://www.tirecoach.eu/en-us/truckbanden/385-3-65r22-5-goodyear-kmax-t-g2-164k-3-158l-tl-m-tr22538565gykmaxtne'),
      ('KMAX T HL',             '385/65R22.5', 17.7, 'https://www.heuver.com/webshop/product/b38565225gykkmx05/385-65r22-5-goodyear-kmax-t-164k-158l-hl-tl-m-s'),
      ('OMNITRAC MST II',       '445/65R22.5', 15.6, 'https://www.heuver.com/product/b44565225gykmst00/445-65r22-5-goodyear-omnitrac-mst-ii-169k-tl-m-s'),
      ('REGIONAL RHS II HL',    '385/65R22.5', 15.2, 'https://www.heuver.com/webshop/product/b38565225gykrhs01/385-65r22-5-goodyear-regional-rhs-ii-high-load-164k-158l-tl')
    ) as t(modelo, medida, mm, url)
  loop
    update tc_referencias_neumatico r
       set profundidad_dibujo_mm = v_fila.mm,
           fuente_corroboracion_url = coalesce(r.fuente_corroboracion_url, v_fila.url),
           verificacion_notas = concat_ws(' · ', nullif(r.verificacion_notas, ''),
             format('Profundidad de nuevo %s mm según ficha de distribuidor (no oficial Goodyear)', v_fila.mm)),
           updated_at = now()
      from tc_cat_modelos_neumatico mo, tc_cat_marcas_neumatico ma, tyre_sizes ts
     where r.modelo_id = mo.id and mo.marca_id = ma.id and ts.id = r.tyre_size_id
       and upper(ma.nombre) like 'GOODYEAR%'
       and upper(btrim(mo.nombre)) = v_fila.modelo
       and tc_medida_base(ts.medida) = tc_medida_base(v_fila.medida)
       and r.profundidad_dibujo_mm is null;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;

    -- Autocomprobación: la referencia, si existe, tiene que quedar con dato.
    if exists (
      select 1 from tc_referencias_neumatico r
        join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
        join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
        join tyre_sizes ts on ts.id = r.tyre_size_id
       where upper(ma.nombre) like 'GOODYEAR%' and upper(btrim(mo.nombre)) = v_fila.modelo
         and tc_medida_base(ts.medida) = tc_medida_base(v_fila.medida)
         and r.profundidad_dibujo_mm is null) then
      raise exception 'Se ha quedado sin profundidad: % %', v_fila.modelo, v_fila.medida;
    end if;
    if not exists (
      select 1 from tc_referencias_neumatico r
        join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
        join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
        join tyre_sizes ts on ts.id = r.tyre_size_id
       where upper(ma.nombre) like 'GOODYEAR%' and upper(btrim(mo.nombre)) = v_fila.modelo
         and tc_medida_base(ts.medida) = tc_medida_base(v_fila.medida)) then
      v_faltan := v_faltan || format('%s %s', v_fila.modelo, v_fila.medida);
    end if;
  end loop;

  perform set_config('mobilink.resultado', format(
    'OK: %s referencias Goodyear con profundidad de nuevo%s', v_total,
    case when array_length(v_faltan, 1) > 0 then ' · no existen en el catálogo: ' || array_to_string(v_faltan, ', ') else '' end), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
