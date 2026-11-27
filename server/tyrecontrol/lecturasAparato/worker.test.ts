import { describe, it, expect } from "vitest";
import { HORA_LOCAL, fechaLocal, porVehiculo, tocaHoy } from "./worker.ts";

const enMadrid = (iso: string) => new Date(iso);

describe("el reloj de la foto diaria", () => {
  it("antes de la hora no toca, aunque no se haya hecho nunca", () => {
    // 02:00 en Madrid (01:00 UTC en invierno).
    expect(tocaHoy(null, enMadrid("2026-11-27T01:00:00Z"))).toBe(false);
  });

  it("pasada la hora y sin hacer, toca", () => {
    expect(tocaHoy(null, enMadrid("2026-11-27T05:00:00Z"))).toBe(true);
  });

  it("hecha hoy, no se repite por la noche", () => {
    const hoyTemprano = Date.parse("2026-11-27T05:05:00Z");
    expect(tocaHoy(hoyTemprano, enMadrid("2026-11-27T22:00:00Z"))).toBe(false);
  });

  it("un servidor que arranca a las once recupera la foto que no se tomó", () => {
    // Lo de ayer está hecho; hoy no. A las 11:00 toca, no se espera a mañana.
    const ayer = Date.parse("2026-11-26T05:00:00Z");
    expect(tocaHoy(ayer, enMadrid("2026-11-27T11:00:00Z"))).toBe(true);
  });

  it("la hora es la local, no UTC", () => {
    expect(HORA_LOCAL).toBe(4);
    // 03:30 UTC en verano son las 05:30 en Madrid: ya toca.
    expect(tocaHoy(null, new Date("2026-07-15T03:30:00Z"))).toBe(true);
    // Y 03:30 UTC en invierno son las 04:30: también.
    expect(tocaHoy(null, new Date("2026-01-15T03:30:00Z"))).toBe(true);
    // Pero 02:30 UTC en invierno son las 03:30: todavía no.
    expect(tocaHoy(null, new Date("2026-01-15T02:30:00Z"))).toBe(false);
  });

  it("la fecha se parte por el día de Madrid, no por el de UTC", () => {
    // 23:30 del 26 en UTC son las 00:30 del 27 en Madrid.
    expect(fechaLocal(new Date("2026-11-26T23:30:00Z"))).toBe("2026-11-27");
  });
});

describe("casar las filas con los vehículos pedidos", () => {
  it("el id se compara en texto: Movertis lo manda numérico", () => {
    const m = porVehiculo([{ idVehicle: 26134116, sensors: {} }]);
    expect(m.has("26134116")).toBe(true);
  });

  it("una fila sin id no se cuelga del primero que pase", () => {
    const m = porVehiculo([{ sensors: {} }, { idVehicle: "7", sensors: {} }]);
    expect(m.size).toBe(1);
    expect(m.has("7")).toBe(true);
  });
});
