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
import { repartoAproximado } from "./change.ts";
import { inventarioDesdeLineas, lineasDesdeInventario, restarInventarios } from "./inventory.ts";

export type CajaErp = {
  sectionId: number | null;
  nombre: string;
  importeCentimos: Centimos;
  /** Las piezas que se le imputan. */
  piezas: LineaDenominacion[];
  /**
   * Lo que suman esas piezas, que es el total que hay que teclear en la ERP.
   *
   * Normalmente coincide con `importeCentimos`. Cuando no, es porque el cajón
   * no da para apartar el importe clavado —el billete de la sección ya salió
   * en un cambio— y se ha apartado lo más parecido que se podía formar. Manda
   * ESTE número en la rejilla: una hoja cuyo total no cuadre con su propio
   * desglose es peor que una que declare la diferencia.
   */
  logradoCentimos: Centimos;
  /** `importeCentimos − logradoCentimos`. Cero cuando el reparto es clavado. */
  desvioCentimos: Centimos;
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
 * Cuando el cajón no da para apartar el importe clavado, se aparta lo más
 * parecido que se pueda formar y se anota el desvío. Rendirse ahí dejaba sin
 * rejilla a quien tiene que cerrar en la ERP, que es a quien sirve el papel.
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
    /*
     * Lo más parecido que se pueda formar, no «exacto o nada».
     *
     * Antes, cuando no había combinación clavada, la sección salía sin
     * desglose y con un aviso: correcto de cara al papel, e inútil de cara a
     * quien tiene que cerrar en Genes, que se quedaba sin rejilla que teclear.
     * Ahora siempre hay rejilla; si no cuadra al céntimo, el papel dice cuánto
     * y por qué, y la diferencia se la queda la principal.
     */
    const r = repartoAproximado(s.efectivoNetoCentimos, restante, "menos_piezas");
    restante = restarInventarios(restante, inventarioDesdeLineas(r.lineas));
    aparte.push({
      sectionId: s.sectionId,
      nombre: s.nombre,
      importeCentimos: s.efectivoNetoCentimos,
      piezas: r.lineas,
      logradoCentimos: r.logradoCentimos,
      desvioCentimos: s.efectivoNetoCentimos - r.logradoCentimos,
    });
  }

  /*
   * A la principal le queda LO QUE HAY EN LA BANDEJA después de apartar, y su
   * total es el de esas piezas: `total − Σ logrado`, no `total − Σ importe`.
   *
   * Es la diferencia entre las dos maneras de contar, y la que hace que la ERP
   * cuadre. El libro mayor dice que la gasolinera movió 50 €; si del cajón solo
   * se pudieron apartar 49,95 €, los 5 céntimos siguen físicamente en la
   * bandeja de la principal y su rejilla los enseña. Restar el importe teórico
   * dejaría una hoja cuyo total no coincide con sus propias piezas, que es
   * justo lo que rompe el cierre.
   */
  const logrado = aparte.reduce((a, c) => a + c.logradoCentimos, 0);
  const apartado = aparte.reduce((a, c) => a + c.importeCentimos, 0);

  return {
    principal: {
      sectionId: null,
      nombre: nombrePrincipal,
      importeCentimos: total - apartado,
      piezas: lineasDesdeInventario(restante),
      logradoCentimos: total - logrado,
      desvioCentimos: (total - apartado) - (total - logrado),
    },
    aparte,
  };
}
