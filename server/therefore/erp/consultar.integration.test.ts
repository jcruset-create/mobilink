/**
 * La consulta al ERP guardada en la actuación, contra PostgreSQL.
 *
 * El ERP es de mentira —una consulta inyectada— y todo lo demás es real: la
 * actuación, el análisis con sus líneas, la comparación, lo que se guarda y
 * el evento. Lo que se fija es que lo que dijo el ERP queda tal cual, que la
 * comparación sólo aparece cuando hay líneas en los dos lados, y que la
 * actuación no se mueve.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsultaAlbaranesErp, EstadoAlbaranErp } from "./puerto.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

vi.mock("../../core/auth.ts", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));

const EMPRESA = "00000000-0000-4000-a000-00000000e501";
const USUARIO = "00000000-0000-4000-a000-0000000000e1";
const ctx = { empresaId: EMPRESA, userId: USUARIO, userNombre: "Prueba" };

let db: typeof import("../../db.ts").default;
let repo: typeof import("../repository.ts");
let servicio: typeof import("../service.ts");
let consultar: typeof import("./consultar.ts").consultarAlbaranEnErp;

const respuesta = (estado: EstadoAlbaranErp | null, fuente = "bc-prueba"): ConsultaAlbaranesErp => ({
  fuente,
  disponible: () => true,
  async consultarAlbaran() {
    return estado;
  },
});

const enErp: EstadoAlbaranErp = {
  existe: true,
  grabado: true,
  contabilizado: true,
  importeCentimos: 21390,
  facturaAsociada: "F-2026-0001",
  lineas: [
    { referencia: "4400111222333", descripcion: "PASTILLA", cantidad: 1, precioUnitarioCentimos: 7750, importeCentimos: 2790 },
    { referencia: "4400111222444", descripcion: "DISCO", cantidad: 1, precioUnitarioCentimos: 15500, importeCentimos: 15500 },
  ],
  consultadoAt: "2026-09-15T09:14:00.000Z",
  fuente: "bc-prueba",
};

async function actuacionConAlbaran(): Promise<{ expedienteId: string; actuacionId: string }> {
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
  });
  const conActuacion = await servicio.anadirActuacion(ctx, ficha.expediente.id, {
    tipoAccion: "MODIFICAR",
    albaranSolicitado: "0501234",
    importeCentimos: 21390,
    indicadorAdicional: null,
    obligatoria: true,
    observaciones: "",
  });
  return { expedienteId: ficha.expediente.id, actuacionId: conActuacion.actuacion.id };
}

/** Un análisis completado con dos líneas, escrito por debajo de la API. */
async function conAnalisis(expedienteId: string, actuacionId: string): Promise<void> {
  const fila = await repo.encolarAnalisis(EMPRESA, expedienteId, actuacionId, "0501234", 21390);
  await repo.guardarResultadoAnalisis(fila.id, "COMPLETADO", { estadoAnalisis: "OK", importeLineasCentimos: 21390 });
  const conf = { referencia: 1, descripcion: 1, cantidad: 1, precio: 1, importe: 1, descuentos: 1 };
  await repo.guardarLineas(EMPRESA, fila.id, [
    { numeroLinea: 1, referencia: "4400111222333", descripcion: "PASTILLA", cantidad: 1, precioUnitarioCentimos: 7750, importeCentimos: 2790, confianza: conf, cuadraAritmetica: true, descuentosRaw: "", descuentos: [], rawText: "", pagina: 1, bbox: null },
    { numeroLinea: 2, referencia: "4400111222444", descripcion: "DISCO", cantidad: 2, precioUnitarioCentimos: 15500, importeCentimos: 18600, confianza: conf, cuadraAritmetica: true, descuentosRaw: "", descuentos: [], rawText: "", pagina: 1, bbox: null },
  ]);
}

afterAll(async () => {
  await db?.end().catch(() => {});
});

describe.runIf(RUN)("Consultar el albarán en el ERP", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    repo = await import("../repository.ts");
    servicio = await import("../service.ts");
    ({ consultarAlbaranEnErp: consultar } = await import("./consultar.ts"));
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
    for (const t of ["thf_validaciones", "thf_albaranes_analizados", "thf_actuaciones", "thf_expedientes", "thf_contadores", "thf_config"]) {
      await db.query(`DELETE FROM ${t} WHERE empresa_id = ANY($1)`, [e]);
    }
  });

  it("guarda lo que dijo el ERP tal cual, con la hora, y anota el evento sin mover la actuación", async () => {
    const { actuacionId } = await actuacionConAlbaran();
    const r = await consultar(ctx, actuacionId, { consulta: respuesta(enErp), ahora: new Date("2026-09-15T10:00:00Z") });
    expect(r.estado?.existe).toBe(true);
    expect(r.comparacion).toBeNull(); // sin análisis del PDF no hay con qué comparar

    const a = await repo.obtenerActuacion(EMPRESA, actuacionId);
    expect(a!.estado).toBe("PENDIENTE");
    expect(a!.erpConsultadoAt).toBe("2026-09-15T10:00:00.000Z");
    expect((a!.erpEstado as { estado: EstadoAlbaranErp }).estado.facturaAsociada).toBe("F-2026-0001");
    const { rows } = await db.query(`SELECT tipo FROM thf_eventos WHERE actuacion_id = $1`, [actuacionId]);
    expect(rows.map((x) => x.tipo)).toContain("ERP_CONSULTADO");
  });

  it("con análisis del PDF, compara línea a línea y guarda la diferencia", async () => {
    const { expedienteId, actuacionId } = await actuacionConAlbaran();
    await conAnalisis(expedienteId, actuacionId);
    const r = await consultar(ctx, actuacionId, { consulta: respuesta(enErp) });
    expect(r.comparacion).not.toBeNull();
    expect(r.comparacion!.coincide).toBe(false);
    // La segunda línea: el papel dice 2 uds y 186,00; el ERP 1 ud y 155,00.
    const dif = r.comparacion!.lineas.find((l) => l.tipo === "DIFIERE");
    expect(dif && dif.tipo === "DIFIERE" && dif.campos).toEqual(["cantidad", "importe"]);
    expect(r.comparacion!.diferenciaTotalCentimos).toBe(21390 - 18290);
  });

  it("«no lo sé» se guarda como null y el evento lo dice; «no consta» como existe: false", async () => {
    const { actuacionId } = await actuacionConAlbaran();
    const sinRespuesta = await consultar(ctx, actuacionId, { consulta: respuesta(null) });
    expect(sinRespuesta.estado).toBeNull();
    let a = await repo.obtenerActuacion(EMPRESA, actuacionId);
    expect((a!.erpEstado as { estado: unknown }).estado).toBeNull();

    const noConsta = await consultar(ctx, actuacionId, { consulta: respuesta({ ...enErp, existe: false, lineas: null }) });
    expect(noConsta.estado?.existe).toBe(false);
    a = await repo.obtenerActuacion(EMPRESA, actuacionId);
    expect((a!.erpEstado as { estado: EstadoAlbaranErp }).estado.existe).toBe(false);
  });

  it("sin ERP conectado se dice, y no se guarda nada", async () => {
    const { actuacionId } = await actuacionConAlbaran();
    const sinErp: ConsultaAlbaranesErp = { fuente: "ninguna", disponible: () => false, async consultarAlbaran() { return null; } };
    await expect(consultar(ctx, actuacionId, { consulta: sinErp })).rejects.toMatchObject({ codigo: "SIN_ERP" });
    const a = await repo.obtenerActuacion(EMPRESA, actuacionId);
    expect(a!.erpConsultadoAt).toBeNull();
  });
});
