-- Catálogo de camión: medidas, índices de carga, códigos de velocidad y
-- modelos de Bridgestone, Continental, Dunlop, Goodyear, Hankook y Michelin.
--
-- Del Excel «catalogo_camion_6_marcas_IC_CV» (17/11/2026), igual que se hizo
-- con furgoneta (tyrecontrol_catalogo_furgoneta_ic_cv.sql) y después de
-- normalizar las medidas (tyrecontrol_medidas_sin_indice_pegado.sql):
--
--   · Se añade lo que falta y nada se repite. Medidas comparadas ya
--     normalizadas; índices y velocidades por su valor; modelos por su nombre
--     sin espacios ni signos dentro de la misma marca, salvo el «+», que en
--     camión es otro modelo (SP346 y SP346+, HT3 y HT3+).
--   · Los nombres se limpian antes de comparar: «SP346 (17.5/19.5)» es el
--     SP346, y en Hankook «SmartFlex AL51» es el AL51 que ya está.
--   · Los modelos nuevos llevan tipo «camion» y su eje (dirección o tracción).
--     Los que ya existían no se tocan.
--   · Las COMBINACIONES no se crean: nacen al dar de alta un neumático.
--
-- Solo catálogo: no toca neumáticos, montajes, vehículos ni ejes.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
--
-- Necesita la migración de furgoneta (las funciones de kg y km/h). Repetida,
-- no añade nada.

do $migracion$
declare
  v_ic bigint; v_cv bigint; v_med bigint; v_mod bigint;
  v_marca text;
