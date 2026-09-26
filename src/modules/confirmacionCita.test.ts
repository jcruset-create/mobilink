import { describe, expect, it } from "vitest";

import {
  cambiosPorRespuesta,
  campoDeFechaDeEstado,
  eligeCitaParaRespuesta,
  estadoConfirmacion,
  estadoEnvioAdelanta,
  estadoEnvioDeTwilio,
  intencionDeRespuesta,
  planDeConfirmacion,
  enSilencio,
  fueraDelSilencio,
  respuestaYaAplicada,
  rotuloConfirmacion,
  rotuloEnvio,
  type CitaCandidata,
} from "./confirmacionCita";

const AHORA = new Date("2026-09-26T10:45:00").getTime();


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

/* ── La regla temporal ─────────────────────────────────────────────────────
 *
 * Cada caso está escrito con la hora a la que se crea la cita y la hora de la
 * cita, no con milisegundos, porque lo que hay que poder revisar de un vistazo
 * es la regla de negocio: a qué hora le llega el WhatsApp al cliente.
 */
describe("planDeConfirmacion", () => {
  const H = 60 * 60 * 1000;
  const CREADA = new Date("2026-09-26T15:00:00").getTime();

  /** Una cita creada a las 15:00 para dentro de `horas`. */
  function citaCon(horas: number, extra: Record<string, unknown> = {}) {
    return {
      status: "programado",
      customerPhone: "610473077",
      sendReminder24h: true,
      createdAtMs: CREADA,
      ...extra,
      _citaAtMs: CREADA + horas * H,
    };
  }

  const plan = (c: any, ahoraMs: number) =>
    planDeConfirmacion(c, { ahoraMs, citaAtMs: c._citaAtMs });

  it("1 · más de 24 h: se pide a T−24 h, ni antes ni al crearla", () => {
    const c = citaCon(48);
    expect(plan(c, CREADA)).toMatchObject({ accion: "esperar" });
    // Justo antes de T−24h todavía espera.
    expect(plan(c, c._citaAtMs - 24 * H - 1)).toMatchObject({ accion: "esperar" });
    expect(plan(c, c._citaAtMs - 24 * H)).toMatchObject({ accion: "enviar" });
  });

  it("2 · a 20 h: NADA al crearla, y se pide una hora después", () => {
    const c = citaCon(20);
    expect(plan(c, CREADA)).toMatchObject({ accion: "esperar", desdeMs: CREADA + H });
    expect(plan(c, CREADA + 59 * 60 * 1000)).toMatchObject({ accion: "esperar" });
    expect(plan(c, CREADA + H)).toMatchObject({ accion: "enviar" });
  });

  it("3 · a 12 h: igual, una hora después de crearla", () => {
    const c = citaCon(12);
    expect(plan(c, CREADA)).toMatchObject({ accion: "esperar", desdeMs: CREADA + H });
    expect(plan(c, CREADA + H)).toMatchObject({ accion: "enviar" });
  });

  it("4 · a 3 h: igual, una hora después", () => {
    const c = citaCon(3);
    expect(plan(c, CREADA)).toMatchObject({ accion: "esperar", desdeMs: CREADA + H });
    expect(plan(c, CREADA + H)).toMatchObject({ accion: "enviar" });
  });

  it("5 · a 1 h 30: no se pide nunca", () => {
    const c = citaCon(1.5);
    expect(plan(c, CREADA)).toMatchObject({ accion: "no-procede" });
    expect(plan(c, CREADA + H)).toMatchObject({ accion: "no-procede" });
  });

  it("6 · a 30 minutos: tampoco", () => {
    expect(plan(citaCon(0.5), CREADA)).toMatchObject({ accion: "no-procede" });
  });

  /*
   * EL TEST QUE JUSTIFICA TODO ESTO.
   *
   * Antes, una cita para dentro de 20 h mandaba la confirmación en menos de
   * 60 s: el cliente recibía «tu cita está registrada» y acto seguido
   * «confirma tu cita». Dos mensajes seguidos del mismo taller diciendo cosas
   * distintas parecen un error, y el segundo se ignora.
   */
  it("7 · NUNCA los dos mensajes seguidos, con cualquier antelación", () => {
    for (const horas of [2, 3, 6, 12, 18, 20, 23, 23.9, 24, 25, 48, 72]) {
      const r = plan(citaCon(horas), CREADA);
      expect(r.accion, `antelación de ${horas} h`).not.toBe("enviar");
    }
  });

  it("8 · con los intentos agotados no se vuelve a intentar", () => {
    const c = citaCon(48, { confirmationWhatsappAttemptCount: 3 });
    expect(plan(c, c._citaAtMs - 24 * H)).toMatchObject({
      accion: "nada",
      motivo: "agotados los intentos",
    });
  });

  it("9 · con dos intentos todavía se intenta el tercero", () => {
    const c = citaCon(48, { confirmationWhatsappAttemptCount: 2 });
    expect(plan(c, c._citaAtMs - 24 * H)).toMatchObject({ accion: "enviar" });
  });

  it("10 · cancelada durante la hora de espera: no se envía", () => {
    for (const status of ["cancelado", "eliminado", "cerrado", "realizado"]) {
      const c = citaCon(20, { status });
      expect(plan(c, CREADA + H)).toMatchObject({ accion: "nada" });
    }
  });

  it("11 · confirmada por otro medio antes de la hora: no se envía", () => {
    const c = citaCon(20, { confirmationStatus: "confirmed" });
    expect(plan(c, CREADA + H)).toMatchObject({ accion: "nada", motivo: "ya confirmed" });
  });

  it("12 · la que ya salió no vuelve a salir tras un reinicio", () => {
    // El guardia está en la base, así que da igual cuántas veces se levante
    // el servidor y vuelva a pasar por la cita.
    const c = citaCon(48, { whatsappReminder24hSentAtMs: CREADA });
    expect(plan(c, c._citaAtMs - 24 * H)).toMatchObject({ accion: "nada", motivo: "ya enviada" });
  });

  it("13 · una cita vieja, sin createdAtMs, sigue con la regla de siempre", () => {
    const c: any = citaCon(48);
    delete c.createdAtMs;
    expect(plan(c, c._citaAtMs - 24 * H)).toMatchObject({ accion: "enviar" });
    expect(plan(c, CREADA)).toMatchObject({ accion: "esperar" });
  });

  it("14 · una cita que ya pasó no recibe nada", () => {
    const c = citaCon(48);
    expect(plan(c, c._citaAtMs + 1)).toMatchObject({ accion: "nada" });
  });

  it("15 · tras una caída muy larga no se manda con la cita encima", () => {
    const c = citaCon(48);
    // 13 h tarde: fuera del plazo de gracia.
    expect(plan(c, c._citaAtMs - 24 * H + 13 * H)).toMatchObject({
      accion: "nada",
      motivo: "fuera de plazo",
    });
  });

  it("no-procede no es lo mismo que pendiente", () => {
    expect(rotuloConfirmacion("not_requested").texto).toBe("No solicitada · cita inmediata");
    expect(rotuloConfirmacion("not_requested").icono).not.toBe("⏳");
  });
});

