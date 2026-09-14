-- ============================================================
-- Mobilink Therefore — Fase 1: expedientes y actuaciones
--
-- Therefore manda correos automáticos sobre facturas de proveedor: pide grabar
-- albaranes, modificarlos, aprobar facturas, y vuelve a pedir lo mismo durante
-- días. Este módulo los convierte en una cola de trabajo donde la unidad de
-- trabajo NO es el correo sino el EXPEDIENTE, y donde un expediente agrupa
-- todas las actuaciones del mismo problema.
--
-- Esta fase crea las cinco tablas que sostienen la cola. Las del correo
-- (notificaciones, adjuntos, decisiones) y las del análisis del albarán dentro
-- del PDF llegan en sus propias fases, cuando haya código que las escriba.
--
-- EQUIVALENTE EN CÓDIGO: server/therefore/schema.ts (initTherefore), que se
-- ejecuta en cada arranque. Este fichero es para pegarlo en el SQL Editor de
-- Supabase y añade lo que aquel NO puede poner: las claves ajenas hacia las
-- tablas app_* de la fundación SaaS, que en la base desechable de las pruebas
-- no existen.
--
-- Idempotente.
-- ============================================================

-- ── 1) Expedientes ──────────────────────────────────────────
create table if not exists thf_expedientes (
  id                          uuid primary key default gen_random_uuid(),
  empresa_id                  uuid not null,

  -- Numeración propia (INC-000452). Es lo que la gente cita por teléfono.
  numero                      text not null,

  -- La sociedad del ERP de la que habla el correo («007»). NO es el tenant:
  -- empresa_id es quién usa Mobilink, empresa_codigo de qué empresa habla
  -- Therefore. Una instalación con dos sociedades necesita los dos.
  empresa_codigo              text not null default '',
  empresa_nombre              text not null default '',

  tipo                        text not null
                              check (tipo in ('INCIDENCIA_ALBARAN','APROBACION_FACTURA','OTRO')),
  estado                      text not null default 'NUEVO'
                              check (estado in ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO','RESUELTO','CERRADO')),

  -- Prioridad, estado y reclamaciones son TRES ejes distintos. Un expediente
  -- puede estar PENDIENTE, con tres reclamaciones y prioridad CRÍTICA: las tres
  -- cosas a la vez. Por eso «RECLAMADO» no es un estado.
  prioridad                   text not null default 'NORMAL'
                              check (prioridad in ('BAJA','NORMAL','ALTA','CRITICA')),
  prioridad_score             integer not null default 0,
  prioridad_manual            text
                              check (prioridad_manual is null or
                                     prioridad_manual in ('BAJA','NORMAL','ALTA','CRITICA')),
  requiere_revision           boolean not null default false,

  proveedor_codigo            text,
  proveedor_nombre            text,
  cuenta_contable             text,
  factura_numero              text,
  factura_fecha               date,

  -- En céntimos y CON SIGNO: un abono de 45,63 € es -4563. Entero, para no
  -- arrastrar errores de coma flotante en una cifra contable.
  importe_centimos            bigint,
  moneda                      text not null default 'EUR',
  caso_referencia             text,

  -- La antigüedad se cuenta desde la PRIMERA notificación, no desde que se creó
  -- la fila: un expediente importado del histórico lleva abierto desde que
  -- Therefore lo pidió por primera vez.
  fecha_primera_notificacion  timestamptz not null default now(),
  fecha_ultima_notificacion   timestamptz not null default now(),
  numero_notificaciones       integer not null default 0,
  numero_reclamaciones        integer not null default 0,

  urgente                     boolean not null default false,
  tarea_vencida               boolean not null default false,

  asignado_usuario_id         uuid,
  fecha_inicio_gestion        timestamptz,
  fecha_resolucion            timestamptz,
  resuelto_por_usuario_id     uuid,
  fecha_cierre                timestamptz,

  observaciones               text not null default '',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid,

  unique (empresa_id, numero)
);

-- Las dos claves con las que se busca un expediente al deduplicar un correo.
create index if not exists thf_exp_empresa_factura_idx
  on thf_expedientes (empresa_id, empresa_codigo, factura_numero);
create index if not exists thf_exp_proveedor_factura_idx
  on thf_expedientes (empresa_id, proveedor_codigo, factura_numero);
-- El orden y los filtros de la bandeja.
create index if not exists thf_exp_estado_prioridad_idx
  on thf_expedientes (empresa_id, estado, prioridad);
create index if not exists thf_exp_ultima_notif_idx
  on thf_expedientes (empresa_id, fecha_ultima_notificacion desc);
create index if not exists thf_exp_revision_idx
  on thf_expedientes (empresa_id) where requiere_revision;
create index if not exists thf_exp_asignado_idx
  on thf_expedientes (empresa_id, asignado_usuario_id) where asignado_usuario_id is not null;

comment on table thf_expedientes is
  'Un problema de Therefore, no un correo. Agrupa todas las actuaciones, '
  'notificaciones y documentos del mismo asunto.';

-- ── 2) Actuaciones ──────────────────────────────────────────
-- Lo que hay que hacer, una fila por cosa. Un mismo correo pide grabar dos
-- albaranes y modificar un tercero: son tres actuaciones de un expediente, y
-- cada una se resuelve por su cuenta.
create table if not exists thf_actuaciones (
  id                       uuid primary key default gen_random_uuid(),
  empresa_id               uuid not null,
  expediente_id            uuid not null references thf_expedientes(id) on delete cascade,

  tipo_accion              text not null
                           check (tipo_accion in ('GRABAR','MODIFICAR','REVISAR','GESTIONAR','ANULAR','APROBAR','OTRO')),

  -- Tal y como lo escribió quien mandó el correo («0806295»).
  albaran_solicitado       text,
  -- El núcleo: la última tirada de dígitos sin ceros a la izquierda. Es lo que
  -- permite cruzar «0806295» con «ENT-100126-0806295».
  albaran_normalizado      text,

  -- Lo que DICE EL CORREO. Si el documento dice otra cosa se registra la
  -- discrepancia, pero esta columna no se toca: son dos fuentes distintas.
  importe_centimos         bigint,

  -- Lo que venía junto al albarán y no se sabe qué significa: «T2». Se conserva
  -- tal cual y no se interpreta.
  indicador_adicional      text,

  estado                   text not null default 'PENDIENTE'
                           check (estado in ('PENDIENTE','EN_PROCESO','BLOQUEADA','RESUELTA','DESCARTADA')),
  obligatoria              boolean not null default true,

  resultado                text,
  erp_referencia           text,
  erp_estado               jsonb,
  erp_consultado_at        timestamptz,

  confianza                numeric(3,2) not null default 1.00,
  origen_notificacion_id   uuid,

  iniciada_por_usuario_id  uuid,
  iniciada_at              timestamptz,
  resuelta_por_usuario_id  uuid,
  resuelta_at              timestamptz,

  observaciones            text not null default '',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists thf_act_expediente_idx on thf_actuaciones (expediente_id);
create index if not exists thf_act_albaran_idx
  on thf_actuaciones (empresa_id, albaran_normalizado) where albaran_normalizado is not null;

-- El índice que impide duplicar una actuación cuando una reclamación repite los
-- albaranes de siempre. Tiene que ser un índice y no una comprobación previa:
-- dos correos procesados a la vez pasarían los dos por un «¿ya existe?».
-- Deja fuera las DESCARTADAS: lo que un cambio de instrucción dejó sin efecto
-- no bloquea que se vuelva a pedir.
create unique index if not exists thf_act_unica_idx
  on thf_actuaciones (expediente_id, tipo_accion, albaran_normalizado)
  where albaran_normalizado is not null and estado <> 'DESCARTADA';

comment on table thf_actuaciones is
  'Cada cosa que hay que hacer. Un expediente puede tener GRABAR de un albarán '
  'y MODIFICAR de otro, y cada una se resuelve por separado.';

-- ── 3) Histórico ────────────────────────────────────────────
-- Inmutable, y la inmutabilidad la impone la BASE: el servidor se conecta con
-- «pg» y un solo usuario, así que se salta la RLS y un UPDATE sería posible.
create table if not exists thf_eventos (
  id                    bigserial primary key,
  empresa_id            uuid not null,
  expediente_id         uuid,
  notificacion_id       uuid,
  actuacion_id          uuid,
  albaran_analizado_id  uuid,

  tipo                  text not null,
  actor_tipo            text not null default 'sistema' check (actor_tipo in ('sistema','usuario')),
  usuario_id            uuid,
  usuario_nombre        text,

  datos_anteriores      jsonb,
  datos_nuevos          jsonb,
  descripcion           text not null default '',

  occurred_at           timestamptz not null default now(),
  huella                text
);

