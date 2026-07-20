/**
 * CRC-16/IBM (ARC), polinomio 0xA001 (reflejado de 0x8005), init 0x0000.
 * Es el CRC usado por Teltonika en los paquetes AVL TCP.
 */
export function crc16Ibm(buffer: Buffer): number {
  let crc = 0x0000;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xffff;
}
