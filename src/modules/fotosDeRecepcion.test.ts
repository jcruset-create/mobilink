import { describe, expect, it } from "vitest";
import { etiquetaDeFoto, fotosOrdenadas, tipoDeFotoRecepcion } from "./fotosDeRecepcion";

describe("tipoDeFotoRecepcion", () => {
  it("acepta los tres tipos y lo demás es estado", () => {
    expect(tipoDeFotoRecepcion("matricula")).toBe("matricula");
    expect(tipoDeFotoRecepcion(" Kilometros ")).toBe("kilometros");
    expect(tipoDeFotoRecepcion("estado")).toBe("estado");
    expect(tipoDeFotoRecepcion(undefined)).toBe("estado");
    expect(tipoDeFotoRecepcion("daños")).toBe("estado");
  });
});

describe("fotosOrdenadas", () => {
  it("matrícula, kilómetros y luego el resto; sin URL no entra", () => {
    const f = fotosOrdenadas([
      { url: "c", tipo: null },
      { url: "", tipo: "matricula" },
      { url: "b", tipo: "kilometros" },
      { url: "d" },
      { url: "a", tipo: "matricula" },
    ]);
    expect(f.map((x) => x.url)).toEqual(["a", "b", "c", "d"]);
    expect(f.map(etiquetaDeFoto)).toEqual(["Matrícula", "Kilómetros", "Estado del vehículo", "Estado del vehículo"]);
  });
});
