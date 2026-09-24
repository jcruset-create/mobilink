import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Las columnas que este módulo nombra tienen que existir de verdad.
 *
 * Tres averías en producción por lo mismo, todas con el mismo síntoma —un 500
 * sin pista— y todas por nombrar una columna que el esquema no tiene:
 *
 *   1. `usesQuantity` en quick_templates: dejó el desplegable de operaciones
 *      del patio vacío.
 *   2. `workshopId` en quick_templates: lo mismo, otra vez, porque seguía en
 *      el WHERE cuando se quitó la primera.
 *   3. `standardMinutes` en jobs —es de quick_templates—: la conversión de
 *      una recepción en trabajo fallaba SIEMPRE.
 *
 * En Postgres una columna que no existe no devuelve null: tumba la consulta
 * entera. Y como los nombres de columna son cadenas, el compilador no mira
 * nada. Este test sí.
 *
 * Lee el SQL del router y lo compara con lo que `db.ts` crea de verdad.
 */

const RUTA_ROUTER = new URL("./router.ts", import.meta.url).pathname;
const RUTA_DB = new URL("../db.ts", import.meta.url).pathname;

/** Columnas que `db.ts` crea para una tabla, por CREATE o por ALTER. */
function columnasDe(tabla: string, sql: string): Set<string> {
  const cols = new Set<string>();

  // CREATE TABLE IF NOT EXISTS <tabla> ( ... )
  //
  // Se recorre contando paréntesis en vez de con una expresión regular: los
  // comentarios de dentro llevan paréntesis y comas, y cualquier atajo se
  // queda a medias sin decirlo, que es como un guarda deja de guardar.
  const marca = `CREATE TABLE IF NOT EXISTS ${tabla}`;
  let desde = sql.indexOf(marca);
  while (desde !== -1) {
    const abre = sql.indexOf("(", desde);
    if (abre === -1) break;
    let nivel = 0;
    let cierra = abre;
    for (let i = abre; i < sql.length; i++) {
      if (sql[i] === "(") nivel++;
      else if (sql[i] === ")") {
        nivel--;
        if (nivel === 0) { cierra = i; break; }
      }
    }
    for (const linea of sql.slice(abre + 1, cierra).split("\n")) {
      const limpia = linea.replace(/--.*$/, "");
      const m = limpia.match(/^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s+[A-Za-z]/);
      if (m && !/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)$/i.test(m[1])) {
        cols.add(m[1]);
      }
    }
    desde = sql.indexOf(marca, cierra);
  }

  // ALTER TABLE <tabla> ... ADD COLUMN IF NOT EXISTS "col"
  const alters = sql.matchAll(
    new RegExp(`ALTER TABLE ${tabla}\\s+ADD COLUMN IF NOT EXISTS\\s+"?([A-Za-z_][A-Za-z0-9_]*)"?`, "gs")
  );
  for (const a of alters) cols.add(a[1]);

  return cols;
}

/** Columnas que el router escribe en un INSERT INTO <tabla> ( ... ). */
function columnasDelInsert(tabla: string, sql: string): string[] {
  const m = sql.match(new RegExp(`INSERT INTO ${tabla}\\s*\\(([^)]*)\\)`, "s"));
  if (!m) return [];
  return m[1]
    .split(",")
    .map((c) => c.replace(/--.*$/gm, "").trim().replace(/^"|"$/g, ""))
    .filter((c) => c !== "");
}

describe("el router solo nombra columnas que existen", () => {
  const router = readFileSync(RUTA_ROUTER, "utf8");
  const db = readFileSync(RUTA_DB, "utf8");

  it("las del INSERT de conversión existen en jobs", () => {
    const declaradas = columnasDe("jobs", db);
    const usadas = columnasDelInsert("jobs", router);

    expect(usadas.length).toBeGreaterThan(10); // que no se haya dejado de leer
    const inexistentes = usadas.filter((c) => !declaradas.has(c));
    expect(inexistentes).toEqual([]);
  });

  it("las del INSERT de la recepción existen en recepciones_vehiculo", () => {
    const declaradas = columnasDe("recepciones_vehiculo", db);
    const usadas = columnasDelInsert("recepciones_vehiculo", router);

    expect(usadas.length).toBeGreaterThan(10);
    expect(usadas.filter((c) => !declaradas.has(c))).toEqual([]);
  });

  it("las de job_files existen", () => {
    const declaradas = columnasDe("job_files", db);
    const usadas = columnasDelInsert("job_files", router);
    expect(usadas.filter((c) => !declaradas.has(c))).toEqual([]);
  });

  /*
   * El test se cree a sí mismo: si el lector de columnas dejara de encontrar
   * nada, los de arriba pasarían en verde sin comprobar ni una línea.
   */
  it("el lector encuentra columnas de verdad", () => {
    const jobs = columnasDe("jobs", db);
    expect(jobs.has("plate")).toBe(true);
    expect(jobs.has("recepcionId")).toBe(true);
    expect(jobs.has("standardMinutes")).toBe(false); // ésa es de quick_templates
  });
});

/**
 * El id del trabajo tiene que CABER en la columna.
 *
 * Cuarta avería de la misma familia, y ésta la metí yo arreglando la tercera:
 * el id del trabajo pasó a ser `Date.now()` para que el navegador no lo
 * calculara mal. Pero `jobs.id` es SERIAL —INTEGER de cuatro bytes, máximo
 * 2.147.483.647— y un `Date.now()` anda por 1.758.000.000.000. Postgres lo
 * rechaza con «integer out of range» y la conversión no funcionó NUNCA desde
 * entonces.
 *
 * Es el mismo tipo de fallo que las tres anteriores —SQL que el compilador no
 * mira— pero por el TAMAÑO del valor y no por el nombre de la columna, así
 * que el guarda de arriba no lo veía. Éste sí.
 */
describe("el id del trabajo cabe en jobs.id", () => {
  const router = readFileSync(RUTA_ROUTER, "utf8");
  const db = readFileSync(RUTA_DB, "utf8");

  it("jobs.id sigue siendo de cuatro bytes, que es de donde viene el límite", () => {
    const creacion = db.slice(db.indexOf("CREATE TABLE IF NOT EXISTS jobs"));
    const tipoDelId = creacion.slice(0, creacion.indexOf(",")).toUpperCase();
    // Si algún día pasa a BIGINT este test falla, y está bien que falle:
    // querrá decir que hay que volver aquí y releer el comentario del router
    // antes de dar por buena cualquier otra forma de numerar.
    expect(tipoDelId).toContain("SERIAL");
  });

  it("la conversión no numera el trabajo con el reloj", () => {
    const conversion = router.slice(
      router.indexOf('"/recepcion-vehiculos/:id/convertir"'),
      router.indexOf('"/recepcion-vehiculos/:id/descartar"')
    );
    expect(conversion).not.toContain("jobId = Date.now()");
    // Se numera preguntándole a la base, no al navegador ni al reloj.
    expect(conversion).toContain("COALESCE(MAX(id), 0) + 1");
  });
});
