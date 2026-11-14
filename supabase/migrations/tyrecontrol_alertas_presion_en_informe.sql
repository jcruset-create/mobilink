-- Las alertas de presión entran en el informe de alertas.
--
-- Necesita `tyrecontrol_alertas_presion.sql` aplicada ANTES: es la que crea
-- `tc_alertas_presion`.
--
-- ── Por qué ahí y no en otro sitio ──────────────────────────────────────────
--
-- `tc_informes_alertas` es la función que alimenta la pantalla de alertas, y
-- hasta hoy devolvía TRES tipos, los tres sacados de la profundidad de la
-- última revisión: `bajo_minimo`, `proximo_sustitucion` y `vehiculo_sin_revisar`.
--
-- La presión nunca había entrado, aunque `tc_config_umbrales` lleva desde
-- siempre una columna `presion_tolerancia_bar` que no usa nadie. El hueco
-- estaba hecho; lo que faltaba era un sitio de donde sacar presiones, y eso es
-- lo que traen los avisos de Goodyear.
--
-- Entrando por aquí, la alerta aparece sola en la pantalla y en el CSV: la
-- pantalla pinta `TIPO_LABEL[tipo] ?? tipo`, así que no hace falta tocar nada
-- más para que se vea.
--
-- ── Se lee la función viva y se sustituye un anclaje ───────────────────────
--
-- No se reescribe la función entera a mano —son 2.918 caracteres y copiarlos
-- mal rompería las tres alertas que ya funcionan—. Se lee su definición, se
-- comprueba que el anclaje aparece EXACTAMENTE una vez y se sustituye. Si no
-- aparece una sola vez, la migración falla y no toca nada.

do $migracion$
declare
  v_def   text;
  v_veces int;
  v_ancla constant text := '  order by 2, 1;';
  v_nuevo constant text :=
    '  union all' || chr(10) ||
    '  -- Avisos de presión de Goodyear que siguen abiertos. Una fila por' || chr(10) ||
    '  -- RUEDA, no por correo: `avisos` dice cuántas veces ha avisado la misma.' || chr(10) ||
    '  select a.tipo, a.severidad, a.vehiculo_id, v.matricula, a.neumatico_id,' || chr(10) ||
    '         coalesce(n.codigo_interno, n.numero_serie), p.codigo_posicion,' || chr(10) ||
    '         case when a.presion_bar is null' || chr(10) ||
    '              then ''Sin lectura de presión''' || chr(10) ||
    '              else ''Presión '' || a.presion_bar || '' bar''' || chr(10) ||
    '           end' || chr(10) ||
    '         || coalesce('' de '' || a.presion_recomendada_bar || '' recomendados'', '''')' || chr(10) ||
    '         || coalesce('' ('' || a.desviacion_pct || '' %)'', '''')' || chr(10) ||
    '         -- Que una rueda lleve días avisando es el dato que distingue una' || chr(10) ||
    '         -- presión baja de una fuga, así que se dice en el propio detalle.' || chr(10) ||
    '         || case when a.avisos > 1' || chr(10) ||
    '                 then '' · '' || a.avisos || '' avisos desde el '' ||' || chr(10) ||
    '                      to_char(a.primer_aviso_at, ''DD/MM'')' || chr(10) ||
    '                 else '''' end,' || chr(10) ||
    '         a.presion_bar' || chr(10) ||
    '    from tc_alertas_presion a' || chr(10) ||
    '    join tc_vehiculos v on v.id = a.vehiculo_id' || chr(10) ||
    '    left join tc_neumaticos n on n.id = a.neumatico_id' || chr(10) ||
    '    left join tc_posiciones_vehiculo p on p.id = a.posicion_id' || chr(10) ||
    '   where a.estado = ''abierta''' || chr(10) ||
    '     and (p_empresa is null or a.empresa_id = p_empresa)' || chr(10) ||
    '  order by 2, 1;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tc_informes_alertas';
  if v_def is null then
    raise exception 'No existe tc_informes_alertas';
  end if;

  if position('tc_alertas_presion' in v_def) > 0 then
    raise notice 'tc_informes_alertas ya trae las alertas de presión, se deja';
    return;
  end if;

  v_veces := (select count(*) from regexp_matches(v_def, replace(replace(
                v_ancla, '(', '\('), ')', '\)'), 'g'));
  if v_veces <> 1 then
    raise exception 'Esperaba 1 anclaje «order by 2, 1;» en tc_informes_alertas y hay %', v_veces;
  end if;

  execute replace(v_def, v_ancla, v_nuevo);
  raise notice 'tc_informes_alertas ahora incluye las alertas de presión';
end
$migracion$;

-- ── Comprobación ───────────────────────────────────────────────────────────
--
-- `enganchada` tiene que salir true. `alertas_presion` es cuántas devuelve hoy
-- la función: será 0 hasta que el buzón procese el primer aviso, y eso es lo
-- esperado — la migración no inventa datos.

select
  (select position('tc_alertas_presion' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tc_informes_alertas') as enganchada,
  (select count(*) from tc_informes_alertas()
    where tipo in ('presion_baja', 'desinflado'))                      as alertas_presion,
  (select count(*) from tc_informes_alertas())                         as alertas_totales;
