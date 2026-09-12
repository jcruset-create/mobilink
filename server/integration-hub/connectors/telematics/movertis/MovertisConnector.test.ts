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
import { MovertisConnector } from "./MovertisConnector.ts";

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
