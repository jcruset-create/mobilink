-- ============================================================
-- Mobilink TyreControl — TODAS las referencias de catálogo, juntas
--
-- Pegar entero en el SQL Editor de Supabase. Es idempotente: se puede
-- ejecutar las veces que haga falta.
--
-- El catálogo del panel lista tc_referencias_neumatico. Una marca con
-- modelos pero sin referencias existe en la base y sale vacía en
-- pantalla; eso es lo que pasaba con las cinco marcas de aquí.
--
-- Lo que carga, y de dónde sale cada cosa:
--
--   1. Goodyear     33 referencias — databook oficial Goodyear 2021.
--   2. Sailun        7 referencias — ficha oficial.
--   3. Continental  15 referencias — Excel de catálogo fase 2, lote 02.
--   4. Bridgestone   9 } 16 referencias — LISTADOS DE DISTRIBUIDOR, no
--      Dunlop        6 }  ficha oficial. Ver el aviso de su bloque.
--
-- Los bloques 1 a 3 son migraciones que ya estaban en el repositorio y
-- van aquí sin tocar una coma; si alguna ya se ejecutó, no pasa nada.
-- ============================================================



-- ============================================================
-- BLOQUE 1. Goodyear — marca, modelos y 33 referencias (databook oficial 2021)
-- (tyrecontrol_catalogo_goodyear_lote01_full.sql)
-- ============================================================

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



-- ============================================================
-- BLOQUE 2. Sailun — marca, modelos y 7 referencias
-- (tyrecontrol_catalogo_sailun_lote.sql)
-- ============================================================

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



-- ============================================================
-- BLOQUE 3. Continental — marca, medidas y 9 modelos (lote 02)
-- (tyrecontrol_catalogo_continental_lote02.sql)
-- ============================================================

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



-- ============================================================
-- BLOQUE 4. Continental — las 15 referencias del lote 02
-- (tyrecontrol_catalogo_continental_lote02_referencias.sql)
-- ============================================================

-- ============================================================
-- Mobilink TyreControl — Catálogo Continental, fase 2, lote 02:
-- las 15 REFERENCIAS (modelo + medida + índices)
--
-- La marca, las 7 medidas y los 9 modelos ya los cargó
-- tyrecontrol_catalogo_continental_lote02.sql. Lo que faltaba es el
-- nivel de abajo: la referencia concreta que el técnico monta, con su
-- índice de carga, símbolo de velocidad, PR y etiqueta europea.
--
-- Origen: catalogo_neumaticos_fase2_continental_lote02.xlsx, pestaña
-- «Referencias Continental». Los datos se transcriben tal cual; un
-- `null` significa QUE NO CONSTA en el Excel, no cero ni «no aplica»,
-- así que no se rellena por inferencia.
--
-- Dimensiones, carga máxima y presión NO se cargan: siguen pendientes
-- de extraer del Technical Data Book oficial y no se inventan.
--
-- OJO con el 3PMSF: no es uniforme dentro de un modelo. El Conti Hybrid HT3
-- lo lleva en 385/65R22.5 y NO en 385/55R19.5 ni 445/45R19.5, pero el
-- catálogo solo tenía la casilla a nivel de MODELO y lo daba por bueno en las
-- tres. Aquí baja al nivel de la referencia, que es donde el dato es cierto.
--
-- Idempotente.
-- ============================================================

-- ── 1. Sitio para los datos que hoy no tienen columna ───────────────────────
--
-- Sin esto habría que tirar información del Excel. El doble marcado es el
-- caso claro: un 385/55R22.5 «160K / 158L» es UN neumático con DOS
-- homologaciones, no dos productos, así que no puede ser una segunda fila
-- de tyre_sizes — saldría duplicado en el catálogo del técnico.
alter table tc_referencias_neumatico
  add column if not exists m_s                     boolean,
  add column if not exists tres_pmsf               boolean,
  add column if not exists marcado_secundario      text,
  add column if not exists ean                     text,
  add column if not exists codigo_fabricante       text,
  add column if not exists verificacion_estado     text,
  add column if not exists fuente_oficial_url      text,
  add column if not exists fuente_corroboracion_url text,
  add column if not exists verificacion_notas      text;

