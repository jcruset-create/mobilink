import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El técnico sale de Core (fase C de la unificación de operarios).
 *
 * Como en `tallerDelTecnicoNoSePierde.test.ts`, hay varios eslabones y basta
 * que se suelte uno para que deje de verse sin que nada falle: el servidor
 * trae quién es en Core, el panel lo copia al recargar, y el alta enlaza al
 * técnico nuevo con la persona elegida. Y una cosa que NO puede pasar: que el
 * nombre del técnico cambie, porque es la clave de todo su histórico.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const SERVIDOR = readFileSync(`${RAIZ}server/index.ts`, "utf8");
const PANEL = readFileSync(`${RAIZ}src/SeaTarragonaV1.tsx`, "utf8");
const FICHA = readFileSync(`${RAIZ}src/components/TecnicosView.tsx`, "utf8");

function bloque(texto: string, desde: string, largo: number) {
  const i = texto.indexOf(desde);
  expect(i).toBeGreaterThan(0);
  return texto.slice(i, i + largo);
}

describe("el técnico sale de Core", () => {
  it("GET /api/techs trae quién es en Core, y sigue funcionando sin Core", () => {
    const get = bloque(SERVIDOR, 'app.get("/api/techs",', 1400);
    expect(get).toContain("hayCore(db)");
    expect(get).toContain("LEFT JOIN sea_employees e ON e.id = t.employee_id");
    expect(get).toContain("core_nombre");
    expect(get).toContain("core_activo");
  });

  it("la fila del técnico conserva su nombre: el de Core va aparte", () => {
    const fila = bloque(SERVIDOR, "function normalizeTechRow(", 1800);
    expect(fila).toContain("name: t.name,");
    expect(fila).toContain("coreNombre: t.core_nombre ?? null");
    expect(fila).toContain("bajaEnCore: t.employee_id != null && t.core_activo === false");
  });

  it("el emparejado da número de trabajador y quién es ya técnico", () => {
    const get = bloque(SERVIDOR, 'app.get("/api/techs/vinculo-core"', 2600);
    expect(get).toContain("numeroTrabajador: e.numero_trabajador ?? null");
    expect(get).toContain("tecnico: tecnicoDe.get(String(e.id)) ?? null");
  });

  it("el panel copia los datos de Core al recargar los técnicos", () => {
    const recarga = bloque(PANEL, "async function reloadTechsFromBackend(", 4500);
    expect(recarga).toContain("coreNombre: found.coreNombre ?? null");
    expect(recarga).toContain("bajaEnCore: found.bajaEnCore === true");
  });

  it("el alta enlaza al técnico nuevo con la persona elegida", () => {
    const alta = bloque(PANEL, "onSaveTech={({", 1800);
    expect(alta).toContain("vincularTecnicoCore(name, employeeId)");
    // Con Core, sin persona elegida no se puede guardar.
    expect(FICHA).toContain("if (!modal.sinCore && !modal.persona) return;");
    expect(FICHA).toContain("employeeId: modal.persona?.id ?? null");
  });
});
