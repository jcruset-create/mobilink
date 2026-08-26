import { describe, expect, it } from "vitest";
import { elementosCambiados, instantaneaDe } from "./deltaSync";

type Item = { id: string; valor: string };

describe("elementosCambiados", () => {
  it("sin cambios no envía nada", () => {
    const items: Item[] = [{ id: "a", valor: "1" }];
    const { cambiados, eliminados } = elementosCambiados(
      items,
      instantaneaDe(items)
    );

    expect(cambiados).toEqual([]);
    expect(eliminados).toEqual([]);
  });

  it("detecta altas y modificaciones, y deja fuera lo que no cambia", () => {
    const antes: Item[] = [
      { id: "a", valor: "1" },
      { id: "b", valor: "2" },
    ];
    const ahora: Item[] = [
      { id: "a", valor: "1" },
      { id: "b", valor: "CAMBIADO" },
      { id: "c", valor: "3" },
    ];

    const { cambiados, eliminados } = elementosCambiados(
      ahora,
      instantaneaDe(antes)
    );

    expect(cambiados.map((i) => i.id).sort()).toEqual(["b", "c"]);
    expect(eliminados).toEqual([]);
  });

  it("detecta los borrados locales", () => {
    const antes: Item[] = [
      { id: "a", valor: "1" },
      { id: "b", valor: "2" },
    ];
    const ahora: Item[] = [{ id: "a", valor: "1" }];

    const { cambiados, eliminados } = elementosCambiados(
      ahora,
      instantaneaDe(antes)
    );

    expect(cambiados).toEqual([]);
    expect(eliminados).toEqual(["b"]);
  });

  it("la instantánea nueva refleja el estado actual", () => {
    const { instantanea } = elementosCambiados(
      [{ id: "a", valor: "nuevo" }],
      instantaneaDe([{ id: "a", valor: "viejo" }])
    );

    expect(instantanea.get("a")).toBe(JSON.stringify({ id: "a", valor: "nuevo" }));
  });
});
