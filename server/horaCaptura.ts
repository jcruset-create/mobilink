/**
 * La hora en que se hizo una foto o una firma en la tablet, no la hora en que
 * llegó al servidor.
 *
 * Sin cobertura, la tablet guarda la foto y la sube cuando vuelve la señal:
 * la hora de llegada puede ser horas después. Para una firma eso importa —el
 * informe dice cuándo firmó el conductor—, así que la tablet manda la hora en
 * que se hizo y aquí se decide si se puede creer.
 *
 * Se desconfía de lo que no cuadra: una hora en el futuro (reloj de la tablet
 * adelantado) o de hace más de una semana (la cola no guarda tanto). En esos
 * casos, null, y manda la hora de llegada.
 */

const MARGEN_FUTURO_MS = 5 * 60_000;
const MAXIMO_ATRAS_MS = 7 * 24 * 3600_000;

export function horaCapturaValida(v: unknown, ahoraMs: number): number | null {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round(n);
  if (ms > ahoraMs + MARGEN_FUTURO_MS) return null;
  if (ms < ahoraMs - MAXIMO_ATRAS_MS) return null;
  return ms;
}

/** La hora de la firma para el informe: la de captura si la hay, si no la de llegada. */
export function horaDeLaFirma(f: { capturadaAtMs?: unknown; createdAtMs?: unknown } | null | undefined): number | null {
  if (!f) return null;
  const c = Number(f.capturadaAtMs);
  if (f.capturadaAtMs != null && Number.isFinite(c) && c > 0) return c;
  const r = Number(f.createdAtMs);
  return Number.isFinite(r) && r > 0 ? r : null;
}
