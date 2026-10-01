/**
 * Deja legible un fallo de la CI: qué prueba se ha roto y por qué.
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * Cuando la suite se pone roja en GitHub, averiguar qué ha fallado era
 * desproporcionadamente difícil:
 *
 *   · el log del job se descarga de un almacén aparte (blob) que las redes
 *     restringidas no alcanzan, así que a veces sencillamente no se puede leer;
 *   · y la API, que sí devuelve la COLA del log, devuelve en esa cola el log
 *     del contenedor de PostgreSQL, que se concatena al final y se come el
 *     resumen de vitest. Lo que se acaba leyendo son cien líneas de «duplicate
 *     key value violates…» de pruebas que esperaban fallar, y ni rastro del
 *     fallo de verdad.
 *
 * Pasó el 01/10: una ejecución en rojo y otra del MISMO commit en verde, sin
 * forma de saber qué se había roto. Se relanzó, salió verde y se mergeó sin
 * haber entendido nada, que es exactamente lo que no se quiere hacer.
 *
 * ── Por qué ANOTACIONES y no solo un artefacto ──────────────────────────────
 *
 * Las anotaciones de GitHub se leen por `api.github.com`, sin pasar por el
 * almacén de blobs. O sea: se pueden consultar desde cualquier sitio que llegue
 * a la API, que es justo donde fallaba todo lo demás. El artefacto se sube
 * igualmente —para quien pueda bajarlo— pero lo que garantiza que el fallo se
 * pueda leer es la anotación.
 *
 * ── El detalle que obliga a leer DOS fuentes ────────────────────────────────
 *
 * El informe JSON de vitest NO guarda el motivo cuando lo que revienta es un
 * `beforeAll`: el fichero sale como «failed», sus casos como «skipped», y
 * «failureMessages» vacío. Se comprobó a mano. Y ése es justo el caso que más
 * cuesta diagnosticar —un bloque entero rojo sin ninguna prueba fallada—, así
 * que para esos se saca el motivo de la salida de texto, que sí lo imprime bajo
 * «Failed Suites».
 */

