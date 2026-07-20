import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Cifrado AES-256-GCM de credenciales de proveedores en reposo.
 * La clave se deriva de FIH_ENCRYPTION_KEY (obligatoria en producción).
 */
function key(): Buffer {
  const secret = process.env.FIH_ENCRYPTION_KEY ?? 'dev-only-insecure-key';
  return createHash('sha256').update(secret).digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptJson<T>(payload: string): T {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8')) as T;
}
