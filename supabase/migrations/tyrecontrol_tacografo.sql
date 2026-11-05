-- ============================================================
-- SEA TyreControl — Tacógrafo: el registro de intervenciones del centro.
--
-- ── Por qué esta migración empieza declarando lo que ya existe ──────────────
--
-- `tc_tacografo_intervenciones` y `tc_tacografo_lotes` YA ESTÁN CREADAS en
-- producción, con sus índices, su clave única y sus políticas RLS. Lo que no
-- existe es ni una línea de código que las use ni una migración que las
-- declare: el repositorio no sabía de ellas. Eso es cómo se acaba borrando o
-- cambiando a ciegas una tabla con datos dentro.
--
-- Así que el primer bloque las declara EXACTAMENTE como están. Sobre una base
-- que ya las tiene no hace nada —`if not exists` en todo—, y sobre una base
-- nueva las crea iguales. El segundo bloque añade lo que les falta para que
-- quepa el fichero del centro.
--
-- Es idempotente de principio a fin: se puede pegar dos veces seguidas.
--
-- ── Qué se guarda aquí y qué no ─────────────────────────────────────────────
--
-- Una intervención de tacógrafo NO es una revisión de neumáticos ni una
-- intervención de taller: no mide ruedas ni mueve stock. Por eso vive en su
-- propia tabla y no se mete con `revisiones_vehiculo` ni `tc_intervenciones`.
--
-- Tampoco es el expediente del anexo II (transferencias e intransferibilidad),
-- que es el módulo `tac_*` y vive aparte. Son dos cosas distintas con el mismo
-- nombre de pila.
--
-- Y NO se toca nada de neumáticos: ni `tc_montajes_actuales`, ni
-- `tc_neumaticos`, ni `tc_vehiculo_ejes`, ni `config_ejes_id`, ni
-- `tc_vehiculos.km_actual`. La medida con la que se calibró un tacógrafo dice
-- con qué circunferencia se ajustó el aparato, no qué rueda hay montada hoy.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1 · Lo que ya existe en producción, declarado
-- ════════════════════════════════════════════════════════════

create table if not exists tc_tacografo_lotes (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references tc_empresas(id) on delete restrict,
  archivo_nombre  text not null,
  archivo_filas   integer not null default 0,
  filas_empresa   integer not null default 0,
  importadas      integer not null default 0,
  duplicadas      integer not null default 0,
  sin_vehiculo    integer not null default 0,
  bloqueadas      integer not null default 0,
  importado_por   uuid references tc_usuarios(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_tcg_lotes_empresa on tc_tacografo_lotes (empresa_id);

create table if not exists tc_tacografo_intervenciones (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references tc_empresas(id) on delete restrict,
  -- Null mientras la matrícula no case con ningún vehículo de la empresa. La
  -- intervención se guarda igual: es historia del centro, y el vehículo puede
  -- darse de alta mañana.
  vehiculo_id            uuid references tc_vehiculos(id) on delete set null,

  -- La identidad de una intervención: de dónde salió y con qué id venía. Sin
  -- el sistema de origen, dos ficheros distintos con la misma numeración se
  -- pisarían.
  sistema_origen         text not null default 'informe_intervenciones',
  id_origen              text not null,

  -- NOT NULL, y tiene sentido que lo sea: una intervención sin fecha no se
  -- puede situar en el histórico ni cuenta para el vencimiento. El importador
  -- bloquea esas filas y lo dice, en vez de meterlas a medias.
  fecha                  date not null,
  tipo_operacion         text,
  orden_trabajo          text,

  -- Tacógrafo
  referencia             text,
  version                text,
  num_serie              text,
  num_sensor             text,
  gnss                   text,
  dsrc                   text,

  -- Calibración
  medida_neumatico       text,
  medida_neumatico_norm  text,
  medida_sospechosa      boolean not null default false,
  param_l                text,
  param_w                text,
  param_k                text,

  -- Equipos del banco
  b_rodillos             text,
  eq_calibrado           text,
  manometro              text,
  cronometro             text,

  -- Vehículo, tal y como venía en el origen
  matricula_origen       text,
  matricula_norm         text,
  bastidor_origen        text,
  marca                  text,
  modelo                 text,
  categoria              text,

  cliente_nombre_origen  text,
  cliente_nif_origen     text,
  tecnico                text,
  observaciones          text,
  tgd_fichero            text,

  -- Trazabilidad de la importación
  lote_id                uuid references tc_tacografo_lotes(id) on delete set null,
  archivo_nombre         text,
  hoja_origen            text,
  fila_origen            integer,
  importado_por          uuid references tc_usuarios(id),
  importado_en           timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

-- La idempotencia. Volver a importar el mismo fichero no puede duplicar nada,
-- y el id del centro no es único por sí solo: lo es dentro de una empresa y un
-- sistema de origen.
--
-- Va como RESTRICCIÓN y no como índice único suelto porque así está en
-- producción. Son equivalentes para lo que hacen, pero si aquí se creara un
-- índice, una base nueva saldría distinta de la que ya existe, y el día que
-- alguien compare los dos esquemas tendría que averiguar cuál es el bueno.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tc_tacografo_interv_origen_uk'
       and conrelid = 'tc_tacografo_intervenciones'::regclass
  ) then
    alter table tc_tacografo_intervenciones
      add constraint tc_tacografo_interv_origen_uk
      unique (empresa_id, sistema_origen, id_origen);
  end if;
end $$;

create index if not exists idx_tcg_interv_empresa    on tc_tacografo_intervenciones (empresa_id);
create index if not exists idx_tcg_interv_vehiculo   on tc_tacografo_intervenciones (vehiculo_id);
create index if not exists idx_tcg_interv_veh_fecha  on tc_tacografo_intervenciones (vehiculo_id, fecha desc);
create index if not exists idx_tcg_interv_lote       on tc_tacografo_intervenciones (lote_id);
-- Las pendientes de vincular se buscan por matrícula normalizada, y son pocas:
-- el índice parcial cuesta nada y las encuentra sin recorrer la tabla.
create index if not exists idx_tcg_interv_pendientes
  on tc_tacografo_intervenciones (empresa_id, matricula_norm) where vehiculo_id is null;

alter table tc_tacografo_lotes          enable row level security;
alter table tc_tacografo_intervenciones enable row level security;

drop policy if exists tcg_lotes_sel on tc_tacografo_lotes;
create policy tcg_lotes_sel on tc_tacografo_lotes for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tcg_lotes_wr on tc_tacografo_lotes;
create policy tcg_lotes_wr on tc_tacografo_lotes for all
  using ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );

drop policy if exists tcg_interv_sel on tc_tacografo_intervenciones;
create policy tcg_interv_sel on tc_tacografo_intervenciones for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tcg_interv_wr on tc_tacografo_intervenciones;
create policy tcg_interv_wr on tc_tacografo_intervenciones for all
  using ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );


