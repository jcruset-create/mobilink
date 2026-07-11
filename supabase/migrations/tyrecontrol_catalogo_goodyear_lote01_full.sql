-- ============================================================
-- SEA TyreControl - Goodyear Fase 2 lote 01 (COMPLETO)
-- Marca + medidas + 22 modelos + tyre_sizes + referencias tecnicas
-- (presion, diametro, revoluciones/km, carga, llanta) del databook
-- oficial Goodyear 2021. Idempotente. codigo_velocidad -> opcional.
-- ============================================================

alter table tyre_sizes alter column codigo_velocidad drop not null;

insert into tc_cat_marcas_neumatico (nombre) values ('Goodyear') on conflict (nombre) do nothing;

-- Medidas
insert into tc_cat_medidas_neumatico (valor) values ('295/60R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/60R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/70R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/65R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('425/65R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('445/65R22.5') on conflict (valor) do nothing;
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='tc_cat_medidas_neumatico' and column_name='categoria') then
    update tc_cat_medidas_neumatico set categoria='camion' where valor in ('295/60R22.5','315/60R22.5','315/70R22.5','385/65R22.5','425/65R22.5','445/65R22.5') and (categoria is null or categoria='');
  end if; end $$;

-- Modelos
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'FUELMAX D GEN-2','traccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'FUELMAX D PERFORMANCE','traccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'FUELMAX S GEN-2','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'FUELMAX S HL GEN-2','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'FUELMAX S HL PERFORMANCE','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'FUELMAX T HL','remolque','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX D GEN-2','traccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX S A HL','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX S GEN-2','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX S HL','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX S HL GEN-2','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX T','remolque','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX T GEN-2','remolque','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX T GEN-2 HL','remolque','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'KMAX T HL','remolque','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'OMNITRAC MST II',null,'camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'OMNITRAC S','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'REGIONAL RHS II HL',null,'camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'ULTRA GRIP MAX D','traccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'ULTRA GRIP MAX S','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'ULTRA GRIP MAX S HL','direccion','camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id,nombre,eje_recomendado,tipo_vehiculo) select id,'URBANMAX MCA',null,'camion' from tc_cat_marcas_neumatico where nombre='Goodyear' on conflict (marca_id,nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;

-- tyre_sizes (por medida + indice de carga; velocidad vacia)
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'315/70R22.5 156/150','315/70R22.5',315,70,22.5,'156','150',null from tc_cat_medidas_neumatico where valor='315/70R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'315/70R22.5 154/150','315/70R22.5',315,70,22.5,'154','150',null from tc_cat_medidas_neumatico where valor='315/70R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'385/65R22.5 160','385/65R22.5',385,65,22.5,'160',null,null from tc_cat_medidas_neumatico where valor='385/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'385/65R22.5 164','385/65R22.5',385,65,22.5,'164',null,null from tc_cat_medidas_neumatico where valor='385/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'425/65R22.5 165','425/65R22.5',425,65,22.5,'165',null,null from tc_cat_medidas_neumatico where valor='425/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'445/65R22.5 169','445/65R22.5',445,65,22.5,'169',null,null from tc_cat_medidas_neumatico where valor='445/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'295/60R22.5 150/147','295/60R22.5',295,60,22.5,'150','147',null from tc_cat_medidas_neumatico where valor='295/60R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'315/60R22.5 152/148','315/60R22.5',315,60,22.5,'152','148',null from tc_cat_medidas_neumatico where valor='315/60R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad) select id,'315/60R22.5 154/148','315/60R22.5',315,60,22.5,'154','148',null from tc_cat_medidas_neumatico where valor='315/60R22.5' on conflict (referencia_completa) do nothing;

