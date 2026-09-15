-- ============================================================
-- Mobilink Therefore — Fase 3b: análisis de albaranes
--
-- Cinco tablas. La frontera entre ellas responde a una pregunta: ¿esto es de
-- la FACTURA o del ALBARÁN?
--
--   thf_documentos              La cabecera del fichero: una factura entera,
--                               con su número, su emisor y sus totales.
--   thf_albaranes_analizados    Lo que se ha sacado de UN albarán para UNA
--                               actuación. Y, de paso, la cola: su columna
--                               estado_proceso es lo que el worker consulta.
--   thf_albaran_lineas          Las líneas de artículo, con la confianza de
--                               cada celda y de dónde salió.
--   thf_albaran_linea_descuentos  Un descuento por fila y en orden: «60% + 10%»
--                               son DOS, nunca uno del 64 %.
--   thf_validaciones            Por qué un análisis está en revisión.
--
-- Una factura con cinco albaranes da UNA fila de documento y CINCO de
-- análisis, y cada una puede estar en un estado distinto, que es lo normal.
--
-- EQUIVALENTE EN CÓDIGO: server/therefore/schema.ts (initTherefore).
--
-- Requiere therefore_fase1.sql y therefore_fase2.sql. Idempotente.
-- ============================================================

do $$
begin
  if to_regclass('public.thf_adjuntos') is null then
    raise exception 'Falta therefore_fase2.sql: ejecútalo antes que éste';
  end if;
end $$;

-- ── El documento, una vez por fichero ───────────────────────────────────────
--
-- El correo y el papel se comparan y NUNCA se sobrescribe el dato del correo:
-- si el número de factura no coincide, se guardan los dos y sale una
-- validación. Quién manda lo decide una persona, no el parser.
create table if not exists thf_documentos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null,
  expediente_id         uuid not null references thf_expedientes(id) on delete cascade,
  adjunto_id            uuid references thf_adjuntos(id) on delete set null,

  hash_archivo          text not null,

  tipo_documento        text not null default 'OTRO'
                          check (tipo_documento in ('FACTURA','ABONO','ALBARAN','OTRO')),
  numero_documento      text,
  fecha_documento       date,

  proveedor_nombre      text,
  proveedor_nif         text,
  cliente_nombre        text,
  cliente_nif           text,

  -- Céntimos CON SIGNO, como en todo el módulo: un abono es negativo.
  base_centimos         bigint,
  iva_centimos          bigint,
  total_centimos        bigint,
  moneda                text not null default 'EUR',

  -- [{numeroDocumento, normalizado, paginaInicio, paginaFin}]
  albaranes_detectados  jsonb not null default '[]',

  origen                text check (origen in ('XML','PDF_TEXTO','PDF_IA')),
  parser_usado          text,
  confianza             jsonb not null default '{}',
  metadata_json         jsonb not null default '{}',

  validacion            text not null default 'SIN_COMPARAR'
                          check (validacion in ('SIN_COMPARAR','VALIDADO','DISCREPANCIA')),
  discrepancias         jsonb not null default '[]',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- El mismo fichero en el mismo expediente se analiza UNA vez.
  unique (expediente_id, hash_archivo)
);
create index if not exists thf_doc_expediente_idx on thf_documentos(expediente_id);
create index if not exists thf_doc_hash_idx on thf_documentos(empresa_id, hash_archivo);

