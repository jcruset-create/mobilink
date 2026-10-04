/** Registro de proveedores de voz. Añadir uno = una clase + una línea aquí. */
import { MockVoiceProvider } from "./mock.ts";
import type { VoiceProvider } from "./types.ts";

export * from "./types.ts";
export { PROVEEDORES_VOZ } from "../ai/nombres.ts";

const registro = new Map<string, VoiceProvider>([["mock", new MockVoiceProvider()]]);
export const proveedorVoz = (nombre: string): VoiceProvider | null => registro.get(nombre) ?? null;
export function fijarProveedorVoz(nombre: string, p: VoiceProvider | null): void {
  if (p) registro.set(nombre, p);
  else registro.delete(nombre);
}
