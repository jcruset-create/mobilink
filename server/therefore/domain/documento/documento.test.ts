/**
 * El parser de albaranes, pieza a pieza.
 *
 * Todos los valores son inventados. No es una formalidad: un parser afinado
 * contra los números de un documento real acierta con ese documento y con
 * ninguno más, y además este repositorio es público. Lo que se prueba aquí es
 * la MECÁNICA —que la rejilla reparte por posición, que los descuentos
 * encadenados no se colapsan, que una fila que no cuadra baja la confianza de
 * toda la fila—, y esa mecánica es la misma con cualquier número.
 *
 * Las filas se escriben a mano con sus coordenadas. Es más trabajo que generar
 * un PDF y es lo que permite montar en tres líneas el caso que en papel
 * costaría media hora: un albarán partido entre dos páginas con la cabecera
 * repetida en la misma posición.
 */

import { describe, expect, it } from "vitest";
import { conceptoGlobal, esArrastre, esCabeceraDeTotales, esConcepto, totalDocumento } from "./conceptos.ts";
import { parserGenerico } from "./generico.ts";
import { factorRestante, leerDescuentos } from "./descuentos.ts";
import { extraerComplementarios } from "./complementarios.ts";
import { extraerLineas, sumaDeLineas } from "./lineas.ts";
import { localizarAlbaranes } from "./secciones.ts";
import {
  SINONIMOS_COLUMNA_POR_DEFECTO,
  detectarRejilla,
  repartirEnColumnas,
  titulosEnLaFila,
} from "./tabla.ts";
import { analizarAlbaran, seleccionarParser } from "./index.ts";
import { cajasDelAlbaran, paginasResaltadas } from "./resaltado.ts";
import { aplanar, type DocumentoTexto, type LineaTexto } from "./tipos.ts";

/* ── Ayudantes para escribir páginas a mano ───────────────────────────────── */

/** Una fila: `[texto, x]` por celda, todas a la misma altura. */
function fila(pagina: number, y: number, celdas: [string, number][]): LineaTexto {
  const palabras = celdas.flatMap(([texto, x]) => {
    // Cada palabra ocupa 5 pt por carácter: basta para que las cajas no se
    // solapen y para que el centro caiga donde tiene que caer.
    let cursor = x;
    return texto.split(" ").map((t) => {
      const p = { texto: t, x: cursor, y, w: t.length * 5, h: 10 };
      cursor += t.length * 5 + 5;
      return p;
    });
  });
  const x = Math.min(...palabras.map((p) => p.x));
  const derecha = Math.max(...palabras.map((p) => p.x + p.w));
  return {
    pagina,
    x,
    y,
    w: derecha - x,
    h: 10,
    tamano: 10,
    texto: palabras.map((p) => p.texto).join(" "),
    palabras,
  };
}

const CABECERA_TABLA: [string, number][] = [
  ["Ref", 40],
  ["Descripcion", 110],
  ["Cant", 300],
  ["Precio", 350],
  ["Dto", 430],
  ["Importe", 500],
];

function lineaArticulo(
  pagina: number,
  y: number,
  ref: string,
  desc: string,
  cant: string,
  precio: string,
  dto: string,
  importe: string
): LineaTexto {
  return fila(pagina, y, [
    [ref, 40],
    [desc, 110],
    [cant, 300],
    [precio, 350],
    [dto, 430],
    [importe, 500],
  ]);
}

function documento(paginas: { numero: number; lineas: LineaTexto[] }[]): DocumentoTexto {
  return { paginas: paginas.map((p) => ({ ...p, ancho: 595, alto: 842 })) };
}

/* ── Conceptos ───────────────────────────────────────────────────────────── */

describe("conceptos globales y totales", () => {
  it("«Portes» es un concepto global y no cierra la sección", () => {
    expect(conceptoGlobal("Portes")).toBe("portes");
    expect(totalDocumento("Portes")).toBeNull();
  });

  it("«Base imponible» es un total de documento", () => {
    expect(totalDocumento("Base imponible")).toBe("base imponible");
  });

  it("gana la etiqueta más larga: «base imponible» antes que «base»", () => {
    expect(totalDocumento("Base imponible")).toBe("base imponible");
  });

  it("un artículo que MENCIONA portes no es un concepto", () => {
    // La etiqueta va delante porque es el nombre de la fila; si estuviera en
    // medio, media tabla de recambios se convertiría en conceptos.
    expect(esConcepto("Filtro de aceite con portes incluidos")).toBe(false);
  });

  it("los puntos de relleno no estorban", () => {
    expect(conceptoGlobal("Portes .........")).toBe("portes");
  });
});

/* ── Descuentos ──────────────────────────────────────────────────────────── */

describe("descuentos", () => {
  it("«60% + 10%» son DOS descuentos en orden, no uno del 64 %", () => {
    const d = leerDescuentos("60% + 10%");
    expect(d.descuentos).toEqual([
      { orden: 1, porcentaje: 60, raw: "60%" },
      { orden: 2, porcentaje: 10, raw: "10%" },
    ]);
    expect(d.raw).toBe("60% + 10%");
    expect(d.reconocido).toBe(true);
  });

  it("el factor encadenado es el producto, y no se guarda como porcentaje", () => {
    expect(factorRestante(leerDescuentos("60% + 10%").descuentos)).toBeCloseTo(0.36, 10);
  });

  it("admite decimales y otros separadores", () => {
    expect(leerDescuentos("7,5% / 2%").descuentos.map((x) => x.porcentaje)).toEqual([7.5, 2]);
  });

  it("un número sin símbolo en la columna de descuento cuenta como descuento", () => {
    expect(leerDescuentos("40").descuentos).toHaveLength(1);
  });

  it("un guion es «sin descuento», no basura", () => {
    const d = leerDescuentos("-");
    expect(d.descuentos).toHaveLength(0);
    expect(d.reconocido).toBe(true);
  });

  it("lo que no se entiende se marca, no se tira", () => {
    const d = leerDescuentos("60% segun acuerdo");
    expect(d.descuentos.map((x) => x.porcentaje)).toEqual([60]);
    expect(d.reconocido).toBe(false);
    expect(d.sobrante).toContain("acuerdo");
  });
});

/* ── Rejilla ─────────────────────────────────────────────────────────────── */

