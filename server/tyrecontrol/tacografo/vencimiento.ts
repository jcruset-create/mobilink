/**
 * Cuándo le toca el tacógrafo a un vehículo.
 *
 * ── Esto es una regla OPERATIVA, no la ley ──────────────────────────────────
 *
 * Para Plana se ha acordado: 24 meses desde la última intervención
 * registrada. Eso es un acuerdo con este cliente, y por eso la regla vive en
 * `tc_tacografo_regla`, por empresa, en vez de estar escrita aquí dentro. Lo
 * de aquí es solo la aritmética.
 *
 * ── Lo que dicen los datos sobre qué reinicia el plazo ──────────────────────
 *
 * La pregunta «¿una transferencia reinicia el plazo?» parecía abierta. Mirando
 * las 1.744 intervenciones del centro, no lo está tanto. El cruce de tipo con
 * resultado no deja ningún hueco:
 *
 *   Calibrado / Control / Reparación   1.295 «Favorable» +   5 «-----»
 *   Instalación / Activación             243 «-----»   (ninguna favorable)
 *   Transferencia / Intransferibilidad   201 «-----»   (ninguna favorable)
 *
 * O sea que «-----» NO significa «no se informó el resultado»: significa que
 * esa clase de intervención no lleva resultado en este informe. Solo los
 * calibrados lo llevan. Tratar «-----» como «salió mal» sería leer mal el
 * fichero.
 *
 * Y hay una segunda cosa, que es la que de verdad zanja la pregunta:
 *
 *   · Calibrado (1.300) e Instalación (243) traen SIEMPRE medida de
 *     neumático, cuentakilómetros y bastidor: son intervenciones técnicas con
 *     calibración de por medio.
 *   · De las 201 transferencias, solo 3 traen esos datos. Es un trámite
 *     documental de cambio de titular, no una calibración.
 *
 * Técnicamente, entonces, lo que reinicia un plazo de calibración es un
 * calibrado o una instalación, no una transferencia. Y resulta que en este
 * fichero da exactamente igual: **ningún vehículo tiene una transferencia como
 * última intervención** (616 terminan en calibrado y 107 en instalación), así
 * que excluirlas no mueve ni una fecha. Se ha comprobado:
 *
 *   cualquier intervención       vigente 557 · próxima 43 · vencida 123
 *   todas menos transferencias   vigente 557 · próxima 43 · vencida 123
 *   solo las «Favorable»         vigente 516 · próxima 43 · vencida 133 · 31 SIN DATOS
 *
 * Esa tercera fila es la que había que evitar: filtrar por «Favorable» deja 31
 * autobuses sin fecha de vencimiento pese a tener el tacógrafo instalado y
 * calibrado, porque su única intervención fue la instalación. Sería inventarse
 * un «sin datos» donde hay datos.
 *
 * Por eso el valor por defecto —y lo acordado— es que **cualquier intervención
 * registrada reinicia el plazo**, con los dos filtros disponibles en la tabla
 * para el día que haga falta afinarlo.
 */

/** La regla de una empresa. Los filtros a `null` significan «cualquiera». */
export interface Regla {
  meses: number;
  avisoDias: number;
  tiposReinician: string[] | null;
  resultadosReinician: string[] | null;
}

export const REGLA_POR_DEFECTO: Regla = {
  meses: 24,
  avisoDias: 60,
  tiposReinician: null,
  resultadosReinician: null,
};

/** Lo mínimo que hace falta saber de una intervención para contar el plazo. */
export interface Hito {
  fecha: string | null;
  tipoOperacion?: string | null;
  resultado?: string | null;
}

export type EstadoTacografo = "vigente" | "proxima" | "vencida" | "sin_datos";

export interface Vencimiento {
  /** La que ha reiniciado el plazo; null si ninguna cuenta. */
  ultima: string | null;
  proxima: string | null;
  /** Negativo cuando ya ha vencido. */
  diasRestantes: number | null;
  estado: EstadoTacografo;
}

/** ¿Esta intervención reinicia el plazo, según la regla? */
export function reinicia(h: Hito, regla: Regla): boolean {
  if (!h.fecha) return false;
  if (regla.tiposReinician && !regla.tiposReinician.includes(h.tipoOperacion ?? "")) return false;
  if (regla.resultadosReinician && !regla.resultadosReinician.includes(h.resultado ?? "")) return false;
  return true;
}

/**
 * Suma meses a una fecha ISO.
 *
 * El 31 de enero más un mes es el 28 de febrero, no el 3 de marzo. Sin esto,
 * `setMonth` desborda y un vencimiento acabaría cayendo en el mes siguiente.
 */
export function sumarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const total = (m - 1) + meses;
  const anio = a + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${String(anio).padStart(4, "0")}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

const dias = (desde: string, hasta: string): number =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

/**
 * El vencimiento de un vehículo a partir de su histórico.
 *
 * `hitos` puede venir en cualquier orden: se queda con la fecha más tardía de
 * las que reinician. Una intervención con fecha futura cuenta igual —el
 * informe puede traer la de hoy mismo— pero no se descarta en silencio.
 */
export function calcular(hitos: Hito[], regla: Regla, hoy: string): Vencimiento {
  let ultima: string | null = null;
  for (const h of hitos) {
    if (!reinicia(h, regla)) continue;
    if (!ultima || h.fecha! > ultima) ultima = h.fecha!;
  }
  if (!ultima) return { ultima: null, proxima: null, diasRestantes: null, estado: "sin_datos" };

  const proxima = sumarMeses(ultima, regla.meses);
  const restantes = dias(hoy, proxima);
  const estado: EstadoTacografo =
    restantes < 0 ? "vencida" : restantes <= regla.avisoDias ? "proxima" : "vigente";
  return { ultima, proxima, diasRestantes: restantes, estado };
}
