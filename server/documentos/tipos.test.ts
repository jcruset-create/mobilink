import { describe, expect, it } from "vitest";

import {
  ESTADOS_ADMIN,
  ETIQUETA_ADMIN,
  TIPOS_DOCUMENTO,
  documentosExigidos,
  documentosQueFaltan,
  estadoAdministrativo,
  puedeVer,
  requiereAtencion,
  tipoDesdeKindAssist,
  visibilidadPorDefecto,
  type HechosAdmin,
} from "./tipos.ts";

function hechos(extra: Partial<HechosAdmin> = {}): HechosAdmin {
  return {
    servicioFinalizado: true,
    tiposPresentes: [],
    documentosExigidos: ["albaran"],
    costeValidado: false,
    facturada: false,
    subcontratada: false,
    ...extra,
  };
}

describe("catálogo de documentos", () => {
  it("están los tipos acordados", () => {
    for (const t of ["albaran", "parte", "factura", "presupuesto", "fotografia", "autorizacion", "otro"]) {
      expect(TIPOS_DOCUMENTO).toContain(t);
    }
  });

  /* Se traducen los `kind` viejos en vez de renombrarlos: hay años de fotos
     guardadas con esos nombres y las pantallas actuales los leen tal cual. */
  it("traduce los kind que ya usaba Assist", () => {
    expect(tipoDesdeKindAssist("firma")).toBe("firma");
    expect(tipoDesdeKindAssist("matricula")).toBe("fotografia");
    expect(tipoDesdeKindAssist("averia")).toBe("fotografia");
    expect(tipoDesdeKindAssist("ALBARAN")).toBe("albaran");
    expect(tipoDesdeKindAssist("loquesea")).toBe("otro");
    expect(tipoDesdeKindAssist(null)).toBe("otro");
  });
});

describe("visibilidad por defecto", () => {
  /*
   * LA regla. La factura del taller a Central lleva dentro lo que a Central le
   * cuesta el servicio; con eso Assist calcularía el margen de su proveedor.
   */
  it("la factura de un proveedor NO se comparte", () => {
    expect(visibilidadPorDefecto("factura", "proveedor")).toBe("interno");
    expect(visibilidadPorDefecto("presupuesto", "proveedor")).toBe("interno");
  });

  it("la factura propia sí: es lo que se le va a cobrar a la contraparte", () => {
    expect(visibilidadPorDefecto("factura", "propio")).toBe("compartido");
  });

  it("albarán y parte llegan hasta el cliente final", () => {
    expect(visibilidadPorDefecto("albaran")).toBe("cliente");
    expect(visibilidadPorDefecto("parte")).toBe("cliente");
  });

  it("fotos, firma y autorización se comparten con la contraparte", () => {
    for (const t of ["fotografia", "firma", "autorizacion"] as const) {
      expect(visibilidadPorDefecto(t)).toBe("compartido");
    }
  });

  /* Por defecto interno: un tipo que nadie ha clasificado no se filtra solo. */
  it("lo no clasificado nace interno", () => {
    expect(visibilidadPorDefecto("otro")).toBe("interno");
  });
});

describe("quién puede ver qué", () => {
  it("el dueño lo ve todo", () => {
    for (const v of ["interno", "compartido", "cliente", "loquesea"]) {
      expect(puedeVer(v, "propio")).toBe(true);
    }
  });

  it("la contraparte ve lo compartido y lo del cliente, nunca lo interno", () => {
    expect(puedeVer("interno", "contraparte")).toBe(false);
    expect(puedeVer("compartido", "contraparte")).toBe(true);
    expect(puedeVer("cliente", "contraparte")).toBe(true);
  });

  it("el cliente final solo ve lo suyo", () => {
    expect(puedeVer("cliente", "cliente")).toBe(true);
    expect(puedeVer("compartido", "cliente")).toBe(false);
    expect(puedeVer("interno", "cliente")).toBe(false);
  });

  /* Lo desconocido no se enseña: un valor corrupto o nuevo no puede abrir una
     puerta que nadie ha decidido abrir. */
  it("una visibilidad desconocida no se enseña a nadie de fuera", () => {
    expect(puedeVer("inventada", "contraparte")).toBe(false);
    expect(puedeVer(null, "cliente")).toBe(false);
    expect(puedeVer(undefined, "contraparte")).toBe(false);
  });
});

