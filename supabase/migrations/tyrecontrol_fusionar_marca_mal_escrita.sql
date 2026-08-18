-- ============================================================
-- Mobilink TyreControl — Fusionar una marca mal escrita en la buena
--
-- En el desplegable de marcas del catálogo conviven "Hankokk" y "Hankook".
-- La primera es una errata: no existe tal fabricante. Sus modelos quedan
-- colgando de una marca fantasma, así que buscar "Hankook" no los encuentra.
--
-- POR QUÉ NO LO ARREGLÓ LA NORMALIZACIÓN DE MARCAS
--
-- tyrecontrol_normalizar_marcas.sql unifica variantes de ESCRITURA de un mismo
-- nombre (mayúsculas, espacios, "Insa" vs "INSA") eligiendo la grafía más
-- usada. A propósito NO toca erratas: "Hankokk" y "Hankook" son dos cadenas
-- distintas, y adivinar que una es la otra por parecido sería peligroso —
-- fusionaría marcas que de verdad se parecen (Sailun/Sailong, Aeolus/Aelous).
-- Una errata la decide una persona, y esta la has decidido tú.
--
-- QUÉ HACE, para cada pareja de la lista de abajo:
--
--   1. Mueve los modelos de la marca mala a la buena. Si un modelo con ese
--      nombre YA existe en la buena (unique (marca_id, nombre)), NO se mueve:
--      se reapuntan sus referencias al modelo que ya estaba y el duplicado se
--      desactiva. Mover a ciegas reventaría el unique.
--   2. Corrige el texto libre de tc_neumaticos.marca, que no pasa por el
--      catálogo (lo escribe el importador y la APK).
--   3. Desactiva la marca mala. No se borra: el FK de modelos es on delete
--      cascade y un borrado se llevaría por delante lo que no se hubiera
--      podido mover.
--
-- Para añadir otra errata en el futuro, basta con otra fila en la lista.
--
-- Idempotente: al segundo pase la marca mala ya está vacía y desactivada.
-- ============================================================

do $$
declare
  r record; m record; v_mala uuid; v_buena uuid;
  v_movidos int := 0; v_fusionados int := 0; v_neus int := 0; v_marcas int := 0; v_n int;
begin
  for r in
    select * from (values
      ('Hankokk', 'Hankook')
    ) as t(mala, buena)
  loop
    select id into v_mala  from tc_cat_marcas_neumatico where lower(nombre) = lower(r.mala);
    select id into v_buena from tc_cat_marcas_neumatico where lower(nombre) = lower(r.buena);

    if v_mala is null then
      raise notice 'La marca "%" no existe: nada que fusionar', r.mala;
      continue;
    end if;
    if v_buena is null then
      raise warning 'La marca buena "%" no existe: NO se fusiona "%" para no dejarla huérfana', r.buena, r.mala;
      continue;
    end if;
    if v_mala = v_buena then
      continue;
    end if;

    -- 1. Los modelos, uno a uno: hay que mirar si el nombre ya está ocupado.
    for m in select id, nombre from tc_cat_modelos_neumatico where marca_id = v_mala loop
      if exists (select 1 from tc_cat_modelos_neumatico
                  where marca_id = v_buena and lower(nombre) = lower(m.nombre)) then
        -- Ya existe el mismo modelo en la marca buena: se reapunta lo que
        -- cuelgue del duplicado y este se retira.
        update tc_referencias_neumatico ref
           set modelo_id = (select id from tc_cat_modelos_neumatico
                             where marca_id = v_buena and lower(nombre) = lower(m.nombre) limit 1),
               updated_at = now()
         where ref.modelo_id = m.id
           -- Sin pisar una referencia que ya exista para el modelo bueno y la
           -- misma medida: el unique (modelo_id, tyre_size_id) lo impediría.
           and not exists (
             select 1 from tc_referencias_neumatico r2
              where r2.modelo_id = (select id from tc_cat_modelos_neumatico
                                     where marca_id = v_buena and lower(nombre) = lower(m.nombre) limit 1)
                and r2.tyre_size_id = ref.tyre_size_id);
        update tc_cat_modelos_neumatico set activo = false where id = m.id;
        v_fusionados := v_fusionados + 1;
      else
        update tc_cat_modelos_neumatico set marca_id = v_buena where id = m.id;
        v_movidos := v_movidos + 1;
      end if;
    end loop;

    -- 2. El texto libre de las fichas de neumático.
    update tc_neumaticos
       set marca = (select nombre from tc_cat_marcas_neumatico where id = v_buena), updated_at = now()
     where lower(trim(marca)) = lower(r.mala);
    get diagnostics v_n = row_count;   -- GET DIAGNOSTICS asigna, no acumula
    v_neus := v_neus + v_n;

    -- 3. La marca mala, fuera de los desplegables.
    update tc_cat_marcas_neumatico set activo = false where id = v_mala;
    v_marcas := v_marcas + 1;
  end loop;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if exists (select 1 from tc_cat_marcas_neumatico ma
               join tc_cat_modelos_neumatico mo on mo.marca_id = ma.id
              where not ma.activo and mo.activo) then
    raise exception 'Ha quedado algún modelo activo colgando de una marca desactivada';
  end if;

  if exists (select 1 from tc_neumaticos where lower(trim(marca)) = 'hankokk') then
    raise exception 'Quedan neumáticos con la marca mal escrita';
  end if;

  raise notice 'OK: % marca(s) fusionada(s); % modelos movidos, % fusionados con uno existente, % neumáticos corregidos',
    v_marcas, v_movidos, v_fusionados, v_neus;
end $$;
