import { describe, expect, it } from "vitest";
import { decidirSesionPanel, MOTIVO_SESION_CADUCADA } from "./panelSession";

describe("decidirSesionPanel", () => {
  it("cierra la sesión cuando el servidor rechaza la credencial", () => {
    for (const status of [401, 403]) {
      expect(decidirSesionPanel(status, null)).toEqual({
        accion: "cerrar",
        motivo: MOTIVO_SESION_CADUCADA,
      });
    }
  });

  it("NO cierra la sesión ante un fallo pasajero", () => {
    // En el taller se trabaja con la conexión que hay: un 500 o un corte no
    // pueden echar a nadie. Si esto cambia, se está rompiendo el uso real.
    for (const status of [0, 408, 500, 502, 503, 504]) {
      expect(decidirSesionPanel(status, null)).toEqual({ accion: "mantener" });
    }
  });

  it("refresca rol, nombre y pantallas cuando la sesión es válida", () => {
    expect(
      decidirSesionPanel(200, {
        role: "supervisor",
        name: "  Jordi  ",
        allowedViews: ["operativo", "agenda"],
      })
    ).toEqual({
      accion: "refrescar",
      rol: "supervisor",
      nombre: "Jordi",
      vistas: ["operativo", "agenda"],
    });
  });

  it("un rol desconocido no se cuela como válido", () => {
    const d = decidirSesionPanel(200, { role: "jefe-supremo" });
    expect(d).toEqual({ accion: "refrescar", rol: null, nombre: null, vistas: null });
  });

  it("sin pantallas concretas no hay restricción (null, no lista vacía)", () => {
    // Una lista vacía significaría "no puede ver nada"; el contrato es que
    // ausencia de restricción se representa con null.
    expect(decidirSesionPanel(200, { role: "admin", allowedViews: [] })).toMatchObject({
      vistas: null,
    });
    expect(decidirSesionPanel(200, { role: "admin" })).toMatchObject({ vistas: null });
  });

  it("aguanta un cuerpo vacío o con basura", () => {
    expect(decidirSesionPanel(200, null)).toEqual({
      accion: "refrescar",
      rol: null,
      nombre: null,
      vistas: null,
    });
    expect(decidirSesionPanel(200, { role: 42, name: "   ", allowedViews: "no" })).toEqual({
      accion: "refrescar",
      rol: null,
      nombre: null,
      vistas: null,
    });
  });
});
