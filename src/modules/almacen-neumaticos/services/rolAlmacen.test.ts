import { describe, expect, it } from "vitest";
import { resolverRolAlmacen } from "./rolAlmacen";

describe("resolverRolAlmacen", () => {
  it("Core manda sobre el rol heredado", () => {
    // Es el objetivo del paso 1: cambiar el rol en Administración → Usuarios
    // tiene efecto aunque perfiles_usuario siga diciendo otra cosa.
    expect(resolverRolAlmacen("operario", "admin", false)).toEqual({
      rol: "operario",
      origen: "core",
    });
  });

  it("sin fila en Core se usa el rol heredado", () => {
    // Mientras queden usuarios sin migrar no se les puede dejar fuera.
    expect(resolverRolAlmacen(null, "responsable", false)).toEqual({
      rol: "responsable",
      origen: "legacy",
    });
  });

  it("el superadmin entra como admin sin ficha en ningún sitio", () => {
    expect(resolverRolAlmacen(null, null, true)).toEqual({
      rol: "admin",
      origen: "superadmin",
    });
    // Y no se le degrada por lo que diga cualquiera de las dos tablas.
    expect(resolverRolAlmacen("operario", "operario", true)).toEqual({
      rol: "admin",
      origen: "superadmin",
    });
  });

  it("sin rol en ninguna parte no hay acceso", () => {
    expect(resolverRolAlmacen(null, null, false)).toEqual({
      rol: null,
      origen: "ninguno",
    });
  });

  it("un rol desconocido no se cuela", () => {
    // Un valor raro en la base no puede convertirse en permiso.
    expect(resolverRolAlmacen("jefe", null, false)).toEqual({
      rol: null,
      origen: "ninguno",
    });
    // Y si Core trae basura, se cae al heredado en vez de dejar sin acceso.
    expect(resolverRolAlmacen("jefe", "operario", false)).toEqual({
      rol: "operario",
      origen: "legacy",
    });
  });

  it("tolera mayúsculas y espacios", () => {
    expect(resolverRolAlmacen("  Admin  ", null, false)).toMatchObject({ rol: "admin" });
  });

  it("una cadena vacía no cuenta como rol", () => {
    expect(resolverRolAlmacen("", "operario", false)).toMatchObject({
      rol: "operario",
      origen: "legacy",
    });
  });
});
