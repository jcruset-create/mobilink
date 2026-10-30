/**
 * La Pantalla técnicos tiene `@ts-nocheck`, así que TypeScript no avisa si
 * falta un import. Un nombre sin importar a nivel de módulo no rompe solo esta
 * pantalla: revienta el bundle entero al cargarse y el panel sale en blanco.
 * Pasó con `ETIQUETA_ASISTENCIA_EN_CURSO`. Esta prueba carga el módulo.
 */

import { describe, expect, it, vi } from "vitest";

// El cliente de Supabase exige su configuración al cargarse; aquí no se usa.
vi.stubEnv("VITE_SUPABASE_URL", "https://dummy.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "dummy");

describe("OperariosTVView", () => {
  it("el módulo se carga sin nombres sin definir", async () => {
    const mod = await import("./OperariosTVView");
    expect(mod.default).toBeTypeOf("function");
  });
});
