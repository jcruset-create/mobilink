import type {
  AISuggestion,
  Job,
  OperationSummary,
  QuickTemplate,
  Tech,
  TechClosureStat,
  TechLoadStat,
  TechOperationStat,
  WorkshopAlert,
} from "./workshopTypes";

import { formatMinutes, getElapsedMinutes } from "./time";

import {
  getCompetencyTargetKey,
  getOperationKey,
  getPredictedTimeForJob,
  getQuickTemplateForJob,
} from "./jobHelpers";

export function buildWorkshopAlerts({
  waitingJobs,
  runningJobs,
  techLoadStats,
  operationReport,
}: {
  waitingJobs: Job[];
  runningJobs: Job[];
  techLoadStats: TechLoadStat[];
  operationReport: OperationSummary[];
}): WorkshopAlert[] {
  const alerts: WorkshopAlert[] = [];

  const waitingMovil = waitingJobs.filter((job) => job.area === "movil").length;
  const waitingCamion = waitingJobs.filter((job) => job.area === "camion").length;
  const waitingTacografo = waitingJobs.filter(
    (job) => job.area === "tacografo"
  ).length;

  if (waitingMovil >= 2) {
    alerts.push({
      id: "movil-collapsed",
      level: "danger",
      text: "Móvil colapsado: hay 2 o más trabajos esperando.",
    });
  }

  if (waitingCamion >= 3) {
    alerts.push({
      id: "camion-saturated",
      level: "warning",
      text: "Camión saturado: la cola de espera está creciendo.",
    });
  }

  if (waitingTacografo >= 2) {
    alerts.push({
      id: "tacografo-load",
      level: "warning",
      text: "Tacógrafo tensionado: conviene vigilar la carga.",
    });
  }

  const overloaded = techLoadStats
    .filter((item) => item.activeCount >= 2)
    .sort((a, b) => b.activeCount - a.activeCount);

  if (overloaded[0]) {
    alerts.push({
      id: "tech-overloaded",
      level: "warning",
      text: `${overloaded[0].techName} está muy cargado (${overloaded[0].activeCount} trabajos activos).`,
    });
  }

  const longRunning = runningJobs
    .map((job) => {
      const prediction = getPredictedTimeForJob(job, operationReport);
      const elapsed = getElapsedMinutes(job.startedAtMs || job.createdAtMs) ?? 0;

      return {
        job,
        elapsed,
        predicted: prediction.predictedMinutes,
      };
    })
    .filter(
      (item) =>
        item.predicted != null && item.elapsed > (item.predicted ?? 0) * 1.4
    )
    .sort((a, b) => b.elapsed - a.elapsed);

  if (longRunning[0]) {
    alerts.push({
      id: `job-delayed-${longRunning[0].job.id}`,
      level: "danger",
      text: `Trabajo ${longRunning[0].job.plate} va retrasado frente al tiempo previsto.`,
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      id: "all-good",
      level: "info",
      text: "Sin alertas críticas en este momento.",
    });
  }

  return alerts;
}

export function buildAiRanking(techOperationStats: TechOperationStat[]) {
  const bestForOperation = (matcher: (item: TechOperationStat) => boolean) =>
    techOperationStats.filter(matcher).slice(0, 3);

  return {
    alineacion: bestForOperation(
      (item) =>
        item.operationKey === "template:alineacion_camion" ||
        item.operationLabel.toLowerCase().includes("alineación")
    ),
    movil: bestForOperation(
      (item) =>
        item.operationKey === "area:movil" ||
        item.operationLabel.toLowerCase().includes("móvil")
    ),
    tacografo: bestForOperation(
      (item) =>
        item.operationKey === "area:tacografo" ||
        item.operationLabel.toLowerCase().includes("tacógrafo")
    ),
  };
}

