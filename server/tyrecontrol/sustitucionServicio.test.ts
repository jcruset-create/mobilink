/**
 * Preparar una sustitución sin llegar a hacerla.
 *
 * La prueba que justifica el fichero es la última: **con las dos llaves
 * puestas, no se llama a ningún RPC destructivo**. Todo lo demás —conflictos,
 * stock, medida— protege datos; esa protege la fase entera, porque el error que
 * de verdad no se puede cometer aquí es mover una rueda de verdad antes de
 * haberlo probado en un entorno seguro.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** El vehículo simulado de TyreControl. */
let posiciones: any[] = [];
/** El stock que devuelve `tc_stock_almacen_empresa`. */
let stock: any[] = [];
/** TODO lo que se llame contra TyreControl, para poder afirmar que no se tocó. */
let llamadas: string[] = [];

vi.mock("./estadoVehiculo.ts", () => ({
  estadoDeVehiculo: async () => {
    llamadas.push("lectura:estadoDeVehiculo");
    return {
      vehiculo: { tcVehicleId: "veh-1" }, ejes: [], posiciones,
      resumen: { posiciones: posiciones.length, montados: 0, alertas: 0,
                 profundidadMinimaMm: null, ultimaRevisionFecha: null },
    };
  },
}));

vi.mock("./sesion.ts", () => ({
  clienteTyreControl: async () => ({
    rpc: async (nombre: string) => {
      llamadas.push(`rpc:${nombre}`);
      if (nombre === "tc_stock_almacen_empresa") return { data: stock, error: null };
      return { data: null, error: null };
    },
    from: (tabla: string) => {
      llamadas.push(`from:${tabla}`);
      const api: any = { select: () => api, eq: () => api, insert: () => api, delete: () => api,
                         update: () => api, limit: async () => ({ data: [], error: null }) };
      return api;
    },
  }),
}));

const { detectarSustitucionYaAplicada, prepararSustitucion, stockDeEmpresa } =
  await import("./sustitucionServicio.ts");

/** Los RPC que mueven neumáticos de verdad. Ninguno puede aparecer en esta fase. */
const DESTRUCTIVOS = ["tc_sustituir_neumatico", "tc_desmontar_neumatico", "tc_montar_neumatico",
                      "tc_montar_desde_almacen", "tc_devolver_usado_a_stock"];

function montada(codigo: string, montaje: string, neumatico: string, medida = "315/80R22.5") {
  return {
    posicionId: `pos-${codigo}`, codigoPosicion: codigo, montajeActualId: montaje,
    neumatico: { neumaticoId: neumatico, estado: "montado", medida },
  };
}

const PLAN = {
  assistanceId: 42,
  tcEmpresaId: "emp-1",
  tcVehicleId: "veh-1",
  codigoPosicion: "E1_IZQ",
  montajeEsperado: "mont-1",
  neumaticoSalienteEsperado: "neu-viejo",
  productoAlmacenId: "prod-1",
  condicion: "nuevo" as const,
  destinoRetirado: "almacen" as const,
  motivoDesmontaje: "pinchazo" as const,
  identidad: { rfidEpc: "E280-1160", dot: "3623" },
  observaciones: "Asistencia Mobilink AST-42",
};

beforeEach(() => {
  llamadas = [];
  posiciones = [montada("E1_IZQ", "mont-1", "neu-viejo")];
  stock = [{ producto_id: "prod-1", marca: "Michelin", modelo: "X", medida: "315/80R22.5", nuevo: 4, usado: 1 }];
  process.env.TYRE_CONTROL_WRITE_ENABLED = "false";
  process.env.TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED = "false";
});

afterEach(() => {
  delete process.env.TYRE_CONTROL_WRITE_ENABLED;
  delete process.env.TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED;
});

describe("el almacén", () => {
  it("se lee por el RPC de TyreControl, que ya comprueba permisos", async () => {
    expect(await stockDeEmpresa("emp-1")).toEqual([
      { productoId: "prod-1", marca: "Michelin", modelo: "X", medida: "315/80R22.5", nuevo: 4, usado: 1 },
    ]);
    expect(llamadas).toContain("rpc:tc_stock_almacen_empresa");
  });
});

describe("simulacro completo", () => {
  it("llega hasta la llamada prevista y se detiene", async () => {
    const r = await prepararSustitucion(PLAN);
    expect(r.estado).toBe("READY_BUT_DISABLED");
    if (r.estado !== "READY_BUT_DISABLED") return;

    expect(r.llamada.rpc).toBe("tc_sustituir_neumatico");
    expect(r.llamada.argumentos).toMatchObject({
      p_montaje_actual: "mont-1",
      p_producto_almacen: "prod-1",
      p_motivo_desmontaje: "pinchazo",
      p_destino_retirado: "almacen",
      p_condicion: "nuevo",
      // Con RFID se pide control individual para que reenganche la ficha.
      p_control_individual: true,
      // Nunca se fuerza la medida: el usuario de integración es operador.
      p_forzar_medida: false,
      // `serviceKm` NO es el cuentakilómetros, así que no se manda odómetro.
      p_km: null,
    });
    expect(r.llamada.argumentos.p_datos).toEqual({ rfid_epc: "E280-1160", dot: "3623" });
  });

  it("sin identidad no impone control individual: decide la política de la empresa", async () => {
    const r = await prepararSustitucion({ ...PLAN, identidad: { dot: "3623" } });
    if (r.estado !== "READY_BUT_DISABLED") throw new Error(r.estado);
    expect(r.llamada.argumentos.p_control_individual).toBeNull();
  });

  it("avisa si la medida cambia, en vez de gastar una llamada que TC rechazará", async () => {
    stock = [{ producto_id: "prod-1", medida: "295/80R22.5", nuevo: 2, usado: 0 }];
    const r = await prepararSustitucion(PLAN);
    if (r.estado !== "READY_BUT_DISABLED") throw new Error(r.estado);
    expect(r.avisos.join(" ")).toMatch(/medida cambia/i);
  });

  it("bloquea si no hay stock de esa condición", async () => {
    stock = [{ producto_id: "prod-1", medida: "315/80R22.5", nuevo: 0, usado: 5 }];
    expect(await prepararSustitucion(PLAN)).toMatchObject({ estado: "BLOCKED", codigo: "tc_no_stock" });
    // …y con la condición «usado», el mismo producto sí se puede.
    expect((await prepararSustitucion({ ...PLAN, condicion: "usado" })).estado)
      .toBe("READY_BUT_DISABLED");
  });

  it("no inventa una posición que no está en la configuración", async () => {
    expect(await prepararSustitucion({ ...PLAN, codigoPosicion: "E9_DER" }))
      .toMatchObject({ estado: "BLOCKED", codigo: "tc_invalid_operation" });
  });
});

