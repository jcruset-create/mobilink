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

function getAssignedMaintenanceStatusLabel(
  status: AssignedMaintenanceTaskStatus
) {
  if (status === "finalizada") return "Finalizada";
  if (status === "interrumpida") return "Interrumpida";

  return "Pendiente";
}

function getAssignedMaintenanceStatusClass(
  status: AssignedMaintenanceTaskStatus
) {
  if (status === "finalizada") return "bg-emerald-100 text-emerald-700";
  if (status === "interrumpida") return "bg-sky-100 text-sky-700";

  return "bg-amber-100 text-amber-700";
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

async function deleteMaintenanceApi(url: string) {
  try {
    const response = await fetch(`${API_BASE}${url}`, {
      method: "DELETE",
    });

    return response.ok;
  } catch {
    return false;
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
}: Props) {
  const [nowTick, setNowTick] = useState(Date.now());
const [maintenanceApiLoaded, setMaintenanceApiLoaded] = useState(false);
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

  const [newMaintenanceTaskLabel, setNewMaintenanceTaskLabel] = useState("");
  const [newMaintenanceTaskType, setNewMaintenanceTaskType] =
    useState<MaintenanceTaskType>("en_taller");

  const [editingMaintenanceTaskId, setEditingMaintenanceTaskId] = useState("");
  const [editingMaintenanceTaskLabel, setEditingMaintenanceTaskLabel] =
    useState("");
  const [editingMaintenanceTaskType, setEditingMaintenanceTaskType] =
    useState<MaintenanceTaskType>("en_taller");

  const [selectedMaintenanceTaskId, setSelectedMaintenanceTaskId] = useState(
    maintenanceTasks[0]?.id ?? ""
  );

  const [selectedMaintenanceTechName, setSelectedMaintenanceTechName] =
    useState("");

  const [showFinishedMaintenanceTasks, setShowFinishedMaintenanceTasks] =
    useState(false);

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

    setMaintenanceApiLoaded(true);
  }

  void loadMaintenanceFromApi();

  return () => {
    cancelled = true;
  };
  // Solo al arrancar la pantalla.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  useEffect(() => {
    setAssignedMaintenanceTasks((prev) => {
      let changed = false;

      const next = prev.map((task) => {
        if (task.status !== "pendiente") return task;
        if (task.taskType !== "en_taller") return task;

        const tech = techs.find((item) => item.name === task.techName);

        if (!tech || tech.currentJobId == null) return task;

        changed = true;

        return {
  ...task,
  status: "interrumpida" as const,
  statusChangedAtMs: Date.now(),
};
      });

      return changed ? next : prev;
    });
  }, [techs]);

  async function addMaintenanceTask() {
  const label = newMaintenanceTaskLabel.trim();

  if (!label) {
    window.alert("Escribe el nombre de la tarea.");
    return;
  }

  const task: MaintenanceTask = {
    id: `maintenance-${Date.now()}`,
    label,
    type: newMaintenanceTaskType,
  };

  const savedTask = await sendMaintenanceJson<MaintenanceTask>(
    "/api/maintenance-tasks",
    {
      method: "POST",
      body: JSON.stringify(task),
    },
    task
  );

  setMaintenanceTasks((prev) =>
    [...prev, savedTask].sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" })
    )
  );

  setNewMaintenanceTaskLabel("");
  setNewMaintenanceTaskType("en_taller");
}

  function startEditMaintenanceTask(task: MaintenanceTask) {
    setEditingMaintenanceTaskId(task.id);
    setEditingMaintenanceTaskLabel(task.label);
    setEditingMaintenanceTaskType(task.type);
  }

  function cancelEditMaintenanceTask() {
    setEditingMaintenanceTaskId("");
    setEditingMaintenanceTaskLabel("");
    setEditingMaintenanceTaskType("en_taller");
  }

  async function saveMaintenanceTask() {
  const label = editingMaintenanceTaskLabel.trim();

  if (!editingMaintenanceTaskId) return;

  if (!label) {
    window.alert("El nombre de la tarea no puede estar vacío.");
    return;
  }

  const currentTask = maintenanceTasks.find(
    (task) => task.id === editingMaintenanceTaskId
  );

  if (!currentTask) return;

  const nextTask: MaintenanceTask = {
    ...currentTask,
    label,
    type: editingMaintenanceTaskType,
  };

  const savedTask = await sendMaintenanceJson<MaintenanceTask>(
    `/api/maintenance-tasks/${editingMaintenanceTaskId}`,
    {
      method: "PUT",
      body: JSON.stringify(nextTask),
    },
    nextTask
  );

  setMaintenanceTasks((prev) =>
    prev
      .map((task) =>
        task.id === editingMaintenanceTaskId ? savedTask : task
      )
      .sort((a, b) =>
        a.label.localeCompare(b.label, "es", { sensitivity: "base" })
      )
  );

  cancelEditMaintenanceTask();
}

  async function removeMaintenanceTask(taskId: string) {
  const task = maintenanceTasks.find((item) => item.id === taskId);

  if (!task) return;

  const ok = window.confirm(`¿Eliminar la tarea "${task.label}"?`);

  if (!ok) return;

  await deleteMaintenanceApi(`/api/maintenance-tasks/${taskId}`);

  setMaintenanceTasks((prev) => prev.filter((item) => item.id !== taskId));

  if (editingMaintenanceTaskId === taskId) {
    cancelEditMaintenanceTask();
  }
}

 async function assignMaintenanceTask() {
  if (!selectedMaintenanceTask) {
    window.alert("Selecciona una tarea de mantenimiento.");
    return;
  }

  if (!selectedMaintenanceTechName) {
    window.alert("Selecciona un técnico disponible.");
    return;
  }

  const existingPendingMaintenanceTask = pendingAssignedMaintenanceTasks.find(
    (task) => task.techName === selectedMaintenanceTechName
  );

  if (existingPendingMaintenanceTask) {
    window.alert(
      `${selectedMaintenanceTechName} ya tiene una tarea de mantenimiento pendiente:\n\n${existingPendingMaintenanceTask.taskLabel}`
    );
    return;
  }

  const ok = window.confirm(
    `¿Asignar "${selectedMaintenanceTask.label}" a ${selectedMaintenanceTechName}?`
  );

  if (!ok) return;

  const assignedTask: AssignedMaintenanceTask = {
    id: `assigned-maintenance-${Date.now()}`,
    taskId: selectedMaintenanceTask.id,
    taskLabel: selectedMaintenanceTask.label,
    taskType: selectedMaintenanceTask.type,
    techName: selectedMaintenanceTechName,
    assignedAtMs: Date.now(),
    status: "pendiente",
    statusChangedAtMs: null,
  };

  const savedTask = await sendMaintenanceJson<AssignedMaintenanceTask>(
    "/api/assigned-maintenance-tasks",
    {
      method: "POST",
      body: JSON.stringify(assignedTask),
    },
    assignedTask
  );

  setAssignedMaintenanceTasks((prev) => [savedTask, ...prev]);
  setSelectedMaintenanceTechName("");
}


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

