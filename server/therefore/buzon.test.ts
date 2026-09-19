/**
 * Lo puro del buzón: qué se acepta y cómo se lee el cuerpo.
 *
 * La pasada entera —abrir el buzón, parsear, guardar el PDF, abrir el
 * expediente— va en la de integración con un buzón falso. Aquí sólo las reglas
 * que se pueden probar sin nada por debajo.
 */

import { describe, expect, it } from "vitest";
// Se importa del dominio, no de buzon.ts ni de config.ts: esos dos importan
// db.ts, que lanza al cargarse sin DATABASE_URL, y esta prueba fallaba siempre
// en CI por eso, no por lo que comprueba.
import {
  cuerpoEnTexto,
  partirRemitentes,
  remitenteAceptado,
} from "./domain/correo/remitentes.ts";

describe("la lista de remitentes", () => {
  it("se parte por comas, puntos y coma o espacios, y se normaliza", () => {
    expect(partirRemitentes(" Therefore@Ejemplo.invalid , otro@ejemplo.invalid;tercero@ejemplo.invalid ")).toEqual([
      "therefore@ejemplo.invalid",
      "otro@ejemplo.invalid",
      "tercero@ejemplo.invalid",
    ]);
  });

  it("lo que no es una dirección ni un dominio se descarta en vez de colarse como filtro", () => {
    expect(partirRemitentes("therefore, sin-arroba, a@b.c, @, @sin-punto")).toEqual(["a@b.c"]);
  });

  it("un dominio, con arroba o sin ella, se guarda como «@dominio»", () => {
    expect(partirRemitentes("Proveedor.invalid, @otro.invalid, persona@tercero.invalid")).toEqual([
      "@proveedor.invalid",
      "@otro.invalid",
      "persona@tercero.invalid",
    ]);
  });

  it("«@dominio» acepta cualquier buzón del dominio y de sus subdominios, y nada más", () => {
    const lista = ["@proveedor.invalid"];
    expect(remitenteAceptado("Persona@Proveedor.invalid", lista)).toBe(true);
    expect(remitenteAceptado("otra@correo.proveedor.invalid", lista)).toBe(true);
    expect(remitenteAceptado("persona@noproveedor.invalid", lista)).toBe(false);
    expect(remitenteAceptado("persona@proveedor.invalid.falso", lista)).toBe(false);
  });

  it("vacía significa «todos»: es preferible a un filtro mal escrito", () => {
    expect(remitenteAceptado("cualquiera@ejemplo.invalid", [])).toBe(true);
  });

  it("con lista, sólo lo que está en ella, sin distinguir mayúsculas", () => {
    const lista = ["therefore@ejemplo.invalid"];
    expect(remitenteAceptado("Therefore@Ejemplo.invalid", lista)).toBe(true);
    expect(remitenteAceptado("persona@ejemplo.invalid", lista)).toBe(false);
  });
});

describe("el cuerpo en texto", () => {
  it("prefiere el texto plano cuando lo hay", () => {
    expect(cuerpoEnTexto({ text: "hola\nmundo", html: "<p>otra cosa</p>" })).toBe("hola\nmundo");
  });

  it("si sólo hay HTML, se le quitan las etiquetas conservando las líneas", () => {
    const t = cuerpoEnTexto({ text: "", html: "<p>Albar&aacute;n: 0501234</p><div>GRABAR<br>&nbsp;T2</div>" });
    expect(t).toContain("0501234");
    expect(t.split("\n").map((l) => l.trim()).filter(Boolean)).toEqual(["Albar&aacute;n: 0501234", "GRABAR", "T2"]);
  });

  it("sin nada, devuelve vacío y no inventa", () => {
    expect(cuerpoEnTexto({ text: undefined, html: false })).toBe("");
  });
});
