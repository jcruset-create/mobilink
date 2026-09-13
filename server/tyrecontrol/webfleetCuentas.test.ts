/**
 * Pruebas del reparto de empresas por cuenta de Webfleet.
 *
 * Lo que se fija es lo que decide cuántas peticiones salen y, sobre todo, que
 * dos clientes distintos no acaben leyendo la misma flota.
 */

import { describe, expect, it } from "vitest";
import { agruparPorCuenta, claveDeCuenta } from "./webfleetCuentas.ts";
import type { WebfleetCreds } from "./webfleetCredenciales.ts";

const casa: WebfleetCreds = { account: "CASA", username: "u", password: "p" };
const plana: WebfleetCreds = { account: "PLANA", username: "up", password: "pp" };

describe("claveDeCuenta()", () => {
  it("la contraseña no forma parte de la identidad de la cuenta", () => {
    // Cambiar la contraseña no convierte una cuenta en otra, y así además no
    // anda rodando por un mapa ni puede acabar en un registro por accidente.
    expect(claveDeCuenta(casa)).toBe(claveDeCuenta({ ...casa, password: "otra" }));
  });

  it("cuenta, usuario y URL sí distinguen", () => {
    expect(claveDeCuenta(casa)).not.toBe(claveDeCuenta({ ...casa, account: "OTRA" }));
    expect(claveDeCuenta(casa)).not.toBe(claveDeCuenta({ ...casa, username: "otro" }));
    expect(claveDeCuenta(casa)).not.toBe(claveDeCuenta({ ...casa, baseUrl: "https://otra" }));
  });
});

describe("agruparPorCuenta()", () => {
  it("varias empresas con las credenciales de la casa son UNA sola llamada", () => {
    const g = agruparPorCuenta([
      ["empresa-1", casa],
      ["empresa-2", casa],
      ["empresa-3", casa],
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].empresas).toEqual(["empresa-1", "empresa-2", "empresa-3"]);
  });

  it("un cliente con credenciales propias consulta SU cuenta, aparte", () => {
    const g = agruparPorCuenta([
      ["empresa-1", casa],
      ["plana", plana],
      ["empresa-2", casa],
    ]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.creds.account === "PLANA")?.empresas).toEqual(["plana"]);
    expect(g.find((x) => x.creds.account === "CASA")?.empresas).toEqual(["empresa-1", "empresa-2"]);
  });

  it("sin empresas no hay ninguna llamada", () => {
    expect(agruparPorCuenta([])).toEqual([]);
  });

  it("el primero en llegar presta sus credenciales al grupo, de forma determinista", () => {
    // Dos juegos de la misma cuenta con distinta contraseña no deberían darse;
    // si se dan, se usa el primero en vez de elegir al azar.
    const g = agruparPorCuenta([
      ["empresa-1", casa],
      ["empresa-2", { ...casa, password: "otra" }],
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].creds.password).toBe("p");
  });
});
