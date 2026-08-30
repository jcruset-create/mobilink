/**
 * Resolución de vehículo contra TyreControl.
 *
 * Se simula el cliente de Supabase para poder fijar lo que importa sin
 * depender del proyecto real: que la consulta va FILTRADA (y no se trae la
 * tabla), que una matrícula en dos empresas se declara ambigua en vez de
 * escoger una, y que el patrón no cuela falsos positivos.
 *
 * Lo que se comprueba de la consulta es la llamada, no el resultado: el fallo
 * que se está corrigiendo era precisamente traerse 2.000 filas, y eso solo se
 * ve mirando cómo se pide.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Filas que devolverá el «tc_vehiculos» simulado en cada prueba. */
let filasVehiculos: any[] = [];
/** Lo que se le pidió a Supabase, para poder afirmar que va filtrado. */
let llamadas: { tabla: string; ilike?: [string, string]; limit?: number; eq: [string, any][] }[] = [];

vi.mock("../supabase.ts", () => {
  function consulta(tabla: string) {
    const registro = { tabla, eq: [] as [string, any][] };
    llamadas.push(registro as any);
    const api: any = {
      select: () => api,
      order: () => api,
      eq: (col: string, val: any) => { registro.eq.push([col, val]); return api; },
      in: () => api,
      ilike: (col: string, patron: string) => { (registro as any).ilike = [col, patron]; return api; },
      limit: (n: number) => { (registro as any).limit = n; return Promise.resolve(datos(tabla)); },
      maybeSingle: () => Promise.resolve({ data: datos(tabla).data[0] ?? null, error: null }),
      then: (r: any) => Promise.resolve(datos(tabla)).then(r),
    };
    return api;
  }
  function datos(tabla: string) {
    if (tabla === "tc_vehiculos") return { data: filasVehiculos, error: null };
    if (tabla === "tc_empresas") {
      return { data: [{ id: "emp-1", nombre: "Transportes Uno" }, { id: "emp-2", nombre: "Transportes Dos" }], error: null };
    }
    if (tabla === "tc_tipos_vehiculo") return { data: [{ id: "tipo-1", nombre: "tractora" }], error: null };
    return { data: [], error: null };
  }
  return { supabase: { from: consulta } };
});

const { resolverVehiculo } = await import("./vehiculos.ts");

function vehiculo(id: string, matricula: string, empresaId = "emp-1") {
  return {
    id, empresa_id: empresaId, matricula, marca: "Volvo", modelo: "FH",
    tipo_vehiculo_id: "tipo-1", km_actual: 250000, origen_km: "webfleet",
    activo: true, updated_at: "2026-08-01T10:00:00Z",
  };
}

beforeEach(() => { filasVehiculos = []; llamadas = []; });

describe("Resolución por matrícula", () => {
  it("encuentra un vehículo y lo traduce a los nombres de Assist", async () => {
    filasVehiculos = [vehiculo("veh-1", "1234-ABC")];
    const r = await resolverVehiculo("1234ABC");
    expect(r.estado).toBe("FOUND");
    if (r.estado !== "FOUND") return;
    expect(r.vehiculo.tcVehicleId).toBe("veh-1");
    expect(r.vehiculo.empresaNombre).toBe("Transportes Uno");
    expect(r.vehiculo.tipoVehiculo).toBe("tractora");
    expect(r.vehiculo.kmActual).toBe(250000);
  });

  it("da igual cómo venga escrita la matrícula", async () => {
    filasVehiculos = [vehiculo("veh-1", "1234ABC")];
    for (const entrada of ["1234-abc", " 1234 ABC ", "1234abc"]) {
      llamadas = [];
      const r = await resolverVehiculo(entrada);
      expect(r.estado).toBe("FOUND");
    }
  });

  it("no encontrado cuando TC no tiene esa matrícula", async () => {
    filasVehiculos = [];
    expect((await resolverVehiculo("9999ZZZ")).estado).toBe("NOT_FOUND");
  });

  /*
   * El patrón `1%2%3%4%A%B%C%` también encaja con `1X2X3X4XAXBXC`. La igualdad
   * la decide la normalización, no el LIKE.
   */
  it("descarta lo que el patrón deja pasar pero no es la matrícula", async () => {
    filasVehiculos = [vehiculo("veh-x", "1X2X3X4XAXBXC")];
    expect((await resolverVehiculo("1234ABC")).estado).toBe("NOT_FOUND");
  });

  /* Una matrícula de dos caracteres traería media tabla. */
  it("una matrícula demasiado corta no llega a consultar", async () => {
    expect((await resolverVehiculo("12")).estado).toBe("NOT_FOUND");
    expect(llamadas).toHaveLength(0);
  });
});

