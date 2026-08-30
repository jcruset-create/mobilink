/**
 * Mapeo cliente Assist ↔ empresa TyreControl, y los cinco casos de resolución.
 *
 * El caso que justifica todo esto: la misma matrícula en dos empresas de TC.
 * Sin mapeo es irresoluble; con mapeo deja de serlo. Y el caso 2 —cliente
 * mapeado cuya empresa NO tiene esa matrícula— tiene que dar NOT_FOUND, nunca
 * buscar en la empresa de al lado.
 *
 * `integration_mappings` es una tabla real; `tc_*` está simulado, porque vive
 * en Supabase y aquí no hay proyecto.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/** Lo que hay «en TyreControl» en cada prueba. */
let empresasTc: any[] = [];
let vehiculosTc: any[] = [];

vi.mock("../supabase.ts", () => {
  function from(tabla: string) {
    const filtros: Record<string, any> = {};
    const resultado = () => {
      if (tabla === "tc_empresas") {
        const d = filtros.id ? empresasTc.filter((e) => e.id === filtros.id) : empresasTc;
        return { data: d, error: null };
      }
      if (tabla === "tc_vehiculos") {
        let d = vehiculosTc;
        if (filtros.empresa_id) d = d.filter((v) => v.empresa_id === filtros.empresa_id);
        if (filtros.activo != null) d = d.filter((v) => v.activo === filtros.activo);
        return { data: d, error: null };
      }
      if (tabla === "tc_tipos_vehiculo") return { data: [{ id: "tipo-1", nombre: "tractora" }], error: null };
      return { data: [], error: null };
    };
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { filtros[col] = val; return api; },
      in: () => api,
      ilike: () => api,
      order: () => api,
      limit: () => Promise.resolve(resultado()),
      maybeSingle: () => Promise.resolve({ data: resultado().data[0] ?? null, error: null }),
      then: (r: any) => Promise.resolve(resultado()).then(r),
    };
    return api;
  }
  return { supabase: { from } };
});

