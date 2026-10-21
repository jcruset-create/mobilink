import { describe, expect, it } from "vitest";
import { puedeAbrirVistaIncrustada, seccionVisible, seccionMarcadaEnCore } from "./vistasDelModulo";
import type { AppView } from "./permissions";

const con = (permitidas: string[]) => (v: AppView) => permitidas.includes(v);

describe("puedeAbrirVistaIncrustada", () => {
  it("la agenda entra con «agenda2» o con la clásica «agenda»", () => {
    expect(puedeAbrirVistaIncrustada("agenda2", con(["agenda2"]))).toBe(true);
    expect(puedeAbrirVistaIncrustada("agenda2", con(["agenda"]))).toBe(true);
  });

  it("sin el permiso, NO se abre: es lo que daba media pantalla", () => {
    expect(puedeAbrirVistaIncrustada("agenda2", con(["operativo2"]))).toBe(false);
    expect(puedeAbrirVistaIncrustada("tecnicos", con(["operativo2"]))).toBe(false);
    expect(puedeAbrirVistaIncrustada("operarios", con(["operativo2"]))).toBe(false);
  });

  it("«operativo2» se queda fuera de la regla a propósito", () => {
    // Cae a la pantalla operativa completa; quitársela dejaría sin nada a
    // quien hoy ve algo.
    expect(puedeAbrirVistaIncrustada("operativo2", con([]))).toBe(true);
  });

  it("una vista que no incrusta el módulo no se bloquea aquí", () => {
    expect(puedeAbrirVistaIncrustada("loquesea", con([]))).toBe(true);
  });
});

describe("seccionVisible", () => {
  it("sin lista de vistas (administrador) se ve todo", () => {
    expect(seccionVisible("agenda2", null)).toBe(true);
    expect(seccionVisible("agenda2", [])).toBe(true);
  });

  it("con lista, se esconde lo que no esté", () => {
    expect(seccionVisible("agenda2", ["operativo2"])).toBe(false);
    expect(seccionVisible("agenda2", ["operativo2", "agenda"])).toBe(true);
  });

  it("una sección que no abre vista del panel no se esconde nunca", () => {
    expect(seccionVisible(null, ["operativo2"])).toBe(true);
  });
});

describe("seccionMarcadaEnCore", () => {
  it("sin lista, todo marcado; con lista, solo lo que está", () => {
    expect(seccionMarcadaEnCore("recepciones", null)).toBe(true);
    expect(seccionMarcadaEnCore("recepciones", [])).toBe(true);
    expect(seccionMarcadaEnCore("recepciones", ["operativo2", "agenda"])).toBe(false);
    expect(seccionMarcadaEnCore("agenda", ["operativo2", "agenda"])).toBe(true);
  });
});
