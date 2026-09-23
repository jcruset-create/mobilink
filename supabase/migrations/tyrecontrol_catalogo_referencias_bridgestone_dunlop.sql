-- ============================================================
-- Mobilink TyreControl — Referencias de Bridgestone y Dunlop
--
-- El catálogo del panel lista tc_referencias_neumatico. Los lotes 04
-- (Bridgestone) y 06 (Dunlop) cargaron marca, medidas y modelos, pero
-- ninguna referencia: 30 modelos que no salen en ninguna pantalla.
--
-- ⚠️ ORIGEN DE ESTOS DATOS, QUE NO ES EL DE LOS DEMÁS LOTES ⚠️
-- Goodyear, Sailun y Continental salen de databooks oficiales y del
-- Excel de catálogo. Estas filas NO. Las fichas técnicas de Bridgestone
-- y Dunlop no son accesibles desde el entorno donde se generó esta
-- migración, así que el índice de carga y el símbolo de velocidad se han
-- tomado de listados de distribuidores europeos, exigiendo que al menos
-- DOS coincidieran en el mismo modelo y la misma medida.
--
-- Por eso todas nacen con verificacion_estado = 'distribuidor_web' y con
-- las dos URLs consultadas. El índice de carga es el dato que dice qué
-- peso aguanta el eje: antes de darlo por bueno hay que contrastarlo con
-- el databook (Bridgestone TBR Data Book / Dunlop TTDB). La columna
-- verificacion_estado está precisamente para poder listarlas y repasarlas.
--
-- Solo entran las combinaciones modelo × medida que un listado nombraba
-- de forma explícita. Las que no se pudieron confirmar NO se inventan:
-- de los 20 modelos Bridgestone salen 7 y de los 10 Dunlop salen 5. El
-- resto sigue sin referencia, que es lo honesto mientras no haya ficha.
--
-- Presión, dimensiones y carga máxima no se cargan. Idempotente.
-- ============================================================

-- ── 1. Columnas de trazabilidad ─────────────────────────────────────────────
-- Las creó la migración de Continental (lote 02). Se repiten aquí para que
-- este fichero se pueda ejecutar solo, sin depender del orden.
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

-- ── 2. La única medida que falta ────────────────────────────────────────────
-- El resto ya las crearon los lotes de Goodyear y Continental.
insert into tyre_sizes (referencia_completa, medida, ancho, perfil, diametro_llanta,
                        indice_carga_simple, indice_carga_doble, codigo_velocidad, medida_id)
select '385/65R22.5 160J', '385/65R22.5', 385, 65, 22.5, '160', null, 'J',
       (select id from tc_cat_medidas_neumatico where valor = '385/65R22.5')
where not exists (select 1 from tyre_sizes where referencia_completa = '385/65R22.5 160J');

-- ── 3. Las referencias ──────────────────────────────────────────────────────
do $$
declare
  f record;
  v_modelo uuid;
  v_size   uuid;
