import { describe, expect, it, vi } from "vitest";

const llamadas: any[] = [];
vi.mock("../../../core/openaiService.ts", () => ({
  hayIA: () => true,
  MODELOS: { asistente: "modelo-asistente" },
  pedirIA: async (req: any) => {
    llamadas.push(req);
    return { ok: true, texto: "", modelo: "modelo-asistente", duracionMs: 5, tokensEntrada: 10, tokensSalida: 3, datos: { idioma: "es", accion: "responder", respuesta: "Hola", herramienta: "", parametros_json: "{}", motivo_escalado: "", resumen: "s" } };
  },
}));

import { OpenAIAdapter } from "./openai.ts";
import { decidirSimulado, detectarIdioma } from "./mock.ts";
import { ESQUEMA_DECISION } from "./types.ts";

describe("proveedores de IA", () => {
  it("OpenAIAdapter DELEGA en la capa única (propósito «asistente», esquema estricto) y no crea cliente propio", async () => {
    const a = new OpenAIAdapter();
    const r = await a.decidir({ sistema: "INSTRUCCIONES", mensajes: [{ rol: "user", texto: "¿precio?" }], operacion: "prueba" });
    expect(r).toMatchObject({ ok: true, modelo: "modelo-asistente", tokensEntrada: 10, decision: { accion: "responder" } });
    expect(llamadas[0]).toMatchObject({ proposito: "asistente", operacion: "prueba", esquema: { nombre: "decision_asistente", schema: ESQUEMA_DECISION } });
    expect(llamadas[0].prompt).toContain("INSTRUCCIONES");
    expect(llamadas[0].prompt).toContain("[QUIEN LLAMA]\n¿precio?");
    expect(a.modelo()).toBe("modelo-asistente");
  });

  it("el esquema de decisión es estricto (todas las claves obligatorias, sin extras)", () => {
    expect(ESQUEMA_DECISION.additionalProperties).toBe(false);
    expect([...ESQUEMA_DECISION.required].sort()).toEqual(Object.keys(ESQUEMA_DECISION.properties).sort());
  });

  it("simulado: idioma, herramientas y escalado sin inventar nada", () => {
    expect(detectarIdioma("Quant costa un traster?", "")).toBe("ca");
    expect(detectarIdioma("¿Cuánto cuesta?", "")).toBe("es");
    expect(decidirSimulado([{ rol: "user", texto: "¿Cuánto cuesta un trastero?" }])).toMatchObject({ accion: "herramienta", herramienta: "obtener_base_conocimiento" });
    expect(decidirSimulado([{ rol: "user", texto: "Quiero hablar con una persona" }])).toMatchObject({ accion: "escalar" });
    // Sin resultado en el conocimiento: escala, no se lo inventa.
    const sinDatos = decidirSimulado([
      { rol: "user", texto: "¿Abrís los domingos?" },
      { rol: "tool", texto: JSON.stringify({ herramienta: "obtener_base_conocimiento", estado: "success", resultado: { items: [] } }) },
    ]);
    expect(sinDatos).toMatchObject({ accion: "escalar", motivo_escalado: "Consulta fuera de la base de conocimiento" });
  });
});
