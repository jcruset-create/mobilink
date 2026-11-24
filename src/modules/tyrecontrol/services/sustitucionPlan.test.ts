import { describe, expect, it } from "vitest";

import {
  asignarMontar, faltanPorElegir, mismaMedidaBase, nuevasQueQuedan, siguienteSinMontar, sugerirDestino,
  textoChip, usadaCogidaPor, type SustitucionPlan,
} from "./sustitucionPlan";

const vacio = (): Record<string, SustitucionPlan> => ({
  a: { destino: "almacen", montar: null },
  b: { destino: "pendiente_reciclaje", montar: null },
});

describe("sugerirDestino", () => {
  it("cerca del mínimo va a la papelera; si le queda, al almacén", () => {
    expect(sugerirDestino(3.6, 3)).toBe("pendiente_reciclaje");
    expect(sugerirDestino(4, 3)).toBe("pendiente_reciclaje");
    expect(sugerirDestino(5.2, 3)).toBe("almacen");
  });
  it("sin mm, al almacén; sin mínimo, se usa 3 mm", () => {
    expect(sugerirDestino(null, 3)).toBe("almacen");
    expect(sugerirDestino(3.9, null)).toBe("pendiente_reciclaje");
    expect(sugerirDestino(4.5, null)).toBe("almacen");
  });
});

describe("asignar lo que se monta", () => {
  it("una nueva puede ir a todas y descuenta una unidad por rueda", () => {
    const p = asignarMontar(vacio(), ["a", "b"], { tipo: "nuevo", productoId: "h", nombre: "Hankook AH51" });
    expect(p.a.montar?.tipo).toBe("nuevo");
    expect(p.b.montar?.tipo).toBe("nuevo");
    expect(nuevasQueQuedan(94, p, "h")).toBe(92);
    expect(nuevasQueQuedan(94, p, "otro")).toBe(94);
  });

  it("una usada va solo a una rueda y se le quita a la que la tuviera", () => {
    let p = asignarMontar(vacio(), ["a", "b"], { tipo: "usado", neumaticoId: "u1", nombre: "NT-1", mm: 15 });
    expect(p.a.montar?.tipo).toBe("usado");
    expect(p.b.montar).toBeNull();
    p = asignarMontar(p, ["b"], { tipo: "usado", neumaticoId: "u1", nombre: "NT-1", mm: 15 });
    expect(p.a.montar).toBeNull();
    expect(usadaCogidaPor(p, "u1")).toBe("b");
    expect(usadaCogidaPor(p, "u1", "b")).toBeNull();
  });

  it("avanza a la siguiente rueda sin elegir y dice cuáles faltan", () => {
    const p = asignarMontar(vacio(), ["a"], { tipo: "usado", neumaticoId: "u1", nombre: "NT-1", mm: 15 });
    expect(siguienteSinMontar(["a", "b"], p, "a")).toBe("b");
    expect(siguienteSinMontar(["a", "b"], p, "b")).toBe("b");
    expect(faltanPorElegir(p)).toEqual(["b"]);
  });
});

describe("textos", () => {
  it("la medida se compara sin índices", () => {
    expect(mismaMedidaBase("295/80R22.5 154/149M", "295/80 R22.5")).toBe(true);
    expect(mismaMedidaBase("295/80R22.5", "315/80R22.5")).toBe(false);
    expect(mismaMedidaBase(null, "295/80R22.5")).toBe(false);
  });
  it("el chip dice qué entra y a dónde va la vieja", () => {
    expect(textoChip("E2IE", { destino: "almacen", montar: { tipo: "nuevo", productoId: "h", nombre: "Hankook AH51" } }))
      .toBe("♻ E2IE → nueva Hankook AH51 · vieja a almacén de usados");
    expect(textoChip("E2DI", { destino: "pendiente_reciclaje", montar: null })).toContain("falta elegir");
  });
});
