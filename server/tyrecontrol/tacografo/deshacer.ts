/**
 * Deshacer un lote: borrar lo que ESE lote metió, y nada más.
 *
 * ── Por qué esto necesita reglas y no un `delete` ───────────────────────────
 *
 * «Deshacer una importación» suena a una línea de SQL. No lo es, porque entre
 * la importación y el arrepentimiento puede haber pasado trabajo de una
 * persona:
 *
 *   · Alguien vinculó a mano una intervención que entró sin vehículo porque
 *     la matrícula no estaba. Borrarla le tira ese trabajo.
 *   · Alguien aceptó una propuesta de medida que salió de este lote, y eso ya
 *     escribió la medida habitual de un vehículo. Si se borra la evidencia,
 *     queda una medida puesta sin nada que la explique.
 *   · Alguien editó una fila.
 *
 * En los tres casos esto se NIEGA y dice cuál es el estorbo, en vez de borrar
 * y dejar el destrozo descubierto meses después. Quien quiera seguir adelante
 * tendrá que resolver primero lo que haya, a mano, mirándolo.
 *
 * ── Qué NO se borra, por construcción ───────────────────────────────────────
 *
 * Las filas que este lote se saltó por estar ya importadas conservan el
 * `lote_id` del lote que las metió de verdad. Deshacer un lote posterior no
 * las toca, porque nunca fueron suyas. Eso no es una comprobación: sale solo
 * de cómo se graba.
 *
 * Y el lote no se borra: se marca como deshecho. Que alguien importara 1.744
 * filas y las deshiciera media hora después es justo lo que hace falta para
 * entender qué pasó.
 */

/** Lo que hay que saber de un lote para decidir si se puede deshacer. */
export interface LoteParaDeshacer {
  id: string;
  empresaId: string;
  estado: string;
  importadas: number;
}

/** Una fila del lote, con lo justo para detectar que la tocaron después. */
export interface FilaDelLote {
  id: string;
  idOrigen: string;
  importadoEn: string;
  actualizadoEn: string;
  vinculadoEn: string | null;
}

export interface PropuestaDelLote {
  id: string;
  estado: string;
  matriculaNorm: string;
}

export type MotivoNegativa =
  | "no_existe" | "otra_empresa" | "ya_deshecho"
  | "filas_modificadas" | "vinculadas_a_mano" | "propuestas_aceptadas";

export interface Veredicto {
  puede: boolean;
  motivo?: MotivoNegativa;
  explicacion?: string;
  /** Los identificadores que estorban, para poder ir a mirarlos. */
  estorban?: string[];
  /** Cuántas filas se borrarían si se sigue adelante. */
  aBorrar: number;
}

/**
 * Margen entre `importado_en` y `actualizado_en` por debajo del cual no se
 * considera que la fila se haya tocado.
 *
 * El disparador pone `actualizado_en` en cada UPDATE, y la propia importación
 * puede hacer uno inmediatamente después del INSERT. Un segundo distingue eso
 * de una edición de verdad sin dejar pasar nada que importe: nadie edita una
 * fila en el mismo segundo en que se creó.
 */
const MARGEN_MS = 1000;

export function evaluar(
  lote: LoteParaDeshacer | null,
  empresaPedida: string,
  filas: FilaDelLote[],
  propuestas: PropuestaDelLote[],
): Veredicto {
  if (!lote) {
    return { puede: false, motivo: "no_existe", aBorrar: 0,
      explicacion: "Ese lote no existe." };
  }
  if (lote.empresaId !== empresaPedida) {
    return { puede: false, motivo: "otra_empresa", aBorrar: 0,
      explicacion: "Ese lote es de otra empresa." };
  }
  if (lote.estado === "deshecho") {
    return { puede: false, motivo: "ya_deshecho", aBorrar: 0,
      explicacion: "Ese lote ya se deshizo." };
  }

  const vinculadas = filas.filter((f) => f.vinculadoEn != null);
  if (vinculadas.length > 0) {
    return {
      puede: false, motivo: "vinculadas_a_mano", aBorrar: filas.length,
      estorban: vinculadas.map((f) => f.idOrigen),
      explicacion: `${vinculadas.length} intervención(es) de este lote se vincularon a mano a un `
        + `vehículo después de importarlas. Eso es trabajo de una persona y no se tira en un `
        + `deshacer: desvincúlalas primero si de verdad quieres borrarlas.`,
    };
  }

  const aceptadas = propuestas.filter((p) => p.estado === "aceptada");
  if (aceptadas.length > 0) {
    return {
      puede: false, motivo: "propuestas_aceptadas", aBorrar: filas.length,
      estorban: aceptadas.map((p) => p.matriculaNorm),
      explicacion: `${aceptadas.length} propuesta(s) de medida salidas de este lote ya se han `
        + `aceptado, y eso escribió la medida habitual de esos vehículos. Borrar la evidencia `
        + `dejaría una medida puesta sin nada que la explique.`,
    };
  }

  const tocadas = filas.filter((f) =>
    Date.parse(f.actualizadoEn) - Date.parse(f.importadoEn) > MARGEN_MS);
  if (tocadas.length > 0) {
    return {
      puede: false, motivo: "filas_modificadas", aBorrar: filas.length,
      estorban: tocadas.map((f) => f.idOrigen),
      explicacion: `${tocadas.length} intervención(es) de este lote se han modificado después de `
        + `importarlas. Míralas antes de borrarlas.`,
    };
  }

  return { puede: true, aBorrar: filas.length };
}