comment on column tc_referencias_neumatico.tres_pmsf is
  'Marcado 3PMSF de ESTA medida. tc_cat_modelos_neumatico.tres_pmsf es del '
  'modelo entero y se queda corto: el Conti Hybrid HT3 lo lleva en '
  '385/65R22.5 pero NO en 385/55R19.5 ni en 445/45R19.5, y 3PMSF es un '
  'marcado invernal legal — darlo por bueno donde no lo hay no es un detalle '
  'cosmético. Manda esta columna cuando esté informada.';
comment on column tc_referencias_neumatico.marcado_secundario is
  'Segunda homologación del mismo neumático (doble marcado), p. ej. 158L '
  'cuando el principal es 160K. No es otro producto.';
comment on column tc_referencias_neumatico.verificacion_estado is
  'Alcance de la comprobación en origen. spec_corroborated_model_pending_'
  'official_page = la ficha oficial del modelo no se llegó a capturar.';

-- ── 2. Medidas con índice (tyre_sizes) ──────────────────────────────────────
-- Una fila por marcado PRINCIPAL. El secundario va en la referencia.
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'315/70R22.5 156/150L','315/70R22.5',315,70,22.5,'156','150','L'
  from tc_cat_medidas_neumatico where valor='315/70R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'315/70R22.5 154/150L','315/70R22.5',315,70,22.5,'154','150','L'
  from tc_cat_medidas_neumatico where valor='315/70R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/55R22.5 160K','385/55R22.5',385,55,22.5,'160',null,'K'
  from tc_cat_medidas_neumatico where valor='385/55R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'295/80R22.5 152/148M','295/80R22.5',295,80,22.5,'152','148','M'
  from tc_cat_medidas_neumatico where valor='295/80R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'315/80R22.5 156/150L','315/80R22.5',315,80,22.5,'156','150','L'
  from tc_cat_medidas_neumatico where valor='315/80R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'295/80R22.5 154/149M','295/80R22.5',295,80,22.5,'154','149','M'
  from tc_cat_medidas_neumatico where valor='295/80R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/65R22.5 160K','385/65R22.5',385,65,22.5,'160',null,'K'
  from tc_cat_medidas_neumatico where valor='385/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/65R22.5 164K','385/65R22.5',385,65,22.5,'164',null,'K'
  from tc_cat_medidas_neumatico where valor='385/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/55R19.5 156J','385/55R19.5',385,55,19.5,'156',null,'J'
  from tc_cat_medidas_neumatico where valor='385/55R19.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'445/45R19.5 160J','445/45R19.5',445,45,19.5,'160',null,'J'
  from tc_cat_medidas_neumatico where valor='445/45R19.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/55R22.5 162K','385/55R22.5',385,55,22.5,'162',null,'K'
  from tc_cat_medidas_neumatico where valor='385/55R22.5' on conflict (referencia_completa) do nothing;

