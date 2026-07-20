import { crc16Ibm } from '../decoders/teltonika/crc16.service';

/**
 * Ejemplo oficial de Codec 8 de la documentación de Teltonika:
 * 1 registro, evento IO 1, sin GPS fix (coordenadas 0).
 * Corresponde al campo "data" (codec id ... número de registros final).
 */
export const sampleRecordHex =
  '08' + // codec 8
  '01' + // 1 registro
  '0000016b40d8ea30' + // timestamp
  '01' + // prioridad
  '0000000000000000' + // longitud + latitud (0)
  '0000' + '0000' + '00' + '0000' + // altitud, ángulo, satélites, velocidad
  '01' + // event io id = 1
  '05' + // total io
  '02' + '15' + '03' + '01' + '01' + // 2 elementos u8: io21=3, io1=1
  '01' + '42' + '5e0f' + // 1 elemento u16: io66=24079
  '01' + 'f1' + '0000601a' + // 1 elemento u32: io241=24602
  '01' + '4e' + '0000000000000000' + // 1 elemento u64: io78=0
  '01'; // número de registros (fin)

/** Construye el paquete IMEI inicial de una sesión Teltonika. */
export function buildImeiPacket(imei: string): Buffer {
  const body = Buffer.from(imei, 'ascii');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length, 0);
  return Buffer.concat([len, body]);
}

/** Envuelve un campo data en un frame AVL TCP completo (preamble + len + data + crc). */
export function buildAvlPacket(data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(0, 0);
  header.writeUInt32BE(data.length, 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc16Ibm(data), 0);
  return Buffer.concat([header, data, crc]);
}
