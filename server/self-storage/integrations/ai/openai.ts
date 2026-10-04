/**
 * Adaptador de OpenAI. NO crea su propio cliente ni elige modelo: delega en la
 * capa única de IA de Mobilink (`server/core/openaiService.ts`), que es la que
 * gestiona clave, modelo (OPENAI_ASSISTANT_MODEL), reintentos, respaldo y
 * métricas sin contenido. Es la ÚNICA pieza de Self Storage que la importa
 * (excepción explícita en `aislamientoModulo.test.ts`).
 *
 *   AIProvider ─▶ OpenAIAdapter ─▶ core/openaiService
 *
 * El asistente no depende de esto: depende de `AIProvider`.
 */

import { hayIA, MODELOS, pedirIA } from "../../../core/openaiService.ts";
import { ESQUEMA_DECISION, type AIProvider, type DecisionIA, type PeticionDecision, type RespuestaDecision } from "./types.ts";

/** La capa única recibe un texto: instrucciones + conversación etiquetada. */
export function promptPlano(p: PeticionDecision): string {
  const hilo = p.mensajes
    .map((m) => (m.rol === "user" ? `[QUIEN LLAMA]\n${m.texto}` : m.rol === "assistant" ? `[ASISTENTE]\n${m.texto}` : `[RESULTADO DE HERRAMIENTA]\n${m.texto}`))
    .join("\n\n");
  return `${p.sistema}\n\n## Conversación hasta ahora\n\n${hilo}\n\n## Tu siguiente paso\nDevuelve SOLO la decisión en el formato indicado.`;
}

export class OpenAIAdapter implements AIProvider {
  readonly nombre = "openai";

  disponible(): boolean {
    return hayIA();
  }

  modelo(): string {
    return MODELOS.asistente;
  }

  async decidir(p: PeticionDecision): Promise<RespuestaDecision> {
    const r = await pedirIA<DecisionIA>({
      prompt: promptPlano(p),
      proposito: "asistente",
      esquema: { nombre: "decision_asistente", schema: ESQUEMA_DECISION as unknown as Record<string, unknown> },
      maxTokens: p.maxTokens ?? 1200,
      temperatura: 0.2,
      operacion: p.operacion,
      timeoutMs: 30_000,
    });
    return { ok: r.ok && Boolean(r.datos), decision: r.datos, error: r.ok ? undefined : r.error, modelo: r.modelo, tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida, duracionMs: r.duracionMs };
  }
}
