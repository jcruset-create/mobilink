import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/main.ts";
import { ESTRICTA, descargaAceptable, esMasNueva } from "../src/version.ts";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

describe("qué versión es más nueva", () => {
  it("compara tramo a tramo, no como texto", () => {
    expect(esMasNueva("1.0.10", "1.0.9")).toBe(true);
    /* Como texto, "1.0.10" < "1.0.9" y el agente no se actualizaría nunca. */
    expect(esMasNueva("1.0.9", "1.0.10")).toBe(false);
    expect(esMasNueva("1.10.0", "1.9.99")).toBe(true);
    expect(esMasNueva("2.0.0", "1.99.99")).toBe(true);
  });

  it("la misma versión NO se instala", () => {
    expect(esMasNueva("1.0.2", "1.0.2")).toBe(false);
  });

  it("una versión MÁS VIEJA no se instala nunca", () => {
    /*
     * Es la comprobación que impide que quien conteste por el servidor devuelva
     * a veinte mostradores a una versión antigua con un fallo ya arreglado.
     */
    expect(esMasNueva("1.0.1", "1.0.2")).toBe(false);
    expect(esMasNueva("0.9.9", "1.0.0")).toBe(false);
  });

  it("tramos de más o de menos no la lían", () => {
    expect(esMasNueva("1.1", "1.0.9")).toBe(true);
    expect(esMasNueva("1.0", "1.0.0")).toBe(false);
    expect(esMasNueva("1.0.0.1", "1.0.0")).toBe(true);
  });

  it("basura no se toma por una versión nueva", () => {
    expect(esMasNueva("", "1.0.2")).toBe(false);
    expect(esMasNueva("no-soy-una-version", "1.0.2")).toBe(false);
  });
});

describe("de dónde se acepta descargar", () => {
  it("acepta las releases de la casa", () => {
    expect(
      descargaAceptable(
        "https://github.com/jcruset-create/mobilink/releases/download/autoscan-v1.0.3/mobilink-autoscan-1.0.3.zip"
      )
    ).toBe(true);
    expect(descargaAceptable("https://objects.githubusercontent.com/algo/x.zip")).toBe(true);
  });

  it("rechaza cualquier otro anfitrión", () => {
    expect(descargaAceptable("https://ejemplo.invalido/agente.zip")).toBe(false);
    /* El parecido no basta: un subdominio ajeno no es github.com. */
    expect(descargaAceptable("https://github.com.malo.invalido/x.zip")).toBe(false);
    expect(descargaAceptable("https://notgithub.com/x.zip")).toBe(false);
  });

  it("rechaza sin TLS aunque el anfitrión sea el bueno", () => {
    /* Por HTTP el contenido lo cambia cualquiera que esté en medio. */
    expect(descargaAceptable("http://github.com/x.zip")).toBe(false);
  });

  it("la política ESTRICTA es la de verdad, no una de pruebas relajada", () => {
    /*
     * La política es un parámetro para que las pruebas puedan usar un servidor
     * local sin certificado. Si alguien dejara la relajada como valor por
     * defecto, todo lo de arriba seguiría en verde —esas pruebas la pasan
     * explícita— y el agente aceptaría descargar de cualquier sitio y por HTTP.
     */
    expect(ESTRICTA.exigirTls).toBe(true);
    expect([...ESTRICTA.anfitriones]).toEqual(["github.com", "objects.githubusercontent.com"]);
  });

  it("rechaza lo que ni siquiera es una URL", () => {
    expect(descargaAceptable("")).toBe(false);
    expect(descargaAceptable("C:\\\\temp\\\\agente.zip")).toBe(false);
    expect(descargaAceptable("file:///C:/temp/agente.zip")).toBe(false);
  });
});

describe("la versión del agente", () => {
  /*
   * `VERSION` es lo que el agente dice en el latido; la de `package.json` es la
   * que la CI usa para etiquetar la release y la que el servidor lee para
   * construir la URL de descarga. Si se separan, el servidor anuncia una
   * versión que ningún agente reconoce como suya: o nadie se actualiza nunca, o
   * todos se creen desfasados para siempre y la bandeja enseña un aviso que no
   * se puede quitar.
   *
   * Es un fallo de los aburridos —dos números en dos ficheros— y por eso
   * conviene que lo cace una prueba y no una persona.
   */
  it("dice lo mismo en main.ts que en package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(AQUI, "..", "package.json"), "utf8")
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
