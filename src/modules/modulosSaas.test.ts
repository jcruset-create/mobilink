import { describe, expect, it } from "vitest";
import { MODULOS_SAAS, NOMBRE_MODULO, nombreModulo } from "./modulosSaas";
import { MODULOS_APP } from "./administracion/config/modulosApp";

describe("catálogo de módulos del SaaS", () => {
  it("todo módulo del catálogo de accesos es licenciable", () => {
    // Si no, se le puede dar acceso a un usuario y luego no hay forma de
    // licenciarlo: el acceso queda guardado y app_mis_modulos lo filtra, que
    // es justo el silencio que se quiere evitar.
    for (const m of MODULOS_APP) {
      expect(MODULOS_SAAS, m.key).toContain(m.key);
    }
  });

  it("todo módulo licenciable tiene nombre para una persona", () => {
    for (const m of MODULOS_SAAS) {
      expect(NOMBRE_MODULO[m], m).toBeTruthy();
    }
  });

  it("los nombres coinciden con los del catálogo de accesos", () => {
    // Dos nombres distintos para el mismo módulo -uno en el panel de licencias
    // y otro en el de usuarios- hacen dudar de si son lo mismo.
    for (const m of MODULOS_APP) {
      expect(nombreModulo(m.key), m.key).toBe(m.label);
    }
  });

  it("no hay claves repetidas", () => {
    expect(new Set(MODULOS_SAAS).size).toBe(MODULOS_SAAS.length);
  });

  it("una clave desconocida se devuelve tal cual, sin romper", () => {
    expect(nombreModulo("modulo-que-no-existe")).toBe("modulo-que-no-existe");
  });
});
