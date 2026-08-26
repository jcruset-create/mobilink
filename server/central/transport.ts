/**
 * El transporte de la caja hacia MC Central.
 *
 * Central vive **en el mismo proceso** que la caja, así que este transporte no
 * hace ninguna llamada de red: invoca la ingesta directamente. Es lo que hace
 * que esta fase no necesite todavía autenticación máquina-a-máquina, ni
 * certificados, ni un reintento por cada corte de red — problemas reales que
 * habría que resolver, pero no para que una red de tres talleres vea sus cajas.
 *
 * Lo importante es que **el emisor no se entera**. La caja escribe en su cola y
 * el worker entrega por `EventTransport`; el día que Central se separe en su
 * propio servicio, se registra un transporte HTTP y no cambia ni una línea de
 * `server/cash/`. Esa es toda la razón de que exista la interfaz.
 *
 * Y la entrega sigue siendo asíncrona aunque no haya red de por medio: pasa por
 * la cola, con sus reintentos y su cola muerta. Llamar a la ingesta dentro de
 * la transacción del cobro habría sido más corto y habría atado nuestra caja a
 * que Central funcione, que es exactamente lo que no puede pasar.
 */

import type { EventTransport, EventoParaEnviar } from "../cash/events/transport.ts";
import { ingerirEvento } from "./ingest.ts";

export class TransporteLocal implements EventTransport {
  readonly clave = "local";

  async enviar(evento: EventoParaEnviar): Promise<void> {
    // El resultado —APLICADO, DUPLICADO o TARDIO— no se mira aquí a propósito:
    // los tres significan «entregado». Quedan anotados en `central_events`
    // para quien quiera auditarlos.
    await ingerirEvento(evento);
  }
}
