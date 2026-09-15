/**
 * El trabajo diario contra PostgreSQL: la prioridad envejece y lo resuelto se
 * cierra solo, salvo lo que espera a alguien.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

vi.mock("../core/auth.ts", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));

const EMPRESA = "00000000-0000-4000-a000-00000000fa01";
const USUARIO = "00000000-0000-4000-a000-0000000000f1";

let db: typeof import("../db.ts").default;
let repo: typeof import("./repository.ts");
let servicio: typeof import("./service.ts");
let diario: typeof import("./diario.ts");

const ctx = { empresaId: EMPRESA, userId: USUARIO, userNombre: "Prueba" };

async function expediente(extra: Partial<import("./repository.ts").DatosExpediente> = {}) {
  const ficha = await servicio.crearExpediente(ctx, {
    tipo: "INCIDENCIA_ALBARAN",
    empresaCodigo: "007",
    empresaNombre: "Comercial Ejemplo",
    proveedorCodigo: "8",
    proveedorNombre: "PROVEEDOR EJEMPLO SL",
    cuentaContable: null,
    facturaNumero: "F-2026-0001",
    facturaFecha: null,
    importeCentimos: null,
    moneda: "EUR",
    casoReferencia: null,
    urgente: false,
    tareaVencida: false,
    observaciones: "",
    ...extra,
  });
  return ficha.expediente;
}

/** Deja un expediente RESUELTO hace `dias` días, por debajo de la API. */
async function resueltoHace(dias: number): Promise<string> {
  const e = await expediente();
  await servicio.cambiarEstado(ctx, e.id, "RESUELTO", "hecho");
  await db.query(
    `UPDATE thf_expedientes SET fecha_resolucion = now() - ($2 || ' days')::interval WHERE id = $1`,
    [e.id, String(dias)]
  );
  return e.id;
}

afterAll(async () => {
  await db?.end().catch(() => {});
});

describe.runIf(RUN)("El trabajo diario de Therefore", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    repo = await import("./repository.ts");
    servicio = await import("./service.ts");
    diario = await import("./diario.ts");
  }, 60_000);

  beforeEach(async () => {
    const e = [EMPRESA];
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query(`ALTER TABLE thf_eventos DISABLE TRIGGER thf_eventos_inmutable_trg`);
      await c.query(`DELETE FROM thf_eventos WHERE empresa_id = ANY($1)`, [e]);
      await c.query(`ALTER TABLE thf_eventos ENABLE TRIGGER thf_eventos_inmutable_trg`);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
    for (const t of ["thf_decisiones", "thf_notificaciones", "thf_actuaciones", "thf_expedientes", "thf_contadores", "thf_config"]) {
      await db.query(`DELETE FROM ${t} WHERE empresa_id = ANY($1)`, [e]);
    }
  });

  it("la prioridad de un expediente viejo sube por antigüedad, y queda constancia", async () => {
    const e = await expediente();
    // Como si llevara veinte días abierto.
    await db.query(`UPDATE thf_expedientes SET fecha_primera_notificacion = now() - interval '20 days' WHERE id = $1`, [e.id]);

    const r = await diario.recalcularPrioridades(EMPRESA);
    expect(r).toEqual({ recalculados: 1, cambiados: 1 });

    const despues = await repo.obtenerExpediente(EMPRESA, e.id);
    expect(despues!.prioridadScore).toBeGreaterThan(e.prioridadScore);
    const { rows } = await db.query(`SELECT tipo FROM thf_eventos WHERE expediente_id = $1 ORDER BY occurred_at`, [e.id]);
    expect(rows.map((x) => x.tipo)).toContain("PRIORIDAD_MODIFICADA");
  });

  it("lo mirado hoy no se vuelve a mirar hoy, cambiara o no", async () => {
    await expediente();
    expect((await diario.recalcularPrioridades(EMPRESA)).recalculados).toBe(1);
    expect((await diario.recalcularPrioridades(EMPRESA)).recalculados).toBe(0);
  });

  it("un RESUELTO de hace 40 días se cierra solo, con evento del sistema; uno de hace 10 no", async () => {
    const viejo = await resueltoHace(40);
    const reciente = await resueltoHace(10);

    expect(await diario.autocerrar(EMPRESA)).toBe(1);

    expect((await repo.obtenerExpediente(EMPRESA, viejo))!.estado).toBe("CERRADO");
    expect((await repo.obtenerExpediente(EMPRESA, reciente))!.estado).toBe("RESUELTO");
    const { rows } = await db.query(
      `SELECT tipo, actor_tipo FROM thf_eventos WHERE expediente_id = $1 AND tipo = 'EXPEDIENTE_CERRADO'`,
      [viejo]
    );
    expect(rows).toEqual([{ tipo: "EXPEDIENTE_CERRADO", actor_tipo: "sistema" }]);
  });

  it("los días de autocierre se leen de la configuración", async () => {
    const id = await resueltoHace(10);
    await db.query(`INSERT INTO thf_config (empresa_id, clave, valor) VALUES ($1, 'expediente.dias_autocierre', '7')`, [EMPRESA]);
    expect(await diario.autocerrar(EMPRESA)).toBe(1);
    expect((await repo.obtenerExpediente(EMPRESA, id))!.estado).toBe("CERRADO");
  });

  it("un RESUELTO con una decisión pendiente NO se cierra: alguien tiene que contestar", async () => {
    const id = await resueltoHace(40);
    await repo.crearDecision(EMPRESA, {
      tipo: "RECLAMACION_SOBRE_RESUELTO",
      notificacionId: null,
      expedienteId: id,
      detalle: {},
    } as never);
    expect(await diario.autocerrar(EMPRESA)).toBe(0);
    expect((await repo.obtenerExpediente(EMPRESA, id))!.estado).toBe("RESUELTO");
  });

  it("la pasada entera recorre las empresas y no lanza", async () => {
    await resueltoHace(40);
    const r = await diario.procesarDiario();
    expect(r.empresas).toBeGreaterThanOrEqual(1);
    expect(r.cerrados).toBeGreaterThanOrEqual(1);
  });
});
