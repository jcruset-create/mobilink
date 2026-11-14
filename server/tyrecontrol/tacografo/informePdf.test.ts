import { describe, expect, it } from "vitest";

import {
  type LineaPdf, comoElExcel, copiasDelInforme, decimalDe, leerInformePdf,
  leerInformesDelPdf, marcada, sinCerosDelante, titularDe, valorDe, valorLargoDe,
  versionesDe,
} from "./informePdf.ts";

/**
 * Las pruebas del lector del informe en PDF.
 *
 * El parser trabaja sobre LÍNEAS CON SU CAJA, no sobre texto, y eso es lo que
 * aquí se construye: impresos de pega con la geometría real del formulario
 * —etiqueta a la izquierda, valor a la derecha y un punto más arriba, las
 * cabeceras de bloque a cuerpo 10 y el contenido a 8—. Así se puede probar
 * justo lo que se rompe en silencio: una cruz que cae en la casilla de al
 * lado, dos copias que no dicen lo mismo, una cabecera de bloque colada como
 * valor de un campo.
 *
 * Los seis informes reales del centro no están en el repositorio: llevan
 * matrículas, bastidores y el nombre y la tarjeta del técnico. La prueba que
 * los contrasta campo a campo contra producción está en
 * `informePdf.reales.test.ts` y se activa con una variable de entorno.
 */

const linea = (o: Partial<LineaPdf> & { texto: string }): LineaPdf => ({
  pagina: 1, x: 25, y: 100, w: o.texto.length * 4, h: 9, tamano: 8, ...o,
});

/** Una etiqueta con su valor a la derecha, como los coloca el impreso. */
function campo(etiqueta: string, valor: string | null, y: number, x = 25, pagina = 1): LineaPdf[] {
  const et = linea({ texto: etiqueta, x, y, pagina });
  if (valor == null) return [et];
  return [et, linea({ texto: valor, x: x + et.w + 10, y: y - 1, pagina })];
}

/** Una pareja SÍ/NO con su cruz, o sin ella. Las cajas en x=60 y x=117. */
function siNo(codSi: string, codNo: string, y: number, marca: "si" | "no" | "ninguna" | "ambas"): LineaPdf[] {
  const l: LineaPdf[] = [
    linea({ texto: `${codSi}. SÍ`, x: 25, y, w: 20 }),
    linea({ texto: "( )", x: 60, y, w: 7 }),
    linea({ texto: `${codNo}. NO`, x: 85, y, w: 20 }),
    linea({ texto: "( )", x: 117, y, w: 7 }),
  ];
  // La cruz va un punto por encima de la caja, como en el impreso de verdad.
  if (marca === "si" || marca === "ambas") l.push(linea({ texto: "x", x: 62, y: y - 1, w: 4 }));
  if (marca === "no" || marca === "ambas") l.push(linea({ texto: "x", x: 119, y: y - 1, w: 4 }));
  return l;
}

interface Opciones {
  a1?: string;
  matricula?: string;
  tipo?: string;
  resultado?: "favorable" | "desfavorable" | "ninguna" | "ambas";
  km?: { e27: string; s78: string };
  i46?: string[];
  pagina?: number;
  sin?: string[];
}

