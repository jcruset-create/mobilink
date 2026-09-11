/**
 * Cotejar la caja del ERP contra la de Mobilink.
 *
 * Dominio puro: dos listas entran, un informe sale. Ni base de datos, ni IA, ni
 * pantalla. Quien lee la captura es otro —y puede leer mal—; lo que se decide
 * aquí es qué significa lo leído, y eso tiene que poder probarse sin depender
 * de un modelo que da respuestas distintas para la misma imagen.
 *
 * ## Lo que este módulo NO hace, y no es un olvido
 *
 * **No crea nada.** Un cotejo informa; los cobros los mete una persona por la
 * pantalla de siempre, con sus validaciones y su detalle de piezas. Crear
 * movimientos de dinero a partir de una captura es la automatización que sale
 * mal el día que el modelo lea 377,24 como 377,74 — y saldría mal en silencio,
 * porque el descuadre lo vería el arqueo tres horas después.
 *
 * **No adivina equivalencias de formas de pago.** «Datáfono Clearone» y «TPV
 * CAIXA» son etiquetas del ERP, y a qué forma de Mobilink corresponden lo dice
 * una tabla que alguien configura. Si eso lo dedujera el modelo, un día
 * decidiría distinto y el cotejo mentiría sin cambiar una línea de código.
 *
 * ## Por qué el emparejamiento manda la REFERENCIA y no el importe
 *
 * `B2_26/611` identifica una operación. «29,69 €» no: dos cobros de 50 € por
 * tarjeta el mismo día son indistinguibles por importe, y emparejarlos al azar
 * da un informe que dice «todo correcto» habiendo cruzado el de un cliente con
 * el de otro.
 *
 * Así que hay dos pasadas. Primero por referencia, que es exacta. Lo que queda
 * se intenta por importe y forma de pago, y **solo cuando no hay duda**: si dos
 * candidatos encajan igual de bien, no se elige — se declara ambiguo y lo mira
 * una persona. Un emparejamiento inventado es peor que un hueco señalado,
 * porque el hueco se ve y el invento no.
 */

import type { Centimos } from "./money.ts";

/** Una línea leída del ERP. Tal cual se leyó, sin interpretar. */
export type LineaErp = {
  /** El número de justificante del ERP, si lo hay. Solo para poder señalarla. */
  justificante?: string | null;
  /** La referencia del documento: «B2_26/611». Es la clave fuerte. */
  referencia?: string | null;
  /** La etiqueta de forma de pago TAL CUAL la escribe el ERP. */
  formaErp: string;
  /** Positivo siempre. El sentido lo da `tipo`. */
  importeCentimos: Centimos;
  tipo: "COBRO" | "PAGO";
  /** Lo que ponga el concepto, para poder enseñarlo al humano. */
  concepto?: string | null;
};

/** Una operación de Mobilink, reducida a lo que el cotejo necesita. */
export type LineaMobilink = {
  id: number;
  numero: string;
  referencia?: string | null;
  /** Código del catálogo de formas de cobro. */
  formaCodigo: string;
  importeCentimos: Centimos;
  tipo: "COBRO" | "PAGO";
  concepto?: string | null;
};

/**
 * Qué etiqueta del ERP es qué forma de Mobilink.
 *
 * Configuración, no deducción. Lo que no esté aquí no se empareja por forma de
 * pago: se dice que falta el equivalente, que es información útil —«tienes una
 * etiqueta del ERP sin configurar»— y no un fallo.
 */
export type Equivalencias = ReadonlyMap<string, string>;

export type Emparejada = {
  erp: LineaErp;
  mobilink: LineaMobilink;
  /** Por qué se emparejaron. Se enseña: no es lo mismo una que otra. */
  por: "referencia" | "importe";
};

export type Ambigua = {
  erp: LineaErp;
  /** Los que encajaban igual de bien. Ninguno se ha elegido. */
  candidatos: LineaMobilink[];
};

export type Informe = {
  /** Cuadran: misma referencia o mismo importe y forma, sin duda. */
  emparejadas: Emparejada[];
  /** Está en el ERP y no en Mobilink. */
  soloEnErp: LineaErp[];
  /** Está en Mobilink y no en el ERP. */
  soloEnMobilink: LineaMobilink[];
  /** Encajaba con varios. No se elige por su cuenta. */
  ambiguas: Ambigua[];
  /** Etiquetas del ERP que no están en la tabla de equivalencias. */
  formasSinEquivalencia: string[];
  totales: {
    erpCobros: Centimos;
    erpPagos: Centimos;
    mobilinkCobros: Centimos;
    mobilinkPagos: Centimos;
    /** ERP menos Mobilink. Cero en las dos = los totales cuadran. */
    diferenciaCobros: Centimos;
    diferenciaPagos: Centimos;
  };
  /**
   * Todo cuadra: nada suelto por ningún lado, nada ambiguo y los totales a cero.
   *
   * Se exige lo uno Y lo otro a propósito. Con solo los totales, un cobro de
   * más y uno de menos por el mismo importe darían «correcto» habiendo dos
   * errores; con solo las líneas, un céntimo de diferencia en un importe
   * emparejado por referencia pasaría desapercibido.
   */
  cuadra: boolean;
};