export function buildAiSuggestions({
  aiRanking,
  techOperationStats,
  techClosureStats,
}: {
  aiRanking: ReturnType<typeof buildAiRanking>;
  techOperationStats: TechOperationStat[];
  techClosureStats: TechClosureStat[];
}): AISuggestion[] {
  const suggestions: AISuggestion[] = [];

  const bestAlineacion = aiRanking.alineacion[0];
  const bestMovil = aiRanking.movil[0];
  const bestTacografo = aiRanking.tacografo[0];

  if (bestAlineacion) {
    suggestions.push({
      id: "best-alineacion",
      text: `Sugerencia IA: ${bestAlineacion.techName} es el más rápido en ${bestAlineacion.operationLabel} (${formatMinutes(bestAlineacion.averageMinutes)} de media).`,
    });
  }

  if (bestMovil) {
    suggestions.push({
      id: "best-movil",
      text: `Sugerencia IA: ${bestMovil.techName} destaca en móvil (${formatMinutes(bestMovil.averageMinutes)} de media).`,
    });
  }

  if (bestTacografo) {
    suggestions.push({
      id: "best-tacografo",
      text: `Sugerencia IA: ${bestTacografo.techName} destaca en tacógrafo (${formatMinutes(bestTacografo.averageMinutes)} de media).`,
    });
  }

  const tacografoLoads = techOperationStats
    .filter((item) => item.operationKey === "area:tacografo")
    .sort((a, b) => b.count - a.count);

  if (tacografoLoads[0] && tacografoLoads[0].count >= 3) {
    suggestions.push({
      id: "load-tacografo",
      text: `Sugerencia IA: ${tacografoLoads[0].techName} está absorbiendo muchos tacógrafos (${tacografoLoads[0].count} cierres).`,
    });
  }

  const topCloser = techClosureStats[0];

  if (topCloser && topCloser.closedCount > 0) {
    suggestions.push({
      id: "top-closer",
      text: `Sugerencia IA: ${topCloser.techName} es quien más trabajos cierra (${topCloser.closedCount}).`,
    });
  }

  const slowest = [...techClosureStats]
    .filter((item) => item.closedCount > 0)
    .sort((a, b) => b.averageMinutes - a.averageMinutes)[0];

  if (slowest) {
    suggestions.push({
      id: "slowest-tech",
      text: `Sugerencia IA: ${slowest.techName} tiene la media más alta por trabajo (${formatMinutes(slowest.averageMinutes)}).`,
    });
  }

  return suggestions;
}

export function getRecommendedTechForJob(
  job: Pick<Job, "area" | "template" | "quickEntryLabel">,
  techs: Tech[],
  quickTemplates: QuickTemplate[],
  techOperationStats: TechOperationStat[]
): string | null {
  const templateConfig = getQuickTemplateForJob(job, quickTemplates);
  const targetKey = getCompetencyTargetKey(job, quickTemplates);

  let candidates = techs.filter((tech) => {
    if (tech.blocked) return false;
    if (tech.name === "Ramón") return false;
    if (tech.status !== "disponible") return false;
    if (!tech.competencies[targetKey]?.responsable) return false;

    if (templateConfig?.allowedTechs?.length) {
      if (!templateConfig.allowedTechs.includes(tech.name)) return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    const ramon = techs.find((tech) => {
      if (tech.name !== "Ramón") return false;
      if (tech.blocked) return false;
      if (tech.currentJobId != null) return false;
      if (!["disponible", "supervisor"].includes(tech.status)) return false;

      return true;
    });

    return ramon ? ramon.name : null;
  }

  const operationKey = getOperationKey(job);

  const ranked = techOperationStats
    .filter((item) => item.operationKey === operationKey)
    .filter((item) => candidates.some((tech) => tech.name === item.techName))
    .sort((a, b) => a.averageMinutes - b.averageMinutes);

  if (ranked.length > 0) {
    return ranked[0].techName;
  }

  if (templateConfig?.priorityOrder?.length) {
    const fromTemplate = templateConfig.priorityOrder.find((name) =>
      candidates.some((tech) => tech.name === name)
    );

    if (fromTemplate) return fromTemplate;
  }

  return candidates[0]?.name ?? null;
}

export function buildRecommendedTechByJobId({
  runningJobs,
  techs,
  quickTemplates,
  techOperationStats,
}: {
  runningJobs: Job[];
  techs: Tech[];
  quickTemplates: QuickTemplate[];
  techOperationStats: TechOperationStat[];
}): Record<number, string | null> {
  const result: Record<number, string | null> = {};

  for (const job of runningJobs) {
    result[job.id] = getRecommendedTechForJob(
      job,
      techs,
      quickTemplates,
      techOperationStats
    );
  }

  return result;
}