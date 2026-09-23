-- ============================================================
-- SEA TyreControl — El eje y el tipo de uso, como listas de verdad.
--
-- ── Qué problema resuelve ───────────────────────────────────────────────────
--
-- `tc_cat_modelos_neumatico.aplicacion` es texto libre, y se nota. En el
-- catálogo cargado conviven, para decir lo mismo:
--
--   Regional · Regional / versátil · Regional / Aggressive ·
--   Long haul / Regional · Larga distancia / autopista ·
--   Mixed on/off road / Construction · Mixto moderado carretera/obra …
--
-- Más de cuarenta variantes. Así no se puede ofrecer un desplegable, ni
-- agrupar por tipo de uso en un informe, ni buscar «los de obra».
--
-- El eje va mejor —cuatro valores— pero tampoco tiene tabla: vive como texto
-- dentro de cada fila, así que no se puede renombrar ni añadir uno nuevo sin
-- tocar código.
--
-- Esta migración crea las dos listas, las siembra y REASIGNA lo que ya hay.
--
-- ── Lo que NO hace ──────────────────────────────────────────────────────────
--
-- No borra nada y no inventa: lo que no encaja en ninguna regla se queda tal
-- cual y sale listado al final para mirarlo a mano. Un modelo mal clasificado
-- es peor que uno sin clasificar, porque nadie lo vuelve a revisar.
--
-- Aditiva y reversible. Idempotente.
-- ============================================================

-- ── Los ejes ────────────────────────────────────────────────────────────────
create table if not exists tc_cat_ejes_neumatico (
  codigo  text primary key,
  nombre  text not null,
  orden   int  not null default 100,
  activo  boolean not null default true
);

insert into tc_cat_ejes_neumatico (codigo, nombre, orden) values
  ('direccion', 'Dirección', 10),
  ('traccion',  'Tracción',  20),
  ('remolque',  'Remolque',  30),
  ('mixto',     'Mixto (todas las posiciones)', 40)
on conflict (codigo) do update set nombre = excluded.nombre, orden = excluded.orden;

comment on table tc_cat_ejes_neumatico is
  'En qué eje va el neumático. Lista editable: para añadir uno, se inserta '
  'aquí y aparece solo en el desplegable del catálogo.';

-- ── Los tipos de uso ────────────────────────────────────────────────────────
--
-- Corta a propósito. Una lista de veinte opciones no la usa nadie: se elige la
-- primera que suena y vuelve el desorden por otro camino.
create table if not exists tc_cat_aplicaciones_neumatico (
  codigo  text primary key,
  nombre  text not null,
  orden   int  not null default 100,
  activo  boolean not null default true
);

insert into tc_cat_aplicaciones_neumatico (codigo, nombre, orden) values
  ('larga_distancia', 'Larga distancia',        10),
  ('regional',        'Regional',               20),
  ('urbano',          'Urbano / reparto',       30),
  ('obra',            'Obra y todoterreno',     40),
  ('mixto',           'Mixto carretera / obra', 50),
  ('invierno',        'Invierno',               60),
  ('especial',        'Especial / otros',       90)
on conflict (codigo) do update set nombre = excluded.nombre, orden = excluded.orden;

comment on table tc_cat_aplicaciones_neumatico is
  'Para qué se usa el neumático. Lista editable, corta a propósito: una de '
  'veinte opciones no la usa nadie y el desorden vuelve por otro camino.';

