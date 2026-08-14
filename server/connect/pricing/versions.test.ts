import { describe, it, expect } from "vitest";
import { seleccionarVersion, vigenteEn, type VersionTarifa } from "./versions.ts";

const ENE_2025 = Date.parse("2025-01-01T00:00:00Z");
const ENE_2026 = Date.parse("2026-01-01T00:00:00Z");
const ENE_2027 = Date.parse("2027-01-01T00:00:00Z");

const v2025: VersionTarifa = {
  id: 1, tariffPlanId: 1, version: "2025", status: "published",
  validFromMs: ENE_2025, validToMs: ENE_2026, priority: 0,
};
const v2026: VersionTarifa = {
  id: 2, tariffPlanId: 1, version: "2026", status: "published",
  validFromMs: ENE_2026, validToMs: ENE_2027, priority: 0,
};
const v2027borrador: VersionTarifa = {
  id: 3, tariffPlanId: 1, version: "2027", status: "draft",
  validFromMs: ENE_2027, validToMs: null, priority: 0,
};

const versiones = [v2025, v2026, v2027borrador];

describe("selección de la versión tarifaria", () => {
  it("un servicio de 2026 usa el tarifario de 2026", () => {
    const r = seleccionarVersion(versiones, Date.parse("2026-08-14T22:17:00Z"));
    expect(r.version?.version).toBe("2026");
    expect(r.avisos).toEqual([]);
  });

  it("publicar el de 2027 no cambia el precio de una asistencia de 2026", () => {
    // Es el motivo entero del versionado: el histórico no se toca.
    const publicado: VersionTarifa = { ...v2027borrador, status: "published" };
    const conNuevo = [...versiones, publicado];
    const r = seleccionarVersion(conNuevo, Date.parse("2026-08-14T22:17:00Z"));
    expect(r.version?.version).toBe("2026");
  });

  it("una asistencia antigua se sigue resolviendo con su tarifario", () => {
    const r = seleccionarVersion(versiones, Date.parse("2025-06-01T12:00:00Z"));
    expect(r.version?.version).toBe("2025");
  });

  it("un borrador no se factura por accidente", () => {
    // Una importación a medio revisar no puede convertirse en tarifa activa
    const r = seleccionarVersion(versiones, Date.parse("2027-03-01T12:00:00Z"));
    expect(r.version).toBeNull();
    expect(r.avisos).toContain("NO_TARIFF_PLAN");
  });

  it("una versión archivada tampoco", () => {
    const archivada: VersionTarifa = { ...v2026, status: "archived" };
    expect(vigenteEn(archivada, ENE_2026 + 1000)).toBe(false);
  });

  it("la vigencia incluye el primer instante y excluye el último", () => {
    // Si el fin fuera inclusivo, a medianoche del 1 de enero habría dos
    // versiones válidas y dos precios posibles.
    expect(vigenteEn(v2026, ENE_2026)).toBe(true);
    expect(vigenteEn(v2026, ENE_2027)).toBe(false);
    expect(vigenteEn(v2025, ENE_2026)).toBe(false);
  });

  it("una versión sin fecha de fin sigue vigente", () => {
    const abierta: VersionTarifa = { ...v2026, validToMs: null };
    expect(vigenteEn(abierta, Date.parse("2035-01-01T00:00:00Z"))).toBe(true);
  });

  it("dos versiones solapadas se resuelven igual siempre, y se avisa", () => {
    // Alguien publicó la nueva sin cerrar la anterior: error de configuración
    const solapada: VersionTarifa = {
      id: 9, tariffPlanId: 1, version: "2026-bis", status: "published",
      validFromMs: ENE_2026 + 86_400_000, validToMs: ENE_2027, priority: 0,
    };
    const en = Date.parse("2026-06-01T00:00:00Z");
    const r1 = seleccionarVersion([v2026, solapada], en);
    const r2 = seleccionarVersion([solapada, v2026], en);
    // La que empieza más tarde: una corrección publicada después manda
    expect(r1.version?.version).toBe("2026-bis");
    expect(r2.version?.version).toBe("2026-bis");
    expect(r1.avisos).toContain("OVERLAPPING_TARIFF_VERSIONS");
    expect(r1.solapadas).toHaveLength(1);
  });

  it("la prioridad manda sobre las fechas", () => {
    const especial: VersionTarifa = {
      id: 10, tariffPlanId: 1, version: "campaña", status: "published",
      validFromMs: ENE_2025, validToMs: null, priority: 100,
    };
    const r = seleccionarVersion([v2026, especial], Date.parse("2026-06-01T00:00:00Z"));
    expect(r.version?.version).toBe("campaña");
  });

  it("sin ninguna versión vigente no se inventa un tarifario", () => {
    const r = seleccionarVersion([], Date.now());
    expect(r.version).toBeNull();
    expect(r.avisos).toContain("NO_TARIFF_PLAN");
  });
});
