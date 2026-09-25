-- ============================================================
-- Mobilink TyreControl — Referencias de Michelin
--
-- El lote 03 cargó marca, 9 medidas y 12 modelos, pero ninguna
-- referencia, y el catálogo del panel lista tc_referencias_neumatico:
-- Michelin salía vacío en pantalla.
--
-- ⚠️ MISMO AVISO QUE EN BRIDGESTONE Y DUNLOP ⚠️
-- Estas filas NO salen de la ficha oficial. El Data Book de Michelin y
-- sus webs de producto no son accesibles desde el entorno donde se
-- generó la migración, así que el índice de carga y el símbolo de
-- velocidad se han tomado de listados de distribuidores europeos,
-- exigiendo que al menos DOS coincidieran en el mismo modelo y la misma
-- medida. Nacen con verificacion_estado = 'distribuidor_web' y con las
-- URLs consultadas: el índice de carga dice qué peso aguanta el eje, así
-- que hay que contrastarlo con el Data Book antes de darlo por bueno.
--
-- Michelin es además la marca donde más fácil es equivocarse, porque los
-- nombres se parecen mucho entre sí y entre generaciones: X MULTI Z,
-- X MULTI HD Z, X MULTI ENERGY Z, X MULTI GRIP Z y X MULTI HL Z son
-- cinco productos distintos. Solo entran las filas en las que el listado
-- nombraba el modelo EXACTO del catálogo.
--
-- Por eso salen 5 de los 12 modelos. Quedan fuera a propósito:
--   · X LINE ENERGY Z3 y D3 — generación nueva; los distribuidores aún
--     listan Z, Z2 y D2, y no se va a copiar el índice de la generación
--     anterior por parecido.
--   · X WORKS D, D2, T, Z — los listados europeos y los americanos no
--     coinciden (156/150K frente a 157/154K en 315/80R22.5).
--   · X MULTI HD D+ — sin listado que la nombre.
--
-- Presión, dimensiones y carga máxima no se cargan. Idempotente.
-- ============================================================

alter table tc_referencias_neumatico
  add column if not exists m_s                      boolean,
  add column if not exists tres_pmsf                boolean,
  add column if not exists marcado_secundario       text,
  add column if not exists ean                      text,
  add column if not exists codigo_fabricante        text,
  add column if not exists verificacion_estado      text,
  add column if not exists fuente_oficial_url       text,
  add column if not exists fuente_corroboracion_url text,
  add column if not exists verificacion_notas       text;

do $$
declare
  f record;
  v_modelo uuid;
  v_size   uuid;