/** Un impreso entero de pega, en una página. */
function impreso(o: Opciones = {}): LineaPdf[] {
  const p = o.pagina ?? 1;
  const sin = new Set(o.sin ?? []);
  const l: LineaPdf[] = [linea({ texto: "INFORME TÉCNICO TACÓGRAFO DIGITAL", y: 20, tamano: 10, pagina: p })];

  const pon = (etiqueta: string, valor: string | null, y: number, x = 25) => {
    if (sin.has(etiqueta.split(/[.:]/)[0])) return;
    l.push(...campo(etiqueta, valor, y, x, p));
  };

  pon("A1. Nº de orden de la intervención:", o.a1 ?? "E943009005405X", 60);
  pon("A3. Fecha:", "04-11-2026 11:22:37", 80);
  pon("E22.Matrícula:", o.matricula ?? "8235JDF", 100);
  pon("E23.Bastidor:", "YV3T7U520FA170454", 120);
  pon("E25. Marca:", "Volvo", 140);
  pon("E27. Lectura del cuentakilómetros:", o.km?.e27 ?? "652259", 160);
  pon("E28. Tamaño de los neumáticos que incorpora:", "295/80R22.5", 180);
  pon("I41. Nombre del fabricante:", "Aumovio Germany GmbH", 200);
  pon("I42. Número de pieza de la VU:", "1381.7550303007", 220);
  pon("I44. Número de serie de la VU:", "840533", 240);
  pon("S73.", "10399", 260);
  pon("S74.", "10399", 280);
  pon("S75.", "3248", 300);
  pon("S78.", o.km?.s78 ?? "652266", 320);

  // El bloque D: cabecera a cuerpo 10 y el tipo debajo, a 8.
  l.push(linea({ texto: "D. TIPO DE INTERVENCIÓN", x: 165, y: 340, tamano: 10, pagina: p }));
  l.push(linea({ texto: "REALIZADA", x: 165, y: 352, tamano: 10, pagina: p }));
  if (!sin.has("D")) {
    for (const [i, t] of (o.tipo ?? "Control periódico de un tacógrafo + Calibrado de un tacógrafo")
      .split(" + ").entries()) {
      l.push(linea({ texto: t, x: 165, y: 365 + i * 10, pagina: p }));
    }
  }
  l.push(linea({ texto: "G. PLACA DE", x: 165, y: 395, tamano: 10, pagina: p }));

  // V85 FAVORABLE / V86 DESFAVORABLE, con sus cajas a mano.
  const res = o.resultado ?? "favorable";
  l.push(
    linea({ texto: "V85.", x: 308, y: 420, w: 16, pagina: p }),
    linea({ texto: "( )", x: 338, y: 420, w: 7, pagina: p }),
    linea({ texto: "FAVORABLE", x: 353, y: 419, pagina: p }),
    linea({ texto: "V86.", x: 441, y: 420, w: 16, pagina: p }),
    linea({ texto: "( )", x: 471, y: 420, w: 7, pagina: p }),
    linea({ texto: "DESFAVORABLE", x: 486, y: 419, pagina: p }),
  );
  if (res === "favorable" || res === "ambas") l.push(linea({ texto: "x", x: 340, y: 419, w: 4, pagina: p }));
  if (res === "desfavorable" || res === "ambas") l.push(linea({ texto: "x", x: 473, y: 419, w: 4, pagina: p }));

  for (const t of (o.i46 ?? ["/"])) {
    l.push(linea({ texto: t, x: 440 + (o.i46 ?? ["/"]).indexOf(t) * 30, y: 440, pagina: p }));
  }
  l.push(linea({ texto: "I46. Versión de mapa y software:", x: 310, y: 440, w: 116, pagina: p }));

  l.push(linea({ texto: "Ejemplar para el taller", x: 492, y: 800, pagina: p }));
  return l;
}

describe("marcada()", () => {
  /*
   * La trampa que da nombre al módulo. Leído como texto, el impreso dice
   *
   *     N63. SÍ ( )
   *     x N64. NO ( )
   *
   * y cualquiera diría que lo marcado es NO. La cruz está en x=62 y la caja
   * de N63 ocupa de 60 a 67: lo marcado es SÍ.
   */
  it("la cruz cuenta para la casilla en la que CAE, no para la etiqueta siguiente", () => {
    expect(marcada(siNo("N63", "N64", 100, "si"), "N63")).toBe(true);
    expect(marcada(siNo("N63", "N64", 100, "si"), "N64")).toBe(false);
  });

  it("y la de la derecha igual, sin contagiar a la de la izquierda", () => {
    expect(marcada(siNo("N59", "N60", 100, "no"), "N59")).toBe(false);
    expect(marcada(siNo("N59", "N60", 100, "no"), "N60")).toBe(true);
  });

  it("sin cruz no hay nada marcado", () => {
    const l = siNo("Z87", "Z88", 100, "ninguna");
    expect(marcada(l, "Z87")).toBe(false);
    expect(marcada(l, "Z88")).toBe(false);
  });

  it("una cruz de otra fila no marca esta", () => {
    const l = [...siNo("K52", "K53", 100, "ninguna"), ...siNo("L54", "L55", 140, "si")];
    expect(marcada(l, "K52")).toBe(false);
    expect(marcada(l, "L54")).toBe(true);
  });
});

