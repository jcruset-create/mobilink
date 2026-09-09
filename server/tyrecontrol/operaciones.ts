/**
 * Vocabulario de la integración con TyreControl: qué operaciones existen, cómo
 * se identifican y qué errores merecen otro intento.
 *
 * ── La correlación ──────────────────────────────────────────────────────────
 *
 * Se construye a partir de lo que la originó, NUNCA con un UUID nuevo:
 * `assist:1234:tc:record`. Un identificador aleatorio por intento haría que el
 * mismo hecho apareciera como dos operaciones distintas, y entonces ni la
 * idempotencia ni la auditoría sirven de nada — que es justo la protección que
 * más falta hace, porque TyreControl no tiene idempotency key.
 *
 * ── Qué se reintenta ────────────────────────────────────────────────────────
 *
 * Reintentar un fallo de red es correcto. Reintentar «medida incompatible» es
 * repetir para siempre algo que nunca va a salir bien, llenando el registro y
 * escondiendo los fallos de verdad. Por eso los errores se clasifican, y por
 * defecto un error desconocido NO se reintenta: es más seguro dejar algo
 * pendiente de mirar que repetir a ciegas una operación que toca datos.
 */

export const OPERACIONES_TC = [
  // Implementadas en esta fase (lectura y comprobación).
  "TC_AUTH_PROBE",
  "TC_VEHICLE_RESOLVE",
  "TC_VEHICLE_STATE",
  "TC_WRITE_PROBE",
  // Contrato de las escrituras futuras. NO implementadas.
  "TC_ASSISTANCE_RECORD",
  "TC_TYRE_MOUNT",
  "TC_TYRE_REMOVE",
  "TC_TYRE_REPLACE",
  "TC_TYRE_REPAIR",
  "TC_TYRE_ROTATE",
] as const;

export type OperacionTc = (typeof OPERACIONES_TC)[number];

/** Las que tocan datos de TyreControl. Ninguna está implementada todavía. */
export const OPERACIONES_QUE_ESCRIBEN: OperacionTc[] = [
  "TC_ASSISTANCE_RECORD", "TC_TYRE_MOUNT", "TC_TYRE_REMOVE",
  "TC_TYRE_REPLACE", "TC_TYRE_REPAIR", "TC_TYRE_ROTATE",
];

export function escribe(op: OperacionTc): boolean {
  return OPERACIONES_QUE_ESCRIBEN.includes(op);
}

/* ── Correlación ─────────────────────────────────────────────────────────── */

/** `assist:1234:tc:record`. Estable entre reintentos, porque es el mismo hecho. */
export function correlacionAsistencia(assistanceId: number | string, sufijo = "record"): string {
  return `assist:${assistanceId}:tc:${sufijo}`;
}

/** `otf:88:tc:trabajo:12`. El trabajo va dentro: son hechos distintos. */
export function correlacionOtf(otfId: number | string, sufijo: string): string {
  return `otf:${otfId}:tc:${sufijo}`;
}

/* ── Clasificación de errores ────────────────────────────────────────────── */

export type ClaseError = "retryable" | "permanente";

/**
 * Motivos por los que NO se reintenta.
 *
 * Son decisiones o errores de configuración: repetirlos no cambia nada. La
 * lista es de códigos propios, no de mensajes de TC, para que un cambio de
 * redacción en TyreControl no altere el comportamiento.
 */
export const PERMANENTES = [
  "tc_ambiguous_plate",
  "tc_vehicle_not_found",
  "tc_mapping_missing",
  "tc_mapping_invalid",
  "tc_permission_denied",
  "tc_incompatible_size",
  "tc_tyre_not_found",
  "tc_invalid_operation",
  "tc_credentials_missing",
  "tc_config_missing",
  "tc_write_disabled",
] as const;

/** Motivos por los que sí merece la pena volver a intentarlo. */
export const REINTENTABLES = [
  "tc_unavailable",
  "tc_timeout",
  "tc_network",
  "tc_rate_limited",
  "tc_session_expired",
] as const;

/**
 * Traduce lo que ha fallado a «volver a intentarlo» o «no».
 *
 * Un error sin clasificar se trata como PERMANENTE a propósito. Lo contrario
 * —reintentar lo desconocido— aplicado a operaciones que tocan neumáticos
 * podría repetir un movimiento del que no se sabe si llegó a hacerse.
 */
export function clasificar(codigo: unknown, mensaje?: unknown): ClaseError {
  const c = String(codigo ?? "");
  if ((REINTENTABLES as readonly string[]).includes(c)) return "retryable";
  if ((PERMANENTES as readonly string[]).includes(c)) return "permanente";

  // Señales de transporte, que no llevan código propio.
  const texto = `${c} ${String(mensaje ?? "")}`.toLowerCase();
  if (/timeout|etimedout|econnreset|econnrefused|enotfound|fetch failed|socket hang up|network/.test(texto)) {
    return "retryable";
  }
  if (/\b(429|502|503|504)\b/.test(texto)) return "retryable";

  // La sesión caducada se renueva y se vuelve a intentar; es el caso típico de
  // un token que vence entre dos operaciones del mismo lote.
  if (/jwt|token.*(expired|invalid)|not authenticated/.test(texto)) return "retryable";

  return "permanente";
}

/** Lo que TyreControl dice cuando la guarda de permisos rechaza. */
export function esSinPermiso(mensaje: unknown): boolean {
  return /sin permiso/i.test(String(mensaje ?? ""));
}
