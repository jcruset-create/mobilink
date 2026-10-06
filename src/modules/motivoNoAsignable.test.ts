import { describe, expect, it } from "vitest";
import { motivoNoAsignable } from "./assignment";
import { DEFAULT_QUICK_TEMPLATES } from "./workshopConstants";

const tech = (extra: Record<string, unknown> = {}) =>
  ({
    name: "Albert",
    status: "disponible",
    blocked: false,
    currentJobId: null,
    competencies: { camion: { responsable: true, apoyo: true } },
    ...extra,
  }) as any;

const job = (extra: Record<string, unknown> = {}) =>
  ({ id: 1, area: "movil", status: "espera", assignedNames: [], plate: "FLOTA", ...extra }) as any;

describe("motivoNoAsignable", () => {
  it("sin competencia en el área lo dice con el nombre del área", () => {
    expect(motivoNoAsignable(tech(), job(), [], DEFAULT_QUICK_TEMPLATES, "responsable")).toContain("Móvil");
  });
  it("con competencia y libre, se puede", () => {
    const t = tech({ competencies: { movil: { responsable: true, apoyo: true } } });
    expect(motivoNoAsignable(t, job(), [], DEFAULT_QUICK_TEMPLATES, "responsable")).toBeNull();
  });
  it("si la plantilla restringe técnicos, dice a quién permite", () => {
    const t = tech({ competencies: { movil: { responsable: true, apoyo: true } } });
    const plantilla = { key: "flota", label: "Flota", area: "movil", mode: "single", allowedTechs: ["José"], priorityOrder: [] } as any;
    const j = job({ quickEntryLabel: "Flota", template: null });
    const r = motivoNoAsignable(t, j, [], [plantilla], "responsable");
    expect(r).toContain("José");
  });
  it("de baja: no disponible", () => {
    expect(motivoNoAsignable(tech({ status: "baja" }), job(), [], DEFAULT_QUICK_TEMPLATES, "responsable")).not.toBeNull();
  });
});
