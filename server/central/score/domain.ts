/**
 * Cash Health Score: un número del 0 al 100 por caja, taller y red.
 *
 * El roadmap lo enuncia en una línea. Lo que se decide aquí, y es lo que separa
 * un indicador útil de uno decorativo:
 *
 * ## Un número solo no vale: va con sus motivos
 *
 * Un 62 no dice nada. Lo que hace falta saber es **por qué es 62 y qué lo
 * arregla**, así que la puntuación devuelve siempre la lista de lo que ha
 * restado y cuánto. Es la misma regla que el motor de pedidos al banco ya
 * aplica: una propuesta que no se entiende no se corrige, se ignora.
 *
 * ## Se resta desde 100, no se suma desde 0
 *
 * Una caja sin problemas está en 100. Cada cosa que va mal descuenta. La
 * alternativa —sumar puntos por portarse bien— premia el volumen: una caja que
 * mueve mucho sacaría mejor nota que una pequeña impecable, y la pregunta que
 * se contesta aquí no es cuánto factura sino si está sana.
 *
 * ## Los descuentos tienen tope
 *
 * Cada factor descuenta como mucho lo suyo. Sin topes, una caja con un
 * descuadre enorme se iría a cero y taparía que además lleva tres semanas sin
 * cerrar: el cero absorbe todo lo demás y se pierde qué hay que atender primero.
 *
 * ## Sin datos no es un cero
 *
 * Una caja recién dada de alta, sin jornadas, **no tiene puntuación**. Ponerle
 * un cero la colocaría la primera de la lista de problemas siendo que no ha
 * hecho nada, y ponerle un 100 diría que está perfecta sin haberla mirado.
 */

/** Señales que Central ya tiene proyectadas de cada caja. */
export type SenalesCaja = {
  registerId: number;
  /** Jornadas cerradas en el periodo mirado. */
  jornadas: number;
  /** Jornadas de esas que descuadraron. */
  jornadasConDescuadre: number;
  /** Suma de descuadres en valor absoluto. */
  descuadreCentimos: number;
  /** Efectivo movido en el periodo, para relativizar el descuadre. */
  efectivoCentimos: number;
  /** Días desde el último cierre. `null` si nunca ha cerrado. */
  diasSinCerrar: number | null;
  /** Días que lleva fuera el tránsito más antiguo sin liquidar. */
  transitoDiasAbierto: number | null;
  /** Días que lleva esperando el cierre más antiguo sin ingresar. */
  pendienteBancoDias: number | null;
  /** Céntimos en monedas. `null` si nunca se ha arqueado. */
  calderillaCentimos: number | null;
};

export type Motivo = {
  factor: "DESCUADRE" | "FRECUENCIA_DESCUADRE" | "SIN_CERRAR" | "TRANSITO" | "BANCO" | "CAMBIO";
  puntos: number;
  detalle: string;
};

export type Puntuacion = {
  registerId: number;
  /** 0–100, o `null` si no hay con qué puntuar. */
  puntos: number | null;
  nivel: "BUENA" | "REGULAR" | "MALA" | "SIN_DATOS";
  motivos: Motivo[];
};

/** Tope de descuento por factor. Suman 100 entre todos. */
export const TOPES = {
  DESCUADRE: 30,
  FRECUENCIA_DESCUADRE: 20,
  SIN_CERRAR: 20,
  TRANSITO: 15,
  BANCO: 10,
  CAMBIO: 5,
} as const;

/** Calderilla por debajo de la cual se considera que va justa. */
export const CALDERILLA_MINIMA_CENTIMOS = 3000;

const tope = (valor: number, maximo: number) => Math.min(Math.round(valor), maximo);

