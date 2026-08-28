import { describe, expect, it } from "vitest";

import {
  EVENTOS,
  esFinal,
  estadoAssistDesdeEvento,
  estadoEnvioTrasEvento,
  eventoDesdeCentral,
  marcaTemporalDe,
  sePuedeReintentar,
} from "./estados.ts";

describe("Central → evento estándar", () => {
  it("traduce el ciclo operativo completo", () => {
    expect(eventoDesdeCentral("pending")).toBe("RECEIVED");
    expect(eventoDesdeCentral("assigned")).toBe("ASSIGNED");
    expect(eventoDesdeCentral("technician_assigned")).toBe("ASSIGNED");
    expect(eventoDesdeCentral("en_route")).toBe("EN_ROUTE");
    expect(eventoDesdeCentral("arrived")).toBe("ON_SITE");
    expect(eventoDesdeCentral("in_progress")).toBe("IN_PROGRESS");
    expect(eventoDesdeCentral("finished")).toBe("COMPLETED");
    expect(eventoDesdeCentral("cancelled")).toBe("CANCELLED");
  });

  /*
   * Para quien espera fuera, «sin cobertura» y «no se pudo asignar» son lo
   * mismo que un rechazo: nadie va a ir. El motivo interno es de Central.
   */
  it("un fallo de asignación llega como rechazo", () => {
    expect(eventoDesdeCentral("no_coverage")).toBe("REJECTED");
    expect(eventoDesdeCentral("assignment_failed")).toBe("REJECTED");
  });

  it("un estado desconocido no se inventa: no se traduce", () => {
    expect(eventoDesdeCentral("estado_nuevo_de_central")).toBeNull();
    expect(eventoDesdeCentral(null)).toBeNull();
    expect(eventoDesdeCentral(undefined)).toBeNull();
  });
});

describe("evento estándar → estado de Assist", () => {
  it("traduce lo que el operario de Assist puede interpretar", () => {
    expect(estadoAssistDesdeEvento("ASSIGNED")).toBe("asignada");
    expect(estadoAssistDesdeEvento("EN_ROUTE")).toBe("en_camino");
    expect(estadoAssistDesdeEvento("ON_SITE")).toBe("en_curso");
    expect(estadoAssistDesdeEvento("IN_PROGRESS")).toBe("en_curso");
    expect(estadoAssistDesdeEvento("COMPLETED")).toBe("finalizada");
    expect(estadoAssistDesdeEvento("CANCELLED")).toBe("cancelada");
  });

  /*
   * El caso que más fácil sería equivocar: que Central ACEPTE no significa que
   * haya nadie conduciendo. Pintar "asignada" ahí le diría al cliente que el
   * servicio ha arrancado cuando todavía no hay ni grúa elegida.
   */
  it("ACEPTADA no mueve el estado de la asistencia", () => {
    expect(estadoAssistDesdeEvento("ACCEPTED")).toBeNull();
  });

  it("los eventos administrativos tampoco lo mueven", () => {
    expect(estadoAssistDesdeEvento("RECEIVED")).toBeNull();
    expect(estadoAssistDesdeEvento("INFO_REQUESTED")).toBeNull();
    expect(estadoAssistDesdeEvento("DOCUMENTED")).toBeNull();
    expect(estadoAssistDesdeEvento("BILLABLE")).toBeNull();
    expect(estadoAssistDesdeEvento("REJECTED")).toBeNull();
  });

  it("nada raro se cuela", () => {
    expect(estadoAssistDesdeEvento("PENDIENTE")).toBeNull();
    expect(estadoAssistDesdeEvento(null)).toBeNull();
  });
});