-- Referencias tecnicas (modelo + medida) con presion y dimensiones
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1005, 325, 8000, '9', 'Goodyear FUELMAX S HL PERFORMANCE 315/70R22.5 156/150'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/70R22.5 156/150' where mo.nombre='FUELMAX S HL PERFORMANCE'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1009, 323, 8000, '9', 'Goodyear FUELMAX S HL GEN-2 315/70R22.5 156/150'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/70R22.5 156/150' where mo.nombre='FUELMAX S HL GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1008, 324, 7500, '9', 'Goodyear FUELMAX D PERFORMANCE 315/70R22.5 154/150'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/70R22.5 154/150' where mo.nombre='FUELMAX D PERFORMANCE'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1013, 323, 7500, '9', 'Goodyear FUELMAX D GEN-2 315/70R22.5 154/150'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/70R22.5 154/150' where mo.nombre='FUELMAX D GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1015, 322, 8000, '9', 'Goodyear KMAX S HL GEN-2 315/70R22.5 156/150'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/70R22.5 156/150' where mo.nombre='KMAX S HL GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1016, 323, 7500, '9', 'Goodyear KMAX D GEN-2 315/70R22.5 154/150'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/70R22.5 154/150' where mo.nombre='KMAX D GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1014, 323, 8000, '9', 'Goodyear ULTRA GRIP MAX S HL 315/70R22.5 156/150'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/70R22.5 156/150' where mo.nombre='ULTRA GRIP MAX S HL'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1018, 324, 7500, '9', 'Goodyear ULTRA GRIP MAX D 315/70R22.5 154/150'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/70R22.5 154/150' where mo.nombre='ULTRA GRIP MAX D'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1075, 304, 9000, '11.75', 'Goodyear FUELMAX S GEN-2 385/65R22.5 160'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='385/65R22.5 160' where mo.nombre='FUELMAX S GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1078, 303, 9000, '11.75', 'Goodyear KMAX S GEN-2 385/65R22.5 160'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='385/65R22.5 160' where mo.nombre='KMAX S GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1075, 307, 10000, '11.75', 'Goodyear REGIONAL RHS II HL 385/65R22.5 164'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='385/65R22.5 164' where mo.nombre='REGIONAL RHS II HL'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1079, 304, 9000, '11.75', 'Goodyear ULTRA GRIP MAX S 385/65R22.5 160'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='385/65R22.5 160' where mo.nombre='ULTRA GRIP MAX S'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1077, 302, 9000, '11.75', 'Goodyear OMNITRAC S 385/65R22.5 160'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='385/65R22.5 160' where mo.nombre='OMNITRAC S'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1072, 308, 10000, '11.75', 'Goodyear FUELMAX T HL 385/65R22.5 164'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='385/65R22.5 164' where mo.nombre='FUELMAX T HL'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1085, 301, 10000, '11.75', 'Goodyear KMAX T GEN-2 HL 385/65R22.5 164'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='385/65R22.5 164' where mo.nombre='KMAX T GEN-2 HL'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1083, 305, 10000, '11.75', 'Goodyear KMAX T HL 385/65R22.5 164'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='385/65R22.5 164' where mo.nombre='KMAX T HL'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 8.25, null, null, 10300, '13', 'Goodyear KMAX T GEN-2 425/65R22.5 165'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='425/65R22.5 165' where mo.nombre='KMAX T GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 8.25, 1128, 293, 10300, '13', 'Goodyear KMAX T 425/65R22.5 165'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='425/65R22.5 165' where mo.nombre='KMAX T'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, null, null, 11600, '13', 'Goodyear KMAX T GEN-2 445/65R22.5 169'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='445/65R22.5 169' where mo.nombre='KMAX T GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1157, 282, 11600, '13', 'Goodyear KMAX T 445/65R22.5 169'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='445/65R22.5 169' where mo.nombre='KMAX T'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 1159, 285, 11600, '14', 'Goodyear OMNITRAC MST II 445/65R22.5 169'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='445/65R22.5 169' where mo.nombre='OMNITRAC MST II'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 925, 351, 6700, '9', 'Goodyear FUELMAX S GEN-2 295/60R22.5 150/147'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='295/60R22.5 150/147' where mo.nombre='FUELMAX S GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 927, 352, 6700, '9', 'Goodyear KMAX S GEN-2 295/60R22.5 150/147'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='295/60R22.5 150/147' where mo.nombre='KMAX S GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 929, 352, 6700, '9', 'Goodyear ULTRA GRIP MAX S 295/60R22.5 150/147'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='295/60R22.5 150/147' where mo.nombre='ULTRA GRIP MAX S'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 937, 351, 6700, '9', 'Goodyear ULTRA GRIP MAX D 295/60R22.5 150/147'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='295/60R22.5 150/147' where mo.nombre='ULTRA GRIP MAX D'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 960, 340, 7100, '9', 'Goodyear FUELMAX D GEN-2 315/60R22.5 152/148'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/60R22.5 152/148' where mo.nombre='FUELMAX D GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 954, 341, 7500, '9', 'Goodyear KMAX S HL GEN-2 315/60R22.5 154/148'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/60R22.5 154/148' where mo.nombre='KMAX S HL GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 955, 340, 7500, '9', 'Goodyear KMAX S HL 315/60R22.5 154/148'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/60R22.5 154/148' where mo.nombre='KMAX S HL'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 954, 341, 7500, '9', 'Goodyear KMAX S A HL 315/60R22.5 154/148'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/60R22.5 154/148' where mo.nombre='KMAX S A HL'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 965, 339, 7100, '9', 'Goodyear KMAX D GEN-2 315/60R22.5 152/148'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/60R22.5 152/148' where mo.nombre='KMAX D GEN-2'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 963, 343, 7100, '9', 'Goodyear URBANMAX MCA 315/60R22.5 152/148'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/60R22.5 152/148' where mo.nombre='URBANMAX MCA'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 957, 341, 7500, '9', 'Goodyear ULTRA GRIP MAX S HL 315/60R22.5 154/148'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/60R22.5 154/148' where mo.nombre='ULTRA GRIP MAX S HL'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, presion_maxima_bar, diametro_exterior_mm, revoluciones_km, carga_maxima_kg, llanta_recomendada, referencia_completa)
  select mo.id, ts.id, 9, 966, 340, 7100, '9', 'Goodyear ULTRA GRIP MAX D 315/60R22.5 152/148'
  from tc_cat_modelos_neumatico mo join tc_cat_marcas_neumatico ma on ma.id=mo.marca_id and ma.nombre='Goodyear'
  join tyre_sizes ts on ts.referencia_completa='315/60R22.5 152/148' where mo.nombre='ULTRA GRIP MAX D'
  on conflict (modelo_id, tyre_size_id) do update set presion_maxima_bar=excluded.presion_maxima_bar, diametro_exterior_mm=excluded.diametro_exterior_mm, revoluciones_km=excluded.revoluciones_km, carga_maxima_kg=excluded.carga_maxima_kg, llanta_recomendada=excluded.llanta_recomendada;