export function puntuar(s: SenalesCaja): Puntuacion {
  if (s.jornadas === 0) {
    return {
      registerId: s.registerId,
      puntos: null,
      nivel: "SIN_DATOS",
      motivos: [],
    };
  }

  const motivos: Motivo[] = [];

  /*
   * El descuadre se mide EN PROPORCIÓN a lo que mueve la caja.
   *
   * Veinte euros descuadrados en una caja que mueve doscientos es un problema
   * grave; los mismos veinte en una que mueve veinte mil es ruido. En absoluto,
   * el indicador solo diría cuál es la caja más grande.
   */
  if (s.descuadreCentimos > 0 && s.efectivoCentimos > 0) {
    const porMil = (s.descuadreCentimos / s.efectivoCentimos) * 1000;
    const puntos = tope(porMil * 3, TOPES.DESCUADRE);
    if (puntos > 0) {
      motivos.push({
        factor: "DESCUADRE",
        puntos,
        detalle: `Descuadra el ${(porMil / 10).toFixed(2)}% de lo que mueve.`,
      });
    }
  }

  /*
   * Y aparte, CADA CUÁNTO descuadra. Un descuadre gordo un día es un incidente;
   * descuadrar poco todos los días es un procedimiento que no se sigue, y eso
   * el importe no lo distingue.
   */
  if (s.jornadasConDescuadre > 0) {
    const proporcion = s.jornadasConDescuadre / s.jornadas;
    const puntos = tope(proporcion * TOPES.FRECUENCIA_DESCUADRE, TOPES.FRECUENCIA_DESCUADRE);
    if (puntos > 0) {
      motivos.push({
        factor: "FRECUENCIA_DESCUADRE",
        puntos,
        detalle: `Descuadró en ${s.jornadasConDescuadre} de ${s.jornadas} jornadas.`,
      });
    }
  }

  // A partir de tres días sin cerrar empieza a doler; antes es un fin de semana.
  if (s.diasSinCerrar != null && s.diasSinCerrar > 3) {
    const puntos = tope((s.diasSinCerrar - 3) * 4, TOPES.SIN_CERRAR);
    motivos.push({
      factor: "SIN_CERRAR",
      puntos,
      detalle: `Lleva ${s.diasSinCerrar} días sin cerrar jornada.`,
    });
  }

  if (s.transitoDiasAbierto != null && s.transitoDiasAbierto > 2) {
    const puntos = tope((s.transitoDiasAbierto - 2) * 3, TOPES.TRANSITO);
    motivos.push({
      factor: "TRANSITO",
      puntos,
      detalle: `Hay dinero fuera del cajón desde hace ${s.transitoDiasAbierto} días.`,
    });
  }

  if (s.pendienteBancoDias != null && s.pendienteBancoDias > 7) {
    const puntos = tope((s.pendienteBancoDias - 7) * 2, TOPES.BANCO);
    motivos.push({
      factor: "BANCO",
      puntos,
      detalle: `Hay cierres sin llevar al banco desde hace ${s.pendienteBancoDias} días.`,
    });
  }

  if (s.calderillaCentimos != null && s.calderillaCentimos < CALDERILLA_MINIMA_CENTIMOS) {
    motivos.push({
      factor: "CAMBIO",
      puntos: TOPES.CAMBIO,
      detalle: "Va justa de calderilla.",
    });
  }

  const descuento = motivos.reduce((a, m) => a + m.puntos, 0);
  const puntos = Math.max(0, 100 - descuento);

  return {
    registerId: s.registerId,
    puntos,
    nivel: puntos >= 80 ? "BUENA" : puntos >= 50 ? "REGULAR" : "MALA",
    // De lo que más resta a lo que menos: es el orden en que hay que atenderlo.
    motivos: motivos.sort((a, b) => b.puntos - a.puntos),
  };
}

/**
 * Puntuación de un grupo (taller, zona o red entera).
 *
 * **Es la media de las cajas con datos, no la suma ponderada por dinero.** Un
 * taller con una caja impecable que mueve mucho y otra desastrosa que mueve
 * poco no está sano: ponderando por importe, la mala desaparecería, y la caja
 * por la que se escapa el dinero suele ser precisamente la pequeña.
 *
 * Las cajas sin datos no entran en la media ni como cero ni como cien: no se
 * sabe, y eso no se promedia.
 */
export function puntuarGrupo(cajas: readonly Puntuacion[]): {
  puntos: number | null;
  conDatos: number;
  sinDatos: number;
  peores: Puntuacion[];
} {
  const conDatos = cajas.filter((c) => c.puntos != null);
  const sinDatos = cajas.length - conDatos.length;

  return {
    puntos:
      conDatos.length === 0
        ? null
        : Math.round(conDatos.reduce((a, c) => a + (c.puntos ?? 0), 0) / conDatos.length),
    conDatos: conDatos.length,
    sinDatos,
    peores: [...conDatos].sort((a, b) => (a.puntos ?? 0) - (b.puntos ?? 0)).slice(0, 5),
  };
}
