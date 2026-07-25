/**
 * Centro de Inteligencia Operacional — informes.
 *
 * Formato genérico columnas + filas (el mismo que ya usa /api/connect/bo/reports),
 * de modo que la capa de presentación puede pintarlos en web, descargarlos en
 * CSV/Excel o adjuntarlos a un envío programado sin lógica adicional.
 *
 * Los informes de este módulo son los analíticos y de IA; los operativos
 * (actividad, rechazos, incidencias...) siguen viviendo en el backoffice y no
 * se duplican aquí.
 */

import nodemailer from "nodemailer";
import db from "../../db.ts";
import { buildKpiCards, dailyTrend, type KpiFilters } from "./kpi.ts";
import { DASHBOARD_KPIS, KPI_CATALOG } from "./catalog.ts";
import { forecastDemand, modelAccuracy } from "./predictions.ts";
import { recommendationStats } from "./recommendations.ts";
import type { OiScope } from "./scope.ts";
import { applyScope } from "./scope.ts";

export interface ReportOutput {
  kind: string;
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  generatedAtMs: number;
}

export const REPORT_CATALOG = [
  { kind: "resumen_diario", name: "Resumen diario de operaciones", description: "KPIs del día con objetivo, semáforo y variación." },
  { kind: "sla_semanal", name: "Informe semanal de SLA", description: "Cumplimiento diario de SLA y tiempos medios de la semana." },
  { kind: "proveedores", name: "Rendimiento de proveedores", description: "Volumen, cumplimiento, tiempos y score por taller." },
  { kind: "flota", name: "Uso de flota", description: "Estado y actividad de las unidades móviles." },
  { kind: "economico", name: "Análisis económico", description: "Importes, coste medio y desviaciones por cliente." },
  { kind: "prediccion_demanda", name: "Predicción de demanda", description: "Demanda prevista por zona y franja con intervalo de confianza." },
  { kind: "precision_eta", name: "Precisión del ETA", description: "ETA comunicado frente a llegada real y error del modelo." },
  { kind: "recomendaciones", name: "Recomendaciones generadas y aplicadas", description: "Volumen, aceptación e impacto estimado por tipo." },
  { kind: "calidad", name: "Calidad del servicio", description: "Incidencias, reclamaciones y tiempos de resolución." },
  { kind: "inventario_kpis", name: "Inventario de KPIs", description: "Catálogo completo con su disponibilidad de datos." },
];

const DAY_MS = 86400_000;
const fmtMs = (v: unknown) => (v ? new Date(Number(v)).toISOString().replace("T", " ").slice(0, 16) : "");
const fmtDay = (v: number) => new Date(v).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit" });
const num = (v: unknown, d = 1) => (v == null ? "" : Math.round(Number(v) * 10 ** d) / 10 ** d);

