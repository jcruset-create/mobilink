-- ============================================================
-- Mobilink TyreControl — El parte de servicio Conti360
--
-- QUÉ ES ESTO
--
-- El parte de servicio que se entrega al cliente (Parte_de_Servicio_conti360_
-- SEA_III_2019.pdf) pide cosas que TyreControl todavía no guardaba. Esta
-- migración añade solo esas, y las añade DONDE YA VIVE EL PARTE: la
-- intervención (tc_intervenciones), que ya es el parte de trabajo, ya tiene
-- número, ya cronometra y ya la puede escribir un operador.
--
-- No se crea ninguna tabla "parte": sería un segundo sitio donde vive la
-- verdad de lo que se hizo en un vehículo.
--
-- LO QUE FALTABA, comparando el formulario impreso con la base de datos
--
--  1. LOS SERVICIOS FACTURABLES. El parte tiene once líneas con cantidad
--     —equilibrados, alineación, válvulas, horas de oficial de 1ª…— y eso es
--     justo lo que se factura. Había tipos de reparación, pero no líneas con
--     cantidad. Es lo más importante de esta migración.
--
--  2. LAS FIRMAS. Del cliente (con nombre y DNI) y del técnico. Se firman en
--     la tablet y la imagen va al bucket de fotos que ya existe; aquí solo se
--     guarda su URL. No se monta otro sistema de archivos.
--
--  3. LOS TIEMPOS DEL MECÁNICO. La intervención ya cronometra el servicio
--     (inicio_at, fin_at, pausas), pero el parte distingue además cuándo
--     empieza y acaba el MECÁNICO y cuántos kilómetros recorrió. En un
--     servicio móvil eso no es un detalle: es lo que se cobra.
--
--  4. DÓNDE SE HIZO: taller, instalaciones de la flota o carretera.
--
--  5. SEIS MOTIVOS Y CUATRO DESTINOS que el formulario tiene y el catálogo no.
--     Van al catálogo general, no a una lista privada del parte: un neumático
--     retirado por "rodaje sin presión" lo está en todo el sistema, no solo en
--     el papel.
--
-- LO QUE NO HACE
--
-- No mapea posiciones. Se usa el esquema de Mobilink (el tipo de vehículo y su
-- plano), no la numeración de Conti360: es el que corresponde a la flota real
-- y el que ya tienen las mediciones. Inventar una equivalencia colocaría
-- lecturas en la rueda equivocada.
--
-- Un parte, un vehículo. Tractora y remolque van en dos partes, que es como
-- TyreControl guarda los vehículos y como se ha decidido.
--
-- Idempotente.
-- ============================================================

-- ── 1. Servicios facturables ────────────────────────────────────────────────
create table if not exists tc_cat_servicios (
  codigo    text primary key,
  nombre    text not null,
  -- Qué se cuenta: unidades, horas o kilómetros. El parte mezcla las tres y
  -- sumarlas como si fueran lo mismo daría un total sin sentido.
  unidad    text not null default 'unidad' check (unidad in ('unidad','hora','km')),
  orden     int not null default 100,
  activo    boolean not null default true
);

insert into tc_cat_servicios (codigo, nombre, unidad, orden) values
  ('desmontar_montar_cubierta','Desmontar/Montar cubierta','unidad',10),
  ('quitar_poner_rueda','Quitar y poner rueda del vehículo','unidad',20),
  ('equilibrado','Equilibrados','unidad',30),
  ('pinchazo','Pinchazo','unidad',40),
  ('rayados','Rayados','unidad',50),
  ('alineacion_standard','Alineación de dirección (standard)','unidad',60),
  ('alineacion_compleja','Alineación de dirección (compleja)','unidad',70),
  ('salida_servicio_movil','Salida de servicio móvil','unidad',80),
  ('km_recorridos','Kilómetros recorridos','km',90),
  ('horas_oficial_1a','Horas de oficial de 1ª (servicio móvil)','hora',100),
  ('valvulas','Válvulas','unidad',110),
  ('alargaderas','Alargaderas','unidad',120)
