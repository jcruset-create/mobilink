import { describe, expect, it } from "vitest";
import {
  autorizar,
  conApoyo,
  conResponsable,
  etiquetaDeTecnico,
  motivoNoAutorizable,
  sinApoyo,
  tecnicosParaElegir,
} from "./autorizarDesdeParte";
import type { Job, Tech } from "./workshopTypes";

const tech = (name: string, extra: Partial<Tech> = {}): Tech =>
  ({ name, status: "disponible", currentJobId: null, blocked: false, competencies: {} as any, priorities: {} as any, ...extra }) as Tech;

const libre = tech("Anthoni");
const ocupado = tech("José", { status: "ocupado", currentJobId: 7 });
const vacaciones = tech("Alejandro", { status: "vacaciones" });

describe("quién se puede elegir", () => {
  it("libres primero, con su etiqueta", () => {
    expect(tecnicosParaElegir([vacaciones, ocupado, libre]).map((t) => t.name)).toEqual(["Anthoni", "Alejandro", "José"]);
    expect(etiquetaDeTecnico(libre)).toBe("Anthoni (libre)");
    expect(etiquetaDeTecnico(ocupado)).toBe("José (ya está en otro trabajo)");
    expect(etiquetaDeTecnico(vacaciones)).toBe("Alejandro (no está disponible)");
  });
});

describe("motivoNoAutorizable", () => {
  const techs = [libre, ocupado, vacaciones];
  it("sin nadie, Móvil sin furgoneta, o alguien que no está libre", () => {
    expect(motivoNoAutorizable([], techs, "camion")).toBe("Elige al menos el responsable.");
    expect(motivoNoAutorizable(["Anthoni"], techs, "movil")).toMatch(/furgoneta/);
    expect(motivoNoAutorizable(["Anthoni", "José"], techs, "camion")).toBe("José ya está en otro trabajo.");
    expect(motivoNoAutorizable(["Alejandro"], techs, "camion")).toBe("Alejandro no está disponible.");
    expect(motivoNoAutorizable(["Nadie"], techs, "camion")).toBe("Nadie ya no existe como técnico.");
  });
  it("todos libres: se puede", () => {
    expect(motivoNoAutorizable(["Anthoni"], techs, "camion")).toBeNull();
  });
});

describe("editar la propuesta", () => {
  it("responsable y apoyos", () => {
    expect(conResponsable(["Anthoni", "Alejandro"], "José")).toEqual(["José", "Alejandro"]);
    expect(conResponsable(["Anthoni", "Alejandro"], "Alejandro")).toEqual(["Alejandro"]);
    expect(conResponsable(["Anthoni"], "")).toEqual([]);
    expect(conApoyo(["Anthoni"], "José")).toEqual(["Anthoni", "José"]);
    expect(conApoyo(["Anthoni", "José"], "José")).toEqual(["Anthoni", "José"]);
    expect(conApoyo([], "José")).toEqual(["José"]);
    expect(sinApoyo(["Anthoni", "José", "Iván"], "José")).toEqual(["Anthoni", "Iván"]);
    expect(sinApoyo(["Anthoni"], "Anthoni")).toEqual(["Anthoni"]);
  });
});

describe("autorizar", () => {
  it("trabajo activo, responsable ocupado, apoyo de refuerzo, todos con el trabajo", () => {
    const job = { id: 55, plate: "9328KBN", area: "camion", status: "validacion", assignedNames: [], reason: "", startedAtMs: null } as unknown as Job;
    const r = autorizar(job, ["Anthoni", "Alejandro"], [libre, ocupado, tech("Alejandro")], 1000);
    expect(r.job.status).toBe("activo");
    expect(r.job.startedAtMs).toBe(1000);
    expect(r.job.assignedNames).toEqual(["Anthoni", "Alejandro"]);
    expect(r.techs.map((t) => [t.name, t.status, t.currentJobId])).toEqual([
      ["Anthoni", "ocupado", 55],
      ["Alejandro", "refuerzo", 55],
    ]);
  });
});
