import { describe, expect, it } from "vitest";

import { adjuntoVisible, esDeTwilio } from "./adjuntoWhatsapp.ts";

const TWILIO =
  "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM456/Media/ME789";
const COPIA =
  "https://abcdefgh.supabase.co/storage/v1/object/public/roadside/roadside/163/whatsapp_1.jpg";

describe("qué direcciones piden usuario y contraseña", () => {
  it("las de Twilio", () => {
    expect(esDeTwilio(TWILIO)).toBe(true);
    expect(esDeTwilio("http://api.twilio.com/algo")).toBe(true);
    expect(esDeTwilio("https://media.twilio.com/x")).toBe(true);
  });

  it("la copia nuestra no", () => {
    expect(esDeTwilio(COPIA)).toBe(false);
  });

  it("y no se confunde con un nombre que solo la contenga", () => {
    // El dominio es lo que manda: «notwilio.com» no es Twilio, y una ruta que
    // mencione la palabra tampoco.
    expect(esDeTwilio("https://ejemplo.com/twilio.com/foto.jpg")).toBe(false);
  });

  it("vacío o basura no es de Twilio", () => {
    expect(esDeTwilio("")).toBe(false);
    expect(esDeTwilio(null)).toBe(false);
    expect(esDeTwilio(undefined)).toBe(false);
    expect(esDeTwilio(42)).toBe(false);
  });
});

describe("qué se le enseña al navegador", () => {
  it("la copia, cuando la hay", () => {
    expect(adjuntoVisible({ media_stored_url: COPIA, media_url: TWILIO })).toEqual({
      url: COPIA,
      motivo: null,
    });
  });

  it("sin copia, NADA: nunca la de Twilio", () => {
    /*
     * Éste es el fallo que motivó el módulo. Con la de Twilio puesta en un
     * <img> o abierta en una pestaña, el navegador contesta al 401 con lo
     * único que sabe hacer: pedirle las credenciales de Twilio al operador que
     * está delante, que ni las tiene ni debe tenerlas.
     */
    const r = adjuntoVisible({ media_stored_url: null, media_url: TWILIO });
    expect(r.url).toBeNull();
    expect(r.motivo).toContain("No se guardó copia");
  });

  it("si el servidor anotó por qué, se enseña el porqué", () => {
    // «No se guardó copia» dice que falta; «Almacén (Supabase): …» dice dónde
    // hay que mirar. Es la diferencia entre un hueco y un diagnóstico.
    const r = adjuntoVisible({
      media_url: TWILIO,
      media_error: "Almacén (Supabase): The resource already exists",
    });
    expect(r.motivo).toContain("Almacén (Supabase): The resource already exists");
  });

  it("y se dice dónde sigue estando, que es lo que hace falta saber", () => {
    const r = adjuntoVisible({ media_url: TWILIO });
    expect(r.motivo).toContain("WhatsApp");
  });

  it("un mensaje sin adjunto no da ni dirección ni aviso", () => {
    expect(adjuntoVisible({})).toEqual({ url: null, motivo: null });
    expect(adjuntoVisible({ media_stored_url: "", media_url: "" })).toEqual({
      url: null,
      motivo: null,
    });
  });

  it("una copia que fuera de Twilio tampoco cuela", () => {
    // No debería pasar, pero si el día de mañana alguien guardara ahí la URL
    // original, el aviso es mejor que el cartel de credenciales.
    const r = adjuntoVisible({ media_stored_url: TWILIO, media_url: TWILIO });
    expect(r.url).toBeNull();
  });

  it("un original que NO es de Twilio sí se puede abrir", () => {
    // Hay mensajes antiguos con la URL ya apuntando a nuestro almacenamiento.
    const r = adjuntoVisible({ media_stored_url: null, media_url: COPIA });
    expect(r.url).toBe(COPIA);
    expect(r.motivo).toBeNull();
  });
});