begin
  if to_regprocedure('public.tc_kg_indice_carga(text)') is null
     or to_regprocedure('public.tc_kmh_codigo_velocidad(text)') is null then
    raise exception 'No se toca nada: falta la migración tyrecontrol_catalogo_furgoneta_ic_cv.sql.';
  end if;
  foreach v_marca in array array['Bridgestone', 'Continental', 'Dunlop', 'Goodyear', 'Hankook', 'Michelin'] loop
    if not exists (select 1 from tc_cat_marcas_neumatico where upper(nombre) = upper(v_marca)) then
      raise exception 'No se toca nada: no existe la marca %.', v_marca;
    end if;
  end loop;

  select count(*) into v_ic from tc_cat_indices_carga;
  select count(*) into v_cv from tc_cat_indices_velocidad;
  select count(*) into v_med from tc_cat_medidas_neumatico;
  select count(*) into v_mod from tc_cat_modelos_neumatico;

  insert into tc_cat_indices_carga (valor, kg)
  select v, tc_kg_indice_carga(v) from unnest(array['122', '124', '126', '127', '129', '130', '132', '134', '136', '138', '139', '140', '142', '144', '145', '146', '147', '148', '149', '150', '152', '154', '156', '158', '160', '162', '164']) v
  on conflict (valor) do nothing;

  insert into tc_cat_indices_velocidad (valor, km_h)
  select v, tc_kmh_codigo_velocidad(v) from unnest(array['G', 'K', 'L', 'M']) v
  on conflict (valor) do nothing;

  -- Una medida que ya estaba pero desactivada se vuelve a activar: la usan.
  update tc_cat_medidas_neumatico set activo = true
   where not activo and valor in (select tc_medida_normalizada(v) from unnest(array['205/75R17.5', '215/75R17.5', '225/75R17.5', '235/75R17.5', '245/70R17.5', '245/70R19.5', '265/70R17.5', '265/70R19.5', '285/70R19.5', '295/60R22.5', '295/80R22.5', '305/70R19.5', '315/45R22.5', '315/60R22.5', '315/70R22.5', '315/80R22.5', '355/50R22.5', '385/55R22.5', '385/65R22.5']) v);
  insert into tc_cat_medidas_neumatico (valor, activo, categoria, ancho, perfil, diametro)
  select v, true, 'camion',
         substring(v from '^(\d{3})')::numeric,
         substring(v from '^\d{3}/(\d{2})')::numeric,
         substring(v from 'R(\d{2}(?:\.\d)?)')::numeric
    from unnest(array['205/75R17.5', '215/75R17.5', '225/75R17.5', '235/75R17.5', '245/70R17.5', '245/70R19.5', '265/70R17.5', '265/70R19.5', '285/70R19.5', '295/60R22.5', '295/80R22.5', '305/70R19.5', '315/45R22.5', '315/60R22.5', '315/70R22.5', '315/80R22.5', '355/50R22.5', '385/55R22.5', '385/65R22.5']) v
   where not exists (select 1 from tc_cat_medidas_neumatico m where tc_medida_normalizada(m.valor) = tc_medida_normalizada(v))
  on conflict (valor) do nothing;

  insert into tc_cat_modelos_neumatico (marca_id, nombre, activo, tipo_vehiculo, eje_recomendado)
  select ma.id, x.nombre, true, 'camion', x.eje
    from (values
    ('Bridgestone', 'Duravis R-STEER 002', 'direccion'),
    ('Bridgestone', 'Duravis R-STEER 002 EVO', 'direccion'),
    ('Bridgestone', 'Ecopia H-STEER 002', 'direccion'),
    ('Continental', 'Conti EcoPlus HD3', 'traccion'),
    ('Continental', 'Conti EcoPlus HD3+', 'traccion'),
    ('Continental', 'Conti EcoPlus HS3', 'direccion'),
    ('Continental', 'Conti EcoPlus HS3+', 'direccion'),
    ('Continental', 'Conti Hybrid HS5', 'direccion'),
    ('Dunlop', 'SP344', 'direccion'),
    ('Dunlop', 'SP346', 'direccion'),
    ('Dunlop', 'SP346+', 'direccion'),
    ('Dunlop', 'SP446', 'traccion'),
    ('Goodyear', 'EQMAX D', 'traccion'),
    ('Goodyear', 'EQMAX S', 'direccion'),
    ('Goodyear', 'EQMAX S ULTRA', 'direccion'),
    ('Goodyear', 'KMAX D GEN-2', 'traccion'),
    ('Goodyear', 'KMAX D GEN-3', 'traccion'),
    ('Goodyear', 'KMAX S GEN-2', 'direccion'),
    ('Goodyear', 'KMAX S GEN-3', 'direccion'),
    ('Goodyear', 'OMNITRAC D', 'traccion'),
    ('Goodyear', 'OMNITRAC S', 'direccion'),
    ('Goodyear', 'ULTRAGRIP MAX D', 'traccion'),
    ('Goodyear', 'ULTRAGRIP MAX S', 'direccion'),
    ('Hankook', 'AL51', 'direccion'),
    ('Hankook', 'DL51', 'traccion'),
    ('Michelin', 'X MULTI D', 'traccion'),
    ('Michelin', 'X MULTI ENERGY D', 'traccion'),
    ('Michelin', 'X MULTI ENERGY Z', 'direccion'),
    ('Michelin', 'X MULTI GRIP D', 'traccion')
    ) as x(marca, nombre, eje)
    join tc_cat_marcas_neumatico ma on upper(ma.nombre) = upper(x.marca)
   where not exists (
     select 1 from tc_cat_modelos_neumatico m
      where m.marca_id = ma.id
        and regexp_replace(upper(m.nombre), '[^A-Z0-9+]', '', 'g') = regexp_replace(upper(x.nombre), '[^A-Z0-9+]', '', 'g'))
  on conflict (marca_id, nombre) do nothing;

  perform set_config('mobilink.resultado', format(
    'OK. Añadidos: %s índices de carga, %s códigos de velocidad, %s medidas, %s modelos.',
    (select count(*) from tc_cat_indices_carga) - v_ic,
    (select count(*) from tc_cat_indices_velocidad) - v_cv,
    (select count(*) from tc_cat_medidas_neumatico) - v_med,
    (select count(*) from tc_cat_modelos_neumatico) - v_mod), false);
  raise notice '%', current_setting('mobilink.resultado');
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado,
       (select json_agg(ma.nombre || ' ' || m.nombre || coalesce(' (' || m.eje_recomendado || ')', '') order by ma.nombre, m.nombre)
          from tc_cat_modelos_neumatico m join tc_cat_marcas_neumatico ma on ma.id = m.marca_id
         where m.created_at > now() - interval '5 minutes') as modelos_nuevos;
