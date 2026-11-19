import { describe, expect, it } from "vitest";
import { decidirCambioDeDatos, mensajeDeCorreo } from "./usuarioDatos.ts";

const SUPER = { id: "s", es_superadmin: true, empresa_id: "mobilink" };
const ADMIN_PLANA = { id: "a", es_superadmin: false, empresa_id: "plana" };
const cliente = { id: "c", email: "ana@plana.com", empresa_id: "plana", es_superadmin: false };

describe("decidirCambioDeDatos", () => {
  it("el superadministrador cambia correo y empresa de un usuario propio de TyreControl", () => {
    expect(decidirCambioDeDatos(SUPER, cliente, false, { email: " Ana.Nueva@Plana.com ", empresa_id: "encatrans" }))
      .toEqual({ ok: true, email: "ana.nueva@plana.com", empresaId: "encatrans" });
  });

  it("si no cambia nada, no hay nada que escribir", () => {
    expect(decidirCambioDeDatos(SUPER, cliente, false, { email: "ANA@plana.com", empresa_id: "plana" })).toEqual({ ok: true });
    expect(decidirCambioDeDatos(SUPER, cliente, true, {})).toEqual({ ok: true });
  });

  it("el administrador de una empresa cambia el correo de los suyos, pero no los mueve", () => {
    expect(decidirCambioDeDatos(ADMIN_PLANA, cliente, false, { email: "otra@plana.com" }))
      .toEqual({ ok: true, email: "otra@plana.com" });
    const r = decidirCambioDeDatos(ADMIN_PLANA, cliente, false, { empresa_id: "encatrans" });
    expect(r.ok).toBe(false);
    expect((r as any).estado).toBe(403);
  });

  it("no toca a los de otra empresa ni a un superadministrador", () => {
    const deOtra = { ...cliente, empresa_id: "encatrans" };
    expect(decidirCambioDeDatos(ADMIN_PLANA, deOtra, false, { email: "x@y.com" }).ok).toBe(false);
    const jefe = { id: "j", email: "j@m.com", empresa_id: "plana", es_superadmin: true };
    expect(decidirCambioDeDatos(ADMIN_PLANA, jefe, false, { email: "x@y.com" }).ok).toBe(false);
  });

  it("un superadministrador no se cambia de empresa", () => {
    const jefe = { id: "j", email: "j@m.com", empresa_id: "mobilink", es_superadmin: true };
    expect(decidirCambioDeDatos(SUPER, jefe, false, { empresa_id: "plana" }).ok).toBe(false);
  });

  it("a un usuario unificado no se le cambia aquí ni correo ni empresa", () => {
    const r = decidirCambioDeDatos(SUPER, cliente, true, { email: "otra@plana.com" });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/Administración/);
    expect(decidirCambioDeDatos(SUPER, cliente, true, { empresa_id: "encatrans" }).ok).toBe(false);
  });

  it("un correo sin forma de correo no pasa", () => {
    expect(decidirCambioDeDatos(SUPER, cliente, false, { email: "ana-sin-arroba" }).ok).toBe(false);
  });
});

describe("mensajeDeCorreo", () => {
  it("traduce el «ya registrado» de Supabase", () => {
    expect(mensajeDeCorreo("A user with this email address has already been registered"))
      .toMatch(/ya lo usa otro usuario/);
  });
  it("deja pasar lo que no conoce", () => {
    expect(mensajeDeCorreo("otra cosa")).toBe("otra cosa");
    expect(mensajeDeCorreo(undefined)).toMatch(/No se ha podido/);
  });
});
