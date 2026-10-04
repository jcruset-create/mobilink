/** Registro de proveedores de telefonía. Añadir uno = una clase + una línea aquí. */
import { MockTelephonyProvider } from "./mock.ts";
import type { TelephonyProvider } from "./types.ts";

export * from "./types.ts";
export { PROVEEDORES_TELEFONIA } from "../ai/nombres.ts";

const registro = new Map<string, TelephonyProvider>([["mock", new MockTelephonyProvider()]]);
export const proveedorTelefonia = (nombre: string): TelephonyProvider | null => registro.get(nombre) ?? null;
