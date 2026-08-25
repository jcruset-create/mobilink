/**
 * Espejo económico de Mobilink Assist. Diseño en docs/PROMPT_tarifas_assist.md.
 *
 * Una asistencia nacida en Assist (`roadside_assistances`) no tenía economía:
 * ni tarifa, ni margen, ni facturación. En vez de construir un segundo motor,
 * se le crea su ESPEJO en Connect (`connect_assistances` con
 * `coreAssistanceId`) y todo lo ya construido —etapas, contratos, conceptos,
 * facturación, auditoría— funciona sin tocar el motor. Assist es el dueño
 * operativo; Connect, el económico.
 *
 * LA REGLA DEL TIEMPO (dirección, 25/08/2026): el tiempo de la asistencia
 * empieza al CREARLA y termina al LLEGAR el vehículo al taller. Por eso:
 *   · el instante contractual del espejo es `createdAtMs` del core (la
 *     franja del forfait se resuelve ahí), y
 *   · la duración para los extras es `arrivedAtWorkshopMs − createdAtMs`,
 *     calculada por el sistema. El técnico solo aporta los kilómetros
 *     (`serviceKm`); los minutos no los teclea nadie.
 *
 * Va en pases del worker y no enganchado a los endpoints del core por las
 * mismas razones que el cierre automático: es reintentable, soporta los
 * caminos de alta que existan hoy y mañana (teléfono, WhatsApp, IA), y un
 * fallo tarificando jamás puede impedir crear o cerrar una asistencia.
 *
 * APAGADO DE FÁBRICA. Se enciende poniendo en `settings` del centro:
 *   { "assistMirror": { "activo": true, "desdeMs": <epoch ms> } }
 * Solo se espejan asistencias creadas DESPUÉS de `desdeMs`: nunca
 * retroactivo, porque tarificar hoy un servicio de entonces inventaría
 * importes.
 */

import crypto from "node:crypto";
import db from "../db.ts";
import { bloquear } from "./pricing/service.ts";

export interface AjustesEspejo {
  activo: boolean;
  desdeMs: number;
}

export function leerAjustesEspejo(settings: unknown): AjustesEspejo {
  const s = (() => {
    if (settings == null) return {} as Record<string, any>;
    if (typeof settings !== "string") return settings as Record<string, any>;
    try { return JSON.parse(settings) ?? {}; } catch { return {}; }
  })();
  const m = s.assistMirror ?? {};
  const desde = Number(m.desdeMs);
  return {
    activo: m.activo === true,
    desdeMs: Number.isFinite(desde) && desde > 0 ? desde : Number.MAX_SAFE_INTEGER,
  };
}

/** El centro que espeja Assist, o null si nadie tiene el interruptor puesto. */
async function centroEspejo(): Promise<{ id: number; desdeMs: number } | null> {
  const r = await db.query(
    `SELECT id, settings FROM connect_control_centers
      WHERE "deletedAtMs" IS NULL AND status = 'active'
        AND settings LIKE '%assistMirror%'
      ORDER BY id`,
  );
  for (const row of r.rows) {
    const a = leerAjustesEspejo(row.settings);
    if (a.activo) return { id: Number(row.id), desdeMs: a.desdeMs };
  }
  return null;
}

/**
 * El partner del espejo. `partnerId` es obligatorio en connect_assistances
 * (es quien encarga el servicio); para las de Assist, quien encarga es la
 * propia operación de Assist.
 */
async function partnerEspejo(controlCenterId: number): Promise<number> {
  const r = await db.query(
    `SELECT id FROM connect_partners
      WHERE "controlCenterId" = $1 AND name = 'Mobilink Assist' LIMIT 1`,
    [controlCenterId],
  );
  if (r.rows[0]) return Number(r.rows[0].id);
  const now = Date.now();
  const ins = await db.query(
    `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
     VALUES ($1, 'Mobilink Assist', $2, $3, $3)
     ON CONFLICT DO NOTHING RETURNING id`,
    [crypto.randomUUID(), controlCenterId, now],
  );
  if (ins.rows[0]) return Number(ins.rows[0].id);
  const otra = await db.query(
    `SELECT id FROM connect_partners WHERE "controlCenterId" = $1 AND name = 'Mobilink Assist' LIMIT 1`,
    [controlCenterId],
  );
  return Number(otra.rows[0].id);
}

