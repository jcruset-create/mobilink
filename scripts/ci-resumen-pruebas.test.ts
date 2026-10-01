import { describe, expect, it } from "vitest";

import {
  anotaciones,
  escapar,
  markdown,
  suitesRotas,
  resumir,
  rutaRelativa,
} from "./ci-resumen-pruebas.mjs";

/*
 * Los dos informes de abajo NO están inventados: son la forma real que saca
 * vitest, comprobada generando los dos fallos a propósito. Importa decirlo
 * porque el segundo —el del `beforeAll`— es contraintuitivo y es justo el que
 * este script existe para poder leer.
 */

/** Una prueba que falla: el caso sale «failed» y trae su mensaje. */
const INFORME_CASO_FALLADO = {
  numTotalTests: 2,
  numFailedTests: 1,
  testResults: [
    {
      name: "/home/user/mobilink/src/modules/ejemplo.test.ts",
      status: "failed",
      message: "",
      assertionResults: [
        {
          fullName: "bloque de ejemplo un caso que falla",
          title: "un caso que falla",
          status: "failed",
          failureMessages: [
            "AssertionError: expected 4 to be 5 // Object.is equality\n    at /home/user/mobilink/src/modules/ejemplo.test.ts:3:49\n    at file:///node_modules/@vitest/runner/dist/chunk.js:302:11",
          ],
        },
        { fullName: "bloque de ejemplo otro que pasa", status: "passed", failureMessages: [] },
      ],
    },
  ],
};

/**
 * Un `beforeAll` que revienta. Ojo a lo que NO hay aquí: «numFailedTests» es 0,
 * el caso sale «skipped» y «failureMessages» está vacío. El motivo del fallo no
 * aparece por ningún lado del JSON.
 */
const INFORME_SUITE_FALLADA = {
  numTotalTests: 1,
  numFailedTests: 0,
  testResults: [
    {
      name: "/home/user/mobilink/server/tacografos/tacografos.integration.test.ts",
      status: "failed",
      message: "",
      assertionResults: [
        { fullName: "Autorrelleno no llega a ejecutarse", status: "skipped", failureMessages: [] },
      ],
    },
  ],
};

/** Y la salida de texto de esa misma ejecución, que sí lo cuenta. */
const SALIDA_SUITE_FALLADA = `
 RUN  v4.1.10 /home/user/mobilink

 ❯ server/tacografos/tacografos.integration.test.ts (1 test | 1 skipped) 5ms

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/tacografos/tacografos.integration.test.ts > Autorrelleno con TyreControl presente
error: cannot change name of input parameter "p_empresa"
 ❯ server/tacografos/tacografos.integration.test.ts:736:14

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
`;

describe("una prueba fallada se cuenta entera", () => {
  it("dice fichero, caso y motivo", () => {
    const { ok, fallos } = resumir(INFORME_CASO_FALLADO);
    expect(ok).toBe(false);
    expect(fallos).toHaveLength(1);
    expect(fallos[0].fichero).toBe("src/modules/ejemplo.test.ts");
    expect(fallos[0].caso).toBe("bloque de ejemplo un caso que falla");
    expect(fallos[0].mensaje).toContain("expected 4 to be 5");
  });

  it("las que pasan no salen", () => {
    const { fallos } = resumir(INFORME_CASO_FALLADO);
    expect(fallos.some((f) => String(f.caso).includes("otro que pasa"))).toBe(false);
  });

  it("del mensaje se queda la cabeza, no la pila entera", () => {
    // La pila de llamadas de vitest son veinte líneas de node_modules que no
    // dicen nada; lo que importa cabe en las primeras.
    const { fallos } = resumir(INFORME_CASO_FALLADO);
    expect(fallos[0].mensaje.split("\n").length).toBeLessThanOrEqual(4);
  });
});

