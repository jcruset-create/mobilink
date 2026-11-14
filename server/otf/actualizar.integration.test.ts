/**
 * Editar una OTF contra PostgreSQL: que las columnas existen con esos
 * nombres, y que cambiar la base deja el operario y las notas como estaban.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sqlActualizarOtf, sqlEstadoTrabajo } from "./actualizar.ts";

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

  it("el tiempo de un trabajo: empezar, finalizar, no realizado con motivo y volver a pendiente", async () => {
    const tid = Number((await db.query(
      `INSERT INTO otf_trabajos ("otfId", plate, trabajo, "createdAtMs", "updatedAtMs") VALUES ($1,'R8535BBY','Cambiar 2',$2,$2) RETURNING id`,
      [otf, ahora]
    )).rows[0].id);
    const aplicar = async (estado: string, motivo: unknown, t: number) => {
      const c = sqlEstadoTrabajo(tid, estado, motivo, t);
      return (await db.query(c.sql, c.params)).rows[0];
    };

    expect(await aplicar("en_proceso", null, 1000)).toMatchObject({ iniciadoAtMs: "1000", finalizadoAtMs: null });
    // Volver a pulsar «Empezar» no reinicia el reloj.
    expect((await aplicar("en_proceso", null, 5000)).iniciadoAtMs).toBe("1000");
    expect(await aplicar("finalizado", "esto no se guarda", 9000)).toMatchObject({ finalizadoAtMs: "9000", motivoNoRealizado: null });
    expect(await aplicar("no_realizado", "  No estaba en la base ", 9500)).toMatchObject({ motivoNoRealizado: "No estaba en la base" });
    expect(await aplicar("pendiente", null, 9900)).toMatchObject({ iniciadoAtMs: null, finalizadoAtMs: null, motivoNoRealizado: null });
  });

  it("no realizado con la explicación del técnico, y finalizar sin Empezar toma la primera foto", async () => {
    const tid = Number((await db.query(
      `INSERT INTO otf_trabajos ("otfId", plate, trabajo, "createdAtMs", "updatedAtMs") VALUES ($1,'0348LJD','Montar 4',$2,$2) RETURNING id`,
      [otf, ahora]
    )).rows[0].id);
    const c = sqlEstadoTrabajo(tid, "no_realizado", "Falta material", 5000, "  Solo llevo 2 neumáticos ");
    expect((await db.query(c.sql, c.params)).rows[0]).toMatchObject({
      motivoNoRealizado: "Falta material", explicacionNoRealizado: "Solo llevo 2 neumáticos",
    });
    await db.query(
      `INSERT INTO otf_trabajo_files ("trabajoId","otfId",kind,url,"createdAtMs") VALUES ($1,$2,'matricula','u',3000)`,
      [tid, otf]
    );
    const p = sqlEstadoTrabajo(tid, "pendiente", null, 6000);
    await db.query(p.sql, p.params);
    const f = sqlEstadoTrabajo(tid, "finalizado", null, 9000);
    expect((await db.query(f.sql, f.params)).rows[0]).toMatchObject({
      iniciadoAtMs: "3000", finalizadoAtMs: "9000", explicacionNoRealizado: null,
    });
  });
});
