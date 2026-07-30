-- ============================================================
-- SEA TyreControl - CATALOGO DE MARCAS DE VEHICULO
--
-- Hasta ahora tc_vehiculos.marca era texto libre (de ahi que convivan
-- 'IVECO', 'MERCEDES' y 'Peugeot'). Ahora hay catalogo con logo y, como
-- una misma marca sirve para varios tipos (Mercedes-Benz es tractora,
-- camion, furgoneta y autobus), la relacion marca-tipo va en su propia
-- tabla en vez de una columna 'tipo' en la marca.
--
-- Se mantiene tc_vehiculos.marca (texto) ademas del nuevo marca_id: los
-- informes y la importacion de Excel leen ese texto.
-- ============================================================

create table if not exists tc_cat_marcas_vehiculo (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  logo_url    text,
  pais_origen text,
  orden       int not null default 100,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists tc_cat_marcas_vehiculo_tipos (
  marca_id        uuid not null references tc_cat_marcas_vehiculo(id) on delete cascade,
  tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id) on delete cascade,
  primary key (marca_id, tipo_vehiculo_id)
);
create index if not exists idx_marcas_veh_tipos_tipo on tc_cat_marcas_vehiculo_tipos (tipo_vehiculo_id);

alter table tc_vehiculos add column if not exists marca_id uuid references tc_cat_marcas_vehiculo(id);

-- RLS: leer cualquier autenticado, escribir solo superadmin (igual que el
-- catalogo de marcas de neumatico).
alter table tc_cat_marcas_vehiculo enable row level security;
alter table tc_cat_marcas_vehiculo_tipos enable row level security;

drop policy if exists marcas_veh_select on tc_cat_marcas_vehiculo;
create policy marcas_veh_select on tc_cat_marcas_vehiculo for select to authenticated using (true);
drop policy if exists marcas_veh_write on tc_cat_marcas_vehiculo;
create policy marcas_veh_write on tc_cat_marcas_vehiculo for all to authenticated
  using (tc_is_superadmin()) with check (tc_is_superadmin());

drop policy if exists marcas_veh_tipos_select on tc_cat_marcas_vehiculo_tipos;
create policy marcas_veh_tipos_select on tc_cat_marcas_vehiculo_tipos for select to authenticated using (true);
drop policy if exists marcas_veh_tipos_write on tc_cat_marcas_vehiculo_tipos;
create policy marcas_veh_tipos_write on tc_cat_marcas_vehiculo_tipos for all to authenticated
  using (tc_is_superadmin()) with check (tc_is_superadmin());

-- ── Semillas ────────────────────────────────────────────────
insert into tc_cat_marcas_vehiculo (nombre, pais_origen, orden) values
  ('MAN','Alemania',10), ('Scania','Suecia',10), ('Volvo','Suecia',10),
  ('Mercedes-Benz','Alemania',10), ('DAF','Paises Bajos',10), ('Iveco','Italia',10),
  ('Renault Trucks','Francia',10), ('Ford Trucks','Turquia',20),
  ('Krone','Alemania',10), ('Schmitz Cargobull','Alemania',10), ('Lecitrailer','Espana',10),
  ('Kogel','Alemania',20), ('Schwarzmuller','Austria',20), ('Lecinena','Espana',20),
  ('Guillen','Espana',20), ('Montenegro','Espana',20), ('Benalu','Francia',30),
  ('Wielton','Polonia',30), ('Fruehauf','Francia',30),
  ('Renault','Francia',10), ('Peugeot','Francia',10), ('Citroen','Francia',10),
  ('Ford','EE.UU.',10), ('Fiat','Italia',10), ('Volkswagen','Alemania',10),
  ('Opel','Alemania',20), ('Nissan','Japon',20), ('Toyota','Japon',20),
  ('Irizar','Espana',10), ('Setra','Alemania',20), ('Iveco Bus','Italia',20),
  ('VDL','Paises Bajos',30), ('Otokar','Turquia',30), ('Sunsundegui','Espana',30),
  ('Seat','Espana',10), ('BMW','Alemania',20), ('Audi','Alemania',20),
  ('Kia','Corea del Sur',20), ('Hyundai','Corea del Sur',20), ('Dacia','Rumania',20),
  ('Skoda','Chequia',20)
on conflict (nombre) do nothing;

-- Las marcas ya escritas a mano en los vehiculos (IVECO, MERCEDES, RENAULT,
-- Peugeot...) se enlazan por nombre normalizado para no duplicarlas.
insert into tc_cat_marcas_vehiculo (nombre, orden)
select distinct initcap(trim(v.marca)), 50
  from tc_vehiculos v
 where coalesce(trim(v.marca), '') <> ''
   and not exists (
     select 1 from tc_cat_marcas_vehiculo m
      where upper(replace(m.nombre, '-', ' ')) = upper(replace(trim(v.marca), '-', ' '))
        or upper(m.nombre) like upper(trim(v.marca)) || '%'
   )
