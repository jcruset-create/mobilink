/**
 * Pruebas de lo que se escribe en cada barrido.
 *
 * Esta parte no la cubría nada, y ahí se escondía el fallo que dejó la tabla
 * vacía en producción: el adaptador iba contra Supabase entero, así que no
 * había nada que probar sin base de datos. Ahora la decisión —qué fila sale y
 * si la estancia continúa— es una función pura y se comprueba aquí.
 */

import { describe, expect, it } from "vitest";
import { filaDePresencia, mismaEstancia, type Anterior } from "./filas.ts";
import type { FilaPresencia } from "../../integration-hub/application/services/BasePresenceService.ts";

const AHORA = "2026-09-13T12:00:00Z";
const POSICION = new Date("2026-09-13T11:55:00Z");

function fila(over: Partial<FilaPresencia> = {}): FilaPresencia {
  return {
    tenantId: "plana",
    vehiculoId: "v1",
    matricula: "1234ABC",
    estado: "IN_BASE",
    baseId: "reus",
    baseNombre: "Reus",
    esSuBase: true,
    distanciaM: 42.7,
    antiguedadMin: 5,
    lat: 41.128,
    lng: 1.186,
    velocidadKmh: 0,
    posicionAt: POSICION,
    proveedor: "movertis",
    cuenta: "buses",
    externo: "E1",
    calculadoAt: new Date(AHORA),
    ...over,
  } as FilaPresencia;
}

const prev = (over: Partial<Anterior> = {}): Anterior => ({
  estado: "IN_BASE",
  delegacion_id: "reus",
  entrada_base_at: "2026-09-12T20:00:00Z",
  ...over,
});

describe("mismaEstancia()", () => {
  it("sigue siendo la misma si no ha cambiado de base", () => {
    expect(mismaEstancia("reus", prev())).toBe(true);
  });

  it("un equipo dormido dentro de la base NO reinicia la estancia", () => {
    // Es lo normal en esta flota: el autobús aparca y el GPS se calla. Contarlo
    // como llegada nueva convertiría «lleva tres días aquí» en «acaba de
    // llegar», que es justo lo contrario de la verdad.
    expect(mismaEstancia("reus", prev({ estado: "STALE_POSITION" }))).toBe(true);
  });

  it("cambiar de base empieza estancia nueva", () => {
    expect(mismaEstancia("vilanova", prev())).toBe(false);
  });

  it("venir de fuera o de no saberse empieza estancia nueva", () => {
    expect(mismaEstancia("reus", prev({ estado: "OUTSIDE_BASES", delegacion_id: null }))).toBe(false);
    expect(mismaEstancia("reus", prev({ estado: "NO_POSITION", delegacion_id: null }))).toBe(false);
    expect(mismaEstancia("reus", undefined)).toBe(false);
  });

  it("sin base detectada no hay estancia que continuar", () => {
    expect(mismaEstancia(undefined, prev())).toBe(false);
  });
});

describe("filaDePresencia()", () => {
  it("conserva la hora de llegada mientras siga en la misma base", () => {
    const f = filaDePresencia(fila(), prev(), AHORA);
    expect(f.entrada_base_at).toBe("2026-09-12T20:00:00Z");
    expect(f.delegacion_id).toBe("reus");
    expect(f.es_su_base).toBe(true);
    expect(f.empresa_id).toBe("plana");
  });

  it("al cambiar de base, la llegada es la de la posición, no la del barrido", () => {
    const f = filaDePresencia(fila({ baseId: "vilanova" }), prev(), AHORA);
    expect(f.entrada_base_at).toBe(POSICION.toISOString());
  });

  it("fuera de toda base no se guarda ni base ni llegada", () => {
    const f = filaDePresencia(
      fila({ estado: "OUTSIDE_BASES", baseId: undefined, baseNombre: undefined, esSuBase: undefined }),
      prev(),
      AHORA,
    );
    expect(f.delegacion_id).toBeNull();
    expect(f.entrada_base_at).toBeNull();
    expect(f.es_su_base).toBeNull();
  });

  it("sin posición fechada no se inventa la hora de llegada", () => {
    const f = filaDePresencia(fila({ posicionAt: undefined }), undefined, AHORA);
    expect(f.posicion_at).toBeNull();
    expect(f.entrada_base_at).toBeNull();
  });

  it("la distancia se redondea a metros y el motivo viaja tal cual", () => {
    const f = filaDePresencia(
      fila({ estado: "NO_POSITION", baseId: undefined, motivo: "sin_enlace", distanciaM: undefined }),
      undefined,
      AHORA,
    );
    expect(f.motivo).toBe("sin_enlace");
    expect(f.distancia_m).toBeNull();
    expect(filaDePresencia(fila(), undefined, AHORA).distancia_m).toBe(43);
  });

  it("velocidad cero se guarda como cero, no como ausencia", () => {
    // Un autobús parado marca 0 y eso es el dato que dice que está aparcado.
    expect(filaDePresencia(fila({ velocidadKmh: 0 }), undefined, AHORA).velocidad_kmh).toBe(0);
  });
});
