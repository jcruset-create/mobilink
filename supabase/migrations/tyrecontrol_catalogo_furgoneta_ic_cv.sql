-- Catálogo de neumáticos: índices de carga y códigos de velocidad con sus
-- kilos y km/h, y las medidas, índices, velocidades y modelos de furgoneta de
-- Hankook, Michelin y Continental.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
--
-- 1. tc_cat_indices_carga gana `kg` y tc_cat_indices_velocidad gana `km_h`,
--    rellenados con la tabla normalizada (ETRTO / ISO 4209):
--    tc_kg_indice_carga('104') = 900, tc_kmh_codigo_velocidad('R') = 170.
--
-- 2. Se añaden, SIN DUPLICAR lo que ya hay:
--      · las medidas de los Excel de Hankook, Michelin y Continental;
--      · sus índices de carga y códigos de velocidad;
--      · sus modelos de furgoneta;
--      · y los índices y velocidades que ya usan los neumáticos y las
--        combinaciones del catálogo (hoy la tabla de índices está vacía).
--    Las medidas se escriben como el resto de la base, sin la «C» de comercial
--    («195/70 R15C» → «195/70R15»): si no, «195/75R16» y «195/75R16C» serían dos
--    medidas para la misma rueda. Las de camping («CP») son otra rueda y se
--    quedan con su «CP». La marca XL tampoco es medida y se quita.
--    Los modelos de Hankook van con su código (RA18, RW12), como los que ya
--    hay (RA30, RA58, TH31+). Un modelo se da por existente si su nombre,
--    sin espacios ni signos, coincide con uno de la misma marca.
--
-- 3. Las COMBINACIONES (medida + índice + velocidad) y su vínculo con el
--    modelo NO se crean aquí: las crea el alta de un neumático. Lo que sí hace
--    esta migración es que, cuando se crea una combinación, su índice de carga
--    y su velocidad entren solos en su tabla si no estaban.
--
-- No toca neumáticos, montajes, vehículos ni ejes: solo tablas de catálogo.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
--
-- Comprueba que existen las tablas y las marcas, añade, y prueba dentro de la
-- transacción que una combinación nueva mete su índice y su velocidad en las
-- tablas; esa prueba se deshace. Repetida, no añade nada.

do $migracion$
declare
  v_ic_antes bigint; v_cv_antes bigint; v_med_antes bigint; v_mod_antes bigint;
  v_marca text;
  v_ok boolean;
