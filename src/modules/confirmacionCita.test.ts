import { describe, expect, it } from "vitest";

import {
  cambiosPorRespuesta,
  campoDeFechaDeEstado,
  debePedirConfirmacion,
  eligeCitaParaRespuesta,
  estadoConfirmacion,
  estadoEnvioAdelanta,
  estadoEnvioDeTwilio,
  intencionDeRespuesta,
  respuestaYaAplicada,
  rotuloConfirmacion,
  rotuloEnvio,
  type CitaCandidata,
} from "./confirmacionCita";

const AHORA = new Date("2026-09-26T10:45:00").getTime();

function cita(extra: Partial<CitaCandidata> & Record<string, unknown> = {}) {
  return {
    id: 1,
    date: "2026-09-27",
    startTime: "09:00",
    customerPhone: "610473077",
    status: "programado",
    sendReminder24h: true,
    ...extra,
  };
}

describe("intencionDeRespuesta", () => {
  it("lee el identificador del botón, que es lo inequívoco", () => {
    expect(intencionDeRespuesta({ buttonPayload: "CONFIRMAR_CITA" })).toBe("confirmar");
    expect(intencionDeRespuesta({ buttonPayload: "CAMBIAR_CITA" })).toBe("cambiar");
  });

  it("acepta el texto del botón cuando no llega el identificador", () => {
    expect(intencionDeRespuesta({ buttonText: "✅ Confirmar" })).toBe("confirmar");
    expect(intencionDeRespuesta({ buttonText: "🔄 Cambiar cita" })).toBe("cambiar");
  });

  /*
   * Quien escribe a mano escribe cualquier cosa. «Confirmo pero llego tarde»
   * NO es un sí que se pueda dar por bueno sin que lo lea una persona: la cita
   * se quedaría confirmada y el taller no sabría lo de la tardanza.
   */
  it("no interpreta el texto libre", () => {
    expect(intencionDeRespuesta({ body: "confirmo pero llego tarde" })).toBeNull();
    expect(intencionDeRespuesta({ body: "sí" })).toBeNull();
    expect(intencionDeRespuesta({ body: "vale" })).toBeNull();
    expect(intencionDeRespuesta({ body: "no puedo, cambiar la cita" })).toBeNull();
  });

  it("devuelve null con un mensaje cualquiera", () => {
    expect(intencionDeRespuesta({ body: "buenos días" })).toBeNull();
    expect(intencionDeRespuesta({})).toBeNull();
  });
});

describe("estadoEnvioDeTwilio", () => {
  it("traduce lo que manda Twilio", () => {
    expect(estadoEnvioDeTwilio("queued")).toBe("sent");
    expect(estadoEnvioDeTwilio("sent")).toBe("sent");
    expect(estadoEnvioDeTwilio("delivered")).toBe("delivered");
    expect(estadoEnvioDeTwilio("read")).toBe("read");
    expect(estadoEnvioDeTwilio("failed")).toBe("failed");
    expect(estadoEnvioDeTwilio("undelivered")).toBe("failed");
  });

  it("ignora lo que no conoce", () => {
    expect(estadoEnvioDeTwilio("inventado")).toBeNull();
    expect(estadoEnvioDeTwilio(null)).toBeNull();
  });
});

describe("estadoEnvioAdelanta", () => {
  it("avanza hacia adelante", () => {
    expect(estadoEnvioAdelanta("sent", "delivered")).toBe(true);
    expect(estadoEnvioAdelanta("delivered", "read")).toBe(true);
    expect(estadoEnvioAdelanta(null, "sent")).toBe(true);
  });

  /*
   * Los callbacks no llegan en orden. Un `delivered` retrasado que pisara un
   * `read` haría que la ficha dijera que el cliente no ha abierto un mensaje
   * que abrió.
   */
  it("no retrocede", () => {
    expect(estadoEnvioAdelanta("read", "delivered")).toBe(false);
    expect(estadoEnvioAdelanta("delivered", "sent")).toBe(false);
    expect(estadoEnvioAdelanta("read", "read")).toBe(false);
  });

  it("fallido siempre gana, y después ya no se mueve", () => {
    expect(estadoEnvioAdelanta("read", "failed")).toBe(true);
    expect(estadoEnvioAdelanta("failed", "read")).toBe(false);
  });
});

