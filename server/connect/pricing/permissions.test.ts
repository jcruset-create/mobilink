/**
 * Los permisos económicos.
 *
 * La prueba que más importa de todo el fichero es una: **el taller no ve el
 * precio de venta ni el margen**. Si eso se rompe, se rompe enseñándole a un
 * proveedor cuánto gana la central por encima de él, y eso no se arregla
 * luego con un parche.
 */

import { describe, expect, it } from "vitest";
import {
  puede, limiteAjuste, autorizarAjuste, recortarSegunRol, leerAjustes,
  LIMITE_SUPERVISOR_POR_DEFECTO,
} from "./permissions.ts";
import { aDinero } from "./money.ts";

const d = (v: string) => aDinero(v)!;

describe("Quién ve qué", () => {
  it("el taller ve lo que le pagan y nada más", () => {
    expect(puede("provider_user", "ver_compra")).toBe(true);
    expect(puede("provider_user", "ver_venta")).toBe(false);
    expect(puede("provider_user", "ver_margen")).toBe(false);
    expect(puede("provider_user", "ajustar_importe")).toBe(false);
    expect(puede("provider_user", "exportar_facturacion")).toBe(false);
  });

  it("un operador ve los importes pero no el margen ni toca dinero", () => {
    expect(puede("operator", "ver_venta")).toBe(true);
    expect(puede("operator", "ver_compra")).toBe(true);
    expect(puede("operator", "ver_margen")).toBe(false);
    expect(puede("operator", "ajustar_importe")).toBe(false);
  });

  it("solo el administrador de central publica tarifas y exporta facturación", () => {
    for (const role of ["supervisor", "operator", "analyst", "provider_user"] as const) {
      expect(puede(role, "publicar_tarifa"), role).toBe(false);
      expect(puede(role, "exportar_facturacion"), role).toBe(false);
    }
    expect(puede("cc_admin", "publicar_tarifa")).toBe(true);
    expect(puede("superadmin", "exportar_facturacion")).toBe(true);
  });

  it("sin rol no se puede nada", () => {
    expect(puede(null, "ver_compra")).toBe(false);
    expect(puede(undefined, "ver_venta")).toBe(false);
  });
});

describe("Hasta cuánto se puede ajustar", () => {
  it("quien no puede ajustar no tiene límite: tiene prohibición", () => {
    // Son cosas distintas, y confundirlas dejaría a un operador con límite infinito
    expect(limiteAjuste("operator")).toBeUndefined();
    expect(limiteAjuste("analyst")).toBeUndefined();
  });

  it("el administrador no tiene límite", () => {
    expect(limiteAjuste("cc_admin")).toBeNull();
    expect(limiteAjuste("superadmin")).toBeNull();
  });

  it("el supervisor tiene el límite por defecto si el centro no dice otra cosa", () => {
    expect(limiteAjuste("supervisor")).toBe(aDinero(LIMITE_SUPERVISOR_POR_DEFECTO));
    expect(limiteAjuste("supervisor", { limiteSupervisor: "400" })).toBe(d("400"));
  });

  it("un ajuste dentro del límite pasa", () => {
    const v = autorizarAjuste("supervisor", d("120"));
    expect(v.permitido).toBe(true);
    expect(v.codigo).toBe("ok");
  });

  it("un ajuste por encima del límite no pasa, y dice por qué", () => {
    const v = autorizarAjuste("supervisor", d("200"));
    expect(v.permitido).toBe(false);
    expect(v.codigo).toBe("sobre_limite");
    expect(v.mensaje).toContain("administrador");
  });

  it("BAJAR un importe cuenta igual que subirlo", () => {
    /*
     * Un límite que solo mirara las subidas dejaría pasar los descuentos, que
     * es justo por donde se escapa el margen.
     */
    expect(autorizarAjuste("supervisor", d("-200")).permitido).toBe(false);
    expect(autorizarAjuste("supervisor", d("-120")).permitido).toBe(true);
  });

  it("un operador no ajusta ni un céntimo", () => {
    const v = autorizarAjuste("operator", d("0.01"));
    expect(v.permitido).toBe(false);
    expect(v.codigo).toBe("sin_permiso");
  });

  it("el administrador mueve lo que haga falta", () => {
    expect(autorizarAjuste("cc_admin", d("100000")).permitido).toBe(true);
  });
});

describe("Recorte de la respuesta según el rol", () => {
  const fila = {
    saleTotal: "331.00", purchaseTotal: "275.00",
    grossMargin: "56.00", grossMarginPct: "16.92", currency: "EUR",
  };
  const campos = {
    venta: ["saleTotal"] as const, compra: ["purchaseTotal"] as const,
    margen: ["grossMargin", "grossMarginPct"] as const,
  };

  it("al taller le llega la compra y el resto en nulo", () => {
    const r = recortarSegunRol(fila, "provider_user", campos as any);
    expect(r.purchaseTotal).toBe("275.00");
    expect(r.saleTotal).toBeNull();
    expect(r.grossMargin).toBeNull();
    expect(r.grossMarginPct).toBeNull();
  });

  it("al operador le llegan los dos importes pero no el margen", () => {
    const r = recortarSegunRol(fila, "operator", campos as any);
    expect(r.saleTotal).toBe("331.00");
    expect(r.purchaseTotal).toBe("275.00");
    expect(r.grossMargin).toBeNull();
  });

  it("al administrador le llega todo", () => {
    expect(recortarSegunRol(fila, "cc_admin", campos as any)).toEqual(fila);
  });

  it("no muta el original: la misma fila se recorta distinto para dos usuarios", () => {
    const original = { ...fila };
    recortarSegunRol(fila, "provider_user", campos as any);
    expect(fila).toEqual(original);
  });

  it("lo que no se nombra no se toca", () => {
    const r = recortarSegunRol(fila, "provider_user", campos as any);
    expect(r.currency).toBe("EUR");
  });
});

describe("Ajustes del centro de control", () => {
  it("lee el límite del JSON de settings", () => {
    expect(leerAjustes('{"pricing":{"limiteAjusteSupervisor":300}}').limiteSupervisor).toBe("300");
    expect(leerAjustes({ pricing: { limiteAjusteSupervisor: "250" } }).limiteSupervisor).toBe("250");
  });

  it("unos settings vacíos o rotos no rompen nada: se usa el valor por defecto", () => {
    for (const v of [null, "", "{}", "{roto", '{"otra":"cosa"}']) {
      expect(leerAjustes(v).limiteSupervisor).toBeNull();
    }
    expect(limiteAjuste("supervisor", leerAjustes("{roto"))).toBe(aDinero(LIMITE_SUPERVISOR_POR_DEFECTO));
  });
});
