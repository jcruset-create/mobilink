-- ============================================================
-- Mobilink TyreControl — Una marca, una sola forma de escribirla
--
-- En el informe de inventario la misma marca sale repartida en varias filas:
--
--   INSA · 385/55R22.5   237        HANKOOK   3362
--   Insa · 385/55R22.5     9        Hankook      6
--   INSA · 385/65R22.5    58
--   Insa · 385/65R22.5    10
--
-- Es la misma marca escrita con otras mayúsculas. tc_neumaticos.marca es
-- texto libre y el informe agrupa por él, así que cada forma hace su fila:
-- los totales por marca no valen y el catálogo ofrece la marca dos veces en
-- los desplegables.
--
-- Lo que hace esta migración:
--
--   1. tc_marca_normalizada(): la forma buena de escribir una marca, que es
--      la que tenga el catálogo tc_cat_marcas_neumatico.
--   2. Deja el catálogo con una sola fila por marca, quedándose con la grafía
--      MÁS USADA y llevándose los modelos de las que se retiran.
--   3. Normaliza el texto ya guardado en tc_neumaticos,
--      productos_neumaticos y tc_fichas_genericas_neumaticos.
--   4. Disparadores para que no vuelva a pasar.
--
-- QUÉ **NO** HACE, a propósito:
--
--   · No corrige erratas. "DUMLOP", "MICHELLIN" y "OMIROYAL" son marcas mal
--     escritas, no otra forma de escribir la buena, y decidir que DUMLOP es
--     Dunlop es una corrección de datos del cliente, no una normalización.
--     Al final se listan para que se arreglen a mano.
--   · No junta "INSA" con "INSATURBO": son dos nombres distintos y solo el
--     cliente sabe si son la misma marca.
--   · No toca tc_vehiculos.marca, que es la marca del CAMIÓN (Mercedes, MAN),
--     otro catálogo y otro asunto.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- ── 1. Marcadores de "aquí no hay marca" ────────────────────────────────────
--
-- El informe enseña una marca "0" con 10 unidades: es lo que dejó una
-- plantilla de Excel con ceros en las casillas vacías. Un cero no es una
-- marca; vale más un hueco honrado que un dato inventado.
create or replace function tc_marca_es_vacia(p text)
returns boolean language sql immutable as $$
  select p is null
      or btrim(p) = ''
      or upper(btrim(p)) in ('0', '-', '--', 'N/A', 'NA', 'SIN MARCA', 'SINMARCA', 'NULL')
$$;

-- ── 2. La forma buena ───────────────────────────────────────────────────────
--
-- Manda el catálogo: si "insa" está en tc_cat_marcas_neumatico como "INSA",
-- la forma buena es "INSA". Y si la marca no está en el catálogo se deja tal
-- cual, sin inventarle mayúsculas: el paso 3 se encarga de que el catálogo
-- tenga una sola grafía de cada una, así que a partir de ahí todas casan.
--
-- Es stable, no immutable: lee una tabla. No sirve para un índice, sí para
-- disparadores y updates, que es donde se usa.
create or replace function tc_marca_normalizada(p text)
returns text language plpgsql stable as $$
declare t text; v text;
begin
  if tc_marca_es_vacia(p) then return null; end if;
  t := btrim(regexp_replace(p, '\s+', ' ', 'g'));
  select nombre into v from tc_cat_marcas_neumatico
   where upper(nombre) = upper(t)
   order by activo desc, created_at, id
   limit 1;
  return coalesce(v, t);
end $$;

comment on function tc_marca_normalizada(text) is
  'La grafía que tenga el catálogo para esa marca (comparando sin distinguir '
  'mayúsculas). Si no está en el catálogo, la devuelve tal cual. No corrige '
  'erratas: "DUMLOP" sigue siendo "DUMLOP".';

-- ── 3. Catálogo: una fila por marca ─────────────────────────────────────────
--
-- ¿Qué grafía se queda? La MÁS USADA en las fichas de neumático. Es el
-- criterio menos sorprendente: si 3362 gomas dicen "HANKOOK" y 6 dicen
-- "Hankook", la de la casa es "HANKOOK". Y es determinista, así que ejecutar
-- esto dos veces da lo mismo. A igualdad de uso gana la más antigua.
do $$
declare r record; n_grupos int := 0; n_del int := 0;
begin
  for r in
    -- Cuántas fichas usan EXACTAMENTE esa grafía. La que más, se queda.
    with candidatas as (
      select c.id, c.nombre, c.created_at,
             (select count(*) from tc_neumaticos t where btrim(t.marca) = c.nombre) as usos
        from tc_cat_marcas_neumatico c)
    select upper(nombre) as clave,
           (array_agg(id order by usos desc, created_at, id))[1] as se_queda,
           array_agg(id) as todas
      from candidatas
     group by upper(nombre)
    having count(*) > 1
  loop
    -- Los modelos cuelgan de la marca y tienen unique(marca_id, nombre): si
    -- la superviviente ya tiene ese modelo, el duplicado sobra.
    delete from tc_cat_modelos_neumatico d
     where d.marca_id = any(r.todas) and d.marca_id <> r.se_queda
       and exists (select 1 from tc_cat_modelos_neumatico x
                    where x.marca_id = r.se_queda and x.nombre = d.nombre);
    update tc_cat_modelos_neumatico set marca_id = r.se_queda
     where marca_id = any(r.todas) and marca_id <> r.se_queda;

    delete from tc_cat_marcas_neumatico
     where id = any(r.todas) and id <> r.se_queda;

    n_grupos := n_grupos + 1;
    n_del := n_del + array_length(r.todas, 1) - 1;
  end loop;
  raise notice 'Catálogo: % marcas estaban repetidas con otras mayúsculas, % filas retiradas', n_grupos, n_del;
