/**
 * Mobilink Assist Lite — urgencia y escalado de los mensajes de la central.
 *
 * Lo mismo que ya hace Assist Pro en `server/mensajes/mensajesAsistencia.ts`,
 * traído al chat de Lite (`connect_communications`, canal 'workshop'):
 *
 *   NORMAL   → suena una vez al llegar y se queda en la bandeja.
 *   URGENTE  → suena cada 15 s hasta que el operario lo lee.
 *   ESCALADO → un normal que lleva más de ESCALADO_MS sin leer pasa a
 *              tratarse como urgente.
 *
 * El escalado **se deduce de las horas, no se guarda**: así no hace falta
 * ningún proceso que vaya cambiando filas, y la regla vive en un solo sitio
 * —aquí— en vez de repetida en el panel, en la API y en la app.
 *
 * Por qué un módulo aparte y no cuatro líneas dentro de `lite.ts`: esto es la
 * única parte de la mensajería que es una decisión y no una consulta, así que
 * es la única que merece pruebas de verdad. Ver `liteMensajes.test.ts`.
 */

/** Un normal sin leer pasa a tratarse como urgente a los 3 minutos. */
export const ESCALADO_MS = 3 * 60_000;

/** Cada cuánto vuelve a sonar lo que está sin leer y es urgente. */
export const REPETICION_MS = 15_000;

/**
 * Respuestas rápidas del operario en el aviso a pantalla completa.
 *
 * Son las tres de Assist Pro: con el móvil en una mano y el aviso tapando la
 * pantalla, tres botones grandes caben y seis no. La lista larga está en el
 * hilo, que es donde hay sitio.
 */
export const RESPUESTAS_RAPIDAS = ["Voy", "Llamo ahora", "Necesito ayuda"];

/** Una fila de `connect_communications` del canal 'workshop', ya en números. */
export type MensajeTaller = {
  id: number;
  body: string;
  byName: string | null;
  createdAtMs: number;
  readAtMs: number | null;
  urgent: boolean;
};

export type MensajeTallerConEstado = MensajeTaller & {
  /** Normal sin leer pasado ESCALADO_MS: se trata como urgente. */
  escalado: boolean;
  /** Tiene que volver a sonar cada REPETICION_MS: urgente o escalado, y sin leer. */
  repetirSonido: boolean;
  /** Minutos sin leer, para que Central lo vea en su pestaña. */
  sinLeerMin: number | null;
};

export function conEstado(m: MensajeTaller, ahoraMs: number): MensajeTallerConEstado {
  const leido = m.readAtMs != null;
  const escalado = !leido && !m.urgent && ahoraMs - m.createdAtMs >= ESCALADO_MS;
  return {
    ...m,
    escalado,
    repetirSonido: !leido && (m.urgent || escalado),
    sinLeerMin: leido ? null : Math.max(0, Math.floor((ahoraMs - m.createdAtMs) / 60_000)),
  };
}

/**
 * Normaliza una fila de la base de datos. Postgres devuelve los BIGINT como
 * cadena y el COUNT como cadena: sin esto, `ahora - createdAtMs` resta un
 * número de un texto y el escalado nunca salta.
 */
export function aMensajeTaller(r: any): MensajeTaller {
  return {
    id: Number(r.id),
    body: String(r.body ?? ""),
    byName: r.byName ?? null,
    createdAtMs: Number(r.createdAtMs),
    readAtMs: r.readAtMs != null ? Number(r.readAtMs) : null,
    urgent: r.urgent === true,
  };
}

/**
 * El momento a partir del cual un mensaje normal sin leer ya está escalado.
 * Se pasa a SQL para contar los que piden atención sin traerlos todos.
 */
export function umbralEscalado(ahoraMs = Date.now()): number {
  return ahoraMs - ESCALADO_MS;
}
