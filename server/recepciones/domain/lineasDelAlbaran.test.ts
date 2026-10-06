/**
 * `lineasDelAlbaran`: qué líneas lleva el albarán que entra por correo.
 *
 * El caso que motiva estas pruebas es real: un albarán cuyo pedido ya estaba
 * expedido del todo se quedaba PENDIENTE_REVISION con «el pedido no tiene
 * nada pendiente de expedir» y el papel de una mercancía que ya estaba en el
 * muelle no entraba en ninguna parte.
 */

import { describe, expect, it } from "vitest";
import { lineasDelAlbaran, type LineaPedidoPendiente } from "./lineasDelAlbaran.ts";

function lineaPedido(id: string, descripcionProveedor: string, pedida: number, expedida: number): LineaPedidoPendiente {
  return { id, descripcionProveedor, cantidadPedida: pedida, cantidadExpedida: expedida };
}

const albaran = (lineas: { cantidad: number | null; descripcion: string | null; referencia: string | null }[], cantidadExpedida: number | null = null) => ({
  lineas,
  cantidadExpedida,
});

describe("lineasDelAlbaran", () => {
  it("casa la línea detallada con la del pedido por la descripción", () => {
    const pedido = [lineaPedido("l1", "NEUMATICO 205/55 R16", 4, 0)];
    const lineas = lineasDelAlbaran(albaran([{ cantidad: 4, descripcion: "Neumatico 205/55 R16", referencia: "A1" }]), pedido, false);
    expect(lineas).toEqual([{ pedidoLineaId: "l1", descripcionProveedor: "Neumatico 205/55 R16", referenciaProveedor: "A1", cantidadExpedida: 4 }]);
  });

  it("la línea que no casa con nada entra fuera de pedido", () => {
    const lineas = lineasDelAlbaran(albaran([{ cantidad: 2, descripcion: "CAMARA 400-8", referencia: null }]), [lineaPedido("l1", "OTRA COSA", 2, 0)], false);
    expect(lineas).toEqual([{ pedidoLineaId: null, descripcionProveedor: "CAMARA 400-8", referenciaProveedor: null, cantidadExpedida: 2 }]);
  });

  it("si su línea del pedido ya está expedida del todo, entra ENTERA fuera de pedido", () => {
    const pedido = [lineaPedido("l1", "NEUMATICO 205/55 R16", 4, 4)];
    const lineas = lineasDelAlbaran(albaran([{ cantidad: 4, descripcion: "NEUMATICO 205/55 R16", referencia: null }]), pedido, false);
    expect(lineas).toEqual([{ pedidoLineaId: null, descripcionProveedor: "NEUMATICO 205/55 R16", referenciaProveedor: null, cantidadExpedida: 4 }]);
  });

  it("lo que pasa de lo pendiente se parte: lo pendiente contra el pedido y el resto fuera", () => {
    const pedido = [lineaPedido("l1", "NEUMATICO 205/55 R16", 4, 3)];
    const lineas = lineasDelAlbaran(albaran([{ cantidad: 4, descripcion: "NEUMATICO 205/55 R16", referencia: null }]), pedido, false);
    expect(lineas).toEqual([
      { pedidoLineaId: "l1", descripcionProveedor: "NEUMATICO 205/55 R16", referenciaProveedor: null, cantidadExpedida: 1 },
      { pedidoLineaId: null, descripcionProveedor: "NEUMATICO 205/55 R16", referenciaProveedor: null, cantidadExpedida: 3 },
    ]);
  });

  it("dos líneas iguales no se comen la misma línea del pedido", () => {
    const pedido = [lineaPedido("l1", "CAMARA 400-8", 2, 0), lineaPedido("l2", "CAMARA 400-8", 2, 0)];
    const lineas = lineasDelAlbaran(
      albaran([
        { cantidad: 2, descripcion: "CAMARA 400-8", referencia: null },
        { cantidad: 2, descripcion: "CAMARA 400-8", referencia: null },
      ]),
      pedido,
      false
    );
    expect(lineas.map((l) => l.pedidoLineaId)).toEqual(["l1", "l2"]);
  });

  it("sin detalle, una cantidad total va a la única línea pendiente", () => {
    const pedido = [lineaPedido("l1", "NEUMATICO", 10, 4)];
    expect(lineasDelAlbaran(albaran([], 6), pedido, false)).toEqual([{ pedidoLineaId: "l1", cantidadExpedida: 6 }]);
  });

  it("sin detalle ni total, sólo entra si se asume la expedición completa", () => {
    const pedido = [lineaPedido("l1", "NEUMATICO", 10, 4)];
    expect(lineasDelAlbaran(albaran([]), pedido, false)).toEqual([]);
    expect(lineasDelAlbaran(albaran([]), pedido, true)).toEqual([{ pedidoLineaId: "l1", cantidadExpedida: 6 }]);
  });
});