end $$;

-- ── 4. El texto ya guardado ─────────────────────────────────────────────────
update tc_neumaticos
   set marca = tc_marca_normalizada(marca)
 where marca is distinct from tc_marca_normalizada(marca);

update productos_neumaticos
   set marca = tc_marca_normalizada(marca)
 where marca is distinct from tc_marca_normalizada(marca);

update tc_fichas_genericas_neumaticos
   set marca = tc_marca_normalizada(marca)
 where marca is distinct from tc_marca_normalizada(marca);

-- ── 5. Que no vuelva a pasar ────────────────────────────────────────────────
create or replace function tc_normalizar_marca_trg()
returns trigger language plpgsql as $$
begin
  new.marca := tc_marca_normalizada(new.marca);
  return new;
end $$;

drop trigger if exists trg_tc_neumaticos_marca on tc_neumaticos;
create trigger trg_tc_neumaticos_marca
  before insert or update of marca on tc_neumaticos
  for each row execute function tc_normalizar_marca_trg();

drop trigger if exists trg_productos_neumaticos_marca on productos_neumaticos;
create trigger trg_productos_neumaticos_marca
  before insert or update of marca on productos_neumaticos
  for each row execute function tc_normalizar_marca_trg();

drop trigger if exists trg_fichas_genericas_marca on tc_fichas_genericas_neumaticos;
create trigger trg_fichas_genericas_marca
  before insert or update of marca on tc_fichas_genericas_neumaticos
  for each row execute function tc_normalizar_marca_trg();

-- El catálogo también: sin esto, alguien crea "hankook" desde el panel y
-- vuelven a existir dos.
create or replace function tc_normalizar_marca_cat_trg()
returns trigger language plpgsql as $$
declare v text;
begin
  new.nombre := btrim(regexp_replace(new.nombre, '\s+', ' ', 'g'));
  select nombre into v from tc_cat_marcas_neumatico
   where upper(nombre) = upper(new.nombre) and id <> new.id
   order by activo desc, created_at, id limit 1;
  -- Ya existe con otras mayúsculas: se adopta la que hay en vez de crear una
  -- gemela. El unique(nombre) hará el resto y el insert fallará limpiamente
  -- en vez de ensuciar el catálogo.
  if v is not null then new.nombre := v; end if;
  return new;
end $$;

drop trigger if exists trg_cat_marcas_nombre on tc_cat_marcas_neumatico;
create trigger trg_cat_marcas_nombre
  before insert or update of nombre on tc_cat_marcas_neumatico
  for each row execute function tc_normalizar_marca_cat_trg();

-- ── 6. Comprobación y lista de lo que hay que mirar a mano ──────────────────
do $$
declare n_dup int; n_pend int; n_cero int; r record; lista text := '';
begin
  select count(*) into n_dup from (
    select upper(nombre) from tc_cat_marcas_neumatico group by 1 having count(*) > 1) x;
  if n_dup > 0 then
    raise exception 'El catálogo aún tiene % marcas repetidas', n_dup;
  end if;

  select count(*) into n_pend from tc_neumaticos
   where marca is distinct from tc_marca_normalizada(marca);
  if n_pend > 0 then
    raise exception 'Quedan % neumáticos con la marca sin normalizar', n_pend;
  end if;

  select count(*) into n_cero from tc_neumaticos where marca is null and activo;
  if n_cero > 0 then
    raise warning 'Hay % neumáticos activos sin marca (algunos eran el "0" de la plantilla de Excel)', n_cero;
  end if;

  -- Erratas y modelos metidos en la casilla de la marca: esto NO lo puede
  -- decidir una migración. Se listan las marcas raras (una sola ficha) para
  -- que alguien las mire.
  for r in
    select marca, count(*) as n from tc_neumaticos
     where marca is not null group by marca having count(*) <= 2
     order by count(*), marca limit 25
  loop
    lista := lista || r.marca || ' (' || r.n || ')  ';
  end loop;
  if lista <> '' then
    raise warning 'Marcas con 1 o 2 fichas, revisar a mano (erratas o modelos en la casilla de la marca): %', lista;
  end if;

  raise notice 'OK: una marca, una sola forma de escribirla';
end $$;
