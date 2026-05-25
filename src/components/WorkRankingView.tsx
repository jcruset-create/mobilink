import { useMemo, useState } from "react";
import type { Job, QuickTemplate, Tech } from "../modules/workshopTypes";
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
    };
  }, [jobs, getOperationLabel, fromDate, toDate, selectedTechName]);

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
      </div>
    </div>
  );
}