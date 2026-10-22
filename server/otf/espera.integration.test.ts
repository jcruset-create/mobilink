/**
 * Una OTF pendiente detrás de una asistencia de carretera, contra PostgreSQL.
 *
 * Contra base de verdad porque la regla ES una consulta: lo que puede fallar
 * es el SQL —un estado mal escrito, un alias que no cuadra— y eso no se ve
 * fingiendo la base.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OTF_EN_ESPERA_SQL } from "./espera.ts";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

describeSiHayBase("OTF pendiente hasta que el operario cierre la asistencia", () => {
  let db: any;
  let asistencia = 0;
  let otf = 0;
  const ahora = Date.now();

  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    asistencia = Number(
      (
        await db.query(
          `INSERT INTO roadside_assistances (status, priority, plate, "trackingToken", "createdAtMs", "updatedAtMs")
           VALUES ('en_camino','normal','1111AAA',$2,$1,$1) RETURNING id`,
          [ahora, `otf-espera-${ahora}`]
        )
      ).rows[0].id
    );
    otf = Number(
      (
        await db.query(
          `INSERT INTO otf ("clientName", status, "assignedTechName", "esperaAsistenciaId", "createdAtMs", "updatedAtMs")
           VALUES ('La Ponderosa','planificada','Iván',$1,$2,$2) RETURNING id`,
          [asistencia, ahora]
        )
      ).rows[0].id
    );
  });

  afterAll(async () => {
    await db.query(`DELETE FROM otf WHERE id = $1`, [otf]);
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [asistencia]);
  });

  async function enEspera(): Promise<boolean> {
    const r = await db.query(
      `SELECT ${OTF_EN_ESPERA_SQL} AS espera FROM otf o WHERE o.id = $1`,
      [otf]
    );
    return r.rows[0].espera === true;
  }

  async function ponerEstado(estado: string) {
    await db.query(`UPDATE roadside_assistances SET status = $2 WHERE id = $1`, [asistencia, estado]);
  }

  it("espera mientras la asistencia sigue abierta", async () => {
    for (const estado of ["asignada", "en_camino", "en_punto", "inicio_reparacion", "finalizada"]) {
      await ponerEstado(estado);
      // «finalizada» incluida: el operario sigue con ella hasta llegar al
      // taller, igual que en la cola de asistencias.
      expect(await enEspera(), estado).toBe(true);
    }
  });

  it("deja de esperar SOLA en cuanto la asistencia se cierra, sin tocar la OTF", async () => {
    for (const estado of ["llegada_taller", "cancelada", "redirigida"]) {
      await ponerEstado(estado);
      expect(await enEspera(), estado).toBe(false);
    }
    // La columna sigue apuntando a la asistencia: nadie la ha limpiado, y aun
    // así ya no espera. Es lo que hace que un fallo al cerrar no pueda dejar
    // la OTF bloqueada para siempre.
    const r = await db.query(`SELECT "esperaAsistenciaId" FROM otf WHERE id = $1`, [otf]);
    expect(Number(r.rows[0].esperaAsistenciaId)).toBe(asistencia);
  });

  it("una OTF que no espera a nadie nunca está en espera", async () => {
    await db.query(`UPDATE otf SET "esperaAsistenciaId" = NULL WHERE id = $1`, [otf]);
    await ponerEstado("en_camino");
    expect(await enEspera()).toBe(false);
    await db.query(`UPDATE otf SET "esperaAsistenciaId" = $2 WHERE id = $1`, [otf, asistencia]);
  });

  it("si la asistencia ya no existe, se suelta", async () => {
    // Preferimos soltarla a dejarla presa de algo que no se puede consultar.
    await db.query(`UPDATE otf SET "esperaAsistenciaId" = 999999999 WHERE id = $1`, [otf]);
    expect(await enEspera()).toBe(false);
  });
});
