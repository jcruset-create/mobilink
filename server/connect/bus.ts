/**
 * Connect Pro — bus de eventos en memoria para el tiempo real (SSE).
 * Los servicios publican aquí; el endpoint /bo/events reenvía a los
 * navegadores conectados. Sin dependencias circulares: solo Node events.
 */

import { EventEmitter } from "node:events";

export type ConnectPush =
  | { kind: "status"; assistanceId: number; status: string }
  | { kind: "alert"; alertId: number; type: string; severity: string; title: string };

export const connectBus = new EventEmitter();
connectBus.setMaxListeners(200);

export function publish(push: ConnectPush): void {
  connectBus.emit("push", push);
}
