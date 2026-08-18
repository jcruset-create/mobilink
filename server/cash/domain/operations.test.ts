/**
 * Pruebas de los invariantes de operación.
 *
 * Reproducen los escenarios del encargo con sus importes exactos, porque son el
 * criterio de aceptación: si alguno de estos deja de pasar, el módulo está mal
 * aunque compile.
 */

import { describe, it, expect } from "vitest";
import { esExito, esFallo } from "./result.ts";
import {
  validarOperacion,
  aplicarMovimientos,
  importeEnEfectivo,
  type OperacionNormalizada,
} from "./operations.ts";
import {
  type LineaDenominacion,
  inventarioDesdeLineas,
  totalInventario,
  cantidadDe,
} from "./inventory.ts";

const CAJA_300: LineaDenominacion[] = [
  { valor: 5000, cantidad: 2 },
  { valor: 2000, cantidad: 5 },
  { valor: 1000, cantidad: 4 },
  { valor: 500, cantidad: 4 },
  { valor: 200, cantidad: 10 },
  { valor: 100, cantidad: 10 },
  { valor: 50, cantidad: 10 },
  { valor: 20, cantidad: 10 },
  { valor: 10, cantidad: 20 },
  { valor: 5, cantidad: 10 },
  { valor: 2, cantidad: 15 },
  { valor: 1, cantidad: 20 },
];

const stock = inventarioDesdeLineas(CAJA_300);

describe("cobro en efectivo", () => {
  it("cobro exacto de 100 €: entra un billete y no sale nada", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "MANUAL",
      importe: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 10000, cantidad: 1 }],
      efectivoEntregado: [],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;

    expect(r.efectivoNeto).toBe(10000);
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0]).toMatchObject({ direccion: "IN", motivo: "CUSTOMER_PAYMENT" });

    const despues = aplicarMovimientos(stock, r.movimientos);
    expect(totalInventario(despues)).toBe(totalInventario(stock) + 10000);
  });

  it("factura 187 €, entrega 205 €, cambio 18 €", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "ERP",
      importe: 18700,
      formasPago: [{ forma: "CASH", importe: 18700 }],
      efectivoRecibido: [
        { valor: 10000, cantidad: 2 },
        { valor: 500, cantidad: 1 },
      ],
      efectivoEntregado: [
        { valor: 1000, cantidad: 1 },
        { valor: 500, cantidad: 1 },
        { valor: 200, cantidad: 1 },
        { valor: 100, cantidad: 1 },
      ],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;

    // 205 − 18 = 187: el invariante central del cobro.
    expect(r.efectivoNeto).toBe(18700);
    expect(r.movimientos.map((m) => m.motivo)).toEqual(["CUSTOMER_PAYMENT", "CHANGE_GIVEN"]);

    const despues = aplicarMovimientos(stock, r.movimientos);
    expect(totalInventario(despues)).toBe(totalInventario(stock) + 18700);
    // Entraron dos billetes de 100 € que antes no había.
    expect(cantidadDe(despues, 10000)).toBe(2);
    // Salió el único cambio de 10 €: había 4, quedan 3.
    expect(cantidadDe(despues, 1000)).toBe(3);
    // El billete de 5 € entra uno y sale uno: se queda como estaba.
    expect(cantidadDe(despues, 500)).toBe(4);
  });

  it("puede devolver como cambio un billete que el cliente acaba de entregar", () => {
    // Caja sin billetes de 50 €: el cambio de 50 € solo puede salir del propio
    // billete que entrega el cliente. Es legítimo y tiene que pasar.
    const cajaPobre = inventarioDesdeLineas([{ valor: 100, cantidad: 5 }]);
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "MANUAL",
      importe: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      efectivoEntregado: [{ valor: 5000, cantidad: 1 }],
    };
    const r = validarOperacion(op, cajaPobre);
    expect(r.ok).toBe(true);
  });

  it("rechaza un cambio mayor que lo entregado", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "MANUAL",
      importe: 1000,
      formasPago: [{ forma: "CASH", importe: 1000 }],
      efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
      efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(false);
    if (esFallo(r)) expect(r.codigo).toBe("CAMBIO_SUPERA_ENTREGADO");
  });

  it("rechaza un cobro en efectivo sin detalle de piezas", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "MANUAL",
      importe: 18700,
      formasPago: [{ forma: "CASH", importe: 18700 }],
      efectivoRecibido: [],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(false);
    if (esFallo(r)) expect(r.codigo).toBe("FALTA_DETALLE_DENOMINACIONES");
  });

  it("rechaza que el cuadre recibido − cambio no dé el importe", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "MANUAL",
      importe: 18700,
      formasPago: [{ forma: "CASH", importe: 18700 }],
      efectivoRecibido: [{ valor: 10000, cantidad: 2 }],
      efectivoEntregado: [{ valor: 1000, cantidad: 1 }], // 200 − 10 = 190 ≠ 187
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(false);
    if (esFallo(r)) expect(r.codigo).toBe("EFECTIVO_NO_CUADRA");
  });
});

