-- ============================================================
-- SEA TyreControl - Falta la columna orden_revision en las posiciones.
--
-- La app la escribe desde hace tiempo (calibrar plano -> "Orden de revision
-- (tablet)"), pero la columna nunca llego a crearse: al guardar la
-- calibracion Supabase devolvia 400 "Could not find the 'orden_revision'
-- column of 'tc_posiciones_vehiculo' in the schema cache".
--
-- Es el numero en el que el tecnico revisa cada rueda (1, 2, 3...). Si esta
-- vacio se usa el recorrido por defecto.
-- ============================================================

alter table tc_posiciones_vehiculo add column if not exists orden_revision int;

comment on column tc_posiciones_vehiculo.orden_revision is
  'Orden en que el tecnico revisa esta rueda en la tablet. Null = recorrido por defecto.';
