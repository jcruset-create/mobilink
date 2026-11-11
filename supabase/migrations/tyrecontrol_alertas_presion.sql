-- ============================================================================
-- Avisos de presión de Goodyear Proactive Solutions.
--
-- ── Qué es esto y qué NO es ────────────────────────────────────────────────
--
-- Goodyear manda un correo por cada rueda que se le baja de presión. No hay
-- API ni webhook: el correo es el único camino, y llega al mismo buzón al que
-- ya llega el informe del CheckPoint (del mismísimo remitente, desde agosto).
--
-- Esto NO escribe en `revisiones_neumaticos_detalle`, y la tentación era
-- evidente porque esa tabla ya tiene `presion_bar` y `metodo_presion`. Sería
-- inventar un asiento que no existe: un aviso de un sensor no es una revisión
-- —nadie ha ido al vehículo, nadie ha mirado la rueda— y meterlo ahí haría que
-- el histórico del neumático contara como revisión lo que fue un correo, y
-- ensuciaría la mediana de duración y el recuento del informe mensual.
--
-- El aviso es un aviso. Vive aquí.
--
-- ── Una fila por RUEDA, no por correo ──────────────────────────────────────
--
-- En diez avisos reales, tres ruedas aparecían dos veces: mismo vehículo,
-- misma rueda, un día después y sin arreglar. Con 378 correos acumulados, una
-- fila por correo llenaría la campana de la misma rueda cuarenta veces y la
-- campana dejaría de mirarse, que es la forma de que una alerta buena no sirva
-- para nada.
--
-- Así que mientras la alerta siga ABIERTA, un aviso nuevo de la misma rueda la
-- actualiza: sube `avisos`, mueve `ultimo_aviso_at` y guarda la última lectura.
-- Y entonces `avisos` pasa a ser el dato que de verdad vale: una rueda que
-- avisa tres días seguidos no tiene poca presión, tiene una fuga.
-- ============================================================================

