/**
 * El estado de Satisfaction, de un vistazo y sin tocar nada.
 *
 * Sirve para responder a «¿por qué no llega ninguna encuesta?» sin abrir una
 * consola de SQL en producción, que es cuando se cometen los errores caros.
 *
 * ── Solo lectura ────────────────────────────────────────────────────────────
 *
 * Ni un UPDATE, ni un INSERT, ni una llamada a Twilio. Se puede ejecutar en
 * producción a cualquier hora sin pensárselo.
 *
 * ── Y sin secretos ──────────────────────────────────────────────────────────
 *
 * De las variables de entorno solo se dice **si están**, nunca cuánto valen. De
 * los teléfonos, los últimos dígitos. Tokens y SID no salen. Es a propósito:
 * esto acaba pegado en un chat cuando algo va mal.
 */

import pool from "../db.ts";
import { hayCredencialesTwilio } from "../core/twilio.ts";
import { contentSidDe } from "./adaptadorWhatsApp.ts";
import { configGlobal } from "./config.ts";
import { baseUrlPublica } from "./urlPublica.ts";

export type Diagnostico = {
  configuracion: Awaited<ReturnType<typeof configGlobal>>;
  entorno: {
    credencialesTwilio: boolean;
    urlPublica: boolean;
    plantillas: Record<string, boolean>;
  };
  esquema: { tabla: string; existe: boolean; filas: number | null }[];
  indices: { nombre: string; existe: boolean }[];
  encuestas: Record<string, number>;
  entregas: Record<string, number>;
  bloqueos: { motivo: string; n: number }[];
  ultimosErrores: { code: string | null; mensaje: string | null; n: number }[];
  worker: { encoladasPendientes: number; enVuelo: number; enDuda: number };
  /** Lo que impide mandar ahora mismo, en cristiano. */
  avisos: string[];
};

const TABLAS = [
  "survey_templates", "survey_instances", "survey_responses", "survey_answers",
  "survey_deliveries", "quality_cases", "quality_case_events", "satisfaction_client_config",
];

/** Los índices sin los cuales esto no es seguro ni rápido. */
const INDICES = [
  "survey_instances_sourceSystem_assistanceId_recipientRole_key", // idempotencia
  "idx_survey_instances_token",            // token único (hash)
  "idx_survey_instances_token_claro",      // token único (valor)
  "idx_survey_deliveries_en_vuelo",        // un mensaje por encuesta y tipo
  "idx_survey_deliveries_sid",             // el callback entra por aquí
  "idx_quality_cases_origen",              // un caso automático por respuesta
  "idx_survey_instances_maduras",          // worker: encolar
  "idx_survey_instances_por_enviar",       // worker: enviar
  "idx_survey_instances_recordatorio",     // worker: recordar
  "idx_survey_responses_periodo",          // métricas
  "idx_quality_cases_periodo",             // métricas
];