on conflict (codigo) do nothing;

-- Las líneas de servicio de cada parte.
create table if not exists tc_intervencion_servicios (
  id              uuid primary key default gen_random_uuid(),
  intervencion_id uuid not null references tc_intervenciones(id) on delete cascade,
  servicio        text not null references tc_cat_servicios(codigo) on delete restrict,
  -- Numeric y no int: las horas se cobran en fracciones (1,5 h).
  cantidad        numeric not null check (cantidad > 0),
  observaciones   text,
  created_at      timestamptz not null default now(),
  -- Una línea por servicio y parte: dos "equilibrados" en el mismo parte son
  -- una cantidad, no dos filas, o el total se cuenta dos veces.
  unique (intervencion_id, servicio)
);
create index if not exists idx_interv_serv_interv on tc_intervencion_servicios (intervencion_id);

alter table tc_cat_servicios enable row level security;
alter table tc_intervencion_servicios enable row level security;

drop policy if exists cat_serv_sel on tc_cat_servicios;
create policy cat_serv_sel on tc_cat_servicios for select using ( auth.uid() is not null );
drop policy if exists cat_serv_wr on tc_cat_servicios;
create policy cat_serv_wr on tc_cat_servicios for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

-- Las líneas siguen el permiso de SU intervención: quien puede escribir el
-- parte puede escribir lo que se facturó en él.
drop policy if exists interv_serv_sel on tc_intervencion_servicios;
create policy interv_serv_sel on tc_intervencion_servicios for select using (
  exists (select 1 from tc_intervenciones i
           where i.id = intervencion_id and tc_puede_ver_empresa(i.empresa_id)));
drop policy if exists interv_serv_wr on tc_intervencion_servicios;
create policy interv_serv_wr on tc_intervencion_servicios for all using (
  exists (select 1 from tc_intervenciones i where i.id = intervencion_id
           and (tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(i.empresa_id)))
) with check (
  exists (select 1 from tc_intervenciones i where i.id = intervencion_id
           and (tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(i.empresa_id))));

-- ── 2. Firmas, tiempos del mecánico y lugar ─────────────────────────────────
alter table tc_intervenciones
  -- Firmas: se dibujan en la tablet y la imagen va al bucket que ya existe.
  add column if not exists firma_cliente_url    text,
  add column if not exists firma_cliente_nombre text,
  add column if not exists firma_cliente_dni    text,
  add column if not exists firma_tecnico_url    text,
  add column if not exists firma_tecnico_nombre text,
  add column if not exists firmado_at           timestamptz,
  -- El mecánico tiene su propio reloj: en un servicio móvil, el tiempo del
  -- mecánico y el del servicio no son el mismo, y es el que se cobra.
  add column if not exists mecanico_inicio_at   timestamptz,
  add column if not exists mecanico_fin_at      timestamptz,
  add column if not exists mecanico_km          numeric,
  add column if not exists lugar_servicio       text,
  add column if not exists orden_flota          text;

alter table tc_intervenciones drop constraint if exists chk_interv_lugar;
alter table tc_intervenciones add constraint chk_interv_lugar
  check (lugar_servicio is null or lugar_servicio in ('taller','flota','carretera'));

