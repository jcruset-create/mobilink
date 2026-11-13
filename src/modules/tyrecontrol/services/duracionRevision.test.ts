/**
 * Cuánto tarda una revisión, dicho en la pantalla.
 *
 * Lo que se fija aquí, sobre todo, es la diferencia entre «no hay dato» y «el
 * dato es cero». Una revisión del CheckPoint no dura cero segundos: es que no
 * dura, porque el arco mide al paso y no hay nada que empiece. Enseñar «0 s»
 * en esas 10.778 filas sería afirmar algo falso sobre cada una.
 */

import { describe, expect, it } from "vitest";

import {
  desglosePausas,
  duracionCorta,
  motivoSinDuracion,
  resumenDuracion,
  tieneDuracion,
} from "./duracionRevision";

describe("cómo se dice una duración", () => {
  it("por debajo del minuto, segundos", () => {
    expect(duracionCorta(43)).toBe("43 s");
    expect(duracionCorta(59)).toBe("59 s");
  });

  it("un cero es un dato, no una ausencia", () => {
    // Se abrió y se cerró en el mismo segundo. Raro, pero verdad, y hay que
    // poder verlo para ir a mirar qué pasó.
    expect(duracionCorta(0)).toBe("0 s");
  });

  it("minutos y segundos, con los casos reales de la instalación", () => {
    expect(duracionCorta(86)).toBe("1 min 26 s"); // mediana de solo profundidades
    expect(duracionCorta(134)).toBe("2 min 14 s"); // mediana con presiones
    expect(duracionCorta(1306)).toBe("21 min 46 s"); // la más larga que hay
  });

  it("se callan los segundos cuando son cero", () => {
    expect(duracionCorta(60)).toBe("1 min");
    expect(duracionCorta(180)).toBe("3 min");
  });

  it("a partir de la hora, horas y minutos", () => {
    expect(duracionCorta(3600)).toBe("1 h");
    expect(duracionCorta(3900)).toBe("1 h 5 min");
    expect(duracionCorta(7199)).toBe("2 h"); // 1 h 59 min 59 s redondea a 2 h
  });

  it("justo por debajo de la hora siguen siendo minutos", () => {
    expect(duracionCorta(3599)).toBe("59 min 59 s");
  });

  it("el redondeo de los minutos no inventa «1 h 60 min»", () => {
    // 7190 s son 1 h y 59,83 min: al redondear los minutos salen 60, que no es
    // «1 h 60 min» sino dos horas.
    expect(duracionCorta(7190)).toBe("2 h");
  });

  it("lo que no es un número es raya, no cero", () => {
    expect(duracionCorta(null)).toBe("—");
    expect(duracionCorta(undefined)).toBe("—");
    expect(duracionCorta(Number.NaN)).toBe("—");
    expect(duracionCorta(Number.POSITIVE_INFINITY)).toBe("—");
    // Un negativo solo puede venir de un reloj mal puesto: no se enseña.
    expect(duracionCorta(-5)).toBe("—");
  });
});

describe("hay cronómetro o no lo hay", () => {
  it("lo hay con un número, cero incluido", () => {
    expect(tieneDuracion({ duracion_seg: 86 })).toBe(true);
    expect(tieneDuracion({ duracion_seg: 0 })).toBe(true);
  });

  it("no lo hay sin número ni con basura", () => {
    expect(tieneDuracion(null)).toBe(false);
    expect(tieneDuracion(undefined)).toBe(false);
    expect(tieneDuracion({})).toBe(false);
    expect(tieneDuracion({ duracion_seg: null })).toBe(false);
    expect(tieneDuracion({ duracion_seg: Number.NaN })).toBe(false);
    expect(tieneDuracion({ duracion_seg: -1 })).toBe(false);
  });

  it("el motivo distingue los tres casos", () => {
    expect(motivoSinDuracion(true)).toContain("CheckPoint");
    expect(motivoSinDuracion(false)).toContain("anterior al cronómetro");
    // El inventario no es «antiguo»: es que no se cronometra, y decir lo otro
    // haría esperar que la próxima vez sí traiga número.
    expect(motivoSinDuracion(false, true)).toContain("no se cronometra");
    expect(motivoSinDuracion(true, true)).toContain("no se cronometra");
    expect(new Set([
      motivoSinDuracion(true), motivoSinDuracion(false), motivoSinDuracion(false, true),
    ]).size).toBe(3);
  });

  it("la hecha en papel tiene su propio motivo, y manda sobre los demás", () => {
    // Decirle «anterior al cronómetro de la APK» a una revisión de esta semana
    // sería falso: el cronómetro existe, lo que no hubo es tablet. Y quien lo
    // leyera se quedaría esperando que la próxima traiga número.
    expect(motivoSinDuracion(false, false, true)).toContain("en papel");
    expect(motivoSinDuracion(false, false, true)).not.toContain("anterior al cronómetro");
    // Manda también sobre el inventario: un inventario pasado desde un papel
    // de hace días no se cronometró por las dos razones, y la de fuera es la
    // que explica por qué tampoco tiene coordenadas.
    expect(motivoSinDuracion(true, true, true)).toContain("en papel");
    expect(new Set([
      motivoSinDuracion(true), motivoSinDuracion(false),
      motivoSinDuracion(false, true), motivoSinDuracion(false, false, true),
    ]).size).toBe(4);
  });
});

