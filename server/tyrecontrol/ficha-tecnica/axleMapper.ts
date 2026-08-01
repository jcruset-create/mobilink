import type { EjeDetectado, ResultadoOcr } from "./ocrService.ts";

/**
 * Configuración de ejes de TyreControl.
 *
 * La configuración NO es la nomenclatura del fabricante: es el número de
 * NEUMÁTICOS que monta cada eje, de delante hacia atrás, unido con "x".
 *
 *   Tractora 2 ejes (4x2 del fabricante)      → 2x4
 *   Tractora 3 ejes con elevable (6x2)        → 2x2x4
 *   Tractora 3 ejes doble tracción (6x4)      → 2x4x4
 *   Semirremolque 3 ejes rueda simple         → 2x2x2
 *   Semirremolque 3 ejes rueda gemela         → 4x4x4
 *   Rígido 4 ejes                             → 2x2x4x4
 *
 * Por eso NO existe ninguna tabla de conversión fija (4x2 → 2x4): esa
 * equivalencia solo se cumple por casualidad en el caso de dos ejes, y falla
 * en cuanto hay tres. La configuración se CALCULA contando neumáticos.
 */

export interface EjeNormalizado {
  posicion: number;
  ruedas: number;
  directriz: boolean;
  motriz: boolean;
  elevable: boolean;
  medida?: string | null;
  indice_carga?: string | null;
  codigo_velocidad?: string | null;
}

export interface ConfiguracionCalculada {
  /** "2x2x4" — configuración operativa. Null si no se pudo determinar. */
  configuracion: string | null;
  ejes: EjeNormalizado[];
  /** Nomenclatura del fabricante tal cual venía ("6x2"), solo informativa. */
  configuracionConvencional: string | null;
  /** Por qué no se pudo calcular (para enseñárselo al técnico). */
  motivoPendiente?: string;
}

/** Categorías cuyo eje delantero NO es motriz ni suele llevar gemela. */
const CATEGORIAS_ARRASTRADAS = ["semirremolque", "remolque"];

/**
 * Calcula la configuración de TyreControl a partir de lo leído por el OCR.
 *
 * Orden de prioridad (el del documento manda; nunca se inventa):
 *   1. Neumáticos por eje explícitos.
 *   2. Deducción por medidas asociadas a cada eje.
 *   3. Categoría del vehículo (semirremolque/remolque → rueda simple).
 * Si tras eso queda algún eje sin resolver, se devuelve null y el técnico lo
 * valida a mano: es preferible pedir una confirmación que montar mal un plano.
 */
export function calcularConfiguracion(ocr: ResultadoOcr, categoria?: string | null): ConfiguracionCalculada {
  const ejes = normalizarEjes(ocr.ejes, categoria);

  if (!ejes.length) {
    return {
      configuracion: null,
      ejes: [],
      configuracionConvencional: ocr.config_convencional ?? null,
      motivoPendiente: "El documento no indica los ejes del vehículo.",
    };
  }

  const sinRuedas = ejes.filter((e) => !e.ruedas);
  if (sinRuedas.length) {
    return {
      configuracion: null,
      ejes,
      configuracionConvencional: ocr.config_convencional ?? null,
      motivoPendiente:
        `No se puede saber cuántos neumáticos monta ${sinRuedas.length === 1 ? "el eje" : "los ejes"} ` +
        sinRuedas.map((e) => e.posicion).join(", ") + ".",
    };
  }

  return {
    configuracion: ejes.map((e) => e.ruedas).join("x"),
    ejes,
    configuracionConvencional: ocr.config_convencional ?? null,
  };
}

function normalizarEjes(detectados: EjeDetectado[], categoria?: string | null): EjeNormalizado[] {
  const arrastrado = CATEGORIAS_ARRASTRADAS.some((c) =>
    (categoria ?? "").toLowerCase().includes(c));

  return [...(detectados ?? [])]
    .filter((e) => Number.isFinite(e.posicion))
    .sort((a, b) => a.posicion - b.posicion)
    .map((e) => {
      let ruedas = Number(e.ruedas) || 0;

      // Un semirremolque/remolque va siempre a rueda simple salvo que el
      // documento diga lo contrario: es la única deducción segura.
      if (!ruedas && arrastrado) ruedas = 2;

      // Solo se aceptan valores reales: 2 (simple) o 4 (gemela).
      if (ruedas !== 2 && ruedas !== 4) ruedas = 0;

      return {
        posicion: e.posicion,
        ruedas,
        directriz: e.directriz === true,
        motriz: e.motriz === true,
        elevable: e.elevable === true,
        medida: e.medida ?? null,
        indice_carga: e.indice_carga ?? null,
        codigo_velocidad: e.codigo_velocidad ?? null,
      };
    });
}

/**
 * Comprueba que la configuración calculada es coherente con la nomenclatura
 * del fabricante. No corrige nada: solo devuelve avisos para la revisión.
 */
export function avisosCoherencia(calc: ConfiguracionCalculada): string[] {
  const avisos: string[] = [];
  const conv = calc.configuracionConvencional;
  if (!conv || !calc.ejes.length) return avisos;

  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(conv.trim());
  if (!m) return avisos;

  // En la nomenclatura del fabricante el primer número son las ruedas
  // totales contando cada gemela como una: 6x2 = 3 ejes.
  const ejesConvencionales = Number(m[1]) / 2;
  if (Number.isFinite(ejesConvencionales) && ejesConvencionales !== calc.ejes.length) {
    avisos.push(
      `La nomenclatura del fabricante (${conv}) sugiere ${ejesConvencionales} ejes, ` +
      `pero se han leído ${calc.ejes.length}.`);
  }

  const motrices = calc.ejes.filter((e) => e.motriz).length;
  const motricesConvencionales = Number(m[2]) / 2;
  if (motrices && Number.isFinite(motricesConvencionales) && motrices !== motricesConvencionales) {
    avisos.push(
      `El fabricante indica ${motricesConvencionales} eje(s) motriz(es) y se han leído ${motrices}.`);
  }

  return avisos;
}
