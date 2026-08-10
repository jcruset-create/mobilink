import { describe, it, expect } from "vitest";
import { masNuevaPrimero, buildDeVersion, nombreDeVersion } from "./apkVersion.ts";

describe("buildDeVersion", () => {
  it("saca el build de una versión completa", () => {
    expect(buildDeVersion("0.33.4+67")).toBe(67);
  });
  it("sin build es 0", () => {
    expect(buildDeVersion("0.33.4")).toBe(0);
  });
});

describe("nombreDeVersion", () => {
  it("parte el nombre en tramos", () => {
    expect(nombreDeVersion("0.33.4+67")).toEqual([0, 33, 4]);
  });
});

describe("masNuevaPrimero", () => {
  it("manda el build, no el nombre", () => {
    // El caso real: 0.33.2+60 se publicó el 5 de agosto y 0.32.9+65 el día 7.
    // Ordenando por nombre ganaba la vieja y descargas la ofrecía dos días.
    const releases = ["0.33.2+60", "0.32.9+65", "0.33.0+66", "0.32.8+64"];
    releases.sort(masNuevaPrimero);
    expect(releases[0]).toBe("0.33.0+66");
    expect(releases).toEqual(["0.33.0+66", "0.32.9+65", "0.32.8+64", "0.33.2+60"]);
  });

  it("con el mismo build desempata el nombre", () => {
    const releases = ["0.32.1+70", "0.33.0+70"];
    releases.sort(masNuevaPrimero);
    expect(releases[0]).toBe("0.33.0+70");
  });

  it("el orden real de las releases publicadas deja la última arriba", () => {
    const releases = [
      "0.32.6+59", "0.33.2+60", "0.32.7+62", "0.32.8+63",
      "0.32.8+64", "0.32.9+65", "0.33.0+66", "0.33.4+67",
    ];
    releases.sort(masNuevaPrimero);
    expect(releases[0]).toBe("0.33.4+67");
  });

  it("un build de tres cifras no se compara como texto", () => {
    // "9" > "10" si se comparan como cadenas: el build es número.
    const releases = ["0.34.0+9", "0.34.0+10"];
    releases.sort(masNuevaPrimero);
    expect(releases[0]).toBe("0.34.0+10");
  });

  it("es un orden estable y total (comparador simétrico)", () => {
    expect(masNuevaPrimero("0.33.0+66", "0.33.0+66")).toBe(0);
    expect(Math.sign(masNuevaPrimero("0.33.0+66", "0.32.9+65"))).toBe(
      -Math.sign(masNuevaPrimero("0.32.9+65", "0.33.0+66")),
    );
  });
});
