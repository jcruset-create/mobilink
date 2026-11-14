/**
 * Qué empresa lee «Vehículos en bases».
 *
 * Lo que se fija aquí es que la tablet pueda pedir el cliente en el que está
 * trabajando el técnico —que no es el de su perfil— y que no pueda pedir uno
 * que no le toca. Las dos mitades importan: sin la primera la pantalla sale
 * vacía para todos los técnicos de esta instalación, y sin la segunda
 * cualquiera leería la flota de cualquiera cambiando un parámetro de la URL.
 */

import { describe, expect, it, vi } from "vitest";

import { empresaParaLeer } from "./empresaPedida.ts";
import type { Solicitante } from "../conciliacion/router.ts";

const TECNICO: Solicitante = {
  usuarioId: "u-tecnico",
  // Su perfil apunta a la empresa de servicio, que no tiene flota. Es el caso
  // real de los tres técnicos con acceso a la tablet.
  empresaPropia: "emp-servicio",
  esSuperadmin: false,
  esAdmin: false,
};

const ADMIN_CLIENTE: Solicitante = {
  usuarioId: "u-admin",
  empresaPropia: "emp-cliente",
  esSuperadmin: false,
  esAdmin: true,
};

const SUPERADMIN: Solicitante = {
  usuarioId: "u-super",
  empresaPropia: "emp-servicio",
  esSuperadmin: true,
  esAdmin: true,
};

/** Comprobador falso: concede solo las empresas de la lista. */
const concede = (...empresas: string[]) =>
  vi.fn(async (_s: Solicitante, e: string) => empresas.includes(e));

describe("sin pedir empresa, todo sigue como estaba", () => {
  it("se usa la del perfil", async () => {
    const comprobar = concede();
    expect(await empresaParaLeer(ADMIN_CLIENTE, undefined, comprobar)).toEqual({
      empresaId: "emp-cliente",
    });
    // No se consulta la base para algo que ya se sabe.
    expect(comprobar).not.toHaveBeenCalled();
  });

  it("una cadena vacía o con espacios es no pedir ninguna", async () => {
    expect(await empresaParaLeer(ADMIN_CLIENTE, "", concede())).toEqual({
      empresaId: "emp-cliente",
    });
    expect(await empresaParaLeer(ADMIN_CLIENTE, "   ", concede())).toEqual({
      empresaId: "emp-cliente",
    });
  });

  it("un parámetro repetido en la URL llega como array y no cuela como empresa", async () => {
    expect(await empresaParaLeer(ADMIN_CLIENTE, ["emp-otra", "emp-otra"], concede())).toEqual({
      empresaId: "emp-cliente",
    });
  });

  it("sin empresa en el perfil y sin pedir ninguna, no hay nada que leer", async () => {
    const huerfano: Solicitante = { ...TECNICO, empresaPropia: "" };
    expect(await empresaParaLeer(huerfano, undefined, concede())).toEqual({ sinEmpresa: true });
  });
});

describe("el técnico multi-cliente, que es para lo que se hizo esto", () => {
  it("pide una empresa asignada y la obtiene, aunque no sea la de su perfil", async () => {
    const comprobar = concede("emp-plana");
    expect(await empresaParaLeer(TECNICO, "emp-plana", comprobar)).toEqual({
      empresaId: "emp-plana",
    });
    expect(comprobar).toHaveBeenCalledWith(TECNICO, "emp-plana");
  });

  it("pide una que no tiene asignada y se le dice que no", async () => {
    expect(await empresaParaLeer(TECNICO, "emp-ajena", concede("emp-plana"))).toEqual({
      prohibida: true,
    });
  });

  it("pedir la suya no hace falta comprobarla", async () => {
    const comprobar = concede();
    expect(await empresaParaLeer(TECNICO, "emp-servicio", comprobar)).toEqual({
      empresaId: "emp-servicio",
    });
    expect(comprobar).not.toHaveBeenCalled();
  });

  it("si la comprobación falla, no se concede", async () => {
    // `puedeVerEmpresa` ya devuelve false ante un error de consulta; esto fija
    // que aquí no se reinterprete como «adelante».
    const comprobar = vi.fn(async () => false);
    expect(await empresaParaLeer(TECNICO, "emp-plana", comprobar)).toEqual({ prohibida: true });
  });
});

describe("el super-admin", () => {
  it("puede nombrar cualquier empresa sin preguntar a la base", async () => {
    const comprobar = concede();
    expect(await empresaParaLeer(SUPERADMIN, "emp-la-que-sea", comprobar)).toEqual({
      empresaId: "emp-la-que-sea",
    });
    expect(comprobar).not.toHaveBeenCalled();
  });
});
