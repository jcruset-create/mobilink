-- ============================================================
-- SEA TyreControl - Catalogo Sailun (STL1/SFR1/STR1, 385)
-- 7 referencias con datos tecnicos del catalogo oficial Sailun TBR 2025.
-- Marca + medidas + modelos + tyre_sizes + referencias con presion,
-- diametro, profundidad de dibujo, carga y llanta. Idempotente.
-- ============================================================

alter table tyre_sizes alter column codigo_velocidad drop not null;

insert into tc_cat_marcas_neumatico (nombre) values ('Sailun') on conflict (nombre) do nothing;

-- Medidas
insert into tc_cat_medidas_neumatico (valor) values ('385/55R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/65R22.5') on conflict (valor) do nothing;
do $$ begin if exists (select 1 from information_schema.columns where table_name='tc_cat_medidas_neumatico' and column_name='categoria') then
  update tc_cat_medidas_neumatico set categoria='camion' where valor in ('385/55R22.5','385/65R22.5') and (categoria is null or categoria=''); end if; end $$;

-- Modelos
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo) select id,'SFR1','direccion','Regional','camion' from tc_cat_marcas_neumatico where nombre='Sailun' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo) select id,'STL1','remolque','Long haul','camion' from tc_cat_marcas_neumatico where nombre='Sailun' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,aplicacion,tipo_vehiculo) select id,'STR1','remolque','Regional','camion' from tc_cat_marcas_neumatico where nombre='Sailun' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado,aplicacion=excluded.aplicacion,tipo_vehiculo=excluded.tipo_vehiculo;

-- tyre_sizes
insert into tyre_sizes (medida_id,referencia_completa,medida,ancho,perfil,diametro_llanta,indice_carga_simple,indice_carga_doble,codigo_velocidad) select id,'385/55R22.5 160K','385/55R22.5',385,55,22.5,'160',null,'K' from tc_cat_medidas_neumatico where valor='385/55R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id,referencia_completa,medida,ancho,perfil,diametro_llanta,indice_carga_simple,indice_carga_doble,codigo_velocidad) select id,'385/65R22.5 160/158K','385/65R22.5',385,65,22.5,'160','158','K' from tc_cat_medidas_neumatico where valor='385/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id,referencia_completa,medida,ancho,perfil,diametro_llanta,indice_carga_simple,indice_carga_doble,codigo_velocidad) select id,'385/55R22.5 160/158K','385/55R22.5',385,55,22.5,'160','158','K' from tc_cat_medidas_neumatico where valor='385/55R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id,referencia_completa,medida,ancho,perfil,diametro_llanta,indice_carga_simple,indice_carga_doble,codigo_velocidad) select id,'385/65R22.5 164/158K','385/65R22.5',385,65,22.5,'164','158','K' from tc_cat_medidas_neumatico where valor='385/65R22.5' on conflict (referencia_completa) do nothing;

