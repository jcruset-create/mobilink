/**
 * Connect Pro — Fase 3: estado de las unidades móviles.
 *
 * Sin modificar Mobilink Assist: el estado se DERIVA de datos que ya existen:
 *   - roadside_vehicles (Render PG): flota de unidades del taller
 *   - roadside_assistances activas: unidad/técnico asignados y fase del servicio
 *   - Supabase tc_vehiculo_webfleet_estado: posición GPS, velocidad y
 *     en_base / en_ruta / sin_conexion / sin_dispositivo (sync Webfleet del core)
 *
 * Prioridad del estado: manual del operador > asistencia activa > Webfleet.
 * Cada cambio queda en connect_mobile_unit_events y se publica por SSE.
 */

import db from "../db.ts";
import { supabase } from "../supabase.ts";
import { publish } from "./bus.ts";

export const UNIT_STATUSES = [
  "available", "reserved", "assigned", "en_route_to_assistance", "working",
  "waiting_instructions", "waiting_material", "finishing", "returning_to_base",
  "at_base", "resting", "unavailable", "out_of_service", "breakdown",
  "no_connection", "shift_ended", "unknown",
] as const;

/** Estado core de la asistencia → estado de la unidad. */
const ASSISTANCE_TO_UNIT: Record<string, string> = {
  pendiente: "reserved",
  asignada: "assigned",
  en_camino: "en_route_to_assistance",
  en_punto: "working",
  inicio_reparacion: "working",
  en_camino_base: "returning_to_base",
};

/** Estado Webfleet → estado de la unidad (cuando no hay asistencia activa). */
const WEBFLEET_TO_UNIT: Record<string, string> = {
  en_base: "at_base",
  en_ruta: "available",
  sin_conexion: "no_connection",
  sin_dispositivo: "unknown",
};

