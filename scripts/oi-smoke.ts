/**
 * Prueba de humo del Centro de Inteligencia Operacional.
 *
 * Crea el esquema completo de Connect + OI sobre la base de datos apuntada por
 * DATABASE_URL, siembra actividad sintética y ejecuta todos los motores (KPIs,
 * predicciones, recomendaciones, alertas, informes y asistente) verificando que
 * las consultas SQL son válidas y devuelven datos coherentes.
 *
 * Uso (nunca contra producción):
 *   DATABASE_URL=postgres://usuario@localhost:5432/mi_base npx tsx scripts/oi-smoke.ts
 */

import crypto from "node:crypto";
import db from "../server/db.ts";
import { initConnect } from "../server/connect/schema.ts";
import { initOperationalIntelligence } from "../server/connect/oi/schema.ts";
import { computeKpis, buildKpiCards, snapshotKpis, dailyTrend } from "../server/connect/oi/kpi.ts";
import { DASHBOARD_KPIS } from "../server/connect/oi/catalog.ts";
import {
  forecastDemand, computeDelayRisks, predictEta, evaluateEtaPredictions,
  evaluateDelayRiskPredictions, evaluateDemandPredictions, persistDemandForecast,
  modelAccuracy, refreshModelAccuracy, zoneSaturation,
} from "../server/connect/oi/predictions.ts";
import { generateRecommendations, recommendationStats, coverageOverview } from "../server/connect/oi/recommendations.ts";
import { runAlertRules } from "../server/connect/oi/alerts.ts";
import { generateReport, REPORT_CATALOG, reportToCsv } from "../server/connect/oi/reports.ts";
import { askAssistant, ASSISTANT_SUGGESTIONS } from "../server/connect/oi/assistant.ts";

const DAY = 86400_000;
const MIN = 60_000;
const now = Date.now();

const STATUS_FLOW = ["pending", "assigned", "en_route", "arrived", "in_progress", "finished"];

