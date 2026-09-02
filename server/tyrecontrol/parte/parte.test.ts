import { describe, it, expect } from "vitest";
import {
  normalizarMatricula, normalizarKm, prepararParte,
  type ParteLeido, type NeumaticoLeido,
} from "./parte.ts";

const c = (valor: string | null, confianza: number | null = 0.95) => ({ valor, confianza });
const neu = (o: Partial<NeumaticoLeido> = {}): NeumaticoLeido => ({
  brand: c("Michelin"), model: c("X Multi D"), serial_number: c(null),
  dimension: c("315/80R22.5"), position: c(null), ...o,
});
const parte = (o: Partial<ParteLeido> = {}): ParteLeido => ({
  plate: c("1234ABC"), kilometers: c("245.817"), vehicle: c("Camión"),
  fleet: c(null), date: c("2026-09-01"), tires: [neu()], ...o,
});

describe("la matrícula", () => {
  it("se conserva tal cual: guiones y espacios pueden ser del dato", () => {
    // Una matricula de remolque o extranjera los lleva de verdad; quitarlos
    // seria perder justo lo que el tecnico ha ido a fotografiar.
    expect(normalizarMatricula(" r-1084 bcz ")).toBe("R-1084 BCZ");
  });
  it("vacía es null, no cadena vacía", () => {
    expect(normalizarMatricula("   ")).toBeNull();
    expect(normalizarMatricula(null)).toBeNull();
  });
});

describe("los kilómetros, sin perder cifras", () => {
  it("quita separadores de millar y la unidad, nunca dígitos", () => {
    for (const x of ["245817", "245.817", "245 817", "245817 km", "245.817 KM"]) {
      expect(normalizarKm(x)).toBe("245817");
    }
  });
  it("no inventa cuando no es un número entero limpio", () => {
    // Preferir null a una cifra a medias: un km equivocado estropea el
    // calculo de desgaste de toda la flota.
    expect(normalizarKm("245,8")).toBeNull();
    expect(normalizarKm("245817 / 12")).toBeNull();
    expect(normalizarKm("ilegible")).toBeNull();
  });
  it("rechaza lo que no cabe en un cuentakilómetros", () => {
    expect(normalizarKm("123456789")).toBeNull();
  });
  it("un cero a la izquierda no cambia el número", () => {
    expect(normalizarKm("0245817")).toBe("245817");
  });
});

describe("el parte que ve el técnico", () => {
  it("lo dudoso se deja vacío y se dice cuál era", () => {
    const p = prepararParte(parte({ plate: c("1234ABC", 0.3) }));
    expect(p.plate).toBeNull();
    expect(p.dudosos).toContain("plate");
    expect(p.warnings.join(" ")).toMatch(/matrícula/i);
  });
  it("un km ilegible avisa en vez de colar una cifra falsa", () => {
    const p = prepararParte(parte({ kilometers: c("24 5,81") }));
    expect(p.kilometers).toBeNull();
    expect(p.warnings.join(" ")).toMatch(/kilómetros/i);
  });
  it("sin fotos legibles lo dice y no se declara utilizable", () => {
    const p = prepararParte(null);
    expect(p.utilizable).toBe(false);
    expect(p.warnings.length).toBeGreaterThan(0);
  });
  it("con matrícula pero sin gomas sigue sirviendo, y avisa", () => {
    const p = prepararParte(parte({ tires: [] }));
    expect(p.utilizable).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/ningún neumático/i);
  });
});

describe("neumáticos repetidos en varias fotos", () => {
  it("el mismo número de serie es el mismo neumático, aunque cambie lo demás", () => {
    const p = prepararParte(parte({ tires: [
      neu({ serial_number: c("ABC123"), model: c(null) }),
      neu({ serial_number: c("ABC123"), model: c("X Multi D") }),
    ]}));
    expect(p.tires).toHaveLength(1);
    // Y se queda con lo mejor de las dos lecturas.
    expect(p.tires[0].model).toBe("X Multi D");
  });
  it("dos gomas IGUALES en posiciones distintas son dos, no una", () => {
    // Un camion lleva ocho ruedas identicas: fusionarlas dejaria el parte
    // con una sola y el tecnico no sabria que le falta.
    const p = prepararParte(parte({ tires: [
      neu({ position: c("E1_IZQ") }), neu({ position: c("E1_DER") }),
    ]}));
    expect(p.tires).toHaveLength(2);
  });
  it("la misma goma sin serie y sin posición se funde una sola vez", () => {
    const p = prepararParte(parte({ tires: [neu(), neu()] }));
    expect(p.tires).toHaveLength(1);
  });
  it("un neumático del que no se ha leído nada no cuenta", () => {
    const p = prepararParte(parte({ tires: [
      neu(), neu({ brand: c(null), model: c(null), dimension: c(null) }),
    ]}));
    expect(p.tires).toHaveLength(1);
  });
  it("la confianza del neumático es la de su PEOR campo", () => {
    const p = prepararParte(parte({ tires: [neu({ dimension: c("315/80R22.5", 0.72) })] }));
    expect(p.tires[0].confidence).toBeCloseTo(0.72);
  });
  it("lo que una foto no leyó y otra sí deja de estar dudoso", () => {
    const p = prepararParte(parte({ tires: [
      neu({ serial_number: c("ABC123"), dimension: c("315/80R22.5", 0.2) }),
      neu({ serial_number: c("ABC123"), dimension: c("315/80R22.5", 0.98) }),
    ]}));
    expect(p.tires[0].dimension).toBe("315/80R22.5");
    expect(p.tires[0].dudosos).not.toContain("dimension");
  });
});

describe("no confundir campos", () => {
  it("la medida se normaliza pero la serie NO se toca", () => {
    const p = prepararParte(parte({ tires: [
      neu({ dimension: c("315/80 R 22.5"), serial_number: c("dot 2325 xk") }),
    ]}));
    expect(p.tires[0].dimension).toBe("315/80R22.5");
    // Recortarla a cuatro cifras destrozaria un numero de serie de fabrica.
    expect(p.tires[0].serial_number).toBe("DOT 2325 XK");
  });
});
