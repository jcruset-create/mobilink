import { describe, expect, it } from "vitest";
import { accesosAPayload, estadoInicialAccesos } from "./accesosModulos";
import { MODULOS_APP } from "../config/modulosApp";

const CORE = MODULOS_APP.find((m) => m.key === "sea-core")!;

describe("accesosAPayload", () => {
  it("sin módulos marcados no da ningún acceso", () => {
    expect(accesosAPayload(estadoInicialAccesos())).toEqual([]);
  });

  it("con todas las pantallas marcadas guarda null (= todas)", () => {
    const estado = estadoInicialAccesos();
    estado["sea-core"] = { ...estado["sea-core"], activo: true };
    expect(accesosAPayload(estado)).toEqual([
      { modulo: "sea-core", rol: CORE.roles[0].value, pantallas: null, empresa_id: null },
    ]);
  });

  it("con alguna desmarcada guarda solo las marcadas", () => {
    const estado = estadoInicialAccesos();
    const [primera] = CORE.pantallas;
    estado["sea-core"] = {
      ...estado["sea-core"],
      activo: true,
      marcadas: { ...estado["sea-core"].marcadas, [primera.key]: false },
    };
    const [acceso] = accesosAPayload(estado);
    expect(acceso.pantallas).toEqual(CORE.pantallas.slice(1).map((p) => p.key));
  });

  it("solo guarda empresa en TyreControl y con rol cliente", () => {
    const estado = estadoInicialAccesos();
    estado.tyrecontrol = { ...estado.tyrecontrol, activo: true, rol: "operador", empresa_id: "e1" };
    expect(accesosAPayload(estado)[0].empresa_id).toBeNull();
    estado.tyrecontrol = { ...estado.tyrecontrol, rol: "cliente" };
    expect(accesosAPayload(estado)[0].empresa_id).toBe("e1");
  });

  it("parte de los accesos ya guardados", () => {
    const estado = estadoInicialAccesos([
      { modulo: "almacen", rol: "responsable", pantallas: ["stock"], empresa_id: null },
    ]);
    expect(estado.almacen.activo).toBe(true);
    expect(estado.almacen.rol).toBe("responsable");
    expect(accesosAPayload(estado)).toEqual([
      { modulo: "almacen", rol: "responsable", pantallas: ["stock"], empresa_id: null },
    ]);
  });
});
