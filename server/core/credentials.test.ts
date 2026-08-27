import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  hashSecret,
  makeSecret,
  newSalt,
  safeEquals,
  verifySecret,
  verifySecretWithLegacy,
} from "./credentials.ts";

describe("hashSecret", () => {
  it("mantiene el algoritmo de Connect Lite (PBKDF2-SHA256, 60.000 it., 32 bytes)", () => {
    // Si este test falla, los PIN ya guardados de connect_lite_users dejan de
    // validar y los operarios de talleres colaboradores se quedan fuera.
    const salt = "a".repeat(32);
    const esperado = crypto.pbkdf2Sync("1234", salt, 60_000, 32, "sha256").toString("hex");
    expect(hashSecret("1234", salt)).toBe(esperado);
  });

  it("da hashes distintos con salts distintos", () => {
    expect(hashSecret("1234", newSalt())).not.toBe(hashSecret("1234", newSalt()));
  });
});

describe("safeEquals", () => {
  it("compara correctamente", () => {
    expect(safeEquals("abc", "abc")).toBe(true);
    expect(safeEquals("abc", "abd")).toBe(false);
    expect(safeEquals("abc", "abcd")).toBe(false);
    expect(safeEquals("", "")).toBe(true);
  });
});

describe("verifySecret", () => {
  it("acepta la credencial correcta y rechaza el resto", () => {
    const { hash, salt } = makeSecret("4321");
    expect(verifySecret("4321", hash, salt)).toBe(true);
    expect(verifySecret("0000", hash, salt)).toBe(false);
    expect(verifySecret("", hash, salt)).toBe(false);
    expect(verifySecret("4321", null, salt)).toBe(false);
    expect(verifySecret("4321", hash, null)).toBe(false);
  });
});

describe("verifySecretWithLegacy", () => {
  it("acepta un PIN heredado en claro y pide migrarlo", () => {
    const r = verifySecretWithLegacy("1234", null, null, "1234");
    expect(r.ok).toBe(true);
    expect(r.needsUpgrade).toBe(true);
  });

  it("rechaza un PIN incorrecto frente al valor heredado", () => {
    expect(verifySecretWithLegacy("9999", null, null, "1234")).toEqual({
      ok: false,
      needsUpgrade: false,
    });
  });

  it("valida contra el hash sin pedir migración", () => {
    const { hash, salt } = makeSecret("4321");
    expect(verifySecretWithLegacy("4321", hash, salt, null)).toEqual({
      ok: true,
      needsUpgrade: false,
    });
    expect(verifySecretWithLegacy("0000", hash, salt, null).ok).toBe(false);
  });

  it("ignora el valor en claro cuando ya existe hash (no hay vuelta atrás)", () => {
    const { hash, salt } = makeSecret("4321");
    expect(verifySecretWithLegacy("1234", hash, salt, "1234").ok).toBe(false);
  });

  it("rechaza a quien no tiene ninguna credencial asignada", () => {
    expect(verifySecretWithLegacy("1234", null, null, null)).toEqual({
      ok: false,
      needsUpgrade: false,
    });
    expect(verifySecretWithLegacy("", null, null, "1234").ok).toBe(false);
  });
});
