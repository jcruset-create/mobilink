import { describe, it, expect } from "vitest";
import { puedeFicha, capacidadesDe } from "./capacidades.ts";

/**
 * La tabla de capacidades introduce la política SIN cambiar quién entraba
 * antes: ver con rango de analista, crear y editar con rango de administrador
 * de centro. Estas pruebas fijan justo eso, para que un retoque futuro no
 * abra la cartera de clientes a quien solo debía consultarla.
 */
describe("capacidades sobre las fichas maestras", () => {
  it("el administrador de centro puede todo, incluida la configuración del ERP", () => {
    for (const cap of capacidadesDe("superadmin")) {
      expect(puedeFicha("cc_admin", cap)).toBe(true);
    }
    expect(puedeFicha("cc_admin", "configurar_erp")).toBe(true);
  });

  it("supervisor, operador y analista ven, pero no tocan", () => {
    for (const rol of ["supervisor", "operator", "analyst"] as const) {
      expect(puedeFicha(rol, "ver_proveedores")).toBe(true);
      expect(puedeFicha(rol, "ver_clientes")).toBe(true);
      expect(puedeFicha(rol, "crear_proveedores")).toBe(false);
      expect(puedeFicha(rol, "editar_clientes")).toBe(false);
      // Las credenciales del ERP son de administración: nadie más las toca.
      expect(puedeFicha(rol, "configurar_erp")).toBe(false);
    }
  });

  it("el taller no ve la cartera del centro de control", () => {
    expect(capacidadesDe("provider_user")).toEqual([]);
    expect(puedeFicha("provider_user", "ver_clientes")).toBe(false);
    expect(puedeFicha("provider_user", "ver_proveedores")).toBe(false);
  });

  it("sin rol no se puede nada", () => {
    expect(puedeFicha(null, "ver_clientes")).toBe(false);
    expect(puedeFicha(undefined, "configurar_erp")).toBe(false);
    expect(capacidadesDe(null)).toEqual([]);
  });

  it("la lista que se devuelve no permite modificar la tabla por dentro", () => {
    const lista = capacidadesDe("analyst");
    lista.push("configurar_erp");
    expect(puedeFicha("analyst", "configurar_erp")).toBe(false);
  });
});
