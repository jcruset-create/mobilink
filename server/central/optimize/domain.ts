/**
 * Reparto de efectivo entre cajas de la misma red.
 *
 * El problema, que en una sola caja no existe: el taller de Reus lleva tres
 * semanas acumulando monedas de 1 € que no gasta, y el de Tarragona se queda
 * sin ellas cada jueves. Hoy los dos van al banco por separado — uno a soltar
 * lo que le sobra y otro a pedir lo que le falta.
 *
 * Lo que hace este motor es cruzar sobrantes con faltantes **por pieza** y
 * proponer los traslados. Y solo eso: proponer.
 *
 * ## Por qué NO ejecuta el traslado
 *
 * Mover dinero entre cajas necesita un documento de tránsito con su estado
 * intermedio, como ya tienen los pedidos de cambio al banco: el dinero sale de
 * una caja hoy y entra en la otra mañana, y en medio **no está en ninguna de
 * las dos**. Sin ese documento, el dinero en camino se contaría en las dos
 * cajas o en ninguna, que es exactamente el riesgo del doble conteo que la
 * fase 4 vino a cerrar.
 *
 * Ese documento es una fase por sí misma. Aquí se propone, alguien decide, y
 * de momento se registra como lo que ya sabe hacer el módulo: una salida en una
 * caja y una entrada en la otra, hechas por la persona que lleva la bolsa.
 *
 * ## Los criterios, en orden
 *
 * 1. **Solo lo que sobra de verdad.** Sobrante es lo que pasa del colchón que
 *    esa caja necesita, no lo que tiene: dejar a una caja sin margen para
 *    socorrer a otra es cambiar un problema de sitio.
 * 2. **Menos viajes antes que reparto perfecto.** Es mejor un traslado que
 *    cubre el 80% que cuatro que cubren el 100%: alguien tiene que conducir.
 * 3. **Piezas pequeñas primero.** Lo que se agota es la calderilla; los
 *    billetes se resuelven solos con la recaudación del día.
 */

import type { Centimos } from "../../cash/domain/money.ts";

export type PosicionCaja = {
  registerId: number;
  centroId: string | null;
  /** Piezas que tiene ahora, por valor. */
  stock: { valor: Centimos; cantidad: number }[];
  /** Piezas que necesita para el horizonte previsto, por valor. */
  necesita: { valor: Centimos; cantidad: number }[];
};

export type Traslado = {
  desdeRegisterId: number;
  haciaRegisterId: number;
  piezas: { valor: Centimos; cantidad: number }[];
  importeCentimos: number;
  motivo: string;
};

export type Reparto = {
  traslados: Traslado[];
  /** Lo que no se puede cubrir moviendo: hay que ir al banco. */
  alBanco: { registerId: number; piezas: { valor: Centimos; cantidad: number }[] }[];
};

/** Colchón que se deja a quien cede: no se le vacía para socorrer a otro. */
export const MARGEN = 1.25;

/** Por debajo de esto no compensa mover: no se manda a nadie por diez monedas. */
export const MINIMO_PIEZAS_POR_TRASLADO = 20;

const mapa = (xs: { valor: number; cantidad: number }[]) => {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x.valor, (m.get(x.valor) ?? 0) + x.cantidad);
  return m;
};

/**
 * Cruza sobrantes con faltantes y propone los traslados.
 *
 * Las cajas que solo ceden no reciben nada, y al revés: mezclar los dos papeles
 * produciría traslados cruzados —A manda a B y B manda a A— que nadie hará.
 */
