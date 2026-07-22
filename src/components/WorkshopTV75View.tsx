import { apiFetch } from "../modules/apiFetch";
import { useEffect, useState } from "react";

type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";

type JobForTV75 = {
  id: number;
  plate: string;
  area: AreaKey;
  status: string;
  urgent?: boolean;
  assignedNames?: string[];
  quickEntryLabel?: string | null;
  template?: any;
  reason?: string;
  startedAtMs?: number | null;
  createdAtMs?: number | null;
  standardMinutes?: number | null;
  predictedMinutes?: number | null;
  aiMinutes?: number | null;
  estimatedMinutes?: number | null;
  actualMinutes?: number | null;

  // Valores calculados desde SeaTarragonaV1 para pantallas.
  // Tienen prioridad sobre los fallbacks antiguos.
  screenEstimatedMinutes?: number | null;
  screenAiMinutes?: number | null;
  screenPrevistoMinutes?: number | null;
};

type TechForTV75 = {
  name: string;
  status: string;
  currentJobId?: number | null;
  avatar?: string | null;
};

type OperationLabelJob = Pick<
  JobForTV75,
  "template" | "area" | "quickEntryLabel"
>;

type Props = {
  jobs: JobForTV75[];
  techs: TechForTV75[];
  finishJob: (jobId: number) => void;
  moveJobToStandBy: (jobId: number) => void;
  getOperationLabel: (job: OperationLabelJob) => string;
  onBack?: () => void;
  onLogout?: () => void;
};

type MaintenanceTaskType = "en_taller" | "fuera_taller";

type AssignedMaintenanceTaskStatus =
  | "pendiente"
  | "finalizada"
  | "interrumpida";

type AssignedMaintenanceTask = {
  id: string;
  taskId: string;
  taskLabel: string;
  taskType: MaintenanceTaskType;
  techName: string;
  assignedAtMs: number;
  status: AssignedMaintenanceTaskStatus;
  statusChangedAtMs?: number | null;
};

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

function normalizeStatus(status?: string) {
  return (status || "").toLowerCase().trim();
}

function getAreaLabel(area: AreaKey) {
  if (area === "camion") return "Camión";
  if (area === "movil") return "Móvil";
  if (area === "tacografo") return "Tacógrafo";
  if (area === "turismo") return "Turismo";
  if (area === "mecanica") return "Mecánica";

  return area;
}

function getAreaClass(area: AreaKey) {
  if (area === "camion") return "bg-red-100 text-red-700";
  if (area === "movil") return "bg-amber-100 text-amber-700";
  if (area === "tacografo") return "bg-orange-100 text-orange-700";
  if (area === "turismo") return "bg-sky-100 text-sky-700";
  if (area === "mecanica") return "bg-emerald-100 text-emerald-700";

  return "bg-slate-100 text-slate-700";
}

function getTechStatusLabel(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "disponible") return "DISPONIBLE";
  if (normalized === "ocupado") return "OCUPADO";
  if (normalized === "refuerzo") return "REFUERZO";
  if (normalized === "supervisor") return "SUPERVISOR";
  if (normalized === "permiso") return "PERMISO";
  if (normalized === "vacaciones") return "VACACIONES";
  if (normalized === "baja") return "BAJA";
  if (normalized === "otro_taller") return "EN OTRO TALLER";
  if (normalized === "en_otro_taller") return "EN OTRO TALLER";
  if (normalized === "nodisponible") return "NO DISPONIBLE";

  return (status || "-").toUpperCase();
}

function getTechCardClass(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "disponible" || normalized === "supervisor") {
    return "border-green-300 bg-green-200 text-green-950";
  }

  if (normalized === "ocupado") {
    return "border-red-300 bg-red-200 text-red-950";
  }

  if (normalized === "refuerzo") {
    return "border-amber-300 bg-amber-200 text-amber-950";
  }

  return "border-slate-300 bg-slate-200 text-slate-800";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getAvatarUrl(tech?: TechForTV75 | null) {
  if (!tech?.avatar) return "";
  if (tech.avatar.startsWith("http")) return tech.avatar;

  return `${API_BASE}${tech.avatar}`;
}