describe("un beforeAll que revienta, que es el caso difícil", () => {
  it("sin la salida de texto, el JSON no da el motivo, pero sí el fichero", () => {
    const { ok, fallos } = resumir(INFORME_SUITE_FALLADA);
    expect(ok).toBe(false);
    expect(fallos).toHaveLength(1);
    expect(fallos[0].fichero).toBe("server/tacografos/tacografos.integration.test.ts");
    expect(fallos[0].caso).toBeNull();
    expect(fallos[0].mensaje).toContain("no se ha podido recuperar el motivo");
  });

  it("con la salida de texto, se recupera el motivo de verdad", () => {
    const { fallos } = resumir(INFORME_SUITE_FALLADA, SALIDA_SUITE_FALLADA);
    expect(fallos[0].mensaje).toContain("cannot change name of input parameter");
  });

  it("se queda con el nombre del bloque, que es lo que se busca en el fichero", () => {
    const { fallos } = resumir(INFORME_SUITE_FALLADA, SALIDA_SUITE_FALLADA);
    expect(fallos[0].bloque).toBe("Autorrelleno con TyreControl presente");
  });

  it("el bloque se corta en la raya, sin tragarse el resumen final", () => {
    const [b] = suitesRotas(SALIDA_SUITE_FALLADA, "server/tacografos/tacografos.integration.test.ts");
    expect(b.mensaje).toContain("cannot change name");
    expect(b.mensaje).not.toContain("Test Files");
  });

  it("los colores de la terminal no ensucian el mensaje", () => {
    const conColores = SALIDA_SUITE_FALLADA.replace(
      "error: cannot",
      "\u001b[31merror:\u001b[39m cannot"
    );
    const [b] = suitesRotas(conColores, "server/tacografos/tacografos.integration.test.ts");
    expect(b.mensaje).not.toContain("\u001b");
    expect(b.mensaje).toContain("cannot change name");
  });

  it("solo se mira la sección «Failed Suites», no el texto entero", () => {
    // Bajo «Failed Tests» van las pruebas falladas normales, que ya vienen del
    // JSON con mejor detalle. Mirando el texto entero, cada una salía dos veces.
    const conAmbas = `
⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  server/otro.test.ts > un caso cualquiera
AssertionError: lo que sea

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
`;
    expect(suitesRotas(conAmbas, "server/otro.test.ts")).toEqual([]);
  });
});

describe("un fichero con una prueba rota Y un bloque que no arrancó", () => {
  /*
   * Pasa de verdad: un `describe` con una prueba fallada y otro cuyo
   * `beforeAll` revienta. Contando solo las pruebas falladas, el segundo
   * bloque se perdía entero y era justo el difícil de encontrar.
   */
  const INFORME = {
    numTotalTests: 2,
    numFailedTests: 1,
    testResults: [
      {
        name: "/home/user/mobilink/src/modules/mixto.test.ts",
        status: "failed",
        message: "",
        assertionResults: [
          {
            fullName: "un caso normal falla",
            status: "failed",
            failureMessages: ["AssertionError: expected 4 to be 5"],
          },
          { fullName: "el otro bloque no llega", status: "skipped", failureMessages: [] },
        ],
      },
    ],
  };
  const SALIDA = `
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/modules/mixto.test.ts > un beforeAll roto
Error: la base no estaba como se esperaba

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
`;

  it("salen los dos", () => {
    const { fallos } = resumir(INFORME, SALIDA);
    expect(fallos).toHaveLength(2);
    expect(fallos.some((f) => f.caso === "un caso normal falla")).toBe(true);
    expect(fallos.some((f) => f.bloque === "un beforeAll roto")).toBe(true);
  });

  it("y el del bloque lleva su motivo", () => {
    const { fallos } = resumir(INFORME, SALIDA);
    const bloque = fallos.find((f) => f.bloque);
    expect(bloque.mensaje).toContain("la base no estaba como se esperaba");
  });
});

