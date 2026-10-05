import { describe, expect, it } from "vitest";
import { decidirConCuentaExistente } from "./altaUsuario";

const admin = { empresaId: "sea", esSuperadmin: false };

describe("decidirConCuentaExistente", () => {
  it("una cuenta huérfana se reutiliza y el alta sigue", () => {
    expect(decidirConCuentaExistente({ tipo: "ninguno" }, admin, "Albert")).toEqual({ accion: "reutilizar" });
  });

  it("si está en mi empresa, me manda a la lista", () => {
    const r = decidirConCuentaExistente({ tipo: "ficha", empresaId: "sea" }, admin, "Albert");
    expect(r.accion).toBe("rechazar");
    expect((r as any).mensaje).toContain("en tu empresa");
    expect((r as any).mensaje).toContain("desactivado");
  });

  it("si es de otra empresa, pide otro nombre y no dice de quién es", () => {
    const r = decidirConCuentaExistente({ tipo: "ficha", empresaId: "laser" }, admin, "Albert");
    expect(r.accion).toBe("rechazar");
    expect((r as any).mensaje).not.toContain("laser");
    expect((r as any).mensaje).toContain("otro");
  });

  it("al superadmin sí se le dice que es de otra empresa", () => {
    const r = decidirConCuentaExistente({ tipo: "ficha", empresaId: "laser" }, { empresaId: "sea", esSuperadmin: true }, "Albert");
    expect((r as any).mensaje).toContain("en otra empresa");
  });

  it("un operario de TyreControl no se pisa nunca", () => {
    const r = decidirConCuentaExistente({ tipo: "tyrecontrol" }, { empresaId: "sea", esSuperadmin: true }, "Albert");
    expect(r.accion).toBe("rechazar");
  });
});