/**
 * El cliente al que facturar, desde el texto libre del solicitante. Solo el
 * emparejamiento EXACTO (sin distinguir mayúsculas) y ÚNICO cuenta: enlazar
 * por parecido facturaría al cliente que no toca sin dar ningún error. Lo no
 * identificado queda sin cliente, con el texto conservado: es el caso del
 * particular, que paga por cobros y no necesita contrato.
 */
async function clienteDe(
  controlCenterId: number,
  solicitanteEmpresa: string | null,
): Promise<number | null> {
  const nombre = (solicitanteEmpresa ?? "").trim();
  if (!nombre) return null;
  const r = await db.query(
    `SELECT id FROM connect_clients
      WHERE "controlCenterId" = $1 AND active AND LOWER(name) = LOWER($2)`,
    [controlCenterId, nombre],
  );
  return r.rows.length === 1 ? Number(r.rows[0].id) : null;
}

export interface ResultadoEspejos {
  creados: number;
  bloqueados: number;
  regularizados: number;
  fallos: number;
}

/**
 * Un pase completo: crear espejos nuevos, congelar forfaits de lo asignado y
 * copiar los datos reales de lo terminado. El cierre en sí NO se dispara
 * aquí: es manual desde la ficha, o del interruptor de cierre automático que
 * ya existe — el espejo es una asistencia de Connect como cualquier otra.
 */
