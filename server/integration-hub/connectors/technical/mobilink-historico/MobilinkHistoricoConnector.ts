/**
 * MobilinkHistoricoConnector — identificación de vehículo con los datos que Mobilink
 * ya tiene, sin pagar a ningún proveedor externo (Fase 2).
 *
 * Autodata y TecDoc requieren contrato y credenciales; hasta que existan, sus conectores
 * son simulación pura. Pero Mobilink lleva tiempo acumulando datos reales de vehículos en
 * sus propias tablas: asistencias en carretera (matrícula, marca, modelo, VIN, medida de
 * neumático) y órdenes de trabajo (matrícula, tipo de vehículo).
 *
 * Este conector explota ese histórico. No sustituye a una base técnica —no conoce tiempos
 * de reparación ni referencias OE— pero responde a la pregunta más frecuente del taller:
 * "esta matrícula, ¿qué vehículo es y qué sabemos ya de él?".
 *
 * Todo lo que no puede responder con datos propios lo delega en el comportamiento simulado
 * heredado, claramente marcado como tal para no confundir un dato real con uno inventado.
 */

import pool from "../../../../db.ts";
import type { ConnectorInfo } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import type { VehicleQuery, VehicleIdentification, TyreSpecification } from "../../../domain/technical.ts";
import { SimulatedTechnicalConnector } from "../SimulatedTechnicalConnector.ts";

export interface MobilinkHistoricoConfig {
  /** Antigüedad máxima de un registro para considerarlo, en días. 0 = sin límite. */
  maxAntiguedadDias?: number;
}

interface FilaHistorico {
  plate: string | null;
  marca: string | null;
  modelo: string | null;
  vin: string | null;
  tipoVehiculo: string | null;
  medidaNeumatico: string | null;
  descripcion: string | null;
  vistoMs: number | null;
}