describe("horario de silencio (22:00–08:00 Europe/Madrid)", () => {
  /*
   * Los instantes se escriben con desfase explícito (+02:00, que es Madrid en
   * septiembre) y no como «2026-09-27T23:00:00». Sin el desfase, `Date` los
   * interpreta en la zona del sistema, y entonces la prueba diría una cosa en
   * un portátil y otra en la CI, que corre en UTC. Una prueba de horas que
   * depende de la hora de la máquina no prueba nada.
   */
  const madrid = (iso: string) => new Date(`${iso}+02:00`).getTime();
  const H = 60 * 60 * 1000;

  /** La cita, con su creación y su hora, ya en milisegundos. */
  function cita(creadaIso: string, citaIso: string, extra: Record<string, unknown> = {}) {
    return {
      status: "programado",
      customerPhone: "600111222",
      createdAtMs: madrid(creadaIso),
      ...extra,
      _citaAtMs: madrid(citaIso),
    } as any;
  }

  const plan = (c: any, ahoraMs: number) =>
    planDeConfirmacion(c, { ahoraMs, citaAtMs: c._citaAtMs, zona: "Europe/Madrid" });

  it("1 · un envío calculado a las 23:00 se pospone a las 08:00 del día siguiente", () => {
    // Cita el 28 a las 23:00 → T−24 h cae el 27 a las 23:00, ya de noche.
    const c = cita("2026-09-20T10:00:00", "2026-09-28T23:00:00");
    const alba = madrid("2026-09-28T08:00:00");

    expect(plan(c, madrid("2026-09-27T23:30:00"))).toMatchObject({
      accion: "esperar",
      desdeMs: alba,
    });
    expect(plan(c, alba)).toMatchObject({ accion: "enviar" });
  });

  it("2 · un envío calculado a las 03:00 se pospone a las 08:00 del mismo día", () => {
    // Cita el 28 a las 03:00 → T−24 h cae el 27 a las 03:00, de madrugada.
    const c = cita("2026-09-20T10:00:00", "2026-09-28T03:00:00");
    const alba = madrid("2026-09-27T08:00:00");

    expect(plan(c, madrid("2026-09-27T03:00:00"))).toMatchObject({
      accion: "esperar",
      desdeMs: alba,
    });
    expect(plan(c, alba)).toMatchObject({ accion: "enviar" });
  });

  it("3 · pospuesto a las 08:00 con más de 2 h de margen: se manda", () => {
    // Creada a las 21:30, cita al día siguiente a las 12:00. La regla de la
    // hora daría 22:30; corrido a las 08:00 quedan cuatro horas, que sirven.
    const c = cita("2026-09-27T21:30:00", "2026-09-28T12:00:00");
    const alba = madrid("2026-09-28T08:00:00");

    expect(plan(c, madrid("2026-09-27T22:30:00"))).toMatchObject({
      accion: "esperar",
      desdeMs: alba,
    });
    expect(c._citaAtMs - alba).toBe(4 * H);
    expect(plan(c, alba)).toMatchObject({ accion: "enviar" });
  });

  it("4 · pospuesto a las 08:00 con menos de 2 h de margen: no se pregunta", () => {
    // Creada a las 23:50, cita al día siguiente a las 09:00. A las 08:00
    // quedaría una hora: preguntar «¿confirmas?» con el cliente ya de camino
    // no aporta nada y deja un pendiente que nadie resuelve.
    const c = cita("2026-09-27T23:50:00", "2026-09-28T09:00:00");
    expect(plan(c, madrid("2026-09-28T00:50:00"))).toMatchObject({ accion: "no-procede" });
    expect(plan(c, madrid("2026-09-28T08:00:00"))).toMatchObject({ accion: "no-procede" });
  });

  it("5 · una cita cancelada durante el silencio no se manda al amanecer", () => {
    // El aplazamiento no es una cola ciega: cuando llegan las 08:00 se vuelve
    // a decidir con el estado de ESE momento.
    const c = cita("2026-09-27T21:30:00", "2026-09-28T12:00:00", { status: "cancelado" });
    expect(plan(c, madrid("2026-09-28T08:00:00"))).toMatchObject({
      accion: "nada",
      motivo: "cita cancelado",
    });
  });

  it("6 · una cita confirmada por otra vía antes de las 08:00 tampoco sale", () => {
    // Llamó por teléfono a las dos de la mañana, o lo hizo recepción a mano.
    const c = cita("2026-09-27T21:30:00", "2026-09-28T12:00:00", {
      confirmationStatus: "confirmed",
      confirmedAtMs: madrid("2026-09-28T02:00:00"),
    });
    expect(plan(c, madrid("2026-09-28T08:00:00"))).toMatchObject({
      accion: "nada",
      motivo: "ya confirmed",
    });
  });

  it("7 · a las 08:00 en punto ya no es silencio, y a las 21:59 tampoco", () => {
    expect(enSilencio(madrid("2026-09-27T08:00:00"), "Europe/Madrid")).toBe(false);
    expect(enSilencio(madrid("2026-09-27T21:59:00"), "Europe/Madrid")).toBe(false);
    expect(enSilencio(madrid("2026-09-27T22:00:00"), "Europe/Madrid")).toBe(true);
    expect(enSilencio(madrid("2026-09-27T07:59:00"), "Europe/Madrid")).toBe(true);
  });

  it("8 · un envío de día no se mueve", () => {
    const tarde = madrid("2026-09-27T17:00:00");
    expect(fueraDelSilencio(tarde, "Europe/Madrid")).toBe(tarde);
  });

  it("9 · el silencio se mide en Madrid, no en la zona del servidor", () => {
    // Las 23:30 de Madrid son las 21:30 UTC. Un servidor que mirara su propio
    // reloj creería que aún es horario diurno y mandaría el WhatsApp.
    const noche = madrid("2026-09-27T23:30:00");
    expect(enSilencio(noche, "Europe/Madrid")).toBe(true);
    expect(enSilencio(noche, "UTC")).toBe(false);
  });
});
