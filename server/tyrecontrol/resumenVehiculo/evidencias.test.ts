/**
 * Evidencias: lo que el modelo cita solo vale si el servidor lo reconoce.
 */
import { describe, expect, it } from "vitest";
import { resolver } from "./evidencias.ts";
import type { Ref } from "./datos.ts";

const VEHICULO = "33333333-3333-4333-8333-333333333333";
const IV = "44444444-4444-4444-8444-444444444444";
const OP = "55555555-5555-4555-8555-555555555555";
const NM = "66666666-6666-4666-8666-666666666666";
const IN = "77777777-7777-4777-8777-777777777777";

const refs = new Map<string, Ref>([
  ["VH1", { ref: "VH1", tipo: "vehiculo", id: VEHICULO, etiqueta: "Ficha de 1234 ABC" }],
  ["IV2", { ref: "IV2", tipo: "intervencion", id: IV, etiqueta: "Intervención 100" }],
  ["OP3", { ref: "OP3", tipo: "operacion", id: OP, etiqueta: "Montaje del 2026-10-01" }],
  ["NM4", { ref: "NM4", tipo: "neumatico", id: NM, etiqueta: "Neumático Michelin" }],
  ["IN5", { ref: "IN5", tipo: "incidencia", id: IN, etiqueta: "Incidencia alta del 2026-10-02" }],
  ["MT6", { ref: "MT6", tipo: "montaje", id: NM, etiqueta: "Montaje en DI" }],
  ["RV7", { ref: "RV7", tipo: "revision", id: IV, etiqueta: "Revisión del 2026-10-03" }],
  ["PL8", { ref: "PL8", tipo: "plan", id: IV, etiqueta: "Plan «ITV»" }],
]);
const ctx = { vehiculoId: VEHICULO, intervencionDeOperacion: new Map([[OP, IV]]) };

describe("resolver", () => {
  it("una referencia inventada no resuelve, aunque tenga el formato correcto", () => {
    const r = resolver(["IV99"], refs, ctx);
    expect(r.evidencias).toEqual([]);
    expect(r.descartadas).toEqual(["IV99"]);
  });

  it("un uuid escrito por el modelo no es una referencia", () => {
    const r = resolver([IV, `/tyrecontrol/intervenciones/${IV}`], refs, ctx);
    expect(r.evidencias).toEqual([]);
    expect(r.descartadas).toHaveLength(2);
  });

  it("solo construye rutas de la lista blanca del panel", () => {
    const r = resolver(["VH1", "IV2", "NM4", "IN5"], refs, ctx);
    expect(r.evidencias.map((e) => e.ruta)).toEqual([
      `/tyrecontrol/vehiculos/${VEHICULO}`,
      `/tyrecontrol/intervenciones/${IV}`,
      `/tyrecontrol/neumaticos/${NM}`,
      "/tyrecontrol/incidencias",
    ]);
  });

  it("una operación enlaza a su intervención; sin intervención, a la ficha", () => {
    expect(resolver(["OP3"], refs, ctx).evidencias[0].ruta)
      .toBe(`/tyrecontrol/intervenciones/${IV}`);
    const suelta = { vehiculoId: VEHICULO, intervencionDeOperacion: new Map([[OP, null]]) };
    expect(resolver(["OP3"], refs, suelta).evidencias[0].ruta)
      .toBe(`/tyrecontrol/vehiculos/${VEHICULO}`);
  });

  it("montajes, revisiones y planes van a su contexto real, no a una ruta inventada", () => {
    const r = resolver(["MT6", "RV7", "PL8"], refs, ctx);
    for (const e of r.evidencias) expect(e.ruta).toBe(`/tyrecontrol/vehiculos/${VEHICULO}`);
  });

  it("la etiqueta la pone el servidor y se limpia antes de salir", () => {
    const sucias = new Map<string, Ref>([
      ["VH1", { ref: "VH1", tipo: "vehiculo", id: VEHICULO, etiqueta: `Ficha de\n\n1234  ABC${"x".repeat(300)}` }],
    ]);
    const e = resolver(["VH1"], sucias, ctx).evidencias[0];
    expect(e.etiqueta).not.toContain("\n");
    expect(e.etiqueta.length).toBeLessThanOrEqual(120);
    expect(e.etiqueta.startsWith("Ficha de 1234 ABC")).toBe(true);
  });

  it("no acepta basura: objetos, formatos raros y repeticiones", () => {
    const r = resolver([{ ref: "IV2" }, "iv2 ", "XX1", "IV2", "IV2"], refs, ctx);
    expect(r.evidencias).toHaveLength(1);        // «iv2 » normaliza a IV2, el duplicado se cae
    expect(r.evidencias[0].ref).toBe("IV2");
  });

  it("si no se cita nada, no hay evidencias", () => {
    expect(resolver(undefined, refs, ctx).evidencias).toEqual([]);
    expect(resolver("IV2", refs, ctx).evidencias).toEqual([]);
  });

  it("una referencia con id que no es uuid no resuelve", () => {
    const malas = new Map<string, Ref>([
      ["IV2", { ref: "IV2", tipo: "intervencion", id: "100 OR 1=1", etiqueta: "Intervención" }],
    ]);
    expect(resolver(["IV2"], malas, ctx).evidencias).toEqual([]);
  });
});
