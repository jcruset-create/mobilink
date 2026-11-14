import { describe, expect, it } from "vitest";

import {
  codigoMaterial,
  emailValido,
  ErrorMaterial,
  limpiarChecklist,
  limpiarMaterial,
  ordenarTrabajosEnBase,
  plazaDe,
  resultadoChecklist,
  telefonoValido,
  textoMaterial,
} from "./mejoras.ts";

describe("orden de los trabajos en la base", () => {
  it("lee la plaza de las observaciones", () => {
    expect(plazaDe("remolque en plaza 27")).toBe(27);
    expect(plazaDe("Pl. 3, junto a la garita")).toBe(3);
    expect(plazaDe("Plaza nº 12")).toBe(12);
    expect(plazaDe("al fondo a la derecha")).toBeNull();
    expect(plazaDe(null)).toBeNull();
  });

  it("a medias primero, luego pendientes por plaza, sin plaza al final, y lo hecho abajo", () => {
    const t = [
      { id: 1, status: "pendiente", observaciones: "plaza 30" },
      { id: 2, status: "finalizado", observaciones: "plaza 1" },
      { id: 3, status: "pendiente", observaciones: null },
      { id: 4, status: "en_proceso", observaciones: "plaza 50" },
      { id: 5, status: "pendiente", observaciones: "plaza 4" },
      { id: 6, status: "no_realizado", observaciones: null },
    ];
    expect(ordenarTrabajosEnBase(t).map((x) => x.id)).toEqual([4, 5, 1, 3, 2, 6]);
  });
});

describe("lista de comprobación", () => {
  it("una línea por punto, sin vacíos ni repetidos", () => {
    expect(limpiarChecklist("Presiones\n\n  Par de apriete \npresiones\nProfundidad de dibujo")).toEqual([
      "Presiones",
      "Par de apriete",
      "Profundidad de dibujo",
    ]);
  });

  it("de la tablet se quedan solo los puntos de la plantilla, en su orden", () => {
    const r = resultadoChecklist(["Presiones", "Par de apriete"], [
      { texto: "Par de apriete", hecho: true },
      { texto: "Presiones", hecho: true, valor: " 8,5 bar " },
      { texto: "Algo inventado", hecho: true },
    ]);
    expect(r).toEqual([
      { texto: "Presiones", hecho: true, valor: "8,5 bar" },
      { texto: "Par de apriete", hecho: true, valor: null },
    ]);
  });

  it("lo que no llega cuenta como no hecho", () => {
    expect(resultadoChecklist(["Presiones"], undefined)).toEqual([{ texto: "Presiones", hecho: false, valor: null }]);
  });
});

describe("material usado", () => {
  it("un neumático: medida en mayúsculas, nuevo por defecto", () => {
    const m = limpiarMaterial({ medida: "385/65r22.5", marca: "Continental", cantidad: 2 });
    expect(m).toEqual({ tipo: "neumatico", descripcion: "385/65R22.5", marca: "Continental", estado: "nuevo", cantidad: 2 });
    expect(codigoMaterial(m)).toBe("NEUMATICO 385/65R22.5 NUEVO");
    expect(textoMaterial(m)).toBe("2 × 385/65R22.5 Continental (nuevo)");
  });

  it("sin medida o con cantidades raras, no", () => {
    expect(() => limpiarMaterial({ medida: "  " })).toThrow(ErrorMaterial);
    expect(() => limpiarMaterial({ medida: "315/70R22.5", cantidad: 0 })).toThrow(ErrorMaterial);
    expect(() => limpiarMaterial({ medida: "315/70R22.5", cantidad: 500 })).toThrow(ErrorMaterial);
  });

  it("otro material no lleva nuevo/usado salvo que se diga", () => {
    const m = limpiarMaterial({ tipo: "otro", descripcion: "válvula", cantidad: 4 });
    expect(m.estado).toBeNull();
    expect(codigoMaterial(m)).toBe("MATERIAL VÁLVULA");
  });
});

describe("contactos", () => {
  it("correo y teléfono", () => {
    expect(emailValido(" jordi@base.es ")).toBe("jordi@base.es");
    expect(emailValido("jordi@")).toBeNull();
    expect(telefonoValido("+34 600 11 22 33")).toBe("+34 600 11 22 33");
    expect(telefonoValido("123")).toBeNull();
  });
});
