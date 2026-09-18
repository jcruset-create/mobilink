import { describe, expect, it } from "vitest";
import {
  filasConContinuaciones,
  formatoDelAlbaran,
  limpiarObservacion,
  observacionDeFila,
  observacionesDelAlbaran,
  observacionesInsa,
  partirObservacion,
  type FilaPdf,
} from "./observaciones.ts";

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

/**
 * El albarán de entrega de INSA TURBO (Industrias del Neumático SAU, del mismo
 * grupo que Soledad), copiado del lector de PDF: entrega D26-26031188 del
 * 18/09/2026. Otra plantilla entera, con VARIOS pedidos en un solo albarán y
 * las observaciones como texto suelto debajo de su artículo.
 */
const ENTREGA_INSA: FilaPdf[] = [
  fila("Entrega", "Nº", "Fecha", "S/Referencia", "Volumen", "Neto(Kg)", "Bruto(Kg)"),
  fila("D26", "26031188", "18/09/2026", "333778", "0,00"),
  fila("Condiciones", "pago", "Moneda", "Destino", "Origen/Final", "Transporte"),
  fila("TRANSFERENCIA", "60", "DIAS", "EUR"),
  fila("Referencias", "Descripción", "Cantidad", "Precio", "%", "Dto", "Total"),
  fila("PEDIDO", "Nº", "26001072", "FECHA", "12/08/2026"),
  fila("021300001012", "295/80X22.5", "INSA", "TURBO", "K25", "BASE", "1ª", "10,000UD", "190,000", "EUR", "0,00", "1.900,000"),
  fila("CASCOS", "HANKOOK", "o", "CONTINENTAL,", "PED.", "ALBERTO"),
  fila("PRECIO", "AUTORIZADO", "PACO", "MACIÁ"),
  fila("TALLER", "RIU", "CLAR"),
  fila("PEDIDO", "Nº", "26001215", "FECHA", "18/09/2026"),
  fila("021000000259", "315/80X22.5", "INSA", "TURBO", "TDO-3", "SM", "1ªOT", "4,000UD", "140,000", "EUR", "0,00", "560,000"),
  fila("CUBIERTAS", "PARA", "TMA,", "PRECIO", "ESPECIAL"),
  fila("*"),
  fila("021000000198", "13X22.5", "INSA", "TURBO", "TDO-3", "1ª", "OT.", "4,000UD", "170,000", "EUR", "0,00", "680,000"),
  fila("CUBIERTAS", "PARA", "TMA,", "PRECIO", "ESPECIAL"),
  fila("CASCOS", "EN", "COMPENSACIÓN,BOLSA", "CATALUÑA"),
  fila("AUTORIZA", "PACO", "MACIÁ."),
  fila("*"),
  fila("021300000867", "315/70X22.5", "INSA", "TURBO", "K700", "TECH", "1ª", "4,000UD", "216,300", "EUR", "15,57", "730,490"),
  fila("021300000865", "315/80X22.5", "INSA", "TURBO", "K700", "TECH", "1ª", "4,000UD", "216,300", "EUR", "0,00", "865,200"),
  fila("FACTURAR", "SÓLO", "EL", "NOMINATIVO,", "CASCOS"),
  fila("EN", "COMPENSACIÓN,BOLSA", "CATALUÑA"),
  fila("AUTORIZA", "PACO", "MACIÁ."),
  fila("*"),
  fila("AGENCIA", "TRANSAHER", "A", "RIU", "CLAR.", "PED.", "JORDI"),
  fila("*".repeat(76)),
  fila("CAMION", "(TRUCK)", "26,000"),
  fila("IMPORTE", "BRUTO", "DESCUENTO", "BASE", "IMPONIBLE", "%", "IVA", "IMPORTE", "IVA", "LÍQUIDO"),
  fila("4.735,690", "0,000", "4.735,690", "21,000", "994,490", "5.730,180", "EUR"),
  fila("BBAN", "3058", "2527", "2527", "2000", "4946"),
];

