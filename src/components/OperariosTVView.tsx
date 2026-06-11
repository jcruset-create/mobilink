import { useEffect, useState } from "react";

type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";

type TemplateKey = "alineacion_camion" | "pinchazo_camion";

type JobForOperarios = {
  id: number;
  plate: string;
  status: string;
  area: AreaKey;
  assignedNames?: string[];
  template?: TemplateKey | null;
  quickEntryLabel?: string | null;
  quickEntryMode?: string | null;
  reason?: string;
  createdAtMs?: number | string | null;
  startedAtMs?: number | string | null;
  closedAtMs?: number | string | null;
  workedAccumulatedMinutes?: number | null;
  pausedAccumulatedMinutes?: number | null;
  pausedAtMs?: number | string | null;
  linkedGroupId?: string | null;
  linkedOrder?: 1 | 2 | null;
  dependsOnJobId?: number | null;
  blockedReason?: string | null;
  includedTasks?: {
    id: string;
    label: string;
    area: AreaKey;
    source: "quickTemplate" | "customExtra";
    templateKey?: string | null;
    standardMinutes?: number | null;
  }[];
};

type TechForOperarios = {
  name: string;
  status: string;
  currentJobId?: number | null;
  avatar?: string | null;
};

type OperationLabelJob = Pick<
  JobForOperarios,
  "template" | "area" | "quickEntryLabel"
>;

type Props = {
  jobs: JobForOperarios[];
  techs: TechForOperarios[];
  finishJob: (jobId: number) => void;
  moveJobToStandBy: (jobId: number) => void;
  getOperationLabel: (job: OperationLabelJob) => string;
  onBack: () => void;
  onGoWorkshopScreen?: () => void;
  canGoBack?: boolean;
  onLogout?: () => void;
  onSetWorkshopPin?: (techName: string) => void;
};

type MaintenanceTaskType = "en_taller" | "fuera_taller";

type AssignedMaintenanceTaskStatus =
  | "pendiente"
  | "finalizada"
  | "interrumpida";

type MaintenanceTask = {
  id: string;
  label: string;
  type: MaintenanceTaskType;
};

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

const DEFAULT_MAINTENANCE_TASKS: MaintenanceTask[] = [
  {
    id: "limpieza_zona_trabajo",
    label: "Limpieza zona trabajo",
    type: "en_taller",
  },
  {
    id: "ordenar_almacen",
    label: "Ordenar almacén",
    type: "en_taller",
  },
  {
    id: "revisar_herramientas",
    label: "Revisar herramientas",
    type: "en_taller",
  },
  {
    id: "cargar_baterias",
    label: "Cargar baterías",
    type: "en_taller",
  },
  {
    id: "revisar_compresor",
    label: "Revisar compresor",
    type: "en_taller",
  },
  {
    id: "recoger_material_fuera",
    label: "Recoger material fuera",
    type: "fuera_taller",
  },
];

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

function normalizeTechStatus(status?: string) {
  return (status || "").toLowerCase().trim();
}

function normalizeTimestamp(value?: number | string | null) {
  if (value == null || value === "") return null;

  const numericValue = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numericValue)) return null;

  return numericValue;
}

function formatWorkedTime(minutes: number) {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;

  if (hours <= 0) return `${mins} min`;

  return `${hours} h ${mins} min`;
}

function formatMaintenanceAssignedAt(value: number) {
  const date = new Date(value);

  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}


function formatMaintenanceElapsedTime(
  task: AssignedMaintenanceTask,
  nowMs: number
) {
  const endMs =
    task.status === "pendiente"
      ? nowMs
      : task.statusChangedAtMs ?? task.assignedAtMs;

  const elapsedMinutes = Math.max(
    0,
    Math.floor((endMs - task.assignedAtMs) / 60000)
  );

  return formatWorkedTime(elapsedMinutes);
}

function getMaintenanceTaskTypeLabel(type: MaintenanceTaskType) {
  if (type === "fuera_taller") return "Fuera de taller";

  return "En taller";
}