describe("pagos y salidas", () => {
  it("pago de 127 € descuenta exactamente las piezas indicadas", () => {
    const cajaConCien = inventarioDesdeLineas([
      { valor: 10000, cantidad: 1 },
      ...CAJA_300,
    ]);
    const op: OperacionNormalizada = {
      tipo: "PAYMENT",
      origen: "MANUAL",
      importe: 12700,
      formasPago: [{ forma: "CASH", importe: 12700 }],
      efectivoEntregado: [
        { valor: 10000, cantidad: 1 },
        { valor: 2000, cantidad: 1 },
        { valor: 500, cantidad: 1 },
        { valor: 200, cantidad: 1 },
      ],
    };
    const r = validarOperacion(op, cajaConCien);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;

    expect(r.efectivoNeto).toBe(-12700);
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0]).toMatchObject({ direccion: "OUT", motivo: "SUPPLIER_PAYMENT" });

    const despues = aplicarMovimientos(cajaConCien, r.movimientos);
    expect(totalInventario(despues)).toBe(totalInventario(cajaConCien) - 12700);
    expect(cantidadDe(despues, 10000)).toBe(0);
    expect(cantidadDe(despues, 2000)).toBe(4);
  });

  it("no deja sacar más piezas de las que hay", () => {
    // Solo hay 2 billetes de 50 €.
    const op: OperacionNormalizada = {
      tipo: "PAYMENT",
      origen: "MANUAL",
      importe: 15000,
      formasPago: [{ forma: "CASH", importe: 15000 }],
      efectivoEntregado: [{ valor: 5000, cantidad: 3 }],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(false);
    if (esFallo(r)) {
      expect(r.codigo).toBe("STOCK_INSUFICIENTE");
      expect(r.mensaje).toMatch(/5000/);
    }
  });

  it("las piezas que salen tienen que sumar exactamente el pago", () => {
    const op: OperacionNormalizada = {
      tipo: "PAYMENT",
      origen: "MANUAL",
      importe: 12700,
      formasPago: [{ forma: "CASH", importe: 12700 }],
      efectivoEntregado: [{ valor: 5000, cantidad: 2 }], // 100 € ≠ 127 €
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(false);
    if (esFallo(r)) expect(r.codigo).toBe("EFECTIVO_NO_CUADRA");
  });
});

describe("operaciones mixtas y sin efectivo", () => {
  it("factura 300 € con 200 € de tarjeta y 100 € en efectivo", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "ERP",
      importe: 30000,
      formasPago: [
        { forma: "BBVA_CARD", importe: 20000, referencia: "auth-9931" },
        { forma: "CASH", importe: 10000 },
      ],
      // El cliente entrega 120 € en efectivo para cubrir los 100 €.
      efectivoRecibido: [{ valor: 10000, cantidad: 1 }, { valor: 2000, cantidad: 1 }],
      efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;

    // Solo los 100 € en efectivo mueven el inventario; los 200 € de tarjeta no.
    expect(importeEnEfectivo(op.formasPago)).toBe(10000);
    expect(r.efectivoNeto).toBe(10000);

    const despues = aplicarMovimientos(stock, r.movimientos);
    expect(totalInventario(despues)).toBe(totalInventario(stock) + 10000);
    expect(cantidadDe(despues, 2000)).toBe(5); // entra uno y sale uno
  });

  it("un cobro solo con tarjeta no mueve ni una moneda", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "ERP",
      importe: 30000,
      formasPago: [{ forma: "CAIXABANK_CARD", importe: 30000 }],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(r.movimientos).toEqual([]);
    expect(r.efectivoNeto).toBe(0);
  });

  it("una operación sin efectivo no puede traer denominaciones", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "ERP",
      importe: 30000,
      formasPago: [{ forma: "AMEX", importe: 30000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(false);
    if (esFallo(r)) expect(r.codigo).toBe("EFECTIVO_NO_CUADRA");
  });

  it("las formas de pago tienen que sumar el importe del documento", () => {
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "ERP",
      importe: 30000,
      formasPago: [
        { forma: "BBVA_CARD", importe: 20000 },
        { forma: "CASH", importe: 5000 },
      ],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(false);
    if (esFallo(r)) expect(r.codigo).toBe("FORMAS_PAGO_NO_CUADRAN");
  });

  it("un cobro parcial es una operación válida por su propio importe", () => {
    // Factura de 1.000 € de la que hoy se cobran 300 €: para la caja esto es
    // una operación de 300 €, no de 1.000 €.
    const op: OperacionNormalizada = {
      tipo: "COLLECTION",
      origen: "ERP",
      importe: 30000,
      formasPago: [{ forma: "CASH", importe: 30000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 6 }],
      efectivoEntregado: [],
    };
    const r = validarOperacion(op, stock);
    expect(r.ok).toBe(true);
  });
});

