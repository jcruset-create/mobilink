import { apiFetch } from "../modules/apiFetch";
import { useEffect, useMemo, useState } from "react";
import type { Job, QuickTemplate, Tech } from "../modules/workshopTypes";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

/** Máximo de minutos que se contabilizan a un solo trabajo (evita datos corruptos
 *  de trabajos que quedaron abiertos y acumularon horas irreales). Equivale a una
 *  jornada completa del centro. */
const MAX_MINUTES_PER_JOB = 480;

type MaintTask = {
  techName: string;
  assignedAtMs: number;
  status: string;
  statusChangedAtMs?: number | null;
};

type SchedTechStatus = {
  techName: string;
  status: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

/** Estados que cuentan como ausencia (no disponible para trabajar en el taller). */
const ABSENCE_STATUS_LABELS: Record<string, string> = {
  vacaciones: "Vacaciones",
  baja: "Baja",
  permiso: "Permiso",
  nodisponible: "No disponible",
  otro_taller: "Otro taller",
};

const ABSENCE_STATUS_COLORS: Record<string, string> = {
  vacaciones: "bg-sky-100 text-sky-700",
  baja: "bg-red-100 text-red-700",
  permiso: "bg-amber-100 text-amber-700",
  nodisponible: "bg-slate-200 text-slate-600",
  otro_taller: "bg-violet-100 text-violet-700",
};

function isAbsenceStatus(status: string): boolean {
  return status in ABSENCE_STATUS_LABELS;
}

type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";

const AREA_LABELS: Record<AreaKey, string> = {
  camion: "Camión",
  movil: "Móvil",
  tacografo: "Tacógrafo",
  turismo: "Turismo",
  mecanica: "Mecánica",
};

const AREA_COLORS: Record<AreaKey, string> = {
  camion: "bg-red-100 text-red-800",
  movil: "bg-amber-100 text-amber-800",
  tacografo: "bg-orange-100 text-orange-800",
  turismo: "bg-sky-100 text-sky-800",
  mecanica: "bg-emerald-100 text-emerald-800",
};

const ALL_AREAS: AreaKey[] = ["camion", "movil", "tacografo", "turismo", "mecanica"];

function formatMinutesShort(minutes: number) {
  if (minutes <= 0) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
import { getWorkV2MoneyLabel } from "../modules/workV2Calculations";
import { buildWorkRankingV2Rows } from "../modules/workRankingV2Helpers";

type OperationLabelJob = Pick<Job, "template" | "area" | "quickEntryLabel">;

type Props = {
  jobs: Job[];
  techs: Tech[];
  quickTemplates: QuickTemplate[];
  getOperationLabel: (job: OperationLabelJob) => string;
  onBack: () => void;
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

/** Minutos del horario del centro para un día de la semana JS (0=Dom,...,6=Sáb) */
function workshopMinutesForDayOfWeek(jsDay: number): number {
  if (jsDay === 0) return 0; // domingo cerrado
  if (jsDay === 6) return 240; // sábado media jornada (4 h)
  // lunes-viernes: jornada de 8 horas
  return 480;
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

function formatPercent(value: number) {
  return value.toLocaleString("es-ES", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQuantity(value: number) {
  return value.toLocaleString("es-ES", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export default function WorkRankingView({
  jobs,
  techs,
  quickTemplates: _quickTemplates,
  getOperationLabel,
  onBack,
}: Props) {
  const [fromDate, setFromDate] = useState(getStartOfCurrentMonth());
  const [toDate, setToDate] = useState(getToday());
  const [selectedTechName, setSelectedTechName] = useState("");
  const [maintTasks, setMaintTasks] = useState<MaintTask[]>([]);
  const [techStatuses, setTechStatuses] = useState<SchedTechStatus[]>([]);

  useEffect(() => {
    async function loadMaint() {
      try {
        const res = await apiFetch(`${API_BASE}/api/assigned-maintenance-tasks`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setMaintTasks(data);
      } catch {
        // silencioso
      }
    }
    async function loadStatuses() {
      try {
        const res = await apiFetch(`${API_BASE}/api/scheduled-tech-statuses`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setTechStatuses(data);
      } catch {
        // silencioso
      }
    }
    void loadMaint();
    void loadStatuses();
  }, []);

  const filterTechNames = useMemo(() => {
    const names = new Set<string>();

    techs.forEach((tech) => {
      if (tech.name) names.add(tech.name);
    });

    jobs.forEach((job) => {
      (job.assignedNames ?? []).forEach((name) => {
        if (name) names.add(name);
      });
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b, "es"));
  }, [jobs, techs]);

  const {
    rankingRows,
    detailRows,
    closedJobsCount,
    realTotalRevenue,
    assignedTotalRevenue,
    timeRows,
  } = useMemo(() => {
    const fromMs = new Date(`${fromDate}T00:00:00`).getTime();
    const toMs = new Date(`${toDate}T23:59:59`).getTime();

    const closedJobs = jobs
      .filter((job) => job.status === "cerrado")
      .filter((job) => {
        const closedMs = getClosedDateMs(job);

        if (!Number.isFinite(closedMs) || closedMs <= 0) return false;

        return closedMs >= fromMs && closedMs <= toMs;
      })
      .filter((job) => {
        if (!selectedTechName) return true;

        return (job.assignedNames ?? []).includes(selectedTechName);
      })
      .sort((a, b) => getClosedDateMs(b) - getClosedDateMs(a));

    const rankingResult = buildWorkRankingV2Rows({
      jobs: closedJobs,
      selectedTechName,
    });

    // ── Tiempo por técnico × área ─────────────────────────────────────
    // Para cada trabajo cerrado, sumamos los minutos trabajados
    // (workedAccumulatedMinutes o actualMinutes) al técnico responsable.
    // Si hay varios técnicos, se reparte: responsable cuenta 100%, apoyo 50%.
    const emptyAreas = (): Record<AreaKey, number> => ({
      camion: 0, movil: 0, tacografo: 0, turismo: 0, mecanica: 0,
    });
    const timeByTechArea: Record<string, Record<AreaKey, number>> = {};
    const countByTechArea: Record<string, Record<AreaKey, number>> = {};

    for (const job of closedJobs) {
      const area = job.area as AreaKey;
      if (!ALL_AREAS.includes(area)) continue;

      const names = job.assignedNames ?? [];
      if (names.length === 0) continue;

      const rawWorkedMin =
        Number(job.workedAccumulatedMinutes ?? job.actualMinutes ?? 0);
      if (rawWorkedMin <= 0) continue;
      // Limitamos el tiempo por trabajo para descartar datos corruptos
      // (trabajos que quedaron abiertos y acumularon horas irreales).
      const workedMin = Math.min(rawWorkedMin, MAX_MINUTES_PER_JOB);

      // Reparto: responsable = primer nombre (peso 1), resto = apoyo (peso 0.5)
      const totalWeight = 1 + (names.length - 1) * 0.5;

      names.forEach((name, idx) => {
        const weight = idx === 0 ? 1 : 0.5;
        const techMin = Math.round((workedMin * weight) / totalWeight);

        if (!timeByTechArea[name]) timeByTechArea[name] = emptyAreas();
        if (!countByTechArea[name]) countByTechArea[name] = emptyAreas();
        timeByTechArea[name][area] += techMin;
        countByTechArea[name][area] += 1;
      });
    }

    // ── Tiempo de mantenimiento por técnico ───────────────────────────
    // Tareas de mantenimiento finalizadas/interrumpidas dentro del rango.
    const maintByTech: Record<string, number> = {};
    const maintCountByTech: Record<string, number> = {};
    for (const task of maintTasks) {
      const endMs = task.statusChangedAtMs ?? null;
      // Sólo contamos tareas terminadas dentro del período filtrado.
      if (endMs == null || !Number.isFinite(endMs)) continue;
      if (endMs < fromMs || endMs > toMs) continue;
      if (selectedTechName && task.techName !== selectedTechName) continue;
      const durMin = Math.min(
        Math.max(0, Math.round((endMs - task.assignedAtMs) / 60000)),
        MAX_MINUTES_PER_JOB
      );
      if (durMin <= 0) continue;
      maintByTech[task.techName] = (maintByTech[task.techName] ?? 0) + durMin;
      maintCountByTech[task.techName] = (maintCountByTech[task.techName] ?? 0) + 1;
    }

    // ── Disponibilidad por técnico (descontando ausencias) ────────────
    // Días laborables del período con sus minutos de jornada.
    const workingDays: { date: string; minutes: number }[] = [];
    {
      const cur = new Date(`${fromDate}T00:00:00`);
      const end = new Date(`${toDate}T00:00:00`);
      while (cur <= end) {
        const mins = workshopMinutesForDayOfWeek(cur.getDay());
        if (mins > 0) {
          const y = cur.getFullYear();
          const m = String(cur.getMonth() + 1).padStart(2, "0");
          const d = String(cur.getDate()).padStart(2, "0");
          workingDays.push({ date: `${y}-${m}-${d}`, minutes: mins });
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    function absenceForTechOnDate(techName: string, date: string): string | null {
      for (const st of techStatuses) {
        if (st.techName !== techName) continue;
        if (!isAbsenceStatus(st.status)) continue;
        if (st.startDate && st.endDate && st.startDate <= date && date <= st.endDate) {
          return st.status;
        }
      }
      return null;
    }

    function computeTechAvailability(techName: string) {
      let available = 0;
      const absenceMinutesByStatus: Record<string, number> = {};
      for (const wd of workingDays) {
        const abs = absenceForTechOnDate(techName, wd.date);
        if (abs) {
          absenceMinutesByStatus[abs] = (absenceMinutesByStatus[abs] ?? 0) + wd.minutes;
        } else {
          available += wd.minutes;
        }
      }
      return { available, absenceMinutesByStatus };
    }

    // Unimos: todos los técnicos conocidos + los que tienen trabajos/mantenimiento
    const allTechNames = new Set<string>([
      ...techs.map((t) => t.name).filter(Boolean),
      ...Object.keys(timeByTechArea),
      ...Object.keys(maintByTech),
    ]);
    const filteredTechNames = selectedTechName
      ? [selectedTechName]
      : Array.from(allTechNames);

    // Convertimos a array ordenado por total desc
    const timeRows = filteredTechNames
      .map((techName) => {
        const areas = timeByTechArea[techName] ?? emptyAreas();
        const counts = countByTechArea[techName] ?? emptyAreas();
        const mantenimiento = maintByTech[techName] ?? 0;
        const mantenimientoCount = maintCountByTech[techName] ?? 0;
        const areasTotal = Object.values(areas).reduce((a, b) => a + b, 0);
        const areasCount = Object.values(counts).reduce((a, b) => a + b, 0);
        const { available, absenceMinutesByStatus } = computeTechAvailability(techName);
        return {
          techName,
          areas,
          counts,
          mantenimiento,
          mantenimientoCount,
          total: areasTotal + mantenimiento,
          totalCount: areasCount + mantenimientoCount,
          available,
          absenceMinutesByStatus,
        };
      })
      .sort((a, b) => b.total - a.total);

    return {
      rankingRows: rankingResult.rankingRows,
      detailRows: rankingResult.detailRows.map((row) => {
        const job = closedJobs.find((item) => item.id === row.jobId);

        return {
          ...row,
          dateLabel: job ? formatDateTime(getClosedDateMs(job)) : "-",
          operationLabel: job ? getOperationLabel(job) : "-",
        };
      }),
      closedJobsCount: closedJobs.length,
      realTotalRevenue: rankingResult.realTotalRevenue,
      assignedTotalRevenue: rankingResult.assignedTotalRevenue,
      timeRows,
    };
  }, [jobs, techs, getOperationLabel, fromDate, toDate, selectedTechName, maintTasks, techStatuses]);

  const knownTechNames = new Set(techs.map((tech) => tech.name));

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black">
              Ranking facturación operarios
            </h1>
            <p className="text-sm font-semibold text-slate-500">
              Reparto real proporcional: responsable peso 1 · apoyo peso 0,5 ·
              sin factor de corrección
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

            <label className="grid gap-1 text-sm font-bold text-slate-600">
              Operario
              <select
                value={selectedTechName}
                onChange={(event) => setSelectedTechName(event.target.value)}
                className="min-w-[190px] rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">Todos</option>

                {filterTechNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
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

            {selectedTechName && (
              <button
                type="button"
                onClick={() => setSelectedTechName("")}
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700 hover:bg-red-100"
              >
                Quitar operario
              </button>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-400">
                Trabajos cerrados
              </div>
              <div className="text-3xl font-black">{closedJobsCount}</div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-400">
                Facturación real
              </div>
              <div className="text-3xl font-black">
                {getWorkV2MoneyLabel(realTotalRevenue)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-400">
                Facturación asignada
              </div>
              <div className="text-3xl font-black">
                {getWorkV2MoneyLabel(assignedTotalRevenue)}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase text-slate-400">
                Técnicos facturando
              </div>
              <div className="text-3xl font-black">{rankingRows.length}</div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-black">
              {selectedTechName
                ? `Ranking de ${selectedTechName}`
                : "Ranking"}
            </h2>
            <span className="text-xs font-bold text-slate-400">
              Ordenado por facturación asignada
            </span>
          </div>

          {rankingRows.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">
              No hay trabajos cerrados con facturación en el rango seleccionado.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Técnico</th>
                    <th className="px-4 py-3 text-right">Fact. asignada</th>
                    <th className="px-4 py-3 text-right">Fact. real trabajos</th>
                    <th className="px-4 py-3 text-right">Resp.</th>
                    <th className="px-4 py-3 text-right">Apoyo</th>
                    <th className="px-4 py-3 text-right">Cantidad</th>
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
                        {getWorkV2MoneyLabel(row.assignedRevenue)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold">
                        {getWorkV2MoneyLabel(row.realRevenue)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {row.responsibleCount} ·{" "}
                        {getWorkV2MoneyLabel(row.responsibleRevenue)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {row.supportCount} ·{" "}
                        {getWorkV2MoneyLabel(row.supportRevenue)}
                      </td>

                      <td className="px-4 py-3 text-right font-bold">
                        {formatQuantity(row.quantityTotal)}
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
            <h2 className="text-xl font-black">
              {selectedTechName
                ? `Detalle histórico de ${selectedTechName}`
                : "Detalle histórico"}
            </h2>
            <span className="text-xs font-bold text-slate-400">
              {detailRows.length} líneas de facturación
            </span>
          </div>

          <div className="max-h-[520px] overflow-auto rounded-2xl border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha cierre</th>
                  <th className="px-4 py-3">Matrícula</th>
                  <th className="px-4 py-3">Trabajo</th>
                  <th className="px-4 py-3 text-right">Cantidad</th>
                  <th className="px-4 py-3 text-right">Precio unidad</th>
                  <th className="px-4 py-3 text-right">Importe trabajo</th>
                  <th className="px-4 py-3">Técnico</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3 text-right">% reparto</th>
                  <th className="px-4 py-3 text-right">Importe asignado</th>
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

                    <td className="px-4 py-3 text-right font-bold">
                      {row.quantityLabel}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {getWorkV2MoneyLabel(row.unitPrice)}
                    </td>

                    <td className="px-4 py-3 text-right font-bold">
                      {getWorkV2MoneyLabel(row.totalPrice)}
                    </td>

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
                      {formatPercent(row.shareRatio)}
                    </td>

                    <td className="px-4 py-3 text-right font-black">
                      {getWorkV2MoneyLabel(row.assignedAmount)}
                    </td>
                  </tr>
                ))}

                {detailRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
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

        {/* ── Tiempo por técnico y área ─────────────────────────────── */}
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black">Tiempo por área</h2>
              <p className="text-sm text-slate-500">
                Minutos trabajados y nº de intervenciones (×N) por operario
                desglosados por tipo de trabajo · responsable 100 % · apoyo 50 %
                · incluye mantenimiento · máx. {Math.floor(MAX_MINUTES_PER_JOB / 60)}h por trabajo
              </p>
            </div>
          </div>

          {timeRows.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-400">
              Sin datos para este período.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-black uppercase text-slate-400">
                    <th className="pb-3 pr-4">Técnico</th>
                    {ALL_AREAS.map((area) => (
                      <th key={area} className="pb-3 px-3 text-right">
                        <span className={`rounded-full px-2 py-0.5 ${AREA_COLORS[area]}`}>
                          {AREA_LABELS[area]}
                        </span>
                      </th>
                    ))}
                    <th className="pb-3 px-3 text-right">
                      <span className="rounded-full px-2 py-0.5 bg-violet-100 text-violet-700">Mantenim.</span>
                    </th>
                    <th className="pb-3 pl-3 text-right">Total</th>
                    <th className="pb-3 pl-3 text-right">
                      <span className="rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">Disponible</span>
                    </th>
                    <th className="pb-3 pl-3 text-right">
                      <span className="rounded-full px-2 py-0.5 bg-indigo-100 text-indigo-700">Uso %</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {timeRows.map((row, i) => {
                    const maxTotal = timeRows[0]?.total ?? 1;
                    return (
                      <tr
                        key={row.techName}
                        className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
                      >
                        <td className="py-3 pr-4 font-black">{row.techName}</td>
                        {ALL_AREAS.map((area) => {
                          const min = row.areas[area];
                          const cnt = row.counts[area];
                          return (
                            <td key={area} className="px-3 py-3 text-right">
                              {min > 0 ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-black ${AREA_COLORS[area]}`}>
                                    {formatMinutesShort(min)}
                                  </span>
                                  <span className="text-[10px] font-bold text-slate-400">
                                    ×{cnt}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-right">
                          {row.mantenimiento > 0 ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className="inline-block rounded-lg px-2 py-0.5 text-xs font-black bg-violet-100 text-violet-700">
                                {formatMinutesShort(row.mantenimiento)}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">
                                ×{row.mantenimientoCount}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="pl-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* barra proporcional */}
                            <div className="hidden md:block w-24 rounded-full bg-slate-100 h-2">
                              <div
                                className="h-2 rounded-full bg-slate-700"
                                style={{ width: `${Math.round((row.total / maxTotal) * 100)}%` }}
                              />
                            </div>
                            <span className="font-black text-slate-900">
                              {formatMinutesShort(row.total)}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400">
                              ×{row.totalCount}
                            </span>
                          </div>
                        </td>
                        <td className="pl-3 py-3 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-slate-600 text-xs font-bold">
                              {formatMinutesShort(row.available)}
                            </span>
                            {Object.entries(row.absenceMinutesByStatus).map(([st, mins]) => (
                              <span
                                key={st}
                                className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-black ${ABSENCE_STATUS_COLORS[st] ?? "bg-slate-100 text-slate-600"}`}
                                title={`${ABSENCE_STATUS_LABELS[st] ?? st}: ${formatMinutesShort(mins)} no disponibles`}
                              >
                                {ABSENCE_STATUS_LABELS[st] ?? st} {formatMinutesShort(mins)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="pl-3 py-3 text-right">
                          {row.available > 0 ? (
                            (() => {
                              const pct = Math.round((row.total / row.available) * 100);
                              const color = pct >= 80 ? "bg-emerald-100 text-emerald-800" : pct >= 50 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
                              return (
                                <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-black ${color}`}>
                                  {pct}%
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 font-black">
                    <td className="pt-3 pr-4 text-slate-500">TOTAL</td>
                    {ALL_AREAS.map((area) => {
                      const total = timeRows.reduce((s, r) => s + r.areas[area], 0);
                      const cnt = timeRows.reduce((s, r) => s + r.counts[area], 0);
                      return (
                        <td key={area} className="px-3 pt-3 text-right">
                          {total > 0 ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-black ${AREA_COLORS[area]}`}>
                                {formatMinutesShort(total)}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">×{cnt}</span>
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 pt-3 text-right">
                      {(() => {
                        const tot = timeRows.reduce((s, r) => s + r.mantenimiento, 0);
                        const cnt = timeRows.reduce((s, r) => s + r.mantenimientoCount, 0);
                        return tot > 0 ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="inline-block rounded-lg px-2 py-0.5 text-xs font-black bg-violet-100 text-violet-700">
                              {formatMinutesShort(tot)}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400">×{cnt}</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        );
                      })()}
                    </td>
                    <td className="pl-3 pt-3 text-right font-black text-slate-900">
                      <div className="flex items-center justify-end gap-1">
                        <span>{formatMinutesShort(timeRows.reduce((s, r) => s + r.total, 0))}</span>
                        <span className="text-[10px] font-bold text-slate-400">
                          ×{timeRows.reduce((s, r) => s + r.totalCount, 0)}
                        </span>
                      </div>
                    </td>
                    <td className="pl-3 pt-3 text-right text-xs font-bold text-slate-400">
                      {formatMinutesShort(timeRows.reduce((s, r) => s + r.available, 0))}
                    </td>
                    <td className="pl-3 pt-3 text-right">
                      {(() => {
                        const totAvail = timeRows.reduce((s, r) => s + r.available, 0);
                        const totWorked = timeRows.reduce((s, r) => s + r.total, 0);
                        if (totAvail <= 0) return <span className="text-slate-300">—</span>;
                        const pct = Math.round((totWorked / totAvail) * 100);
                        const color = pct >= 80 ? "bg-emerald-100 text-emerald-800" : pct >= 50 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";
                        return (
                          <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-black ${color}`}>{pct}%</span>
                        );
                      })()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}