describe("rejilla de la tabla", () => {
  it("reconoce la cabecera de columnas y reparte por posición", () => {
    const cabecera = fila(1, 100, CABECERA_TABLA);
    expect(titulosEnLaFila(cabecera, SINONIMOS_COLUMNA_POR_DEFECTO)).toBe(6);
    const rejilla = detectarRejilla([cabecera]);
    expect(rejilla.modo).toBe("CABECERA");

    const r = lineaArticulo(1, 120, "4400111222333", "PASTILLA FRENO", "1,00", "77,50", "60% + 10%", "27,90");
    const celdas = repartirEnColumnas(r, rejilla);
    expect(celdas.referencia).toBe("4400111222333");
    expect(celdas.cantidad).toBe("1,00");
    expect(celdas.precio).toBe("77,50");
    expect(celdas.descuento).toBe("60% + 10%");
    expect(celdas.importe).toBe("27,90");
  });

  it("sin cabecera pasa a modo posicional y BAJA la confianza", () => {
    const rejilla = detectarRejilla([fila(1, 100, [["ALGO SUELTO", 40]])]);
    expect(rejilla.modo).toBe("POSICIONAL");
    expect(rejilla.confianza).toBeLessThan(1);
  });

  it("en modo posicional lee la fila por la forma de sus tokens", () => {
    const r = fila(1, 120, [["4400111222333 PASTILLA FRENO 1,00 77,50 60% + 10% 27,90", 40]]);
    const celdas = repartirEnColumnas(r, detectarRejilla([]));
    expect(celdas.referencia).toBe("4400111222333");
    expect(celdas.importe).toBe("27,90");
    expect(celdas.precio).toBe("77,50");
    expect(celdas.descuento).toBe("60% + 10%");
  });
});

/* ── Secciones ───────────────────────────────────────────────────────────── */

describe("localizar y delimitar albaranes", () => {
  it("una marca abre una sección y los totales la cierran", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 50, [["FACTURA F-2026-0001", 40]]),
          fila(1, 80, [["Albaran: 0501234", 40]]),
          fila(1, 100, CABECERA_TABLA),
          lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00"),
          fila(1, 160, [["Base imponible", 350], ["10,00", 500]]),
          fila(1, 175, [["Total factura", 350], ["12,10", 500]]),
        ],
      },
    ]);
    const loc = localizarAlbaranes(doc);
    expect(loc.secciones).toHaveLength(1);
    expect(loc.secciones[0].numeroDocumento).toBe("0501234");
    expect(loc.secciones[0].finPor).toBe("TOTALES");
    // La cabecera de la factura no pertenece a ningún albarán.
    expect(loc.cabeceraDocumento.map((l) => l.texto)).toEqual(["FACTURA F-2026-0001"]);
  });

  it("dos albaranes pegados no mezclan sus líneas", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 80, [["Albaran: 0501234", 40]]),
          fila(1, 100, CABECERA_TABLA),
          lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00"),
          fila(1, 140, [["Albaran: 0501299", 40]]),
          lineaArticulo(1, 160, "222222", "DOS", "1,00", "20,00", "-", "20,00"),
        ],
      },
    ]);
    const loc = localizarAlbaranes(doc);
    expect(loc.secciones.map((s) => s.numeroDocumento)).toEqual(["0501234", "0501299"]);
    expect(loc.secciones[0].finPor).toBe("SIGUIENTE_MARCA");
    expect(loc.secciones[0].vecinaSiguiente).toBe("0501299");
    expect(loc.secciones[1].vecinaAnterior).toBe("0501234");
  });

  it("un albarán partido en dos páginas es UNA sección, sin el pie repetido", () => {
    const pie = (p: number) => fila(p, 800, [["Pagina " + p + " de 2", 250]]);
    const logo = (p: number) => fila(p, 20, [["PROVEEDOR EJEMPLO SL", 40]]);
    const doc = documento([
      {
        numero: 1,
        lineas: [
          logo(1),
          fila(1, 80, [["Albaran: 0501234", 40]]),
          fila(1, 100, CABECERA_TABLA),
          lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00"),
          pie(1),
        ],
      },
      {
        numero: 2,
        lineas: [logo(2), lineaArticulo(2, 120, "222222", "DOS", "1,00", "20,00", "-", "20,00"), pie(2)],
      },
    ]);
    const loc = localizarAlbaranes(doc);
    expect(loc.secciones).toHaveLength(1);
    expect(loc.secciones[0].paginaInicio).toBe(1);
    expect(loc.secciones[0].paginaFin).toBe(2);
    // El logotipo (texto idéntico) y el pie («Página 1 de 2» / «2 de 2», misma
    // forma y pegado al borde) desaparecen los dos.
    const textos = loc.secciones[0].lineas.map((l) => l.texto);
    expect(textos.some((t) => t.includes("PROVEEDOR"))).toBe(false);
    expect(textos.some((t) => t.includes("Pagina"))).toBe(false);
    expect(loc.lineasRepetidasRetiradas).toBe(4);
  });

  it("nunca retira la cabecera de columnas aunque se repita en las dos páginas", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [fila(1, 80, [["Albaran: 0501234", 40]]), fila(1, 100, CABECERA_TABLA)],
      },
      { numero: 2, lineas: [fila(2, 100, CABECERA_TABLA)] },
    ]);
    const loc = localizarAlbaranes(doc, { columnas: SINONIMOS_COLUMNA_POR_DEFECTO });
    expect(loc.secciones[0].lineas.filter((l) => l.texto.includes("Importe"))).toHaveLength(2);
  });

  it("sin ninguna marca sale una sección de documento entero", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [fila(1, 100, CABECERA_TABLA), lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00")],
      },
    ]);
    const loc = localizarAlbaranes(doc);
    expect(loc.secciones).toHaveLength(1);
    expect(loc.secciones[0].documentoEntero).toBe(true);
    expect(loc.secciones[0].numeroDocumento).toBeNull();
  });

  it("el número puede estar en la celda de al lado, no en la misma cadena", () => {
    const doc = documento([
      { numero: 1, lineas: [fila(1, 80, [["Nº albarán", 40], ["ENT-770199-0501234", 200]])] },
    ]);
    expect(localizarAlbaranes(doc).secciones[0].numeroDocumento).toBe("ENT-770199-0501234");
  });
});

/* ── Líneas ──────────────────────────────────────────────────────────────── */

