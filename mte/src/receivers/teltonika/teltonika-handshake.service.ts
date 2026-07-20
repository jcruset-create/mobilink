import { Socket } from 'net';

/**
 * Handshake Teltonika: tras recibir el IMEI, el servidor responde
 * 0x01 para aceptar el dispositivo o 0x00 para rechazarlo.
 */
export class TeltonikaHandshakeService {
  accept(socket: Socket): void {
    socket.write(Buffer.from([0x01]));
  }

  reject(socket: Socket): void {
    socket.write(Buffer.from([0x00]));
  }
}
