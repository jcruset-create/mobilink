import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La lista de los desplegables se tiene que leer.
 *
 * Con el <select> transparente de Tailwind, en las pantallas oscuras el
 * navegador abría la lista en blanco con la letra clara heredada: no se veía
 * nada. La regla global de `src/index.css` le pone a la lista sus dos colores.
 * Si alguien la quita o deja solo uno de los dos, vuelve el problema (o
 * aparece el contrario: letra oscura sobre fondo oscuro), y ninguna otra
 * prueba lo notaría.
 */
const CSS = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

/** El cuerpo de la regla cuyo selector contiene `selector`. */
function regla(selector: string): string {
  const i = CSS.indexOf(selector);
  expect(i, `falta la regla de «${selector}»`).toBeGreaterThan(-1);
  const abre = CSS.indexOf("{", i);
  return CSS.slice(abre + 1, CSS.indexOf("}", abre));
}

/** Luminancia relativa (WCAG) de un color #rrggbb. */
function luminancia(hex: string): number {
  const canal = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * canal(n >> 16) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

const contraste = (a: string, b: string) => {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
};

const color = (cuerpo: string, propiedad: string) => {
  const m = new RegExp(`(?:^|[;\\s])${propiedad}:\\s*(#[0-9a-fA-F]{6})`).exec(cuerpo);
  expect(m, `la regla no fija ${propiedad}`).not.toBeNull();
  return m![1];
};

describe("lista de los desplegables", () => {
  it("lleva fondo oscuro y letra clara, los dos puestos a la vez", () => {
    const cuerpo = regla("select:not([multiple]):not([size]) option,");
    const fondo = color(cuerpo, "background-color");
    const letra = color(cuerpo, "color");
    expect(luminancia(fondo)).toBeLessThan(0.1);
    // AA para texto normal es 4,5; aquí se pide de sobra.
    expect(contraste(fondo, letra)).toBeGreaterThan(7);
  });

  it("las opciones desactivadas van en gris, pero se leen", () => {
    const fondo = color(regla("select:not([multiple]):not([size]) option,"), "background-color");
    const gris = color(regla("option:disabled"), "color");
    expect(contraste(fondo, gris)).toBeGreaterThan(2.5);
    expect(contraste(fondo, gris)).toBeLessThan(7);
  });
});