export async function syncMobileUnits(): Promise<number> {
  const now = Date.now();

  const [vehicles, activeAssistances, provider] = await Promise.all([
    db.query(`SELECT * FROM roadside_vehicles WHERE active = true`),
    db.query(
      `SELECT ra.id, ra."assignedVehicleName", ra."assignedTechName", ra.status,
              ca.id AS "connectId"
         FROM roadside_assistances ra
         LEFT JOIN connect_assistances ca ON ca."coreAssistanceId" = ra.id
        WHERE ra.status IN ('pendiente','asignada','en_camino','en_punto','inicio_reparacion','en_camino_base')
          AND ra."assignedVehicleName" IS NOT NULL AND ra."assignedVehicleName" <> ''`,
    ),
    db.query(`SELECT id FROM connect_provider_companies ORDER BY id LIMIT 1`),
  ]);
  const providerId = provider.rows[0]?.id ?? null;
  if (!providerId) return 0;

  // Posiciones Webfleet desde Supabase (mejor esfuerzo: si falla, seguimos sin GPS)
  const wfByVehicleId = new Map<string, any>();
  try {
    const [{ data: estados }, { data: tcVehiculos }] = await Promise.all([
      supabase.from("tc_vehiculo_webfleet_estado").select("vehiculo_id, estado, lat, lng, postext, velocidad_kmh, pos_time"),
      supabase.from("tc_vehiculos").select("id, matricula, webfleet_vehicle_id"),
    ]);
    const tcById = new Map((tcVehiculos ?? []).map((v: any) => [v.id, v]));
    for (const e of estados ?? []) {
      const tc = tcById.get(e.vehiculo_id);
      if (tc?.webfleet_vehicle_id) wfByVehicleId.set(String(tc.webfleet_vehicle_id).trim(), e);
    }
  } catch (err: any) {
    console.error("[Connect] unidades: sin datos Webfleet:", err?.message);
  }

  const byVehicleName = new Map<string, any>();
  for (const a of activeAssistances.rows) byVehicleName.set(String(a.assignedVehicleName).trim(), a);

  let changed = 0;
  for (const v of vehicles.rows) {
    const assistance = byVehicleName.get(String(v.name).trim());
    const wf = v.webfleetVehicleId ? wfByVehicleId.get(String(v.webfleetVehicleId).trim()) : null;

    const derived = assistance
      ? (ASSISTANCE_TO_UNIT[assistance.status] ?? "assigned")
      : (wf ? (WEBFLEET_TO_UNIT[wf.estado] ?? "unknown") : "unknown");

    const existing = await db.query(`SELECT * FROM connect_mobile_units WHERE "coreVehicleId" = $1`, [v.id]);
    const manualStatus = existing.rows[0]?.manualStatus ?? null;
    const status = manualStatus ?? derived;

    const row = {
      lat: wf?.lat ?? null,
      lng: wf?.lng ?? null,
      posText: wf?.postext ?? null,
      speed: wf?.velocidad_kmh ?? null,
      connection: wf ? (wf.estado === "sin_conexion" ? "offline" : "online") : "unknown",
      tech: assistance?.assignedTechName ?? null,
      activeId: assistance?.connectId ?? null,
      lastReport: wf?.pos_time ? new Date(wf.pos_time).getTime() : null,
    };

    if (!existing.rows[0]) {
      const ins = await db.query(
        `INSERT INTO connect_mobile_units
           ("providerCompanyId", "coreVehicleId", "webfleetVehicleId", name, plate, status,
            "technicianRef", latitude, longitude, "positionText", "speedKmh", "connectionStatus",
            "activeAssistanceId", "lastReportAtMs", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING id`,
        [providerId, v.id, v.webfleetVehicleId ?? null, v.name, v.plate ?? null, status,
         row.tech, row.lat, row.lng, row.posText, row.speed, row.connection,
         row.activeId, row.lastReport, now],
      );
      await db.query(
        `INSERT INTO connect_mobile_unit_events ("unitId", "fromStatus", "toStatus", reason, "createdAtMs")
         VALUES ($1, NULL, $2, 'alta automática desde el core', $3)`,
        [ins.rows[0].id, status, now],
      );
      changed++;
      continue;
    }

    const prev = existing.rows[0];
    await db.query(
      `UPDATE connect_mobile_units SET
         name = $1, plate = $2, status = $3, "technicianRef" = $4,
         latitude = COALESCE($5, latitude), longitude = COALESCE($6, longitude),
         "positionText" = COALESCE($7, "positionText"), "speedKmh" = $8,
         "connectionStatus" = $9, "activeAssistanceId" = $10,
         "lastReportAtMs" = COALESCE($11, "lastReportAtMs"), "updatedAtMs" = $12
       WHERE id = $13`,
      [v.name, v.plate ?? null, status, row.tech, row.lat, row.lng, row.posText,
       row.speed, row.connection, row.activeId, row.lastReport, now, prev.id],
    );
    if (prev.status !== status) {
      await db.query(
        `INSERT INTO connect_mobile_unit_events ("unitId", "fromStatus", "toStatus", reason, "createdAtMs")
         VALUES ($1, $2, $3, $4, $5)`,
        [prev.id, prev.status, status, manualStatus ? `manual: ${prev.manualReason ?? ""}` : "derivado del core/Webfleet", now],
      );
      publish({ kind: "status", assistanceId: 0, status: `unit:${prev.id}:${status}` });
      changed++;
    }
  }
  return changed;
}

/** Estado manual del operador (no disponible, descanso, avería…). null lo limpia. */
export async function setManualStatus(
  unitId: number,
  status: string | null,
  reason: string | null,
  byName: string,
): Promise<void> {
  if (status && !(UNIT_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Estado no válido: ${status}`);
  }
  const cur = await db.query(`SELECT status FROM connect_mobile_units WHERE id = $1`, [unitId]);
  if (!cur.rows[0]) throw new Error("Unidad no encontrada");
  const now = Date.now();
  await db.query(
    `UPDATE connect_mobile_units SET "manualStatus" = $1, "manualReason" = $2, "manualByName" = $3,
        status = COALESCE($1, status), "updatedAtMs" = $4
      WHERE id = $5`,
    [status, reason, byName, now, unitId],
  );
  await db.query(
    `INSERT INTO connect_mobile_unit_events ("unitId", "fromStatus", "toStatus", reason, "createdAtMs")
     VALUES ($1, $2, $3, $4, $5)`,
    [unitId, cur.rows[0].status, status ?? "auto", `${byName}: ${reason ?? (status ? "estado manual" : "vuelve a automático")}`, now],
  );
}
