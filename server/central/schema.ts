/**
 * Esquema de MC Central.
 *
 * Central **no escribe nunca en las tablas `cash_*`**. Solo lee eventos y
 * mantiene sus propias tablas `central_*`, que son proyecciones: si se borraran
 * enteras, se podrían reconstruir volviendo a pasar la cola de eventos. Esa es
 * la propiedad que las hace seguras — un error de agregación aquí no puede
 * corromper la caja, que sigue siendo la fuente de verdad de lo suyo.
 *
 * Misma convención que el resto del proyecto: DDL idempotente al arrancar, con
 * su equivalente para el SQL Editor en
 * `supabase/migrations/central_fase3_readmodels.sql`.
 */

import pool from "../db.ts";

/**
 * Los módulos que admiten `app_licencias` y `app_usuario_modulos`.
 *
 * La lista vive en UN solo sitio y se recrea entera. Es la regla que este
 * proyecto ya aprendió por las malas: cuando dos bloques recrean el mismo
 * CHECK, el de arriba se queda con la lista vieja y el servidor deja de
 * arrancar en cuanto existe la primera fila con el valor nuevo.
 */
const MODULOS = [
  "administracion",
  "tyrecontrol",
  "almacen",
  "sea-core",
  "toolcontrol",
  "safety",
  "presencia",
  "taller",
  "workplanner",
  "cash",
  "central",
] as const;

async function existe(tabla: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS hay`, [`public.${tabla}`]);
  return Boolean(rows[0]?.hay);
}

/**
 * Da de alta el módulo `central` en los CHECK de licencias y permisos.
 *
 * Se monta desde TypeScript y no con un bloque PL/pgSQL porque el CHECK no
 * puede referirse a una variable de PL/pgSQL: la expresión se guarda en el
 * catálogo y allí no existe. Y el fallo es traicionero, porque el DROP de la
 * línea anterior sí pasa: te quedas sin restricción y con un error.
 *
 * La lista se interpola, así que tiene que venir de la constante de arriba y
 * NUNCA de datos de fuera.
 */
async function registrarModuloCentral(): Promise<void> {
  const lista = MODULOS.map((m) => `'${m}'`).join(", ");

  for (const [tabla, restriccion] of [
    ["app_licencias", "app_licencias_modulo_check"],
    ["app_usuario_modulos", "app_usuario_modulos_modulo_check"],
  ]) {
    if (!(await existe(tabla))) continue;
    await pool.query(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${restriccion}`);
    await pool.query(
      `ALTER TABLE ${tabla} ADD CONSTRAINT ${restriccion} CHECK (modulo IN (${lista}))`
    );
  }
}