describe("extraer líneas", () => {
  const conCabecera = (filas: LineaTexto[]) => [fila(1, 100, CABECERA_TABLA), ...filas];

  it("lee una línea con descuentos encadenados y comprueba la aritmética", () => {
    const r = extraerLineas(
      conCabecera([lineaArticulo(1, 120, "4400111222333", "PASTILLA FRENO", "1,00", "77,50", "60% + 10%", "27,90")])
    );
    expect(r.lineas).toHaveLength(1);
    const l = r.lineas[0];
    expect(l.referencia).toBe("4400111222333");
    expect(l.precioUnitarioCentimos).toBe(7750);
    expect(l.importeCentimos).toBe(2790);
    expect(l.descuentos).toHaveLength(2);
    // 77,50 × 0,4 × 0,9 = 27,90.
    expect(l.cuadraAritmetica).toBe(true);
    expect(l.confianza.precio).toBeGreaterThanOrEqual(0.95);
  });

  it("si la fila NO cuadra, ningún campo de la fila pasa de 0,80", () => {
    // Un 77,50 leído como 77,60 deja de cuadrar: es la salvaguarda contra el
    // número mal leído, que si no pasaría desapercibido. La tolerancia sólo
    // absorbe redondeos de céntimo; en cuanto la desviación sale de ahí, deja
    // de ser un redondeo y la fila entera pierde la confianza.
    const r = extraerLineas(
      conCabecera([lineaArticulo(1, 120, "4400111222333", "PASTILLA FRENO", "1,00", "77,60", "60% + 10%", "27,90")])
    );
    const l = r.lineas[0];
    expect(l.cuadraAritmetica).toBe(false);
    for (const campo of ["referencia", "cantidad", "precio", "importe"] as const) {
      expect(l.confianza[campo]).toBeLessThanOrEqual(0.8);
    }
  });

  it("una descripción que salta de línea se pega a la anterior", () => {
    // Salta de línea porque no cabía: la de arriba llena su columna hasta el
    // borde, que es lo que distingue una descripción partida de una nota.
    const r = extraerLineas(
      conCabecera([
        lineaArticulo(1, 120, "111111", "PASTILLA DE FRENO DELANTERA CERAMICA", "1,00", "10,00", "-", "10,00"),
        fila(1, 132, [["EJE IZQUIERDO", 110]]),
      ])
    );
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].descripcion).toContain("EJE IZQUIERDO");
    expect(r.notas).toEqual([]);
  });

  it("texto suelto bajo una descripción corta es una nota, no una continuación", () => {
    // «FLOTA NORTE» debajo de «PASTILLA FRENO»: la descripción no llenaba la
    // columna, así que no se salió; lo de abajo es otra cosa y va a notas.
    const r = extraerLineas(
      conCabecera([
        lineaArticulo(1, 120, "111111", "PASTILLA FRENO", "1,00", "10,00", "-", "10,00"),
        fila(1, 132, [["FLOTA NORTE", 110]]),
      ])
    );
    expect(r.lineas[0].descripcion).toBe("PASTILLA FRENO");
    expect(r.notas).toEqual(["FLOTA NORTE"]);
  });

  it("«Portes» va a conceptos, no a líneas, y no entra en la suma", () => {
    const r = extraerLineas(
      conCabecera([
        lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00"),
        fila(1, 140, [["Portes", 110], ["12,50", 500]]),
      ])
    );
    expect(r.lineas).toHaveLength(1);
    expect(r.conceptos.map((c) => c.importeCentimos)).toEqual([1250]);
    expect(sumaDeLineas(r.lineas)).toBe(1000);
  });

  it("una referencia ilegible se deja en null, no se corrige", () => {
    const r = extraerLineas(
      conCabecera([
        lineaArticulo(1, 120, "440011122233", "UNO", "1,00", "10,00", "-", "10,00"),
        lineaArticulo(1, 140, "440011122244", "DOS", "1,00", "20,00", "-", "20,00"),
        lineaArticulo(1, 160, "44OO11122255", "TRES", "1,00", "30,00", "-", "30,00"),
      ])
    );
    expect(r.lineas[2].referencia).toBeNull();
    expect(r.lineas[2].confianza.referencia).toBeCloseTo(0.3, 5);
    // Las otras dos no se tocan.
    expect(r.lineas[0].referencia).toBe("440011122233");
  });

  it("en una columna donde ya se mezclan letras y números, no se marca nada", () => {
    const r = extraerLineas(
      conCabecera([
        lineaArticulo(1, 120, "AB-1001-X", "UNO", "1,00", "10,00", "-", "10,00"),
        lineaArticulo(1, 140, "CO-1002-I", "DOS", "1,00", "20,00", "-", "20,00"),
      ])
    );
    expect(r.lineas.every((l) => l.referencia !== null)).toBe(true);
  });

  it("sin cantidad no se inventa: la aritmética queda sin comprobar", () => {
    const r = extraerLineas(
      conCabecera([lineaArticulo(1, 120, "111111", "UNO", "??", "10,00", "-", "10,00")])
    );
    expect(r.lineas[0].cantidad).toBeNull();
    expect(r.lineas[0].cuadraAritmetica).toBeNull();
  });

  it("la suma es null si a alguna línea le falta el importe", () => {
    const r = extraerLineas(conCabecera([lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00")]));
    expect(sumaDeLineas(r.lineas)).toBe(1000);
    expect(sumaDeLineas([{ ...r.lineas[0], importeCentimos: null }])).toBeNull();
  });
});

/* ── Complementarios ─────────────────────────────────────────────────────── */

describe("datos complementarios", () => {
  it("lee matrícula, bastidor y observaciones sin cambiarles las mayúsculas", () => {
    const c = extraerComplementarios([
      fila(1, 60, [["Matricula: 4417KDT", 40]]),
      fila(1, 74, [["Bastidor: WZ10A2BCDEF345678", 40]]),
      fila(1, 88, [["Observaciones: Entregar en el muelle", 40]]),
    ]);
    expect(c.matricula).toBe("4417KDT");
    expect(c.bastidor).toBe("WZ10A2BCDEF345678");
    expect(c.observaciones).toBe("Entregar en el muelle");
  });

  it("una tirada de 17 dígitos no es un bastidor", () => {
    const c = extraerComplementarios([fila(1, 60, [["12345678901234567", 40]])]);
    expect(c.bastidor).toBeNull();
  });

  it("lo etiquetado que no tiene columna se guarda igualmente", () => {
    const c = extraerComplementarios([
      fila(1, 60, [["Pedido: P-9912", 40]]),
      fila(1, 74, [["Puerta de carga: 4", 40]]),
    ]);
    expect(c.otros.pedido).toBe("P-9912");
    expect(c.otros["Puerta de carga"]).toBe("4");
  });

  it("busca el vehículo también en la banda anterior a la sección", () => {
    const c = extraerComplementarios([fila(1, 120, [["ALGO", 40]])], [fila(1, 60, [["4417KDT", 40]])]);
    expect(c.matricula).toBe("4417KDT");
  });
});

/* ── El análisis completo ────────────────────────────────────────────────── */

describe("analizar un albarán dentro de una factura", () => {
  const factura = documento([
    {
      numero: 1,
      lineas: [
        fila(1, 40, [["PROVEEDOR EJEMPLO SL", 40]]),
        fila(1, 80, [["Albaran: ENT-770199-0501234", 40]]),
        fila(1, 100, CABECERA_TABLA),
        lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00"),
        fila(1, 200, [["Albaran: 0501235", 40]]),
        lineaArticulo(1, 220, "222222", "DOS", "1,00", "20,00", "-", "20,00"),
      ],
    },
  ]);

  it("encuentra el albarán por su parte identificadora, no por el prefijo", () => {
    const a = analizarAlbaran(factura, "0501234");
    expect(a.resultadoMatch).toBe("MATCH");
    expect(a.numeroDocumento).toBe("ENT-770199-0501234");
    expect(a.sumaLineasCentimos).toBe(1000);
  });

  it("dos albaranes que se parecen no se confunden", () => {
    const a = analizarAlbaran(factura, "0501235");
    expect(a.numeroDocumento).toBe("0501235");
    expect(a.sumaLineasCentimos).toBe(2000);
  });

  it("un albarán que no está da NO_MATCH y no se queda con las líneas de otro", () => {
    const a = analizarAlbaran(factura, "0509999");
    expect(a.resultadoMatch).toBe("NO_MATCH");
    expect(a.lineas).toHaveLength(0);
    expect(a.seccion).toBeNull();
  });

  it("un número parecido se anota como parecido pero NO se coge", () => {
    const a = analizarAlbaran(factura, "0501236");
    expect(a.resultadoMatch).toBe("NO_MATCH");
    expect(a.parecidos).toContain("0501235");
  });

  it("sin marcas, el techo es UNCERTAIN aunque las líneas se lean bien", () => {
    const suelto = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 100, CABECERA_TABLA),
          lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00"),
        ],
      },
    ]);
    const a = analizarAlbaran(suelto, "0501234");
    expect(a.resultadoMatch).toBe("UNCERTAIN");
    expect(a.lineas).toHaveLength(1);
  });

  it("mientras no haya parsers específicos, siempre gana el genérico", () => {
    expect(seleccionarParser(factura).clave).toBe("generico");
  });

  it("aplanar devuelve las páginas en orden de lectura", () => {
    const dos = documento([
      { numero: 2, lineas: [fila(2, 10, [["B", 40]])] },
      { numero: 1, lineas: [fila(1, 20, [["A2", 40]]), fila(1, 10, [["A1", 40]])] },
    ]);
    expect(aplanar(dos).map((l) => l.texto)).toEqual(["A1", "A2", "B"]);
  });
});

