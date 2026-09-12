-- ============================================================
-- SEA TyreControl — Presencia en bases (independiente del proveedor).
--
-- Guarda, por vehículo, si está DENTRO de una base y cuándo se supo. La
-- calcula `BasePresenceService` del Integration Hub a partir de la última
-- posición que da el proveedor de telemática (Movertis hoy, cualquiera
-- mañana), comparada con la geo-zona de las delegaciones
-- (`tc_delegaciones.base_lat/base_lng/base_radio_m`).
--
-- ── Por qué una tabla nueva y no `tc_vehiculo_webfleet_estado` ──────────────
--
-- Porque esa tabla tiene un escritor, `server/webfleetSync.ts`, que recorre
-- TODOS los vehículos activos de TODAS las empresas y marca
-- `sin_dispositivo` al que no tiene `webfleet_vehicle_id`. Los vehículos de un
-- cliente de Movertis no lo tienen, así que escribir ahí desde este barrido
-- monta dos escritores peleándose por la misma fila: cada ciclo de Webfleet
-- borraría lo que acabara de calcular Movertis. Se arreglaría tocando
-- `webfleetSync.ts`, y Webfleet está en producción y no se toca.
--
-- Los estados tampoco son los mismos. Webfleet guarda
-- `en_base|otra_base|en_ruta|sin_conexion|sin_dispositivo`, que mezcla dónde
-- está el vehículo con qué le pasa al equipo. Aquí se separan: el estado dice
-- lo que se sabe de la POSICIÓN, y `STALE_POSITION` —hay posición pero es
-- vieja— no se colapsa en «en ruta». En la flota real medida, el 21 % de los
-- equipos lleva más de un día sin emitir: llamarlos «en ruta» sería inventar.
--
-- Las geo-zonas SÍ se reutilizan: son las mismas de siempre, ya renombradas a
-- `base_lat` / `base_lng` / `base_radio_m` en
-- tyrecontrol_bases_geozona_renombrado.sql, porque el dato no es de Webfleet,
-- es de la base, y ahora lo lee cualquier proveedor.
-- ============================================================

create table if not exists tc_vehiculo_presencia_base (
  vehiculo_id     uuid primary key references tc_vehiculos(id) on delete cascade,
  empresa_id      uuid not null references tc_empresas(id) on delete cascade,
  estado          text not null
                    check (estado in ('IN_BASE','OUTSIDE_BASES','STALE_POSITION',
                                      'NO_POSITION','INVALID_POSITION')),
  -- Base detectada. Null cuando no está en ninguna o no se sabe.
  delegacion_id   uuid references tc_delegaciones(id) on delete set null,
  -- Si esa base es la delegación asignada al vehículo. Para revisar un
  -- neumático da igual, pero quien organiza el taller quiere saberlo.
  es_su_base      boolean,
  -- Distancia al centro de la base detectada, o a la más cercana si está fuera.
  distancia_m     numeric,
  -- Antigüedad de la posición en minutos EN EL MOMENTO DEL CÁLCULO. Se guarda
  -- además de `posicion_at` porque es lo que se enseña, y recalcularla en cada
  -- consulta daría números que cambian sin que nadie haya barrido nada.
  antiguedad_min  int,
  lat             numeric,
  lng             numeric,
  velocidad_kmh   numeric,
  -- Instante de la posición según el proveedor. NO es cuándo se preguntó.
  posicion_at     timestamptz,
  -- Desde cuándo está en ESTA base, mientras no cambie. Es lo que contesta
  -- «¿cuánto lleva parado aquí?», que es la pregunta del arco del CheckPoint:
  -- si el autobús sigue en la base desde antes de la medición, su odómetro de
  -- ahora vale para entonces.
  entrada_base_at timestamptz,
  -- Procedencia, para poder auditar de dónde salió el dato.
  proveedor       text,
  cuenta          text,
  externo         text,
  -- Por qué no hay posición, cuando no hay: 'sin_enlace' (falta vincular el
  -- vehículo con el proveedor) o 'proveedor_sin_dato' (está vinculado y el
  -- proveedor no dice nada de él). Distinguirlo evita llamar al proveedor
  -- cuando lo que falta es acabar la conciliación.
  motivo          text check (motivo in ('sin_enlace','proveedor_sin_dato')),
  calculado_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_presencia_base_empresa    on tc_vehiculo_presencia_base (empresa_id);
create index if not exists idx_presencia_base_estado     on tc_vehiculo_presencia_base (empresa_id, estado);
create index if not exists idx_presencia_base_delegacion on tc_vehiculo_presencia_base (delegacion_id);

comment on table tc_vehiculo_presencia_base is
  'Última presencia conocida de cada vehículo respecto a las bases (delegaciones con geo-zona). La calcula el Integration Hub desde el proveedor de telemática del cliente. No es seguimiento GPS: solo sirve para saber a quién se puede revisar sin sacarlo de servicio.';

-- ── RLS: cada cliente ve su flota; escribe el servicio (service_role) ───────
alter table tc_vehiculo_presencia_base enable row level security;

drop policy if exists presencia_base_select on tc_vehiculo_presencia_base;
create policy presencia_base_select on tc_vehiculo_presencia_base for select
  using ( tc_puede_ver_empresa(empresa_id) );

-- La escritura es del barrido, que corre con la clave de servicio y no pasa
-- por RLS. Se deja también a los administradores para poder corregir a mano.
drop policy if exists presencia_base_write on tc_vehiculo_presencia_base;
create policy presencia_base_write on tc_vehiculo_presencia_base for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );
