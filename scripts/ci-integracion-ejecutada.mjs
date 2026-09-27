/**
 * Comprueba que las pruebas de integración se han ejecutado de verdad.
 *
 * ── Qué agujero cierra ──────────────────────────────────────────────────────
 *
 * Si las de integración se saltaran por un fallo de configuración, `npm test`
 * seguiría en verde y no nos enteraríamos. Eso es peor que no tenerlas: da
 * cobertura aparente. Así que después de la suite se mira el informe JSON y se
 * exige que cada fichero `*.integration.test.ts` haya ejecutado algo.
 *
 * ── Por qué es un script y no un heredoc en el workflow ─────────────────────
 *
 * Estuvo embebido en `.github/workflows/tests.yml` y eso lo hacía imposible de
 * ejecutar en local. Cuando `server/seguridadHttp.integration.test.ts` pasó a
 * gobernarse con su propia variable `RUN_HTTP_TESTS` (que la CI no pone), este
 * guarda empezó a fallar con razón —24 de 24 casos saltados— y la CI se quedó
 * en rojo **seis commits** sin que nadie lo viera, porque en local la suite
 * pasaba. Sacarlo a un fichero con pruebas propias es lo que impide que vuelva
 * a pasar.
 *
 * ── El salto legítimo, y por qué no se puede aceptar a la ligera ────────────
 *
 * Un fichero de integración puede saltarse **a propósito** si está detrás de
 * una variable adicional que la CI deliberadamente no pone. Eso no es un fallo
 * de configuración: es un arnés que se pide a mano.
 *
 * Pero aceptar «todo saltado» sin más devolvería el agujero original. Así que la
 * excepción es estrecha y tiene que cumplirse entera:
 *
 *   1. el fichero está en `GOBERNADOS_APARTE`, nombrado uno por uno;
 *   2. la variable que lo gobierna NO vale "1" en este entorno;
 *   3. todos sus casos están saltados, no fallados;
 *   4. y ha llegado a recolectar casos, o sea que la suite SÍ se cargó.
 *
 * Si la variable está puesta y el fichero se salta de todas formas, el salto ya
 * no es legítimo y se falla: significa que la suite no se cargó.
 */

/**
 * Ficheros de integración que se gobiernan con su propia variable, además de
 * `RUN_DB_TESTS`. Se nombran uno por uno a propósito: una lista explícita se
 * revisa, un patrón se olvida.
 */
export const GOBERNADOS_APARTE = {
  "server/seguridadHttp.integration.test.ts": "RUN_HTTP_TESTS",
};

/** El sufijo de ruta con el que se busca un fichero en la lista de arriba. */
function gobernadoAparte(nombre) {
  for (const [ruta, variable] of Object.entries(GOBERNADOS_APARTE)) {
    if (nombre === ruta || nombre.endsWith(`/${ruta}`)) return { ruta, variable };
  }
  return null;
}

/**
 * @param informe  el JSON de vitest (`--reporter=json`), ya parseado
 * @param entorno  las variables de entorno (`process.env`)
 * @returns `{ ok, lineas, error }` — `error` es el motivo del fallo, o null
 */
export function revisar(informe, entorno = {}) {
  const lineas = [];
  const ficheros = informe?.testResults ?? [];
  const integracion = ficheros.filter((t) => (t.name ?? "").includes("integration"));

  if (integracion.length === 0) {
    return { ok: false, lineas, error: "No se ha encontrado ningun fichero de pruebas de integracion." };
  }

  for (const t of integracion) {
    const nombre = t.name ?? "";
    const corto = nombre.split("/").pop();
    const casos = t.assertionResults ?? [];
    const pasados = casos.filter((c) => c.status === "passed");
    const saltados = casos.filter((c) => c.status === "skipped" || c.status === "pending");

    if (pasados.length > 0) {
      lineas.push(`${corto}: ${pasados.length}/${casos.length} casos en verde (fichero: ${t.status})`);
      continue;
    }

    const aparte = gobernadoAparte(nombre);
    const variablePuesta = aparte ? entorno[aparte.variable] === "1" : false;
    const todoSaltado = casos.length > 0 && saltados.length === casos.length;

    if (aparte && !variablePuesta && todoSaltado) {
      lineas.push(
        `${corto}: ${casos.length} casos saltados A PROPOSITO (${aparte.variable} no esta puesta). ` +
          `Se ejecuta a mano: RUN_DB_TESTS=1 ${aparte.variable}=1 npx vitest run ${aparte.ruta}`,
      );
      continue;
    }

    lineas.push(`${corto}: 0/${casos.length} casos en verde (fichero: ${t.status})`);

    if (casos.length === 0) {
      return {
        ok: false,
        lineas,
        error:
          `${corto} no ha recolectado ningun caso: la suite no se ha cargado. ` +
          "Revisa el error de carga mas arriba.",
      };
    }
    if (aparte && variablePuesta) {
      return {
        ok: false,
        lineas,
        error:
          `${corto} esta gobernado por ${aparte.variable}, que SI esta puesta, y aun asi no ha ` +
          "ejecutado nada. El salto no es legitimo: la suite no se ha cargado.",
      };
    }
    return {
      ok: false,
      lineas,
      error:
        `${corto} no ha ejecutado ninguna prueba de integracion. Si el salto es deliberado, ` +
        "anadelo a GOBERNADOS_APARTE en scripts/ci-integracion-ejecutada.mjs con la variable " +
        "que lo gobierna; si no, revisa el error de carga de la suite mas arriba.",
    };
  }

  return { ok: true, lineas, error: null };
}

// Entrada de línea de órdenes. Sin argumento usa la ruta que pone el workflow.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { existsSync, readFileSync } = await import("node:fs");
  const ruta = process.argv[2] ?? "/tmp/tests.json";

  if (!existsSync(ruta)) {
    console.error(`No se ha generado el informe de pruebas (${ruta}).`);
    process.exit(1);
  }

  const { ok, lineas, error } = revisar(JSON.parse(readFileSync(ruta, "utf8")), process.env);
  for (const l of lineas) console.log(l);
  if (!ok) {
    console.error(error);
    process.exit(1);
  }
  console.log(`${lineas.length} ficheros de integracion comprobados.`);
}
