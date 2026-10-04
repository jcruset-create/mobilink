import { describe, expect, it } from "vitest";
import { construirSistema, contienePrecio, costeEstimado, decidirAtencion, ordenarPorRelevancia, REGLAS_OBLIGATORIAS, sanear } from "./asistente.ts";

describe("Asistente IA · reglas puras", () => {
  it("detecta importes con moneda (para que ningún precio salga de la cabeza del modelo)", () => {
    for (const t of ["Cuesta 45 € al mes", "45€", "unos 30 euros", "EUR 12,50", "€ 9"]) expect(contienePrecio(t), t).toBe(true);
    for (const t of ["Tenemos trasteros de 5 m²", "Llama al 977 000 000", "Consulta la web"]) expect(contienePrecio(t), t).toBe(false);
  });

  it("conocimiento: lo más parecido primero, en castellano y en catalán", () => {
    const e = [
      { id: "1", category: "precio", question: "¿Cuánto cuesta un trastero?", answer: "Depende del tamaño. Consulta la web.", language: "es", priority: 60, centerId: null },
      { id: "2", category: "visitas", question: "¿Puedo visitar el trastero?", answer: "Visita virtual o guiada.", language: "es", priority: 45, centerId: null },
      { id: "3", category: "precio", question: "Quant costa un traster?", answer: "Depèn de la mida.", language: "ca", priority: 60, centerId: null },
    ];
    expect(ordenarPorRelevancia(e, "cuanto cuesta el trastero pequeño")[0].id).toBe("1");
    expect(ordenarPorRelevancia(e, "quiero visitar las instalaciones")[0].id).toBe("2");
    expect(ordenarPorRelevancia(e, "Quant costa?")[0].id).toBe("3");
    expect(ordenarPorRelevancia(e, "zzz")).toEqual([]);
  });

  it("las instrucciones llevan TODAS las reglas obligatorias, el conocimiento y sólo las herramientas activas", () => {
    const s = construirSistema({
      marca: "Marca X",
      web: "https://x.example",
      calculadora: null,
      contratacion: null,
      visitaVirtual: null,
      centro: { name: "Centro", city: "Ciudad" },
      idiomas: ["es", "ca"],
      reglasExtra: ["Regla propia"],
      conocimiento: [{ category: "precio", question: "¿Precio?", answer: "En la web." }],
      herramientas: [{ nombre: "consultar_disponibilidad", descripcion: "d", parametros: "{}", riesgo: "READ_ONLY" }],
      escaladoHumano: true,
    });
    for (const r of REGLAS_OBLIGATORIAS) expect(s).toContain(r);
    expect(s).toContain("Regla propia");
    expect(s).toContain("consultar_disponibilidad");
    expect(s).toContain("https://x.example");
    expect(s).not.toContain("TLC");
  });

  it("sanea teléfonos y emails en el registro de herramientas", () => {
    expect(JSON.stringify(sanear({ telefono: "+34600555444", email: "ana.perez@example.com", n: 3 }))).not.toMatch(/600555444|ana\.perez/);
  });

  it("enrutado: sin IA activa o sin proveedor, siempre una persona", () => {
    expect(decidirAtencion("ai", true, true)).toBe("ai");
    expect(decidirAtencion("hybrid", true, true)).toBe("hybrid");
    expect(decidirAtencion("ai", false, true)).toBe("human");
    expect(decidirAtencion("hybrid", true, false)).toBe("human");
    expect(decidirAtencion("human", true, true)).toBe("human");
  });

  it("coste: sólo si hay precios configurados (no se inventa)", () => {
    expect(costeEstimado(1_000_000, 0, null, null)).toBeNull();
    expect(costeEstimado(1_000_000, 500_000, 1, 4)).toBe(3);
  });
});
