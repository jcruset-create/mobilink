/**
 * Base de conector técnico con SIMULACIÓN determinista.
 *
 * Autodata y TecDoc comparten esta base: cuando no hay credenciales configuradas,
 * devuelven datos técnicos plausibles y estables (derivados del identificador, no
 * aleatorios) para poder desarrollar y demostrar la Fase 2 sin un proveedor real.
 * Cada implementación concreta sobreescribe `callReal*` cuando se conecte de verdad.
 */

import type { ITechnicalConnector, ConnectorInfo } from "../../domain/connectors.ts";
import type { OperationContext } from "../../domain/identifiers.ts";
import type {
  VehicleQuery,
  VehicleIdentification,
  TechnicalSpecifications,
  CompatiblePart,
  RepairTime,
  MaintenancePlan,
  TyreSpecification,
} from "../../domain/technical.ts";

/** Hash estable (no aleatorio) para simulación reproducible. */
function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

const MAKES = ["Volvo", "Scania", "MAN", "Mercedes-Benz", "Renault", "Iveco", "DAF"];
const FUELS = ["Diésel", "Gasolina", "Híbrido", "Eléctrico"];

export abstract class SimulatedTechnicalConnector implements ITechnicalConnector {
  abstract readonly info: ConnectorInfo;

  /** Las subclases indican si tienen config real; por defecto, siempre simulación. */
  protected async useSimulation(_ctx: OperationContext): Promise<boolean> {
    return true;
  }

  async testConnection(ctx: OperationContext): Promise<{ ok: boolean; message: string }> {
    if (await this.useSimulation(ctx)) {
      return { ok: true, message: `Modo simulación (${this.info.displayName} no configurado)` };
    }
    return { ok: true, message: `Conexión con ${this.info.displayName} correcta` };
  }

  async identifyVehicle(ctx: OperationContext, query: VehicleQuery): Promise<VehicleIdentification[]> {
    if (await this.useSimulation(ctx)) return this.simIdentify(query);
    return this.realIdentify(ctx, query);
  }

  async getTechnicalSpecifications(ctx: OperationContext, vehicleRef: string): Promise<TechnicalSpecifications> {
    if (await this.useSimulation(ctx)) return this.simSpecs(vehicleRef);
    return this.realSpecs(ctx, vehicleRef);
  }

  async getCompatibleParts(ctx: OperationContext, vehicleRef: string, category?: string): Promise<CompatiblePart[]> {
    if (await this.useSimulation(ctx)) return this.simParts(vehicleRef, category);
    return this.realParts(ctx, vehicleRef, category);
  }

  async getOeReferences(ctx: OperationContext, partRef: string): Promise<string[]> {
    if (await this.useSimulation(ctx)) return this.simOe(partRef);
    return this.realOe(ctx, partRef);
  }

  async getRepairTimes(ctx: OperationContext, vehicleRef: string, operationCode?: string): Promise<RepairTime[]> {
    if (await this.useSimulation(ctx)) return this.simRepairTimes(vehicleRef, operationCode);
    return this.realRepairTimes(ctx, vehicleRef, operationCode);
  }

  async getMaintenancePlan(ctx: OperationContext, vehicleRef: string): Promise<MaintenancePlan> {
    if (await this.useSimulation(ctx)) return this.simMaintenance(vehicleRef);
    return this.realMaintenance(ctx, vehicleRef);
  }

  async getTyreSpecifications(ctx: OperationContext, vehicleRef: string): Promise<TyreSpecification[]> {
    if (await this.useSimulation(ctx)) return this.simTyres(vehicleRef);
    return this.realTyres(ctx, vehicleRef);
  }

  // ── Ganchos "reales": las subclases los implementan al integrar de verdad ──
  protected realIdentify(_ctx: OperationContext, _q: VehicleQuery): Promise<VehicleIdentification[]> {
    throw new Error(`${this.info.key}: identifyVehicle real no implementado`);
  }
  protected realSpecs(_ctx: OperationContext, _ref: string): Promise<TechnicalSpecifications> {
    throw new Error(`${this.info.key}: getTechnicalSpecifications real no implementado`);
  }
  protected realParts(_ctx: OperationContext, _ref: string, _cat?: string): Promise<CompatiblePart[]> {
    throw new Error(`${this.info.key}: getCompatibleParts real no implementado`);
  }
  protected realOe(_ctx: OperationContext, _partRef: string): Promise<string[]> {
    throw new Error(`${this.info.key}: getOeReferences real no implementado`);
  }
  protected realRepairTimes(_ctx: OperationContext, _ref: string, _op?: string): Promise<RepairTime[]> {
    throw new Error(`${this.info.key}: getRepairTimes real no implementado`);
  }
  protected realMaintenance(_ctx: OperationContext, _ref: string): Promise<MaintenancePlan> {
    throw new Error(`${this.info.key}: getMaintenancePlan real no implementado`);
  }
  protected realTyres(_ctx: OperationContext, _ref: string): Promise<TyreSpecification[]> {
    throw new Error(`${this.info.key}: getTyreSpecifications real no implementado`);
  }

