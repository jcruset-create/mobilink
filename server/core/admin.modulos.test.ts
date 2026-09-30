import { describe, expect, it } from "vitest";
import { MODULOS_VALIDOS } from "./admin.ts";
import { MODULOS_SAAS } from "../../src/modules/modulosSaas.ts";

describe("licencias: módulos que admite el servidor", () => {
  it("se puede licenciar cualquier módulo del SaaS", () => {
    /*
     * Aquí había una copia a mano con ocho módulos: el panel ofrecía Mobilink
     * Cash, Central, Recepciones… y al añadir la licencia el servidor
     * respondía «Módulo no válido».
     */
    for (const m of MODULOS_SAAS) {
      expect(MODULOS_VALIDOS, m).toContain(m);
    }
    expect(MODULOS_VALIDOS).toHaveLength(MODULOS_SAAS.length);
  });
});
