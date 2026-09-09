/**
 * Qué ocurre HOY al cerrar una asistencia, con y sin el interruptor.
 *
 * Lo que se fija, y es el punto de toda la fase: ni con el flag encendido se
 * ejecuta un movimiento de neumáticos. El interruptor prepara la fase
 * siguiente; no la adelanta.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let empresasTc: any[] = [];
let vehiculosTc: any[] = [];
/** Cualquier RPC que se llegara a llamar quedaría aquí. Debe estar vacío. */
const rpcLlamados: string[] = [];

vi.mock("../supabase.ts", () => {
  function from(tabla: string) {
    const filtros: Record<string, any> = {};
    const resultado = () => {
      if (tabla === "tc_empresas") {
        return { data: filtros.id ? empresasTc.filter((e) => e.id === filtros.id) : empresasTc, error: null };
      }
      if (tabla === "tc_vehiculos") {
        let d = vehiculosTc;
        if (filtros.empresa_id) d = d.filter((v) => v.empresa_id === filtros.empresa_id);
        if (filtros.activo != null) d = d.filter((v) => v.activo === filtros.activo);
        return { data: d, error: null };
      }
      return { data: [], error: null };
    };
    const api: any = {
      select: () => api, eq: (c: string, v: any) => { filtros[c] = v; return api; },
      in: () => api, ilike: () => api, order: () => api,
      limit: () => Promise.resolve(resultado()),
      maybeSingle: () => Promise.resolve({ data: resultado().data[0] ?? null, error: null }),
      then: (r: any) => Promise.resolve(resultado()).then(r),
    };
    return api;
  }
  return { supabase: { from } };
});

vi.mock("./sesion.ts", () => ({
  clienteTyreControl: async () => ({
    rpc: async (n: string) => { rpcLlamados.push(n); return { data: null, error: null }; },
  }),
  olvidarSesionTc: () => {},
  estadoSesionTc: () => ({ hayCredenciales: false, activa: false, email: null, expiraEnMs: null }),
}));