/** Normaliza una matrícula para comparar: sin espacios, guiones ni minúsculas. */
export function normalizarMatricula(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export class MobilinkHistoricoConnector extends SimulatedTechnicalConnector {
  readonly info: ConnectorInfo = {
    key: "mobilink-historico",
    kind: "technical",
    displayName: "Histórico de Mobilink",
    capabilities: ["identifyVehicle", "getTyreSpecifications"],
  };

  constructor(private readonly config: MobilinkHistoricoConfig = {}) {
    super();
  }

  /**
   * Nunca simula la identificación: o encuentra el vehículo en datos propios, o devuelve
   * una lista vacía. Inventar un vehículo aquí sería peor que no responder.
   */
  protected async useSimulation(_ctx: OperationContext): Promise<boolean> {
    return false;
  }

  async testConnection(_ctx: OperationContext): Promise<{ ok: boolean; message: string }> {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM roadside_assistances WHERE plate <> ''`
      );
      return { ok: true, message: `Histórico disponible: ${rows[0]?.n ?? 0} asistencias con matrícula` };
    } catch (e: any) {
      return { ok: false, message: `No se pudo leer el histórico: ${e?.message ?? e}` };
    }
  }

  private get corteMs(): number | null {
    const dias = this.config.maxAntiguedadDias ?? 0;
    return dias > 0 ? Date.now() - dias * 24 * 60 * 60 * 1000 : null;
  }

  /** Filas del histórico que casan con la matrícula o el VIN, de más reciente a más antigua. */
  private async buscarHistorico(query: VehicleQuery): Promise<FilaHistorico[]> {
    const plate = query.plate ? normalizarMatricula(query.plate) : null;
    const vin = query.vin ? query.vin.toUpperCase().trim() : null;

    // La normalización se hace también en SQL para que casen matrículas guardadas
    // con espacios o guiones ("1234-ABC" y "1234 ABC" son la misma).
    const normSql = `UPPER(REGEXP_REPLACE(COALESCE(a.plate,''), '[^A-Za-z0-9]', '', 'g'))`;

    const { rows } = await pool.query<FilaHistorico>(
      `SELECT a.plate,
              b.marca, b.modelo, b.vin, b."tipoVehiculo", b."medidaNeumatico",
              a."vehicleDescription" AS descripcion,
              GREATEST(COALESCE(a."updatedAtMs",0), COALESCE(a."createdAtMs",0)) AS "vistoMs"
         FROM roadside_assistances a
         LEFT JOIN roadside_backoffice b ON b."assistanceId" = a.id
        WHERE ($1::text IS NOT NULL AND ${normSql} = $1)
           OR ($2::text IS NOT NULL AND UPPER(COALESCE(b.vin,'')) = $2)
        ORDER BY "vistoMs" DESC
        LIMIT 50`,
      [plate, vin]
    );

    const corte = this.corteMs;
    return corte ? rows.filter((r) => (r.vistoMs ?? 0) >= corte) : rows;
  }

  /** Complementa con las OT, que aportan tipo de vehículo aunque no marca ni modelo. */
  private async buscarEnOrdenes(plate: string): Promise<{ tipoVehiculo: string | null; vistoMs: number } | null> {
    const { rows } = await pool.query(
      `SELECT t."tipoVehiculo", t."updatedAtMs" AS "vistoMs"
         FROM otf_trabajos t
        WHERE UPPER(REGEXP_REPLACE(COALESCE(t.plate,''), '[^A-Za-z0-9]', '', 'g')) = $1
        ORDER BY t."updatedAtMs" DESC
        LIMIT 1`,
      [plate]
    );
    return rows[0] ?? null;
  }

  async identifyVehicle(_ctx: OperationContext, query: VehicleQuery): Promise<VehicleIdentification[]> {
    const filas = await this.buscarHistorico(query);
    const plateNorm = query.plate ? normalizarMatricula(query.plate) : null;

    // Se consolida en un único vehículo: el dato más reciente de cada campo gana, pero
    // un campo vacío no pisa a uno relleno de una asistencia anterior.
    const consolidado: FilaHistorico = {
      plate: query.plate ?? null,
      marca: null,
      modelo: null,
      vin: query.vin ?? null,
      tipoVehiculo: null,
      medidaNeumatico: null,
      descripcion: null,
      vistoMs: null,
    };
    for (const f of filas) {
      consolidado.plate ??= f.plate;
      consolidado.marca ??= f.marca;
      consolidado.modelo ??= f.modelo;
      consolidado.vin ??= f.vin;
      consolidado.tipoVehiculo ??= f.tipoVehiculo;
      consolidado.medidaNeumatico ??= f.medidaNeumatico;
      consolidado.descripcion ??= f.descripcion;
      consolidado.vistoMs ??= f.vistoMs;
    }

    if (filas.length === 0 && plateNorm) {
      const ot = await this.buscarEnOrdenes(plateNorm);
      if (!ot) return [];
      consolidado.tipoVehiculo = ot.tipoVehiculo;
      consolidado.vistoMs = ot.vistoMs;
    }

    if (!consolidado.marca && !consolidado.modelo && !consolidado.vin && !consolidado.tipoVehiculo) {
      return [];
    }

    // La confianza refleja qué tenemos, no cuántas veces lo hemos visto: con VIN o con
    // marca+modelo la identificación es sólida; con sólo el tipo de vehículo, es orientativa.
    const confidence: VehicleIdentification["confidence"] = consolidado.vin
      ? "high"
      : consolidado.marca && consolidado.modelo
        ? "medium"
        : "low";

    return [
      {
        vehicleRef: `MOBILINK:${plateNorm ?? consolidado.vin ?? "?"}`,
        plate: consolidado.plate ?? undefined,
        vin: consolidado.vin ?? undefined,
        make: consolidado.marca ?? undefined,
        model: consolidado.modelo ?? undefined,
        variant: consolidado.tipoVehiculo ?? consolidado.descripcion ?? undefined,
        confidence,
        source: this.info.key,
      },
    ];
  }

  /**
   * Medida de neumático vista en el histórico del vehículo.
   *
   * Es un dato OBSERVADO en asistencias anteriores, no la especificación del fabricante:
   * por eso no se inventa el eje ni la presión, que aquí no se conocen. Si no hay medida
   * registrada devuelve lista vacía en lugar de un valor plausible.
   */
  async getTyreSpecifications(_ctx: OperationContext, vehicleRef: string): Promise<TyreSpecification[]> {
    const plate = vehicleRef.startsWith("MOBILINK:") ? vehicleRef.slice("MOBILINK:".length) : vehicleRef;
    const filas = await this.buscarHistorico({ plate });
    const medida = filas.find((f) => f.medidaNeumatico)?.medidaNeumatico;
    if (!medida) return [];

    return [
      { vehicleRef, axle: "front", size: medida },
      { vehicleRef, axle: "rear", size: medida },
    ];
  }
}
