-- ═══════════════════════════════════════════════════════════════════════════
--  MC CENTRAL · TODAS LAS MIGRACIONES (fases 1 a 21)
--
--  Para pegar de una vez en el SQL Editor de Supabase.
--
--  · TODO es idempotente: se puede ejecutar mas de una vez sin romper nada.
--  · El ORDEN importa. Va de la fase 1 a la 21 y no debe alterarse.
--  · La mayoria de estas tablas las crea tambien initCash/initCentral al
--    arrancar el servidor. Lo que NO hace el arranque, y por lo que este
--    fichero es imprescindible, es:
--       - la clave ajena cash_registers.centro_id -> app_centros  (fase 1)
--       - el BACKFILL que empareja las cajas con su taller        (fase 1)
--       - retirar las claves ajenas de app_auditoria              (fase 10)
--       - el indice de consumo que evita recorrer el libro entero  (fase 20)
--
--  REQUISITO PREVIO: la fundacion SaaS (saas_fase1_empresas_licencias.sql) tiene
--  que estar aplicada. Este fichero da por hechas app_empresas, app_centros,
--  app_licencias, app_usuario_modulos y app_auditoria.
--
--  VERIFICADO: aplicado dos veces seguidas sobre una base con el esquema de
--  caja y la fundacion SaaS, sin un solo error. Deja 17 tablas central_*, las
--  columnas nuevas de cash_registers / cash_sessions / cash_operation_documents,
--  el backfill de talleres hecho y la auditoria ya inmutable.
--
--  AVISO IMPORTANTE (fase 10): la auditoria pasa a escribirse DENTRO de la
--  transaccion que mueve el dinero. Si se despliega el codigo sin aplicar
--  este fichero, la clave ajena de app_auditoria sigue puesta y un empresa_id
--  que no estuviera en app_empresas tumbaria un cobro. Aplicalo ANTES o A LA
--  VEZ que el despliegue, no despues.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- central_fase1_jerarquia.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 1 — jerarquía: ZONA → TALLER → CAJA
--
-- Todo lo de aquí es ADITIVO y todas las columnas nacen NULLABLE. Es
-- deliberado: el DDL equivalente de `server/cash/schema.ts` se ejecuta en CADA
-- arranque del servidor, así que un NOT NULL puesto antes de tiempo no da un
-- error de migración: **impide arrancar el proceso**. Ya pasó en este módulo
-- con un CHECK de motivos que reventaba al existir el primer asiento
-- `BAG_OPENED`. Endurecer es una migración posterior, cuando el backfill esté
-- verificado contra los datos reales.
--
-- Equivalente en código: server/cash/schema.ts (bloque «Jerarquía»).

-- ── 1) Zonas ────────────────────────────────────────────────────────────────
-- Agrupación de talleres dentro de una empresa. Opcional: una empresa de un
-- solo taller no tiene por qué inventarse una zona.
create table if not exists app_zonas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references app_empresas(id) on delete cascade,
  nombre      text not null,
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_app_zonas_empresa on app_zonas (empresa_id, activa);

-- El nombre es único DENTRO de la empresa, no en toda la instalación: dos
-- empresas pueden tener cada una su zona «Norte» sin saber la una de la otra.
create unique index if not exists idx_app_zonas_nombre
  on app_zonas (empresa_id, lower(nombre));

-- ── 2) Centro → zona ────────────────────────────────────────────────────────
alter table app_centros
  add column if not exists zona_id uuid references app_zonas(id) on delete set null;

-- `on delete set null` y no cascade: borrar una zona reorganiza el mapa, no
-- borra talleres. Un taller sin zona sigue siendo un taller.
create index if not exists idx_app_centros_zona on app_centros (zona_id);

-- ── 3) Caja → centro ────────────────────────────────────────────────────────
-- Hasta ahora `cash_registers.centro` era TEXTO LIBRE, así que agrupar por
-- taller era agrupar cadenas. La columna de texto SE CONSERVA durante toda la
-- fase: la usan los informes (`server/cash/report.ts`) y el `ON CONFLICT
-- (empresa_id, centro, nombre)` del alta de cajas. Quitarla es trabajo de
-- después de verificar el backfill.
alter table cash_registers
  add column if not exists centro_id uuid references app_centros(id);

create index if not exists cash_registers_centro_idx on cash_registers (centro_id);

