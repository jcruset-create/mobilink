-- ============================================================
-- DATOS — Asignación de un operario (técnico de la APK) a sus empresas
-- (clientes). La pantalla de selección de cliente muestra las empresas de
-- tc_operador_empresas; si un técnico "está autorizado" a un cliente pero no
-- tiene la fila aquí, ese cliente NO aparece (o aparece sin nombre por RLS).
--
-- Caso: David debería ver "Mobilink Tarragona" y "Encatrans" pero Encatrans no
-- sale. Ejecutar por pasos en el editor SQL de Supabase (bypassa RLS).
-- ============================================================

-- 1) VERIFICA a qué empresas está asignado David hoy:
select u.id as usuario_id, u.nombre as tecnico, e.id as empresa_id, e.nombre as empresa
from tc_operador_empresas oe
join tc_usuarios u on u.id = oe.usuario_id
join tc_empresas  e on e.id = oe.empresa_id
where u.nombre ilike '%david%'
order by u.nombre, e.nombre;

-- 2) VERIFICA el/los usuario(s) llamados David y las empresas objetivo
--    (para asegurarte de que solo hay UN David y coger los ids correctos):
select id, nombre, email, empresa_id from tc_usuarios where nombre ilike '%david%';
select id, nombre from tc_empresas where nombre ilike '%encatrans%' or nombre ilike '%tarragona%';

-- 3) Si en el paso 1 NO aparece Encatrans, asígnalo. Revisa antes que el
--    ilike de David casa con UN solo usuario (si hay varios, usa los ids
--    exactos en vez del ilike). Idempotente:
insert into tc_operador_empresas (usuario_id, empresa_id)
select u.id, e.id
from tc_usuarios u, tc_empresas e
where u.nombre ilike '%david%'
  and e.nombre ilike '%encatrans%'
on conflict do nothing;

-- (Opcional) asegurar también Mobilink Tarragona:
-- insert into tc_operador_empresas (usuario_id, empresa_id)
-- select u.id, e.id from tc_usuarios u, tc_empresas e
-- where u.nombre ilike '%david%' and e.nombre ilike '%tarragona%'
-- on conflict do nothing;
