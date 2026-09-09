/**
 * De qué IP se fía el limitador de la miniweb.
 *
 * Sin base de datos: `ipDe` solo mira la petición. Lo que se fija es que una
 * cabecera puesta a mano por quien llama NO sirve para estrenar cupo, que es
 * exactamente lo que pasaba cogiendo la primera de `X-Forwarded-For`.
 */

import { describe, expect, it } from "vitest";
import type { Request } from "express";

import { ipDe } from "./ipCliente.ts";

const peticion = (p: { xff?: string | string[]; ip?: string }) =>
  ({ headers: { "x-forwarded-for": p.xff }, ip: p.ip } as unknown as Request);

describe("de dónde sale la IP", () => {
  it("sin cabecera, la de la conexión", () => {
    expect(ipDe(peticion({ ip: "10.0.0.7" }))).toBe("10.0.0.7");
  });

  it("con un proxy delante, la que escribió el proxy", () => {
    expect(ipDe(peticion({ xff: "88.1.2.3", ip: "10.0.0.7" }))).toBe("88.1.2.3");
  });

  it("una cabecera falsificada NO estrena cupo", () => {
    /*
     * El atacante manda «1.1.1.1» y el proxy le añade detrás su IP real. Con la
     * primera, cada petición parecía venir de un sitio distinto y el límite no
     * frenaba nada; con la última, todas caen en el mismo cubo.
     */
    const a = ipDe(peticion({ xff: "1.1.1.1, 88.1.2.3", ip: "10.0.0.7" }));
    const b = ipDe(peticion({ xff: "2.2.2.2, 88.1.2.3", ip: "10.0.0.7" }));
    expect(a).toBe("88.1.2.3");
    expect(b).toBe("88.1.2.3");
    expect(a).toBe(b);
  });

  it("aguanta varios saltos y la cabecera repetida", () => {
    expect(ipDe(peticion({ xff: "1.1.1.1, 2.2.2.2, 88.1.2.3" }))).toBe("88.1.2.3");
    expect(ipDe(peticion({ xff: ["1.1.1.1", "88.1.2.3"] }))).toBe("88.1.2.3");
  });

  it("con la cabecera vacía o con basura, no se queda en blanco", () => {
    expect(ipDe(peticion({ xff: "  ,  ", ip: "10.0.0.7" }))).toBe("10.0.0.7");
    expect(ipDe(peticion({}))).toBe("desconocida");
  });
});
