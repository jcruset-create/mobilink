import { Socket } from 'net';

/**
 * ACK Teltonika: tras procesar un paquete AVL, el servidor confirma
 * con el número de registros aceptados como entero de 4 bytes.
 * Si el número no coincide con el enviado, el dispositivo reenvía el paquete.
 */
export class TeltonikaAckService {
  ack(socket: Socket, recordCount: number): void {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(recordCount, 0);
    socket.write(buf);
  }

  /** Rechazo: confirmar 0 registros fuerza el reenvío del paquete. */
  nack(socket: Socket): void {
    this.ack(socket, 0);
  }
}