-- ════════════════════════════════════════════════════════════
-- 2 · Lo que les falta para que quepa el fichero del centro
-- ════════════════════════════════════════════════════════════
--
-- De las 52 columnas del informe de intervenciones, la tabla de producción
-- recoge 22. Estas son las que faltaban y sí merecen guardarse. Las diez que
-- no están aquí son del propio centro —nombre, dirección y contraseña del
-- taller— e idénticas en las 1.744 filas: guardarlas sería repetir el
-- membrete en cada línea.

alter table tc_tacografo_intervenciones
  -- El resultado. No es «se informó o no»: en este informe solo los calibrados
  -- lo llevan (1.295 de 1.300), y las instalaciones y transferencias vienen
  -- siempre con «-----». Ver `vencimiento.ts`.
  add column if not exists resultado             text,

  -- El cuentakilómetros, antes y después. Son LECTURAS FECHADAS, no el km del
  -- vehículo: `tc_vehiculos.km_actual` viene de la telemática y no se toca.
  add column if not exists km_anterior           numeric,
  add column if not exists km_nuevo              numeric,
  -- Lo marca el detector de coherencia cuando la lectura baja respecto a la
  -- anterior del mismo vehículo. En este fichero pasa 8 veces, y las 8 huelen
  -- a cambio de cuentakilómetros, no a errata.
  add column if not exists km_sospechoso         boolean default false,

  -- Los parámetros de antes del ajuste, para poder ver qué cambió.
  add column if not exists param_l_anterior      text,
  add column if not exists param_w_anterior      text,
  add column if not exists medida_anterior       text,
  add column if not exists medida_anterior_norm  text,

  -- El aparato
  add column if not exists tipo_tacografo        text,
  add column if not exists fabricante            text,
  add column if not exists version_mapa          text,
  add column if not exists precintos             text,

  -- La tarjeta del técnico que firmó
  add column if not exists tecnico_tarjeta       text,
  add column if not exists tecnico_tarjeta_cad   date,
  add column if not exists tecnico_tarjeta_ver   text,

  -- Las ocho comprobaciones y los tres errores de distancia, en un jsonb.
  -- Van juntas y a propósito: solo las llevan los tacógrafos inteligentes
  -- recientes (entre 16 y 36 filas de 1.744), y once columnas vacías en el
  -- 98% de la tabla son once columnas que nadie consulta. Como jsonb se
  -- guardan tal cual vinieron y se enseñan en el detalle.
  add column if not exists comprobaciones        jsonb;


-- ════════════════════════════════════════════════════════════
-- 3 · La regla de periodicidad, por empresa
-- ════════════════════════════════════════════════════════════
--
-- La periodicidad del tacógrafo es una regla OPERATIVA del cliente, no una ley
-- universal, y por eso vive en una tabla y no en el código. Para Plana son 24
-- meses desde la última intervención registrada.
--
-- `tipos_reinician` y `resultados_reinician` a NULL significan «todos», que es
-- lo acordado para Plana. Se dejan ahí porque la pregunta de si una
-- transferencia debe reiniciar un plazo técnico es legítima, y el día que se
-- responda no debería hacer falta tocar código. Ver `vencimiento.ts`.

