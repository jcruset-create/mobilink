/**
 * Confirmación de citas por WhatsApp: los estados y las decisiones.
 *
 * Puro, sin base de datos y sin Twilio, para poder probar en un test lo que de
 * otro modo solo se vería mandando WhatsApps de verdad: que un «leído» no
 * confirma, que una respuesta ambigua no toca ninguna cita, y que un despliegue
 * no reenvía la confirmación a las citas que ya la tenían.
 *
 * ── Tres estados que NO son el mismo ────────────────────────────────────────
 *
 *  1. `status` de la cita — programado, en_cola, cerrado… Lo que ya existía.
 *  2. `confirmationWhatsappStatus` — qué ha pasado con el MENSAJE: enviado,
 *     entregado, leído, fallido. Lo dice Twilio.
 *  3. `confirmationStatus` — qué ha dicho EL CLIENTE. Solo lo mueve una
 *     respuesta suya.
 *
 * El segundo y el tercero se confunden con una facilidad pasmosa, y confundirlos
 * significa dar por confirmada una cita que nadie ha confirmado: el cliente abrió
 * el WhatsApp, lo leyó y no contestó. Por eso viven en campos distintos, los
 * mueven funciones distintas, y hay un test que lo comprueba.
 */

/** Lo que Twilio dice del mensaje. */
export type EstadoEnvioWhatsapp = "pending" | "sent" | "delivered" | "read" | "failed";

/** Lo que dice el cliente. */
export type EstadoConfirmacion =
  /** Aún no toca pedirle nada. */
  | "pending"
  /** Se le ha pedido y estamos esperando. */
  | "awaiting_confirmation"
  /** Ha pulsado «Confirmar». */
  | "confirmed"
  /** Ha pulsado «Cambiar cita». */
  | "reschedule"
  /**
   * No se le va a preguntar: la cita se creó con menos de dos horas de
   * margen. NO es `pending`, y la diferencia importa: `pending` dice
   * «esperamos respuesta» y en recepción se lee como que el cliente no ha
   * contestado. Aquí nunca se le preguntó nada.
   */
  | "not_requested";

/** Los identificadores de los botones de la plantilla. */
export const RESPUESTA_CONFIRMAR = "CONFIRMAR_CITA";
export const RESPUESTA_CAMBIAR = "CAMBIAR_CITA";

/** Lo que el cliente ha querido decir. */
export type IntencionCliente = "confirmar" | "cambiar" | null;

/**
 * Qué ha contestado el cliente.
 *
 * Manda el identificador del botón (`ButtonPayload`), que es inequívoco. El
 * texto libre se mira DESPUÉS y solo para las dos frases exactas de los
 * botones, porque quien escribe a mano escribe cualquier cosa: «confirmo pero
 * llego tarde» no es un sí que se pueda dar por bueno sin que lo lea una
 * persona.
 */
export function intencionDeRespuesta(entrante: {
  buttonPayload?: unknown;
  buttonText?: unknown;
  body?: unknown;
}): IntencionCliente {
  const payload = String(entrante?.buttonPayload ?? "").trim().toUpperCase();
  if (payload === RESPUESTA_CONFIRMAR) return "confirmar";
  if (payload === RESPUESTA_CAMBIAR) return "cambiar";

  // El texto del botón, que es lo que llega si el payload no viene.
  const texto = String(entrante?.buttonText ?? entrante?.body ?? "")
    .trim()
    .toLowerCase()
    .replace(/[✅🔄]/gu, "")
    .trim();
  if (texto === "confirmar") return "confirmar";
  if (texto === "cambiar cita") return "cambiar";

  return null;
}

/* ── El estado del mensaje ────────────────────────────────────────────────── */

const ORDEN_ENVIO: Record<EstadoEnvioWhatsapp, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/**
 * ¿Este estado que llega adelanta al que ya teníamos?
 *
 * Los callbacks de Twilio no llegan en orden. Un `delivered` que se retrasa no
 * puede pisar un `read` que ya llegó, o la ficha diría que el cliente no ha
 * abierto un mensaje que abrió.
 *
 * `failed` es la excepción y siempre gana: un mensaje que ha fallado ha
 * fallado, aunque antes se hubiera dado por entregado.
 */
