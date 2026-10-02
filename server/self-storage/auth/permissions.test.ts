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
    expect(await rolDeSelfStorage(db(null), "u", false)).toBeNull();
  });
});