/* ── Lo que enseñaron las primeras facturas reales ────────────────────────── */

describe("lo que enseñaron las primeras facturas reales", () => {
  /** Cabecera de tabla sin columna de referencia, como la de un proveedor de neumáticos. */
  const SIN_REF: [string, number][] = [
    ["Denominacion", 110],
    ["Cantidad", 300],
    ["Precio", 350],
    ["Descuento", 430],
    ["Importe", 500],
  ];
  const TOTALES_EN_DOS_FILAS = [
    fila(1, 572, [
      ["IMPORTE BRUTO", 50],
      ["BASE IMPONIBLE", 237],
      ["% I.V.A.", 339],
      ["IMPORTE I.V.A.", 407],
      ["TOTAL ABONO", 505],
    ]),
    fila(1, 587, [
      ["-37,71", 66],
      ["-37,71", 254],
      ["21,00", 341],
      ["-7,92", 423],
      ["-45,63", 503],
    ]),
  ];

  it("«ALB:0501234» sin espacio es una marca; «ALB 580798» en una nota no lo es", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 50, [["FACTURA F-2026-0001", 40]]),
          fila(1, 100, SIN_REF),
          fila(1, 110, [["REF: X4711", 110]]),
          fila(1, 120, [["ALB:0501234 FECHA: 26/08/2026", 110]]),
          fila(1, 130, [["PASTILLA FRENO", 110], ["2,00", 300], ["10,00", 350], ["20,00", 500]]),
          fila(1, 140, [["ALB 580798", 110], ["1,00", 300]]),
          ...TOTALES_EN_DOS_FILAS,
        ],
      },
    ]);
    const loc = localizarAlbaranes(doc);
    expect(loc.secciones).toHaveLength(1);
    expect(loc.secciones[0].numeroDocumento).toBe("0501234");
    // La fila de títulos del pie, sin ningún importe, cierra la sección.
    expect(loc.secciones[0].finPor).toBe("TOTALES");
    // La etiqueta corta de justo encima («REF: …») es del albarán, no de la cabecera.
    expect(loc.secciones[0].lineas[0].texto).toBe("REF: X4711");
    expect(loc.secciones[0].lineas.map((l) => l.texto)).not.toContain("IMPORTE BRUTO BASE IMPONIBLE % I.V.A. IMPORTE I.V.A. TOTAL ABONO");
    expect(loc.cabeceraDocumento.map((l) => l.texto)).toEqual(["FACTURA F-2026-0001", "Denominacion Cantidad Precio Descuento Importe"]);
  });

  it("«Suma y sigue» no cierra el albarán, y la plantilla repetida se retira esté donde esté", () => {
    const legal =
      "Le informamos de que tratamos sus datos con el fin de prestarle el servicio solicitado y de " +
      "realizar la facturacion del mismo, y de que se conservaran mientras dure la relacion comercial.";
    // Una FILA DE DATOS puede repetirse palabra por palabra en las dos páginas.
    const pedido = "Nuestro pedido: 1021294542 de fecha 07.09.2026";
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 80, [["Albaran: 0501234", 40]]),
          fila(1, 100, CABECERA_TABLA),
          fila(1, 110, [[pedido, 40]]),
          lineaArticulo(1, 120, "111111", "UNO", "1,00", "10,00", "-", "10,00"),
          fila(1, 140, [["SUMA Y SIGUE: 10,00", 350]]),
          fila(1, 160, [[legal, 40]]),
          fila(1, 180, [["Pagina 1 de 2", 500]]),
        ],
      },
      {
        numero: 2,
        lineas: [
          fila(2, 60, [["Fecha expedicion: 01/09/2026 Suma anterior: 10,00", 40]]),
          fila(2, 100, CABECERA_TABLA),
          // A distinta altura que en la página 1: los bloques no caen igual.
          fila(2, 113, [[pedido, 40]]),
          lineaArticulo(2, 120, "222222", "DOS", "1,00", "20,00", "-", "20,00"),
          fila(2, 160, [["Base imponible", 350], ["30,00", 500]]),
          fila(2, 175, [["Total factura", 350], ["36,30", 500]]),
          fila(2, 300, [[legal, 40]]),
          fila(2, 400, [["Pagina 2 de 2", 500]]),
        ],
      },
    ]);
    const loc = localizarAlbaranes(doc, { columnas: SINONIMOS_COLUMNA_POR_DEFECTO });
    expect(loc.lineasRepetidasRetiradas).toBe(4);
    expect(loc.secciones).toHaveLength(1);
    expect(loc.secciones[0].finPor).toBe("TOTALES");
    expect(loc.secciones[0].paginaFin).toBe(2);
    // El pedido se repite igual en las dos páginas y se queda: es un dato del
    // albarán, no plantilla. Borrarlo sería perderlo.
    expect(loc.secciones[0].lineas.filter((l) => l.texto === pedido)).toHaveLength(2);

    const r = extraerLineas(loc.secciones[0].lineas);
    expect(r.lineas.map((l) => l.descripcion)).toEqual(["UNO", "DOS"]);
    expect(r.conceptos).toEqual([]);
    // El pedido que vuelve a salir en mitad del albarán no es línea ni
    // concepto: es una observación, y ahí se queda.
    expect(r.notas).toEqual([pedido]);
  });

  it("sin columna de referencia, la referencia no está «sin leer»: no existe", () => {
    const r = extraerLineas([
      fila(1, 100, SIN_REF),
      fila(1, 130, [["PASTILLA FRENO", 110], ["2,00", 300], ["10,00", 350], ["20,00", 500]]),
    ]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].referencia).toBeNull();
    expect(r.lineas[0].confianza.referencia).toBeGreaterThanOrEqual(0.95);
    expect(r.lineas[0].cuadraAritmetica).toBe(true);
  });

  it("una fila con cantidad y sin importe es una nota del albarán, no una línea", () => {
    const r = extraerLineas([
      fila(1, 100, SIN_REF),
      fila(1, 130, [["MANO OBRA MECANICA", 110], ["0,50", 300], ["58,13", 350], ["20,00", 430], ["23,25", 500]]),
      fila(1, 140, [["SE ANULA PULMON", 110], ["1,00", 300]]),
      fila(1, 150, [["CASO 4711", 110]]),
      fila(1, 160, [["------------------------------", 110], ["1,00", 300]]),
    ]);
    expect(r.lineas).toHaveLength(1);
    // El descuento sin «%» cuenta como porcentaje y la fila cuadra.
    expect(r.lineas[0].cuadraAritmetica).toBe(true);
    expect(r.notas).toEqual(["SE ANULA PULMON", "CASO 4711"]);
    expect(r.descartadas).toBe(0);
  });

  it("un título de bloque sin importe abre un bloque de conceptos", () => {
    const r = extraerLineas([
      fila(1, 100, SIN_REF),
      fila(1, 130, [["NEUMATICO EJEMPLO", 110], ["2,00", 300], ["21,11", 350], ["42,21", 500]]),
      fila(1, 140, [["PORTES DE DEVOLUCION", 110], ["-2,00", 300], ["4,00", 350], ["-8,00", 500]]),
      fila(1, 150, [["TASAS Y OTROS CONCEPTOS", 110]]),
      fila(1, 160, [["Gestion de residuos Cat.BT", 110], ["2,00", 300], ["1,75", 350], ["3,50", 500]]),
    ]);
    expect(r.lineas.map((l) => l.descripcion)).toEqual(["NEUMATICO EJEMPLO"]);
    expect(r.conceptos.map((c) => [c.etiqueta, c.importeCentimos])).toEqual([
      ["PORTES DE DEVOLUCION", -800],
      ["TASAS Y OTROS CONCEPTOS", null],
      ["Gestion de residuos Cat.BT", 350],
    ]);
  });

  it("las tasas ambientales se reconocen aunque no vayan al principio", () => {
    expect(conceptoGlobal("- Gastos de ecovalor")).toBe("ecovalor");
    expect(conceptoGlobal("S.I.Gestión de NFU Cat.BT")).toBe("nfu");
    expect(conceptoGlobal("NEUMATICO CONFUSION 205")).toBeNull();
    expect(esArrastre("SUMA Y SIGUE: 5.385,18")).toBe(true);
    expect(esArrastre("Suma de las líneas")).toBe(false);
    expect(esCabeceraDeTotales("IMPORTE BRUTO DESCUENTO BASE IMPONIBLE % I.V.A. IMPORTE I.V.A. TOTAL ABONO")).toBe(true);
    expect(esCabeceraDeTotales("Ref Descripcion Cant Precio Total")).toBe(false);
    expect(esCabeceraDeTotales("Base imponible 100,00 Total 121,00")).toBe(false);
  });

  it("sin columna de descripción, el texto bajo «Referencia» es la descripción", () => {
    const r = extraerLineas([
      fila(1, 100, [["Referencia", 40], ["Cantidad", 300], ["Precio", 350], ["Total", 500]]),
      fila(1, 130, [["255/65 R17 NEUMATICO EJEMPLO", 40], ["4", 300], ["93,47 €", 350], ["373,88 €", 500]]),
      fila(1, 140, [["- Gastos de ecovalor", 40], ["4", 300], ["1,80 €", 350], ["7,20 €", 500]]),
    ]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].referencia).toBeNull();
    expect(r.lineas[0].descripcion).toBe("255/65 R17 NEUMATICO EJEMPLO");
    expect(r.lineas[0].cantidad).toBe(4);
    expect(r.lineas[0].importeCentimos).toBe(37388);
    expect(r.lineas[0].cuadraAritmetica).toBe(true);
    expect(r.lineas[0].confianza.referencia).toBeGreaterThanOrEqual(0.95);
    expect(r.conceptos.map((c) => [c.etiqueta, c.importeCentimos])).toEqual([["Gastos de ecovalor", 720]]);
  });

  it("la cabecera lee los valores que van DEBAJO de sus etiquetas, y el correo electrónico no es un número", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 60, [["PROVEEDOR EJEMPLO SL", 40]]),
          fila(1, 70, [["facturacion@ejemplo.invalid", 40]]),
          fila(1, 164, [["ABONO", 70], ["FECHA", 180]]),
          fila(1, 175, [["A0000123", 52], ["31/08/2026", 164]]),
          fila(1, 203, SIN_REF),
          fila(1, 219, [["ALB:0501234 FECHA: 26/08/2026", 110]]),
          fila(1, 232, [["NEUMATICO EJEMPLO", 110], ["2,00", 300], ["21,11", 350], ["42,21", 500]]),
          ...TOTALES_EN_DOS_FILAS,
        ],
      },
    ]);
    const c = parserGenerico.extraerCabecera(doc);
    expect(c.tipoDocumento).toBe("ABONO");
    expect(c.numeroDocumento).toBe("A0000123");
    expect(c.fechaDocumento).toBe("2026-08-31");
    expect(c.baseCentimos).toBe(-3771);
    // La cuota, no el 21 % que hay bajo «% I.V.A.».
    expect(c.ivaCentimos).toBe(-792);
    expect(c.totalCentimos).toBe(-4563);
  });

  it("«Nº : F-2026-0001» al lado, y «Total sin IVA / IVA / Total IVA incluido» en dos filas", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 18, [["Factura", 40]]),
          fila(1, 38, [["Nº", 40], [":", 55], ["F-2026-0001", 65]]),
          fila(1, 50, [["Fecha : 11/08/2026", 40]]),
          fila(1, 128, [["Nº IVA: ESW0000000X", 40]]),
          fila(1, 747, [["TOTAL SIN IVA", 200], ["IVA", 300], ["TOTAL IVA INCLUIDO", 400]]),
          fila(1, 763, [["383,08 €", 200], ["80,45 €", 300], ["463,53 €", 400]]),
        ],
      },
    ]);
    const c = parserGenerico.extraerCabecera(doc);
    expect(c.tipoDocumento).toBe("FACTURA");
    expect(c.numeroDocumento).toBe("F-2026-0001");
    expect(c.baseCentimos).toBe(38308);
    expect(c.ivaCentimos).toBe(8045);
    expect(c.totalCentimos).toBe(46353);
  });

  it("lee la matrícula de un remolque y no confunde «CF1100 A/T» de un neumático con una", () => {
    expect(extraerComplementarios([fila(1, 100, [["MAT: R1234BCD KILOMETROS:0", 40]])]).matricula).toBe("R1234BCD");
    const articulo = fila(1, 120, [["255/65 R17 CF1100 A/T", 110], ["4", 300], ["93,47", 350], ["373,88", 500]]);
    expect(extraerComplementarios([articulo]).matricula).toBeNull();
    // Etiquetada sí, aunque la fila lleve una cantidad.
    expect(extraerComplementarios([fila(1, 120, [["MATR.: 1234BCD", 110], ["1,00", 300]])]).matricula).toBe("1234BCD");
  });

  it("las notas de un albarán acaban en observaciones y sus tasas en conceptos", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 50, [["FACTURA F-2026-0001", 40]]),
          fila(1, 100, SIN_REF),
          fila(1, 120, [["ALB:0501234 FECHA: 26/08/2026", 110]]),
          fila(1, 125, [["MAT: 1234BCD KILOMETROS:0", 110]]),
          fila(1, 130, [["MANO OBRA MECANICA", 110], ["0,50", 300], ["58,13", 350], ["20,00", 430], ["23,25", 500]]),
          fila(1, 140, [["3er EJE IZQUIERDO", 110], ["1,00", 300]]),
          fila(1, 150, [["Base imponible", 350], ["23,25", 500]]),
        ],
      },
    ]);
    const a = analizarAlbaran(doc, "0501234");
    expect(a.resultadoMatch).toBe("MATCH");
    expect(a.lineas).toHaveLength(1);
    expect(a.sumaLineasCentimos).toBe(2325);
    expect(a.complementarios.matricula).toBe("1234BCD");
    expect(a.complementarios.observaciones).toBe("3er EJE IZQUIERDO");
    expect(a.filasDescartadas).toBe(0);
  });
});