/** La referencia, normalizada: es lo único que se compara entre dos sistemas. */
function normalizarReferencia(r: string | null | undefined): string | null {
  if (!r) return null;
  /*
   * Fuera espacios, guiones, barras y puntos, y todo a mayúsculas. El mismo
   * documento se escribe «B2_26/611», «B2 26/611» y «b2-26-611» según quién lo
   * teclee o cómo lo lea el modelo, y sin esto el cotejo cae a emparejar por
   * importe justo cuando tenía la clave buena delante.
   */
  const limpia = r.trim().toUpperCase().replace(/[\s\-/._]/g, "");
  return limpia || null;
}

export function cotejar(
  erp: readonly LineaErp[],
  mobilink: readonly LineaMobilink[],
  equivalencias: Equivalencias
): Informe {
  const emparejadas: Emparejada[] = [];
  const ambiguas: Ambigua[] = [];
  const sinEquivalencia = new Set<string>();

  /* Lo que queda por emparejar de cada lado. Se va vaciando. */
  const pendientesErp = [...erp];
  const pendientesMob = [...mobilink];

  const sacar = (lista: LineaMobilink[], l: LineaMobilink) => {
    const i = lista.indexOf(l);
    if (i >= 0) lista.splice(i, 1);
  };

  // ── Primera pasada: por referencia, que es exacta ──────────────────────────
  for (const e of [...pendientesErp]) {
    const ref = normalizarReferencia(e.referencia);
    if (!ref) continue;

    const iguales = pendientesMob.filter(
      (m) => m.tipo === e.tipo && normalizarReferencia(m.referencia) === ref
    );
    /*
     * Con más de uno tampoco se elige. Dos operaciones de Mobilink con la misma
     * referencia y el mismo tipo es en sí un problema —un cobro duplicado— y
     * taparlo emparejando una al azar es justo lo contrario de lo que se pide.
     */
    if (iguales.length === 1) {
      emparejadas.push({ erp: e, mobilink: iguales[0]!, por: "referencia" });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
      sacar(pendientesMob, iguales[0]!);
    } else if (iguales.length > 1) {
      ambiguas.push({ erp: e, candidatos: iguales });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
    }
  }

  // ── Segunda pasada: por importe y forma, y solo sin dudas ──────────────────
  for (const e of [...pendientesErp]) {
    const codigo = equivalencias.get(e.formaErp.trim().toUpperCase());
    if (!codigo) {
      /*
       * Sin equivalencia NO se empareja por importe a secas. Sería colar un
       * cobro por tarjeta contra uno en efectivo del mismo importe, que es
       * precisamente el error que este cotejo tiene que encontrar.
       */
      sinEquivalencia.add(e.formaErp.trim());
      continue;
    }

    const encajan = pendientesMob.filter(
      (m) =>
        m.tipo === e.tipo &&
        m.importeCentimos === e.importeCentimos &&
        m.formaCodigo === codigo
    );
    if (encajan.length === 1) {
      emparejadas.push({ erp: e, mobilink: encajan[0]!, por: "importe" });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
      sacar(pendientesMob, encajan[0]!);
    } else if (encajan.length > 1) {
      ambiguas.push({ erp: e, candidatos: encajan });
      pendientesErp.splice(pendientesErp.indexOf(e), 1);
    }
  }

  const suma = (ls: readonly { importeCentimos: Centimos; tipo: string }[], t: string) =>
    ls.filter((l) => l.tipo === t).reduce((a, l) => a + l.importeCentimos, 0);

  const erpCobros = suma(erp, "COBRO");
  const erpPagos = suma(erp, "PAGO");
  const mobilinkCobros = suma(mobilink, "COBRO");
  const mobilinkPagos = suma(mobilink, "PAGO");

  const totales = {
    erpCobros,
    erpPagos,
    mobilinkCobros,
    mobilinkPagos,
    diferenciaCobros: erpCobros - mobilinkCobros,
    diferenciaPagos: erpPagos - mobilinkPagos,
  };

  return {
    emparejadas,
    soloEnErp: pendientesErp,
    soloEnMobilink: pendientesMob,
    ambiguas,
    formasSinEquivalencia: [...sinEquivalencia].sort(),
    totales,
    cuadra:
      pendientesErp.length === 0 &&
      pendientesMob.length === 0 &&
      ambiguas.length === 0 &&
      totales.diferenciaCobros === 0 &&
      totales.diferenciaPagos === 0,
  };
}