function TechAvatar({
  tech,
  size = "normal",
}: {
  tech?: TechForTV75 | null;
  size?: "normal" | "large";
}) {
  const imageUrl = getAvatarUrl(tech);
  const sizeClass =
    size === "large" ? "h-12 w-12 text-lg" : "h-10 w-10 text-sm";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={tech?.name || "Técnico"}
        className={`${sizeClass} rounded-full border border-white/80 object-cover shadow-sm`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} flex items-center justify-center rounded-full border border-white/80 bg-white/80 font-black shadow-sm`}
    >
      {getInitials(tech?.name || "?")}
    </div>
  );
}

function getWorkedMinutes(job: JobForTV75) {
  if (!job.startedAtMs) return 0;

  const startedAtMs = Number(job.startedAtMs);

  if (!Number.isFinite(startedAtMs)) return 0;

  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 60000));
}

function formatMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;

  if (hours <= 0) return `${mins} min`;

  return `${hours} h ${mins} min`;
}

function getPositiveMinutes(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return Math.round(numberValue);
}

function getEstimatedMinutes(job: JobForTV75) {
  const candidates = [
    job.screenEstimatedMinutes,
    job.screenPrevistoMinutes,
    job.estimatedMinutes,
    job.standardMinutes,
    job.actualMinutes,
    job.predictedMinutes,
    job.aiMinutes,
  ];

  for (const value of candidates) {
    const minutes = getPositiveMinutes(value);

    if (minutes != null) {
      return minutes;
    }
  }

  return 0;
}

function getAiMinutes(job: JobForTV75) {
  const candidates = [
    job.screenAiMinutes,
    job.screenEstimatedMinutes,
    job.screenPrevistoMinutes,
    job.aiMinutes,
    job.predictedMinutes,
    job.estimatedMinutes,
    job.standardMinutes,
    job.actualMinutes,
  ];

  for (const value of candidates) {
    const minutes = getPositiveMinutes(value);

    if (minutes != null) {
      return minutes;
    }
  }

  return getEstimatedMinutes(job);
}

function isJobDelayed(job: JobForTV75) {
  const workedMinutes = getWorkedMinutes(job);
  const estimatedMinutes = getEstimatedMinutes(job);

  if (estimatedMinutes <= 0) return false;

  return workedMinutes > estimatedMinutes;
}

function formatMaintenanceTime(task: AssignedMaintenanceTask, nowMs: number) {
  const endMs =
    task.status === "pendiente"
      ? nowMs
      : task.statusChangedAtMs ?? task.assignedAtMs;

  const minutes = Math.max(0, Math.floor((endMs - task.assignedAtMs) / 60000));

  return formatMinutes(minutes);
}

function getMaintenanceTaskTypeLabel(type: MaintenanceTaskType) {
  if (type === "fuera_taller") return "Fuera de taller";
  return "Mantenimiento";
}

async function fetchMaintenanceJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await apiFetch(`${API_BASE}${url}`);

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

function SmallJobCard({
  job,
  getOperationLabel,
  nowMs,
}: {
  job: JobForTV75;
  getOperationLabel: (job: OperationLabelJob) => string;
  nowMs: number;
}) {
  const assignedNames = job.assignedNames ?? [];

  // Tiempo esperando en cola desde que se creó el trabajo
  const waitingMs = job.createdAtMs
    ? Math.max(0, nowMs - Number(job.createdAtMs))
    : 0;
  const waitingMinutes = Math.floor(waitingMs / 60000);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${getAreaClass(
            job.area
          )}`}
        >
          {getAreaLabel(job.area)}
        </span>

        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">
          #{job.id}
        </span>
      </div>

      <div className="break-words text-xl font-black leading-tight text-slate-950">
        {job.plate || "SIN MATRÍCULA"}
      </div>

      <div className="mt-1 text-sm font-black text-slate-700">
        {getOperationLabel(job)}
      </div>

      {assignedNames.length > 0 && (
        <div className="mt-2 text-xs font-semibold text-slate-500">
          {assignedNames.join(" · ")}
        </div>
      )}

      <div className="mt-3 rounded-xl bg-sky-700 px-3 py-2 text-sm font-black text-white">
        ⏳ Esperando: {formatMinutes(waitingMinutes)}
      </div>
    </div>
  );
}

