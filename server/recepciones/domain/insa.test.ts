import { describe, expect, it } from "vitest";
import { esEntregaInsa, leerEntregaInsa, nifsDelPapel, normalizarNif } from "./insa.ts";
import type { FilaPdf } from "./observaciones.ts";

const fila = (...palabras: string[]): FilaPdf => ({ palabras });

/**
 * La entrega D26-26031188 del 18/09/2026, copiada tal cual del lector de PDF
 * sobre el fichero que manda INSA TURBO. Incluye lo que despista: la raya de
 * guiones entre la cabecera y sus datos, la moneda entre el precio y el
 * descuento, dos pedidos del proveedor, y el «CAMION (TRUCK) 26,000» de
 * después del cierre.
 */
const ENTREGA: FilaPdf[] = [
  fila("Datos", "de", "cliente"),
  fila("C121874"),
  fila("COMERCIAL", "SEA,", "S.A."),
  fila("Ctra.", "Aspe", "-", "Novelda,", "38", "PG.IND.", "RIU", "CLAR", "C/", "COURE,", "7"),
  fila("03680,", "Aspe", "43006", "TARRAGONA"),
  fila("ALICANTE", "Tarragona"),
  fila("VAT:", "ES", "A03297959", "ESPAÑA"),
  fila("Phone:", "(0034)", "96", "549", "56", "76", "/", "(0034)", "96", "549", "34", "78", "N.I.F.:", "ESA43044379"),
  fila("-".repeat(184)),
  fila("Entrega", "Nº", "Fecha", "S/Referencia", "Volumen", "Neto(Kg)", "Bruto(Kg)"),
  fila("-".repeat(185)),
  fila("D26", "26031188", "18/09/2026", "333778", "0,00"),
  fila("-".repeat(184)),
  fila("Condiciones", "pago", "Moneda", "Destino", "Origen/Final", "Transporte"),
  fila("-".repeat(184)),
  fila("TRANSFERENCIA", "60", "DIAS", "EUR"),
  fila("Referencias", "Descripción", "Cantidad", "Precio", "%", "Dto", "Total"),
  fila("PEDIDO", "Nº", "26001072", "FECHA", "12/08/2026"),
  fila("021300001012", "295/80X22.5", "INSA", "TURBO", "K25", "BASE", "1ª", "10,000UD", "190,000", "EUR", "0,00", "1.900,000"),
  fila("CASCOS", "HANKOOK", "o", "CONTINENTAL,", "PED.", "ALBERTO"),
  fila("TALLER", "RIU", "CLAR"),
  fila("PEDIDO", "Nº", "26001215", "FECHA", "18/09/2026"),
  fila("021000000259", "315/80X22.5", "INSA", "TURBO", "TDO-3", "SM", "1ªOT", "4,000UD", "140,000", "EUR", "0,00", "560,000"),
  fila("CUBIERTAS", "PARA", "TMA,", "PRECIO", "ESPECIAL"),
  fila("*"),
  fila("021300000867", "315/70X22.5", "INSA", "TURBO", "K700", "TECH", "1ª", "4,000UD", "216,300", "EUR", "15,57", "730,490"),
  fila("*"),
  fila("AGENCIA", "TRANSAHER", "A", "RIU", "CLAR.", "PED.", "JORDI"),
  fila("*".repeat(76)),
  fila("CAMION", "(TRUCK)", "26,000"),
  fila("IMPORTE", "BRUTO", "DESCUENTO", "BASE", "IMPONIBLE", "%", "IVA", "IMPORTE", "IVA", "LÍQUIDO"),
  fila("4.735,690", "0,000", "4.735,690", "21,000", "994,490", "5.730,180", "EUR"),
];