-- ── El albarán analizado, y la cola ─────────────────────────────────────────
--
-- estado_proceso ES la cola. No hay infraestructura nueva: es el patrón del
-- proyecto —la tabla como cola, FOR UPDATE SKIP LOCKED para repartir entre
-- instancias— y cuesta una columna en vez de un servicio.
--
-- Una fila por INTENTO VIVO. Reanalizar no machaca: crea otra fila y deja la
-- anterior como histórico (metadata_json.sustituidaPor), porque la comparación
-- «antes y después» de un parser corregido es lo que hay que poder enseñar el
-- día que alguien pregunte por qué ahora sale otra cosa.
create table if not exists thf_albaranes_analizados (
  id                          uuid primary key default gen_random_uuid(),
  empresa_id                  uuid not null,
  expediente_id               uuid not null references thf_expedientes(id) on delete cascade,
  actuacion_id                uuid not null references thf_actuaciones(id) on delete cascade,
  adjunto_id                  uuid references thf_adjuntos(id) on delete set null,
  documento_id                uuid references thf_documentos(id) on delete set null,

  -- El que pedía la incidencia y el que trae el papel. Se guardan los dos: la
  -- diferencia entre ellos es la mitad de la información.
  numero_solicitado           text not null,
  numero_documento            text,
  numero_normalizado          text,

  confianza_match             numeric(3,2),
  resultado_match             text check (resultado_match in ('MATCH','UNCERTAIN','NO_MATCH')),

  fecha                       date,
  matricula                   text,
  bastidor                    text,
  observaciones               text,

  -- Copia del importe de la actuación EN EL MOMENTO del análisis: si luego
  -- llega una corrección, el análisis sigue explicando lo que comparó.
  importe_incidencia_centimos bigint,
  importe_lineas_centimos     bigint,
  diferencia_centimos         bigint,

  estado_analisis             text check (estado_analisis in ('OK','REVISAR','ERROR')),

  estado_proceso              text not null default 'PENDIENTE'
                                check (estado_proceso in ('PENDIENTE','PROCESANDO','COMPLETADO','ERROR')),
  intentos                    integer not null default 0,
  error                       text,
  procesando_desde            timestamptz,

  pagina_inicio               integer,
  pagina_fin                  integer,
  parser_usado                text,
  origen                      text,

  metadata_json               jsonb not null default '{}',

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists thf_alb_actuacion_idx on thf_albaranes_analizados(actuacion_id);
create index if not exists thf_alb_expediente_idx on thf_albaranes_analizados(expediente_id);
-- La cola: sólo lo que queda por hacer, que es lo que se consulta cada 15 s.
create index if not exists thf_alb_cola_idx
  on thf_albaranes_analizados(empresa_id, created_at)
  where estado_proceso in ('PENDIENTE','PROCESANDO');

-- ── Las líneas ──────────────────────────────────────────────────────────────
--
-- raw_text, pagina y bbox no son metadatos de adorno: son lo que permite
-- enseñar de dónde salió cada celda. Sin ellos, «el precio es 77,50» es una
-- afirmación que nadie puede comprobar sin reabrir el PDF a mano.
create table if not exists thf_albaran_lineas (
  id                        uuid primary key default gen_random_uuid(),
  empresa_id                uuid not null,
  albaran_analizado_id      uuid not null references thf_albaranes_analizados(id) on delete cascade,
  numero_linea              integer not null,

  referencia                text,
  descripcion               text,
  cantidad                  numeric(12,3),
  precio_unitario_centimos  bigint,
  importe_centimos          bigint,

  confianza_referencia      numeric(3,2),
  confianza_descripcion     numeric(3,2),
  confianza_cantidad        numeric(3,2),
  confianza_precio          numeric(3,2),
  confianza_importe         numeric(3,2),
  confianza_descuentos      numeric(3,2),

  -- cantidad · precio · Π(1 − dᵢ) ≈ importe. NULL si faltan datos para
  -- comprobarlo, que no es lo mismo que fallar.
  cuadra_aritmetica         boolean,

  raw_text                  text not null,
  pagina                    integer,
  bbox                      jsonb,
  metadata_json             jsonb not null default '{}',

  created_at                timestamptz not null default now(),

  unique (albaran_analizado_id, numero_linea)
);
create index if not exists thf_alb_lin_albaran_idx on thf_albaran_lineas(albaran_analizado_id);

-- ── Los descuentos de cada línea ────────────────────────────────────────────
--
-- Una fila por descuento y en orden. raw_value conserva lo impreso porque es
-- lo que el ERP pide y lo que está pactado con el proveedor; «64 %» no aparece
-- en ningún papel.
create table if not exists thf_albaran_linea_descuentos (
  id          uuid primary key default gen_random_uuid(),
  linea_id    uuid not null references thf_albaran_lineas(id) on delete cascade,
  orden       integer not null,
  porcentaje  numeric(6,3),
  raw_value   text not null,
  unique (linea_id, orden)
);

-- ── Las validaciones ────────────────────────────────────────────────────────
--
-- Es lo que explica POR QUÉ algo está en revisión. Un estado sin motivo obliga
-- a quien lo recibe a repetir a mano el trabajo del parser.
create table if not exists thf_validaciones (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null,
  expediente_id         uuid not null references thf_expedientes(id) on delete cascade,
  actuacion_id          uuid references thf_actuaciones(id) on delete cascade,
  albaran_analizado_id  uuid references thf_albaranes_analizados(id) on delete cascade,

  tipo                  text not null check (tipo in (
                          'ALBARAN_MATCH','IMPORTE','LINEAS','DESCUENTOS','CAMPOS_CRITICOS',
                          'SEPARACION_ALBARANES','DOCUMENTO','CORREO_VS_DOCUMENTO')),
  estado                text not null check (estado in ('OK','REVISAR','ERROR')),

  -- Escrito para la pantalla, no para el log.
  mensaje               text not null,
  valor_esperado        text,
  valor_obtenido        text,
  metadata_json         jsonb not null default '{}',

  created_at            timestamptz not null default now()
);
create index if not exists thf_val_albaran_idx on thf_validaciones(albaran_analizado_id);
-- Lo que no está OK es lo único que se busca por expediente.
create index if not exists thf_val_pendientes_idx
  on thf_validaciones(expediente_id, estado)
  where estado <> 'OK';

-- Las claves ajenas hacia app_* viven aquí y no en el init del servidor: las
-- pruebas de integración levantan una base desechable sin la fundación SaaS.
do $$
begin
  if to_regclass('public.app_empresas') is not null then
    if not exists (select 1 from pg_constraint where conname = 'thf_documentos_empresa_fk') then
      alter table thf_documentos
        add constraint thf_documentos_empresa_fk
        foreign key (empresa_id) references app_empresas(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'thf_albaranes_empresa_fk') then
      alter table thf_albaranes_analizados
        add constraint thf_albaranes_empresa_fk
        foreign key (empresa_id) references app_empresas(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'thf_alb_lineas_empresa_fk') then
      alter table thf_albaran_lineas
        add constraint thf_alb_lineas_empresa_fk
        foreign key (empresa_id) references app_empresas(id) on delete cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'thf_validaciones_empresa_fk') then
      alter table thf_validaciones
        add constraint thf_validaciones_empresa_fk
        foreign key (empresa_id) references app_empresas(id) on delete cascade;
    end if;
  end if;
end $$;

do $$
begin
  raise notice 'OK: Therefore fase 3b (documentos, albaranes analizados, líneas, descuentos y validaciones)';
end $$;
