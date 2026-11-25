import { describe, expect, it } from "vitest";

import {
  asignarVias, cajaDeTesela, puntosABuscar, refPrincipal, resumirDia, teselaDe, teselasDe, tipoDeVia,
  velocidadMaxima, type Candidata, type PuntoDia,
} from "./clasificar.ts";

const via = (highway: string, ref: string | null = null, extra: { maxspeed?: number | null; peaje?: boolean } = {}) =>
  ({ highway, ref, maxspeed: extra.maxspeed ?? null, peaje: extra.peaje ?? false });

describe("tipoDeVia", () => {
  it("autopista de peaje y autovía", () => {
    expect(tipoDeVia(via("motorway", "AP-7", { peaje: true }))).toBe("autopista");
    expect(tipoDeVia(via("motorway", "AP-7"))).toBe("autopista");
    expect(tipoDeVia(via("motorway", "C-32", { peaje: true }))).toBe("autopista");
    expect(tipoDeVia(via("motorway", "A-2"))).toBe("autovia");
    expect(tipoDeVia(via("motorway_link"))).toBe("autovia");
    expect(tipoDeVia(via("trunk", "C-31"))).toBe("autovia");
  });

  it("nacional, autonómica y provincial", () => {
    expect(tipoDeVia(via("primary", "N-340"))).toBe("nacional");
    expect(tipoDeVia(via("trunk", "N-II"))).toBe("autovia");
    expect(tipoDeVia(via("secondary", "C-14"))).toBe("autonomica");
    expect(tipoDeVia(via("secondary", "T-11"))).toBe("autonomica");
    expect(tipoDeVia(via("tertiary", "TV-3141"))).toBe("local");
    expect(tipoDeVia(via("tertiary", "BV-2002"))).toBe("local");
  });

  it("urbana y local sin matrícula", () => {
    expect(tipoDeVia(via("residential"))).toBe("urbana");
    expect(tipoDeVia(via("living_street"))).toBe("urbana");
    expect(tipoDeVia(via("primary"))).toBe("urbana");
    expect(tipoDeVia(via("secondary", null, { maxspeed: 50 }))).toBe("urbana");
    expect(tipoDeVia(via("tertiary", null, { maxspeed: 80 }))).toBe("local");
    expect(tipoDeVia(via("unclassified"))).toBe("local");
  });
});

describe("refPrincipal y velocidadMaxima", () => {
  it("normaliza la matrícula", () => {
    expect(refPrincipal("AP 7;E-15")).toBe("AP-7");
    expect(refPrincipal("n-340")).toBe("N-340");
    expect(refPrincipal("")).toBeNull();
  });
  it("entiende las velocidades de OSM", () => {
    expect(velocidadMaxima("50")).toBe(50);
    expect(velocidadMaxima("ES:urban")).toBe(50);
    expect(velocidadMaxima("ES:motorway")).toBe(120);
    expect(velocidadMaxima("none")).toBeNull();
  });
});

describe("teselas", () => {
  it("tesela y caja", () => {
    expect(teselaDe(41.15, 1.25)).toBe("411_12");
    expect(cajaDeTesela("411_12")).toEqual([41.1, 1.2, 41.2, 1.3]);
    expect(teselaDe(40.0, -0.05)).toBe("400_-1");
  });
  it("un punto junto al borde pide también la vecina", () => {
    expect(teselasDe([{ lat: 41.15, lng: 1.25 }])).toEqual(["411_12"]);
    expect(teselasDe([{ lat: 41.15, lng: 1.2999 }])).toEqual(["411_12", "411_13"]);
  });
});

/** Puntos hacia el este a ~`kmh`, uno cada 10 s. */
function ruta(n: number, kmh = 100, t0 = Date.UTC(2026, 10, 24, 6)): PuntoDia[] {
  const paso = (kmh / 3600) * 10 / (111.2 * Math.cos((41.1 * Math.PI) / 180));
  return Array.from({ length: n }, (_, i) => ({ t: t0 + i * 10_000, lat: 41.1, lng: 1.2 + i * paso }));
}
const cand = (i: number, osm_id: number, highway: string, ref: string | null, dist_m: number): Candidata =>
  ({ i, osm_id, highway, ref, nombre: null, maxspeed: null, peaje: false, dist_m });

describe("asignarVias y resumirDia", () => {
  it("se queda en la autovía aunque la vía de servicio esté un poco más cerca", () => {
    const p = ruta(4);
    const c = [
      cand(0, 1, "motorway", "A-2", 3),
      cand(1, 1, "motorway", "A-2", 9), cand(1, 2, "unclassified", null, 4),
      cand(2, 1, "motorway", "A-2", 4),
      cand(3, 1, "motorway", "A-2", 25), cand(3, 2, "unclassified", null, 2),
    ];
    const a = asignarVias(p, [0, 1, 2, 3], c);
    expect(a.map((x) => x.tipo)).toEqual(["autovia", "autovia", "autovia", "local"]);
  });

  it("parado hereda la vía; buscado sin nada cerca es «sin vía»", () => {
    const p = ruta(3);
    const a = asignarVias(p, [0, 2], [cand(0, 1, "residential", null, 5)]);
    expect(a.map((x) => x.tipo)).toEqual(["urbana", "urbana", "sin_via"]);
  });

  it("puntosABuscar salta los puntos parados", () => {
    const quieto = { t: 0, lat: 41.1, lng: 1.2 };
    const p = [quieto, { ...quieto, t: 10_000 }, { ...quieto, t: 20_000 }, ...ruta(2).map((x) => ({ ...x, lng: x.lng + 0.01 }))];
    expect(puntosABuscar(p)).toEqual([0, 3, 4]);
  });

  it("suma km por tipo y carretera; el cambio se reparte a medias", () => {
    const p = ruta(31); // 300 s a 100 km/h → 8,33 km
    const c: Candidata[] = p.map((_, i) => (i < 16 ? cand(i, 1, "motorway", "A-2", 3) : cand(i, 2, "primary", "N-340", 3)));
    const r = resumirDia(asignarVias(p, p.map((_, i) => i), c));
    expect(r.kmPuntos).toBeCloseTo(8.33, 1);
    const autovia = r.filas.find((f) => f.tipo === "autovia")!;
    const nacional = r.filas.find((f) => f.tipo === "nacional")!;
    expect(autovia.ref).toBe("A-2");
    expect(autovia.km).toBeCloseTo((15.5 / 30) * 8.33, 1);
    expect(nacional.km).toBeCloseTo((14.5 / 30) * 8.33, 1);
    expect(autovia.segundos + nacional.segundos).toBe(300);
    expect(r.tramos.map((t) => t.tipo)).toEqual(["autovia", "nacional"]);
    // Los tramos se tocan.
    expect(r.tramos[1].puntos[0]).toEqual(r.tramos[0].puntos[r.tramos[0].puntos.length - 1]);
  });

  it("un salto imposible del GPS no suma", () => {
    const p = ruta(3);
    p[2] = { ...p[2], lat: 42.1 }; // 111 km en 10 s
    const c = p.map((_, i) => cand(i, 1, "residential", null, 3));
    const r = resumirDia(asignarVias(p, [0, 1, 2], c));
    expect(r.kmPuntos).toBeLessThan(1);
  });
});
