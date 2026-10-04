/**
 * Registro de proveedores de IA. Añadir uno (Anthropic, Google…) es: una
 * clase que implemente `AIProvider` + una línea aquí + su nombre en
 * `PROVEEDORES_IA`. El asistente no cambia.
 */

import { MockAIProvider } from "./mock.ts";
import { OpenAIAdapter } from "./openai.ts";
import type { AIProvider } from "./types.ts";

export * from "./types.ts";

export { PROVEEDORES_IA } from "./nombres.ts";
import type { PROVEEDORES_IA } from "./nombres.ts";
export type NombreProveedorIA = (typeof PROVEEDORES_IA)[number];

const registro = new Map<string, AIProvider>([
  ["mock", new MockAIProvider()],
  ["openai", new OpenAIAdapter()],
]);

export function proveedorIA(nombre: string): AIProvider | null {
  return registro.get(nombre) ?? null;
}

/** Para pruebas: sustituye (o añade) un proveedor. */
export function fijarProveedorIA(nombre: string, p: AIProvider | null): void {
  if (p) registro.set(nombre, p);
  else registro.delete(nombre);
}

/** Estado de cada proveedor para la pantalla de Proveedores (sin secretos). */
export function estadoProveedoresIA(): { nombre: string; disponible: boolean; modelo: string }[] {
  return [...registro.values()].map((p) => ({ nombre: p.nombre, disponible: p.disponible(), modelo: p.modelo() }));
}
