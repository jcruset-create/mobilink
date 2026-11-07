/**
 * Por qué un vehículo se ha quedado sin base en la ficha.
 *
 * El cálculo de la base habitual (`tc_base_habitual`) solo escribe cuando la
 * decisión es CLARA: al menos 24 horas en esa base y que sean el 60 % o más
 * de las que ha pasado en bases dentro de la ventana. Lo demás lo deja sin
 * tocar, que es lo correcto —una base mal puesta manda a un técnico al patio
 * equivocado— pero deja al que mira la lista con un hueco y sin explicación.
 *
 * Esto convierte esa fila de cálculo en una frase. Vive fuera del componente
 * porque es una decisión con criterio, y esas se prueban.
 */
import type { BaseHabitual } from "./data";

export interface MotivoSinBase {
  /** La frase corta de la fila. */
  texto: string;
  /** La letra pequeña del `title`, con los números detrás de la decisión. */
  detalle: string;
  /** `propuesta` es accionable hoy; `dudosa` y `sin_datos`, no. */
  clase: "propuesta" | "dudosa" | "sin_datos";
}

const pct = (cuota: number | null | undefined): string | null =>
  cuota == null || !Number.isFinite(cuota) ? null : `${Math.round(cuota * 100)} %`;

const horas = (h: number | null | undefined): string | null =>
  h == null || !Number.isFinite(h) ? null : `${Math.round(h)} h`;

/**
 * La explicación para un vehículo SIN base asignada.
 *
 * Devuelve null cuando no hay nada que explicar: o no se ha podido calcular
 * (y entonces es mejor callar que inventar un motivo), o el vehículo ya tiene
 * base, que es el caso en el que la fila enseña la base y no esto.
 */
export function motivoSinBase(fila: BaseHabitual | undefined): MotivoSinBase | null {
  if (!fila) return null;

  if (fila.decision === "sin_datos") {
    return {
      texto: "Sin datos de presencia",
      detalle:
        "No ha pasado por ninguna base en la ventana que se mira, o no está " +
        "vinculado con la telemática. Sin horas que contar, la base hay que escribirla a mano.",
      clase: "sin_datos",
    };
  }

  if (fila.decision === "clara" && fila.base_propuesta) {
    // Clara y la ficha vacía: el cálculo la pondría si se vuelve a pasar.
    const p = pct(fila.cuota);
    return {
      texto: `Se le puede poner ${fila.base_propuesta}${p ? ` (${p})` : ""}`,
      detalle:
        `Ha pasado ${horas(fila.horas) ?? "—"} en ${fila.base_propuesta}` +
        (p ? `, el ${p} de sus horas en bases` : "") +
        ". Es una decisión clara: se asigna sola desde «Base habitual».",
      clase: "propuesta",
    };
  }

  // Dudosa. Lo útil es ENTRE QUÉ duda, porque eso es lo que decide la persona.
  const primera = fila.base_propuesta;
  if (!primera) {
    return {
      texto: "Sin datos de presencia",
      detalle: "No hay ninguna base con horas en la ventana que se mira.",
      clase: "sin_datos",
    };
  }
  const p1 = pct(fila.cuota);
  const reparto = fila.horas_en_bases && fila.horas_segunda
    ? pct(fila.horas_segunda / fila.horas_en_bases)
    : null;

  if (fila.segunda) {
    return {
      texto: `Base dudosa: ${primera}${p1 ? ` ${p1}` : ""} · ${fila.segunda}${reparto ? ` ${reparto}` : ""}`,
      detalle:
        `Reparte las noches entre ${primera} (${horas(fila.horas) ?? "—"}) y ` +
        `${fila.segunda} (${horas(fila.horas_segunda) ?? "—"}). ` +
        "Hace falta el 60 % en una sola base para asignarla sola, así que la decide una persona.",
      clase: "dudosa",
    };
  }

  // Una sola base, pero con pocas horas medidas: no llega a las 24.
  return {
    texto: `Base dudosa: ${primera}${horas(fila.horas) ? `, solo ${horas(fila.horas)}` : ""}`,
    detalle:
      `Solo se le han medido ${horas(fila.horas) ?? "pocas"} en ${primera}, y hacen falta 24 ` +
      "para asignarla sola. Con una ventana de más días puede pasar a clara.",
    clase: "dudosa",
  };
}