-- ── 4) Backfill ─────────────────────────────────────────────────────────────
-- Empareja por nombre normalizado (sin tildes, sin mayúsculas, sin espacios de
-- sobra) dentro de la MISMA empresa.
--
-- Lo que no case queda a NULL y se resuelve a mano desde Configuración. No se
-- adivina: asignar una caja al taller equivocado es peor que dejarla sin
-- asignar, porque el error viaja después a todos los informes consolidados y
-- nadie lo vuelve a mirar.
--
-- Idempotente: solo toca las filas que aún están a NULL, así que reejecutarlo
-- no deshace ninguna asignación hecha a mano.
-- Un detalle que importa: `app_centros` no impide dos talleres con el mismo
-- nombre en la misma empresa, así que se exige coincidencia ÚNICA. Con dos
-- candidatos el emparejamiento sería una moneda al aire, y una caja asignada
-- al taller equivocado descuadra todos los informes consolidados de después.
with normalizado as (
  select id,
         empresa_id,
         upper(translate(btrim(nombre),
           'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
           'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')) as clave
    from app_centros
),
unico as (
  -- `(array_agg(id))[1]` y no `min(id)`: PostgreSQL no tiene min() para uuid.
  -- Da igual cuál se coja porque el `having` de abajo deja solo los grupos de
  -- un elemento, pero sin agregarlo la consulta ni siquiera compila.
  select empresa_id, clave, (array_agg(id))[1] as centro_id
    from normalizado
   group by empresa_id, clave
  having count(*) = 1
)
update cash_registers c
   set centro_id = u.centro_id
  from unico u
 where c.centro_id is null
   and c.centro <> ''
   and u.empresa_id = c.empresa_id
   and u.clave = upper(translate(btrim(c.centro),
         'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
         'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'));


-- ───────────────────────────────────────────────────────────────────────
-- central_fase2_eventos.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 2 — cola de eventos de dominio
--
-- Hermana de `cash_erp_outbox`, y tabla aparte a propósito: aquélla lleva
-- `connector_key` y una clave ajena a `cash_operations`, y está en producción.
-- Mezclar dos dominios en una cola viva es riesgo gratuito.
--
-- Lo que manda sobre todo el diseño: esta fila se escribe DENTRO de la
-- transacción que mueve el dinero. Si su INSERT fallara, se desharía un cobro
-- que ya ocurrió físicamente. Por eso NO hay clave ajena, ni CHECK sobre el
-- tipo, ni ninguna restricción que dependa de los datos: lo único que puede
-- rechazar esta fila es que la base esté caída, y entonces el cobro tampoco se
-- habría guardado.
--
-- Equivalente en código: server/cash/schema.ts (bloque «Cola de eventos»).

create table if not exists cash_event_outbox (
  id                bigserial primary key,
  -- Clave de deduplicación en destino; viaja como Idempotency-Key.
  event_id          uuid not null default gen_random_uuid() unique,
  empresa_id        uuid not null,
  -- El taller se copia aunque se pueda deducir de la caja: el evento cuenta lo
  -- que pasó ENTONCES, y eso incluye dónde pasó. La caja pudo reasignarse.
  centro_id         uuid,
  register_id       integer,
  session_id        integer,
  aggregate_type    text,
  aggregate_id      bigint,
  aggregate_version bigint,
  tipo              text not null,
  -- Cuándo OCURRIÓ, que no es cuándo se envía ni cuándo se tecleó.
  ocurrido_en_ms    bigint not null,
  actor_user_id     uuid,
  datos             jsonb not null default '{}'::jsonb,
  estado            text not null default 'PENDING'
                    check (estado in ('PENDING','SENDING','SENT','ERROR','RETRY_PENDING','CANCELLED')),
  intentos          integer not null default 0,
  proximo_intento_ms bigint,
  last_error        text,
  created_at_ms     bigint not null,
  processed_at_ms   bigint
);

create index if not exists cash_events_pendientes_idx
  on cash_event_outbox (estado, proximo_intento_ms)
  where estado in ('PENDING','RETRY_PENDING');

create index if not exists cash_events_empresa_idx
  on cash_event_outbox (empresa_id, created_at_ms desc);

-- Orden de reconstrucción para Central: por agregado y versión.
create index if not exists cash_events_agregado_idx
  on cash_event_outbox (aggregate_type, aggregate_id, aggregate_version);

-- Versión del agregado: deja ver un hueco o un evento que llega tarde sin
-- fiarse del reloj. Sube dentro de bloqueos que YA existen —la jornada en
-- `bloquearSesion`, la caja en los ingresos bancarios—, así que no añade
-- contención: el incremento va donde ya había un FOR UPDATE.
--
-- `not null default 0` no reescribe las filas existentes (PostgreSQL guarda el
-- valor por defecto en el catálogo desde la 11), así que es seguro con datos.
alter table cash_sessions  add column if not exists version bigint not null default 0;
alter table cash_registers add column if not exists version bigint not null default 0;


-- ───────────────────────────────────────────────────────────────────────
-- central_fase3_readmodels.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 3 — proyecciones de supervisión
--
-- Central NO escribe nunca en las tablas cash_*. Estas tablas son proyecciones:
-- si se borraran enteras, se reconstruyen volviendo a pasar central_events. Esa
-- propiedad es lo que las hace seguras — un error de agregación aquí no puede
-- corromper la caja, que sigue siendo la fuente de verdad de lo suyo.
--
-- Equivalente en código: server/central/schema.ts.

