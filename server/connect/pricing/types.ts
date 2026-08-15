/**
 * Contrato del motor de tarifas: lo que entra, lo que sale y cómo se avisa
 * de lo que no ha podido calcularse.
 *
 * Está aparte del motor porque lo consumen también el repositorio, la API y el
 * panel, y porque poner los tipos donde vive la lógica invita a que la lógica
 * se cuele en quien solo quería un tipo.
 */

import type { Dinero } from "./money.ts";
import type { ReglaTarifa } from "./rules.ts";

export const VERSION_MOTOR = "1.0.0";

/**
 * Códigos de aviso. Ninguno se traduce nunca en un precio cero: o el importe
 * sale bien, o sale nulo con su motivo. Un cero es un dato, y un dato falso es
 * peor que la ausencia de dato.
 */
export type CodigoAviso =
  | "NO_TARIFF_PLAN"            // el contrato no lleva a ninguna versión vigente
  | "NO_MATCHING_RULE"          // ninguna regla encaja con el caso
  | "AMBIGUOUS_RULES"           // dos reglas empatan: error de configuración
  | "TIRE_PRICE_NOT_FOUND"
  | "AMBIGUOUS_TIRE_PRICE"      // dos precios de neumático empatan
  | "MANUFACTURER_LIST_NOT_FOUND" // descuento sobre baremo sin baremo vigente
  | "ZONE_NOT_RESOLVED"
  | "HOLIDAY_SCOPE_UNKNOWN"     // festivo local sin saber el municipio
  | "DISTANCE_NOT_AVAILABLE"
  | "DURATION_NOT_AVAILABLE"
  | "PURCHASE_TARIFF_NOT_FOUND" // hay venta pero no compra: margen indeterminado
  | "SALE_TARIFF_NOT_FOUND"
  | "FORMULA_NOT_SUPPORTED"
  | "EXTRA_AMOUNT_MISSING"
  | "EXTRA_PERCENTAGE_MISSING"
  | "EXTRA_BASE_MISSING"
  | "MANUAL_OVERRIDE"
  | "WORKSHOP_HOLIDAY";        // el taller está de festivo: su compra sube

export interface Aviso {
  codigo: CodigoAviso;
  /** 'sale' | 'purchase' | null si afecta a las dos partes. */
  lado?: "sale" | "purchase" | null;
  detalle?: string;
}

export type EtapaTarifa = "estimate" | "locked" | "final";

/**
 * `manual_review` significa que falta algo esencial y nadie debería facturar
 * esto sin mirarlo. `partial` es que el precio está pero incompleto: por
 * ejemplo, venta sí y compra no.
 */
export type EstadoTarifa = "ok" | "partial" | "manual_review";

export type TipoLinea =
  | "FORFAIT" | "EXTRA_KM" | "EXTRA_TIME" | "TIRE" | "ADDITIONAL_TIRE"
  | "MATERIAL" | "CANCELLATION" | "ADMIN_FEE" | "TOLL" | "OTHER";

/** Neumáticos, materiales y suplementos que se añaden al cerrar el servicio. */
export interface ConceptoServicio {
  tipo: TipoLinea;
  /** Código del extra del tarifario, si viene de uno. */
  extraCode?: string | null;
  descripcion?: string | null;
  cantidad?: number;
  /** Datos del neumático, cuando el tipo es TIRE o ADDITIONAL_TIRE. */
  neumatico?: { medida: string; marca?: string | null; posicion?: string | null } | null;
}

export interface ContextoTarifa {
  assistanceId: number;
  controlCenterId: number;
  clientId: number | null;
  workshopId: number | null;
  providerCompanyId: number | null;

  serviceTypeCode: string;
  vehicleTypeCode: string;

  /** Instante contractual: la orden de salida, no la llegada del técnico. */
  atMs: number;
  /** Zona horaria en la que se leen las franjas y los festivos. */
  timezone: string;

  lugar: { regionCode?: string | null; provinceCode?: string | null; municipality?: string | null };
  zoneIds: number[];

  distanceKm: number | null;
  /** De dónde sale la distancia: importa para poder explicarla después. */
  distanceSource: "estimated" | "routed" | null;
  durationMin: number | null;

  conceptos?: ConceptoServicio[];
  /** Se anuló el servicio después de dar la orden de salida. */
  cancelado?: boolean;

  /**
   * Festivos DEL TALLER que atiende, que no son los del servicio.
   *
   * La central trabaja 365 días 24 horas y le cobra a su cliente según el
   * calendario del contrato. El taller no: si en su pueblo es fiesta local, ese
   * día trabaja en festivo y lo factura como tal. Son dos cosas distintas y por
   * eso estas clases se aplican SOLO al lado de compra: lo que paga el cliente
   * no depende de dónde tenga el taller su ayuntamiento.
   */
  clasesDiaTaller?: string[];
}

/** Lo que se ha resuelto en un lado (compra o venta). */
export interface LadoResuelto {
  contractId: number;
  tariffPlanId: number;
  tariffPlanName: string;
  tariffVersionId: number;
  version: string;
  regla: ReglaTarifa | null;
  currency: string;
}

export interface LineaPrecio {
  numero: number;
  tipo: TipoLinea;
  conceptCode: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  compraUnitaria: Dinero | null;
  ventaUnitaria: Dinero | null;
  compraTotal: Dinero | null;
  ventaTotal: Dinero | null;
  saleRuleId: number | null;
  purchaseRuleId: number | null;
  extraId: number | null;
  metadata: Record<string, unknown>;
}

/** Lo que se le enseña al operador cuando pregunta por qué cuesta eso. */
export interface ExplicacionTarifa {
  tarifario: string | null;
  version: string | null;
  regla: string | null;
  fechaLocal: string;
  horaLocal: string;
  zonaHoraria: string;
  franja: string | null;
  tipoDia: string;
  zona: string | null;
  distanciaKm: number | null;
  origenDistancia: string | null;
  distanciaIncluidaKm: number | null;
  tiempoIncluidoMin: number | null;
  /** Reglas que no se aplicaron y por qué. */
  descartes: string[];
}

export interface ResultadoTarifa {
  etapa: EtapaTarifa;
  estado: EstadoTarifa;
  currency: string;

  /** null = DESCONOCIDO. Nunca cero para decir "no lo sé". */
  compraTotal: Dinero | null;
  ventaTotal: Dinero | null;
  margen: Dinero | null;
  margenPct: Dinero | null;

  venta: LadoResuelto | null;
  compra: LadoResuelto | null;

  lineas: LineaPrecio[];
  avisos: Aviso[];
  explicacion: ExplicacionTarifa;

  engineVersion: string;
  pricingRequestId: string;
}
