/**
 * De lo que dice el correo a lo que hay en la ficha: qué vehículo y qué rueda.
 *
 * Vive aparte de la ingesta y no toca la base: recibe los candidatos ya leídos
 * y decide. Es la parte donde estaba la trampa, así que es la que se prueba.
 *
 * ── La trampa de las posiciones ────────────────────────────────────────────
 *
 * La tentación es casar por el código de posición, y habría fallado en 2 de los
 * 7 vehículos que se miraron: `tc_posiciones_vehiculo.codigo_posicion` NO es un
 * vocabulario estable. En la misma instalación conviven al menos dos esquemas:
 *
 *   4 ruedas:  DEL_IZQ · DEL_DER · TRAS_IZQ · TRAS_DER
 *   8 ruedas:  E1_IZQ · E1_DER · E2_IZQ_EXT · E2_IZQ_INT · E2_DER_INT · E2_DER_EXT · E3_IZQ · E3_DER
 *
 * Lo que sí es consistente es la terna `(eje, lado, interior_exterior)`, y por
 * ahí se casa.
 *
 * ── La segunda trampa: Goodyear dice «interior» de más ─────────────────────
 *
 * En un eje de rueda simple no hay interior ni exterior, pero el correo lo dice
 * igual: «Eje 2 - izquierdo exterior» de una furgoneta cuyo eje trasero lleva
 * una rueda por lado, o «Eje 3 - derecho interior» de un eje que en la ficha es
 * E3_DER a secas. Son 2 de los 7 casos reales.
 *
 * Por eso el casado tiene dos pasos, y el segundo solo se permite cuando el eje
 * es REALMENTE de rueda simple —ninguna de sus posiciones tiene
 * `interior_exterior`—. Si el eje es de rueda gemela y el calificativo no casa,
 * no se elige una: se aparta el aviso. Entre avisar de la rueda equivocada y no
 * avisar, no avisar es lo honesto.
 */

import type { AlertaGoodyear, TipoAlerta } from "./alerta.ts";

/** Una posición de la ficha, tal como viene de `tc_posiciones_vehiculo`. */
export interface PosicionFicha {
  id: string;
  codigo_posicion: string;
  eje: number | null;
  lado: string | null;
  interior_exterior: string | null;
}

/** Un vehículo candidato, tal como viene de `tc_vehiculos`. */
export interface VehiculoFicha {
  id: string;
  empresa_id: string;
  matricula: string;
  numero_unidad: string | null;
  tipo_vehiculo_id: string | null;
}

/**
 * O la ficha que casa, o el motivo por el que no.
 *
 * Mismo molde que `Lectura`, y por la misma razón: con `strict: false` en el
 * tsconfig del servidor, una union discriminada por un booleano no estrecha.
 * Con `"motivo" in r` sí.
 */
export type Casado<T> = T | { motivo: string };

/**
 * Qué vehículo es.
 *
 * La matrícula manda y el ID de flota CONTRASTA. No al revés: el índice único
 * de `tc_vehiculos` es `(empresa_id, matricula)`, así que la matrícula podría
 * repetirse entre empresas —hoy no se repite ninguna de las 909, pero la base
 * lo permite—, y `numero_unidad` ni siquiera es único dentro de una empresa:
 * en Plana hay dos vehículos que lo comparten.
 *
 * Con una sola candidata, el ID de flota se usa para comprobar que hablamos del
 * mismo vehículo. Si no coincide, se aparta: que la matrícula y el número de
 * unidad apunten a sitios distintos es exactamente el caso en el que elegir uno
 * sería inventar.
 */
export function casarVehiculo(
  candidatos: VehiculoFicha[],
  alerta: Pick<AlertaGoodyear, "matricula" | "idFlota">,
): Casado<VehiculoFicha> {
  if (candidatos.length === 0) {
    return { motivo: `La matrícula ${alerta.matricula} no está en ninguna flota` };
  }
  if (candidatos.length > 1) {
    return {
      motivo: `La matrícula ${alerta.matricula} está en ${candidatos.length} empresas: no se elige`,
    };
  }
  const v = candidatos[0];
  if (alerta.idFlota && v.numero_unidad && norm(v.numero_unidad) !== norm(alerta.idFlota)) {
    return {
      motivo:
        `El correo dice ID de flota ${alerta.idFlota} y ${v.matricula} ` +
        `es la unidad ${v.numero_unidad}`,
    };
  }
  return v;
}

function norm(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * Qué rueda es, en dos pasos.
 *
 * `ruedas` son TODAS las posiciones del tipo de vehículo, no solo las del eje:
 * hace falta ver el eje entero para saber si es de rueda gemela o simple.
 */
export function casarPosicion(
  ruedas: PosicionFicha[],
  rueda: Pick<AlertaGoodyear, "eje" | "lado" | "interiorExterior">,
): Casado<PosicionFicha> {
  const delEje = ruedas.filter((p) => p.eje === rueda.eje);
  if (delEje.length === 0) {
    return { motivo: `El vehículo no tiene eje ${rueda.eje}` };
  }

  // Paso 1: la terna exacta.
  const exacta = delEje.filter(
    (p) => p.lado === rueda.lado && p.interior_exterior === rueda.interiorExterior,
  );
  if (exacta.length === 1) return exacta[0];

  // Paso 2: el eje es de rueda simple, así que el «interior/exterior» del
  // correo sobra. Solo vale si NINGUNA posición del eje lo tiene: en un eje
  // gemelo, ignorarlo sería elegir entre la de dentro y la de fuera a cara o
  // cruz.
  const ejeSimple = delEje.every((p) => p.interior_exterior == null);
  if (ejeSimple) {
    const porLado = delEje.filter((p) => p.lado === rueda.lado);
    if (porLado.length === 1) return porLado[0];
  }

  const dicho = `eje ${rueda.eje} ${rueda.lado}${rueda.interiorExterior ? ` ${rueda.interiorExterior}` : ""}`;
  return {
    motivo: `No hay una sola posición para ${dicho} (el eje tiene ${delEje.length}: ${delEje
      .map((p) => p.codigo_posicion)
      .join(", ")})`,
  };
}

/**
 * La severidad con la que entra cada tipo de aviso.
 *
 * No se deduce del porcentaje, se deduce del TIPO, por dos motivos. Uno: el
 * desinflado no trae porcentaje y es el más grave de todos. Dos: en los diez
 * avisos reales el texto siempre dice «rango crítico», así que sacar un
 * «media» de un número sería inventarse un nivel que Goodyear no manda.
 *
 * Hoy los dos tipos conocidos son `alta`, y la tabla se escribe igualmente:
 * cuando aparezca un tipo nuevo —que aparecerá, de diez correos ya salieron
 * dos— el compilador obliga a decidir aquí en vez de dejarlo al azar de un
 * `else`. Si alguno no dice «crítico», ese será el primer `media`.
 */
const SEVERIDAD: Record<TipoAlerta, "alta" | "media"> = {
  desinflado: "alta",
  presion_baja: "alta",
};

export function severidadDe(tipo: TipoAlerta): "alta" | "media" {
  return SEVERIDAD[tipo];
}