async function resumeInterruptedMaintenanceTask(assignedTaskId: string) {
  const task = assignedMaintenanceTasks.find(
    (item) => item.id === assignedTaskId
  );

  if (!task) return;

  if (task.status !== "interrumpida") {
    window.alert("Solo se pueden reanudar tareas interrumpidas.");
    return;
  }

  const tech = techs.find((item) => item.name === task.techName);

  if (!tech) {
    window.alert("No se ha encontrado el técnico asignado.");
    return;
  }

  if (
    normalizeTechStatus(tech.status) !== "disponible" ||
    tech.currentJobId != null
  ) {
    window.alert(
      "Este técnico todavía no está disponible. No se puede reanudar la tarea."
    );
    return;
  }

  const ok = window.confirm(
    `¿Reanudar "${task.taskLabel}" con ${task.techName}?`
  );

  if (!ok) return;

  const fallbackTask: AssignedMaintenanceTask = {
    ...task,
    status: "pendiente",
    assignedAtMs: Date.now(),
    statusChangedAtMs: null,
  };

  const savedTask = await sendMaintenanceJson<AssignedMaintenanceTask>(
    `/api/assigned-maintenance-tasks/${assignedTaskId}/resume`,
    {
      method: "PUT",
    },
    fallbackTask
  );

  setAssignedMaintenanceTasks((prev) =>
    prev.map((item) => (item.id === assignedTaskId ? savedTask : item))
  );
}

  async function removeAssignedMaintenanceTask(assignedTaskId: string) {
  const task = assignedMaintenanceTasks.find(
    (item) => item.id === assignedTaskId
  );

  if (!task) return;

  const ok = window.confirm(
    `¿Borrar la asignación "${task.taskLabel}" de ${task.techName}?`
  );

  if (!ok) return;

  await deleteMaintenanceApi(
    `/api/assigned-maintenance-tasks/${assignedTaskId}`
  );

  setAssignedMaintenanceTasks((prev) =>
    prev.filter((item) => item.id !== assignedTaskId)
  );
}

  async function clearFinishedMaintenanceTasks() {
  const historyTasks = assignedMaintenanceTasks.filter(
    (task) => task.status === "finalizada" || task.status === "interrumpida"
  );

  if (historyTasks.length === 0) {
    window.alert("No hay tareas finalizadas o interrumpidas para limpiar.");
    return;
  }

  const ok = window.confirm(
    `¿Limpiar ${historyTasks.length} tarea(s) finalizada(s) o interrumpida(s)?`
  );

  if (!ok) return;

  await deleteMaintenanceApi("/api/assigned-maintenance-tasks/history");

  setAssignedMaintenanceTasks((prev) =>
    prev.filter(
      (task) => task.status !== "finalizada" && task.status !== "interrumpida"
    )
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

  const interruptedAssignedMaintenanceTasks = assignedMaintenanceTasks.filter(
  (task) => task.status === "interrumpida"
);

  const historyAssignedMaintenanceTasks = assignedMaintenanceTasks.filter(
    (task) => task.status === "finalizada" || task.status === "interrumpida"
  );

  const visibleAssignedMaintenanceTasks = showFinishedMaintenanceTasks
    ? assignedMaintenanceTasks
    : assignedMaintenanceTasks.filter((task) => task.status === "pendiente");

  const maintenanceTechNames = Array.from(
    new Set(pendingAssignedMaintenanceTasks.map((task) => task.techName))
  );

  const outsideMaintenanceTechNames = Array.from(
    new Set(pendingOutsideMaintenanceTasks.map((task) => task.techName))
  );

  const availableMaintenanceTechs = techs.filter((tech) => {
  const hasAnyPendingMaintenanceTask = pendingAssignedMaintenanceTasks.some(
    (task) => task.techName === tech.name
  );

  return (
    normalizeTechStatus(tech.status) === "disponible" &&
    tech.currentJobId == null &&
    !hasAnyPendingMaintenanceTask
  );
});

  const selectedMaintenanceTask =
    maintenanceTasks.find((task) => task.id === selectedMaintenanceTaskId) ??
    maintenanceTasks[0] ??
    null;

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
              {activeJobs.length}
            </span>
          </div>

          {activeJobs.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
              No hay trabajos activos.
            </div>
          ) : (
            <div className="grid gap-3 2xl:grid-cols-2">
              {activeJobs.slice(0, 6).map((job) => {
                const assignedNames = job.assignedNames || [];
                const workedMinutes = getLiveWorkedMinutes(job, nowTick);

                return (
                  <div
                    key={job.id}
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
            </div>
          )}
        </section>

        <div className="space-y-4">
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-emerald-950">
                  Tareas de mantenimiento
                </h2>
                <p className="text-xs font-semibold text-emerald-700">
                  En taller no bloquea trabajos. Fuera de taller sí bloquea.
                </p>
              </div>

              <div className="flex items-center gap-2">
  <span
    className={`rounded-full px-3 py-1 text-xs font-black ${
      maintenanceApiLoaded
        ? "bg-emerald-100 text-emerald-700"
        : "bg-amber-100 text-amber-700"
    }`}
  >
    {maintenanceApiLoaded ? "API" : "LOCAL"}
  </span>

  <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">
    {maintenanceTasks.length}
  </span>
</div>
            </div>

            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-amber-200 bg-white px-3 py-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-amber-700">
                  Pendientes
                </div>
                <div className="text-2xl font-black text-amber-900">
                  {pendingAssignedMaintenanceTasks.length}
                </div>
              </div>

              <div className="rounded-2xl border border-sky-200 bg-white px-3 py-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-sky-700">
                  Interrumpidas
                </div>
                <div className="text-2xl font-black text-sky-900">
                  {interruptedAssignedMaintenanceTasks.length}
                </div>
              </div>

              <div className="rounded-2xl border border-red-200 bg-white px-3 py-3">
                <div className="text-[10px] font-black uppercase tracking-wide text-red-600">
                  Fuera de taller
                </div>
                <div className="text-2xl font-black text-red-700">
                  {outsideMaintenanceTechNames.length}
                </div>
              </div>
            </div>

            {maintenanceTechNames.length > 0 && (
              <div className="mb-3 rounded-2xl border border-emerald-200 bg-white p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-emerald-800">
                  Ahora en mantenimiento
                </div>

                <div className="flex flex-wrap gap-2">
                  {maintenanceTechNames.map((name) => {
                    const task = pendingAssignedMaintenanceTasks.find(
                      (item) => item.techName === name
                    );

                    return (
                      <div
                        key={name}
                        className={`rounded-full border px-3 py-2 text-xs font-black ${
                          task?.taskType === "fuera_taller"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        {name}
                        {task ? ` · ${task.taskLabel}` : ""}
                        {task
                          ? ` · ${getMaintenanceTaskTypeLabel(task.taskType)}`
                          : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mb-3 rounded-2xl border border-emerald-200 bg-white p-3">
              <label className="mb-2 block text-xs font-black uppercase tracking-wide text-emerald-800">
                Crear tarea
              </label>

              <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                <input
                  type="text"
                  value={newMaintenanceTaskLabel}
                  onChange={(event) =>
                    setNewMaintenanceTaskLabel(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      addMaintenanceTask();
                    }
                  }}
                  placeholder="Ej: Barrer zona camiones"
                  className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400"
                />

                <select
                  value={newMaintenanceTaskType}
                  onChange={(event) =>
                    setNewMaintenanceTaskType(
                      event.target.value as MaintenanceTaskType
                    )
                  }
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400"
                >
                  <option value="en_taller">En taller</option>
                  <option value="fuera_taller">Fuera taller</option>
                </select>

                <button
                  type="button"
                  onClick={addMaintenanceTask}
                  className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700"
                >
                  Crear
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-white">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-emerald-100 text-xs uppercase tracking-wide text-emerald-900">
                  <tr>
                    <th className="px-3 py-3 font-black">Tarea</th>
                    <th className="w-[130px] px-3 py-3 font-black">Tipo</th>
                    <th className="w-[190px] px-3 py-3 text-right font-black">
                      Acciones
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {maintenanceTasks.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-6 text-center text-sm font-semibold text-slate-500"
                      >
                        No hay tareas de mantenimiento.
                      </td>
                    </tr>
                  ) : (
                    maintenanceTasks.map((task) => {
                      const isEditing = editingMaintenanceTaskId === task.id;

                      return (
                        <tr
                          key={task.id}
                          className="border-t border-emerald-100 align-middle"
                        >
                          <td className="px-3 py-3">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingMaintenanceTaskLabel}
                                onChange={(event) =>
                                  setEditingMaintenanceTaskLabel(
                                    event.target.value
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    saveMaintenanceTask();
                                  }

                                  if (event.key === "Escape") {
                                    cancelEditMaintenanceTask();
                                  }
                                }}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400"
                                autoFocus
                              />
                            ) : (
                              <div className="font-bold text-slate-900">
                                {task.label}
                              </div>
                            )}
                          </td>

                          <td className="px-3 py-3">
                            {isEditing ? (
                              <select
                                value={editingMaintenanceTaskType}
                                onChange={(event) =>
                                  setEditingMaintenanceTaskType(
                                    event.target.value as MaintenanceTaskType
                                  )
                                }
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold outline-none focus:border-emerald-400"
                              >
                                <option value="en_taller">En taller</option>
                                <option value="fuera_taller">
                                  Fuera taller
                                </option>
                              </select>
                            ) : (
                              <span
                                className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                                  task.type === "fuera_taller"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-emerald-100 text-emerald-700"
                                }`}
                              >
                                {getMaintenanceTaskTypeLabel(task.type)}
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-3">
                            {isEditing ? (
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={saveMaintenanceTask}
                                  className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white"
                                >
                                  Guardar
                                </button>

                                <button
                                  type="button"
                                  onClick={cancelEditMaintenanceTask}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    startEditMaintenanceTask(task)
                                  }
                                  className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
                                >
                                  Editar
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    removeMaintenanceTask(task.id)
                                  }
                                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100"
                                >
                                  Borrar
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 rounded-2xl border border-emerald-200 bg-white p-3">
              <div className="mb-3">
                <h3 className="text-sm font-black text-emerald-950">
                  Asignar tarea a técnico disponible
                </h3>
                <p className="text-xs font-semibold text-emerald-700">
                  Cada técnico puede tener una tarea de mantenimiento pendiente. En taller no bloquea trabajos reales; fuera de taller sí bloquea.
                </p>
              </div>

              <div className="grid gap-2">
                <div>
                  <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
                    Tarea
                  </label>

                  <select
                    value={selectedMaintenanceTaskId}
                    onChange={(event) =>
                      setSelectedMaintenanceTaskId(event.target.value)
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400"
                  >
                    {maintenanceTasks.length === 0 ? (
                      <option value="">No hay tareas</option>
                    ) : (
                      maintenanceTasks.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.label} · {getMaintenanceTaskTypeLabel(task.type)}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">
                    Técnico disponible
                  </label>

                  <select
                    value={selectedMaintenanceTechName}
                    onChange={(event) =>
                      setSelectedMaintenanceTechName(event.target.value)
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400"
                  >
                    <option value="">Seleccionar técnico</option>

                    {availableMaintenanceTechs.map((tech) => (
                      <option key={tech.name} value={tech.name}>
                        {tech.name}
                      </option>
                    ))}
                  </select>

                  {availableMaintenanceTechs.length === 0 && (
                    <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                      No hay técnicos disponibles ahora mismo.
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={assignMaintenanceTask}
                  disabled={
                    !selectedMaintenanceTask ||
                    !selectedMaintenanceTechName ||
                    availableMaintenanceTechs.length === 0
                  }
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Asignar tarea visual
                </button>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-black text-slate-900">
                      Tareas asignadas
                    </h4>
                    <p className="text-xs font-semibold text-slate-500">
                      {showFinishedMaintenanceTasks
                        ? "Mostrando pendientes, finalizadas e interrumpidas."
                        : "Mostrando solo tareas pendientes."}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setShowFinishedMaintenanceTasks((current) => !current)
                      }
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      {showFinishedMaintenanceTasks
                        ? "Ocultar historial"
                        : "Mostrar historial"}
                    </button>

                    <button
                      type="button"
                      onClick={clearFinishedMaintenanceTasks}
                      disabled={historyAssignedMaintenanceTasks.length === 0}
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Limpiar historial
                    </button>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-100 uppercase tracking-wide text-slate-600">
                      <tr>
                        <th className="px-3 py-3 font-black">Tarea</th>
                        <th className="px-3 py-3 font-black">Tipo</th>
                        <th className="px-3 py-3 font-black">Técnico</th>
                        <th className="px-3 py-3 font-black">Estado</th>
                        <th className="px-3 py-3 font-black">Tiempo</th>
                        <th className="px-3 py-3 text-right font-black">
                          Acciones
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {visibleAssignedMaintenanceTasks.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-3 py-6 text-center text-sm font-semibold text-slate-500"
                          >
                            No hay tareas asignadas.
                          </td>
                        </tr>
                      ) : (
                        visibleAssignedMaintenanceTasks.map((task) => (
                          <tr key={task.id} className="border-t border-slate-100">
                            <td className="px-3 py-3 font-bold text-slate-900">
                              {task.taskLabel}
                            </td>

                            <td className="px-3 py-3">
                              <span
                                className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                                  task.taskType === "fuera_taller"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-emerald-100 text-emerald-700"
                                }`}
                              >
                                {getMaintenanceTaskTypeLabel(task.taskType)}
                              </span>
                            </td>

                            <td className="px-3 py-3 font-semibold text-slate-700">
                              {task.techName}
                            </td>

                            <td className="px-3 py-3">
                              <span
                                className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${getAssignedMaintenanceStatusClass(
                                  task.status
                                )}`}
                              >
                                {getAssignedMaintenanceStatusLabel(task.status)}
                              </span>
                            </td>

                            <td className="px-3 py-3 font-semibold text-slate-500">
  {formatMaintenanceAssignedAt(task.assignedAtMs)}
</td>

<td className="px-3 py-3 font-black text-slate-700">
  {formatMaintenanceElapsedTime(task, nowTick)}
</td>

<td className="px-3 py-3">
                              <div className="flex justify-end gap-2">
 {task.status === "pendiente" && (
  <>
    {task.taskType === "en_taller" && (
      <button
        type="button"
        onClick={() => interruptAssignedMaintenanceTask(task.id)}
        className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100"
      >
        Interrumpir
      </button>
    )}

    <button
      type="button"
      onClick={() => finishAssignedMaintenanceTask(task.id)}
      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100"
    >
      Finalizar
    </button>
  </>
)}
  {task.status === "interrumpida" && (
    <button
      type="button"
      onClick={() => resumeInterruptedMaintenanceTask(task.id)}
      className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100"
    >
      Reanudar
    </button>
  )}

  <button
    type="button"
    onClick={() => removeAssignedMaintenanceTask(task.id)}
    className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100"
  >
    Borrar
  </button>
</div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

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
                                : "Sin trabajo asignado"}
                        </div>
                      </div>
                    </div>

                    <span className="shrink-0 rounded-full border border-white/80 bg-white/80 px-2 py-1 text-[10px] font-black">
                      {pendingOutsideMaintenanceTask
                        ? "FUERA TALLER"
                        : pendingWorkshopMaintenanceTask
                          ? "MANT. TALLER"
                          : getTechStatusLabel(tech.status)}
                    </span>
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