import { describe, expect, it } from "vitest";
import { estadoAlbaran, estadoPedido } from "./estados.ts";

describe("estadoPedido", () => {
  it("sin nada expedido está pendiente de expedición", () => {
    expect(estadoPedido([{ pedida: 2, expedida: 0, recibida: 0 }])).toBe("PENDIENTE_EXPEDICION");
    expect(estadoPedido([])).toBe("PENDIENTE_EXPEDICION");
  });

  it("caso 2 · 10 pedidas, 6 expedidas y 6 recibidas: parcialmente expedido, NO incidencia", () => {
    expect(estadoPedido([{ pedida: 10, expedida: 6, recibida: 6 }])).toBe("PARCIALMENTE_EXPEDIDO");
  });

  it("todo expedido y nada recibido es expedido", () => {
    expect(estadoPedido([{ pedida: 2, expedida: 2, recibida: 0 }])).toBe("EXPEDIDO");
  });

  it("caso 3 · 10 expedidas y 8 recibidas sigue expedido (quedan 2 por recibir)", () => {
    expect(estadoPedido([{ pedida: 10, expedida: 10, recibida: 8 }])).toBe("EXPEDIDO");
  });

  it("caso 1 · 2/2/2 está completado", () => {
    expect(estadoPedido([{ pedida: 2, expedida: 2, recibida: 2 }])).toBe("COMPLETADO");
  });

  it("una línea a medias basta para no estar completado", () => {
    expect(
      estadoPedido([
        { pedida: 2, expedida: 2, recibida: 2 },
        { pedida: 4, expedida: 4, recibida: 3 },
      ])
    ).toBe("EXPEDIDO");
  });

  it("cancelado manda sobre las cantidades", () => {
    expect(estadoPedido([{ pedida: 2, expedida: 2, recibida: 2 }], true)).toBe("CANCELADO");
  });
});

describe("estadoAlbaran", () => {
  it("sin recepciones está en tránsito", () => {
    expect(estadoAlbaran([{ expedida: 2, recibida: 0 }])).toBe("EN_TRANSITO");
  });

  it("caso 3 · 10 expedidas y 8 recibidas: parcialmente recibido", () => {
    expect(estadoAlbaran([{ expedida: 10, recibida: 8 }], { conIncidencia: true })).toBe(
      "PARCIALMENTE_RECIBIDO"
    );
  });

  it("todo recibido sin incidencia: recibido", () => {
    expect(estadoAlbaran([{ expedida: 2, recibida: 2 }])).toBe("RECIBIDO");
  });

  it("todo recibido pero con una incidencia (dañado): recibido con incidencia", () => {
    expect(estadoAlbaran([{ expedida: 2, recibida: 2 }], { conIncidencia: true })).toBe(
      "RECIBIDO_CON_INCIDENCIA"
    );
  });

  it("cerrado por un gestor con unidades de menos: recibido con incidencia", () => {
    expect(estadoAlbaran([{ expedida: 10, recibida: 8 }], { conIncidencia: true, cerrado: true })).toBe(
      "RECIBIDO_CON_INCIDENCIA"
    );
  });

  it("sobra mercancía: recibido con incidencia, no parcialmente", () => {
    expect(estadoAlbaran([{ expedida: 2, recibida: 3 }], { conIncidencia: true })).toBe(
      "RECIBIDO_CON_INCIDENCIA"
    );
  });
});
