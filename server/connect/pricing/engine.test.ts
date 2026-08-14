/**
 * Pruebas del motor completo, con un tarifario cargado como DATOS.
 *
 * El tarifario de aquí abajo reproduce el de referencia del encargo, y es
 * exactamente lo que se cargará después como configuración: si alguna de estas
 * pruebas necesitara tocar el código del motor para pasar, sería la señal de
 * que se ha colado lógica de un cliente donde no debe.
 */

import { describe, it, expect } from "vitest";
import { formatear } from "./money.ts";
import { minutosDeHora } from "./time.ts";
import { calcularTarifa, type ConfiguracionLado, type ConfiguracionTarifa, type ReglaConImporte } from "./engine.ts";
import { claveNeumatico } from "./engine.ts";
import { aDinero } from "./money.ts";
import type { ContextoTarifa } from "./types.ts";
import type { FranjaHoraria } from "./timeBands.ts";
import type { DiaCalendario } from "./calendar.ts";
import type { Extra } from "./extras.ts";

const DIURNO = 1;
const NOCTURNO = 2;

const franjas: FranjaHoraria[] = [
  { id: DIURNO, code: "DIURNO", name: "Diurno", startMinute: minutosDeHora("08:00"), endMinute: minutosDeHora("19:00"), weekdays: [1, 2, 3, 4, 5] },
  { id: NOCTURNO, code: "NOCTURNO", name: "Nocturno", startMinute: minutosDeHora("19:00"), endMinute: minutosDeHora("08:00"), weekdays: [1, 2, 3, 4, 5] },
];

const calendario: DiaCalendario[] = [
  { date: "2026-12-25", scope: "special", dayClass: "christmas", name: "Navidad", yearly: true },
  { date: "2026-01-01", scope: "special", dayClass: "new_year", name: "Año Nuevo", yearly: true },
  { date: "2026-08-11", scope: "local", municipality: "Polinyà", dayClass: "holiday", name: "Festa Major" },
];

const extras: Extra[] = [
  { id: 100, code: "EXTRA_KM", name: "Kilómetro adicional", calculationType: "PER_KM", amount: "1.25", unit: "km" },
  { id: 101, code: "EXTRA_TIME_DAY", name: "Tiempo extra diurno", calculationType: "PER_HOUR", amount: "50", unit: "h" },
  { id: 102, code: "ADDITIONAL_TIRE", name: "Neumático adicional", calculationType: "PER_UNIT", amount: "60", unit: "ud" },
  { id: 103, code: "CANCELLATION", name: "Anulación con salida", calculationType: "PERCENTAGE", percentage: "50" },
];

const comun = {
  serviceTypeCode: "tyres", vehicleTypeCode: "truck",
  zoneId: null, active: true,
  extraDistanceExtraId: 100, extraDurationExtraId: 101,
  extraTriggerType: "THRESHOLD_PERCENT" as const, extraThresholdPercent: "20",
};

const reglas: ReglaConImporte[] = [
  { ...comun, id: 10, code: "DIURNO_PROX", name: "Diurno proximidad", timeBandId: DIURNO, dayClasses: null,
    maxDistanceKm: 30, maxDurationMin: 90, priority: 45, amount: "110",
    includedDistanceKm: "30", includedDurationMin: 90 },
  { ...comun, id: 11, code: "DIURNO", name: "Diurno", timeBandId: DIURNO, dayClasses: null,
    priority: 40, amount: "198", includedDistanceKm: "100", includedDurationMin: 180 },
  { ...comun, id: 12, code: "NOCTURNO", name: "Nocturno", timeBandId: NOCTURNO, dayClasses: null,
    priority: 50, amount: "331", includedDistanceKm: "100", includedDurationMin: 180 },
  { ...comun, id: 13, code: "FESTIVO", name: "Festivos", timeBandId: null, dayClasses: ["holiday"],
    priority: 90, amount: "331", includedDistanceKm: "100", includedDurationMin: 180 },
  { ...comun, id: 14, code: "FESTIVO_EXTRA", name: "Festivos extra", timeBandId: null,
    dayClasses: ["christmas", "new_year"], priority: 100, amount: "424",
    includedDistanceKm: "100", includedDurationMin: 180 },
];