-- Lo que ha llegado, y a la vez la BARRERA DE DEDUPLICACIÓN: event_id es clave
-- primaria, así que reenviar el mismo evento no puede aplicarlo dos veces. La
-- defensa contra el doble conteo no es una comprobación de código: es la clave.
create table if not exists central_events (
  event_id          uuid primary key,
  empresa_id        uuid not null,
  centro_id         uuid,
  register_id       integer,
  session_id        integer,
  aggregate_type    text,
  aggregate_id      bigint,
  aggregate_version bigint,
  tipo              text not null,
  ocurrido_en_ms    bigint not null,
  actor_user_id     uuid,
  datos             jsonb not null default '{}'::jsonb,
  recibido_en_ms    bigint not null,
  -- APLICADO: cambió la proyección. TARDIO: llegó detrás de uno más nuevo del
  -- mismo agregado. Distinguirlos es lo que separa «no ha llegado» de «llegó y
  -- se descartó».
  resultado         text not null default 'APLICADO'
);

create index if not exists central_events_empresa_idx
  on central_events (empresa_id, ocurrido_en_ms desc);
create index if not exists central_events_agregado_idx
  on central_events (aggregate_type, aggregate_id, aggregate_version);

-- La jornada vista desde la red. `ultima_version` es la del último evento de
-- ESTADO aplicado: uno con versión menor llega tarde y no lo pisa. Sin esto, un
-- evento retrasado por un reintento reabriría en pantalla una jornada cerrada.
create table if not exists central_sessions (
  session_id                integer primary key,
  empresa_id                uuid not null,
  centro_id                 uuid,
  register_id               integer not null,
  fecha                     date,
  estado                    text,
  fondo_inicial_centimos    bigint not null default 0,
  contado_centimos          bigint,
  diferencia_centimos       bigint,
  ingreso_bancario_centimos bigint,
  cambio_final_centimos     bigint,
  operaciones               integer not null default 0,
  efectivo_neto_centimos    bigint not null default 0,
  cobros_centimos           bigint not null default 0,
  pagos_centimos            bigint not null default 0,
  anulaciones               integer not null default 0,
  reaperturas               integer not null default 0,
  abierta_en_ms             bigint,
  cerrada_en_ms             bigint,
  ultima_version            bigint not null default 0,
  actualizado_en_ms         bigint not null
);

create index if not exists central_sessions_red_idx on central_sessions (empresa_id, fecha desc);
create index if not exists central_sessions_abiertas_idx on central_sessions (empresa_id, estado);
create index if not exists central_sessions_centro_idx on central_sessions (centro_id, fecha desc);

-- La caja vista desde la red. Existe para responder rápido a «¿cuál lleva tres
-- días sin cerrar?», que con solo la tabla de jornadas obligaría a agregar todo
-- el histórico cada vez que se abre la pantalla.
create table if not exists central_registers (
  register_id          integer primary key,
  empresa_id           uuid not null,
  centro_id            uuid,
  ultima_actividad_ms  bigint,
  ultima_fecha_cerrada date,
  jornada_abierta_id   integer,
  ingresos_bancarios   integer not null default 0,
  ingresado_centimos   bigint not null default 0,
  actualizado_en_ms    bigint not null
);

create index if not exists central_registers_empresa_idx on central_registers (empresa_id);

-- Alta del módulo `central` en licencias y permisos.
--
-- El CHECK se recrea con la lista COMPLETA y en UN SOLO sitio. Es la regla que
-- este proyecto aprendió por las malas: con dos bloques recreando el mismo
-- CHECK, el de arriba se queda con la lista vieja y el servidor deja de
-- arrancar en cuanto existe la primera fila con el valor nuevo.
alter table app_licencias drop constraint if exists app_licencias_modulo_check;
alter table app_licencias add constraint app_licencias_modulo_check
  check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol',
                    'safety','presencia','taller','workplanner','cash','central'));

alter table app_usuario_modulos drop constraint if exists app_usuario_modulos_modulo_check;
alter table app_usuario_modulos add constraint app_usuario_modulos_modulo_check
  check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol',
                    'safety','presencia','taller','workplanner','cash','central'));


-- ───────────────────────────────────────────────────────────────────────
-- central_fase4_posicion.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 4 — posición global de efectivo sin doble conteo
--
-- La pieza que falta para que la suma cuadre: el dinero que SALIÓ del cajón y
-- todavía no ha vuelto. El módulo de caja asienta cuando el dinero se mueve
-- físicamente, no cuando se planea, así que lo que se fue al banco a cambiar o
-- lo que lleva un empleado ya no está en el cajón.
--
-- Sin esta tabla la red parecería tener menos efectivo del que tiene cada vez
-- que alguien va al banco. Y la tentación contraria -sumarlo al cajón- sería
-- contarlo dos veces.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_transits (
  clase              text not null,          -- CHANGE_ORDER | ADVANCE
  documento_id       bigint not null,
  empresa_id         uuid not null,
  centro_id          uuid,
  register_id        integer,
  session_id         integer,
  numero             text,
  importe_centimos   bigint not null default 0,
  -- Quién lo tiene. La pregunta que hay que poder contestar no es solo cuánto
  -- falta, sino con quién está.
  responsable        text,
  estado             text not null default 'ABIERTO',
  abierto_en_ms      bigint,
  cerrado_en_ms      bigint,
  liquidado_centimos bigint,
  actualizado_en_ms  bigint not null,
  primary key (clase, documento_id)
);

