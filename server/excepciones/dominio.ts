/**
 * Costes de una asistencia y la bandeja de excepciones.
 *
 * ── Cuatro importes, no uno ─────────────────────────────────────────────────
 *
 *   previsto  — lo que se estimó al aceptar. Sirve para decidir, no para pagar.
 *   acordado  — lo que se pactó con quien hace el trabajo. Es el compromiso.
 *   final     — lo que factura de verdad. Puede no coincidir con el acordado.
 *   venta     — lo que se le cobra al cliente.
 *
 * Guardarlos separados es lo que permite contestar «¿por qué esto costó 40 €
 * más de lo pactado?» tres meses después. Con un solo campo que se va pisando,
 * esa pregunta no tiene respuesta.
 *
 * **NULL significa desconocido, nunca cero.** Es la misma regla que ya sigue el
 * motor de tarifas de Central, y por el mismo motivo: un coste a cero se
 * confunde con un servicio gratis y produce un margen inventado.
 */

/** Importes en céntimos no; en euros con decimales, como el resto del sistema. */
export type Costes = {
  previsto: number | null;
  acordado: number | null;
  final: number | null;
  venta: number | null;
};

export type Margen = {
  /** El coste que manda: el final si lo hay, si no el acordado, si no el previsto. */
  costeEfectivo: number | null;
  margenEuros: number | null;
  margenPct: number | null;
  /** El final se ha pasado de lo acordado. */
  desviado: boolean;
  desviacionEuros: number | null;
  desviacionPct: number | null;
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Calcula margen y desviación.
 *
 * El coste que cuenta es el final si existe; mientras no exista, el acordado.
 * Usar el previsto para calcular un margen que se enseña como definitivo es
 * como se toman decisiones con números que luego cambian.
 */
export function calcularMargen(c: Costes): Margen {
  const previsto = num(c.previsto);
  const acordado = num(c.acordado);
  const final = num(c.final);
  const venta = num(c.venta);

  const costeEfectivo = final ?? acordado ?? previsto;
  const margenEuros = venta != null && costeEfectivo != null
    ? redondear(venta - costeEfectivo)
    : null;
  // El porcentaje se calcula sobre la VENTA, que es el criterio de la casa
  // para el margen bruto. Sobre el coste daría otro número y se confundirían.
  const margenPct = margenEuros != null && venta != null && venta !== 0
    ? redondear((margenEuros / venta) * 100)
    : null;

  const desviacionEuros = final != null && acordado != null
    ? redondear(final - acordado)
    : null;
  const desviacionPct = desviacionEuros != null && acordado != null && acordado !== 0
    ? redondear((desviacionEuros / acordado) * 100)
    : null;

  return {
    costeEfectivo,
    margenEuros,
    margenPct,
    // Solo cuenta pasarse. Que salga más barato de lo pactado no es una
    // incidencia que haya que revisar.
    desviado: desviacionEuros != null && desviacionEuros > 0,
    desviacionEuros,
    desviacionPct,
  };
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Cuánto se tolera antes de pedir aprobación.
 *
 * Dos umbrales a la vez, y hacen falta los dos: un 10 % de 30 € son 3 € y no
 * merece parar nada; 20 € de desviación en un servicio de 1.000 € tampoco. Se
 * exige superar el porcentaje **y** el importe mínimo.
 */
export const TOLERANCIA_PCT = 10;
export const TOLERANCIA_EUROS = 25;

export type NivelDesviacion = "ninguna" | "aviso" | "aprobacion";

export function nivelDesviacion(m: Margen): NivelDesviacion {
  if (!m.desviado || m.desviacionEuros == null) return "ninguna";
  const superaPct = (m.desviacionPct ?? 0) > TOLERANCIA_PCT;
  const superaEuros = m.desviacionEuros > TOLERANCIA_EUROS;
  if (superaPct && superaEuros) return "aprobacion";
  return "aviso";
}

/**
 * Si se puede facturar al cliente.
 *
 * Un margen negativo NO bloquea: hay servicios que se dan a pérdida a
 * conciencia, y bloquear la facturación por eso deja de cobrar un trabajo ya
 * hecho. Lo que bloquea es una desviación grande sin aprobar, porque ahí lo que
 * falta es una decisión, no un número.
 */
export function facturacionBloqueada(
  m: Margen,
  aprobada: boolean,
): { bloqueada: boolean; motivo?: string } {
  if (nivelDesviacion(m) === "aprobacion" && !aprobada) {
    return {
      bloqueada: true,
      motivo: `El coste final se ha pasado ${m.desviacionEuros} € (${m.desviacionPct} %) de lo acordado y falta aprobarlo`,
    };
  }
  return { bloqueada: false };
}

/* ── Bandeja de excepciones ──────────────────────────────────────────────── */

/**
 * Los cajones de la bandeja.
 *
 * El operario trabaja por excepciones: lo que va bien no necesita que nadie lo
 * mire. Cada cajón es una pregunta con respuesta accionable, no una categoría
 * abstracta — «sin aceptar hace 40 minutos» se puede resolver llamando; «con
 * incidencias» no dice qué hacer.
 */
export const CAJONES = [
  "sin_aceptar",
  "sla_vencido",
  "error_integracion",
  "documentacion_pendiente",
  "coste_desviado",
  "webhook_fallido",
  "facturacion_bloqueada",
] as const;

export type Cajon = (typeof CAJONES)[number];

export const ETIQUETA_CAJON: Record<Cajon, string> = {
  sin_aceptar: "Sin aceptar",
  sla_vencido: "SLA vencido",
  error_integracion: "Errores de integración",
  documentacion_pendiente: "Documentación pendiente",
  coste_desviado: "Coste desviado",
  webhook_fallido: "Avisos sin entregar",
  facturacion_bloqueada: "Facturación bloqueada",
};

/**
 * Gravedad, que decide el orden en pantalla.
 *
 * Lo operativo va antes que lo administrativo: una grúa sin aceptar tiene a
 * alguien esperando en la carretera; un albarán que falta lleva tres días
 * faltando y puede esperar diez minutos más.
 */
export const GRAVEDAD: Record<Cajon, number> = {
  sla_vencido: 100,
  sin_aceptar: 90,
  error_integracion: 70,
  webhook_fallido: 60,
  coste_desviado: 40,
  facturacion_bloqueada: 30,
  documentacion_pendiente: 20,
};

export function ordenarCajones(cajones: Cajon[]): Cajon[] {
  return [...cajones].sort((a, b) => GRAVEDAD[b] - GRAVEDAD[a]);
}

/**
 * Minutos sin aceptar a partir de los cuales una asistencia entra en la
 * bandeja.
 *
 * Es un valor pequeño a propósito: el sentido de este cajón es cazar la que se
 * ha quedado colgada, y con media hora ya se ha perdido media hora.
 */
export const MINUTOS_SIN_ACEPTAR = 20;
