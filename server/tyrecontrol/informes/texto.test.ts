import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { limpiarParaPdf } from "./texto.ts";

/**
 * La prueba que importa no es «la cadena queda bonita»: es que pdf-lib pueda
 * escribirla. Por eso se dibuja de verdad en un PDF en memoria, con la misma
 * fuente que usan los informes. Una lista de caracteres permitidos escrita a
 * mano se queda obsoleta; esto pregunta a quien decide.
 */

const fuente = await (async () => {
  const d = await PDFDocument.create();
  return d.embedFont(StandardFonts.Helvetica);
})();

const sePuedeEscribir = (s: string): boolean => {
  try { fuente.encodeText(s); return true; } catch { return false; }
};

describe("limpiarParaPdf", () => {
  it("la RAYA sobrevive: es lo que se escribe cuando un dato no se sabe", () => {
    expect(limpiarParaPdf("—")).toBe("—");
    expect(limpiarParaPdf("Ultima revision: —")).toBe("Ultima revision: —");
  });

  it("los acentos, la eñe y el euro se quedan", () => {
    expect(limpiarParaPdf("Alcañiz · 1.200 € · José Martínez")).toBe("Alcañiz · 1.200 € · José Martínez");
  });

  it("las comillas y los puntos suspensivos también", () => {
    expect(limpiarParaPdf("«vencida» “sin revisión” 'ok' …")).toBe("«vencida» “sin revisión” 'ok' …");
  });

  it("lo que no se puede escribir pero se puede decir, se dice", () => {
    expect(limpiarParaPdf("antes → después")).toBe("antes -> después");
    expect(limpiarParaPdf("6 × 2")).toBe("6 x 2");
  });

  it("el espacio duro no rompe la medida del ancho: pasa a espacio normal", () => {
    expect(limpiarParaPdf("295/80R22.5 mm")).toBe("295/80R22.5 mm");
  });

  it("lo que no tiene equivalente se va, en vez de tirar el informe", () => {
    expect(limpiarParaPdf("お早う")).toBe("");
    expect(limpiarParaPdf("ok 🙂 ya")).toBe("ok  ya");
  });

  it("nulo o vacío no es un error", () => {
    expect(limpiarParaPdf(null)).toBe("");
    expect(limpiarParaPdf(undefined)).toBe("");
  });

  it("lo que sale SIEMPRE lo puede escribir la fuente", () => {
    const crudos = [
      "— – · « » € ‘’“” … •", "Alcañiz", "→ ← ⇒ × ≤ ≥ ≠", "お早う 🙂",
      "N°1 ½ ¼ ± µ ©®™", "  ​", "l'Hospitalet de l'Infant",
    ];
    for (const c of crudos) {
      const limpio = limpiarParaPdf(c);
      expect(sePuedeEscribir(limpio), `no se puede escribir: ${JSON.stringify(limpio)}`).toBe(true);
    }
  });
});