/* ── La tercera plantilla: el desglose por filas ──────────────────────────── */

describe("una plantilla que desglosa cada artículo en varias filas", () => {
  /*
   * La forma que trae un ERP alemán: columna de posición, la unidad pegada a
   * la cantidad, el precio BRUTO en la fila del artículo y debajo una fila por
   * cada descuento, una con el neto y otra con la ecotasa. El signo va detrás
   * del número y las fechas llevan puntos.
   */
  const CABECERA_ERP: [string, number][] = [
    ["Pos.", 68],
    ["No.Art.", 88],
    ["Descripción", 144],
    ["Cant.", 335],
    ["Unit", 360],
    ["Precio/unit", 398],
    ["Importe neto", 470],
  ];
  const articulo = (y: number, pos: string, art: string, desc: string, precio: string): LineaTexto =>
    fila(1, y, [[pos, 55], [art, 88], [desc, 144], ["1", 350], ["UN", 360], [precio, 416], [precio, 490]]);
  const desglose = (y: number, etiqueta: string, izquierda: string, derecha: string): LineaTexto =>
    fila(1, y, [[etiqueta, 144], [izquierda, 416], [derecha, 483]]);
  const PIE_EN_DOS_FILAS: LineaTexto[] = [
    fila(1, 600, [["Importe neto", 78], ["% IVA", 185], ["IVA", 273], ["Vencimiento", 361], ["Total", 484]]),
    fila(1, 614, [
      ["EUR", 68], ["1.000,00", 132], ["21,00", 202],
      ["EUR", 240], ["210,00", 308], ["23.09.2026", 361],
      ["EUR", 448], ["1.210,00", 515],
    ]),
  ];
  /** Un artículo entero: bruto, dos descuentos, el neto y su ecotasa. */
  const bloqueDeArticulo = (y: number, pos: string): LineaTexto[] => [
    articulo(y, pos, "572912", "235/75R17.5 EJEMPLO T 143J144F 3PSF", "100,00"),
    desglose(y + 13, "Descuento base", "40,00-%", "40,00-"),
    desglose(y + 26, "Descuento adicional", "10,00-%", "10,00-"),
    desglose(y + 39, "Subt2: Net 1", "50,00", "50,00"),
    desglose(y + 52, "Total", "50,00", "50,00"),
    desglose(y + 65, "ECOTASA NFVU", "6,15", "6,15"),
  ];

  it("el «Total» de un artículo no cierra el albarán; el pie de la factura sí", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 200, [["Factura 5901223371", 40]]),
          fila(1, 224, CABECERA_ERP),
          fila(1, 264, [["Nuestro pedido: 1021294542 de fecha 07.09.2026", 144]]),
          fila(1, 275, [["Nuestro Albarán: 4049975109 de fecha 08.09.2026", 144], ["Entregado: 09.09.2026", 330]]),
          fila(1, 286, [["Ref.: 2721723105 de fecha 07.09.2026", 144]]),
          ...bloqueDeArticulo(330, "0020"),
          ...bloqueDeArticulo(408, "0030"),
          ...PIE_EN_DOS_FILAS,
        ],
      },
    ]);
    const loc = localizarAlbaranes(doc);
    expect(loc.secciones).toHaveLength(1);
    expect(loc.secciones[0].numeroDocumento).toBe("4049975109");
    // Los dos artículos enteros están dentro; el pie, fuera.
    expect(loc.secciones[0].finPor).toBe("TOTALES");
    expect(loc.secciones[0].lineas.filter((l) => l.texto.startsWith("Total"))).toHaveLength(2);
    expect(loc.secciones[0].lineas.some((l) => l.texto.includes("Vencimiento"))).toBe(false);
    // Y la fila de datos de encima de la marca es del albarán, no de nadie.
    expect(loc.secciones[0].lineas[0].texto).toContain("Nuestro pedido");
  });

  it("cada artículo es UNA línea con su neto, sus descuentos y su tasa aparte", () => {
    const r = extraerLineas([fila(1, 224, CABECERA_ERP), ...bloqueDeArticulo(330, "0020")]);

    expect(r.lineas).toHaveLength(1);
    const l = r.lineas[0];
    expect(l.referencia).toBe("572912");
    // La descripción entera: no se la come la columna de la cantidad.
    expect(l.descripcion).toBe("235/75R17.5 EJEMPLO T 143J144F 3PSF");
    // La unidad va pegada a la cantidad y no estorba.
    expect(l.cantidad).toBe(1);
    expect(l.precioUnitarioCentimos).toBe(10000);
    // El importe de la línea es el NETO, que es lo que se paga y lo que suma.
    expect(l.importeCentimos).toBe(5000);
    expect(l.descuentos.map((d) => d.porcentaje)).toEqual([40, 10]);
    expect(l.descuentosRaw).toBe("40,00-% + 10,00-%");
    expect(l.cuadraAritmetica).toBe(true);
    expect(sumaDeLineas(r.lineas)).toBe(5000);

    // La ecotasa cuesta dinero y no es línea: se enseña aparte y no se suma.
    expect(r.conceptos.map((c) => [c.etiqueta, c.importeCentimos])).toEqual([["ECOTASA NFVU", 615]]);
    expect(r.notas).toEqual([]);
  });

  it("manda el descuento impreso en dinero, no la convención que se suponga", () => {
    // 33,33 % y 5 % sobre 1.000: encadenados dan 633,37 y sumados 616,70. El
    // papel dice 616,60 porque el proveedor redondea cada descuento por su
    // cuenta, y lo que cuadra es lo que está impreso al lado.
    const r = extraerLineas([
      fila(1, 224, CABECERA_ERP),
      fila(1, 330, [["0010", 55], ["572794", 88], ["NEUMATICO EJEMPLO", 144], ["1", 350], ["UN", 360], ["1.000,00", 416], ["1.000,00", 490]]),
      desglose(343, "Descuento base", "33,33-%", "333,40-"),
      desglose(356, "Descuento adicional", "5,00-%", "50,00-"),
      desglose(369, "Total", "616,60", "616,60"),
    ]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].importeCentimos).toBe(61660);
    expect(r.lineas[0].cuadraAritmetica).toBe(true);
  });

  it("si nada explica el importe, la línea entera pierde la confianza", () => {
    const r = extraerLineas([
      fila(1, 224, CABECERA_ERP),
      articulo(330, "0010", "572794", "NEUMATICO EJEMPLO", "100,00"),
      desglose(343, "Descuento base", "40,00-%", "40,00-"),
      desglose(356, "Total", "70,00", "70,00"),
    ]);
    expect(r.lineas[0].cuadraAritmetica).toBe(false);
    expect(r.lineas[0].confianza.precio).toBeLessThanOrEqual(0.8);
  });

  it("la segunda fila de la cabecera («EUR EUR») no continúa ninguna descripción", () => {
    const r = extraerLineas([
      fila(1, 224, CABECERA_ERP),
      fila(1, 235, [["EUR", 416], ["EUR", 490]]),
      ...bloqueDeArticulo(330, "0020"),
      fila(1, 420, [["EUR", 416], ["EUR", 490]]),
    ]);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].descripcion).toBe("235/75R17.5 EJEMPLO T 143J144F 3PSF");
    expect(r.notas).toEqual([]);
  });

  it("los totales se leen del PIE, aunque cada artículo remate con su «Total»", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 200, [["Factura 5901223371", 40]]),
          fila(1, 212, [["Fecha de doc.: 15.09.2026", 400]]),
          fila(1, 224, CABECERA_ERP),
          ...bloqueDeArticulo(330, "0020"),
          ...PIE_EN_DOS_FILAS,
        ],
      },
    ]);
    const c = parserGenerico.extraerCabecera(doc);
    expect(c.numeroDocumento).toBe("5901223371");
    expect(c.fechaDocumento).toBe("2026-09-15");
    // Del recuadro del pie, cada cifra bajo su título aunque no se solapen.
    expect(c.baseCentimos).toBe(100000);
    expect(c.ivaCentimos).toBe(21000);
    expect(c.totalCentimos).toBe(121000);
  });

  it("una fecha con puntos no es un importe ni cuenta como decimales", () => {
    expect(esCabeceraDeTotales("Importe neto % IVA IVA Vencimiento 23.09.2026 Total")).toBe(true);
    const r = extraerLineas([
      fila(1, 224, CABECERA_ERP),
      articulo(330, "0010", "572794", "NEUMATICO EJEMPLO", "100,00"),
      // Con fecha y sin importe: es una nota, no el neto de la línea. Y la
      // nota se guarda entera, que la fecha es la mitad de lo que dice.
      fila(1, 343, [["Entregado: 09.09.2026", 144]]),
    ]);
    expect(r.lineas[0].importeCentimos).toBe(10000);
    expect(r.notas).toEqual(["Entregado: 09.09.2026"]);
  });

  it("la plantilla repetida se retira aunque no caiga en el mismo sitio en las dos páginas", () => {
    const paginacion = (p: number) => `Factura 5901223371 Original Página: ${p} de 2`;
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 200, [[paginacion(1), 40]]),
          fila(1, 224, CABECERA_ERP),
          fila(1, 275, [["Nuestro Albarán: 4049975109 de fecha 08.09.2026", 144]]),
          ...bloqueDeArticulo(330, "0020"),
        ],
      },
      {
        numero: 2,
        lineas: [
          fila(2, 260, [[paginacion(2), 40]]),
          fila(2, 224, CABECERA_ERP),
          fila(2, 275, [["Nuestro Albarán: 4050016039 de fecha 12.09.2026", 144]]),
          ...bloqueDeArticulo(330, "0040").map((l) => ({ ...l, pagina: 2 })),
        ],
      },
    ]);
    const loc = localizarAlbaranes(doc);
    expect(loc.secciones).toHaveLength(2);
    for (const s of loc.secciones) {
      expect(s.lineas.some((l) => l.texto.includes("Página"))).toBe(false);
    }
  });
});

