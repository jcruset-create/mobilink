/**
 * Errores de integración. Distinguen fallos TRANSITORIOS (reintentar) de
 * PERMANENTES (revisión manual / fallo definitivo), lo que gobierna la máquina
 * de estados y el Queue Manager (§2.9).
 */

export type IntegrationErrorKind =
  | "TRANSIENT" // sistema externo caído, timeout, 5xx → reintentar
  | "VALIDATION" // datos de entrada inválidos → no reintentar
  | "MAPPING" // no se pudo mapear un código externo → revisión manual
  | "AUTH" // credenciales/permisos inválidos → revisión manual
  | "NOT_FOUND" // recurso inexistente en el sistema externo
  | "PERMANENT"; // otro error no recuperable

export class IntegrationError extends Error {
  readonly kind: IntegrationErrorKind;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(params: {
    kind: IntegrationErrorKind;
    code: string;
    message: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "IntegrationError";
    this.kind = params.kind;
    this.code = params.code;
    this.retryable = params.kind === "TRANSIENT";
    this.details = params.details;
  }

  static transient(code: string, message: string, details?: unknown) {
    return new IntegrationError({ kind: "TRANSIENT", code, message, details });
  }
  static validation(code: string, message: string, details?: unknown) {
    return new IntegrationError({ kind: "VALIDATION", code, message, details });
  }
  static mapping(code: string, message: string, details?: unknown) {
    return new IntegrationError({ kind: "MAPPING", code, message, details });
  }
  static auth(code: string, message: string, details?: unknown) {
    return new IntegrationError({ kind: "AUTH", code, message, details });
  }
  static notFound(code: string, message: string, details?: unknown) {
    return new IntegrationError({ kind: "NOT_FOUND", code, message, details });
  }
  static permanent(code: string, message: string, details?: unknown) {
    return new IntegrationError({ kind: "PERMANENT", code, message, details });
  }
}
