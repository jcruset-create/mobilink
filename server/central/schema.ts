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

  await registrarModuloCentral();

  console.log("MC Central: esquema inicializado correctamente");
}
