-- ============================================================
-- SEA TyreControl - Catalogo Michelin (Fase 3, lote 03)
-- 23 referencias camion Europa (fichas oficiales Michelin ES).
-- Marca + medidas + modelos (eje, aplicacion, M+S, 3PMSF,
-- reesculturable, recauchutable). Presion/dimensiones pendientes.
-- Idempotente.
-- ============================================================

insert into tc_cat_marcas_neumatico (nombre) values ('Michelin') on conflict (nombre) do nothing;

-- Medidas
insert into tc_cat_medidas_neumatico (valor) values ('13R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('295/60R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('295/80R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/60R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/70R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/80R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('355/50R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/55R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/65R22.5') on conflict (valor) do nothing;
do $$ begin if exists (select 1 from information_schema.columns where table_name='tc_cat_medidas_neumatico' and column_name='categoria') then
  update tc_cat_medidas_neumatico set categoria='camion' where valor in ('13R22.5','295/60R22.5','295/80R22.5','315/60R22.5','315/70R22.5','315/80R22.5','355/50R22.5','385/55R22.5','385/65R22.5') and (categoria is null or categoria=''); end if; end $$;

-- Modelos Michelin
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X LINE ENERGY D3','traccion','Long haul','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X LINE ENERGY Z3','direccion','Long haul','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X MULTI F','direccion','Regional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X MULTI HD D','traccion','Regional / Aggressive','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X MULTI HD D+','traccion','Regional / Aggressive','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X MULTI HD Z','mixto','Regional / Aggressive','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X MULTI T','remolque','Regional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X MULTI Z','mixto','Regional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X WORKS D','traccion','On-road / On-off road','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X WORKS D2','traccion','On-road / On-off road','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X WORKS T','remolque','On-road / On-off road','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'X WORKS Z','mixto','On-road / On-off road','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Michelin'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
