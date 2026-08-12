import { describe, it, expect } from "vitest";
import { normalizarMatricula, normalizarVehiculo, descripcionVehiculo } from "./vehicle.ts";

describe("ficha del vehículo", () => {
  it("la matrícula queda siempre igual escrita", () => {
    // Si no, la misma matrícula tecleada de dos formas no cruza con el
    // histórico del taller, que la guarda en mayúsculas y sin separadores.
    expect(normalizarMatricula(" 1234 abc ")).toBe("1234ABC");
    expect(normalizarMatricula("1234-ABC")).toBe("1234ABC");
    expect(normalizarMatricula("b-1234-cd")).toBe("B1234CD");
  });

  it("una matrícula vacía es null, no cadena vacía", () => {
    expect(normalizarMatricula("")).toBeNull();
    expect(normalizarMatricula("   ")).toBeNull();
    expect(normalizarMatricula(null)).toBeNull();
  });

  it("conserva el tipo cuando el formulario no lo manda", () => {
    const v = normalizarVehiculo({ type: "truck" }, { plate: "1234ABC" });
    expect(v.type).toBe("truck");
  });

  it("sin tipo previo ni nuevo, turismo", () => {
    expect(normalizarVehiculo({}, {}).type).toBe("car");
  });

  it("permite borrar un dato mal metido", () => {
    const v = normalizarVehiculo({ make: "Renaul", model: "Kangoo" }, { make: "", model: "Kangoo" });
    expect(v.make).toBeNull();
    expect(v.model).toBe("Kangoo");
  });

  it("no pisa las claves ajenas a la ficha", () => {
    // Otro proceso puede haber dejado datos suyos en el mismo JSON; borrarlos
    // al guardar la matrícula seria un efecto colateral silencioso.
    const v = normalizarVehiculo({ externalId: "ABC-9" } as any, { plate: "1234ABC" });
    expect((v as any).externalId).toBe("ABC-9");
  });

  it("los interruptores siempre son booleanos", () => {
    const v = normalizarVehiculo({}, { trailer: undefined, dangerousGoods: true });
    expect(v.trailer).toBe(false);
    expect(v.dangerousGoods).toBe(true);
  });

  it("recorta los campos largos en vez de reventar la base", () => {
    const v = normalizarVehiculo({}, { cargo: "x".repeat(500) });
    expect(v.cargo).toHaveLength(120);
  });

  it("el VIN va en mayúsculas", () => {
    expect(normalizarVehiculo({}, { vin: " vf1abc123 " }).vin).toBe("VF1ABC123");
  });

  it("la descripción para el core junta marca y modelo", () => {
    expect(descripcionVehiculo({ make: "Renault", model: "Kangoo" })).toBe("Renault Kangoo");
    expect(descripcionVehiculo({ make: "Renault" })).toBe("Renault");
    expect(descripcionVehiculo({})).toBeNull();
  });
});
