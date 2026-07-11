-- ============================================================
-- SEA TyreControl - Catalogo Dunlop (Fase 6, lote 06)
-- 49 referencias camion/bus Europa (paginas oficiales Dunlop).
-- Marca + medidas + modelos (eje, aplicacion, M+S, 3PMSF,
-- reesculturable, recauchutable). Presion/dimensiones pendientes.
-- Idempotente.
-- ============================================================

insert into tc_cat_marcas_neumatico (nombre) values ('Dunlop') on conflict (nombre) do nothing;

-- Medidas
insert into tc_cat_medidas_neumatico (valor) values ('13R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('205/75R17.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('215/75R17.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('225/75R17.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('235/75R17.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('245/70R17.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('245/70R19.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('265/70R17.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('265/70R19.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('285/70R19.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('295/60R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('295/80R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('305/70R19.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/60R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/70R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/80R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/55R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/65R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('435/50R19.5') on conflict (valor) do nothing;
do $$ begin if exists (select 1 from information_schema.columns where table_name='tc_cat_medidas_neumatico' and column_name='categoria') then
  update tc_cat_medidas_neumatico set categoria='camion' where valor in ('13R22.5','205/75R17.5','215/75R17.5','225/75R17.5','235/75R17.5','245/70R17.5','245/70R19.5','265/70R17.5','265/70R19.5','285/70R19.5','295/60R22.5','295/80R22.5','305/70R19.5','315/60R22.5','315/70R22.5','315/80R22.5','385/55R22.5','385/65R22.5','435/50R19.5') and (categoria is null or categoria=''); end if; end $$;

-- Modelos Dunlop
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP246','remolque','Long haul / Regional','camion',null,null,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP247','remolque','Long haul / Regional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP282','remolque','Mixed on/off road / Construction','camion',null,null,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP346','direccion','Long haul / Regional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP346+','direccion','Long haul / Regional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP362','mixto','Winter regional / interregional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP382','direccion','Mixed on/off road / Construction','camion',null,null,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP446','traccion','Long haul / Regional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP462','traccion','Severe winter regional / interregional','camion',true,true,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'SP482','traccion','Mixed on/off road / Construction','camion',null,null,true,true from tc_cat_marcas_neumatico where nombre='Dunlop'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
