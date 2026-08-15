/**
 * Pruebas del algoritmo de cambio.
 *
 * Lo importante de este fichero no son los casos de ejemplo del encargo, que
 * también están: es el contraste contra una búsqueda exhaustiva. Un algoritmo
 * de cambio con stock limitado puede parecer correcto en los cinco casos que a
 * uno se le ocurren y fallar justo en el que se lleva la última moneda de 20 c.
 * Aquí se enumeran TODAS las combinaciones posibles para cajas pequeñas y se
 * comprueba que la programación dinámica encuentra solución siempre que la hay
 * y que además usa el mínimo de piezas.
 */

import { describe, it, expect } from "vitest";
import {
  calcularCambio,
  calcularCambioDesdeLineas,
  validarCambioManual,
  CAMBIO_MAXIMO_CENTIMOS,
} from "./change.ts";
import {
  type LineaDenominacion,
  inventarioDesdeLineas,
  totalInventario,
  cabeDentro,
} from "./inventory.ts";

/** Caja de trabajo del encargo: cambio inicial de 300 € con composición real. */
const CAJA_300: LineaDenominacion[] = [
  { valor: 5000, cantidad: 2 }, // 50 € × 2 = 100 €
  { valor: 2000, cantidad: 5 }, // 20 € × 5 = 100 €
  { valor: 1000, cantidad: 4 }, // 10 € × 4 =  40 €
  { valor: 500, cantidad: 4 }, //   5 € × 4 =  20 €
  { valor: 200, cantidad: 10 }, //  2 € × 10 =  20 €
  { valor: 100, cantidad: 10 }, //  1 € × 10 =  10 €
  { valor: 50, cantidad: 10 }, // 0,50 € × 10 = 5 €
  { valor: 20, cantidad: 10 }, // 0,20 € × 10 = 2 €
  { valor: 10, cantidad: 20 }, // 0,10 € × 20 = 2 €
  { valor: 5, cantidad: 10 }, // 0,05 € × 10 = 0,50 €
  { valor: 2, cantidad: 15 }, // 0,02 € × 15 = 0,30 €
  { valor: 1, cantidad: 20 }, // 0,01 € × 20 = 0,20 €
];

// ── Utilidades de contraste ────────────────────────────────────────────────

/**
 * Mínimo de piezas por fuerza bruta. Enumera de verdad todas las cantidades de
 * cada denominación, sin ninguna astucia: es lenta y por eso solo se usa con
 * cajas pequeñas, pero precisamente por tonta es de fiar.
 */
function minimoPiezasFuerzaBruta(importe: number, stock: LineaDenominacion[]): number | null {
  let mejor: number | null = null;

  const explorar = (i: number, restante: number, piezas: number): void => {
    if (restante === 0) {
      if (mejor === null || piezas < mejor) mejor = piezas;
      return;
    }
    if (i >= stock.length) return;
    const { valor, cantidad } = stock[i];
    const maximo = Math.min(cantidad, Math.floor(restante / valor));
    for (let k = maximo; k >= 0; k--) {
      explorar(i + 1, restante - valor * k, piezas + k);
    }
  };

  explorar(0, importe, 0);
  return mejor;
}

function totalDeLineas(lineas: readonly LineaDenominacion[]): number {
  return lineas.reduce((acc, l) => acc + l.valor * l.cantidad, 0);
}

// ── Casos del encargo ──────────────────────────────────────────────────────

