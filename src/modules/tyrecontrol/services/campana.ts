/**
 * Lo que enseña la campana, que ahora son dos cosas distintas.
 *
 * Hasta hoy la campana solo leía `tc_webfleet_alertas`: «ha entrado en base
 * con una revisión pendiente». Ahora también enseña los avisos de presión de
 * Goodyear, que viven en `tc_alertas_presion`.
 *
 * ── Por qué se mezclan aquí y no en la base ────────────────────────────────
 *
 * La alternativa era copiar los avisos de presión a `tc_webfleet_alertas`
 * para que la campana siguiera leyendo de un solo sitio. Serían DOS FUENTES
 * DE VERDAD para el mismo hecho: el día que una se actualizara y la otra no
 * —y pasaría, porque un aviso de presión se repite y se resuelve— la campana
 * y la ficha del vehículo dirían cosas distintas del mismo neumático.
 *
 * Se leen las dos y se juntan aquí, que es la vista y no el dato.
 *
 * ── La diferencia que importa: el ✓ ────────────────────────────────────────
 *
 * Un aviso de base se «marca como leído» y desaparece. Eso tiene sentido:
 * era un recordatorio.
 *
 * Un aviso de presión NO. Quitarlo de la vista no infla la rueda. Si se
 * pudiera despachar con un toque desde la campana, el gesto cómodo sería
 * justo el que deja el neumático bajo y la pantalla limpia. Así que la
 * campana lo enseña, lleva al vehículo, y el aviso se va cuando alguien lo da
 * por resuelto donde resolverlo significa algo —la ficha o la tablet—.
 *
 * Es menos cómodo a propósito: una rueda con una fuga debe seguir dando la
 * lata.
 */

import type { AlertaPresion, WebfleetAlerta } from "../types";
import { nombreDelTipo, textoDePresion, textoDeRepeticion } from "./alertasPresion";

/** Un aviso cualquiera, ya listo para pintarlo. */
export interface AvisoCampana {
  /** Único dentro de la campana: el id de origen puede repetirse entre tablas. */
  clave: string;
  origen: "base" | "presion";
  id: string;
  vehiculoId: string | null;
  texto: string;
  /** Lo que se dice debajo, cuando hay algo más que decir. */
  detalle: string | null;
  /** Para ordenar y para enseñar «hace cuánto». ISO, o null si no se sabe. */
  instante: string | null;
  /** Solo los de base se pueden quitar de la vista. Ver la cabecera. */
  sePuedeMarcarLeido: boolean;
}

/** Un aviso de entrada en base, como lo enseña la campana. */
export function avisoDeBase(a: WebfleetAlerta): AvisoCampana {
  return {
    clave: `base:${a.id}`,
    origen: "base",
    id: a.id,
    vehiculoId: a.vehiculo_id ?? null,
    texto: a.mensaje,
    detalle: null,
    instante: a.created_at ?? null,
    sePuedeMarcarLeido: true,
  };
}

/** Un aviso de presión, como lo enseña la campana. */
export function avisoDePresion(a: AlertaPresion, matricula?: string | null): AvisoCampana {
  const posicion = a.posicion?.codigo_posicion ?? "posición desconocida";
  const quien = matricula ? `${matricula} · ` : "";
  const repeticion = textoDeRepeticion(a);
  return {
    clave: `presion:${a.id}`,
    origen: "presion",
    id: a.id,
    vehiculoId: a.vehiculo_id,
    texto: `${quien}${nombreDelTipo(a.tipo)} en ${posicion}`,
    detalle: [textoDePresion(a), repeticion].filter(Boolean).join(" · "),
    instante: a.ultimo_aviso_at ?? null,
    sePuedeMarcarLeido: false,
  };
}

/**
 * Los dos orígenes, en el orden en que hay que mirarlos.
 *
 * Primero los de presión y después los de base, y dentro de cada grupo lo más
 * reciente arriba. No es el orden cronológico puro a propósito: una rueda a
 * media presión es un riesgo ahora, y un «ha entrado en base» es una
 * oportunidad de revisar. Si se mezclaran por fecha, el aviso de anoche que
 * de verdad importa quedaría debajo de tres entradas en base de esta mañana.
 *
 * El desempate final es por `clave` para que la lista no baile entre
 * refrescos cuando dos avisos comparten instante.
 */
export function ordenarAvisos(avisos: AvisoCampana[]): AvisoCampana[] {
  const peso = (a: AvisoCampana) => (a.origen === "presion" ? 0 : 1);
  return [...avisos].sort((a, b) => {
    if (peso(a) !== peso(b)) return peso(a) - peso(b);
    const ta = a.instante ?? "";
    const tb = b.instante ?? "";
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.clave < b.clave ? -1 : 1;
  });
}

/**
 * Lo que marca el número rojo de la campana.
 *
 * Cuenta los dos orígenes: un aviso de presión abierto es algo pendiente
 * aunque no se pueda marcar como leído. Dejarlo fuera de la cuenta sería
 * esconderlo justo donde se mira para saber si hay algo.
 */
export function cuantosAvisos(avisos: AvisoCampana[]): number {
  return avisos.length;
}

/** Cuántos de los que hay se pueden quitar con «marcar todas leídas». */
export function cuantosSeMarcan(avisos: AvisoCampana[]): number {
  return avisos.filter((a) => a.sePuedeMarcarLeido).length;
}
