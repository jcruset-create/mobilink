import { describe, expect, it } from "vitest";

import {
  CLAVES_PROHIBIDAS_EN_PAYLOAD,
  ETIQUETA,
  TIPOS_EVENTO,
  esTecnico,
  esTipoEvento,
  limpiarPayload,
  tipoDesdeEstadoAssist,
  tipoDesdeEstadoCentral,
  tipoDesdeEventoCable,
} from "./tipos.ts";

describe("vocabulario del diario", () => {
  it("están los 21 eventos acordados, sin duplicados", () => {
    expect(new Set(TIPOS_EVENTO).size).toBe(TIPOS_EVENTO.length);
    for (const t of [
      "ASSISTANCE_CREATED", "EXTERNAL_DISPATCH_CREATED", "EXTERNAL_DISPATCH_SENT",
      "EXTERNAL_ASSISTANCE_RECEIVED", "ASSISTANCE_ACCEPTED", "ASSISTANCE_REJECTED",
      "INFORMATION_REQUESTED", "PROVIDER_ASSIGNED", "EN_ROUTE", "ON_SITE",
      "SERVICE_STARTED", "SERVICE_COMPLETED", "SERVICE_CANCELLED", "DOCUMENT_UPLOADED",
      "DELIVERY_NOTE_RECEIVED", "SUPPLIER_INVOICE_RECEIVED", "COST_CONFIRMED",
      "READY_TO_BILL", "CUSTOMER_INVOICED", "SYNC_FAILED", "SYNC_RECOVERED",
    ]) {
      expect(TIPOS_EVENTO).toContain(t);
    }
  });

  it("todos tienen etiqueta: la timeline no puede enseñar un nombre en inglés a un operario", () => {
    for (const t of TIPOS_EVENTO) {
      expect(ETIQUETA[t]).toBeTruthy();
      expect(ETIQUETA[t]).not.toBe(t);
    }
  });

  it("no acepta un tipo inventado", () => {
    expect(esTipoEvento("ASSISTANCE_CREATED")).toBe(true);
    expect(esTipoEvento("LO_QUE_SEA")).toBe(false);
    expect(esTipoEvento(null)).toBe(false);
  });

  /* Un fallo y su recuperación son ruido para quien quiere saber por dónde va
     la grúa; siguen en el diario, pero no en la timeline por defecto. */
  it("los eventos técnicos están marcados", () => {
    expect(esTecnico("SYNC_FAILED")).toBe(true);
    expect(esTecnico("SYNC_RECOVERED")).toBe(true);
    expect(esTecnico("EN_ROUTE")).toBe(false);
  });
});

describe("traducción desde el vocabulario del cable", () => {
  it("traduce los eventos que llegan del destino", () => {
    expect(tipoDesdeEventoCable("ACCEPTED")).toBe("ASSISTANCE_ACCEPTED");
    expect(tipoDesdeEventoCable("ASSIGNED")).toBe("PROVIDER_ASSIGNED");
    expect(tipoDesdeEventoCable("IN_PROGRESS")).toBe("SERVICE_STARTED");
    expect(tipoDesdeEventoCable("COMPLETED")).toBe("SERVICE_COMPLETED");
    expect(tipoDesdeEventoCable("BILLABLE")).toBe("READY_TO_BILL");
  });

  /*
   * REQUESTED no se traduce a propósito: ese hecho ya lo cuenta
   * EXTERNAL_DISPATCH_CREATED, que además dice a quién. Anotar los dos dejaría
   * dos líneas para un solo hecho.
   */
  it("REQUESTED no se traduce: ya lo cuenta el evento de subcontratación", () => {
    expect(tipoDesdeEventoCable("REQUESTED")).toBeNull();
  });

  it("un evento desconocido no se inventa", () => {
    expect(tipoDesdeEventoCable("INVENTADO")).toBeNull();
    expect(tipoDesdeEventoCable(undefined)).toBeNull();
  });
});

