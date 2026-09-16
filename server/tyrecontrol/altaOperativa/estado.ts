/**
 * Qué le falta a un vehículo para poder trabajar con él.
 *
 * ── Operativo no es lo mismo que completo ───────────────────────────────────
 *
 * Un vehículo sin marca ni modelo se puede revisar perfectamente: se le miden
 * las gomas igual. Uno sin tipo de vehículo NO, porque sin tipo no hay plano,
 * sin plano no hay posiciones y sin posiciones no hay dónde colgar una
 * medición. Esa es la línea, y es la que separa esta lista de la de
 * «pendientes de validar» del panel:
 *
 *   · Alta OPERATIVA pendiente → el técnico no puede trabajar. Sale aquí.
 *   · Datos ADMINISTRATIVOS pendientes → marca, modelo, año, bastidor,
 *     delegación. Los completa oficina y NO devuelven el vehículo a esta cola.
 *
 * Mezclarlas fue el error que ya se cometió una vez: `pendiente_validar` marca
 * lo segundo, y por eso NO se usa aquí. Un vehículo puede estar perfectamente
 * operativo y seguir pendiente de validar, y al revés.
 *
 * ── Esto no necesita ninguna columna nueva ──────────────────────────────────
 *
 * El estado se CALCULA con lo que ya hay: el tipo del vehículo, las posiciones
 * de ese tipo, los montajes vigentes y las profundidades medidas. Guardar
 * además un campo «estado del alta» sería un segundo sitio donde mirar, y el
 * día que los dos no coincidieran habría que decidir cuál miente.
 *
 * Código PURO: no consulta nada. Quien lo llame trae los recuentos.
 */

/** Por qué un vehículo sigue sin poder usarse. En orden de qué toca antes. */
export type MotivoPendiente =
  /** No tiene tipo: sin tipo no hay plano. Es el primer paso del alta. */
  | "SIN_TIPO"
  /**
   * Tiene tipo, pero ese tipo no tiene posiciones.
   *
   * No lo arregla el técnico desde la tablet: las posiciones cuelgan del TIPO
   * y son de todos los vehículos que lo comparten. Se enseña para que se sepa
   * por qué no se puede seguir, y se avisa a oficina.
   */
  | "TIPO_SIN_PLANO"
  /** Faltan neumáticos por informar en alguna posición. */
  | "INVENTARIO_INCOMPLETO"
  /** Están todos los neumáticos, pero alguno sin profundidad inicial. */
  | "SIN_MEDICION_INICIAL";

/**
 * Lo que hay que saber de un vehículo para clasificarlo.
 *
 * Los recuentos son de POSICIONES, no de neumáticos sueltos: lo que se
 * pregunta es «¿está cubierto el plano?».
 */
export interface VehiculoParaAlta {
  id: string;
  matricula: string;
  /** null cuando aún no se le ha puesto tipo. */
  tipoId: string | null;
  /** Cuántas posiciones ACTIVAS tiene el tipo de este vehículo. 0 si no hay tipo. */
  posicionesDelTipo: number;
  /** En cuántas de esas posiciones hay hoy un neumático montado. */
  posicionesConNeumatico: number;
  /** En cuántas hay además una profundidad medida. */
  posicionesConProfundidad: number;
}

export interface EstadoAlta {
  /** true cuando el vehículo ya se puede revisar y operar con normalidad. */
  operativo: boolean;
  motivo: MotivoPendiente | null;
  /** La línea que lee el técnico en la tarjeta. */
  texto: string;
  /**
   * El progreso del inventario, cuando ya se ha empezado.
   *
   * Solo se rellena si tiene sentido enseñarlo: con el plano puesto. Antes de
   * eso un «0 de 0» no informa de nada.
   */
  progreso: { hechas: number; total: number } | null;
}

