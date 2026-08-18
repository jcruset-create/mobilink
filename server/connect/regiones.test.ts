/**
 * Provincia → comunidad autónoma.
 *
 * Importa acertar porque de aquí salen los festivos autonómicos de cada
 * taller. Un taller asignado a la comunidad equivocada tendría los festivos de
 * otro sitio, y el operador llamaría a un taller cerrado creyendo que abre.
 *
 * Las provincias llegan como texto libre —de importaciones, de WhatsApp y de
 * altas a mano—, así que lo que se prueba sobre todo es cuánta suciedad
 * aguanta la búsqueda.
 */

import { describe, expect, it } from "vitest";
import { regionDeProvincia, normalizarProvincia, nombreRegion, REGIONES } from "./regiones.ts";

describe("Comunidad autónoma de una provincia", () => {
  it("acierta con las provincias escritas bien", () => {
    expect(regionDeProvincia("Zaragoza")).toBe("AR");
    expect(regionDeProvincia("Barcelona")).toBe("CT");
    expect(regionDeProvincia("Madrid")).toBe("MD");
    expect(regionDeProvincia("Sevilla")).toBe("AN");
    expect(regionDeProvincia("Valladolid")).toBe("CL");
  });

  it("aguanta acentos, mayúsculas y espacios de más", () => {
    expect(regionDeProvincia("  MÁLAGA ")).toBe("AN");
    expect(regionDeProvincia("Cádiz")).toBe("AN");
    expect(regionDeProvincia("LEÓN")).toBe("CL");
    expect(regionDeProvincia("Castellón")).toBe("VC");
  });

  it("acepta las dos formas oficiales de los nombres gallegos y vascos", () => {
    expect(regionDeProvincia("A Coruña")).toBe("GA");
    expect(regionDeProvincia("La Coruña")).toBe("GA");
    expect(regionDeProvincia("Ourense")).toBe("GA");
    expect(regionDeProvincia("Orense")).toBe("GA");
    expect(regionDeProvincia("Gipuzkoa")).toBe("PV");
    expect(regionDeProvincia("Guipúzcoa")).toBe("PV");
    expect(regionDeProvincia("Bizkaia")).toBe("PV");
    expect(regionDeProvincia("Vizcaya")).toBe("PV");
    expect(regionDeProvincia("Girona")).toBe("CT");
    expect(regionDeProvincia("Gerona")).toBe("CT");
  });

  it("saca la provincia de una cadena compuesta", () => {
    expect(regionDeProvincia("Barcelona (Cataluña)")).toBe("CT");
    expect(regionDeProvincia("Valencia/València")).toBe("VC");
    expect(regionDeProvincia("Provincia de Toledo")).toBe("CM");
  });

  it("las ciudades que dan nombre a su comunidad también valen", () => {
    // Los talleres a veces traen la ciudad donde debería ir la provincia
    expect(regionDeProvincia("Bilbao")).toBe("PV");
    expect(regionDeProvincia("Logroño")).toBe("RI");
    expect(regionDeProvincia("Santander")).toBe("CB");
    expect(regionDeProvincia("Pamplona")).toBe("NC");
  });

  it("lo que no se reconoce devuelve null, no una comunidad al azar", () => {
    /*
     * Adivinar sería lo peor: el taller acabaría con los festivos de otra
     * comunidad y nadie lo notaría hasta llamar a uno cerrado. Un null se ve
     * en la pantalla de cobertura y se corrige.
     */
    expect(regionDeProvincia("Lisboa")).toBeNull();
    expect(regionDeProvincia("")).toBeNull();
    expect(regionDeProvincia(null)).toBeNull();
    expect(regionDeProvincia("no sé")).toBeNull();
  });

  it("Ceuta y Melilla son su propia comunidad", () => {
    expect(regionDeProvincia("Ceuta")).toBe("CE");
    expect(regionDeProvincia("Melilla")).toBe("ML");
  });

  it("todas las provincias de España caen en alguna comunidad", () => {
    const provincias = [
      "Álava", "Albacete", "Alicante", "Almería", "Asturias", "Ávila", "Badajoz",
      "Baleares", "Barcelona", "Burgos", "Cáceres", "Cádiz", "Cantabria",
      "Castellón", "Ciudad Real", "Córdoba", "A Coruña", "Cuenca", "Girona",
      "Granada", "Guadalajara", "Guipúzcoa", "Huelva", "Huesca", "Jaén", "León",
      "Lleida", "Lugo", "Madrid", "Málaga", "Murcia", "Navarra", "Ourense",
      "Palencia", "Las Palmas", "Pontevedra", "La Rioja", "Salamanca",
      "Santa Cruz de Tenerife", "Segovia", "Sevilla", "Soria", "Tarragona",
      "Teruel", "Toledo", "Valencia", "Valladolid", "Vizcaya", "Zamora",
      "Zaragoza", "Ceuta", "Melilla",
    ];
    const sinResolver = provincias.filter((p) => regionDeProvincia(p) == null);
    expect(sinResolver).toEqual([]);
    expect(provincias).toHaveLength(52);
  });

  it("todo código que se devuelve existe en la lista de comunidades", () => {
    const codigos = new Set(REGIONES.map((r) => r.code));
    for (const p of ["Zaragoza", "Bilbao", "Ceuta", "Las Palmas", "Toledo"]) {
      expect(codigos.has(regionDeProvincia(p)!), p).toBe(true);
    }
    expect(REGIONES).toHaveLength(19);
  });

  it("el nombre de la comunidad se puede recuperar por su código", () => {
    expect(nombreRegion("AR")).toBe("Aragón");
    expect(nombreRegion("XX")).toBeNull();
    expect(nombreRegion(null)).toBeNull();
  });
});

describe("Normalización de provincia", () => {
  it("deja el nombre comparable", () => {
    expect(normalizarProvincia("  Á L A V A ")).toBe("a l a v a");
    expect(normalizarProvincia("Provincia de Cuenca")).toBe("cuenca");
    expect(normalizarProvincia("Sta. Cruz, Tenerife")).toBe("sta cruz tenerife");
  });
});
