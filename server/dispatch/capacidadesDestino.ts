/**
 * Qué sabe hacer cada plataforma destino, y qué hacer cuando no sabe.
 *
 * No todas las plataformas hacen lo mismo. Una acepta documentos y manda
 * posición en vivo; otra solo confirma que ha recibido el aviso y llama por
 * teléfono. Sin declararlo, el sistema pide lo mismo a todas y acaba lleno de
 * errores que no son errores: pedir seguimiento a quien no lo tiene no es un
 * fallo, es una plataforma más sencilla.
 *
 * La degradación es elegante en un sentido concreto: si el destino no sabe
 * hacer algo, se deja de pedir y se dice en la pantalla lo que no habrá. Nunca
 * se falsea —no se inventa una posición ni un ETA— y nunca se rompe el envío
 * por una capacidad que falta.
 *
 * Un destino sin capacidades declaradas se trata como el mínimo común: recibe
 * asistencias y comunica estados. Es lo único que puede darse por supuesto de
 * algo con lo que se acaba de conectar.
 */

export const CAPACIDADES = [
  "supports_status_updates",
  "supports_documents",
  "supports_live_tracking",
  "supports_quotes",
  "supports_invoice_sync",
  "supports_cancellation",
  "supports_eta",
] as const;

export type Capacidad = (typeof CAPACIDADES)[number];

/** Lo que se da por supuesto cuando el destino no ha declarado nada. */
const MINIMO: Capacidad[] = ["supports_status_updates"];

export function leerCapacidades(v: unknown): Capacidad[] {
  let o: any = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { o = []; } }
  if (!Array.isArray(o)) return [...MINIMO];
  const validas = o
    .map((x) => String(x ?? "").trim())
    .filter((x): x is Capacidad => (CAPACIDADES as readonly string[]).includes(x));
  return validas.length === 0 ? [...MINIMO] : validas;
}

export function puede(capacidades: unknown, cap: Capacidad): boolean {
  return leerCapacidades(capacidades).includes(cap);
}

/** Texto para la pantalla: qué NO va a pasar con este destino. */
const AUSENCIA: Record<Capacidad, string> = {
  supports_status_updates: "No comunica cambios de estado: habrá que preguntarlos.",
  supports_documents: "No devuelve documentos: el parte y las fotos llegarán por otra vía.",
  supports_live_tracking: "Sin seguimiento en vivo: no habrá posición en el mapa.",
  supports_quotes: "No presupuesta: se encarga con la tarifa pactada o no se encarga.",
  supports_invoice_sync: "No manda importes: la factura se concilia a mano.",
  supports_cancellation: "No admite cancelación automática: hay que llamar.",
  supports_eta: "No da hora estimada de llegada.",
};

/**
 * Lo que este destino no hace, en la lengua del operador.
 *
 * Solo se avisa de lo que se echa en falta de verdad, que es lo que se le iba
 * a pedir. Listar las siete capacidades que no tiene un destino sencillo
 * convierte el aviso en ruido y deja de leerse.
 */
export function limitaciones(capacidades: unknown, seVanAPedir: Capacidad[] = [...CAPACIDADES]): string[] {
  const tiene = leerCapacidades(capacidades);
  return seVanAPedir.filter((c) => !tiene.includes(c)).map((c) => AUSENCIA[c]);
}
