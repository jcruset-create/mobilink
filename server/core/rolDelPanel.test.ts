import { describe, expect, it } from "vitest";
import { resolverRolDelPanel, vistasDeWorkplanner, type DatosDeSesion } from "./rolDelPanel";

const panel = [
  { name: "Albert", role: "supervisor" as const, allowedViews: ["operativo2", "agenda2"] },
  { name: "Recepción", role: "supervisor" as const, allowedViews: [] },
  { name: "TV", role: "tv75" as const },
];

function sesion(extra: Partial<DatosDeSesion>): DatosDeSesion {
  return {
    username: "albert.belles",
    nombre: "Albert Belles Bertran",
    esSuperadmin: false,
    admAdmin: false,
    techName: null,
    workplanner: null,
    ...extra,
  };
}

describe("resolverRolDelPanel", () => {
  it("el caso de Albert: sin coincidir el nombre ni el módulo, no entra (como antes)", () => {
    expect(resolverRolDelPanel(sesion({}), panel)).toBeNull();
  });

  it("por el técnico vinculado encuentra su usuario del panel", () => {
    expect(resolverRolDelPanel(sesion({ techName: "Albert" }), panel)).toMatchObject({
      role: "supervisor",
      name: "Albert",
      allowedViews: ["operativo2", "agenda2"],
      via: "tecnico",
    });
  });

  it("con el módulo WorkPlanner y sin usuario del panel: supervisor con sus pantallas", () => {
    expect(
      resolverRolDelPanel(
        sesion({ workplanner: { pantallas: ["operativo2", "agenda", "partes"] } }),
        []
      )
    ).toMatchObject({ role: "supervisor", allowedViews: ["operativo2", "agenda2", "agenda"], via: "workplanner" });
  });

  it("el usuario del panel manda sobre el módulo", () => {
    expect(
      resolverRolDelPanel(sesion({ techName: "Albert", workplanner: { pantallas: null } }), panel)?.via
    ).toBe("tecnico");
  });

  it("igual que siempre: por usuario o nombre completo", () => {
    expect(resolverRolDelPanel(sesion({ username: "recepción" }), panel)?.name).toBe("Recepción");
    expect(resolverRolDelPanel(sesion({ username: "x", nombre: "TV" }), panel)?.role).toBe("tv75");
  });

  it("superadmin y admin de Administración son admin del panel", () => {
    expect(resolverRolDelPanel(sesion({ esSuperadmin: true }), panel)?.role).toBe("admin");
    expect(resolverRolDelPanel(sesion({ admAdmin: true }), panel)?.role).toBe("admin");
  });

  it("nombres vacíos no casan con nada", () => {
    expect(
      resolverRolDelPanel(sesion({ username: "", nombre: "", techName: "" }), [
        { name: "", role: "admin" },
      ])
    ).toBeNull();
  });
});

describe("vistasDeWorkplanner", () => {
  it("sin lista: todas las del rol", () => {
    expect(vistasDeWorkplanner(null)).toBeNull();
    expect(vistasDeWorkplanner([])).toBeNull();
  });
  it("solo pantallas que no son del panel: al menos Operativo 2", () => {
    expect(vistasDeWorkplanner(["partes", "plantillas"])).toEqual(["operativo2"]);
  });
});