describe("campoDeFechaDeEstado", () => {
  it("cada estado a su campo", () => {
    expect(campoDeFechaDeEstado("delivered")).toBe("confirmationWhatsappDeliveredAtMs");
    expect(campoDeFechaDeEstado("read")).toBe("confirmationWhatsappReadAtMs");
    expect(campoDeFechaDeEstado("failed")).toBe("confirmationWhatsappFailedAtMs");
  });

  it("«enviado» no tiene campo propio: su hora se escribe al mandarlo", () => {
    expect(campoDeFechaDeEstado("sent")).toBeNull();
  });
});

describe("estadoConfirmacion", () => {
  it("una cita vieja, sin el campo, está pendiente", () => {
    expect(estadoConfirmacion({})).toBe("pending");
    expect(estadoConfirmacion({ confirmationStatus: null })).toBe("pending");
  });

  it("lee los estados buenos y descarta la basura", () => {
    expect(estadoConfirmacion({ confirmationStatus: "confirmed" })).toBe("confirmed");
    expect(estadoConfirmacion({ confirmationStatus: "reschedule" })).toBe("reschedule");
    expect(estadoConfirmacion({ confirmationStatus: "lo-que-sea" })).toBe("pending");
  });
});

describe("debePedirConfirmacion", () => {
  const dentro = { dentroDeLaVentana: true };

  it("sí a una cita viva, con teléfono y sin pedir", () => {
    expect(debePedirConfirmacion(cita(), dentro)).toBe(true);
  });

  it("no fuera de la ventana", () => {
    expect(debePedirConfirmacion(cita(), { dentroDeLaVentana: false })).toBe(false);
  });

  it("no a una cita cancelada, eliminada o cerrada", () => {
    for (const status of ["cancelado", "eliminado", "cerrado"]) {
      expect(debePedirConfirmacion(cita({ status }), dentro)).toBe(false);
    }
  });

  it("no sin teléfono", () => {
    expect(debePedirConfirmacion(cita({ customerPhone: "" }), dentro)).toBe(false);
    expect(debePedirConfirmacion(cita({ customerPhone: "   " }), dentro)).toBe(false);
  });

  it("no si el recordatorio está apagado", () => {
    expect(debePedirConfirmacion(cita({ sendReminder24h: false }), dentro)).toBe(false);
  });

  /*
   * EL TEST QUE IMPIDE EL DESASTRE.
   *
   * En producción hay doscientas y pico citas con `whatsappReminder24hSentAtMs`
   * ya escrito. Si ese campo dejara de ser el guardia, todas las citas de
   * mañana recibirían la confirmación de golpe al desplegar. Un reenvío masivo
   * a clientes reales no se arregla pidiendo perdón.
   */
  it("NO reenvía a una cita que ya tenía el recordatorio marcado", () => {
    expect(
      debePedirConfirmacion(cita({ whatsappReminder24hSentAtMs: 1759000000000 }), dentro)
    ).toBe(false);
  });

  it("no vuelve a preguntar a quien ya contestó", () => {
    for (const confirmationStatus of ["confirmed", "reschedule", "awaiting_confirmation"]) {
      expect(debePedirConfirmacion(cita({ confirmationStatus }), dentro)).toBe(false);
    }
  });
});

