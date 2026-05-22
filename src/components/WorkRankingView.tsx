import { useMemo, useState } from "react";
import type { Job, QuickTemplate, Tech } from "../modules/workshopTypes";

type OperationLabelJob = Pick<Job, "template" | "area" | "quickEntryLabel">;

type Props = {
  jobs: Job[];
  techs: Tech[];
  quickTemplates: QuickTemplate[];
  getOperationLabel: (job: OperationLabelJob) => string;
  onBack: () => void;
};

type RankingRow = {
  techName: string;
  totalPoints: number;
  responsiblePoints: number;
  supportPoints: number;
  responsibleCount: number;
  supportCount: number;
  jobsCount: number;
};

type DetailRow = {
  jobId: number;
  dateLabel: string;
  plate: string;
  operationLabel: string;
  techName: string;
  role: "responsable" | "apoyo";
  basePoints: number;
  factor: number;
  finalPoints: number;
};

const AREA_FACTORS: Record<Job["area"], number> = {
  camion: 1.5,
  movil: 1.25,
  tacografo: 1.1,
  turismo: 1,
  mecanica: 1.25,
};

const TEMPLATE_FACTORS: Record<string, number> = {
  alineacion_camion: 1.25,
  pinchazo_camion: 0.75,
};

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getStartOfCurrentMonth() {
  const now = new Date();
  return formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

function getToday() {
  return formatDateInput(new Date());
}

function getStartOfPreviousMonth() {
  const now = new Date();
  return formatDateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}

function getEndOfPreviousMonth() {
  const now = new Date();
  return formatDateInput(new Date(now.getFullYear(), now.getMonth(), 0));
}

function getStartOfYear() {
  const now = new Date();
  return formatDateInput(new Date(now.getFullYear(), 0, 1));
}

function getClosedDateMs(job: Job) {
  return Number(job.closedAtMs ?? 0);
}

function getCorrectionFactor(job: Job, quickTemplates: QuickTemplate[]) {
  const templateKey = String(job.template ?? "").trim();

  if (templateKey && TEMPLATE_FACTORS[templateKey] != null) {
    return TEMPLATE_FACTORS[templateKey];
  }

  const quickLabel = String(job.quickEntryLabel ?? "").trim().toLowerCase();

  const quickTemplate = quickTemplates.find(
    (template) => template.label.trim().toLowerCase() === quickLabel
  );

  if (quickTemplate?.key && TEMPLATE_FACTORS[quickTemplate.key] != null) {
    return TEMPLATE_FACTORS[quickTemplate.key];
  }

  return AREA_FACTORS[job.area] ?? 1;
}

function formatPoints(value: number) {
  return value.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";

  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WorkRankingView({
  jobs,
  techs,
  quickTemplates,
  getOperationLabel,
  onBack,
}: Props) {
  const [fromDate, setFromDate] = useState(getStartOfCurrentMonth());
  const [toDate, setToDate] = useState(getToday());

  const { rankingRows, detailRows, closedJobsCount, totalPoints } =
    useMemo(() => {
      const fromMs = new Date(`${fromDate}T00:00:00`).getTime();
      const toMs = new Date(`${toDate}T23:59:59`).getTime();

      const closedJobs = jobs
        .filter((job) => job.status === "cerrado")
        .filter((job) => {
          const closedMs = getClosedDateMs(job);

          if (!Number.isFinite(closedMs) || closedMs <= 0) return false;

          return closedMs >= fromMs && closedMs <= toMs;
        })
        .sort((a, b) => getClosedDateMs(b) - getClosedDateMs(a));

      const rankingMap = new Map<string, RankingRow>();
      const details: DetailRow[] = [];

      const ensureRow = (techName: string) => {
        const existing = rankingMap.get(techName);

        if (existing) return existing;

        const row: RankingRow = {
          techName,
          totalPoints: 0,
          responsiblePoints: 0,
          supportPoints: 0,
          responsibleCount: 0,
          supportCount: 0,
          jobsCount: 0,
        };

        rankingMap.set(techName, row);

        return row;
      };

      for (const job of closedJobs) {
        const assignedNames = Array.isArray(job.assignedNames)
          ? job.assignedNames.filter(Boolean)
          : [];

        if (assignedNames.length === 0) continue;

        const factor = getCorrectionFactor(job, quickTemplates);
        const operationLabel = getOperationLabel(job);

        assignedNames.forEach((techName, index) => {
          const role = index === 0 ? "responsable" : "apoyo";
          const basePoints = role === "responsable" ? 1 : 0.5;
          const finalPoints = basePoints * factor;

          const row = ensureRow(techName);

          row.totalPoints += finalPoints;
          row.jobsCount += 1;

          if (role === "responsable") {
            row.responsiblePoints += finalPoints;
            row.responsibleCount += 1;
          } else {
            row.supportPoints += finalPoints;
            row.supportCount += 1;
          }

          details.push({
            jobId: job.id,
            dateLabel: formatDateTime(getClosedDateMs(job)),
            plate: job.plate,
            operationLabel,
            techName,
            role,
            basePoints,
            factor,
            finalPoints,
          });
        });
      }

      const rows = Array.from(rankingMap.values()).sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) {
          return b.totalPoints - a.totalPoints;
        }

        return a.techName.localeCompare(b.techName, "es");
      });

      return {
        rankingRows: rows,
        detailRows: details,
        closedJobsCount: closedJobs.length,
        totalPoints: rows.reduce((sum, row) => sum + row.totalPoints, 0),
      };
    }, [jobs, quickTemplates, getOperationLabel, fromDate, toDate]);

  const knownTechNames = new Set(techs.map((tech) => tech.name));

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black">
              Ranking trabajos cerrados
            </h1>
            <p className="text-sm font-semibold text-slate-500">
              Responsable = 1 punto · Apoyo = 0,5 puntos · Aplicando factor por
              tipo de trabajo
            </p>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
          >
            Volver
          </button>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm font-bold text-slate-600">
              Desde
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300"
              />
            </label>

            <label className="grid gap-1 text-sm font-bold text-slate-600">
              Hasta
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                setFromDate(getStartOfCurrentMonth());
                setToDate(getToday());
              }}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-100"
            >
              Este mes
            </button>

            <button
              type="button"
              onClick={() => {
                setFromDate(getStartOfPreviousMonth());
                setToDate(getEndOfPreviousMonth());
              }}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-100"
            >
              Mes anterior
            </button>

            <button
              type="button"
              onClick={() => {
                setFromDate(getStartOfYear());
                setToDate(getToday());
              }}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-100"
            >
              Año actual
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-400">
                Trabajos cerrados
              </div>
              <div className="text-3xl font-black">{closedJobsCount}</div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-400">
                Puntos totales
              </div>
              <div className="text-3xl font-black">
                {formatPoints(totalPoints)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-400">
                Técnicos puntuando
              </div>
              <div className="text-3xl font-black">{rankingRows.length}</div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-black">Ranking</h2>
            <span className="text-xs font-bold text-slate-400">
              Ordenado por puntos
            </span>
          </div>

          {rankingRows.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">
              No hay trabajos cerrados en el rango seleccionado.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Técnico</th>
                    <th className="px-4 py-3 text-right">Puntos</th>
                    <th className="px-4 py-3 text-right">Resp.</th>
                    <th className="px-4 py-3 text-right">Apoyo</th>
                    <th className="px-4 py-3 text-right">Trabajos</th>
                  </tr>
                </thead>

                <tbody>
                  {rankingRows.map((row, index) => (
                    <tr
                      key={row.techName}
                      className="border-t border-slate-100"
                    >
                      <td className="px-4 py-3 font-black text-slate-400">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3 font-black">
                        {row.techName}
                        {!knownTechNames.has(row.techName) && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
                            Histórico
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-lg font-black">
                        {formatPoints(row.totalPoints)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.responsibleCount} ·{" "}
                        {formatPoints(row.responsiblePoints)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.supportCount} · {formatPoints(row.supportPoints)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {row.jobsCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-black">Detalle histórico</h2>
            <span className="text-xs font-bold text-slate-400">
              {detailRows.length} líneas de puntuación
            </span>
          </div>

          <div className="max-h-[520px] overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha cierre</th>
                  <th className="px-4 py-3">Matrícula</th>
                  <th className="px-4 py-3">Trabajo</th>
                  <th className="px-4 py-3">Técnico</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3 text-right">Base</th>
                  <th className="px-4 py-3 text-right">Factor</th>
                  <th className="px-4 py-3 text-right">Puntos</th>
                </tr>
              </thead>

              <tbody>
                {detailRows.map((row) => (
                  <tr
                    key={`${row.jobId}-${row.techName}-${row.role}`}
                    className="border-t border-slate-100"
                  >
                    <td className="px-4 py-3 font-bold text-slate-500">
                      {row.dateLabel}
                    </td>
                    <td className="px-4 py-3 font-black">{row.plate}</td>
                    <td className="px-4 py-3">{row.operationLabel}</td>
                    <td className="px-4 py-3 font-bold">{row.techName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                          row.role === "responsable"
                            ? "bg-slate-900 text-white"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {row.role === "responsable" ? "Responsable" : "Apoyo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatPoints(row.basePoints)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      x{formatPoints(row.factor)}
                    </td>
                    <td className="px-4 py-3 text-right font-black">
                      {formatPoints(row.finalPoints)}
                    </td>
                  </tr>
                ))}

                {detailRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-10 text-center text-sm font-bold text-slate-400"
                    >
                      Sin detalle para este rango de fechas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}