describe("todo en verde", () => {
  it("no hay fallos que contar", () => {
    const { ok, fallos } = resumir({
      numTotalTests: 10,
      numFailedTests: 0,
      testResults: [{ name: "/x/mobilink/a.test.ts", status: "passed", assertionResults: [] }],
    });
    expect(ok).toBe(true);
    expect(fallos).toEqual([]);
  });

  it("un informe vacío o roto no revienta el script", () => {
    expect(resumir(null).ok).toBe(true);
    expect(resumir({}).ok).toBe(true);
  });
});

describe("las anotaciones, que son lo que de verdad se puede leer después", () => {
  /*
   * El log del job se baja de un almacén aparte que las redes restringidas no
   * alcanzan, y la cola que devuelve la API se la come el log de PostgreSQL.
   * Las anotaciones se leen por api.github.com, así que son el único canal que
   * aguanta. Por eso se cuida su formato.
   */
  it("llevan el fichero, para que GitHub las pinte sobre el código", () => {
    const [a] = anotaciones(resumir(INFORME_CASO_FALLADO).fallos);
    expect(a.startsWith("::error file=src/modules/ejemplo.test.ts,")).toBe(true);
  });

  it("los saltos de línea van escapados, o GitHub corta el mensaje", () => {
    const [a] = anotaciones([{ fichero: "a.ts", caso: "x", mensaje: "linea1\nlinea2" }]);
    expect(a).toContain("linea1%0Alinea2");
    expect(a.split("\n")).toHaveLength(1);
  });

  it("el porcentaje se escapa primero, o se estropean los demás escapes", () => {
    expect(escapar("100% \n")).toBe("100%25 %0A");
  });

  it("ni comas ni dos puntos en el título, que separan propiedades", () => {
    const [a] = anotaciones([
      { fichero: "a.ts", caso: "con, coma y :: dos puntos", mensaje: "lo que sea" },
    ]);
    const titulo = a.slice(a.indexOf("title="), a.indexOf("::", a.indexOf("title=")));
    expect(titulo).not.toContain(",");
  });
});

describe("el resumen que se ve en la página de la ejecución", () => {
  it("en rojo, nombra el fichero y el caso", () => {
    const md = markdown(resumir(INFORME_CASO_FALLADO));
    expect(md).toContain("src/modules/ejemplo.test.ts");
    expect(md).toContain("un caso que falla");
    expect(md).toContain("1 fallo en las pruebas");
  });

  it("en verde, lo dice y ya", () => {
    const md = markdown(resumir({ numTotalTests: 7, numFailedTests: 0, testResults: [] }));
    expect(md).toContain("Pruebas en verde");
    expect(md).toContain("7 pruebas");
  });
});

describe("las rutas se dan relativas al repositorio", () => {
  /*
   * Una anotación con una ruta que no existe no se pinta sobre el código, y
   * ahí se pierde media gracia. El caso que importa es el de la CI, donde el
   * repositorio se clona con el nombre DOS veces.
   */
  it("en la CI, donde «mobilink» sale dos veces en la ruta", () => {
    expect(
      rutaRelativa(
        "/home/runner/work/mobilink/mobilink/server/a.test.ts",
        "/home/runner/work/mobilink/mobilink"
      )
    ).toBe("server/a.test.ts");
  });

  it("y aunque no haya GITHUB_WORKSPACE, por la última aparición", () => {
    // Con la primera, esta ruta quedaba en «mobilink/server/a.test.ts»: un
    // directorio que no existe y una anotación que no se pinta.
    expect(rutaRelativa("/home/runner/work/mobilink/mobilink/server/a.test.ts", "")).toBe(
      "server/a.test.ts"
    );
  });

  it("en local", () => {
    expect(rutaRelativa("/home/user/mobilink/server/a.test.ts", "")).toBe("server/a.test.ts");
  });

  it("una ruta ya relativa se deja como está", () => {
    expect(rutaRelativa("server/a.test.ts", "")).toBe("server/a.test.ts");
  });
});
