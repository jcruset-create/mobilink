-- ============================================================
-- Mobilink Therefore — Fase 2: correos, adjuntos y decisiones
--
-- La fase 1 dejó la cola de trabajo (expedientes y actuaciones) y se llenaba a
-- mano. Esta añade por dónde entra el correo: se registra, se busca si ya hay
-- un expediente del mismo asunto, y lo que no se sabe decidir se deja escrito
-- para que lo mire una persona.
--
-- Tres tablas y una función:
--
--   thf_notificaciones   un correo. El texto original NUNCA se edita: es la
--                        única prueba de qué se pidió exactamente.
--   thf_adjuntos         sus ficheros, por hash. El contenido se guardará
--                        cuando haya almacenamiento (fase 3); el hash ya sirve
--                        hoy para cruzar el mismo documento entre correos.
--   thf_decisiones       lo que el sistema NO decide solo, con la puntuación
--                        de cada candidato tal y como se calculó.
--   thf_normalizar_id()  la normalización con la que se cruzan las facturas.
--
-- EQUIVALENTE EN CÓDIGO: server/therefore/schema.ts (initTherefore), que se
-- ejecuta en cada arranque. Este fichero es para pegarlo en el SQL Editor de
-- Supabase y añade lo que aquel NO puede poner: las claves ajenas hacia las
-- tablas app_* de la fundación SaaS.
--
-- Requiere therefore_fase1.sql. Idempotente.
-- ============================================================

-- ── 0) Comprobación previa ──────────────────────────────────
-- Sin las tablas de la fase 1, las claves ajenas de abajo fallarían con un
-- mensaje de PostgreSQL que no dice qué hay que hacer. Este sí.
do $$
begin
  if to_regclass('public.thf_expedientes') is null then
    raise exception 'Falta therefore_fase1.sql: ejecútalo antes que éste';
  end if;
end $$;

-- ── 1) Normalización de identificadores ─────────────────────
-- La misma regla que `normalizarIdentificador` en domain/dedupe.ts: mayúsculas,
-- sólo letras y dígitos, y sin ceros a la izquierda. Hace falta en SQL porque
-- la consulta de candidatos tiene que cruzar la factura «0000123514» de un
-- correo con la «123514» de un expediente, y traerse a Node todos los
-- expedientes de la ventana para compararlos sería leer miles de filas para
-- quedarse con dos.
--
-- Que la regla esté escrita dos veces es un riesgo real; hay una prueba de
-- integración que pasa la misma lista de valores por las dos y exige el mismo
-- resultado. O coinciden, o la CI se pone roja.
--
-- IMMUTABLE no es decorativo: sin eso no se puede indexar por ella.
create or replace function thf_normalizar_id(v text) returns text as $$
  select nullif(
    regexp_replace(
      regexp_replace(upper(coalesce(v, '')), '[^A-Z0-9]', '', 'g'),
      '^0+', ''),
    '')
$$ language sql immutable;

create index if not exists thf_exp_factura_norm_idx
  on thf_expedientes(empresa_id, thf_normalizar_id(factura_numero));

-- ── 2) Notificaciones ───────────────────────────────────────
create table if not exists thf_notificaciones (
  id                      uuid primary key default gen_random_uuid(),
  empresa_id              uuid not null,

  -- SET NULL y no CASCADE: si un expediente se borra, sus correos siguen
  -- siendo correos que llegaron. Borrarlos sería falsear el buzón. Y es NULL
  -- también mientras el correo espera a que alguien decida dónde va.
  expediente_id           uuid references thf_expedientes(id) on delete set null,

  -- El Message-ID del RFC, que es lo que existe en CUALQUIER buzón. El de
  -- Gmail se guarda aparte, con su propio índice único parcial, para cuando el
  -- servidor sea Gmail y lo mande. Atar el módulo a un proveedor concreto
  -- habría sido un problema: aquí el buzón es cdmon.
  message_id              text not null,
  gmail_message_id        text,
  gmail_thread_id         text,
  in_reply_to             text,

  fecha_email             timestamptz not null,
  remitente               text not null default '',
  destinatario            text not null default '',
  asunto                  text not null default '',

  -- NUNCA se edita ni se borra. Cuando el parser se equivoque —y se va a
  -- equivocar— lo que se corrige es lo interpretado, y esto es contra lo que
  -- se compara.
  texto_original          text not null,
  html_original           text,
  eml_storage_path        text,

  tipo_notificacion       text not null default 'SOLICITUD'
                          check (tipo_notificacion in
                            ('SOLICITUD','RECORDATORIO','RECLAMACION','TAREA_VENCIDA',
                             'CAMBIO_INSTRUCCION','APROBACION','OTRO')),

  urgente_detectado       boolean not null default false,
  persona_solicitante     text,
  fecha_solicitud_texto   text,

  -- sha256 del texto normalizado. Cruza los reenvíos manuales, que llegan con
  -- otro Message-ID y el mismo cuerpo.
  hash_contenido          text not null,

  -- Lo que se entendió del correo, con sus confianzas: la EVIDENCIA. Es lo que
  -- se mira cuando alguien pregunta por qué existe esta actuación, y lo que
  -- permite volver a aplicar el correo cuando una decisión se resuelve días
  -- después.
  parseado                jsonb,

  estado_proceso          text not null default 'PROCESADA'
                          check (estado_proceso in
                            ('PROCESADA','PENDIENTE_DECISION','ERROR_PARSER','IGNORADA')),
  error_proceso           text,

  created_at              timestamptz not null default now(),

  -- La idempotencia de la ingesta. Es un UNIQUE de la base y no una
  -- comprobación previa porque dos pasadas del buzón a la vez pasarían las dos
  -- por un «¿ya existe?» y las dos insertarían.
  unique (empresa_id, message_id)
);

