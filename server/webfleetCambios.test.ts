import { describe, expect, it } from "vitest";
import { estadoWebfleetCambia } from "./webfleetCambios.ts";

const guardado = {
  vehiculo_id: "v1",
  empresa_id: "e1",
  estado: "en_base",
  delegacion_id: "d1",
  entrada_base_at: "2026-11-23T06:00:00+00:00",
  lat: 41.1189,
  lng: 1.2445,
  postext: "Tarragona",
  velocidad_kmh: 0,
  odometro_km: 812345,
  pos_time: "2026-11-23T06:01:00+00:00",
};

describe("¿cambia el estado Webfleet de un vehículo?", () => {
  it("aparcado y sin novedad: no se escribe, aunque las fechas vengan en otro formato", () => {
    expect(
      estadoWebfleetCambia(guardado, {
        ...guardado,
        entrada_base_at: "2026-11-23T06:00:00.000Z",
        pos_time: "2026-11-23T06:01:00.000Z",
        updated_at: new Date().toISOString(),
      })
    ).toBe(false);
  });

  it("se mueve, cambia de estado o de odómetro: se escribe", () => {
    expect(estadoWebfleetCambia(guardado, { ...guardado, lat: 41.2 })).toBe(true);
    expect(estadoWebfleetCambia(guardado, { ...guardado, estado: "en_ruta" })).toBe(true);
    expect(estadoWebfleetCambia(guardado, { ...guardado, odometro_km: 812350 })).toBe(true);
    expect(estadoWebfleetCambia(guardado, { ...guardado, pos_time: "2026-11-23T06:06:00.000Z" })).toBe(true);
  });

  it("de algo a nada también es un cambio", () => {
    expect(estadoWebfleetCambia(guardado, { ...guardado, delegacion_id: null })).toBe(true);
  });

  it("solo cuenta lo que trae la fila: «sin conexión» no trae posición y no la borra", () => {
    const sinConexion = { ...guardado, estado: "sin_conexion", delegacion_id: null, entrada_base_at: null };
    const nueva = { vehiculo_id: "v1", empresa_id: "e1", estado: "sin_conexion", delegacion_id: null, entrada_base_at: null };
    expect(estadoWebfleetCambia(sinConexion, nueva)).toBe(false);
  });

  it("un vehículo que no estaba: se escribe", () => {
    expect(estadoWebfleetCambia(undefined, guardado)).toBe(true);
  });
});
