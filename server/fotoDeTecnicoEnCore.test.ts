import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La foto del técnico enlazado es la de su ficha de Core.
 *
 * Como en `tecnicoSaleDeCore.test.ts`: son varios eslabones y basta que se
 * suelte uno para que la foto deje de verse, o —peor— para que una dirección
 * firmada, que caduca, acabe guardada en la base como si fuera la foto.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const SERVIDOR = readFileSync(`${RAIZ}server/index.ts`, "utf8");
const PANEL = readFileSync(`${RAIZ}src/SeaTarragonaV1.tsx`, "utf8");

function bloque(texto: string, desde: string, largo: number) {
  const i = texto.indexOf(desde);
  expect(i).toBeGreaterThan(0);
  return texto.slice(i, i + largo);
}

describe("la foto del técnico enlazado", () => {
  it("GET /api/techs trae la foto de Core y la firma", () => {
    const get = bloque(SERVIDOR, 'app.get("/api/techs",', 2600);
    expect(get).toContain("e.foto_url AS core_foto");
    expect(get).toContain("almacenSupabase.firmar(rutasDeFoto)");
    expect(get).toContain("...(fotoDeCore ? { avatar: fotoDeCore } : {})");
  });

  it("si no se puede firmar, se ve la del taller en vez de romperse", () => {
    const get = bloque(SERVIDOR, 'app.get("/api/techs",', 2600);
    expect(get).toContain("almacenSupabase.firmar(rutasDeFoto).catch(() => ({}))");
  });

  it("guardar el técnico no escribe en la base la dirección firmada que le dio Core", () => {
    const put = bloque(SERVIDOR, 'app.put("/api/techs/:name",', 5200);
    expect(put).toContain("const fotoEnCore = await fotoDeTecnicoEnCore(name);");
    expect(put).toContain("fotoEnCore.enCore ? fotoEnCore.avatarDelTaller : avatar ?? null");
  });

  it("subir la foto de un enlazado desde el taller la guarda en Core, normalizada", () => {
    const post = bloque(SERVIDOR, '"/api/techs/:name/avatar",', 1900);
    expect(post).toContain("const employeeId = await empleadoDeTecnico(name);");
    expect(post).toContain("await ponerFoto(employeeId, req.file)");
    // Y si Core la rechaza, se devuelve su motivo, no un 500.
    expect(post).toContain("if (e instanceof ErrorFoto) return res.status(e.status).json");
  });

  it("el panel conserva la dirección entre recargas para que la foto no parpadee", () => {
    const recarga = bloque(PANEL, "async function reloadTechsFromBackend(", 4500);
    expect(recarga).toContain("avatar: fotoEstable(found.avatar ?? baseTech.avatar ?? null)");
  });
});
