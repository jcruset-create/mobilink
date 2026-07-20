import { AvlPacket } from '../../types/avl';

/**
 * Interfaz común para decodificadores de protocolo.
 * Cualquier fabricante futuro (Queclink, Ruptela, ...) implementa esta interfaz.
 */
export interface ProtocolDecoder {
  /** Codecs / protocolos que sabe decodificar este decoder. */
  supports(codecId: number): boolean;
  /** Decodifica el cuerpo de datos AVL (sin preámbulo ni CRC). */
  decode(data: Buffer): AvlPacket;
}
