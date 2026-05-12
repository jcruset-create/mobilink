type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";

type JobStatus =
  | "espera"
  | "activo"
  | "cerrado"
  | "parado"
  | "validacion"
  | "cancelado";

type JobForHistory = {
  id: number;
  area: AreaKey;
  plate: string;
  urgent?: boolean;
  status: JobStatus | string;
  assignedNames?: string[];
  reason?: string;
  createdAtMs?: number | null;
  startedAtMs?: number | null;
  closedAtMs?: number | null;
  actualMinutes?: number | null;
  workedAccumulatedMinutes?: number | null;
  pausedAccumulatedMinutes?: number | null;
  quickEntryLabel?: string | null;
  template?: any;
  includedTasks?: {
    id: string;
    label: string;
    standardMinutes?: number | null;
  }[];
};

type OperationLabelJob = Pick<
  JobForHistory,
  "template" | "area" | "quickEntryLabel"
>;

type Props = {
  jobs: JobForHistory[];
  getOperationLabel: (job: OperationLabelJob) => string;
  onBack: () => void;
};

function formatClock(ms?: number | null) {
  if (!ms) return "-";

  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMinutes(minutes?: number | null) {
  if (minutes == null) return "-";

  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} h`;

  return `${h} h ${m} min`;
}

function getAreaBadgeClass(area: AreaKey) {
  if (area === "camion") return "bg-red-100 text-red-700";
  if (area === "movil") return "bg-amber-100 text-amber-700";
  if (area === "tacografo") return "bg-orange-100 text-orange-700";
  if (area === "turismo") return "bg-sky-100 text-sky-700";
  if (area === "mecanica") return "bg-emerald-100 text-emerald-700";

  return "bg-slate-100 text-slate-700";
}

function HistoryCard({
  job,
  getOperationLabel,
  variant,
}: {
  job: JobForHistory;
  getOperationLabel: (job: OperationLabelJob) => string;
  variant: "finished" | "cancelled";
}) {
  const assignedNames = job.assignedNames ?? [];
  const isCancelled = variant === "cancelled";

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        isCancelled
          ? "border-red-200 bg-red-50"
          : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-black tracking-wide text-slate-950">
            {job.plate || "Sin matrícula"}
          </div>

          <div className="mt-1 text-sm font-bold text-slate-700">
            {getOperationLabel(job)}
          </div>
        </div>

        <span
          className={`rounded-full px-3 py-1 text-xs font-black uppercase ${getAreaBadgeClass(
            job.area
          )}`}
        >
          {job.area}
        </span>
      </div>

      {job.urgent && (
        <div className="mb-3 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-700">
          URGENTE
        </div>
      )}

      <div className="grid gap-2 text-sm md:grid-cols-2">
        <div className="rounded-xl bg-white/80 px-3 py-2">
          <span className="font-bold text-slate-600">Creado:</span>{" "}
          {formatClock(job.createdAtMs)}
        </div>

        <div className="rounded-xl bg-white/80 px-3 py-2">
          <span className="font-bold text-slate-600">
            {isCancelled ? "Cancelado:" : "Finalizado:"}
          </span>{" "}
          {formatClock(job.closedAtMs)}
        </div>

        <div className="rounded-xl bg-white/80 px-3 py-2">
          <span className="font-bold text-slate-600">Trabajado:</span>{" "}
          {formatMinutes(job.workedAccumulatedMinutes ?? job.actualMinutes)}
        </div>

        <div className="rounded-xl bg-white/80 px-3 py-2">
          <span className="font-bold text-slate-600">Parado:</span>{" "}
          {formatMinutes(job.pausedAccumulatedMinutes)}
        </div>
      </div>

      {assignedNames.length > 0 && (
        <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm">
          <span className="font-bold text-slate-600">Técnicos:</span>{" "}
          {assignedNames.join(" + ")}
        </div>
      )}

      {job.includedTasks && job.includedTasks.length > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-800">
          <span className="font-bold">Tareas incluidas:</span>{" "}
          {job.includedTasks.map((task) => task.label).join(" + ")}
        </div>
      )}

      {job.reason && (
        <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-xs text-slate-600">
          <span className="font-bold">Motivo:</span> {job.reason}
        </div>
      )}
    </div>
  );
}
function getDayKeyFromMs(value?: number | null) {
  if (!value) return "sin-fecha";

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDayLabel(dayKey: string) {
  if (dayKey === "sin-fecha") return "Sin fecha";

  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function groupJobsByDay<
  T extends { closedAtMs?: number | null; createdAtMs?: number | null }
>(jobs: T[], useClosedDate: boolean) {
  const groups = new Map<string, T[]>();

  for (const job of jobs) {
    const ms = useClosedDate
      ? job.closedAtMs ?? job.createdAtMs ?? null
      : job.createdAtMs ?? job.closedAtMs ?? null;

    const dayKey = getDayKeyFromMs(ms);

    if (!groups.has(dayKey)) {
      groups.set(dayKey, []);
    }

    groups.get(dayKey)!.push(job);
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dayKey, items]) => ({
      dayKey,
      label: formatDayLabel(dayKey),
      items,
    }));
}

export default function FinishedAndCancelledJobsView({
  jobs,
  getOperationLabel,
  onBack,
}: Props) {
  const finishedJobs = jobs
    .filter((job) => job.status === "cerrado")
    .slice()
    .sort((a, b) => (b.closedAtMs ?? 0) - (a.closedAtMs ?? 0));

  const cancelledJobs = jobs
    .filter((job) => job.status === "cancelado")
    .slice()
    .sort((a, b) => (b.closedAtMs ?? b.createdAtMs ?? 0) - (a.closedAtMs ?? a.createdAtMs ?? 0));
  const finishedGroups = groupJobsByDay(finishedJobs, true);
  const cancelledGroups = groupJobsByDay(cancelledJobs, false);
  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="sticky top-3 z-50 flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black">
              Trabajos terminados y cancelados
            </h1>
            <p className="text-sm text-slate-500">
              Histórico de la jornada y trabajos cerrados.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="rounded-2xl bg-emerald-100 px-4 py-2 text-sm font-black text-emerald-700">
              Terminados {finishedJobs.length}
            </div>

            <div className="rounded-2xl bg-red-100 px-4 py-2 text-sm font-black text-red-700">
              Cancelados {cancelledJobs.length}
            </div>

            <button
              type="button"
              onClick={onBack}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Volver
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black text-emerald-900">
                Terminados
              </h2>

              <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-black text-emerald-700">
                {finishedJobs.length}
              </span>
            </div>

            <div className="max-h-[calc(100vh-220px)] space-y-5 overflow-y-auto pr-2">
  {finishedGroups.length === 0 ? (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">
      No hay trabajos terminados.
    </div>
  ) : (
    finishedGroups.map((group) => (
      <div
        key={group.dayKey}
        className="rounded-3xl border border-emerald-100 bg-emerald-50/50 p-3"
      >
        <div className="sticky top-0 z-10 mb-3 flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-100 px-4 py-2">
          <h3 className="text-sm font-black capitalize text-emerald-900">
            {group.label}
          </h3>

          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-700">
            {group.items.length} trabajos
          </span>
        </div>

        <div className="space-y-4">
          {group.items.map((job) => (
            <HistoryCard
              key={job.id}
              job={job}
              getOperationLabel={getOperationLabel}
              variant="finished"
            />
          ))}
        </div>
      </div>
    ))
  )}
</div>
          </section>

          <section className="rounded-3xl border border-red-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-black text-red-900">
                Cancelados
              </h2>

              <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-black text-red-700">
                {cancelledJobs.length}
              </span>
            </div>

            <div className="max-h-[calc(100vh-220px)] space-y-5 overflow-y-auto pr-2">
  {cancelledGroups.length === 0 ? (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">
      No hay trabajos cancelados.
    </div>
  ) : (
    cancelledGroups.map((group) => (
      <div
        key={group.dayKey}
        className="rounded-3xl border border-red-100 bg-red-50/50 p-3"
      >
        <div className="sticky top-0 z-10 mb-3 flex items-center justify-between rounded-2xl border border-red-200 bg-red-100 px-4 py-2">
          <h3 className="text-sm font-black capitalize text-red-900">
            {group.label}
          </h3>

          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-red-700">
            {group.items.length} trabajos
          </span>
        </div>

        <div className="space-y-4">
          {group.items.map((job) => (
            <HistoryCard
              key={job.id}
              job={job}
              getOperationLabel={getOperationLabel}
              variant="cancelled"
            />
          ))}
        </div>
      </div>
    ))
  )}
</div>
          </section>
        </div>
      </div>
    </div>
  );
}