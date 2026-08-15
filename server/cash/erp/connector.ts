/**
 * Contrato de integración con una ERP externa.
 *
 * Mobilink Cash no conoce ninguna ERP. Conoce este contrato, y trabaja siempre
 * con el modelo normalizado de `DocumentoExterno`: da igual que detrás haya
 * Business Central, Sage, A3 u Odoo. Escribir un conector nuevo no obliga a
 * tocar ni una línea del motor de caja.
 *
 * Sigue el mismo patrón que `server/integration-hub/domain/connectors.ts`, que
 * ya define `Connector` con su `info` y su `testConnection`: se reutiliza la
 * idea (y el vocabulario) en vez de inventar otra forma de hacer lo mismo.
 *
 * Las credenciales viven DENTRO del conector, leídas de variables de entorno.
 * No entran en la base de datos, no se devuelven por la API y no llegan jamás
 * al navegador.
 */

import type { Centimos } from "../domain/money.ts";
import type { FormaPago } from "../domain/operations.ts";

export type TipoDocumento =
  | "CUSTOMER_INVOICE"
  | "SUPPLIER_INVOICE"
  | "RECEIPT"
  | "CREDIT_NOTE"
  | "PAYMENT_ORDER"
  | "OTHER";

export type TipoParte = "CUSTOMER" | "SUPPLIER" | "OTHER";

/**
 * Documento económico normalizado.
 *
 * `externalSystem` + `externalId` es la clave que evita duplicados. Un número
 * de factura NO es único entre sistemas distintos, y dos ERPs pueden emitir
 * ambas una "F2026-00125".
 */
export type DocumentoExterno = {
  externalSystem: string;
  externalId: string;
  externalReference?: string | null;
  tipo: TipoDocumento;
  parteTipo: TipoParte;
  parteExternalId?: string | null;
  parteNombre: string;
  numero: string;
  fecha?: string | null;
  vencimiento?: string | null;
  totalCentimos: Centimos;
  pendienteCentimos: Centimos;
  moneda: string;
  /** Estado tal y como lo reporta la ERP, sin traducir. */
  estadoErp?: string | null;
  /** Lo que no encaja en el modelo: matrícula, nº de OT, centro de coste… */
  metadata?: Record<string, unknown> | null;
};

export type LineaCobroErp = {
  forma: FormaPago;
  importeCentimos: Centimos;
  referencia?: string | null;
};

/** Lo que se comunica a la ERP cuando un cobro o un pago se ha ejecutado. */
export type ResultadoOperacionErp = {
  externalSystem: string;
  externalDocumentId: string;
  /** Número de Mobilink Cash. Es también la clave de idempotencia. */
  operacionNumero: string;
  importeCentimos: Centimos;
  fechaIso: string;
  formasPago: LineaCobroErp[];
  observaciones?: string | null;
};

export type RespuestaErp = {
  ok: boolean;
  /** Referencia que devuelve la ERP (nº de asiento, de recibo…). */
  referencia?: string | null;
  mensaje?: string;
  /** La ERP ya tenía registrada esta clave: no es un fallo, es idempotencia. */
  duplicado?: boolean;
};

export class ErrorErpTemporal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorErpTemporal";
  }
}

export class ErrorErpPermanente extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorErpPermanente";
  }
}

export type InfoConector = {
  key: string;
  displayName: string;
  /** Qué sabe hacer de verdad esta versión, para el panel de integración. */
  capacidades: string[];
};

/**
 * Contrato que cumple cualquier conector de ERP para Mobilink Cash.
 *
 * Todos los métodos son opcionales salvo `info` y `probarConexion`: una ERP que
 * solo sepa dar facturas de cliente es un conector perfectamente válido, y el
 * panel enseña qué capacidades tiene.
 */
export interface ICashErpConnector {
  readonly info: InfoConector;

  probarConexion(): Promise<{ ok: boolean; mensaje: string }>;

  /** Documentos pendientes de cobrar (facturas de cliente, recibos). */
  documentosACobrar?(): Promise<DocumentoExterno[]>;

  /** Documentos pendientes de pagar (facturas de proveedor). */
  documentosAPagar?(): Promise<DocumentoExterno[]>;

  obtenerDocumento?(externalId: string): Promise<DocumentoExterno | null>;

  /**
   * Comunica un cobro ejecutado. Debe ser idempotente respecto a
   * `operacionNumero`: un reintento no puede contabilizar el cobro dos veces.
   */
  registrarCobro?(r: ResultadoOperacionErp): Promise<RespuestaErp>;

  registrarPago?(r: ResultadoOperacionErp): Promise<RespuestaErp>;

  anularCobro?(operacionNumero: string, motivo: string): Promise<RespuestaErp>;

  anularPago?(operacionNumero: string, motivo: string): Promise<RespuestaErp>;
}
