import { describe, expect, it } from "vitest";
import { disponibleParaAlquilar, transicionesPermitidas, validarCambioEstado } from "./unitStatus.ts";
import { ErrorSelfStorage } from "../errors.ts";

const libre = { tieneContratoVivo: false, tieneReservaActiva: false };

function codigo(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ErrorSelfStorage ? e.codigo : "OTRO";
  }
  return "OK";
}

describe("estados del trastero · cambios manuales", () => {
  it("disponible → mantenimiento exige motivo y lo devuelve normalizado", () => {
    expect(codigo(() => validarCambioEstado("available", "maintenance", { origen: "manual", ...libre }))).toBe("MOTIVO_OBLIGATORIO");
    expect(validarCambioEstado("available", "maintenance", { origen: "manual", motivo: "  humedad  ", ...libre })).toBe("humedad");
  });

  it("bloqueado → disponible no necesita motivo", () => {
    expect(validarCambioEstado("blocked", "available", { origen: "manual", ...libre })).toBeNull();
  });

  it("«reservado» y «alquilado» no se ponen nunca a mano", () => {
    expect(codigo(() => validarCambioEstado("available", "occupied", { origen: "manual", ...libre }))).toBe("ESTADO_SOLO_SISTEMA");
    expect(codigo(() => validarCambioEstado("available", "reserved", { origen: "manual", ...libre }))).toBe("ESTADO_SOLO_SISTEMA");
  });

  it("un alquilado o reservado no se libera ni se retira a mano", () => {
    expect(transicionesPermitidas("occupied", "manual")).toEqual([]);
    expect(transicionesPermitidas("reserved", "manual")).toEqual([]);
    expect(codigo(() => validarCambioEstado("occupied", "available", { origen: "manual", ...libre }))).toBe("TRANSICION_NO_PERMITIDA");
    expect(codigo(() => validarCambioEstado("occupied", "maintenance", { origen: "manual", motivo: "x", ...libre }))).toBe("TRANSICION_NO_PERMITIDA");
  });

  it("con contrato vivo o reserva activa no se toca, aunque el estado diga otra cosa", () => {
    expect(
      codigo(() => validarCambioEstado("available", "blocked", { origen: "manual", motivo: "x", tieneContratoVivo: true, tieneReservaActiva: false }))
    ).toBe("TRASTERO_COMPROMETIDO");
    expect(
      codigo(() => validarCambioEstado("maintenance", "available", { origen: "manual", tieneContratoVivo: false, tieneReservaActiva: true }))
    ).toBe("TRASTERO_COMPROMETIDO");
  });

  it("mismo estado → sin cambio", () => {
    expect(codigo(() => validarCambioEstado("available", "available", { origen: "manual", ...libre }))).toBe("ESTADO_SIN_CAMBIO");
  });
});

describe("estados del trastero · cambios del sistema (reservas y contratos)", () => {
  it("disponible → reservado → alquilado → disponible", () => {
    expect(validarCambioEstado("available", "reserved", { origen: "sistema", ...libre })).toBeNull();
    expect(validarCambioEstado("reserved", "occupied", { origen: "sistema", ...libre })).toBeNull();
    expect(validarCambioEstado("occupied", "available", { origen: "sistema", ...libre })).toBeNull();
  });

  it("el sistema no reserva un box en mantenimiento", () => {
    expect(codigo(() => validarCambioEstado("maintenance", "reserved", { origen: "sistema", ...libre }))).toBe("TRANSICION_NO_PERMITIDA");
  });

  it("el sistema no libera un box con contrato vivo", () => {
    expect(codigo(() => validarCambioEstado("occupied", "available", { origen: "sistema", tieneContratoVivo: true, tieneReservaActiva: false }))).toBe(
      "TRASTERO_COMPROMETIDO"
    );
  });
});

describe("disponible para alquilar en la web", () => {
  it("sólo disponible y visible", () => {
    expect(disponibleParaAlquilar("available", true)).toBe(true);
    expect(disponibleParaAlquilar("available", false)).toBe(false);
    expect(disponibleParaAlquilar("reserved", true)).toBe(false);
    expect(disponibleParaAlquilar("maintenance", true)).toBe(false);
  });
});
