import { describe, expect, it } from "vitest";

import {
  asuntoBase,
  asuntoConReferencia,
  extraerExpediente,
  normalizarDireccion,
  normalizarMessageId,
  referenciaDe,
  referenciasDeCabecera,
} from "./referencia.ts";
import {
  MAX_RECORDATORIOS,
  MOTIVOS,
  construirMensaje,
  esperaHastaSiguienteMs,
  tocaRecordar,
} from "./plantillas.ts";

describe("referencia en el asunto", () => {
  it("construye la referencia del expediente", () => {
    expect(referenciaDe("AST-4210")).toBe("[AST-4210]");
    expect(referenciaDe("as-2026-000123")).toBe("[AS-2026-000123]");
    expect(referenciaDe("")).toBeNull();
    expect(referenciaDe(null)).toBeNull();
  });

  it("la añade al asunto", () => {
    expect(asuntoConReferencia("Falta el albarán", "AST-4210"))
      .toBe("[AST-4210] Falta el albarán");
  });

  /*
   * Que no se duplique importa de verdad: al responder varias veces, un asunto
   * con la referencia repetida tres veces es lo que hace que la gente la borre
   * a mano, y entonces se pierde el enganche.
   */
  it("no la duplica si el asunto ya la lleva", () => {
    const conRef = "[AST-4210] Falta el albarán";
    expect(asuntoConReferencia(conRef, "AST-4210")).toBe(conRef);
    expect(asuntoConReferencia("Re: [AST-4210] Falta el albarán", "AST-4210"))
      .toBe("Re: [AST-4210] Falta el albarán");
  });

  it("saca el expediente de una respuesta, aunque venga con Re: y reenvíos", () => {
    expect(extraerExpediente("Re: [AST-4210] Falta el albarán")).toBe("AST-4210");
    expect(extraerExpediente("RV: Fwd: Re: [AS-2026-000123] lo que sea")).toBe("AS-2026-000123");
    expect(extraerExpediente("[ast-4210] en minúsculas")).toBe("AST-4210");
  });

  it("no se inventa un expediente donde no lo hay", () => {
    expect(extraerExpediente("Un correo cualquiera")).toBeNull();
    expect(extraerExpediente("[FACTURA-2026] de otra cosa")).toBeNull();
    expect(extraerExpediente(null)).toBeNull();
  });
});

describe("enganche por cabeceras", () => {
  /* La otra mitad de las respuestas llega con el asunto reescrito entero. */
  it("recoge In-Reply-To y References", () => {
    const r = referenciasDeCabecera({
      inReplyTo: "<abc@mobilink>",
      references: "<uno@mobilink> <abc@mobilink>",
    });
    expect(r).toContain("abc@mobilink");
    expect(r).toContain("uno@mobilink");
    expect(r).toHaveLength(2);       // sin duplicados
  });

  it("admite References como lista, que es como lo dan algunos clientes", () => {
    expect(referenciasDeCabecera({ references: ["<a@x>", "<b@x>"] }))
      .toEqual(["a@x", "b@x"]);
  });

  it("aguanta cabeceras vacías", () => {
    expect(referenciasDeCabecera({})).toEqual([]);
    expect(referenciasDeCabecera({ inReplyTo: "", references: null })).toEqual([]);
  });

  it("normaliza los ángulos y las mayúsculas, que cada cliente pone a su manera", () => {
    expect(normalizarMessageId("<ABC@Mobilink>")).toBe("abc@mobilink");
    expect(normalizarMessageId("  abc@mobilink ")).toBe("abc@mobilink");
  });
});

describe("direcciones y asuntos", () => {
  it("se queda con la dirección, no con el nombre", () => {
    expect(normalizarDireccion("Marta <MARTA@taller.es>")).toBe("marta@taller.es");
    expect(normalizarDireccion(" marta@taller.es ")).toBe("marta@taller.es");
  });

  /* Sin esto, el mismo hilo aparece como cinco conversaciones distintas. */
  it("limpia las marcas de respuesta para agrupar el hilo", () => {
    expect(asuntoBase("Re: [AST-4210] Falta el albarán")).toBe("Falta el albarán");
    expect(asuntoBase("RE: RV: Fwd: [AST-4210] Falta el albarán")).toBe("Falta el albarán");
    expect(asuntoBase("Re[2]: [AST-4210] Falta el albarán")).toBe("Falta el albarán");
  });
});

