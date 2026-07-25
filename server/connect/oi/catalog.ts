/**
 * Centro de Inteligencia Operacional — catálogo de KPIs.
 *
 * Cada KPI declara cómo se lee (unidad, dirección), su objetivo por defecto y
 * los umbrales del semáforo. El cálculo vive en kpi.ts; aquí solo la
 * definición funcional, que es lo que se siembra en operational_kpi_definition
 * y lo que un cc_admin puede reconfigurar por centro de control.
 *
 * `available: false` marca los KPIs del diseño funcional que HOY no pueden
 * calcularse con los datos existentes (no hay encuestas de satisfacción,
 * odómetro ni identidad de conductor en Connect). Se publican igualmente con
 * semáforo gris y el motivo, que es justo el inventario de datos ausentes que
 * pide el análisis previo, en lugar de inventar cifras.
 */

export type KpiCategory = "operational" | "provider" | "fleet" | "driver" | "economic" | "quality";
export type KpiDirection = "up_good" | "down_good";

export interface KpiDefinition {
  code: string;
  name: string;
  description: string;
  category: KpiCategory;
  formula: string;
  unit: string;
  direction: KpiDirection;
  targetValue?: number;
  /** Desviación respecto al objetivo a partir de la cual el semáforo pasa a ámbar (fracción). */
  warningThreshold?: number;
  /** Desviación a partir de la cual pasa a rojo (fracción). */
  criticalThreshold?: number;
  /** false = sin fuente de datos todavía (semáforo gris + motivo). */
  available?: boolean;
  missingData?: string;
}

const A = (k: KpiDefinition): KpiDefinition => ({ available: true, ...k });

