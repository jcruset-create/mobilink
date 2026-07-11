-- ============================================================
-- SEA TyreControl - Catalogo Continental (Fase 2, lote 02)
-- Camion/bus Europa. Sin presiones ni dimensiones (llegan del
-- Technical Data Book oficial). Idempotente.
-- ============================================================

insert into tc_cat_marcas_neumatico (nombre) values ('Continental') on conflict (nombre) do nothing;

-- Medidas
insert into tc_cat_medidas_neumatico (valor) values ('295/80R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/70R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/80R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/55R19.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/55R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/65R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('445/45R19.5') on conflict (valor) do nothing;

-- Categoria 'camion' para estas medidas (solo si existe la columna categoria)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name='tc_cat_medidas_neumatico' and column_name='categoria') then
    update tc_cat_medidas_neumatico set categoria='camion'
      where valor in ('295/80R22.5','315/70R22.5','315/80R22.5','385/55R19.5','385/55R22.5','385/65R22.5','445/45R19.5')
        and (categoria is null or categoria='');
  end if;
end $$;

-- Modelos Continental
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti Eco HS5', 'direccion', 'Regional / long-haul', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti EcoRegional HS3', 'direccion', 'Regional / long-haul', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti Hybrid HD3', 'traccion', 'Regional', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti Hybrid HD5', 'traccion', 'Regional', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti Hybrid HS3+', 'direccion', 'Regional', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti Hybrid HS5', 'direccion', 'Regional / long-haul', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti Hybrid HT3', 'remolque', 'Regional / long-haul', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti Hybrid HT3+', 'remolque', 'Regional / long-haul', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf, recauchutable)
  select id, 'Conti Hybrid HT5', 'remolque', 'Regional / long-haul', 'camion', true, true, true
  from tc_cat_marcas_neumatico where nombre='Continental'
  on conflict (marca_id, nombre) do update set
    eje_recomendado=excluded.eje_recomendado, aplicacion=excluded.aplicacion, tipo_vehiculo=excluded.tipo_vehiculo,
    m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf, recauchutable=excluded.recauchutable;