function ActiveJobVisualCard({
  job,
  techs,
  getOperationLabel,
}: {
  job: JobForTV75;
  techs: TechForTV75[];
  getOperationLabel: (job: OperationLabelJob) => string;
}) {
  const assignedNames = job.assignedNames ?? [];
  const workedMinutes = getWorkedMinutes(job);
  const estimatedMinutes = getEstimatedMinutes(job);
  const aiMinutes = getAiMinutes(job);
  const delayed = isJobDelayed(job);

  return (
    <div
      className={`relative flex h-full min-h-0 flex-col overflow-hidden rounded-[clamp(14px,1.1vw,24px)] border p-[clamp(7px,0.65vw,12px)] shadow-sm ${
        delayed
          ? "border-red-300 bg-red-50 shadow-red-100"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      {/* Técnico */}
      <div className="mb-[clamp(4px,0.45vw,8px)] flex min-h-[clamp(32px,3.8vh,42px)] flex-wrap gap-[clamp(4px,0.45vw,8px)]">
        {assignedNames.length > 0 ? (
          assignedNames.map((name) => {
            const tech = techs.find((item) => item.name === name);

            return (
              <div
                key={name}
                className="flex h-[clamp(30px,3.6vh,40px)] min-w-0 items-center gap-2 rounded-2xl bg-white px-2 py-1 shadow-sm"
              >
                <TechAvatar tech={tech} />
                <div className="max-w-[clamp(74px,7vw,115px)] truncate text-[clamp(12px,0.9vw,16px)] font-black">
                  {name}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-[clamp(30px,3.6vh,40px)] items-center rounded-2xl bg-white px-2 py-1 text-[clamp(9px,0.75vw,12px)] font-bold text-slate-400 shadow-sm">
            Sin técnicos asignados
          </div>
        )}
      </div>

      {/* Área + ID */}
      <div className="mb-[clamp(4px,0.45vw,8px)] flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[clamp(8px,0.65vw,10px)] font-black uppercase ${getAreaClass(
            job.area
          )}`}
        >
          {getAreaLabel(job.area)}
        </span>

        <span className="rounded-full bg-white px-2 py-0.5 text-[clamp(8px,0.65vw,10px)] font-black text-slate-400">
          #{job.id}
        </span>
      </div>

      {/* Matrícula + alarma */}
      <div className="relative min-h-[clamp(34px,4.2vh,46px)] pr-[clamp(44px,4.3vw,68px)]">
        <div className="break-words text-[clamp(18px,1.45vw,26px)] font-black leading-none tracking-wide text-slate-950">
          {job.plate || "SIN MATRÍCULA"}
        </div>

        {delayed && (
          <div className="absolute right-0 top-1/2 w-[clamp(42px,4vw,58px)] -translate-y-1/2 rounded-lg bg-red-600 px-1 py-1 text-center text-[clamp(7px,0.55vw,9px)] font-black leading-tight text-white shadow-sm">
            <div>Trabajo</div>
            <div>retrasado</div>
          </div>
        )}
      </div>

      {/* Operación */}
      <div className="mt-[clamp(4px,0.5vw,8px)] min-h-[clamp(30px,4vh,40px)] line-clamp-2 text-[clamp(11px,0.85vw,15px)] font-black leading-tight text-slate-700">
        {getOperationLabel(job)}
      </div>

      {/* Tiempos: mismo ancho, visibles y en una sola línea */}
      <div className="mt-auto flex w-full flex-col gap-[clamp(4px,0.45vw,8px)] pt-[clamp(4px,0.55vw,10px)]">
        <div className="w-full rounded-2xl bg-slate-900 px-2 py-[clamp(5px,0.55vh,8px)] text-center text-[clamp(9px,0.75vw,12px)] font-black text-white whitespace-nowrap">
          Tiempo trabajando: {formatMinutes(workedMinutes)}
        </div>

        <div className="grid w-full grid-cols-2 overflow-hidden rounded-2xl border-2 border-slate-900 bg-white text-center">
          <div className="min-w-0 border-r-2 border-slate-900 px-1 py-[clamp(3px,0.45vh,6px)]">
            <div className="text-[clamp(7px,0.55vw,9px)] font-black uppercase tracking-wide text-slate-500">
              IA
            </div>
            <div className="truncate whitespace-nowrap text-[clamp(8px,0.7vw,11px)] font-black leading-tight text-slate-950">
              {formatMinutes(aiMinutes)}
            </div>
          </div>

          <div className="min-w-0 px-1 py-[clamp(3px,0.45vh,6px)]">
            <div className="text-[clamp(7px,0.55vw,9px)] font-black uppercase tracking-wide text-slate-500">
              Previsto
            </div>
            <div className="truncate whitespace-nowrap text-[clamp(8px,0.7vw,11px)] font-black leading-tight text-slate-950">
              {formatMinutes(estimatedMinutes)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MaintenanceVisualCard({
  task,
  tech,
  nowMs,
}: {
  task: AssignedMaintenanceTask;
  tech?: TechForTV75 | null;
  nowMs: number;
}) {
  const isOutside = task.taskType === "fuera_taller";

  return (
    <div
      className={`rounded-3xl border p-4 shadow-sm ${
        isOutside
          ? "border-red-200 bg-red-50"
          : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm">
          <TechAvatar tech={tech} size="large" />

          <div className="truncate text-[clamp(15px,1.1vw,20px)] font-black">{task.techName}</div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
              isOutside
                ? "bg-red-100 text-red-700"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {isOutside ? "Fuera taller" : "Mantenimiento"}
          </span>

          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-400">
            Tarea
          </span>
        </div>

        <div className="break-words text-3xl font-black leading-none tracking-wide text-slate-950">
          {task.taskLabel}
        </div>

        <div className="mt-2 line-clamp-2 text-lg font-black leading-tight text-slate-700">
          {getMaintenanceTaskTypeLabel(task.taskType)}
        </div>

        <div className="mt-4 inline-flex rounded-2xl bg-slate-900 px-4 py-2 text-base font-black text-white">
          Tiempo trabajando: {formatMaintenanceTime(task, nowMs)}
        </div>
      </div>
    </div>
  );
}

export default function WorkshopTV75View({
  jobs,
  techs,
  getOperationLabel,
  onBack,
  onLogout,
}: Props) {
  const [nowTick, setNowTick] = useState(Date.now());
  const [assignedMaintenanceTasks, setAssignedMaintenanceTasks] = useState<
    AssignedMaintenanceTask[]
  >([]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAssignedMaintenanceTasks() {
      const apiAssignedMaintenanceTasks = await fetchMaintenanceJson<
        AssignedMaintenanceTask[]
      >("/api/assigned-maintenance-tasks", []);

      if (cancelled) return;

      if (Array.isArray(apiAssignedMaintenanceTasks)) {
        setAssignedMaintenanceTasks(apiAssignedMaintenanceTasks);
      }
    }

    void loadAssignedMaintenanceTasks();

    const interval = window.setInterval(() => {
      void loadAssignedMaintenanceTasks();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const activeJobs = jobs.filter((job) => job.status === "activo");
  const validationJobs = jobs.filter((job) => job.status === "validacion");
  const standByJobs = jobs.filter((job) => job.status === "parado");
  const waitingJobs = jobs.filter((job) => job.status === "espera");

  const pendingMaintenanceTasks = assignedMaintenanceTasks.filter(
    (task) => task.status === "pendiente"
  );

  const activeVisualCount = activeJobs.length + pendingMaintenanceTasks.length;

  return (
    <div className="fixed inset-0 overflow-hidden bg-white text-slate-950">
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-white">
        <header className="flex h-[clamp(58px,7vh,76px)] shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-[clamp(10px,1vw,20px)] shadow-sm">
          <div>
            <h1 className="text-[clamp(20px,1.7vw,30px)] font-black leading-tight">
              Pantalla técnicos
            </h1>

            <p className="text-[clamp(10px,0.8vw,14px)] font-semibold text-slate-500">
              Vista TV · trabajos activos, mantenimiento y estado de técnicos
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-[clamp(6px,0.65vw,12px)]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-[clamp(8px,0.8vw,16px)] py-[clamp(5px,0.55vw,8px)] text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                Activos
              </div>
              <div className="text-[clamp(16px,1.3vw,20px)] font-black text-slate-900">
                {activeVisualCount}
              </div>
            </div>

            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-[clamp(8px,0.8vw,16px)] py-[clamp(5px,0.55vw,8px)] text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-violet-500">
                Validar
              </div>
              <div className="text-[clamp(16px,1.3vw,20px)] font-black text-violet-800">
                {validationJobs.length}
              </div>
            </div>

            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-[clamp(8px,0.8vw,16px)] py-[clamp(5px,0.55vw,8px)] text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-orange-500">
                Stand by
              </div>
              <div className="text-[clamp(16px,1.3vw,20px)] font-black text-orange-800">
                {standByJobs.length}
              </div>
            </div>

            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-[clamp(8px,0.8vw,16px)] py-[clamp(5px,0.55vw,8px)] text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-sky-500">
                Cola
              </div>
              <div className="text-[clamp(16px,1.3vw,20px)] font-black text-sky-800">
                {waitingJobs.length}
              </div>
            </div>

            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="rounded-2xl bg-slate-900 px-[clamp(10px,1vw,20px)] py-[clamp(7px,0.7vw,12px)] text-[clamp(11px,0.85vw,14px)] font-black text-white"
              >
                Volver
              </button>
            )}

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="rounded-2xl border border-red-200 bg-white px-[clamp(10px,1vw,20px)] py-[clamp(7px,0.7vw,12px)] text-[clamp(11px,0.85vw,14px)] font-black text-red-600 hover:bg-red-50"
              >
                Salir
              </button>
            )}
          </div>
        </header>

        <main className="grid min-h-0 flex-1 overflow-hidden grid-cols-[minmax(0,1fr)_minmax(220px,18vw)_minmax(240px,20vw)] gap-[clamp(6px,0.7vw,12px)] bg-white p-[clamp(6px,0.7vw,12px)]">
          <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-[clamp(8px,0.8vw,16px)] shadow-sm">
            <div className="mb-[clamp(8px,0.8vw,16px)] flex items-center justify-between">
              <h2 className="text-[clamp(18px,1.45vw,24px)] font-black">Trabajos activos</h2>

              <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">
                {activeVisualCount}
              </span>
            </div>

            {activeJobs.length === 0 && pendingMaintenanceTasks.length === 0 ? (
              <div className="flex h-[calc(100%-52px)] items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 text-[clamp(13px,1vw,18px)] font-black text-slate-400">
                No hay trabajos activos ni tareas asignadas.
              </div>
            ) : (
              <div className="grid h-[calc(100%-52px)] grid-cols-3 grid-rows-3 gap-[clamp(6px,0.7vw,12px)] overflow-hidden">
                {activeJobs.map((job) => (
                  <ActiveJobVisualCard
                    key={`job-${job.id}`}
                    job={job}
                    techs={techs}
                    getOperationLabel={getOperationLabel}
                  />
                ))}

                {pendingMaintenanceTasks.map((task) => {
                  const tech = techs.find((item) => item.name === task.techName);

                  return (
                    <MaintenanceVisualCard
                      key={`maintenance-${task.id}`}
                      task={task}
                      tech={tech}
                      nowMs={nowTick}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid min-h-0 grid-rows-[1fr_1fr] gap-[clamp(6px,0.7vw,12px)]">
            <section className="min-h-0 overflow-hidden rounded-3xl border border-orange-200 bg-orange-50 p-[clamp(8px,0.8vw,16px)] shadow-sm">
              <div className="mb-[clamp(8px,0.8vw,16px)] flex items-center justify-between">
                <h2 className="text-[clamp(17px,1.35vw,24px)] font-black text-orange-900">
                  Trabajos en Stand by
                </h2>

                <span className="rounded-full bg-orange-100 px-4 py-2 text-sm font-black text-orange-700">
                  {standByJobs.length}
                </span>
              </div>

              <div className="h-[calc(100%-52px)] space-y-[clamp(6px,0.7vw,12px)] overflow-auto pr-1">
                {standByJobs.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-orange-200 bg-white/80 text-center text-sm font-black text-orange-700">
                    Sin trabajos en stand by.
                  </div>
                ) : (
                  standByJobs.map((job) => (
                    <SmallJobCard
                      key={job.id}
                      job={job}
                      getOperationLabel={getOperationLabel}
                      nowMs={nowTick}
                    />
                  ))
                )}
              </div>
            </section>

            <section className="min-h-0 overflow-hidden rounded-3xl border border-sky-200 bg-sky-50 p-[clamp(8px,0.8vw,16px)] shadow-sm">
              <div className="mb-[clamp(8px,0.8vw,16px)] flex items-center justify-between">
                <h2 className="text-[clamp(17px,1.35vw,24px)] font-black text-sky-900">
                  Trabajos en cola
                </h2>

                <span className="rounded-full bg-sky-100 px-4 py-2 text-sm font-black text-sky-700">
                  {waitingJobs.length}
                </span>
              </div>

              <div className="h-[calc(100%-52px)] space-y-[clamp(6px,0.7vw,12px)] overflow-auto pr-1">
                {waitingJobs.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-sky-200 bg-white/80 text-center text-sm font-black text-sky-700">
                    Sin trabajos en cola.
                  </div>
                ) : (
                  waitingJobs.map((job) => (
                    <SmallJobCard
                      key={job.id}
                      job={job}
                      getOperationLabel={getOperationLabel}
                      nowMs={nowTick}
                    />
                  ))
                )}
              </div>
            </section>
          </section>

          <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-[clamp(8px,0.8vw,16px)] shadow-sm">
            <div className="mb-[clamp(8px,0.8vw,16px)] flex items-center justify-between">
              <h2 className="text-[clamp(18px,1.45vw,24px)] font-black">Estado técnicos</h2>

              <span className="text-xs font-bold text-slate-400">
                No editable
              </span>
            </div>

            <div className="h-[calc(100%-52px)] space-y-[clamp(6px,0.7vw,12px)] overflow-auto pr-1">
              {techs.map((tech) => {
                const currentJob =
                  tech.currentJobId != null
                    ? jobs.find((job) => job.id === tech.currentJobId)
                    : null;

                const pendingMaintenanceTask = pendingMaintenanceTasks.find(
                  (task) => task.techName === tech.name
                );

                return (
                  <div
                    key={tech.name}
                    className={`rounded-2xl border p-[clamp(8px,0.8vw,16px)] ${
                      pendingMaintenanceTask
                        ? pendingMaintenanceTask.taskType === "fuera_taller"
                          ? "border-red-300 bg-red-200 text-red-950"
                          : "border-emerald-300 bg-emerald-200 text-emerald-950"
                        : getTechCardClass(tech.status)
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <TechAvatar tech={tech} />

                        <div className="min-w-0">
                          <div className="truncate text-[clamp(15px,1.1vw,20px)] font-black">
                            {tech.name}
                          </div>

                          <div className="truncate text-[clamp(9px,0.75vw,12px)] font-bold opacity-80">
                            {currentJob
                              ? `${currentJob.plate} · ${getOperationLabel(
                                  currentJob
                                )}`
                              : pendingMaintenanceTask
                              ? `${getMaintenanceTaskTypeLabel(
                                  pendingMaintenanceTask.taskType
                                )} · ${pendingMaintenanceTask.taskLabel}`
                              : "Sin trabajo asignado"}
                          </div>
                        </div>
                      </div>

                      <span className="shrink-0 rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-black">
                        {pendingMaintenanceTask
                          ? pendingMaintenanceTask.taskType === "fuera_taller"
                            ? "FUERA TALLER"
                            : "MANTENIMIENTO"
                          : getTechStatusLabel(tech.status)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}