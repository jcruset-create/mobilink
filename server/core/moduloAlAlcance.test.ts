/**
 * Un usuario que solo existe en tc_usuarios (técnico de la tablet, usuario de
 * un cliente) entra con la empresa por defecto, que tiene licencia de todo.
 * Que eso no le abra los demás módulos.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../supabase.ts", () => ({ supabase: {} }));
vi.mock("../db.ts", () => ({ default: { query: vi.fn() } }));

const { moduloAlAlcance } = await import("./auth.ts");

describe("moduloAlAlcance", () => {
  it("el usuario del puente solo llega a TyreControl", () => {
    const ctx = { esSuperadmin: false, soloTyreControl: true };
    expect(moduloAlAlcance(ctx, "tyrecontrol")).toBe(true);
    for (const m of ["administracion", "cash", "central", "almacen", "tacografos", "recepciones", "therefore"]) {
      expect(moduloAlAlcance(ctx, m)).toBe(false);
    }
  });

  it("el usuario unificado sigue como estaba: decide su licencia", () => {
    expect(moduloAlAlcance({ esSuperadmin: false }, "administracion")).toBe(true);
    expect(moduloAlAlcance({ esSuperadmin: false, soloTyreControl: false }, "cash")).toBe(true);
  });

  it("el superadmin llega a todo", () => {
    expect(moduloAlAlcance({ esSuperadmin: true, soloTyreControl: true }, "administracion")).toBe(true);
  });
});
