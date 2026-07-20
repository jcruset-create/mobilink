/** Errores tipados del hub para una gestión de reintentos coherente. */

export type ProviderErrorKind =
  | 'auth' // credenciales inválidas o token caducado no renovable -> no reintentar, marcar conexión
  | 'rate_limit' // esperar retryAfter y reintentar
  | 'transient' // red / 5xx -> reintento con backoff exponencial
  | 'permanent' // 4xx de datos -> registrar y saltar
  | 'unsupported'; // capacidad no soportada por el proveedor

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly retryAfterMs?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'transient';
  }
}
