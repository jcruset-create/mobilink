/**
 * Kilómetros del rastro de Mobilink Assist, contra PostgreSQL.
 *
 * El cálculo ya está probado aparte con puntos inventados; lo que se fija aquí
 * es la lectura: que el rastro del técnico y el historial de estados de la
 * asistencia se cruzan bien, que es de donde sale el desglose de ida y vuelta
 * cuando el rastro no lleva el estado dentro.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let recorridoDeAsistenciaCore: typeof import("./recorrido.ts").recorridoDeAsistenciaCore;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const T0 = Date.parse("2026-09-11T17:49:00+02:00");
let asistenciaId = 0;

/** Un punto a `metros` al este, a los `segundos` del comienzo. */
const punto = (metros: number, segundos: number) => ({
  lat: 41.1,
  lng: 1.2 + metros / 84_000,
  ts: T0 + segundos * 1000,
});

describe.skipIf(!RUN)("kilómetros del rastro de Assist", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    await initDb();
    ({ recorridoDeAsistenciaCore } = await import("./recorrido.ts"));

    const a = await db.query(
      `INSERT INTO roadside_assistances
         (status, "customerName", "customerPhone", address, plate, "trackingToken",
          "createdAtMs", "updatedAtMs")
       VALUES ('finalizada','Prueba recorrido','600000000','Ctra. N-340','1234ABC',$1,$2,$2)
       RETURNING id`,
      [`tk-rec-${sufijo}`, T0],
    );
    asistenciaId = Number(a.rows[0].id);

    // El historial: sale, llega, trabaja y vuelve.
    for (const [status, seg] of [
      ["asignada", -60], ["en_camino", 0], ["en_punto", 900],
      ["en_camino_base", 2400], ["llegada_taller", 3300],
    ] as const) {
      await db.query(
        `INSERT INTO roadside_assistance_events ("assistanceId", status, "createdAtMs")
         VALUES ($1,$2,$3)`,
        [asistenciaId, status, T0 + seg * 1000],
      );
    }

    // El rastro: 10 km de ida, quieto en el punto, 10 km de vuelta.
    // Como el rastro real: mientras está parado la app sigue latiendo, así
    // que no hay agujeros; lo que hay es el aparato quieto, que no suma.
    const puntos = [
      ...Array.from({ length: 11 }, (_, i) => punto(i * 1000, i * 80)),
      ...Array.from({ length: 27 }, (_, i) => punto(10_000 + (i % 2), 880 + i * 60)),
      ...Array.from({ length: 11 }, (_, i) => punto(10_000 - i * 1000, 2500 + i * 80)),
    ];
    for (const p of puntos) {
      await db.query(
        `INSERT INTO roadside_operator_track ("assistanceId", lat, lng, ts) VALUES ($1,$2,$3,$4)`,
        [asistenciaId, p.lat, p.lng, p.ts],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!RUN || !asistenciaId) return;
    await db.query(`DELETE FROM roadside_operator_track WHERE "assistanceId" = $1`, [asistenciaId]).catch(() => {});
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [asistenciaId]).catch(() => {});
  }, 30_000);

  it("saca ida y vuelta cruzando el rastro con el historial de estados", async () => {
    const r = await recorridoDeAsistenciaCore(asistenciaId);
    expect(r.ida).toBeGreaterThan(9);
    expect(r.vuelta).toBeGreaterThan(9);
    expect(r.propuestaKm).toBe(20);
    expect(r.calidad).toBe("bueno");
  });

  it("una asistencia sin rastro no inventa kilómetros", async () => {
    const a = await db.query(
      `INSERT INTO roadside_assistances
         (status, "customerName", "customerPhone", address, "trackingToken", "createdAtMs", "updatedAtMs")
       VALUES ('pendiente','Sin rastro','600000001','Ctra.',$1,$2,$2) RETURNING id`,
      [`tk-sin-${sufijo}`, T0],
    );
    const id = Number(a.rows[0].id);
    const r = await recorridoDeAsistenciaCore(id);
    expect(r.total).toBe(0);
    expect(r.calidad).toBe("insuficiente");
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [id]).catch(() => {});
  });
});
