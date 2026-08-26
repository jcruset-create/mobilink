/**
 * La conversión de lo calculado a lo que pinta la pantalla.
 *
 * Parece trivial y no lo es: aquí es donde se decide que un importe que el
 * motor no ha podido calcular llegue al panel como nulo y no como cero. Si
 * esta capa "arregla" los nulos, todo el criterio del motor —desconocido no es
 * gratis— se pierde en la última milla.
 */

import { describe, expect, it } from "vitest";
import { etapaParaApi } from "./presenter.ts";

const SNAPSHOT = {
  venta: { tariffPlanName: "SEAS Nacional", version: "2026.1", reglaNombre: "Nocturno L-V" },
  contexto: { fechaLocal: "2026-08-14", horaLocal: "22:17", timezone: "Europe/Madrid", franja: "NOCTURNO" },
};

describe("Etapa para el panel", () => {
  it("los importes salen como texto con dos decimales", () => {
    const r = etapaParaApi({
      stage: "locked", status: "ok", currency: "EUR",
      saleTotal: "331.0000", purchaseTotal: "300.0000",
      grossMargin: "31.0000", grossMarginPct: "9.3655",
      computedAtMs: "1755200000000", snapshot: SNAPSHOT, warnings: [], lines: [],
    });
    expect(r.saleTotal).toBe("331.00");
    expect(r.purchaseTotal).toBe("300.00");
    expect(r.grossMargin).toBe("31.00");
    expect(r.grossMarginPct).toBe("9.37");
    expect(r.computedAtMs).toBe(1_755_200_000_000);
  });

  it("un importe desconocido sigue siendo desconocido, no cero", () => {
    const r = etapaParaApi({
      stage: "locked", status: "partial", currency: "EUR",
      saleTotal: "331.0000", purchaseTotal: null, grossMargin: null, grossMarginPct: null,
      snapshot: SNAPSHOT, warnings: [], lines: [],
    });
    expect(r.purchaseTotal).toBeNull();
    expect(r.grossMargin).toBeNull();
    expect(r.grossMarginPct).toBeNull();
  });

  it("la cadena vacía tampoco se convierte en cero", () => {
    const r = etapaParaApi({ stage: "final", status: "ok", saleTotal: "", snapshot: null });
    expect(r.saleTotal).toBeNull();
  });

  it("el snapshot vale igual venga parseado o como texto", () => {
    const comoTexto = etapaParaApi({ stage: "locked", status: "ok", snapshot: JSON.stringify(SNAPSHOT) });
    const comoObjeto = etapaParaApi({ stage: "locked", status: "ok", snapshot: SNAPSHOT });
    expect(comoTexto.tariff).toBe("SEAS Nacional");
    expect(comoTexto.rule).toBe("Nocturno L-V");
    expect(comoTexto.context).toEqual(comoObjeto.context);
  });

  it("un snapshot ilegible no revienta la pantalla: se pinta lo que haya", () => {
    const r = etapaParaApi({
      stage: "final", status: "ok", saleTotal: "100", snapshot: "{esto no es json",
      warnings: "[[roto", lines: null,
    });
    expect(r.saleTotal).toBe("100.00");
    expect(r.tariff).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(r.lines).toEqual([]);
  });

  it("las líneas también se normalizan, unitarios incluidos", () => {
    const r = etapaParaApi({
      stage: "final", status: "ok", currency: "EUR", snapshot: SNAPSHOT,
      lines: [
        { lineNumber: 1, kind: "FORFAIT", description: "Forfait nocturno", quantity: "1",
          unit: null, saleUnitPrice: "331.0000", saleTotal: "331.0000",
          purchaseUnitPrice: null, purchaseTotal: null },
        { lineNumber: 2, kind: "EXTRA_KM", description: "Km de más", quantity: "25.0",
          unit: "km", saleUnitPrice: "1.2500", saleTotal: "31.2500",
          purchaseUnitPrice: "1.2500", purchaseTotal: "31.2500" },
      ],
    });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ quantity: 1, saleTotal: "331.00", purchaseTotal: null });
    expect(r.lines[1]).toMatchObject({ quantity: 25, unit: "km", saleUnitPrice: "1.25", saleTotal: "31.25" });
  });

  it("si no hay venta, el tarifario y la regla salen del lado de compra", () => {
    const r = etapaParaApi({
      stage: "locked", status: "partial",
      snapshot: { compra: { tariffPlanName: "Red propia", version: "2026.1", reglaNombre: "Diurno" } },
    });
    expect(r.tariff).toBe("Red propia");
    expect(r.rule).toBe("Diurno");
  });

  it("las etapas sin moneda se quedan en euros, que es lo que hay", () => {
    expect(etapaParaApi({ stage: "estimate", status: "ok" }).currency).toBe("EUR");
  });
});
