/**
 * Pruebas del guarda que comprueba que las de integración se han ejecutado.
 *
 * El guarda vivía embebido en el YAML del workflow, así que no había forma de
 * ejecutarlo en local: la CI se quedó seis commits en rojo por un salto que en
 * local no se veía. Estas pruebas existen para que ese caso —un fichero de
 * integración que se salta a propósito— esté fijado y no vuelva a descubrirse
 * en la CI.
 */

import { describe, expect, it } from "vitest";
import { GOBERNADOS_APARTE, revisar } from "./ci-integracion-ejecutada.mjs";

/** Un informe de vitest con los campos que el guarda mira. */
function informe(...ficheros: Array<{ name: string; status?: string; casos: string[] }>) {
  return {
    testResults: ficheros.map((f) => ({
      name: f.name,
      status: f.status ?? "passed",
      assertionResults: f.casos.map((status, i) => ({ status, title: `caso ${i}` })),
    })),
  };
}

const VERDE = { name: "/r/server/cash/cash.integration.test.ts", casos: ["passed", "passed"] };

describe("el caso normal", () => {
  it("un fichero de integración con casos en verde pasa", () => {
    const r = revisar(informe(VERDE), {});
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.lineas[0]).toContain("2/2 casos en verde");
  });

  it("no mira los ficheros que no son de integración", () => {
    const r = revisar(informe(VERDE, { name: "/r/server/medidas.test.ts", casos: ["skipped"] }), {});
    expect(r.ok).toBe(true);
    expect(r.lineas).toHaveLength(1);
  });
});

describe("el agujero original · cobertura aparente", () => {
  it("falla si NINGÚN fichero de integración aparece en el informe", () => {
    const r = revisar(informe({ name: "/r/server/medidas.test.ts", casos: ["passed"] }), {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("No se ha encontrado ningun fichero");
  });

  it("falla si un fichero de integración no recolectó ningún caso: la suite no cargó", () => {
    const r = revisar(informe({ name: "/r/server/cash/cash.integration.test.ts", casos: [] }), {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no ha recolectado ningun caso");
  });

  it("falla si todos sus casos están saltados y NO está gobernado aparte", () => {
    // Este es el agujero: con RUN_DB_TESTS puesto, un fichero que se salta
    // entero es un fallo de configuración, no un salto legítimo.
    const r = revisar(
      informe({ name: "/r/server/cash/cash.integration.test.ts", casos: ["skipped", "skipped"] }),
      { RUN_DB_TESTS: "1" },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no ha ejecutado ninguna prueba de integracion");
    expect(r.error).toContain("GOBERNADOS_APARTE");
  });

  it("falla si sus casos están FALLADOS, no saltados", () => {
    const r = revisar(
      informe({ name: "/r/server/cash/cash.integration.test.ts", status: "failed", casos: ["failed"] }),
      {},
    );
    expect(r.ok).toBe(false);
  });
});

describe("el salto legítimo · ficheros gobernados por su propia variable", () => {
  const ARNES = "/r/server/seguridadHttp.integration.test.ts";

  it("acepta el arnés HTTP saltado entero cuando RUN_HTTP_TESTS no está puesta", () => {
    // Es el caso real que dejó la CI en rojo seis commits.
    const r = revisar(informe(VERDE, { name: ARNES, casos: Array(24).fill("skipped") }), {
      RUN_DB_TESTS: "1",
    });
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.lineas[1]).toContain("A PROPOSITO");
    expect(r.lineas[1]).toContain("RUN_HTTP_TESTS");
  });

  it("y dice cómo ejecutarlo a mano, para que el salto no se lea como «no existe»", () => {
    const r = revisar(informe(VERDE, { name: ARNES, casos: ["skipped"] }), {});
    expect(r.lineas[1]).toContain("RUN_DB_TESTS=1 RUN_HTTP_TESTS=1 npx vitest run");
  });

  it("pero si RUN_HTTP_TESTS SÍ está puesta y aun así no ejecuta nada, falla", () => {
    // Con la variable puesta el salto ya no es deliberado: la suite no cargó.
    const r = revisar(informe(VERDE, { name: ARNES, casos: Array(24).fill("skipped") }), {
      RUN_DB_TESTS: "1",
      RUN_HTTP_TESTS: "1",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("SI esta puesta");
  });

  it("y la excepción no tapa un fallo: si sus casos fallan, falla", () => {
    const r = revisar(informe(VERDE, { name: ARNES, status: "failed", casos: ["failed"] }), {});
    expect(r.ok).toBe(false);
  });

  it("no acepta un fichero gobernado aparte que no recolectó nada", () => {
    const r = revisar(informe(VERDE, { name: ARNES, casos: [] }), {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no ha recolectado ningun caso");
  });
});

describe("la lista de excepciones", () => {
  it("tiene una sola entrada, y es el arnés HTTP", () => {
    // Si esta prueba falla es porque alguien ha añadido una excepción. No es
    // necesariamente un error, pero tiene que ser una decisión consciente:
    // cada entrada es un fichero de integración que la CI deja de comprobar.
    expect(Object.keys(GOBERNADOS_APARTE)).toEqual(["server/seguridadHttp.integration.test.ts"]);
    expect(GOBERNADOS_APARTE["server/seguridadHttp.integration.test.ts"]).toBe("RUN_HTTP_TESTS");
  });

  it("cada entrada apunta a un fichero que existe y que se gobierna con esa variable", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    for (const [ruta, variable] of Object.entries(GOBERNADOS_APARTE)) {
      const abs = new URL(`../${ruta}`, import.meta.url).pathname;
      expect(existsSync(abs), `${ruta} no existe`).toBe(true);
      // Si el fichero no menciona su variable, la excepción está de más y
      // estaría silenciando un salto de verdad.
      expect(readFileSync(abs, "utf8")).toContain(variable);
    }
  });
});