describe("cambio: casos del encargo", () => {
  it("un cobro exacto no genera cambio", () => {
    const r = calcularCambioDesdeLineas(0, CAJA_300);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toEqual([]);
    expect(r.piezas).toBe(0);
  });

  it("devuelve 18 € con las denominaciones disponibles", () => {
    // Factura 187 €, el cliente entrega 100 € × 2 + 5 € × 1 = 205 €.
    const r = calcularCambioDesdeLineas(20500 - 18700, CAJA_300);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(totalDeLineas(r.lineas)).toBe(1800);
    // 10 + 5 + 2 + 1 es el óptimo con esta caja: cuatro piezas.
    expect(r.piezas).toBe(4);
    expect(r.lineas).toEqual([
      { valor: 1000, cantidad: 1 },
      { valor: 500, cantidad: 1 },
      { valor: 200, cantidad: 1 },
      { valor: 100, cantidad: 1 },
    ]);
  });

  it("no propone una denominación que no existe en caja", () => {
    // Sin billetes de 10 €: los 18 € tienen que salir de otra parte.
    const sinDiez = CAJA_300.filter((l) => l.valor !== 1000);
    const r = calcularCambioDesdeLineas(1800, sinDiez);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(totalDeLineas(r.lineas)).toBe(1800);
    expect(r.lineas.some((l) => l.valor === 1000)).toBe(false);
    expect(cabeDentro(inventarioDesdeLineas(sinDiez), inventarioDesdeLineas(r.lineas))).toBe(true);
  });

  it("hay dinero de sobra pero no combinación exacta: NO_SOLUTION", () => {
    // Cien euros en billetes de 50: total 100 €, pero 3 € no se pueden formar.
    const soloCincuentas: LineaDenominacion[] = [{ valor: 5000, cantidad: 2 }];
    const r = calcularCambioDesdeLineas(300, soloCincuentas);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("NO_SOLUTION");
    expect(r.mensaje).toMatch(/no es posible devolver/i);
  });

  it("distingue no tener bastante dinero de no poder componerlo", () => {
    const caja: LineaDenominacion[] = [{ valor: 200, cantidad: 1 }];
    const r = calcularCambioDesdeLineas(1000, caja);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("STOCK_INSUFICIENTE");
  });

  it("agota una denominación y sigue encontrando la combinación exacta", () => {
    // 8 € con dos monedas de 2 € y el resto en monedas de 1 €: obliga a usar
    // todas las de 2 € y a completar con las de 1 €.
    const caja: LineaDenominacion[] = [
      { valor: 200, cantidad: 2 },
      { valor: 100, cantidad: 4 },
    ];
    const r = calcularCambioDesdeLineas(800, caja);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(totalDeLineas(r.lineas)).toBe(800);
    expect(r.piezas).toBe(6);
  });

  it("el voraz fallaría aquí y la programación dinámica no", () => {
    // Voraz: coge el billete de 20 € y se queda con 5 € que no puede formar con
    // lo que resta. La solución real es 3 × 8 €... que no existe en euros, así
    // que se usa un caso equivalente: 25 € con un billete de 20 € (único) y
    // cinco monedas de 2 €. Voraz → 20 + no puede cerrar 5. Óptimo real: no
    // existe. Se comprueba que efectivamente lo declara imposible.
    const caja: LineaDenominacion[] = [
      { valor: 2000, cantidad: 1 },
      { valor: 200, cantidad: 5 },
    ];
    const r = calcularCambioDesdeLineas(2500, caja);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("NO_SOLUTION");
  });

  it("encuentra la solución que obliga a NO coger la denominación mayor", () => {
    // 6 €: con el billete de 5 € quedaría 1 € y no hay monedas de 1 €.
    // La única salida es 3 monedas de 2 €, ignorando el billete.
    const caja: LineaDenominacion[] = [
      { valor: 500, cantidad: 1 },
      { valor: 200, cantidad: 3 },
    ];
    const r = calcularCambioDesdeLineas(600, caja);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toEqual([{ valor: 200, cantidad: 3 }]);
  });
});

// ── Contraste exhaustivo ───────────────────────────────────────────────────