describe("plantillas", () => {
  const datos = {
    expediente: "AST-4210",
    matricula: "1234ABC",
    direccion: "AP-7 km 245",
    fechaServicio: 1_700_000_000_000,
    remitente: "Marta",
  };

  it("todas llevan la referencia en el asunto", () => {
    for (const m of MOTIVOS) {
      expect(construirMensaje(m, datos).asunto).toContain("[AST-4210]");
    }
  });

  it("todas dicen de qué expediente hablan", () => {
    for (const m of MOTIVOS) {
      const msg = construirMensaje(m, datos);
      expect(msg.texto).toContain("AST-4210");
      expect(msg.texto).toContain("1234ABC");
    }
  });

  /*
   * Estos correos salen hacia talleres: lo que cruza por correo no se puede
   * retirar. Ninguna plantilla puede llevar importes ni costes.
   */
  it("ninguna plantilla lleva importes ni costes", () => {
    for (const m of MOTIVOS) {
      const t = construirMensaje(m, { ...datos, descripcion: "Cambio de rueda" }).texto.toLowerCase();
      for (const prohibido of ["coste", "margen", "importe", "precio", "€"]) {
        expect(t).not.toContain(prohibido);
      }
    }
  });

  it("cada una pide UNA cosa", () => {
    expect(construirMensaje("solicitud_albaran", datos).texto.toLowerCase()).toContain("albarán");
    expect(construirMensaje("solicitud_albaran", datos).texto.toLowerCase()).not.toContain("factura");
    expect(construirMensaje("solicitud_factura", datos).texto.toLowerCase()).toContain("factura");
  });

  it("el recordatorio cambia el tono, no lo que pide", () => {
    const primero = construirMensaje("solicitud_albaran", datos);
    const segundo = construirMensaje("recordatorio_albaran", { ...datos, intento: 2 });
    expect(segundo.asunto).toContain("Recordatorio");
    expect(primero.asunto).not.toContain("Recordatorio");
    expect(segundo.texto.toLowerCase()).toContain("albarán");
  });

  it("pide que respondan sin cambiar el asunto: es lo que mantiene el enganche", () => {
    expect(construirMensaje("solicitud_factura", datos).texto).toContain("sin cambiar el asunto");
  });
});

describe("cadencia de los recordatorios", () => {
  const DIA = 24 * 60 * 60 * 1000;

  /*
   * Creciente a propósito: un recordatorio diario no consigue el albarán antes,
   * consigue que el taller marque el remitente como correo no deseado.
   */
  it("la espera crece con cada intento", () => {
    expect(esperaHastaSiguienteMs(1)).toBe(2 * DIA);
    expect(esperaHastaSiguienteMs(2)).toBe(4 * DIA);
    expect(esperaHastaSiguienteMs(3)).toBe(7 * DIA);
    expect(esperaHastaSiguienteMs(9)).toBe(7 * DIA);   // con techo
  });

  it("el primero sale enseguida", () => {
    expect(tocaRecordar({ intentos: 0, ultimoEnvioMs: null, resuelto: false }, Date.now()).toca)
      .toBe(true);
  });

  it("no se manda otro antes de tiempo", () => {
    const ahora = Date.now();
    const r = tocaRecordar({ intentos: 1, ultimoEnvioMs: ahora - DIA, resuelto: false }, ahora);
    expect(r.toca).toBe(false);
    expect(r.motivo).toBe("aun_no");
  });

  it("pasada la espera, sí", () => {
    const ahora = Date.now();
    expect(tocaRecordar({ intentos: 1, ultimoEnvioMs: ahora - 3 * DIA, resuelto: false }, ahora).toca)
      .toBe(true);
  });

  /* Lo que ya llegó no se vuelve a pedir: es el fallo que más molesta a un taller. */
  it("resuelto no se recuerda nunca más", () => {
    const r = tocaRecordar({ intentos: 0, ultimoEnvioMs: null, resuelto: true }, Date.now());
    expect(r.toca).toBe(false);
    expect(r.motivo).toBe("resuelto");
  });

  /*
   * A partir de tres avisos deja de insistir la máquina y pasa a la bandeja:
   * si no han contestado en tres, no van a contestar al cuarto.
   */
  it("deja de insistir tras el máximo, y dice por qué", () => {
    const r = tocaRecordar(
      { intentos: MAX_RECORDATORIOS, ultimoEnvioMs: 0, resuelto: false }, Date.now());
    expect(r.toca).toBe(false);
    expect(r.motivo).toBe("demasiados");
  });
});