describe("valorDe()", () => {
  it("coge el valor de la derecha, no el del campo de al lado", () => {
    const l = [...campo("E22.Matrícula:", "8235JDF", 100, 310),
      ...campo("E23.Bastidor:", "YV3T7U520FA170454", 100, 416)];
    expect(valorDe(l, "E22")).toBe("8235JDF");
    expect(valorDe(l, "E23")).toBe("YV3T7U520FA170454");
  });

  /*
   * El caso real: la etiqueta «C13. Fecha de caducidad de la tarjeta…» tiene
   * a dos puntos de distancia, y a su derecha, la segunda línea del título
   * del bloque de al lado. Sin distinguir cuerpo 10 de cuerpo 8, la fecha de
   * caducidad de la tarjeta del técnico vale «INSTALACIÓN DEL».
   */
  it("una cabecera de bloque no es el valor de un campo", () => {
    const l = [
      linea({ texto: "C13. Fecha de caducidad de la", x: 25, y: 307, w: 110 }),
      linea({ texto: "tarjeta del centro de ensayo:", x: 25, y: 317, w: 100 }),
      linea({ texto: "INSTALACIÓN DEL", x: 165, y: 309, tamano: 10 }),
      linea({ texto: "08-01-2027", x: 25, y: 331, w: 40 }),
    ];
    expect(valorDe(l, "C13")).toBe("08-01-2027");
  });

  // En la portada el valor va debajo, y la etiqueta puede ocupar dos líneas.
  it("también lo lee debajo, con la etiqueta partida en dos líneas", () => {
    const l = [
      linea({ texto: "C12. Identificación completa de la", x: 25, y: 267, w: 120 }),
      linea({ texto: "tarjeta del centro de ensayo:", x: 25, y: 277, w: 100 }),
      linea({ texto: "EA43044379001308 (G2)", x: 25, y: 291, w: 91 }),
    ];
    expect(valorDe(l, "C12")).toBe("EA43044379001308 (G2)");
  });

  it("un campo vacío es null y no se trae el de abajo", () => {
    const l = [
      ...campo("E27. Lectura del cuentakilómetros:", null, 339, 310),
      ...campo("E28. Tamaño de los neumáticos que incorpora:", null, 356, 310),
      ...campo("E29. Marca del neumático:", null, 373, 310),
    ];
    expect(valorDe(l, "E27")).toBeNull();
  });
});

describe("valorLargoDe() y titularDe()", () => {
  it("el nombre del técnico, que el impreso parte en dos líneas", () => {
    const l = [
      linea({ texto: "C11. Nombre y apellidos:", x: 25, y: 232, w: 89 }),
      linea({ texto: "PEDRO RAMON FERRAN", x: 25, y: 244, w: 96 }),
      linea({ texto: "GONZALEZ", x: 25, y: 254, w: 44 }),
      linea({ texto: "C12. Identificación completa de la", x: 25, y: 267, w: 120 }),
    ];
    expect(valorLargoDe(l, "C11")).toBe("PEDRO RAMON FERRAN GONZALEZ");
  });

  /*
   * El titular trae delante el código de cliente y debajo la dirección, y el
   * Excel guarda solo la razón social. Y empieza CINCO puntos por encima de
   * su etiqueta, porque el recuadro va centrado.
   */
  it("el titular, sin el código de cliente y sin la dirección", () => {
    const l = [
      linea({ texto: "E26. Titular:", x: 310, y: 280, w: 43 }),
      linea({ texto: "(B43009091) TERESA Y JOSE PLANA EMPRESA", x: 385, y: 275 }),
      linea({ texto: "PLANA S.L.", x: 525, y: 285 }),
      linea({ texto: "LES CREUS, 29. 43120 CONSTANTI - Tarragona", x: 389, y: 302 }),
    ];
    expect(titularDe(l)).toBe("TERESA Y JOSE PLANA EMPRESA PLANA S.L.");
  });
});