async function cuenta(tabla: string): Promise<number | null> {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabla}`);
    return Number(r.rows[0].n);
  } catch {
    return null;
  }
}

export async function diagnosticarSatisfaction(): Promise<Diagnostico> {
  const configuracion = await configGlobal();

  const plantillas = {
    driverInitial: Boolean(contentSidDe("DRIVER", "INITIAL")),
    customerInitial: Boolean(contentSidDe("CUSTOMER", "INITIAL")),
    driverReminder: Boolean(contentSidDe("DRIVER", "REMINDER")),
    customerReminder: Boolean(contentSidDe("CUSTOMER", "REMINDER")),
  };
  const entorno = {
    credencialesTwilio: hayCredencialesTwilio(),
    urlPublica: Boolean(baseUrlPublica()),
    plantillas,
  };

  const existentes = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`, [TABLAS]);
  const hay = new Set(existentes.rows.map((f) => String(f.table_name)));
  const esquema = [];
  for (const t of TABLAS) {
    esquema.push({ tabla: t, existe: hay.has(t), filas: hay.has(t) ? await cuenta(t) : null });
  }

  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
    [INDICES]);
  const hayIdx = new Set(idx.rows.map((f) => String(f.indexname)));
  const indices = INDICES.map((nombre) => ({ nombre, existe: hayIdx.has(nombre) }));

  const porEstado = async (tabla: string) => {
    if (!hay.has(tabla)) return {};
    const r = await pool.query(`SELECT status, COUNT(*)::int AS n FROM ${tabla} GROUP BY status`);
    return Object.fromEntries(r.rows.map((f) => [String(f.status), Number(f.n)]));
  };
  const encuestas = await porEstado("survey_instances");
  const entregas = await porEstado("survey_deliveries");

  const bloqueos = hay.has("survey_instances")
    ? (await pool.query(
        `SELECT "blockedReason" AS motivo, COUNT(*)::int AS n FROM survey_instances
          WHERE "blockedReason" IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 10`)).rows
        .map((f) => ({ motivo: String(f.motivo), n: Number(f.n) }))
    : [];

  /*
   * Los errores se agrupan por código, no se listan uno a uno: lo que interesa
   * es «hay 40 números inválidos», no cuarenta líneas iguales. El mensaje ya
   * viene saneado de origen —sin URL ni SID—, pero se recorta igualmente.
   */
  const ultimosErrores = hay.has("survey_deliveries")
    ? (await pool.query(
        `SELECT "errorCode" AS code, LEFT(COALESCE("errorMessage",''), 120) AS mensaje,
                COUNT(*)::int AS n
           FROM survey_deliveries
          WHERE status IN ('FAILED','SKIPPED') AND "createdAtMs" > $1
          GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`,
        [Date.now() - 7 * 24 * 3_600_000])).rows
        .map((f) => ({
          code: f.code == null ? null : String(f.code),
          mensaje: f.mensaje ? String(f.mensaje) : null,
          n: Number(f.n),
        }))
    : [];

  const worker = hay.has("survey_instances")
    ? {
        encoladasPendientes: Number((await pool.query(
          `SELECT COUNT(*)::int AS n FROM survey_instances WHERE status = 'QUEUED'`)).rows[0].n),
        enVuelo: Number((await pool.query(
          `SELECT COUNT(*)::int AS n FROM survey_deliveries WHERE status = 'SENDING'`)).rows[0].n),
        enDuda: Number((await pool.query(
          `SELECT COUNT(*)::int AS n FROM survey_deliveries WHERE status = 'UNKNOWN'`)).rows[0].n),
      }
    : { encoladasPendientes: 0, enVuelo: 0, enDuda: 0 };

  /* ── Los avisos ────────────────────────────────────────────────────────── */

  const avisos: string[] = [];
  if (!configuracion.activo) {
    avisos.push("Satisfaction está APAGADO: no se crea ni se manda nada. Es el estado de fábrica.");
  } else {
    if (!entorno.credencialesTwilio) avisos.push("Faltan las credenciales de Twilio: no se manda nada.");
    if (!entorno.urlPublica) avisos.push("No hay URL pública: no se puede construir el enlace.");
    if (configuracion.conductor && !plantillas.driverInitial) {
      avisos.push("La encuesta del conductor está activa pero no hay plantilla configurada.");
    }
    if (configuracion.cliente && !plantillas.customerInitial) {
      avisos.push("La encuesta del cliente está activa pero no hay plantilla configurada.");
    }
    if (configuracion.recordatorio
        && !(plantillas.driverReminder || plantillas.customerReminder)) {
      avisos.push("El recordatorio está activo y no hay ninguna plantilla de recordatorio.");
    }
  }
  for (const i of indices) {
    if (!i.existe) avisos.push(`Falta el índice ${i.nombre}: revisa que el esquema esté al día.`);
  }
  if (worker.enDuda > 0) {
    avisos.push(`${worker.enDuda} entrega(s) en duda pendientes de reconciliar. ` +
      "Cualquiera merece una mirada antes de ampliar el envío.");
  }
  if (worker.enVuelo > 0) {
    avisos.push(`${worker.enVuelo} entrega(s) atascadas en SENDING. ` +
      "Si no bajan solas, algún worker murió a mitad de un envío.");
  }

  return {
    configuracion, entorno, esquema, indices, encuestas, entregas,
    bloqueos, ultimosErrores, worker, avisos,
  };
}
