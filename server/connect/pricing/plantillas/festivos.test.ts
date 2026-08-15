/**
 * Los festivos que genera el calendario de una central nueva.
 *
 * Se prueba la Pascua contra años conocidos porque es lo único aquí que se
 * calcula en vez de estar escrito, y porque un Viernes Santo mal puesto
 * cobraría un servicio como laborable el día de más tráfico de la Semana
 * Santa.
 */

import { describe, expect, it } from "vitest";
import { domingoDePascua, festivosNacionales } from "./festivos.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("Domingo de Pascua", () => {
  it("cuadra con años conocidos", () => {
    // Comprobados contra el calendario gregoriano
    expect(iso(domingoDePascua(2024))).toBe("2024-03-31");
    expect(iso(domingoDePascua(2025))).toBe("2025-04-20");
    expect(iso(domingoDePascua(2026))).toBe("2026-04-05");
    expect(iso(domingoDePascua(2027))).toBe("2027-03-28");
    expect(iso(domingoDePascua(2030))).toBe("2030-04-21");
    expect(iso(domingoDePascua(2038))).toBe("2038-04-25");   // la más tardía posible
    expect(iso(domingoDePascua(2035))).toBe("2035-03-25");
  });

  it("siempre cae en domingo", () => {
    for (let a = 2024; a <= 2060; a++) {
      expect(domingoDePascua(a).getUTCDay(), String(a)).toBe(0);
    }
  });
});

describe("Festivos nacionales", () => {
  it("España trae los nueve fijos más el Viernes Santo", () => {
    const d = festivosNacionales("ES", 2026);
    expect(d).toHaveLength(10);
    expect(d.map((x) => x.fecha)).toContain("2026-04-03");   // Viernes Santo de 2026
    expect(d.map((x) => x.fecha)).toContain("2026-12-25");
  });

  it("la Navidad y el Año Nuevo llevan clase propia para poder cobrarse aparte", () => {
    /*
     * Sin esto, un tarifario que quiera cobrar el 25 de diciembre distinto del
     * resto de festivos tendría que mirar la fecha en el código, y eso es
     * exactamente lo que este motor no hace.
     */
    const d = festivosNacionales("ES", 2026);
    expect(d.find((x) => x.fecha === "2026-12-25")).toMatchObject({ clase: "christmas", ambito: "special" });
    expect(d.find((x) => x.fecha === "2026-01-01")).toMatchObject({ clase: "new_year", ambito: "special" });
    expect(d.find((x) => x.fecha === "2026-10-12")).toMatchObject({ ambito: "national" });
  });

  it("el Viernes Santo no se marca como anual: cambia cada año", () => {
    const d = festivosNacionales("ES", 2026);
    expect(d.find((x) => x.nombre === "Viernes Santo")!.anual).toBe(false);
    expect(d.find((x) => x.nombre === "Navidad")!.anual).toBe(true);
  });

  it("no se inventa los traslados ni los autonómicos", () => {
    /*
     * En 2026 el 1 de noviembre cae en domingo y suele trasladarse al 2. Ese
     * traslado lo decide el Gobierno cada año: aquí va la fecha canónica y el
     * traslado se añade a mano. Un calendario que parece completo y no lo está
     * es peor que uno corto.
     */
    const d = festivosNacionales("ES", 2026);
    expect(d.map((x) => x.fecha)).toContain("2026-11-01");
    expect(d.map((x) => x.fecha)).not.toContain("2026-11-02");
    expect(d.every((x) => x.ambito !== "regional")).toBe(true);
  });

  it("Portugal trae los suyos, no los de España", () => {
    const d = festivosNacionales("PT", 2026);
    expect(d.map((x) => x.nombre)).toContain("Dia da Liberdade");
    expect(d.map((x) => x.nombre)).not.toContain("Fiesta Nacional de España");
  });

  it("un país que no está cae a España en vez de dejar el calendario vacío", () => {
    // Un calendario vacío haría que ningún festivo se cobrara como festivo
    expect(festivosNacionales("XX", 2026).length).toBeGreaterThan(5);
  });

  it("salen ordenados por fecha", () => {
    const f = festivosNacionales("ES", 2027).map((x) => x.fecha);
    expect([...f].sort()).toEqual(f);
  });
});
