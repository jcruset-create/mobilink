import { describe, it, expect } from "vitest";
import { LiteMetrics } from "./liteMetrics.ts";

const T = 1_700_000_000_000;

describe("métricas de Mobilink Assist Lite", () => {
  it("separa fallos del servidor, rechazos del cliente y límites de uso", () => {
    const m = new LiteMetrics();
    m.recordApi("POST /assistances/:id/files", 201, 300, T);
    m.recordApi("POST /assistances/:id/files", 500, 50, T);
    m.recordApi("POST /assistances/:id/files", 422, 10, T);
    // Un 429 no es ni error del servidor ni petición mal formada: es el freno
    // funcionando, y contarlo como fallo daría una alarma falsa.
    m.recordApi("POST /assistances/:id/files", 429, 1, T);
    m.recordRateLimited("POST /assistances/:id/files", T);

    const s = m.snapshot(T);
    const e = s.api[0];
    expect(e.total).toBe(4);
    expect(e.errores).toBe(1);
    expect(e.rechazos).toBe(1);
    expect(e.limitados).toBe(1);
    expect(e.errorRate).toBe(0.25);
  });

  it("cuenta las posiciones perdidas por diferencia entre recibidas y guardadas", () => {
    const m = new LiteMetrics();
    m.recordPoints(100, 60, T);
    const s = m.snapshot(T);
    expect(s.posiciones.perdidas).toBe(40);
    expect(s.posiciones.perdidaRate).toBe(0.4);
  });

  it("un push que no llega a ningún dispositivo cuenta como fallido", () => {
    const m = new LiteMetrics();
    m.recordPush(3, 1, 1, T);
    const s = m.snapshot(T);
    expect(s.push.fallidos).toBe(2);
    expect(s.push.tokensInvalidos).toBe(1);
    expect(s.push.falloRate).toBeCloseTo(0.6667, 3);
  });

  it("los conflictos de estado se atribuyen al taller", () => {
    const m = new LiteMetrics();
    m.recordConflict(7, T);
    m.recordConflict(7, T);
    m.recordConflict(9, T);
    m.recordConflict(null, T);
    const s = m.snapshot(T);
    expect(s.conflictos.total).toBe(4);
    expect(s.conflictos.porTaller[0]).toEqual({ workshopId: 7, total: 2 });
  });

  it("agrega los cubos de toda la ventana", () => {
    const m = new LiteMetrics();
    for (let i = 0; i < 10; i++) m.recordApi("GET /assistances", 200, 20, T + i * 60_000);
    expect(m.snapshot(T + 10 * 60_000).api[0].total).toBe(10);
  });

  it("lo que sale de la ventana deja de contar", () => {
    const m = new LiteMetrics();
    m.recordApi("GET /assistances", 500, 20, T);
    // Dos horas después ese minuto ya no está en la ventana de una hora
    const s = m.snapshot(T + 120 * 60_000);
    expect(s.totales.peticiones).toBe(0);
    expect(s.api).toEqual([]);
  });

  it("no crece sin límite aunque el proceso lleve días arriba", () => {
    const m = new LiteMetrics();
    for (let i = 0; i < 5000; i++) m.recordApi("GET /assistances", 200, 5, T + i * 60_000);
    const s = m.snapshot(T + 5000 * 60_000);
    // Solo la última hora, no las 83 horas de tráfico
    expect(s.api[0].total).toBeLessThanOrEqual(60);
  });

  it("los percentiles describen la latencia real", () => {
    const m = new LiteMetrics();
    for (let i = 1; i <= 100; i++) m.recordApi("POST /sync", 200, i, T);
    const e = m.snapshot(T).api[0];
    expect(e.p50Ms).toBe(50);
    expect(e.p95Ms).toBe(95);
  });

  it("los endpoints se ordenan poniendo delante lo que está fallando", () => {
    const m = new LiteMetrics();
    for (let i = 0; i < 100; i++) m.recordApi("GET /assistances", 200, 5, T);
    m.recordApi("POST /sync", 500, 5, T);
    expect(m.snapshot(T).api[0].endpoint).toBe("POST /sync");
  });

  it("sin tráfico devuelve ceros, no divisiones por cero", () => {
    const s = new LiteMetrics().snapshot(T);
    expect(s.totales.peticiones).toBe(0);
    expect(s.posiciones.perdidaRate).toBe(0);
    expect(s.push.falloRate).toBe(0);
  });
});
