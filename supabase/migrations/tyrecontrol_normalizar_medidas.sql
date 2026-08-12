-- ============================================================
-- Mobilink TyreControl — Una medida, una sola forma de escribirla
--
-- En el informe ejecutivo la misma medida sale dos veces:
--
--   295/80R22,5 · 10,6 mm media   2621
--   295/80R22.5 · 11,0 mm media    485
--   315/80R22,5 · 11,5 mm media    400
--   315/80R22.5 · 12,9 mm media    172
--
-- No son medidas distintas: es la misma goma escrita con coma y con punto.
-- El informe agrupa por el texto de tc_neumaticos.medida, así que cada
-- variante hace su propia fila, parte la media y descuadra el dimensionado
-- del stock. El Excel de Plana venía con las dos formas mezcladas y así han
-- entrado.
--
-- Lo que hace esta migración:
--
--   1. tc_medida_normalizada(): la forma canónica de escribir una medida.
--   2. Deja el catálogo tc_cat_medidas_neumatico con una sola fila por
--      medida, reapuntando lo que colgaba de las duplicadas antes de
--      borrarlas.
--   3. Normaliza el texto ya guardado en tc_neumaticos, productos_neumaticos,
--      tc_fichas_genericas_neumaticos y tyre_sizes.
--   4. Pone disparadores para que no vuelva a pasar: da igual si la medida
--      entra por el importador, por el panel o a mano.
--
-- NO se toca tc_tipos_llanta.medida: eso es la llanta ("22.5x11.75"), otro
-- formato y otro asunto.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- ── 1. La forma canónica ────────────────────────────────────────────────────
--
-- Deliberadamente conservadora: mayúsculas, sin espacios y la coma decimal a
-- punto. NO reconstruye la medida a partir de un regexp como hace
-- tc_medida_base(), porque eso tira lo que venga detrás (índice de carga,
-- código de velocidad: "315/80R22.5 156/150L"). Aquí solo se corrige la
-- forma de escribirla, nunca se pierde información.
create or replace function tc_medida_normalizada(p text)
returns text language sql immutable as $$
  select case
    when p is null then null
    when btrim(p) = '' then null
    else
      -- "295/80 r 22,5" → "295/80R22.5", y "315/80R22.5 156/150L" se queda
      -- con su índice de carga separado por UN espacio. Por eso no se borran
      -- todos los espacios de golpe: solo los de dentro de la medida.
      regexp_replace(
        -- El guion solo detrás de la R y entre dígitos: "295/80R22-5". Suelto
        -- no se toca, que en diagonales es parte de la medida ("7.50-16").
        regexp_replace(
          -- La coma solo entre dígitos: "295/80R22.5, gemela" no pierde la
          -- coma de separación.
          regexp_replace(
            -- Espacios pegados a la barra y a la R: son de dentro.
            regexp_replace(
              regexp_replace(
                upper(btrim(regexp_replace(p, '\s+', ' ', 'g'))),
                '([0-9]) */ *([0-9])', '\1/\2', 'g'),
              '([0-9]) *R *([0-9])', '\1R\2', 'g'),
            '([0-9]),([0-9])', '\1.\2', 'g'),
          '(R[0-9]{1,2})-([0-9])', '\1.\2', 'g'),
        -- Y por si quedó un espacio antes del sufijo, uno solo.
        ' +', ' ', 'g')
  end
$$;

comment on function tc_medida_normalizada(text) is
  'Forma canónica de una medida: mayúsculas, sin espacios y coma decimal a '
  'punto. Conserva todo lo demás (a diferencia de tc_medida_base, que extrae '
  'solo la medida base para comparar compatibilidades).';

-- ── 2. Catálogo: una fila por medida ────────────────────────────────────────
--
-- El catálogo tiene unique(valor), así que las variantes conviven como filas
-- distintas y los desplegables las ofrecen todas. Se elige una superviviente
-- por medida normalizada —la que ya estuviera bien escrita, y si no la más
-- antigua—, se reapunta lo que colgaba de las demás y se borran.
do $$
declare r record; n_mov int := 0; n_del int := 0;
begin
  for r in
    select tc_medida_normalizada(valor) as canon,
           -- Superviviente: la que ya esté en forma canónica; si ninguna,
           -- la más antigua, que es la que más referencias suele tener.
           (array_agg(id order by (valor = tc_medida_normalizada(valor)) desc, created_at, id))[1] as se_queda,
           array_agg(id) as todas
      from tc_cat_medidas_neumatico
     where tc_medida_normalizada(valor) is not null
     group by tc_medida_normalizada(valor)
    having count(*) > 1
  loop
    -- Vehículos y ejes: reapuntar es suficiente, no hay unicidad que rompa.
    update tc_vehiculos      set medida_id = r.se_queda
     where medida_id = any(r.todas) and medida_id <> r.se_queda;
    update tc_vehiculo_ejes  set medida_id = r.se_queda
     where medida_id = any(r.todas) and medida_id <> r.se_queda;
    update tyre_sizes        set medida_id = r.se_queda
     where medida_id = any(r.todas) and medida_id <> r.se_queda;

    -- Compatibilidad medida↔tipo: unique(medida_id, tipo_vehiculo_id). Si el
    -- tipo ya está enlazado con la superviviente, la fila duplicada sobra;
    -- reapuntarla daría error de clave única.
    delete from tc_medidas_tipo_vehiculo d
     where d.medida_id = any(r.todas) and d.medida_id <> r.se_queda
       and exists (select 1 from tc_medidas_tipo_vehiculo x
                    where x.medida_id = r.se_queda and x.tipo_vehiculo_id = d.tipo_vehiculo_id);
    update tc_medidas_tipo_vehiculo set medida_id = r.se_queda
     where medida_id = any(r.todas) and medida_id <> r.se_queda;

    delete from tc_cat_medidas_neumatico
     where id = any(r.todas) and id <> r.se_queda;

    n_mov := n_mov + 1;
    n_del := n_del + array_length(r.todas, 1) - 1;
  end loop;
  raise notice 'Catálogo: % medidas estaban duplicadas, % filas sobrantes retiradas', n_mov, n_del;
