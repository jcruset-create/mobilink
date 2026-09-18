import { describe, expect, it } from "vitest";
import { LARGO_MATERIAL, cuerpoPlantilla, motivoParaNoAvisar, saludo, textoAviso, textoMaterial, variablesPlantilla, type Ajustes, type DatosAviso } from "./aviso.ts";

const datos = (extra: Partial<DatosAviso> = {}): DatosAviso => ({
  destinatario: "JORGE PLANA",
  telefono: "629862105",
  centroNombre: "Taller Tarragona",
  resultado: "OK",
  empresaNombre: "COMERCIAL SEA",
  lineas: [{ descripcion: "245/70 R17.5 HANKOOK AH35 136M", cantidad: 2 }],
  albaranNumero: "2028450459",
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

describe("textoMaterial", () => {
  it("dice qué ha llegado y cuántas unidades", () => {
    expect(textoMaterial(datos())).toBe("245/70 R17.5 HANKOOK AH35 136M (2 uds.)");
  });

  it("una sola unidad se dice en singular", () => {
    expect(textoMaterial(datos({ lineas: [{ descripcion: "BATERIA 12V 74AH", cantidad: 1 }] }))).toBe("BATERIA 12V 74AH (1 ud.)");
  });

  it("varias líneas van seguidas en una sola línea, que es lo que admite una variable", () => {
    const t = textoMaterial(
      datos({
        lineas: [
          { descripcion: "245/70 R17.5 HANKOOK AH35 136M", cantidad: 2 },
          { descripcion: "315/80 R22.5 SAILUN STR1 156K", cantidad: 4 },
        ],
      })
    );
    expect(t).toBe("245/70 R17.5 HANKOOK AH35 136M (2 uds.) · 315/80 R22.5 SAILUN STR1 156K (4 uds.)");
  });

  it("una cantidad con decimales se escribe con coma", () => {
    expect(textoMaterial(datos({ lineas: [{ descripcion: "ACEITE 15W40", cantidad: 2.5 }] }))).toBe("ACEITE 15W40 (2,5 uds.)");
  });

  it("lo que no ha llegado no se enumera: un «(0 uds.)» sólo confunde", () => {
    const t = textoMaterial(
      datos({
        lineas: [
          { descripcion: "LLEGÓ", cantidad: 3 },
          { descripcion: "NO LLEGÓ", cantidad: 0 },
        ],
      })
    );
    expect(t).toBe("LLEGÓ (3 uds.)");
  });

  it("sin líneas se dice el albarán: la variable no puede ir vacía", () => {
    expect(textoMaterial(datos({ lineas: [] }))).toBe("Albarán 2028450459");
    expect(textoMaterial(datos({ lineas: [], albaranNumero: "" }))).toBe("Material recibido");
    expect(textoMaterial(datos({ lineas: [{ descripcion: "X", cantidad: 0 }] }))).toBe("Albarán 2028450459");
  });

  it("un albarán de muchas líneas se corta y cuenta las que faltan", () => {
    const lineas = Array.from({ length: 40 }, (_, i) => ({ descripcion: `NEUMATICO MODELO NUMERO ${i} DE PRUEBA`, cantidad: 2 }));
    const t = textoMaterial(datos({ lineas }));
    expect(t.length).toBeLessThanOrEqual(LARGO_MATERIAL + 20);
    expect(t).toMatch(/ y \d+ más$/);
  });

  it("y una sola línea desmesurada se recorta, no se manda un mensaje que Meta rechaza", () => {
    const t = textoMaterial(datos({ lineas: [{ descripcion: "A".repeat(2000), cantidad: 1 }] }));
    expect(t.length).toBeLessThanOrEqual(LARGO_MATERIAL);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("las variables de la plantilla", () => {
  /** Lo que Meta rechaza en el valor de una variable. */
  const prohibido = (v: string) => /[\n\r\t]/.test(v) || /\s{4,}/.test(v) || v.trim() === "";

  it("ninguna lleva salto de línea, tabulador, cuatro espacios seguidos, ni va vacía", () => {
    const casos = [
      datos(),
      datos({ destinatario: null }),
      datos({ destinatario: "PEDRO\nGARCIA", centroNombre: "TALLER\tTARRAGONA" }),
      datos({ lineas: [] }),
      datos({ lineas: [{ descripcion: "NEUMATICO    CON     ESPACIOS", cantidad: 1 }] }),
      datos({ lineas: [{ descripcion: "SIGUE\nABAJO", cantidad: 3 }] }),
    ];
    for (const d of casos) {
      for (const [clave, valor] of Object.entries(variablesPlantilla(d))) {
        expect(prohibido(valor), `variable {{${clave}}}: ${JSON.stringify(valor)}`).toBe(false);
      }
    }
  });

  it("van en su orden: saludo, centro y material", () => {
    expect(variablesPlantilla(datos())).toEqual({
      "1": "Hola JORGE PLANA",
      "2": "Taller Tarragona",
      "3": "245/70 R17.5 HANKOOK AH35 136M (2 uds.)",
    });
  });

  it("un centro sin nombre no deja la variable vacía", () => {
    expect(variablesPlantilla(datos({ centroNombre: "  " }))["2"]).toBe("el centro");
  });

  it("el cuerpo de la plantilla y el texto plano dicen lo mismo, con las variables puestas", () => {
    const d = datos();
    const puesto = cuerpoPlantilla(d.empresaNombre)
      .replace("{{1}}", variablesPlantilla(d)["1"])
      .replace("{{2}}", variablesPlantilla(d)["2"])
      .replace("{{3}}", variablesPlantilla(d)["3"]);
    expect(puesto).toBe(textoAviso(d));
  });
});

describe("textoAviso", () => {
  it("dice lo justo: que ha llegado, dónde y qué", () => {
    expect(textoAviso(datos())).toBe("Hola JORGE PLANA: ha llegado tu material a Taller Tarragona.\n245/70 R17.5 HANKOOK AH35 136M (2 uds.)\n— COMERCIAL SEA");
  });

  it("sin nombre no se inventa uno", () => {
    expect(saludo(null)).toBe("Hola");
    expect(saludo("  ")).toBe("Hola");
    expect(textoAviso(datos({ destinatario: null }))).toContain("Hola: ha llegado tu material a Taller Tarragona.");
  });

  it("no se cuela en el mensaje ni un precio ni un importe", () => {
    const t = textoAviso(datos({ lineas: [{ descripcion: "245/70 R17.5 HANKOOK AH35 136M", cantidad: 2 }] }));
    expect(t).not.toMatch(/€/);
    expect(t).not.toMatch(/\d+,\d{2}\b/);
  });
});
