/**
 * Centro de Inteligencia Operacional — asistente operacional.
 *
 * Traduce preguntas en lenguaje natural a consultas PREDEFINIDAS y seguras.
 * Nunca genera SQL: la IA solo elige entre un conjunto cerrado de intenciones y
 * extrae parámetros; los datos siempre se leen con el ámbito del usuario que
 * pregunta (scope de rol/empresa), así que un proveedor no puede ver la
 * actividad de otro. Toda consulta queda registrada en ai_assistant_query.
 *
 * La clasificación es determinista por patrones. Si hay clave de OpenAI
 * configurada y ningún patrón encaja, se pide al modelo que elija UNA intención
 * de la lista; si tampoco así se resuelve, se responde con las capacidades
 * disponibles en lugar de improvisar.
 *
 * El asistente no ejecuta acciones: describe y propone, y las acciones críticas
 * se confirman siempre en su pantalla correspondiente.
 */

import OpenAI from "openai";
import db from "../../db.ts";
import { buildKpiCards, computeKpis, type KpiFilters } from "./kpi.ts";
import { forecastDemand, computeDelayRisks, zoneSaturation, modelAccuracy } from "./predictions.ts";
import type { OiScope } from "./scope.ts";
import { scopeToFilters } from "./scope.ts";

export interface AssistantAnswer {
  intent: string;
  answer: string;
  data?: unknown;
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
  link?: string;
  followUps?: string[];
  dataUsed: string[];
}

interface Intent {
  key: string;
  patterns: RegExp[];
  description: string;
  run: (question: string, scope: OiScope) => Promise<AssistantAnswer>;
}

const DAY_MS = 86400_000;

function todayRange(): { from: number; to: number } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return { from: d.getTime(), to: Date.now() };
}

function baseFilters(scope: OiScope, days = 0): KpiFilters {
  const { from, to } = todayRange();
  return { ...scopeToFilters(scope), from: days > 0 ? to - days * DAY_MS : from, to };
}

