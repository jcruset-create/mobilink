/**
 * Centro de Inteligencia Operacional — cliente de /api/operational-intelligence.
 * Mismo patrón de autenticación que boFetch (Bearer de la sesión unificada).
 */

import { supabase } from "../../administracion/services/supabase";
import { ApiError } from "./api";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

export async function oiFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch {
    /* sin sesión: el backend responderá 401 */
  }
  const res = await fetch(`${API_BASE}/api/operational-intelligence${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Error HTTP ${res.status}`);
  }
  return json as T;
}

/** Descarga directa de un informe en CSV (Excel lo abre sin conversión). */
export async function oiDownloadCsv(kind: string, body: Record<string, unknown>): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch { /* el backend responderá 401 */ }
  const res = await fetch(`${API_BASE}/api/operational-intelligence/reports/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, kind, format: "csv" }),
  });
  if (!res.ok) throw new ApiError(res.status, "error", "No se pudo generar el informe");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Tipos compartidos con el backend ────────────────────────────────────────

export type KpiStatus = "green" | "amber" | "red" | "grey";

export type KpiCard = {
  code: string;
  name: string;
  category: string;
  unit: string;
  description: string;
  direction: "up_good" | "down_good";
  value: number | null;
  target: number | null;
  status: KpiStatus;
  sampleSize: number;
  available: boolean;
  missingData?: string;
  vsPrevDay: number | null;
  vsPrevWeek: number | null;
  trend: "up" | "down" | "flat" | null;
  isLive: boolean;
};

export type TrendPoint = {
  day: number; received: number; finished: number; cancelled: number;
  assignmentMin: number | null; arrivalMin: number | null; slaPct: number | null; revenue: number | null;
};

export type CoverageZone = {
  zoneId: string; label: string; workshopId: number | null; latitude: number; longitude: number;
  active: number; availableUnits: number; ratio: number; demand3h: number; capacity3h: number;
  status: "ok" | "tight" | "deficit";
};

export type DashboardResponse = {
  generatedAtMs: number;
  scope: { role: string; providerCompanyId: number | null; full: boolean };
  filters: Record<string, unknown>;
  kpis: KpiCard[];
  trend: TrendPoint[];
  coverage: CoverageZone[];
  riskSummary: { critical: number; high: number; medium: number; low: number };
};

export type DelayRisk = {
  assistanceId: number;
  score: number;
  level: "low" | "medium" | "high" | "critical";
  minutesToDeadline: number | null;
  etaMinutes: number | null;
  factors: Array<{ name: string; weight: number; detail: string }>;
  explanation: string;
};

export type LiveService = {
  id: number; status: string; priority: string; serviceType: string; createdAtMs: number;
  address: string | null; latitude: number | null; longitude: number | null;
  slaDeadlineAtMs: number | null; expedientNumber: string | null; customerName: string | null;
  workshop: string | null; provider: string | null;
  unitId: number | null; unitName: string | null; lastReportAtMs: number | null;
  waitingMin: number; gpsStale: boolean;
  risk: Pick<DelayRisk, "score" | "level" | "explanation" | "etaMinutes" | "minutesToDeadline"> | null;
};

export type LiveUnit = {
  id: number; name: string; plate: string | null; status: string;
  latitude: number | null; longitude: number | null; lastReportAtMs: number | null;
  activeAssistanceId: number | null; speedKmh: number | null;
};

export type DemandSlot = {
  zoneId: string; zoneLabel: string; workshopId: number | null; targetAtMs: number; hour: number;
  predicted: number; confidenceMin: number; confidenceMax: number; confidenceScore: number;
  vsAveragePct: number | null; sampleSize: number; recommendedUnits: number; factors: string[];
};

export type Recommendation = {
  id: number;
  recommendationType: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  affectedEntityType: string | null;
  affectedEntityId: string | null;
  expectedImpact: string | null;
  impactValue: number | null;
  impactUnit: string | null;
  proposedAction: { type: string; label: string; link?: string; params?: Record<string, unknown> };
  explanation: {
    detected: string;
    dataUsed: string[];
    factors: Array<{ name: string; detail: string }>;
    confidence: number;
    alternatives?: string[];
  };
  status: "pending" | "accepted" | "rejected" | "expired";
  acceptedBy: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  createdAtMs: number;
  expiresAtMs: number | null;
};

export type OperationalAlert = {
  id: number;
  alertType: string;
  category: "operational" | "quality" | "economic";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  entityType: string | null;
  entityId: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  status: "open" | "acknowledged" | "resolved" | "expired";
  detectedAtMs: number;
  dueAtMs: number | null;
  acknowledgedAtMs: number | null;
  acknowledgedBy: string | null;
  resolvedAtMs: number | null;
  resolvedBy: string | null;
  resolution: string | null;
  escalationLevel: number;
  comments: Array<{ by: string; text: string; atMs: number }>;
};

export type AssistantAnswer = {
  intent: string;
  answer: string;
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
  link?: string;
  followUps?: string[];
  dataUsed: string[];
};

export type ReportOutput = {
  kind: string; title: string; subtitle?: string;
  columns: string[]; rows: Array<Array<string | number | null>>; generatedAtMs: number;
};

// ── Formateo compartido ─────────────────────────────────────────────────────

export const KPI_STATUS_STYLES: Record<KpiStatus, string> = {
  green: "border-emerald-500/40 bg-emerald-500/10",
  amber: "border-amber-500/40 bg-amber-500/10",
  red: "border-red-500/50 bg-red-500/10",
  grey: "border-slate-700 bg-slate-800",
};

export const KPI_STATUS_LABELS: Record<KpiStatus, string> = {
  green: "Dentro del objetivo",
  amber: "Riesgo de incumplimiento",
  red: "Incumplimiento o situación crítica",
  grey: "Datos insuficientes",
};

export const PRIORITY_STYLES: Record<string, string> = {
  critical: "border-red-500/60 bg-red-500/15 text-red-300",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  low: "border-slate-500/40 bg-slate-500/10 text-slate-300",
};

export const RISK_STYLES: Record<string, string> = {
  critical: "border-red-500/60 bg-red-500/15 text-red-300",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  low: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

export const RISK_LABELS: Record<string, string> = {
  critical: "Crítico", high: "Alto", medium: "Medio", low: "Bajo",
};

export function fmtValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  if (unit === "%") return `${rounded} %`;
  if (unit === "€") return `${rounded.toLocaleString("es-ES")} €`;
  if (unit === "min") return `${rounded} min`;
  return `${rounded.toLocaleString("es-ES")}${unit && unit !== "servicios" ? ` ${unit}` : ""}`;
}

export function fmtVariation(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v} %`;
}

export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

/** Rango de fechas por defecto de las pantallas: el día en curso. */
export function todayRange(): { from: number; to: number } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return { from: d.getTime(), to: Date.now() };
}

export function rangeForDays(days: number): { from: number; to: number } {
  return { from: Date.now() - days * 86400_000, to: Date.now() };
}