let db: typeof import("../db.ts").default;
let cierre: typeof import("./cierreAsistencia.ts");
let emp: typeof import("./empresas.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const EMPRESA = `emp-cie-${sufijo}`;
let cliente = 0;
let conNeumatico = 0, sinNeumatico = 0, sinMatricula = 0;

describe.skipIf(!RUN)("Cierre de asistencia y TyreControl", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initIntegrationHub } = await import("../integration-hub/index.ts");
    const { initExcepciones } = await import("../excepciones/schema.ts");
    const { initDocumentos } = await import("../documentos/schema.ts");
    await initDb(); await initConnect(); await initIntegrationHub();
    await initDocumentos(); await initExcepciones();
    cierre = await import("./cierreAsistencia.ts");
    emp = await import("./empresas.ts");
    await emp.initMapeoEmpresas();

    const c = await db.query(
      `INSERT INTO connect_clients (name, "createdAtMs", "updatedAtMs") VALUES ($1,$2,$2) RETURNING id`,
      [`Flota ${sufijo}`, Date.now()]);
    cliente = Number(c.rows[0].id);

    async function crear(plate: string | null, trabajo: string, conCliente = true) {
      const r = await db.query(
        `INSERT INTO roadside_assistances
           (status, priority, "customerName", "customerPhone", address, plate,
            "descripcionAveria", "trabajosARealizar", "trackingToken",
            "clienteFacturacionId", "assignedTechName", "costeFinal",
            "createdAtMs", "updatedAtMs", "finishedAtMs")
         VALUES ('finalizada','normal','Cliente','600111222','Calle 1',$1,'Avería',$2,$3,$4,'Antonio',185,$5,$5,$5)
         RETURNING id`,
        [plate ?? "", trabajo, `tok-cie-${sufijo}-${Math.random().toString(36).slice(2, 8)}`,
         conCliente ? cliente : null, Date.now()]);
      return Number(r.rows[0].id);
    }
    conNeumatico = await crear("1234ABC", "Sustitución de neumático en eje 2");
    sinNeumatico = await crear("5678DEF", "Arranque con pinzas, batería descargada");
    sinMatricula = await crear(null, "Remolque");
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`DELETE FROM roadside_assistances WHERE "trackingToken" LIKE $1`,
      [`tok-cie-${sufijo}%`]).catch(() => {});
    await db.query(`DELETE FROM integration_mappings WHERE system = 'tyrecontrol' AND mobilink_id = $1`,
      [String(cliente)]).catch(() => {});
    await db.query(`DELETE FROM connect_clients WHERE id = $1`, [cliente]).catch(() => {});
  }, 30_000);

  beforeEach(() => {
    rpcLlamados.length = 0;
    empresasTc = [{ id: EMPRESA, nombre: "Flota TC", activo: true }];
    vehiculosTc = [{
      id: `v-cie-${sufijo}`, empresa_id: EMPRESA, matricula: "1234-ABC", marca: "Volvo",
      modelo: "FH", tipo_vehiculo_id: null, km_actual: 300000, origen_km: "manual",
      activo: true, updated_at: null,
    }];
  });
  afterEach(() => { delete process.env.TYRE_CONTROL_WRITE_ENABLED; });

  /* ── El sobre ──────────────────────────────────────────────────────────── */

  it("resuelve el vehículo y monta el sobre con su correlación", async () => {
    await emp.guardarMapeo({ clienteId: cliente, tcEmpresaId: EMPRESA });
    const s = await cierre.alFinalizarAsistenciaParaTyreControl(conNeumatico);
    expect(s!.resolucion).toBe("FOUND");
    expect(s!.tcVehicleId).toBe(`v-cie-${sufijo}`);
    expect(s!.origenEmpresa).toBe("mapping");
    expect(s!.correlationId).toBe(`assist:${conNeumatico}:tc:record`);
    expect(s!.tecnico).toBe("Antonio");
  });

  /* La correlación es la única barrera contra duplicados que tenemos. */
  it("la correlación no cambia entre llamadas", async () => {
    const a = await cierre.alFinalizarAsistenciaParaTyreControl(conNeumatico);
    const b = await cierre.alFinalizarAsistenciaParaTyreControl(conNeumatico);
    expect(a!.correlationId).toBe(b!.correlationId);
  });

  it("un vehículo que no está en TC se dice, no se inventa", async () => {
    const s = await cierre.alFinalizarAsistenciaParaTyreControl(sinNeumatico);
    expect(s!.resolucion).toBe("NOT_FOUND");
    expect(s!.tcVehicleId).toBeNull();
  });

  it("una asistencia sin matrícula no llega ni a consultar", async () => {
    const s = await cierre.alFinalizarAsistenciaParaTyreControl(sinMatricula);
    expect(s!.resolucion).toBe("SIN_MATRICULA");
  });

  /*
   * La pista sirve para contar cuántas asistencias caerían de cada lado, no
   * para decidir nada: de un texto libre no se deduce qué rueda se tocó.
   */
  it("distingue lo que parece de neumáticos de lo que no", async () => {
    expect((await cierre.alFinalizarAsistenciaParaTyreControl(conNeumatico))!.pareceDeNeumaticos).toBe(true);
    expect((await cierre.alFinalizarAsistenciaParaTyreControl(sinNeumatico))!.pareceDeNeumaticos).toBe(false);
  });

  /* serviceKm son kilómetros del desplazamiento, no el cuentakilómetros. */
  it("el sobre NO lleva serviceKm", async () => {
    const s = await cierre.alFinalizarAsistenciaParaTyreControl(conNeumatico);
    expect(JSON.stringify(s)).not.toContain("serviceKm");
  });

  it("lleva el coste que hay ahora, sabiendo que puede no ser el definitivo", async () => {
    const s = await cierre.alFinalizarAsistenciaParaTyreControl(conNeumatico);
    expect(s!.coste.costeFinal).toBe(185);
  });

  /* ── El interruptor ────────────────────────────────────────────────────── */

  /* ÉSTA es la prueba del apartado 44. */
  it("con el flag apagado, cerrar no llama a TyreControl", async () => {
    await cierre.engancheCierreTyreControl(conNeumatico);
    expect(rpcLlamados).toEqual([]);
  });

  /*
   * Y encendido TAMPOCO. El interruptor deja la infraestructura preparada;
   * activarlo por error no puede provocar escrituras que nadie ha aprobado.
   */
  it("con el flag ENCENDIDO tampoco mueve nada todavía", async () => {
    process.env.TYRE_CONTROL_WRITE_ENABLED = "true";
    await cierre.engancheCierreTyreControl(conNeumatico);
    expect(rpcLlamados).toEqual([]);
  });

  it("una asistencia que no existe no revienta el cierre", async () => {
    expect(await cierre.engancheCierreTyreControl(99999999)).toBeNull();
  });
});
