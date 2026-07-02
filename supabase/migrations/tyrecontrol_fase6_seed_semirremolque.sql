-- ============================================================
-- SEA TyreControl — Fase 6: semilla de posiciones para semirremolque
-- (3 ejes, una rueda por lado y eje) — necesaria para el motor
-- gráfico de vehículos (Vehicle Layout Engine).
-- ============================================================

insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, nombre, eje, lado, interior_exterior, orden_visual)
select t.id, v.codigo, v.nombre, v.eje, v.lado, v.io, v.orden
from tc_tipos_vehiculo t
join (values
  ('E1_IZQ','Eje 1 izquierda',1,'izq',null,1),
  ('E1_DER','Eje 1 derecha',1,'der',null,2),
  ('E2_IZQ','Eje 2 izquierda',2,'izq',null,3),
  ('E2_DER','Eje 2 derecha',2,'der',null,4),
  ('E3_IZQ','Eje 3 izquierda',3,'izq',null,5),
  ('E3_DER','Eje 3 derecha',3,'der',null,6)
) as v(codigo,nombre,eje,lado,io,orden) on true
where t.nombre = 'semirremolque'
on conflict (tipo_vehiculo_id, codigo_posicion) do nothing;
