import { describe, expect, it } from "vitest";
import { limpiarObservacion, observacionDeFila, observacionesDelAlbaran, type FilaPdf } from "./observaciones.ts";

const fila = (...palabras: string[]): FilaPdf => ({ palabras });
/** La fila que abre la tabla de productos en el albarán de Soledad. */
const CABECERA = fila("Artículo", "Descripción", "Cantidad", "Precio", "Dto.", "Importe");
const TOTALES = fila("Importe", "Bruto:", "1.039,00");

/**
 * Las filas tal y como salen de los albaranes de verdad, copiadas del texto
 * que da el lector de PDF. Cinco albaranes del 15 al 17/09/2026.
 */
const ALBARAN_JORGE: FilaPdf[] = [
  CABECERA,
  fila("0107091840003", "265/70X19.5", "HANKOOK", "AH35", "140M", "4", "263,7", "1.054,80"),
  fila("0107099000009", "10", "EUR", "DTO", "UD", "HANKOOK", "-4", "10", "-40,00"),
  fila(".", "0", "0", "0,00"),
  fila("4102999990093", "S.I.Gestión", "de", "NFU", "Cat.D1T", "4", "6,05", "24,20"),
  fila("JORGE+PLANA", "0", "0", "0,00"),
  fila("0", "0", "0,00"),
  TOTALES,
];

const ALBARAN_TALLER: FilaPdf[] = [
  CABECERA,
  fila("0119090420003", "315/70X22.5", "SAILUN", "SDL1", "154L", "4", "235", "940,00"),
  fila("0119090430001", "315/80X22.5", "SAILUN", "SDR1", "156L", "4", "234,989", "939,96"),
  fila("0119090530004", "385/55X22.5", "SAILUN", "STR1+N", "160K", "5", "248,01", "1.240,05"),
  fila(".", "0", "0", "0,00"),
  fila("4102999990094", "S.I.Gestión", "de", "NFU", "Cat.D2T", "13", "12,18", "158,34"),
  fila("TALLER", "0", "0", "0,00"),
  fila("0", "0", "0,00"),
  TOTALES,
];

describe("observacionesDelAlbaran", () => {
  it("lee la observación que va tras la línea de NFU, con los «+» ya como espacios", () => {
    expect(observacionesDelAlbaran(ALBARAN_JORGE)).toEqual(["JORGE PLANA"]);
    expect(observacionesDelAlbaran(ALBARAN_TALLER)).toEqual(["TALLER"]);
  });

  it("no confunde con la observación la fila separadora, las de cierre ni los artículos", () => {
    // «.» no tiene letras; los ceros sueltos no tienen texto; los artículos no
    // llevan sus números a cero. Ninguna de las tres sale.
    expect(observacionesDelAlbaran(ALBARAN_JORGE)).not.toContain(".");
    expect(observacionesDelAlbaran(ALBARAN_JORGE)).toHaveLength(1);
  });

  it("un artículo cuya descripción lleva «+» no se toca: sólo se limpian las observaciones", () => {
    // «385/55X22.5 SAILUN STR1+N» es un neumático, y su «+» es parte del modelo.
    expect(observacionesDelAlbaran(ALBARAN_TALLER)).toEqual(["TALLER"]);
  });

  it("sin observaciones devuelve una lista vacía, no se inventa nada", () => {
    expect(observacionesDelAlbaran(ALBARAN_JORGE.slice(0, 5))).toEqual([]);
    expect(observacionesDelAlbaran([])).toEqual([]);
    // Sin cabecera de tabla no hay dónde buscar: no se adivina.
    expect(observacionesDelAlbaran(ALBARAN_JORGE.slice(1))).toEqual([]);
  });

  it("un albarán de dos páginas: el membrete repetido no se come la observación", () => {
    // La segunda página repite el membrete, y «Tel. Pedidos 911 910 910»
    // termina en tres números. Antes pasaba por artículo y tapaba el TALLER.
    const pg = (n: number, f: FilaPdf): FilaPdf => ({ ...f, pagina: n });
    const filas = [
      ...ALBARAN_TALLER.slice(0, ALBARAN_TALLER.length - 1).map((f) => pg(1, f)),
      pg(2, fila("Calle", "Severo", "Ochoa,", "30", "Tel.", "Pedidos", "911", "910", "910")),
      pg(2, CABECERA),
      pg(2, fila("0", "0", "0,00")),
      pg(2, fila("Importe", "Bruto:", "5.891,34")),
    ];
    expect(observacionesDelAlbaran(filas)).toEqual(["TALLER"]);
  });

  it("varias observaciones salen todas, y las repetidas una sola vez", () => {
    const filas = [...ALBARAN_TALLER.slice(0, 7), fila("JORGE+PLANA", "0", "0", "0,00"), fila("TALLER", "0", "0", "0,00")];
    expect(observacionesDelAlbaran(filas)).toEqual(["TALLER", "JORGE PLANA"]);
  });

  it("si el albarán no trae NFU, las observaciones siguen siendo lo que va tras el último artículo", () => {
    const filas = [CABECERA, fila("0107091840003", "265/70X19.5", "HANKOOK", "4", "263,7", "1.054,80"), fila("MOSTRADOR", "0", "0", "0,00")];
    expect(observacionesDelAlbaran(filas)).toEqual(["MOSTRADOR"]);
  });
});

describe("observacionDeFila", () => {
  it("una observación nunca lleva precio: por eso basta con las tres columnas a cero", () => {
    // Lo que se teclea al pedir: un sitio, un nombre, o un nombre y su teléfono.
    expect(observacionDeFila(fila("PEDRO+610473077", "0", "0", "0,00"))).toBe("PEDRO 610473077");
    expect(observacionDeFila(fila("JORGE+PLANA", "0", "0", "0,00"))).toBe("JORGE PLANA");
    // Un teléfono a secas también es una observación, aunque no tenga letras.
    expect(observacionDeFila(fila("610473077", "0", "0", "0,00"))).toBe("610473077");
    // Un dígito perdido no lo es.
    expect(observacionDeFila(fila("5", "0", "0", "0,00"))).toBeNull();
  });

  it("el nombre y el teléfono con un espacio de verdad no se parten por las columnas", () => {
    expect(observacionDeFila(fila("PEDRO", "610473077", "0", "0", "0,00"))).toBe("PEDRO 610473077");
  });

  it("exige texto Y las tres columnas a cero", () => {
    expect(observacionDeFila(fila("TALLER", "0", "0", "0,00"))).toBe("TALLER");
    expect(observacionDeFila(fila("TALLER", "0", "0", "12,10"))).toBeNull(); // un importe
    expect(observacionDeFila(fila(".", "0", "0", "0,00"))).toBeNull(); // sin letras
    expect(observacionDeFila(fila("0", "0", "0,00"))).toBeNull(); // sin texto
    expect(observacionDeFila(fila("Importe", "Bruto:", "1.039,00"))).toBeNull(); // faltan columnas
  });
});

describe("limpiarObservacion", () => {
  it("los «+» son espacios y los espacios de más sobran", () => {
    expect(limpiarObservacion("JORGE+PLANA")).toBe("JORGE PLANA");
    expect(limpiarObservacion("  A++B  ")).toBe("A B");
    expect(limpiarObservacion("TALLER")).toBe("TALLER");
  });
});