create table if not exists tc_tacografo_regla (
  empresa_id            uuid primary key references tc_empresas(id) on delete cascade,
  meses                 integer not null default 24 check (meses between 1 and 120),
  -- Cuántos días antes empieza a avisar. 60 es lo que da margen a pedir cita.
  aviso_dias            integer not null default 60 check (aviso_dias between 0 and 365),
  -- NULL = cualquiera. Si lleva valores, solo esos reinician el plazo.
  tipos_reinician       text[],
  resultados_reinician  text[],
  nota                  text,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references tc_usuarios(id)
);

alter table tc_tacografo_regla enable row level security;
drop policy if exists tcg_regla_sel on tc_tacografo_regla;
create policy tcg_regla_sel on tc_tacografo_regla for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tcg_regla_wr on tc_tacografo_regla;
create policy tcg_regla_wr on tc_tacografo_regla for all
  using ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );


-- ════════════════════════════════════════════════════════════
-- 4 · Las propuestas de medida
-- ════════════════════════════════════════════════════════════
--
-- Lo que el tacógrafo sabe de la medida NO se escribe solo en el vehículo.
-- Aquí queda la propuesta, con su evidencia —medida original, normalizada,
-- fecha e id de la intervención de la que sale— y alguien la acepta o no.
--
-- Al aceptar, lo ÚNICO que se escribe es `tc_vehiculos.medida_id`, la medida
-- habitual. Nunca un montaje, un neumático, un eje ni una posición: la medida
-- de calibración no demuestra qué rueda hay puesta.
--
-- `caso` distingue las tres situaciones, porque no se tratan igual:
--   sin_medida     · el vehículo no tiene medida. Se puede aceptar en bloque.
--   solo_marcado   · misma medida, distinto marcado C (225/75R16C vs 225/75R16).
--                    No es una discrepancia; se enseña para que se vea.
--   discrepa       · medidas distintas de verdad. Una a una, siempre.
--   sin_vehiculo   · la matrícula no casa con ningún vehículo de la empresa.

create table if not exists tc_tacografo_medida_propuesta (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id        uuid references tc_vehiculos(id) on delete cascade,
  matricula_norm     text not null,

  caso               text not null
    check (caso in ('sin_medida','solo_marcado','discrepa','sin_vehiculo')),

  -- La evidencia, tal cual salió del informe
  intervencion_id    uuid references tc_tacografo_intervenciones(id) on delete cascade,
  id_origen          text,
  fecha_intervencion date,
  medida_origen      text,
  medida_norm        text not null,

  -- Lo que TyreControl tenía cuando se creó la propuesta, para que al
  -- resolverla se vea contra qué se comparó y no contra lo que haya cambiado.
  medida_actual_id   uuid references tc_cat_medidas_neumatico(id) on delete set null,
  medida_actual      text,

  estado             text not null default 'pendiente'
    check (estado in ('pendiente','aceptada','rechazada','caducada')),
  resuelto_por       uuid references tc_usuarios(id),
  resuelto_en        timestamptz,
  nota               text,

  lote_id            uuid references tc_tacografo_lotes(id) on delete set null,
  created_at         timestamptz not null default now()
);

-- Una propuesta viva por vehículo y medida: reimportar el mismo fichero no
-- puede llenar la pantalla de la misma propuesta repetida.
create unique index if not exists tc_tacografo_propuesta_uk
  on tc_tacografo_medida_propuesta (empresa_id, matricula_norm, medida_norm)
  where estado = 'pendiente';
create index if not exists idx_tcg_prop_empresa_estado
  on tc_tacografo_medida_propuesta (empresa_id, estado);
create index if not exists idx_tcg_prop_vehiculo
  on tc_tacografo_medida_propuesta (vehiculo_id);

alter table tc_tacografo_medida_propuesta enable row level security;
drop policy if exists tcg_prop_sel on tc_tacografo_medida_propuesta;
create policy tcg_prop_sel on tc_tacografo_medida_propuesta for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tcg_prop_wr on tc_tacografo_medida_propuesta;
create policy tcg_prop_wr on tc_tacografo_medida_propuesta for all
  using ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );


comment on table tc_tacografo_intervenciones is
  'Intervenciones de tacógrafo del centro técnico, importadas del informe de intervenciones. Una fila por intervención; la identidad es (empresa_id, sistema_origen, id_origen).';
comment on table tc_tacografo_medida_propuesta is
  'Propuestas de medida habitual deducidas de la calibración del tacógrafo. Al aceptarse solo escriben tc_vehiculos.medida_id; nunca montajes, neumáticos, ejes ni posiciones.';
comment on table tc_tacografo_regla is
  'Periodicidad de tacógrafo por empresa. Regla operativa del cliente, no legal: para Plana, 24 meses desde la última intervención registrada.';
