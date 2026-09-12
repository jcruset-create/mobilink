/**
 * Las cabeceras con las que el conector se presenta ante Movertis.
 *
 * Parece poca cosa para un fichero de pruebas, y es justo lo contrario: un
 * prefijo «Bearer» de más devuelve 401 con la credencial CORRECTA, y entonces
 * todo el mundo mira el secreto, el gestor de secretos y la variable de Render
 * antes de sospechar de una palabra en la cabecera. Esto lo fija para que no
 * vuelva a pasar.
 */

import { describe, expect, it } from "vitest";
import { MovertisConnector, mensajeDeError, motivoDeRed } from "./MovertisConnector.ts";
import { getSecretsProvider, setSecretsProvider } from "../../../infrastructure/secrets.ts";

describe("cabeceras de autenticación", () => {
  it("manda el token EN CRUDO, sin «Bearer», que es lo que pide Movertis", () => {
    const h = new MovertisConnector({}).cabecerasDe({ token: "abc123" });
    expect(h.authorization).toBe("abc123");
    expect(h.authorization).not.toContain("Bearer");
  });

  it("con esquemaToken 'bearer' vuelve al prefijo, sin tocar código", () => {
    const h = new MovertisConnector({ esquemaToken: "bearer" }).cabecerasDe({ token: "abc123" });
    expect(h.authorization).toBe("Bearer abc123");
  });

  it("sin token, usuario y contraseña van en Basic", () => {
    const h = new MovertisConnector({}).cabecerasDe({ username: "u", password: "p" });
    expect(h.authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });

  it("el token manda sobre el usuario: no se mezclan dos autenticaciones", () => {
    const h = new MovertisConnector({}).cabecerasDe({ token: "t", username: "u", password: "p" });
    expect(h.authorization).toBe("t");
  });

  it("la API key se acumula: hay instalaciones que piden las dos cosas", () => {
    const h = new MovertisConnector({}).cabecerasDe({ token: "t", apiKey: "k" });
    expect(h.authorization).toBe("t");
    expect(h["X-Api-Key"]).toBe("k");
  });

  it("sin credenciales no inventa ninguna cabecera de autenticación", () => {
    const h = new MovertisConnector({}).cabecerasDe({});
    expect(h.authorization).toBeUndefined();
    expect(h["X-Api-Key"]).toBeUndefined();
    expect(h.Accept).toBe("application/json");
  });
});

/**
 * Movertis falla de dos maneras que no se parecen a un fallo, y las dos las
 * tiene que atrapar `mensajeDeError`. Los cuerpos de aquí son literales,
 * copiados de respuestas reales de `devapi.hellomovertis.com`.
 */
describe("mensajeDeError()", () => {
  it("atrapa el HTTP 201 que en realidad es un 500", () => {
    // Esto es lo que devuelve una bandera que no existe: estado 201 en la
    // respuesta HTTP y el error metido en el cuerpo. Si no se mira, entra en el
    // sistema como datos y sale como una flota vacía.
    expect(
      mensajeDeError({
        response: "position - Flag incorrecta",
        status: 500,
        message: "position - Flag incorrecta",
        name: "HttpException",
      }),
    ).toBe("position - Flag incorrecta");
  });

  it("atrapa el 500 con el error de validación", () => {
    expect(
      mensajeDeError({
        statusCode: 500,
        timestamp: "2026-09-12T08:38:34.814Z",
        path: "/vehicle/showvehicles",
        error: "El flag basicData es obligatorio",
      }),
    ).toBe("El flag basicData es obligatorio");
  });

  it("atrapa el error de JavaScript en crudo de un campo que falta", () => {
    expect(
      mensajeDeError({
        statusCode: 500,
        path: "/vehicle/showvehicles",
        error: "Cannot read properties of undefined (reading 'length')",
      }),
    ).toMatch(/Cannot read properties/);
  });

  it("no confunde una respuesta buena con un error", () => {
    // La flota llega como lista, y un vehículo suelto como objeto sin estado.
    expect(mensajeDeError([{ name: "604 - 1678 GCM", idVehicle: 26134116 }])).toBeNull();
    expect(mensajeDeError({ name: "604 - 1678 GCM", idVehicle: 26134116 })).toBeNull();
    expect(mensajeDeError(null)).toBeNull();
  });
});

/**
 * El token que pide cada cuenta.
 *
 * Un cliente puede tener dos cuentas de Movertis con tokens distintos. Antes de
 * que el gestor de secretos distinguiera cuentas, las dos leían la misma
 * variable: la segunda daba 401 con la credencial correcta o, si el token valía
 * para ambas, devolvía la flota de la primera sin dar ningún error. Esto fija
 * que la cuenta llega hasta la resolución del secreto.
 */
describe("credenciales por cuenta", () => {
  it("pide el secreto de SU cuenta, no el del cliente a secas", async () => {
    const pedidos: Array<[string, string, string, string | undefined]> = [];
    const anterior = getSecretsProvider();
    try {
      setSecretsProvider({
        get: async (tenant, conector, nombre, cuenta) => {
          pedidos.push([tenant, conector, nombre, cuenta]);
          return nombre === "token" && cuenta === "auxiliar" ? "token-auxiliar" : undefined;
        },
      });

      const conector = new MovertisConnector({ baseUrl: "https://api.invalid", accountKey: "auxiliar" });
      const r = await conector.testConnection({ tenantId: "empresa-plana", correlationId: "COR-1" });

      // Todas las lecturas llevan la cuenta.
      expect(pedidos.length).toBeGreaterThan(0);
      expect(pedidos.every(([, , , cuenta]) => cuenta === "auxiliar")).toBe(true);
      // Y con credencial encontrada NO se queda en «sin credenciales».
      expect(r.message).not.toContain("sin credenciales");
    } finally {
      setSecretsProvider(anterior);
    }
  });

  it("sin cuenta declarada no inventa ninguna", async () => {
    const cuentas: Array<string | undefined> = [];
    const anterior = getSecretsProvider();
    try {
      setSecretsProvider({
        get: async (_t, _c, _n, cuenta) => {
          cuentas.push(cuenta);
          return undefined;
        },
      });
      await new MovertisConnector({ baseUrl: "https://api.invalid" }).testConnection({
        tenantId: "empresa-plana",
        correlationId: "COR-1",
      });
      expect(cuentas.every((c) => c === undefined)).toBe(true);
    } finally {
      setSecretsProvider(anterior);
    }
  });
});

/**
 * Por qué no se pudo ni hablar con Movertis.
 *
 * «fetch failed» a secas costó una tarde de diagnóstico: no distingue una URL
 * mal escrita de un certificado roto de una salida de red cerrada, y las tres
 * se arreglan en sitios distintos. Esto fija que el motivo real —que Node
 * esconde en `cause`— llega hasta el mensaje, y que la URL va con él.
 */
describe("motivoDeRed()", () => {
  const url = "https://api.hellomovertis.com/vehicle/showvehicles";
  const conCausa = (code: string) =>
    Object.assign(new Error("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

  it("desenvuelve el DNS que no resuelve, que es el fallo más probable de una URL mal puesta", () => {
    const m = motivoDeRed(conCausa("ENOTFOUND"), url);
    expect(m).toContain("DNS");
    expect(m).toContain("ENOTFOUND");
    expect(m).not.toBe("fetch failed");
  });

  it("distingue un certificado caducado de todo lo demás", () => {
    expect(motivoDeRed(conCausa("CERT_HAS_EXPIRED"), url)).toContain("caducado");
  });

  it("dice cuándo el servidor rechaza la conexión", () => {
    expect(motivoDeRed(conCausa("ECONNREFUSED"), url)).toContain("rechaza la conexión");
  });

  it("siempre incluye la URL: con dos entornos, saber cuál se intentó es media respuesta", () => {
    expect(motivoDeRed(conCausa("ENOTFOUND"), url)).toContain(url);
    expect(motivoDeRed(new Error("lo que sea"), url)).toContain(url);
  });

  it("el timeout se dice como timeout, no como un código de red", () => {
    const m = motivoDeRed(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }), url);
    expect(m).toContain("no contestó a tiempo");
  });

  it("un código desconocido no se traga el mensaje: se enseña tal cual", () => {
    expect(motivoDeRed(conCausa("ERARO_1234"), url)).toContain("ERARO_1234");
  });
});