-- ── 3. Referencias (modelo + medida) ────────────────────────────────────────
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HS5 315/70R22.5 156/150L', 20,
    true, true, 'C', 'B', 70, 'A',
    '154/150M', '4019238046120', '05126270000', 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hs5/', 'https://www.internationaltyres.com/product/315-70-r-22-5-continental-hybrid-hs5-156-150l-154-150m/', 'Official Continental product page confirms model/position/retreadability; size and label corroborated by distributor.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '315/70R22.5 156/150L'
  where mo.nombre = 'Conti Hybrid HS5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HD5 315/70R22.5 154/150L', 18,
    true, true, 'C', 'C', 76, null,
    '152/148M', '4019238046137', null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hd5/', 'https://www.neumaticos.es/continental-conti-hybrid-hd5-315-70-r22.5-154-150l--16429212', 'Official Continental page confirms model and application; size, EAN and EU label corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '315/70R22.5 154/150L'
  where mo.nombre = 'Conti Hybrid HD5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HS5 385/55R22.5 160K', 20,
    true, true, null, null, null, null,
    '158L', null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hs5/', 'https://www.muchoneumatico.com/neumaticos/125579-38555r22_5-160k158l-conti-hybrid-hs5.html', 'Model official; size and dual marking corroborated by Spanish distributor.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R22.5 160K'
  where mo.nombre = 'Conti Hybrid HS5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HD5 295/80R22.5 152/148M', 16,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hd5/', 'https://www.neumaticoslider.es/neumatico-camion/continental/conti-hybrid-hd5/295-80-r22-5-152-148m-1689921', 'Model official; size, PR and 3PMSF corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '295/80R22.5 152/148M'
  where mo.nombre = 'Conti Hybrid HD5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti EcoRegional HS3 315/80R22.5 156/150L', 20,
    true, true, 'C', 'B', 70, null,
    '154/150M', '4019238035766', null, 'model_official_spec_corroborated',
    'https://www.continental-tires.com/products/truck/tires/conti-ecoregional-hs3/', 'https://www.neumaticos-online.es/rshop/neumaticos/Continental/Conti-EcoRegional-HS3/315-80-R22-5-156-150L-20PR-doble-marcado-154-150M/R-421096', 'Official product page confirms model; size and markings corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '315/80R22.5 156/150L'
  where mo.nombre = 'Conti EcoRegional HS3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HS3+ 295/80R22.5 154/149M', 16,
    true, true, 'C', 'B', 70, 'A',
    null, '4019238051391', '0512565', 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hs3-plus/', 'https://www.autodoc.es/neumaticos/continental/295-80-r22_5', 'Official Spanish product page confirms model; detailed size, EAN and label corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '295/80R22.5 154/149M'
  where mo.nombre = 'Conti Hybrid HS3+'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HD3 295/80R22.5 152/148M', null,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hd3/', 'https://www.muchoneumatico.com/neumaticos/55629-29580r22_5-152148m-conti-hybrid-hd3.html', 'Official Spanish page confirms model; size corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '295/80R22.5 152/148M'
  where mo.nombre = 'Conti Hybrid HD3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3 385/65R22.5 160K', 20,
    true, true, null, null, null, null,
    '158L', null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3/', 'https://www.neumaticos-online.es/rshop/neumaticos/Continental/Conti-Hybrid-HT3/385-65-R22-5-160K-20PR-doble-marcado-158L/R-430378', 'Official product page confirms model and trailer application; size/marking corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/65R22.5 160K'
  where mo.nombre = 'Conti Hybrid HT3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3+ 385/65R22.5 164K', null,
    true, true, null, null, 70, null,
    '158L', null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3-plus/', 'https://www.muchoneumatico.com/neumaticos/121328-38565r22_5-164k158l-conti-hybrid-ht3.html', 'Official page confirms 3PMSF and application; size and dual marking corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/65R22.5 164K'
  where mo.nombre = 'Conti Hybrid HT3+'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3 385/55R19.5 156J', null,
    true, false, 'B', 'C', 70, 'A',
    null, '4019238820492', '0532112', 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3/', 'https://www.autodoc.co.uk/tyres/continental/385-55-r19_5', 'Official model page plus market specification corroboration.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R19.5 156J'
  where mo.nombre = 'Conti Hybrid HT3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3+ 385/55R19.5 156J', null,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3-plus/', 'https://www.1001neumaticos.com/continental-conti-hybrid-ht3-plus-385-55-r195-156-j-28085640-pn', 'Official model page; size corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R19.5 156J'
  where mo.nombre = 'Conti Hybrid HT3+'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3 445/45R19.5 160J', 22,
    true, false, 'B', 'C', 72, 'B',
    null, '4019238558784', '0531024000', 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3/', 'https://www.centralepneus.fr/pneu-camion/continental/hybrid-ht3/445-45-r19-5-160j-1404846', 'Official model page; size, PR, EAN and label corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '445/45R19.5 160J'
  where mo.nombre = 'Conti Hybrid HT3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3+ 445/45R19.5 160J', null,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3-plus/', 'https://www.bigtyres.co.uk/tyres/brands/continental/hybrid-ht3-plus/445-45r19-5-continental-hybrid-ht3-tl-trailer-160j-3pmsf-m-s', 'Official model page; size and 3PMSF corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '445/45R19.5 160J'
  where mo.nombre = 'Conti Hybrid HT3+'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Eco HS5 385/55R22.5 162K', null,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-eco-hs-5/', 'https://tecnotyres.com/continental-conti-eco-hs5-385-55-r22-5-162k/', 'Official model page; size corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R22.5 162K'
  where mo.nombre = 'Conti Eco HS5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT5 385/55R22.5 160K', 20,
    true, true, null, null, null, null,
    '158L', null, null, 'spec_corroborated_model_pending_official_page',
    'https://www.continental-tires.com/content/dam/conti-tires-cms/continental/market-content/be/truck/fr---nl/Continental__TechnicalDataBook_03_24__Screen_EN.pdf.coredownload.pdf', 'https://www.neumaticoslider.es/neumatico-camion/continental/conti-hybrid-ht5/385-55-r22-5-160k-158l-1909225', 'Reference visible in European market; direct official product page not captured in this pass.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R22.5 160K'
  where mo.nombre = 'Conti Hybrid HT5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;

