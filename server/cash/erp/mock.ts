/**
 * Conector de ERP simulado.
 *
 * Existe para que Mobilink Cash se pueda desarrollar y probar entero antes de
 * decidir qué ERP se conecta, y para que las pruebas de integración puedan
 * provocar a voluntad lo que una ERP real hace de vez en cuando y siempre en el
 * peor momento: contestar 503, tardar demasiado, o decir que ese cobro ya lo
 * tenía registrado.
 *
 * No se usa en producción: `registry.ts` solo lo devuelve si está configurado
 * explícitamente como conector de la empresa.
 */

import {
  type DocumentoExterno,
  type ICashErpConnector,
  type InfoConector,
  type RespuestaErp,
  type ResultadoOperacionErp,
  ErrorErpPermanente,
  ErrorErpTemporal,
} from "./connector.ts";

export const SISTEMA_MOCK = "MOCK";

export type FalloSimulado = "NINGUNO" | "TEMPORAL" | "PERMANENTE" | "TIMEOUT";

export type OpcionesMock = {
  documentosACobrar?: DocumentoExterno[];
  documentosAPagar?: DocumentoExterno[];
  /** Qué debe hacer la próxima llamada de escritura. */
  fallo?: FalloSimulado;
  /**
   * Cuántas llamadas seguidas fallan antes de empezar a funcionar. Sirve para
   * probar que el reintento acaba llegando a buen puerto.
   */
  fallosAntesDeFuncionar?: number;
};

export class MockCashErpConnector implements ICashErpConnector {
  readonly info: InfoConector = {
    key: "mock",
    displayName: "ERP simulada (desarrollo)",
    capacidades: ["documentosACobrar", "documentosAPagar", "registrarCobro", "registrarPago", "anular"],
  };

  /** Claves ya registradas: es lo que hace idempotente al conector. */
  private readonly registradas = new Map<string, RespuestaErp>();
  private llamadasFallidas = 0;

  /** Llamadas recibidas, para que las pruebas puedan comprobarlas. */
  readonly recibidas: { metodo: string; operacionNumero: string }[] = [];

  constructor(private opciones: OpcionesMock = {}) {}

  configurar(opciones: OpcionesMock): void {
    this.opciones = { ...this.opciones, ...opciones };
    this.llamadasFallidas = 0;
  }

  async probarConexion(): Promise<{ ok: boolean; mensaje: string }> {
    if (this.opciones.fallo === "PERMANENTE") {
      return { ok: false, mensaje: "ERP simulada: fallo permanente configurado" };
    }
    return { ok: true, mensaje: "ERP simulada disponible" };
  }

  async documentosACobrar(): Promise<DocumentoExterno[]> {
    this.simularLectura();
    return this.opciones.documentosACobrar ?? [];
  }

  async documentosAPagar(): Promise<DocumentoExterno[]> {
    this.simularLectura();
    return this.opciones.documentosAPagar ?? [];
  }

  async obtenerDocumento(externalId: string): Promise<DocumentoExterno | null> {
    this.simularLectura();
    const todos = [
      ...(this.opciones.documentosACobrar ?? []),
      ...(this.opciones.documentosAPagar ?? []),
    ];
    return todos.find((d) => d.externalId === externalId) ?? null;
  }

  async registrarCobro(r: ResultadoOperacionErp): Promise<RespuestaErp> {
    return this.registrar("registrarCobro", r);
  }

  async registrarPago(r: ResultadoOperacionErp): Promise<RespuestaErp> {
    return this.registrar("registrarPago", r);
  }

  async anularCobro(operacionNumero: string, motivo: string): Promise<RespuestaErp> {
    this.recibidas.push({ metodo: "anularCobro", operacionNumero });
    this.simularEscritura();
    this.registradas.delete(operacionNumero);
    return { ok: true, referencia: `ANUL-${operacionNumero}`, mensaje: motivo };
  }

  async anularPago(operacionNumero: string, motivo: string): Promise<RespuestaErp> {
    this.recibidas.push({ metodo: "anularPago", operacionNumero });
    this.simularEscritura();
    this.registradas.delete(operacionNumero);
    return { ok: true, referencia: `ANUL-${operacionNumero}`, mensaje: motivo };
  }

  // ── Interioridades ──────────────────────────────────────────────────────

  private registrar(metodo: string, r: ResultadoOperacionErp): RespuestaErp {
    this.recibidas.push({ metodo, operacionNumero: r.operacionNumero });

    /*
     * La comprobación de duplicado va ANTES de simular el fallo a propósito:
     * reproduce el caso peligroso de verdad, el de la respuesta perdida. La ERP
     * ya contabilizó el cobro, pero el 503 se comió el acuse; cuando Mobilink
     * Cash reintenta, una ERP bien hecha responde "ya lo tenía" en vez de
     * apuntarlo dos veces.
     */
    const previa = this.registradas.get(r.operacionNumero);
    if (previa) return { ...previa, duplicado: true };

    this.simularEscritura();

    const respuesta: RespuestaErp = {
      ok: true,
      referencia: `${SISTEMA_MOCK}-${r.operacionNumero}`,
      mensaje: "Registrado en la ERP simulada",
    };
    this.registradas.set(r.operacionNumero, respuesta);
    return respuesta;
  }

  private simularLectura(): void {
    if (this.opciones.fallo === "PERMANENTE") {
      throw new ErrorErpPermanente("ERP simulada: documento no accesible");
    }
    if (this.opciones.fallo === "TEMPORAL" || this.opciones.fallo === "TIMEOUT") {
      throw new ErrorErpTemporal("ERP simulada: servicio no disponible");
    }
  }

  private simularEscritura(): void {
    const fallo = this.opciones.fallo ?? "NINGUNO";
    if (fallo === "NINGUNO") return;

    const tope = this.opciones.fallosAntesDeFuncionar;
    if (tope != null && this.llamadasFallidas >= tope) return;
    this.llamadasFallidas++;

    if (fallo === "PERMANENTE") {
      throw new ErrorErpPermanente("ERP simulada: la operación ha sido rechazada");
    }
    if (fallo === "TIMEOUT") {
      throw new ErrorErpTemporal("ERP simulada: tiempo de espera agotado");
    }
    throw new ErrorErpTemporal("ERP simulada: 503 Service Unavailable");
  }
}

/** Factura de cliente de ejemplo, la del encargo. */
export function facturaDemo(overrides: Partial<DocumentoExterno> = {}): DocumentoExterno {
  return {
    externalSystem: SISTEMA_MOCK,
    externalId: "F2026-00125",
    externalReference: "F2026-00125",
    tipo: "CUSTOMER_INVOICE",
    parteTipo: "CUSTOMER",
    parteExternalId: "CLI-ABC",
    parteNombre: "Cliente ABC SL",
    numero: "F2026-00125",
    fecha: "2026-08-15",
    vencimiento: "2026-09-15",
    totalCentimos: 18700,
    pendienteCentimos: 18700,
    moneda: "EUR",
    estadoErp: "OPEN",
    metadata: { matricula: "1234ABC" },
    ...overrides,
  };
}
