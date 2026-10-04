/**
 * Proveedor de VOZ (texto ↔ audio): ElevenLabs, OpenAI audio, Google… El
 * asistente trabaja en texto; la voz es una capa que se enchufa alrededor.
 * Fase B: sólo la interfaz y un simulado. Nada de audio se guarda
 * (`call_center.store_audio` sólo admite «no»).
 */
export interface VoiceProvider {
  readonly nombre: string;
  disponible(): boolean;
  /** Audio de quien llama → texto (y segundos de audio, para el coste). */
  transcribir(audio: Uint8Array, opciones: { idioma?: string | null }): Promise<{ texto: string; segundos: number }>;
  /** Texto del asistente → audio para reproducir en la llamada. */
  sintetizar(texto: string, opciones: { idioma: string }): Promise<{ audio: Uint8Array; formato: string; segundos: number }>;
}
