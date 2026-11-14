-- El inventario inicial, como revisión de pleno derecho.
--
-- ── Lo que ya funcionaba ────────────────────────────────────────────────────
--
-- `tc_inventario_inicial_finalizar` ya dejaba la revisión en `completada`, así
-- que un inventario terminado YA salía en el Histórico de revisiones. Lo que
-- faltaba eran dos cosas, y la segunda es un fallo.
--
-- ── 1. No se distinguía de una revisión normal ──────────────────────────────
--
-- En la lista salía igual que cualquier otra, sin nada que dijera que era el
-- inventario de entrada. Ahora lleva `tipo_revision = 'inventario_inicial'`,
-- que es lo que la pantalla usa para etiquetarla.
--
-- Hay que ensanchar el CHECK de `tipo_revision`, que hasta ahora solo admitía
-- los dos tipos que pone la APK.
--
-- ── 2. El inventario se metía en el borrador de otro ────────────────────────
--
-- Las dos funciones buscaban «el último borrador de este vehículo», sin mirar
-- si era SUYO:
--
--     select id into v_revision from revisiones_vehiculo
--      where vehiculo_id = p_vehiculo and estado_revision = 'borrador'
--      order by created_at desc limit 1;
--
-- Mientras el vehículo era nuevo y no tenía ningún otro borrador, funcionaba
-- de casualidad. Pero un técnico que abre una revisión y no la cierra deja un
-- borrador ahí, y entonces el inventario escribe DENTRO de esa revisión ajena
-- y al finalizar la marca como completada. Pasó el 09/11 con el 0683MNS: el
-- inventario fue a parar a un borrador abierto dos minutos antes, que no
-- llevaba la etiqueta del inventario.
--
-- Y hay borradores sueltos de sobra: ese mismo día se quedaron tres abiertos
-- sin cerrar.
--
-- Ahora cada función busca solo el borrador DEL INVENTARIO, por su
-- `observaciones`. Si no lo hay, `posicion` crea el suyo (ya lo hacía) y
-- `finalizar` dice que no hay ninguno empezado, que es la verdad.
--
-- ── Cómo está escrita ───────────────────────────────────────────────────────
--
-- No se recrean las funciones enteras: se lee su definición viva, se comprueba
-- que el trozo a cambiar aparece EXACTAMENTE una vez y se sustituye. Volver a
-- escribir 10 KB de plpgsql a mano para cambiar una línea es la forma más
-- fácil de perder por el camino algo que alguien arregló y no está en el
-- repositorio. Si el trozo no aparece una sola vez, la migración falla y no
-- toca nada.

-- ── El tipo nuevo ───────────────────────────────────────────────────────────

alter table revisiones_vehiculo drop constraint if exists revisiones_vehiculo_tipo_revision_check;
alter table revisiones_vehiculo add constraint revisiones_vehiculo_tipo_revision_check
  check (tipo_revision = any (array[
    'solo_profundidades'::text,
    'profundidades_presiones'::text,
    'inventario_inicial'::text
  ]));

-- ── Las dos funciones ───────────────────────────────────────────────────────

do $migracion$
declare
  v_fn      text;
  v_def     text;
  v_nuevo   text;
  v_veces   int;
  -- El patrón tolera \r y espacios: la definición viva tiene finales de línea
  -- de Windows, de cuando alguien la pegó desde el navegador.
  v_patron  constant text :=
    'estado_revision = ''borrador''\s*\r?\n\s*order by created_at desc limit 1;';
  v_reemplazo constant text :=
    'estado_revision = ''borrador''' || chr(10) ||
    '     and observaciones = ''Inventario inicial del vehículo''' || chr(10) ||
    '   order by created_at desc limit 1;';
begin
  foreach v_fn in array array['tc_inventario_inicial_posicion', 'tc_inventario_inicial_finalizar']
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then
      raise exception 'No existe la función %', v_fn;
    end if;

    select count(*) into v_veces
      from regexp_matches(v_def, v_patron, 'g');
    -- Cero = ya se aplicó (el `order by` ya no va pegado al `borrador`). Es la
    -- comprobación de reentrada: esta migración se puede pegar dos veces.
    if v_veces = 0 then
      raise notice '% ya estaba arreglada, se deja', v_fn;
      continue;
    end if;
    if v_veces <> 1 then
      raise exception 'En % esperaba 1 aparición del borrador suelto y hay %', v_fn, v_veces;
    end if;

    v_nuevo := regexp_replace(v_def, v_patron, v_reemplazo);
    execute v_nuevo;
    raise notice '% arreglada', v_fn;
  end loop;
end
$migracion$;

-- ── Y que la revisión del inventario se etiquete al cerrarla ────────────────
--
-- Mismo método: una sustitución sobre la definición viva. El `update` que
-- cierra la revisión gana una línea.

do $migracion$
declare
  v_def   text;
  v_veces int;
  v_patron constant text := 'set estado_revision = ''completada'',';
  v_reemplazo constant text :=
    'set estado_revision = ''completada'',' || chr(10) ||
    '         tipo_revision = ''inventario_inicial'',';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tc_inventario_inicial_finalizar';

  if position('tipo_revision = ''inventario_inicial''' in v_def) > 0 then
    raise notice 'tc_inventario_inicial_finalizar ya etiquetaba, se deja';
    return;
  end if;

  select count(*) into v_veces from regexp_matches(v_def, v_patron, 'g');
  if v_veces <> 1 then
    raise exception 'Esperaba 1 aparición del update de cierre y hay %', v_veces;
  end if;

  execute replace(v_def, v_patron, v_reemplazo);
  raise notice 'tc_inventario_inicial_finalizar ahora etiqueta la revisión';
end
$migracion$;

-- ── Comprobación ────────────────────────────────────────────────────────────
--
-- Que las tres cosas están, dicho por la base y no por quien pega esto.

select
  (select position('and observaciones = ''Inventario inicial del vehículo''' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tc_inventario_inicial_posicion')  as posicion_usa_su_borrador,
  (select position('and observaciones = ''Inventario inicial del vehículo''' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tc_inventario_inicial_finalizar') as finalizar_usa_su_borrador,
  (select position('tipo_revision = ''inventario_inicial''' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tc_inventario_inicial_finalizar') as finalizar_etiqueta;
