import { describe, expect, it } from "vitest";

import {
  CAJONES,
  ETIQUETA_CAJON,
  TOLERANCIA_EUROS,
  TOLERANCIA_PCT,
  calcularMargen,
  facturacionBloqueada,
  nivelDesviacion,
  ordenarCajones,
} from "./dominio.ts";

describe("cálculo de margen", () => {
  /* El ejemplo del enunciado, visto desde Assist. */
  it("el caso real: coste 155, venta 195", () => {
    const m = calcularMargen({ previsto: 150, acordado: 155, final: 155, venta: 195 });
    expect(m.costeEfectivo).toBe(155);
    expect(m.margenEuros).toBe(40);
    // Sobre la venta, que es el criterio de margen bruto de la casa.
    expect(m.margenPct).toBeCloseTo(20.51, 1);
  });

  /*
   * El coste que manda es el final si existe. Enseñar un margen calculado con
   * el previsto como si fuera definitivo es cómo se decide con números que
   * luego cambian.
   */
  it("manda el final; si no hay, el acordado; si no, el previsto", () => {
    expect(calcularMargen({ previsto: 100, acordado: 120, final: 130, venta: 200 }).costeEfectivo).toBe(130);
    expect(calcularMargen({ previsto: 100, acordado: 120, final: null, venta: 200 }).costeEfectivo).toBe(120);
    expect(calcularMargen({ previsto: 100, acordado: null, final: null, venta: 200 }).costeEfectivo).toBe(100);
  });

  /* NULL es desconocido, nunca cero: un coste a cero inventa un margen. */
  it("sin coste conocido no se inventa un margen", () => {
    const m = calcularMargen({ previsto: null, acordado: null, final: null, venta: 195 });
    expect(m.costeEfectivo).toBeNull();
    expect(m.margenEuros).toBeNull();
    expect(m.margenPct).toBeNull();
  });

  it("sin venta tampoco", () => {
    expect(calcularMargen({ previsto: null, acordado: 120, final: null, venta: null }).margenEuros)
      .toBeNull();
  });

  it("una venta de cero no revienta el porcentaje", () => {
    const m = calcularMargen({ previsto: null, acordado: 50, final: null, venta: 0 });
    expect(m.margenEuros).toBe(-50);
    expect(m.margenPct).toBeNull();     // no se divide entre cero
  });

  it("un margen negativo se calcula, no se oculta", () => {
    const m = calcularMargen({ previsto: null, acordado: null, final: 200, venta: 150 });
    expect(m.margenEuros).toBe(-50);
  });
});

describe("desviación sobre lo acordado", () => {
  it("mide cuánto se pasó el final del acordado", () => {
    const m = calcularMargen({ previsto: null, acordado: 100, final: 150, venta: 200 });
    expect(m.desviado).toBe(true);
    expect(m.desviacionEuros).toBe(50);
    expect(m.desviacionPct).toBe(50);
  });

  /* Que salga más barato no es una incidencia que haya que revisar. */
  it("salir más barato NO es una desviación", () => {
    const m = calcularMargen({ previsto: null, acordado: 100, final: 80, venta: 200 });
    expect(m.desviado).toBe(false);
    expect(m.desviacionEuros).toBe(-20);
    expect(nivelDesviacion(m)).toBe("ninguna");
  });

  it("sin final o sin acordado no hay desviación que medir", () => {
    expect(calcularMargen({ previsto: 100, acordado: null, final: 150, venta: null }).desviado)
      .toBe(false);
    expect(calcularMargen({ previsto: null, acordado: 100, final: null, venta: null }).desviado)
      .toBe(false);
  });
});

describe("cuándo hace falta aprobación", () => {
  /*
   * Dos umbrales a la vez, y hacen falta los dos: un 10 % de 30 € son 3 € y no
   * merece parar nada; 20 € en un servicio de 1.000 € tampoco.
   */
  it("exige superar el porcentaje Y el importe", () => {
    // 50 % pero solo 15 €: no para nada.
    expect(nivelDesviacion(calcularMargen({
      previsto: null, acordado: 30, final: 45, venta: 100,
    }))).toBe("aviso");

    // 200 € pero solo un 20 %... eso sí supera los dos.
    expect(nivelDesviacion(calcularMargen({
      previsto: null, acordado: 1000, final: 1200, venta: 1500,
    }))).toBe("aprobacion");

    // 30 € sobre 1000 = 3 %: supera el importe pero no el porcentaje.
    expect(nivelDesviacion(calcularMargen({
      previsto: null, acordado: 1000, final: 1030, venta: 1500,
    }))).toBe("aviso");
  });

  it("los umbrales están donde dicen estar", () => {
    expect(TOLERANCIA_PCT).toBe(10);
    expect(TOLERANCIA_EUROS).toBe(25);
  });

  it("sin desviación no hay nada que aprobar", () => {
    expect(nivelDesviacion(calcularMargen({
      previsto: null, acordado: 100, final: 100, venta: 150,
    }))).toBe("ninguna");
  });
});

describe("bloqueo de la facturación", () => {
  it("una desviación grande sin aprobar bloquea, y dice por qué", () => {
    const m = calcularMargen({ previsto: null, acordado: 1000, final: 1200, venta: 1500 });
    const r = facturacionBloqueada(m, false);
    expect(r.bloqueada).toBe(true);
    expect(r.motivo).toContain("200");
    expect(r.motivo).toContain("aprobar");
  });

  it("aprobada, deja de bloquear", () => {
    const m = calcularMargen({ previsto: null, acordado: 1000, final: 1200, venta: 1500 });
    expect(facturacionBloqueada(m, true).bloqueada).toBe(false);
  });

  /*
   * Hay servicios que se dan a pérdida a conciencia. Bloquear por eso deja de
   * cobrar un trabajo ya hecho, que es peor que el margen negativo.
   */
  it("un margen negativo NO bloquea", () => {
    const m = calcularMargen({ previsto: null, acordado: 200, final: 200, venta: 150 });
    expect(m.margenEuros).toBe(-50);
    expect(facturacionBloqueada(m, false).bloqueada).toBe(false);
  });

  it("un aviso pequeño tampoco bloquea", () => {
    const m = calcularMargen({ previsto: null, acordado: 30, final: 45, venta: 100 });
    expect(facturacionBloqueada(m, false).bloqueada).toBe(false);
  });
});

describe("cajones de la bandeja", () => {
  it("están los siete acordados y todos tienen etiqueta", () => {
    expect(CAJONES).toHaveLength(7);
    for (const c of CAJONES) {
      expect(ETIQUETA_CAJON[c]).toBeTruthy();
      expect(ETIQUETA_CAJON[c]).not.toBe(c);
    }
  });

  /*
   * Lo operativo antes que lo administrativo: una grúa sin aceptar tiene a
   * alguien esperando en la carretera; un albarán lleva tres días faltando y
   * puede esperar diez minutos más.
   */
  it("lo urgente sale primero", () => {
    const orden = ordenarCajones([
      "documentacion_pendiente", "sla_vencido", "facturacion_bloqueada", "sin_aceptar",
    ]);
    expect(orden[0]).toBe("sla_vencido");
    expect(orden[1]).toBe("sin_aceptar");
    expect(orden[orden.length - 1]).toBe("documentacion_pendiente");
  });

  it("ordenar no altera la lista original", () => {
    const original: any[] = ["documentacion_pendiente", "sla_vencido"];
    ordenarCajones(original);
    expect(original).toEqual(["documentacion_pendiente", "sla_vencido"]);
  });
});