describe("leerEntregaInsa", () => {
  it("lee el número de la entrega, que va DEBAJO de su cabecera con una raya por medio", () => {
    const e = leerEntregaInsa(ENTREGA)!;
    expect(e.numeroAlbaran).toBe("D26-26031188");
    expect(e.fecha).toBe("2026-09-18");
    expect(e.referenciaCliente).toBe("333778");
  });

  it("lee las líneas con su cantidad y su precio, saltándose la moneda", () => {
    const e = leerEntregaInsa(ENTREGA)!;
    expect(e.lineas).toEqual([
      { referencia: "021300001012", descripcion: "295/80X22.5 INSA TURBO K25 BASE 1ª", cantidad: 10, precioCentimos: 19000, pedidoProveedor: "26001072" },
      { referencia: "021000000259", descripcion: "315/80X22.5 INSA TURBO TDO-3 SM 1ªOT", cantidad: 4, precioCentimos: 14000, pedidoProveedor: "26001215" },
      { referencia: "021300000867", descripcion: "315/70X22.5 INSA TURBO K700 TECH 1ª", cantidad: 4, precioCentimos: 21630, pedidoProveedor: "26001215" },
    ]);
  });

  it("cada línea sabe de qué pedido del proveedor es, y los pedidos salen con su fecha", () => {
    const e = leerEntregaInsa(ENTREGA)!;
    expect(e.pedidos).toEqual([
      { numero: "26001072", fecha: "2026-08-12" },
      { numero: "26001215", fecha: "2026-09-18" },
    ]);
  });

  it("la cantidad lleva la unidad pegada y tres decimales: «10,000UD» son 10, no 10.000", () => {
    const e = leerEntregaInsa(ENTREGA)!;
    expect(e.lineas.map((l) => l.cantidad)).toEqual([10, 4, 4]);
  });

  it("saca la localidad del destinatario de la cabecera", () => {
    expect(leerEntregaInsa(ENTREGA)!.destinoLocalidad).toBe("TARRAGONA");
  });

  it("ni el «CAMION (TRUCK) 26,000» ni los totales pasan por mercancía", () => {
    const e = leerEntregaInsa(ENTREGA)!;
    expect(e.lineas.map((l) => l.descripcion).join(" ")).not.toMatch(/CAMION|IMPORTE/);
    expect(e.lineas).toHaveLength(3);
  });

  it("las observaciones vienen con la entrega: es lo que dice para quién es", () => {
    expect(leerEntregaInsa(ENTREGA)!.observaciones).toContain("TALLER RIU CLAR");
  });

  it("lo que no es una entrega de INSA no se lee: se devuelve null en vez de inventarse un albarán", () => {
    expect(esEntregaInsa([fila("un", "papel", "cualquiera")])).toBe(false);
    expect(leerEntregaInsa([fila("un", "papel", "cualquiera")])).toBeNull();
    expect(leerEntregaInsa([])).toBeNull();
  });

  it("una entrega con un solo pedido también se lee, y sus líneas lo llevan", () => {
    const una = ENTREGA.filter((f) => !f.palabras.join(" ").includes("26001215") && !f.palabras.join(" ").includes("INSA TURBO TDO-3") && !f.palabras.join(" ").includes("K700"));
    const e = leerEntregaInsa(una)!;
    expect(e.pedidos).toEqual([{ numero: "26001072", fecha: "2026-08-12" }]);
    expect(e.lineas).toHaveLength(1);
    expect(e.lineas[0].pedidoProveedor).toBe("26001072");
  });
});

describe("el NIF del papel", () => {
  it("se lee con y sin prefijo de país, y con o sin guiones", () => {
    expect(normalizarNif("A03297959")).toBe("A03297959");
    expect(normalizarNif("ESA43044379")).toBe("A43044379");
    expect(normalizarNif("A-03297959")).toBe("A03297959");
    expect(normalizarNif("12345678Z")).toBe("12345678Z");
  });

  it("lo que no tiene forma de NIF no lo es: ni el pedido, ni la referencia, ni el registro", () => {
    expect(normalizarNif("26001072")).toBe("");
    expect(normalizarNif("021300001012")).toBe("");
    expect(normalizarNif("NEU/2021/000000347")).toBe("");
    expect(normalizarNif("TARRAGONA")).toBe("");
    expect(normalizarNif("")).toBe("");
  });

  it("del papel salen los dos: el del proveedor y el nuestro", () => {
    // Quién es quién no se decide aquí: se miran los dos contra los
    // proveedores dados de alta, y nosotros no somos proveedor de nadie.
    expect(nifsDelPapel(ENTREGA)).toEqual(["A03297959", "A43044379"]);
    expect(leerEntregaInsa(ENTREGA)!.nifs).toEqual(["A03297959", "A43044379"]);
  });
});