/** Una línea del log de vitest, sin los colores de la terminal. */
function sinColores(texto) {
  // eslint-disable-next-line no-control-regex
  return String(texto ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * La ruta relativa al repositorio, que es lo que entiende una anotación.
 *
 * Una anotación con una ruta que no existe en el repositorio no se pinta sobre
 * el código: GitHub la deja suelta y se pierde media gracia. Y la raíz NO es la
 * misma aquí que en la CI —allí el repositorio se clona en
 * «/home/runner/work/mobilink/mobilink», con el nombre dos veces— así que se
 * usa `GITHUB_WORKSPACE` cuando lo hay, que es la raíz de verdad.
 *
 * Sin esa variable se recorta por la ÚLTIMA aparición de «/mobilink/», no por
 * la primera: con la primera, la ruta de la CI quedaba en
 * «mobilink/server/a.test.ts», un directorio que no existe.
 */
export function rutaRelativa(nombre, raiz = process.env.GITHUB_WORKSPACE ?? "") {
  const limpio = String(nombre ?? "").replace(/\\/g, "/");
  const base = String(raiz).replace(/\\/g, "/").replace(/\/+$/, "");
  if (base && limpio.startsWith(`${base}/`)) return limpio.slice(base.length + 1);
  const i = limpio.lastIndexOf("/mobilink/");
  return i >= 0 ? limpio.slice(i + "/mobilink/".length) : limpio.replace(/^\/+/, "");
}

/**
 * Los bloques rotos de un fichero, según la salida de texto.
 *
 * Vitest los imprime bajo «Failed Suites», que es una sección aparte de
 * «Failed Tests»: ahí van los `beforeAll` que revientan, y el JSON no los
 * cuenta —el fichero sale «failed», sus casos «skipped» y sin mensaje—.
 *
 * Se busca SOLO dentro de esa sección a propósito. Mirando el texto entero se
 * recogía también el encabezado de las pruebas falladas normales, que ya vienen
 * del JSON con mejor detalle, y cada fallo salía dos veces.
 */
export function suitesRotas(salida, rutaDelFichero) {
  const texto = sinColores(salida);
  const desde = texto.indexOf("Failed Suites");
  if (desde < 0) return [];

  const corto = rutaRelativa(rutaDelFichero);
  const lineas = texto.slice(desde).split("\n");
  const bloques = [];
  let actual = null;

  for (const linea of lineas) {
    const esFail = linea.includes("FAIL") && linea.includes(".test.");
    if (esFail) {
      if (actual) bloques.push(actual);
      actual = linea.includes(corto) ? { titulo: linea.trim(), lineas: [] } : null;
      continue;
    }
    if (!actual) continue;
    // La raya de separación cierra la sección entera.
    if (/^\s*⎯{3,}/.test(linea) || /^\s*Test Files\s/.test(linea)) {
      bloques.push(actual);
      actual = null;
      break;
    }
    // Con el mensaje y un poco de contexto basta para saber por dónde empezar;
    // el resto está en el artefacto.
    if (linea.trim() && actual.lineas.length < 5) actual.lineas.push(linea.trimEnd());
  }
  if (actual) bloques.push(actual);

  return bloques
    .map((b) => ({
      // «FAIL ruta > Nombre del bloque» → nos quedamos con el nombre.
      bloque: b.titulo.split(">").slice(1).join(">").trim() || null,
      mensaje: b.lineas.join("\n").trim(),
    }))
    .filter((b) => b.mensaje);
}

/**
 * Qué ha fallado, a partir del informe JSON y de la salida de texto.
 *
 * @param informe  el JSON de vitest (`--reporter=json`), ya parseado
 * @param salida   lo que vitest escribió por pantalla (puede faltar)
 * @returns `{ ok, fallos, totales }`
 */
export function resumir(informe, salida = "") {
  const ficheros = informe?.testResults ?? [];
  const fallos = [];

  for (const fichero of ficheros) {
    if (fichero.status !== "failed") continue;
    const ruta = rutaRelativa(fichero.name);
    const casos = (fichero.assertionResults ?? []).filter((c) => c.status === "failed");

    /*
     * Primero los bloques que ni llegaron a ejecutarse. Van ADEMÁS de las
     * pruebas falladas, no en su lugar: en un mismo fichero puede haber un
     * `describe` con una prueba rota y otro cuyo `beforeAll` revienta, y
     * contando solo las primeras el segundo se perdía entero.
     */
    for (const rota of suitesRotas(salida, fichero.name)) {
      fallos.push({
        fichero: ruta,
        caso: null,
        bloque: rota.bloque,
        mensaje: rota.mensaje,
      });
    }

    if (casos.length > 0) {
      for (const caso of casos) {
        const mensaje = sinColores(caso.failureMessages?.[0] ?? "")
          .split("\n")
          .filter((l) => l.trim())
          .slice(0, 4)
          .join("\n")
          .trim();
        fallos.push({
          fichero: ruta,
          caso: caso.fullName ?? caso.title ?? "",
          bloque: null,
          mensaje: mensaje || "Sin mensaje en el informe.",
        });
      }
      continue;
    }

    /*
     * Fichero rojo, sin pruebas rojas y sin que la salida de texto cuente nada:
     * pasa cuando no se ha guardado la salida. Al menos se nombra el fichero,
     * que ya es más de lo que se tenía.
     */
    if (!fallos.some((f) => f.fichero === ruta)) {
      fallos.push({
        fichero: ruta,
        caso: null,
        bloque: null,
        mensaje:
          sinColores(fichero.message ?? "").trim() ||
          "El fichero ha fallado sin ejecutar ninguna prueba y no se ha podido " +
            "recuperar el motivo. Mira el artefacto «resultado-pruebas».",
      });
    }
  }

  return {
    ok: fallos.length === 0,
    fallos,
    totales: {
      ficheros: ficheros.length,
      pruebas: informe?.numTotalTests ?? 0,
      falladas: informe?.numFailedTests ?? 0,
    },
  };
}

/** Escapa un valor para que quepa en una anotación de GitHub. */
export function escapar(texto) {
  return String(texto ?? "")
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

/** Las líneas `::error::` que GitHub convierte en anotaciones legibles. */
export function anotaciones(fallos) {
  return fallos.map((f) => {
    const titulo = f.caso
      ? `Prueba fallada - ${f.caso}`
      : f.bloque
        ? `Bloque que no llegó a ejecutarse - ${f.bloque}`
        : "Fichero fallado antes de ejecutar nada";
    // La coma y los dos puntos separan propiedades, así que no pueden ir crudos.
    const tituloLimpio = escapar(titulo).replace(/,/g, " ").replace(/::/g, " ");
    return `::error file=${f.fichero},title=${tituloLimpio}::${escapar(f.mensaje)}`;
  });
}

/** El resumen en Markdown que se ve en la página de la ejecución. */
export function markdown({ ok, fallos, totales }) {
  if (ok) {
    return `## Pruebas en verde\n\n${totales.pruebas} pruebas en ${totales.ficheros} ficheros.\n`;
  }
  const lineas = [
    `## ${fallos.length} fallo${fallos.length === 1 ? "" : "s"} en las pruebas`,
    "",
    `${totales.falladas} pruebas falladas de ${totales.pruebas}, en ${totales.ficheros} ficheros.`,
    "",
  ];
  for (const f of fallos) {
    lineas.push(`### \`${f.fichero}\``);
    if (f.caso) lineas.push(`**${f.caso}**`, "");
    else if (f.bloque) lineas.push(`**${f.bloque}** — no llegó a ejecutarse`, "");
    lineas.push("```", f.mensaje, "```", "");
  }
  return lineas.join("\n");
}

// Entrada de línea de órdenes: node ci-resumen-pruebas.mjs <informe.json> [salida.txt]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { appendFileSync, existsSync, readFileSync } = await import("node:fs");
  const rutaInforme = process.argv[2] ?? "/tmp/tests.json";
  const rutaSalida = process.argv[3] ?? "";

  if (!existsSync(rutaInforme)) {
    // Sin informe no hay nada que resumir, y tampoco es este script quien tiene
    // que poner el job en rojo: de eso ya se encarga el paso de las pruebas.
    console.log(`No hay informe de pruebas en ${rutaInforme}: nada que resumir.`);
    process.exit(0);
  }

  const informe = JSON.parse(readFileSync(rutaInforme, "utf8"));
  const salida = rutaSalida && existsSync(rutaSalida) ? readFileSync(rutaSalida, "utf8") : "";
  const resultado = resumir(informe, salida);

  for (const linea of anotaciones(resultado.fallos)) console.log(linea);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown(resultado));
  }

  if (resultado.ok) {
    console.log(`Pruebas en verde: ${resultado.totales.pruebas} en ${resultado.totales.ficheros} ficheros.`);
  } else {
    console.log(`\n${resultado.fallos.length} fallo(s). El detalle va arriba, como anotaciones.`);
  }
  // Siempre 0: esto informa, no juzga. Quien pone el job en rojo es `npm test`.
  process.exit(0);
}