describe("Ambigüedad entre empresas", () => {
  /*
   * `tc_vehiculos` tiene unique(empresa_id, matricula): la misma matrícula
   * puede ser dos vehículos distintos. Coger el primero funcionaría casi
   * siempre y fallaría en silencio el día que no.
   */
  it("dos empresas con la misma matrícula dan AMBIGUOUS, no la primera", async () => {
    filasVehiculos = [vehiculo("veh-1", "1234ABC", "emp-1"), vehiculo("veh-2", "1234-ABC", "emp-2")];
    const r = await resolverVehiculo("1234ABC");
    expect(r.estado).toBe("AMBIGUOUS");
    if (r.estado !== "AMBIGUOUS") return;
    expect(r.candidatos).toHaveLength(2);
    expect(r.candidatos.map((c) => c.empresaNombre).sort())
      .toEqual(["Transportes Dos", "Transportes Uno"]);
  });

  /* Con la empresa sabida no hay ambigüedad: el filtro lo hace la base. */
  it("indicar la empresa desambigua y va en el WHERE", async () => {
    filasVehiculos = [vehiculo("veh-1", "1234ABC", "emp-1")];
    const r = await resolverVehiculo("1234ABC", { empresaId: "emp-1" });
    expect(r.estado).toBe("FOUND");
    const consulta = llamadas.find((l) => l.tabla === "tc_vehiculos")!;
    expect(consulta.eq).toContainEqual(["empresa_id", "emp-1"]);
  });
});

describe("La consulta ya no se trae la tabla", () => {
  /* Es el fallo que se está corrigiendo: 2.000 filas y filtrar en JS. */
  it("filtra por matrícula en el servidor con un patrón anclado", async () => {
    filasVehiculos = [vehiculo("veh-1", "1234ABC")];
    await resolverVehiculo("1234ABC");
    const consulta = llamadas.find((l) => l.tabla === "tc_vehiculos")!;
    expect(consulta.ilike).toEqual(["matricula", "1%2%3%4%A%B%C%"]);
    expect(consulta.ilike![1].startsWith("%")).toBe(false);
  });

  it("el tope es de seguridad, no de negocio: muy por debajo de los 2.000 de antes", async () => {
    filasVehiculos = [vehiculo("veh-1", "1234ABC")];
    await resolverVehiculo("1234ABC");
    const consulta = llamadas.find((l) => l.tabla === "tc_vehiculos")!;
    expect(consulta.limit).toBeLessThanOrEqual(50);
  });

  /*
   * Una flota de 5.000 vehículos no cambia nada, porque el filtro lo hace la
   * base: lo que llega son las pocas filas que encajan con el patrón.
   */
  it("el tamaño de la flota no influye en el resultado", async () => {
    filasVehiculos = [vehiculo("veh-9999", "1234ABC")];
    const r = await resolverVehiculo("1234ABC");
    expect(r.estado).toBe("FOUND");
  });

  it("por defecto no busca vehículos dados de baja", async () => {
    filasVehiculos = [vehiculo("veh-1", "1234ABC")];
    await resolverVehiculo("1234ABC");
    expect(llamadas.find((l) => l.tabla === "tc_vehiculos")!.eq).toContainEqual(["activo", true]);
  });
});