create index if not exists thf_ev_expediente_idx on thf_eventos (expediente_id, occurred_at);
create index if not exists thf_ev_empresa_idx on thf_eventos (empresa_id, occurred_at desc);

create or replace function thf_eventos_huella() returns trigger as $$
begin
  new.huella := encode(sha256(convert_to(
    new.empresa_id::text                    || '|' ||
    coalesce(new.expediente_id::text,'')    || '|' ||
    coalesce(new.actuacion_id::text,'')     || '|' ||
    new.tipo                                || '|' ||
    new.actor_tipo                          || '|' ||
    coalesce(new.usuario_id::text,'')       || '|' ||
    new.occurred_at::text                   || '|' ||
    coalesce(new.datos_anteriores::text,'') || '|' ||
    coalesce(new.datos_nuevos::text,''),
    'UTF8')), 'hex');
  return new;
end $$ language plpgsql;

drop trigger if exists thf_eventos_huella_trg on thf_eventos;
create trigger thf_eventos_huella_trg
  before insert on thf_eventos
  for each row execute function thf_eventos_huella();

-- El candado. El mensaje dice QUÉ hacer en vez de sólo negarse: quien se topa
-- con esto casi siempre quería corregir algo, y lo que corrige un evento
-- equivocado es otro evento.
create or replace function thf_eventos_solo_insertar() returns trigger as $$
begin
  raise exception
    'thf_eventos es inmutable: no se puede % un evento. Una correccion se registra como un evento nuevo.',
    TG_OP;