function fmt(n: number | null | undefined, unit = ""): string {
  if (n === null || n === undefined) return "sin datos";
  return `${Math.round(n * 10) / 10}${unit ? ` ${unit}` : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intenciones
// ─────────────────────────────────────────────────────────────────────────────

const INTENTS: Intent[] = [
  {
    key: "delayed_services",
    description: "Servicios retrasados o en riesgo de incumplir el SLA",
    patterns: [/retras/i, /riesgo.*(sla|incump)/i, /incumpl/i, /fuera de plazo/i],
    async run(_q, scope) {
      const risks = (await computeDelayRisks()).filter((r) => r.level === "high" || r.level === "critical");
      const ids = risks.map((r) => r.assistanceId);
      const rows = ids.length ? await loadAssistances(ids, scope) : [];
      const visible = risks.filter((r) => rows.some((x) => x.id === r.assistanceId));
      return {
        intent: "delayed_services",
        answer: visible.length === 0
          ? "Ahora mismo no hay servicios con riesgo alto o crítico de incumplir el SLA."
          : `Hay ${visible.length} servicio(s) con riesgo alto o crítico de incumplir el SLA.`,
        columns: ["Servicio", "Estado", "Proveedor", "Riesgo", "Min. hasta SLA", "Motivo"],
        rows: visible.map((r) => {
          const a = rows.find((x) => x.id === r.assistanceId)!;
          return [`#${r.assistanceId}`, a.status, a.workshop ?? "sin asignar", `${Math.round(r.score * 100)} %`,
            r.minutesToDeadline ?? "—", r.explanation];
        }),
        link: "/connect/inteligencia/tiempo-real",
        dataUsed: ["Modelo delay-risk-rules v1", "connect_assistances", "connect_status_history"],
        followUps: ["¿Qué servicios puedo reasignar?", "¿Qué proveedor tiene peor cumplimiento esta semana?"],
      };
    },
  },
  {
    key: "worst_provider",
    description: "Proveedor con peor cumplimiento o rendimiento",
    patterns: [/peor.*(proveedor|taller|cumpl)/i, /(proveedor|taller).*(peor|más lento|mas lento)/i, /ranking.*(proveedor|taller)/i, /mejor.*(proveedor|taller)/i],
    async run(q, scope) {
      const days = /mes/i.test(q) ? 30 : 7;
      const rows = await providerRanking(scope, days);
      if (!rows.length) {
        return { intent: "worst_provider", answer: "No hay actividad de proveedores en el periodo consultado.", dataUsed: ["connect_assistances"] };
      }
      const best = /mejor/i.test(q);
      const sorted = [...rows].sort((a, b) =>
        best ? (b.slaPct ?? -1) - (a.slaPct ?? -1) : (a.slaPct ?? 101) - (b.slaPct ?? 101));
      const top = sorted[0];
      return {
        intent: "worst_provider",
        answer: `En los últimos ${days} días, ${top.workshop} es el proveedor con ${best ? "mejor" : "peor"} cumplimiento de SLA: ` +
          `${top.slaPct == null ? "sin servicios con SLA" : `${top.slaPct} %`}, ${top.finished} servicios finalizados y ` +
          `${fmt(top.arrivalMin, "min")} de tiempo medio de llegada.`,
        columns: ["Taller", "Finalizados", "Cumplimiento SLA", "T. llegada", "Score"],
        rows: sorted.map((r) => [r.workshop, r.finished, r.slaPct == null ? "—" : `${r.slaPct} %`, fmt(r.arrivalMin, "min"), Math.round(r.score)]),
        link: "/connect/inteligencia/proveedores",
        dataUsed: ["connect_assistances", "connect_status_history", "connect_workshops.currentScore"],
        followUps: ["¿Por qué ha aumentado el tiempo medio de llegada?"],
      };
    },
  },
  {
    key: "demand_zones",
    description: "Zonas con mayor demanda prevista",
    patterns: [/zona.*(demanda|mayor|más)/i, /(demanda|previsión|prevision).*(zona|mayor)/i, /dónde.*(demanda|servicios)/i, /mapa de calor/i],
    async run(_q, scope) {
      const slots = await forecastDemand({ hours: 6 });
      const byZone = new Map<string, { label: string; total: number; peakHour: number; vs: number | null }>();
      for (const s of slots) {
        const e = byZone.get(s.zoneId) ?? { label: s.zoneLabel, total: 0, peakHour: s.hour, vs: s.vsAveragePct };
        e.total += s.predicted;
        if (s.predicted > 0 && s.vsAveragePct != null && (e.vs == null || s.vsAveragePct > e.vs)) { e.vs = s.vsAveragePct; e.peakHour = s.hour; }
        byZone.set(s.zoneId, e);
      }
      const ranked = [...byZone.values()].sort((a, b) => b.total - a.total).slice(0, 8);
      return {
        intent: "demand_zones",
        answer: ranked.length
          ? `En las próximas 6 horas la mayor demanda prevista está en ${ranked[0].label}: ${Math.round(ranked[0].total * 10) / 10} asistencias, con pico sobre las ${ranked[0].peakHour}:00.`
          : "Todavía no hay histórico suficiente para prever la demanda por zona.",
        columns: ["Zona", "Demanda prevista (6 h)", "Hora pico", "Variación vs media"],
        rows: ranked.map((z) => [z.label, Math.round(z.total * 10) / 10, `${z.peakHour}:00`, z.vs == null ? "—" : `${z.vs} %`]),
        link: "/connect/inteligencia/demanda",
        dataUsed: ["Modelo demand-seasonal-naive v1", "connect_assistances (90 días)"],
        followUps: ["¿Cuántas grúas hay disponibles ahora?", "¿Qué zonas tienen cobertura insuficiente?"],
      };
    },
  },
  {
    key: "available_units",
    description: "Disponibilidad de unidades y grúas",
    patterns: [/(grúa|grua|unidad|unidades).*(disponible|libre)/i, /disponibilidad.*(flota|unidad|grúa|grua)/i, /cuántas.*(grúas|gruas|unidades)/i],
    async run(_q, scope) {
      const params: unknown[] = [];
      let where = "1 = 1";
      if (scope.providerCompanyId) { params.push(scope.providerCompanyId); where = `"providerCompanyId" = $${params.length}`; }
      const r = await db.query(
        `SELECT status, COUNT(*)::int AS n FROM connect_mobile_units WHERE ${where} GROUP BY status ORDER BY 2 DESC`,
        params,
      );
      const total = r.rows.reduce((s, x) => s + x.n, 0);
      const available = r.rows.filter((x) => ["available", "at_base"].includes(x.status)).reduce((s, x) => s + x.n, 0);
      return {
        intent: "available_units",
        answer: total === 0
          ? "No hay unidades móviles registradas en tu ámbito."
          : `Hay ${available} unidad(es) disponible(s) de ${total} en total (${Math.round((available / total) * 100)} % de disponibilidad).`,
        columns: ["Estado", "Unidades"],
        rows: r.rows.map((x) => [x.status, x.n]),
        link: "/connect/inteligencia/flota",
        dataUsed: ["connect_mobile_units (estado derivado de GPS y asistencias activas)"],
        followUps: ["¿Qué zonas tienen cobertura insuficiente?"],
      };
    },
  },
  {
    key: "coverage",
    description: "Cobertura y saturación por zona",
    patterns: [/cobertura/i, /satura/i, /falta.*(grúa|grua|unidad|recurso)/i],
    async run(_q, _scope) {
      const [zones, slots] = await Promise.all([zoneSaturation(), forecastDemand({ hours: 3 })]);
      const demand = new Map<string, number>();
      for (const s of slots) demand.set(s.zoneId, (demand.get(s.zoneId) ?? 0) + s.predicted);
      const rows = Object.values(zones).map((z) => {
        const d = Math.round((demand.get(z.zoneId) ?? 0) * 10) / 10;
        const capacity = Math.round(z.availableUnits * 1.5 * 3 * 10) / 10;
        return { label: z.label, active: z.active, units: z.availableUnits, demand: d, capacity, deficit: d > capacity };
      }).sort((a, b) => Number(b.deficit) - Number(a.deficit) || b.demand - a.demand);
      const risky = rows.filter((r) => r.deficit);
      return {
        intent: "coverage",
        answer: risky.length
          ? `${risky.length} zona(s) presentan cobertura insuficiente para las próximas 3 horas: ${risky.map((r) => r.label).join(", ")}.`
          : "Todas las zonas tienen capacidad suficiente para la demanda prevista en las próximas 3 horas.",
        columns: ["Zona", "Activos", "Unidades disponibles", "Demanda 3 h", "Capacidad 3 h", "Estado"],
        rows: rows.map((r) => [r.label, r.active, r.units, r.demand, r.capacity, r.deficit ? "déficit" : "ok"]),
        link: "/connect/inteligencia/demanda",
        dataUsed: ["Modelo demand-seasonal-naive v1", "connect_mobile_units", "connect_assistances activas"],
      };
    },
  },
  {
    key: "kpi_summary",
    description: "Resumen de KPIs del día",
    patterns: [/resumen/i, /cómo va (el día|la operación|hoy)/i, /kpi/i, /situación/i, /cuántos servicios/i],
    async run(_q, scope) {
      const f = baseFilters(scope);
      const cards = await buildKpiCards(
        ["services_received", "services_pending", "services_delayed", "avg_assignment_min", "avg_arrival_min", "sla_compliance_pct", "fleet_availability_pct"],
        f,
      );
      const get = (c: string) => cards.find((x) => x.code === c);
      return {
        intent: "kpi_summary",
        answer:
          `Hoy se han recibido ${fmt(get("services_received")?.value ?? 0)} servicios. ` +
          `Pendientes de asignar: ${fmt(get("services_pending")?.value)}; con retraso: ${fmt(get("services_delayed")?.value)}. ` +
          `Tiempo medio de asignación ${fmt(get("avg_assignment_min")?.value, "min")}, llegada ${fmt(get("avg_arrival_min")?.value, "min")}, ` +
          `cumplimiento de SLA ${fmt(get("sla_compliance_pct")?.value, "%")}.`,
        columns: ["KPI", "Valor", "Objetivo", "Estado", "vs. día anterior"],
        rows: cards.map((c) => [c.name, c.value == null ? "sin datos" : `${c.value} ${c.unit}`, c.target ?? "—", c.status, c.vsPrevDay == null ? "—" : `${c.vsPrevDay} %`]),
        link: "/connect/inteligencia",
        dataUsed: ["Motor de KPIs sobre connect_assistances y connect_status_history"],
        followUps: ["¿Por qué ha aumentado el tiempo medio de llegada?", "¿Qué servicios tienen riesgo de incumplir el SLA?"],
      };
    },
  },
  {
    key: "arrival_time_cause",
    description: "Por qué ha variado el tiempo medio de llegada",
    patterns: [/por qué.*(tiempo|eta|llegada|aumentado|subido)/i, /causa.*(retraso|tiempo)/i, /explica.*(tiempo|eta)/i],
    async run(_q, scope) {
      const f = scopeToFilters(scope);
      const now = Date.now();
      const [recent, prev] = await Promise.all([
        computeKpis({ ...f, from: now - 7 * DAY_MS, to: now }),
        computeKpis({ ...f, from: now - 14 * DAY_MS, to: now - 7 * DAY_MS }),
      ]);
      const diff = (code: string) => {
        const a = recent[code]?.value;
        const b = prev[code]?.value;
        if (a == null || b == null || b === 0) return null;
        return Math.round(((a - b) / b) * 1000) / 10;
      };
      const parts: Array<[string, number | null]> = [
        ["tiempo de asignación", diff("avg_assignment_min")],
        ["tiempo hasta la salida", diff("avg_departure_min")],
        ["tiempo de desplazamiento", diff("avg_travel_min")],
        ["tasa de rechazo de ofertas", diff("provider_rejection_pct")],
        ["servicios reasignados", diff("reassigned_pct")],
      ];
      const worst = parts.filter(([, v]) => v != null).sort((a, b) => (b[1] as number) - (a[1] as number));
      const total = diff("avg_arrival_min");
      return {
        intent: "arrival_time_cause",
        answer: total == null
          ? "No hay datos suficientes en las dos últimas semanas para explicar la variación del tiempo de llegada."
          : `El tiempo medio de llegada ha variado un ${total} % respecto a la semana anterior. ` +
            (worst.length && (worst[0][1] as number) > 0
              ? `El componente que más ha empeorado es el ${worst[0][0]} (${worst[0][1]} %).`
              : "Ningún componente concreto se ha degradado de forma significativa."),
        columns: ["Componente", "Variación semanal"],
        rows: parts.map(([name, v]) => [name, v == null ? "sin datos" : `${v} %`]),
        link: "/connect/inteligencia",
        dataUsed: ["Motor de KPIs (dos ventanas de 7 días)", "connect_status_history", "connect_assignments"],
      };
    },
  },
  {
    key: "compare_zones",
    description: "Comparar dos zonas o proveedores",
    patterns: [/compara/i, /diferencia entre/i, /\bvs\b/i],
    async run(_q, scope) {
      const rows = await providerRanking(scope, 30);
      return {
        intent: "compare_zones",
        answer: rows.length
          ? "Comparativa de los últimos 30 días por taller (los talleres definen las zonas operativas de la red)."
          : "No hay actividad suficiente para comparar en los últimos 30 días.",
        columns: ["Taller / zona", "Finalizados", "Cumplimiento SLA", "T. llegada", "Score", "Importe"],
        rows: rows.map((r) => [r.workshop, r.finished, r.slaPct == null ? "—" : `${r.slaPct} %`, fmt(r.arrivalMin, "min"), Math.round(r.score), fmt(r.revenue, "€")]),
        link: "/connect/inteligencia/proveedores",
        dataUsed: ["connect_assistances", "connect_status_history", "connect_workshops"],
      };
    },
  },
  {
    key: "recommendations",
    description: "Recomendaciones activas de la IA",
    patterns: [/recomend|recomien/i, /qué (puedo|debería) hacer/i, /cómo reducir/i, /mejorar/i],
    async run(_q, _scope) {
      const r = await db.query(
        `SELECT id, title, priority, "expectedImpact", "recommendationType"
           FROM ai_recommendation WHERE status = 'pending' ORDER BY
             CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC LIMIT 10`,
      );
      return {
        intent: "recommendations",
        answer: r.rows.length
          ? `Hay ${r.rows.length} recomendación(es) activa(s). La más prioritaria: ${r.rows[0].title}.`
          : "No hay recomendaciones activas en este momento.",
        columns: ["Prioridad", "Recomendación", "Impacto estimado"],
        rows: r.rows.map((x) => [x.priority, x.title, x.expectedImpact ?? "—"]),
        link: "/connect/inteligencia/recomendaciones",
        dataUsed: ["Motor de recomendaciones (ai_recommendation)"],
      };
    },
  },
  {
    key: "model_accuracy",
    description: "Precisión de los modelos de IA",
    patterns: [/precisión|precision/i, /acierta|fiab/i, /modelo/i],
    async run(_q, _scope) {
      const rows = await modelAccuracy(30);
      return {
        intent: "model_accuracy",
        answer: rows.length
          ? "Precisión de los modelos en los últimos 30 días, medida comparando cada predicción con el resultado real."
          : "Todavía no hay predicciones evaluadas: la precisión se puede medir cuando los servicios previstos ya han ocurrido.",
        columns: ["Modelo", "Versión", "Predicciones evaluadas", "Error medio (MAE)", "Error relativo (MAPE)", "Sesgo"],
        rows: rows.map((m) => [m.predictionType as string, m.modelVersion as string, m.evaluated as number,
          m.mae as number, m.mape == null ? "—" : `${m.mape} %`, m.bias as number]),
        link: "/connect/inteligencia/configuracion",
        dataUsed: ["ai_prediction (predicciones evaluadas)", "ai_model_registry"],
      };
    },
  },
  {
    key: "report",
    description: "Generar un informe",
    patterns: [/informe|reporte/i, /genera.*(informe|pdf|excel|csv)/i],
    async run(_q, _scope) {
      return {
        intent: "report",
        answer:
          "Puedo preparar los informes de resumen diario, SLA, rendimiento de proveedores, precisión del ETA, " +
          "predicción de demanda y recomendaciones. Abre Informes para elegir periodo y formato (web, CSV o Excel) " +
          "o para programar su envío periódico por correo.",
        link: "/connect/inteligencia/informes",
        dataUsed: ["Catálogo de informes del centro de inteligencia"],
      };
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Consultas auxiliares (siempre con el ámbito del usuario)
// ─────────────────────────────────────────────────────────────────────────────

async function loadAssistances(ids: number[], scope: OiScope): Promise<Array<{ id: number; status: string; workshop: string | null }>> {
  const params: unknown[] = [ids];
  let where = `ca.id = ANY($1::int[])`;
  if (scope.providerCompanyId) { params.push(scope.providerCompanyId); where += ` AND w."providerCompanyId" = $${params.length}`; }
  if (scope.clientId) { params.push(scope.clientId); where += ` AND ca."clientId" = $${params.length}`; }
  const r = await db.query(
    `SELECT ca.id, ca.status, w.name AS workshop
       FROM connect_assistances ca LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
      WHERE ${where}`,
    params,
  );
  return r.rows;
}

async function providerRanking(scope: OiScope, days: number): Promise<Array<{
  workshop: string; finished: number; slaPct: number | null; arrivalMin: number | null; score: number; revenue: number;
}>> {
  const since = Date.now() - days * DAY_MS;
  const params: unknown[] = [since];
  let where = `ca."createdAtMs" >= $1 AND ca.status <> 'draft'`;
  if (scope.providerCompanyId) { params.push(scope.providerCompanyId); where += ` AND w."providerCompanyId" = $${params.length}`; }
  if (scope.clientId) { params.push(scope.clientId); where += ` AND ca."clientId" = $${params.length}`; }
  const r = await db.query(
    `SELECT w.name AS workshop, w."currentScore" AS score,
            COUNT(*) FILTER (WHERE ca.status = 'finished')::int AS finished,
            COUNT(*) FILTER (WHERE ca."slaDeadlineAtMs" IS NOT NULL)::int AS n_sla,
            COUNT(*) FILTER (WHERE ca."slaDeadlineAtMs" IS NOT NULL AND arr."occurredAtMs" IS NOT NULL
                               AND arr."occurredAtMs" <= ca."slaDeadlineAtMs")::int AS sla_ok,
            AVG((arr."occurredAtMs" - ca."createdAtMs")/60000.0) AS arrival_min,
            COALESCE(SUM(COALESCE(ca."finalCost", ca."estimatedCost")) FILTER (WHERE ca.status = 'finished'), 0) AS revenue
       FROM connect_assistances ca
       JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN LATERAL (SELECT MIN("occurredAtMs") AS "occurredAtMs" FROM connect_status_history
          WHERE "assistanceId" = ca.id AND "toStatus" = 'arrived') arr ON true
      WHERE ${where}
      GROUP BY w.id, w.name, w."currentScore" ORDER BY finished DESC`,
    params,
  );
  return r.rows.map((x) => ({
    workshop: x.workshop,
    finished: x.finished,
    slaPct: x.n_sla > 0 ? Math.round((x.sla_ok / x.n_sla) * 100) : null,
    arrivalMin: x.arrival_min != null ? Number(x.arrival_min) : null,
    score: Number(x.score ?? 0),
    revenue: Number(x.revenue ?? 0),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación y ejecución
// ─────────────────────────────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function matchIntent(question: string): Intent | null {
  const q = question.trim();
  for (const intent of INTENTS) {
    if (intent.patterns.some((p) => p.test(q))) return intent;
  }
  return null;
}

/**
 * Clasificación asistida por LLM: solo elige entre las intenciones existentes.
 * No se le envían datos operativos, únicamente la pregunta del usuario.
 */
async function classifyWithLlm(question: string): Promise<Intent | null> {
  const client = getOpenAI();
  if (!client) return null;
  try {
    const list = INTENTS.map((i) => `- ${i.key}: ${i.description}`).join("\n");
    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Clasificas preguntas de un centro de control de asistencia en carretera. " +
            `Responde SOLO con la clave de una de estas intenciones, o con "none" si ninguna encaja:\n${list}`,
        },
        { role: "user", content: question },
      ],
    });
    const key = (r.choices[0]?.message?.content ?? "").trim().toLowerCase().replace(/[^a-z_]/g, "");
    return INTENTS.find((i) => i.key === key) ?? null;
  } catch (err: any) {
    console.error("[OI] asistente: clasificación LLM falló:", err?.message);
    return null;
  }
}

export interface AssistantContext {
  userId?: number | null;
  userName?: string | null;
  userRole?: string | null;
  controlCenterId?: number | null;
}

/** Punto de entrada del asistente: pregunta → respuesta con datos y trazas. */
export async function askAssistant(question: string, scope: OiScope, ctx: AssistantContext): Promise<AssistantAnswer> {
  const started = Date.now();
  const clean = String(question || "").slice(0, 500).trim();
  if (!clean) {
    return { intent: "empty", answer: "Escribe una pregunta sobre la operación.", dataUsed: [] };
  }

  let intent = matchIntent(clean);
  if (!intent) intent = await classifyWithLlm(clean);

  let answer: AssistantAnswer;
  if (!intent) {
    answer = {
      intent: "unknown",
      answer:
        "No he entendido la consulta. Puedo responder sobre: " +
        INTENTS.map((i) => i.description.toLowerCase()).join("; ") + ".",
      dataUsed: [],
      followUps: ["¿Cuántos servicios están retrasados?", "¿Qué zonas tienen mayor demanda?", "Resumen de hoy"],
    };
  } else {
    try {
      answer = await intent.run(clean, scope);
    } catch (err: any) {
      console.error("[OI] asistente: error ejecutando intención", intent.key, err?.message);
      answer = { intent: intent.key, answer: "No he podido completar la consulta por un error interno.", dataUsed: [] };
    }
  }

  // Registro de la consulta (seguridad y RGPD: qué se preguntó y con qué ámbito)
  await db.query(
    `INSERT INTO ai_assistant_query
       ("controlCenterId","userId","userName","userRole",question,intent,answer,"dataScope","durationMs","createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      ctx.controlCenterId ?? null, ctx.userId ?? null, ctx.userName ?? null, ctx.userRole ?? null,
      clean, answer.intent, answer.answer.slice(0, 4000), JSON.stringify(scope),
      Date.now() - started, Date.now(),
    ],
  ).catch((e) => console.error("[OI] no se pudo registrar la consulta:", e?.message));

  return answer;
}

/** Sugerencias que se muestran en el asistente vacío. */
export const ASSISTANT_SUGGESTIONS = [
  "¿Cuántos servicios están retrasados?",
  "¿Qué proveedor tiene peor cumplimiento esta semana?",
  "Muéstrame las zonas con mayor demanda",
  "¿Cuántas grúas están disponibles ahora?",
  "¿Por qué ha aumentado el tiempo medio de llegada?",
  "¿Qué zonas tienen cobertura insuficiente?",
  "¿Qué recomienda la IA ahora mismo?",
  "¿Cuál es la precisión del ETA?",
];
