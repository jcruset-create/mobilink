-- ============================================================
-- Mobilink TyreControl — Avisos de presión del arco (CheckPoint)
--
-- Cuando un vehículo cruza el arco con una rueda por debajo del umbral, llega
-- un correo con la plantilla de Goodyear ("Presión baja!"). Hasta hoy esos
-- correos se leían a mano y no dejaban rastro. Ahora el mismo vigilante que
-- lee el informe semanal los reconoce y abre una incidencia.
--
-- Aquí van las tres piezas que eso necesita en la base de datos:
--
--   1. tc_incidencias.origen — de dónde salió la incidencia. Nullable, porque
--      las que ya existen y las que crea la APK vienen de una revisión y no
--      hay por qué tocarlas.
--
--   2. Un índice único PARCIAL que impide dos incidencias abiertas del arco
--      para la misma rueda. La regla de negocio ya la aplica el servidor, pero
--      dos correos en la misma pasada, o dos instancias, la esquivarían: esto
--      lo decide la base de datos y no el orden en que se ejecute el código.
--
--   3. tc_avisos_presion — una fila por correo de aviso. Es el histórico: con
--      un contador en la incidencia sabríamos cuántas veces, pero no cuándo ni
--      con qué presión, y "cinco avisos, el primero a 5,5 bar y el último a
--      4,8" es lo que distingue una rueda que pierde aire de un pinchazo lento.
--      También recoge los avisos que NO se pudieron convertir en incidencia
--      (matrícula desconocida, plantilla cambiada): un proceso que escribe sin
--      que nadie mire tiene que dejar rastro también cuando no escribe.
--
-- tc_checkpoint_ejecuciones no se toca: sus columnas son del informe semanal
-- (mediciones, revisiones, altas…) y ese camino ya funciona.
--
-- Idempotente.
-- ============================================================

-- ── 1. De dónde viene la incidencia ─────────────────────────────────────────
alter table tc_incidencias add column if not exists origen text;

alter table tc_incidencias drop constraint if exists tc_incidencias_origen_check;
alter table tc_incidencias add constraint tc_incidencias_origen_check
  check (origen is null or origen = any (array['revision','checkpoint_aviso']));

comment on column tc_incidencias.origen is
  'De dónde salió la incidencia. null = de una revisión (todas las anteriores '
  'a los avisos del arco). checkpoint_aviso = la abrió sola el vigilante de '
  'correo al recibir un aviso de presión.';

-- ── 2. Una sola incidencia abierta por rueda ────────────────────────────────
-- "Abierta" es la misma definición que ya usa tc_resolver_incidencia_parcial:
-- todo lo que no sea solucionada, cancelada o no_procede.
--
-- Sólo alcanza a las filas del arco, así que no puede estorbar a lo que hace
-- la APK; y sólo a las abiertas, así que si la incidencia se soluciona y el
-- aviso vuelve un mes después, se abre una nueva — que es lo correcto: el
-- problema volvió a aparecer.
create unique index if not exists ux_tc_incidencias_aviso_abierta
  on tc_incidencias (vehiculo_id, posicion_id)
  where origen = 'checkpoint_aviso'
    and estado not in ('solucionada','cancelada','no_procede');