export function estadoEnvioAdelanta(
  actual: EstadoEnvioWhatsapp | null | undefined,
  nuevo: EstadoEnvioWhatsapp
): boolean {
  if (nuevo === "failed") return true;
  const antes = ORDEN_ENVIO[(actual ?? "pending") as EstadoEnvioWhatsapp] ?? 0;
  if (actual === "failed") return false;
  return ORDEN_ENVIO[nuevo] > antes;
}

/** Cómo llama Twilio a cada estado, traducido al nuestro. */
export function estadoEnvioDeTwilio(valor: unknown): EstadoEnvioWhatsapp | null {
  const v = String(valor ?? "").trim().toLowerCase();
  if (v === "sent" || v === "queued" || v === "accepted") return "sent";
  if (v === "delivered") return "delivered";
  if (v === "read") return "read";
  if (v === "failed" || v === "undelivered") return "failed";
  return null;
}

/** En qué campo de la cita se apunta la hora de cada estado. */
export function campoDeFechaDeEstado(estado: EstadoEnvioWhatsapp): string | null {
  if (estado === "delivered") return "confirmationWhatsappDeliveredAtMs";
  if (estado === "read") return "confirmationWhatsappReadAtMs";
  if (estado === "failed") return "confirmationWhatsappFailedAtMs";
  // `sent` ya tiene su hora en `confirmationWhatsappSentAtMs`, que se escribe
  // al mandarlo y no depende de que llegue ningún callback.
  return null;
}

/* ── El estado de la confirmación ─────────────────────────────────────────── */

/** Lo que dice la cita, con las viejas —que no tienen el campo— en `pending`. */
export function estadoConfirmacion(cita: {
  confirmationStatus?: unknown;
}): EstadoConfirmacion {
  const v = String(cita?.confirmationStatus ?? "").trim();
  if (
    v === "awaiting_confirmation" ||
    v === "confirmed" ||
    v === "reschedule" ||
    v === "not_requested"
  ) {
    return v;
  }
  return "pending";
}

/* ── Cuándo se pide la confirmación ───────────────────────────────────────── */

/** Con más margen que esto, la confirmación va a T−24 h, como siempre. */
export const ANTELACION_NORMAL_MS = 24 * 60 * 60 * 1000;

/** Con menos margen que esto no se pide confirmación: no daría tiempo. */
export const ANTELACION_MINIMA_MS = 2 * 60 * 60 * 1000;

/**
 * Lo que se espera desde que se crea la cita antes de pedirle confirmación.
 *
 * Existe para que el cliente no reciba «tu cita está registrada» y, treinta
 * segundos después, «confirma tu cita». Dos mensajes seguidos del mismo taller
 * diciendo cosas distintas parecen un error del sistema, y el segundo se
 * ignora.
 */
export const ESPERA_TRAS_CREAR_MS = 60 * 60 * 1000;

/** Cuánto se tolera llegar tarde: un servidor apagado no debe perder el aviso. */
export const GRACIA_MS = 12 * 60 * 60 * 1000;

export type PlanConfirmacion =
  /** No hay nada que hacer, y por qué. */
  | { accion: "nada"; motivo: string }
  /** No se le va a preguntar nunca: se creó con menos de dos horas. */
  | { accion: "no-procede" }
  /** Todavía no toca. `desdeMs` es cuándo tocará. */
  | { accion: "esperar"; desdeMs: number }
  /** Ahora. */
  | { accion: "enviar" };

/** Máximo de intentos antes de dar el envío por fallido. */
export const INTENTOS_MAXIMOS = 3;

/**
 * Qué hacer con esta cita, ahora mismo.
 *
 * ── La regla, según el margen con que se creó la cita ───────────────────────
 *
 *  · más de 24 h  → a T−24 h. El flujo normal.
 *  · entre 2 y 24 h → una hora después de crearla. No a T−24 h, porque eso ya
 *    ha pasado y saldría a los segundos, pegado al mensaje de creación.
 *  · menos de 2 h → no se pide. No da tiempo a que conteste y a que sirva de
 *    algo, y preguntar por preguntar deja la agenda llena de pendientes que
 *    nadie va a resolver.
 *
 * Una cita SIN `createdAtMs` —las que ya existían— se trata con la regla
 * clásica de T−24 h. Cambiarles el criterio a posteriori movería el momento de
 * envío de citas que ya están en marcha.
 */