export function repartir(cajas: readonly PosicionCaja[]): Reparto {
  const sobra = new Map<number, Map<number, number>>();
  const falta = new Map<number, Map<number, number>>();

  for (const c of cajas) {
    const tiene = mapa(c.stock);
    const necesita = mapa(c.necesita);
    const valores = new Set([...tiene.keys(), ...necesita.keys()]);

    for (const valor of valores) {
      const n = necesita.get(valor) ?? 0;
      const t = tiene.get(valor) ?? 0;
      // Sobra lo que pasa del colchón; falta lo que no llega a lo justo.
      const excedente = t - Math.ceil(n * MARGEN);
      if (excedente > 0) {
        if (!sobra.has(c.registerId)) sobra.set(c.registerId, new Map());
        sobra.get(c.registerId)!.set(valor, excedente);
      } else if (t < n) {
        if (!falta.has(c.registerId)) falta.set(c.registerId, new Map());
        falta.get(c.registerId)!.set(valor, n - t);
      }
    }
  }

  const traslados = new Map<string, Traslado>();
  const alBanco = new Map<number, Map<number, number>>();

  // Piezas pequeñas primero: lo que se agota es la calderilla.
  const valoresOrdenados = [
    ...new Set([...falta.values()].flatMap((m) => [...m.keys()])),
  ].sort((a, b) => a - b);

  for (const valor of valoresOrdenados) {
    for (const [necesitado, pendientes] of falta) {
      let porCubrir = pendientes.get(valor) ?? 0;
      if (porCubrir <= 0) continue;

      /*
       * Se empieza por quien más tiene de esa pieza: cubre más con un solo
       * viaje, que es el criterio que manda sobre el reparto perfecto.
       */
      const candidatos = [...sobra.entries()]
        .filter(([id, m]) => id !== necesitado && (m.get(valor) ?? 0) > 0)
        .sort((a, b) => (b[1].get(valor) ?? 0) - (a[1].get(valor) ?? 0));

      for (const [donante, disponibles] of candidatos) {
        if (porCubrir <= 0) break;
        const cuanto = Math.min(porCubrir, disponibles.get(valor) ?? 0);
        if (cuanto <= 0) continue;

        const clave = `${donante}->${necesitado}`;
        const t = traslados.get(clave) ?? {
          desdeRegisterId: donante,
          haciaRegisterId: necesitado,
          piezas: [],
          importeCentimos: 0,
          motivo: "",
        };
        t.piezas.push({ valor, cantidad: cuanto });
        t.importeCentimos += valor * cuanto;
        traslados.set(clave, t);

        disponibles.set(valor, (disponibles.get(valor) ?? 0) - cuanto);
        porCubrir -= cuanto;
      }

      if (porCubrir > 0) {
        if (!alBanco.has(necesitado)) alBanco.set(necesitado, new Map());
        const m = alBanco.get(necesitado)!;
        m.set(valor, (m.get(valor) ?? 0) + porCubrir);
      }
    }
  }

  /*
   * Los traslados que no llegan al mínimo se descartan y su parte pasa al
   * banco. Mandar a alguien a conducir veinte minutos por diez monedas de 0,20 €
   * es una propuesta que nadie va a seguir, y una propuesta que no se sigue
   * hace que se dejen de mirar todas las demás.
   */
  const utiles: Traslado[] = [];
  for (const t of traslados.values()) {
    const piezas = t.piezas.reduce((a, p) => a + p.cantidad, 0);
    if (piezas < MINIMO_PIEZAS_POR_TRASLADO) {
      if (!alBanco.has(t.haciaRegisterId)) alBanco.set(t.haciaRegisterId, new Map());
      const m = alBanco.get(t.haciaRegisterId)!;
      for (const p of t.piezas) m.set(p.valor, (m.get(p.valor) ?? 0) + p.cantidad);
      continue;
    }
    t.piezas.sort((a, b) => b.valor - a.valor);
    t.motivo = `${piezas} piezas que le sobran a una caja y le faltan a la otra.`;
    utiles.push(t);
  }

  return {
    traslados: utiles.sort((a, b) => b.importeCentimos - a.importeCentimos),
    alBanco: [...alBanco.entries()].map(([registerId, m]) => ({
      registerId,
      piezas: [...m.entries()]
        .map(([valor, cantidad]) => ({ valor, cantidad }))
        .sort((a, b) => b.valor - a.valor),
    })),
  };
}
