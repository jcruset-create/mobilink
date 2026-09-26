import { describe, expect, it } from "vitest";
import { accesosAPayload, estadoInicialAccesos, estadoDeLicencia, modulosGuardados, type LicenciaModulo } from "./accesosModulosHelpers";
import { MODULOS_APP } from "../config/modulosApp";

const CORE = MODULOS_APP.find((m) => m.key === "sea-core")!;

describe("accesosAPayload", () => {
  it("sin módulos marcados no da ningún acceso", () => {
    expect(accesosAPayload(estadoInicialAccesos())).toEqual([]);
  });

  it("con todas las pantallas marcadas guarda null (= todas)", () => {
    const estado = estadoInicialAccesos();
    estado["sea-core"] = { ...estado["sea-core"], activo: true };
    expect(accesosAPayload(estado)).toEqual([
      { modulo: "sea-core", rol: CORE.roles[0].value, pantallas: null, empresa_id: null },
    ]);
  });

  it("con alguna desmarcada guarda solo las marcadas", () => {
    const estado = estadoInicialAccesos();
    const [primera] = CORE.pantallas;
    estado["sea-core"] = {
      ...estado["sea-core"],
      activo: true,
      marcadas: { ...estado["sea-core"].marcadas, [primera.key]: false },
    };
    const [acceso] = accesosAPayload(estado);
    expect(acceso.pantallas).toEqual(CORE.pantallas.slice(1).map((p) => p.key));
  });

  it("solo guarda empresa en TyreControl y con rol cliente", () => {
    const estado = estadoInicialAccesos();
    estado.tyrecontrol = { ...estado.tyrecontrol, activo: true, rol: "operador", empresa_id: "e1" };
    expect(accesosAPayload(estado)[0].empresa_id).toBeNull();
    estado.tyrecontrol = { ...estado.tyrecontrol, rol: "cliente" };
    expect(accesosAPayload(estado)[0].empresa_id).toBe("e1");
  });

  it("parte de los accesos ya guardados", () => {
    const estado = estadoInicialAccesos([
      { modulo: "almacen", rol: "responsable", pantallas: ["stock"], empresa_id: null },
    ]);
    expect(estado.almacen.activo).toBe(true);
    expect(estado.almacen.rol).toBe("responsable");
    expect(accesosAPayload(estado)).toEqual([
      { modulo: "almacen", rol: "responsable", pantallas: ["stock"], empresa_id: null },
    ]);
  });
});

describe("estadoDeLicencia", () => {
  const vigente = (extra: Partial<LicenciaModulo> = {}): LicenciaModulo => ({
    modulo: "cash", estado: "activa", fecha_fin: null, vigente: true,
    max_usuarios: null, usados: 0, ...extra,
  });

  it("con licencia vigente y sin tope no dice nada y deja marcar", () => {
    expect(estadoDeLicencia("cash", [vigente()], false)).toEqual({ bloqueado: false, motivo: null, tono: "info" });
  });

  // La diferencia que evita el desastre: no es lo mismo "no tiene ninguna"
  // que "no se han podido leer".
  it("si no se han podido leer (null), no bloquea nada", () => {
    expect(estadoDeLicencia("cash", null, false)).toEqual({ bloqueado: false, motivo: null, tono: "info" });
    expect(estadoDeLicencia("loquesea", null, false).bloqueado).toBe(false);
  });

  it("sin licencia, bloquea y lo explica", () => {
    const e = estadoDeLicencia("cash", [], false);
    expect(e.bloqueado).toBe(true);
    expect(e.motivo).toMatch(/no tiene contratado/i);
  });

  it("licencia vencida, bloquea nombrando la fecha en castellano", () => {
    const e = estadoDeLicencia("cash", [vigente({ vigente: false, fecha_fin: "2026-08-27" })], false);
    expect(e.bloqueado).toBe(true);
    expect(e.motivo).toContain("27/08/2026");
  });

  it("sin plazas, bloquea y dice cuántas hay", () => {
    const e = estadoDeLicencia("cash", [vigente({ max_usuarios: 2, usados: 2 })], false);
    expect(e.bloqueado).toBe(true);
    expect(e.motivo).toMatch(/2 usuarios y ya hay 2/);
  });

  it("con plazas libres, deja marcar y enseña el aforo sin alarmar", () => {
    const e = estadoDeLicencia("cash", [vigente({ max_usuarios: 5, usados: 2 })], false);
    expect(e.bloqueado).toBe(false);
    expect(e.motivo).toBe("2 de 5 usuarios.");
    expect(e.tono).toBe("info");
  });

  it("lo que pide atención va marcado como aviso", () => {
    expect(estadoDeLicencia("cash", [vigente({ vigente: false })], false).tono).toBe("aviso");
    expect(estadoDeLicencia("cash", [vigente({ max_usuarios: 1, usados: 1 })], false).tono).toBe("aviso");
    expect(estadoDeLicencia("cash", [], true).tono).toBe("aviso");
  });

  // El caso que importa: lo ya concedido no se pierde por editar al usuario.
  it("un acceso ya guardado NUNCA se bloquea, aunque la licencia haya vencido", () => {
    for (const lic of [[], [vigente({ vigente: false, fecha_fin: "2026-01-01" })], [vigente({ max_usuarios: 1, usados: 9 })]]) {
      expect(estadoDeLicencia("cash", lic, true).bloqueado, JSON.stringify(lic)).toBe(false);
    }
  });

  it("y cuando se conserva, se dice por qué", () => {
    expect(estadoDeLicencia("cash", [], true).motivo).toMatch(/se conserva/i);
    expect(estadoDeLicencia("cash", [vigente({ vigente: false })], true).motivo).toMatch(/se conserva/i);
  });
});

describe("modulosGuardados", () => {
  it("son los módulos que ya tenía, no los del catálogo", () => {
    expect(modulosGuardados([{ modulo: "cash", rol: "usuario", pantallas: null, empresa_id: null }]))
      .toEqual(new Set(["cash"]));
    expect(modulosGuardados(undefined).size).toBe(0);
  });
});
