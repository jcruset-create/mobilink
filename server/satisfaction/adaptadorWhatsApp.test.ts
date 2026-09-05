/**
 * El adaptador, sin salir a la red.
 *
 * Lo que se fija: qué plantilla se elige, qué variables viajan —y cuáles NO—,
 * cómo se clasifica cada error y que un mensaje de error guardado no se lleva
 * por delante ni el token ni un identificador del proveedor.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CODIGOS_PERMANENTES, MOTIVO_SIN_PLANTILLA, VARIABLES_PLANTILLA,
  contentSidDe, sanearError, variablesDe,
} from "./adaptadorWhatsApp.ts";

const ENTORNO = { ...process.env };
beforeEach(() => { for (const v of Object.values(VARIABLES_PLANTILLA).flatMap(Object.values)) delete process.env[v]; });
afterEach(() => { process.env = { ...ENTORNO }; });

describe("plantillas", () => {
  it("cada rol y tipo tiene su propia variable de entorno, sin solaparse", () => {
    const todas = Object.values(VARIABLES_PLANTILLA).flatMap((r) => Object.values(r));
    expect(new Set(todas).size).toBe(4);
    expect(todas.every((v) => v.startsWith("TWILIO_TEMPLATE_SATISFACTION"))).toBe(true);
  });

  it("sin configurar no hay SID: no se inventa ninguno", () => {
    expect(contentSidDe("DRIVER", "INITIAL")).toBeNull();
    expect(contentSidDe("CUSTOMER", "REMINDER")).toBeNull();
  });

  it("lee el SID de su variable y no de la del vecino", () => {
    process.env.TWILIO_TEMPLATE_SATISFACTION_DRIVER = "HXdelconductor";
    expect(contentSidDe("DRIVER", "INITIAL")).toBe("HXdelconductor");
    expect(contentSidDe("CUSTOMER", "INITIAL")).toBeNull();
    expect(contentSidDe("DRIVER", "REMINDER")).toBeNull();
  });

  it("una variable en blanco cuenta como no configurada", () => {
    process.env.TWILIO_TEMPLATE_SATISFACTION_DRIVER = "   ";
    expect(contentSidDe("DRIVER", "INITIAL")).toBeNull();
  });

  it("cada combinación tiene un motivo distinto para el registro", () => {
    const motivos = Object.values(MOTIVO_SIN_PLANTILLA).flatMap((r) => Object.values(r));
    expect(new Set(motivos).size).toBe(4);
    expect(MOTIVO_SIN_PLANTILLA.DRIVER.INITIAL).toBe("no_template_satisfaction_driver");
    expect(MOTIVO_SIN_PLANTILLA.CUSTOMER.REMINDER)
      .toBe("no_template_satisfaction_reminder_customer");
  });
});

describe("variables del mensaje", () => {
  it("van dos: de qué servicio se habla y el enlace", () => {
    const v = variablesDe({ referencia: "1234ABC", url: "https://x/valoracion/tok" });
    expect(v).toEqual({ "1": "1234ABC", "2": "https://x/valoracion/tok" });
  });

  it("no viaja nada más: ni teléfono, ni tenant, ni ids internos", () => {
    const v = variablesDe({ referencia: "1234ABC", url: "https://x/valoracion/tok" });
    expect(Object.keys(v)).toHaveLength(2);
    const texto = JSON.stringify(v);
    expect(texto).not.toMatch(/600|900|tenant|assistanceId|surveyInstance|quality/i);
  });
});

describe("clasificación de errores", () => {
  it("los permanentes son los que no mejoran por insistir", () => {
    // Número inválido y destinatario que no puede recibir WhatsApp.
    expect(CODIGOS_PERMANENTES.has("21211")).toBe(true);
    expect(CODIGOS_PERMANENTES.has("21614")).toBe(true);
  });

  it("un 5xx o un timeout NO están en la lista: son transitorios", () => {
    expect(CODIGOS_PERMANENTES.has("50000")).toBe(false);
    expect(CODIGOS_PERMANENTES.has("ETIMEDOUT")).toBe(false);
  });
});

describe("saneado del error", () => {
  it("borra la URL, que lleva el token dentro", () => {
    const limpio = sanearError(
      "Failed to send to https://mobilink-solutions.com/valoracion/abc123DEF: 500");
    expect(limpio).not.toMatch(/abc123DEF/);
    expect(limpio).toContain("[url]");
  });

  it("borra los identificadores del proveedor", () => {
    const limpio = sanearError("Auth failed for ACde0123456789abcdef0123456789ab");
    expect(limpio).not.toMatch(/ACde0123/);
    expect(limpio).toContain("[sid]");
  });

  it("recorta, para que un error enorme no se coma la fila", () => {
    expect(sanearError("x".repeat(5000)).length).toBeLessThanOrEqual(300);
  });

  it("con nada devuelve cadena vacía y no revienta", () => {
    expect(sanearError(null)).toBe("");
    expect(sanearError(undefined)).toBe("");
  });
});