-- ── 4. Comprobación ─────────────────────────────────────────────────────────
-- Si algún modelo o alguna medida no existiera, el join no habría insertado
-- nada y el lote quedaría a medias sin que nadie se enterara.
do $$
declare n int; pendiente int;
begin
  select count(*) into n
    from tc_referencias_neumatico r
    join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
    join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
   where ma.nombre = 'Continental' and r.referencia_completa like 'Continental %';
  if n < 15 then
    raise exception 'Solo % referencias Continental de las 15 del lote: falta algún modelo o medida', n;
  end if;
  select count(*) into pendiente from tc_referencias_neumatico
   where verificacion_estado = 'spec_corroborated_model_pending_official_page';
  raise notice 'Referencias Continental del lote 02: % (de las que % siguen sin ficha oficial capturada)', n, pendiente;
end $$;



-- ============================================================
-- BLOQUE 5. Bridgestone — marca, medidas y 20 modelos (lote 04)
-- (tyrecontrol_catalogo_bridgestone_lote04.sql)
-- ============================================================

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



-- ============================================================
-- BLOQUE 6. Dunlop — marca, medidas y 10 modelos (lote 06)
-- (tyrecontrol_catalogo_dunlop_lote06.sql)
-- ============================================================

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



-- ============================================================
-- BLOQUE 7. Bridgestone y Dunlop — 16 referencias. OJO: origen distinto, leer la cabecera
-- (tyrecontrol_catalogo_referencias_bridgestone_dunlop.sql)
-- ============================================================

-- ============================================================
-- Mobilink TyreControl — Referencias de Bridgestone y Dunlop
--
-- El catálogo del panel lista tc_referencias_neumatico. Los lotes 04
-- (Bridgestone) y 06 (Dunlop) cargaron marca, medidas y modelos, pero
-- ninguna referencia: 30 modelos que no salen en ninguna pantalla.
--
-- ⚠️ ORIGEN DE ESTOS DATOS, QUE NO ES EL DE LOS DEMÁS LOTES ⚠️
-- Goodyear, Sailun y Continental salen de databooks oficiales y del
-- Excel de catálogo. Estas filas NO. Las fichas técnicas de Bridgestone
-- y Dunlop no son accesibles desde el entorno donde se generó esta
-- migración, así que el índice de carga y el símbolo de velocidad se han
-- tomado de listados de distribuidores europeos, exigiendo que al menos
-- DOS coincidieran en el mismo modelo y la misma medida.
--
-- Por eso todas nacen con verificacion_estado = 'distribuidor_web' y con
-- las dos URLs consultadas. El índice de carga es el dato que dice qué
-- peso aguanta el eje: antes de darlo por bueno hay que contrastarlo con
-- el databook (Bridgestone TBR Data Book / Dunlop TTDB). La columna
-- verificacion_estado está precisamente para poder listarlas y repasarlas.
--
-- Solo entran las combinaciones modelo × medida que un listado nombraba
-- de forma explícita. Las que no se pudieron confirmar NO se inventan:
-- de los 20 modelos Bridgestone salen 7 y de los 10 Dunlop salen 5. El
-- resto sigue sin referencia, que es lo honesto mientras no haya ficha.
--
-- Presión, dimensiones y carga máxima no se cargan. Idempotente.
-- ============================================================

