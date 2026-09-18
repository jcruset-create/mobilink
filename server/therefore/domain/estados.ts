/**
 * El vocabulario del módulo y las transiciones que se admiten.
 *
 * Código PURO: sin base de datos y sin red, para poder probar casos concretos
 * en vez de sembrar media base. Es el mismo criterio que `acuerdos/dominio.ts`.
 *
 * ── Tres ejes que NO son el mismo ───────────────────────────────────────────
 *
 * El error que este fichero existe para evitar es mezclar en una sola columna
 * cosas que cambian por motivos distintos:
 *
 *   · `estado`            — en qué punto de la gestión está el expediente.
 *   · `prioridad`         — cuánto corre (ver `prioridad.ts`).
 *   · `numeroReclamaciones` — cuántas veces han vuelto a pedirlo.
 *
 * Por eso **«RECLAMADO» no es un estado**. Una incidencia perfectamente normal
 * puede estar en PENDIENTE con tres reclamaciones y prioridad CRÍTICA; si
 * «reclamado» fuera un estado habría que elegir entre esa información y la de
 * en qué punto está la gestión, y se perdería una de las dos. En la bandeja
 * «Reclamados» es un filtro, no una columna.
 *
 * ── Tampoco es un estado la acción ──────────────────────────────────────────
 *
 * GRABAR y MODIFICAR no son tipos de expediente: un mismo correo pide grabar
 * dos albaranes y modificar un tercero. La acción vive en la ACTUACIÓN, y el
 * expediente sólo dice de qué va (incidencia de albarán, aprobación de
 * factura, otro).
 */

/* ── Tipos de expediente ─────────────────────────────────────────────────── */

export const TIPOS_EXPEDIENTE = [
  "INCIDENCIA_ALBARAN",
  "APROBACION_FACTURA",
  "OTRO",
] as const;
export type TipoExpediente = (typeof TIPOS_EXPEDIENTE)[number];

export function esTipoExpediente(v: unknown): v is TipoExpediente {
  return typeof v === "string" && (TIPOS_EXPEDIENTE as readonly string[]).includes(v);
}

/* ── Acciones de una actuación ───────────────────────────────────────────── */

/**
 * `APROBAR` no está en la lista inicial del encargo y se añade a propósito: un
 * expediente de aprobación de factura tiene que tener algo que resolver, y sin
 * una actuación sería el único tipo que se resuelve sin haber hecho nada. Es
 * una ampliación de la lista, no un cambio de las que ya había.
 */
export const TIPOS_ACCION = [
  "GRABAR",
  "MODIFICAR",
  "REVISAR",
  "GESTIONAR",
  "ANULAR",
  "APROBAR",
  "OTRO",
] as const;
export type TipoAccion = (typeof TIPOS_ACCION)[number];

export function esTipoAccion(v: unknown): v is TipoAccion {
  return typeof v === "string" && (TIPOS_ACCION as readonly string[]).includes(v);
}

/* ── Estados del expediente ──────────────────────────────────────────────── */

/**
 * `DESCARTADO` es «esto no era una tarea».
 *
 * Un correo que no iba a ninguna parte, una prueba, un expediente abierto por
 * error. No es CERRADO —que significa gestionado y terminado, y cuenta en las
 * estadísticas de trabajo hecho— ni se borra de la base: el correo que lo
 * abrió, sus adjuntos y su histórico siguen ahí, porque la pregunta «¿y esto
 * qué fue?» se hace meses después. Lo que hace es desaparecer de la bandeja,
 * que es lo que a nadie le sirve tener delante.
 */
export const ESTADOS_EXPEDIENTE = [
  "NUEVO",
  "PENDIENTE",
  "EN_PROCESO",
  "BLOQUEADO",
  "RESUELTO",
  "CERRADO",
  "DESCARTADO",
] as const;
export type EstadoExpediente = (typeof ESTADOS_EXPEDIENTE)[number];

export function esEstadoExpediente(v: unknown): v is EstadoExpediente {
  return typeof v === "string" && (ESTADOS_EXPEDIENTE as readonly string[]).includes(v);
}

/** Estados en los que el expediente todavía es trabajo de alguien. */
export const ESTADOS_ABIERTOS: readonly EstadoExpediente[] = [
  "NUEVO",
  "PENDIENTE",
  "EN_PROCESO",
  "BLOQUEADO",
];

export function estaAbierto(e: EstadoExpediente): boolean {
  return ESTADOS_ABIERTOS.includes(e);
}

/**
 * Qué se puede hacer desde dónde.
 *
 * Dos decisiones que no son evidentes:
 *
 * · **RESUELTO vuelve a PENDIENTE, no a EN_PROCESO.** Reabrir es empezar de
 *   nuevo la gestión, y quien lo reabre no tiene por qué ser quien la tenía a
 *   medias. Dejarlo en EN_PROCESO diría que alguien está trabajando en ello.
 *
 * · **CERRADO se puede reabrir.** Un cierre por antigüedad (30 días sin
 *   actividad) no es una decisión que nadie tomó: es el paso del tiempo. Si
 *   Therefore vuelve a reclamar, tiene que poder volver a la cola.
 */
const TRANSICIONES_EXPEDIENTE: Record<EstadoExpediente, readonly EstadoExpediente[]> = {
  NUEVO: ["PENDIENTE", "EN_PROCESO", "BLOQUEADO", "RESUELTO", "CERRADO", "DESCARTADO"],
  PENDIENTE: ["EN_PROCESO", "BLOQUEADO", "RESUELTO", "CERRADO", "DESCARTADO"],
  EN_PROCESO: ["PENDIENTE", "BLOQUEADO", "RESUELTO", "CERRADO", "DESCARTADO"],
  BLOQUEADO: ["PENDIENTE", "EN_PROCESO", "RESUELTO", "CERRADO", "DESCARTADO"],
  RESUELTO: ["PENDIENTE", "CERRADO", "DESCARTADO"],
  CERRADO: ["PENDIENTE", "DESCARTADO"],
  // Descartar se deshace: se vuelve a la cola y se explica por qué.
  DESCARTADO: ["PENDIENTE"],
};