end $$;

-- Y ahora el valor de las que quedan. Se hace después de deduplicar: al revés,
-- el update chocaría contra unique(valor).
update tc_cat_medidas_neumatico
   set valor = tc_medida_normalizada(valor)
 where valor is distinct from tc_medida_normalizada(valor)
   and tc_medida_normalizada(valor) is not null;

-- ── 3. El texto ya guardado ─────────────────────────────────────────────────
update tc_neumaticos
   set medida = tc_medida_normalizada(medida)
 where medida is distinct from tc_medida_normalizada(medida);

update productos_neumaticos
   set medida = tc_medida_normalizada(medida)
 where medida is distinct from tc_medida_normalizada(medida);

update tc_fichas_genericas_neumaticos
   set medida = tc_medida_normalizada(medida)
 where medida is distinct from tc_medida_normalizada(medida);

update tyre_sizes
   set medida = tc_medida_normalizada(medida)
 where medida is distinct from tc_medida_normalizada(medida)
   and tc_medida_normalizada(medida) is not null;  -- medida es not null aquí

-- ── 4. Que no vuelva a pasar ────────────────────────────────────────────────
--
-- Limpiar una vez no sirve de nada si mañana entra otra variante. El
-- disparador es el único sitio por el que pasan todos los caminos: el
-- importador de Excel, el panel, la APK y cualquier insert a mano.
create or replace function tc_normalizar_medida_trg()
returns trigger language plpgsql as $$
begin
  new.medida := tc_medida_normalizada(new.medida);
  return new;
end $$;

create or replace function tc_normalizar_medida_valor_trg()
returns trigger language plpgsql as $$
begin
  new.valor := coalesce(tc_medida_normalizada(new.valor), new.valor);
  return new;
end $$;

drop trigger if exists trg_tc_neumaticos_medida on tc_neumaticos;
create trigger trg_tc_neumaticos_medida
  before insert or update of medida on tc_neumaticos
  for each row execute function tc_normalizar_medida_trg();

drop trigger if exists trg_productos_neumaticos_medida on productos_neumaticos;
create trigger trg_productos_neumaticos_medida
  before insert or update of medida on productos_neumaticos
  for each row execute function tc_normalizar_medida_trg();

drop trigger if exists trg_fichas_genericas_medida on tc_fichas_genericas_neumaticos;
create trigger trg_fichas_genericas_medida
  before insert or update of medida on tc_fichas_genericas_neumaticos
  for each row execute function tc_normalizar_medida_trg();

-- En el catálogo se usa coalesce: si alguien mete un valor que no parece una
-- medida, se queda como está en vez de convertirse en null y romper el
-- not null.
drop trigger if exists trg_cat_medidas_valor on tc_cat_medidas_neumatico;
create trigger trg_cat_medidas_valor
  before insert or update of valor on tc_cat_medidas_neumatico
  for each row execute function tc_normalizar_medida_valor_trg();

-- ── 5. Comprobación ─────────────────────────────────────────────────────────
do $$
declare
  n_cat int; n_neu int; n_prod int; n_dup int; n_sin int;
begin
  select count(*) into n_cat  from tc_cat_medidas_neumatico
   where valor is distinct from tc_medida_normalizada(valor)
     and tc_medida_normalizada(valor) is not null;
  select count(*) into n_neu  from tc_neumaticos
   where medida is distinct from tc_medida_normalizada(medida);
  select count(*) into n_prod from productos_neumaticos
   where medida is distinct from tc_medida_normalizada(medida);

  if n_cat + n_neu + n_prod > 0 then
    raise exception 'Quedan sin normalizar: % en el catálogo, % neumáticos, % productos',
      n_cat, n_neu, n_prod;
  end if;

  -- Lo que de verdad arregla el informe: que no queden dos filas del catálogo
  -- que sean la misma medida.
  select count(*) into n_dup from (
    select tc_medida_normalizada(valor) from tc_cat_medidas_neumatico
     where tc_medida_normalizada(valor) is not null
     group by 1 having count(*) > 1) x;
  if n_dup > 0 then
    raise exception 'El catálogo aún tiene % medidas duplicadas', n_dup;
  end if;

  -- Esto no lo arregla la normalización: son gomas a las que nadie apuntó la
  -- medida. Se avisa para que se vea, no para que falle.
  select count(*) into n_sin from tc_neumaticos where medida is null and activo;
  if n_sin > 0 then
    raise warning 'Hay % neumáticos activos sin medida: eso sale en el informe como "Sin registrar"', n_sin;
  end if;

  raise notice 'OK: una medida, una sola forma de escribirla (catálogo, neumáticos, productos y fichas genéricas)';
end $$;
