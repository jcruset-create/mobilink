/**
 * Qué CONCEPTO DE GASTO propone Cash para un ticket leído: dietas, peajes,
 * parking…
 *
 * Tercer hermano de `invoice-scan/classifier.ts` (forma de cobro) y
 * `invoice-scan/seccion.ts` (sección), con las mismas reglas del juego: entra
 * lo leído del papel, entran las reglas de la empresa y su catálogo de
 * conceptos, y sale una PROPUESTA. Sin base de datos, sin red, sin IA.
 *
 * ## El modelo lee; la empresa decide
 *
 * El modelo dice qué clase de negocio emite el papel —«es una autopista»—,
 * que es LEER. Qué concepto de ESTA empresa corresponde a eso —«Peajes», o
 * «Desplazamientos», o nada— lo dicen las reglas que alguien configuró. En
 * ningún sitio del esquema del modelo vive una regla de gasto, y así se puede
 * cambiar el catálogo sin tocar ni una línea de lo que se le pide leer.
 *
 * ## No lo sé ≠ Varios
 *
 * Si ninguna regla reconoce el ticket, no se propone nada. No hay un concepto
 * «por defecto»: un gasto clasificado a ojo en «Varios» parece un dato y
 * ensucia la estadística; un ticket sin concepto se ve y se rellena en dos
 * segundos. Y sin concepto no se puede presentar, así que el hueco no se
 * escapa.
 */

import { ivaCuadra } from "../invoice-scan/seccion.ts";
import type { Centimos } from "../domain/money.ts";

export type CampoConcepto = "TIPO_ESTABLECIMIENTO" | "NOMBRE_EMISOR" | "NIF_EMISOR" | "CONCEPTO";

export type ReglaConcepto = {
  id: number;
  campo: CampoConcepto;
  /** Se compara sin acentos y sin mayúsculas; el NIF, entero y sin puntuación. */
  patron: string;
  conceptoId: number;
  /** Cuánta fe merece, de 0 a 1. */
  confianza: number;
  /** Si puede rellenar el concepto sola, o solo sugerirlo. */
  autoSeleccionar: boolean;
  /** Primero las de número más bajo. Empates, por id. */
  prioridad: number;
};

export type EvidenciaConcepto = {
  tipoEstablecimiento: string;
  nombreEmisor: string | null;
  nifEmisor: string | null;
  concepto: string | null;
  baseCentimos: Centimos | null;
  ivaCentimos: Centimos | null;
  totalCentimos: Centimos | null;
  /** Lo que el modelo dice que le merece haber leído al emisor. */
  confianzaEmisor: number;
};

export type PropuestaConcepto = {
  /** null = NO LO SÉ. Nunca «el de siempre». */
  conceptoId: number | null;
  confianza: number;
  /** En castellano y para una persona: se enseña y se audita. */
  motivo: string;
  autoSeleccionar: boolean;
  reglaId: number | null;
};

/**
 * Umbral para rellenar el concepto solo.
 *
 * Como el de sección (0,8) y no como el de forma de cobro (0,9): un concepto
 * mal puesto no saca dinero de ningún sitio, se ve en la línea del ticket y la
 * persona tiene que dar el ticket por REVISADO antes de presentar. Hay un
 * segundo par de ojos obligatorio por delante.
 */
export const UMBRAL_CONCEPTO = 0.8;

function llano(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function nifLlano(texto: string | null | undefined): string {
  return llano(texto).replace(/[\s.\-/]/g, "");
}

function valorDelCampo(campo: CampoConcepto, e: EvidenciaConcepto): string | null {
  switch (campo) {
    case "TIPO_ESTABLECIMIENTO":
      // DESCONOCIDO no es un valor: es no haberlo leído. Ninguna regla casa con él.
      return e.tipoEstablecimiento === "DESCONOCIDO" ? null : e.tipoEstablecimiento;
    case "NOMBRE_EMISOR":
      return e.nombreEmisor;
    case "NIF_EMISOR":
      return e.nifEmisor;
    case "CONCEPTO":
      return e.concepto;
  }
}

/**
 * El tipo de establecimiento se compara ENTERO: «PARKING» no puede casar con
 * nada que lo contenga, es una palabra de una lista cerrada. El NIF también,
 * sin puntuación. Nombre y concepto son descriptivos y se comparan por trozos:
 * «aumar» tiene que casar con «AUTOPISTAS AUMAR, S.A.».
 */
function casa(campo: CampoConcepto, patron: string, valor: string): boolean {
  if (campo === "NIF_EMISOR") {
    const p = nifLlano(patron);
    return Boolean(p) && p === nifLlano(valor);
  }
  if (campo === "TIPO_ESTABLECIMIENTO") {
    const p = llano(patron);
    return Boolean(p) && p === llano(valor);
  }
  const p = llano(patron);
  const v = llano(valor);
  return Boolean(p) && Boolean(v) && v.includes(p);
}

const ETIQUETA: Record<CampoConcepto, string> = {
  TIPO_ESTABLECIMIENTO: "el tipo de establecimiento",
  NOMBRE_EMISOR: "el nombre del establecimiento",
  NIF_EMISOR: "el NIF del establecimiento",
  CONCEPTO: "el concepto del ticket",
};

/**
 * La propuesta de concepto.
 *
 * `activos` son los conceptos que la empresa tiene activos AHORA: una regla
 * que apunta a uno dado de baja se salta y se dice por qué, como en sección.
 */
export function clasificarConcepto(
  evidencia: EvidenciaConcepto,
  reglas: readonly ReglaConcepto[],
  activos: ReadonlySet<number>
): PropuestaConcepto {
  /*
   * Si las cifras del ticket no cuadran entre ellas, la lectura no es de fiar
   * y lo que se haya entendido del emisor tampoco. Se propone igual —un
   * concepto no mueve dinero— pero nunca solo.
   */
  const cuadra = ivaCuadra({
    cifEmisor: evidencia.nifEmisor,
    nombreEmisor: evidencia.nombreEmisor,
    numeroFactura: null,
    concepto: evidencia.concepto,
    baseCentimos: evidencia.baseCentimos,
    ivaCentimos: evidencia.ivaCentimos,
    totalCentimos: evidencia.totalCentimos,
    confianzaEmisor: evidencia.confianzaEmisor,
  });

  const ordenadas = [...reglas].sort((a, b) => a.prioridad - b.prioridad || a.id - b.id);
  let apuntaABaja = false;
  for (const regla of ordenadas) {
    const valor = valorDelCampo(regla.campo, evidencia);
    if (!valor || !casa(regla.campo, regla.patron, valor)) continue;
    if (!activos.has(regla.conceptoId)) {
      apuntaABaja = true;
      continue;
    }
    // La MENOR entre la de la regla y la que el modelo le da al emisor.
    const confianza = Math.min(regla.confianza, evidencia.confianzaEmisor);
    return {
      conceptoId: regla.conceptoId,
      confianza,
      motivo:
        `Regla «${regla.patron}» sobre ${ETIQUETA[regla.campo]}: ${valor}` +
        (cuadra === false ? ". Las cifras del ticket no cuadran: compruébalo." : ""),
      autoSeleccionar: regla.autoSeleccionar && confianza >= UMBRAL_CONCEPTO && cuadra !== false,
      reglaId: regla.id,
    };
  }

  return {
    conceptoId: null,
    confianza: 0,
    motivo: apuntaABaja
      ? "Una regla reconoce este ticket, pero su concepto está desactivado. Revísala en Configuración."
      : "Ninguna regla reconoce este ticket. Elige el concepto a mano.",
    autoSeleccionar: false,
    reglaId: null,
  };
}
