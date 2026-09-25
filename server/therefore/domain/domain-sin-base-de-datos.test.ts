/**
 * `domain/` no toca la base de datos. Nunca.
 *
 * No es una preferencia de estilo. `server/db.ts` **lanza al importarse** si
 * falta `DATABASE_URL`, así que basta con que un fichero del dominio lo
 * importe —aunque sea de refilón, a través de otro— para que todas las pruebas
 * que lo usen fallen en CI antes de ejecutar una sola comprobación. Ha pasado
 * tres veces en este repositorio, y las tres el fallo no decía nada de lo que
 * se estaba probando.
 *
 * Esta prueba lo fija: si alguien mete un import de db.ts —o de algo que lo
 * arrastre— en `domain/`, falla aquí, con el nombre del fichero y el porqué,
 * en vez de falsear el resultado de otra suite.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DOMINIO = dirname(fileURLToPath(import.meta.url));

function ficheros(directorio: string): string[] {
  return readdirSync(directorio).flatMap((entrada) => {
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) return ficheros(ruta);
    return ruta.endsWith(".ts") ? [ruta] : [];
  });
}

/** Los `from "…"` de un fichero, resueltos a ruta absoluta cuando son relativos. */
function importa(ruta: string): string[] {
  const codigo = readFileSync(ruta, "utf8");

  return [...codigo.matchAll(/\bfrom\s+"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((especificador) => especificador.startsWith("."))
    .map((especificador) => resolve(dirname(ruta), especificador));
}

/** Qué ficheros del dominio llegan a db.ts, directamente o a través de otros. */
function losQueLleganABaseDeDatos(): Map<string, string> {
  const db = resolve(DOMINIO, "../../db.ts");
  const culpables = new Map<string, string>();

  for (const fichero of ficheros(DOMINIO)) {
    if (fichero.endsWith(".test.ts")) continue;

    const vistos = new Set<string>();
    const pendientes = [fichero];

    while (pendientes.length > 0) {
      const actual = pendientes.pop()!;
      if (vistos.has(actual)) continue;
      vistos.add(actual);

      for (const destino of importa(actual)) {
        if (destino === db) {
          culpables.set(fichero, actual);
          pendientes.length = 0;
          break;
        }

        try {
          if (statSync(destino).isFile()) pendientes.push(destino);
        } catch {
          // Un import que no resuelve a un fichero del repositorio (un paquete
          // con ruta relativa rara, un .d.ts que no está) no es asunto de esta
          // prueba: lo suyo lo dice el compilador.
        }
      }
    }
  }

  return culpables;
}

describe("el dominio de Therefore", () => {
  it("no importa db.ts, ni directamente ni a través de otro fichero", () => {
    const culpables = [...losQueLleganABaseDeDatos()].map(
      ([fichero, por]) =>
        fichero === por
          ? `${fichero} importa db.ts`
          : `${fichero} llega a db.ts a través de ${por}`
    );

    expect(culpables).toEqual([]);
  });

  it("la propia comprobación sirve: detecta un import de db.ts donde lo haya", () => {
    // Sin este caso, un error en el rastreo dejaría la prueba de arriba en
    // verde para siempre sin comprobar nada.
    const buzon = resolve(DOMINIO, "../buzon.ts");

    expect(importa(buzon)).toContain(resolve(DOMINIO, "../../db.ts"));
  });
});