create index if not exists central_transits_abiertos_idx
  on central_transits (empresa_id, estado);

-- Marca de conciliación. El importe que un cierre aparta «para el banco» sale
-- del cajón y espera en la tienda hasta que un ingreso lo recoge: mientras no
-- se concilie, ese dinero existe y hay que contarlo. Sin esta marca, la
-- posición global seguiría contando billetes que ya están en el banco.
alter table central_sessions
  add column if not exists conciliada boolean not null default false;


-- ───────────────────────────────────────────────────────────────────────
-- central_fase5_ingresos.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 5 — ciclo de ingresos bancarios y asignación de origen
--
-- Un ingreso no es un numero suelto: agrupa los cierres de varios dias de una
-- caja. `central_deposit_sources` guarda ese desglose -que jornada puso
-- cuanto- y es lo que permite contestar, cuando el banco apunta un abono de
-- 3.480 EUR, de que dias y de que caja salio. Sin el desglose, conciliar con el
-- extracto es adivinar.
--
-- Va en tabla aparte y no como JSON dentro del ingreso porque la pregunta que
-- de verdad se hace es la inversa: «esta jornada, en que ingreso acabo?».
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_bank_deposits (
  deposit_id                  integer primary key,
  empresa_id                  uuid not null,
  centro_id                   uuid,
  register_id                 integer,
  numero                      text,
  fecha                       date,
  referencia                  text,
  importe_centimos            bigint not null default 0,
  total_cierres_centimos      bigint not null default 0,
  remanente_anterior_centimos bigint not null default 0,
  remanente_nuevo_centimos    bigint not null default 0,
  estado                      text not null default 'CONFIRMADO',
  anulado_motivo              text,
  creado_en_ms                bigint,
  anulado_en_ms               bigint,
  actualizado_en_ms           bigint not null
);

create index if not exists central_deposits_empresa_idx
  on central_bank_deposits (empresa_id, fecha desc nulls last);
create index if not exists central_deposits_caja_idx
  on central_bank_deposits (register_id, estado);

create table if not exists central_deposit_sources (
  deposit_id       integer not null,
  session_id       integer not null,
  empresa_id       uuid not null,
  fecha            date,
  importe_centimos bigint not null default 0,
  primary key (deposit_id, session_id)
);

create index if not exists central_sources_session_idx
  on central_deposit_sources (session_id);


-- ───────────────────────────────────────────────────────────────────────
-- central_fase6_cambio.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 6 — vista consolidada de cambio y arqueos
--
-- El motor de denominaciones, cartuchos, bolsas y arqueo ya estaba entregado en
-- el modulo de caja. Lo que faltaba era verlo de toda la red a la vez, y para
-- eso Central necesita el detalle POR PIEZA, que hasta ahora no recibia: los
-- eventos de arqueo solo llevaban totales.
--
-- La foto sale del ultimo arqueo y no del stock teorico. El teorico es correcto
-- por construccion, pero el arqueo es lo que alguien ha contado con la mano, y
-- para decidir si un taller se esta quedando sin calderilla la foto buena es la
-- contada.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_denomination_stock (
  register_id       integer not null,
  valor_centimos    integer not null,
  empresa_id        uuid not null,
  centro_id         uuid,
  cantidad          integer not null default 0,
  -- Diferencia del ultimo arqueo en esa pieza. Un descuadre de un billete y
  -- otro de veinte monedas de cinco centimos no son el mismo problema.
  diferencia        integer not null default 0,
  session_id        integer,
  contado_en_ms     bigint,
  actualizado_en_ms bigint not null,
  primary key (register_id, valor_centimos)
);

create index if not exists central_denom_empresa_idx
  on central_denomination_stock (empresa_id, valor_centimos);


-- ───────────────────────────────────────────────────────────────────────
-- central_fase7_reglas.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 7 — motor de reglas jerarquico, alertas e incidencias
--
-- Las reglas son POCAS y de tipos cerrados a proposito: cada tipo mira una cosa
-- medible que Central ya conoce. Una regla generica con una expresion que hay
-- que interpretar es una regla que nadie sabe si esta bien escrita hasta el dia
-- que no avisa.
--
-- `ambito` + `ambito_id` es la jerarquia: EMPRESA, ZONA, CENTRO o CAJA, y gana
-- la mas especifica. La resolucion vive en server/central/rules/engine.ts, que
-- no toca la base de datos y se prueba en un milisegundo.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_rules (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null,
  tipo              text not null,
  ambito            text not null,
  ambito_id         text,
  umbral            bigint not null,
  activa            boolean not null default true,
  creado_por        uuid,
  creado_en_ms      bigint not null,
  actualizado_en_ms bigint not null
);

create index if not exists central_rules_empresa_idx on central_rules (empresa_id, tipo);

