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
import { conceptoGlobal, esConcepto, totalDocumento } from "./conceptos.ts";
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
    const sinonimos = ["ref", "descripcion", "cant", "precio", "dto", "importe"];
    const loc = localizarAlbaranes(doc, { sinonimosColumna: sinonimos });
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
    const r = extraerLineas(
      conCabecera([
        lineaArticulo(1, 120, "111111", "PASTILLA FRENO", "1,00", "10,00", "-", "10,00"),
        fila(1, 132, [["DELANTERA IZQUIERDA", 110]]),
      ])
    );
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].descripcion).toContain("DELANTERA IZQUIERDA");
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
