import { describe, expect, it } from "vitest";

import {
  MARGEN_EN_CAMINO_MS,
  entregaDeTwilio,
  entregaEnLista,
  esFinal,
  motivoDeEntrega,
  tocaPreguntar,
} from "./entregaSmsEstado.ts";

describe("lo que dice Twilio → lo que se guarda", () => {
  it("entregado, no entregado y en camino", () => {
    expect(entregaDeTwilio("delivered")).toBe("entregado");
    expect(entregaDeTwilio("undelivered")).toBe("no_entregado");
    expect(entregaDeTwilio("failed")).toBe("no_entregado");
    for (const s of ["accepted", "queued", "sending", "sent"]) expect(entregaDeTwilio(s)).toBe("en_camino");
  });

  it("que Twilio lo haya ENVIADO no es que haya llegado", () => {
    expect(entregaDeTwilio("sent")).not.toBe("entregado");
  });

  it("un estado desconocido no se convierte en una entrega inventada", () => {
    expect(entregaDeTwilio("partially_delivered")).toBeNull();
    expect(entregaDeTwilio("")).toBeNull();
    expect(entregaDeTwilio(null)).toBeNull();
  });

  it("da igual cómo venga escrito", () => {
    expect(entregaDeTwilio(" Delivered ")).toBe("entregado");
  });
});

describe("por qué no llegó", () => {
  it("los códigos conocidos salen en castellano, con el código al lado", () => {
    expect(motivoDeEntrega(30003, "Unreachable destination handset")).toBe(
      "El móvil está apagado o sin cobertura. (código 30003 de Twilio)"
    );
    expect(motivoDeEntrega(30007)).toContain("filtrado");
  });

  it("un código que no se conoce enseña lo que diga Twilio, sin inventar", () => {
    expect(motivoDeEntrega(39999, "Something new")).toBe("Something new (código 39999 de Twilio)");
    expect(motivoDeEntrega(39999, null)).toBe("Código 39999 de Twilio.");
  });

  it("sin código ni texto no hay nada que decir", () => {
    expect(motivoDeEntrega(null, null)).toBeNull();
    expect(motivoDeEntrega(null, "  ")).toBeNull();
  });
});

describe("cuándo se le pregunta a Twilio", () => {
  const ahoraMs = 1_800_000_000_000;
  const hace = (ms: number) => ahoraMs - ms;

  it("por lo que ya tiene respuesta definitiva, nunca más", () => {
    expect(esFinal("entregado")).toBe(true);
    expect(esFinal("no_entregado")).toBe(true);
    expect(esFinal("en_camino")).toBe(false);
    expect(esFinal(null)).toBe(false);
    for (const entrega of ["entregado", "no_entregado"]) {
      expect(tocaPreguntar({ entrega, enviadoAtMs: hace(60_000), preguntadoAtMs: hace(3_600_000), ahoraMs })).toBe(false);
    }
  });

  it("por uno al que nunca se le ha preguntado, ya", () => {
    expect(tocaPreguntar({ entrega: null, enviadoAtMs: hace(1_000), preguntadoAtMs: null, ahoraMs })).toBe(true);
  });

  it("recién enviado, cada medio minuto y no más", () => {
    const base = { entrega: "en_camino", enviadoAtMs: hace(2 * 60_000), ahoraMs };
    expect(tocaPreguntar({ ...base, preguntadoAtMs: hace(10_000) })).toBe(false);
    expect(tocaPreguntar({ ...base, preguntadoAtMs: hace(31_000) })).toBe(true);
  });

  it("si ya lleva un rato atascado, cada diez minutos", () => {
    const base = { entrega: "en_camino", enviadoAtMs: hace(3 * 3_600_000), ahoraMs };
    expect(tocaPreguntar({ ...base, preguntadoAtMs: hace(5 * 60_000) })).toBe(false);
    expect(tocaPreguntar({ ...base, preguntadoAtMs: hace(11 * 60_000) })).toBe(true);
  });
});

describe("lo que se pinta en la lista", () => {
  const ahoraMs = 1_800_000_000_000;

  it("lo definitivo se pinta tal cual, lleve el tiempo que lleve", () => {
    expect(entregaEnLista("entregado", ahoraMs - 86_400_000, ahoraMs)).toBe("entregado");
    expect(entregaEnLista("no_entregado", ahoraMs - 1_000, ahoraMs)).toBe("no_entregado");
  });

  it("sin respuesta todavía es «en camino»… durante un rato", () => {
    expect(entregaEnLista(null, ahoraMs - 20_000, ahoraMs)).toBe("en_camino");
    expect(entregaEnLista("en_camino", ahoraMs - MARGEN_EN_CAMINO_MS + 1_000, ahoraMs)).toBe("en_camino");
  });

  it("un «en camino» de hace más de un cuarto de hora ya no se llama así", () => {
    expect(entregaEnLista("en_camino", ahoraMs - MARGEN_EN_CAMINO_MS, ahoraMs)).toBe("sin_confirmar");
    expect(entregaEnLista(null, ahoraMs - 2 * 3_600_000, ahoraMs)).toBe("sin_confirmar");
  });
});