-- ── 1. Columnas de trazabilidad ─────────────────────────────────────────────
-- Las creó la migración de Continental (lote 02). Se repiten aquí para que
-- este fichero se pueda ejecutar solo, sin depender del orden.
alter table tc_referencias_neumatico
  add column if not exists m_s                      boolean,
  add column if not exists tres_pmsf                boolean,
  add column if not exists marcado_secundario       text,
  add column if not exists ean                      text,
  add column if not exists codigo_fabricante        text,
  add column if not exists verificacion_estado      text,
  add column if not exists fuente_oficial_url       text,
  add column if not exists fuente_corroboracion_url text,
  add column if not exists verificacion_notas       text;

-- ── 2. La única medida que falta ────────────────────────────────────────────
-- El resto ya las crearon los lotes de Goodyear y Continental.
insert into tyre_sizes (referencia_completa, medida, ancho, perfil, diametro_llanta,
                        indice_carga_simple, indice_carga_doble, codigo_velocidad, medida_id)
select '385/65R22.5 160J', '385/65R22.5', 385, 65, 22.5, '160', null, 'J',
       (select id from tc_cat_medidas_neumatico where valor = '385/65R22.5')
where not exists (select 1 from tyre_sizes where referencia_completa = '385/65R22.5 160J');

-- ── 3. Las referencias ──────────────────────────────────────────────────────
do $$
declare
  f record;
  v_modelo uuid;
  v_size   uuid;