-- Una sola regla por tipo y ambito concreto. Dos reglas del mismo alcance
-- obligarian a desempatar, y un aviso que aparece segun por donde se mire es
-- peor que no tener aviso.
create unique index if not exists central_rules_unica_idx
  on central_rules (empresa_id, tipo, ambito, coalesce(ambito_id, ''));

create table if not exists central_incidents (
  id                bigserial primary key,
  empresa_id        uuid not null,
  centro_id         uuid,
  register_id       integer,
  session_id        integer,
  tipo              text not null,
  regla_id          uuid,
  -- Identifica EL HECHO, no la regla: dos descuadres de dias distintos son dos
  -- incidencias; un transito que sigue fuera es la misma de ayer.
  clave             text not null,
  umbral            bigint not null default 0,
  valor             bigint not null default 0,
  estado            text not null default 'ABIERTA'
                    check (estado in ('ABIERTA','RECONOCIDA','RESUELTA')),
  detalle           jsonb not null default '{}'::jsonb,
  nota              text,
  abierta_en_ms     bigint not null,
  actualizada_en_ms bigint not null,
  cerrada_en_ms     bigint,
  cerrada_por       uuid,
  -- AUTO cuando la condicion dejo de darse; MANUAL cuando la cierra alguien.
  cerrada_motivo    text
);

-- Una incidencia VIVA por hecho. Es lo que impide que cada evaluacion vuelva a
-- abrir el mismo aviso: la barrera es el indice, no el codigo.
create unique index if not exists central_incidents_viva_idx
  on central_incidents (empresa_id, clave)
  where estado in ('ABIERTA','RECONOCIDA');

create index if not exists central_incidents_bandeja_idx
  on central_incidents (empresa_id, estado, abierta_en_ms desc);


-- ───────────────────────────────────────────────────────────────────────
-- central_fase8_avisos.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 8 — Notification Hub
--
-- NO es un tercer sistema de correo. El proyecto ya tiene el transporte SMTP en
-- server/mail.ts, compartido por el index y por el vigilante del buzon del
-- CheckPoint. Lo que faltaba no era otro nodemailer, sino saber a quien avisar
-- de que: destinatarios, una cola y un worker.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_notification_channels (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null,
  canal             text not null default 'EMAIL',
  destino           text not null,
  -- Mismo ambito que las reglas: el responsable de un taller quiere los avisos
  -- de SU taller. Un buzon con avisos ajenos se filtra a una carpeta y deja de
  -- leerse.
  ambito            text not null default 'EMPRESA',
  ambito_id         text,
  -- Vacio = todos los tipos. Es el caso normal al empezar, y obligar a
  -- enumerarlos solo conseguiria que alguien olvidara uno.
  tipos             text[] not null default '{}',
  activo            boolean not null default true,
  creado_en_ms      bigint not null,
  actualizado_en_ms bigint not null
);

create index if not exists central_channels_empresa_idx
  on central_notification_channels (empresa_id, activo);
create unique index if not exists central_channels_unico_idx
  on central_notification_channels (empresa_id, canal, lower(destino), ambito,
                                    coalesce(ambito_id, ''));

-- La cola de avisos. Mismo patron que las otras dos colas del proyecto, y por
-- la misma razon: un aviso que no se puede mandar no puede tumbar lo que lo
-- genero.
create table if not exists central_notifications (
  id                 bigserial primary key,
  empresa_id         uuid not null,
  incident_id        bigint not null,
  channel_id         uuid,
  canal              text not null default 'EMAIL',
  destino            text not null,
  asunto             text not null,
  cuerpo             text not null,
  estado             text not null default 'PENDIENTE'
                     check (estado in ('PENDIENTE','ENVIANDO','ENVIADO','ERROR','CANCELADO')),
  intentos           integer not null default 0,
  proximo_intento_ms bigint,
  last_error         text,
  creado_en_ms       bigint not null,
  enviado_en_ms      bigint
);

-- Un aviso por incidencia y destinatario. Las incidencias ya estan
-- deduplicadas por hecho, asi que esto es lo que impide que un problema que
-- dura tres dias mande tres correos iguales.
create unique index if not exists central_notif_unica_idx
  on central_notifications (incident_id, canal, lower(destino));

create index if not exists central_notif_pendientes_idx
  on central_notifications (estado, proximo_intento_ms)
  where estado in ('PENDIENTE','ERROR');


-- ───────────────────────────────────────────────────────────────────────
-- central_fase9_evidencias.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 9 — integridad y version de las evidencias
--
-- El bucket privado y la URL firmada de 15 minutos ya existian. Lo que faltaba
-- era poder demostrar que el fichero que hay hoy es el que se adjunto, y poder
-- sustituir un escaneo torcido sin perder el anterior.
--
-- · sha256 es la huella del fichero tal y como se subio. Una factura que
--   respalda una salida de caja no puede cambiar sin que se note.
-- · version y reemplaza_a porque un justificante SE SUSTITUYE, no se corrige.
--   El anterior se marca sustituido y se queda: aqui no se borra nada, y menos
--   lo que respalda un movimiento de dinero.
--
-- Nullable a proposito: los documentos anteriores a esta fase no tienen huella,
-- y eso es un dato -no se puede verificar lo que se subio antes de empezar a
-- medirlo- no algo que haya que inventar.
--
-- Equivalente en código: server/cash/schema.ts.