create index if not exists thf_notif_expediente_idx
  on thf_notificaciones(expediente_id, fecha_email);
create index if not exists thf_notif_hash_idx
  on thf_notificaciones(empresa_id, hash_contenido);
create index if not exists thf_notif_hilo_idx
  on thf_notificaciones(empresa_id, gmail_thread_id)
  where gmail_thread_id is not null;
create index if not exists thf_notif_pendientes_idx
  on thf_notificaciones(empresa_id, estado_proceso)
  where estado_proceso <> 'PROCESADA';
create unique index if not exists thf_notif_gmail_idx
  on thf_notificaciones(empresa_id, gmail_message_id)
  where gmail_message_id is not null;

-- ── 3) Adjuntos ─────────────────────────────────────────────
create table if not exists thf_adjuntos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null,
  notificacion_id  uuid not null references thf_notificaciones(id) on delete cascade,
  expediente_id    uuid references thf_expedientes(id) on delete set null,

  nombre_archivo   text not null default '',
  mime_type        text not null default '',
  tamano_bytes     integer,

  tipo_documento   text not null default 'OTRO'
                   check (tipo_documento in ('PDF_FACTURA','PDF_ABONO','XML_FACTURA','OTRO')),

  hash_archivo     text not null,
  -- <empresa>/<hash[0:2]>/<hash>.<ext>. NULL mientras no haya dónde guardarlo:
  -- el mismo fichero se guardará UNA vez aunque llegue diez.
  storage_path     text,

  paginas          integer,
  tiene_texto      boolean,
  parsed           boolean not null default false,
  parse_error      text,

  created_at       timestamptz not null default now(),

  unique (notificacion_id, hash_archivo)
);

create index if not exists thf_adj_hash_idx on thf_adjuntos(empresa_id, hash_archivo);
create index if not exists thf_adj_expediente_idx on thf_adjuntos(expediente_id);

-- ── 4) Decisiones ───────────────────────────────────────────
-- La tabla que sostiene la regla de todo el módulo: cuando no se sabe, se
-- pregunta. Un motor que siempre elige acierta el 95 % y el 5 % restante
-- aparece en contabilidad semanas después.
create table if not exists thf_decisiones (
  id                       uuid primary key default gen_random_uuid(),
  empresa_id               uuid not null,

  tipo                     text not null
                           check (tipo in
                             ('POSIBLE_DUPLICADO','CAMBIO_INSTRUCCION',
                              'RECLAMACION_SOBRE_RESUELTO','REQUIERE_REVISION','ERROR_PARSER')),

  notificacion_id          uuid references thf_notificaciones(id) on delete cascade,
  expediente_id            uuid references thf_expedientes(id) on delete cascade,
  -- La actuación concreta, para los CAMBIO_INSTRUCCION. Un mismo correo puede
  -- cambiar la instrucción de tres albaranes, y son tres decisiones: aceptar
  -- una y mantener otra es una respuesta perfectamente razonable.
  actuacion_id             uuid references thf_actuaciones(id) on delete cascade,

  -- [{id, numero, estado, score, motivos:[{clave,puntos,texto}]}]. Se guarda la
  -- puntuación TAL Y COMO se calculó, no una referencia: los pesos se pueden
  -- cambiar, y entonces la pantalla enseñaría una razón distinta de la que
  -- hubo. Lo que se decidió se decidió con estos números.
  candidatos               jsonb not null default '[]',
  detalle                  jsonb,

  estado                   text not null default 'PENDIENTE'
                           check (estado in ('PENDIENTE','DECIDIDA')),
  decision                 text,
  motivo                   text,
  decidida_por_usuario_id  uuid,
  decidida_por_nombre      text,
  decidida_at              timestamptz,

  created_at               timestamptz not null default now()
);