describe("el desglose de pausas", () => {
  it("sin pausas no hay nada que desglosar", () => {
    // El caso normal hoy: no hay una sola pausa en toda la base. Repetir el
    // mismo número con otro nombre no añadiría nada.
    expect(desglosePausas({ duracion_seg: 134, trabajo_seg: 134, pausa_seg: 0, n_pausas: 0 })).toBeNull();
    expect(desglosePausas({ duracion_seg: 134 })).toBeNull();
    expect(desglosePausas(null)).toBeNull();
  });

  it("con una pausa se dice el trabajo y la pausa", () => {
    expect(
      desglosePausas({ duracion_seg: 134, trabajo_seg: 110, pausa_seg: 24, n_pausas: 1 }),
    ).toBe("1 min 50 s de trabajo · 1 pausa de 24 s");
  });

  it("con varias, en plural", () => {
    expect(
      desglosePausas({ duracion_seg: 600, trabajo_seg: 420, pausa_seg: 180, n_pausas: 3 }),
    ).toBe("7 min de trabajo · 3 pausas de 3 min");
  });

  it("una pausa sin trabajo apuntado solo dice la pausa", () => {
    expect(desglosePausas({ duracion_seg: 134, pausa_seg: 24, n_pausas: 1 }))
      .toBe("1 pausa de 24 s");
  });
});

describe("el resumen de la cabecera", () => {
  it("sin ninguna cronometrada no se inventa una mediana", () => {
    expect(resumenDuracion([])).toEqual({ cronometradas: 0, medianaSeg: null });
    expect(resumenDuracion([{ duracion_seg: null }, null, {}]))
      .toEqual({ cronometradas: 0, medianaSeg: null });
  });

  it("cuenta solo las que llevan cronómetro", () => {
    const r = resumenDuracion([
      { duracion_seg: 86 },
      { duracion_seg: null }, // CheckPoint
      { duracion_seg: 134 },
      null,
    ]);
    expect(r.cronometradas).toBe(2);
  });

  it("mediana con número impar de filas", () => {
    expect(resumenDuracion([{ duracion_seg: 50 }, { duracion_seg: 86 }, { duracion_seg: 300 }]).medianaSeg)
      .toBe(86);
  });

  it("mediana con número par: el punto medio de las dos centrales", () => {
    expect(
      resumenDuracion([
        { duracion_seg: 50 },
        { duracion_seg: 80 },
        { duracion_seg: 90 },
        { duracion_seg: 300 },
      ]).medianaSeg,
    ).toBe(85);
  });

  it("no la arrastra una revisión que alguien dejó abierta", () => {
    // Es el motivo de usar mediana y no media: con estos cinco, la media sale
    // a 325 s y la mediana a 90. La de 21 minutos existe de verdad en la base.
    const filas = [
      { duracion_seg: 60 },
      { duracion_seg: 80 },
      { duracion_seg: 90 },
      { duracion_seg: 100 },
      { duracion_seg: 1306 },
    ];
    expect(resumenDuracion(filas).medianaSeg).toBe(90);
  });

  it("no altera el orden de la lista que recibe", () => {
    // Ordena para la mediana, y hacerlo sobre el array de la pantalla
    // reordenaría la tabla entera sin que nadie lo haya pedido.
    const filas = [{ duracion_seg: 300 }, { duracion_seg: 50 }, { duracion_seg: 86 }];
    resumenDuracion(filas);
    expect(filas.map((f) => f.duracion_seg)).toEqual([300, 50, 86]);
  });
});