-- ── 3. Los motivos y destinos que el formulario tiene y el catálogo no ──────
--
-- Van al catálogo general a propósito: un neumático retirado por "rodaje sin
-- presión" lo está en todo el sistema, no solo en el papel de ese día.
-- NO se usa "on conflict" aquí, y no es un descuido. tc_cat_motivos no tiene
-- único el código: tiene unique (codigo, tipo_operacion), y estos motivos son
-- comunes a todas las operaciones, o sea tipo_operacion NULL. En un índice
-- único de PostgreSQL dos NULL no son iguales, así que ON CONFLICT no los
-- reconocería y volver a pasar la migración duplicaría las siete filas.
insert into tc_cat_motivos (codigo, nombre, tipo_operacion, orden)
select v.codigo, v.nombre, null::text, v.orden
  from (values
    ('cambio_posicion','Cambio de posición / Permutación',85),
    ('dano_golpe','Daño por golpe',86),
    ('cortes','Cortes',87),
    ('roces_flanco','Roces en flanco',88),
    ('dano_banda_rodadura','Daño en banda de rodadura',89),
    ('rodaje_sin_presion','Rodaje sin presión',90),
    ('robo','Robo',91)
  ) as v(codigo, nombre, orden)
 where not exists (select 1 from tc_cat_motivos m where m.codigo = v.codigo);

insert into tc_cat_destinos (codigo, nombre, estado_resultante, orden) values
  ('comprada_taller','Comprada por el taller','vendido',90),
  ('almacen_flota','A almacén de la flota','stock_usado',91),
  ('carcasa_continental','Carcasa a Continental','pendiente_recauchutado',92),
  ('reclamacion','Reclamación','cuarentena',93),
  ('almacen_taller','Almacenar en el taller','stock_usado',94)
on conflict (codigo) do nothing;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare v_n int; v_falta text;
begin
  -- DURO: las doce líneas del formulario tienen que estar. Si falta una, el
  -- parte sale con un servicio que no se puede facturar.
  select string_agg(c, ', ') into v_falta from unnest(array[
    'desmontar_montar_cubierta','quitar_poner_rueda','equilibrado','pinchazo','rayados',
    'alineacion_standard','alineacion_compleja','salida_servicio_movil','km_recorridos',
    'horas_oficial_1a','valvulas','alargaderas']) c
   where not exists (select 1 from tc_cat_servicios s where s.codigo = c);
  if v_falta is not null then
    raise exception 'Faltan servicios del parte en el catálogo: %', v_falta;
  end if;

  -- DURO: las diez razones de sustitución del formulario.
  select string_agg(c, ', ') into v_falta from unnest(array[
    'desgaste','cambio_posicion','pinchazo','dano_golpe','desgaste_irregular',
    'cortes','roces_flanco','dano_banda_rodadura','rodaje_sin_presion','robo']) c
   where not exists (select 1 from tc_cat_motivos m where m.codigo = c);
  if v_falta is not null then
    raise exception 'Faltan razones de sustitución del parte: %', v_falta;
  end if;

  -- DURO: los siete destinos del formulario.
  select string_agg(c, ', ') into v_falta from unnest(array[
    'comprada_taller','almacen_flota','carcasa_continental','desechado',
    'reclamacion','almacen_taller']) c
   where not exists (select 1 from tc_cat_destinos d where d.codigo = c);
  if v_falta is not null then
    raise exception 'Faltan destinos del parte: %', v_falta;
  end if;

  -- DURO: no se puede facturar dos veces el mismo servicio en un parte.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'tc_intervencion_servicios'::regclass and contype = 'u') then
    raise exception 'Falta el unique (intervencion_id, servicio): el total se contaría dos veces';
  end if;

  -- DURO: la cantidad tiene que ser positiva.
  begin
    insert into tc_intervencion_servicios (intervencion_id, servicio, cantidad)
    values ('00000000-0000-0000-0000-000000000000', 'equilibrado', 0);
    raise exception 'Se ha aceptado una cantidad de 0: falta el check';
  exception
    when check_violation then null;          -- lo esperado
    when foreign_key_violation then null;    -- la intervención falsa, da igual
  end;

  select count(*) into v_n from tc_cat_servicios where activo;
  raise notice 'OK: % servicios facturables, firmas, tiempos del mecánico y lugar del servicio. Motivos y destinos del parte completos.', v_n;
end $$;