describe("eligeCitaParaRespuesta", () => {
  const esperando = (extra: Partial<CitaCandidata> = {}): CitaCandidata => ({
    id: 1,
    status: "programado",
    confirmationStatus: "awaiting_confirmation",
    ...extra,
  });

  it("gana el mensaje al que contesta, aunque haya más citas", () => {
    const r = eligeCitaParaRespuesta(
      [esperando({ id: 1, confirmationWhatsappSid: "SM1" }), esperando({ id: 2 })],
      { sidOriginal: "SM1" }
    );
    expect(r).toMatchObject({ tipo: "una", via: "sid" });
    expect(r.tipo === "una" && r.cita.id).toBe(1);
  });

  it("con una sola esperando, vale el teléfono", () => {
    const r = eligeCitaParaRespuesta([esperando({ id: 7 })], {});
    expect(r).toMatchObject({ tipo: "una", via: "telefono" });
  });

  /*
   * Una flota tiene UN teléfono y diez citas. Confirmar la que no era es peor
   * que no confirmar ninguna: la de verdad se queda esperando, la otra se da
   * por buena, y nadie se entera hasta que el camión no aparece.
   */
  it("con varias esperando NO elige ninguna", () => {
    const r = eligeCitaParaRespuesta([esperando({ id: 1 }), esperando({ id: 2 })], {});
    expect(r.tipo).toBe("ambigua");
    expect(r.tipo === "ambigua" && r.candidatas).toHaveLength(2);
  });

  it("no cuenta las canceladas ni las eliminadas", () => {
    const r = eligeCitaParaRespuesta(
      [esperando({ id: 1 }), esperando({ id: 2, status: "cancelado" })],
      {}
    );
    expect(r).toMatchObject({ tipo: "una" });
  });

  it("ninguna cuando no hay nada esperando", () => {
    expect(eligeCitaParaRespuesta([], {}).tipo).toBe("ninguna");
    expect(
      eligeCitaParaRespuesta([esperando({ confirmationStatus: "confirmed" })], {}).tipo
    ).toBe("ninguna");
  });
});

describe("cambiosPorRespuesta", () => {
  it("confirmar deja la cita confirmada y con su hora", () => {
    const c = cambiosPorRespuesta("confirmar", {
      ahoraMs: AHORA,
      respuesta: "✅ Confirmar",
      messageSid: "SM9",
    });
    expect(c.confirmationStatus).toBe("confirmed");
    expect(c.confirmedAtMs).toBe(AHORA);
    expect(c.confirmationResponseMessageSid).toBe("SM9");
  });

  it("cambiar deja la cita para reprogramar", () => {
    const c = cambiosPorRespuesta("cambiar", { ahoraMs: AHORA });
    expect(c.confirmationStatus).toBe("reschedule");
    expect(c.rescheduleRequestedAtMs).toBe(AHORA);
    expect(c.confirmedAtMs).toBeUndefined();
  });

  /*
   * LEÍDO NO ES CONFIRMADO. Lo que diga Twilio del mensaje vive en otro campo
   * y lo escribe otro camino; esta función no lo toca ni de refilón.
   */
  it("no toca el estado del MENSAJE", () => {
    const c = cambiosPorRespuesta("confirmar", { ahoraMs: AHORA });
    expect(c).not.toHaveProperty("confirmationWhatsappStatus");
    expect(c).not.toHaveProperty("confirmationWhatsappReadAtMs");
  });
});

describe("respuestaYaAplicada", () => {
  it("cazá el mensaje repetido", () => {
    expect(respuestaYaAplicada({ confirmationResponseMessageSid: "SM1" }, "SM1")).toBe(true);
  });

  it("deja pasar uno nuevo", () => {
    expect(respuestaYaAplicada({ confirmationResponseMessageSid: "SM1" }, "SM2")).toBe(false);
    expect(respuestaYaAplicada({}, "SM1")).toBe(false);
  });
});

describe("rótulos", () => {
  it("el del mensaje", () => {
    expect(rotuloEnvio("read")).toEqual({ icono: "👁", texto: "Leído" });
    expect(rotuloEnvio("failed")).toEqual({ icono: "⚠", texto: "Fallido" });
    expect(rotuloEnvio(null)).toBeNull();
  });

  it("el de la confirmación", () => {
    expect(rotuloConfirmacion("confirmed").texto).toBe("Confirmada");
    expect(rotuloConfirmacion("reschedule").texto).toBe("Reprogramar");
    expect(rotuloConfirmacion("pending").texto).toBe("Pendiente");
  });
});
