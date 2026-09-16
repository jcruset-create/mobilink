-- ============================================================
-- Mobilink — OR Manuales (prefijo orm_)
--
-- El gemelo manual de `server/or-manuales/schema.ts`, para pegar en el SQL
-- Editor de Supabase. El servidor crea esto mismo al arrancar y es idempotente:
-- esta migración existe para poder aplicarlo sin esperar a un despliegue y
-- para que quede escrito qué tablas usa el módulo.
--
-- Qué controla: el ciclo de vida del papel. Los blocs de órdenes de reparación
-- manuales (25 OR consecutivas, una hoja por OR), quién se lleva cada bloc,
-- cuándo vuelve, qué hojas se escanean y CUÁLES FALTAN.
--
-- Ejecutar DESPUÉS de saas_modulo_or_manuales.sql (o a la vez: son
-- independientes, pero sin la licencia la API contesta 403 a todo el mundo).
-- ============================================================

-- ── El bloc físico ───────────────────────────────────────────
create table if not exists orm_blocs (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null,
  numero_bloc         text not null,
  or_inicial          integer not null,
  or_final            integer not null,
  cantidad_or         integer not null default 25,
  responsable_id      uuid,
  responsable_nombre  text,
  fecha_creacion      date not null default current_date,
  fecha_entrega       date,
  fecha_devolucion    date,
  estado              text not null default 'DISPONIBLE'
                      check (estado in ('DISPONIBLE','ENTREGADO','DEVUELTO','PENDIENTE_ESCANEO','INCOMPLETO','REVISAR','COMPLETO','CERRADO')),
  observaciones       text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  closed_at           timestamptz,
  closed_by           uuid,
  check (or_final >= or_inicial),
  unique (empresa_id, numero_bloc)
);
create index if not exists idx_orm_blocs_empresa_estado on orm_blocs (empresa_id, estado);
create index if not exists idx_orm_blocs_rango on orm_blocs (empresa_id, or_inicial, or_final);

-- ── Cada OR del bloc ─────────────────────────────────────────
-- Las 25 filas se crean con el bloc, todas en PENDIENTE: «qué falta» son las
-- que nadie ha tocado. El unique (empresa_id, numero_or) es la regla «una OR
-- pertenece a un solo bloc», y vive en la base porque dos altas simultáneas
-- pasarían cualquier comprobación previa.
create table if not exists orm_or (
  id                      uuid primary key default gen_random_uuid(),
  empresa_id              uuid not null,
  bloc_id                 uuid not null references orm_blocs(id) on delete cascade,
  numero_or               integer not null,
  estado                  text not null default 'PENDIENTE'
                          check (estado in ('PENDIENTE','ESCANEADA','REVISAR','DUPLICADA','ERROR')),
  documento_principal_id  uuid,
  fecha_escaneo           timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (empresa_id, numero_or)
);
create index if not exists idx_orm_or_bloc on orm_or (bloc_id, numero_or);
create index if not exists idx_orm_or_estado on orm_or (empresa_id, estado);

