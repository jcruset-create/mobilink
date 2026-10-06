/**
 * Qué líneas lleva el albarán del proveedor, cruzadas con las de su pedido.
 *
 * Vive aquí, en `domain/`, porque es una decisión pura: dos listas entran y
 * una sale. No sabe de base de datos ni de correo, y por eso se puede probar
 * sola, que es justo lo que hacía falta cuando el reparto empezó a tener
 * casos (lo que sobra, lo ya expedido, dos líneas iguales).
 */

import { pendienteDeExpedir, redondear } from "./cantidades.ts";
import { descripcionNormalizada } from "./articulos.ts";

/** Lo que de una línea de pedido necesita saber el reparto. */
export type LineaPedidoPendiente = {
  id: string;
  descripcionProveedor: string;
  cantidadPedida: number;
  cantidadExpedida: number;
};

/** Lo que sale: una línea de albarán lista para `service.crearAlbaran`. */
export type LineaAlbaranParaCrear = {
  /** Línea del pedido a la que corresponde. Si falta, es una línea fuera de pedido. */
  pedidoLineaId?: string | null;
  descripcionProveedor?: string | null;
  referenciaProveedor?: string | null;
  cantidadExpedida: number;
};

/**
 * Qué líneas lleva el albarán, en este orden de preferencia:
 *   1. las líneas que detalla el correo, casadas con las del pedido por la
 *      descripción normalizada (las que no casan entran como fuera de pedido);
 *   2. una «cantidad expedida» total, si el pedido tiene una sola línea;
 *   3. todo lo pendiente de expedir del pedido, si la configuración lo asume.
 *
 * ── Lo que sobra entra, no se cae ───────────────────────────────────────────
 *
 * Una línea no puede expedir más de lo que su línea de pedido tiene pendiente:
 * el servicio lo rechazaría. Pero la mercancía está viniendo igual, así que lo
 * que sobra NO se pierde: entra como línea FUERA DE PEDIDO con la cantidad que
 * dice el papel. Y una línea de pedido ya expedida del todo no se casa con
 * nadie: su albarán nuevo entra entero fuera de pedido, que es exactamente lo
 * que es. Antes se truncaba a cero y la línea desaparecía; si desaparecían
 * todas, el albarán se quedaba PENDIENTE_REVISION con «el pedido no tiene nada
 * pendiente de expedir» y el papel de una mercancía que ya estaba en el muelle
 * no entraba en ninguna parte.
 */
export function lineasDelAlbaran(
  a: { lineas: { cantidad: number | null; descripcion: string | null; referencia: string | null }[]; cantidadExpedida: number | null },
  lineasPedido: LineaPedidoPendiente[],
  asumirCompleta: boolean
): LineaAlbaranParaCrear[] {
  const pendiente = (l: LineaPedidoPendiente) => pendienteDeExpedir(l.cantidadPedida, l.cantidadExpedida);
  const conPendiente = lineasPedido.filter((l) => pendiente(l) > 0);

  const detalladas = a.lineas.filter((l) => l.cantidad && l.cantidad > 0);
  if (detalladas.length > 0) {
    const usadas = new Set<string>();
    return detalladas.flatMap((l) => {
      const clave = l.descripcion ? descripcionNormalizada(l.descripcion) : "";
      const lp = conPendiente.find((x) => !usadas.has(x.id) && clave && descripcionNormalizada(x.descripcionProveedor) === clave);
      if (lp) usadas.add(lp.id);
      const contraPedido = lp ? Math.min(l.cantidad!, pendiente(lp)) : 0;
      const sobrante = redondear(l.cantidad! - contraPedido);
      const descripcionProveedor = l.descripcion ?? lp?.descripcionProveedor ?? "";
      const comun = { descripcionProveedor, referenciaProveedor: l.referencia };
      const salida: LineaAlbaranParaCrear[] = [];
      if (contraPedido > 0) salida.push({ ...comun, pedidoLineaId: lp!.id, cantidadExpedida: contraPedido });
      if (sobrante > 0) salida.push({ ...comun, pedidoLineaId: null, cantidadExpedida: sobrante });
      return salida.filter((x) => x.descripcionProveedor);
    });
  }

  if (a.cantidadExpedida && a.cantidadExpedida > 0 && conPendiente.length === 1) {
    const lp = conPendiente[0];
    return [{ pedidoLineaId: lp.id, cantidadExpedida: Math.min(a.cantidadExpedida, pendiente(lp)) }];
  }

  if (asumirCompleta) {
    return conPendiente.map((lp) => ({ pedidoLineaId: lp.id, cantidadExpedida: pendiente(lp) }));
  }
  return [];
}
