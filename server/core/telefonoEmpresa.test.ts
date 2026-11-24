import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { errorDeTelefono, normalizarTelefono, telefonoDeTecnico } from "./telefonoEmpresa.ts";

describe("normalizarTelefono", () => {
  it("quita espacios, puntos, guiones y paréntesis, y conserva el +", () => {
    expect(normalizarTelefono(" 610 47 30 77 ")).toBe("610473077");
    expect(normalizarTelefono("+34 (610) 473-077")).toBe("+34610473077");
    expect(normalizarTelefono("977.12.34.56")).toBe("977123456");
  });

  it("vacío es quitar el teléfono", () => {
    expect(normalizarTelefono("")).toBeNull();
    expect(normalizarTelefono("  ")).toBeNull();
    expect(normalizarTelefono(null)).toBeNull();
  });
});

describe("errorDeTelefono", () => {
  it("admite móviles, fijos con prefijo y extensiones cortas", () => {
    for (const ok of ["610473077", "+34610473077", "977123456", "214"]) expect(errorDeTelefono(ok)).toBeNull();
  });

  it("rechaza letras, un + en medio y longitudes absurdas", () => {
    expect(errorDeTelefono("61047ABC")).toMatch(/solo puede llevar cifras/);
    expect(errorDeTelefono("34+610473077")).toMatch(/solo puede llevar cifras/);
    expect(errorDeTelefono("12")).toMatch(/entre 3 y 15/);
    expect(errorDeTelefono("1".repeat(16))).toMatch(/entre 3 y 15/);
  });
});

describe("telefonoDeTecnico", () => {
  const fila = { phone: "600000001", core_tel_empresa: "611111111", core_tel_personal: "622222222" };

  it("sin enlazar con Core (o sin la columna), el del taller", () => {
    expect(telefonoDeTecnico(fila, false, true)).toEqual({ telefono: "600000001", origen: "taller" });
    expect(telefonoDeTecnico({ phone: "  " }, false, true)).toEqual({ telefono: null, origen: null });
  });

  it("enlazado: manda el de empresa de Core, para cualquiera", () => {
    expect(telefonoDeTecnico(fila, true, false)).toEqual({ telefono: "611111111", origen: "empresa" });
  });

  it("enlazado y sin teléfono de empresa: el personal SOLO para el administrador", () => {
    const sinEmpresa = { ...fila, core_tel_empresa: null };
    expect(telefonoDeTecnico(sinEmpresa, true, true)).toEqual({ telefono: "622222222", origen: "personal" });
    expect(telefonoDeTecnico(sinEmpresa, true, false)).toEqual({ telefono: null, origen: null });
  });

  it("enlazado: el viejo del taller no vuelve aunque Core no tenga ninguno", () => {
    expect(telefonoDeTecnico({ phone: "600000001" }, true, true)).toEqual({ telefono: null, origen: null });
  });
});

/**
 * Los eslabones del servidor: basta que uno se suelte para que el cliente
 * vuelva a ver un teléfono que no toca, sin que falle ninguna otra prueba.
 */
describe("el teléfono del técnico en el servidor", () => {
  const SERVIDOR = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  it("la página de seguimiento del cliente pide el teléfono «para cliente»", () => {
    expect(SERVIDOR).toContain("techPhone = await telefonoDeTecnicoParaCliente(assistance.assignedTechName);");
    // Y ya no lee techs.phone a pelo para enseñárselo al cliente.
    expect(SERVIDOR).not.toContain("SELECT phone FROM techs WHERE name = $1 LIMIT 1");
  });

  it("GET /api/techs decide el teléfono con el rol de quien pregunta", () => {
    const i = SERVIDOR.indexOf('app.get("/api/techs",');
    const get = SERVIDOR.slice(i, i + 2200);
    expect(get).toContain("e.telefono_empresa AS core_tel_empresa");
    expect(get).toContain('(await getRoleFromRequestAsync(req)) === "admin"');
    expect(get).toContain("telefonoDeTecnico(fila, mandaCore, esAdmin)");
  });

  it("guardar un técnico enlazado no escribe su teléfono desde el taller", () => {
    const i = SERVIDOR.indexOf('app.put("/api/techs/:name",');
    expect(SERVIDOR.slice(i, i + 4500)).toContain("phone === undefined || (await telefonoLoPoneCore(name))");
  });
});
