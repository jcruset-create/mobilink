import { describe, expect, it } from "vitest";
import { esAmasijo, lineasDeMercancia } from "./lineasAlbaran.ts";
import type { FilaPdf } from "./observaciones.ts";

const fila = (...palabras: string[]): FilaPdf => ({ palabras });
const CABECERA = fila("Artículo", "Descripción", "Cantidad", "Precio", "Dto.", "Importe");
const TOTALES = fila("Importe", "Bruto:", "1.039,00");

/** Un albarán de Soledad de los de verdad, con su descuento y su NFU. */
const ALBARAN: FilaPdf[] = [
  CABECERA,
  fila("0107091840003", "265/70X19.5", "HANKOOK", "AH35", "140M", "4", "263,7", "1.054,80"),
  fila("0119090430001", "315/80X22.5", "SAILUN", "SDR1", "156L", "4", "234,989", "939,96"),
  fila("0107099000009", "10", "EUR", "DTO", "UD", "HANKOOK", "-4", "10", "-40,00"),
  fila(".", "0", "0", "0,00"),
  fila("4102999990093", "S.I.Gestión", "de", "NFU", "Cat.D1T", "4", "6,05", "24,20"),
  fila("JORGE+PLANA", "0", "0", "0,00"),
  TOTALES,
];

describe("lineasDeMercancia · el albarán de Soledad", () => {
  it("saca cada artículo con su referencia, su descripción y su cantidad", () => {
    expect(lineasDeMercancia(ALBARAN)).toEqual([
      { referencia: "0107091840003", descripcion: "265/70X19.5 HANKOOK AH35 140M", cantidad: 4, precioCentimos: 26370 },
      { referencia: "0119090430001", descripcion: "315/80X22.5 SAILUN SDR1 156L", cantidad: 4, precioCentimos: 23499 },
    ]);
  });

  it("el descuento y la gestión de NFU no son mercancía: no se cuentan en el muelle", () => {
    const d = lineasDeMercancia(ALBARAN).map((l) => l.descripcion).join(" ");
    expect(d).not.toMatch(/DTO|NFU/);
  });

  it("ni la fila de puntos, ni la observación de después del NFU", () => {
    const d = lineasDeMercancia(ALBARAN).map((l) => l.descripcion).join(" ");
    expect(d).not.toMatch(/JORGE|^\.$/);
    expect(lineasDeMercancia(ALBARAN)).toHaveLength(2);
  });

  it("un PDF que no es un albarán conocido no da líneas: no se inventa mercancía", () => {
    expect(lineasDeMercancia([fila("un", "papel", "cualquiera")])).toEqual([]);
    expect(lineasDeMercancia([])).toEqual([]);
  });

  it("una cantidad que no es positiva no entra", () => {
    const conDevolucion = [CABECERA, fila("0107091840003", "265/70X19.5", "HANKOOK", "AH35", "140M", "-2", "263,7", "-527,40"), TOTALES];
    expect(lineasDeMercancia(conDevolucion)).toEqual([]);
  });
});

/** La entrega de INSA, que ya se sabía leer: aquí sólo se comprueba el puente. */
const ENTREGA_INSA: FilaPdf[] = [
  fila("Entrega", "Nº", "Fecha", "S/Referencia"),
  fila("-".repeat(80)),
  fila("D26", "26031188", "18/09/2026", "333778"),
  fila("Referencias", "Descripción", "Cantidad", "Precio", "%", "Dto", "Total"),
  fila("PEDIDO", "Nº", "26001072", "FECHA", "12/08/2026"),
  fila("021300001012", "295/80X22.5", "INSA", "TURBO", "K25", "BASE", "1ª", "10,000UD", "190,000", "EUR", "0,00", "1.900,000"),
  fila("TALLER", "RIU", "CLAR"),
  fila("*".repeat(76)),
  fila("IMPORTE", "BRUTO", "DESCUENTO"),
];

describe("lineasDeMercancia · la entrega de INSA", () => {
  it("también sale por aquí, con la misma forma", () => {
    expect(lineasDeMercancia(ENTREGA_INSA)).toEqual([
      { referencia: "021300001012", descripcion: "295/80X22.5 INSA TURBO K25 BASE 1ª", cantidad: 10, precioCentimos: 19000 },
    ]);
  });
});

describe("esAmasijo · reconocer una tabla aplanada en una descripción", () => {
  it("la línea que salió del correo aplanado lo es", () => {
    expect(
      esAmasijo(
        "4.00 385/65R22.5 TORQUE TQ022 164K 211.28 2.00 385/65R22.5 HANKOOK TM11 160K 424.17 1.00 315/70R22.5 HANKOOK DL51 154L 439.37"
      )
    ).toBe(true);
  });

  it("un artículo de verdad no lo es, aunque su medida lleve un decimal", () => {
    expect(esAmasijo("245/70X17.5 HANKOOK AH35 136M")).toBe(false);
    expect(esAmasijo("315/80 R22.5 SAILUN SDR1 156L")).toBe(false);
    expect(esAmasijo("13X22.5 INSA TURBO TDO-3 1ª OT.")).toBe(false);
    expect(esAmasijo("")).toBe(false);
  });

  it("con UN importe dentro tampoco: hace falta que se haya tragado varias filas", () => {
    // Una descripción con un precio pegado es rara, pero no es media tabla.
    expect(esAmasijo("245/70X17.5 HANKOOK AH35 136M 248.45")).toBe(false);
    expect(esAmasijo("245/70X17.5 HANKOOK AH35 136M 248.45 2.00 315/80X22.5 SAILUN 234.99")).toBe(true);
  });
});
