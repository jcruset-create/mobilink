import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * El centro de descargas se pinta con dos listas que viven en ficheros
 * distintos y nadie obliga a que coincidan:
 *
 *   - `APK_APPS` en server/index.ts, que es la que sirve los binarios.
 *   - `META` en public/descargas.html, que pone el icono y la descripción.
 *
 * Cuando se añadió WorkPlanner Taller a la primera y no a la segunda, su
 * tarjeta salió con un «?» por icono y sin descripción. No rompía nada, no
 * daba error en ningún log, y estuvo así hasta que alguien abrió la página y
 * se fijó.
 *
 * Esta prueba es el aviso que no había: si se añade una app al servidor y se
 * olvida la ficha, falla aquí y no delante de un técnico.
 */
const raiz = path.join(__dirname, "..");

function clavesDelServidor(): string[] {
  const src = fs.readFileSync(path.join(raiz, "server/index.ts"), "utf8");
  const bloque = src.split("const APK_APPS")[1]?.split("};")[0];
  if (!bloque) throw new Error("No se encuentra APK_APPS en server/index.ts");
  return [...bloque.matchAll(/^\s*"?([a-z-]+)"?:\s*\{/gm)].map((m) => m[1]);
}

function clavesDeLaPagina(): string[] {
  const html = fs.readFileSync(path.join(raiz, "public/descargas.html"), "utf8");
  const bloque = html.split("var META = {")[1]?.split("};")[0];
  if (!bloque) throw new Error("No se encuentra META en public/descargas.html");
  return [...bloque.matchAll(/^\s*"?([a-z-]+)"?:\s*\{/gm)].map((m) => m[1]);
}

describe("centro de descargas", () => {
  it("encuentra las dos listas", () => {
    // Si alguien renombra o reestructura una de las dos, esta prueba tiene
    // que romperse aquí y no colarse pasando en vacío.
    expect(clavesDelServidor().length).toBeGreaterThan(0);
    expect(clavesDeLaPagina().length).toBeGreaterThan(0);
  });

  it("toda app que sirve el servidor tiene ficha en la página", () => {
    const sinFicha = clavesDelServidor().filter(
      (k) => !clavesDeLaPagina().includes(k)
    );
    expect(
      sinFicha,
      `Sin icono ni descripción en public/descargas.html: ${sinFicha.join(", ")}`
    ).toEqual([]);
  });

  it("y no hay fichas de apps que el servidor ya no sirve", () => {
    // Al revés también molesta, aunque menos: una ficha huérfana es código
    // muerto que hace creer que la app sigue ahí.
    const huerfanas = clavesDeLaPagina().filter(
      (k) => !clavesDelServidor().includes(k)
    );
    expect(
      huerfanas,
      `Ficha sin app detrás: ${huerfanas.join(", ")}`
    ).toEqual([]);
  });
});