-- Referencias tecnicas
insert into tc_referencias_neumatico (modelo_id,tyre_size_id,presion_maxima_bar,diametro_exterior_mm,profundidad_dibujo_mm,carga_maxima_kg,llanta_recomendada,referencia_completa)
  select mo.id,ts.id,9,996,12.5,4500,'12.25','Sailun STL1 385/55R22.5 160K'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Sailun' join tyre_sizes ts on ts.referencia_completa='385/55R22.5 160K' where mo.nombre='STL1'
  on conflict (modelo_id,tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar,diametro_exterior_mm=excluded.diametro_exterior_mm,profundidad_dibujo_mm=excluded.profundidad_dibujo_mm,carga_maxima_kg=excluded.carga_maxima_kg,llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id,tyre_size_id,presion_maxima_bar,diametro_exterior_mm,profundidad_dibujo_mm,carga_maxima_kg,llanta_recomendada,referencia_completa)
  select mo.id,ts.id,9,996,13,4500,'11.75','Sailun STL1 385/65R22.5 160/158K'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Sailun' join tyre_sizes ts on ts.referencia_completa='385/65R22.5 160/158K' where mo.nombre='STL1'
  on conflict (modelo_id,tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar,diametro_exterior_mm=excluded.diametro_exterior_mm,profundidad_dibujo_mm=excluded.profundidad_dibujo_mm,carga_maxima_kg=excluded.carga_maxima_kg,llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id,tyre_size_id,presion_maxima_bar,diametro_exterior_mm,profundidad_dibujo_mm,carga_maxima_kg,llanta_recomendada,referencia_completa)
  select mo.id,ts.id,9,996,14.5,4500,'12.25','Sailun SFR1 385/55R22.5 160/158K'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Sailun' join tyre_sizes ts on ts.referencia_completa='385/55R22.5 160/158K' where mo.nombre='SFR1'
  on conflict (modelo_id,tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar,diametro_exterior_mm=excluded.diametro_exterior_mm,profundidad_dibujo_mm=excluded.profundidad_dibujo_mm,carga_maxima_kg=excluded.carga_maxima_kg,llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id,tyre_size_id,presion_maxima_bar,diametro_exterior_mm,profundidad_dibujo_mm,carga_maxima_kg,llanta_recomendada,referencia_completa)
  select mo.id,ts.id,9,1072,16.5,4500,'11.75','Sailun SFR1 385/65R22.5 160/158K'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Sailun' join tyre_sizes ts on ts.referencia_completa='385/65R22.5 160/158K' where mo.nombre='SFR1'
  on conflict (modelo_id,tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar,diametro_exterior_mm=excluded.diametro_exterior_mm,profundidad_dibujo_mm=excluded.profundidad_dibujo_mm,carga_maxima_kg=excluded.carga_maxima_kg,llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id,tyre_size_id,presion_maxima_bar,diametro_exterior_mm,profundidad_dibujo_mm,carga_maxima_kg,llanta_recomendada,referencia_completa)
  select mo.id,ts.id,9,1072,16.5,5000,'11.75','Sailun SFR1 385/65R22.5 164/158K'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Sailun' join tyre_sizes ts on ts.referencia_completa='385/65R22.5 164/158K' where mo.nombre='SFR1'
  on conflict (modelo_id,tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar,diametro_exterior_mm=excluded.diametro_exterior_mm,profundidad_dibujo_mm=excluded.profundidad_dibujo_mm,carga_maxima_kg=excluded.carga_maxima_kg,llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id,tyre_size_id,presion_maxima_bar,diametro_exterior_mm,profundidad_dibujo_mm,carga_maxima_kg,llanta_recomendada,referencia_completa)
  select mo.id,ts.id,9,1072,16,4500,'11.75','Sailun STR1 385/65R22.5 160/158K'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Sailun' join tyre_sizes ts on ts.referencia_completa='385/65R22.5 160/158K' where mo.nombre='STR1'
  on conflict (modelo_id,tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar,diametro_exterior_mm=excluded.diametro_exterior_mm,profundidad_dibujo_mm=excluded.profundidad_dibujo_mm,carga_maxima_kg=excluded.carga_maxima_kg,llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id,tyre_size_id,presion_maxima_bar,diametro_exterior_mm,profundidad_dibujo_mm,carga_maxima_kg,llanta_recomendada,referencia_completa)
  select mo.id,ts.id,9,1072,16,5000,'11.75','Sailun STR1 385/65R22.5 164/158K'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Sailun' join tyre_sizes ts on ts.referencia_completa='385/65R22.5 164/158K' where mo.nombre='STR1'
  on conflict (modelo_id,tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar,diametro_exterior_mm=excluded.diametro_exterior_mm,profundidad_dibujo_mm=excluded.profundidad_dibujo_mm,carga_maxima_kg=excluded.carga_maxima_kg,llanta_recomendada=excluded.llanta_recomendada;