  // ── Simulación determinista ───────────────────────────────────────────────
  /** Deriva un vehicleRef estable de la matrícula/VIN para encadenar consultas. */
  protected vehicleRefFrom(query: VehicleQuery): string {
    const seed = (query.vin || query.plate || "UNKNOWN").toUpperCase();
    return `VEH-${this.info.key.toUpperCase()}-${(hash(seed) % 1000000).toString().padStart(6, "0")}`;
  }

  private simIdentify(query: VehicleQuery): VehicleIdentification[] {
    if (!query.plate && !query.vin) return [];
    const seed = (query.vin || query.plate || "").toUpperCase();
    const h = hash(seed);
    return [
      {
        vehicleRef: this.vehicleRefFrom(query),
        vin: query.vin,
        plate: query.plate,
        make: MAKES[h % MAKES.length],
        model: `Serie ${((h >> 3) % 9) + 1}`,
        variant: `${((h >> 5) % 3) + 2}.${(h % 10)} TD`,
        year: 2012 + (h % 13),
        engineCode: `ENG-${(h % 9000 + 1000)}`,
        fuel: FUELS[h % FUELS.length],
        kw: 90 + (h % 260),
        cc: 1600 + (h % 5000),
        confidence: "high",
        source: this.info.key,
      },
    ];
  }

  private simSpecs(vehicleRef: string): TechnicalSpecifications {
    const h = hash(vehicleRef);
    return {
      vehicleRef,
      specs: [
        { group: "Frenos", name: "Par de apriete rueda", value: String(110 + (h % 90)), unit: "Nm" },
        { group: "Frenos", name: "Espesor mínimo disco delantero", value: String(22 + (h % 8)), unit: "mm" },
        { group: "Motor", name: "Capacidad aceite", value: (5 + (h % 30) / 10).toFixed(1), unit: "L" },
        { group: "Motor", name: "Intervalo cambio aceite", value: String(15000 + (h % 3) * 5000), unit: "km" },
        { group: "Neumáticos", name: "Presión eje delantero", value: (2.2 + (h % 8) / 10).toFixed(1), unit: "bar" },
      ],
    };
  }

  private simParts(vehicleRef: string, category?: string): CompatiblePart[] {
    const h = hash(vehicleRef + (category ?? ""));
    const cats = category
      ? [category]
      : ["Pastillas de freno", "Discos de freno", "Filtro de aceite", "Filtro de aire"];
    return cats.map((cat, i) => {
      const g = hash(vehicleRef + cat + i);
      return {
        partRef: `TD-${(g % 900000 + 100000)}`,
        name: `${cat} (calidad OES)`,
        category: cat,
        brand: ["Textar", "Bosch", "Mann", "Febi"][g % 4],
        manufacturerReference: `${["TEXTAR", "BOSCH", "MANN", "FEBI"][g % 4]}-${g % 90000}`,
        oeReferences: [String(34116859066n + BigInt(g % 1000)), String(30116859000n + BigInt(g % 500))],
        position: cat.includes("freno") ? (i % 2 ? "Eje trasero" : "Eje delantero") : undefined,
        quality: "OES",
        source: this.info.key,
      };
    });
  }

  private simOe(partRef: string): string[] {
    const h = hash(partRef);
    return [String(34116859066n + BigInt(h % 1000)), String(30116859000n + BigInt(h % 777))];
  }

  private simRepairTimes(vehicleRef: string, operationCode?: string): RepairTime[] {
    const base = [
      { operationCode: "BRK-FRONT-PADS", description: "Sustitución pastillas eje delantero" },
      { operationCode: "BRK-FRONT-DISCS", description: "Sustitución discos eje delantero" },
      { operationCode: "OIL-SERVICE", description: "Cambio de aceite y filtro" },
    ];
    const filtered = operationCode ? base.filter((b) => b.operationCode === operationCode) : base;
    return filtered.map((b) => {
      const g = hash(vehicleRef + b.operationCode);
      return { ...b, hours: Math.round((0.6 + (g % 30) / 10) * 10) / 10, source: this.info.key };
    });
  }

  private simMaintenance(vehicleRef: string): MaintenancePlan {
    const h = hash(vehicleRef);
    return {
      vehicleRef,
      items: [
        { intervalKm: 15000 + (h % 2) * 5000, intervalMonths: 12, operation: "Cambio aceite y filtro" },
        { intervalKm: 30000, intervalMonths: 24, operation: "Filtro de aire y habitáculo" },
        { intervalKm: 60000, intervalMonths: 48, operation: "Líquido de frenos" },
        { intervalKm: 120000, operation: "Correa de distribución", notes: "Según motorización" },
      ],
    };
  }

  private simTyres(vehicleRef: string): TyreSpecification[] {
    const h = hash(vehicleRef);
    const sizes = ["225/45 R17", "205/55 R16", "235/40 R18", "315/80 R22.5"];
    const size = sizes[h % sizes.length];
    return [
      { vehicleRef, axle: "front", size, loadIndex: "94", speedRating: "W", pressureBar: 2.3 + (h % 5) / 10 },
      { vehicleRef, axle: "rear", size, loadIndex: "94", speedRating: "W", pressureBar: 2.5 + (h % 5) / 10 },
    ];
  }
}
