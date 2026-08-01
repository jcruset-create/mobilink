-- Crea el tipo "Cabeza tractora 2 ejes" (hasta ahora solo existía la de 3
-- ejes con 10 posiciones) y reasigna el vehículo 1111ABC, que la ficha
-- técnica ya identificó correctamente como 2x4 (2 ejes).

insert into tc_tipos_vehiculo (nombre, descripcion, numero_ejes, numero_ruedas, configuracion_ejes, activo)
values ('tractora_2_ejes', 'Cabeza tractora 2 ejes', 2, 6, '2x4', true);

insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, nombre, eje, lado, interior_exterior, orden_visual, activo)
select
  (select id from tc_tipos_vehiculo where nombre = 'tractora_2_ejes'),
  codigo_posicion, nombre, eje, lado, interior_exterior, orden_visual, true
from tc_posiciones_vehiculo
where tipo_vehiculo_id = (select id from tc_tipos_vehiculo where nombre = 'tractora')
  and eje in (1, 2);

update tc_vehiculos
set tipo_vehiculo_id = (select id from tc_tipos_vehiculo where nombre = 'tractora_2_ejes')
where matricula = '1111ABC';
