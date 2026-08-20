/**
 * Reparto del arqueo entre las cajas de la ERP.
 *
 * Taller y gasolinera comparten CAJÓN pero son dos cajas distintas en Genes, y
 * cada una se cierra por su lado. El arqueo del cajón entero —429,69 €— no
 * cuadra contra ninguna de las dos: la gasolinera movió 50 € y el taller el
 * resto, fondo incluido.
 *
 * Aquí se propone qué piezas son de cada una. Es una PROPUESTA y el papel lo
 * dice: el cajón es uno solo y los 50 € de la gasolinera no están apartados
 * físicamente. Lo que sí es exacto son los IMPORTES —salen del libro mayor,
 * operación a operación— y esos son los que tienen que cuadrar.
 *
 * El fondo se queda siempre con la caja principal, que es de donde salió.
 */

import type { Centimos } from "./money.ts";
import type { LineaDenominacion } from "./inventory.ts";
import { calcularCambio } from "./change.ts";
import { inventarioDesdeLineas, lineasDesdeInventario, restarInventarios } from "./inventory.ts";

export type CajaErp = {
  sectionId: number | null;
  nombre: string;
  importeCentimos: Centimos;
  /** Las piezas que se le imputan. Vacío si no se ha podido repartir. */
  piezas: LineaDenominacion[];
  /**
   * No se ha podido apartar ese importe con las piezas contadas. Pasa cuando
   * el dinero de la sección ya se gastó en dar cambio: el importe sigue siendo
   * bueno, pero las piezas concretas ya no están en el cajón.
   */
  sinPiezas: boolean;
};

export type RepartoErp = {
  /** La caja principal: se queda con el fondo y con todo lo no repartido. */
  principal: CajaErp;
  /** Las secciones marcadas como «caja propia en la ERP». */
  aparte: CajaErp[];
};

/**
 * Reparte las piezas contadas entre la caja principal y las que se arquean
 * aparte.
 *
 * Se aparta primero la sección de MÁS importe, y dentro de cada una se cogen
 * las piezas más grandes que quepan (`menos_piezas`): 50 € salen como un
 * billete de 50, no como cincuenta monedas de euro. Es lo que haría cualquiera
 * al separar el dinero de dos cajas en la misma bandeja, y deja el menudo —que
 * es el cambio de mañana— en la caja principal.
 *
 * Una sección que no se pueda cubrir con las piezas que quedan se marca
 * `sinPiezas` en vez de repartir mal: el importe sigue siendo el bueno y el
 * papel lo dice, que es infinitamente mejor que un desglose inventado.
 */
export function repartirArqueo(
  contado: readonly LineaDenominacion[],
  nombrePrincipal: string,
  secciones: readonly { sectionId: number | null; nombre: string; efectivoNetoCentimos: Centimos }[]
): RepartoErp {
  let restante = inventarioDesdeLineas(contado);
  const total = contado.reduce((a, l) => a + l.valor * l.cantidad, 0);

  // De mayor a menor importe: apartar primero lo gordo deja menos posibilidades
  // de que a la última sección no le cuadren las piezas.
  const porImporte = [...secciones]
    .filter((s) => s.efectivoNetoCentimos > 0)
    .sort((a, b) => b.efectivoNetoCentimos - a.efectivoNetoCentimos);

  const aparte: CajaErp[] = [];
  for (const s of porImporte) {
    const r = calcularCambio(s.efectivoNetoCentimos, restante, "menos_piezas");
    if (r.ok) {
      restante = restarInventarios(restante, inventarioDesdeLineas(r.lineas));
      aparte.push({
        sectionId: s.sectionId,
        nombre: s.nombre,
        importeCentimos: s.efectivoNetoCentimos,
        piezas: r.lineas,
        sinPiezas: false,
      });
    } else {
      aparte.push({
        sectionId: s.sectionId,
        nombre: s.nombre,
        importeCentimos: s.efectivoNetoCentimos,
        piezas: [],
        sinPiezas: true,
      });
    }
  }

  /*
   * A la principal le queda lo que no se ha apartado. Su importe se calcula
   * restando del total y NO sumando sus piezas: si una sección se quedó sin
   * piezas, sus monedas siguen dentro de `restante` pero su dinero no es de la
   * principal, y sumarlas la descuadraría.
   */
  const apartado = aparte.reduce((a, c) => a + c.importeCentimos, 0);

  return {
    principal: {
      sectionId: null,
      nombre: nombrePrincipal,
      importeCentimos: total - apartado,
      piezas: lineasDesdeInventario(restante),
      sinPiezas: false,
    },
    aparte,
  };
}