export const KPI_CATALOG: KpiDefinition[] = [
  // ── Panel principal / operacionales ──────────────────────────────────────
  A({
    code: "services_received", name: "Servicios recibidos", category: "operational",
    description: "Asistencias creadas en el periodo (excluye borradores).",
    formula: "COUNT(asistencias creadas en el periodo)", unit: "servicios", direction: "up_good",
  }),
  A({
    code: "services_pending", name: "Pendientes de asignación", category: "operational",
    description: "Asistencias en estado pendiente o buscando proveedor.",
    formula: "COUNT(status IN pending, searching)", unit: "servicios", direction: "down_good",
    targetValue: 3, warningThreshold: 0.5, criticalThreshold: 1.5,
  }),
  A({
    code: "services_assigned", name: "Asignados", category: "operational",
    description: "Asistencias con proveedor asignado o técnico asignado.",
    formula: "COUNT(status IN assigned, technician_assigned, awaiting_acceptance)", unit: "servicios", direction: "up_good",
  }),
  A({
    code: "services_en_route", name: "En desplazamiento", category: "operational",
    description: "Unidades en camino hacia el punto de asistencia.",
    formula: "COUNT(status = en_route)", unit: "servicios", direction: "up_good",
  }),
  A({
    code: "services_in_progress", name: "En ejecución", category: "operational",
    description: "Asistencias en el punto o en intervención.",
    formula: "COUNT(status IN arrived, in_progress)", unit: "servicios", direction: "up_good",
  }),
  A({
    code: "services_finished", name: "Finalizados", category: "operational",
    description: "Asistencias finalizadas en el periodo.",
    formula: "COUNT(status = finished)", unit: "servicios", direction: "up_good",
  }),
  A({
    code: "services_cancelled", name: "Cancelados", category: "operational",
    description: "Asistencias canceladas en el periodo.",
    formula: "COUNT(status = cancelled)", unit: "servicios", direction: "down_good",
  }),
  A({
    code: "services_delayed", name: "Con retraso", category: "operational",
    description: "Asistencias activas cuyo límite de SLA ya se ha superado sin llegada.",
    formula: "COUNT(activas con slaDeadline < ahora y sin llegada)", unit: "servicios", direction: "down_good",
    targetValue: 0, warningThreshold: 1, criticalThreshold: 3,
  }),
  A({
    code: "avg_assignment_min", name: "Tiempo medio de asignación", category: "operational",
    description: "Minutos desde la recepción de la asistencia hasta su asignación a un proveedor.",
    formula: "AVG(assigned_at − created_at)", unit: "min", direction: "down_good",
    targetValue: 10, warningThreshold: 0.3, criticalThreshold: 0.8,
  }),
  A({
    code: "avg_acceptance_min", name: "Tiempo medio de aceptación", category: "operational",
    description: "Minutos desde el envío de la oferta hasta la aceptación del proveedor.",
    formula: "AVG(respondedAt − sentAt) sobre ofertas aceptadas", unit: "min", direction: "down_good",
    targetValue: 8, warningThreshold: 0.3, criticalThreshold: 0.8,
  }),
  A({
    code: "avg_departure_min", name: "Tiempo medio hasta la salida", category: "operational",
    description: "Minutos desde la aceptación hasta que la unidad inicia el desplazamiento.",
    formula: "AVG(en_route_at − assigned_at)", unit: "min", direction: "down_good",
    targetValue: 10, warningThreshold: 0.4, criticalThreshold: 1,
  }),
  A({
    code: "avg_travel_min", name: "Tiempo medio de desplazamiento", category: "operational",
    description: "Minutos desde el inicio del desplazamiento hasta la llegada al punto.",
    formula: "AVG(arrived_at − en_route_at)", unit: "min", direction: "down_good",
    targetValue: 30, warningThreshold: 0.3, criticalThreshold: 0.7,
  }),
  A({
    code: "avg_arrival_min", name: "Tiempo medio real de llegada", category: "operational",
    description: "Minutos desde la recepción de la asistencia hasta la llegada real al punto.",
    formula: "AVG(arrived_at − created_at)", unit: "min", direction: "down_good",
    targetValue: 45, warningThreshold: 0.25, criticalThreshold: 0.6,
  }),
  A({
    code: "avg_intervention_min", name: "Tiempo medio de intervención", category: "operational",
    description: "Minutos entre la llegada al punto y la finalización del servicio.",
    formula: "AVG(finished_at − arrived_at)", unit: "min", direction: "down_good",
    targetValue: 45, warningThreshold: 0.4, criticalThreshold: 1,
  }),
  A({
    code: "avg_resolution_min", name: "Tiempo medio de resolución", category: "operational",
    description: "Minutos totales del servicio, de la recepción a la finalización.",
    formula: "AVG(finished_at − created_at)", unit: "min", direction: "down_good",
    targetValue: 90, warningThreshold: 0.3, criticalThreshold: 0.7,
  }),
  A({
    code: "eta_predicted_min", name: "ETA medio previsto", category: "operational",
    description: "Media del ETA comunicado por el modelo en las asistencias del periodo.",
    formula: "AVG(ai_prediction.predictedValue de tipo eta)", unit: "min", direction: "down_good",
    targetValue: 40, warningThreshold: 0.25, criticalThreshold: 0.6,
  }),
  A({
    code: "sla_compliance_pct", name: "Cumplimiento de SLA", category: "operational",
    description: "Porcentaje de asistencias con SLA definido que llegaron antes del límite.",
    formula: "llegadas dentro de plazo / asistencias con SLA × 100", unit: "%", direction: "up_good",
    targetValue: 95, warningThreshold: 0.05, criticalThreshold: 0.15,
  }),
  A({
    code: "reassigned_pct", name: "Servicios reasignados", category: "operational",
    description: "Porcentaje de asistencias que necesitaron más de una asignación.",
    formula: "asistencias con ≥2 asignaciones / total × 100", unit: "%", direction: "down_good",
    targetValue: 5, warningThreshold: 0.6, criticalThreshold: 1.4,
  }),
  A({
    code: "cancelled_pct", name: "Servicios cancelados", category: "operational",
    description: "Porcentaje de cancelaciones sobre el total del periodo.",
    formula: "cancelladas / total × 100", unit: "%", direction: "down_good",
    targetValue: 5, warningThreshold: 0.6, criticalThreshold: 1.4,
  }),
  A({
    code: "no_gps_pct", name: "Servicios sin GPS", category: "operational",
    description: "Porcentaje de asistencias activas cuya unidad no reporta posición reciente.",
    formula: "activas con unidad sin reporte en 15 min / activas con unidad × 100", unit: "%", direction: "down_good",
    targetValue: 5, warningThreshold: 1, criticalThreshold: 3,
  }),
  A({
    code: "out_of_sla_pct", name: "Servicios fuera de SLA", category: "operational",
    description: "Porcentaje de asistencias con SLA que se incumplió.",
    formula: "100 − cumplimiento de SLA", unit: "%", direction: "down_good",
    targetValue: 5, warningThreshold: 1, criticalThreshold: 3,
  }),
  A({
    code: "fleet_availability_pct", name: "Disponibilidad de flota", category: "fleet",
    description: "Porcentaje de unidades móviles en estado disponible o en base.",
    formula: "unidades disponibles / unidades totales × 100", unit: "%", direction: "up_good",
    targetValue: 40, warningThreshold: 0.3, criticalThreshold: 0.6,
  }),

  // ── Proveedores ──────────────────────────────────────────────────────────
  A({
    code: "provider_services", name: "Servicios por proveedor", category: "provider",
    description: "Asistencias finalizadas por taller en el periodo.",
    formula: "COUNT(finalizadas agrupadas por taller)", unit: "servicios", direction: "up_good",
  }),
  A({
    code: "provider_acceptance_pct", name: "Tasa de aceptación", category: "provider",
    description: "Ofertas aceptadas sobre ofertas enviadas.",
    formula: "aceptadas / (aceptadas + rechazadas + expiradas) × 100", unit: "%", direction: "up_good",
    targetValue: 85, warningThreshold: 0.1, criticalThreshold: 0.25,
  }),
  A({
    code: "provider_rejection_pct", name: "Tasa de rechazo", category: "provider",
    description: "Ofertas rechazadas o expiradas sobre el total ofertado.",
    formula: "(rechazadas + expiradas) / ofertadas × 100", unit: "%", direction: "down_good",
    targetValue: 15, warningThreshold: 0.6, criticalThreshold: 1.5,
  }),
  A({
    code: "provider_eta_accuracy_pct", name: "Cumplimiento del ETA", category: "provider",
    description: "Porcentaje de llegadas dentro del ETA comunicado (margen +10 min).",
    formula: "llegadas ≤ ETA+10 min / asistencias con ETA × 100", unit: "%", direction: "up_good",
    targetValue: 85, warningThreshold: 0.1, criticalThreshold: 0.3,
  }),
  A({
    code: "provider_incidents", name: "Incidencias por proveedor", category: "provider",
    description: "Incidencias abiertas contra el proveedor en el periodo.",
    formula: "COUNT(connect_incidents por proveedor)", unit: "incidencias", direction: "down_good",
  }),
  A({
    code: "provider_score", name: "Score inteligente", category: "provider",
    description: "Score 0–100 del taller (fiabilidad, velocidad, calidad y compromiso).",
    formula: "connect_workshops.currentScore (motor de score existente)", unit: "puntos", direction: "up_good",
    targetValue: 75, warningThreshold: 0.1, criticalThreshold: 0.25,
  }),

  // ── Flota ────────────────────────────────────────────────────────────────
  A({
    code: "fleet_services_per_unit", name: "Servicios por unidad", category: "fleet",
    description: "Media de asistencias finalizadas por unidad móvil activa.",
    formula: "finalizadas con unidad / unidades con actividad", unit: "servicios", direction: "up_good",
  }),
  A({
    code: "fleet_utilization_pct", name: "Utilización de flota", category: "fleet",
    description: "Porcentaje de unidades ocupadas en un servicio ahora mismo.",
    formula: "unidades ocupadas / unidades totales × 100", unit: "%", direction: "up_good",
    targetValue: 60, warningThreshold: 0.3, criticalThreshold: 0.6,
  }),
  A({
    code: "fleet_out_of_service", name: "Unidades fuera de servicio", category: "fleet",
    description: "Unidades en avería, fuera de servicio o sin conexión.",
    formula: "COUNT(estado IN out_of_service, breakdown, no_connection)", unit: "unidades", direction: "down_good",
    targetValue: 0, warningThreshold: 1, criticalThreshold: 3,
  }),
  {
    code: "fleet_km_loaded", name: "Kilómetros en servicio", category: "fleet", available: false,
    missingData: "No hay odómetro ni traza de ruta persistida por asistencia; solo la última posición Webfleet.",
    description: "Kilómetros recorridos con servicio asignado.",
    formula: "SUM(km de ruta por asistencia)", unit: "km", direction: "up_good",
  },
  {
    code: "fleet_km_empty", name: "Kilómetros sin carga", category: "fleet", available: false,
    missingData: "Requiere histórico de posiciones GPS por unidad, hoy no se almacena la traza.",
    description: "Kilómetros recorridos sin servicio asignado.",
    formula: "SUM(km entre servicios)", unit: "km", direction: "down_good",
  },
  {
    code: "fleet_cost_per_km", name: "Coste por kilómetro", category: "fleet", available: false,
    missingData: "Depende de los kilómetros por servicio, aún no disponibles.",
    description: "Coste operativo por kilómetro recorrido.",
    formula: "coste total / km totales", unit: "€/km", direction: "down_good",
  },
  {
    code: "fleet_fuel_estimate", name: "Consumo estimado", category: "fleet", available: false,
    missingData: "Sin datos de consumo ni de kilometraje por unidad.",
    description: "Consumo de combustible estimado de la flota.",
    formula: "km × consumo medio por tipo de unidad", unit: "l", direction: "down_good",
  },

  // ── Conductores ──────────────────────────────────────────────────────────
  {
    code: "driver_services", name: "Servicios por conductor", category: "driver", available: false,
    missingData: "Connect guarda el nombre del técnico del core, sin entidad conductor ni turnos; hace falta unificar identidad.",
    description: "Servicios realizados por conductor.",
    formula: "COUNT(asistencias por conductor)", unit: "servicios", direction: "up_good",
  },
  {
    code: "driver_punctuality_pct", name: "Puntualidad del conductor", category: "driver", available: false,
    missingData: "Depende de la entidad conductor y del ETA por conductor.",
    description: "Porcentaje de llegadas puntuales por conductor.",
    formula: "llegadas dentro de ETA / total × 100", unit: "%", direction: "up_good",
  },
  {
    code: "driver_active_hours", name: "Horas activas", category: "driver", available: false,
    missingData: "No hay registro de jornada del conductor en Connect (existe en Presencia, sin vínculo).",
    description: "Horas activas por conductor y turno.",
    formula: "SUM(horas de turno)", unit: "h", direction: "up_good",
  },

  // ── Económicos ───────────────────────────────────────────────────────────
  A({
    code: "revenue_total", name: "Facturación", category: "economic",
    description: "Importe de las asistencias finalizadas en el periodo (coste final o estimado).",
    formula: "SUM(COALESCE(finalCost, estimatedCost)) de finalizadas", unit: "€", direction: "up_good",
  }),
  A({
    code: "cost_avg_service", name: "Coste medio por servicio", category: "economic",
    description: "Importe medio de las asistencias finalizadas.",
    formula: "AVG(COALESCE(finalCost, estimatedCost))", unit: "€", direction: "down_good",
    targetValue: 120, warningThreshold: 0.15, criticalThreshold: 0.35,
  }),
  A({
    code: "cost_deviation_pct", name: "Desviación coste vs tarifa", category: "economic",
    description: "Diferencia porcentual entre el coste final y el estimado por tarifa.",
    formula: "(finalCost − estimatedCost) / estimatedCost × 100", unit: "%", direction: "down_good",
    targetValue: 5, warningThreshold: 1, criticalThreshold: 3,
  }),
  A({
    code: "pending_invoice_count", name: "Pendientes de facturar", category: "economic",
    description: "Asistencias finalizadas sin marca de facturación.",
    formula: "COUNT(finalizadas con invoicedAtMs IS NULL)", unit: "servicios", direction: "down_good",
    targetValue: 10, warningThreshold: 1, criticalThreshold: 4,
  }),
  A({
    code: "untariffed_pct", name: "Servicios sin tarifa", category: "economic",
    description: "Finalizadas sin importe estimado ni final: no hay tarifa configurada.",
    formula: "finalizadas sin coste / finalizadas × 100", unit: "%", direction: "down_good",
    targetValue: 0, warningThreshold: 1, criticalThreshold: 3,
  }),
  {
    code: "gross_margin", name: "Margen bruto", category: "economic", available: false,
    missingData: "Solo se registra un importe por asistencia; falta separar precio de venta al cliente y coste del proveedor.",
    description: "Diferencia entre ingreso y coste del proveedor.",
    formula: "SUM(ingreso − coste)", unit: "€", direction: "up_good",
  },

  // ── Calidad ──────────────────────────────────────────────────────────────
  A({
    code: "incidents_total", name: "Incidencias", category: "quality",
    description: "Incidencias abiertas en el periodo.",
    formula: "COUNT(connect_incidents creadas)", unit: "incidencias", direction: "down_good",
    targetValue: 5, warningThreshold: 1, criticalThreshold: 3,
  }),
  A({
    code: "complaints_total", name: "Reclamaciones", category: "quality",
    description: "Incidencias de tipo reclamación o daños.",
    formula: "COUNT(incidencias tipo complaint/damages)", unit: "reclamaciones", direction: "down_good",
    targetValue: 0, warningThreshold: 1, criticalThreshold: 3,
  }),
  A({
    code: "incident_resolution_min", name: "Tiempo de resolución de incidencias", category: "quality",
    description: "Minutos medios entre apertura y resolución de una incidencia.",
    formula: "AVG(resolvedAt − createdAt)", unit: "min", direction: "down_good",
    targetValue: 480, warningThreshold: 0.5, criticalThreshold: 1.5,
  }),
  A({
    code: "incomplete_docs_pct", name: "Documentación incompleta", category: "quality",
    description: "Porcentaje de finalizadas con incidencia documental o de evidencias.",
    formula: "incidencias documentales / finalizadas × 100", unit: "%", direction: "down_good",
    targetValue: 2, warningThreshold: 1, criticalThreshold: 3,
  }),
  {
    code: "customer_satisfaction", name: "Satisfacción media del cliente", category: "quality", available: false,
    missingData: "No existe encuesta post-servicio ni valoración del cliente en Connect; es el primer dato a capturar.",
    description: "Valoración media del cliente (1–5).",
    formula: "AVG(valoración del cliente)", unit: "puntos", direction: "up_good",
  },
  {
    code: "nps", name: "Net Promoter Score", category: "quality", available: false,
    missingData: "Requiere encuesta NPS, no implantada.",
    description: "NPS de los clientes atendidos.",
    formula: "% promotores − % detractores", unit: "puntos", direction: "up_good",
  },
];

export const KPI_BY_CODE: Record<string, KpiDefinition> = Object.fromEntries(
  KPI_CATALOG.map((k) => [k.code, k]),
);

/** KPIs que se muestran en el panel principal, en orden. */
export const DASHBOARD_KPIS = [
  "services_received", "services_pending", "services_assigned", "services_en_route",
  "services_in_progress", "services_finished", "services_cancelled", "services_delayed",
  "avg_assignment_min", "eta_predicted_min", "avg_arrival_min", "avg_resolution_min",
  "sla_compliance_pct", "fleet_availability_pct", "customer_satisfaction",
  "cost_avg_service", "revenue_total",
];
