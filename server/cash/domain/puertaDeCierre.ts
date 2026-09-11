/**
 * ¿Se puede cerrar la jornada con lo que sabemos del cotejo con el ERP?
 *
 * Dominio puro: entra el último cotejo que se guardó y el estado de la jornada
 * ahora, sale un veredicto. Ni base de datos, ni IA, ni pantalla.
 *
 * ## Puerta con llave, no muro
 *
 * La regla de la casa es que no se cierra la caja sin haber cotejado contra el
 * ERP. Pero el cotejo se apoya en un modelo que lee una captura, y eso falla:
 * la pantalla sale torcida, el servicio no responde, el ERP está caído. Un
 * bloqueo duro dejaría al mostrador sin poder cerrar la caja por un motivo que
 * no tiene nada que ver con el dinero, y el remedio de la gente sería el peor
 * posible: cerrar de cualquier manera al día siguiente, o no cerrar.
 *
 * Así que se puede forzar. Lo que NO se puede es forzar sin decir por qué: el
 * motivo es obligatorio, se queda escrito en la jornada y en la auditoría, y
 * eso convierte un atajo silencioso en una decisión con nombre y apellidos.
 *
 * Es el mismo criterio que `permitirCajaVacia` en el cierre: lo raro se puede
 * hacer, pero a propósito.
 *
 * ## Un cotejo caduca
 *
 * Y esto es la mitad del valor de la puerta. Cotejar a las seis, meter dos
 * cobros a las siete y cerrar a las ocho enseñando el OK de las seis es peor
 * que no cotejar: da por revisado algo que nadie ha mirado. Por eso el cotejo
 * se guarda con una huella de la jornada, y si la jornada ha cambiado desde
 * entonces el OK ya no vale.
 */

/** Lo que se guardó la última vez que alguien cotejó esta jornada. */
export type CotejoGuardado = {
  /** El informe daba todo por cuadrado. */
  cuadra: boolean;
  /** Cómo estaba la jornada cuando se cotejó. */
  huella: string;
  creadoEnMs: number;
};

/**
 * El discriminante es TEXTO y no un booleano, y no es capricho.
 *
 * El typecheck del servidor corre con `strict: false`, y sin `strictNullChecks`
 * TypeScript no estrecha una unión por un discriminante `true`/`false`: dentro
 * del `if` seguiría viendo las dos ramas y `motivo` no existiría. Se descubrió
 * aquí, compilando. Con texto estrecha igual en los dos modos.
 */
export type VeredictoDeCierre =
  /** Adelante. `forzado` = ha hecho falta la llave. */
  | { deja: "SIGUE"; forzado: boolean }
  | { deja: "PARA"; motivo: "FALTA_COTEJO" | "COTEJO_CADUCADO" | "COTEJO_NO_CUADRA" };

/**
 * La huella de la jornada: con esto se sabe si el cotejo sigue valiendo.
 *
 * Las DOS cifras, porque cada una se le escapa a la otra. La suma no cambia si
 * se anula un cobro de 50 € y se mete otro de 50 €; el último id no cambia si
 * se corrige un importe, ni si se anula la última —la anulación deja la
 * operación donde estaba y le cambia el estado—.
 *
 * ── Y por qué NO va también el número de operaciones ──────────────────────
 *
 * Estaba, y se quitó al ver que ninguna prueba podía matarlo: el importe de una
 * operación es siempre mayor que cero (`IMPORTE_NO_VALIDO`), así que cualquier
 * cambio en cuántas hay mueve la suma por fuerza. Un campo que no se puede
 * distinguir promete una protección que no da, y el día que alguien mire esto
 * para entender qué se vigila, le sobraría un tercio.
 */
export function huellaDeJornada(resumen: {
  ultimaOperacionId: number;
  sumaCentimos: number;
}): string {
  return `${resumen.ultimaOperacionId}:${resumen.sumaCentimos}`;
}

/**
 * El veredicto.
 *
 * `forzar` no es un «sí» que se pasa por encima de la comprobación: es la
 * llave, y quien la usa firma. Por eso llega como el motivo escrito y no como
 * un booleano — un `true` se pone sin pensar; una frase, no tanto.
 */
export function puertaDeCierre(
  cotejo: CotejoGuardado | null,
  huellaAhora: string,
  motivoParaForzar: string | null | undefined
): VeredictoDeCierre {
  const forzado = Boolean(motivoParaForzar && motivoParaForzar.trim());

  if (!cotejo) {
    /*
     * Sin cotejo NINGUNO. Se puede forzar, y es el caso que hace falta que se
     * pueda: si el servicio que lee la captura está caído, no hay manera
     * humana de producir un cotejo, y la caja tiene que poder cerrarse igual.
     */
    return forzado
      ? { deja: "SIGUE", forzado: true }
      : { deja: "PARA", motivo: "FALTA_COTEJO" };
  }

  if (cotejo.huella !== huellaAhora) {
    /*
     * Se cotejó, pero después se tocó la jornada. El OK que hay guardado habla
     * de otra caja. Lo barato aquí es volver a cotejar —es pegar una captura—
     * así que se pide, en vez de dar por buena una foto vieja.
     */
    return forzado
      ? { deja: "SIGUE", forzado: true }
      : { deja: "PARA", motivo: "COTEJO_CADUCADO" };
  }

  if (!cotejo.cuadra) {
    return forzado
      ? { deja: "SIGUE", forzado: true }
      : { deja: "PARA", motivo: "COTEJO_NO_CUADRA" };
  }

  /*
   * Cuadra y está al día. Se cierra sin más, y sin marcar nada como forzado
   * aunque venga un motivo escrito: no se ha saltado ninguna comprobación, y
   * anotar «cierre forzado» en una jornada que cuadraba sería mentir en el
   * histórico.
   */
  return { deja: "SIGUE", forzado: false };
}
