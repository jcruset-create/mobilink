/**
 * La columna «Telemática».
 *
 * Lo que se fija: que un proveedor nuevo aparezca solo, que el enlace antiguo
 * de Webfleet cuente igual que uno del Hub, y que «sin telemática» se diga con
 * esas palabras en vez de con el nombre del proveedor que había primero.
 */

import { describe, expect, it } from "vitest";
import {
  conectoresDe,
  etiquetaTelematica,
  nombreConector,
  porVehiculo,
  type EnlaceTelematica,
} from "./telematicaVehiculo";
import type { Vehiculo } from "../types";

function veh(id: string, over: Partial<Vehiculo> = {}): Vehiculo {
  return { id, matricula: `M-${id}`, activo: true, km_actual: 0, origen_km: "manual", ...over } as Vehiculo;
}

function enlace(vehiculoId: string, connectorKey: string, accountKey = "default"): EnlaceTelematica {
  return { empresaId: "e1", vehiculoId, connectorKey, accountKey };
}

describe("nombreConector()", () => {
  it("los conocidos, con su nombre", () => {
    expect(nombreConector("movertis")).toBe("Movertis");
    expect(nombreConector("webfleet")).toBe("Webfleet");
  });

  it("uno que todavía no conocemos sale capitalizado, no en blanco", () => {
    // Es lo que hace que un conector nuevo aparezca sin tocar el panel.
    expect(nombreConector("geotab")).toBe("Geotab");
    expect(nombreConector("samsara")).toBe("Samsara");
  });

  it("no se rompe con basura", () => {
    expect(nombreConector("")).toBe("—");
    expect(nombreConector("   ")).toBe("—");
  });
});

describe("conectoresDe()", () => {
  it("el enlace del Hub manda", () => {
    const m = porVehiculo([enlace("v1", "movertis")]);
    expect(conectoresDe(veh("v1"), m)).toEqual(["movertis"]);
  });

  it("el enlace ANTIGUO de Webfleet cuenta aunque no haya fila en el Hub", () => {
    const m = porVehiculo([]);
    expect(conectoresDe(veh("v1", { webfleet_vehicle_id: "12345" }), m)).toEqual(["webfleet"]);
  });

  it("un vehículo con las dos telemáticas las enseña las dos", () => {
    const m = porVehiculo([enlace("v1", "movertis")]);
    expect(conectoresDe(veh("v1", { webfleet_vehicle_id: "12345" }), m)).toEqual(["movertis", "webfleet"]);
  });

  it("no duplica cuando el Webfleet antiguo y el del Hub son el mismo", () => {
    const m = porVehiculo([enlace("v1", "webfleet")]);
    expect(conectoresDe(veh("v1", { webfleet_vehicle_id: "12345" }), m)).toEqual(["webfleet"]);
  });

  it("un id de Webfleet en blanco no cuenta como telemática", () => {
    const m = porVehiculo([]);
    expect(conectoresDe(veh("v1", { webfleet_vehicle_id: "   " }), m)).toEqual([]);
    expect(conectoresDe(veh("v1", { webfleet_vehicle_id: null }), m)).toEqual([]);
  });

  it("el orden es estable: la base no garantiza ninguno", () => {
    const m = porVehiculo([enlace("v1", "webfleet"), enlace("v1", "movertis")]);
    expect(conectoresDe(veh("v1"), m)).toEqual(["movertis", "webfleet"]);
  });

  it("los enlaces de otro vehículo no se le cuelgan a este", () => {
    const m = porVehiculo([enlace("v2", "movertis")]);
    expect(conectoresDe(veh("v1"), m)).toEqual([]);
  });
});

describe("porVehiculo()", () => {
  it("agrupa y no repite el mismo conector de dos cuentas", () => {
    // Un cliente puede tener dos cuentas del mismo proveedor; en la columna
    // sigue siendo un proveedor.
    const m = porVehiculo([enlace("v1", "movertis", "buses"), enlace("v1", "movertis", "auxiliar")]);
    expect(m.get("v1")).toEqual(["movertis"]);
  });

  it("descarta filas sin vehículo o sin conector", () => {
    const m = porVehiculo([enlace("", "movertis"), enlace("v1", "")]);
    expect(m.size).toBe(0);
  });
});

describe("etiquetaTelematica()", () => {
  it("sin ninguna lo dice con esas palabras", () => {
    // «Sin Webfleet» era mentira para un autobús que lleva Movertis.
    expect(etiquetaTelematica([])).toBe("Sin telemática");
  });

  it("una, con su nombre; dos, separadas", () => {
    expect(etiquetaTelematica(["movertis"])).toBe("Movertis");
    expect(etiquetaTelematica(["movertis", "webfleet"])).toBe("Movertis · Webfleet");
  });
});
