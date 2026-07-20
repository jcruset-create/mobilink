/**
 * Simulador de dispositivo Teltonika para probar el MTE sin hardware.
 * Se conecta al servidor TCP, hace handshake con un IMEI y envía un
 * paquete AVL de ejemplo, mostrando el ACK recibido.
 *
 * Uso: npm run simulate  (variables: MTE_HOST, MTE_PORT, IMEI)
 */
import net from 'net';
import { buildAvlPacket, buildImeiPacket, sampleRecordHex } from '../fixtures';

const host = process.env.MTE_HOST ?? '127.0.0.1';
const port = parseInt(process.env.MTE_PORT ?? '5027', 10);
const imei = process.env.IMEI ?? '356307042441013';

const socket = net.createConnection({ host, port }, () => {
  console.log(`Conectado a ${host}:${port}, enviando IMEI ${imei}`);
  socket.write(buildImeiPacket(imei));
});

let phase: 'handshake' | 'avl' = 'handshake';

socket.on('data', (data) => {
  if (phase === 'handshake') {
    if (data[0] === 0x01) {
      console.log('Handshake aceptado (0x01); enviando paquete AVL');
      phase = 'avl';
      socket.write(buildAvlPacket(Buffer.from(sampleRecordHex, 'hex')));
    } else {
      console.error('Dispositivo rechazado (0x00). ¿Está el IMEI autorizado en mte_devices?');
      socket.end();
    }
  } else {
    console.log(`ACK recibido: ${data.readUInt32BE(0)} registros confirmados`);
    socket.end();
  }
});

socket.on('error', (err) => console.error('Error de conexión:', err.message));
socket.on('close', () => console.log('Conexión cerrada'));
