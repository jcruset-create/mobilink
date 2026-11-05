/**
 * Las tablets de los operarios en el Mapa flota.
 *
 * La tablet manda su posición mientras el operario tiene la sesión abierta en
 * Mobilink Assist (con la notificación fija de Android a la vista). Aquí se
 * guarda solo la ÚLTIMA de cada operario: el mapa enseña dónde está ahora, no
 * por dónde ha ido. El recorrido de una asistencia sigue guardándose aparte,
 * en `roadside_operator_track`.
 *
 * Al cerrar sesión la fila se borra: quien ha cerrado sesión no sale en el
 * mapa. Y una posición de hace más de un día no se enseña aunque siga ahí
 * (tablet apagada sin cerrar sesión): no dice nada de dónde está ahora.
 */

import db from "../db.ts";

/** Más vieja que esto, la tablet no sale en el mapa. */
export const MAX_EDAD_EN_MAPA_MS = 24 * 60 * 60_000;

export type PosicionTablet = {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  speedKmh?: number | null;
  atMs: number;
};

export async function guardarPosicionTablet(techName: string, p: PosicionTablet): Promise<void> {
  if (!techName || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
  if (p.lat === 0 && p.lng === 0) return; // GPS sin fijar
  await db.query(
    `INSERT INTO tablet_posicion ("techName", lat, lng, "accuracyM", "speedKmh", "atMs")
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("techName") DO UPDATE
       SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, "accuracyM" = EXCLUDED."accuracyM",
           "speedKmh" = EXCLUDED."speedKmh", "atMs" = EXCLUDED."atMs"
     -- Una posición más vieja (un lote que llega tarde) no pisa una más nueva.
     WHERE tablet_posicion."atMs" <= EXCLUDED."atMs"`,
    [techName, p.lat, p.lng, p.accuracyM ?? null, p.speedKmh ?? null, p.atMs]
  );
}

/**
 * La última posición de la tablet de un operario, sin límite de edad: quien
 * la use decide si es reciente (ver `core/posicionDoble.ts`).
 */
export async function ultimaPosicionTablet(
  techName: string
): Promise<{ lat: number; lng: number; atMs: number } | null> {
  const r = await db.query(
    `SELECT lat, lng, "atMs" FROM tablet_posicion WHERE "techName" = $1`,
    [techName]
  );
  const row = r.rows[0];
  return row ? { lat: Number(row.lat), lng: Number(row.lng), atMs: Number(row.atMs) } : null;
}

export async function borrarPosicionTablet(techName: string): Promise<void> {
  await db.query(`DELETE FROM tablet_posicion WHERE "techName" = $1`, [techName]);
}

export type TabletEnMapa = {
  techName: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedKmh: number | null;
  atMs: number;
  tallerId: number | null;
  tallerNombre: string | null;
  /** Taller del operario = taller de quien mira (o quien mira es admin). */
  esPropio: boolean;
  asistenciaId: number | null;
  asistenciaEstado: string | null;
  asistenciaMatricula: string | null;
  furgoneta: string | null;
};

/**
 * Las tablets para el mapa, con el taller del operario y la asistencia que
 * lleva ahora, si lleva alguna. `miTallerId` null = se ve todo como propio,
 * como en las furgonetas.
 */
export async function listarTabletsEnMapa(
  miTallerId: number | null,
  ahoraMs = Date.now()
): Promise<TabletEnMapa[]> {
  const r = await db.query(
    `SELECT tp.*, t."tallerId", at.nombre AS "tallerNombre",
            ra.id AS "asistenciaId", ra.status AS "asistenciaEstado",
            ra.plate AS "asistenciaMatricula", ra."assignedVehicleName" AS furgoneta
       FROM tablet_posicion tp
       LEFT JOIN techs t ON t.name = tp."techName"
       LEFT JOIN assist_talleres at ON at.id = t."tallerId"
       LEFT JOIN LATERAL (
         SELECT id, status, plate, "assignedVehicleName"
           FROM roadside_assistances a
          WHERE a."assignedTechName" = tp."techName"
            AND a.status IN ('asignada','en_camino','en_punto','inicio_reparacion','finalizada','en_camino_base')
          ORDER BY a."createdAtMs" DESC
          LIMIT 1
       ) ra ON true
      WHERE tp."atMs" >= $1
      ORDER BY tp."techName"`,
    [ahoraMs - MAX_EDAD_EN_MAPA_MS]
  );
  return r.rows.map((row: any) => {
    const tallerId = row.tallerId != null ? Number(row.tallerId) : null;
    return {
      techName: String(row.techName),
      lat: Number(row.lat),
      lng: Number(row.lng),
      accuracyM: row.accuracyM != null ? Number(row.accuracyM) : null,
      speedKmh: row.speedKmh != null ? Number(row.speedKmh) : null,
      atMs: Number(row.atMs),
      tallerId,
      tallerNombre: row.tallerNombre ?? null,
      esPropio: miTallerId == null || tallerId == null || tallerId === miTallerId,
      asistenciaId: row.asistenciaId != null ? Number(row.asistenciaId) : null,
      asistenciaEstado: row.asistenciaEstado ?? null,
      asistenciaMatricula: row.asistenciaMatricula ?? null,
      furgoneta: row.furgoneta ?? null,
    };
  });
}
