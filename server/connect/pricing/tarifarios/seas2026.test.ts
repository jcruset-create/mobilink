/**
 * Guardas sobre el tarifario de SEAS como DATOS.
 *
 * No comprueban que los importes sean los correctos —eso solo lo puede decir
 * el documento, contrastándolo a mano— sino que la transcripción tiene la
 * forma que debe: que ninguna fila se ha desalineado, que no se ha colado un
 * cero donde el PDF tenía una celda vacía, y que no hay dos precios para la
 * misma combinación peleándose por ganar.
 *
 * Son las pegas que la vista se salta al copiar una tabla de doce filas por
 * nueve columnas dos veces.
 */

import { describe, expect, it } from "vitest";
import { SEAS_2026_COMPRA, SEAS_2026_VENTA } from "./seas2026.ts";

const LADOS = [
  ["venta", SEAS_2026_VENTA],
  ["compra", SEAS_2026_COMPRA],
] as const;

describe("SEAS 2026 como datos", () => {
  it.each(LADOS)("%s: ningún precio neto vale cero", (_lado, t) => {
    /*
     * En el PDF hay celdas vacías y celdas con "0,00 €". Las dos quieren decir
     * que no hay precio. Un cero cargado se facturaría, y un neumático de
     * camión no cuesta cero euros.
     */
    const netos = (t.preciosNeumaticos ?? []).filter((p) => p.modelo === "NET_PRICE");
    expect(netos.length).toBeGreaterThan(50);
    for (const p of netos) {
      expect(Number(p.neto)).toBeGreaterThan(0);
    }
  });

  it.each(LADOS)("%s: no hay dos precios para la misma combinación", (_lado, t) => {
    // Un empate exacto haría que el importe dependiera del orden de inserción
    const visto = new Set<string>();
    for (const p of t.preciosNeumaticos ?? []) {
      const clave = [p.medida ?? "*", p.marca ?? "*", p.grupoMarca ?? "*", p.posicion, p.prioridad].join("|");
      expect(visto.has(clave), `combinación repetida: ${clave}`).toBe(false);
      visto.add(clave);
    }
  });

  it.each(LADOS)("%s: todo grupo citado en un precio existe", (_lado, t) => {
    const grupos = new Set((t.gruposMarca ?? []).map((g) => g.code));
    for (const p of t.preciosNeumaticos ?? []) {
      if (p.grupoMarca) expect(grupos.has(p.grupoMarca), `grupo desconocido: ${p.grupoMarca}`).toBe(true);
    }
  });

  it.each(LADOS)("%s: un precio cuelga de una marca o de un grupo, no de los dos", (_lado, t) => {
    for (const p of t.preciosNeumaticos ?? []) {
      expect(!(p.marca && p.grupoMarca), `${p.medida} ${p.marca}/${p.grupoMarca}`).toBe(true);
    }
  });

  it.each(LADOS)("%s: los descuentos sobre baremo son porcentajes, no precios", (_lado, t) => {
    // Un 610 aquí en lugar de un 39 daría un precio negativo
    const descuentos = (t.preciosNeumaticos ?? []).filter((p) => p.modelo === "DISCOUNT_FROM_LIST");
    expect(descuentos.length).toBeGreaterThan(10);
    for (const p of descuentos) {
      const d = Number(p.descuento);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(100);
      // Y valen para cualquier medida: son el comodín de "lo que no tiene neto"
      expect(p.medida).toBeNull();
      expect(p.prioridad).toBeLessThan(10);
    }
  });

  it.each(LADOS)("%s: toda regla apunta a extras que existen", (_lado, t) => {
    const extras = new Set(t.extras.map((e) => e.code));
    for (const r of t.reglas) {
      if (r.extraKm) expect(extras.has(r.extraKm), `${r.code} → ${r.extraKm}`).toBe(true);
      if (r.extraTiempo) expect(extras.has(r.extraTiempo), `${r.code} → ${r.extraTiempo}`).toBe(true);
    }
  });

  it.each(LADOS)("%s: toda regla apunta a franjas y zonas que existen", (_lado, t) => {
    const franjas = new Set(t.franjas.map((f) => f.code));
    const zonas = new Set(t.zonas.map((z) => z.code));
    for (const r of t.reglas) {
      if (r.franja) expect(franjas.has(r.franja), `${r.code} → ${r.franja}`).toBe(true);
      if (r.zona) expect(zonas.has(r.zona), `${r.code} → ${r.zona}`).toBe(true);
    }
  });

  it.each(LADOS)("%s: no hay dos reglas con la misma prioridad", (_lado, t) => {
    // Un empate de prioridad y especificidad dispara AMBIGUOUS_RULES en el
    // motor: mejor que no llegue a la base.
    const prioridades = t.reglas.map((r) => r.prioridad);
    expect(new Set(prioridades).size).toBe(prioridades.length);
  });

  it("las dos tablas cubren las mismas combinaciones de neumático", () => {
    /*
     * Si una fila se desalineó al transcribir, lo más probable es que una de
     * las dos tablas acabe con una combinación que la otra no tiene. No sería
     * un error fatal —el margen saldría indeterminado— pero sí una señal de
     * que hay que volver al PDF.
     */
    const clave = (t: typeof SEAS_2026_VENTA) =>
      new Set((t.preciosNeumaticos ?? [])
        .filter((p) => p.modelo === "NET_PRICE")
        .map((p) => `${p.medida}|${p.marca ?? p.grupoMarca}|${p.posicion}`));

    const venta = clave(SEAS_2026_VENTA);
    const compra = clave(SEAS_2026_COMPRA);
    expect([...venta].filter((k) => !compra.has(k))).toEqual([]);
    expect([...compra].filter((k) => !venta.has(k))).toEqual([]);
  });

  it("los dos lados tienen las mismas reglas con importes distintos", () => {
    expect(SEAS_2026_VENTA.reglas.map((r) => r.code))
      .toEqual(SEAS_2026_COMPRA.reglas.map((r) => r.code));

    const importe = (t: typeof SEAS_2026_VENTA, code: string) =>
      t.reglas.find((r) => r.code === code)!.importe;

    expect(importe(SEAS_2026_VENTA, "DIURNO")).toBe("198");
    expect(importe(SEAS_2026_COMPRA, "DIURNO")).toBe("170");
  });

  it("el diurno proximidad tiene margen negativo, y está a propósito", () => {
    /*
     * Venta 110 y compra 125: SEAS paga al taller más de lo que cobra. Está
     * así en el documento. Esta prueba no lo aprueba: lo fija, para que si
     * alguien lo cambia sea a sabiendas y no de refilón.
     */
    const venta = Number(SEAS_2026_VENTA.reglas.find((r) => r.code === "DIURNO_PROX")!.importe);
    const compra = Number(SEAS_2026_COMPRA.reglas.find((r) => r.code === "DIURNO_PROX")!.importe);
    expect(venta).toBe(110);
    expect(compra).toBe(125);
    expect(venta - compra).toBe(-15);
  });

  it("tres marcas dan más descuento en venta que en compra", () => {
    // BARUM, DAYTON y FORMULA. También está en el documento.
    const dto = (t: typeof SEAS_2026_VENTA, marca: string) =>
      Number((t.preciosNeumaticos ?? []).find(
        (p) => p.modelo === "DISCOUNT_FROM_LIST" && p.marca === marca)!.descuento);

    const invertidas = ["Barum", "Dayton", "Formula"].filter(
      (m) => dto(SEAS_2026_VENTA, m) > dto(SEAS_2026_COMPRA, m));
    expect(invertidas).toEqual(["Barum", "Dayton", "Formula"]);
  });
});