export function planDeConfirmacion(
  cita: {
    status?: unknown;
    customerPhone?: unknown;
    sendReminder24h?: unknown;
    whatsappReminder24hSentAtMs?: unknown;
    confirmationStatus?: unknown;
    confirmationWhatsappAttemptCount?: unknown;
    createdAtMs?: unknown;
  },
  momento: { ahoraMs: number; citaAtMs: number | null; graciaMs?: number }
): PlanConfirmacion {
  const estado = String(cita?.status ?? "");
  if (["cancelado", "eliminado", "cerrado", "realizado"].includes(estado)) {
    return { accion: "nada", motivo: `cita ${estado}` };
  }
  if (cita?.sendReminder24h === false) {
    return { accion: "nada", motivo: "recordatorio apagado" };
  }
  if (!String(cita?.customerPhone ?? "").trim()) {
    return { accion: "nada", motivo: "sin teléfono" };
  }
  // El guardia de siempre, el que llevan las citas de producción.
  if (cita?.whatsappReminder24hSentAtMs) {
    return { accion: "nada", motivo: "ya enviada" };
  }
  const confirmacion = estadoConfirmacion(cita);
  if (confirmacion !== "pending") {
    return { accion: "nada", motivo: `ya ${confirmacion}` };
  }
  const intentos = Number(cita?.confirmationWhatsappAttemptCount ?? 0);
  if (Number.isFinite(intentos) && intentos >= INTENTOS_MAXIMOS) {
    return { accion: "nada", motivo: "agotados los intentos" };
  }

  const citaAtMs = momento.citaAtMs;
  if (citaAtMs == null || !Number.isFinite(citaAtMs)) {
    return { accion: "nada", motivo: "sin fecha utilizable" };
  }
  if (citaAtMs <= momento.ahoraMs) {
    return { accion: "nada", motivo: "la cita ya ha pasado" };
  }

  const creada = Number(cita?.createdAtMs);
  const tieneCreacion = Number.isFinite(creada) && creada > 0;
  const antelacion = tieneCreacion ? citaAtMs - creada : null;

  if (antelacion != null && antelacion < ANTELACION_MINIMA_MS) {
    return { accion: "no-procede" };
  }

  const cuando =
    antelacion == null || antelacion > ANTELACION_NORMAL_MS
      ? citaAtMs - ANTELACION_NORMAL_MS
      : creada + ESPERA_TRAS_CREAR_MS;

  if (momento.ahoraMs < cuando) return { accion: "esperar", desdeMs: cuando };

  const gracia = momento.graciaMs ?? GRACIA_MS;
  if (momento.ahoraMs - cuando > gracia) {
    return { accion: "nada", motivo: "fuera de plazo" };
  }

  return { accion: "enviar" };
}

/* ── De la respuesta a la cita ────────────────────────────────────────────── */

export type CitaCandidata = {
  id: number;
  date?: string | null;
  startTime?: string | null;
  customerPhone?: string | null;
  confirmationWhatsappSid?: string | null;
  confirmationStatus?: unknown;
  status?: unknown;
};

export type EleccionDeCita =
  /** Una sola, y sabemos cuál. */
  | { tipo: "una"; cita: CitaCandidata; via: "sid" | "telefono" }
  /** Varias posibles: no se toca ninguna. */
  | { tipo: "ambigua"; candidatas: CitaCandidata[] }
  /** Ninguna: la respuesta no va de una cita. */
  | { tipo: "ninguna" };

/**
 * A qué cita se refiere esta respuesta.
 *
 * ── Por qué no vale «la última cita de ese teléfono» ────────────────────────
 *
 * Porque una flota tiene un solo teléfono y diez citas. Confirmar la que no era
 * es peor que no confirmar ninguna: la de verdad se queda esperando y la otra
 * se da por buena, y nadie se entera hasta que el camión no aparece.
 *
 * Por eso la cascada empieza por lo inequívoco —el mensaje al que ha
 * respondido— y solo cae al teléfono cuando NO hay duda: una única cita
 * esperando confirmación. Con dos, se para y lo mira una persona.
 */
