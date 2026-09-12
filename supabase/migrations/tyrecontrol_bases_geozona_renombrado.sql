-- ============================================================
-- SEA TyreControl — La geo-zona de las bases deja de llamarse «webfleet».
--
-- Las columnas nacieron en la fase 0 de Webfleet, cuando el único proveedor
-- que daba posiciones era Webfleet. Ya no: la presencia en bases la calcula el
-- Integration Hub con el proveedor que tenga cada cliente (Movertis hoy), y un
-- cliente sin Webfleet configurando su base en `webfleet_lat` es una fuente de
-- confusión permanente. El dato no es de Webfleet: es de la base.
--
--   webfleet_lat           → base_lat
--   webfleet_lng           → base_lng
--   webfleet_radio_m       → base_radio_m
--   webfleet_genera_avisos → base_genera_avisos
--   webfleet_zona_nombre   → zona_externa_nombre
--
-- `webfleet_zona_nombre` no pasa a `base_...` porque ese SÍ es de Webfleet: es
-- el nombre que la zona tiene en su plataforma, un dato de referencia externo.
-- Se queda con un nombre que dice eso y no ata a un proveedor.
--
-- ── Qué se ha actualizado con esto ──────────────────────────────────────────
--
-- Todo lo que las leía, y son pocos sitios: `server/webfleetSync.ts` (solo los
-- nombres, ninguna lógica), el formulario de delegaciones y el tipo del panel
-- (`src/modules/tyrecontrol/`). No las lee ninguna app Flutter, así que no hay
-- APK instalada que se quede a medias. Lo único que nota el cambio es una
-- pestaña del panel abierta desde antes del despliegue: se arregla recargando.
--
-- Idempotente y sin pérdida: renombra si existe el nombre viejo y no el nuevo,
-- y si no existe ninguno, crea el nuevo. Los datos viajan con el renombrado,
-- que en PostgreSQL no toca las filas.
-- ============================================================

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('webfleet_lat',           'base_lat',            'numeric'),
      ('webfleet_lng',           'base_lng',            'numeric'),
      ('webfleet_radio_m',       'base_radio_m',        'int'),
      ('webfleet_genera_avisos', 'base_genera_avisos',  'boolean'),
      ('webfleet_zona_nombre',   'zona_externa_nombre', 'text')
    ) as t(viejo, nuevo, tipo)
  loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tc_delegaciones'
         and column_name = r.nuevo
    ) then
      raise notice 'tc_delegaciones.% ya existe: nada que renombrar', r.nuevo;
      continue;
    end if;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'tc_delegaciones'
         and column_name = r.viejo
    ) then
      execute format('alter table tc_delegaciones rename column %I to %I', r.viejo, r.nuevo);
      raise notice 'tc_delegaciones.% → %', r.viejo, r.nuevo;
    else
      execute format('alter table tc_delegaciones add column %I %s', r.nuevo, r.tipo);
      raise notice 'tc_delegaciones.% creada (no existía la vieja)', r.nuevo;
    end if;
  end loop;
end $$;

-- Los defaults y el not null que tenían las viejas, por si la columna se acaba
-- de crear en una base que nunca pasó por la fase 0 de Webfleet.
alter table tc_delegaciones alter column base_radio_m set default 300;
update tc_delegaciones set base_genera_avisos = true where base_genera_avisos is null;
alter table tc_delegaciones alter column base_genera_avisos set default true;
alter table tc_delegaciones alter column base_genera_avisos set not null;

comment on column tc_delegaciones.base_lat is
  'Centro de la geo-zona de la base (lat). Con base_lng y base_radio_m define dónde está un vehículo "en base". Lo lee cualquier proveedor de telemática, no solo Webfleet.';
comment on column tc_delegaciones.base_radio_m is
  'Radio de la geo-zona en metros. 300 por defecto.';
comment on column tc_delegaciones.zona_externa_nombre is
  'Nombre de la zona en la plataforma del proveedor, como referencia. No se usa para calcular nada.';

-- Comprobación.
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'tc_delegaciones'
   and (column_name like 'base_%' or column_name like 'webfleet_%' or column_name = 'zona_externa_nombre')
 order by column_name;