end $$ language plpgsql;

drop trigger if exists thf_eventos_inmutable_trg on thf_eventos;
create trigger thf_eventos_inmutable_trg
  before update or delete on thf_eventos
  for each row execute function thf_eventos_solo_insertar();

-- ── 4) Numeración y configuración ───────────────────────────
create table if not exists thf_contadores (
  empresa_id  uuid not null,
  serie       text not null,
  last_seq    integer not null default 0,
  primary key (empresa_id, serie)
);

-- Clave/valor POR EMPRESA, como cash_settings: los pesos de la prioridad son la
-- opinión de cada instalación sobre qué corre más. Sólo guarda lo que alguien
-- ha cambiado; los valores por defecto viven en server/therefore/config.ts.
create table if not exists thf_config (
  empresa_id  uuid not null,
  clave       text not null,
  valor       text,
  updated_at  timestamptz not null default now(),
  primary key (empresa_id, clave)
);

-- ── 5) Claves ajenas hacia la fundación SaaS ────────────────
-- Esto es lo único que este fichero añade sobre el DDL del arranque. Allí no
-- pueden estar porque las pruebas de integración levantan una base desechable
-- sin app_empresas ni app_usuarios, y una clave ajena incondicional impediría
-- arrancar contra ella.
do $$
begin
  if to_regclass('public.app_empresas') is not null then
    if not exists (select 1 from pg_constraint where conname = 'thf_exp_empresa_fk') then
      alter table thf_expedientes
        add constraint thf_exp_empresa_fk foreign key (empresa_id)
        references app_empresas(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'thf_act_empresa_fk') then
      alter table thf_actuaciones
        add constraint thf_act_empresa_fk foreign key (empresa_id)
        references app_empresas(id) on delete cascade;
    end if;
  else
    raise notice 'Sin app_empresas: no se ponen las claves ajenas de empresa';
  end if;
end $$;

-- ── 6) RLS ──────────────────────────────────────────────────
-- Se activa SIN políticas, y es deliberado: hoy nada lee estas tablas con
-- supabase-js. El panel entra por /api/therefore, y el servidor se conecta con
-- «pg», que se salta la RLS. Activarla sin políticas deja la puerta cerrada
-- para cualquier otro camino; el día que una app necesite leerlas se le escribe
-- su política, que es mejor que dejar hoy una permisiva «por si acaso».
alter table thf_expedientes enable row level security;
alter table thf_actuaciones enable row level security;
alter table thf_eventos     enable row level security;
alter table thf_contadores  enable row level security;
alter table thf_config      enable row level security;

-- ── 7) Comprobación ─────────────────────────────────────────
-- Lo que se promete se comprueba, no se supone.
do $$
declare n int;
begin
  select count(*) into n from information_schema.tables
   where table_name in ('thf_expedientes','thf_actuaciones','thf_eventos',
                        'thf_contadores','thf_config');
  if n <> 5 then raise exception 'Faltan tablas de Therefore: sólo hay %', n; end if;

  -- El índice único parcial es lo que impide duplicar una actuación al llegar
  -- una reclamación. Si esa sintaxis no funcionara, el módulo duplicaría
  -- trabajo en silencio.
  if not exists (
    select 1 from pg_indexes
     where tablename = 'thf_actuaciones' and indexname = 'thf_act_unica_idx')
  then
    raise exception 'Falta thf_act_unica_idx: una reclamación duplicaría las actuaciones';
  end if;

  -- El candado del histórico.
  if not exists (
    select 1 from pg_trigger where tgname = 'thf_eventos_inmutable_trg')
  then
    raise exception 'Falta el candado de thf_eventos: el histórico sería modificable';
  end if;

  raise notice 'OK: Therefore fase 1 (expedientes, actuaciones, histórico, numeración y configuración)';
end $$;
