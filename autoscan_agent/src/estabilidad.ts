/**
 * Decidir cuándo un fichero ha terminado de escribirse.
 *
 * Es la regla que se pidió explícitamente: **no subir en cuanto salta el evento
 * del sistema de ficheros**. Windows avisa de que el fichero existe mucho antes
 * de que tenga dentro todo el lote, y ScanSnap Home además lo mueve y lo
 * renombra después de crearlo. Subir con el evento manda PDFs truncados que el
 * servidor acepta —son PDFs válidos, con menos páginas— y nadie se entera hasta
 * que falta una factura.
 *
 * ## Cómo se decide
 *
 * Se mira el fichero cada `muestreoMs`. Mientras cambie, se reinicia la cuenta.
 * Cuando lleva `estabilidadMs` sin cambiar, se da por terminado.
 *
 * Se compara **tamaño y fecha de modificación**, no solo el tamaño: un PDF
 * reescrito entero con el mismo número de páginas pesa lo mismo, y mirando solo
 * el tamaño parecería que nunca se ha tocado.
 *
 * ## Cero bytes nunca es estable
 *
 * El caso que más duele y el que menos se piensa. ScanSnap crea el fichero y
 * después escribe; si el escáner se queda a medias —papel atascado, el USB
 * fuera, el PC apagado— queda un fichero de 0 bytes que lleva quieto mucho más
 * de cinco segundos. Sin esta regla el agente lo daría por terminado y subiría
 * un documento vacío, que en el módulo aparece como una factura de verdad
 * esperando a que alguien la revise.
 *
 * ## Por qué es un módulo aparte y sin `fs`
 *
 * Aquí no se toca el disco: entran observaciones y sale una decisión. Así la
 * regla se prueba con una tabla en vez de con esperas reales, que es la única
 * manera de comprobar de verdad qué pasa cuando un fichero crece justo en el
 * último segundo.
 */

/** Lo que se ve del fichero en cada muestreo. */
export type Observacion = {
  tamano: number;
  /** `mtimeMs` del fichero. */
  modificadoMs: number;
};

export type Veredicto = "estable" | "cambiando" | "vacio";

type Registro = Observacion & {
  /** Desde cuándo se ve exactamente igual. */
  quietoDesdeMs: number;
};

export class Estabilizador {
  readonly #estabilidadMs: number;
  readonly #vistos = new Map<string, Registro>();

  constructor(estabilidadMs: number) {
    this.#estabilidadMs = estabilidadMs;
  }

  /**
   * Anota lo que se ve ahora y dice si el fichero ya se puede tocar.
   *
   * `vacio` no es `cambiando`: un fichero de 0 bytes puede quedarse así para
   * siempre, y quien llama necesita poder distinguir «espera un poco» de «esto
   * lleva media hora sin contenido, avisa».
   */
  observar(ruta: string, o: Observacion, ahora: number): Veredicto {
    if (o.tamano <= 0) {
      /*
       * Se sigue anotando para que, si empieza a llenarse, la cuenta arranque
       * desde ese momento y no desde que apareció vacío.
       */
      this.#vistos.set(ruta, { ...o, quietoDesdeMs: ahora });
      return "vacio";
    }

    const previo = this.#vistos.get(ruta);
    if (!previo || previo.tamano !== o.tamano || previo.modificadoMs !== o.modificadoMs) {
      this.#vistos.set(ruta, { ...o, quietoDesdeMs: ahora });
      return "cambiando";
    }

    return ahora - previo.quietoDesdeMs >= this.#estabilidadMs ? "estable" : "cambiando";
  }

  /**
   * Cuánto lleva quieto un fichero que ya se ha visto. `null` si no se conoce.
   *
   * Lo usa el aviso de la bandeja: un fichero vacío desde hace media hora es un
   * escaneo que salió mal, y decirlo vale más que esperarlo callado.
   */
  quietoDesdeMs(ruta: string): number | null {
    return this.#vistos.get(ruta)?.quietoDesdeMs ?? null;
  }

  /**
   * Olvida un fichero.
   *
   * Hay que llamarlo al encolarlo o al desaparecer: si no, el mapa crece con
   * cada escaneo del día y un agente que lleva meses arrancado se lo come todo
   * en memoria por ficheros que ya no existen.
   */
  olvidar(ruta: string): void {
    this.#vistos.delete(ruta);
  }

  /**
   * Olvida todos los que ya no estén en la carpeta.
   *
   * `olvidar()` cubre el fichero que se encola, que es el final feliz. Éste
   * cubre el otro camino: el que alguien mueve o borra a mano ANTES de que se
   * dé por terminado —un escaneo repetido, una prueba— y que si no nadie
   * volvería a nombrar nunca. Sin esto, el mapa crece con cada uno de esos y un
   * agente que lleva meses arrancado guarda ficheros que ya no existen.
   *
   * @returns cuántos se han olvidado.
   */
  olvidarLosQueNoEsten(presentes: ReadonlySet<string>): number {
    let n = 0;
    for (const ruta of [...this.#vistos.keys()]) {
      if (presentes.has(ruta)) continue;
      this.#vistos.delete(ruta);
      n += 1;
    }
    return n;
  }

  /** Cuántos ficheros se están vigilando. Para el resumen de la bandeja. */
  get vigilados(): number {
    return this.#vistos.size;
  }
}