async function seed(): Promise<void> {
  const partner = (await db.query(
    `INSERT INTO connect_partners (uuid, name, "createdAtMs", "updatedAtMs") VALUES ($1,'Aseguradora Demo',$2,$2) RETURNING id`,
    [crypto.randomUUID(), now],
  )).rows[0].id;

  const provider = (await db.query(`SELECT id FROM connect_provider_companies ORDER BY id LIMIT 1`)).rows[0].id;

  const workshops: number[] = [];
  for (const [name, lat, lng] of [["Taller Tarragona", 41.118, 1.245], ["Taller Barcelona", 41.387, 2.168]] as Array<[string, number, number]>) {
    const w = (await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
      [name, lat, lng, provider, now],
    )).rows[0].id;
    workshops.push(w);
  }

  const client = (await db.query(
    `INSERT INTO connect_clients (name, "defaultSlaMinutes", "createdAtMs", "updatedAtMs")
     VALUES ('Cliente Demo', 45, $1, $1) RETURNING id`, [now],
  )).rows[0].id;

  for (let i = 0; i < 2; i++) {
    await db.query(
      `INSERT INTO connect_mobile_units ("providerCompanyId", name, plate, status, latitude, longitude, "lastReportAtMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [provider, `Grúa ${i + 1}`, `1234ABC${i}`, i === 0 ? "available" : "at_base", 41.12 + i * 0.2, 1.25 + i * 0.9, now - 3 * MIN, now],
    );
  }

  const types = ["tow_truck", "mechanical", "battery", "tyres"];
  // 240 asistencias repartidas en 45 días, con historial de estados realista
  for (let i = 0; i < 240; i++) {
    const created = now - Math.floor(Math.random() * 45) * DAY - Math.floor(Math.random() * 20) * 3600_000;
    const workshopId = workshops[i % workshops.length];
    const finished = i % 7 !== 0;
    const cancelled = i % 23 === 0;
    const status = cancelled ? "cancelled" : finished ? "finished" : STATUS_FLOW[i % 5];
    const sla = 45;
    const cost = 90 + Math.round(Math.random() * 120);

    const id = (await db.query(
      `INSERT INTO connect_assistances
         (uuid,"partnerId","clientId",status,priority,"serviceType",latitude,longitude,address,
          "customerName","workshopId","slaMinutes","slaDeadlineAtMs","estimatedCost","finalCost",
          "createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Autovía A-7, km 12','Cliente',$9,$10,$11,$12,$13,$14,$14)
       RETURNING id`,
      [
        crypto.randomUUID(), partner, client, status, i % 9 === 0 ? "urgente" : "normal", types[i % types.length],
        41.1 + (i % 2) * 0.28 + Math.random() * 0.05, 1.2 + (i % 2) * 0.9 + Math.random() * 0.05,
        workshopId, sla, created + sla * MIN, cost, finished ? cost + Math.round(Math.random() * 40) - 15 : null, created,
      ],
    )).rows[0].id;

    let t = created;
    const steps = cancelled ? ["pending", "assigned", "cancelled"] : STATUS_FLOW.slice(0, STATUS_FLOW.indexOf(status) + 1);
    for (const s of steps) {
      await db.query(
        `INSERT INTO connect_status_history ("assistanceId","toStatus","occurredAtMs") VALUES ($1,$2,$3)`,
        [id, s, t],
      );
      t += Math.round((5 + Math.random() * 25) * MIN);
    }

    await db.query(
      `INSERT INTO connect_assignments ("assistanceId","workshopId",rank,score,mode,status,"sentAtMs","respondedAtMs","createdAtMs")
       VALUES ($1,$2,1,80,'offer',$3,$4,$5,$4)`,
      [id, workshopId, i % 11 === 0 ? "rejected" : "accepted", created + 2 * MIN, created + Math.round((4 + Math.random() * 6) * MIN)],
    );

    if (i % 17 === 0) {
      await db.query(
        `INSERT INTO connect_incidents ("assistanceId","providerCompanyId","workshopId",type,severity,status,description,"createdAtMs","updatedAtMs")
         VALUES ($1,$2,$3,$4,'medium','open','Incidencia de prueba',$5,$5)`,
        [id, provider, workshopId, i % 34 === 0 ? "complaint" : "delay", created],
      );
    }
  }

  // Servicios activos ahora mismo: alimentan riesgo, alertas y tiempo real
  for (let i = 0; i < 6; i++) {
    const created = now - (10 + i * 12) * MIN;
    const id = (await db.query(
      `INSERT INTO connect_assistances
         (uuid,"partnerId","clientId",status,priority,"serviceType",latitude,longitude,address,"customerName",
          "workshopId","slaMinutes","slaDeadlineAtMs","estimatedCost","createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$4,'normal','tow_truck',41.12,1.26,'A-7 km 5','Cliente activo',$5,45,$6,120,$7,$7)
       RETURNING id`,
      [crypto.randomUUID(), partner, client, i < 3 ? "pending" : "en_route", workshops[0], created + 45 * MIN, created],
    )).rows[0].id;
    await db.query(
      `INSERT INTO connect_status_history ("assistanceId","toStatus","occurredAtMs") VALUES ($1,'pending',$2)`,
      [id, created],
    );
    if (i >= 3) {
      await db.query(
        `INSERT INTO connect_status_history ("assistanceId","toStatus","occurredAtMs") VALUES ($1,'assigned',$2),($1,'en_route',$3)`,
        [id, created + 5 * MIN, created + 12 * MIN],
      );
      await db.query(
        `UPDATE connect_mobile_units SET "activeAssistanceId" = $1, status = 'en_route_to_assistance' WHERE id = (SELECT MIN(id) FROM connect_mobile_units)`,
        [id],
      );
    }
  }
}

/**
 * Ejecuta las consultas que solo viven en el router (no en los motores), para
 * que un fallo de SQL en un endpoint no se descubra en producción.
 */
async function checkRouterQueries(): Promise<void> {
  // Umbrales por centro de control: alta y actualización idempotente
  for (let i = 0; i < 2; i++) {
    await db.query(
      `INSERT INTO operational_kpi_definition
         (code, name, description, category, formula, unit, direction,
          "targetValue","warningThreshold","criticalThreshold","controlCenterId",active,"createdAtMs","updatedAtMs")
       VALUES ('sla_compliance_pct','Cumplimiento de SLA','','operational','','%','up_good',97,0.05,0.15,1,true,$1,$1)
       ON CONFLICT (code, "controlCenterId") WHERE "controlCenterId" IS NOT NULL
       DO UPDATE SET "targetValue" = EXCLUDED."targetValue", "updatedAtMs" = EXCLUDED."updatedAtMs"`,
      [now],
    );
  }
  const overrides = await db.query(
    `SELECT code, "targetValue" FROM operational_kpi_definition WHERE "controlCenterId" = $1`, [1]);
  check("umbrales por centro de control (upsert idempotente)", overrides.rows.length === 1, `objetivo ${overrides.rows[0]?.targetValue}`);

  // Listado de alertas con responsable y contadores
  const alerts = await db.query(
    `SELECT a.*, u.name AS "assignedUserName" FROM operational_alert a
       LEFT JOIN connect_users u ON u.id = a."assignedUserId"
      WHERE ($1 = 'all' OR a.status = $1) AND ($2::text IS NULL OR a.category = $2)
      ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, a.id DESC LIMIT $3`,
    ["open", null, 50],
  );
  check("listado de alertas", Array.isArray(alerts.rows), `${alerts.rows.length} abiertas`);

  if (alerts.rows[0]) {
    const id = alerts.rows[0].id;
    await db.query(
      `UPDATE operational_alert SET comments = (COALESCE(NULLIF(comments, ''), '[]')::jsonb || $2::jsonb)::text WHERE id = $1`,
      [id, JSON.stringify([{ by: "smoke", text: "comprobación", atMs: now }])],
    );
    const c = await db.query(`SELECT comments FROM operational_alert WHERE id = $1`, [id]);
    // El script puede ejecutarse varias veces sobre la misma base: basta con
    // comprobar que el comentario se ha añadido a la lista.
    check("comentarios de alerta", JSON.parse(c.rows[0].comments).length >= 1);
  }

  // Servicios y unidades del tiempo real
  const live = await db.query(
    `SELECT ca.id, ca.status, w.name AS workshop, mu.name AS "unitName"
       FROM connect_assistances ca
       LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
       LEFT JOIN connect_mobile_units mu ON mu."activeAssistanceId" = ca.id
      WHERE ca.status IN ('pending','en_route') ORDER BY ca."createdAtMs"`,
  );
  check("consulta de operación en tiempo real", live.rows.length > 0, `${live.rows.length} activos`);

  // Tarifa vigente usada por la recomendación de asignación
  const tariff = await db.query(
    `SELECT tl."baseAmount", tl."perKmAmount" FROM connect_tariff_lines tl
       JOIN connect_provider_authorizations pa ON pa.id = tl."authorizationId"
       JOIN connect_workshops w ON w."providerCompanyId" = pa."providerCompanyId"
      WHERE w.id = $1 AND tl."serviceTypeCode" = $2 AND tl.active LIMIT 1`,
    [1, "tow_truck"],
  );
  check("consulta de tarifa para el coste estimado", Array.isArray(tariff.rows));

  // Programación de informes
  await db.query(
    `INSERT INTO operational_report_schedule
       ("reportKind",name,frequency,"hourUtc",recipients,format,filters,"nextRunAtMs","createdAtMs","updatedAtMs")
     VALUES ('resumen_diario','Resumen diario','daily',6,$1,'csv','{}',$2,$3,$3)`,
    [JSON.stringify(["demo@example.com"]), now + 3600_000, now],
  );
  const schedules = await db.query(`SELECT * FROM operational_report_schedule ORDER BY id DESC`);
  check("programación de informes", schedules.rows.length > 0);

  // Registro de modelos y feedback
  const models = await db.query(`SELECT * FROM ai_model_registry ORDER BY "modelType"`);
  check("registro de modelos", models.rows.length === 5, `${models.rows.length} modelos`);
  const feedback = await db.query(
    `SELECT accepted, COUNT(*)::int AS n FROM ai_feedback WHERE "createdAtMs" >= $1 GROUP BY 1`, [now - 30 * DAY]);
  check("agregado de feedback", Array.isArray(feedback.rows));

  // Decisión sobre una recomendación (aceptar) y su feedback asociado
  const rec = await db.query(`SELECT id FROM ai_recommendation WHERE status = 'pending' ORDER BY id LIMIT 1`);
  if (rec.rows[0]) {
    const { decideRecommendation } = await import("../server/connect/oi/recommendations.ts");
    const out = await decideRecommendation({ id: rec.rows[0].id, accept: true, userId: null, userName: "smoke" });
    check("aceptar recomendación registra feedback", out.ok);
    const fb = await db.query(`SELECT * FROM ai_feedback WHERE "recommendationId" = $1`, [rec.rows[0].id]);
    check("feedback persistido", fb.rows.length === 1);
  }

  // Histórico de consultas del asistente
  const history = await db.query(
    `SELECT id, "userName", question, intent FROM ai_assistant_query ORDER BY id DESC LIMIT 10`);
  check("histórico del asistente", Array.isArray(history.rows));
}

function check(label: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) process.exitCode = 1;
}

async function main(): Promise<void> {
  console.log("→ Esquema");
  await initConnect();
  await initOperationalIntelligence();

  const seeded = await db.query(`SELECT COUNT(*)::int AS n FROM connect_assistances`);
  if (seeded.rows[0].n === 0) {
    console.log("→ Sembrando datos de prueba");
    await seed();
  }

  console.log("\n→ Motor de KPIs");
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const monthFilters = { from: now - 30 * DAY, to: now };
  const kpis = await computeKpis(monthFilters);
  check("computeKpis devuelve todo el catálogo", Object.keys(kpis).length > 40, `${Object.keys(kpis).length} KPIs`);
  check("services_received tiene valor", kpis.services_received.value != null, `${kpis.services_received.value}`);
  check("sla_compliance_pct calculado", kpis.sla_compliance_pct.value != null, `${kpis.sla_compliance_pct.value} %`);
  check("avg_arrival_min calculado", kpis.avg_arrival_min.value != null, `${kpis.avg_arrival_min.value} min`);
  check("KPIs sin fuente marcados no disponibles", kpis.customer_satisfaction.available === false, kpis.customer_satisfaction.missingData ?? "");

  const cards = await buildKpiCards(DASHBOARD_KPIS, monthFilters);
  check("buildKpiCards con semáforo y comparativas", cards.length === DASHBOARD_KPIS.length,
    cards.map((c) => `${c.code}:${c.status}`).slice(0, 4).join(" "));
  check("snapshotKpis persiste fotos", (await snapshotKpis("live", { from: dayStart.getTime(), to: now })) > 0);
  check("snapshotKpis es idempotente", (await snapshotKpis("live", { from: dayStart.getTime(), to: now })) > 0);
  const trend = await dailyTrend(monthFilters, 30);
  check("dailyTrend devuelve serie diaria", trend.length > 0, `${trend.length} días`);

  console.log("\n→ Predicciones");
  const demand = await forecastDemand({ hours: 12 });
  check("forecastDemand por zona y franja", demand.length > 0, `${demand.length} franjas`);
  check("intervalos de confianza coherentes", demand.every((d) => d.confidenceMin <= d.predicted && d.predicted <= d.confidenceMax));
  check("persistDemandForecast guarda predicciones", (await persistDemandForecast(demand.slice(0, 5))) === 5);

  const risks = await computeDelayRisks({ persist: true });
  check("computeDelayRisks sobre servicios activos", risks.length > 0, `${risks.length} activos, top ${risks[0]?.level}`);
  check("cada riesgo va explicado", risks.every((r) => r.explanation.length > 10));

  const activeId = risks[0]?.assistanceId;
  const eta = activeId ? await predictEta(activeId, { persist: true }) : null;
  check("predictEta devuelve ETA con factores", !!eta && eta.factors.length > 0, eta?.explanation.slice(0, 90));

  check("evaluateEtaPredictions no falla", (await evaluateEtaPredictions()) >= 0);
  check("evaluateDelayRiskPredictions no falla", (await evaluateDelayRiskPredictions()) >= 0);
  check("evaluateDemandPredictions no falla", (await evaluateDemandPredictions()) >= 0);
  check("modelAccuracy consultable", Array.isArray(await modelAccuracy(30)));
  check("refreshModelAccuracy no falla", (await refreshModelAccuracy()) >= 0);
  check("zoneSaturation por zona", Object.keys(await zoneSaturation()).length > 0);

  console.log("\n→ Recomendaciones y alertas");
  const created = await generateRecommendations();
  check("generateRecommendations ejecuta las reglas", created >= 0, `${created} nuevas`);
  check("generateRecommendations deduplica", (await generateRecommendations()) === 0);
  check("recommendationStats consultable", Array.isArray(await recommendationStats(30)));
  check("coverageOverview por zona", (await coverageOverview()).length > 0);

  const alerts = await runAlertRules();
  check("runAlertRules genera alertas", alerts >= 0, `${alerts} nuevas`);
  check("runAlertRules deduplica", (await runAlertRules()) === 0);

  console.log("\n→ Informes");
  const scope = { controlCenterId: null, providerCompanyId: null, clientId: null, role: "cc_admin", full: true };
  for (const r of REPORT_CATALOG) {
    const report = await generateReport(r.kind, monthFilters, scope);
    check(`informe ${r.kind}`, !!report && Array.isArray(report.rows), `${report?.rows.length ?? 0} filas`);
    if (report && r.kind === "resumen_diario") check("CSV serializable", reportToCsv(report).includes(";"));
  }

  console.log("\n→ Consultas propias de la API");
  await checkRouterQueries();

  console.log("\n→ Asistente");
  for (const q of ASSISTANT_SUGGESTIONS) {
    const a = await askAssistant(q, scope, { userName: "smoke", userRole: "cc_admin" });
    check(`"${q}"`, a.intent !== "unknown" && a.answer.length > 0, `[${a.intent}] ${a.answer.slice(0, 70)}`);
  }

  console.log("\nPrueba de humo completada.");
  await db.end?.();
}

main().catch((err) => {
  console.error("Fallo en la prueba de humo:", err);
  process.exit(1);
});
