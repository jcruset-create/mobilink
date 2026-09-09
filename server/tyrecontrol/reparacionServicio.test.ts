/**
 * Ejecución de la reparación.
 *
 * Las dos pruebas que justifican el fichero:
 *
 *  · Si alguien movió la rueda desde TyreControl, NO se repara: se marca
 *    conflicto. Nunca «la rueda que haya ahora».
 *  · Si se pierde la respuesta del RPC, no se repite a ciegas. O se demuestra
 *    que ya ocurrió —por la incidencia, que hace de referencia externa— o se
 *    deriva a una persona.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Lo que devuelve el vehículo simulado. */
let posiciones: any[] = [];
/** Operaciones que TyreControl tiene enlazadas a una incidencia. */
let operacionesPorIncidencia: Record<string, string> = {};
/** Qué debe fallar en la próxima llamada. */
let fallarRpc: string | null = null;
let fallarInsert = false;
/** Qué se ha llamado, para poder afirmar que NO se repitió. */
let llamadas: string[] = [];

vi.mock("./estadoVehiculo.ts", () => ({
  estadoDeVehiculo: async () => ({
    vehiculo: { tcVehicleId: "veh-1" }, ejes: [], posiciones,
    resumen: { posiciones: posiciones.length, montados: 0, alertas: 0,
               profundidadMinimaMm: null, ultimaRevisionFecha: null },
  }),
}));

vi.mock("./sesion.ts", () => ({
  clienteTyreControl: async () => ({
    rpc: async (nombre: string, args: any) => {
      llamadas.push(nombre);
      if (fallarRpc) return { data: null, error: { message: fallarRpc } };
      // El RPC deja la operación enlazada a la incidencia: es la evidencia.
      if (nombre === "tc_resolver_incidencia_parcial") {
        operacionesPorIncidencia[args.p_incidencia_id] = `op-${args.p_incidencia_id}`;
      }
      return { data: "op-taller", error: null };
    },
    from: (tabla: string) => {
      const api: any = {
        insert: (fila: any) => {
          llamadas.push(`insert:${tabla}`);
          if (fallarInsert) {
            return { select: () => ({ single: async () => ({ data: null, error: { message: "boom" } }) }) };
          }
          const id = tabla === "tc_incidencias" ? "inc-1" : "prob-1";
          void fila;
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
        },
        select: () => api,
        eq: (col: string, val: any) => {
          if (col === "incidencia_id") (api as any)._inc = val;
          return api;
        },
        limit: async () => {
          const inc = (api as any)._inc;
          const op = inc ? operacionesPorIncidencia[inc] : null;
          return { data: op ? [{ id: op }] : [], error: null };
        },
      };
      return api;
    },
  }),
  olvidarSesionTc: () => {},
}));

const { ejecutarReparacion } = await import("./reparacionServicio.ts");

const PLAN = {
  tcVehicleId: "veh-1", tcEmpresaId: "emp-1",
  posicionCodigo: "E2_IZQ_EXT", tipo: "pinchazo" as const, resultado: "reparado" as const,
  observaciones: "Asistencia Mobilink AST-1 · Técnico: Antonio",
};

function posicionMontada(montaje = "mon-1", neumatico = "neu-1", estado = "montado") {
  return [{
    posicionId: "pos-1", codigoPosicion: "E2_IZQ_EXT", eje: 2, ordenVisual: 1,
    montajeActualId: montaje, neumatico: { neumaticoId: neumatico, estado },
    fechaMontaje: null, kmMontaje: null, ultimaRevision: null,
  }];
}

beforeEach(() => {
  posiciones = posicionMontada();
  operacionesPorIncidencia = {};
  fallarRpc = null; fallarInsert = false; llamadas = [];
});

describe("Camino en sitio (rueda puesta)", () => {
  /*
   * Es el caso de carretera. `tc_registrar_reparacion` lo rechazaría —«el
   * neumático está montado»—, así que va por incidencia, como la APK de TC.
   */
  it("con la rueda montada abre incidencia y la resuelve", async () => {
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("COMPLETED");
    if (r.estado !== "COMPLETED") return;
    expect(r.camino).toBe("en_sitio");
    expect(llamadas).toContain("insert:tc_incidencias");
    expect(llamadas).toContain("tc_resolver_incidencia_parcial");
    // Y NO se ha llamado al RPC que rechaza los montados.
    expect(llamadas).not.toContain("tc_registrar_reparacion");
  });

  it("un tipo que exige desmontar no se intenta con la rueda puesta", async () => {
    const r = await ejecutarReparacion({ ...PLAN, tipo: "llanta" });
    expect(r.estado).toBe("FAILED");
    if (r.estado === "FAILED") expect(r.motivo).toContain("desmontar");
    expect(llamadas).toEqual([]);
  });
});

describe("Camino de taller (rueda desmontada)", () => {
  it("con el neumático fuera usa tc_registrar_reparacion", async () => {
    posiciones = posicionMontada("mon-1", "neu-1", "almacen");
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("COMPLETED");
    if (r.estado === "COMPLETED") expect(r.camino).toBe("taller");
    expect(llamadas).toContain("tc_registrar_reparacion");
  });
});

