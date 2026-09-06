-- ============================================================
-- Mobilink TyreControl — El plano del vehículo lleva margen
--
-- EL PROBLEMA
--
-- Las coordenadas de cada posición (pos_x/y/w/h, en % de 0 a 100) eran
-- porcentajes de la IMAGEN del chasis, y la imagen ocupaba todo el área. En
-- las fotos de Mobilink las ruedas exteriores llegan al filo, así que los
-- recuadros de esas posiciones no cabían al lado de la rueda: quedaban encima
-- o se salían del área.
--
-- LA REGLA A PARTIR DE AHORA
--
-- Las coordenadas son porcentajes del PLANO, que es la imagen más un margen
-- fijo a cada lado (12 % a izquierda y derecha, 4 % arriba y abajo, ver
-- shared/planoMargen.ts y tyrecontrol_app/lib/widgets/plano_margen.dart). El
-- panel, la tablet y el PDF del parte dibujan la imagen más pequeña dentro
-- del plano, y un recuadro puede quedar fuera de la foto sin salirse del
-- área.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- Convierte UNA VEZ las coordenadas ya calibradas al nuevo espacio, para que
-- los recuadros sigan cayendo exactamente sobre la misma rueda que hoy:
--
--     x' = 12 + x · 0,76      w' = w · 0,76
--     y' =  4 + y · 0,92      h' = h · 0,92
--
-- Después, el que calibra solo tiene que arrastrar hacia fuera las posiciones
-- exteriores que lo necesiten.
--
-- La columna coords_con_margen marca las filas ya convertidas: la migración
-- es idempotente y una fila no se convierte dos veces. Las posiciones nuevas
-- nacen ya en el espacio con margen (default true).
-- ============================================================

alter table tc_posiciones_vehiculo
  add column if not exists coords_con_margen boolean;

update tc_posiciones_vehiculo
   set pos_x = case when pos_x is null then null else 12 + pos_x * 0.76 end,
       pos_w = case when pos_w is null then null else pos_w * 0.76 end,
       pos_y = case when pos_y is null then null else 4 + pos_y * 0.92 end,
       pos_h = case when pos_h is null then null else pos_h * 0.92 end,
       coords_con_margen = true
 where coords_con_margen is null;

alter table tc_posiciones_vehiculo
  alter column coords_con_margen set default true;

comment on column tc_posiciones_vehiculo.pos_x is
  'Posición del recuadro del neumático en % (0-100) del PLANO: la imagen del chasis más un margen fijo (12 % a cada lado, 4 % arriba y abajo). Calibrado a mano desde el panel.';
comment on column tc_posiciones_vehiculo.coords_con_margen is
  'true: pos_x/y/w/h ya están en el espacio del plano con margen. Lo pone la migración tyrecontrol_plano_con_margen.sql y el default para las filas nuevas.';

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from tc_posiciones_vehiculo where coords_con_margen is null) then
    raise exception 'Quedan posiciones sin convertir al plano con margen';
  end if;
  raise notice 'OK: coordenadas de posiciones en el espacio del plano con margen.';
end $$;
