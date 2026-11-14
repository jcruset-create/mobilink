-- ===========================================================================
-- Tacógrafo · fase 5: las propuestas de medida, resolubles
--
-- Tercera y última migración de la integración. Las dos anteriores
-- (tyrecontrol_tacografo.sql y tyrecontrol_tacografo_lotes.sql) ya están
-- aplicadas en producción, así que esto NO las modifica: añade lo que le
-- faltaba a `tc_tacografo_medida_propuesta` para poder resolverse desde una
-- pantalla.
--
-- Es idempotente: todo va con `if not exists` o con `drop ... if exists`
-- delante. Pasarla dos veces no cambia nada la segunda.
--
-- Lo que NO toca, aquí ni en ninguna de las tres: tc_montajes_actuales,
-- tc_neumaticos, tc_vehiculo_ejes, config_ejes_id y tc_vehiculos.km_actual.
-- Aceptar una propuesta escribe `tc_vehiculos.medida_id` y nada más.
-- ===========================================================================

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · `segura_para_bloque`: lo único del cálculo que no se puede rehacer
--
-- Una propuesta entra en una confirmación en bloque solo si es una
-- coincidencia segura: vehículo enlazado, sin medida previa que pisar y
-- SIN NINGÚN AVISO en las filas de ese vehículo (bastidor que no cuadra,
-- medida que no se sabe leer, fila sin fecha).
--
-- Las dos primeras condiciones se pueden deducir de la fila guardada
-- (`vehiculo_id` y `caso = 'sin_medida'`). La tercera no: sale del fichero,
-- y el fichero no está cuando alguien abre la pantalla tres semanas después.
-- Si se recalculara sin esa parte, en el «aceptar todo» entrarían propuestas
-- de vehículos cuyo bastidor no coincide con el del informe, que es
-- exactamente lo que el acuerdo excluía.
--
-- Por defecto `false`: una propuesta de antes de esta columna no se sabe si
-- era segura, y lo que no se sabe no entra en un botón que acepta de golpe.
-- ───────────────────────────────────────────────────────────────────────────
alter table tc_tacografo_medida_propuesta
  add column if not exists segura_para_bloque boolean not null default false;

comment on column tc_tacografo_medida_propuesta.segura_para_bloque is
  'Si la propuesta puede entrar en una confirmación múltiple: vehículo vinculado, sin medida previa y sin ningún aviso en las filas del informe. Se calcula al importar, cuando el fichero está delante.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · Qué se escribió al aceptar, para poder deshacerlo
--
-- Sin esto, una propuesta aceptada deja el vehículo con una medida y ninguna
-- forma de saber cuál tenía antes. `medida_actual_id` guarda lo que había
-- cuando se CREÓ la propuesta, que es contra lo que se comparó; estas dos
-- guardan lo que se escribió y cuándo, que es otra cosa.
-- ───────────────────────────────────────────────────────────────────────────
alter table tc_tacografo_medida_propuesta
  add column if not exists medida_aplicada_id uuid
    references tc_cat_medidas_neumatico(id) on delete set null,
  add column if not exists medida_aplicada    text,
  -- `false` cuando se ha aceptado quitando el marcado: el tacógrafo decía
  -- 225/75R16C y se guardó 225/75R16, que es como lo escribe el catálogo.
  add column if not exists aplicada_exacta    boolean;

comment on column tc_tacografo_medida_propuesta.medida_aplicada_id is
  'La entrada del catálogo que se escribió en tc_vehiculos.medida_id al aceptar. Null si no se ha aceptado.';
comment on column tc_tacografo_medida_propuesta.aplicada_exacta is
  'false si se aceptó sin el marcado de carga (225/75R16C guardado como 225/75R16, que es como lo escribe el catálogo).';

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · Índice para la pantalla
--
-- La pantalla pide «las pendientes de esta empresa, por caso». El índice de
-- la primera migración ya cubre (empresa_id, estado); éste añade el caso,
-- que es por lo que se filtra y se agrupa.
-- ───────────────────────────────────────────────────────────────────────────
create index if not exists idx_tcg_prop_empresa_caso
  on tc_tacografo_medida_propuesta (empresa_id, estado, caso);

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · Que `resuelto_en` no se quede a medias
--
-- Una propuesta resuelta sin fecha de resolución no se puede ordenar ni
-- auditar, y es el tipo de hueco que no se descubre hasta que hace falta.
-- Se rellena en el propio `update`, pero el trigger lo garantiza también
-- para cualquier otra vía.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function tcg_propuesta_resuelta() returns trigger as $$
begin
  if new.estado <> 'pendiente' and new.resuelto_en is null then
    new.resuelto_en := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tcg_prop_resuelta on tc_tacografo_medida_propuesta;
create trigger trg_tcg_prop_resuelta
  before insert or update on tc_tacografo_medida_propuesta
  for each row execute function tcg_propuesta_resuelta();

commit;

-- ===========================================================================
-- Comprobaciones de después (para pegar en el editor, leen y no escriben)
--
--   select count(*) from information_schema.columns
--    where table_name = 'tc_tacografo_medida_propuesta'
--      and column_name in ('segura_para_bloque','medida_aplicada_id',
--                          'medida_aplicada','aplicada_exacta');
--   -- esperado: 4
--
--   select count(*) from pg_trigger where tgname = 'trg_tcg_prop_resuelta';
--   -- esperado: 1
--
--   select count(*) from pg_indexes
--    where indexname = 'idx_tcg_prop_empresa_caso';
--   -- esperado: 1
--
--   select count(*) from tc_tacografo_medida_propuesta;
--   -- esperado: lo que hubiera antes, sin cambios
-- ===========================================================================
