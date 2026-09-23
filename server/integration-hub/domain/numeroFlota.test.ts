import { describe, expect, it } from "vitest";

import { cambiosDeNumeroFlota, numeroDeFlotaDeNombre } from "./numeroFlota.ts";

describe("numeroDeFlotaDeNombre", () => {
  it("lee los nombres reales de Movertis, con el separador que sea", () => {
    // Tal cual salen en la pantalla de conciliación.
    expect(numeroDeFlotaDeNombre("1807 7523-NNB", "7523NNB")).toBe("1807");
    expect(numeroDeFlotaDeNombre("1808-8774-NMX", "8774-NMX")).toBe("1808");
    expect(numeroDeFlotaDeNombre("1810-7524-NNB", "7524 NNB")).toBe("1810");
  });

  it("NO confunde media matrícula con un número de bus", () => {
    // Éste es el caso que justifica todo el módulo: si el proveedor nombra el
    // vehículo solo con su matrícula, lo de delante son cifras de la placa.
    expect(numeroDeFlotaDeNombre("7523-NNB", "7523NNB")).toBeNull();
    expect(numeroDeFlotaDeNombre("7523 NNB", "7523NNB")).toBeNull();
  });

  it("no propone nada si lo de detrás no es la matrícula de ESE vehículo", () => {
    // Un nombre que habla de otro coche no sirve para rellenar éste.
    expect(numeroDeFlotaDeNombre("1807 7523-NNB", "8774NMX")).toBeNull();
    expect(numeroDeFlotaDeNombre("1807 Autocar grande", "7523NNB")).toBeNull();
  });

  it("quita los ceros de relleno", () => {
    expect(numeroDeFlotaDeNombre("0042 7523NNB", "7523NNB")).toBe("42");
  });

  it("descarta el cero y lo que no tiene forma", () => {
    expect(numeroDeFlotaDeNombre("0 7523NNB", "7523NNB")).toBeNull();
    expect(numeroDeFlotaDeNombre("", "7523NNB")).toBeNull();
    expect(numeroDeFlotaDeNombre(null, "7523NNB")).toBeNull();
    expect(numeroDeFlotaDeNombre("1807 7523NNB", "")).toBeNull();
    expect(numeroDeFlotaDeNombre("1807 7523NNB", null)).toBeNull();
  });
});

describe("cambiosDeNumeroFlota", () => {
  const bus = (extra: Partial<Parameters<typeof cambiosDeNumeroFlota>[0][0]> = {}) => ({
    vehiculoId: "v1",
    matricula: "7523NNB",
    nombreProveedor: "1807 7523-NNB",
    numeroActual: null,
    ...extra,
  });

  it("rellena el hueco", () => {
    const [c] = cambiosDeNumeroFlota([bus()]);
    expect(c.numeroPropuesto).toBe("1807");
    expect(c.tipo).toBe("rellena");
  });

  it("marca como conflicto el que ya tenía otro número", () => {
    const [c] = cambiosDeNumeroFlota([bus({ numeroActual: "1500" })]);
    expect(c.tipo).toBe("conflicto");
    expect(c.numeroActual).toBe("1500");
    expect(c.numeroPropuesto).toBe("1807");
  });

  it("calla los que ya están bien, aunque estén escritos con ceros", () => {
    expect(cambiosDeNumeroFlota([bus({ numeroActual: "1807" })])).toEqual([]);
    expect(cambiosDeNumeroFlota([bus({ numeroActual: "01807" })])).toEqual([]);
    expect(cambiosDeNumeroFlota([bus({ numeroActual: " 1807 " })])).toEqual([]);
  });

  it("calla los que no tienen número que proponer", () => {
    expect(cambiosDeNumeroFlota([bus({ nombreProveedor: "7523-NNB" })])).toEqual([]);
    expect(cambiosDeNumeroFlota([bus({ nombreProveedor: null })])).toEqual([]);
  });
});
