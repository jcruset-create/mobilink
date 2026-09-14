import { describe, expect, it } from "vitest";

import { referenciaDe } from "../correo/referencia.ts";
import {
  autorizacionParaTaller,
  puedeMarcarSinSeguimiento,
  puedeQuitarSinSeguimiento,
} from "./marcaSeguimiento.ts";

/** Una subcontratada en curso, que es el caso para el que existe todo esto. */
const subcontratada = {
  status: "asignada",
  proveedorTallerId: 7,
  sinSeguimiento: false,
  finishedAtMs: null,
  cancelledAtMs: null,
};

describe("marcar sin seguimiento", () => {
  it("se puede en una subcontratada en curso", () => {
    expect(puedeMarcarSinSeguimiento(subcontratada)).toEqual({ ok: true });
  });

  it("NO se puede en una asistencia propia", () => {
    // Hay un operario con la APK mandando estados: quitarle el seguimiento
    // sería esconder información que sí existe.
    const r = puedeMarcarSinSeguimiento({ ...subcontratada, proveedorTallerId: null });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("motivo");
  });

  it("NO se puede si el servicio ya está cerrado", () => {
    for (const status of ["finalizada", "en_camino_base", "llegada_taller", "cancelada", "redirigida"]) {
      expect(puedeMarcarSinSeguimiento({ ...subcontratada, status }).ok).toBe(false);
    }
  });

  it("finishedAtMs cierra aunque el estado diga otra cosa", () => {
    // El estado se puede haber quedado atrás; la fecha de fin no miente.
    expect(
      puedeMarcarSinSeguimiento({ ...subcontratada, status: "asignada", finishedAtMs: 1 }).ok
    ).toBe(false);
  });

  it("una cancelada no se marca", () => {
    expect(
      puedeMarcarSinSeguimiento({ ...subcontratada, cancelledAtMs: 1 }).ok
    ).toBe(false);
  });
});

describe("quitar la marca", () => {
  it("se puede: se marca por error, o el taller la pasa a un operario nuestro", () => {
    expect(
      puedeQuitarSinSeguimiento({ ...subcontratada, sinSeguimiento: true })
    ).toEqual({ ok: true });
  });

  it("no hay nada que quitar si no estaba marcada", () => {
    expect(puedeQuitarSinSeguimiento(subcontratada).ok).toBe(false);
  });

  it("no se reabre el seguimiento de algo ya cerrado", () => {
    expect(
      puedeQuitarSinSeguimiento({
        ...subcontratada,
        sinSeguimiento: true,
        status: "finalizada",
      }).ok
    ).toBe(false);
  });
});

describe("autorización para el taller", () => {
  it("ES la referencia del expediente, no un número aparte", () => {
    // `AST-137` ya viaja en el asunto de los correos del expediente. Mandarle
    // al taller además un «A-137» casi idéntico es pedirle que distinga dos
    // números parecidos y elija bien.
    expect(autorizacionParaTaller(137)).toBe("AST-137");
  });

  it("coincide con la referencia que el correo pone en el asunto", () => {
    // Si estos dos se separan, el taller recibe un número en el asunto y otro
    // en el cuerpo, y su respuesta deja de engancharse al expediente.
    expect(referenciaDe(autorizacionParaTaller(137))).toBe("[AST-137]");
  });

  it("el prefijo la distingue de la autorización que nos dan a nosotros", () => {
    // `solicitanteAutorizacion` es ENTRANTE —la da la aseguradora o el gestor
    // de flota— y ésta es SALIENTE. Confundirlas es un lío de facturación, y
    // el prefijo evita que un número suelto se lea como la otra.
    expect(autorizacionParaTaller(1)).toMatch(/^AST-/);
  });

  it("es única por asistencia", () => {
    const vistas = new Set([1, 2, 137, 9999].map(autorizacionParaTaller));
    expect(vistas.size).toBe(4);
  });
});
