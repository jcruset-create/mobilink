-- ============================================================================
-- Cuándo pasó el barrido de presencia por última vez.
--
-- ── Por qué una tabla para un dato tan tonto ────────────────────────────────
--
-- Hasta ahora el instante del barrido se guardaba 717 veces: una copia en el
-- `calculado_at` de cada fila de `tc_vehiculo_presencia_base`. El panel lo lee
-- como `max(calculado_at)` de las filas que ve (`presencia/router.ts`), y es
-- lo que enseña como «último barrido» —y lo que permite decir «no se ha
-- barrido nunca» cuando la tabla está vacía, que es como se encontró el fallo
-- que la dejó así—.
--
-- Mientras el barrido reescribiera las 717 filas en cada vuelta, eso salía
-- gratis. Deja de salir gratis en cuanto el barrido se salta las filas que no
-- han cambiado, que es justo lo que se quiere: medido el 10/11/2026, de los
-- 717 vehículos solo 356 traen posición más fresca que el intervalo de diez
-- minutos. Los otros 361 —155 de ellos dormidos, con posición de hace más de
-- una hora— se reescribían para no decir nada nuevo.
--
-- Si se saltan y el instante del barrido vive solo en ellas, pasa esto: de
-- madrugada, con la flota entera parada, puede no cambiar ninguna fila en
-- horas, y a las seis de la mañana la pantalla diría que el último barrido fue
-- a las diez de la noche. El barrido habría corrido setenta veces.
--
-- El dato es del BARRIDO, no de cada vehículo. Aquí tiene su sitio: una fila
-- por empresa, una escritura por vuelta en vez de 717.
--
-- ── Qué NO es ──────────────────────────────────────────────────────────────
--
-- No es un histórico. Se pisa en cada vuelta a propósito: para saber cuándo se
-- barrió y qué dio, no para reconstruir la serie. El histórico de estancias ya
-- existe y es `tc_vehiculo_presencia_historico`.
-- ============================================================================

create table if not exists tc_presencia_barrido (
  empresa_id     uuid primary key references tc_empresas(id) on delete cascade,

  -- El instante del barrido. Es el mismo `calculado_at` que se copiaba en cada
  -- fila, y lo que el panel enseña como «último barrido».
  calculado_at   timestamptz not null,

  -- Cuántos vehículos miró y cuántas filas tuvo que escribir de verdad. El
  -- segundo es el que deja ver, sin entrar en la base, cuánto está ahorrando
  -- saltarse las que no cambian: en una flota parada tiene que bajar mucho.
  vehiculos      integer not null default 0 check (vehiculos >= 0),
  escritas       integer not null default 0 check (escritas >= 0),

  actualizado_at timestamptz not null default now()
);

comment on table tc_presencia_barrido is
  'Cuándo corrió por última vez el barrido de presencia de cada empresa, y qué dio. Una fila por empresa, pisada en cada vuelta: el instante del barrido es del barrido y no de cada uno de los 717 vehículos, que es donde se guardaba antes.';
comment on column tc_presencia_barrido.calculado_at is
  'Instante del barrido. Es lo que el panel enseña como «último barrido»; antes salía de max(calculado_at) de las filas de tc_vehiculo_presencia_base.';
comment on column tc_presencia_barrido.escritas is
  'Filas que el barrido tuvo que escribir de verdad, de las `vehiculos` que miró. La diferencia son las que no habían cambiado.';

-- ── RLS: el mismo criterio que las dos tablas de presencia ─────────────────

alter table tc_presencia_barrido enable row level security;

drop policy if exists presencia_barrido_select on tc_presencia_barrido;
create policy presencia_barrido_select on tc_presencia_barrido for select
  using ( tc_puede_ver_empresa(empresa_id) );

-- Escribe el barrido, que corre con la clave de servicio y no pasa por RLS.
-- Se deja también a los administradores para poder corregir a mano.
drop policy if exists presencia_barrido_write on tc_presencia_barrido;
create policy presencia_barrido_write on tc_presencia_barrido for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );

-- ── Arranque: que la pantalla no diga «nunca» el día del despliegue ────────
--
-- Si la tabla naciera vacía, entre el despliegue y el primer barrido el panel
-- diría «no se ha barrido nunca» aunque haya 717 filas de presencia delante.
-- Se siembra con lo que ya saben esas filas, que es exactamente el dato que
-- esta tabla viene a sustituir.

insert into tc_presencia_barrido (empresa_id, calculado_at, vehiculos, escritas)
select empresa_id, max(calculado_at), count(*), 0
  from tc_vehiculo_presencia_base
 where calculado_at is not null
 group by empresa_id
on conflict (empresa_id) do nothing;

-- ── Comprobación ───────────────────────────────────────────────────────────

select (select count(*) from tc_presencia_barrido)                as empresas_sembradas,
       (select max(calculado_at) from tc_presencia_barrido)       as ultimo_barrido;
