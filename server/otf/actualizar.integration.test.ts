/**
 * Editar una OTF contra PostgreSQL: que las columnas existen con esos
 * nombres, y que cambiar la base deja el operario y las notas como estaban.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sqlActualizarOtf } from "./actualizar.ts";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

describeSiHayBase("editar una OTF", () => {
  let db: any;
  let otf = 0;
  const ahora = Date.now();

  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    otf = Number(
      (
        await db.query(
          `INSERT INTO otf ("clientName", status, "assignedTechName", notas, "createdAtMs", "updatedAtMs")
           VALUES ('Conti 360','planificada','David','Llevar gato',$1,$1) RETURNING id`,
          [ahora]
        )
      ).rows[0].id
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM otf WHERE id = $1`, [otf]);
  });

  it("poner la base no toca operario ni notas", async () => {
    const u = sqlActualizarOtf(otf, { knownPlaceId: null, baseName: "Riu Clar", direccion: "Pol. Riu Clar", lat: 41.1, lng: 1.2 }, ahora + 1);
    await db.query(u!.sql, u!.params);
    const r = (await db.query(`SELECT * FROM otf WHERE id = $1`, [otf])).rows[0];
    expect(r).toMatchObject({ baseName: "Riu Clar", direccion: "Pol. Riu Clar", assignedTechName: "David", notas: "Llevar gato", clientName: "Conti 360" });
    expect(Number(r.lat)).toBeCloseTo(41.1);
  });

  it("quitar el operario a propósito", async () => {
    const u = sqlActualizarOtf(otf, { assignedTechName: null }, ahora + 2);
    await db.query(u!.sql, u!.params);
    const r = (await db.query(`SELECT "assignedTechName", "baseName" FROM otf WHERE id = $1`, [otf])).rows[0];
    expect(r).toEqual({ assignedTechName: null, baseName: "Riu Clar" });
  });
});
