-- Histórico diario de los contadores del aparato de telemática.
--
-- ── Por qué existe esta tabla ──────────────────────────────────────────────
--
-- El equipo de Movertis está enchufado al bus del vehículo y da contadores
-- ACUMULADOS: litros consumidos desde que se instaló, horas de motor,
-- odómetro, y el peso por eje de ese instante. Pero `showvehicles` devuelve el
-- valor de AHORA: no hay histórico que pedirle.
--
-- Sin guardar, esos números no contestan ninguna pregunta útil. Nadie quiere
-- saber cuánto ha gastado un autobús en cinco años: quiere el mes pasado. Con
-- una foto al día, el consumo de un periodo es la resta de dos fotos — lo
-- mismo que ya se hace con el odómetro para el kilometraje mensual.
--
-- Las restas y sus cotas (un contador que baja, un motor que anda más horas
-- que el reloj) están en server/tyrecontrol/lecturasAparato/calculo.ts. Aquí
-- solo se guarda lo que vino.
--
-- UNA FILA POR VEHÍCULO Y DÍA. Si un día se lee dos veces, la segunda pisa a
-- la primera: la foto buena es la última, y dos fotos del mismo día harían
-- que el tramo de ese día valiera la mitad.
--
-- No toca ninguna tabla existente. Idempotente: se puede pegar dos veces.

create table if not exists tc_lecturas_aparato (
  vehiculo_id   uuid not null references tc_vehiculos(id) on delete cascade,
  empresa_id    uuid not null,
  -- Fecha LOCAL de la lectura (Europe/Madrid), no UTC: el día es el del
  -- taller, y una lectura de las 03:00 en UTC caería en el día anterior.
  fecha         date not null,
  leido_en      timestamptz not null default now(),
  -- Los contadores. Todos pueden faltar: un aparato sin bus solo da posición.
  horas_motor   numeric,
  consumido_l   numeric,
  odometro_km   numeric,
  -- El peso de ese instante, no un máximo del día.
  peso_total_kg numeric,
  ejes          jsonb,
  -- La lectura entera puesta en claro, para no tener que volver a pedirla si
  -- mañana interesa un contador que hoy no se mira.
  lectura       jsonb,
  primary key (vehiculo_id, fecha)
);

create index if not exists tc_lecturas_aparato_empresa_fecha
  on tc_lecturas_aparato (empresa_id, fecha desc);

alter table tc_lecturas_aparato enable row level security;

-- Lo escribe el servidor (service_role, que se salta RLS). Leer, cualquiera
-- que pueda ver la empresa: el mismo criterio que el resto de TyreControl.
drop policy if exists tc_lecturas_aparato_select on tc_lecturas_aparato;
create policy tc_lecturas_aparato_select on tc_lecturas_aparato for select to authenticated
  using ((select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

do $migracion$
declare v_cols int;
begin
  if to_regclass('public.tc_lecturas_aparato') is null then
    raise exception 'No se ha creado tc_lecturas_aparato';
  end if;
  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tc_lecturas_aparato'
     and column_name in ('horas_motor', 'consumido_l', 'odometro_km', 'peso_total_kg', 'ejes', 'lectura');
  if v_cols <> 6 then
    raise exception 'A tc_lecturas_aparato le faltan columnas: % de 6', v_cols;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'tc_lecturas_aparato'
       and policyname = 'tc_lecturas_aparato_select'
  ) then
    raise exception 'Falta la política de lectura de tc_lecturas_aparato';
  end if;
  perform set_config('mobilink.resultado',
    'OK: tc_lecturas_aparato creada, con su índice por empresa y fecha y su política de lectura.', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