describe("versionesDe()", () => {
  /*
   * I46 son DOS versiones separadas por una barra, y la barra es un objeto de
   * texto aparte y más a la izquierda que el valor. Coger «el valor más a la
   * izquierda» devuelve la barra, y el campo sale vacío.
   */
  it("la barra no es la versión: el software está a su derecha", () => {
    const l = [
      linea({ texto: "I46. Versión de mapa y software:", x: 310, y: 595, w: 116 }),
      linea({ texto: "/", x: 504, y: 596, w: 2 }),
      linea({ texto: "PABF.S0L", x: 520, y: 595, w: 38 }),
    ];
    expect(versionesDe(l)).toEqual({ mapa: null, software: "PABF.S0L" });
  });

  it("con las dos versiones, cada una en su campo", () => {
    const l = [
      linea({ texto: "I46. Versión de mapa y software:", x: 310, y: 595, w: 116 }),
      linea({ texto: "20220901", x: 470, y: 595 }),
      linea({ texto: "/", x: 504, y: 596, w: 2 }),
      linea({ texto: "021.010", x: 520, y: 595 }),
    ];
    expect(versionesDe(l)).toEqual({ mapa: "20220901", software: "021.010" });
  });

  it("vacío es vacío, no una barra", () => {
    const l = [
      linea({ texto: "I46. Versión de mapa y software:", x: 310, y: 595, w: 116 }),
      linea({ texto: "/", x: 504, y: 596, w: 2 }),
    ];
    expect(versionesDe(l)).toEqual({ mapa: null, software: null });
  });
});

describe("normalizadores", () => {
  // El impreso puntúa los códigos largos y el Excel los guarda pelados.
  it("comoElExcel() quita los puntos de un código numérico", () => {
    expect(comoElExcel("1381.7550303007")).toBe("13817550303007");
    expect(comoElExcel("021.010")).toBe("21010");
  });

  // Pero `012.00E` y `PABF.S0L` viven así en producción: llevan letras.
  it("y deja en paz lo que no es un número", () => {
    expect(comoElExcel("PABF.S0L")).toBe("PABF.S0L");
    expect(comoElExcel("012.00E")).toBe("012.00E");
  });

  it("sinCerosDelante() solo cuando es todo dígitos", () => {
    expect(sinCerosDelante("00499")).toBe("499");
    expect(sinCerosDelante("voiliv006860217")).toBe("voiliv006860217");
  });

  // «0,0» y «0» en el mismo jsonb son dos ceros que alguien compararía.
  it("decimalDe() escribe el número como el Excel", () => {
    expect(decimalDe("0,0")).toBe("0");
    expect(decimalDe("-0,2 s / 24 h")).toBe("-0.2");
    expect(decimalDe("1105")).toBe("1105");
    expect(decimalDe("Ok")).toBeNull();
  });
});

describe("copiasDelInforme()", () => {
  it("cada «Ejemplar para el…» cierra una copia", () => {
    const dos = [...impreso({ pagina: 1 }), ...impreso({ pagina: 2 })];
    expect(copiasDelInforme(dos)).toHaveLength(2);
  });

  it("un impreso sin ejemplar sigue siendo una copia", () => {
    const l = impreso().filter((x) => !/Ejemplar/.test(x.texto));
    expect(copiasDelInforme(l)).toHaveLength(1);
  });
});

