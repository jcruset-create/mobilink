/**
 * Tests del conector de histórico propio.
 *
 * Lo importante aquí es que NO invente: si Mobilink no sabe nada de esa matrícula,
 * debe devolver vacío en lugar de un vehículo plausible.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let asistencias: any[] = [];
let trabajos: any[] = [];
/** SQL recibido, para comprobar contra qué tablas se consulta. */
let consultas: string[] = [];

vi.mock("../../../../db.ts", () => ({
  default: {
    query: async (sql: string, params: any[] = []) => {
      consultas.push(sql);
      if (sql.includes("COUNT(*)")) return { rows: [{ n: asistencias.length }] };
      if (sql.includes("otf_trabajos")) return { rows: trabajos };
      if (sql.includes("roadside_assistances")) {
        const [plate, vin] = params;
        return {
          rows: asistencias.filter(
            (a) => (plate && a._plateNorm === plate) || (vin && (a.vin ?? "").toUpperCase() === vin)
          ),
        };
      }
      return { rows: [] };
    },
  },
}));

const { MobilinkHistoricoConnector, normalizarMatricula } = await import("./MobilinkHistoricoConnector.ts");

const CTX = { tenantId: "default", correlationId: "COR-1" };

beforeEach(() => {
  asistencias = [];
  trabajos = [];
  consultas = [];
});

describe("normalizarMatricula", () => {
  it("iguala matrículas escritas con guiones, espacios o minúsculas", () => {
    expect(normalizarMatricula("1234-abc")).toBe("1234ABC");
    expect(normalizarMatricula("1234 ABC")).toBe("1234ABC");
    expect(normalizarMatricula(" 1234abc ")).toBe("1234ABC");
  });
});

describe("MobilinkHistoricoConnector.identifyVehicle", () => {
  it("identifica el vehículo con los datos de asistencias previas", async () => {
    asistencias = [
      {
        _plateNorm: "1234ABC",
        plate: "1234-ABC",
        marca: "Volvo",
        modelo: "FH16",
        vin: null,
        tipoVehiculo: "Tractora",
        medidaNeumatico: "315/70 R22.5",
        descripcion: null,
        vistoMs: 1000,
      },
    ];

    const bc = new MobilinkHistoricoConnector();
    const [v] = await bc.identifyVehicle(CTX, { plate: "1234 abc" });

    expect(v.make).toBe("Volvo");
    expect(v.model).toBe("FH16");
    expect(v.confidence).toBe("medium");
    expect(v.source).toBe("mobilink-historico");
  });

  it("da confianza alta cuando hay VIN", async () => {
    asistencias = [
      {
        _plateNorm: "1234ABC",
        plate: "1234ABC",
        marca: "Scania",
        modelo: "R450",
        vin: "YS2R4X20001234567",
        tipoVehiculo: null,
        medidaNeumatico: null,
        descripcion: null,
        vistoMs: 1,
      },
    ];

    const [v] = await new MobilinkHistoricoConnector().identifyVehicle(CTX, { plate: "1234ABC" });

    expect(v.confidence).toBe("high");
    expect(v.vin).toBe("YS2R4X20001234567");
  });

  it("no inventa nada si la matrícula es desconocida", async () => {
    const resultado = await new MobilinkHistoricoConnector().identifyVehicle(CTX, { plate: "0000ZZZ" });

    expect(resultado).toEqual([]);
  });

  it("completa campos vacíos con asistencias anteriores sin pisar los recientes", async () => {
    asistencias = [
      // Más reciente, pero sin marca ni modelo.
      { _plateNorm: "1234ABC", plate: "1234ABC", marca: null, modelo: null, vin: null, tipoVehiculo: "Tractora", medidaNeumatico: null, descripcion: null, vistoMs: 2000 },
      // Anterior, con los datos buenos.
      { _plateNorm: "1234ABC", plate: "1234ABC", marca: "MAN", modelo: "TGX", vin: null, tipoVehiculo: null, medidaNeumatico: "385/65 R22.5", descripcion: null, vistoMs: 1000 },
    ];

    const [v] = await new MobilinkHistoricoConnector().identifyVehicle(CTX, { plate: "1234ABC" });

    expect(v.make).toBe("MAN");
    expect(v.model).toBe("TGX");
    expect(v.variant).toBe("Tractora");
  });

  it("recurre a las órdenes de trabajo cuando no hay asistencias", async () => {
    trabajos = [{ tipoVehiculo: "Remolque", vistoMs: 500 }];

    const [v] = await new MobilinkHistoricoConnector().identifyVehicle(CTX, { plate: "5678DEF" });

    expect(v.variant).toBe("Remolque");
    expect(v.confidence).toBe("low");
  });

  it("descarta registros más antiguos que el límite configurado", async () => {
    asistencias = [
      {
        _plateNorm: "1234ABC",
        plate: "1234ABC",
        marca: "Iveco",
        modelo: "Stralis",
        vin: null,
        tipoVehiculo: null,
        medidaNeumatico: null,
        descripcion: null,
        vistoMs: Date.now() - 400 * 24 * 60 * 60 * 1000, // 400 días
      },
    ];

    const bc = new MobilinkHistoricoConnector({ maxAntiguedadDias: 365 });
    const resultado = await bc.identifyVehicle(CTX, { plate: "1234ABC" });

    expect(resultado).toEqual([]);
  });
});

describe("MobilinkHistoricoConnector.getTyreSpecifications", () => {
  it("devuelve la medida observada en asistencias previas", async () => {
    asistencias = [
      { _plateNorm: "1234ABC", plate: "1234ABC", marca: null, modelo: null, vin: null, tipoVehiculo: null, medidaNeumatico: "315/70 R22.5", descripcion: null, vistoMs: 1 },
    ];

    const specs = await new MobilinkHistoricoConnector().getTyreSpecifications(CTX, "MOBILINK:1234ABC");

    expect(specs.map((s) => s.size)).toEqual(["315/70 R22.5", "315/70 R22.5"]);
    expect(specs.map((s) => s.axle)).toEqual(["front", "rear"]);
  });

  it("no inventa medida si no hay ninguna registrada", async () => {
    const specs = await new MobilinkHistoricoConnector().getTyreSpecifications(CTX, "MOBILINK:9999XXX");

    expect(specs).toEqual([]);
  });
});
