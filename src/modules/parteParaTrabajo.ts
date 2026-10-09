import type { Job } from "./workshopTypes";
import type { TrabajoPropuesto } from "./parteTrabajoATrabajos";
import { normalizaTexto } from "./parteTrabajoATrabajos";

/**
 * Enganchar un parte del ERP a un trabajo que ya existe.
 *
 * ── Qué hace y qué NO hace ──────────────────────────────────────────────────
 *
 * Añade al trabajo lo que el parte aporta —su número, la hora de entrada del
 * vehículo, el material a montar y las tareas incluidas— y NADA más. No toca
 * la operación, ni el área, ni la matrícula, ni el técnico propuesto.
 *
 * Es a propósito: esos cuatro los decidió una persona al crear la entrada, y
 * un parte escaneado por una IA no es motivo para pisarlos. Quien quiera
 * cambiar la operación tiene su desplegable al lado.
 */

/** Lo que un parte aporta a un trabajo ya creado. */
export function camposDeParte(propuesto: {
  ptNumero: string;
  arrivedAtMs: number | null;
  materiales: TrabajoPropuesto["materiales"];
  tareasIncluidas: TrabajoPropuesto["tareasIncluidas"];
}): Partial<Job> {
  const numero = String(propuesto.ptNumero ?? "").trim();

  return {
    ptNumero: numero || null,
    // La hora del parte es cuando entró el vehículo, no cuando se escaneó el
    // papel. Si el parte no la trae, no se inventa.
    ...(propuesto.arrivedAtMs != null ? { ptEntradaMs: propuesto.arrivedAtMs } : {}),
    materiales: propuesto.materiales?.length ? propuesto.materiales : null,
    includedTasks: propuesto.tareasIncluidas?.length ? propuesto.tareasIncluidas : [],
  };
}

/** Solo el número, tecleado a mano cuando no hay papel que escanear. */
export function camposDeNumeroDeParte(numero: string): Partial<Job> {
  const limpio = String(numero ?? "").trim().toUpperCase();
  return { ptNumero: limpio || null };
}

/**
 * Cuál de los trabajos del parte es ÉSTE.
 *
 * Un parte puede traer varias líneas y varios vehículos. Se propone el que
 * coincide en matrícula —lo único que no se presta a interpretación—, y si no
 * hay ninguno se deja que lo elija una persona: adivinar por descripción es
 * cómo se acaba imputando el material al vehículo de al lado.
 */
export function indiceSugerido(
  trabajos: { plate: string }[],
  matriculaDelTrabajo: unknown
): number {
  const buscada = normalizaTexto(String(matriculaDelTrabajo ?? "")).replace(/[^A-Z0-9]/g, "");
  if (buscada.length < 4) return trabajos.length === 1 ? 0 : -1;

  const i = trabajos.findIndex(
    (t) => normalizaTexto(t.plate).replace(/[^A-Z0-9]/g, "") === buscada
  );
  if (i >= 0) return i;

  return trabajos.length === 1 ? 0 : -1;
}
