import type {
  AssignmentRole,
  Job,
  OperationSummary,
  Tech,
  TechClosureStat,
  TechHoursSummary,
  TechLoadStat,
  TechOperationStat,
} from "./workshopTypes";

import {
  getElapsedMinutes,
  isSameOrAfter,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "./time";

import {
  getOperationKey,
  getOperationLabel,
} from "./jobHelpers";

export function buildOperationReport(closedJobs: Job[]): OperationSummary[] {
  const bucket = new Map<
    string,
    { label: string; total: number; count: number; last: number | null }
  >();

  for (const job of closedJobs) {
    if (job.actualMinutes == null) continue;

    const key = getOperationKey(job);
    const label = getOperationLabel(job);

    const current = bucket.get(key) || {
      label,
      total: 0,
      count: 0,
      last: null,
    };

    current.total += job.actualMinutes;
    current.count += 1;
    current.last = job.actualMinutes;

    bucket.set(key, current);
  }

  return [...bucket.entries()]
    .map(([key, item]) => ({
      key,
      label: item.label,
      count: item.count,
      averageMinutes: item.total / item.count,
      lastMinutes: item.last,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export function buildTechStats(closedJobs: Job[]) {
  const stats = new Map<
    string,
    {
      operation: string;
      fastestTech: string;
      bestTime: number;
      averageMinutes: number;
    }
  >();

  const bucket = new Map<
    string,
    { total: number; count: number; techTimes: Record<string, number[]> }
  >();

  for (const job of closedJobs) {
    if (job.actualMinutes == null || !job.assignedNames?.length) continue;

    const key = getOperationKey(job);
    const tech = job.assignedNames[0];

    if (!bucket.has(key)) {
      bucket.set(key, { total: 0, count: 0, techTimes: {} });
    }

    const item = bucket.get(key)!;

    item.total += job.actualMinutes;
    item.count++;

    if (!item.techTimes[tech]) {
      item.techTimes[tech] = [];
    }

    item.techTimes[tech].push(job.actualMinutes);
  }

  for (const [operation, data] of bucket.entries()) {
    let fastestTech = "";
    let bestAvg = Infinity;

    for (const tech in data.techTimes) {
      const times = data.techTimes[tech];
      const avg = times.reduce((a, b) => a + b, 0) / times.length;

      if (avg < bestAvg) {
        bestAvg = avg;
        fastestTech = tech;
      }
    }

    stats.set(operation, {
      operation,
      fastestTech,
      bestTime: bestAvg,
      averageMinutes: data.total / data.count,
    });
  }

  return Array.from(stats.values());
}

export function buildTechLoadStats(jobs: Job[], techs: Tech[]): TechLoadStat[] {
  const active = jobs.filter((job) => job.status === "activo");

  return techs.map((tech) => {
    const assignedJobs = active.filter((job) =>
      (job.assignedNames ?? []).includes(tech.name)
    );

    const totalOpenMinutes = assignedJobs.reduce((sum, job) => {
      return sum + (getElapsedMinutes(job.startedAtMs || job.createdAtMs) ?? 0);
    }, 0);

    return {
      techName: tech.name,
      activeCount: assignedJobs.length,
      totalOpenMinutes,
    };
  });
}

export function buildTechHoursReport(
  closedJobs: Job[],
  techs: Tech[]
): TechHoursSummary[] {
  const now = new Date();
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const report = new Map<string, TechHoursSummary>();

  for (const tech of techs) {
    report.set(tech.name, {
      name: tech.name,
      responsable: { daily: 0, weekly: 0, monthly: 0 },
      apoyo: { daily: 0, weekly: 0, monthly: 0 },
    });
  }

  for (const job of closedJobs) {
    if (
      job.actualMinutes == null ||
      !job.closedAtMs ||
      (job.assignedNames ?? []).length === 0
    ) {
      continue;
    }

    const responsableName = (job.assignedNames ?? [])[0];
    const supportNames = (job.assignedNames ?? []).slice(1);

    const addTime = (techName: string, role: AssignmentRole) => {
      const item = report.get(techName);

      if (!item) return;

      if (isSameOrAfter(job.closedAtMs, dayStart)) {
        item[role].daily += job.actualMinutes || 0;
      }

      if (isSameOrAfter(job.closedAtMs, weekStart)) {
        item[role].weekly += job.actualMinutes || 0;
      }

      if (isSameOrAfter(job.closedAtMs, monthStart)) {
        item[role].monthly += job.actualMinutes || 0;
      }
    };

    addTime(responsableName, "responsable");

    for (const name of supportNames) {
      addTime(name, "apoyo");
    }
  }

  return [...report.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "es")
  );
}

export function buildTechOperationStats(closedJobs: Job[]): TechOperationStat[] {
  const bucket = new Map<
    string,
    {
      techName: string;
      operationKey: string;
      operationLabel: string;
      totalMinutes: number;
      count: number;
    }
  >();

  for (const job of closedJobs) {
    if (
      job.actualMinutes == null ||
      job.actualMinutes <= 0 ||
      !job.assignedNames ||
      job.assignedNames.length === 0
    ) {
      continue;
    }

    const operationKey = getOperationKey(job);
    const operationLabel = getOperationLabel(job);

    for (const techName of job.assignedNames) {
      const key = `${techName}__${operationKey}`;

      const current = bucket.get(key) ?? {
        techName,
        operationKey,
        operationLabel,
        totalMinutes: 0,
        count: 0,
      };

      current.totalMinutes += job.actualMinutes;
      current.count += 1;

      bucket.set(key, current);
    }
  }

  return [...bucket.values()]
    .map((item) => ({
      ...item,
      averageMinutes: item.count > 0 ? item.totalMinutes / item.count : 0,
    }))
    .sort((a, b) => a.averageMinutes - b.averageMinutes);
}

export function buildTechClosureStats(
  closedJobs: Job[],
  techs: Tech[]
): TechClosureStat[] {
  const bucket = new Map<
    string,
    { techName: string; closedCount: number; totalMinutes: number }
  >();

  for (const tech of techs) {
    bucket.set(tech.name, {
      techName: tech.name,
      closedCount: 0,
      totalMinutes: 0,
    });
  }

  for (const job of closedJobs) {
    if (!job.assignedNames || job.assignedNames.length === 0) continue;

    for (const techName of job.assignedNames) {
      const current = bucket.get(techName) ?? {
        techName,
        closedCount: 0,
        totalMinutes: 0,
      };

      current.closedCount += 1;
      current.totalMinutes += job.actualMinutes ?? 0;

      bucket.set(techName, current);
    }
  }

  return [...bucket.values()]
    .map((item) => ({
      ...item,
      averageMinutes:
        item.closedCount > 0 ? item.totalMinutes / item.closedCount : 0,
    }))
    .sort((a, b) => b.closedCount - a.closedCount);
}