describe("leerInformePdf()", () => {
  it("lee el impreso completo", () => {
    const r = leerInformePdf(impreso());
    expect(r.problemas).toEqual([]);
    expect(r.fila).toMatchObject({
      idOrigen: "E943009005405X",
      fecha: "2026-11-04",
      matriculaNorm: "8235JDF",
      tipoOperacion: "Calibrado o Parametrización / Control / Reparación",
      resultado: "Favorable",
      medidaNorm: "295/80R22.5",
      paramW: "10399",
      referencia: "13817550303007",
      numSerie: "840533",
      tipoTacografo: "Digital",
    });
  });

  /*
   * Trampa 3. El Excel llama a sus columnas «viejo» y «nuevo» pero guarda al
   * revés: 1.529 de las 1.543 filas de producción tienen el «anterior» más
   * alto. Aquí se hace igual, porque la ficha enseña `kmNuevo` y una fila
   * creada del PDF con el otro criterio saldría descolocada entre sus
   * vecinas.
   */
  it("kmAnterior es la lectura de DESPUÉS (S78), como en las 1.744 filas que ya están", () => {
    const r = leerInformePdf(impreso({ km: { e27: "652259", s78: "652266" } }));
    expect(r.fila!.kmNuevo).toBe(652259);
    expect(r.fila!.kmAnterior).toBe(652266);
    expect(r.fila!.kmAnterior!).toBeGreaterThan(r.fila!.kmNuevo!);
  });

  it("el fabricante se guarda con la marca del Excel, no con la razón social", () => {
    expect(leerInformePdf(impreso()).fila!.fabricante).toBe("VDO");
  });

  it("y uno desconocido se guarda tal cual, avisando", () => {
    const l = impreso({ sin: ["I41"] });
    l.push(...campo("I41. Nombre del fabricante:", "Tacógrafos Pepe S.L.", 200));
    const r = leerInformePdf(l);
    expect(r.fila!.fabricante).toBe("Tacógrafos Pepe S.L.");
    expect(r.problemas.some((p) => p.motivo.includes("no es ninguna de las marcas"))).toBe(true);
  });

  describe("el resultado, que es lo que mueve el vencimiento", () => {
    it("V85 marcada es Favorable", () => {
      expect(leerInformePdf(impreso({ resultado: "favorable" })).fila!.resultado).toBe("Favorable");
    });

    it("V86 marcada es Desfavorable", () => {
      expect(leerInformePdf(impreso({ resultado: "desfavorable" })).fila!.resultado).toBe("Desfavorable");
    });

    // Las 449 filas sin resultado de producción llevan «-----», no null: en
    // una transferencia no se informa, y eso no es lo mismo que no saberlo.
    it("ninguna marcada es «-----», como en las transferencias del Excel", () => {
      expect(leerInformePdf(impreso({ resultado: "ninguna" })).fila!.resultado).toBe("-----");
    });

    it("las dos marcadas es un impreso mal rellenado, y se dice", () => {
      const r = leerInformePdf(impreso({ resultado: "ambas" }));
      expect(r.fila!.resultado).toBeNull();
      expect(r.problemas.some((p) => p.motivo.includes("FAVORABLE y DESFAVORABLE"))).toBe(true);
    });
  });

  describe("el tipo de intervención", () => {
    it("«Transferencia de datos + Sustitución» es la familia de transferencias", () => {
      const r = leerInformePdf(impreso({ tipo: "Transferencia de datos + Sustitución de un tacógrafo" }));
      expect(r.fila!.tipoOperacion)
        .toBe("Transferencia / Certificado de intransferibilidad / Sustitución");
    });

    /*
     * Un tipo que no se reconoce NO cae en la categoría más probable: se deja
     * a null y se dice. `tipo_operacion` es lo que mira el vencimiento, y uno
     * mal puesto le cambia la fecha a un autobús.
     */
    it("uno que no se reconoce se queda sin categoría y lo dice", () => {
      const r = leerInformePdf(impreso({ tipo: "Revisión del limpiaparabrisas" }));
      expect(r.fila!.tipoOperacion).toBeNull();
      expect(r.problemas.some((p) => p.motivo.includes("no se reconoce"))).toBe(true);
    });

    it("y uno que encaja en dos tampoco se elige a dedo", () => {
      const r = leerInformePdf(impreso({ tipo: "Instalación de un tacógrafo + Calibrado de un tacógrafo" }));
      expect(r.fila!.tipoOperacion).toBeNull();
      expect(r.problemas.some((p) => p.motivo.includes("más de una categoría"))).toBe(true);
    });

    it("sin bloque D, se dice", () => {
      const r = leerInformePdf(impreso({ sin: ["D"] }));
      expect(r.problemas.some((p) => p.motivo.includes("bloque D"))).toBe(true);
    });
  });

  describe("las dos copias del impreso", () => {
    it("si dicen lo mismo, sale una sola intervención", () => {
      const r = leerInformePdf([...impreso({ pagina: 1 }), ...impreso({ pagina: 2 })]);
      expect(r.copias).toBe(2);
      expect(r.problemas).toEqual([]);
      expect(r.fila!.idOrigen).toBe("E943009005405X");
    });

    /*
     * Y si no, no se elige ninguna. Un impreso con dos kilometrajes distintos
     * del mismo campo es un impreso que hay que mirar a mano, no un problema
     * de desempate.
     */
    it("si discrepan, no se elige ninguna y se dice en qué", () => {
      const r = leerInformePdf([
        ...impreso({ pagina: 1 }),
        ...impreso({ pagina: 2, km: { e27: "999999", s78: "652266" } }),
      ]);
      expect(r.fila).toBeNull();
      expect(r.problemas.some((p) => p.motivo.includes("no dicen lo mismo en «kmNuevo»"))).toBe(true);
    });
  });

  describe("lo que no se puede leer", () => {
    it("sin A1 no hay intervención que identificar", () => {
      const r = leerInformePdf(impreso({ sin: ["A1"] }));
      expect(r.fila).toBeNull();
      expect(r.problemas[0].motivo).toContain("A1");
    });

    it("sin fecha tampoco, que es lo que la sitúa en el histórico", () => {
      const r = leerInformePdf(impreso({ sin: ["A3"] }));
      expect(r.fila).toBeNull();
      expect(r.problemas[0].motivo).toContain("fecha");
    });

    it("sin matrícula tampoco", () => {
      const r = leerInformePdf(impreso({ sin: ["E22"] }));
      expect(r.fila).toBeNull();
      expect(r.problemas[0].motivo).toContain("matrícula");
    });

    it("otro PDF cualquiera no se intenta interpretar", () => {
      const r = leerInformePdf([linea({ texto: "FACTURA Nº 2026/114" })]);
      expect(r.fila).toBeNull();
      expect(r.problemas[0].motivo).toContain("no parece un informe técnico");
    });

    it("un PDF sin texto se dice que no se puede leer", () => {
      const r = leerInformePdf([]);
      expect(r.fila).toBeNull();
      expect(r.copias).toBe(0);
      expect(r.problemas[0].motivo).toContain("no tiene texto");
    });
  });
});