/** Cómo se llama el botón de la tarjeta según lo que toque hacer. */
export function accionDe(estado: EstadoAlta): string {
  switch (estado.motivo) {
    case "SIN_TIPO":
      return "Completar alta";
    case "TIPO_SIN_PLANO":
      return "Ver el problema";
    case "INVENTARIO_INCOMPLETO":
    case "SIN_MEDICION_INICIAL":
      return "Continuar inventario";
    default:
      return "Abrir";
  }
}

/**
 * Clasifica un vehículo.
 *
 * El orden de las comprobaciones es el orden del trabajo: primero el tipo,
 * luego que ese tipo tenga plano, luego los neumáticos y por último sus
 * medidas. Se devuelve SOLO el primer motivo que bloquea, porque es lo único
 * que el técnico puede hacer ahora mismo; enseñarle los cuatro a la vez no le
 * ayuda a decidir.
 */
export function estadoDeAlta(v: VehiculoParaAlta): EstadoAlta {
  if (!v.tipoId) {
    return { operativo: false, motivo: "SIN_TIPO", texto: "Pendiente: tipo y configuración", progreso: null };
  }
  if (v.posicionesDelTipo <= 0) {
    return {
      operativo: false,
      motivo: "TIPO_SIN_PLANO",
      texto: "Su tipo de vehículo no tiene plano",
      progreso: null,
    };
  }

  const total = v.posicionesDelTipo;
  // Los recuentos vienen de fuera, y de fuera puede llegar cualquier cosa: un
  // montaje sobre una posición ya desactivada cuenta en la consulta y no en el
  // plano. Se recorta para no enseñar nunca "7 de 6", que le haría dudar de
  // todo lo demás.
  const conNeumatico = Math.max(0, Math.min(v.posicionesConNeumatico, total));
  const conProfundidad = Math.max(0, Math.min(v.posicionesConProfundidad, conNeumatico));

  if (conNeumatico < total) {
    return {
      operativo: false,
      motivo: "INVENTARIO_INCOMPLETO",
      texto: `Inventario: ${conNeumatico} de ${total} neumáticos informados`,
      progreso: { hechas: conNeumatico, total },
    };
  }
  if (conProfundidad < total) {
    return {
      operativo: false,
      motivo: "SIN_MEDICION_INICIAL",
      texto: `Faltan profundidades: ${conProfundidad} de ${total} medidos`,
      progreso: { hechas: conProfundidad, total },
    };
  }
  return { operativo: true, motivo: null, texto: "Listo para revisar", progreso: { hechas: total, total } };
}

/** Los que siguen pendientes, en el orden en el que conviene atacarlos. */
export function pendientes(vehiculos: VehiculoParaAlta[]): Array<VehiculoParaAlta & { estado: EstadoAlta }> {
  /*
   * Primero los empezados y casi listos, no los que no se han tocado.
   *
   * Terminar un vehículo al que le falta una rueda lo saca de la cola hoy;
   * empezar uno de cero deja dos a medias. Dentro de cada grupo, por matrícula,
   * para que la lista no baile entre recargas.
   */
  const peso: Record<MotivoPendiente, number> = {
    SIN_MEDICION_INICIAL: 0,
    INVENTARIO_INCOMPLETO: 1,
    SIN_TIPO: 2,
    TIPO_SIN_PLANO: 3, // el último: no lo desbloquea el técnico
  };
  return vehiculos
    .map((v) => ({ ...v, estado: estadoDeAlta(v) }))
    .filter((v) => !v.estado.operativo)
    .sort((a, b) => {
      const pa = peso[a.estado.motivo!], pb = peso[b.estado.motivo!];
      if (pa !== pb) return pa - pb;
      // A igual motivo, el que más adelantado va.
      const fa = a.estado.progreso ? a.estado.progreso.hechas / a.estado.progreso.total : 0;
      const fb = b.estado.progreso ? b.estado.progreso.hechas / b.estado.progreso.total : 0;
      if (fa !== fb) return fb - fa;
      return a.matricula.localeCompare(b.matricula, "es", { numeric: true, sensitivity: "base" });
    });
}
