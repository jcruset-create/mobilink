/**
 * Por dónde salen los eventos hacia MC Central.
 *
 * Central todavía no existe —es la fase 3—, así que aquí solo está el contrato
 * y una implementación en memoria para las pruebas. Es exactamente lo que el
 * módulo ya hizo con la ERP: `ICashErpConnector` + `MockCashErpConnector`
 * mucho antes de que hubiera un conector real. El motor no cambia cuando
 * aparece el de verdad, solo se registra otro transporte.
 *
 * Mientras no haya ninguno configurado, los eventos **se acumulan en PENDING**.
 * No es un fallo ni algo que haya que limpiar: es la cola esperando destino, y
 * el día que Central arranque los recibe en orden desde el principio.
 */

export type EventoParaEnviar = {
  eventId: string;
  empresaId: string;
  centroId: string | null;
  registerId: number | null;
  sessionId: number | null;
  aggregateType: string | null;
  aggregateId: number | null;
  aggregateVersion: number | null;
  tipo: string;
  ocurridoEnMs: number;
  actorUserId: string | null;
  datos: Record<string, unknown>;
};

/**
 * Un fallo del que no sirve reintentar: el destino ha dicho que ese evento no
 * lo va a aceptar nunca (formato inválido, empresa desconocida). Va a la cola
 * muerta directamente en vez de gastar ocho intentos.
 *
 * Todo lo demás —red, 500, tiempo de espera— es temporal y se reintenta.
 */
export class ErrorTransportePermanente extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorTransportePermanente";
  }
}

export interface EventTransport {
  readonly clave: string;
  /**
   * Entrega el evento. Debe ser **idempotente en el destino** usando
   * `eventId`: el worker puede reenviar el mismo evento si se cae justo
   * después de entregarlo y antes de anotarlo.
   */
  enviar(evento: EventoParaEnviar): Promise<void>;
}

/** Transporte en memoria: guarda lo recibido. Solo para pruebas y desarrollo. */
export class TransporteEnMemoria implements EventTransport {
  readonly clave = "memoria";
  readonly recibidos: EventoParaEnviar[] = [];

  /** Si está puesto, `enviar` falla con él. Para probar la cola y los reintentos. */
  fallo: Error | null = null;

  async enviar(evento: EventoParaEnviar): Promise<void> {
    if (this.fallo) throw this.fallo;
    // Deduplicación por `eventId`, como debe hacer el destino real: un reenvío
    // no puede contar el mismo cobro dos veces.
    if (this.recibidos.some((r) => r.eventId === evento.eventId)) return;
    this.recibidos.push(evento);
  }

  limpiar(): void {
    this.recibidos.length = 0;
    this.fallo = null;
  }
}

let activo: EventTransport | null = null;

/** Registra el transporte que usará el worker. Sin ninguno, la cola espera. */
export function registrarTransporte(t: EventTransport | null): void {
  activo = t;
}

export function transporteActivo(): EventTransport | null {
  return activo;
}
