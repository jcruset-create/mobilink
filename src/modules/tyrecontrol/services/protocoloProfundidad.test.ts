import { describe, it, expect } from "vitest";
import { valorDeLaSerie, veredicto, TOLERANCIA_MM, type LecturaDeSerie, veredictoEnLaFicha } from "./protocoloProfundidad";

/** Lecturas del arco, de la más reciente a la más antigua. */
const arco = (...mm: number[]): LecturaDeSerie[] => mm.map((v, i) => ({ mm: v, manual: false, fecha: `d${i}` }));
const aMano = (mm: number, fecha = "m"): LecturaDeSerie => ({ mm, manual: true, fecha });

describe("valorDeLaSerie · tres lecturas: la mediana", () => {
  it("el 4310JYJ: 8,7 · 8,5 · 1,8 → vale 8,5 y el 1,8 queda pendiente", () => {
    const v = valorDeLaSerie(arco(1.8, 8.5, 8.7));
    expect(v?.mm).toBe(8.5);
    expect(v?.confirmada).toBe(true);
    expect(v?.pendiente).toEqual({ mm: 1.8, fecha: "d0" });
  });

  it("el pico hacia arriba tampoco mueve el valor", () => {
    const v = valorDeLaSerie(arco(10.7, 8.6, 8.6));
    expect(v?.mm).toBe(8.6);
    expect(v?.pendiente?.mm).toBe(10.7);
  });

  it("un desgaste de verdad se confirma a la segunda lectura", () => {
    // Antes 9; el arco dice 3,2 y al día siguiente 3,0.
    const v = valorDeLaSerie(arco(3.0, 3.2, 9));
    expect(v?.mm).toBe(3.2);
    expect(v?.confirmada).toBe(true);
    expect(v?.pendiente).toBeNull();
  });

  it("el ruido normal no deja nada pendiente", () => {
    const v = valorDeLaSerie(arco(8.5, 8.7, 9.2));
    expect(v?.mm).toBe(8.7);
    expect(v?.pendiente).toBeNull();
  });

  it("devuelve una lectura que existió, con su fecha, no un promedio", () => {
    const v = valorDeLaSerie(arco(8.5, 9.2, 8.7));
    expect(v?.mm).toBe(8.7);
    expect(v?.fecha).toBe("d2");
  });

  it("solo mira las tres últimas", () => {
    expect(valorDeLaSerie(arco(8.5, 8.6, 8.7, 1.0, 1.0))?.mm).toBe(8.6);
  });

  it("justo en la tolerancia no es un disparate", () => {
    const v = valorDeLaSerie(arco(8.5 - TOLERANCIA_MM, 8.5, 8.5));
    expect(v?.pendiente).toBeNull();
  });
});

describe("valorDeLaSerie · con menos de tres", () => {
  it("dos que coinciden: vale la última, confirmada", () => {
    const v = valorDeLaSerie(arco(3.1, 3.4));
    expect(v).toMatchObject({ mm: 3.1, confirmada: true, pendiente: null });
  });

  it("dos que NO coinciden: se queda la anterior y la última queda pendiente", () => {
    const v = valorDeLaSerie(arco(1.8, 8.5));
    expect(v?.mm).toBe(8.5);
    expect(v?.confirmada).toBe(false);
    expect(v?.pendiente?.mm).toBe(1.8);
  });

  it("una sola: es lo que hay, sin confirmar", () => {
    expect(valorDeLaSerie(arco(3.0))).toMatchObject({ mm: 3.0, confirmada: false, pendiente: null });
  });

  it("ninguna: no hay valor", () => {
    expect(valorDeLaSerie([])).toBeNull();
  });
});

describe("valorDeLaSerie · la medición a mano manda", () => {
  it("la última a mano vale sola, sin esperar a nadie", () => {
    const v = valorDeLaSerie([aMano(3.0), ...arco(8.5, 8.6)]);
    expect(v).toMatchObject({ mm: 3.0, confirmada: true, pendiente: null });
  });

  it("lo anterior a la medición a mano deja de contar", () => {
    // Arco 8,4 después de una manual de 8,5: las de antes (2,0) no entran.
    const v = valorDeLaSerie([...arco(8.4), aMano(8.5), ...arco(2.0)]);
    expect(v?.mm).toBe(8.4);
    expect(v?.confirmada).toBe(true);
  });

  it("un disparate del arco justo después de una manual no la tumba", () => {
    const v = valorDeLaSerie([...arco(1.8), aMano(8.5)]);
    expect(v?.mm).toBe(8.5);
    expect(v?.confirmada).toBe(true);
    expect(v?.pendiente?.mm).toBe(1.8);
  });

  it("con la manual la más antigua de las tres, entra en la mediana como una más", () => {
    const v = valorDeLaSerie([...arco(8.4, 8.2), aMano(8.5)]);
    expect(v?.mm).toBe(8.4);
  });
});