begin
  for f in
    select * from (values
      -- marca, modelo, medida (tyre_sizes.referencia_completa), PR,
      -- marcado secundario, M+S, 3PMSF, profundidad, fuente 1, fuente 2, notas
      ('Bridgestone','DURAVIS R-DRIVE 002'   ,'315/70R22.5 154/150L',null::int,'152/148M',true ,true ,16.6::numeric,
       'https://www.heuver.com/webshop/product/10002088/315-70r22-5-bridgestone-duravis-r-drive-002-154-150l-152-148m-tl-m-s-3pmsf',
       'https://www.truckbandenmarkt.com/en/truck-tires/bridgestone-315-70r22-5-r-drive-002-154-150l-152-148m/', null::text),

      ('Bridgestone','DURAVIS R-STEER 002'   ,'315/70R22.5 156/150L',null,'154/150M',null ,true ,null,
       'https://www.heuver.com/product/10002110/315-70r22-5-bridgestone-duravis-r-steer-002-156-150l-154-150m-tl-3pmsf',
       'https://www.tyres-outlet.co.uk/product/bridgestone/duravis-r-steer-002/315-70-r22.5/r-411303', null),

      ('Bridgestone','DURAVIS R-TRAILER 002' ,'385/65R22.5 160K'    ,20  ,'158L'    ,true ,true ,null,
       'https://www.heuver.com/product/10006034/385-65r22-5-bridgestone-duravis-r-trailer-002-160k-158l-20pr-tl-m-s-3pmsf',
       'https://www.bigtyres.co.uk/tyres/brands/bridgestone/r-trailer-002/385-65r22-5-bridgestone-duravis-r-trailer-002-tl-trailer-160k',
       'Existe también en 385/55R22.5 160K pero con un solo listado: no se carga hasta confirmarla.'),

      ('Bridgestone','ECOPIA H-DRIVE 002'    ,'315/80R22.5 156/150L',null,'154/150M',null ,null ,null,
       'https://www.tyres-outlet.co.uk/product/bridgestone/ecopia-h-drive-002/315-80-r22.5/r-378082',
       'https://tecnotyres.com/en/bridgestone-315-80-r22-5-ecohd2-156l154m-tl/', null),

      ('Bridgestone','ECOPIA H-DRIVE 002'    ,'315/70R22.5 154/150L',null,null      ,null ,null ,null,
       'https://www.internationaltyres.com/shop/315-70-r-22-5-bridgestone-ecopia-h-drive-002-154-150l/',
       null, 'Un solo listado explícito; el índice coincide con el del R-DRIVE 002 en la misma medida.'),

      ('Bridgestone','ECOPIA H-STEER 002'    ,'315/80R22.5 156/150L',null,null      ,true ,true ,null,
       'https://www.mlperformanceusa.com/products/bridgestone-ecopia-h-steer-002-315-80-r22-5-156-150l-truck-summer-tyre-13509',
       'https://wheelandtireproz.com/product/bridgestone-ecopia-h-steer-002-315-80-r22-5-156l/',
       'En 315/70R22.5 los listados se contradicen (154L frente a 156L), así que esa medida no se carga.'),

      ('Bridgestone','ECOPIA H-TRAILER 002'  ,'385/65R22.5 160K'    ,20  ,'158L'    ,null ,null ,null,
       'https://www.internationaltyres.com/shop/385-65-r-22-5-bridgestone-ecopia-h-trailer-002-160k-158l/',
       'https://www.forrez.com/en/wholesale/products/bridgestone-38565r225-ecopia-h-trailer-002-160-k-tl', null),

      ('Bridgestone','ECOPIA H-TRAILER 002'  ,'385/55R22.5 160K'    ,20  ,null      ,null ,null ,null,
       'https://www.giga-tyres.co.uk/bridgestone/ecopia-h-trailer-002/385/55-r22.5/160/k/gi-r-378088ga',
       'https://otrusa.com/products/385-55r22-5-20pr-l-bridgestone-ecopia-h-trailer-002-tl', null),

      ('Bridgestone','ECOPIA DRIVE'          ,'315/70R22.5 154/150L',null,'152/148M',true ,true ,13.7,
       'https://www.heuver.com/webshop/product/10014749/315-70r22-5-bridgestone-ecopia-drive-enliten-154-150l-152-148m-tl-m-s-3pmsf',
       null, 'Generación ENLITEN. Un solo listado explícito.'),

      ('Dunlop'     ,'SP346'                 ,'315/70R22.5 156/150L',null,null      ,true ,true ,null,
       'https://www.farmtyresni.com/product-page/315-70r22-5-dunlop-sp346-156-150l',
       'https://news.goodyear.eu/ready-for-whatevers-ahead---dunlop-launches-new-on-road-truck-tyre-range/', null),

      ('Dunlop'     ,'SP346'                 ,'385/65R22.5 160K'    ,null,'158L'    ,true ,null ,null,
       'https://www.truckbandenmarkt.com/en/truck-tires/dunlop-385-65r22-5-sp-346-160k-158l/',
       'https://e-catalog.com/DUNLOP-SP346-385-65-R22-5-160K.htm', null),

      ('Dunlop'     ,'SP346+'                ,'315/70R22.5 156/150L',null,null      ,true ,true ,null,
       'https://shop.fastparts.is/en/product/dekk-31570r22.5-dunlop-sp346-hl-156150l-48905',
       'https://e-partstruck.com/produs/truck-tires-dunlop-315-70r22-5-sp346/',
       'Los listados la dan como SP346+ HL: el 156/150L es el índice de la versión High Load.'),

      ('Dunlop'     ,'SP446'                 ,'315/70R22.5 154/150L',null,'152/148M',true ,true ,null,
       'https://www.truckbandenmarkt.com/en/truck-tires/dunlop-315-70r22-5-sp-446-154-150l-152-148m/',
       'https://www.rsu.de/p/dunlop-sp-446-315-70r22-5-154l-150l-152m-150m-250976', null),

      ('Dunlop'     ,'SP246'                 ,'385/65R22.5 164K'    ,20  ,'158L'    ,true ,null ,null,
       'https://www.heuver.com/webshop/product/b38565225duk24600/385-65r22-5-dunlop-sp246-164k-158l-20pr-hl-tl-m-s',
       'https://www.tyres-outlet.co.uk/product/dunlop/sp-246/385-65-r22.5/r-332729', 'Versión HL (High Load).'),

      ('Dunlop'     ,'SP246'                 ,'385/55R22.5 160K'    ,null,'158L'    ,null ,null ,null,
       'https://www.tyres-outlet.co.uk/product/dunlop/sp-246/385-55-r22.5/r-330245',
       null, 'Un solo listado explícito.'),

      ('Dunlop'     ,'SP282'                 ,'385/65R22.5 160J'    ,20  ,'158K'    ,true ,null ,null,
       'https://www.heuver.com/product/b38565225duj28200/385-65r22-5-dunlop-sp282-160j-158k-tl-m-s',
       'https://www.tiremart.com/dunlop-sp-282-385-65r22-5-160j-l-20-ply-as-a-s-all-season-tire/', null)
    ) as t(marca, modelo, medida, ply, secundario, m_s, pmsf, prof, fuente1, fuente2, notas)
  loop
    select mo.id into v_modelo
      from tc_cat_modelos_neumatico mo
      join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
     where ma.nombre = f.marca and mo.nombre = f.modelo;

    select id into v_size from tyre_sizes where referencia_completa = f.medida;

    if v_modelo is null then
      raise exception 'No existe el modelo % de %. ¿Falta el lote de la marca?', f.modelo, f.marca;
    end if;
    if v_size is null then
      raise exception 'No existe la medida %', f.medida;
    end if;

    insert into tc_referencias_neumatico
      (modelo_id, tyre_size_id, referencia_completa, ply, marcado_secundario,
       m_s, tres_pmsf, profundidad_dibujo_mm,
       verificacion_estado, fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
    values
      (v_modelo, v_size, f.marca || ' ' || f.modelo || ' ' || f.medida, f.ply, f.secundario,
       f.m_s, f.pmsf, f.prof,
       'distribuidor_web', f.fuente1, f.fuente2, f.notas)
    on conflict (modelo_id, tyre_size_id) do update set
      referencia_completa      = excluded.referencia_completa,
      ply                      = coalesce(excluded.ply, tc_referencias_neumatico.ply),
      marcado_secundario       = coalesce(excluded.marcado_secundario, tc_referencias_neumatico.marcado_secundario),
      m_s                      = coalesce(excluded.m_s, tc_referencias_neumatico.m_s),
      tres_pmsf                = coalesce(excluded.tres_pmsf, tc_referencias_neumatico.tres_pmsf),
      profundidad_dibujo_mm    = coalesce(excluded.profundidad_dibujo_mm, tc_referencias_neumatico.profundidad_dibujo_mm),
      -- Si alguien ya la verificó contra el databook, no se le pisa el estado.
      verificacion_estado      = case when tc_referencias_neumatico.verificacion_estado = 'verificado'
                                      then 'verificado' else 'distribuidor_web' end,
      fuente_oficial_url       = coalesce(tc_referencias_neumatico.fuente_oficial_url, excluded.fuente_oficial_url),
      fuente_corroboracion_url = coalesce(tc_referencias_neumatico.fuente_corroboracion_url, excluded.fuente_corroboracion_url),
      verificacion_notas       = coalesce(excluded.verificacion_notas, tc_referencias_neumatico.verificacion_notas);
  end loop;
end $$;

-- ── 4. Recuento, y un aviso de lo que sigue faltando ────────────────────────
do $$
declare
  n_ref      int;
  n_sin_ref  int;
begin
  select count(*) into n_ref
    from tc_referencias_neumatico r
    join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
    join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
   where ma.nombre in ('Bridgestone','Dunlop');

  if n_ref < 16 then
    raise exception 'Solo han entrado % referencias de Bridgestone/Dunlop, se esperaban 16', n_ref;
  end if;

  select count(*) into n_sin_ref
    from tc_cat_modelos_neumatico mo
    join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
   where ma.nombre in ('Bridgestone','Dunlop')
     and not exists (select 1 from tc_referencias_neumatico r where r.modelo_id = mo.id);

  raise notice 'Bridgestone + Dunlop: % referencias cargadas. Siguen sin ninguna % modelos, a la espera de ficha oficial.', n_ref, n_sin_ref;
  raise notice 'Todas nacen como verificacion_estado = ''distribuidor_web'': repasar el indice de carga contra el databook.';
end $$;

comment on column tc_referencias_neumatico.verificacion_estado is
  'De dónde sale el dato: ''verificado'' (ficha oficial del fabricante), ''distribuidor_web'' (listado de distribuidor, pendiente de contrastar) o null (sin comprobar).';
