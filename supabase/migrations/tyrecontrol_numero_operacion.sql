-- ============================================================
-- Mobilink TyreControl — Número de registro para las operaciones
--
-- Hoy una operación solo tiene un UUID: no se puede decir por teléfono ni
-- enseñar al cliente. Y en el histórico de un vehículo, las cuatro líneas de
-- un mismo cambio de eje (dos desmontajes y dos montajes seguidos) salen como
-- cuatro entradas sueltas, cuando fueron UNA visita al taller.
--
-- La agrupación ya existía a medias: tc_intervenciones y la columna
-- operaciones_neumaticos.intervencion_id. Lo que faltaba era el número.
--
--   OP-2026-000143 · 10/08/2026 · 16:03-16:04 · David
--     ├─ Desmontaje  NT-2026-000039  E1_IZQ  Desgaste
--     ├─ Desmontaje  NT-2026-000040  E1_DER  Desgaste
--     ├─ Montaje     NT-2026-000088  E1_DER
--     └─ Montaje     NT-2026-000089  E1_IZQ
--
-- Idempotente: se puede ejecutar varias veces sin renumerar nada.
-- ============================================================

-- ── 1. Contador y generador ─────────────────────────────────────────────────
--
-- Contador propio, NO el de los neumáticos (tc_contadores_numero_interno): si
-- compartieran serie, los números de parte saltarían de 143 a 187 y el cliente
-- preguntaría por los partes que faltan.
--
-- El `on conflict do update … returning` es atómico: dos técnicos finalizando a
-- la vez obtienen números distintos. Y al ser una tabla normal y no una
-- secuencia, si la transacción se deshace el número NO se quema: vuelve atrás
-- con ella y la serie no deja huecos.
create table if not exists tc_contadores_numero_operacion (
  anio   int primary key,
  ultimo int not null default 0
);

create or replace function tc_generar_numero_operacion()
returns text language plpgsql security definer set search_path = public as $$
declare v_anio int; v_siguiente int;
begin
  v_anio := extract(year from now())::int;
  insert into tc_contadores_numero_operacion (anio, ultimo) values (v_anio, 1)
    on conflict (anio) do update set ultimo = tc_contadores_numero_operacion.ultimo + 1
    returning ultimo into v_siguiente;
  return 'OP-' || v_anio || '-' || lpad(v_siguiente::text, 6, '0');
end $$;

-- ── 2. La columna ───────────────────────────────────────────────────────────
--
-- El DEFAULT se pone al FINAL, no aquí: durante el relleno hay que crear las
-- intervenciones que envuelven a las operaciones sueltas, y si ya tuvieran
-- número automático se lo llevarían en el orden en que se crean, no en el de
-- los hechos. Primero se agrupa, luego se numera todo junto por fecha.
alter table tc_intervenciones add column if not exists numero text;
alter table tc_intervenciones alter column numero drop default;

-- ── 3. Las operaciones sueltas ──────────────────────────────────────────────
--
-- Solo tienen intervención las operaciones que pasan por "Finalizar" en la
-- pantalla de Cambios. Las que se hacen desde el panel y las que salen de
-- resolver una incidencia se quedan con intervencion_id a null, y son
-- justamente las que más rabia da no poder citar.
--
-- No se pueden envolver en el momento de crearse: el panel y la APK llaman a
-- los MISMOS RPC, así que la base de datos no puede saber si una operación va
-- suelta o forma parte de una sesión de Cambios que aún no ha terminado. El
-- único dato que las distingue es el tiempo: una sesión se cierra en minutos,
-- y lo que sigue huérfano media hora después ya no se va a agrupar con nada.
--
-- De ahí esta función, que consolida a posteriori. La llama la migración para
-- el histórico y el servidor al abrir un histórico, así se cura sola.
create or replace function tc_agrupar_operaciones_sueltas(p_minutos int default 30)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_interv uuid; n int := 0;
begin
  for r in
    select id, empresa_id, vehiculo_id, tecnico_id, fecha_operacion, tipo_operacion,
           neumatico_id, created_at
      from operaciones_neumaticos
     where intervencion_id is null
       and created_at < now() - make_interval(mins => p_minutos)
     order by created_at, id
  loop
    insert into tc_intervenciones (
      empresa_id, vehiculo_id, fecha, tecnico_id, resumen, n_operaciones,
      tipo_principal, n_neumaticos, created_at)
    values (
      r.empresa_id, r.vehiculo_id, r.fecha_operacion, r.tecnico_id,
      -- Resumen mínimo y honrado: lo que se sabe con certeza de una línea
      -- suelta. Las de una sesión de Cambios traen el suyo, mucho más rico.
      initcap(replace(r.tipo_operacion, '_', ' ')),
      1, r.tipo_operacion, case when r.neumatico_id is null then null else 1 end,
      -- La intervención hereda la fecha de la operación: si se pusiera now(),
      -- una operación de julio aparecería como de hoy en el histórico.
      r.created_at)
    returning id into v_interv;

    update operaciones_neumaticos set intervencion_id = v_interv where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function tc_agrupar_operaciones_sueltas(int) to authenticated;

-- Consolidar el histórico ya existente. CON el margen de 30 minutos, no con
-- cero: si esta migración se ejecuta mientras un técnico tiene abierta una
-- sesión de Cambios, sus operaciones aún no agrupadas quedarían envueltas de
-- una en una y al pulsar Finalizar se crearía OTRA intervención encima. El
-- histórico es pasado, así que el margen no deja nada fuera.
do $$
declare n int;
begin
  select tc_agrupar_operaciones_sueltas(30) into n;
  raise notice 'Operaciones sueltas envueltas en su propia intervención: %', n;
end $$;

-- ── 4. Numerar TODO por orden cronológico ───────────────────────────────────
--
-- Ahora que las sueltas ya están envueltas, se numera todo de una vez por
-- fecha de creación: así OP-2026-000001 es de verdad la primera intervención
-- que hubo y la serie se lee como una línea de tiempo. Solo las que no tienen
-- número: volver a ejecutar esto no renumera nada.
do $$
declare r record; n int := 0;
begin
  for r in select id from tc_intervenciones where numero is null order by created_at, id loop
    update tc_intervenciones set numero = tc_generar_numero_operacion() where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'Intervenciones numeradas: %', n;
end $$;

-- ── 5. A partir de aquí, numeración automática ──────────────────────────────
--
-- Con el DEFAULT puesto, toda intervención nueva sale numerada venga de donde
-- venga (APK, panel o un insert a mano) sin tocar código de servidor.
alter table tc_intervenciones alter column numero set default tc_generar_numero_operacion();

-- ── 6. Unicidad ─────────────────────────────────────────────────────────────
-- Se crea después de numerar: si hubiera algún duplicado, aquí se ve.
create unique index if not exists idx_interv_numero on tc_intervenciones (numero);
create index if not exists idx_interv_fecha on tc_intervenciones (fecha);

-- ── 7. Comprobación ─────────────────────────────────────────────────────────
do $$
declare sin_numero int; sueltas int;
begin
  select count(*) into sin_numero from tc_intervenciones where numero is null;
  if sin_numero > 0 then
    raise exception 'Quedan % intervenciones sin número', sin_numero;
  end if;
  select count(*) into sueltas from operaciones_neumaticos where intervencion_id is null;
  raise notice 'OK: todas las intervenciones numeradas. Operaciones sin agrupar: % (deberían ser solo las de los últimos minutos)', sueltas;
end $$;
