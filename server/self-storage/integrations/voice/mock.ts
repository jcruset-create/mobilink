import type { VoiceProvider } from "./types.ts";

/** Voz simulada: el «audio» es el propio texto en UTF-8. Para pruebas y consola. */
export class MockVoiceProvider implements VoiceProvider {
  readonly nombre = "mock";
  disponible(): boolean {
    return true;
  }
  async transcribir(audio: Uint8Array) {
    const texto = new TextDecoder().decode(audio);
    return { texto, segundos: Math.max(1, Math.round(texto.length / 15)) };
  }
  async sintetizar(texto: string) {
    return { audio: new TextEncoder().encode(texto), formato: "text/plain", segundos: Math.max(1, Math.round(texto.length / 15)) };
  }
}
