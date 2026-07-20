import { AvlPacket, AvlRecord } from '../../types/avl';
import { ProtocolDecoder } from '../interfaces/decoder.interface';

export const CODEC_8 = 0x08;
export const CODEC_8E = 0x8e;

class ByteReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  u8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  u16(): number {
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }
  u32(): number {
    const v = this.buf.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  i32(): number {
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  u64(): bigint {
    const v = this.buf.readBigUInt64BE(this.offset);
    this.offset += 8;
    return v;
  }
  bytes(n: number): Buffer {
    const v = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  get position(): number {
    return this.offset;
  }
}

/**
 * Decodificador de Teltonika Codec 8 y Codec 8 Extended.
 *
 * Diferencias 8E vs 8:
 *  - IDs de IO en 2 bytes (u16) en lugar de 1 byte (u8)
 *  - Contadores de IO en 2 bytes
 *  - Bloque adicional de elementos de longitud variable (NX)
 */
export class Codec8Decoder implements ProtocolDecoder {
  supports(codecId: number): boolean {
    return codecId === CODEC_8 || codecId === CODEC_8E;
  }

  /**
   * Decodifica el campo "data" del paquete AVL:
   * [codecId u8][count u8][records...][count u8]
   */
  decode(data: Buffer): AvlPacket {
    const r = new ByteReader(data);
    const codecId = r.u8();
    if (!this.supports(codecId)) {
      throw new Error(`Codec no soportado: 0x${codecId.toString(16)}`);
    }
    const extended = codecId === CODEC_8E;
    const count = r.u8();
    const records: AvlRecord[] = [];

    for (let i = 0; i < count; i++) {
      records.push(this.decodeRecord(r, extended));
    }

    const countEnd = r.u8();
    if (countEnd !== count) {
      throw new Error(`Contador de registros inconsistente: ${count} != ${countEnd}`);
    }

    return { codecId, recordCount: count, records, crcOk: true };
  }

  private decodeRecord(r: ByteReader, extended: boolean): AvlRecord {
    const timestampMs = r.u64();
    const priority = r.u8();

    // Bloque GPS
    const longitude = r.i32() / 1e7;
    const latitude = r.i32() / 1e7;
    const altitude = r.u16();
    const angle = r.u16();
    const satellites = r.u8();
    const speed = r.u16();

    // Bloque IO
    const readId = () => (extended ? r.u16() : r.u8());
    const readCount = () => (extended ? r.u16() : r.u8());

    const eventIoId = readId();
    readCount(); // total de elementos IO (no se necesita para parsear)

    const elements = new Map<number, number | bigint>();

    const n1 = readCount();
    for (let i = 0; i < n1; i++) elements.set(readId(), r.u8());

    const n2 = readCount();
    for (let i = 0; i < n2; i++) elements.set(readId(), r.u16());

    const n4 = readCount();
    for (let i = 0; i < n4; i++) elements.set(readId(), r.u32());

    const n8 = readCount();
    for (let i = 0; i < n8; i++) elements.set(readId(), r.u64());

    if (extended) {
      // Elementos de longitud variable (solo Codec 8E)
      const nx = r.u16();
      for (let i = 0; i < nx; i++) {
        const id = r.u16();
        const len = r.u16();
        const raw = r.bytes(len);
        // Se almacena como número si cabe, si no como bigint del buffer
        elements.set(id, raw.length <= 6 ? Number(BigInt('0x' + (raw.toString('hex') || '0'))) : BigInt('0x' + raw.toString('hex')));
      }
    }

    return {
      timestamp: new Date(Number(timestampMs)),
      priority,
      gps: { longitude, latitude, altitude, angle, satellites, speed },
      io: { eventIoId, elements },
    };
  }
}