begin
  for f in
    select * from (values
      -- modelo, medida, PR, marcado secundario, M+S, 3PMSF,
      -- etiqueta rr / grip / ruido dB / clase ruido, fuente 1, fuente 2, notas
      ('X MULTI Z'   ,'315/70R22.5 156/150L',null::int,null::text  ,true,true ,'C'::text,'B'::text,72::numeric,'A'::text,
       'https://www.heuver.com/product/b31570225milxmz00/315-70r22-5-michelin-x-multi-z-156-150l-tl-m-s-3pmsf',
       'https://www.bigtyres.co.uk/tyres/brands/michelin/x-multi-z/315-70r22-5-michelin-x-multi-z-m-s-3pmsf-tl-steer-156-150l',
       null::text),

      ('X MULTI Z'   ,'385/65R22.5 160K'    ,null,'158L',true,true ,null,null,null,null,
       'https://www.bigtyres.co.uk/tyres/brands/michelin/x-multi-z/385-65r22-5-michelin-x-multi-z-tl-steer-160k-3pmsf',
       'https://www.truckbandenmarkt.com/en/truck-tires/michelin-385-65r22-5-x-multi-z-160k-158l/', null),

      ('X MULTI T'   ,'385/65R22.5 160K'    ,null,'158L',true,true ,null,null,null,null,
       'https://www.heuver.com/webshop/product/b38565225mikxmt01/385-65r22-5-michelin-x-multi-t-160k-tl-m-s-3pmsf',
       'https://www.bigtyres.co.uk/tyres/brands/michelin/x-multi-t/385-65r22-5-michelin-x-multi-t-tl-trailer-160k', null),

      ('X MULTI F'   ,'385/65R22.5 160K'    ,null,'158L',true,false,null,null,null,null,
       'https://www.bigtyres.co.uk/tyres/brands/michelin/x-multi-f/385-65r22-5-michelin-x-multi-f-m-s-tl-steer-158l-160k',
       null,
       'Un solo listado explícito. Lleva M+S pero NO 3PMSF, al revés que la Z y la T de la misma medida: no es un olvido.'),

      ('X MULTI HD Z','315/80R22.5 156/150L',18  ,null  ,null,null ,null,null,null,null,
       'https://www.bigtyres.co.uk/tyres/brands/michelin/x-multi-hd-z/315-80r22-5-michelin-x-multi-hd-z-tl-all-position-156-150l',
       'https://www.internationaltyres.com/shop/315-80-r-22-5-michelin-x-multi-z-hd-156-150l/', null),

      ('X MULTI HD D','315/80R22.5 156/150L',18  ,null  ,null,null ,null,null,null,null,
       'https://mantallanta.com/en/products/michelin%C2%AE-x-multi-hd-d-315-80r22-5-156-150l-tl',
       'https://business.michelin.co.uk/tyres/michelin-x-multi-hd-d-z', null)
    ) as t(modelo, medida, ply, secundario, m_s, pmsf, rr, grip, ruido_db, ruido_clase, fuente1, fuente2, notas)
  loop
    select mo.id into v_modelo
      from tc_cat_modelos_neumatico mo
      join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
     where ma.nombre = 'Michelin' and mo.nombre = f.modelo;

    select id into v_size from tyre_sizes where referencia_completa = f.medida;

    if v_modelo is null then
      raise exception 'No existe el modelo Michelin %. ¿Falta el lote 03?', f.modelo;
    end if;
    if v_size is null then
      raise exception 'No existe la medida %', f.medida;
    end if;

    insert into tc_referencias_neumatico
      (modelo_id, tyre_size_id, referencia_completa, ply, marcado_secundario, m_s, tres_pmsf,
       etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
       verificacion_estado, fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
    values
      (v_modelo, v_size, 'Michelin ' || f.modelo || ' ' || f.medida, f.ply, f.secundario, f.m_s, f.pmsf,
       f.rr, f.grip, f.ruido_db, f.ruido_clase,
       'distribuidor_web', f.fuente1, f.fuente2, f.notas)
    on conflict (modelo_id, tyre_size_id) do update set
      referencia_completa      = excluded.referencia_completa,
      ply                      = coalesce(excluded.ply, tc_referencias_neumatico.ply),
      marcado_secundario       = coalesce(excluded.marcado_secundario, tc_referencias_neumatico.marcado_secundario),
      m_s                      = coalesce(excluded.m_s, tc_referencias_neumatico.m_s),
      -- 3PMSF puede ser false a propósito (la X MULTI F), así que aquí no
      -- vale coalesce: un false del fichero tiene que poder entrar.
      tres_pmsf                = excluded.tres_pmsf,
      etiqueta_rr              = coalesce(excluded.etiqueta_rr, tc_referencias_neumatico.etiqueta_rr),
      etiqueta_grip_humedo     = coalesce(excluded.etiqueta_grip_humedo, tc_referencias_neumatico.etiqueta_grip_humedo),
      etiqueta_ruido_db        = coalesce(excluded.etiqueta_ruido_db, tc_referencias_neumatico.etiqueta_ruido_db),
      etiqueta_ruido_clase     = coalesce(excluded.etiqueta_ruido_clase, tc_referencias_neumatico.etiqueta_ruido_clase),
      verificacion_estado      = case when tc_referencias_neumatico.verificacion_estado = 'verificado'
                                      then 'verificado' else 'distribuidor_web' end,
      fuente_oficial_url       = coalesce(tc_referencias_neumatico.fuente_oficial_url, excluded.fuente_oficial_url),
      fuente_corroboracion_url = coalesce(tc_referencias_neumatico.fuente_corroboracion_url, excluded.fuente_corroboracion_url),
      verificacion_notas       = coalesce(excluded.verificacion_notas, tc_referencias_neumatico.verificacion_notas);
  end loop;
end $$;

do $$
declare n_ref int; n_sin int;
begin
  select count(*) into n_ref
    from tc_referencias_neumatico r
    join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
    join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
   where ma.nombre = 'Michelin';

  if n_ref < 6 then
    raise exception 'Solo han entrado % referencias Michelin, se esperaban 6', n_ref;
  end if;

  select count(*) into n_sin
    from tc_cat_modelos_neumatico mo
    join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
   where ma.nombre = 'Michelin'
     and not exists (select 1 from tc_referencias_neumatico r where r.modelo_id = mo.id);

  raise notice 'Michelin: % referencias cargadas. Siguen sin ninguna % modelos, a la espera de ficha oficial.', n_ref, n_sin;
end $$;
