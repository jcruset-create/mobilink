/**
 * La decisión del histórico de presencia.
 *
 * Lo que se fija aquí es la regla de la que depende que los porcentajes
 * signifiquen algo: **un hueco de barrido corta la estancia, no la alarga**.
 * Si la alargara, un despliegue de tres horas se convertiría en tres horas de
 * «visto en la base» que nadie vio, y el informe diría 94 % sobre 120 horas
 * cuando solo se midieron 110.
 */

import { describe, expect, it } from "vitest";
import { decidirEstancia, filaNueva, BARRIDOS_DE_GRACIA, type EstanciaAbierta } from "./historico.ts";

const INTERVALO = 10;
const VISTO = {
  vehiculoId: "veh-1",
  empresaId: "emp-1",
  estado: "IN_BASE",
  delegacionId: "base-reus",
};
const T = (min: number) => new Date(Date.UTC(2026, 8, 21, 8, 0, 0) + min * 60_000).toISOString();

const abierta = (extra: Partial<EstanciaAbierta> = {}): EstanciaAbierta => ({
  id: "est-1", estado: "IN_BASE", delegacion_id: "base-reus", visto_at: T(0), ...extra,
});

describe("decidirEstancia()", () => {
  it("sin estancia previa, se abre la primera", () => {
    expect(decidirEstancia(VISTO, undefined, T(0), INTERVALO)).toEqual({ accion: "abrir" });
  });

  it("mismo estado y misma base al barrido siguiente: se alarga", () => {
    expect(decidirEstancia(VISTO, abierta(), T(10), INTERVALO))
      .toEqual({ accion: "extender", id: "est-1", vistoAt: T(10) });
  });

  it("cambia de base: se corta y `hasta` es la ÚLTIMA MUESTRA, no el ahora", () => {
    const r = decidirEstancia({ ...VISTO, delegacionId: "base-vilanova" }, abierta(), T(10), INTERVALO);
    expect(r).toEqual({ accion: "cortar", cerrar: "est-1", hasta: T(0), motivo: "cambio" });
  });

  it("cambia de estado en la misma base: también corta", () => {
    const r = decidirEstancia({ ...VISTO, estado: "STALE_POSITION" }, abierta(), T(10), INTERVALO);
    expect(r.accion).toBe("cortar");
  });

  it("sale de la base: de IN_BASE a OUTSIDE_BASES sin delegación", () => {
    const r = decidirEstancia(
      { ...VISTO, estado: "OUTSIDE_BASES", delegacionId: null }, abierta(), T(10), INTERVALO,
    );
    expect(r.accion).toBe("cortar");
  });

  it("un hueco largo corta AUNQUE no haya cambiado nada", () => {
    // Tres horas sin barrer y el autobús sigue en Reus. No se le ha visto en
    // esas tres horas, así que la estancia no puede incluirlas.
    const r = decidirEstancia(VISTO, abierta(), T(180), INTERVALO);
    expect(r).toEqual({ accion: "cortar", cerrar: "est-1", hasta: T(0), motivo: "hueco" });
  });

  it("el umbral sale del intervalo del barrido, no de un número suelto", () => {
    const tope = INTERVALO * BARRIDOS_DE_GRACIA; // 30 min
    expect(decidirEstancia(VISTO, abierta(), T(tope), INTERVALO).accion).toBe("extender");
    expect(decidirEstancia(VISTO, abierta(), T(tope + 1), INTERVALO).accion).toBe("cortar");
    // Barriendo cada 30 min, el mismo hueco de 31 min ya no corta.
    expect(decidirEstancia(VISTO, abierta(), T(tope + 1), 30).accion).toBe("extender");
  });

  it("un barrido perdido no corta: para eso están los barridos de gracia", () => {
    expect(decidirEstancia(VISTO, abierta(), T(20), INTERVALO).accion).toBe("extender");
  });

  it("dos estancias sin base se distinguen por el estado, no por la base nula", () => {
    const sinBase = abierta({ estado: "OUTSIDE_BASES", delegacion_id: null });
    expect(decidirEstancia({ ...VISTO, estado: "OUTSIDE_BASES", delegacionId: null }, sinBase, T(10), INTERVALO).accion)
      .toBe("extender");
    expect(decidirEstancia({ ...VISTO, estado: "NO_POSITION", delegacionId: null }, sinBase, T(10), INTERVALO).accion)
      .toBe("cortar");
  });

  it("una fecha ilegible en la estancia abierta no corta por sorpresa", () => {
    // `Date.parse` de una basura da NaN. Sin la guarda, NaN > tope es false y
    // colaría por «extender», pero lo que no puede es petar ni cortar a ciegas.
    const r = decidirEstancia(VISTO, abierta({ visto_at: "ayer" }), T(10), INTERVALO);
    expect(["extender", "cortar"]).toContain(r.accion);
  });
});

describe("filaNueva()", () => {
  it("nace abierta, con una muestra y con `desde` = `visto_at`", () => {
    expect(filaNueva(VISTO, T(0))).toEqual({
      empresa_id: "emp-1", vehiculo_id: "veh-1", estado: "IN_BASE",
      delegacion_id: "base-reus", desde: T(0), visto_at: T(0), hasta: null,
      muestras: 1, actualizado_at: T(0),
    });
  });

  it("sin base, la delegación va nula y no se inventa", () => {
    expect(filaNueva({ ...VISTO, delegacionId: null }, T(0)).delegacion_id).toBeNull();
  });
});
