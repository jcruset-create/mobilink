import { describe, it, expect } from "vitest";
import { codigoDeUso, opcionesConElegido } from "./usos";

describe("el código de un uso nuevo", () => {
  it("sale del nombre, en minúsculas y sin tildes", () => {
    // Con tilde, una consulta escrita sin ella dejaría de encontrarlo.
    expect(codigoDeUso("Dirección")).toBe("direccion");
  });
  it("los espacios se vuelven guión bajo", () => {
    expect(codigoDeUso("Larga distancia")).toBe("larga_distancia");
  });
  it("aguanta barras, guiones y signos", () => {
    expect(codigoDeUso("Mixto carretera / obra")).toBe("mixto_carretera_obra");
    expect(codigoDeUso("  Urbano — reparto  ")).toBe("urbano_reparto");
  });
  it("dos nombres que solo difieren en tildes o mayúsculas dan el MISMO código", () => {
    // Es lo que evita «Regional» y «regional» como dos entradas distintas.
    expect(codigoDeUso("REGIONAL")).toBe(codigoDeUso("regional"));
    expect(codigoDeUso("Dirección")).toBe(codigoDeUso("direccion"));
  });
  it("un nombre sin letras ni números no da código: hay que rechazarlo", () => {
    expect(codigoDeUso("   ")).toBe("");
    expect(codigoDeUso("///")).toBe("");
  });
});

describe("las opciones del desplegable", () => {
  const marcas = ["Bridgestone", "Continental", "Michelin"];

  it("sin nada elegido, la lista tal cual", () => {
    expect(opcionesConElegido(marcas, "").map((o) => o.valor)).toEqual(marcas);
  });

  it("lo que viene de «Sin catalogar» y NO está en el catálogo se ve, y marcado", () => {
    const r = opcionesConElegido(marcas, "Sailun");
    expect(r[0]).toEqual({ valor: "Sailun", etiqueta: "Sailun (nuevo)" });
    expect(r.length).toBe(4);
  });

  it("si ya está en la lista no se duplica", () => {
    expect(opcionesConElegido(marcas, "Michelin").length).toBe(3);
  });

  it("y no se duplica aunque venga en otras mayúsculas", () => {
    // Si se duplicara, el desplegable enseñaría «MICHELIN (nuevo)» encima de
    // «Michelin» y se crearía la marca dos veces.
    expect(opcionesConElegido(marcas, "MICHELIN").length).toBe(3);
  });

  it("con la lista vacía, lo elegido sigue estando", () => {
    // Pasa de verdad: si falla la consulta de catálogos, el formulario tiene
    // que seguir sirviendo con lo que traía.
    expect(opcionesConElegido([], "315/80R22.5").map((o) => o.valor)).toEqual(["315/80R22.5"]);
  });
});