export function eligeCitaParaRespuesta(
  candidatas: CitaCandidata[],
  pista: { sidOriginal?: string | null }
): EleccionDeCita {
  const vivas = (candidatas ?? []).filter((c) => {
    const estado = String(c?.status ?? "");
    return estado !== "cancelado" && estado !== "eliminado";
  });

  // 1. El mensaje al que contesta. Es el único dato que no admite discusión.
  const sid = String(pista?.sidOriginal ?? "").trim();
  if (sid) {
    const porSid = vivas.filter((c) => String(c.confirmationWhatsappSid ?? "") === sid);
    if (porSid.length === 1) return { tipo: "una", cita: porSid[0], via: "sid" };
    if (porSid.length > 1) return { tipo: "ambigua", candidatas: porSid };
  }

  // 2. Las que están esperando respuesta de ese teléfono.
  const esperando = vivas.filter((c) => estadoConfirmacion(c) === "awaiting_confirmation");
  if (esperando.length === 1) return { tipo: "una", cita: esperando[0], via: "telefono" };
  if (esperando.length > 1) return { tipo: "ambigua", candidatas: esperando };

  return { tipo: "ninguna" };
}

/**
 * Cómo queda la cita después de la respuesta.
 *
 * Devuelve SOLO los campos que cambian, para que quien escriba en la base no
 * tenga que saber nada de esta regla. Nunca toca `confirmationWhatsappStatus`:
 * lo que diga Twilio del mensaje es otra cosa y se escribe por otro camino.
 */
export function cambiosPorRespuesta(
  intencion: Exclude<IntencionCliente, null>,
  datos: { ahoraMs: number; respuesta?: string | null; messageSid?: string | null }
): Record<string, unknown> {
  const comun = {
    confirmationResponse: datos.respuesta ?? null,
    confirmationResponseMessageSid: datos.messageSid ?? null,
  };

  if (intencion === "confirmar") {
    return {
      ...comun,
      confirmationStatus: "confirmed" as const,
      confirmedAtMs: datos.ahoraMs,
    };
  }

  return {
    ...comun,
    confirmationStatus: "reschedule" as const,
    rescheduleRequestedAtMs: datos.ahoraMs,
  };
}

/**
 * ¿Esta respuesta ya se aplicó?
 *
 * Twilio reintenta los webhooks, y el mismo mensaje puede llegar dos veces. Sin
 * esto, la segunda vez reescribiría la hora de confirmación y la ficha diría
 * que el cliente confirmó más tarde de lo que confirmó.
 */
export function respuestaYaAplicada(
  cita: { confirmationResponseMessageSid?: unknown },
  messageSid: string | null | undefined
): boolean {
  const guardado = String(cita?.confirmationResponseMessageSid ?? "").trim();
  const entrante = String(messageSid ?? "").trim();
  return guardado !== "" && guardado === entrante;
}

/* ── Para la pantalla ─────────────────────────────────────────────────────── */

/** Cómo se dice cada estado del mensaje, con su icono. */
export function rotuloEnvio(estado: EstadoEnvioWhatsapp | null | undefined): {
  icono: string;
  texto: string;
} | null {
  switch (estado) {
    case "sent": return { icono: "✓", texto: "Enviado" };
    case "delivered": return { icono: "✓✓", texto: "Entregado" };
    case "read": return { icono: "👁", texto: "Leído" };
    case "failed": return { icono: "⚠", texto: "Fallido" };
    case "pending": return { icono: "⏳", texto: "Pendiente" };
    default: return null;
  }
}

/** Cómo se dice el estado de la confirmación. */
export function rotuloConfirmacion(estado: EstadoConfirmacion): {
  icono: string;
  texto: string;
} {
  switch (estado) {
    case "confirmed": return { icono: "✅", texto: "Confirmada" };
    case "reschedule": return { icono: "🔄", texto: "Reprogramar" };
    case "awaiting_confirmation": return { icono: "⏳", texto: "Pendiente" };
    // Ni ⏳ ni «pendiente»: a esta cita no se le ha preguntado nada, y decir
    // «pendiente» haría creer a recepción que el cliente no contesta.
    case "not_requested": return { icono: "—", texto: "No solicitada · cita inmediata" };
    default: return { icono: "⏳", texto: "Pendiente" };
  }
}
