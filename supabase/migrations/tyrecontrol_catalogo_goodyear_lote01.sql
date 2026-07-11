-- ============================================================
-- SEA TyreControl - Catalogo Goodyear (Fase 2, lote 01)
-- 33 referencias camion Europa (databook oficial 2021). Marca +
-- medidas + modelos. Presion/dimensiones pendientes (falta simbolo
-- de velocidad para crear tyre_sizes). Idempotente.
-- ============================================================

insert into tc_cat_marcas_neumatico (nombre) values ('Goodyear') on conflict (nombre) do nothing;

-- Medidas
insert into tc_cat_medidas_neumatico (valor) values ('295/60R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/60R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('315/70R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('385/65R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('425/65R22.5') on conflict (valor) do nothing;
insert into tc_cat_medidas_neumatico (valor) values ('445/65R22.5') on conflict (valor) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name='tc_cat_medidas_neumatico' and column_name='categoria') then
    update tc_cat_medidas_neumatico set categoria='camion' where valor in ('295/60R22.5','315/60R22.5','315/70R22.5','385/65R22.5','425/65R22.5','445/65R22.5') and (categoria is null or categoria='');
  end if;
end $$;

-- Modelos Goodyear (eje segun nomenclatura S/D/T; null si ambiguo)
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'FUELMAX D GEN-2', 'traccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'FUELMAX D PERFORMANCE', 'traccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'FUELMAX S GEN-2', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'FUELMAX S HL GEN-2', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'FUELMAX S HL PERFORMANCE', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'FUELMAX T HL', 'remolque', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX D GEN-2', 'traccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX S A HL', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX S GEN-2', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX S HL', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX S HL GEN-2', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX T', 'remolque', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX T GEN-2', 'remolque', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX T GEN-2 HL', 'remolque', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'KMAX T HL', 'remolque', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'OMNITRAC MST II', null, 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'OMNITRAC S', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'REGIONAL RHS II HL', null, 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'ULTRA GRIP MAX D', 'traccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'ULTRA GRIP MAX S', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'ULTRA GRIP MAX S HL', 'direccion', 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
insert into tc_cat_modelos_neumatico (marca_id, nombre, eje_recomendado, tipo_vehiculo)
  select id, 'URBANMAX MCA', null, 'camion' from tc_cat_marcas_neumatico where nombre='Goodyear'
  on conflict (marca_id, nombre) do update set eje_recomendado=excluded.eje_recomendado, tipo_vehiculo=excluded.tipo_vehiculo;