describe("leerInformesDelPdf(), varias intervenciones en un PDF", () => {
  /*
   * El centro entrega los informes de uno en uno, pero nada impide juntar el
   * mes entero en un fichero y reenviarlo tal cual. Agrupar por A1 —y no por
   * «cada dos copias, una»— es lo que hace que esto funcione aunque los
   * ejemplares vengan desordenados o falte uno.
   */
  const dos = () => [
    ...impreso({ pagina: 1 }),
    ...impreso({ pagina: 2 }),
    ...impreso({ pagina: 3, a1: "E943009005411D", matricula: "9832LXT" }),
    ...impreso({ pagina: 4, a1: "E943009005411D", matricula: "9832LXT" }),
  ];

  it("dos intervenciones con sus dos ejemplares cada una", () => {
    const r = leerInformesDelPdf(dos());
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.fila!.idOrigen)).toEqual(["E943009005405X", "E943009005411D"]);
    expect(r.map((x) => x.copias)).toEqual([2, 2]);
    expect(r.flatMap((x) => x.problemas)).toEqual([]);
  });

  // Las páginas de ESTA intervención, no las del fichero entero: lo que se
  // guarda del documento tiene que hablar del informe, no del sobre.
  it("cada una cuenta sus páginas, no las del PDF entero", () => {
    expect(leerInformesDelPdf(dos()).map((x) => x.paginas)).toEqual([2, 2]);
  });

  it("cada una con su matrícula, no la de la primera", () => {
    const r = leerInformesDelPdf(dos());
    expect(r.map((x) => x.fila!.matriculaNorm)).toEqual(["8235JDF", "9832LXT"]);
  });

  it("aunque los ejemplares vengan mezclados", () => {
    const mezclado = [
      ...impreso({ pagina: 1 }),
      ...impreso({ pagina: 2, a1: "E943009005411D", matricula: "9832LXT" }),
      ...impreso({ pagina: 3 }),
      ...impreso({ pagina: 4, a1: "E943009005411D", matricula: "9832LXT" }),
    ];
    const r = leerInformesDelPdf(mezclado);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.copias === 2)).toBe(true);
  });

  it("y un ejemplar suelto también es una intervención", () => {
    const r = leerInformesDelPdf([
      ...impreso({ pagina: 1 }),
      ...impreso({ pagina: 2, a1: "E943009005411D", matricula: "9832LXT" }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.copias)).toEqual([1, 1]);
  });

  /*
   * Y lo importante: una que no se puede leer NO se lleva por delante a las
   * demás. Un fichero con diez informes y uno roto importa nueve y dice qué
   * pasa con el décimo.
   */
  it("una intervención con las copias discrepantes no tumba a las demás", () => {
    const r = leerInformesDelPdf([
      ...impreso({ pagina: 1 }),
      ...impreso({ pagina: 2, km: { e27: "999999", s78: "652266" } }),
      ...impreso({ pagina: 3, a1: "E943009005411D", matricula: "9832LXT" }),
      ...impreso({ pagina: 4, a1: "E943009005411D", matricula: "9832LXT" }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].fila).toBeNull();
    expect(r[0].problemas.some((p) => p.motivo.includes("no dicen lo mismo"))).toBe(true);
    expect(r[1].fila!.idOrigen).toBe("E943009005411D");
  });

  it("una copia ilegible se queda con su problema y no se pierde", () => {
    const r = leerInformesDelPdf([
      ...impreso({ pagina: 1 }),
      ...impreso({ pagina: 2, sin: ["A1"] }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].fila!.idOrigen).toBe("E943009005405X");
    expect(r[1].fila).toBeNull();
    expect(r[1].problemas[0].motivo).toContain("A1");
  });

  it("un PDF sin texto lo dice una sola vez", () => {
    const r = leerInformesDelPdf([]);
    expect(r).toHaveLength(1);
    expect(r[0].problemas[0].motivo).toContain("no tiene texto");
  });
});

describe("leerInformePdf(), el de la ficha: una y solo una", () => {
  it("con una, la devuelve", () => {
    expect(leerInformePdf(impreso()).fila!.idOrigen).toBe("E943009005405X");
  });

  /*
   * Elegir la primera dejaría las demás sin adjuntar y sin que nadie se
   * entere, que es peor que no hacer nada.
   */
  it("con varias no elige: lo dice y manda a la importación", () => {
    const r = leerInformePdf([
      ...impreso({ pagina: 1 }),
      ...impreso({ pagina: 2, a1: "E943009005411D", matricula: "9832LXT" }),
    ]);
    expect(r.fila).toBeNull();
    expect(r.problemas[0].motivo).toContain("2 intervenciones");
    expect(r.problemas[0].motivo).toContain("E943009005411D");
  });
});