describe("entradas no válidas", () => {
  it("rechaza importes cero o negativos", () => {
    for (const importe of [0, -100]) {
      const r = validarOperacion(
        { tipo: "COLLECTION", origen: "MANUAL", importe, formasPago: [] },
        stock
      );
      expect(r.ok).toBe(false);
      if (esFallo(r)) expect(r.codigo).toBe("IMPORTE_NO_VALIDO");
    }
  });

  it("rechaza una forma de pago con importe no positivo", () => {
    const r = validarOperacion(
      {
        tipo: "COLLECTION",
        origen: "MANUAL",
        importe: 10000,
        formasPago: [
          { forma: "CASH", importe: 10000 },
          { forma: "AMEX", importe: 0 },
        ],
      },
      stock
    );
    expect(r.ok).toBe(false);
    if (esFallo(r)) expect(r.codigo).toBe("IMPORTE_NO_VALIDO");
  });
});

describe("cambio de moneda en mostrador", () => {
  /** El caso del encargo: un billete de 20 € por 10 + 5 + cinco monedas de 1 €. */
  const cambioDe20: OperacionNormalizada = {
    tipo: "EXCHANGE",
    origen: "MANUAL",
    importe: 2000,
    formasPago: [{ forma: "CASH", importe: 2000 }],
    efectivoRecibido: [{ valor: 2000, cantidad: 1 }],
    efectivoEntregado: [
      { valor: 1000, cantidad: 1 },
      { valor: 500, cantidad: 1 },
      { valor: 100, cantidad: 5 },
    ],
  };

  it("entra el billete, salen sus piezas y el total de la caja no se mueve", () => {
    const r = validarOperacion(cambioDe20, stock);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;

    expect(r.efectivoNeto).toBe(0);
    expect(r.movimientos).toHaveLength(2);
    expect(r.movimientos[0]).toMatchObject({ direccion: "IN", motivo: "EXCHANGE" });
    expect(r.movimientos[1]).toMatchObject({ direccion: "OUT", motivo: "EXCHANGE" });

    const despues = aplicarMovimientos(stock, r.movimientos);
    // Mismo dinero, otra composición: un 20 € más, un 10 € y un 5 € menos.
    expect(totalInventario(despues)).toBe(totalInventario(stock));
    expect(cantidadDe(despues, 2000)).toBe(cantidadDe(stock, 2000) + 1);
    expect(cantidadDe(despues, 1000)).toBe(cantidadDe(stock, 1000) - 1);
    expect(cantidadDe(despues, 100)).toBe(cantidadDe(stock, 100) - 5);
  });

  it("también al revés: entran monedas y sale el billete", () => {
    const r = validarOperacion(
      {
        ...cambioDe20,
        efectivoRecibido: [{ valor: 100, cantidad: 20 }],
        efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
      },
      stock
    );
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(r.efectivoNeto).toBe(0);
  });

  it("si lo que entra y lo que sale no suman lo mismo, no es un cambio", () => {
    const r = validarOperacion(
      { ...cambioDe20, efectivoEntregado: [{ valor: 1000, cantidad: 1 }] },
      stock
    );
    expect(r).toMatchObject({ ok: false, codigo: "EFECTIVO_NO_CUADRA" });
  });

  it("el cambio sale del cajón: lo recién recibido no cuenta como disponible", () => {
    // Caja sin billetes de 20 €. Cambiar dos de 10 € por uno de 20 € que
    // "acaba de entrar" es devolverle al cliente su propio dinero.
    const sinVeintes = inventarioDesdeLineas(
      CAJA_300.filter((l) => l.valor !== 2000)
    );
    const r = validarOperacion(
      {
        ...cambioDe20,
        efectivoRecibido: [{ valor: 2000, cantidad: 1 }],
        efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
      },
      sinVeintes
    );
    expect(r).toMatchObject({ ok: false, codigo: "STOCK_INSUFICIENTE" });
  });

  it("no admite tarjeta ni ninguna otra forma: un cambio es todo efectivo", () => {
    const r = validarOperacion(
      {
        ...cambioDe20,
        formasPago: [
          { forma: "CASH", importe: 1000 },
          { forma: "CARD", importe: 1000 },
        ],
      },
      stock,
      new Set(["CASH"])
    );
    expect(r).toMatchObject({ ok: false, codigo: "FORMAS_PAGO_NO_CUADRAN" });
  });
});