-- ── Reasignar lo que ya hay ─────────────────────────────────────────────────
--
-- El orden de las reglas IMPORTA y no es alfabético: se va de lo más
-- específico a lo más general. «Winter regional» tiene que ser invierno y no
-- regional, y «Long haul / Regional» larga distancia y no regional.
--
-- ── Dónde está la frontera entre «obra» y «mixto» ───────────────────────────
--
-- Es la decisión que había que tomar, porque en el catálogo hay textos que
-- dicen las dos cosas: «Mixto moderado carretera/obra», «Mixed on/off road /
-- Construction», «On-road / On-off road».
--
-- El criterio: si el texto dice que va por CARRETERA Y por obra —mixto, mixed,
-- on/off, versátil—, es MIXTO. «Obra» queda para el que solo habla de obra:
-- cantera, construction a secas, todoterreno. Por eso la regla de mixto va
-- ANTES que la de obra, aunque el texto mencione las dos.
--
-- Así «obra» significa algo —neumático de obra pura— en vez de ser el cajón
-- donde cae todo lo que roza una cantera.
--
-- Se guarda el texto original en una columna nueva: si alguna regla se
-- equivoca, el dato no se ha perdido y se puede rehacer el reparto.
alter table tc_cat_modelos_neumatico
  add column if not exists aplicacion_original text;

update tc_cat_modelos_neumatico
   set aplicacion_original = aplicacion
 where aplicacion_original is null and aplicacion is not null;

do $$
declare
  v_reglas text[][] := array[
    -- invierno primero: «Winter regional» es de invierno, no regional
    array['invierno',        '(invierno|winter|nieve|snow|3pmsf|m\+s)'],
    -- mixto ANTES que obra: un texto que menciona las dos cosas es mixto.
    array['mixto',           '(mixto|mixed|versátil|versatil|on.?off|on.?and.?off|on-road)'],
    array['obra',            '(obra|cantera|quarry|construction|todoterreno|off.?road)'],
    array['urbano',          '(urbano|urban|city|reparto|delivery|bus urbano|autobús urbano)'],
    array['larga_distancia', '(larga distancia|long.?haul|autopista|highway|coach|carretera larga)'],
    array['regional',        '(regional|interregional|comarcal)']
  ];
  v_regla text[];
  v_tocados int;
begin
  foreach v_regla slice 1 in array v_reglas loop
    update tc_cat_modelos_neumatico
       set aplicacion = v_regla[1]
     where aplicacion is not null
       and aplicacion !~ '^[a-z_]+$'          -- lo ya normalizado no se vuelve a tocar
       and aplicacion ~* v_regla[2];
    get diagnostics v_tocados = row_count;
    raise notice 'aplicacion=% → % modelos', v_regla[1], v_tocados;
  end loop;
end $$;

-- ── Lo que no ha encajado ───────────────────────────────────────────────────
--
-- Se queda con su texto original y se enseña aquí. Es deliberado: clasificar
-- a ojo lo que no encaja en ninguna regla es justo como se cuela un dato malo
-- que ya nadie repasa.
create or replace view tc_modelos_aplicacion_sin_clasificar as
  select m.id, m.nombre, k.nombre as marca, m.aplicacion
    from tc_cat_modelos_neumatico m
    left join tc_cat_marcas_neumatico k on k.id = m.marca_id
   where m.aplicacion is not null
     and m.aplicacion not in (select codigo from tc_cat_aplicaciones_neumatico);

comment on view tc_modelos_aplicacion_sin_clasificar is
  'Modelos cuyo tipo de uso no encajó en ninguna regla de reparto. Se revisan '
  'a mano desde el catálogo; su texto original sigue en aplicacion_original.';

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Las dos listas las lee todo el mundo y las escribe quien administra el
-- catálogo, igual que el resto de catálogos maestros de TyreControl.
alter table tc_cat_ejes_neumatico enable row level security;
alter table tc_cat_aplicaciones_neumatico enable row level security;

drop policy if exists ejes_lectura on tc_cat_ejes_neumatico;
create policy ejes_lectura on tc_cat_ejes_neumatico for select using (true);
drop policy if exists ejes_escritura on tc_cat_ejes_neumatico;
create policy ejes_escritura on tc_cat_ejes_neumatico for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists aplicaciones_lectura on tc_cat_aplicaciones_neumatico;
create policy aplicaciones_lectura on tc_cat_aplicaciones_neumatico for select using (true);
drop policy if exists aplicaciones_escritura on tc_cat_aplicaciones_neumatico;
create policy aplicaciones_escritura on tc_cat_aplicaciones_neumatico for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );
