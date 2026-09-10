/**
 * Acceso por empresa en el servidor.
 *
 * Esto es lo único que separa a un cliente de los datos de otro cliente en los
 * endpoints que reciben la empresa como parámetro: allí la RLS no protege,
 * porque el servidor habla con Supabase usando service_role. Conviene que el
 * criterio esté fijado, y sobre todo que quede fijado que ante la duda se
 * responde que NO: un fallo al comprobar un permiso no puede resolverse
 * concediéndolo.
 *
 * Se simula el cliente de Supabase para no depender del proyecto real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Fila de tc_usuarios que devolverá el simulador (null = no existe). */
let usuario: any = null;
/** Filas de tc_operador_empresas: empresas asignadas al operador. */
let asignadas: string[] = [];
/** Error que debe devolver la consulta de usuarios, si la prueba lo pide. */
let errorUsuarios: any = null;

vi.mock("../supabase.ts", () => {
  function consulta(tabla: string) {
    const filtros: Record<string, any> = {};
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { filtros[col] = val; return api; },
      maybeSingle: () => {
        if (tabla === "tc_usuarios") {
          return Promise.resolve({ data: errorUsuarios ? null : usuario, error: errorUsuarios });
        }
        if (tabla === "tc_operador_empresas") {
          const hay = asignadas.includes(filtros.empresa_id);
          return Promise.resolve({ data: hay ? { empresa_id: filtros.empresa_id } : null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return api;
  }
  return { supabase: { from: consulta } };
});

const { puedeVerEmpresa, puedeVerEmpresaDeRequest } = await import("./empresaAcceso.ts");

beforeEach(() => {
  usuario = null;
  asignadas = [];
  errorUsuarios = null;
});

describe("Ante la duda, no", () => {
  it("sin sesión no se pasa", async () => {
    expect(await puedeVerEmpresa(undefined, "emp-1")).toBe(false);
    expect(await puedeVerEmpresa({}, "emp-1")).toBe(false);
  });

  it("sin empresa que comprobar tampoco", async () => {
    expect(await puedeVerEmpresa({ userId: "u1" }, "")).toBe(false);
  });

  it("un usuario que no está en tc_usuarios no pasa", async () => {
    usuario = null;
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-1")).toBe(false);
  });

  it("un usuario desactivado no pasa aunque sea de la empresa", async () => {
    usuario = { rol: "administrador", empresa_id: "emp-1", es_superadmin: false, activo: false };
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-1")).toBe(false);
  });

  it("si la consulta falla, se deniega en vez de conceder", async () => {
    errorUsuarios = { message: "conexión perdida" };
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-1")).toBe(false);
  });
});

describe("Quién sí pasa", () => {
  it("el super-admin, por el contexto y sin consultar", async () => {
    usuario = null; // ni siquiera hace falta que exista la fila
    expect(await puedeVerEmpresa({ userId: "u1", esSuperadmin: true }, "emp-9")).toBe(true);
  });

  it("el super-admin marcado en la tabla", async () => {
    usuario = { rol: "cliente", empresa_id: "emp-2", es_superadmin: true, activo: true };
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-1")).toBe(true);
  });

  it("cualquiera, con su propia empresa", async () => {
    usuario = { rol: "administrador", empresa_id: "emp-1", es_superadmin: false, activo: true };
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-1")).toBe(true);
  });

  it("el operador, con las empresas que tiene asignadas", async () => {
    usuario = { rol: "operador", empresa_id: "emp-1", es_superadmin: false, activo: true };
    asignadas = ["emp-2", "emp-3"];
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-2")).toBe(true);
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-3")).toBe(true);
  });
});

describe("Quién no pasa — el agujero que esto cierra", () => {
  it("un cliente NO llega a la empresa de otro cliente", async () => {
    usuario = { rol: "cliente", empresa_id: "emp-1", es_superadmin: false, activo: true };
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-2")).toBe(false);
  });

  it("un administrador NO llega a la empresa de otro cliente", async () => {
    usuario = { rol: "administrador", empresa_id: "emp-1", es_superadmin: false, activo: true };
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-2")).toBe(false);
  });

  it("un operador NO llega a una empresa que no tiene asignada", async () => {
    usuario = { rol: "operador", empresa_id: "emp-1", es_superadmin: false, activo: true };
    asignadas = ["emp-2"];
    expect(await puedeVerEmpresa({ userId: "u1" }, "emp-3")).toBe(false);
  });

  it("la empresa del contexto no basta: manda la de la tabla", async () => {
    // authCtx.empresaId puede ser DEFAULT_EMPRESA_ID por el puente de
    // core/auth.ts, así que no se usa para decidir.
    usuario = { rol: "cliente", empresa_id: "emp-1", es_superadmin: false, activo: true };
    expect(await puedeVerEmpresa({ userId: "u1", empresaId: "emp-7" }, "emp-7")).toBe(false);
  });
});

describe("La variante que toma el req de Express", () => {
  it("lee el authCtx de la petición", async () => {
    usuario = { rol: "administrador", empresa_id: "emp-1", es_superadmin: false, activo: true };
    expect(await puedeVerEmpresaDeRequest({ authCtx: { userId: "u1" } }, "emp-1")).toBe(true);
    expect(await puedeVerEmpresaDeRequest({ authCtx: { userId: "u1" } }, "emp-2")).toBe(false);
  });

  it("una petición sin authCtx no pasa", async () => {
    expect(await puedeVerEmpresaDeRequest({}, "emp-1")).toBe(false);
    expect(await puedeVerEmpresaDeRequest(undefined, "emp-1")).toBe(false);
  });
});
