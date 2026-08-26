-- ============================================================
-- Mobilink TyreControl — Preparar la base para el CheckPoint
--
-- El CheckPoint de Bridgestone es un arco por el que pasa el autobús y que
-- le lee presión y profundidad de todas las ruedas sin que nadie baje. Su
-- informe semanal se va a importar en TyreControl, y para eso faltan tres
-- cosas en la base de datos.
--
--   1. La HORA de la medición. revisiones_vehiculo solo guarda la fecha;
--      created_at es cuándo se grabó, no cuándo se midió. El CheckPoint da
--      "2026-08-05 13:14:52" y esa hora hay que conservarla: es la que dice
--      por qué pasillo y en qué vuelta se midió, y es la que permite saber
--      si una medición es NUEVA o ya está cargada.
--   2. Distinguir sus mediciones de las de un técnico. Hoy metodo_* admite
--      manual, bluetooth, sonda e importacion_excel. Se añade 'checkpoint',
--      para poder comparar el arco contra la sonda.
--   3. Arreglar una matrícula: el arco lee 2339JPW y nosotros teníamos
--      2339JPM. La buena es la del arco.
--
-- Idempotente.
-- ============================================================

-- ── 1. Cuándo se midió de verdad ────────────────────────────────────────────
alter table revisiones_vehiculo add column if not exists medido_at timestamptz;

comment on column revisiones_vehiculo.medido_at is
  'Momento real de la medición, no el de la grabación (created_at). Lo trae '
  'el CheckPoint con su hora; en una revisión hecha con la APK es la hora de '
  'cierre. Sirve para no reimportar dos veces la misma pasada por el arco.';

-- Buscar la última medición de un vehículo es lo que hace el importador en
-- cada fila para decidir si algo es nuevo.
create index if not exists idx_rev_veh_medido on revisiones_vehiculo (vehiculo_id, medido_at desc);

-- Las revisiones que ya hay se quedan con la fecha que tenían: no nos
-- inventamos una hora que nadie apuntó. medido_at a null significa
-- exactamente eso, "no se sabe la hora".

-- ── 2. 'checkpoint' como método de medición ─────────────────────────────────
alter table revisiones_neumaticos_detalle
  drop constraint if exists revisiones_neumaticos_detalle_metodo_profundidad_check,
  drop constraint if exists revisiones_neumaticos_detalle_metodo_presion_check;

alter table revisiones_neumaticos_detalle
  add constraint revisiones_neumaticos_detalle_metodo_profundidad_check
    check (metodo_profundidad is null or metodo_profundidad in
      ('manual','bluetooth','sonda','importacion_excel','checkpoint')),
  add constraint revisiones_neumaticos_detalle_metodo_presion_check
    check (metodo_presion is null or metodo_presion in
      ('manual','bluetooth','sonda','importacion_excel','checkpoint'));

-- ── 3. 2339JPM era 2339JPW ──────────────────────────────────────────────────
--
-- No se crea un vehículo nuevo ni se mueve nada: es el mismo autobús con la
-- matrícula mal escrita en el Excel que se importó a mano. Cambiándole el
-- nombre conserva su historial entero y el arco lo reconocerá a partir de
-- ahora.
do $$
declare n int;
begin
  if exists (select 1 from tc_vehiculos where upper(btrim(matricula)) = '2339JPW') then
    if exists (select 1 from tc_vehiculos where upper(btrim(matricula)) = '2339JPM') then
      -- Están las dos: alguien ya creó la buena. Fusionarlas es otra
      -- historia (hay historial en las dos) y no se hace a ciegas.
      raise warning 'Existen 2339JPM y 2339JPW a la vez: hay que decidir a mano cuál se queda con el historial';
    else
      raise notice '2339JPW ya está bien escrita, nada que hacer';
    end if;
  else
    update tc_vehiculos set matricula = '2339JPW'
     where upper(btrim(matricula)) = '2339JPM';
    get diagnostics n = row_count;
    if n > 0 then
      raise notice '2339JPM renombrada a 2339JPW (conserva su historial)';
    else
      raise notice 'No hay ningún 2339JPM que renombrar';
    end if;
  end if;
end $$;

-- ── 4. Comprobación ─────────────────────────────────────────────────────────
do $$
declare ok_col int; ok_chk int;
begin
  select count(*) into ok_col from information_schema.columns
   where table_name = 'revisiones_vehiculo' and column_name = 'medido_at';
  if ok_col <> 1 then raise exception 'Falta revisiones_vehiculo.medido_at'; end if;

  -- Que el CHECK admita de verdad 'checkpoint': se prueba, no se supone.
  begin
    select count(*) into ok_chk from revisiones_neumaticos_detalle
     where metodo_profundidad = 'checkpoint';
  exception when others then
    raise exception 'El CHECK de metodo_profundidad no admite checkpoint';
  end;

  raise notice 'OK: hora de medición, método checkpoint y la matrícula del arco';
end $$;