-- ── El lote que alguien sube ─────────────────────────────────
create table if not exists orm_procesamientos (
  id                      uuid primary key default gen_random_uuid(),
  empresa_id              uuid not null,
  archivo_original        text not null,
  storage_key_original    text,
  hash_original           text,
  mime                    text,
  paginas                 integer not null default 0,
  paginas_procesadas      integer not null default 0,
  documentos_detectados   integer not null default 0,
  documentos_correctos    integer not null default 0,
  documentos_revision     integer not null default 0,
  no_identificados        integer not null default 0,
  duplicados              integer not null default 0,
  errores                 integer not null default 0,
  usuario_id              uuid,
  usuario_nombre          text,
  fecha_inicio            timestamptz not null default now(),
  fecha_fin               timestamptz,
  estado                  text not null default 'PENDIENTE'
                          check (estado in ('PENDIENTE','EN_CURSO','COMPLETADO','ERROR')),
  etapa                   text,
  error_mensaje           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_orm_proc_empresa_fecha on orm_procesamientos (empresa_id, fecha_inicio desc);
create index if not exists idx_orm_proc_pendientes on orm_procesamientos (estado, fecha_inicio)
  where estado in ('PENDIENTE','EN_CURSO');

-- ── Cada página escaneada ────────────────────────────────────
-- Una fila por PÁGINA: la regla del módulo es «una página, una OR», así que un
-- PDF de 25 páginas deja 25 documentos. or_id y bloc_id son null mientras no
-- se sepa de quién es la hoja: ése es el estado NO_IDENTIFICADO.
create table if not exists orm_documentos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null,
  or_id                 uuid references orm_or(id) on delete set null,
  bloc_id               uuid references orm_blocs(id) on delete set null,
  procesamiento_id      uuid references orm_procesamientos(id) on delete set null,
  nombre_archivo        text not null,
  nombre_original       text not null,
  pagina_origen         integer,
  storage_key           text not null,
  tipo_archivo          text not null default 'application/pdf',
  tamano_bytes          integer not null default 0,
  hash_archivo          text not null,
  ocr_numero_detectado  integer,
  ocr_confianza         integer,
  ocr_metodo            text,
  ocr_texto             text,
  estado_procesamiento  text not null default 'PENDIENTE'
                        check (estado_procesamiento in ('PENDIENTE','ARCHIVADO','REVISION','NO_IDENTIFICADO','DUPLICADO','SUSTITUIDO','ERROR','ELIMINADO')),
  error_mensaje         text,
  sustituye_a           uuid references orm_documentos(id) on delete set null,
  usuario_carga         uuid,
  usuario_carga_nombre  text,
  fecha_carga           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_orm_doc_or on orm_documentos (or_id) where or_id is not null;
create index if not exists idx_orm_doc_estado on orm_documentos (empresa_id, estado_procesamiento, fecha_carga desc);
create index if not exists idx_orm_doc_hash on orm_documentos (empresa_id, hash_archivo);
create index if not exists idx_orm_doc_proc on orm_documentos (procesamiento_id);

-- ── Custodia: quién se llevó el bloc y cuándo lo trajo ───────
create table if not exists orm_entregas (
  id                        uuid primary key default gen_random_uuid(),
  empresa_id                uuid not null,
  bloc_id                   uuid not null references orm_blocs(id) on delete cascade,
  responsable_id            uuid,
  responsable_nombre        text,
  fecha_entrega             date not null,
  fecha_devolucion          date,
  observaciones             text,
  observaciones_devolucion  text,
  usuario_registro          uuid,
  usuario_registro_nombre   text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists idx_orm_entregas_bloc on orm_entregas (bloc_id, fecha_entrega desc);
-- Un bloc no se entrega dos veces sin volver primero.
create unique index if not exists idx_orm_entregas_abierta on orm_entregas (bloc_id) where fecha_devolucion is null;

-- ── Avisos ───────────────────────────────────────────────────
-- Uno vivo por bloc y tipo: si cada recálculo creara una fila, la pantalla de
-- Avisos sería un historial de ruido en vez de una lista de cosas por hacer.
create table if not exists orm_avisos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null,
  bloc_id             uuid references orm_blocs(id) on delete cascade,
  or_id               uuid references orm_or(id) on delete cascade,
  tipo                text not null check (tipo in ('BLOC_INCOMPLETO','DOCUMENTO_PENDIENTE','OR_DUPLICADA')),
  mensaje             text not null,
  responsable_id      uuid,
  responsable_nombre  text,
  canal               text not null default 'INTERNO' check (canal in ('INTERNO','EMAIL','WHATSAPP','SMS','PUSH')),
  estado              text not null default 'ABIERTO' check (estado in ('ABIERTO','NOTIFICADO','RESUELTO')),
  fecha_creacion      timestamptz not null default now(),
  fecha_notificacion  timestamptz,
  fecha_resolucion    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_orm_avisos_estado on orm_avisos (empresa_id, estado, fecha_creacion desc);
create unique index if not exists idx_orm_avisos_vivo on orm_avisos (bloc_id, tipo)
  where estado <> 'RESUELTO' and bloc_id is not null;

-- ── El diario del módulo, inmutable ──────────────────────────
create table if not exists orm_eventos (
  id              bigint generated always as identity primary key,
  empresa_id      uuid not null,
  bloc_id         uuid,
  or_id           uuid,
  documento_id    uuid,
  accion          text not null,
  detalle         jsonb,
  usuario_id      uuid,
  usuario_nombre  text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_orm_eventos_bloc on orm_eventos (bloc_id, created_at desc);
create index if not exists idx_orm_eventos_empresa on orm_eventos (empresa_id, created_at desc);

create or replace function orm_eventos_solo_insertar() returns trigger as $$
begin
  raise exception 'orm_eventos es inmutable: no se puede % una fila del histórico', tg_op;
end;
$$ language plpgsql;

drop trigger if exists orm_eventos_inmutable_trg on orm_eventos;
create trigger orm_eventos_inmutable_trg
  before update or delete on orm_eventos
  for each row execute function orm_eventos_solo_insertar();

-- ── Configuración por empresa ────────────────────────────────
-- La zona de OCR y los umbrales de confianza viven aquí para poder cambiarlos
-- sin desplegar. Sólo se guarda lo que alguien ha cambiado; los valores por
-- defecto están en server/or-manuales/config.ts.
create table if not exists orm_config (
  empresa_id  uuid not null,
  clave       text not null,
  valor       text,
  updated_at  timestamptz not null default now(),
  primary key (empresa_id, clave)
);
