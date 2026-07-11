-- ============================================================
-- SEA TyreControl - Catalogo Bridgestone (Fase 4, lote 04)
-- 20 referencias camion/autobus Europa (paginas oficiales BS ES).
-- Marca + medidas + modelos (eje, aplicacion, M+S, 3PMSF,
-- recauchutable). Presion/dimensiones/indices pendientes (Tyrelink).
-- Idempotente.
-- ============================================================

insert into tc_cat_marcas_neumatico (nombre) values ('Bridgestone') on conflict (nombre) do nothing;

-- Medidas
insert into tc_cat_medidas_neumatico (valor) values ('315/70R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/80R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/55R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/65R22.5') on conflict (valor) do nothing;
do $$ begin if exists (select 1 from information_schema.columns where table_name='tc_cat_medidas_neumatico' and column_name='categoria') then
  update tc_cat_medidas_neumatico set categoria='camion' where valor in ('315/70R22.5','315/80R22.5','385/55R22.5','385/65R22.5') and (categoria is null or categoria=''); end if; end $$;

-- Modelos Bridgestone
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'COACH-AP 001','mixto','Larga distancia autocar','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'DURAVIS R-DRIVE 002','traccion','Regional / versátil','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'DURAVIS R-STEER 002','direccion','Regional / versátil','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'DURAVIS R-TRAILER 002','remolque','Regional / versátil','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'ECOPIA DRIVE','traccion','Larga distancia / autopista','camion',true,true,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'ECOPIA H-DRIVE 002','traccion','Larga distancia / autopista','camion',true,true,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'ECOPIA H-STEER 002','direccion','Larga distancia / autopista','camion',true,true,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'ECOPIA H-TRAILER 002','remolque','Larga distancia / autopista','camion',true,true,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'ECOPIA STEER','direccion','Larga distancia / autopista','camion',true,true,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'ECOPIA TRAILER','remolque','Larga distancia / autopista','camion',true,true,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'GREATEC R173','traccion','Urbano','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'M-DRIVE 002','traccion','Mixto moderado carretera/obra','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'M-STEER 002','direccion','Mixto moderado carretera/obra','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'M748 EVO','traccion','Mixto severo','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'M852','traccion','Invierno / mixto','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'R179+','remolque','Regional / versátil','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'R192','mixto','Urbano','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'R297','remolque','Regional / versátil','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'U-AP 002','mixto','Urbano','camion',true,true,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo,m_s,tres_pmsf,reesculturable,recauchutable)
  select id,'UAP-001','mixto','Urbano','camion',null,null,null,true from tc_cat_marcas_neumatico where nombre='Bridgestone'
  on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo,m_s=excluded.m_s,tres_pmsf=excluded.tres_pmsf,reesculturable=excluded.reesculturable,recauchutable=excluded.recauchutable;