describe("estado del envío al recibir eventos", () => {
  it("avanza con el ciclo normal", () => {
    expect(estadoEnvioTrasEvento("SENT", "RECEIVED")).toBe("RECEIVED");
    expect(estadoEnvioTrasEvento("RECEIVED", "ACCEPTED")).toBe("ACCEPTED");
    expect(estadoEnvioTrasEvento("ACCEPTED", "COMPLETED")).toBe("COMPLETED");
  });

  /*
   * Los webhooks se entregan al menos una vez y pueden llegar desordenados.
   * Un ASSIGNED con retraso después de COMPLETED no puede resucitar el envío.
   */
  it("no retrocede con un aviso que llega tarde", () => {
    expect(estadoEnvioTrasEvento("COMPLETED", "ASSIGNED")).toBeNull();
    expect(estadoEnvioTrasEvento("ACCEPTED", "RECEIVED")).toBeNull();
    expect(estadoEnvioTrasEvento("ACCEPTED", "ACCEPTED")).toBeNull();
  });

  /* Un rechazo o una cancelación son decisiones, no progreso: mandan siempre. */
  it("el rechazo y la cancelación mandan aunque llegue después", () => {
    expect(estadoEnvioTrasEvento("ACCEPTED", "REJECTED")).toBe("REJECTED");
    expect(estadoEnvioTrasEvento("COMPLETED", "CANCELLED")).toBe("CANCELLED");
  });

  it("los eventos operativos mantienen el envío en aceptado", () => {
    for (const e of ["EN_ROUTE", "ON_SITE", "IN_PROGRESS", "DOCUMENTED", "BILLABLE"]) {
      expect(estadoEnvioTrasEvento("RECEIVED", e)).toBe("ACCEPTED");
    }
  });

  it("pedir información no mueve el envío", () => {
    expect(estadoEnvioTrasEvento("RECEIVED", "INFO_REQUESTED")).toBeNull();
  });

  it("un evento inventado no mueve nada", () => {
    expect(estadoEnvioTrasEvento("SENT", "LO_QUE_SEA")).toBeNull();
  });
});

describe("reintentos", () => {
  it("se reintenta lo que falló o aún no salió", () => {
    expect(sePuedeReintentar("PENDING")).toBe(true);
    expect(sePuedeReintentar("ERROR")).toBe(true);
    expect(sePuedeReintentar("SENDING")).toBe(true);
  });

  /*
   * La razón de ser de esta función: reintentar algo que el destino YA aceptó
   * crearía allí un segundo expediente si la idempotencia fallara. Se cierra
   * la puerta aquí además de en el destino.
   */
  it("NO se reintenta lo que el destino ya tiene o ya decidió", () => {
    for (const e of ["SENT", "RECEIVED", "ACCEPTED", "REJECTED", "COMPLETED", "CANCELLED"]) {
      expect(sePuedeReintentar(e)).toBe(false);
    }
  });

  it("los estados cerrados se reconocen", () => {
    expect(esFinal("REJECTED")).toBe(true);
    expect(esFinal("COMPLETED")).toBe(true);
    expect(esFinal("CANCELLED")).toBe(true);
    expect(esFinal("ACCEPTED")).toBe(false);
    expect(esFinal("ERROR")).toBe(false);
  });
});

describe("marcas temporales", () => {
  it("solo los hitos llevan sello", () => {
    expect(marcaTemporalDe("RECEIVED")).toBe("receivedAtMs");
    expect(marcaTemporalDe("ACCEPTED")).toBe("acceptedAtMs");
    expect(marcaTemporalDe("REJECTED")).toBe("rejectedAtMs");
    expect(marcaTemporalDe("COMPLETED")).toBe("completedAtMs");
    expect(marcaTemporalDe("EN_ROUTE")).toBeNull();
    expect(marcaTemporalDe("ASSIGNED")).toBeNull();
  });
});

describe("vocabulario", () => {
  it("los 13 eventos del acuerdo están y no hay duplicados", () => {
    expect(new Set(EVENTOS).size).toBe(EVENTOS.length);
    for (const e of [
      "REQUESTED", "RECEIVED", "ACCEPTED", "REJECTED", "INFO_REQUESTED",
      "ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "COMPLETED",
      "CANCELLED", "DOCUMENTED", "BILLABLE",
    ]) {
      expect(EVENTOS).toContain(e);
    }
  });
});
