/**
 * Lo que se fija aquí es que los cinco estados NO se confundan entre sí.
 *
 * «No hay lectura» y «no se pudo preguntar» piden cosas distintas al técnico:
 * una se resuelve tecleando los kilómetros y la otra reintentando. Decirle lo
 * mismo en los dos casos le hace reintentar cuando no sirve de nada, o teclear
 * cuando bastaba con esperar diez segundos.
 */

import { describe, expect, it } from "vitest";

import {
  avisoDeSalto, clasificarLectura, frescuraDeConfig, haceCuanto, tocaRefrescar,
  FRESCURA_ODOMETRO_MIN,
} from "./frescura.ts";

const AHORA = new Date("2026-09-16T10:42:00.000Z");
const haceMin = (m: number) => new Date(AHORA.getTime() - m * 60_000);

const encontrado = (min: number, extra: Record<string, unknown> = {}) =>
  clasificarLectura({
    resultado: {
      estado: "encontrado", km: 482315, capturadoAt: haceMin(min),
      proveedor: "movertis", externo: "EQ-3", ...extra,
    } as never,
    ahora: AHORA,
  });

describe("clasificarLectura", () => {
  it("una lectura reciente vale como actual, y dice de cuándo es", () => {
    const l = encontrado(2);
    expect(l.estado).toBe("actualizado");
    expect(l.km).toBe(482315);
    expect(l.antiguedadMin).toBe(2);
    expect(l.texto).toBe("Lectura de hace 2 minutos.");
  });

  it("una lectura vieja se usa igual, pero avisando de que pudo rodar", () => {
    const l = encontrado(400);
    expect(l.estado).toBe("lectura_anterior");
    expect(l.km).toBe(482315);      // el número sigue estando
    expect(l.texto).toContain("puede haber rodado");
  });

  it("el corte está en el umbral, y se puede mover por cuenta", () => {
    expect(encontrado(FRESCURA_ODOMETRO_MIN).estado).toBe("actualizado");
    expect(encontrado(FRESCURA_ODOMETRO_MIN + 1).estado).toBe("lectura_anterior");
    const estrecha = clasificarLectura({
      resultado: { estado: "encontrado", km: 1, capturadoAt: haceMin(10),
                   proveedor: "movertis", externo: "EQ-3" },
      ahora: AHORA, frescuraMin: 5,
    });
    expect(estrecha.estado).toBe("lectura_anterior");
  });

  it("siempre se guardan las DOS fechas: la de la lectura y la de la consulta", () => {
    // Un número sin fecha invita a creerse que es de ahora mismo, y la fecha
    // de cuándo se preguntó no es la misma que la de cuándo se midió.
    const l = encontrado(30);
    expect(l.capturadoAt).toEqual(haceMin(30));
    expect(l.consultadoAt).toEqual(AHORA);
  });

  it("un odómetro por GPS se avisa: no es el del salpicadero", () => {
    const l = encontrado(3, { origenOdometro: "gps" });
    expect(l.texto).toContain("GPS");
    expect(l.origenOdometro).toBe("gps");
  });

  it("una lectura con el reloj del proveedor adelantado no se rechaza", () => {
    const l = clasificarLectura({
      resultado: { estado: "encontrado", km: 100, capturadoAt: new Date(AHORA.getTime() + 60_000),
                   proveedor: "movertis", externo: "EQ-3" },
      ahora: AHORA,
    });
    expect(l.estado).toBe("actualizado");
    expect(l.antiguedadMin).toBe(0);
  });

  it("sin enlace telemático no es un fallo, y se dice distinto", () => {
    const l = clasificarLectura({ resultado: { estado: "sin_telematica" }, ahora: AHORA });
    expect(l.estado).toBe("sin_telematica");
    expect(l.km).toBeNull();
  });

  it("el proveedor sin odómetro y el proveedor caído NO son el mismo estado", () => {
    const sinDato = clasificarLectura({ resultado: { estado: "sin_lectura" }, ahora: AHORA });
    const caido = clasificarLectura({ resultado: { estado: "no_disponible" }, ahora: AHORA });
    expect(sinDato.estado).toBe("no_disponible");
    expect(caido.estado).toBe("error");
    expect(sinDato.estado).not.toBe(caido.estado);
  });

  it("ningún texto enseña un error técnico al operario", () => {
    for (const r of [{ estado: "sin_lectura" }, { estado: "no_disponible" }, { estado: "sin_telematica" }] as const) {
      const t = clasificarLectura({ resultado: r, ahora: AHORA }).texto;
      expect(t).not.toMatch(/error:|stack|http|\d{3} [A-Z]|null|undefined/i);
    }
  });
});

