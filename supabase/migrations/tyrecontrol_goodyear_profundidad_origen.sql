-- Profundidad de NUEVO (profundidad_dibujo_mm) de 15 referencias Goodyear.
--
-- Las 37 referencias Goodyear del catálogo la tenían vacía, y sin ella una
-- goma no puede entrar en el seguimiento de rendimiento sin escribirla a mano.
--
-- Solo entran las que tienen la cifra para ESE modelo, ESA medida y ESE índice
-- de carga:
--   · 8 OFICIALES: Goodyear Truck Tyre Data Book 2020-2021 (columna «Tread
--     Depth»). URL en `fuente_oficial_url`.
--   · 7 de ficha de DISTRIBUIDOR (Heuver / Tirecoach), modelos que el Data
--     Book 2020 no trae. URL en `fuente_corroboracion_url`.
-- Cada fila deja anotado de dónde sale en `verificacion_notas`. Las dudosas
-- (generación GEN-2 no confirmada, unidades no claras) NO entran: mejor vacío
-- que un número que no es suyo.
--
-- Rellena vacíos y sustituye por el oficial lo que venía de distribuidor.
-- No toca neumáticos, montajes ni vehículos.
-- Idempotente: la segunda vez no cambia nada.

do $migracion$
declare
  v_fila record; v_n int; v_total int := 0; v_faltan text[] := '{}';
begin
  for v_fila in
    select * from (values
      ('KMAX T', '425/65R22.5', 16.2, 'https://www.goodyear.eu/content/dam/goodyear/truck/pdfs/em/EM%20Databook%20TTDB%202020-2021.pdf', 'oficial'),
      ('REGIONAL RHS II HL', '385/65R22.5', 15.2, 'https://www.goodyear.eu/content/dam/goodyear/truck/pdfs/em/EM%20Databook%20TTDB%202020-2021.pdf', 'oficial'),
      ('OMNITRAC MST II', '445/65R22.5', 15.8, 'https://www.goodyear.eu/content/dam/goodyear/truck/pdfs/em/EM%20Databook%20TTDB%202020-2021.pdf', 'oficial'),
      ('OMNITRAC S', '385/65R22.5', 15.4, 'https://www.goodyear.eu/content/dam/goodyear/truck/pdfs/em/EM%20Databook%20TTDB%202020-2021.pdf', 'oficial'),
      ('KMAX S GEN-2', '295/60R22.5', 12.3, 'https://www.goodyear.eu/content/dam/goodyear/truck/pdfs/em/EM%20Databook%20TTDB%202020-2021.pdf', 'oficial'),
      ('KMAX S HL GEN-2', '315/60R22.5', 12.5, 'https://www.goodyear.eu/content/dam/goodyear/truck/pdfs/em/EM%20Databook%20TTDB%202020-2021.pdf', 'oficial'),
      ('KMAX D GEN-2', '315/60R22.5', 17.6, 'https://www.goodyear.eu/content/dam/goodyear/truck/pdfs/em/EM%20Databook%20TTDB%202020-2021.pdf', 'oficial'),
      ('URBANMAX MCA', '315/60R22.5', 16.3, 'https://www.goodyear.eu/content/dam/goodyear/truck/pdfs/em/EM%20Databook%20TTDB%202020-2021.pdf', 'oficial'),
      ('KMAX T', '385/55R22.5', 14.4, 'https://www.heuver.com/product/b38555225gykkmx01/385-55r22-5-goodyear-kmax-t-160k-158l-tl-m-s', 'distribuidor'),
      ('KMAX T', '385/65R22.5', 17.7, 'https://www.heuver.com/product/b38565225gykkmx00/385-65r22-5-goodyear-kmax-t-160k-158l-tl', 'distribuidor'),
      ('ULTRA GRIP MAX D', '295/60R22.5', 17.6, 'https://www.heuver.com/webshop/product/b29560225gykugm01/295-60r22-5-goodyear-ultragrip-max-d-150k-149l-16pr-tl-m-s-3pmsf', 'distribuidor'),
      ('KMAX S HL', '315/60R22.5', 12.5, 'https://www.heuver.com/product/b31560225gylkmx02/315-60r22-5-goodyear-kmax-s-154-148l-16pr-hl-tl-m-s', 'distribuidor'),
      ('FUELMAX D PERFORMANCE', '315/70R22.5', 15.9, 'https://www.heuver.com/webshop/product/b31570225gylflm01/315-70r22-5-goodyear-fuelmax-d-154l-152m-tl-performance-m-s-3pmsf', 'distribuidor'),
      ('KMAX T GEN-2 HL', '385/65R22.5', 17.6, 'https://www.tirecoach.eu/en-us/truckbanden/385-3-65r22-5-goodyear-kmax-t-g2-164k-3-158l-tl-m-tr22538565gykmaxtne', 'distribuidor'),
      ('KMAX T HL', '385/65R22.5', 17.7, 'https://www.heuver.com/webshop/product/b38565225gykkmx05/385-65r22-5-goodyear-kmax-t-164k-158l-hl-tl-m-s', 'distribuidor')
    ) as t(modelo, medida, mm, url, tipo)
  loop
    update tc_referencias_neumatico r
       set profundidad_dibujo_mm = v_fila.mm,
           fuente_oficial_url = case when v_fila.tipo = 'oficial' then coalesce(r.fuente_oficial_url, v_fila.url) else r.fuente_oficial_url end,
           fuente_corroboracion_url = case when v_fila.tipo = 'oficial' then r.fuente_corroboracion_url else coalesce(r.fuente_corroboracion_url, v_fila.url) end,
           verificacion_notas = concat_ws(' · ', nullif(r.verificacion_notas, ''),
             case when v_fila.tipo = 'oficial'
               then format('Profundidad de nuevo %s mm: Goodyear Truck Tyre Data Book 2020-2021 (oficial)', v_fila.mm)
               else format('Profundidad de nuevo %s mm según ficha de distribuidor (no oficial Goodyear)', v_fila.mm) end),
           updated_at = now()
      from tc_cat_modelos_neumatico mo, tc_cat_marcas_neumatico ma, tyre_sizes ts
     where r.modelo_id = mo.id and mo.marca_id = ma.id and ts.id = r.tyre_size_id
       and upper(ma.nombre) like 'GOODYEAR%'
       and upper(btrim(mo.nombre)) = v_fila.modelo
       and tc_medida_base(ts.medida) = tc_medida_base(v_fila.medida)
       and (r.profundidad_dibujo_mm is null
            -- Un dato de distribuidor lo sustituye el oficial (p. ej. MST II
            -- 445/65: 15,6 de Heuver → 15,8 del Data Book). Uno oficial no se toca.
            or (v_fila.tipo = 'oficial'
                and coalesce(r.verificacion_notas, '') like '%según ficha de distribuidor%'
                and coalesce(r.verificacion_notas, '') not like '%Data Book%'));
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
