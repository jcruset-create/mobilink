-- ============================================================
-- SEA TyreControl - Modulo ficha tecnica ITV (2b): sembrar la tabla
-- normalizada con lo que ya hay en las columnas del vehiculo.
--
-- La ficha ITV pasa a leerse de tc_vehiculo_atributos_tecnicos, asi que
-- los datos que hoy solo viven en columnas de tc_vehiculos tienen que
-- aparecer alli tambien; si no, desapareceria de la pantalla lo que ya
-- estaba cargado a mano.
--
-- Las columnas NO se borran: siguen siendo la proyeccion que usan las
-- listas, los informes y la APK.
--
-- Idempotente: solo crea la fila si ese vehiculo no la tiene ya.
-- Requiere tyrecontrol_itv_2_valores.sql
-- ============================================================

do $itv_text$
declare m record;
begin
  for m in select * from (values
      ('matricula','matricula'), ('marca','marca'), ('modelo','modelo'), ('vin','bastidor'),
      ('tipo','tipo_ficha'), ('variante','variante'), ('version','version'),
      ('denominacion_comercial','denominacion_comercial'), ('fabricante','fabricante'),
      ('categoria','categoria'), ('clasificacion','clasificacion'), ('carroceria','carroceria'),
      ('num_homologacion','num_homologacion'), ('combustible','combustible'),
      ('norma_emisiones','norma_emisiones')
    ) as t(clave, columna)
  loop
    execute format($f$
      insert into tc_vehiculo_atributos_tecnicos
        (vehiculo_id, campo_ficha_id, codigo_origen, etiqueta_origen, clave_normalizada,
         valor_bruto, valor_normalizado, tipo_valor, unidad, estado, origen, verificado_manualmente)
      select v.id, c.id, c.codigo, c.descripcion, c.clave,
             btrim(v.%1$I::text), btrim(v.%1$I::text), c.tipo_dato, c.unidad, 'validado', 'manual', true
        from tc_vehiculos v
        join tc_cat_campos_ficha_tecnica c on c.clave = %2$L
       where v.%1$I is not null and btrim(v.%1$I::text) <> ''
         and not exists (select 1 from tc_vehiculo_atributos_tecnicos a
                          where a.vehiculo_id = v.id and a.campo_ficha_id = c.id)
    $f$, m.columna, m.clave);
  end loop;
end
$itv_text$;

do $itv_num$
declare m record;
begin
  for m in select * from (values
      ('num_ejes','num_ejes'), ('num_ruedas','num_ruedas'), ('ejes_motrices','ejes_motrices'),
      ('distancia_ejes','distancia_ejes'), ('via','via'), ('mma','mma'),
      ('masa_maxima_conjunto','masa_maxima_conjunto'), ('masa_orden_marcha','masa_orden_marcha'),
      ('tara','tara'), ('masa_remolcable','masa_remolcable'), ('longitud','longitud'),
      ('anchura','anchura'), ('altura','altura'), ('cilindrada','cilindrada'),
      ('potencia','potencia'), ('num_cilindros','num_cilindros'), ('nivel_sonoro','nivel_sonoro')
    ) as t(clave, columna)
  loop
    execute format($f$
      insert into tc_vehiculo_atributos_tecnicos
        (vehiculo_id, campo_ficha_id, codigo_origen, etiqueta_origen, clave_normalizada,
         valor_bruto, valor_normalizado, valor_numero, tipo_valor, unidad, estado, origen, verificado_manualmente)
      select v.id, c.id, c.codigo, c.descripcion, c.clave,
             v.%1$I::text, v.%1$I::text, v.%1$I::numeric, c.tipo_dato, c.unidad, 'validado', 'manual', true
        from tc_vehiculos v
        join tc_cat_campos_ficha_tecnica c on c.clave = %2$L
       where v.%1$I is not null
         and not exists (select 1 from tc_vehiculo_atributos_tecnicos a
                          where a.vehiculo_id = v.id and a.campo_ficha_id = c.id)
    $f$, m.columna, m.clave);
  end loop;
end
$itv_num$;

do $itv_fecha$
declare m record;
begin
  for m in select * from (values
      ('fecha_primera_matriculacion','fecha_matriculacion'), ('fecha_emision','fecha_emision')
    ) as t(clave, columna)
  loop
    execute format($f$
      insert into tc_vehiculo_atributos_tecnicos
        (vehiculo_id, campo_ficha_id, codigo_origen, etiqueta_origen, clave_normalizada,
         valor_bruto, valor_normalizado, valor_fecha, tipo_valor, unidad, estado, origen, verificado_manualmente)
      select v.id, c.id, c.codigo, c.descripcion, c.clave,
             to_char(v.%1$I, 'DD/MM/YYYY'), to_char(v.%1$I, 'YYYY-MM-DD'), v.%1$I,
             c.tipo_dato, c.unidad, 'validado', 'manual', true
        from tc_vehiculos v
        join tc_cat_campos_ficha_tecnica c on c.clave = %2$L
       where v.%1$I is not null
         and not exists (select 1 from tc_vehiculo_atributos_tecnicos a
                          where a.vehiculo_id = v.id and a.campo_ficha_id = c.id)
    $f$, m.columna, m.clave);
  end loop;
end
$itv_fecha$;

-- Cuantos datos han quedado por vehiculo (comprobacion rapida).
-- select v.matricula, count(*) from tc_vehiculo_atributos_tecnicos a
--   join tc_vehiculos v on v.id = a.vehiculo_id group by 1 order by 2 desc;

-- ── Rollback ───────────────────────────────────────────────────────
-- delete from tc_vehiculo_atributos_tecnicos where origen = 'manual' and documento_id is null;
