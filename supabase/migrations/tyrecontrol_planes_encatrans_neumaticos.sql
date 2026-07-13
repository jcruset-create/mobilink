-- ============================================================
-- SEA TyreControl — Alta masiva de plan "Revisión de neumáticos"
-- para todos los vehículos activos de ENCATRANS.
--   Frecuencia: cada 2 meses O cada 10.000 km (vence el primero).
--   Última revisión (fecha y km): la última inspección completada
--   del vehículo (la que aparece en la ficha).
-- Idempotente: no duplica si el vehículo ya tiene ese plan activo.
-- ============================================================

insert into tc_planes_mantenimiento
  (empresa_id, vehiculo_id, operacion_id, frecuencia_meses, frecuencia_km, ultima_fecha, ultima_km)
select
  v.empresa_id, v.id, op.id, 2, 10000,
  (select r.fecha_revision from revisiones_vehiculo r
     where r.vehiculo_id = v.id and r.estado_revision = 'completada'
     order by r.fecha_revision desc limit 1),
  (select r.km_vehiculo   from revisiones_vehiculo r
     where r.vehiculo_id = v.id and r.estado_revision = 'completada'
     order by r.fecha_revision desc limit 1)
from tc_vehiculos v
join tc_empresas e on e.id = v.empresa_id
cross join (select id from tc_operaciones_mantenimiento where nombre = 'Revisión de neumáticos' limit 1) op
where upper(e.nombre) = 'ENCATRANS'
  and v.activo
  and not exists (
    select 1 from tc_planes_mantenimiento pm
    where pm.vehiculo_id = v.id and pm.operacion_id = op.id and pm.activo
  );
