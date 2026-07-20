/** Estructuras crudas del protocolo Teltonika (Codec 8 / 8E). */

export interface AvlGps {
  longitude: number;
  latitude: number;
  altitude: number;
  angle: number;
  satellites: number;
  speed: number;
}

export interface AvlIoElement {
  eventIoId: number;
  elements: Map<number, number | bigint>;
}

export interface AvlRecord {
  timestamp: Date;
  priority: number;
  gps: AvlGps;
  io: AvlIoElement;
}

export interface AvlPacket {
  codecId: number; // 0x08 | 0x8E
  recordCount: number;
  records: AvlRecord[];
  crcOk: boolean;
}
