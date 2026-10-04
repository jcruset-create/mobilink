import { describe, expect, it } from "vitest";
import {
  duracionSegundos,
  efectoDeResultado,
  enmascararTelefono,
  estadoTrasResultado,
  interruptorGlobal,
  MOTIVOS_INICIALES,
  prioridadIncidencia,
  prioridadMaxima,
  puedePasar,
  RESULTADOS_INICIALES,
} from "./callcenter.ts";

describe("Call Center · reglas puras", () => {
  it("catálogo de partida: los 15 motivos y 10 resultados pedidos, sin códigos repetidos", () => {
    expect(MOTIVOS_INICIALES.map((m) => m.code)).toEqual([
      "precio_disponibilidad", "tamano_trastero", "calculadora_espacio", "contratacion_online", "visita_virtual", "visita_guiada",
      "ubicacion", "acceso", "seguridad", "cliente_existente", "facturacion", "baja_cancelacion", "incidencia", "reclamacion", "otro",
    ]);
    expect(RESULTADOS_INICIALES).toHaveLength(10);
    expect(new Set(RESULTADOS_INICIALES.map((r) => r.code)).size).toBe(10);
  });

  it("el resultado decide el estado: la web cierra, la visita deja seguimiento, escalar escala", () => {
    expect(estadoTrasResultado("enviado_web")).toBe("closed");
    expect(estadoTrasResultado("enviado_calculadora")).toBe("closed");
    expect(estadoTrasResultado("visita_guiada_solicitada")).toBe("follow_up");
    expect(estadoTrasResultado("requiere_seguimiento")).toBe("follow_up");
    expect(estadoTrasResultado("escalado_tlc")).toBe("escalated");
    expect(estadoTrasResultado("no_resuelto")).toBe("finished");
    // Uno propio de la empresa no cierra nada por su cuenta.
    expect(efectoDeResultado("mudanza_agendada")).toBe("finish");
  });

  it("una llamada cerrada no se reabre", () => {
    expect(puedePasar("closed", "in_progress")).toBe(false);
    expect(puedePasar("in_progress", "closed")).toBe(true);
    expect(puedePasar("follow_up", "closed")).toBe(true);
    expect(puedePasar("escalated", "in_progress")).toBe(true);
  });

  it("incidencias de acceso, seguridad, emergencia y fallo grave: SIEMPRE urgentes", () => {
    for (const t of ["no_access", "security", "unauthorized_access", "emergency", "facility_failure"] as const) {
      expect(prioridadIncidencia(t, "normal")).toBe("urgent");
    }
    expect(prioridadIncidencia("billing")).toBe("normal");
    expect(prioridadIncidencia("complaint", "high")).toBe("high");
  });

  it("la prioridad nunca baja por el motivo", () => {
    expect(prioridadMaxima("urgent", "high")).toBe("urgent");
    expect(prioridadMaxima("normal", "high")).toBe("high");
    expect(prioridadMaxima("high", null)).toBe("high");
  });

  it("duración desde que se contestó (o desde el inicio)", () => {
    const i = new Date("2026-10-04T10:00:00Z");
    expect(duracionSegundos(i, new Date("2026-10-04T10:00:10Z"), new Date("2026-10-04T10:01:10Z"))).toBe(60);
    expect(duracionSegundos(i, null, new Date("2026-10-04T10:00:30Z"))).toBe(30);
  });

  it("interruptor global: encendido salvo 0/false/off", () => {
    expect(interruptorGlobal(undefined)).toBe(true);
    expect(interruptorGlobal("1")).toBe(true);
    for (const v of ["0", "false", "OFF", "no"]) expect(interruptorGlobal(v)).toBe(false);
  });

  it("teléfono enmascarado para logs", () => {
    expect(enmascararTelefono("+34600111222")).toBe("+346••••••22");
    expect(enmascararTelefono(null)).toBeNull();
  });
});
