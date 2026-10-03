import { describe, expect, it } from "vitest";
import { admiteAdminDeEmpresa, puedeVerEmpresa } from "./adminAcceso";

describe("admiteAdminDeEmpresa: lo que un administrador de cliente puede pedir", () => {
  it("puede leer la lista de empresas (se le devuelve solo la suya)", () => {
    expect(admiteAdminDeEmpresa("GET", "/empresas")).toBe(true);
  });

  it("puede leer las licencias de una empresa (luego se comprueba que sea la suya)", () => {
    expect(admiteAdminDeEmpresa("GET", "/empresas/abc/licencias")).toBe(true);
  });

  it("NO puede crear ni modificar empresas", () => {
    expect(admiteAdminDeEmpresa("POST", "/empresas")).toBe(false);
    expect(admiteAdminDeEmpresa("PATCH", "/empresas/abc")).toBe(false);
  });

  it("NO puede tocar licencias", () => {
    expect(admiteAdminDeEmpresa("POST", "/empresas/abc/licencias")).toBe(false);
    expect(admiteAdminDeEmpresa("PATCH", "/licencias/abc")).toBe(false);
  });

  it("NO entra en talleres ni en la auditoría", () => {
    expect(admiteAdminDeEmpresa("GET", "/empresas/abc/centros")).toBe(false);
    expect(admiteAdminDeEmpresa("POST", "/empresas/abc/centros")).toBe(false);
    expect(admiteAdminDeEmpresa("GET", "/empresas/abc/auditoria")).toBe(false);
  });

  it("una ruta que no está en la lista nace cerrada", () => {
    // La razón de que sea lista blanca: lo que se añada mañana no se abre solo.
    expect(admiteAdminDeEmpresa("GET", "/empresas/abc/lo-que-sea-nuevo")).toBe(false);
    expect(admiteAdminDeEmpresa("GET", "/cualquier-otra")).toBe(false);
  });

  it("no se cuela con rutas parecidas", () => {
    expect(admiteAdminDeEmpresa("GET", "/empresas/abc/licencias/xyz")).toBe(false);
    expect(admiteAdminDeEmpresa("GET", "/empresasX")).toBe(false);
  });
});

describe("puedeVerEmpresa", () => {
  const ACME = "acme", BETA = "beta";

  it("el superadmin ve cualquiera", () => {
    expect(puedeVerEmpresa({ esSuperadmin: true, empresaId: ACME }, BETA)).toBe(true);
  });

  it("el administrador de un cliente ve la suya y solo la suya", () => {
    expect(puedeVerEmpresa({ esSuperadmin: false, empresaId: ACME }, ACME)).toBe(true);
    expect(puedeVerEmpresa({ esSuperadmin: false, empresaId: ACME }, BETA)).toBe(false);
  });

  it("sin sesión, nada", () => {
    expect(puedeVerEmpresa(undefined, ACME)).toBe(false);
  });
});