-- ── 3. El histórico de avisos ───────────────────────────────────────────────
create table if not exists tc_avisos_presion (
  id uuid primary key default gen_random_uuid(),

  -- Identificador del correo. Único: si el buzón devuelve dos veces el mismo
  -- mensaje —pasa al reconectar—, la segunda no se procesa. Misma red que en
  -- tc_checkpoint_ejecuciones.
  message_id text unique,
  asunto text,
  remitente text,
  fecha_correo timestamptz,

  -- A qué incidencia fue a parar. null cuando no se pudo crear ninguna.
  incidencia_id uuid references tc_incidencias(id) on delete set null,
  empresa_id uuid references tc_empresas(id) on delete set null,
  vehiculo_id uuid references tc_vehiculos(id) on delete set null,
  posicion_id uuid references tc_posiciones_vehiculo(id) on delete set null,

  -- Lo que decía el correo, tal cual se leyó. Todo nullable: un correo que no
  -- se ha podido leer también deja fila.
  matricula text,
  id_flota text,
  eje int,
  lado text check (lado is null or lado = any (array['izq','der'])),
  interior_exterior text check (interior_exterior is null or interior_exterior = any (array['int','ext'])),
  codigo_posicion text,
  presion_bar numeric,
  presion_recomendada_bar numeric,
  desviacion_pct numeric,
  rango text,
  umbral_pct numeric,
  medido_at timestamptz,
  checkpoint text,

  -- Cómo se leyeron esos campos. 'plantilla' = analizador determinista, que es
  -- el caso normal y el único que se da por bueno. 'ia' = el correo no encajaba
  -- con la plantilla y lo leyó el modelo: NO crea incidencia, se avisa a una
  -- persona para que lo confirme.
  origen_datos text not null default 'plantilla'
    check (origen_datos = any (array['plantilla','ia'])),

  estado text not null
    check (estado = any (array[
      'creada',                 -- abrió incidencia nueva
      'actualizada',            -- se sumó a una incidencia ya abierta
      'sin_vehiculo',           -- la matrícula no está en TyreControl
      'vehiculo_ambiguo',       -- la matrícula está en más de un vehículo activo
      'sin_posicion',           -- el tipo del vehículo no tiene esa rueda
      'pendiente_confirmacion', -- lo leyó la IA: espera que lo confirme una persona
      'no_reconocido'           -- ni la plantilla ni la IA supieron leerlo
    ])),
  -- Qué campos obligatorios faltaron, para que el correo de aviso diga algo
  -- útil en vez de "no se ha podido procesar".
  faltan jsonb not null default '[]'::jsonb,
  notas jsonb not null default '[]'::jsonb,
  -- Recorte del correo. Sólo se guarda cuando no se pudo leer: es lo que
  -- permite arreglar el analizador sin pedirle a nadie que reenvíe nada.
  cuerpo text,
  aviso_enviado boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_tc_avisos_presion_incidencia on tc_avisos_presion (incidencia_id);
create index if not exists idx_tc_avisos_presion_fecha on tc_avisos_presion (created_at desc);
create index if not exists idx_tc_avisos_presion_vehiculo on tc_avisos_presion (vehiculo_id, medido_at desc);

comment on table tc_avisos_presion is
  'Una fila por correo de aviso de presión del arco. Las que comparten '
  'incidencia_id son el mismo problema avisado varias veces: contarlas es lo '
  'que dice que la rueda lleva cinco días sin arreglar.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Lo escribe el servidor con la clave de servicio, que se salta la RLS. Para
-- el panel, solo lectura y solo de lo suyo. Mismo patrón que las ejecuciones
-- del CheckPoint.
alter table tc_avisos_presion enable row level security;

drop policy if exists tc_avisos_presion_select on tc_avisos_presion;
create policy tc_avisos_presion_select on tc_avisos_presion for select
  using ( tc_is_superadmin() or empresa_id is null or tc_puede_ver_empresa(empresa_id) );

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'tc_incidencias' and column_name = 'origen')
  then raise exception 'Falta tc_incidencias.origen'; end if;

  select count(*) into n from information_schema.columns
   where table_name = 'tc_avisos_presion';
  if n = 0 then raise exception 'No se ha creado tc_avisos_presion'; end if;

  -- El unique de message_id evita procesar dos veces el mismo correo.
  if not exists (
    select 1 from pg_indexes
     where tablename = 'tc_avisos_presion' and indexdef like '%UNIQUE%message_id%')
  then
    raise exception 'Falta el unique de message_id: el mismo aviso podría procesarse dos veces';
  end if;

  -- Y éste es el que impide la incidencia duplicada. Se comprueba que existe
  -- Y que sigue siendo parcial: sin el WHERE alcanzaría a las incidencias de
  -- la APK y a las ya solucionadas, y rompería tanto la creación manual como
  -- el caso "se arregló y volvió a pasar".
  if not exists (
    select 1 from pg_indexes
     where tablename = 'tc_incidencias'
       and indexname = 'ux_tc_incidencias_aviso_abierta'
       and indexdef like '%UNIQUE%'
       and indexdef like '%WHERE%'
       and indexdef like '%checkpoint_aviso%')
  then
    raise exception 'Falta el índice único parcial de incidencias del arco: se podrían duplicar';
  end if;

  raise notice 'OK: avisos de presión del CheckPoint';
end $$;