begin
  for f in
    select * from (values
      -- marca, modelo, medida (tyre_sizes.referencia_completa), PR,
      -- marcado secundario, M+S, 3PMSF, profundidad, fuente 1, fuente 2, notas
      ('Bridgestone','DURAVIS R-DRIVE 002'   ,'315/70R22.5 154/150L',null::int,'152/148M',true ,true ,16.6::numeric,
       'https://www.heuver.com/webshop/product/10002088/315-70r22-5-bridgestone-duravis-r-drive-002-154-150l-152-148m-tl-m-s-3pmsf',
       'https://www.truckbandenmarkt.com/en/truck-tires/bridgestone-315-70r22-5-r-drive-002-154-150l-152-148m/', null::text),

      ('Bridgestone','DURAVIS R-STEER 002'   ,'315/70R22.5 156/150L',null,'154/150M',null ,true ,null,
       'https://www.heuver.com/product/10002110/315-70r22-5-bridgestone-duravis-r-steer-002-156-150l-154-150m-tl-3pmsf',
       'https://www.tyres-outlet.co.uk/product/bridgestone/duravis-r-steer-002/315-70-r22.5/r-411303', null),

      ('Bridgestone','DURAVIS R-TRAILER 002' ,'385/65R22.5 160K'    ,20  ,'158L'    ,true ,true ,null,
       'https://www.heuver.com/product/10006034/385-65r22-5-bridgestone-duravis-r-trailer-002-160k-158l-20pr-tl-m-s-3pmsf',
       'https://www.bigtyres.co.uk/tyres/brands/bridgestone/r-trailer-002/385-65r22-5-bridgestone-duravis-r-trailer-002-tl-trailer-160k',
       'Existe también en 385/55R22.5 160K pero con un solo listado: no se carga hasta confirmarla.'),

      ('Bridgestone','ECOPIA H-DRIVE 002'    ,'315/80R22.5 156/150L',null,'154/150M',null ,null ,null,
       'https://www.tyres-outlet.co.uk/product/bridgestone/ecopia-h-drive-002/315-80-r22.5/r-378082',
       'https://tecnotyres.com/en/bridgestone-315-80-r22-5-ecohd2-156l154m-tl/', null),

      ('Bridgestone','ECOPIA H-DRIVE 002'    ,'315/70R22.5 154/150L',null,null      ,null ,null ,null,
       'https://www.internationaltyres.com/shop/315-70-r-22-5-bridgestone-ecopia-h-drive-002-154-150l/',
       null, 'Un solo listado explícito; el índice coincide con el del R-DRIVE 002 en la misma medida.'),

      ('Bridgestone','ECOPIA H-STEER 002'    ,'315/80R22.5 156/150L',null,null      ,true ,true ,null,
       'https://www.mlperformanceusa.com/products/bridgestone-ecopia-h-steer-002-315-80-r22-5-156-150l-truck-summer-tyre-13509',
       'https://wheelandtireproz.com/product/bridgestone-ecopia-h-steer-002-315-80-r22-5-156l/',
       'En 315/70R22.5 los listados se contradicen (154L frente a 156L), así que esa medida no se carga.'),

      ('Bridgestone','ECOPIA H-TRAILER 002'  ,'385/65R22.5 160K'    ,20  ,'158L'    ,null ,null ,null,
       'https://www.internationaltyres.com/shop/385-65-r-22-5-bridgestone-ecopia-h-trailer-002-160k-158l/',
       'https://www.forrez.com/en/wholesale/products/bridgestone-38565r225-ecopia-h-trailer-002-160-k-tl', null),

      ('Bridgestone','ECOPIA H-TRAILER 002'  ,'385/55R22.5 160K'    ,20  ,null      ,null ,null ,null,
       'https://www.giga-tyres.co.uk/bridgestone/ecopia-h-trailer-002/385/55-r22.5/160/k/gi-r-378088ga',
       'https://otrusa.com/products/385-55r22-5-20pr-l-bridgestone-ecopia-h-trailer-002-tl', null),

      ('Bridgestone','ECOPIA DRIVE'          ,'315/70R22.5 154/150L',null,'152/148M',true ,true ,13.7,
       'https://www.heuver.com/webshop/product/10014749/315-70r22-5-bridgestone-ecopia-drive-enliten-154-150l-152-148m-tl-m-s-3pmsf',
       null, 'Generación ENLITEN. Un solo listado explícito.'),

      ('Dunlop'     ,'SP346'                 ,'315/70R22.5 156/150L',null,null      ,true ,true ,null,
       'https://www.farmtyresni.com/product-page/315-70r22-5-dunlop-sp346-156-150l',
       'https://news.goodyear.eu/ready-for-whatevers-ahead---dunlop-launches-new-on-road-truck-tyre-range/', null),

      ('Dunlop'     ,'SP346'                 ,'385/65R22.5 160K'    ,null,'158L'    ,true ,null ,null,
       'https://www.truckbandenmarkt.com/en/truck-tires/dunlop-385-65r22-5-sp-346-160k-158l/',
       'https://e-catalog.com/DUNLOP-SP346-385-65-R22-5-160K.htm', null),

      ('Dunlop'     ,'SP346+'                ,'315/70R22.5 156/150L',null,null      ,true ,true ,null,
       'https://shop.fastparts.is/en/product/dekk-31570r22.5-dunlop-sp346-hl-156150l-48905',
       'https://e-partstruck.com/produs/truck-tires-dunlop-315-70r22-5-sp346/',
       'Los listados la dan como SP346+ HL: el 156/150L es el índice de la versión High Load.'),

      ('Dunlop'     ,'SP446'                 ,'315/70R22.5 154/150L',null,'152/148M',true ,true ,null,
       'https://www.truckbandenmarkt.com/en/truck-tires/dunlop-315-70r22-5-sp-446-154-150l-152-148m/',
       'https://www.rsu.de/p/dunlop-sp-446-315-70r22-5-154l-150l-152m-150m-250976', null),

      ('Dunlop'     ,'SP246'                 ,'385/65R22.5 164K'    ,20  ,'158L'    ,true ,null ,null,
       'https://www.heuver.com/webshop/product/b38565225duk24600/385-65r22-5-dunlop-sp246-164k-158l-20pr-hl-tl-m-s',
       'https://www.tyres-outlet.co.uk/product/dunlop/sp-246/385-65-r22.5/r-332729', 'Versión HL (High Load).'),

      ('Dunlop'     ,'SP246'                 ,'385/55R22.5 160K'    ,null,'158L'    ,null ,null ,null,
       'https://www.tyres-outlet.co.uk/product/dunlop/sp-246/385-55-r22.5/r-330245',
       null, 'Un solo listado explícito.'),

      ('Dunlop'     ,'SP282'                 ,'385/65R22.5 160J'    ,20  ,'158K'    ,true ,null ,null,
       'https://www.heuver.com/product/b38565225duj28200/385-65r22-5-dunlop-sp282-160j-158k-tl-m-s',
       'https://www.tiremart.com/dunlop-sp-282-385-65r22-5-160j-l-20-ply-as-a-s-all-season-tire/', null)
    ) as t(marca, modelo, medida, ply, secundario, m_s, pmsf, prof, fuente1, fuente2, notas)
  loop
    select mo.id into v_modelo
      from tc_cat_modelos_neumatico mo
      join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
     where ma.nombre = f.marca and mo.nombre = f.modelo;

    select id into v_size from tyre_sizes where referencia_completa = f.medida;

    if v_modelo is null then
      raise exception 'No existe el modelo % de %. ¿Falta el lote de la marca?', f.modelo, f.marca;
    end if;
    if v_size is null then
      raise exception 'No existe la medida %', f.medida;
    end if;

    insert into tc_referencias_neumatico
      (modelo_id, tyre_size_id, referencia_completa, ply, marcado_secundario,
       m_s, tres_pmsf, profundidad_dibujo_mm,
       verificacion_estado, fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
    values
      (v_modelo, v_size, f.marca || ' ' || f.modelo || ' ' || f.medida, f.ply, f.secundario,
       f.m_s, f.pmsf, f.prof,
       'distribuidor_web', f.fuente1, f.fuente2, f.notas)
    on conflict (modelo_id, tyre_size_id) do update set
      referencia_completa      = excluded.referencia_completa,
      ply                      = coalesce(excluded.ply, tc_referencias_neumatico.ply),
      marcado_secundario       = coalesce(excluded.marcado_secundario, tc_referencias_neumatico.marcado_secundario),
      m_s                      = coalesce(excluded.m_s, tc_referencias_neumatico.m_s),
      tres_pmsf                = coalesce(excluded.tres_pmsf, tc_referencias_neumatico.tres_pmsf),
      profundidad_dibujo_mm    = coalesce(excluded.profundidad_dibujo_mm, tc_referencias_neumatico.profundidad_dibujo_mm),
      -- Si alguien ya la verificó contra el databook, no se le pisa el estado.
      verificacion_estado      = case when tc_referencias_neumatico.verificacion_estado = 'verificado'
                                      then 'verificado' else 'distribuidor_web' end,
      fuente_oficial_url       = coalesce(tc_referencias_neumatico.fuente_oficial_url, excluded.fuente_oficial_url),
      fuente_corroboracion_url = coalesce(tc_referencias_neumatico.fuente_corroboracion_url, excluded.fuente_corroboracion_url),
      verificacion_notas       = coalesce(excluded.verificacion_notas, tc_referencias_neumatico.verificacion_notas);
  end loop;
end $$;

-- ── 4. Recuento, y un aviso de lo que sigue faltando ────────────────────────
do $$
declare
  n_ref      int;
  n_sin_ref  int;
begin
  select count(*) into n_ref
    from tc_referencias_neumatico r
    join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
    join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
   where ma.nombre in ('Bridgestone','Dunlop');

  if n_ref < 16 then
    raise exception 'Solo han entrado % referencias de Bridgestone/Dunlop, se esperaban 16', n_ref;
  end if;

  select count(*) into n_sin_ref
    from tc_cat_modelos_neumatico mo
    join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
   where ma.nombre in ('Bridgestone','Dunlop')
     and not exists (select 1 from tc_referencias_neumatico r where r.modelo_id = mo.id);

  raise notice 'Bridgestone + Dunlop: % referencias cargadas. Siguen sin ninguna % modelos, a la espera de ficha oficial.', n_ref, n_sin_ref;
  raise notice 'Todas nacen como verificacion_estado = ''distribuidor_web'': repasar el indice de carga contra el databook.';
end $$;

comment on column tc_referencias_neumatico.verificacion_estado is
  'De dónde sale el dato: ''verificado'' (ficha oficial del fabricante), ''distribuidor_web'' (listado de distribuidor, pendiente de contrastar) o null (sin comprobar).';