export async function pasadaDeEspejos(limitePorPase = 50): Promise<ResultadoEspejos> {
  const salida: ResultadoEspejos = { creados: 0, bloqueados: 0, regularizados: 0, fallos: 0 };
  const centro = await centroEspejo();
  if (!centro) return salida;

  const now = Date.now();

  /* ── 1. Espejos nuevos ────────────────────────────────────────────────────
   *
   * Solo asistencias core SIN fila en Connect: las inyectadas desde Central
   * ya SON una fila de Connect (el puente de ida), y darles espejo las
   * facturaría dos veces.
   */
  const nuevas = await db.query(
    `SELECT ra.id, ra."customerName", ra."customerPhone", ra.address,
            ra.latitude, ra.longitude, ra.plate, ra."vehicleDescription",
            ra."solicitanteEmpresa", ra."createdAtMs", ra.priority
       FROM roadside_assistances ra
      WHERE ra."createdAtMs" >= $1
        AND ra.status <> 'cancelada'
        AND NOT EXISTS (SELECT 1 FROM connect_assistances ca WHERE ca."coreAssistanceId" = ra.id)
      ORDER BY ra.id
      LIMIT $2`,
    [centro.desdeMs, limitePorPase],
  );

  const partnerId = nuevas.rows.length > 0 ? await partnerEspejo(centro.id) : 0;

  for (const ra of nuevas.rows) {
    try {
      const clientId = await clienteDe(centro.id, ra.solicitanteEmpresa);
      const ins = await db.query(
        `INSERT INTO connect_assistances
           (uuid, "partnerId", "controlCenterId", "coreAssistanceId", "clientId", "clientName",
            status, priority, "serviceType", "customerName", "customerPhone", address,
            latitude, longitude, vehicle,
            "serviceOrderedAtMs", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,'assigned',$7,'tyres',$8,$9,$10,$11,$12,$13,$14,$14,$15)
         ON CONFLICT ("coreAssistanceId") DO NOTHING
         RETURNING id`,
        [
          crypto.randomUUID(), partnerId, centro.id, Number(ra.id),
          clientId, ra.solicitanteEmpresa ?? null,
          ra.priority === "urgente" ? "urgente" : "normal",
          ra.customerName ?? "", ra.customerPhone ?? "", ra.address ?? "",
          ra.latitude ?? null, ra.longitude ?? null,
          /*
           * El negocio de Assist hoy es asistencia de neumático industrial:
           * el tipo de servicio y de vehículo del espejo reflejan eso, que
           * es lo que las reglas del tarifario esperan. Si mañana Assist
           * amplía a otros servicios, el tipo tendrá que venir del alta —
           * y mientras tanto, un servicio distinto simplemente no casará
           * con ninguna regla y saldrá a revisión manual, nunca mal cobrado.
           */
          JSON.stringify({ type: "truck", plate: ra.plate || null, description: ra.vehicleDescription ?? null }),
          // LA REGLA: el tiempo empieza al crear; la franja del forfait también
          Number(ra.createdAtMs), now,
        ],
      );
      if (!ins.rows[0]) continue; // otro pase llegó antes
      salida.creados++;
      // La estimación no se persiste aquí ni en ningún sitio: en todo el
      // sistema es efímera, se calcula al consultarla. Lo que sí queda
      // escrito son las etapas con compromiso: el bloqueo y el cierre.
    } catch (e: any) {
      salida.fallos++;
      console.error(`[Espejo] alta del espejo de core ${ra.id}:`, e?.message);
    }
  }

  /* ── 2. Forfait congelado al asignar técnico ─────────────────────────────
   *
   * El instante contractual ya está en el espejo (serviceOrderedAtMs =
   * creación del core), así que la franja sale de ahí aunque el bloqueo
   * llegue un pase más tarde.
   */
  const porBloquear = await db.query(
    `SELECT ca.id FROM connect_assistances ca
       JOIN roadside_assistances ra ON ra.id = ca."coreAssistanceId"
      WHERE ca."controlCenterId" = $1
        AND ra."assignedAtMs" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM connect_assistance_pricings p
                         WHERE p."assistanceId" = ca.id AND p.stage = 'locked')
      ORDER BY ca.id LIMIT $2`,
    [centro.id, limitePorPase],
  );
  for (const row of porBloquear.rows) {
    try {
      await bloquear(Number(row.id));
      salida.bloqueados++;
    } catch (e: any) {
      salida.fallos++;
      console.error(`[Espejo] bloqueo de ${row.id}:`, e?.message);
    }
  }

  /* ── 3. Datos reales para el cierre ──────────────────────────────────────
   *
   * La duración es sistema, no tecleo: de la creación a la llegada al
   * taller; si no hubo paso por taller (reparado in situ), al finalizar. Los
   * kilómetros son los del técnico (`serviceKm`). El cierre en sí lo dispara
   * una persona o el cierre automático, como en el resto de Connect.
   */
  const porRegularizar = await db.query(
    `SELECT ca.id, ra."createdAtMs" AS inicio, ra."serviceKm",
            COALESCE(ra."arrivedAtWorkshopMs", ra."finishedAtMs") AS fin
       FROM connect_assistances ca
       JOIN roadside_assistances ra ON ra.id = ca."coreAssistanceId"
      WHERE ca."controlCenterId" = $1
        AND COALESCE(ra."arrivedAtWorkshopMs", ra."finishedAtMs") IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM connect_assistance_pricings p
                         WHERE p."assistanceId" = ca.id AND p.stage = 'final')
        AND (ca."workedMinutes" IS DISTINCT FROM
               GREATEST(1, ROUND((COALESCE(ra."arrivedAtWorkshopMs", ra."finishedAtMs") - ra."createdAtMs") / 60000.0))::int
             OR ca."odometerKm" IS DISTINCT FROM ra."serviceKm")
      ORDER BY ca.id LIMIT $2`,
    [centro.id, limitePorPase],
  );
  for (const row of porRegularizar.rows) {
    try {
      const minutos = Math.max(1, Math.round((Number(row.fin) - Number(row.inicio)) / 60000));
      await db.query(
        `UPDATE connect_assistances
            SET "workedMinutes" = $1, "odometerKm" = $2, "updatedAtMs" = $3
          WHERE id = $4`,
        [minutos, row.serviceKm ?? null, now, row.id],
      );
      salida.regularizados++;
    } catch (e: any) {
      salida.fallos++;
      console.error(`[Espejo] datos reales de ${row.id}:`, e?.message);
    }
  }

  return salida;
}