describe("traducción desde los estados internos", () => {
  it("desde Central", () => {
    expect(tipoDesdeEstadoCentral("assigned")).toBe("PROVIDER_ASSIGNED");
    expect(tipoDesdeEstadoCentral("technician_assigned")).toBe("PROVIDER_ASSIGNED");
    expect(tipoDesdeEstadoCentral("arrived")).toBe("ON_SITE");
    expect(tipoDesdeEstadoCentral("finished")).toBe("SERVICE_COMPLETED");
    expect(tipoDesdeEstadoCentral("no_coverage")).toBe("ASSISTANCE_REJECTED");
  });

  /* 'pending' y 'searching' son trámite interno: llenarían la timeline de ruido. */
  it("los estados de trámite de Central no son noticia", () => {
    expect(tipoDesdeEstadoCentral("pending")).toBeNull();
    expect(tipoDesdeEstadoCentral("searching")).toBeNull();
    expect(tipoDesdeEstadoCentral("draft")).toBeNull();
  });

  it("desde Assist", () => {
    expect(tipoDesdeEstadoAssist("asignada")).toBe("PROVIDER_ASSIGNED");
    expect(tipoDesdeEstadoAssist("en_camino")).toBe("EN_ROUTE");
    expect(tipoDesdeEstadoAssist("en_curso")).toBe("SERVICE_STARTED");
    expect(tipoDesdeEstadoAssist("finalizada")).toBe("SERVICE_COMPLETED");
    expect(tipoDesdeEstadoAssist("cancelada")).toBe("SERVICE_CANCELLED");
    expect(tipoDesdeEstadoAssist("pendiente")).toBeNull();
  });

  /*
   * Los dos sistemas traducen al MISMO evento desde nombres distintos: es lo
   * que permite que cada uno cambie sus estados sin desplegar el otro.
   */
  it("estados distintos de sistemas distintos llegan al mismo evento", () => {
    expect(tipoDesdeEstadoAssist("en_camino")).toBe(tipoDesdeEstadoCentral("en_route"));
    expect(tipoDesdeEstadoAssist("finalizada")).toBe(tipoDesdeEstadoCentral("finished"));
  });
});

describe("limpieza del payload", () => {
  /*
   * El diario se enseña en pantalla y viaja en la API: un payload con una
   * credencial dentro es una fuga con fecha y hora.
   */
  it("quita cualquier cosa con pinta de credencial", () => {
    const limpio = limpiarPayload({
      destino: "Plataforma A",
      apiKey: "mkc_live_secreto",
      api_key: "otro",
      authorization: "Bearer x",
      TOKEN: "y",
      passwordHash: "z",
    });
    expect(limpio).toEqual({ destino: "Plataforma A" });
    for (const k of CLAVES_PROHIBIDAS_EN_PAYLOAD) {
      expect(Object.keys(limpio).map((x) => x.toLowerCase()))
        .not.toContain(k.toLowerCase());
    }
  });

  it("conserva lo que sí sirve", () => {
    const limpio = limpiarPayload({ estado: "en_camino", intento: 3, urgente: true });
    expect(limpio).toEqual({ estado: "en_camino", intento: 3, urgente: true });
  });

  it("quita los vacíos: un payload lleno de nulos es ruido", () => {
    expect(limpiarPayload({ a: null, b: undefined, c: "x" })).toEqual({ c: "x" });
  });

  it("no se rompe con lo que no es un objeto", () => {
    expect(limpiarPayload(null)).toEqual({});
    expect(limpiarPayload("texto")).toEqual({});
    expect(limpiarPayload([1, 2, 3])).toEqual({});
  });

  it("recorta los textos largos: la timeline se lee entera", () => {
    const largo = limpiarPayload({ nota: "x".repeat(2000) });
    expect(String(largo.nota).length).toBeLessThanOrEqual(500);
  });

  /*
   * Truncar un JSON por la mitad lo deja sin cerrar. Antes esto reventaba al
   * intentar volver a parsearlo y se perdía la línea entera del diario.
   */
  it("un objeto anidado enorme no rompe la anotación", () => {
    const gordo = { lista: Array.from({ length: 500 }, (_, i) => ({ i, texto: "abcdefghij" })) };
    const limpio = limpiarPayload(gordo);
    expect(() => JSON.stringify(limpio)).not.toThrow();
    expect(typeof limpio.lista).toBe("string");
    expect(String(limpio.lista).endsWith("…")).toBe(true);
  });

  it("un objeto anidado pequeño se conserva tal cual", () => {
    const limpio = limpiarPayload({ destino: { id: 1, nombre: "A" } });
    expect(limpio.destino).toEqual({ id: 1, nombre: "A" });
  });
});