function getLiveWorkedMinutes(job: JobForOperarios, nowMs: number) {
  const baseMinutes = job.workedAccumulatedMinutes ?? 0;
  const startedAtMs = normalizeTimestamp(job.startedAtMs);

  if (!startedAtMs || job.status !== "activo") {
    return baseMinutes;
  }

  const liveMinutes = Math.floor((nowMs - startedAtMs) / 60000);

  return baseMinutes + Math.max(0, liveMinutes);
}

function getTechStatusLabel(status: string) {
  const normalized = normalizeTechStatus(status);

  if (normalized === "otro_taller") return "EN OTRO TALLER";
  if (normalized === "en_otro_taller") return "EN OTRO TALLER";
  if (normalized === "nodisponible") return "NO DISPONIBLE";
  if (normalized === "disponible") return "DISPONIBLE";
  if (normalized === "ocupado") return "OCUPADO";
  if (normalized === "vacaciones") return "VACACIONES";
  if (normalized === "baja") return "BAJA";
  if (normalized === "permiso") return "PERMISO";
  if (normalized === "supervisor") return "SUPERVISOR";
  if (normalized === "refuerzo") return "REFUERZO";

  return (status || "-").toUpperCase();
}

function getTechCardClass(status: string) {
  const normalized = normalizeTechStatus(status);

  if (normalized === "disponible" || normalized === "supervisor") {
    return "border-green-300 bg-green-200 text-green-950";
  }

  if (normalized === "refuerzo") {
    return "border-yellow-300 bg-yellow-200 text-yellow-950";
  }

  if (normalized === "ocupado") {
    return "border-red-300 bg-red-200 text-red-950";
  }

  return "border-slate-300 bg-slate-200 text-slate-800";
}

function getLinkedPhaseLabel(job: JobForOperarios) {
  if (!job.linkedGroupId && !job.linkedOrder && !job.dependsOnJobId) {
    return "";
  }

  if (job.linkedOrder === 1) {
    if (job.status === "validacion") return "1º pendiente de validar";
    if (job.status === "activo") return "1º en curso";
    if (job.status === "cerrado") return "1º finalizado";
    return "1º trabajo vinculado";
  }

  if (job.linkedOrder === 2) {
    if (job.status === "parado") return "2º bloqueado";
    if (job.status === "validacion") return "2º pendiente de validar";
    if (job.status === "activo") return "2º en curso";
    if (job.status === "espera") return "2º en cola";
    if (job.status === "cerrado") return "2º finalizado";
    return "2º trabajo vinculado";
  }

  return "Trabajo vinculado";
}

function getAreaClass(area: AreaKey) {
  if (area === "camion") return "bg-red-100 text-red-700";
  if (area === "movil") return "bg-amber-100 text-amber-700";
  if (area === "tacografo") return "bg-orange-100 text-orange-700";
  if (area === "turismo") return "bg-sky-100 text-sky-700";
  if (area === "mecanica") return "bg-emerald-100 text-emerald-700";

  return "bg-slate-100 text-slate-700";
}

function getTechInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getTechAvatarUrl(tech?: TechForOperarios | null) {
  if (!tech?.avatar) return "";

  if (tech.avatar.startsWith("http")) return tech.avatar;

  return `${API_BASE}${tech.avatar}`;
}