export async function generateReport(kind: string, filters: KpiFilters, scope: OiScope): Promise<ReportOutput | null> {
  const f = applyScope(filters, scope);
  const now = Date.now();
  const base = { kind, generatedAtMs: now };

  if (kind === "resumen_diario") {
    const cards = await buildKpiCards(DASHBOARD_KPIS, f);
    return {
      ...base,
      title: "Resumen diario de operaciones",
      subtitle: `${fmtMs(f.from)} → ${fmtMs(f.to)}`,
      columns: ["KPI", "Categoría", "Valor", "Unidad", "Objetivo", "Estado", "vs. día anterior", "vs. semana anterior", "Muestra"],
      rows: cards.map((c) => [
        c.name, c.category, c.value ?? (c.available ? "sin datos" : "no disponible"), c.unit,
        c.target ?? "", c.status, c.vsPrevDay == null ? "" : `${c.vsPrevDay} %`,
        c.vsPrevWeek == null ? "" : `${c.vsPrevWeek} %`, c.sampleSize,
      ]),
    };
  }

  if (kind === "sla_semanal") {
    const days = Math.max(1, Math.ceil((f.to - f.from) / DAY_MS));
    const trend = await dailyTrend(f, days);
    return {
      ...base,
      title: "Informe de SLA",
      subtitle: `${days} día(s) hasta ${fmtMs(f.to)}`,
      columns: ["Día", "Recibidos", "Finalizados", "Cancelados", "Cumplimiento SLA", "T. asignación", "T. llegada"],
      rows: trend.map((d) => [
        fmtDay(d.day as number), d.received as number, d.finished as number, d.cancelled as number,
        d.slaPct == null ? "" : `${d.slaPct} %`, num(d.assignmentMin), num(d.arrivalMin),
      ]),
    };
  }

  if (kind === "proveedores") {
    const params: unknown[] = [f.from, f.to];
    let where = `ca."createdAtMs" BETWEEN $1 AND $2 AND ca.status <> 'draft'`;
    if (f.providerCompanyId) { params.push(f.providerCompanyId); where += ` AND w."providerCompanyId" = $${params.length}`; }
    const r = await db.query(
      `SELECT w.name AS workshop, pc.name AS provider, w."currentScore",
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ca.status = 'finished')::int AS finished,
              COUNT(*) FILTER (WHERE ca.status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE ca."slaDeadlineAtMs" IS NOT NULL)::int AS n_sla,
              COUNT(*) FILTER (WHERE ca."slaDeadlineAtMs" IS NOT NULL AND arr."occurredAtMs" IS NOT NULL
                                 AND arr."occurredAtMs" <= ca."slaDeadlineAtMs")::int AS sla_ok,
              AVG((arr."occurredAtMs" - ca."createdAtMs")/60000.0) AS arrival_min,
              AVG((fin."occurredAtMs" - ca."createdAtMs")/60000.0) AS resolution_min,
              COALESCE(SUM(COALESCE(ca."finalCost", ca."estimatedCost")) FILTER (WHERE ca.status = 'finished'), 0) AS revenue
         FROM connect_assistances ca
         JOIN connect_workshops w ON w.id = ca."workshopId"
         LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
         LEFT JOIN LATERAL (SELECT MIN("occurredAtMs") AS "occurredAtMs" FROM connect_status_history
            WHERE "assistanceId" = ca.id AND "toStatus" = 'arrived') arr ON true
         LEFT JOIN LATERAL (SELECT MIN("occurredAtMs") AS "occurredAtMs" FROM connect_status_history
            WHERE "assistanceId" = ca.id AND "toStatus" = 'finished') fin ON true
        WHERE ${where}
        GROUP BY w.id, w.name, pc.name, w."currentScore" ORDER BY finished DESC`,
      params,
    );
    return {
      ...base,
      title: "Rendimiento de proveedores",
      subtitle: `${fmtMs(f.from)} → ${fmtMs(f.to)}`,
      columns: ["Taller", "Empresa", "Score", "Servicios", "Finalizados", "Cancelados", "Cumplimiento SLA", "T. llegada (min)", "T. resolución (min)", "Importe (€)"],
      rows: r.rows.map((x) => [
        x.workshop, x.provider ?? "", num(x.currentScore, 0), x.total, x.finished, x.cancelled,
        x.n_sla > 0 ? `${Math.round((x.sla_ok / x.n_sla) * 100)} %` : "", num(x.arrival_min), num(x.resolution_min),
        num(x.revenue, 2),
      ]),
    };
  }

  if (kind === "flota") {
    const params: unknown[] = [];
    let where = "1 = 1";
    if (f.providerCompanyId) { params.push(f.providerCompanyId); where = `mu."providerCompanyId" = $${params.length}`; }
    const r = await db.query(
      `SELECT mu.name, mu.plate, mu.status, mu."statusReason", mu."lastReportAtMs", mu."activeAssistanceId",
              pc.name AS provider,
              (SELECT COUNT(*)::int FROM connect_mobile_unit_events e
                WHERE e."unitId" = mu.id AND e."createdAtMs" >= $${params.length + 1}) AS events
         FROM connect_mobile_units mu
         LEFT JOIN connect_provider_companies pc ON pc.id = mu."providerCompanyId"
        WHERE ${where} ORDER BY mu.name`,
      [...params, f.from],
    );
    return {
      ...base,
      title: "Uso de flota",
      subtitle: `Estado actual · actividad desde ${fmtMs(f.from)}`,
      columns: ["Unidad", "Matrícula", "Empresa", "Estado", "Motivo", "Servicio activo", "Último reporte", "Cambios de estado"],
      rows: r.rows.map((x) => [
        x.name, x.plate ?? "", x.provider ?? "", x.status, x.statusReason ?? "",
        x.activeAssistanceId ?? "", fmtMs(x.lastReportAtMs), x.events,
      ]),
    };
  }

  if (kind === "economico") {
    const params: unknown[] = [f.from, f.to];
    let where = `ca."createdAtMs" BETWEEN $1 AND $2 AND ca.status <> 'draft'`;
    if (f.providerCompanyId) { params.push(f.providerCompanyId); where += ` AND w."providerCompanyId" = $${params.length}`; }
    if (f.clientId) { params.push(f.clientId); where += ` AND ca."clientId" = $${params.length}`; }
    const r = await db.query(
      `SELECT COALESCE(cl.name, ca."clientName", p.name, 'Sin cliente') AS client,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ca.status = 'finished')::int AS finished,
              COALESCE(SUM(COALESCE(ca."finalCost", ca."estimatedCost")), 0) AS amount,
              AVG(COALESCE(ca."finalCost", ca."estimatedCost")) AS avg_amount,
              AVG((ca."finalCost" - ca."estimatedCost") / NULLIF(ca."estimatedCost", 0) * 100) AS deviation,
              COUNT(*) FILTER (WHERE ca.status = 'finished' AND ca."invoicedAtMs" IS NULL)::int AS pending_invoice
         FROM connect_assistances ca
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
         LEFT JOIN connect_clients cl ON cl.id = ca."clientId"
         LEFT JOIN connect_partners p ON p.id = ca."partnerId"
        WHERE ${where}
        GROUP BY 1 ORDER BY amount DESC`,
      params,
    );
    return {
      ...base,
      title: "Análisis económico",
      subtitle: `${fmtMs(f.from)} → ${fmtMs(f.to)}`,
      columns: ["Cliente", "Servicios", "Finalizados", "Importe (€)", "Importe medio (€)", "Desviación vs tarifa", "Pendientes de facturar"],
      rows: r.rows.map((x) => [
        x.client, x.total, x.finished, num(x.amount, 2), num(x.avg_amount, 2),
        x.deviation == null ? "" : `${num(x.deviation)} %`, x.pending_invoice,
      ]),
    };
  }

  if (kind === "prediccion_demanda") {
    const slots = await forecastDemand({ hours: 24 });
    const hour = (ms: number) => new Date(ms).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    return {
      ...base,
      title: "Predicción de demanda",
      subtitle: "Próximas 24 horas por zona y franja",
      columns: ["Zona", "Franja", "Previstas", "Mín. (IC 80 %)", "Máx. (IC 80 %)", "vs. media", "Confianza", "Unidades recomendadas"],
      rows: slots
        .filter((s) => s.predicted > 0)
        .map((s) => [
          s.zoneLabel, hour(s.targetAtMs), s.predicted, s.confidenceMin, s.confidenceMax,
          s.vsAveragePct == null ? "" : `${s.vsAveragePct} %`, `${Math.round(s.confidenceScore * 100)} %`, s.recommendedUnits,
        ]),
    };
  }

  if (kind === "precision_eta") {
    const r = await db.query(
      `SELECT p."entityId" AS assistance, p."predictedValue" AS eta, p."actualValue" AS actual,
              p."errorValue" AS error, p."confidenceScore", p."predictionAtMs",
              w.name AS workshop
         FROM ai_prediction p
         LEFT JOIN connect_assistances ca ON ca.id = p."entityId"::int
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
        WHERE p."predictionType" = 'eta' AND p."predictionAtMs" BETWEEN $1 AND $2
        ORDER BY p.id DESC LIMIT 2000`,
      [f.from, f.to],
    );
    const accuracy = await modelAccuracy(30);
    const eta = accuracy.find((m) => m.predictionType === "eta");
    return {
      ...base,
      title: "Precisión del ETA",
      subtitle: eta
        ? `Error medio ${eta.mae} min sobre ${eta.evaluated} predicciones evaluadas (30 días)`
        : "Todavía sin predicciones evaluadas",
      columns: ["Asistencia", "Taller", "ETA comunicado (min)", "Llegada real (min)", "Error (min)", "Confianza", "Emitido"],
      rows: r.rows.map((x) => [
        `#${x.assistance}`, x.workshop ?? "", num(x.eta, 0), x.actual == null ? "pendiente" : num(x.actual, 0),
        x.error == null ? "" : num(x.error, 0), `${Math.round(Number(x.confidenceScore ?? 0) * 100)} %`, fmtMs(x.predictionAtMs),
      ]),
    };
  }

  if (kind === "recomendaciones") {
    const days = Math.max(1, Math.ceil((f.to - f.from) / DAY_MS));
    const stats = await recommendationStats(days);
    return {
      ...base,
      title: "Recomendaciones generadas y aplicadas",
      subtitle: `Últimos ${days} día(s)`,
      columns: ["Tipo", "Generadas", "Aceptadas", "Rechazadas", "Caducadas", "Tasa de aceptación", "Impacto estimado acumulado"],
      rows: stats.map((s) => [
        s.type as string, s.total as number, s.accepted as number, s.rejected as number, s.expired as number,
        s.acceptanceRate == null ? "" : `${s.acceptanceRate} %`,
        `${s.estimatedImpact} ${s.impactUnit ?? ""}`.trim(),
      ]),
    };
  }

  if (kind === "calidad") {
    const params: unknown[] = [f.from, f.to];
    let where = `i."createdAtMs" BETWEEN $1 AND $2`;
    if (f.providerCompanyId) { params.push(f.providerCompanyId); where += ` AND i."providerCompanyId" = $${params.length}`; }
    const r = await db.query(
      `SELECT i.type, i.severity,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE i.status IN ('resolved','closed'))::int AS resolved,
              AVG((i."resolvedAtMs" - i."createdAtMs")/60000.0) AS resolution_min,
              COUNT(*) FILTER (WHERE i."slaImpact")::int AS sla_impact
         FROM connect_incidents i WHERE ${where}
        GROUP BY 1, 2 ORDER BY total DESC`,
      params,
    );
    return {
      ...base,
      title: "Calidad del servicio",
      subtitle: `${fmtMs(f.from)} → ${fmtMs(f.to)}`,
      columns: ["Tipo de incidencia", "Gravedad", "Total", "Resueltas", "T. medio de resolución (min)", "Con impacto en SLA"],
      rows: r.rows.map((x) => [x.type, x.severity, x.total, x.resolved, num(x.resolution_min, 0), x.sla_impact]),
    };
  }

  if (kind === "inventario_kpis") {
    return {
      ...base,
      title: "Inventario de KPIs",
      subtitle: "Catálogo completo y disponibilidad real de datos",
      columns: ["Código", "Nombre", "Categoría", "Unidad", "Objetivo", "Cálculo", "Disponible", "Dato ausente"],
      rows: KPI_CATALOG.map((k) => [
        k.code, k.name, k.category, k.unit, k.targetValue ?? "", k.formula,
        k.available === false ? "no" : "sí", k.missingData ?? "",
      ]),
    };
  }

  return null;
}