/** El mismo tarifario sirve de venta y de compra: es el caso de una central. */
function lado(contractId: number): ConfiguracionLado {
  return {
    contractId, tariffPlanId: 1, tariffPlanName: "SEAS Nacional", tariffVersionId: 7,
    version: "2026", currency: "EUR", reglas, extras,
    preciosNeumaticos: new Map([
      [claveNeumatico("315/70R22.5", "BRIDGESTONE", "STEER"), aDinero("485.49")!],
    ]),
  };
}

const cfg: ConfiguracionTarifa = {
  franjas, calendario, venta: lado(1), compra: lado(2), nombreZona: "España",
};

function ctx(p: Partial<ContextoTarifa> = {}): ContextoTarifa {
  return {
    assistanceId: 1, controlCenterId: 1, clientId: 1, workshopId: 1, providerCompanyId: 1,
    serviceTypeCode: "tyres", vehicleTypeCode: "truck",
    atMs: Date.parse("2026-08-14T22:17:00+02:00"),
    timezone: "Europe/Madrid",
    lugar: { municipality: "Tarragona" }, zoneIds: [1],
    distanceKm: 76, distanceSource: "routed", durationMin: null,
    ...p,
  };
}

const opciones = { etapa: "locked" as const, pricingRequestId: "req-1" };

