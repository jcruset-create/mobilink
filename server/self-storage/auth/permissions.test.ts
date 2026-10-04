import { describe, expect, it } from "vitest";
import { PERMISOS, permisosDeRol, rolDeSelfStorage } from "./permissions.ts";

const db = (rol: string | null) => ({ query: async () => ({ rows: rol ? [{ rol }] : [] }) });

describe("permisos de Self Storage", () => {
  it("mantenimiento no ve clientes; empleado sí, pero no gestiona trasteros ni importa", () => {
    expect(permisosDeRol("maintenance")).not.toContain("ss.customers.view");
    expect(permisosDeRol("maintenance")).toContain("ss.units.status");
    expect(permisosDeRol("employee")).toContain("ss.customers.manage");
    expect(permisosDeRol("employee")).not.toContain("ss.units.manage");
    expect(permisosDeRol("employee")).not.toContain("ss.import");
  });

  it("call_center: atiende llamadas e incidencias con mínimo privilegio", () => {
    const p = permisosDeRol("call_center");
    expect(p).toEqual(expect.arrayContaining(["ss.callcenter.view", "ss.callcenter.create", "ss.callcenter.edit", "ss.callcenter.escalate", "ss.incidents.view", "ss.incidents.create"]));
    for (const no of ["ss.view", "ss.customers.view", "ss.contracts.view", "ss.contracts.manage", "ss.billing.view", "ss.billing.manage", "ss.settings.manage", "ss.callcenter.configure", "ss.incidents.manage", "ss.audit.view"]) {
      expect(p).not.toContain(no);
    }
    expect(permisosDeRol("employee")).toEqual(expect.arrayContaining(["ss.callcenter.create", "ss.incidents.manage"]));
    expect(permisosDeRol("employee")).not.toContain("ss.callcenter.configure");
  });

  it("admin y superadmin lo tienen todo; un rol desconocido, nada", () => {
    expect(permisosDeRol("admin")).toEqual(PERMISOS);
    expect(permisosDeRol("superadmin")).toEqual(PERMISOS);
    expect(permisosDeRol("gestor")).toEqual([]);
    expect(permisosDeRol(null)).toEqual([]);
  });

  it("el superadmin sale de app_usuarios, no de una fila con «superadmin» escrito a mano", async () => {
    expect(await rolDeSelfStorage(db(null), "u", true)).toBe("superadmin");
    expect(await rolDeSelfStorage(db("superadmin"), "u", false)).toBeNull();
    expect(await rolDeSelfStorage(db("employee"), "u", false)).toBe("employee");
    expect(await rolDeSelfStorage(db("call_center"), "u", false)).toBe("call_center");
    expect(await rolDeSelfStorage(db(null), "u", false)).toBeNull();
  });
});