describe("frescuraDeConfig", () => {
  it("sin configuración manda el valor por defecto", () => {
    expect(frescuraDeConfig(undefined)).toBe(FRESCURA_ODOMETRO_MIN);
    expect(frescuraDeConfig({})).toBe(FRESCURA_ODOMETRO_MIN);
  });

  it("una cuenta puede estrechar o ensanchar el umbral", () => {
    expect(frescuraDeConfig({ frescuraOdometroMin: 30 })).toBe(30);
    expect(frescuraDeConfig({ frescuraOdometroMin: 600 })).toBe(600);
  });

  it("un valor absurdo no convierte en actual lo que no lo es", () => {
    expect(frescuraDeConfig({ frescuraOdometroMin: 0 })).toBe(FRESCURA_ODOMETRO_MIN);
    expect(frescuraDeConfig({ frescuraOdometroMin: -5 })).toBe(FRESCURA_ODOMETRO_MIN);
    expect(frescuraDeConfig({ frescuraOdometroMin: "mucho" })).toBe(FRESCURA_ODOMETRO_MIN);
    // Una semana no es «actual» por mucho que lo diga la configuración.
    expect(frescuraDeConfig({ frescuraOdometroMin: 10080 })).toBe(24 * 60);
  });
});

describe("tocaRefrescar", () => {
  it("no se vuelve a preguntar si la lectura sigue valiendo", () => {
    // El cupo del proveedor es limitado y compartido con el barrido de bases.
    expect(tocaRefrescar(encontrado(5), AHORA)).toBe(false);
  });

  it("se vuelve a preguntar cuando ya no vale", () => {
    expect(tocaRefrescar(encontrado(5), new Date(AHORA.getTime() + 200 * 60_000))).toBe(true);
  });

  it("sin lectura previa, siempre se pregunta", () => {
    const sin = clasificarLectura({ resultado: { estado: "sin_lectura" }, ahora: AHORA });
    expect(tocaRefrescar(sin, AHORA)).toBe(true);
  });
});

describe("avisoDeSalto", () => {
  it("un odómetro menor que el último confirmado se avisa, no se bloquea", () => {
    const a = avisoDeSalto({ km: 400000, kmAnterior: 482315 });
    expect(a).toContain("MENOR");
    // Avisa. Puede ser un cambio de equipo o una corrección del contador, y
    // negarse a trabajar por eso dejaría el camión sin parte.
  });

  it("un salto enorme se avisa", () => {
    expect(avisoDeSalto({ km: 490000, kmAnterior: 482315, dias: 1 })).toContain("Compruébalo");
  });

  it("un incremento normal no molesta", () => {
    expect(avisoDeSalto({ km: 482800, kmAnterior: 482315, dias: 1 })).toBeNull();
  });

  it("el mismo salto repartido en más días es normal", () => {
    expect(avisoDeSalto({ km: 490000, kmAnterior: 482315, dias: 30 })).toBeNull();
  });

  it("sin kilometraje anterior no hay nada que comparar", () => {
    expect(avisoDeSalto({ km: 1000, kmAnterior: null })).toBeNull();
    expect(avisoDeSalto({ km: 1000, kmAnterior: 0 })).toBeNull();
  });
});

describe("haceCuanto", () => {
  it("se lee como lo diría una persona", () => {
    expect(haceCuanto(0)).toBe("hace menos de un minuto");
    expect(haceCuanto(1)).toBe("hace 1 minuto");
    expect(haceCuanto(42)).toBe("hace 42 minutos");
    expect(haceCuanto(60)).toBe("hace 1 hora");
    expect(haceCuanto(200)).toBe("hace 3 horas");
    expect(haceCuanto(1500)).toBe("hace 1 día");
    expect(haceCuanto(5000)).toBe("hace 3 días");
  });
});
