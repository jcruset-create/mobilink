import { describe, expect, it } from "vitest";
import { repartirArqueo } from "./erpsplit.ts";
import type { LineaDenominacion } from "./inventory.ts";

const total = (l: readonly LineaDenominacion[]) => l.reduce((a, x) => a + x.valor * x.cantidad, 0);

/** El caso real del 18/08: 350 € de fondo, 29,69 € de taller, 50 € de gasolinera. */
const CONTADO: LineaDenominacion[] = [
  { valor: 5000, cantidad: 5 }, // 250,00
  { valor: 2000, cantidad: 3 }, //  60,00
  { valor: 1000, cantidad: 6 }, //  60,00
  { valor: 200, cantidad: 6 }, //  12,00
  { valor: 100, cantidad: 24 }, //  24,00
  { valor: 50, cantidad: 22 }, //  11,00
  { valor: 20, cantidad: 15 }, //   3,00
  { valor: 10, cantidad: 50 }, //   5,00
  { valor: 5, cantidad: 65 }, //   3,25
  { valor: 2, cantidad: 53 }, //   1,06
  { valor: 1, cantidad: 38 }, //   0,38
];

describe("reparto del arqueo entre cajas de la ERP", () => {
  it("aparta la gasolinera y deja el resto al taller", () => {
    expect(total(CONTADO)).toBe(42969);

    const r = repartirArqueo(CONTADO, "Taller", [
      { sectionId: 2, nombre: "Gasolinera", efectivoNetoCentimos: 5000 },
    ]);

    expect(r.aparte).toHaveLength(1);
    expect(r.aparte[0].importeCentimos).toBe(5000);
    // El billete más grande que quepa: 50 € es un billete, no cincuenta monedas.
    expect(r.aparte[0].piezas).toEqual([{ valor: 5000, cantidad: 1 }]);
    expect(r.principal.importeCentimos).toBe(37969);
    expect(total(r.principal.piezas)).toBe(37969);
  });

  it("las dos cajas suman exactamente lo contado", () => {
    // Es la propiedad que hace que el cierre de Genes cuadre. Sin ella el
    // reparto sería decorativo.
    const r = repartirArqueo(CONTADO, "Taller", [
      { sectionId: 2, nombre: "Gasolinera", efectivoNetoCentimos: 5000 },
      { sectionId: 3, nombre: "Tienda", efectivoNetoCentimos: 1234 },
    ]);
    const suma = r.principal.importeCentimos + r.aparte.reduce((a, c) => a + c.importeCentimos, 0);
    expect(suma).toBe(total(CONTADO));
    expect(total(r.principal.piezas) + r.aparte.reduce((a, c) => a + total(c.piezas), 0)).toBe(
      total(CONTADO)
    );
  });

  it("ninguna pieza se reparte dos veces", () => {
    const r = repartirArqueo(CONTADO, "Taller", [
      { sectionId: 2, nombre: "Gasolinera", efectivoNetoCentimos: 5000 },
      { sectionId: 3, nombre: "Tienda", efectivoNetoCentimos: 2000 },
    ]);
    const usadas = new Map<number, number>();
    for (const l of [...r.principal.piezas, ...r.aparte.flatMap((c) => c.piezas)]) {
      usadas.set(l.valor, (usadas.get(l.valor) ?? 0) + l.cantidad);
    }
    for (const l of CONTADO) expect(usadas.get(l.valor) ?? 0).toBe(l.cantidad);
  });

  it("aparta primero la sección de más importe", () => {
    // Con poco menudo, atender antes a la grande evita que la pequeña se quede
    // sin piezas por haberle dado el billete que necesitaba la otra.
    const r = repartirArqueo(CONTADO, "Taller", [
      { sectionId: 3, nombre: "Tienda", efectivoNetoCentimos: 1000 },
      { sectionId: 2, nombre: "Gasolinera", efectivoNetoCentimos: 5000 },
    ]);
    expect(r.aparte[0].nombre).toBe("Gasolinera");
    expect(r.aparte[1].nombre).toBe("Tienda");
  });

  it("marca la sección cuyo dinero ya no está en el cajón, sin inventarse piezas", () => {
    // El importe es bueno —sale del libro mayor— pero esos billetes ya se
    // fueron en un cambio. Antes que repartir mal, se dice.
    const pobre: LineaDenominacion[] = [{ valor: 1, cantidad: 5 }];
    const r = repartirArqueo(pobre, "Taller", [
      { sectionId: 2, nombre: "Gasolinera", efectivoNetoCentimos: 5000 },
    ]);
    expect(r.aparte[0].sinPiezas).toBe(true);
    expect(r.aparte[0].piezas).toEqual([]);
    expect(r.aparte[0].importeCentimos).toBe(5000);
    // Y la principal no se queda el dinero de la gasolinera por la puerta de atrás.
    expect(r.principal.importeCentimos).toBe(5 - 5000);
  });

  it("una sección que no movió efectivo no sale en el reparto", () => {
    const r = repartirArqueo(CONTADO, "Taller", [
      { sectionId: 2, nombre: "Gasolinera", efectivoNetoCentimos: 0 },
    ]);
    expect(r.aparte).toHaveLength(0);
    expect(r.principal.importeCentimos).toBe(total(CONTADO));
  });

  it("sin secciones aparte, todo es de la caja principal", () => {
    const r = repartirArqueo(CONTADO, "Taller", []);
    expect(r.aparte).toHaveLength(0);
    expect(r.principal.importeCentimos).toBe(total(CONTADO));
    expect(total(r.principal.piezas)).toBe(total(CONTADO));
  });
});
