import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ninguna lectura del panel puede salir sin credencial.
 *
 * ── Qué pasó ────────────────────────────────────────────────────────────────
 *
 * La Fase 0 de seguridad cambió `protectWhenStrict` —que era un `next()`
 * pelado— por `exigirCredencial`, y cincuenta rutas empezaron a contestar 401
 * a quien no manda nada. Correcto. Pero diecisiete lecturas del front no
 * mandaban nada: las escrituras llevaban `getAdminHeaders()` desde siempre y
 * las lecturas no, porque hasta ese día daba igual.
 *
 * Y no falló de forma visible. El front hace `response.json()` sin mirar
 * `response.ok`, se encuentra `{"error":"No autorizado"}`, comprueba
 * `Array.isArray(data)` —que es falso— y pinta cero. La agenda apareció vacía,
 * el historial también, y ningún error en pantalla.
 *
 * Este guarda cruza las dos cosas: las rutas que el servidor protege y las
 * llamadas que el front hace. Es tosco a propósito —lee texto, no un AST—
 * porque lo que tiene que cazar es igual de tosco: una llamada a la que se le
 * olvidaron las cabeceras.
 */

const RAIZ = new URL("../", import.meta.url).pathname;

function ficheros(dir: string, ext: string[]): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...ficheros(ruta, ext));
    else if (ext.some((e) => nombre.endsWith(e))) salida.push(ruta);
  }
  return salida;
}

/** Las rutas GET que el servidor exige con credencial. */
function rutasProtegidas(): string[] {
  const index = readFileSync(join(RAIZ, "server", "index.ts"), "utf8");
  const encontradas = index.matchAll(
    /app\.get\("(\/api\/[^"]+)",\s*exigirCredencial/g
  );
  // Sin el `/:param`: el front construye la URL y el prefijo es lo comparable.
  return [...new Set([...encontradas].map((m) => m[1].split("/:")[0]))];
}

describe("las lecturas del panel llevan credencial", () => {
  const protegidas = rutasProtegidas();

  it("el servidor protege las rutas de lectura que se esperan", () => {
    // Si esto baja de golpe, es que `exigirCredencial` se ha revertido y el
    // resto del guarda estaría comprobando el vacío.
    expect(protegidas.length).toBeGreaterThan(15);
    expect(protegidas).toContain("/api/scheduled-jobs");
    expect(protegidas).toContain("/api/jobs");
  });

  it("ninguna llamada del front a esas rutas sale sin cabeceras", () => {
    const sinCredencial: string[] = [];

    for (const fichero of ficheros(join(RAIZ, "src"), [".ts", ".tsx"])) {
      if (fichero.endsWith(".test.ts") || fichero.endsWith(".test.tsx")) continue;
      const texto = readFileSync(fichero, "utf8");

      for (const llamada of texto.matchAll(
        /fetch(?:WithTimeout)?\(\s*`?[^`')]*?(\/api\/[A-Za-z0-9\-/_${}.:]+)/g
      )) {
        const ruta = llamada[1];
        if (!protegidas.some((p) => ruta.startsWith(p))) continue;

        // Hasta el cierre de la llamada, no 400 caracteres a ojo.
        const resto = texto.slice(llamada.index! + llamada[0].length);
        const fin = resto.indexOf(");");
        const argumentos = resto.slice(0, fin > 0 ? fin : 400);

        if (/headers/.test(argumentos)) continue;
        // Un POST/PUT sin cabeceras es otro problema, y no el de este guarda.
        if (/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(argumentos)) continue;

        const linea = texto.slice(0, llamada.index!).split("\n").length;
        sinCredencial.push(`${fichero.replace(RAIZ, "")}:${linea} → ${ruta}`);
      }
    }

    expect(sinCredencial).toEqual([]);
  });
});