/* ── El subrayador ────────────────────────────────────────────────────────── */

describe("por dónde pasa el subrayador", () => {
  const CABECERA_ERP: [string, number][] = [
    ["Referencia", 40],
    ["Descripcion", 110],
    ["Cant", 300],
    ["Precio", 350],
    ["Importe", 500],
  ];
  const conDosAlbaranes = () =>
    documento([
      {
        numero: 1,
        lineas: [
          fila(1, 60, [["FACTURA F-2026-0001", 40]]),
          fila(1, 100, CABECERA_ERP),
          fila(1, 120, [["Albaran: 0501234", 40]]),
          fila(1, 132, [["NEUMATICO UNO", 110], ["1", 300], ["10,00", 350], ["10,00", 500]]),
          fila(1, 150, [["Albaran: 0509999", 40]]),
          fila(1, 162, [["NEUMATICO DOS", 110], ["1", 300], ["20,00", 350], ["20,00", 500]]),
          fila(1, 200, [["Base imponible", 350], ["30,00", 500]]),
        ],
      },
    ]);

  it("cubre las filas del albarán pedido y ninguna del de al lado", () => {
    const a = analizarAlbaran(conDosAlbaranes(), "0501234");
    const cajas = cajasDelAlbaran(a.seccion);

    expect(a.resultadoMatch).toBe("MATCH");
    // Sus dos filas —la marca y el artículo— y el trazo del número encima.
    expect(cajas.filter((c) => c.tipo === "BLOQUE")).toHaveLength(2);
    expect(cajas.filter((c) => c.tipo === "NUMERO")).toHaveLength(1);
    expect(paginasResaltadas(cajas)).toEqual([1]);

    // Ni una caja llega a la altura del segundo albarán.
    for (const c of cajas) expect(c.y + c.h).toBeLessThan(150);
  });

  it("la caja lleva aire alrededor: es un rotulador, no un subrayado", () => {
    const a = analizarAlbaran(conDosAlbaranes(), "0501234");
    const [primera] = cajasDelAlbaran(a.seccion, 2);
    const linea = a.seccion!.lineas[0];
    expect(primera.x).toBe(linea.x - 2);
    expect(primera.y).toBe(linea.y - 2);
    expect(primera.w).toBe(linea.w + 4);
    expect(primera.h).toBe(linea.h + 4);
  });

  it("sin albarán localizado no se pinta nada: no se afirma lo que no se sabe", () => {
    const a = analizarAlbaran(conDosAlbaranes(), "0507777");
    expect(a.seccion).toBeNull();
    expect(cajasDelAlbaran(a.seccion)).toEqual([]);

    // Y un documento sin ninguna marca tampoco: la «sección» es el papel entero.
    const suelto = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 100, CABECERA_ERP),
          fila(1, 132, [["NEUMATICO UNO", 110], ["1", 300], ["10,00", 350], ["10,00", 500]]),
        ],
      },
    ]);
    const b = analizarAlbaran(suelto, "0501234");
    expect(b.seccion?.documentoEntero).toBe(true);
    expect(cajasDelAlbaran(b.seccion)).toEqual([]);
  });

  it("no se pinta la cabecera de columnas ni una página donde el albarán no tiene cifras", () => {
    const doc = documento([
      {
        numero: 1,
        lineas: [
          fila(1, 100, CABECERA_ERP),
          fila(1, 120, [["Albaran: 0501234", 40]]),
          fila(1, 132, [["NEUMATICO UNO", 110], ["1", 300], ["10,00", 350], ["10,00", 500]]),
        ],
      },
      {
        // La página siguiente abre otro albarán: lo que queda por medio es
        // suyo por reparto, pero no tiene ni una cifra del primero.
        numero: 2,
        lineas: [
          fila(2, 100, CABECERA_ERP),
          fila(2, 110, [["DZ", 28]]),
          fila(2, 120, [["Albaran: 0509999", 40]]),
          fila(2, 132, [["NEUMATICO DOS", 110], ["1", 300], ["20,00", 350], ["20,00", 500]]),
        ],
      },
    ]);
    const a = analizarAlbaran(doc, "0501234");
    expect(a.seccion?.paginaFin).toBe(2);
    expect(paginasResaltadas(cajasDelAlbaran(a.seccion))).toEqual([1]);
  });
});
