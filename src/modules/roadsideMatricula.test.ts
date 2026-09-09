import { describe, expect, it } from "vitest";

import { etiquetaMatricula, matriculasDe } from "./roadsideMatricula";

describe("matriculasDe", () => {
  it("con el interruptor marcado, manda la del remolque", () => {
    // El caso que se veía como «Sin matricula» en la pantalla: asistencia al
    // remolque, sin tractora informada.
    const m = matriculasDe({
      plate: "",
      plateRemolque: "R7657BDM",
      esRemolque: true,
    });
    expect(m.principal).toBe("R7657BDM");
    expect(m.principalEsRemolque).toBe(true);
    expect(m.secundaria).toBe("");
    expect(m.etiquetaSecundaria).toBe("");
  });

  it("con el interruptor marcado y las dos matrículas, la tractora pasa a segundo plano", () => {
    const m = matriculasDe({
      plate: "1234ABC",
      plateRemolque: "R7657BDM",
      esRemolque: true,
    });
    expect(m.principal).toBe("R7657BDM");
    expect(m.principalEsRemolque).toBe(true);
    expect(m.secundaria).toBe("1234ABC");
    expect(m.etiquetaSecundaria).toBe("Tractora");
  });

  it("sin interruptor pero sin tractora, la del remolque sigue mandando", () => {
    // Si no, la asistencia se quedaría «sin matrícula» teniendo una delante
    // sólo porque nadie marcó una casilla.
    const m = matriculasDe({ plate: "", plateRemolque: "R7657BDM" });
    expect(m.principal).toBe("R7657BDM");
    expect(m.principalEsRemolque).toBe(true);
  });

  it("sin interruptor y con tractora, manda la tractora", () => {
    const m = matriculasDe({
      plate: "1234ABC",
      plateRemolque: "R7657BDM",
      esRemolque: false,
    });
    expect(m.principal).toBe("1234ABC");
    expect(m.principalEsRemolque).toBe(false);
    expect(m.secundaria).toBe("R7657BDM");
    expect(m.etiquetaSecundaria).toBe("Remolque");
  });

  it("un camión sin remolque no inventa una segunda matrícula", () => {
    const m = matriculasDe({ plate: "1234ABC", plateRemolque: "" });
    expect(m.principal).toBe("1234ABC");
    expect(m.secundaria).toBe("");
    expect(m.etiquetaSecundaria).toBe("");
  });

  it("sin ninguna matrícula no se inventa nada", () => {
    const m = matriculasDe({ plate: "", plateRemolque: "", esRemolque: true });
    expect(m.principal).toBe("");
    expect(m.principalEsRemolque).toBe(false);
  });

  it("acepta null y undefined, que es como llegan del backend", () => {
    expect(matriculasDe({}).principal).toBe("");
    expect(
      matriculasDe({ plate: null, plateRemolque: "R7657BDM", esRemolque: null })
        .principal
    ).toBe("R7657BDM");
  });

  it("los espacios sobrantes no cuentan como matrícula", () => {
    // Un campo con espacios se guarda como «no vacío» y haría creer que hay
    // tractora, dejando la del remolque en segundo plano sin motivo.
    const m = matriculasDe({
      plate: "   ",
      plateRemolque: "R7657BDM",
      esRemolque: false,
    });
    expect(m.principal).toBe("R7657BDM");
    expect(m.principalEsRemolque).toBe(true);
  });
});

describe("etiquetaMatricula", () => {
  it("dice que es un remolque, que una matrícula suelta no lo aclara", () => {
    expect(
      etiquetaMatricula({ plate: "", plateRemolque: "R7657BDM", esRemolque: true })
    ).toBe("Remolque R7657BDM");
  });

  it("la tractora va sin adorno", () => {
    expect(etiquetaMatricula({ plate: "1234ABC" })).toBe("1234ABC");
  });

  it("sin matrícula, el texto de relleno", () => {
    expect(etiquetaMatricula({})).toBe("Sin matrícula");
    expect(etiquetaMatricula({}, "—")).toBe("—");
  });
});