describe("documentos exigidos", () => {
  it("un servicio propio necesita el albarán", () => {
    expect(documentosExigidos(false)).toEqual(["albaran"]);
  });

  /* Subcontratado necesita además la factura de quien lo hizo: sin ella no se
     puede cerrar el coste, y sin coste no hay margen conocido. */
  it("uno subcontratado necesita además la factura", () => {
    expect(documentosExigidos(true)).toEqual(["albaran", "factura"]);
  });

  it("sabe decir qué falta", () => {
    expect(documentosQueFaltan(hechos({
      documentosExigidos: ["albaran", "factura"], tiposPresentes: ["albaran", "fotografia"],
    }))).toEqual(["factura"]);
    expect(documentosQueFaltan(hechos({ tiposPresentes: ["albaran"] }))).toEqual([]);
  });
});

describe("estado administrativo deducido", () => {
  it("recién terminada y sin nada: pendiente de albarán", () => {
    expect(estadoAdministrativo(hechos())).toBe("PENDIENTE_ALBARAN");
  });

  it("con albarán pero sin validar el coste: documentación completa", () => {
    expect(estadoAdministrativo(hechos({ tiposPresentes: ["albaran"] })))
      .toBe("DOCUMENTACION_COMPLETA");
  });

  it("con el coste validado: lista para facturar", () => {
    expect(estadoAdministrativo(hechos({ tiposPresentes: ["albaran"], costeValidado: true })))
      .toBe("LISTA_PARA_FACTURAR");
  });

  it("facturada manda sobre todo lo demás", () => {
    expect(estadoAdministrativo(hechos({ facturada: true }))).toBe("FACTURADA");
  });

  it("subcontratada con albarán pero sin factura: pendiente de factura", () => {
    expect(estadoAdministrativo(hechos({
      subcontratada: true,
      documentosExigidos: ["albaran", "factura"],
      tiposPresentes: ["albaran"],
    }))).toBe("PENDIENTE_FACTURA");
  });

  it("el albarán se reclama antes que la factura: es el que firma el cliente", () => {
    expect(estadoAdministrativo(hechos({
      documentosExigidos: ["albaran", "factura"], tiposPresentes: [],
    }))).toBe("PENDIENTE_ALBARAN");
  });

  /*
   * Antes de terminar no se reclama papeleo: una asistencia en curso «pendiente
   * de albarán» llenaría la bandeja de avisos que nadie puede atender, y una
   * bandeja llena de ruido se ignora entera.
   */
  it("mientras el servicio no ha terminado no se reclama nada", () => {
    expect(estadoAdministrativo(hechos({ servicioFinalizado: false })))
      .toBe("SIN_DOCUMENTACION");
    expect(estadoAdministrativo(hechos({ servicioFinalizado: false, tiposPresentes: ["fotografia"] })))
      .toBe("COSTE_PENDIENTE");
  });

  /*
   * El caso del enunciado: operativo FINALIZADA y administrativo PENDIENTE
   * ALBARÁN conviven. Son dos verdades a la vez.
   */
  it("operativo y administrativo son independientes", () => {
    const finalizadaSinPapeles = estadoAdministrativo(hechos({ servicioFinalizado: true }));
    expect(finalizadaSinPapeles).toBe("PENDIENTE_ALBARAN");
    expect(ETIQUETA_ADMIN[finalizadaSinPapeles]).toBe("Pendiente de albarán");
  });

  it("es una función pura: los mismos hechos dan el mismo estado", () => {
    const h = hechos({ tiposPresentes: ["albaran"], costeValidado: true });
    expect(estadoAdministrativo(h)).toBe(estadoAdministrativo(h));
  });

  it("todos los estados tienen etiqueta", () => {
    for (const e of ESTADOS_ADMIN) {
      expect(ETIQUETA_ADMIN[e]).toBeTruthy();
      expect(ETIQUETA_ADMIN[e]).not.toBe(e);
    }
  });
});

describe("qué entra en la bandeja de excepciones", () => {
  it("lo que espera algo de una persona", () => {
    expect(requiereAtencion("PENDIENTE_ALBARAN")).toBe(true);
    expect(requiereAtencion("PENDIENTE_FACTURA")).toBe(true);
    expect(requiereAtencion("SIN_DOCUMENTACION")).toBe(true);
    // Documentación completa pero coste sin validar: es donde se atasca.
    expect(requiereAtencion("DOCUMENTACION_COMPLETA")).toBe(true);
  });

  it("lo que ya va solo, no", () => {
    expect(requiereAtencion("LISTA_PARA_FACTURAR")).toBe(false);
    expect(requiereAtencion("FACTURADA")).toBe(false);
    expect(requiereAtencion("COSTE_VALIDADO")).toBe(false);
  });
});
