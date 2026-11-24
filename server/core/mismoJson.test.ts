import { describe, expect, it } from "vitest";
import { mismoJson } from "./mismoJson.ts";

describe("mismoJson", () => {
  it("el orden de las claves no importa, tampoco dentro de objetos y listas", () => {
    expect(mismoJson({ a: 1, b: { x: 1, y: [1, { p: 1, q: 2 }] } }, { b: { y: [1, { q: 2, p: 1 }], x: 1 }, a: 1 })).toBe(true);
  });

  it("un valor distinto, una clave de más o el orden de una lista sí importan", () => {
    expect(mismoJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(mismoJson({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(mismoJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });

  it("como se guarda: un undefined no cuenta y un texto JSON vale como su objeto", () => {
    expect(mismoJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(mismoJson('{"b":2,"a":1}', { a: 1, b: 2 })).toBe(true);
  });
});
