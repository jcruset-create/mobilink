import { describe, expect, it } from "vitest";

import type { RevisionEstado } from "../types";
import type { VehiculoPresencia } from "./presenciaBases";
import {
  agruparPines,
  cuentaPorEstado,
  estadoMasUrgente,
  pinesDeLaBase,
  posicionUtil,
  rutaHasta,
} from "./mapaBase";

function v(id: string, extra: Partial<VehiculoPresencia> = {}): VehiculoPresencia {
  return {
    vehiculo_id: id,
    estado: "IN_BASE",
    delegacion_id: "reus",
    es_su_base: true,
    distancia_m: 20,
    antiguedad_min: 5,
    lat: 41.15,
    lng: 1.1,
    velocidad_kmh: 0,
    posicion_at: null,
    entrada_base_at: null,
    proveedor: null,
    cuenta: null,
    externo: null,
    motivo: null,
    calculado_at: "2026-11-19T10:00:00Z",
    vehiculo: { id, matricula: id.toUpperCase() },
    ...extra,
  };
}

const rev = (id: string, estado: string, dias_vencido?: number): RevisionEstado =>
  ({ vehiculo_id: id, estado, dias_vencido }) as RevisionEstado;

describe("mapa de una base", () => {
  it("solo pinta los pendientes con posición, dentro o con posición antigua, y por urgencia", () => {
    const vehiculos = [
      v("a"),
      v("b"),
      v("c", { estado: "STALE_POSITION", antiguedad_min: 900 }),
      v("d", { estado: "OUTSIDE_BASES" }),
      v("e", { delegacion_id: "vilanova" }),
      v("f", { lat: 0, lng: 0 }),
      v("g"),
    ];
    const revisiones = new Map([
      ["a", rev("a", "proxima")],
      ["b", rev("b", "vencida", 3)],
      ["c", rev("c", "sin_revision")],
      ["d", rev("d", "sin_revision")],
      ["e", rev("e", "sin_revision")],
      ["f", rev("f", "sin_revision")],
      ["g", rev("g", "al_dia")],
    ]);
    const pines = pinesDeLaBase("reus", vehiculos, revisiones);
    expect(pines.map((p) => p.v.vehiculo_id)).toEqual(["c", "b", "a"]);
    expect(pines[0].vieja).toBe(true);
    expect(pines[1].vieja).toBe(false);
    expect(cuentaPorEstado(pines)).toEqual({ sin_revision: 1, vencida: 1, proxima: 1 });
  });

  it("junta los que se pisan y los separa al acercarse", () => {
    const vehiculos = [v("a"), v("b", { lat: 41.15002 }), v("c", { lat: 41.16 })];
    const revisiones = new Map([
      ["a", rev("a", "proxima")],
      ["b", rev("b", "sin_revision")],
      ["c", rev("c", "vencida")],
    ]);
    const pines = pinesDeLaBase("reus", vehiculos, revisiones);
    const lejos = agruparPines(pines, 15);
    expect(lejos.length).toBe(2);
    const juntos = lejos.find((g) => g.pines.length === 2)!;
    expect(estadoMasUrgente(juntos)).toBe("sin_revision");
    expect(agruparPines(pines, 19).length).toBe(3);
  });

  it("descarta posiciones que no sirven y arma la ruta", () => {
    expect(posicionUtil(0, 0)).toBe(false);
    expect(posicionUtil(null, 1)).toBe(false);
    expect(posicionUtil(41, 1)).toBe(true);
    expect(rutaHasta(41.1, 1.2)).toContain("destination=41.100000%2C1.200000");
  });
});
