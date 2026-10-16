import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El taller y el teléfono de un técnico no se pueden perder al guardar su estado.
 *
 * Pasaba en cadena: `GET /api/techs` no leía la columna, el panel no la copiaba
 * al recargar y el siguiente guardado (disponible, baja…) mandaba `null`. Todos
 * acababan en Tarragona y Reus salía vacío. Hay tres eslabones y basta que se
 * suelte uno para que vuelva a pasar, así que se miran los tres.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const SERVIDOR = readFileSync(`${RAIZ}server/index.ts`, "utf8");
const PANEL = readFileSync(`${RAIZ}src/SeaTarragonaV1.tsx`, "utf8");

function bloque(texto: string, desde: string, largo: number) {
  const i = texto.indexOf(desde);
  expect(i).toBeGreaterThan(0);
  return texto.slice(i, i + largo);
}

describe("taller y teléfono del técnico", () => {
  it("GET /api/techs lee el taller", () => {
    const get = bloque(SERVIDOR, 'app.get("/api/techs",', 600);
    expect(get).toContain('"workshopId"');
    expect(get).toContain("phone");
  });

  it("PUT /api/techs conserva teléfono y taller cuando no vienen", () => {
    const put = bloque(SERVIDOR, 'app.put("/api/techs/:name",', 4000);
    expect(put).toContain('SELECT "roadsideCapable", "workshopId", phone FROM techs');
    expect(put).toContain("phone === undefined");
    expect(put).toContain("workshopId === undefined");
  });

  it("el panel copia taller y teléfono al recargar los técnicos", () => {
    const recarga = bloque(PANEL, "async function reloadTechsFromBackend(", 4000);
    expect(recarga).toContain("workshopId: found.workshopId ?? null");
    expect(recarga).toContain("phone: found.phone ?? null");
  });
});