alter table cash_operation_documents
  add column if not exists sha256      text,
  add column if not exists version     integer not null default 1,
  add column if not exists reemplaza_a integer,
  add column if not exists sustituido  boolean not null default false;

create index if not exists cash_docs_sha_idx
  on cash_operation_documents (empresa_id, sha256) where sha256 is not null;


-- ───────────────────────────────────────────────────────────────────────
-- central_fase10_auditoria.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 10 — auditoria inmutable
--
-- Tres cosas que no estaban, y las tres salieron de mirar en vez de suponer:
--
-- 1. La tabla podia NO EXISTIR. La crea la migracion de la fundacion SaaS, que
--    se aplica a mano; en una base sin ella las 35 llamadas del modulo de caja
--    fallaban en silencio, porque registrarAuditoria traga sus errores.
--
-- 2. Se podia modificar y borrar. Las politicas RLS solo permitian leer e
--    insertar, pero el servidor se conecta con pg y no pasa por RLS: un UPDATE
--    sobre una linea de auditoria era perfectamente posible.
--
-- 3. No se podia demostrar que una linea no habia cambiado.
--
-- Equivalente en código: server/core/auditoriaSchema.ts.

-- ── 1) Fuera la clave ajena ─────────────────────────────────────────────────
-- La auditoria pasa a escribirse DENTRO de la transaccion que mueve el dinero,
-- y eso cambia las reglas: cualquier cosa que pueda hacer fallar este INSERT
-- deshace un cobro que ya ocurrio fisicamente. Una clave ajena es exactamente
-- eso. Ademas, una auditoria que rechaza una linea porque su empresa ya no esta
-- es una auditoria que se pierde justo cuando mas falta hace: el registro
-- sobrevive a su sujeto, para eso esta.
alter table app_auditoria drop constraint if exists app_auditoria_empresa_id_fkey;
alter table app_auditoria drop constraint if exists app_auditoria_user_id_fkey;

-- ── 2) Huella por fila ──────────────────────────────────────────────────────
-- Es una huella POR FILA, no una cadena que encadene cada linea con la
-- anterior. Una cadena detectaria tambien un borrado, pero obligaria a
-- serializar TODAS las escrituras de auditoria de la instalacion -cada una
-- tendria que leer la huella de la anterior con la fila bloqueada- y la
-- auditoria se escribe en cada operacion de cada modulo. El borrado ya lo
-- impide el disparador de abajo; la huella cubre lo otro: que alguien cambie
-- el contenido por fuera.
alter table app_auditoria add column if not exists huella text;

create or replace function app_auditoria_huella() returns trigger as $$
begin
  new.huella := encode(sha256(convert_to(
    coalesce(new.empresa_id::text,'') || '|' ||
    coalesce(new.user_id::text,'')    || '|' ||
    new.accion                        || '|' ||
    coalesce(new.entidad,'')          || '|' ||
    coalesce(new.entidad_id,'')       || '|' ||
    coalesce(new.detalle::text,'')    || '|' ||
    coalesce(new.ip::text,'')         || '|' ||
    new.created_at::text,
    'UTF8')), 'hex');
  return new;
end $$ language plpgsql;

drop trigger if exists app_auditoria_huella_trg on app_auditoria;
create trigger app_auditoria_huella_trg
  before insert on app_auditoria
  for each row execute function app_auditoria_huella();

-- ── 3) El candado ───────────────────────────────────────────────────────────
-- El mensaje explica QUE hacer, no solo se niega: quien se topa con esto casi
-- siempre queria corregir algo, y lo que corrige una linea de auditoria
-- equivocada es otra linea, nunca un UPDATE.
create or replace function app_auditoria_solo_insertar() returns trigger as $$
begin
  raise exception
    'app_auditoria es inmutable: no se puede % una linea de auditoria. Una correccion se registra como una linea nueva.',
    TG_OP;
end $$ language plpgsql;

drop trigger if exists app_auditoria_inmutable_trg on app_auditoria;
create trigger app_auditoria_inmutable_trg
  before update or delete on app_auditoria
  for each row execute function app_auditoria_solo_insertar();

-- ── 4) Marca de reautenticacion reciente ────────────────────────────────────
-- En la base y no en memoria: en Render hay varias instancias y la siguiente
-- peticion puede caer en otra. Con un mapa en memoria, reautenticarse valdria o
-- no segun a quien le tocara responder -intermitente y sin explicacion, que es
-- la peor clase de fallo-.
--
-- Una fila por usuario, que se pisa: el historico de cuando se ha identificado
-- cada uno ya esta en la auditoria.
create table if not exists cash_reauth (
  user_id  uuid primary key,
  hasta_ms bigint not null
);


