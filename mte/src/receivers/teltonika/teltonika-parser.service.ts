import { crc16Ibm } from '../../decoders/teltonika/crc16.service';

export type FrameResult =
  | { kind: 'incomplete' }
  | { kind: 'imei'; imei: string; consumed: number }
  | { kind: 'avl'; data: Buffer; crcOk: boolean; consumed: number }
  | { kind: 'invalid'; reason: string; consumed: number };

/**
 * Parser de framing TCP de Teltonika.
 * - Primer paquete de la sesión: [len u16][IMEI ascii]
 * - Paquetes AVL: [preamble u32 = 0][dataLen u32][data...][crc u32]
 */
export class TeltonikaParser {
  /** Intenta extraer el paquete IMEI inicial del buffer. */
  parseImei(buffer: Buffer): FrameResult {
    if (buffer.length < 2) return { kind: 'incomplete' };
    const len = buffer.readUInt16BE(0);
    if (len < 8 || len > 20) {
      return { kind: 'invalid', reason: `Longitud de IMEI inválida: ${len}`, consumed: buffer.length };
    }
    if (buffer.length < 2 + len) return { kind: 'incomplete' };
    const imei = buffer.subarray(2, 2 + len).toString('ascii');
    if (!/^\d{8,17}$/.test(imei)) {
      return { kind: 'invalid', reason: `IMEI no numérico: ${imei}`, consumed: 2 + len };
    }
    return { kind: 'imei', imei, consumed: 2 + len };
  }

  /** Intenta extraer un frame AVL completo del buffer. */
  parseAvlFrame(buffer: Buffer): FrameResult {
    if (buffer.length < 8) return { kind: 'incomplete' };
    const preamble = buffer.readUInt32BE(0);
    if (preamble !== 0) {
      return { kind: 'invalid', reason: `Preamble inválido: 0x${preamble.toString(16)}`, consumed: buffer.length };
    }
    const dataLen = buffer.readUInt32BE(4);
    if (dataLen < 3 || dataLen > 10 * 1024 * 1024) {
      return { kind: 'invalid', reason: `Longitud de datos inválida: ${dataLen}`, consumed: buffer.length };
    }
    const total = 8 + dataLen + 4;
    if (buffer.length < total) return { kind: 'incomplete' };

    const data = buffer.subarray(8, 8 + dataLen);
    const crcReceived = buffer.readUInt32BE(8 + dataLen);
    const crcOk = crc16Ibm(data) === crcReceived;
    return { kind: 'avl', data: Buffer.from(data), crcOk, consumed: total };
  }
}
