import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";

vi.mock("../../core/auth.ts", () => ({ resolveAuthContext: vi.fn() }));
vi.mock("../../supabase.ts", () => ({ supabase: {} }));

const { esSuperadminPorSesion } = await import("./sesionSuperadmin.ts");

const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as unknown as Request;
const ctx = (esSuperadmin: boolean) => ({ userId: "u", username: "j", nombre: "J", empresaId: "e", esSuperadmin, esAdmin: true });

describe("esSuperadminPorSesion", () => {
  it("solo con la sesión de un super-admin", async () => {
    expect(await esSuperadminPorSesion(req("Bearer t"), async () => ctx(true))).toBe(true);
    expect(await esSuperadminPorSesion(req("Bearer t"), async () => ctx(false))).toBe(false);
    expect(await esSuperadminPorSesion(req("Bearer t"), async () => null)).toBe(false);
  });
  it("sin Bearer o con error al resolver, no", async () => {
    expect(await esSuperadminPorSesion(req(), async () => ctx(true))).toBe(false);
    expect(await esSuperadminPorSesion(req("Basic x"), async () => ctx(true))).toBe(false);
    expect(await esSuperadminPorSesion(req("Bearer t"), async () => { throw new Error("caído"); })).toBe(false);
  });
});
