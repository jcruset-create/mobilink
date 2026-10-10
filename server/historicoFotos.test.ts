import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El histórico solo LEE las fotos; no las guarda ni las borra.
 *
 * Las fotos del patio se enganchan al trabajo al convertir la recepción, por
 * referencia a un fichero ya subido. Si esta pantalla pudiera escribir ahí,
 * una mala pulsación se llevaría por delante la prueba de cómo entró un
 * vehículo. El endpoint nuevo es de lectura y exige credencial de panel.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const SERVIDOR = readFileSync(`${RAIZ}server/index.ts`, "utf8");
const PAGINA = readFileSync(`${RAIZ}src/modules/workplanner/AnalisisPage.tsx`, "utf8");

describe("fotos del histórico", () => {
  it("el endpoint del panel existe y pide credencial", () => {
    expect(SERVIDOR).toContain(
      'app.get("/api/jobs/:id/files", exigirCredencial(requirePanelRole)'
    );
  });

  it("no hay forma de escribir ni borrar ficheros desde el panel", () => {
    expect(SERVIDOR).not.toContain('app.post("/api/jobs/:id/files"');
    expect(SERVIDOR).not.toContain('app.delete("/api/jobs/:id/files"');
  });

  it("la ruta de la APK se queda como estaba", () => {
    expect(SERVIDOR).toContain(
      'app.get("/api/taller-operator/jobs/:id/files", requireTallerOperator'
    );
    expect(SERVIDOR).toContain('"/api/taller-operator/jobs/:id/files",');
  });

  it("la pantalla solo pide las fotos, y al abrir la ficha", () => {
    expect(PAGINA).toContain("/files`");
    expect(PAGINA).not.toMatch(/method:\s*"(POST|PUT|DELETE)"/);
  });
});
