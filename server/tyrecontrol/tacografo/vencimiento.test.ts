import { describe, expect, it } from "vitest";
import { REGLA_POR_DEFECTO, calcular, reinicia, sumarMeses, type Hito, type Regla } from "./vencimiento.ts";

const HOY = "2026-11-04";
const CAL = "Calibrado o Parametrización / Control / Reparación";
const INS = "Instalación / Activación";
const TRA = "Transferencia / Certificado de intransferibilidad / Sustitución";

const regla = (p: Partial<Regla> = {}): Regla => ({ ...REGLA_POR_DEFECTO, ...p });
const h = (fecha: string | null, tipo = CAL, resultado = "Favorable"): Hito =>
  ({ fecha, tipoOperacion: tipo, resultado });

describe("sumarMeses", () => {
  it("24 meses son dos años", () => {
    expect(sumarMeses("2024-06-15", 24)).toBe("2026-06-15");
  });

  /**
   * El fallo clásico de `setMonth`: 31 de enero más un mes se le va al 3 de
   * marzo. Un vencimiento tiene que caer en el mes que toca.
   */
  it("el 31 de enero más un mes es el 28 de febrero, no el 3 de marzo", () => {
    expect(sumarMeses("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("y en año bisiesto, el 29", () => {
    expect(sumarMeses("2024-01-31", 1)).toBe("2024-02-29");
    expect(sumarMeses("2024-02-29", 24)).toBe("2026-02-28");
  });

  it("cruza el año sin perderse", () => {
    expect(sumarMeses("2025-11-30", 24)).toBe("2027-11-30");
    expect(sumarMeses("2025-12-31", 14)).toBe("2027-02-28");
  });
});

describe("qué reinicia el plazo", () => {
  it("por defecto, cualquier intervención con fecha", () => {
    expect(reinicia(h("2026-01-01", TRA, "-----"), regla())).toBe(true);
    expect(reinicia(h("2026-01-01", INS, "-----"), regla())).toBe(true);
  });

  it("sin fecha no reinicia nada: no habría desde cuándo contar", () => {
    expect(reinicia(h(null), regla())).toBe(false);
  });

  it("con filtro de tipo, solo los tipos de la lista", () => {
    const r = regla({ tiposReinician: [CAL, INS] });
    expect(reinicia(h("2026-01-01", CAL), r)).toBe(true);
    expect(reinicia(h("2026-01-01", INS), r)).toBe(true);
    expect(reinicia(h("2026-01-01", TRA, "-----"), r)).toBe(false);
  });

  it("con filtro de resultado, solo esos resultados", () => {
    const r = regla({ resultadosReinician: ["Favorable"] });
    expect(reinicia(h("2026-01-01", CAL, "Favorable"), r)).toBe(true);
    expect(reinicia(h("2026-01-01", INS, "-----"), r)).toBe(false);
  });
});

describe("calcular", () => {
  it("manda la más reciente, venga en el orden que venga", () => {
    const v = calcular([h("2022-03-01"), h("2025-06-10"), h("2024-01-01")], regla(), HOY);
    expect(v.ultima).toBe("2025-06-10");
    expect(v.proxima).toBe("2027-06-10");
    expect(v.estado).toBe("vigente");
  });

  it("vencida cuando la próxima ya ha pasado", () => {
    const v = calcular([h("2023-01-10")], regla(), HOY);
    expect(v.proxima).toBe("2025-01-10");
    expect(v.estado).toBe("vencida");
    expect(v.diasRestantes).toBeLessThan(0);
  });

  it("próxima dentro de la ventana de aviso, vigente justo fuera", () => {
    // 60 días de aviso: el día 60 avisa, el 61 todavía no.
    expect(calcular([h("2025-01-03")], regla(), HOY).estado).toBe("proxima");   // vence 03/01/2027
    expect(calcular([h("2025-01-05")], regla(), HOY).estado).toBe("vigente");   // vence 05/01/2027
  });

  it("el mismo día del vencimiento todavía no está vencida", () => {
    const v = calcular([h("2024-11-04")], regla(), HOY);
    expect(v.proxima).toBe("2026-11-04");
    expect(v.diasRestantes).toBe(0);
    expect(v.estado).toBe("proxima");
  });

  it("sin intervenciones, sin datos: no se inventa una fecha", () => {
    const v = calcular([], regla(), HOY);
    expect(v).toEqual({ ultima: null, proxima: null, diasRestantes: null, estado: "sin_datos" });
  });

  it("si ninguna reinicia, tampoco se inventa", () => {
    const v = calcular([h("2025-01-01", TRA, "-----")], regla({ tiposReinician: [CAL] }), HOY);
    expect(v.estado).toBe("sin_datos");
  });

  it("la regla la pone la empresa: con 12 meses vence antes", () => {
    expect(calcular([h("2025-06-10")], regla({ meses: 12 }), HOY).estado).toBe("vencida");
    expect(calcular([h("2025-06-10")], regla({ meses: 24 }), HOY).estado).toBe("vigente");
  });
});

/**
 * Lo que el fichero real obliga a no hacer.
 *
 * En las 1.744 intervenciones del centro, «-----» no significa «no se informó
 * el resultado»: las 243 instalaciones y las 201 transferencias vienen todas
 * así, y solo los calibrados llevan «Favorable». Filtrar por «Favorable»
 * dejaría 31 autobuses SIN fecha de vencimiento teniendo el tacógrafo
 * instalado y calibrado, porque su única intervención fue la instalación.
 */
describe("el caso que los datos reales obligan a respetar", () => {
  const soloInstalacion = [h("2025-04-02", INS, "-----")];

  it("un vehículo cuya única intervención es la instalación TIENE vencimiento", () => {
    const v = calcular(soloInstalacion, regla(), HOY);
    expect(v.estado).toBe("vigente");
    expect(v.proxima).toBe("2027-04-02");
  });

  it("y filtrando por «Favorable» se quedaría sin él: por eso no es el defecto", () => {
    const v = calcular(soloInstalacion, regla({ resultadosReinician: ["Favorable"] }), HOY);
    expect(v.estado).toBe("sin_datos");
  });

  it("excluir transferencias no cambia nada si no son la última", () => {
    const hist = [h("2023-05-01", TRA, "-----"), h("2025-09-12", CAL, "Favorable")];
    const todas = calcular(hist, regla(), HOY);
    const sinTransf = calcular(hist, regla({ tiposReinician: [CAL, INS] }), HOY);
    expect(sinTransf).toEqual(todas);
    expect(todas.ultima).toBe("2025-09-12");
  });

  it("pero sí cambia si la transferencia ES la última", () => {
    const hist = [h("2023-05-01", CAL, "Favorable"), h("2026-09-12", TRA, "-----")];
    expect(calcular(hist, regla(), HOY).estado).toBe("vigente");
    expect(calcular(hist, regla({ tiposReinician: [CAL, INS] }), HOY).estado).toBe("vencida");
  });
});
