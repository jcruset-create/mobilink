import { describe, expect, it } from "vitest";

import { limitesDelMes, medianocheEn } from "./meses.ts";
import { pedirPorPartes } from "./partesDelMes.ts";

const OCT = { year: 2026, month: 10 };
const Z = "Europe/Madrid";

/**
 * Un proveedor de mentira que reproduce 0179JDJ en octubre: km por día, el
 * odómetro avanzando con ellos, y un día (el 12) que hace fallar cualquier
 * ventana que lo contenga.
 */
function proveedor(kmPorDia: Record<number, number>, diasMalos: number[], odoInicio = 587_322) {
  const dia = (t: Date) => {
    for (let d = 1; d <= 31; d++) {
      const fin = d === 31 ? limitesDelMes(OCT, Z).hasta : medianocheEn(2026, 10, d + 1, Z);
      if (t < fin) return d;
    }
    return 32;
  };
  const odoAntesDe = (d: number) => odoInicio + Object.entries(kmPorDia).filter(([k]) => Number(k) < d).reduce((a, [, v]) => a + v, 0);
  let llamadas = 0;
  const pedir = async (desde: Date, hasta: Date) => {
    llamadas += 1;
    const d1 = dia(desde);
    const d2 = dia(new Date(hasta.getTime() - 1));
    if (diasMalos.some((m) => m >= d1 && m <= d2)) throw new Error("Cannot read properties of undefined (reading 'toString')");
    const dias = Object.keys(kmPorDia).map(Number).filter((d) => d >= d1 && d <= d2 && kmPorDia[d] > 0);
    if (!dias.length) return "vacio" as const;
    const km = dias.reduce((a, d) => a + kmPorDia[d], 0);
    return { km, odometroInicial: odoAntesDe(dias[0]), odometroFinal: odoAntesDe(dias[dias.length - 1] + 1), viajes: dias.length };
  };
  return { pedir, llamadas: () => llamadas };
}

describe("pedirPorPartes", () => {
  it("0179JDJ: aísla el día roto y lo rellena con el odómetro de los vecinos", async () => {
    // 190 km la primera semana, 424 entre el 8 y el 15 (con el 12 roto), 43 al final.
    const p = proveedor({ 2: 100, 5: 90, 9: 200, 12: 124, 14: 100, 20: 43 }, [12]);
    const r = await pedirPorPartes(OCT, Z, p.pedir, { primeraFallida: true });
    expect(r.diasFallidos).toEqual([12]);
    expect(r.km).toBe(657);
    expect(r.kmPorOdometro).toBe(124);
    expect(r.odometroInicial).toBe(587_322);
    expect(r.odometroFinal).toBe(587_979);
    expect(r.peticiones).toBe(p.llamadas());
    expect(r.peticiones).toBeLessThanOrEqual(12);
  });

  it("si las partes suman más que el avance del odómetro, manda el odómetro (0179JDJ real: 1.356 frente a 657)", async () => {
    // Los días 9 y 14 vienen inflados al pedirlos sueltos: la suma se dispara.
    const p = proveedor({ 2: 100, 5: 90, 9: 200, 12: 124, 14: 100, 20: 43 }, [12]);
    const inflado = async (desde: Date, hasta: Date) => {
      const r = await p.pedir(desde, hasta);
      return r === "vacio" ? r : { ...r, km: r.km * 2 };
    };
    const r = await pedirPorPartes(OCT, Z, inflado, { primeraFallida: true });
    expect(r.km).toBe(657);
    expect(r.ajustadoAlOdometro).toBe(true);
    expect(r.kmPorOdometro).toBe(657);
  });

  it("sin días rotos basta una petición", async () => {
    const p = proveedor({ 3: 50, 20: 70 }, []);
    const r = await pedirPorPartes(OCT, Z, p.pedir);
    expect(r).toMatchObject({ km: 120, diasFallidos: [], peticiones: 1 });
  });

  it("un hueco al principio del mes sin odómetro antes NO se inventa", async () => {
    const p = proveedor({ 1: 30, 20: 70 }, [1]);
    const r = await pedirPorPartes(OCT, Z, p.pedir);
    expect(r.km).toBeNull();
    expect(r.motivo).toContain("odómetro");
  });

  it("con el tope de peticiones agotado no da el mes por bueno", async () => {
    const p = proveedor({ 9: 200, 12: 124, 14: 100 }, [12]);
    const r = await pedirPorPartes(OCT, Z, p.pedir, { primeraFallida: true, maxPeticiones: 3 });
    expect(r.km).toBeNull();
    expect(r.motivo).toContain("límite");
  });

  it("si no hay turno, tampoco", async () => {
    const r = await pedirPorPartes(OCT, Z, async () => null);
    expect(r.km).toBeNull();
  });
});
