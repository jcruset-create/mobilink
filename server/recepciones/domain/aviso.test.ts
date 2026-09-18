import { describe, expect, it } from "vitest";
import { motivoParaNoAvisar, saludo, textoAviso, variablesPlantilla, type Ajustes, type DatosAviso } from "./aviso.ts";

const datos = (extra: Partial<DatosAviso> = {}): DatosAviso => ({
  destinatario: "JORGE PLANA",
  telefono: "629862105",
  centroNombre: "Taller Tarragona",
  resultado: "OK",
  empresaNombre: "COMERCIAL SEA",
  ...extra,
});
const ajustes = (extra: Partial<Ajustes> = {}): Ajustes => ({ activado: true, hayCredenciales: true, ...extra });

describe("motivoParaNoAvisar", () => {
  it("con todo en su sitio, toca avisar", () => {
    expect(motivoParaNoAvisar(datos(), ajustes())).toBeNull();
  });

  it("apagado no se manda nada, aunque lo demás esté", () => {
    expect(motivoParaNoAvisar(datos(), ajustes({ activado: false }))).toMatch(/apagado/);
  });

  it("con incidencia no se avisa: «ha llegado tu material» sería mentira", () => {
    expect(motivoParaNoAvisar(datos({ resultado: "CON_INCIDENCIA" }), ajustes())).toMatch(/incidencia/);
  });

  it("sin móvil en el albarán no hay a quién escribir", () => {
    expect(motivoParaNoAvisar(datos({ telefono: null }), ajustes())).toMatch(/móvil/);
  });

  it("sin credenciales se dice eso, no otra cosa", () => {
    expect(motivoParaNoAvisar(datos(), ajustes({ hayCredenciales: false }))).toMatch(/Twilio/);
  });

  it("el motivo que se guarda es el más general: apagado tapa a los demás", () => {
    const todoMal = motivoParaNoAvisar(datos({ telefono: null, resultado: "CON_INCIDENCIA" }), ajustes({ activado: false }));
    expect(todoMal).toMatch(/apagado/);
  });

  it("lo de esta recepción va antes que la fontanería: sin credenciales Y con incidencia, manda la incidencia", () => {
    const m = motivoParaNoAvisar(datos({ resultado: "CON_INCIDENCIA" }), ajustes({ hayCredenciales: false }));
    expect(m).toMatch(/incidencia/);
  });

  it("y un albarán sin móvil se dice tal cual, no como un problema de configuración", () => {
    expect(motivoParaNoAvisar(datos({ telefono: null }), ajustes({ hayCredenciales: false }))).toMatch(/móvil/);
  });
});

describe("textoAviso", () => {
  it("dice lo justo: que ha llegado y dónde", () => {
    expect(textoAviso(datos())).toBe("Hola JORGE PLANA: ha llegado tu material a Taller Tarragona. — COMERCIAL SEA");
  });

  it("sin nombre no se inventa uno", () => {
    expect(saludo(null)).toBe("Hola");
    expect(saludo("  ")).toBe("Hola");
    expect(textoAviso(datos({ destinatario: null }))).toBe("Hola: ha llegado tu material a Taller Tarragona. — COMERCIAL SEA");
  });

  it("no se cuela en el mensaje ni una cantidad ni un precio", () => {
    const t = textoAviso(datos());
    expect(t).not.toMatch(/\d+[,.]\d{2}/);
    expect(t).not.toMatch(/€/);
  });

  it("las variables de la plantilla van en su orden", () => {
    expect(variablesPlantilla(datos())).toEqual({ "1": "Hola JORGE PLANA", "2": "Taller Tarragona" });
  });
});
