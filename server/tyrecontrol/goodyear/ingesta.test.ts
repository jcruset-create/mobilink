/**
 * Las dos reglas del buzón de las que depende que un aviso se pierda o no.
 *
 * El resto de la ingesta habla con la base y no se puede probar sin ella, pero
 * estas dos caben en cuatro líneas y son justo las que, mal escritas, hacen
 * desaparecer un aviso de presión sin que nada falle a la vista. Es lo que
 * pasaba ANTES de esta fase: un correo sin adjunto se marcaba como leído y no
 * dejaba rastro, así que los avisos de Goodyear que cayeran en este buzón se
 * perdían uno a uno.
 */

import { describe, expect, it } from "vitest";

import { clasificar, seMarcaLeido } from "./ingesta.ts";

describe("cómo cuenta cada correo en la pasada", () => {
  it("una alerta nueva es una alerta", () => {
    expect(clasificar({ estado: "alerta", alertaId: "a1", nueva: true })).toBe("alerta");
  });

  it("una alerta que ya estaba abierta cuenta como repetida", () => {
    // Es un aviso más de una rueda que ya avisaba. Contarla como nueva diría
    // que hay más ruedas en problemas de las que hay.
    expect(clasificar({ estado: "alerta", alertaId: "a1", nueva: false })).toBe("repetido");
  });

  it("lo que no es un aviso se ignora", () => {
    expect(clasificar({ estado: "no_es_alerta" })).toBe("ignorado");
  });

  it("lo que no se pudo casar se cuenta aparte, no como error", () => {
    // Son dos cosas distintas: «lo entendí y no supe colocarlo» frente a «no
    // he podido mirarlo». La primera no se arregla reintentando.
    expect(clasificar({ estado: "no_casado", motivo: "La matrícula no está" })).toBe("no_casado");
  });

  it("un repetido por message_id sigue siendo repetido", () => {
    expect(clasificar({ estado: "repetido" })).toBe("repetido");
  });

  it("un fallo es un error", () => {
    expect(clasificar({ estado: "error", motivo: "la base no contesta" })).toBe("error");
  });
});

describe("qué se marca como leído", () => {
  it("un error NO se marca: se reintenta en la pasada siguiente", () => {
    // Marcarlo sería descartar un aviso de presión por un hipo de red.
    expect(seMarcaLeido("error")).toBe(false);
  });

  it("todo lo demás sí", () => {
    expect(seMarcaLeido("alerta")).toBe(true);
    expect(seMarcaLeido("repetido")).toBe(true);
    expect(seMarcaLeido("ignorado")).toBe(true);
    expect(seMarcaLeido("importado")).toBe(true);
  });

  it("el no_casado también se marca, y no se pierde", () => {
    // Volver a pasarlo daría exactamente lo mismo. Queda en
    // `tc_goodyear_avisos` con su motivo y con lo que se entendió, que es lo
    // que permite arreglar el casado y repasarlo sin reenviar 378 correos.
    expect(seMarcaLeido("no_casado")).toBe(true);
  });
});
