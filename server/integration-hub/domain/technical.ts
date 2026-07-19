/**
 * Modelo NORMALIZADO de datos técnicos (Technical Data Hub, §2.3 / Fase 2).
 *
 * Cualquier conector (Autodata, TecDoc, catálogos de fabricante, VIN, matrícula...)
 * traduce su respuesta a estos tipos. Los módulos de Mobilink sólo conocen esto.
 */

/** Consulta de identificación de vehículo (por matrícula o VIN). */
export interface VehicleQuery {
  plate?: string;
  vin?: string;
  country?: string;
}

/** Vehículo identificado y normalizado. */
export interface VehicleIdentification {
  /** Id técnico estable del vehículo en el sistema externo (para consultas posteriores). */
  vehicleRef: string;
  vin?: string;
  plate?: string;
  make?: string;
  model?: string;
  variant?: string;
  year?: number;
  engineCode?: string;
  fuel?: string;
  kw?: number;
  cc?: number;
  /** Confianza de la identificación (varias coincidencias posibles). */
  confidence: "high" | "medium" | "low";
  source: string;
}

/** Especificaciones técnicas / medidas de servicio. */
export interface TechnicalSpecifications {
  vehicleRef: string;
  specs: TechnicalSpecItem[];
}

export interface TechnicalSpecItem {
  group: string; // p. ej. "Frenos", "Motor", "Neumáticos"
  name: string; // p. ej. "Par de apriete rueda"
  value: string;
  unit?: string;
}

/** Recambio compatible con el vehículo. */
export interface CompatiblePart {
  /** Referencia del artículo en el sistema técnico (p. ej. código TecDoc). */
  partRef: string;
  name: string;
  category: string; // p. ej. "Pastillas de freno"
  brand?: string;
  manufacturerReference?: string;
  oeReferences: string[];
  position?: string; // "Eje delantero", "Eje trasero"...
  quality?: "OEM" | "OES" | "aftermarket";
  source: string;
}

/** Tiempo de reparación (baremo). */
export interface RepairTime {
  operationCode: string;
  description: string;
  /** Horas de baremo. */
  hours: number;
  source: string;
}

/** Elemento de un plan de mantenimiento. */
export interface MaintenancePlanItem {
  intervalKm?: number;
  intervalMonths?: number;
  operation: string;
  notes?: string;
}

export interface MaintenancePlan {
  vehicleRef: string;
  items: MaintenancePlanItem[];
}

/** Especificación de neumático. */
export interface TyreSpecification {
  vehicleRef: string;
  axle: "front" | "rear";
  size: string; // p. ej. "225/45 R17"
  loadIndex?: string;
  speedRating?: string;
  pressureBar?: number;
}
