/**
 * Centro de Inteligencia Operacional — punto de entrada del submódulo.
 *
 * Se integra dentro de Connect Pro, no como servicio aparte: comparte base de
 * datos, sesión, roles y worker. Desde server/connect/index.ts basta con:
 *   initOperationalIntelligence()  (tras initConnect)
 *   app.use("/api/operational-intelligence", createOperationalIntelligenceRouter())
 *   runIntelligenceCycle()          (en cada tick del worker de Connect)
 */

export { initOperationalIntelligence } from "./schema.ts";
export { createOperationalIntelligenceRouter } from "./router.ts";
export { runIntelligenceCycle } from "./worker.ts";
export { KPI_CATALOG, DASHBOARD_KPIS } from "./catalog.ts";
export { computeKpis, buildKpiCards, snapshotKpis } from "./kpi.ts";
export { forecastDemand, predictEta, computeDelayRisks } from "./predictions.ts";
export { generateRecommendations } from "./recommendations.ts";
export { runAlertRules } from "./alerts.ts";
export { askAssistant } from "./assistant.ts";
export { generateReport, REPORT_CATALOG } from "./reports.ts";