describe("cuando la realidad ya no es la que Assist creía", () => {
  it("para si alguien movió la rueda desde TyreControl", async () => {
    posiciones = [montada("E1_IZQ", "mont-OTRO", "neu-otro")];
    expect(await prepararSustitucion(PLAN)).toMatchObject({ estado: "CONFLICT" });
  });

  it("para si la posición se ha quedado vacía", async () => {
    posiciones = [{ posicionId: "pos-1", codigoPosicion: "E1_IZQ", montajeActualId: null, neumatico: null }];
    expect(await prepararSustitucion(PLAN)).toMatchObject({ estado: "CONFLICT" });
  });

  it("para si el montaje es el mismo pero el neumático no", async () => {
    posiciones = [montada("E1_IZQ", "mont-1", "neu-distinto")];
    expect(await prepararSustitucion(PLAN)).toMatchObject({ estado: "CONFLICT" });
  });
});

describe("evidencia posterior: ¿llegó a hacerse?", () => {
  const consulta = {
    tcVehicleId: "veh-1", codigoPosicion: "E1_IZQ",
    montajeEsperado: "mont-1", neumaticoSalienteEsperado: "neu-viejo",
  };

  it("montaje nuevo y saliente fuera → APLICADA", async () => {
    posiciones = [montada("E1_IZQ", "mont-2", "neu-nuevo")];
    expect(await detectarSustitucionYaAplicada(consulta))
      .toMatchObject({ veredicto: "APLICADA", montajeActualId: "mont-2", neumaticoId: "neu-nuevo" });
  });

  it("todo igual que antes → NO_APLICADA, se puede reintentar", async () => {
    expect(await detectarSustitucionYaAplicada(consulta)).toMatchObject({ veredicto: "NO_APLICADA" });
  });

  it("posición vacía → PARCIAL, y eso lo mira una persona", async () => {
    posiciones = [{ posicionId: "pos-1", codigoPosicion: "E1_IZQ", montajeActualId: null, neumatico: null }];
    expect(await detectarSustitucionYaAplicada(consulta)).toMatchObject({ veredicto: "PARCIAL" });
  });

  it("montaje distinto con el mismo neumático → AMBIGUA", async () => {
    posiciones = [montada("E1_IZQ", "mont-3", "neu-viejo")];
    expect(await detectarSustitucionYaAplicada(consulta)).toMatchObject({ veredicto: "AMBIGUA" });
  });

  it("sin testigo guardado no se adivina: AMBIGUA", async () => {
    posiciones = [montada("E1_IZQ", "mont-9", "neu-nuevo")];
    expect(await detectarSustitucionYaAplicada({ ...consulta, montajeEsperado: null }))
      .toMatchObject({ veredicto: "AMBIGUA" });
  });
});

describe("cero escrituras destructivas, pase lo que pase", () => {
  it("con las llaves apagadas no se llama a ningún RPC que mueva nada", async () => {
    await prepararSustitucion(PLAN);
    for (const rpc of DESTRUCTIVOS) expect(llamadas).not.toContain(`rpc:${rpc}`);
  });

  /*
   * El caso que exige la fase: aunque alguien encienda las DOS llaves —la
   * general y la de sustitución— esta fase sigue sin ejecutar. El freno está
   * dentro del handler, no en quien lo llama.
   */
  it("con las dos llaves puestas TAMPOCO ejecuta", async () => {
    process.env.TYRE_CONTROL_WRITE_ENABLED = "true";
    process.env.TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED = "true";

    const r = await prepararSustitucion(PLAN);
    expect(r.estado).toBe("READY_BUT_DISABLED");
    if (r.estado === "READY_BUT_DISABLED") {
      expect(r.avisos.join(" ")).toMatch(/1D\.1/);
    }
    for (const rpc of DESTRUCTIVOS) expect(llamadas).not.toContain(`rpc:${rpc}`);
    // Ni por la puerta de atrás: ninguna escritura directa sobre tablas tc_*.
    expect(llamadas.filter((l) => l.startsWith("from:"))).toEqual([]);
  });

  it("ni siquiera al detectar la evidencia: solo lectura", async () => {
    posiciones = [montada("E1_IZQ", "mont-2", "neu-nuevo")];
    await detectarSustitucionYaAplicada({
      tcVehicleId: "veh-1", codigoPosicion: "E1_IZQ",
      montajeEsperado: "mont-1", neumaticoSalienteEsperado: "neu-viejo",
    });
    expect(llamadas).toEqual(["lectura:estadoDeVehiculo"]);
  });
});
