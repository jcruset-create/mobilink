import crypto from "crypto";

/**
 * Hasheo de credenciales cortas (PIN de operario, contraseña de usuario de app).
 *
 * El algoritmo es el que ya usaba Connect Lite (`server/connect/lite.ts`):
 * PBKDF2-SHA256, 60.000 iteraciones, 32 bytes, con salt aleatorio por credencial.
 * Se extrae aquí para que todos los subsistemas compartan una única implementación.
 */

const PBKDF2_ITERATIONS = 60_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

export function newSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function hashSecret(secret: string, salt: string): string {
  return crypto
    .pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString("hex");
}

/** Comparación en tiempo constante: no filtra cuántos caracteres coinciden. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Verifica una credencial contra su hash+salt almacenados. */
export function verifySecret(secret: string, hash: string | null, salt: string | null): boolean {
  if (!secret || !hash || !salt) return false;
  return safeEquals(hashSecret(secret, salt), hash);
}

/**
 * Resultado de comprobar una credencial que puede estar todavía en claro
 * (dato heredado) o ya hasheada.
 *
 * `needsUpgrade` indica que la credencial era correcta pero estaba en claro:
 * quien llama debe re-guardarla hasheada. Así los datos antiguos se migran
 * solos según cada usuario va entrando, sin cortar el acceso a nadie.
 */
export type CredentialCheck = { ok: boolean; needsUpgrade: boolean };

export function verifySecretWithLegacy(
  secret: string,
  hash: string | null,
  salt: string | null,
  legacyPlaintext: string | null
): CredentialCheck {
  if (!secret) return { ok: false, needsUpgrade: false };
  if (hash && salt) {
    return { ok: verifySecret(secret, hash, salt), needsUpgrade: false };
  }
  if (legacyPlaintext) {
    return { ok: safeEquals(secret, legacyPlaintext), needsUpgrade: safeEquals(secret, legacyPlaintext) };
  }
  return { ok: false, needsUpgrade: false };
}

/** Crea el par hash+salt para guardar una credencial nueva. */
export function makeSecret(secret: string): { hash: string; salt: string } {
  const salt = newSalt();
  return { hash: hashSecret(secret, salt), salt };
}