create index if not exists thf_dec_pendientes_idx
  on thf_decisiones(empresa_id, created_at desc)
  where estado = 'PENDIENTE';
create index if not exists thf_dec_expediente_idx on thf_decisiones(expediente_id);
create index if not exists thf_dec_notificacion_idx on thf_decisiones(notificacion_id);

-- Una decisión pendiente por correo, tipo y actuación, y no más. Sin esto,
-- reprocesar un correo dejaría dos entradas idénticas en la cola y quien
-- resolviera la primera se encontraría la segunda sin saber si es otro caso.
--
-- El COALESCE es necesario y no un adorno: en un índice único de PostgreSQL dos
-- NULL son distintos, así que sin él las decisiones sin actuación —que son casi
-- todas— no se deduplicarían entre sí.
create unique index if not exists thf_dec_unica_idx
  on thf_decisiones(
    notificacion_id, tipo,
    coalesce(actuacion_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where estado = 'PENDIENTE' and notificacion_id is not null;

-- ── 5) Claves ajenas hacia la fundación SaaS ────────────────
-- Lo único que este fichero añade sobre el DDL del arranque, por el mismo
-- motivo que en la fase 1: las pruebas levantan una base desechable sin
-- app_empresas, y una clave ajena incondicional impediría arrancar contra ella.
do $$
begin
  if to_regclass('public.app_empresas') is not null then
    if not exists (select 1 from pg_constraint where conname = 'thf_notif_empresa_fk') then
      alter table thf_notificaciones
        add constraint thf_notif_empresa_fk foreign key (empresa_id)
        references app_empresas(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'thf_adj_empresa_fk') then
      alter table thf_adjuntos
        add constraint thf_adj_empresa_fk foreign key (empresa_id)
        references app_empresas(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'thf_dec_empresa_fk') then
      alter table thf_decisiones
        add constraint thf_dec_empresa_fk foreign key (empresa_id)
        references app_empresas(id) on delete cascade;
    end if;
  else
    raise notice 'Sin app_empresas: no se ponen las claves ajenas de empresa';
  end if;
end $$;

-- ── 6) RLS ──────────────────────────────────────────────────
-- Activada SIN políticas, como en la fase 1: nada lee estas tablas con
-- supabase-js. El panel entra por /api/therefore y el servidor se conecta con
-- «pg», que se salta la RLS. Dejarla cerrada es mejor que escribir hoy una
-- política permisiva «por si acaso».
alter table thf_notificaciones enable row level security;
alter table thf_adjuntos       enable row level security;
alter table thf_decisiones     enable row level security;

-- ── 7) Comprobación ─────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.tables
   where table_name in ('thf_notificaciones','thf_adjuntos','thf_decisiones');
  if n <> 3 then raise exception 'Faltan tablas de la fase 2: sólo hay %', n; end if;

  -- El UNIQUE que hace idempotente la ingesta. Si faltara, el buzón crearía un
  -- expediente por cada relectura y nadie lo vería hasta tener la bandeja llena.
  if not exists (
    select 1 from pg_constraint
     where conname = 'thf_notificaciones_empresa_id_message_id_key')
  then
    raise exception 'Falta el UNIQUE (empresa_id, message_id): el buzón duplicaría correos';
  end if;

  if not exists (
    select 1 from pg_indexes
     where tablename = 'thf_decisiones' and indexname = 'thf_dec_unica_idx')
  then
    raise exception 'Falta thf_dec_unica_idx: la cola de revisión acumularía duplicados';
  end if;

  -- Y que la normalización dice lo que tiene que decir. Un cambio ahí rompería
  -- el cruce de facturas sin que nada más se quejara.
  if thf_normalizar_id('0000123514') is distinct from '123514'
     or thf_normalizar_id('FA-2026/001') is distinct from 'FA2026001'
     or thf_normalizar_id('000') is not null
  then
    raise exception 'thf_normalizar_id no normaliza como se espera';
  end if;

  raise notice 'OK: Therefore fase 2 (correos, adjuntos y decisiones)';
end $$;