create table if not exists tc_alertas_presion (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references tc_empresas(id) on delete cascade,
  vehiculo_id   uuid not null references tc_vehiculos(id) on delete cascade,
  posicion_id   uuid not null references tc_posiciones_vehiculo(id),

  -- El neumático que estaba montado ahí cuando entró el aviso. Se guarda para
  -- que el aviso siga teniendo sentido después de un cambio de rueda: sin
  -- esto, al desmontarla el aviso quedaría hablando de una posición vacía.
  -- `on delete set null`: borrar una goma no puede llevarse el aviso.
  neumatico_id  uuid references tc_neumaticos(id) on delete set null,

  -- De los diez correos salieron dos tipos. Habrá más —presión alta,
  -- temperatura, sensor sin señal—: cuando aparezcan se añaden aquí.
  tipo          text not null check (tipo in ('presion_baja', 'desinflado')),
  severidad     text not null check (severidad in ('alta', 'media')),

  -- La presión recomendada es POR VEHÍCULO y la trae el correo: 8,0 bar en un
  -- autobús, 2,5 en una furgoneta. TyreControl no la tenía: `tc_config_umbrales`
  -- guarda una tolerancia, no una presión objetivo.
  presion_recomendada_bar numeric(5,2),

  -- Nulas en los avisos de «neumático desinflado», donde el correo pone `!!!`
  -- en vez de un número. Un cero diría «se midieron 0,0 bar», que es otra cosa
  -- distinta de «el sensor no da una lectura fiable».
  presion_bar   numeric(5,2),
  -- El porcentaje TAL COMO lo dice el correo, con su signo. No se recalcula:
  -- 4,0 sobre 8,0 daría −50 % y el correo dice −49,65 %, porque los bares
  -- vienen redondeados y el porcentaje sale de los valores crudos. Calcularlo
  -- nosotros daría un número distinto del que el cliente ve en su portal.
  desviacion_pct numeric(6,2),
  -- El «(debajo X %)». No es constante: se han visto 75 y 80, y los avisos de
  -- desinflado no lo traen.
  umbral_pct    numeric(5,2),

  -- Cuándo lo midió el sensor, según el correo. NO es cuándo se leyó el buzón.
  medido_at     timestamptz not null,

  -- ── Seguimiento ──────────────────────────────────────────────────────────
  estado        text not null default 'abierta'
                  check (estado in ('abierta', 'resuelta', 'descartada')),
  avisos        integer not null default 1 check (avisos > 0),
  primer_aviso_at timestamptz not null,
  ultimo_aviso_at timestamptz not null,

  -- Goodyear avisa de que la presión está baja; NO avisa de que se ha
  -- arreglado. Así que una alerta la cierra una persona, o la cierra una
  -- revisión posterior que mida bien esa rueda.
  resuelta_at   timestamptz,
  resuelta_por_revision_id uuid references revisiones_vehiculo(id) on delete set null,
  nota          text,

  creado_at     timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

-- La invariante de la que depende todo lo demás: una sola alerta ABIERTA por
-- rueda. Se deja que la garantice la base, no el código: si una pasada
-- intentara abrir una segunda, falla ahí y no callando.
create unique index if not exists idx_alertas_presion_abierta
  on tc_alertas_presion (vehiculo_id, posicion_id) where estado = 'abierta';

create index if not exists idx_alertas_presion_empresa
  on tc_alertas_presion (empresa_id, estado, ultimo_aviso_at desc);
create index if not exists idx_alertas_presion_vehiculo
  on tc_alertas_presion (vehiculo_id, ultimo_aviso_at desc);

comment on table tc_alertas_presion is
  'Avisos de presión de Goodyear Proactive Solutions, que llegan por correo. Una fila por RUEDA mientras la alerta sigue abierta, no una por correo: los avisos se repiten a diario sobre la misma rueda. No es una revisión y no escribe en revisiones_neumaticos_detalle.';
comment on column tc_alertas_presion.avisos is
  'Cuántos correos ha generado esta misma rueda sin resolverse. Es el dato que distingue una presión baja de una fuga.';
comment on column tc_alertas_presion.desviacion_pct is
  'El porcentaje que dice el correo, copiado. No se recalcula desde los bares: vienen redondeados y no cuadran.';
comment on column tc_alertas_presion.presion_bar is
  'Nula en los avisos de «neumático desinflado», donde el correo pone !!! en vez de un número.';

-- ── El rastro de cada correo ───────────────────────────────────────────────
--
-- Mismo molde que `tc_checkpoint_ejecuciones`, que lleva en producción desde
-- agosto. Sirve para dos cosas: que un correo no se procese dos veces
-- (`message_id` único) y que lo que NO se pudo casar deje constancia con su
-- motivo en vez de desaparecer en silencio.

create table if not exists tc_goodyear_avisos (
  id           uuid primary key default gen_random_uuid(),
  message_id   text not null unique,
  asunto       text,
  remitente    text,
  fecha_correo timestamptz,

  estado       text not null check (estado in ('alerta', 'repetido', 'no_casado', 'ignorado', 'error')),
  motivo       text,
  alerta_id    uuid references tc_alertas_presion(id) on delete set null,

  -- Lo que se entendió del correo, aunque no se pudiera casar. Es lo que
  -- permite arreglar el casado después y volver a pasarlo sin pedirle a nadie
  -- que reenvíe 378 correos.
  leido        jsonb,

  creado_at    timestamptz not null default now()
);

create index if not exists idx_goodyear_avisos_estado
  on tc_goodyear_avisos (estado, creado_at desc);

comment on table tc_goodyear_avisos is
  'Un apunte por correo de Goodyear procesado. message_id único: es lo que impide procesar dos veces el mismo. Los que no se pudieron casar quedan con su motivo y lo que se entendió, para poder repasarlos.';

-- ── RLS: el mismo criterio que el resto de TyreControl ─────────────────────

alter table tc_alertas_presion enable row level security;

drop policy if exists alertas_presion_select on tc_alertas_presion;
create policy alertas_presion_select on tc_alertas_presion for select
  using ( tc_puede_ver_empresa(empresa_id) );

-- Escribe el buzón, que corre con la clave de servicio y no pasa por RLS. Se
-- deja a los administradores para poder cerrar una alerta a mano.
drop policy if exists alertas_presion_write on tc_alertas_presion;
create policy alertas_presion_write on tc_alertas_presion for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );

-- El registro de correos no lleva empresa —un correo que no se casa no tiene
-- empresa todavía— así que es solo para superadministradores.
alter table tc_goodyear_avisos enable row level security;

drop policy if exists goodyear_avisos_todo on tc_goodyear_avisos;
create policy goodyear_avisos_todo on tc_goodyear_avisos for all
  using ( tc_is_superadmin() )
  with check ( tc_is_superadmin() );

-- ── Comprobación ───────────────────────────────────────────────────────────

select
  (select count(*) from information_schema.tables
    where table_name = 'tc_alertas_presion')                         as tabla_alertas,
  (select count(*) from information_schema.tables
    where table_name = 'tc_goodyear_avisos')                         as tabla_avisos,
  (select count(*) from pg_indexes
    where indexname = 'idx_alertas_presion_abierta')                 as indice_una_abierta_por_rueda,
  (select count(*) from pg_policies
    where tablename in ('tc_alertas_presion', 'tc_goodyear_avisos')) as politicas;