describe("la entrega de INSA TURBO", () => {
  it("se reconoce por su cabecera, que no es la de Soledad", () => {
    expect(formatoDelAlbaran(ENTREGA_INSA)).toBe("INSA");
    expect(formatoDelAlbaran(ALBARAN_JORGE)).toBe("SOLEDAD");
    expect(formatoDelAlbaran([fila("un", "papel", "cualquiera")])).toBeNull();
  });

  it("lee las observaciones de debajo de cada artículo, sin repetir las repetidas", () => {
    expect(observacionesDelAlbaran(ENTREGA_INSA)).toEqual([
      "CASCOS HANKOOK o CONTINENTAL, PED. ALBERTO",
      "PRECIO AUTORIZADO PACO MACIÁ",
      "TALLER RIU CLAR",
      "CUBIERTAS PARA TMA, PRECIO ESPECIAL",
      "CASCOS EN COMPENSACIÓN,BOLSA CATALUÑA",
      "AUTORIZA PACO MACIÁ.",
      "FACTURAR SÓLO EL NOMINATIVO, CASCOS",
      "EN COMPENSACIÓN,BOLSA CATALUÑA",
      "AGENCIA TRANSAHER A RIU CLAR. PED. JORDI",
    ]);
  });

  it("ningún artículo pasa por observación, ni al revés", () => {
    const obs = observacionesInsa(ENTREGA_INSA);
    for (const o of obs) {
      expect(o).not.toMatch(/INSA TURBO/);
      expect(o).not.toMatch(/UD\b/);
    }
    expect(obs).toHaveLength(9);
  });

  it("lo de antes de la cabecera y lo de después de los asteriscos se queda fuera", () => {
    const obs = observacionesInsa(ENTREGA_INSA);
    // El membrete y las condiciones de pago van ANTES de la tabla.
    expect(obs.join(" ")).not.toMatch(/TRANSFERENCIA|Condiciones/);
    // Y «CAMION (TRUCK) 26,000» va DESPUÉS de la fila de asteriscos: tiene
    // letras y pasaría por observación si no se cerrara el cuerpo ahí.
    expect(obs.join(" ")).not.toMatch(/CAMION/);
    // Ni los totales ni el banco.
    expect(obs.join(" ")).not.toMatch(/IMPORTE BRUTO|BBAN/);
  });

  it("la cabecera de cada pedido agrupa, no es una observación", () => {
    expect(observacionesInsa(ENTREGA_INSA).join(" ")).not.toMatch(/26001072|26001215/);
  });

  it("de aquí sale a quién avisar: quien pidió, no el recado de precios", () => {
    const partidas = observacionesInsa(ENTREGA_INSA).map(partirObservacion);
    // Esta entrega no trae ningún móvil, así que no se avisaría a nadie.
    expect(partidas.find((o) => o.telefono)).toBeUndefined();
  });
});

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

  /**
   * Albarán 2028458827, tal cual sale del PDF. Aquí pasan LAS DOS cosas: el
   * artículo se parte en dos líneas («…SAILUN STR1+» / «164K») y la
   * observación también («OSCAR+SALVADOR+SANJULIAN» / «+629862105»). La
   * segunda línea no lleva columnas numéricas, y ahí es donde está el
   * teléfono: perderla era perder justo el dato que sirve para avisar.
   */
  const ALBARAN_PARTIDO: FilaPdf[] = [
    CABECERA,
    fila("0119090530003", "385/65X22.5", "SAILUN", "STR1+", "2", "261,346", "522,69"),
    fila("164K"),
    fila(".", "0", "0", "0,00"),
    fila("4102999990094", "S.I.Gestión", "de", "NFU", "Cat.D2T", "2", "12,18", "24,36"),
    fila("OSCAR+SALVADOR+SANJULIAN", "0", "0", "0,00"),
    fila("+629862105"),
    fila("0", "0", "0,00"),
    fila("Importe", "Bruto:", "547,05"),
  ];

  it("la observación que sigue en la línea de abajo se lee entera, teléfono incluido", () => {
    expect(observacionesDelAlbaran(ALBARAN_PARTIDO)).toEqual(["OSCAR SALVADOR SANJULIAN 629862105"]);
    expect(partirObservacion(observacionesDelAlbaran(ALBARAN_PARTIDO)[0])).toEqual({
      texto: "OSCAR SALVADOR SANJULIAN",
      telefono: "629862105",
    });
  });

  it("la continuación de un artículo se queda en el artículo, no se cuela de observación", () => {
    // «164K» es la segunda línea del neumático, no un dato suelto.
    expect(observacionesDelAlbaran(ALBARAN_PARTIDO)).toHaveLength(1);
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

describe("filasConContinuaciones", () => {
  it("pega la línea de abajo a la DESCRIPCIÓN, no detrás de los números", () => {
    const filas = [fila("OSCAR+SALVADOR+SANJULIAN", "0", "0", "0,00"), fila("+629862105")];
    expect(filasConContinuaciones(filas)).toEqual([
      { descripcion: ["OSCAR+SALVADOR+SANJULIAN", "+629862105"], numeros: [0, 0, 0] },
    ]);
  });

  it("una continuación sin fila anterior no revienta ni se inventa una", () => {
    expect(filasConContinuaciones([fila("164K")])).toEqual([]);
  });
});

describe("partirObservacion", () => {
  it("saca el móvil a su propio campo y deja el resto como texto", () => {
    expect(partirObservacion("PEDRO 610473077")).toEqual({ texto: "PEDRO", telefono: "610473077" });
    expect(partirObservacion("610473077 PEDRO")).toEqual({ texto: "PEDRO", telefono: "610473077" });
    expect(partirObservacion("610473077")).toEqual({ texto: "", telefono: "610473077" });
  });

  it("admite el móvil escrito como lo escribe la gente", () => {
    expect(partirObservacion("PEDRO 610 473 077")).toEqual({ texto: "PEDRO", telefono: "610473077" });
    expect(partirObservacion("PEDRO 610.473.077")).toEqual({ texto: "PEDRO", telefono: "610473077" });
    expect(partirObservacion("PEDRO +34 610473077")).toEqual({ texto: "PEDRO", telefono: "610473077" });
    expect(partirObservacion("PEDRO 710473077")).toEqual({ texto: "PEDRO", telefono: "710473077" });
  });

  it("al sacar el móvil no se arrasa con la puntuación de la frase", () => {
    // La observación de INSA es una frase de verdad, no una etiqueta.
    expect(partirObservacion("CASCOS HANKOOK o CONTINENTAL, PED. ALBERTO 610473077")).toEqual({
      texto: "CASCOS HANKOOK o CONTINENTAL, PED. ALBERTO",
      telefono: "610473077",
    });
    expect(partirObservacion("610473077 AGENCIA TRANSAHER A RIU CLAR. PED. JORDI")).toEqual({
      texto: "AGENCIA TRANSAHER A RIU CLAR. PED. JORDI",
      telefono: "610473077",
    });
  });

  it("lo que no es un móvil español se queda donde está", () => {
    // Un fijo no sirve para WhatsApp.
    expect(partirObservacion("TALLER 977123456")).toEqual({ texto: "TALLER 977123456", telefono: null });
    // Ni un número de pedido: avisar a un desconocido es peor que no avisar.
    expect(partirObservacion("PEDIDO 5693921")).toEqual({ texto: "PEDIDO 5693921", telefono: null });
    expect(partirObservacion("PEDIDO 6104730771")).toEqual({ texto: "PEDIDO 6104730771", telefono: null });
    expect(partirObservacion("TALLER")).toEqual({ texto: "TALLER", telefono: null });
    expect(partirObservacion("JORGE PLANA")).toEqual({ texto: "JORGE PLANA", telefono: null });
  });
});
