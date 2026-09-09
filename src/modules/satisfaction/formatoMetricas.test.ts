import { describe, expect, it } from "vitest";

import {
  MUESTRA_MINIMA, SIN_DATOS, anchosDeBarras, construirSerie, distribucionCompleta,
  etiquetaPeriodo, etiquetaTramo, formatearDuracion, formatearEntero, formatearMedia,
  formatearPct, muestraSuficiente, textoDanos, textoMuestra, textoPorCada100,
  textoTasaRespuesta,
} from "./formatoMetricas.ts";

describe("medias", () => {
  it("usa coma decimal y dos decimales", () => {
    expect(formatearMedia({ media: 4.25, respuestas: 12 })).toBe("4,25");
    expect(formatearMedia({ media: 5, respuestas: 1 })).toBe("5,00");
  });

  it("sin respuestas dice «Sin datos», nunca cero", () => {
    expect(formatearMedia({ media: null, respuestas: 0 })).toBe(SIN_DATOS);
    expect(formatearMedia(null)).toBe(SIN_DATOS);
    // El caso peligroso: media presente pero muestra vacía. Sigue sin ser un dato.
    expect(formatearMedia({ media: 0, respuestas: 0 })).toBe(SIN_DATOS);
  });

  it("una media de cero con respuestas sí se pinta (no es ausencia)", () => {
    expect(formatearMedia({ media: 0, respuestas: 3 })).toBe("0,00");
  });
});

describe("porcentajes y enteros", () => {
  it("null es «Sin datos» y 0 es cero", () => {
    expect(formatearPct(null)).toBe(SIN_DATOS);
    expect(formatearPct(0)).toBe("0,0 %");
    expect(formatearPct(12.34)).toBe("12,3 %");
    expect(formatearEntero(null)).toBe(SIN_DATOS);
    expect(formatearEntero(0)).toBe("0");
  });

  it("separa los miles", () => {
    // En español los cuatro dígitos NO se agrupan («1234»); a partir de cinco, sí.
    expect(formatearEntero(1234)).toBe("1234");
    expect(formatearEntero(12345)).toBe("12.345");
  });
});

describe("tamaño de muestra", () => {
  it("marca las muestras cortas", () => {
    expect(muestraSuficiente({ media: 5, respuestas: MUESTRA_MINIMA - 1 })).toBe(false);
    expect(muestraSuficiente({ media: 5, respuestas: MUESTRA_MINIMA })).toBe(true);
    expect(muestraSuficiente(null)).toBe(false);
  });

  it("redacta el tamaño en singular y plural", () => {
    expect(textoMuestra({ media: 4, respuestas: 1 })).toBe("sobre 1 respuesta");
    expect(textoMuestra({ media: 4, respuestas: 7 })).toBe("sobre 7 respuestas");
    expect(textoMuestra({ media: null, respuestas: 0 })).toBe("");
  });
});

describe("duraciones", () => {
  it("pasa de minutos a horas y a días", () => {
    expect(formatearDuracion(90_000)).toBe("2 min");
    expect(formatearDuracion(9_000_000)).toBe("2 h 30 min");
    expect(formatearDuracion(7_200_000)).toBe("2 h");
    expect(formatearDuracion(90_000_000)).toBe("1 d 1 h");
    expect(formatearDuracion(172_800_000)).toBe("2 d");
  });

  it("sin dato no inventa un cero", () => {
    expect(formatearDuracion(null)).toBe(SIN_DATOS);
    expect(formatearDuracion(-1)).toBe(SIN_DATOS);
  });
});

