import { describe, it, expect } from "vitest";
import { borrarFondoDesdeLosBordes } from "./fondoLogo";

/** Dibuja una imagen a partir de un mapa de caracteres: B blanco, N negro, . transparente. */
function lienzo(filas: string[]): { datos: number[]; ancho: number; alto: number } {
  const alto = filas.length;
  const ancho = filas[0].length;
  const datos: number[] = [];
  for (const fila of filas) {
    for (const c of fila) {
      if (c === "B") datos.push(255, 255, 255, 255);
      else if (c === "N") datos.push(0, 0, 0, 255);
      else datos.push(0, 0, 0, 0);
    }
  }
  return { datos, ancho, alto };
}

/** Cómo queda: T transparente, O opaco. */
function dibujo(datos: number[], ancho: number, alto: number): string[] {
  const filas: string[] = [];
  for (let y = 0; y < alto; y++) {
    let fila = "";
    for (let x = 0; x < ancho; x++) fila += datos[(y * ancho + x) * 4 + 3] === 0 ? "T" : "O";
    filas.push(fila);
  }
  return filas;
}

describe("borrarFondoDesdeLosBordes", () => {
  it("se lleva el recuadro blanco de alrededor", () => {
    const { datos, ancho, alto } = lienzo([
      "BBBBB",
      "BNNNB",
      "BNNNB",
      "BBBBB",
    ]);
    expect(borrarFondoDesdeLosBordes(datos, ancho, alto)).toBe(14);
    expect(dibujo(datos, ancho, alto)).toEqual([
      "TTTTT",
      "TOOOT",
      "TOOOT",
      "TTTTT",
    ]);
  });

  it("NO toca el blanco de dentro del dibujo", () => {
    // El caso de las letras de MAN: blancas, pero rodeadas de logo.
    const { datos, ancho, alto } = lienzo([
      "BBBBB",
      "BNNNB",
      "BNBNB",
      "BNNNB",
      "BBBBB",
    ]);
    borrarFondoDesdeLosBordes(datos, ancho, alto);
    expect(dibujo(datos, ancho, alto)).toEqual([
      "TTTTT",
      "TOOOT",
      "TOOOT",   // el blanco de en medio sigue opaco
      "TOOOT",
      "TTTTT",
    ]);
  });

  it("un logo que ya venía transparente no se toca", () => {
    const { datos, ancho, alto } = lienzo([
      ".....",
      ".NNN.",
      ".....",
    ]);
    expect(borrarFondoDesdeLosBordes(datos, ancho, alto)).toBe(0);
    expect(dibujo(datos, ancho, alto)).toEqual([
      "TTTTT",
      "TOOOT",
      "TTTTT",
    ]);
  });

  it("un blanco roto también es fondo, pero un gris no", () => {
    const gris = [200, 200, 200, 255];
    const casi = [248, 249, 247, 255];
    const datos = [...casi, ...gris, ...casi];
    expect(borrarFondoDesdeLosBordes(datos, 3, 1)).toBe(2);
    expect(datos[3]).toBe(0);   // el casi-blanco de la izquierda, fuera
    expect(datos[7]).toBe(255); // el gris se queda
  });

  it("un logo sin fondo blanco no pierde nada", () => {
    const { datos, ancho, alto } = lienzo([
      "NNN",
      "NNN",
    ]);
    expect(borrarFondoDesdeLosBordes(datos, ancho, alto)).toBe(0);
  });

  it("una imagen vacía no rompe", () => {
    expect(borrarFondoDesdeLosBordes([], 0, 0)).toBe(0);
  });
});
