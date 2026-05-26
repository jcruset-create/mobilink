import { API_BASE, fetchWithTimeout, getAdminHeaders } from "./workshopApi";

export type MaintenanceTaskType = "en_taller" | "fuera_taller";

export type MaintenanceTask = {
  id: string;
  label: string;
  type: MaintenanceTaskType;
};

export type AssignedMaintenanceTask = {
  id: string;
  taskId: string;
  taskLabel: string;
  taskType: MaintenanceTaskType;
  techName: string;
  assignedAtMs: number;
  status: "pendiente" | "finalizada" | "interrumpida";
  statusChangedAtMs?: number | null;
};

function normalizeMaintenanceTask(item: unknown): MaintenanceTask | null {
  if (!item || typeof item !== "object") return null;

  const raw = item as Partial<MaintenanceTask>;

  const id = String(raw.id || "").trim();
  const label = String(raw.label || "").trim();

  if (!id || !label) return null;

  const type: MaintenanceTaskType =
    raw.type === "fuera_taller" || raw.type === "en_taller"
      ? raw.type
      : "en_taller";

  return {
    id,
    label,
    type,
  };
}

function isMaintenanceTask(
  task: MaintenanceTask | null
): task is MaintenanceTask {
  return task !== null;
}

export async function loadMaintenanceTasksFromBackend(): Promise<
  MaintenanceTask[]
> {
  const response = await fetchWithTimeout(`${API_BASE}/api/maintenance-tasks`);

  if (!response.ok) {
    throw new Error(
      `Error cargando tareas de mantenimiento. Código ${response.status}.`
    );
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(normalizeMaintenanceTask).filter(isMaintenanceTask);
}

export async function assignMaintenanceTaskToBackend(params: {
  task: MaintenanceTask;
  techName: string;
}): Promise<AssignedMaintenanceTask> {
  const now = Date.now();

  const assignedTask: AssignedMaintenanceTask = {
    id: `assigned-maintenance-${now}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    taskId: params.task.id,
    taskLabel: params.task.label,
    taskType: params.task.type,
    techName: params.techName,
    assignedAtMs: now,
    status: "pendiente",
    statusChangedAtMs: null,
  };

  const response = await fetchWithTimeout(
    `${API_BASE}/api/assigned-maintenance-tasks`,
    {
      method: "POST",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(assignedTask),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    throw new Error(
      errorData?.error ||
        `Error asignando mantenimiento. Código ${response.status}.`
    );
  }

  return response.json();
}