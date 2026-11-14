/**
 * Dónde está la tablet de un operario, dicho en la lista de usuarios.
 *
 * Lo que más importa aquí es cuándo se dice «frío». Una posición de hace tres
 * minutos sirve para ir a buscar a alguien; una de hace dos horas no, y
 * enseñarla igual que la otra haría que alguien saliera a un sitio donde ya no
 * está. La diferencia tiene que verse.
 */

import { describe, expect, it } from "vitest";

import {
  coordenadaValida,
  detalleDePosicion,
  enlaceDeMapa,
  indexarPosiciones,
  MAX_EDAD_MS,
  vistaHace,
} from "./ubicacionOperario";

const AHORA = Date.UTC(2026, 10, 9, 17, 0, 0);
const hace = (ms: number) => new Date(AHORA - ms).toISOString();

describe("cuánto hace que se la vio", () => {
  it("menos de un minuto es «ahora mismo»", () => {
    expect(vistaHace(hace(0), AHORA)).toEqual({ txt: "ahora mismo", frio: false });
    expect(vistaHace(hace(59_000), AHORA)).toEqual({ txt: "ahora mismo", frio: false });
  });

  it("minutos, y caliente hasta el cuarto de hora", () => {
    expect(vistaHace(hace(3 * 60_000), AHORA)).toEqual({ txt: "hace 3 min", frio: false });
    expect(vistaHace(hace(15 * 60_000), AHORA)).toEqual({ txt: "hace 15 min", frio: false });
    // Pasado el cuarto de hora, en gris: puede haberse movido sin que la
    // tablet lo haya contado.
    expect(vistaHace(hace(16 * 60_000), AHORA)).toEqual({ txt: "hace 16 min", frio: true });
  });

  it("horas, siempre en frío", () => {
    expect(vistaHace(hace(60 * 60_000), AHORA)).toEqual({ txt: "hace 1 h", frio: true });
    expect(vistaHace(hace(5 * 3600_000), AHORA)).toEqual({ txt: "hace 5 h", frio: true });
  });

  it("pasado un día no se da una hora concreta", () => {
    // 36 h en horas sería «hace 36 h», que nadie lee. Y da igual: a esa edad
    // la posición no dice dónde está.
    expect(vistaHace(hace(MAX_EDAD_MS + 60_000), AHORA))
      .toEqual({ txt: "hace más de un día", frio: true });
  });

  it("justo en el límite todavía se cuenta en horas", () => {
    expect(vistaHace(hace(MAX_EDAD_MS), AHORA).txt).toBe("hace 24 h");
  });

  it("sin fecha, o con una que no se entiende, raya", () => {
    expect(vistaHace(null, AHORA)).toEqual({ txt: "—", frio: true });
    expect(vistaHace(undefined, AHORA)).toEqual({ txt: "—", frio: true });
    expect(vistaHace("", AHORA)).toEqual({ txt: "—", frio: true });
    expect(vistaHace("esta mañana", AHORA)).toEqual({ txt: "—", frio: true });
  });

  it("una del futuro es un reloj mal puesto, no «hace -3 min»", () => {
    // Un margen de cinco minutos para el desfase normal entre relojes.
    expect(vistaHace(new Date(AHORA + 60_000).toISOString(), AHORA).txt).toBe("ahora mismo");
    expect(vistaHace(new Date(AHORA + 20 * 60_000).toISOString(), AHORA))
      .toEqual({ txt: "—", frio: true });
  });
});

describe("qué es una coordenada", () => {
  it("una de verdad", () => {
    expect(coordenadaValida(41.1189, 1.2445)).toBe(true); // Tarragona
  });

  it("el (0, 0) no: es un GPS sin fijar", () => {
    expect(coordenadaValida(0, 0)).toBe(false);
  });

  it("un cero solo sí: el meridiano y el ecuador existen", () => {
    expect(coordenadaValida(41.1, 0)).toBe(true);
    expect(coordenadaValida(0, 1.2)).toBe(true);
  });

  it("fuera del mundo, ni lo que no es número", () => {
    expect(coordenadaValida(91, 0)).toBe(false);
    expect(coordenadaValida(0, 181)).toBe(false);
    expect(coordenadaValida("hola", 1)).toBe(false);
    expect(coordenadaValida(null, null)).toBe(false);
  });
});

describe("el enlace al mapa", () => {
  it("mismo formato que la ficha del vehículo", () => {
    expect(enlaceDeMapa(41.118883, 1.244491))
      .toBe("https://www.google.com/maps?q=41.118883,1.244491");
  });

  it("siempre con seis decimales, también en un número redondo", () => {
    expect(enlaceDeMapa(41, 1)).toBe("https://www.google.com/maps?q=41.000000,1.000000");
  });
});

describe("indexar lo que llega de la base", () => {
  it("por usuario", () => {
    const m = indexarPosiciones([
      { usuario_id: "u1", lat: 41.1, lng: 1.2, visto_at: hace(60_000), precision_m: 12 },
      { usuario_id: "u2", lat: 41.2, lng: 1.3, visto_at: hace(120_000) },
    ]);
    expect(m.size).toBe(2);
    expect(m.get("u1")?.precision_m).toBe(12);
    expect(m.get("u2")?.precision_m).toBeNull();
  });

  it("tira la basura en vez de pintarla en el golfo de Guinea", () => {
    const m = indexarPosiciones([
      { usuario_id: "u1", lat: 0, lng: 0, visto_at: hace(60_000) },
      { usuario_id: "u2", lat: 41.2, lng: 1.3, visto_at: undefined },
      { usuario_id: undefined, lat: 41.3, lng: 1.4, visto_at: hace(60_000) },
      { usuario_id: "u4", lat: 41.4, lng: 1.5, visto_at: hace(60_000) },
    ]);
    expect([...m.keys()]).toEqual(["u4"]);
  });

  it("una lista vacía o nula no es un error", () => {
    expect(indexarPosiciones([]).size).toBe(0);
    expect(indexarPosiciones(null).size).toBe(0);
    expect(indexarPosiciones(undefined).size).toBe(0);
  });
});

describe("el detalle del title", () => {
  it("lleva la hora exacta y la precisión cuando la hay", () => {
    const t = detalleDePosicion({
      usuario_id: "u1", lat: 41.1, lng: 1.2, precision_m: 12.4, visto_at: hace(60_000),
    });
    expect(t).toContain("precisión ±12 m");
    expect(t).toContain("Abre Google Maps");
  });

  it("sin precisión no se inventa una", () => {
    const t = detalleDePosicion({
      usuario_id: "u1", lat: 41.1, lng: 1.2, precision_m: null, visto_at: hace(60_000),
    });
    expect(t).not.toContain("precisión");
  });
});
