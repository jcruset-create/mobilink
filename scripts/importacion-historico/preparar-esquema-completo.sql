-- Datos mínimos de prueba sobre el esquema COMPLETO (construir-esquema.sh):
-- una empresa, un administrador, un tipo de vehículo con plano 2x4 y los
-- ayudantes que usan e2e.sql y concurrencia.sh. Solo bases de pruebas.
--
-- El usuario se identifica como en producción: auth.uid() lee el `sub` del
-- JWT, que aquí se inyecta con PGOPTIONS="-c request.jwt.claims=..." (ver
-- e2e.sh / concurrencia.sh).
do $$ begin
  if exists (select 1 from information_schema.tables where table_name='auth_ctx') then
    raise exception 'Esto es para el esquema completo, no para el banco mínimo';
  end if;
end $$;

insert into tc_empresas (id, nombre) values ('00000000-0000-0000-0000-0000000000e1', 'Plana (pruebas)'), ('00000000-0000-0000-0000-0000000000e2', 'Otra (pruebas)')
  on conflict (id) do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'admin.pruebas@local') on conflict (id) do nothing;
insert into tc_usuarios (id, empresa_id, nombre, email, rol, activo, acceso_apk, acceso_panel, es_superadmin)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000e1', 'Admin pruebas', 'admin.pruebas@local', 'administrador', true, false, true, false)
  on conflict (id) do nothing;
insert into tc_tipos_vehiculo (id, nombre, numero_ejes, numero_ruedas, configuracion_ejes)
  values ('00000000-0000-0000-0000-00000000000a', 'autocar_2x4_pruebas', 2, 6, '2x4'), ('00000000-0000-0000-0000-00000000000b', 'furgo_2x2_pruebas', 2, 4, '2x2')
  on conflict (id) do nothing;
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, lado, interior_exterior, orden_visual) values
  ('00000000-0000-0000-0000-00000000000a','E1_IZQ',1,'izq',null,1), ('00000000-0000-0000-0000-00000000000a','E1_DER',1,'der',null,2),
  ('00000000-0000-0000-0000-00000000000a','E2_IZQ_EXT',2,'izq','ext',3), ('00000000-0000-0000-0000-00000000000a','E2_IZQ_INT',2,'izq','int',4),
  ('00000000-0000-0000-0000-00000000000a','E2_DER_INT',2,'der','int',5), ('00000000-0000-0000-0000-00000000000a','E2_DER_EXT',2,'der','ext',6),
  ('00000000-0000-0000-0000-00000000000b','E1_IZQ',1,'izq',null,1), ('00000000-0000-0000-0000-00000000000b','E1_DER',1,'der',null,2),
  ('00000000-0000-0000-0000-00000000000b','E2_IZQ',2,'izq',null,3), ('00000000-0000-0000-0000-00000000000b','E2_DER',2,'der',null,4)
  on conflict do nothing;

-- Un neumático y un montaje reales en 7724KBM, que la importación no debe tocar.
insert into tc_vehiculos (id, empresa_id, tipo_vehiculo_id, matricula, km_actual) values
  ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','7724KBM', 999999)
  on conflict do nothing;

-- Fotografía de lo que NO debe cambiar.
create or replace function foto() returns text language sql as $$
  select md5(coalesce((select string_agg(m::text, '|' order by m.id) from tc_montajes_actuales m), '') || '#' ||
             coalesce((select string_agg(h::text, '|' order by h.id) from tc_historial_montajes h), '') || '#' ||
             coalesce((select string_agg(n::text, '|' order by n.id) from tc_neumaticos n where n.importacion_lote_id is null), '') || '#' ||
             coalesce((select string_agg(s::text, '|' order by s.id) from movimientos_stock s), '') || '#' ||
             coalesce((select string_agg(r::text, '|' order by r.id) from revisiones_vehiculo r), '') || '#' ||
             coalesce((select string_agg(d::text, '|' order by d.id) from revisiones_neumaticos_detalle d), '') || '#' ||
             coalesce((select string_agg(v.id::text || v.km_actual || coalesce(v.origen_km::text,''), '|' order by v.id) from tc_vehiculos v), ''))
$$;

-- Albaranes sintéticos para concurrencia.sh (mismos que en el banco).
create or replace function alb_n(p_doc text, p_mat text, p_n int, p_refs int, p_cond text default 'nueva') returns jsonb language sql as $$
  select jsonb_build_object('origen_doc',p_doc||'|'||p_mat,'documento',p_doc,'matricula',p_mat,'fecha','2026-09-20','km',null,'huella_origen','h'||p_doc,
    'operaciones',(select jsonb_agg(jsonb_build_object('origen_linea',p_doc||'|'||p_mat||'|H1|M|1|u'||i||'/'||p_n,'condicion',p_cond,'marca','Hankook',
                                                       'modelo', case when p_refs = 1 or i <= p_n/2 then 'AH51' else 'DH35' end,'medida','295/80R22.5'))
                     from generate_series(1,p_n) i),
    'servicios','[]'::jsonb,'lineas','[]'::jsonb)
$$;
create or replace function lote(p_periodo text, variadic p_albs jsonb[]) returns jsonb language sql as $$
  select jsonb_build_object('periodo', p_periodo, 'fichero', 'plana.xlsx', 'albaranes', to_jsonb(p_albs))
$$;
-- Para que concurrencia.sh pueda ejecutar su `update auth_ctx` sin ruido: aquí el rol viene del JWT.
create table if not exists auth_ctx_dummy (x int);