let db: typeof import("../db.ts").default;
let emp: typeof import("./empresas.ts");
let veh: typeof import("./vehiculos.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let clienteA = 0, clienteB = 0, clienteSinMapeo = 0;

const EMP_UNO = `emp-uno-${sufijo}`;
const EMP_DOS = `emp-dos-${sufijo}`;

function vehiculo(id: string, matricula: string, empresaId: string, activo = true) {
  return { id, empresa_id: empresaId, matricula, marca: "Volvo", modelo: "FH",
           tipo_vehiculo_id: "tipo-1", km_actual: 1000, origen_km: "manual",
           activo, updated_at: null };
}

describe.skipIf(!RUN)("Mapeo de empresa y resolución", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initIntegrationHub } = await import("../integration-hub/index.ts");
    await initDb(); await initConnect(); await initIntegrationHub();
    emp = await import("./empresas.ts");
    veh = await import("./vehiculos.ts");
    await emp.initMapeoEmpresas();

    for (const nombre of ["Alfa", "Beta", "SinMapeo"]) {
      const r = await db.query(
        `INSERT INTO connect_clients (name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$2) RETURNING id`,
        [`Cliente ${nombre} ${sufijo}`, Date.now()],
      );
      const id = Number(r.rows[0].id);
      if (nombre === "Alfa") clienteA = id;
      else if (nombre === "Beta") clienteB = id;
      else clienteSinMapeo = id;
    }
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`DELETE FROM integration_mappings WHERE system = 'tyrecontrol'
                     AND mobilink_id = ANY($1::text[])`,
      [[clienteA, clienteB, clienteSinMapeo].map(String)]).catch(() => {});
    await db.query(`DELETE FROM connect_clients WHERE id = ANY($1::int[])`,
      [[clienteA, clienteB, clienteSinMapeo]]).catch(() => {});
  }, 30_000);

  beforeEach(() => {
    empresasTc = [
      { id: EMP_UNO, nombre: "Transportes Uno", activo: true },
      { id: EMP_DOS, nombre: "Transportes Dos", activo: true },
    ];
    // La MISMA matrícula en dos empresas: el caso que lo justifica todo.
    vehiculosTc = [
      vehiculo(`v-uno-${sufijo}`, "1234ABC", EMP_UNO),
      vehiculo(`v-dos-${sufijo}`, "1234-ABC", EMP_DOS),
      vehiculo(`v-solo-${sufijo}`, "9999ZZZ", EMP_UNO),
    ];
  });

  /* ── El mapeo ──────────────────────────────────────────────────────────── */

  it("se guarda y se lee con los nombres de los dos lados", async () => {
    const m = await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_UNO, porQuien: "Jordi" });
    expect(m.tcEmpresaId).toBe(EMP_UNO);
    expect(m.tcEmpresaNombre).toBe("Transportes Uno");
    expect(m.clienteNombre).toContain("Alfa");
  });

  /* Un cliente, una empresa: es la invariante que le faltaba a la tabla. */
  it("un cliente no puede apuntar a dos empresas: el segundo reemplaza", async () => {
    await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_UNO });
    await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_DOS });
    const todos = (await emp.listarMapeos()).filter((m) => m.clienteId === clienteA);
    expect(todos).toHaveLength(1);
    expect(todos[0].tcEmpresaId).toBe(EMP_DOS);
  });

  /* Se comprueba antes de guardar: si no, el fallo aparece al primer envío. */
  it("no se puede mapear a una empresa que no existe", async () => {
    await expect(emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: "no-existe" }))
      .rejects.toMatchObject({ codigo: "empresa_no_encontrada" });
  });

  it("no se puede mapear a una empresa dada de baja", async () => {
    empresasTc = [{ id: EMP_UNO, nombre: "Transportes Uno", activo: false }];
    await expect(emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_UNO }))
      .rejects.toMatchObject({ codigo: "empresa_inactiva" });
  });

  it("no se puede mapear un cliente que no existe", async () => {
    await expect(emp.guardarMapeo({ clienteId: 99999999, tcEmpresaId: EMP_UNO }))
      .rejects.toMatchObject({ codigo: "cliente_no_encontrado" });
  });

  it("se puede quitar", async () => {
    await emp.borrarMapeo(clienteA).catch(() => {});
    await emp.guardarMapeo({ clienteId: clienteB, tcEmpresaId: EMP_DOS });
    await emp.borrarMapeo(clienteB);
    expect(await emp.empresaDeCliente(clienteB)).toBeNull();
  });

  /*
   * La tabla ya lo impedía; lo que se añade es decirlo con nombres en vez de
   * con el mensaje de una restricción.
   */
  it("dos clientes no pueden reclamar la misma empresa, y se explica", async () => {
    await emp.borrarMapeo(clienteB).catch(() => {});
    await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_UNO });
    const e: any = await emp.guardarMapeo({ clienteId: clienteB, tcEmpresaId: EMP_UNO }).catch((x) => x);
    expect(e.codigo).toBe("empresa_ya_asignada");
    expect(e.message).toContain("Transportes Uno");
    expect(e.message).toContain("Alfa");
  });

  /* ── Los cinco casos ───────────────────────────────────────────────────── */

  /* Caso 1 */
  it("cliente mapeado + matrícula en esa empresa → FOUND por mapping", async () => {
    await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_UNO });
    const r = await veh.resolverVehiculoDeCliente("1234ABC", clienteA);
    expect(r.estado).toBe("FOUND");
    if (r.estado !== "FOUND") return;
    expect(r.vehiculo.empresaId).toBe(EMP_UNO);
    expect(r.origenEmpresa).toBe("mapping");
  });

  /*
   * Caso 2 — el importante. Que ese cliente no tenga ese vehículo es una
   * respuesta correcta; encontrarlo en la empresa de al lado y actuar sobre
   * él, no.
   */
  it("cliente mapeado + matrícula NO en su empresa → NOT_FOUND, sin mirar en otra", async () => {
    await emp.guardarMapeo({ clienteId: clienteB, tcEmpresaId: EMP_DOS });
    // 9999ZZZ solo existe en EMP_UNO.
    const r = await veh.resolverVehiculoDeCliente("9999ZZZ", clienteB);
    expect(r.estado).toBe("NOT_FOUND");
  });

  /* Caso 3 */
  it("sin mapeo + matrícula única → FOUND, pero diciendo que fue por coincidencia", async () => {
    const r = await veh.resolverVehiculoDeCliente("9999ZZZ", clienteSinMapeo);
    expect(r.estado).toBe("FOUND");
    if (r.estado !== "FOUND") return;
    expect(r.origenEmpresa).toBe("unica");   // no «mapping»: se sabe de dónde vino
  });

  /* Caso 4 */
  it("sin mapeo + matrícula en dos empresas → AMBIGUOUS", async () => {
    const r = await veh.resolverVehiculoDeCliente("1234ABC", clienteSinMapeo);
    expect(r.estado).toBe("AMBIGUOUS");
    if (r.estado !== "AMBIGUOUS") return;
    expect(r.candidatos).toHaveLength(2);
  });

  /* Y con mapeo deja de serlo: es la razón de ser de todo esto. */
  it("el mapeo elimina la ambigüedad", async () => {
    const sin = await veh.resolverVehiculoDeCliente("1234ABC", clienteSinMapeo);
    expect(sin.estado).toBe("AMBIGUOUS");

    await emp.borrarMapeo(clienteB).catch(() => {});
    await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_DOS });
    const con = await veh.resolverVehiculoDeCliente("1234ABC", clienteA);
    expect(con.estado).toBe("FOUND");
    if (con.estado === "FOUND") expect(con.vehiculo.empresaId).toBe(EMP_DOS);
  });

  /* Caso 5 — no se resuelve por otra empresa «porque esa no vale». */
  it("mapeo a una empresa que desaparece → MAPPING_ERROR, no otra empresa", async () => {
    await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_UNO });
    empresasTc = [{ id: EMP_DOS, nombre: "Transportes Dos", activo: true }];   // EMP_UNO ya no está

    const r = await veh.resolverVehiculoDeCliente("1234ABC", clienteA);
    expect(r.estado).toBe("MAPPING_ERROR");
    if (r.estado === "MAPPING_ERROR") expect(r.tcEmpresaId).toBe(EMP_UNO);
  });

  it("mapeo a una empresa dada de baja → MAPPING_ERROR con el nombre", async () => {
    await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_UNO });
    empresasTc = [{ id: EMP_UNO, nombre: "Transportes Uno", activo: false }];

    const r = await veh.resolverVehiculoDeCliente("1234ABC", clienteA);
    expect(r.estado).toBe("MAPPING_ERROR");
    if (r.estado === "MAPPING_ERROR") expect(r.motivo).toContain("Transportes Uno");
  });

  it("un mapeo desactivado se ignora y se cae a la búsqueda global", async () => {
    await emp.guardarMapeo({ clienteId: clienteA, tcEmpresaId: EMP_UNO, activo: false });
    const r = await veh.resolverVehiculoDeCliente("1234ABC", clienteA);
    expect(r.estado).toBe("AMBIGUOUS");
  });
});