describe("motor de tarifas", () => {
  it("viernes 22:17, camión, 76 km: nocturno a 331 €", () => {
    const r = calcularTarifa(ctx(), cfg, opciones);
    expect(r.venta?.regla?.code).toBe("NOCTURNO");
    expect(formatear(r.ventaTotal!)).toBe("331.00");
    expect(r.explicacion.franja).toBe("19:00–08:00 (L-V)");
    expect(r.explicacion.horaLocal).toBe("22:17");
    expect(r.explicacion.distanciaIncluidaKm).toBe(100);
    expect(r.explicacion.tiempoIncluidoMin).toBe(180);
  });

  it("con el mismo tarifario en los dos lados el margen es cero, y se dice", () => {
    // Es el caso real de una central que compra y vende con el mismo
    // tarifario. Cero es la respuesta correcta, no un fallo.
    const r = calcularTarifa(ctx(), cfg, opciones);
    expect(formatear(r.compraTotal!)).toBe("331.00");
    expect(formatear(r.margen!)).toBe("0.00");
    expect(formatear(r.margenPct!)).toBe("0.00");
  });

  it("si el taller no tiene tarifa de compra, el margen queda indeterminado", () => {
    // Nunca cero: cero significaría que el servicio sale gratis y el margen
    // es del 100 %.
    const r = calcularTarifa(ctx(), { ...cfg, compra: null }, opciones);
    expect(formatear(r.ventaTotal!)).toBe("331.00");
    expect(r.compraTotal).toBeNull();
    expect(r.margen).toBeNull();
    expect(r.avisos.map((a) => a.codigo)).toContain("PURCHASE_TARIFF_NOT_FOUND");
    expect(r.estado).toBe("partial");
  });

  it("martes 10:30 a 22 km: proximidad a 110 €", () => {
    const r = calcularTarifa(
      ctx({ atMs: Date.parse("2026-08-11T10:30:00+02:00"), distanceKm: 22, durationMin: 60, lugar: { municipality: "Tarragona" } }),
      cfg, opciones,
    );
    expect(r.venta?.regla?.code).toBe("DIURNO_PROX");
    expect(formatear(r.ventaTotal!)).toBe("110.00");
  });

  it("mismo día pero a 76 km: ya no es proximidad, es diurno a 198 €", () => {
    const r = calcularTarifa(
      ctx({ atMs: Date.parse("2026-08-11T10:30:00+02:00"), distanceKm: 76, lugar: { municipality: "Tarragona" } }),
      cfg, opciones,
    );
    expect(r.venta?.regla?.code).toBe("DIURNO");
    expect(formatear(r.ventaTotal!)).toBe("198.00");
  });

  it("festivo local a las 10:00: gana el festivo, no el diurno", () => {
    const r = calcularTarifa(
      ctx({ atMs: Date.parse("2026-08-11T10:00:00+02:00"), lugar: { municipality: "Polinyà" } }),
      cfg, opciones,
    );
    expect(r.venta?.regla?.code).toBe("FESTIVO");
    expect(formatear(r.ventaTotal!)).toBe("331.00");
    expect(r.explicacion.tipoDia).toBe("Festa Major (festivo local)");
  });

  it("Navidad a las 22:00: festivos extra a 424 €, no nocturno", () => {
    const r = calcularTarifa(
      ctx({ atMs: Date.parse("2026-12-25T22:00:00+01:00") }),
      cfg, opciones,
    );
    expect(r.venta?.regla?.code).toBe("FESTIVO_EXTRA");
    expect(formatear(r.ventaTotal!)).toBe("424.00");
    expect(r.explicacion.tipoDia).toBe("Navidad (día especial)");
  });

  it("sin regla aplicable no se inventa precio: revisión manual", () => {
    const r = calcularTarifa(ctx({ serviceTypeCode: "tow_truck" }), cfg, opciones);
    expect(r.ventaTotal).toBeNull();
    expect(r.estado).toBe("manual_review");
    expect(r.avisos.map((a) => a.codigo)).toContain("NO_MATCHING_RULE");
  });

  describe("el forfait se congela en la orden de salida", () => {
    it("el cierre del sábado por la mañana mantiene la tarifa nocturna del viernes", () => {
      // El compromiso contractual: la tarifa la fija la orden de salida, no la
      // hora a la que el técnico termina.
      const bloqueada = calcularTarifa(ctx(), cfg, opciones);
      expect(bloqueada.venta?.regla?.code).toBe("NOCTURNO");

      const cierre = calcularTarifa(
        ctx({ atMs: Date.parse("2026-08-15T08:30:00+02:00"), distanceKm: 76, durationMin: 120 }),
        cfg,
        { etapa: "final", pricingRequestId: "req-2",
          reglaVentaBloqueadaId: 12, reglaCompraBloqueadaId: 12 },
      );
      expect(cierre.venta?.regla?.code).toBe("NOCTURNO");
      expect(formatear(cierre.ventaTotal!)).toBe("331.00");
    });

    it("sin bloqueo, ese mismo cierre habría resuelto otra tarifa", () => {
      // Prueba de que el bloqueo hace algo: el sábado a las 08:30 no encaja
      // en ninguna regla horaria de lunes a viernes.
      const sinBloqueo = calcularTarifa(
        ctx({ atMs: Date.parse("2026-08-15T08:30:00+02:00") }),
        cfg, { etapa: "final", pricingRequestId: "req-3" },
      );
      // Ninguna franja de L-V cubre el sábado: sin la regla bloqueada no hay
      // tarifa que aplicar, y el motor lo dice en vez de improvisar una.
      expect(sinBloqueo.venta?.regla).toBeNull();
      expect(sinBloqueo.estado).toBe("manual_review");
    });

    it("si la regla bloqueada ya no existe, no se reinventa el precio", () => {
      const r = calcularTarifa(ctx(), cfg,
        { etapa: "final", pricingRequestId: "req-4", reglaVentaBloqueadaId: 9999 });
      expect(r.ventaTotal).toBeNull();
      expect(r.estado).toBe("manual_review");
    });
  });

  describe("suplementos al cerrar", () => {
    const cerrar = (p: Partial<ContextoTarifa>) => calcularTarifa(
      ctx({ ...p }), cfg,
      { etapa: "final", pricingRequestId: "req-5", reglaVentaBloqueadaId: 12, reglaCompraBloqueadaId: 12 },
    );

    it("115 km con 100 incluidos no pasan del 20 %: no se cobran", () => {
      const r = cerrar({ distanceKm: 115 });
      expect(r.lineas.map((l) => l.tipo)).toEqual(["FORFAIT"]);
      expect(formatear(r.ventaTotal!)).toBe("331.00");
    });

    it("125 km sí: se cobran los 25 de más", () => {
      const r = cerrar({ distanceKm: 125 });
      const extra = r.lineas.find((l) => l.tipo === "EXTRA_KM")!;
      expect(extra.cantidad).toBe(25);
      expect(formatear(extra.ventaTotal!)).toBe("31.25");
      expect(formatear(r.ventaTotal!)).toBe("362.25");
    });

    it("el tiempo de más se cobra por horas", () => {
      // 300 min con 180 incluidos: 120 de exceso, más del 20 % → 2 h a 50 €
      const r = cerrar({ distanceKm: 100, durationMin: 300 });
      const extra = r.lineas.find((l) => l.tipo === "EXTRA_TIME")!;
      expect(formatear(extra.ventaTotal!)).toBe("100.00");
    });

    it("en la estimación y en el bloqueo no se cobran suplementos", () => {
      // Todavía no se ha recorrido nada: cobrarlos sería adivinar
      const r = calcularTarifa(ctx({ distanceKm: 125 }), cfg, opciones);
      expect(r.lineas.map((l) => l.tipo)).toEqual(["FORFAIT"]);
    });
  });

  describe("neumáticos y conceptos", () => {
    const cerrarCon = (conceptos: ContextoTarifa["conceptos"]) => calcularTarifa(
      ctx({ distanceKm: 100, conceptos }), cfg,
      { etapa: "final", pricingRequestId: "req-6", reglaVentaBloqueadaId: 12, reglaCompraBloqueadaId: 12 },
    );

    it("el neumático se cobra al precio de su tarifa", () => {
      const r = cerrarCon([
        { tipo: "TIRE", neumatico: { medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" } },
      ]);
      const linea = r.lineas.find((l) => l.tipo === "TIRE")!;
      expect(formatear(linea.ventaTotal!)).toBe("485.49");
    });

    it("un neumático sin tarifa no se inventa: avisa", () => {
      const r = cerrarCon([
        { tipo: "TIRE", neumatico: { medida: "295/80R22.5", marca: "Michelin", posicion: "DRIVE" } },
      ]);
      expect(r.avisos.map((a) => a.codigo)).toContain("TIRE_PRICE_NOT_FOUND");
      expect(r.lineas.find((l) => l.tipo === "TIRE")!.ventaTotal).toBeNull();
    });

    it("el ejemplo completo del encargo cuadra", () => {
      // Forfait 331 + 25 km a 1,25 + neumático 485,49 + adicional 60 = 907,74
      const r = calcularTarifa(
        ctx({
          distanceKm: 125,
          conceptos: [
            { tipo: "TIRE", neumatico: { medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" } },
            { tipo: "ADDITIONAL_TIRE", extraCode: "ADDITIONAL_TIRE", cantidad: 1 },
          ],
        }),
        cfg,
        { etapa: "final", pricingRequestId: "req-7", reglaVentaBloqueadaId: 12, reglaCompraBloqueadaId: 12 },
      );
      expect(r.lineas.map((l) => l.tipo)).toEqual(["FORFAIT", "EXTRA_KM", "TIRE", "ADDITIONAL_TIRE"]);
      expect(formatear(r.ventaTotal!)).toBe("907.74");
    });
  });

  it("una anulación con salida cobra el 50 % y sustituye al forfait", () => {
    const r = calcularTarifa(ctx({ cancelado: true }), cfg,
      { etapa: "final", pricingRequestId: "req-8", reglaVentaBloqueadaId: 12, reglaCompraBloqueadaId: 12 });
    expect(r.lineas.map((l) => l.tipo)).toEqual(["CANCELLATION"]);
    expect(formatear(r.ventaTotal!)).toBe("165.50");
  });

  it("la explicación dice de dónde sale cada cosa", () => {
    const r = calcularTarifa(ctx(), cfg, opciones);
    expect(r.explicacion).toMatchObject({
      tarifario: "SEAS Nacional",
      version: "2026",
      regla: "Nocturno",
      fechaLocal: "2026-08-14",
      horaLocal: "22:17",
      zonaHoraria: "Europe/Madrid",
      tipoDia: "Laborable",
      zona: "España",
      distanciaKm: 76,
      origenDistancia: "routed",
    });
  });

  it("el resultado lleva la versión del motor, para poder reproducirlo", () => {
    const r = calcularTarifa(ctx(), cfg, opciones);
    expect(r.engineVersion).toBe("1.0.0");
    expect(r.pricingRequestId).toBe("req-1");
  });
});