describe("barras", () => {
  it("escala sobre el mayor del grupo, no sobre el total", () => {
    expect(anchosDeBarras([10, 5, 0])).toEqual([100, 50, 0]);
  });

  it("todo a cero no divide por cero ni reparte a partes iguales", () => {
    expect(anchosDeBarras([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("distribución de estrellas", () => {
  it("rellena las estrellas que nadie votó y ordena de 5 a 1", () => {
    const d = distribucionCompleta([{ estrella: 5, n: 3, pct: 75 }, { estrella: 2, n: 1, pct: 25 }]);
    expect(d.map((f) => f.estrella)).toEqual([5, 4, 3, 2, 1]);
    expect(d.find((f) => f.estrella === 4)).toEqual({ estrella: 4, n: 0, pct: 0 });
    expect(d[0]).toEqual({ estrella: 5, n: 3, pct: 75 });
  });

  it("sin datos devuelve las cinco filas a cero", () => {
    expect(distribucionCompleta(null)).toHaveLength(5);
  });
});

describe("serie temporal", () => {
  const D = 86_400_000;
  const puntos = [
    { desdeMs: Date.UTC(2026, 0, 1), driver: { media: 5, respuestas: 4 }, customer: { media: null, respuestas: 0 }, casos: 0, criticos: 0 },
    { desdeMs: Date.UTC(2026, 0, 2), driver: { media: null, respuestas: 0 }, customer: { media: 3, respuestas: 2 }, casos: 1, criticos: 0 },
    { desdeMs: Date.UTC(2026, 0, 3), driver: { media: 1, respuestas: 1 }, customer: { media: null, respuestas: 0 }, casos: 0, criticos: 0 },
  ];

  it("un tramo sin respuestas es hueco, no un cero", () => {
    const s = construirSerie(puntos, "driver", "dia");
    expect(s[1].valor).toBeNull();
    expect(s[1].altura).toBe(0);
    expect(s[1].respuestas).toBe(0);
  });

  it("la escala es fija de 1 a 5", () => {
    const s = construirSerie(puntos, "driver", "dia");
    expect(s[0].altura).toBe(100); // 5 ★
    expect(s[2].altura).toBe(0);   // 1 ★, el suelo de la escala
  });

  it("cada rol lee su propia media", () => {
    expect(construirSerie(puntos, "customer", "dia")[1].valor).toBe(3);
  });

  it("sin puntos devuelve una serie vacía", () => {
    expect(construirSerie(null, "driver", "dia")).toEqual([]);
    expect(construirSerie([], "driver", "mes")).toEqual([]);
  });

  it("etiqueta según la granularidad", () => {
    const ms = Date.UTC(2026, 2, 9);
    expect(etiquetaTramo(ms, "dia")).toBe("9 mar");
    expect(etiquetaTramo(ms, "semana")).toBe("sem. 9 mar");
    expect(etiquetaTramo(ms, "mes")).toBe("mar 26");
    expect(etiquetaPeriodo(ms, ms + 30 * D)).toBe("del 9 mar al 8 abr 26");
  });
});

describe("tasa de respuesta", () => {
  it("sin entregas reales no enseña porcentaje, enseña el motivo", () => {
    const r = textoTasaRespuesta(0, { hayEntregas: false, motivo: "Todavía no se envía nada." });
    expect(r.valor).toBe(SIN_DATOS);
    expect(r.nota).toBe("Todavía no se envía nada.");
  });

  it("con entregas sí muestra el porcentaje", () => {
    const r = textoTasaRespuesta(42.5, { hayEntregas: true, motivo: null });
    expect(r.valor).toBe("42,5 %");
    expect(r.nota).toBeNull();
  });
});

describe("normalizados y daños", () => {
  it("por cada 100 se lee entero", () => {
    expect(textoPorCada100(3.4, "respuestas")).toBe("3,4 por cada 100 respuestas");
    expect(textoPorCada100(null, "respuestas")).toBe(SIN_DATOS);
  });

  it("separa alegados de confirmados", () => {
    const filas = textoDanos({ alegados: 12, confirmados: 3, descartados: 5, sinCerrar: 4 });
    expect(filas[0]).toEqual({ etiqueta: "Daños alegados", valor: "12" });
    expect(filas[1].etiqueta).toBe("Confirmados tras revisión");
    expect(filas[1].valor).toBe("3");
    // Nunca una sola cifra «Daños: 12» que dé por confirmada la alegación.
    expect(filas.some((f) => f.etiqueta === "Daños")).toBe(false);
  });
});