describe("veredicto", () => {
  const min = 4;

  it("rojo solo si el valor bajo está confirmado", () => {
    expect(veredicto(valorDeLaSerie(arco(3.0, 3.2, 9)), min)).toBe("cambiar");
    expect(veredicto(valorDeLaSerie([aMano(3.0)]), min)).toBe("cambiar");
  });

  it("una sola lectura baja: por confirmar, no rojo", () => {
    expect(veredicto(valorDeLaSerie(arco(3.0)), min)).toBe("por_confirmar");
  });

  it("el 4310JYJ: valor 8,5 con un 1,8 pendiente → por confirmar", () => {
    expect(veredicto(valorDeLaSerie(arco(1.8, 8.5, 8.7)), min)).toBe("por_confirmar");
  });

  it("una gastada de verdad con un pico hacia arriba encima sigue en rojo", () => {
    // Es lo que hoy se perdía: 3,1 · 3,0 y de repente 10,7.
    expect(veredicto(valorDeLaSerie(arco(10.7, 3.0, 3.1)), min)).toBe("cambiar");
  });

  it("dos que no coinciden con la vieja baja: por confirmar", () => {
    expect(veredicto(valorDeLaSerie(arco(9.0, 3.0)), min)).toBe("por_confirmar");
  });

  it("en el mínimo justo cuenta como en el informe: ≤", () => {
    expect(veredicto(valorDeLaSerie(arco(4.0, 4.0, 4.1)), min)).toBe("cambiar");
    expect(veredicto(valorDeLaSerie(arco(4.1, 4.1, 4.2)), min)).toBe("ok");
  });

  it("un pendiente ALTO sobre un valor bueno no es nada", () => {
    expect(veredicto(valorDeLaSerie(arco(12.9, 8.6, 8.6)), min)).toBe("ok");
  });

  it("sin valor o sin mínimo no se acusa a nadie", () => {
    expect(veredicto(null, min)).toBe("ok");
    expect(veredicto(valorDeLaSerie(arco(1.0, 1.0, 1.0)), null)).toBe("ok");
  });
});

describe("veredictoEnLaFicha", () => {
  const med = (p: { profundidad_mm: number | null; confirmada?: boolean; pendiente_mm?: number | null }) => p;

  it("si lo que se enseña es lo de la revisión, decide el protocolo", () => {
    expect(veredictoEnLaFicha(3, med({ profundidad_mm: 3, confirmada: true }), 4)).toBe("cambiar");
    expect(veredictoEnLaFicha(3, med({ profundidad_mm: 3, confirmada: false }), 4)).toBe("por_confirmar");
    expect(veredictoEnLaFicha(8.5, med({ profundidad_mm: 8.5, confirmada: true, pendiente_mm: 1.8 }), 4)).toBe("por_confirmar");
    expect(veredictoEnLaFicha(8.5, med({ profundidad_mm: 8.5, confirmada: true }), 4)).toBe("ok");
  });

  it("un mapa antiguo, sin el campo, se trata como confirmado", () => {
    expect(veredictoEnLaFicha(3, med({ profundidad_mm: 3 }), 4)).toBe("cambiar");
  });

  it("si manda la profundidad tecleada en el neumático, cuenta como confirmada", () => {
    // Un usado montado a 3 mm: la revisión decía otra cosa, y más antigua.
    expect(veredictoEnLaFicha(3, med({ profundidad_mm: 9, confirmada: false }), 4)).toBe("cambiar");
    // Un reesculturado a 8 mm tapa la lectura baja pendiente de antes.
    expect(veredictoEnLaFicha(8, med({ profundidad_mm: 4.7, confirmada: true, pendiente_mm: 3 }), 4)).toBe("ok");
    // Sin ninguna revisión, lo del neumático.
    expect(veredictoEnLaFicha(2, null, 4)).toBe("cambiar");
    expect(veredictoEnLaFicha(12, undefined, 4)).toBe("ok");
  });

  it("sin profundidad o sin mínimo no se acusa a nadie", () => {
    expect(veredictoEnLaFicha(null, null, 4)).toBe("ok");
    expect(veredictoEnLaFicha(1, med({ profundidad_mm: 1, confirmada: true }), null)).toBe("ok");
  });
});
