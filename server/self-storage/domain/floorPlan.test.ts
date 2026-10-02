import { describe, expect, it } from "vitest";
import { sanearSvg } from "./floorPlan.ts";

const PLANO = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="400" height="200">
  <metadata>cosas</metadata>
  <script>alert(1)</script>
  <g id="zona-2" inkscape:label="Zona 2">
    <rect id="box-2-014" x="10" y="10" width="40" height="30" fill="#fff" onclick="alert(2)"/>
    <rect id="box-2-015" x="60" y="10" width="40" height="30" style="fill:url(http://malo/x.svg)"/>
    <path id="box-2-016" d="M110 10 h40 v30 h-40 z"/>
  </g>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hola</div></foreignObject>
  <a href="javascript:alert(3)"><text x="1" y="1">x</text></a>
  <use xlink:href="https://malo/y.svg#a"/>
  <use href="#box-2-014" id="copia"/>
  <image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>
  <image href="https://malo/z.png" width="10" height="10"/>
</svg>`;

describe("saneado del plano SVG", () => {
  const r = sanearSvg(PLANO);

  it("quita scripts, eventos, foreignObject, enlaces y referencias externas", () => {
    expect(r.svg).not.toMatch(/<script/i);
    expect(r.svg).not.toMatch(/onclick/i);
    expect(r.svg).not.toMatch(/foreignObject/i);
    expect(r.svg).not.toMatch(/javascript:/i);
    expect(r.svg).not.toMatch(/https?:\/\/malo/);
    expect(r.svg).not.toMatch(/inkscape:label/);
    expect(r.svg).not.toMatch(/<metadata/);
  });

  it("conserva las formas, los usos internos y la imagen incrustada", () => {
    expect(r.svg).toMatch(/id="box-2-014"/);
    expect(r.svg).toMatch(/href="#box-2-014"/);
    expect(r.svg).toMatch(/data:image\/png;base64/);
  });

  it("devuelve los ids de las formas vinculables", () => {
    expect(r.shapeIds).toEqual(["zona-2", "box-2-014", "box-2-015", "box-2-016", "copia"]);
  });

  it("añade viewBox si sólo hay width/height", () => {
    expect(r.svg).toMatch(/viewBox="0 0 400 200"/);
  });

  it("explica lo que ha quitado", () => {
    expect(r.eliminados).toEqual(expect.arrayContaining(["<script>", "<foreignObject>", "@onclick"]));
  });

  it("rechaza DOCTYPE/entidades, lo que no es SVG y lo vacío", () => {
    expect(() => sanearSvg('<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow(/DOCTYPE/);
    expect(() => sanearSvg("<html><body/></html>")).toThrow(/no es un SVG/);
    expect(() => sanearSvg("<svg")).toThrow(/no es un SVG válido/);
    expect(() => sanearSvg("   ")).toThrow(/vacío/);
  });

  it("avisa de ids repetidos", () => {
    const d = sanearSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect id="a"/><rect id="a"/></svg>');
    expect(d.shapeIds).toEqual(["a"]);
    expect(d.avisos.join()).toMatch(/repetido/);
  });
});
