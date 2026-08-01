/**
 * Pruebas de las reglas de Mobilink Assist Lite: máquina de estados,
 * validación de cierre, geovallas, saneado de GPS y KPIs.
 *
 * Son pruebas puras (sin base de datos): liteRules.ts no tiene dependencias.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_FINISH_RULES, LITE_FLOW, WORKSHOP_TIER, canLiteTransition, computeLiteKpis,
  dedupePoints, estimateEtaMinutes, geofenceHint, haversineMeters, isValidPoint,
  nextLiteStatus, shouldTrack, statusQualityScore, trackingIntervalSec, validateFinish,
} from "./liteRules.ts";

describe("máquina de estados", () => {
  it("recorre el ciclo completo del taller", () => {
    const camino = ["technician_assigned", "en_route", "arrived", "in_progress", "finished", "returning_to_workshop", "at_workshop"];
    let actual = "assigned";
    for (const paso of camino) {
      expect(canLiteTransition(actual, paso)).toBe(true);
      actual = paso;
    }
    expect(nextLiteStatus("at_workshop")).toBeNull();
  });

  it("permite cerrar sin volver al taller", () => {
    expect(canLiteTransition("in_progress", "finished")).toBe(true);
    // 'finished' es un final válido: la vuelta al taller es opcional
    expect(canLiteTransition("finished", "returning_to_workshop")).toBe(true);
  });

  it("no deja saltarse estados ni retroceder", () => {
    expect(canLiteTransition("assigned", "arrived")).toBe(false);
    expect(canLiteTransition("en_route", "in_progress")).toBe(false);
    expect(canLiteTransition("arrived", "en_route")).toBe(false);
    expect(canLiteTransition("finished", "in_progress")).toBe(false);
    expect(canLiteTransition("at_workshop", "en_route")).toBe(false);
  });

  it("rechaza estados desconocidos", () => {
    expect(canLiteTransition("en_route", "teletransportado")).toBe(false);
    expect(canLiteTransition("cancelled", "en_route")).toBe(false);
  });

  it("mantiene los 8 estados del ciclo operativo", () => {
    expect(LITE_FLOW).toHaveLength(8);
    expect(WORKSHOP_TIER.lite).toBe("LITE");
    expect(WORKSHOP_TIER.assist).toBe("FULL");
  });
});

describe("seguimiento GPS", () => {
  it("solo rastrea durante los estados en movimiento o en el punto", () => {
    expect(shouldTrack("en_route")).toBe(true);
    expect(shouldTrack("arrived")).toBe(true);
    expect(shouldTrack("returning_to_workshop")).toBe(true);
    expect(shouldTrack("assigned")).toBe(false);
    expect(shouldTrack("technician_assigned")).toBe(false);
    expect(shouldTrack("finished")).toBe(false);
    expect(shouldTrack("at_workshop")).toBe(false);
  });

  it("respeta la configuración de privacidad al trabajar", () => {
    expect(shouldTrack("in_progress", true)).toBe(true);
    expect(shouldTrack("in_progress", false)).toBe(false);
  });

  it("espacia el envío cuando el vehículo está parado", () => {
    expect(trackingIntervalSec("en_route", 90)).toBeLessThan(trackingIntervalSec("en_route", 0));
    expect(trackingIntervalSec("arrived", 0)).toBe(120);
    expect(trackingIntervalSec("finished", 50)).toBe(0);
  });

  it("descarta posiciones imposibles", () => {
    const now = 1_700_000_000_000;
    expect(isValidPoint({ lat: 41.1, lng: 1.2, ts: now }, now)).toBe(true);
    expect(isValidPoint({ lat: 0, lng: 0, ts: now }, now)).toBe(false);
    expect(isValidPoint({ lat: 200, lng: 1.2, ts: now }, now)).toBe(false);
    expect(isValidPoint({ lat: 41.1, lng: 1.2, ts: now + 3600_000 }, now)).toBe(false);
    expect(isValidPoint({ lat: 41.1, lng: 1.2, ts: now, accuracyM: 5000 }, now)).toBe(false);
  });

  it("elimina duplicados y micromovimientos", () => {
    const p = (lat: number, lng: number, ts: number) => ({ lat, lng, ts });
    const puntos = [p(41.1, 1.2, 3000), p(41.1, 1.2, 1000), p(41.1, 1.2, 1000), p(41.2, 1.3, 2000)];
    const out = dedupePoints(puntos);
    expect(out.map((x) => x.ts)).toEqual([1000, 2000, 3000]);
  });

  it("mide distancias reales", () => {
    // Tarragona → Reus, ~13 km en línea recta
    const d = haversineMeters(41.1189, 1.2445, 41.1561, 1.1069);
    expect(d).toBeGreaterThan(11000);
    expect(d).toBeLessThan(15000);
    expect(estimateEtaMinutes(d)).toBeGreaterThan(5);
  });
});

describe("geovallas", () => {
  const punto = { lat: 41.1189, lng: 1.2445, ts: Date.now(), accuracyM: 15 };

  it("sugiere 'en punto' al llegar al lugar de la incidencia", () => {
    const hint = geofenceHint({ status: "en_route", point: punto, target: { lat: 41.1190, lng: 1.2446 } });
    expect(hint.suggest).toBe("arrived");
    expect(hint.reliable).toBe(true);
  });

  it("no sugiere nada si aún está lejos", () => {
    const hint = geofenceHint({ status: "en_route", point: punto, target: { lat: 41.2, lng: 1.4 } });
    expect(hint.suggest).toBeNull();
    expect(hint.distanceM).toBeGreaterThan(1000);
  });

  it("no sugiere nada con precisión GPS insuficiente", () => {
    const hint = geofenceHint({
      status: "en_route",
      point: { ...punto, accuracyM: 900 },
      target: { lat: 41.1190, lng: 1.2446 },
    });
    expect(hint.suggest).toBeNull();
    expect(hint.reliable).toBe(false);
  });

  it("sugiere 'en taller' al volver a la base", () => {
    const hint = geofenceHint({ status: "returning_to_workshop", point: punto, workshop: { lat: 41.1191, lng: 1.2447 } });
    expect(hint.suggest).toBe("at_workshop");
  });
});

describe("requisitos de finalización", () => {
  it("acepta un cierre completo", () => {
    const errores = validateFinish(DEFAULT_FINISH_RULES, {
      result: "repaired_on_site",
      resolutionNotes: "Sustituida la batería",
      photos: [{ category: "work" }],
    });
    expect(errores).toEqual([]);
  });

  it("exige fotografías, resultado y observación", () => {
    const errores = validateFinish(DEFAULT_FINISH_RULES, { photos: [] });
    expect(errores).toHaveLength(3);
  });

  it("exige firma y nombre del firmante cuando el servicio lo requiere", () => {
    const reglas = { ...DEFAULT_FINISH_RULES, requireSignature: true };
    const sinFirma = validateFinish(reglas, {
      result: "towed", resolutionNotes: "Trasladado", photos: [{ category: "work" }],
    });
    expect(sinFirma.some((e) => e.includes("firma"))).toBe(true);

    const conFirma = validateFinish(reglas, {
      result: "towed", resolutionNotes: "Trasladado", photos: [{ category: "work" }],
      signature: { signerName: "Ana Pérez" },
    });
    expect(conFirma).toEqual([]);
  });

  it("exige las categorías de foto configuradas", () => {
    const reglas = { ...DEFAULT_FINISH_RULES, requiredPhotoCategories: ["arrival", "finished"] };
    const errores = validateFinish(reglas, {
      result: "repaired_on_site", resolutionNotes: "ok", photos: [{ category: "arrival" }],
    });
    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain("Vehículo finalizado");
  });
});

describe("KPIs", () => {
  const t0 = 1_700_000_000_000;
  const min = (n: number) => t0 + n * 60_000;
  const historial = [
    { toStatus: "assigned", occurredAtMs: t0 },
    { toStatus: "technician_assigned", occurredAtMs: min(2) },
    { toStatus: "en_route", occurredAtMs: min(5) },
    { toStatus: "arrived", occurredAtMs: min(30) },
    { toStatus: "in_progress", occurredAtMs: min(35) },
    { toStatus: "finished", occurredAtMs: min(80) },
    { toStatus: "returning_to_workshop", occurredAtMs: min(85) },
    { toStatus: "at_workshop", occurredAtMs: min(110) },
  ];

  it("calcula los tiempos del ciclo con marcas del servidor", () => {
    const k = computeLiteKpis(historial);
    expect(k.acceptMin).toBe(2);
    expect(k.acceptToEnRouteMin).toBe(3);
    expect(k.travelMin).toBe(25);
    expect(k.assignToArrivalMin).toBe(30);
    expect(k.onSiteBeforeWorkMin).toBe(5);
    expect(k.workMin).toBe(45);
    expect(k.totalMin).toBe(80);
    expect(k.returnMin).toBe(25);
    expect(k.cycleMin).toBe(110);
  });

  it("evalúa el cumplimiento del SLA de llegada", () => {
    expect(computeLiteKpis(historial, { slaDeadlineAtMs: min(45) }).slaMet).toBe(true);
    expect(computeLiteKpis(historial, { slaDeadlineAtMs: min(20) }).slaMet).toBe(false);
    expect(computeLiteKpis(historial).slaMet).toBeNull();
  });

  it("deja en null lo que no ha ocurrido todavía", () => {
    const k = computeLiteKpis(historial.slice(0, 3));
    expect(k.travelMin).toBeNull();
    expect(k.totalMin).toBeNull();
  });

  it("penaliza la calidad cuando Central tiene que corregir estados", () => {
    expect(statusQualityScore(historial)).toBe(100);
    expect(statusQualityScore(historial, 2)).toBe(70);
    expect(statusQualityScore(historial.slice(0, 3))).toBeLessThan(60);
  });
});