function TechAvatar({
  tech,
  size = "normal",
}: {
  tech?: TechForOperarios | null;
  size?: "normal" | "large";
}) {
  const imageUrl = getTechAvatarUrl(tech);
  const sizeClass = size === "large" ? "h-14 w-14 text-xl" : "h-9 w-9 text-sm";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={tech?.name || "Técnico"}
        className={`${sizeClass} rounded-full border border-white/70 object-cover shadow-sm`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} flex items-center justify-center rounded-full border border-white/70 bg-white/70 font-bold shadow-sm`}
    >
      {getTechInitials(tech?.name || "?")}
    </div>
  );
}

function SmallJobCard({
  job,
  techs,
  getOperationLabel,
}: {
  job: JobForOperarios;
  techs: TechForOperarios[];
  getOperationLabel: (job: OperationLabelJob) => string;
}) {
  const assignedNames = job.assignedNames || [];
  const linkedPhaseLabel = getLinkedPhaseLabel(job);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${getAreaClass(
            job.area
          )}`}
        >
          {job.area}
        </span>

        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          #{job.id}
        </span>
      </div>

      <div className="text-lg font-black text-slate-950">{job.plate}</div>

      <div className="text-xs font-semibold text-slate-700">
        {getOperationLabel(job)}
      </div>

      {linkedPhaseLabel && (
        <div className="mt-1 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase text-violet-700">
          {linkedPhaseLabel}
        </div>
      )}

      {job.includedTasks && job.includedTasks.length > 0 && (
        <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          + {job.includedTasks.map((task) => task.label).join(" + ")}
        </div>
      )}

      {assignedNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {assignedNames.map((name) => {
            const tech = techs.find((item) => item.name === name);

            return (
              <div
                key={name}
                className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold"
              >
                <TechAvatar tech={tech} />
                {name}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function fetchMaintenanceJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${url}`);

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

async function sendMaintenanceJson<T>(
  url: string,
  options: RequestInit,
  fallback: T
): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}


function saveMaintenanceTasksToLocalStorage(tasks: MaintenanceTask[]) {
  try {
    window.localStorage.setItem("maintenanceTasks", JSON.stringify(tasks));
  } catch {
    // No rompemos la pantalla si localStorage falla.
  }
}

function saveAssignedMaintenanceTasksToLocalStorage(
  tasks: AssignedMaintenanceTask[]
) {
  try {
    window.localStorage.setItem(
      "assignedMaintenanceTasks",
      JSON.stringify(tasks)
    );
  } catch {
    // No rompemos la pantalla si localStorage falla.
  }
}

export default function OperariosTVView({
  jobs,
  techs,
  finishJob,
  moveJobToStandBy,
  getOperationLabel,
  onBack,
  onGoWorkshopScreen,
  canGoBack = true,
  onLogout,
  onSetWorkshopPin,
}: Props) {
  const [nowTick, setNowTick] = useState(Date.now());

  const [maintenanceTasks, setMaintenanceTasks] = useState<MaintenanceTask[]>(
    () => {
      try {
        const saved = window.localStorage.getItem("maintenanceTasks");

        if (saved) {
          const parsed = JSON.parse(saved);

          if (Array.isArray(parsed)) {
            const validTasks = parsed
              .filter(
                (item) =>
                  item &&
                  typeof item.id === "string" &&
                  typeof item.label === "string"
              )
              .map((item) => ({
                id: item.id,
                label: item.label,
                type:
                  item.type === "fuera_taller" || item.type === "en_taller"
                    ? item.type
                    : "en_taller",
              }));

            if (validTasks.length > 0) {
              return validTasks;
            }
          }
        }

        return DEFAULT_MAINTENANCE_TASKS;
      } catch {
        return DEFAULT_MAINTENANCE_TASKS;
      }
    }
  );

  const [assignedMaintenanceTasks, setAssignedMaintenanceTasks] = useState<
    AssignedMaintenanceTask[]
  >(() => {
    try {
      const saved = window.localStorage.getItem("assignedMaintenanceTasks");

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed)) {
          return parsed
            .filter(
              (item) =>
                item &&
                typeof item.id === "string" &&
                typeof item.taskId === "string" &&
                typeof item.taskLabel === "string" &&
                typeof item.techName === "string" &&
                typeof item.assignedAtMs === "number" &&
                (item.status === "pendiente" ||
                  item.status === "finalizada" ||
                  item.status === "interrumpida")
            )
            .map((item) => ({
              id: item.id,
              taskId: item.taskId,
              taskLabel: item.taskLabel,
              taskType:
                item.taskType === "fuera_taller" || item.taskType === "en_taller"
                  ? item.taskType
                  : "en_taller",
              techName: item.techName,
              assignedAtMs: item.assignedAtMs,
              status:
                item.status === "finalizada" ||
                item.status === "interrumpida" ||
                item.status === "pendiente"
                  ? item.status
                  : "pendiente",
              statusChangedAtMs:
                typeof item.statusChangedAtMs === "number"
                  ? item.statusChangedAtMs
                  : null,
            }));
        }
      }

      return [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    saveMaintenanceTasksToLocalStorage(maintenanceTasks);
  }, [maintenanceTasks]);

  useEffect(() => {
    saveAssignedMaintenanceTasksToLocalStorage(assignedMaintenanceTasks);
  }, [assignedMaintenanceTasks]);

  useEffect(() => {
    let cancelled = false;

    async function loadMaintenanceFromApi() {
      const localMaintenanceTasks = maintenanceTasks;
      const localAssignedMaintenanceTasks = assignedMaintenanceTasks;

      const apiMaintenanceTasks = await fetchMaintenanceJson<MaintenanceTask[]>(
        "/api/maintenance-tasks",
        localMaintenanceTasks
      );

      const apiAssignedMaintenanceTasks = await fetchMaintenanceJson<
        AssignedMaintenanceTask[]
      >("/api/assigned-maintenance-tasks", localAssignedMaintenanceTasks);

      if (cancelled) return;

      if (Array.isArray(apiMaintenanceTasks)) {
        setMaintenanceTasks(apiMaintenanceTasks);
        saveMaintenanceTasksToLocalStorage(apiMaintenanceTasks);
      }

      if (Array.isArray(apiAssignedMaintenanceTasks)) {
        setAssignedMaintenanceTasks(apiAssignedMaintenanceTasks);
        saveAssignedMaintenanceTasksToLocalStorage(apiAssignedMaintenanceTasks);
      }

    }

    void loadMaintenanceFromApi();

    const interval = window.setInterval(() => {
      void loadMaintenanceFromApi();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // Sincronización automática con backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function interruptWorkshopMaintenanceWithRealJob() {
      const tasksToInterrupt = assignedMaintenanceTasks.filter((task) => {
        if (task.status !== "pendiente") return false;
        if (task.taskType !== "en_taller") return false;

        const tech = techs.find((item) => item.name === task.techName);

        return !!tech && tech.currentJobId != null;
      });

      if (tasksToInterrupt.length === 0) return;

      for (const task of tasksToInterrupt) {
        const fallbackTask: AssignedMaintenanceTask = {
          ...task,
          status: "interrumpida",
          statusChangedAtMs: Date.now(),
        };

        const savedTask = await sendMaintenanceJson<AssignedMaintenanceTask>(
          `/api/assigned-maintenance-tasks/${task.id}/interrupt`,
          {
            method: "PUT",
          },
          fallbackTask
        );

        if (cancelled) return;

        setAssignedMaintenanceTasks((prev) =>
          prev.map((item) => (item.id === task.id ? savedTask : item))
        );
      }
    }

    void interruptWorkshopMaintenanceWithRealJob();

    return () => {
      cancelled = true;
    };
  }, [techs, assignedMaintenanceTasks]);

  async function finishAssignedMaintenanceTask(assignedTaskId: string) {
    const localUpdatedAt = Date.now();

    const currentTask = assignedMaintenanceTasks.find(
      (task) => task.id === assignedTaskId
    );

    if (!currentTask) return;

    const fallbackTask: AssignedMaintenanceTask = {
      ...currentTask,
      status: "finalizada",
      statusChangedAtMs: localUpdatedAt,
    };

    const savedTask = await sendMaintenanceJson<AssignedMaintenanceTask>(
      `/api/assigned-maintenance-tasks/${assignedTaskId}/finish`,
      {
        method: "PUT",
      },
      fallbackTask
    );

    setAssignedMaintenanceTasks((prev) =>
      prev.map((task) => (task.id === assignedTaskId ? savedTask : task))
    );
  }

  async function interruptAssignedMaintenanceTask(assignedTaskId: string) {
    const task = assignedMaintenanceTasks.find(
      (item) => item.id === assignedTaskId
    );

    if (!task) return;

    if (task.status !== "pendiente") {
      window.alert("Solo se pueden interrumpir tareas pendientes.");
      return;
    }

    if (task.taskType !== "en_taller") {
      window.alert("Solo se pueden interrumpir tareas de mantenimiento en taller.");
      return;
    }

    const ok = window.confirm(
      `¿Interrumpir "${task.taskLabel}" de ${task.techName}?`
    );

    if (!ok) return;

    const fallbackTask: AssignedMaintenanceTask = {
      ...task,
      status: "interrumpida",
      statusChangedAtMs: Date.now(),
    };

    const savedTask = await sendMaintenanceJson<AssignedMaintenanceTask>(
      `/api/assigned-maintenance-tasks/${assignedTaskId}/interrupt`,
      {
        method: "PUT",
      },
      fallbackTask
    );

    setAssignedMaintenanceTasks((prev) =>
      prev.map((item) => (item.id === assignedTaskId ? savedTask : item))
    );
  }

  const activeJobs = jobs.filter((job) => job.status === "activo");
  const validationJobs = jobs.filter((job) => job.status === "validacion");
  const standByJobs = jobs.filter((job) => job.status === "parado");
  const waitingJobs = jobs.filter((job) => job.status === "espera");

  const pendingAssignedMaintenanceTasks = assignedMaintenanceTasks.filter(
    (task) => task.status === "pendiente"
  );

  const pendingWorkshopMaintenanceTasks = pendingAssignedMaintenanceTasks.filter(
    (task) => task.taskType === "en_taller"
  );

  const pendingOutsideMaintenanceTasks = pendingAssignedMaintenanceTasks.filter(
    (task) => task.taskType === "fuera_taller"
  );

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-black">Pantalla técnicos</h1>
          <p className="text-sm text-slate-500">
            Vista simple para TV / técnicos
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {onGoWorkshopScreen && (
            <button
              type="button"
              onClick={onGoWorkshopScreen}
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
            >
              Pantalla taller
            </button>
          )}

          {canGoBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium"
            >
              Volver a operativo
            </button>
          )}

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Salir
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_0.9fr_0.7fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-black">Trabajos asignados</h2>

            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
              {activeJobs.length + pendingAssignedMaintenanceTasks.length}
            </span>
          </div>

          {activeJobs.length === 0 &&
          pendingAssignedMaintenanceTasks.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
              No hay trabajos activos ni tareas de mantenimiento asignadas.
            </div>
          ) : (
            <div className="grid gap-3 2xl:grid-cols-2">
              {activeJobs.slice(0, 6).map((job) => {
                const assignedNames = job.assignedNames || [];
                const workedMinutes = getLiveWorkedMinutes(job, nowTick);

                return (
                  <div
                    key={`job-${job.id}`}
                    className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="mb-3 flex flex-wrap gap-3">
                      {assignedNames.length > 0 ? (
                        assignedNames.map((name) => {
                          const tech = techs.find(
                            (item) => item.name === name
                          );

                          return (
                            <div
                              key={name}
                              className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2 shadow-sm"
                            >
                              <TechAvatar tech={tech} size="large" />
                              <div className="text-2xl font-black">{name}</div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm text-slate-400">
                          Sin técnicos asignados
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${getAreaClass(
                              job.area
                            )}`}
                          >
                            {job.area}
                          </span>

                          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">
                            #{job.id}
                          </span>
                        </div>

                        <div className="text-4xl font-black tracking-wide">
                          {job.plate}
                        </div>

                        <div className="mt-1 text-xl font-bold text-slate-700">
                          {getOperationLabel(job)}
                        </div>

                        <div className="mt-3 inline-flex rounded-2xl bg-slate-900 px-4 py-2 text-lg font-black text-white shadow-sm">
                          Tiempo trabajando: {formatWorkedTime(workedMinutes)}
                        </div>

                        {job.includedTasks && job.includedTasks.length > 0 && (
                          <div className="mt-3 rounded-2xl border border-emerald-200 bg-white p-3">
                            <div className="mb-2 text-xs font-black uppercase tracking-wide text-emerald-700">
                              Tareas incluidas
                            </div>

                            <div className="grid gap-1">
                              {job.includedTasks.map((task) => (
                                <div
                                  key={task.id}
                                  className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900"
                                >
                                  <span>✓ {task.label}</span>

                                  {task.standardMinutes != null && (
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-emerald-700">
                                      {task.standardMinutes} min
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid min-w-[190px] gap-2">
                        <button
                          type="button"
                          onClick={() => finishJob(job.id)}
                          className="rounded-2xl bg-slate-900 px-4 py-4 text-lg font-bold text-white"
                        >
                          Finalizar
                        </button>

                        <button
                          type="button"
                          onClick={() => moveJobToStandBy(job.id)}
                          className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-lg font-bold text-amber-700"
                        >
                          Stand by
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {pendingAssignedMaintenanceTasks.map((task) => {
                const tech = techs.find((item) => item.name === task.techName);
                const isOutside = task.taskType === "fuera_taller";

                return (
                  <div
                    key={`maintenance-${task.id}`}
                    className={`rounded-3xl border p-4 ${
                      isOutside
                        ? "border-red-200 bg-red-50"
                        : "border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    <div className="mb-3 flex flex-wrap gap-3">
                      <div className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2 shadow-sm">
                        <TechAvatar tech={tech} size="large" />
                        <div className="text-2xl font-black">
                          {task.techName}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                              isOutside
                                ? "bg-red-100 text-red-700"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {isOutside ? "Fuera taller" : "Mantenimiento"}
                          </span>

                          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">
                            Tarea
                          </span>
                        </div>

                        <div className="text-4xl font-black tracking-wide text-slate-950">
                          {task.taskLabel}
                        </div>

                        <div className="mt-1 text-xl font-bold text-slate-700">
                          {getMaintenanceTaskTypeLabel(task.taskType)}
                        </div>

                        <div className="mt-3 inline-flex rounded-2xl bg-slate-900 px-4 py-2 text-lg font-black text-white shadow-sm">
                          Tiempo trabajando:{" "}
                          {formatMaintenanceElapsedTime(task, nowTick)}
                        </div>

                        <div className="mt-3 rounded-2xl border border-white bg-white/80 px-4 py-3 text-sm font-bold text-slate-700">
                          Asignada:{" "}
                          {formatMaintenanceAssignedAt(task.assignedAtMs)}
                        </div>
                      </div>

                      <div className="grid min-w-[190px] gap-2">
                        <button
                          type="button"
                          onClick={() => finishAssignedMaintenanceTask(task.id)}
                          className="rounded-2xl bg-slate-900 px-4 py-4 text-lg font-bold text-white"
                        >
                          Finalizar
                        </button>

                        {task.taskType === "en_taller" && (
                          <button
                            type="button"
                            onClick={() =>
                              interruptAssignedMaintenanceTask(task.id)
                            }
                            className="rounded-2xl border border-sky-300 bg-sky-50 px-4 py-4 text-lg font-bold text-sky-700"
                          >
                            Interrumpir
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-4">

          <section className="rounded-3xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-violet-900">
                Pendientes de validar
              </h2>

              <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-bold text-violet-700">
                {validationJobs.length}
              </span>
            </div>

            {validationJobs.length === 0 ? (
              <div className="rounded-2xl bg-white/60 p-4 text-center text-sm text-violet-700">
                Sin trabajos pendientes de validar.
              </div>
            ) : (
              <div className="space-y-2">
                {validationJobs.map((job) => {
                  const linkedPhaseLabel = getLinkedPhaseLabel(job);

                  return (
                    <div
                      key={job.id}
                      className="rounded-2xl border border-violet-200 bg-white p-3"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${getAreaClass(
                            job.area
                          )}`}
                        >
                          {job.area}
                        </span>

                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                          PENDIENTE
                        </span>
                      </div>

                      <div className="text-xl font-black text-slate-950">
                        {job.plate}
                      </div>

                      <div className="text-xs font-semibold text-violet-800">
                        {getOperationLabel(job)}
                      </div>

                      {linkedPhaseLabel && (
                        <div className="mt-2 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase text-violet-700">
                          {linkedPhaseLabel}
                        </div>
                      )}

                      {job.assignedNames && job.assignedNames.length > 0 && (
                        <div className="mt-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-900">
                          Propuesto: {job.assignedNames.join(" + ")}
                        </div>
                      )}

                      {job.reason && (
                        <div className="mt-2 text-[11px] text-slate-500">
                          {job.reason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-orange-900">
                Trabajos en Stand by
              </h2>

              <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-700">
                {standByJobs.length}
              </span>
            </div>

            {standByJobs.length === 0 ? (
              <div className="rounded-2xl bg-white/60 p-4 text-center text-sm text-orange-700">
                Sin trabajos en stand by.
              </div>
            ) : (
              <div className="space-y-2">
                {standByJobs.map((job) => (
                  <SmallJobCard
                    key={job.id}
                    job={job}
                    techs={techs}
                    getOperationLabel={getOperationLabel}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-sky-900">
                Cola de trabajo
              </h2>

              <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-bold text-sky-700">
                {waitingJobs.length}
              </span>
            </div>

            {waitingJobs.length === 0 ? (
              <div className="rounded-2xl bg-white/60 p-4 text-center text-sm text-sky-700">
                Sin trabajos en cola.
              </div>
            ) : (
              <div className="space-y-2">
                {waitingJobs.map((job) => (
                  <SmallJobCard
                    key={job.id}
                    job={job}
                    techs={techs}
                    getOperationLabel={getOperationLabel}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black">Estado técnicos</h2>
            <span className="text-xs text-slate-500">No editable</span>
          </div>

          <div className="space-y-2">
            {techs.map((tech) => {
              const currentJob =
                tech.currentJobId != null
                  ? jobs.find((job) => job.id === tech.currentJobId)
                  : null;

              const validationProposal = jobs.find(
                (job) =>
                  job.status === "validacion" &&
                  Array.isArray(job.assignedNames) &&
                  job.assignedNames.includes(tech.name)
              );

              const isReservedForValidation = Boolean(
                validationProposal && !currentJob
              );

              const pendingWorkshopMaintenanceTask =
                pendingWorkshopMaintenanceTasks.find(
                  (task) => task.techName === tech.name
                );

              const pendingOutsideMaintenanceTask =
                pendingOutsideMaintenanceTasks.find(
                  (task) => task.techName === tech.name
                );

              return (
                <div
                  key={tech.name}
                  className={`rounded-2xl border p-3 ${
                    pendingOutsideMaintenanceTask
                      ? "border-red-300 bg-red-200 text-red-950"
                      : pendingWorkshopMaintenanceTask
                      ? "border-emerald-300 bg-emerald-200 text-emerald-950"
                      : isReservedForValidation
                      ? "border-violet-300 bg-violet-200 text-violet-950"
                      : getTechCardClass(tech.status)
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <TechAvatar tech={tech} />

                      <div className="min-w-0">
                        <div className="truncate text-lg font-black">
                          {tech.name}
                        </div>

                        <div className="truncate text-xs font-semibold opacity-80">
                          {currentJob
                            ? `${currentJob.plate} · ${getOperationLabel(
                                currentJob
                              )}`
                            : pendingOutsideMaintenanceTask
                            ? `Fuera de taller · ${pendingOutsideMaintenanceTask.taskLabel}`
                            : pendingWorkshopMaintenanceTask
                            ? `Mantenimiento taller · ${pendingWorkshopMaintenanceTask.taskLabel}`
                            : validationProposal
                            ? `Propuesto en ${
                                validationProposal.plate
                              } · ${getOperationLabel(validationProposal)}`
                            : "Sin trabajo asignado"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="rounded-full border border-white/80 bg-white/80 px-2 py-1 text-[10px] font-black">
                        {pendingOutsideMaintenanceTask
                          ? "FUERA TALLER"
                          : pendingWorkshopMaintenanceTask
                          ? "MANT. TALLER"
                          : isReservedForValidation
                          ? "RESERVADO"
                          : getTechStatusLabel(tech.status)}
                      </span>
                      {onSetWorkshopPin && (
                        <button
                          type="button"
                          title="Establecer PIN taller"
                          onClick={() => onSetWorkshopPin(tech.name)}
                          className="rounded-full border border-white/60 bg-white/60 px-2 py-1 text-[10px] font-black hover:bg-white/80"
                        >
                          🔑 PIN
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}