describe("Leer antes de escribir", () => {
  /* ÉSTA es la prueba del apartado 6: alguien movió la rueda mientras tanto. */
  it("si cambió el montaje, NO se repara: conflicto", async () => {
    posiciones = posicionMontada("mon-DISTINTO");
    const r = await ejecutarReparacion({ ...PLAN, montajeEsperado: "mon-1" });
    expect(r.estado).toBe("CONFLICT");
    if (r.estado === "CONFLICT") expect(r.motivo).toContain("ha cambiado la rueda");
    expect(llamadas).toEqual([]);   // no se ha tocado nada
  });

  it("si cambió el neumático, tampoco", async () => {
    posiciones = posicionMontada("mon-1", "neu-OTRO");
    const r = await ejecutarReparacion({ ...PLAN, montajeEsperado: "mon-1", neumaticoEsperado: "neu-1" });
    expect(r.estado).toBe("CONFLICT");
    expect(llamadas).toEqual([]);
  });

  it("si la posición se quedó vacía, conflicto", async () => {
    posiciones = [{ posicionId: "pos-1", codigoPosicion: "E2_IZQ_EXT", eje: 2, ordenVisual: 1,
                    montajeActualId: null, neumatico: null, fechaMontaje: null, kmMontaje: null,
                    ultimaRevision: null }];
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("CONFLICT");
  });

  it("una posición que no existe en el vehículo se rechaza", async () => {
    const r = await ejecutarReparacion({ ...PLAN, posicionCodigo: "NO_EXISTE" });
    expect(r.estado).toBe("FAILED");
    expect(llamadas).toEqual([]);
  });
});

describe("Estados que bloquean", () => {
  it("un neumático descartado no se repara", async () => {
    posiciones = posicionMontada("mon-1", "neu-1", "descartado");
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("FAILED");
    if (r.estado === "FAILED") expect(r.motivo).toContain("descartado");
    expect(llamadas).toEqual([]);
  });

  it("uno que ya está en reparación tampoco", async () => {
    posiciones = posicionMontada("mon-1", "neu-1", "reparacion");
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("FAILED");
    expect(llamadas).toEqual([]);
  });
});

describe("Resultado incierto", () => {
  /*
   * ÉSTA es la prueba del apartado 39: el RPC se ejecutó pero la respuesta se
   * perdió. El siguiente intento no puede reparar otra vez.
   */
  it("si el RPC llegó a ejecutarse, un reintento NO lo repite", async () => {
    // Simula que el intento anterior sí registró la operación.
    operacionesPorIncidencia["inc-previa"] = "op-ya-hecha";
    const r = await ejecutarReparacion({ ...PLAN, incidenciaId: "inc-previa" });

    expect(r.estado).toBe("COMPLETED");
    if (r.estado === "COMPLETED") expect(r.operacionTcId).toBe("op-ya-hecha");
    // Lo importante: no se ha vuelto a llamar al RPC.
    expect(llamadas).not.toContain("tc_resolver_incidencia_parcial");
    expect(llamadas).not.toContain("insert:tc_incidencias");
  });

  /* Y si falla justo después, la evidencia decide en vez del azar. */
  it("un fallo tras ejecutarse se resuelve leyendo la evidencia", async () => {
    fallarRpc = "fetch failed";
    // El RPC «falla» pero la operación ya estaba: es el caso de la respuesta
    // perdida en la red.
    operacionesPorIncidencia["inc-1"] = "op-si-ocurrio";
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("COMPLETED");
    if (r.estado === "COMPLETED") expect(r.operacionTcId).toBe("op-si-ocurrio");
  });

  it("sin evidencia y con fallo transitorio, se reintenta", async () => {
    fallarRpc = "fetch failed";
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("RETRY");
  });

  /*
   * En el camino de taller no hay incidencia con la que demostrar nada, así que
   * ante la duda va a una persona. Dejar algo pendiente es mucho mejor que
   * reparar dos veces.
   */
  it("en taller, un timeout va a revisión manual y NO se reintenta", async () => {
    posiciones = posicionMontada("mon-1", "neu-1", "almacen");
    fallarRpc = "timeout";
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("MANUAL_REVIEW");
    if (r.estado === "MANUAL_REVIEW") expect(r.motivo).toContain("No se sabe");
  });

  it("un error real de TC no se reintenta", async () => {
    fallarRpc = "Sin permiso sobre esta incidencia";
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("FAILED");
  });

  /* Si no se puede ni abrir la incidencia, no se ha tocado nada: se reintenta. */
  it("si no se puede abrir la incidencia, se reintenta sin haber escrito nada", async () => {
    fallarInsert = true;
    const r = await ejecutarReparacion(PLAN);
    expect(r.estado).toBe("RETRY");
    expect(llamadas).not.toContain("tc_resolver_incidencia_parcial");
  });
});