on conflict (nombre) do nothing;

-- Relacion marca ↔ tipo de vehiculo.
with pares(marca, tipo) as (values
  ('MAN','tractora'), ('Scania','tractora'), ('Volvo','tractora'), ('Mercedes-Benz','tractora'),
  ('DAF','tractora'), ('Iveco','tractora'), ('Renault Trucks','tractora'), ('Ford Trucks','tractora'),
  ('MAN','camion_2_ejes'), ('Scania','camion_2_ejes'), ('Volvo','camion_2_ejes'), ('Mercedes-Benz','camion_2_ejes'),
  ('DAF','camion_2_ejes'), ('Iveco','camion_2_ejes'), ('Renault Trucks','camion_2_ejes'), ('Ford Trucks','camion_2_ejes'),
  ('MAN','camion_3_ejes'), ('Scania','camion_3_ejes'), ('Volvo','camion_3_ejes'), ('Mercedes-Benz','camion_3_ejes'),
  ('DAF','camion_3_ejes'), ('Iveco','camion_3_ejes'), ('Renault Trucks','camion_3_ejes'), ('Ford Trucks','camion_3_ejes'),
  ('Krone','semirremolque'), ('Schmitz Cargobull','semirremolque'), ('Lecitrailer','semirremolque'),
  ('Kogel','semirremolque'), ('Schwarzmuller','semirremolque'), ('Lecinena','semirremolque'),
  ('Guillen','semirremolque'), ('Montenegro','semirremolque'), ('Benalu','semirremolque'),
  ('Wielton','semirremolque'), ('Fruehauf','semirremolque'),
  ('Krone','remolque'), ('Schmitz Cargobull','remolque'), ('Lecitrailer','remolque'),
  ('Kogel','remolque'), ('Schwarzmuller','remolque'), ('Lecinena','remolque'),
  ('Guillen','remolque'), ('Montenegro','remolque'), ('Benalu','remolque'),
  ('Wielton','remolque'), ('Fruehauf','remolque'),
  ('Mercedes-Benz','furgoneta'), ('Renault','furgoneta'), ('Peugeot','furgoneta'), ('Citroen','furgoneta'),
  ('Ford','furgoneta'), ('Iveco','furgoneta'), ('Fiat','furgoneta'), ('Volkswagen','furgoneta'),
  ('Opel','furgoneta'), ('Nissan','furgoneta'), ('Toyota','furgoneta'),
  ('Mercedes-Benz','autobus'), ('MAN','autobus'), ('Scania','autobus'), ('Volvo','autobus'),
  ('Irizar','autobus'), ('Setra','autobus'), ('Iveco Bus','autobus'), ('VDL','autobus'),
  ('Otokar','autobus'), ('Sunsundegui','autobus'),
  ('Mercedes-Benz','autocar'), ('MAN','autocar'), ('Scania','autocar'), ('Volvo','autocar'),
  ('Irizar','autocar'), ('Setra','autocar'), ('Iveco Bus','autocar'), ('VDL','autocar'),
  ('Otokar','autocar'), ('Sunsundegui','autocar'),
  ('Seat','turismo'), ('Volkswagen','turismo'), ('Renault','turismo'), ('Peugeot','turismo'),
  ('Citroen','turismo'), ('Ford','turismo'), ('Opel','turismo'), ('Toyota','turismo'),
  ('BMW','turismo'), ('Mercedes-Benz','turismo'), ('Audi','turismo'), ('Kia','turismo'),
  ('Hyundai','turismo'), ('Dacia','turismo'), ('Nissan','turismo'), ('Skoda','turismo'), ('Fiat','turismo')
)
insert into tc_cat_marcas_vehiculo_tipos (marca_id, tipo_vehiculo_id)
select m.id, t.id
  from pares p
  join tc_cat_marcas_vehiculo m on m.nombre = p.marca
  join tc_tipos_vehiculo t on t.nombre = p.tipo
on conflict do nothing;

-- Rellenar marca_id de los vehiculos que ya tenian la marca escrita.
update tc_vehiculos v set marca_id = m.id
  from tc_cat_marcas_vehiculo m
 where v.marca_id is null
   and coalesce(trim(v.marca), '') <> ''
   and upper(replace(m.nombre, '-', ' ')) = upper(replace(trim(v.marca), '-', ' '));