export async function initCentral(): Promise<void> {
  /*
   * Lo que ha llegado.
   *
   * Es a la vez el registro de recepción y **la barrera de deduplicación**:
   * `event_id` es único, así que reenviar el mismo evento no puede aplicarlo
   * dos veces. El worker de la caja puede reenviar —si se cae justo después de
   * entregar y antes de anotar— y aquí eso no cuenta un cobro de más.
   *
   * Se guarda el evento entero, no solo su id. Ocupa poco y permite
   * reconstruir las proyecciones sin volver a pedirle nada a la caja, que es lo
   * que convierte un error de agregación en algo que se arregla en diez
   * minutos en vez de en una migración de datos.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_events (
      event_id UUID PRIMARY KEY,
      empresa_id UUID NOT NULL,
      centro_id UUID,
      register_id INTEGER,
      session_id INTEGER,
      aggregate_type TEXT,
      aggregate_id BIGINT,
      aggregate_version BIGINT,
      tipo TEXT NOT NULL,
      ocurrido_en_ms BIGINT NOT NULL,
      actor_user_id UUID,
      datos JSONB NOT NULL DEFAULT '{}'::jsonb,
      recibido_en_ms BIGINT NOT NULL,
      -- APLICADO: cambió la proyección. TARDIO: llegó detrás de uno más nuevo
      -- del mismo agregado y no se aplicó al estado. Guardar cuál fue cada cosa
      -- es lo que permite distinguir «no ha llegado» de «llegó y se descartó».
      resultado TEXT NOT NULL DEFAULT 'APLICADO'
    );
    CREATE INDEX IF NOT EXISTS central_events_empresa_idx
      ON central_events(empresa_id, ocurrido_en_ms DESC);
    CREATE INDEX IF NOT EXISTS central_events_agregado_idx
      ON central_events(aggregate_type, aggregate_id, aggregate_version);
  `);

  /*
   * La jornada vista desde la red.
   *
   * Una fila por jornada de cualquier caja de cualquier taller. Es lo que
   * responde a «¿qué cajas siguen abiertas?» y «¿dónde descuadró algo?» sin
   * tener que preguntarle a cada caja por separado.
   *
   * `ultima_version` es la del último evento de estado aplicado. Un evento con
   * versión menor o igual llega tarde y no pisa el estado: sin esto, un evento
   * retrasado por un reintento reabriría en la pantalla una jornada que ya se
   * cerró.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_sessions (
      session_id INTEGER PRIMARY KEY,
      empresa_id UUID NOT NULL,
      centro_id UUID,
      register_id INTEGER NOT NULL,
      fecha DATE,
      estado TEXT,
      fondo_inicial_centimos BIGINT NOT NULL DEFAULT 0,
      contado_centimos BIGINT,
      diferencia_centimos BIGINT,
      ingreso_bancario_centimos BIGINT,
      cambio_final_centimos BIGINT,
      -- Contadores del día, que es lo que mira un supervisor de un vistazo.
      operaciones INTEGER NOT NULL DEFAULT 0,
      efectivo_neto_centimos BIGINT NOT NULL DEFAULT 0,
      cobros_centimos BIGINT NOT NULL DEFAULT 0,
      pagos_centimos BIGINT NOT NULL DEFAULT 0,
      anulaciones INTEGER NOT NULL DEFAULT 0,
      reaperturas INTEGER NOT NULL DEFAULT 0,
      abierta_en_ms BIGINT,
      cerrada_en_ms BIGINT,
      ultima_version BIGINT NOT NULL DEFAULT 0,
      actualizado_en_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS central_sessions_red_idx
      ON central_sessions(empresa_id, fecha DESC);
    CREATE INDEX IF NOT EXISTS central_sessions_abiertas_idx
      ON central_sessions(empresa_id, estado);
    CREATE INDEX IF NOT EXISTS central_sessions_centro_idx
      ON central_sessions(centro_id, fecha DESC);
  `);

  /*
   * La caja vista desde la red: su último movimiento y lo que lleva al banco.
   *
   * Existe para responder rápido a «¿cuál es la caja que lleva tres días sin
   * cerrar?», que con solo la tabla de jornadas obligaría a un agregado sobre
   * todo el histórico cada vez que se abre la pantalla.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_registers (
      register_id INTEGER PRIMARY KEY,
      empresa_id UUID NOT NULL,
      centro_id UUID,
      ultima_actividad_ms BIGINT,
      ultima_fecha_cerrada DATE,
      jornada_abierta_id INTEGER,
      ingresos_bancarios INTEGER NOT NULL DEFAULT 0,
      ingresado_centimos BIGINT NOT NULL DEFAULT 0,
      actualizado_en_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS central_registers_empresa_idx
      ON central_registers(empresa_id);
  `);

  /*
   * Dinero fuera del cajón que todavía no ha vuelto.
   *
   * Es la pieza que hace que la posición global cuadre. El cajón ya NO cuenta
   * este dinero —salió con su asiento— así que sin esta tabla, la red parecería
   * tener menos efectivo del que tiene cada vez que alguien va al banco. Y la
   * tentación contraria, sumarlo al cajón, sería contarlo dos veces.
   *
   * Una fila por documento (`clase` + `documento_id`), no por movimiento: lo
   * que interesa es si sigue abierto y por cuánto.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_transits (
      clase TEXT NOT NULL,
      documento_id BIGINT NOT NULL,
      empresa_id UUID NOT NULL,
      centro_id UUID,
      register_id INTEGER,
      session_id INTEGER,
      numero TEXT,
      importe_centimos BIGINT NOT NULL DEFAULT 0,
      -- Quién lo tiene. La pregunta que hay que poder contestar no es solo
      -- cuánto falta, sino con quién está.
      responsable TEXT,
      estado TEXT NOT NULL DEFAULT 'ABIERTO',
      abierto_en_ms BIGINT,
      cerrado_en_ms BIGINT,
      liquidado_centimos BIGINT,
      actualizado_en_ms BIGINT NOT NULL,
      PRIMARY KEY (clase, documento_id)
    );
    CREATE INDEX IF NOT EXISTS central_transits_abiertos_idx
      ON central_transits(empresa_id, estado);
  `);

  /*
   * Marca de conciliación en la jornada.
   *
   * El importe que un cierre aparta «para el banco» sale del cajón y espera en
   * la tienda hasta que un ingreso lo recoge. Mientras no se concilie, ese
   * dinero EXISTE y hay que contarlo; en cuanto entra en un ingreso, deja de
   * estar. Sin esta marca, la posición global seguiría contando billetes que ya
   * están en el banco.
   */
  await pool.query(`
    ALTER TABLE central_sessions
      ADD COLUMN IF NOT EXISTS conciliada BOOLEAN NOT NULL DEFAULT false;
  `);

  /*
   * Los ingresos bancarios de la red, con su origen.
   *
   * Un ingreso no es un número suelto: agrupa los cierres de varios días de una
   * caja. `central_deposit_sources` guarda ESE desglose —qué jornada puso
   * cuánto— y es lo que permite contestar, cuando el banco apunta un abono de
   * 3.480 €, de qué días y de qué caja salió. Sin el desglose, conciliar con el
   * extracto es adivinar.
   *
   * Se guarda aparte y no como JSON dentro del ingreso porque la pregunta que
   * de verdad se hace es la inversa: «esta jornada, ¿en qué ingreso acabó?».
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_bank_deposits (
      deposit_id INTEGER PRIMARY KEY,
      empresa_id UUID NOT NULL,
      centro_id UUID,
      register_id INTEGER,
      numero TEXT,
      fecha DATE,
      referencia TEXT,
      importe_centimos BIGINT NOT NULL DEFAULT 0,
      total_cierres_centimos BIGINT NOT NULL DEFAULT 0,
      remanente_anterior_centimos BIGINT NOT NULL DEFAULT 0,
      remanente_nuevo_centimos BIGINT NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'CONFIRMADO',
      anulado_motivo TEXT,
      creado_en_ms BIGINT,
      anulado_en_ms BIGINT,
      actualizado_en_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS central_deposits_empresa_idx
      ON central_bank_deposits(empresa_id, fecha DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS central_deposits_caja_idx
      ON central_bank_deposits(register_id, estado);

    CREATE TABLE IF NOT EXISTS central_deposit_sources (
      deposit_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      empresa_id UUID NOT NULL,
      fecha DATE,
      importe_centimos BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (deposit_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS central_sources_session_idx
      ON central_deposit_sources(session_id);
  `);

  /*
   * El cambio que tiene cada caja, pieza a pieza.
   *
   * Sale del último arqueo, que es la única foto FIABLE de qué monedas hay en
   * un cajón: el stock teórico es correcto por construcción, pero el arqueo es
   * lo que alguien ha contado con la mano. Para decidir si un taller se está
   * quedando sin calderilla, la foto buena es la contada.
   *
   * Una fila por caja y valor. Se pisa con cada arqueo nuevo: aquí no interesa
   * la historia —esa está en `central_events`— sino cuánto hay ahora.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_denomination_stock (
      register_id INTEGER NOT NULL,
      valor_centimos INTEGER NOT NULL,
      empresa_id UUID NOT NULL,
      centro_id UUID,
      cantidad INTEGER NOT NULL DEFAULT 0,
      -- Diferencia del último arqueo en esa pieza. Un descuadre de un billete y
      -- otro de veinte monedas de cinco céntimos no son el mismo problema.
      diferencia INTEGER NOT NULL DEFAULT 0,
      session_id INTEGER,
      contado_en_ms BIGINT,
      actualizado_en_ms BIGINT NOT NULL,
      PRIMARY KEY (register_id, valor_centimos)
    );
    CREATE INDEX IF NOT EXISTS central_denom_empresa_idx
      ON central_denomination_stock(empresa_id, valor_centimos);
  `);

  /*
   * Reglas y sus incidencias.
   *
   * Las reglas son POCAS y de tipos cerrados a propósito: cada tipo mira una
   * cosa medible que Central ya conoce. Una regla genérica con una expresión
   * que hay que interpretar es una regla que nadie sabe si está bien escrita
   * hasta el día que no avisa.
   *
   * `ambito` + `ambito_id` es la jerarquía: EMPRESA, ZONA, CENTRO o CAJA. La
   * resolución —gana la más específica— vive en `rules/engine.ts`, que no toca
   * la base de datos y se prueba en un milisegundo.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      tipo TEXT NOT NULL,
      ambito TEXT NOT NULL,
      ambito_id TEXT,
      umbral BIGINT NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT true,
      creado_por UUID,
      creado_en_ms BIGINT NOT NULL,
      actualizado_en_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS central_rules_empresa_idx ON central_rules(empresa_id, tipo);

    -- Una sola regla por tipo y ámbito concreto. Dos reglas del mismo alcance
    -- obligarían a desempatar, y un aviso que aparece según por dónde se mire
    -- es peor que no tener aviso.
    CREATE UNIQUE INDEX IF NOT EXISTS central_rules_unica_idx
      ON central_rules(empresa_id, tipo, ambito, COALESCE(ambito_id, ''));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_incidents (
      id BIGSERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      centro_id UUID,
      register_id INTEGER,
      session_id INTEGER,
      tipo TEXT NOT NULL,
      regla_id UUID,
      -- Identifica EL HECHO, no la regla: dos descuadres de días distintos son
      -- dos incidencias; un tránsito que sigue fuera es la misma de ayer.
      clave TEXT NOT NULL,
      umbral BIGINT NOT NULL DEFAULT 0,
      valor BIGINT NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'ABIERTA'
        CHECK (estado IN ('ABIERTA','RECONOCIDA','RESUELTA')),
      detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
      nota TEXT,
      abierta_en_ms BIGINT NOT NULL,
      actualizada_en_ms BIGINT NOT NULL,
      cerrada_en_ms BIGINT,
      cerrada_por UUID,
      -- AUTO cuando la condición dejó de darse; a mano cuando alguien la cierra.
      cerrada_motivo TEXT
    );

    -- Una incidencia VIVA por hecho. Es lo que impide que cada evaluación
    -- vuelva a abrir el mismo aviso: la barrera es el índice, no el código.
    CREATE UNIQUE INDEX IF NOT EXISTS central_incidents_viva_idx
      ON central_incidents(empresa_id, clave)
      WHERE estado IN ('ABIERTA','RECONOCIDA');

    CREATE INDEX IF NOT EXISTS central_incidents_bandeja_idx
      ON central_incidents(empresa_id, estado, abierta_en_ms DESC);
  `);

  /*
   * A quién se avisa y por dónde.
   *
   * Un canal es «estos correos, para estos tipos de incidencia, en este
   * ámbito». El ámbito es el mismo que el de las reglas —empresa, zona, centro
   * o caja— porque el responsable de un taller quiere los avisos de SU taller y
   * no los de la red entera: un buzón con avisos que no son tuyos se filtra a
   * una carpeta y deja de leerse.
   *
   * `tipos` vacío significa TODOS. Es el caso normal al empezar, y obligar a
   * enumerarlos solo conseguiría que alguien olvidara uno.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_notification_channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      canal TEXT NOT NULL DEFAULT 'EMAIL',
      destino TEXT NOT NULL,
      ambito TEXT NOT NULL DEFAULT 'EMPRESA',
      ambito_id TEXT,
      tipos TEXT[] NOT NULL DEFAULT '{}',
      activo BOOLEAN NOT NULL DEFAULT true,
      creado_en_ms BIGINT NOT NULL,
      actualizado_en_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS central_channels_empresa_idx
      ON central_notification_channels(empresa_id, activo);
    CREATE UNIQUE INDEX IF NOT EXISTS central_channels_unico_idx
      ON central_notification_channels(empresa_id, canal, lower(destino), ambito,
                                       COALESCE(ambito_id, ''));
  `);

  /*
   * La cola de avisos.
   *
   * Mismo patrón que las otras dos colas del proyecto —pendiente, reintentos
   * con espera creciente y estado terminal— y por la misma razón: **un aviso
   * que no se puede mandar no puede tumbar lo que lo generó**. El correo se
   * intenta después; la incidencia ya está registrada.
   *
   * Un aviso por incidencia y canal, garantizado por índice único: las
   * incidencias ya están deduplicadas por hecho, así que esto es lo que impide
   * que un problema que dura tres días mande tres correos iguales.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_notifications (
      id BIGSERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      incident_id BIGINT NOT NULL,
      channel_id UUID,
      canal TEXT NOT NULL DEFAULT 'EMAIL',
      destino TEXT NOT NULL,
      asunto TEXT NOT NULL,
      cuerpo TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','ENVIANDO','ENVIADO','ERROR','CANCELADO')),
      intentos INTEGER NOT NULL DEFAULT 0,
      proximo_intento_ms BIGINT,
      last_error TEXT,
      creado_en_ms BIGINT NOT NULL,
      enviado_en_ms BIGINT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS central_notif_unica_idx
      ON central_notifications(incident_id, canal, lower(destino));
    CREATE INDEX IF NOT EXISTS central_notif_pendientes_idx
      ON central_notifications(estado, proximo_intento_ms)
      WHERE estado IN ('PENDIENTE','ERROR');
  `);

  /*
   * Clientes máquina-a-máquina y sus testigos.
   *
   * De los secretos solo se guarda la huella —ni el secreto del cliente ni el
   * testigo—, así que una copia de la base de datos no da acceso a nada. El
   * secreto se enseña una sola vez, al crearlo, y si se pierde se genera otro:
   * no hay forma de recuperarlo, y esa es justo la propiedad que se busca.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_api_clients (
      client_id TEXT PRIMARY KEY,
      empresa_id UUID NOT NULL,
      nombre TEXT NOT NULL,
      secreto_huella TEXT NOT NULL,
      alcances TEXT[] NOT NULL DEFAULT '{}',
      activo BOOLEAN NOT NULL DEFAULT true,
      creado_en_ms BIGINT NOT NULL,
      ultimo_uso_ms BIGINT
    );
    CREATE INDEX IF NOT EXISTS central_api_clients_empresa_idx
      ON central_api_clients(empresa_id, activo);

    CREATE TABLE IF NOT EXISTS central_api_tokens (
      token_huella TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      empresa_id UUID NOT NULL,
      alcances TEXT[] NOT NULL DEFAULT '{}',
      expira_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS central_api_tokens_cliente_idx ON central_api_tokens(client_id);
    CREATE INDEX IF NOT EXISTS central_api_tokens_expira_idx ON central_api_tokens(expira_ms);
  `);

  /*
   * Webhooks de salida.
   *
   * Misma cola y mismos reintentos que los avisos por correo, porque el
   * problema es idéntico: un destino caído no puede tumbar lo que generó el
   * evento. Lo que cambia es la firma: cada envío va con un HMAC del cuerpo,
   * que es lo que permite a quien lo recibe saber que viene de aquí y no de
   * cualquiera que conozca la URL.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS central_webhooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      url TEXT NOT NULL,
      secreto TEXT NOT NULL,
      eventos TEXT[] NOT NULL DEFAULT '{}',
      activo BOOLEAN NOT NULL DEFAULT true,
      creado_en_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS central_webhooks_empresa_idx
      ON central_webhooks(empresa_id, activo);

    CREATE TABLE IF NOT EXISTS central_webhook_deliveries (
      id BIGSERIAL PRIMARY KEY,
      webhook_id UUID NOT NULL,
      empresa_id UUID NOT NULL,
      evento TEXT NOT NULL,
      -- Clave de deduplicación en destino, igual que en el resto del proyecto.
      idempotency_key TEXT NOT NULL,
      cuerpo JSONB NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','ENVIANDO','ENVIADO','ERROR','CANCELADO')),
      intentos INTEGER NOT NULL DEFAULT 0,
      proximo_intento_ms BIGINT,
      last_error TEXT,
      codigo_http INTEGER,
      creado_en_ms BIGINT NOT NULL,
      enviado_en_ms BIGINT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS central_webhook_unico_idx
      ON central_webhook_deliveries(webhook_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS central_webhook_pendientes_idx
      ON central_webhook_deliveries(estado, proximo_intento_ms)
      WHERE estado IN ('PENDIENTE','ERROR');
  `);

  await registrarModuloCentral();

  console.log("MC Central: esquema inicializado correctamente");
}