/** Serializa un informe a CSV (separador ; y BOM, para que Excel lo abra bien). */
export function reportToCsv(report: ReportOutput): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [report.columns.map(esc).join(";")];
  for (const row of report.rows) lines.push(row.map(esc).join(";"));
  return `﻿${lines.join("\n")}`;
}

// ── Programación de envíos ──────────────────────────────────────────────────

/** Próxima ejecución a la hora indicada (UTC) según la frecuencia. */
export function nextRunAt(frequency: string, hourUtc: number, fromMs = Date.now()): number {
  const d = new Date(fromMs);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(hourUtc);
  if (d.getTime() <= fromMs) d.setUTCDate(d.getUTCDate() + 1);
  if (frequency === "weekly") {
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); // lunes
  } else if (frequency === "monthly") {
    if (d.getUTCDate() !== 1) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(hourUtc, 0, 0, 0);
    }
  }
  return d.getTime();
}

let transport: nodemailer.Transporter | null = null;
/** Mismo SMTP que el resto de la aplicación; si no está configurado, no se envía. */
function mailTransport(): nodemailer.Transporter | null {
  if (transport) return transport;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

/** Genera y envía los informes programados que ya han vencido. */
export async function runDueSchedules(): Promise<number> {
  const now = Date.now();
  const due = await db.query(
    `SELECT * FROM operational_report_schedule
      WHERE active = true AND ("nextRunAtMs" IS NULL OR "nextRunAtMs" <= $1) LIMIT 20`,
    [now],
  );
  let sent = 0;

  for (const s of due.rows) {
    const period = s.frequency === "monthly" ? 30 : s.frequency === "weekly" ? 7 : 1;
    const filters: KpiFilters = { from: now - period * DAY_MS, to: now };
    const scope: OiScope = {
      controlCenterId: s.controlCenterId ?? null, providerCompanyId: null, clientId: null,
      role: "cc_admin", full: true,
    };
    let result = "";
    try {
      const report = await generateReport(String(s.reportKind), filters, scope);
      if (!report) {
        result = "informe desconocido";
      } else {
        const recipients: string[] = safeJson(s.recipients);
        const mailer = mailTransport();
        if (!mailer || !recipients.length) {
          result = mailer ? "sin destinatarios" : "SMTP no configurado";
        } else {
          await mailer.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: recipients.join(","),
            subject: `${report.title} — ${new Date(now).toLocaleDateString("es-ES")}`,
            text:
              `${report.title}\n${report.subtitle ?? ""}\n\n` +
              `Se adjunta el informe con ${report.rows.length} fila(s).\n` +
              `Generado automáticamente por el Centro de Inteligencia Operacional de Mobilink Connect.`,
            attachments: [{
              filename: `${report.kind}-${new Date(now).toISOString().slice(0, 10)}.csv`,
              content: reportToCsv(report),
              contentType: "text/csv; charset=utf-8",
            }],
          });
          result = `enviado a ${recipients.length} destinatario(s)`;
          sent++;
        }
      }
    } catch (err: any) {
      result = `error: ${err?.message ?? "desconocido"}`;
      console.error("[OI] informe programado falló:", err?.message);
    }

    await db.query(
      `UPDATE operational_report_schedule
          SET "lastRunAtMs" = $1, "lastResult" = $2, "nextRunAtMs" = $3, "updatedAtMs" = $1
        WHERE id = $4`,
      [now, result, nextRunAt(String(s.frequency), Number(s.hourUtc), now), s.id],
    );
  }
  return sent;
}

function safeJson(v: unknown): any {
  try { return typeof v === "string" ? JSON.parse(v) : (v ?? []); } catch { return []; }
}
