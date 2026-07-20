/**
 * Tests mínimos sin framework: decodificación Codec 8 / 8E, CRC y framing.
 * Ejecutar con: npm test
 */
import assert from 'assert';
import { crc16Ibm } from '../decoders/teltonika/crc16.service';
import { Codec8Decoder } from '../decoders/teltonika/codec8.decoder';
import { TeltonikaParser } from '../receivers/teltonika/teltonika-parser.service';
import { normalizeTelemetry } from '../normalizers/telemetry.normalizer';
import { buildAvlPacket, buildImeiPacket, sampleRecordHex } from './fixtures';

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    console.error(`  ✘ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('MTE tests');

test('CRC16/IBM de "123456789" es 0xBB3D', () => {
  assert.strictEqual(crc16Ibm(Buffer.from('123456789', 'ascii')), 0xbb3d);
});

test('Parser extrae paquete IMEI', () => {
  const parser = new TeltonikaParser();
  const result = parser.parseImei(buildImeiPacket('356307042441013'));
  assert.strictEqual(result.kind, 'imei');
  if (result.kind === 'imei') assert.strictEqual(result.imei, '356307042441013');
});

test('Parser rechaza IMEI no numérico', () => {
  const parser = new TeltonikaParser();
  const bad = Buffer.concat([Buffer.from([0x00, 0x04]), Buffer.from('ABCD', 'ascii')]);
  assert.strictEqual(parser.parseImei(bad).kind, 'invalid');
});

test('Decodifica registro Codec 8 de la documentación Teltonika', () => {
  // Ejemplo oficial de Teltonika (1 registro, Codec 8)
  const data = Buffer.from(sampleRecordHex, 'hex');
  const decoder = new Codec8Decoder();
  const packet = decoder.decode(data);
  assert.strictEqual(packet.codecId, 0x08);
  assert.strictEqual(packet.recordCount, 1);
  const rec = packet.records[0];
  assert.strictEqual(rec.priority, 1);
  assert.strictEqual(rec.io.eventIoId, 1);
  assert.strictEqual(rec.io.elements.get(1), 1);
});

test('Framing AVL completo con CRC válido y consumo correcto', () => {
  const data = Buffer.from(sampleRecordHex, 'hex');
  const frame = buildAvlPacket(data);
  const parser = new TeltonikaParser();
  const result = parser.parseAvlFrame(frame);
  assert.strictEqual(result.kind, 'avl');
  if (result.kind === 'avl') {
    assert.strictEqual(result.crcOk, true);
    assert.strictEqual(result.consumed, frame.length);
  }
});

test('Framing detecta CRC inválido', () => {
  const data = Buffer.from(sampleRecordHex, 'hex');
  const frame = buildAvlPacket(data);
  frame[frame.length - 1] ^= 0xff; // corromper CRC
  const parser = new TeltonikaParser();
  const result = parser.parseAvlFrame(frame);
  assert.strictEqual(result.kind, 'avl');
  if (result.kind === 'avl') assert.strictEqual(result.crcOk, false);
});

test('Frame parcial devuelve incomplete', () => {
  const data = Buffer.from(sampleRecordHex, 'hex');
  const frame = buildAvlPacket(data).subarray(0, 10);
  const parser = new TeltonikaParser();
  assert.strictEqual(parser.parseAvlFrame(frame).kind, 'incomplete');
});

test('Normalización produce el modelo unificado', () => {
  const data = Buffer.from(sampleRecordHex, 'hex');
  const packet = new Codec8Decoder().decode(data);
  const t = normalizeTelemetry('356307042441013', 'FMC650', 'veh-001', packet.records[0]);
  assert.strictEqual(t.deviceType, 'FMC650');
  assert.strictEqual(t.imei, '356307042441013');
  assert.strictEqual(t.vehicleId, 'veh-001');
  assert.ok(t.timestamp.endsWith('Z'));
  assert.ok('io' in t && 'raw' in t && 'gps' in t);
});

console.log(`\n${passed} tests OK`);