-- ───────────────────────────────────────────────────────────────────────
-- central_fase12_integraciones.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 12 — API canonica, acceso maquina-a-maquina y webhooks
--
-- Hasta aqui no existia ninguna forma de que un PROGRAMA hablara con Mobilink:
-- toda la API exige el Bearer de una sesion de Supabase, o sea, un usuario con
-- su contrasena. Un proceso desatendido tenia que usar la cuenta de una
-- persona, que hereda todos sus permisos y deja de funcionar el dia que esa
-- persona se va. Era el riesgo R8.
--
-- De los secretos solo se guarda la huella -ni el del cliente ni el testigo-,
-- asi que una copia de esta base no da acceso a nada. El secreto se ensena una
-- sola vez al crearlo; si se pierde, se genera otro.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_api_clients (
  client_id      text primary key,
  empresa_id     uuid not null,
  nombre         text not null,
  secreto_huella text not null,
  alcances       text[] not null default '{}',
  activo         boolean not null default true,
  creado_en_ms   bigint not null,
  ultimo_uso_ms  bigint
);

create index if not exists central_api_clients_empresa_idx
  on central_api_clients (empresa_id, activo);

create table if not exists central_api_tokens (
  token_huella text primary key,
  client_id    text not null,
  empresa_id   uuid not null,
  alcances     text[] not null default '{}',
  expira_ms    bigint not null
);

create index if not exists central_api_tokens_cliente_idx on central_api_tokens (client_id);
create index if not exists central_api_tokens_expira_idx  on central_api_tokens (expira_ms);

-- Webhooks de salida. Misma cola y mismos reintentos que los avisos por correo,
-- porque el problema es el mismo: un destino caido no puede tumbar lo que
-- genero el evento. Lo que cambia es la firma HMAC de cada envio, que es lo que
-- permite al receptor saber que viene de aqui y no de cualquiera que conozca
-- la URL.
create table if not exists central_webhooks (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null,
  url          text not null,
  secreto      text not null,
  eventos      text[] not null default '{}',
  activo       boolean not null default true,
  creado_en_ms bigint not null
);

create index if not exists central_webhooks_empresa_idx on central_webhooks (empresa_id, activo);

create table if not exists central_webhook_deliveries (
  id                 bigserial primary key,
  webhook_id         uuid not null,
  empresa_id         uuid not null,
  evento             text not null,
  idempotency_key    text not null,
  cuerpo             jsonb not null,
  estado             text not null default 'PENDIENTE'
                     check (estado in ('PENDIENTE','ENVIANDO','ENVIADO','ERROR','CANCELADO')),
  intentos           integer not null default 0,
  proximo_intento_ms bigint,
  last_error         text,
  codigo_http        integer,
  creado_en_ms       bigint not null,
  enviado_en_ms      bigint
);

create unique index if not exists central_webhook_unico_idx
  on central_webhook_deliveries (webhook_id, idempotency_key);
create index if not exists central_webhook_pendientes_idx
  on central_webhook_deliveries (estado, proximo_intento_ms)
  where estado in ('PENDIENTE','ERROR');


-- ───────────────────────────────────────────────────────────────────────
-- central_fase14_conciliacion.sql
-- ───────────────────────────────────────────────────────────────────────

-- MC Central · Fase 14 — conciliacion bancaria asistida
--
-- Los apuntes se guardan tal cual vienen del banco, sin interpretar: es el
-- documento original y lo que permite volver a mirarlo cuando alguien pregunta
-- por que se caso una cosa con otra.
--
-- La conciliacion es una columna en el apunte y no una tabla aparte: un apunte
-- se concilia con un ingreso, uno a uno. Si algun dia hiciera falta casar un
-- apunte con varios ingresos seria otra historia, pero inventar hoy esa tabla
-- es complicar sin caso.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_bank_statements (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null,
  nombre_fichero         text,
  cuenta                 text,
  desde                  date,
  hasta                  date,
  saldo_inicial_centimos bigint,
  saldo_final_centimos   bigint,
  -- El saldo declarado por el banco cuadra con sus propios movimientos. Un
  -- extracto que no cuadra NO se guarda: conciliar contra medio extracto da
  -- por descuadrado lo que en realidad estaba bien.
  cuadra                 boolean not null default false,
  importado_por          uuid,
  importado_en_ms        bigint not null
);

create index if not exists central_statements_empresa_idx
  on central_bank_statements (empresa_id, hasta desc nulls last);

create table if not exists central_statement_lines (
  id                uuid primary key default gen_random_uuid(),
  statement_id      uuid not null,
  empresa_id        uuid not null,
  fecha             date,
  fecha_valor       date,
  importe_centimos  bigint not null,
  concepto          text,
  ampliado          text,
  referencia        text,
  deposit_id        integer,
  conciliado_por    uuid,
  conciliado_en_ms  bigint,
  -- Comisiones, recibos, nominas: se marcan como ajenos a la caja o la lista de
  -- pendientes se llena de apuntes que nunca van a casar con nada.
  descartado        boolean not null default false,
  descartado_motivo text
);

