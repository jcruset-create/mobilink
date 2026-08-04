-- ============================================================
-- Mobilink TyreControl — La profundidad informada a mano deja de perderse
--
-- SÍNTOMA: se reescultura una rueda y se teclean los 8 mm, o se monta un
-- usado con su profundidad real, y la tarjeta sigue enseñando los mm de
-- antes.
--
-- CAUSA: la app pinta `última medición de revisión ?? profundidad del
-- neumático`. La medición GANA siempre. Al reesculturar, el neumático
-- conserva su id, así que la medición vieja (4.7 mm) tapa para siempre la
-- nueva profundidad (8 mm) que sí está guardada en tc_neumaticos.
--
-- Para decidir cuál de los dos datos es el bueno hace falta saber CUÁNDO se
-- fijó la profundidad del neumático. `updated_at` no sirve: una permuta lo
-- toca sin cambiar la profundidad, y entonces se descartaría una medición
-- buena y la rueda volvería al valor de catálogo.
--
-- SOLUCIÓN: una columna propia, mantenida por un TRIGGER. Así se cubren
-- todos los caminos (plan de trabajo, montaje desde almacén, montaje desde
-- catálogo, deshacer, ediciones desde el panel) sin reescribir un solo RPC,
-- que es donde estaría el riesgo de romper algo.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

alter table tc_neumaticos
  add column if not exists profundidad_actualizada_en timestamptz;

comment on column tc_neumaticos.profundidad_actualizada_en is
  'Cuándo se fijó profundidad_actual_mm por última vez. La app compara esta '
  'fecha con la de la última medición de revisión para saber cuál manda.';

-- El trigger es la única fuente de verdad de esta columna: nadie tiene que
-- acordarse de ponerla al día en cada RPC.
create or replace function tc_marcar_profundidad_actualizada()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.profundidad_actual_mm is not null then
      new.profundidad_actualizada_en := coalesce(new.profundidad_actualizada_en, now());
    end if;
  elsif new.profundidad_actual_mm is distinct from old.profundidad_actual_mm then
    new.profundidad_actualizada_en := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_tc_profundidad_actualizada on tc_neumaticos;
create trigger trg_tc_profundidad_actualizada
  before insert or update on tc_neumaticos
  for each row execute function tc_marcar_profundidad_actualizada();

-- Relleno para lo que ya existe. Se usa updated_at como aproximación: es lo
-- único que hay. Para las ruedas ya reesculturadas es lo correcto (el último
-- cambio fue justamente ese); para el resto da igual, porque si la medición
-- es posterior seguirá ganando ella.
update tc_neumaticos
   set profundidad_actualizada_en = updated_at
 where profundidad_actual_mm is not null
   and profundidad_actualizada_en is null;

-- ============================================================
-- Limpieza: sobrecargas viejas de tc_montar_desde_almacen
--
-- Hay tres firmas conviviendo en la base de datos, de migraciones sucesivas
-- que añadían parámetros. Postgres NO las sustituye entre sí: crea una
-- función distinta por cada lista de tipos.
--
--   8 args  (…, p_obs)                       ← fase8 / fase12
--   9 args  (…, p_obs, p_forzar_medida)      ← fase14 / fase27
--  10 args  (…, p_forzar_medida, p_condicion) ← stock_usado  ← la buena
--
-- Hoy no molesta porque la APK y el panel llaman con los 10 parámetros y
-- PostgREST resuelve por nombre. Pero es una trampa esperando: el día que
-- alguien quite `p_condicion` de una llamada, entraría por una de las
-- viejas, que NO guarda la profundidad del usado y NO descuenta el stock, y
-- el fallo sería silencioso.
--
-- Solo se conserva la de 10 argumentos, que es superconjunto de las otras.
-- Comprobado antes de borrar: ni la app (supabase_service.dart) ni el panel
-- (data.ts) usan otra.
-- ============================================================

drop function if exists tc_montar_desde_almacen(uuid, uuid, uuid, boolean, jsonb, numeric, date, text);
drop function if exists tc_montar_desde_almacen(uuid, uuid, uuid, boolean, jsonb, numeric, date, text, boolean);

-- Comprobación: debe quedar exactamente una.
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'tc_montar_desde_almacen';
  if n <> 1 then
    raise warning 'Quedan % versiones de tc_montar_desde_almacen (se esperaba 1)', n;
  end if;
end $$;
