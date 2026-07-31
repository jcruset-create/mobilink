-- ============================================================
-- SEA TyreControl - Modulo ficha tecnica ITV (4/4): modelo normalizado puro
--
-- Quita de tc_vehiculos las 29 columnas de ficha tecnica. A partir de
-- aqui el unico sitio donde vive un dato de ficha es
-- tc_vehiculo_atributos_tecnicos.
--
-- Se conservan matricula, marca, modelo, bastidor y fecha_matriculacion:
-- no son "datos de ficha", son la identidad operativa del vehiculo y las
-- usan listas, montajes, informes y la APK.
--
-- IMPORTANTE: ejecutar DESPUES de tyrecontrol_itv_2b_backfill_columnas.sql.
-- La guarda de abajo aborta si queda algun dato sin volcar, asi que no se
-- puede perder informacion por ejecutarla antes de tiempo.
-- ============================================================

do $itv_guard$
declare m record; n bigint; total bigint := 0; detalle text := '';
begin
  for m in select * from (values
      ('tipo','tipo_ficha'), ('variante','variante'), ('version','version'),
      ('denominacion_comercial','denominacion_comercial'), ('fabricante','fabricante'),
      ('categoria','categoria'), ('clasificacion','clasificacion'), ('carroceria','carroceria'),
      ('num_homologacion','num_homologacion'), ('num_ejes','num_ejes'), ('num_ruedas','num_ruedas'),
      ('ejes_motrices','ejes_motrices'), ('distancia_ejes','distancia_ejes'), ('via','via'),
      ('mma','mma'), ('masa_maxima_conjunto','masa_maxima_conjunto'),
      ('masa_orden_marcha','masa_orden_marcha'), ('tara','tara'), ('masa_remolcable','masa_remolcable'),
      ('longitud','longitud'), ('anchura','anchura'), ('altura','altura'),
      ('combustible','combustible'), ('cilindrada','cilindrada'), ('potencia','potencia'),
      ('num_cilindros','num_cilindros'), ('norma_emisiones','norma_emisiones'),
      ('nivel_sonoro','nivel_sonoro'), ('fecha_emision','fecha_emision')
    ) as t(clave, columna)
  loop
    execute format($f$
      select count(*) from tc_vehiculos v
        join tc_cat_campos_ficha_tecnica c on c.clave = %2$L
       where v.%1$I is not null and btrim(v.%1$I::text) <> ''
         and not exists (select 1 from tc_vehiculo_atributos_tecnicos a
                          where a.vehiculo_id = v.id and a.campo_ficha_id = c.id)
    $f$, m.columna, m.clave) into n;
    if n > 0 then
      total := total + n;
      detalle := detalle || format(' %s(%s)', m.columna, n);
    end if;
  end loop;

  if total > 0 then
    raise exception
      'No se borra nada: quedan % dato(s) en columnas sin volcar a la tabla normalizada:%. Ejecuta antes tyrecontrol_itv_2b_backfill_columnas.sql',
      total, detalle;
  end if;
end
$itv_guard$;

alter table tc_vehiculos
  drop column if exists tipo_ficha,
  drop column if exists variante,
  drop column if exists version,
  drop column if exists denominacion_comercial,
  drop column if exists fabricante,
  drop column if exists categoria,
  drop column if exists clasificacion,
  drop column if exists carroceria,
  drop column if exists num_homologacion,
  drop column if exists num_ejes,
  drop column if exists num_ruedas,
  drop column if exists ejes_motrices,
  drop column if exists distancia_ejes,
  drop column if exists via,
  drop column if exists mma,
  drop column if exists masa_maxima_conjunto,
  drop column if exists masa_orden_marcha,
  drop column if exists tara,
  drop column if exists masa_remolcable,
  drop column if exists longitud,
  drop column if exists anchura,
  drop column if exists altura,
  drop column if exists combustible,
  drop column if exists cilindrada,
  drop column if exists potencia,
  drop column if exists num_cilindros,
  drop column if exists norma_emisiones,
  drop column if exists nivel_sonoro,
  drop column if exists fecha_emision;

notify pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────────
-- No hay vuelta atras automatica: al borrar la columna se pierde el dato
-- que hubiera en ella. La copia buena esta en tc_vehiculo_atributos_tecnicos,
-- asi que para deshacerlo habria que recrear las columnas y volcarlas desde
-- alli, invirtiendo la migracion 2b.