create index if not exists central_lines_extracto_idx
  on central_statement_lines (statement_id, fecha);
create index if not exists central_lines_pendientes_idx
  on central_statement_lines (empresa_id)
  where deposit_id is null and not descartado;

-- Un ingreso no puede quedar conciliado con dos apuntes del banco: seria
-- contarlo dos veces en el extracto.
create unique index if not exists central_lines_deposito_idx
  on central_statement_lines (deposit_id) where deposit_id is not null;


-- ──────────────────────────────────────────────────────────────────────
-- central_fase20_rendimiento.sql
-- ──────────────────────────────────────────────────────────────────────

-- MC Central · Fase 20 — rendimiento de las consultas de consumo
--
-- La prediccion (fase 17) y el reparto (fase 19) preguntan lo mismo por cada
-- caja: que piezas han salido dando cambio. Sin este indice, PostgreSQL recorre
-- LA TABLA ENTERA de movimientos para contestarlo, asi que el coste crece con
-- el libro mayor de toda la empresa en vez de con la historia de esa caja. Y el
-- libro mayor no mengua nunca.
--
-- Medido sobre 365.000 movimientos (5 cajas, dos anos de jornadas diarias):
--   · consulta suelta:            52 ms -> 30 ms, y deja de ser un Seq Scan
--   · llamada de la pantalla:    230 ms -> 140 ms
--
-- INCLUDE en vez de mas columnas de clave: no se busca por importe ni por
-- cantidad, solo se leen, asi que el indice ocupa menos y no se reordena por
-- ellas.
--
-- Equivalente en código: server/cash/schema.ts.
--
-- Se puede crear con CONCURRENTLY si la tabla es grande y no se quiere bloquear
-- la caja mientras tanto; en ese caso hay que lanzarlo FUERA de una transaccion.
create index if not exists cash_denmov_consumo_idx
  on cash_denomination_movements (session_id, motivo, direccion)
  include (valor_unitario_centimos, cantidad);


-- ──────────────────────────────────────────────────────────────────────
-- central_fase21_traslados.sql
-- ──────────────────────────────────────────────────────────────────────

-- MC Central · Fase 21 — traslados de efectivo entre cajas
--
-- La fase 19 sabia PROPONERLOS pero no podia ejecutarlos, por un motivo
-- concreto: en medio del viaje el dinero no esta en ninguna de las dos cajas, y
-- sin un documento que lo represente se contaria dos veces o ninguna, que es el
-- doble conteo que cerro la fase 4.
--
-- La regla que lo sostiene es la que ya rige los pedidos al banco y las
-- entregas: los asientos se hacen cuando el dinero se mueve, no cuando se
-- planea. Al crear el traslado sale del cajon de origen; al recibirlo entra en
-- el de destino; en medio, ninguna de las dos lo tiene.
--
-- Equivalente en código: server/cash/schema.ts.

create table if not exists cash_transfers (
  id                   serial primary key,
  empresa_id           uuid not null,
  numero               text not null,
  origen_register_id   integer not null references cash_registers(id) on delete restrict,
  destino_register_id  integer not null references cash_registers(id) on delete restrict,
  -- Una caja no se manda dinero a si misma: seria un asiento de ida y otro de
  -- vuelta por el mismo importe, o sea, ruido en el libro mayor.
  constraint cash_transfers_distintas check (origen_register_id <> destino_register_id),

  estado               text not null default 'EN_TRANSITO'
                       check (estado in ('EN_TRANSITO','RECIBIDO','CANCELADO')),
  importe_centimos     bigint not null check (importe_centimos > 0),
  -- Lo que de verdad llego, que puede no ser lo que salio.
  recibido_centimos    bigint,
  diferencia_motivo    text,

  -- Quien lleva la bolsa. Es lo que se pregunta cuando no aparece.
  portador             text,
  notas                text,

  session_id_salida    integer references cash_sessions(id) on delete restrict,
  operation_salida_id  integer references cash_operations(id) on delete restrict,
  session_id_entrada   integer references cash_sessions(id) on delete restrict,
  operation_entrada_id integer references cash_operations(id) on delete restrict,

  creado_por           uuid,
  creado_at_ms         bigint not null,
  cerrado_por          uuid,
  cerrado_at_ms        bigint
);

create index if not exists cash_transfers_empresa_idx on cash_transfers (empresa_id, estado);
create index if not exists cash_transfers_destino_idx on cash_transfers (destino_register_id, estado);

create table if not exists cash_transfer_lines (
  transfer_id    integer not null references cash_transfers(id) on delete cascade,
  -- ENVIADO o RECIBIDO: se guardan las dos, porque comparar lo que salio con lo
  -- que llego es justo lo que hay que poder hacer.
  rol            text not null check (rol in ('ENVIADO','RECIBIDO')),
  valor_centimos integer not null,
  cantidad       integer not null,
  primary key (transfer_id, rol, valor_centimos)
);
