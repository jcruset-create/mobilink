import { describe, expect, it } from "vitest";

import {
  ROLES_EMPRESA,
  leerRoles,
  normalizarCif,
  normalizarRoles,
  puedeEditarRelacion,
  puedeVerEmpresas,
  relacionVigente,
  tieneRol,
  validarCondiciones,
} from "./empresas.ts";

describe("roles de empresa", () => {
  it("acepta los cuatro papeles del catálogo", () => {
    expect(normalizarRoles(["CUSTOMER", "PROVIDER", "PARTNER", "WORKSHOP_OWNER"])).toEqual([
      ...ROLES_EMPRESA,
    ]);
  });

  it("normaliza mayúsculas y espacios", () => {
    expect(normalizarRoles([" provider ", "customer"])).toEqual(["CUSTOMER", "PROVIDER"]);
  });

  it("quita duplicados y ordena igual siempre, para poder comparar dos relaciones", () => {
    expect(normalizarRoles(["PROVIDER", "CUSTOMER", "PROVIDER"])).toEqual(["CUSTOMER", "PROVIDER"]);
  });

  /*
   * Lo importante de este caso: una errata NO se convierte en un rol. Si
   * "PROVIDR" colara como PROVIDER, una empresa no autorizada entraría en el
   * reparto de asistencias.
   */
  it("descarta lo que no reconoce en vez de adivinar", () => {
    expect(normalizarRoles(["PROVIDR", "", null, 7, {}])).toEqual([]);
    expect(normalizarRoles("cualquier cosa")).toEqual([]);
  });

  it("admite una lista separada por comas, que es como llega de un formulario", () => {
    expect(normalizarRoles("provider,workshop_owner")).toEqual(["PROVIDER", "WORKSHOP_OWNER"]);
  });

  it("lee la columna guardada como JSON de texto", () => {
    expect(leerRoles('["PROVIDER","CUSTOMER"]')).toEqual(["CUSTOMER", "PROVIDER"]);
    expect(leerRoles("[]")).toEqual([]);
    expect(leerRoles(null)).toEqual([]);
    expect(leerRoles("texto roto {")).toEqual([]);
  });

  it("tieneRol responde sobre el valor ya guardado", () => {
    expect(tieneRol('["PROVIDER"]', "PROVIDER")).toBe(true);
    expect(tieneRol('["PROVIDER"]', "CUSTOMER")).toBe(false);
  });
});

describe("vigencia de la relación comercial", () => {
  const ahora = 1_700_000_000_000;

  it("una relación activa y sin fechas está vigente", () => {
    expect(relacionVigente({ status: "active" }, ahora)).toBe(true);
  });

  it("una relación suspendida no está vigente aunque las fechas cuadren", () => {
    expect(relacionVigente({ status: "suspended", validFromMs: 0 }, ahora)).toBe(false);
    expect(relacionVigente({ status: "ended" }, ahora)).toBe(false);
  });

  it("no está vigente antes de empezar", () => {
    expect(relacionVigente({ status: "active", validFromMs: ahora + 1 }, ahora)).toBe(false);
  });

  /* validTo excluido, igual que en el motor de tarifas: el día del fin ya no cuenta. */
  it("el instante de fin ya queda fuera", () => {
    expect(relacionVigente({ status: "active", validToMs: ahora }, ahora)).toBe(false);
    expect(relacionVigente({ status: "active", validToMs: ahora + 1 }, ahora)).toBe(true);
  });

  it("una relación inexistente nunca está vigente", () => {
    expect(relacionVigente(null, ahora)).toBe(false);
    expect(relacionVigente(undefined, ahora)).toBe(false);
  });
});

describe("validación de condiciones comerciales", () => {
  it("acepta unas condiciones vacías: todo es opcional", () => {
    expect(validarCondiciones({})).toEqual([]);
  });

  it("rechaza límites negativos en vez de corregirlos a cero", () => {
    expect(validarCondiciones({ authorizationLimit: -500 })).toContain(
      "authorizationLimit no puede ser negativo",
    );
    expect(validarCondiciones({ creditLimit: -1 })).toContain("creditLimit no puede ser negativo");
  });

  it("acepta el cero, que sí es un límite legítimo", () => {
    expect(validarCondiciones({ authorizationLimit: 0, creditLimit: 0 })).toEqual([]);
  });

  it("exige minutos enteros y positivos en los SLA", () => {
    expect(validarCondiciones({ slaArrivalMin: 0 })).toHaveLength(1);
    expect(validarCondiciones({ slaAcceptMin: 2.5 })).toHaveLength(1);
    expect(validarCondiciones({ slaAcceptMin: 15, slaArrivalMin: 60 })).toEqual([]);
  });

  it("rechaza una vigencia que acaba antes de empezar", () => {
    expect(validarCondiciones({ validFromMs: 200, validToMs: 100 })).toHaveLength(1);
    expect(validarCondiciones({ validFromMs: 100, validToMs: 200 })).toEqual([]);
  });

  it("rechaza un estado que no existe", () => {
    expect(validarCondiciones({ status: "borrado" })).toHaveLength(1);
    expect(validarCondiciones({ status: "suspended" })).toEqual([]);
  });

  it("ignora los campos que llegan vacíos desde un formulario", () => {
    expect(validarCondiciones({ creditLimit: "", slaAcceptMin: "", status: "" })).toEqual([]);
  });
});

describe("identificador fiscal", () => {
  /* Sin esto la ficha maestra no sirve: se crearían dos empresas por el mismo CIF. */
  it("iguala las formas de escribir el mismo CIF", () => {
    expect(normalizarCif("B-12345678")).toBe("B12345678");
    expect(normalizarCif("b 12345678")).toBe("B12345678");
    expect(normalizarCif(" B12345678 ")).toBe("B12345678");
  });

  it("un CIF ausente se normaliza a cadena vacía, no a null", () => {
    expect(normalizarCif(null)).toBe("");
    expect(normalizarCif(undefined)).toBe("");
  });
});

describe("capacidades sobre empresas", () => {
  it("ver la cartera llega hasta el analista", () => {
    for (const rol of ["superadmin", "cc_admin", "supervisor", "operator", "analyst"] as const) {
      expect(puedeVerEmpresas(rol)).toBe(true);
    }
  });

  it("cambiar condiciones comerciales es cosa de administración", () => {
    expect(puedeEditarRelacion("cc_admin")).toBe(true);
    expect(puedeEditarRelacion("superadmin")).toBe(true);
    expect(puedeEditarRelacion("supervisor")).toBe(false);
    expect(puedeEditarRelacion("operator")).toBe(false);
  });

  /* El taller no ve la cartera de la central: está fuera a propósito. */
  it("provider_user no ve ni edita", () => {
    expect(puedeVerEmpresas("provider_user")).toBe(false);
    expect(puedeEditarRelacion("provider_user")).toBe(false);
  });

  it("sin rol no se puede nada", () => {
    expect(puedeVerEmpresas(null)).toBe(false);
    expect(puedeEditarRelacion(undefined)).toBe(false);
  });
});
