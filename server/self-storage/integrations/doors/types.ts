/**
 * Contrato de los controladores de puertas (fase 3). Sólo tipos: la fase 1 no
 * abre nada, pero el resto del módulo ya puede hablar en estos términos.
 *
 * Modelo físico: dispositivo → salidas → puertas. La lógica de accesos habla de
 * PUERTAS; sólo el adaptador sabe de salidas, relés y protocolos. Así un RUT241
 * con una salida, un módulo de relés con ocho u otro controlador no cambian
 * nada fuera de `integrations/doors/`.
 */

/** Conectividad del dispositivo. La definitiva se decide con el equipo delante. */
export type DeviceDriver = "rms" | "rut_http" | "relay" | "mock";

export type DeviceTarget = {
  id: string;
  model: string; // 'RUT241', …
  driver: DeviceDriver;
  endpoint: string | null;
  /** NOMBRE de la variable de entorno con la credencial; nunca la credencial. */
  credentialsSecretName: string | null;
};

export type OutputTarget = {
  device: DeviceTarget;
  outputNumber: number;
  outputType: "relay" | "digital_output";
  pulseDurationMs: number;
};

export type PulseResult = { ok: boolean; latencyMs: number; error?: string };

export interface DoorController {
  /** Activa la salida `ms` milisegundos y la apaga SIEMPRE, aunque algo falle. */
  pulse(output: OutputTarget, ms: number): Promise<PulseResult>;
  /** Latido: ¿responde el dispositivo? */
  ping(device: DeviceTarget): Promise<{ online: boolean; firmware?: string }>;
}
