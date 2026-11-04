import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que se fija aquí es el agujero, no la comodidad.
 *
 * Los tres informes reciben la empresa en la URL y el servidor habla con
 * Supabase sin pasar por RLS. Si esto se relaja, un usuario de rol `cliente`
 * saca el informe de otro cliente tecleando su UUID, y nadie se enteraría:
 * el PDF sale perfecto, con los datos de quien no debe.
 */

const puedeVer = vi.fn();
vi.mock("../empresaAcceso.ts", () => ({
  puedeVerEmpresaDeRequest: (...a: unknown[]) => puedeVer(...a),
}));

const { empresaDelInforme, esAdministrador } = await import("./alcance.ts");

const req = (authCtx: Record<string, unknown> | undefined) => ({ authCtx }) as any;

const PROPIA = "11111111-1111-4111-8111-111111111111";
const AJENA = "22222222-2222-4222-8222-222222222222";

beforeEach(() => puedeVer.mockReset());

describe("empresaDelInforme", () => {
  it("sin sesión no hay informe", async () => {
    expect(await empresaDelInforme(req(undefined), PROPIA))
      .toEqual({ empresa: null, estado: 401, error: "Sesión requerida" });
  });

  it("sin pedir empresa, la de quien pide", async () => {
    expect(await empresaDelInforme(req({ userId: "u", empresaId: PROPIA }), ""))
      .toEqual({ empresa: PROPIA });
    // No se pregunta a la base por la propia: es la suya por definición.
    expect(puedeVer).not.toHaveBeenCalled();
  });

  it("pidiendo la propia, tampoco se consulta", async () => {
    expect(await empresaDelInforme(req({ userId: "u", empresaId: PROPIA }), PROPIA))
      .toEqual({ empresa: PROPIA });
    expect(puedeVer).not.toHaveBeenCalled();
  });

  it("pidiendo una ajena que NO puede ver: 403, no su propia", async () => {
    puedeVer.mockResolvedValue(false);
    const r = await empresaDelInforme(req({ userId: "u", empresaId: PROPIA }), AJENA);
    expect(r).toEqual({ empresa: null, estado: 403, error: "Sin acceso a esa empresa" });
    // Lo importante: NO se le devuelve un informe de otra empresa, y tampoco
    // se le cambia la empresa por la suya sin decírselo.
    expect(r.empresa).toBeNull();
  });

  it("pidiendo una ajena que sí puede ver (un técnico): sale", async () => {
    puedeVer.mockResolvedValue(true);
    expect(await empresaDelInforme(req({ userId: "u", empresaId: PROPIA }), AJENA))
      .toEqual({ empresa: AJENA });
  });

  it("el espacio en blanco no es una empresa", async () => {
    expect(await empresaDelInforme(req({ userId: "u", empresaId: PROPIA }), "   "))
      .toEqual({ empresa: PROPIA });
  });

  it("sin empresa propia ni empresa pedida, se dice en vez de leer todo", async () => {
    expect(await empresaDelInforme(req({ userId: "u", empresaId: "" }), ""))
      .toEqual({ empresa: null, estado: 400, error: "Falta la empresa" });
  });
});

describe("esAdministrador", () => {
  it("el administrador de la empresa y el super-admin, sí", () => {
    expect(esAdministrador(req({ esAdmin: true }))).toBe(true);
    expect(esAdministrador(req({ esSuperadmin: true }))).toBe(true);
  });

  it("un cliente o un técnico, no: el informe interno no es para ellos", () => {
    expect(esAdministrador(req({ esAdmin: false, esSuperadmin: false }))).toBe(false);
  });

  it("sin sesión, no", () => {
    expect(esAdministrador(req(undefined))).toBe(false);
  });
});
