/**
 * Proveedor de IA (OpenAI hoy; Anthropic, Google… mañana). Su único trabajo es
 * convertir instrucciones + conversación en una DECISIÓN estructurada. Nada de
 * reglas de negocio, nada de base de datos y nada de herramientas: eso lo hace
 * Mobilink (`modules/asistente`), igual con cualquier proveedor.
 */

export type MensajeIA = { rol: "user" | "assistant" | "tool"; texto: string };

/** Lo que el asistente decide en cada vuelta. Mismo formato para todos los proveedores. */
export type DecisionIA = {
  idioma: string;
  accion: "responder" | "herramienta" | "escalar" | "finalizar";
  respuesta: string;
  herramienta: string;
  /** Parámetros de la herramienta como JSON en texto (esquema estricto y estable). */
  parametros_json: string;
  motivo_escalado: string;
  resumen: string;
};

export type PeticionDecision = {
  sistema: string;
  mensajes: MensajeIA[];
  /** Identificador para métricas (nunca se registra el contenido). */
  operacion: string;
  maxTokens?: number;
};

export type RespuestaDecision = {
  ok: boolean;
  decision?: DecisionIA;
  error?: string;
  modelo: string;
  tokensEntrada?: number;
  tokensSalida?: number;
  duracionMs: number;
};

export interface AIProvider {
  readonly nombre: string;
  /** Hay con qué hablarle (clave, red…). Sin esto, ni se intenta. */
  disponible(): boolean;
  /** Modelo que usará (informativo: lo decide la configuración del proveedor). */
  modelo(): string;
  decidir(p: PeticionDecision): Promise<RespuestaDecision>;
}

/** Esquema JSON estricto de la decisión (todas las claves obligatorias, sin extras). */
export const ESQUEMA_DECISION = {
  type: "object",
  additionalProperties: false,
  required: ["idioma", "accion", "respuesta", "herramienta", "parametros_json", "motivo_escalado", "resumen"],
  properties: {
    idioma: { type: "string", description: "Código ISO de dos letras del idioma de quien llama (es, ca…)." },
    accion: { type: "string", enum: ["responder", "herramienta", "escalar", "finalizar"] },
    respuesta: { type: "string", description: "Lo que se le dice a quien llama (vacío si accion = herramienta)." },
    herramienta: { type: "string", description: "Nombre de la herramienta (vacío si no se usa)." },
    parametros_json: { type: "string", description: "Parámetros de la herramienta en JSON; «{}» si no hay." },
    motivo_escalado: { type: "string", description: "Por qué se pasa a una persona (vacío si no se escala)." },
    resumen: { type: "string", description: "Resumen breve y actualizado de la conversación." },
  },
} as const;