begin
  if to_regclass('public.tc_cat_indices_carga') is null or to_regclass('public.tc_cat_indices_velocidad') is null
     or to_regclass('public.tc_cat_medidas_neumatico') is null or to_regclass('public.tc_cat_modelos_neumatico') is null
     or to_regclass('public.tyre_sizes') is null or to_regprocedure('public.tc_medida_normalizada(text)') is null then
    raise exception 'No se toca nada: falta alguna tabla del catálogo o tc_medida_normalizada.';
  end if;
  foreach v_marca in array array['Hankook', 'Michelin', 'Continental'] loop
    if not exists (select 1 from tc_cat_marcas_neumatico where upper(nombre) = upper(v_marca)) then
      raise exception 'No se toca nada: no existe la marca %.', v_marca;
    end if;
  end loop;

  select count(*) into v_ic_antes from tc_cat_indices_carga;
  select count(*) into v_cv_antes from tc_cat_indices_velocidad;
  select count(*) into v_med_antes from tc_cat_medidas_neumatico;
  select count(*) into v_mod_antes from tc_cat_modelos_neumatico;

  -- 1. Kilos y km/h.
  execute 'alter table tc_cat_indices_carga add column if not exists kg numeric';
  execute 'alter table tc_cat_indices_velocidad add column if not exists km_h integer';

  execute $f$
    create or replace function tc_kg_indice_carga(p text) returns numeric
    language sql immutable set search_path = public as $$
      select ('{"60": 250, "61": 257, "62": 265, "63": 272, "64": 280, "65": 290, "66": 300, "67": 307, "68": 315, "69": 325, "70": 335, "71": 345, "72": 355, "73": 365, "74": 375, "75": 387, "76": 400, "77": 412, "78": 425, "79": 437, "80": 450, "81": 462, "82": 475, "83": 487, "84": 500, "85": 515, "86": 530, "87": 545, "88": 560, "89": 580, "90": 600, "91": 615, "92": 630, "93": 650, "94": 670, "95": 690, "96": 710, "97": 730, "98": 750, "99": 775, "100": 800, "101": 825, "102": 850, "103": 875, "104": 900, "105": 925, "106": 950, "107": 975, "108": 1000, "109": 1030, "110": 1060, "111": 1090, "112": 1120, "113": 1150, "114": 1180, "115": 1215, "116": 1250, "117": 1285, "118": 1320, "119": 1360, "120": 1400, "121": 1450, "122": 1500, "123": 1550, "124": 1600, "125": 1650, "126": 1700, "127": 1750, "128": 1800, "129": 1850, "130": 1900, "131": 1950, "132": 2000, "133": 2060, "134": 2120, "135": 2180, "136": 2240, "137": 2300, "138": 2360, "139": 2430, "140": 2500, "141": 2575, "142": 2650, "143": 2725, "144": 2800, "145": 2900, "146": 3000, "147": 3075, "148": 3150, "149": 3250, "150": 3350, "151": 3450, "152": 3550, "153": 3650, "154": 3750, "155": 3875, "156": 4000, "157": 4125, "158": 4250, "159": 4375, "160": 4500, "161": 4625, "162": 4750, "163": 4875, "164": 5000, "165": 5150, "166": 5300, "167": 5450, "168": 5600, "169": 5800, "170": 6000}'::jsonb ->> nullif(substring(btrim(coalesce(p, '')) from '^(\d{2,3})'), ''))::numeric
    $$ $f$;
  execute $f$
    create or replace function tc_kmh_codigo_velocidad(p text) returns integer
    language sql immutable set search_path = public as $$
      select ('{"B": 50, "C": 60, "D": 65, "E": 70, "F": 80, "G": 90, "J": 100, "K": 110, "L": 120, "M": 130, "N": 140, "P": 150, "Q": 160, "R": 170, "S": 180, "T": 190, "U": 200, "H": 210, "V": 240, "W": 270, "Y": 300}'::jsonb ->> upper(btrim(coalesce(p, ''))))::integer
    $$ $f$;

  -- 2. Índices de carga: los de los Excel y los que ya se usan. Solo números
  --    de dos o tres cifras: «108R» de una ficha mal escrita entra como 108.
  insert into tc_cat_indices_carga (valor, kg)
  select v, tc_kg_indice_carga(v)
    from (
      select unnest(array['86', '87', '88', '89', '90', '92', '93', '94', '95', '96', '97', '98', '99', '100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '114', '115', '116', '117', '118', '119', '120', '121']) as v
      union select substring(btrim(indice_carga_simple) from '^(\d{2,3})') from tyre_sizes where activo
      union select substring(btrim(indice_carga_doble) from '^(\d{2,3})') from tyre_sizes where activo
      union select substring(btrim(x) from '^(\d{2,3})')
              from tc_neumaticos, regexp_split_to_table(coalesce(indice_carga, ''), '/') x
    ) s
   where v is not null
  on conflict (valor) do nothing;
  update tc_cat_indices_carga set kg = tc_kg_indice_carga(valor) where kg is null;

  insert into tc_cat_indices_velocidad (valor, km_h)
  select v, tc_kmh_codigo_velocidad(v)
    from (
      select unnest(array['H', 'P', 'Q', 'R', 'S', 'T']) as v
      union select upper(btrim(codigo_velocidad)) from tyre_sizes where activo
      union select upper(btrim(indice_velocidad)) from tc_neumaticos
    ) s
   where v ~ '^[A-Z]$'
  on conflict (valor) do nothing;
  update tc_cat_indices_velocidad set km_h = tc_kmh_codigo_velocidad(valor) where km_h is null;

  -- Medidas. El disparador de la tabla las normaliza antes de comprobar si ya
  -- están, así que «195/70R15» no entra dos veces.
  insert into tc_cat_medidas_neumatico (valor, activo, categoria, ancho, perfil, diametro)
  select v, true, 'furgoneta',
         substring(v from '^(\d{3})')::numeric,
         substring(v from '^\d{3}/(\d{2})')::numeric,
         substring(v from 'R(\d{2}(?:\.\d)?)')::numeric
    from unnest(array['155R13', '165/70R13', '165/70R14', '165R13', '175/65R14', '175/70R14', '175/75R16', '175/80R14', '185/75R14', '185/75R16', '185/80R14', '185R14', '185R15', '195/60R16', '195/65R16', '195/70R15', '195/75R14', '195/75R16', '195/80R14', '195/80R15', '195R14', '205/55R16', '205/60R16', '205/65R15', '205/65R16', '205/70R15', '205/75R16', '205R14', '215/60R16', '215/60R17', '215/65R15', '215/65R16', '215/65R17', '215/70R15', '215/70R16', '215/75R16', '225/55R17', '225/60R16', '225/65R16', '225/65R16CP', '225/70R15', '225/75R16', '225/75R16CP', '235/60R17', '235/65R16', '235/65R16CP']) v
   where not exists (select 1 from tc_cat_medidas_neumatico m where tc_medida_normalizada(m.valor) = tc_medida_normalizada(v))
  on conflict (valor) do nothing;

  -- Modelos.
  insert into tc_cat_modelos_neumatico (marca_id, nombre, activo, tipo_vehiculo, aplicacion)
  select ma.id, x.nombre, true, 'furgoneta', x.temporada
    from (values
    ('Hankook', 'RA18', null),
    ('Hankook', 'RA58', null),
    ('Hankook', 'RW12', null),
    ('Hankook', 'RA30', null),
    ('Continental', 'VanContact A/S Ultra', 'Todo tiempo'),
    ('Continental', 'VanContact Ultra', 'Verano'),
    ('Continental', 'ContiVanContact 100', 'Verano'),
    ('Continental', 'VanContact Winter', 'Invierno'),
    ('Continental', 'VanContact 4Season', 'Todo tiempo'),
    ('Continental', 'VanContact Eco', 'Verano'),
    ('Continental', 'VancoCamper', 'Verano'),
    ('Continental', 'ContiVanContact 200', 'Verano'),
    ('Continental', 'VancoFourSeason 2', 'Todo tiempo'),
    ('Continental', 'VanContact A/S Ultra Camper', 'Todo tiempo'),
    ('Michelin', 'Agilis Alpin', 'Invierno'),
    ('Michelin', 'Agilis CrossClimate', 'Todo tiempo'),
    ('Michelin', 'Agilis 3', 'Verano'),
    ('Michelin', 'CrossClimate Camping', 'Todo tiempo')
    ) as x(marca, nombre, temporada)
    join tc_cat_marcas_neumatico ma on upper(ma.nombre) = upper(x.marca)
   where not exists (
     select 1 from tc_cat_modelos_neumatico m
      where m.marca_id = ma.id
        and regexp_replace(upper(m.nombre), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(x.nombre), '[^A-Z0-9]', '', 'g'))
  on conflict (marca_id, nombre) do nothing;

  -- 3. Una combinación nueva mete su índice y su velocidad en las tablas.
  execute $f$
    create or replace function tc_catalogo_desde_combinacion_trg() returns trigger
    language plpgsql security definer set search_path = public as $$
    declare v text;
    begin
      foreach v in array array[new.indice_carga_simple, new.indice_carga_doble] loop
        v := substring(btrim(coalesce(v, '')) from '^(\d{2,3})');
        if v is not null then
          insert into tc_cat_indices_carga (valor, kg) values (v, tc_kg_indice_carga(v))
          on conflict (valor) do nothing;
        end if;
      end loop;
      v := upper(btrim(coalesce(new.codigo_velocidad, '')));
      if v ~ '^[A-Z]$' then
        insert into tc_cat_indices_velocidad (valor, km_h) values (v, tc_kmh_codigo_velocidad(v))
        on conflict (valor) do nothing;
      end if;
      return new;
    end $$ $f$;
  execute 'drop trigger if exists trg_catalogo_desde_combinacion on tyre_sizes';
  execute 'create trigger trg_catalogo_desde_combinacion after insert or update of indice_carga_simple, indice_carga_doble, codigo_velocidad on tyre_sizes for each row execute function tc_catalogo_desde_combinacion_trg()';

  -- La prueba: una combinación con un índice y una velocidad que no use nadie.
  begin
    delete from tc_cat_indices_carga where valor in ('167', '163');
    delete from tc_cat_indices_velocidad where valor = 'Y';
    insert into tyre_sizes (medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad, activo)
    values ('999/99R99', 999, 99, 99, '167', '163', 'Y', true);
    v_ok := (select kg from tc_cat_indices_carga where valor = '167') = 5450
        and (select kg from tc_cat_indices_carga where valor = '163') = 4875
        and (select km_h from tc_cat_indices_velocidad where valor = 'Y') = 300;
    raise exception using errcode = 'MB001', message = case when v_ok then 'ok' else 'mal' end;
  exception when sqlstate 'MB001' then
    if sqlerrm <> 'ok' then
      raise exception 'La prueba ha fallado: una combinación nueva no mete su índice o su velocidad. No se toca nada.';
    end if;
  end;

  perform set_config('mobilink.resultado', format(
    'OK. Añadidos: %s índices de carga, %s códigos de velocidad, %s medidas, %s modelos.',
    (select count(*) from tc_cat_indices_carga) - v_ic_antes,
    (select count(*) from tc_cat_indices_velocidad) - v_cv_antes,
    (select count(*) from tc_cat_medidas_neumatico) - v_med_antes,
    (select count(*) from tc_cat_modelos_neumatico) - v_mod_antes), false);
  raise notice '%', current_setting('mobilink.resultado');
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado,
       (select count(*) from tc_cat_indices_carga) as indices_carga,
       (select count(*) from tc_cat_indices_carga where kg is null) as indices_sin_kg,
       (select count(*) from tc_cat_indices_velocidad) as codigos_velocidad,
       (select count(*) from tc_cat_indices_velocidad where km_h is null) as codigos_sin_kmh,
       (select count(*) from tc_cat_medidas_neumatico) as medidas,
       (select count(*) from tc_cat_modelos_neumatico m join tc_cat_marcas_neumatico ma on ma.id = m.marca_id
         where ma.nombre in ('Hankook', 'Michelin', 'Continental')) as modelos_de_las_tres_marcas;