export function transicionesDesde(estado: EstadoExpediente): readonly EstadoExpediente[] {
  return TRANSICIONES_EXPEDIENTE[estado] ?? [];
}

export function puedeTransicionar(de: EstadoExpediente, a: EstadoExpediente): boolean {
  return transicionesDesde(de).includes(a);
}

/**
 * Transiciones que no se hacen sin escribir por qué.
 *
 * Bloquear y reabrir son las dos que le cuestan tiempo a otra persona: quien se
 * encuentre el expediente mañana necesita saber qué se estaba esperando o por
 * qué volvió. Resolver también lo pide cuando no hay actuaciones que lo
 * justifiquen —ver `expedienteResoluble`—, y eso lo decide el servicio.
 */
export function exigeMotivo(de: EstadoExpediente, a: EstadoExpediente): boolean {
  if (a === "BLOQUEADO") return true;
  if ((de === "RESUELTO" || de === "CERRADO" || de === "DESCARTADO") && a === "PENDIENTE") return true;
  return false;
}

/** Descartado no es un estado de trabajo: no sale en la bandeja ni se cuenta. */
export function estaDescartado(e: EstadoExpediente): boolean {
  return e === "DESCARTADO";
}

/* ── Estados de la actuación ─────────────────────────────────────────────── */

export const ESTADOS_ACTUACION = [
  "PENDIENTE",
  "EN_PROCESO",
  "BLOQUEADA",
  "RESUELTA",
  "DESCARTADA",
] as const;
export type EstadoActuacion = (typeof ESTADOS_ACTUACION)[number];

export function esEstadoActuacion(v: unknown): v is EstadoActuacion {
  return typeof v === "string" && (ESTADOS_ACTUACION as readonly string[]).includes(v);
}

/**
 * `DESCARTADA` es terminal, y es la diferencia con el expediente.
 *
 * Una actuación se descarta cuando un cambio de instrucción la deja sin efecto
 * («ya no lo grabes, modifícalo»). Deshacer eso no es revivir la vieja: es
 * volver a pedir la acción, que crea otra actuación y deja las dos en el
 * histórico. Si se pudiera resucitar, el índice único de
 * (expediente, acción, albarán) —que es lo que impide duplicar actuaciones al
 * llegar una reclamación— tendría dos filas vivas iguales.
 */
const TRANSICIONES_ACTUACION: Record<EstadoActuacion, readonly EstadoActuacion[]> = {
  PENDIENTE: ["EN_PROCESO", "BLOQUEADA", "RESUELTA", "DESCARTADA"],
  EN_PROCESO: ["PENDIENTE", "BLOQUEADA", "RESUELTA", "DESCARTADA"],
  BLOQUEADA: ["PENDIENTE", "EN_PROCESO", "RESUELTA", "DESCARTADA"],
  RESUELTA: ["PENDIENTE"],
  DESCARTADA: [],
};

export function transicionesDeActuacionDesde(
  estado: EstadoActuacion
): readonly EstadoActuacion[] {
  return TRANSICIONES_ACTUACION[estado] ?? [];
}

export function puedeTransicionarActuacion(de: EstadoActuacion, a: EstadoActuacion): boolean {
  return transicionesDeActuacionDesde(de).includes(a);
}

/** Una actuación que ya no espera trabajo: resuelta o descartada. */
export function actuacionCerrada(e: EstadoActuacion): boolean {
  return e === "RESUELTA" || e === "DESCARTADA";
}

/* ── El expediente en función de sus actuaciones ─────────────────────────── */

export type ActuacionParaEstado = {
  estado: EstadoActuacion;
  obligatoria: boolean;
};

/**
 * ¿Se puede dar por resuelto el expediente mirando sus actuaciones?
 *
 * Sí cuando **hay** actuaciones obligatorias y todas están cerradas. Un
 * expediente SIN actuaciones no se resuelve solo: no hay nada de lo que
 * deducir que el trabajo esté hecho, y darlo por resuelto en cuanto se crea
 * sería la peor manera de vaciar la bandeja. Ése se resuelve a mano, con
 * motivo, y es lo que hace el servicio con los de tipo OTRO.
 */
export function expedienteResoluble(actuaciones: readonly ActuacionParaEstado[]): boolean {
  const obligatorias = actuaciones.filter((a) => a.obligatoria);
  if (obligatorias.length === 0) return false;
  return obligatorias.every((a) => actuacionCerrada(a.estado));
}

/**
 * ¿Hay alguien trabajando en esto ya?
 *
 * Sirve para que iniciar la primera actuación mueva el expediente a
 * EN_PROCESO sin que nadie tenga que acordarse de cambiarlo a mano.
 */
export function expedienteEnProceso(actuaciones: readonly ActuacionParaEstado[]): boolean {
  return actuaciones.some((a) => a.estado === "EN_PROCESO");
}

/* ── Prioridad (el vocabulario; el cálculo va en prioridad.ts) ───────────── */

export const PRIORIDADES = ["BAJA", "NORMAL", "ALTA", "CRITICA"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

export function esPrioridad(v: unknown): v is Prioridad {
  return typeof v === "string" && (PRIORIDADES as readonly string[]).includes(v);
}
