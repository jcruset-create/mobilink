import { describe, it, expect } from "vitest";
import { comprobarFichero } from "./fichero.ts";

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");

describe("comprobarFichero", () => {
  it("admite el PDF escaneado y la foto del parte", () => {
    expect(comprobarFichero(`data:application/pdf;base64,${b64(1000)}`))
      .toMatchObject({ ok: true, tipo: "application/pdf" });
    expect(comprobarFichero(`data:image/jpeg;base64,${b64(1000)}`))
      .toMatchObject({ ok: true, tipo: "image/jpeg" });
  });

  it("calcula el tamaño real, no el del base64", () => {
    const r = comprobarFichero(`data:application/pdf;base64,${b64(300_000)}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bytes).toBeGreaterThan(299_000);
    if (r.ok) expect(r.bytes).toBeLessThan(301_000);
  });

  it("corta un fichero enorme antes de mandarlo al modelo", () => {
    // Un PDF de cien páginas no es un parte y costaría una fortuna en tokens.
    const r = comprobarFichero(`data:application/pdf;base64,${b64(9 * 1024 * 1024)}`);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.error).toContain("8 MB");
  });

  it("rechaza lo que no es un parte: hojas de cálculo, ejecutables, texto suelto", () => {
    expect(comprobarFichero(`data:application/zip;base64,${b64(100)}`)).toMatchObject({ ok: false });
    expect(comprobarFichero("no soy un data uri")).toMatchObject({ ok: false });
    expect(comprobarFichero("")).toMatchObject({ ok: false });
  });

  it("no se fía de la extensión del nombre: mira el tipo declarado", () => {
    expect(comprobarFichero(`data:text/html;base64,${b64(10)}`)).toMatchObject({ ok: false });
  });
});
