import { describe, expect, it } from "vitest";
import { extraerEnlaceMapa } from "./enlaceMapa.ts";

describe("extraerEnlaceMapa", () => {
  it("coge los enlaces que manda la gente de verdad", () => {
    const casos = [
      "https://maps.app.goo.gl/AbCdEf123",
      "Estoy aquí: https://maps.app.goo.gl/AbCdEf123 en la N-340",
      "https://goo.gl/maps/AbCdEf",
      "https://maps.google.com/?q=41.11,1.25",
      "https://www.google.com/maps/@41.11,1.25,17z",
      "https://share.google/abcdef",
    ];
    for (const texto of casos) {
      expect(extraerEnlaceMapa(texto), texto).toContain("http");
    }
  });

  it("RECHAZA el dominio que imita al permitido — el fallo que tenía el patrón", () => {
    // Esto es lo que aceptaba el patrón anterior: el host real es del atacante.
    const casos = [
      "https://maps.app.goo.gl.atacante.tld/x",
      "https://maps.google.com.atacante.tld/x",
      "https://goo.gl.evil.example/x",
      "https://share.google.atacante.tld/x",
      "https://www.google.com.mx.atacante.tld/x",
    ];
    for (const texto of casos) {
      expect(extraerEnlaceMapa(texto), texto).toBeNull();
    }
  });

  it("rechaza un host que solo contiene el dominio permitido", () => {
    expect(extraerEnlaceMapa("https://notgoo.gl/x")).toBeNull();
    expect(extraerEnlaceMapa("https://fakemaps.google.com/x")).toBeNull();
  });

  it("no inventa enlaces donde no hay", () => {
    expect(extraerEnlaceMapa("Estoy en el kilómetro 12 de la N-340")).toBeNull();
    expect(extraerEnlaceMapa("")).toBeNull();
    expect(extraerEnlaceMapa(null)).toBeNull();
    expect(extraerEnlaceMapa(undefined)).toBeNull();
  });

  it("no se lleva el texto que va detrás del enlace", () => {
    expect(extraerEnlaceMapa("mira https://maps.app.goo.gl/AbC gracias")).toBe(
      "https://maps.app.goo.gl/AbC"
    );
  });
});