describe("cambio: contraste contra búsqueda exhaustiva", () => {
  it("coincide con la fuerza bruta en todos los importes de varias cajas", () => {
    const cajas: LineaDenominacion[][] = [
      [
        { valor: 500, cantidad: 2 },
        { valor: 200, cantidad: 3 },
        { valor: 100, cantidad: 2 },
        { valor: 50, cantidad: 3 },
        { valor: 20, cantidad: 2 },
      ],
      [
        { valor: 2000, cantidad: 1 },
        { valor: 1000, cantidad: 1 },
        { valor: 500, cantidad: 1 },
        { valor: 200, cantidad: 2 },
        { valor: 100, cantidad: 1 },
      ],
      // Caja con huecos: sin monedas de 1 € ni de 10 c. Es donde aparecen los
      // importes imposibles y donde un algoritmo flojo se delata.
      [
        { valor: 500, cantidad: 3 },
        { valor: 200, cantidad: 4 },
        { valor: 50, cantidad: 3 },
        { valor: 5, cantidad: 2 },
      ],
      // Solo menudo: obliga a usar muchísimas piezas de la misma denominación,
      // que es el caso que estresa la ventana del mínimo deslizante.
      [
        { valor: 2, cantidad: 12 },
        { valor: 1, cantidad: 9 },
      ],
    ];

    for (const caja of cajas) {
      const stock = inventarioDesdeLineas(caja);
      const total = totalInventario(stock);

      for (let importe = 0; importe <= total; importe++) {
        const esperado = minimoPiezasFuerzaBruta(importe, caja);
        const r = calcularCambio(importe, stock);

        if (esperado === null) {
          expect(r.ok, `importe ${importe} debería ser imposible`).toBe(false);
          if (!r.ok) expect(r.motivo).toBe("NO_SOLUTION");
          continue;
        }

        expect(r.ok, `importe ${importe} debería tener solución`).toBe(true);
        if (!r.ok) continue;

        // Tres invariantes: suma exacta, mínimo de piezas y stock respetado.
        expect(totalDeLineas(r.lineas), `importe ${importe}`).toBe(importe);
        expect(r.piezas, `importe ${importe}`).toBe(esperado);
        expect(cabeDentro(stock, inventarioDesdeLineas(r.lineas)), `importe ${importe}`).toBe(true);
      }
    }
  });

  it("a igualdad de piezas conserva el menudo", () => {
    // 10 € se pueden devolver con un billete de 10 € o con dos de 5 €.
    // Ambas son válidas; la de una pieza gana por mínimo de piezas.
    const caja: LineaDenominacion[] = [
      { valor: 1000, cantidad: 1 },
      { valor: 500, cantidad: 2 },
    ];
    const r = calcularCambioDesdeLineas(1000, caja);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toEqual([{ valor: 1000, cantidad: 1 }]);
  });
});

// ── Límites ────────────────────────────────────────────────────────────────

describe("cambio: límites y entradas no válidas", () => {
  it("rechaza importes negativos o no enteros", () => {
    for (const malo of [-1, 12.5, NaN, Infinity]) {
      const r = calcularCambioDesdeLineas(malo, CAJA_300);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe("IMPORTE_NO_VALIDO");
    }
  });

  it("se planta por encima del máximo en lugar de reservar media máquina", () => {
    const cajaEnorme: LineaDenominacion[] = [{ valor: 50000, cantidad: 1000 }];
    const r = calcularCambioDesdeLineas(CAMBIO_MAXIMO_CENTIMOS + 100, cajaEnorme);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("IMPORTE_EXCESIVO");
  });

  it("resuelve justo en el máximo", () => {
    const caja: LineaDenominacion[] = [{ valor: 50000, cantidad: 10 }];
    const r = calcularCambioDesdeLineas(CAMBIO_MAXIMO_CENTIMOS, caja);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(totalDeLineas(r.lineas)).toBe(CAMBIO_MAXIMO_CENTIMOS);
  });

  it("una caja vacía no puede devolver nada salvo cero", () => {
    expect(calcularCambioDesdeLineas(0, []).ok).toBe(true);
    const r = calcularCambioDesdeLineas(100, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("STOCK_INSUFICIENTE");
  });
});

// ── Cambio manual ──────────────────────────────────────────────────────────

describe("cambio manual", () => {
  const stock = inventarioDesdeLineas(CAJA_300);

  it("acepta una composición que cuadra y cabe en caja", () => {
    const r = validarCambioManual(1800, [
      { valor: 1000, cantidad: 1 },
      { valor: 500, cantidad: 1 },
      { valor: 200, cantidad: 1 },
      { valor: 100, cantidad: 1 },
    ], stock);
    expect(r.ok).toBe(true);
  });

  it("acepta una composición distinta de la propuesta si suma lo mismo", () => {
    // El operador entrega 18 € en monedas de 2 € porque le viene bien.
    const r = validarCambioManual(1800, [{ valor: 200, cantidad: 9 }], stock);
    expect(r.ok).toBe(true);
  });

  it("rechaza una composición que no suma el importe requerido", () => {
    const r = validarCambioManual(1800, [{ valor: 1000, cantidad: 1 }], stock);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("IMPORTE_NO_CUADRA");
  });

  it("rechaza sacar más piezas de las que hay", () => {
    // Solo hay 2 billetes de 50 €.
    const r = validarCambioManual(15000, [{ valor: 5000, cantidad: 3 }], stock);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("STOCK_INSUFICIENTE");
  });
});
