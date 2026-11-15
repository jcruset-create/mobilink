/**
 * El cambio de neumáticos de una OTF contra PostgreSQL: que las columnas
 * existen, y que con la escritura en TyreControl apagada (como viene) el
 * montaje no se intenta y queda dicho por qué.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { limpiarNeumaticos } from "./neumaticosTc.ts";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

describeSiHayBase("cambio de neumáticos de una OTF", () => {
  let db: any;
  let montar: (tid: number) => Promise<any>;
  let otf = 0;
  const ahora = Date.now();
  const neumaticos = limpiarNeumaticos({
    tcEmpresaId: "emp", tcVehiculoId: null, tcTipoVehiculoId: "tipo", tipoNombre: "Tractora", config: "2x2",
    posiciones: [
      { id: "p1", codigo: "E1_IZQ", eje: 1, lado: "izq", x: 7, y: 10, w: 14, h: 14 },
      { id: "p2", codigo: "E1_DER", eje: 1, lado: "der", x: 79, y: 10, w: 14, h: 14 },
    ],
    seleccion: ["E1_IZQ", "E1_DER"], referenciaId: "ref", marca: "Continental", modelo: "HS3", medida: "315/70R22.5",
  });

  const trabajo = async (status: string, conNeumaticos = true) =>
    Number((await db.query(
      `INSERT INTO otf_trabajos ("otfId", plate, trabajo, status, neumaticos, "createdAtMs", "updatedAtMs")
       VALUES ($1,'1111AAA','Cambio de neumáticos',$2,$3::jsonb,$4,$4) RETURNING id`,
      [otf, status, conNeumaticos ? JSON.stringify(neumaticos) : null, ahora],
    )).rows[0].id);

  beforeAll(async () => {
    delete process.env.TYRE_CONTROL_OTF_MOUNT_ENABLED;
    db = (await import("../db.ts")).default;
    montar = (await import("./neumaticosTcServicio.ts")).montarTrabajoEnTc;
    otf = Number((await db.query(
      `INSERT INTO otf ("clientName", status, "createdAtMs", "updatedAtMs") VALUES ('Conti 360','en_curso',$1,$1) RETURNING id`,
      [ahora],
    )).rows[0].id);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM otf WHERE id = $1`, [otf]);
  });

  it("finalizado y con la escritura apagada: no se monta y se dice por qué", async () => {
    const tid = await trabajo("finalizado");
    const r = await montar(tid);
    expect(r).toMatchObject({ estado: "desactivado" });
    const fila = (await db.query(`SELECT "tcMontaje", neumaticos FROM otf_trabajos WHERE id = $1`, [tid])).rows[0];
    expect(fila.tcMontaje.estado).toBe("desactivado");
    expect(fila.neumaticos.seleccion).toEqual(["E1_IZQ", "E1_DER"]);
  });

  it("sin finalizar, o sin neumáticos, ni se entra", async () => {
    expect(await montar(await trabajo("pendiente"))).toBeNull();
    expect(await montar(await trabajo("finalizado", false))).toBeNull();
  });

  it("si ya hay uno registrándose, el segundo no entra", async () => {
    const tid = await trabajo("finalizado");
    await db.query(`UPDATE otf_trabajos SET "tcMontaje" = $2::jsonb WHERE id = $1`,
      [tid, JSON.stringify({ estado: "en_curso", motivo: null, atMs: Date.now() })]);
    expect(await montar(tid)).toBeNull();
    // Pero uno que se quedó colgado hace rato sí se puede retomar.
    await db.query(`UPDATE otf_trabajos SET "tcMontaje" = $2::jsonb WHERE id = $1`,
      [tid, JSON.stringify({ estado: "en_curso", motivo: null, atMs: Date.now() - 3600_000 })]);
    expect(await montar(tid)).toMatchObject({ estado: "desactivado" });
  });
});
