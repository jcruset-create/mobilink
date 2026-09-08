/**
 * Quién puede hacer qué. Sin base de datos: es una tabla.
 *
 * Estas comprobaciones existen porque un permiso se mueve de rol en una línea
 * y nadie lo nota al revisar un diff largo. Lo que se fija aquí no es el mapa
 * entero —cambiará— sino las fronteras que alguien tomó a propósito y que
 * volver a cruzar tiene consecuencias.
 */

import { beforeAll, describe, expect, it } from "vitest";

/*
 * `permissions.ts` arrastra `db.ts`, que exige `DATABASE_URL` nada más
 * importarse. Aquí no se consulta nada —esto es una tabla, no una prueba de
 * integración— así que basta con dar una cadena cualquiera antes de importar:
 * el pool de `pg` no abre conexión hasta la primera consulta, y no la hay.
 */
process.env.DATABASE_URL ??= "postgresql://sin-usar/sin-usar";

let PERMISOS: typeof import("./permissions.ts").PERMISOS;
let permisosDeRol: typeof import("./permissions.ts").permisosDeRol;

beforeAll(async () => {
  ({ PERMISOS, permisosDeRol } = await import("./permissions.ts"));
});

describe("reabrir una jornada es de administrador", () => {
  it("un responsable NO puede reabrir", () => {
    /*
     * Reabrir es la única acción que puede cambiar un cierre YA FIRMADO, y con
     * él el importe que va al banco y lo que se le contó a la gestoría. Un
     * responsable corrige dentro de su jornada; deshacer una cerrada sube un
     * escalón.
     */
    expect(permisosDeRol("responsable")).not.toContain("cash.session.reopen");
  });

  it("pero sí cerrarla, que es su trabajo", () => {
    expect(permisosDeRol("responsable")).toContain("cash.close_session");
  });

  it("un administrador sí puede", () => {
    expect(permisosDeRol("admin")).toContain("cash.session.reopen");
  });

  it("ni el cajero ni la consulta, por supuesto", () => {
    expect(permisosDeRol("cajero")).not.toContain("cash.session.reopen");
    expect(permisosDeRol("consulta")).not.toContain("cash.session.reopen");
  });
});

describe("las otras fronteras que no deben bajar de nivel", () => {
  it("autorizar un cobro duplicado no es de cajero", () => {
    // Es dinero: cobrar dos veces la misma factura.
    expect(permisosDeRol("cajero")).not.toContain("cash.duplicate_payment.override");
    expect(permisosDeRol("responsable")).toContain("cash.duplicate_payment.override");
  });

  it("dar de alta un escáner tampoco", () => {
    // Un dispositivo es una llave permanente que mete documentos en el módulo.
    expect(permisosDeRol("cajero")).not.toContain("cash.autoscan.manage");
  });

  it("anular una operación no es de cajero", () => {
    expect(permisosDeRol("cajero")).not.toContain("cash.operation.reverse");
  });

  it("consulta solo mira", () => {
    const soloLectura = permisosDeRol("consulta");
    expect(soloLectura.every((p) => p.endsWith(".view"))).toBe(true);
  });
});

describe("el mapa no se rompe", () => {
  it("un rol desconocido no da permisos", () => {
    /*
     * Importa de verdad: un rol mal escrito en la base no puede acabar
     * dándolo todo por defecto.
     */
    expect(permisosDeRol("lo-que-sea")).toHaveLength(0);
    expect(permisosDeRol(null)).toHaveLength(0);
    expect(permisosDeRol(undefined)).toHaveLength(0);
  });

  it("el administrador los tiene todos", () => {
    expect(permisosDeRol("admin")).toHaveLength(PERMISOS.length);
  });
});
