import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "./workshopApi";
import type { Tech } from "./workshopTypes";

export type MaintenanceAvailabilityTask = {
  id: string;
  taskId: string;
  taskLabel: string;
  taskType: "en_taller" | "fuera_taller";
  techName: string;
  assignedAtMs: number;
  status: "pendiente" | "finalizada" | "interrumpida";
  statusChangedAtMs?: number | null;
};

export type MaintenanceAvailability = {
  blockedTechNames: string[];
  workshopMaintenanceTechNames: string[];
  outsideWorkshopTasks: MaintenanceAvailabilityTask[];
  workshopTasks: MaintenanceAvailabilityTask[];
  pendingTasks: MaintenanceAvailabilityTask[];
  interruptedTasks: MaintenanceAvailabilityTask[];
  activeMaintenanceTasks: MaintenanceAvailabilityTask[];
};

type UseMaintenanceAvailabilityParams = {
  techs: Tech[];
  isAuthenticated: boolean;
  autoSyncPaused: boolean;
  lastSyncAt: number | null;
  getAdminHeaders: (extra?: HeadersInit) => HeadersInit;
};

const EMPTY_MAINTENANCE_AVAILABILITY: MaintenanceAvailability = {
  blockedTechNames: [],
  workshopMaintenanceTechNames: [],
  outsideWorkshopTasks: [],
  workshopTasks: [],
  pendingTasks: [],
  interruptedTasks: [],
  activeMaintenanceTasks: [],
};

function normalizeMaintenanceAvailability(
  data: Partial<MaintenanceAvailability>
): MaintenanceAvailability {
  return {
    blockedTechNames: Array.isArray(data.blockedTechNames)
      ? data.blockedTechNames
      : [],
    workshopMaintenanceTechNames: Array.isArray(
      data.workshopMaintenanceTechNames
    )
      ? data.workshopMaintenanceTechNames
      : [],
    outsideWorkshopTasks: Array.isArray(data.outsideWorkshopTasks)
      ? data.outsideWorkshopTasks
      : [],
    workshopTasks: Array.isArray(data.workshopTasks)
      ? data.workshopTasks
      : [],
    pendingTasks: Array.isArray(data.pendingTasks) ? data.pendingTasks : [],
    interruptedTasks: Array.isArray(data.interruptedTasks)
      ? data.interruptedTasks
      : [],
    activeMaintenanceTasks: Array.isArray(data.activeMaintenanceTasks)
      ? data.activeMaintenanceTasks
      : [],
  };
}

function formatMaintenanceSyncTime(value: number | null) {
  if (!value) return "Sin sincronizar";

  return new Date(value).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function useMaintenanceAvailability({
  techs,
  isAuthenticated,
  autoSyncPaused,
  lastSyncAt,
  getAdminHeaders,
}: UseMaintenanceAvailabilityParams) {
  const [maintenanceAvailability, setMaintenanceAvailability] =
    useState<MaintenanceAvailability>(EMPTY_MAINTENANCE_AVAILABILITY);

  const [maintenanceAvailabilitySyncedAt, setMaintenanceAvailabilitySyncedAt] =
    useState<number | null>(null);

  const [maintenanceAvailabilitySyncError, setMaintenanceAvailabilitySyncError] =
    useState(false);

  const reloadMaintenanceAvailabilityFromBackend = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/maintenance-availability`);

      if (!response.ok) {
        setMaintenanceAvailabilitySyncError(true);
        return;
      }

      const data = (await response.json()) as Partial<MaintenanceAvailability>;

      setMaintenanceAvailability(normalizeMaintenanceAvailability(data));
      setMaintenanceAvailabilitySyncedAt(Date.now());
      setMaintenanceAvailabilitySyncError(false);
    } catch {
      setMaintenanceAvailabilitySyncError(true);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    void reloadMaintenanceAvailabilityFromBackend();
  }, [isAuthenticated, reloadMaintenanceAvailabilityFromBackend]);

  const isTechBlockedByOutsideMaintenance = useCallback(
    (techName: string) => {
      return maintenanceAvailability.blockedTechNames.includes(techName);
    },
    [maintenanceAvailability.blockedTechNames]
  );

  const hasAnyTechBlockedByOutsideMaintenance = useCallback(
    (techNames: string[]) => {
      const blockedTech = techNames.find((name) =>
        isTechBlockedByOutsideMaintenance(name)
      );

      if (!blockedTech) {
        return false;
      }

      window.alert(
        `${blockedTech} está en una tarea de mantenimiento fuera de taller y no puede recibir trabajos reales ahora.`
      );

      return true;
    },
    [isTechBlockedByOutsideMaintenance]
  );

  const getInterruptedMaintenanceTasksForTechs = useCallback(
    (techNames: string[]) => {
      return maintenanceAvailability.interruptedTasks.filter(
        (task) =>
          techNames.includes(task.techName) &&
          task.taskType === "en_taller" &&
          task.status === "interrumpida"
      );
    },
    [maintenanceAvailability.interruptedTasks]
  );

  const outsideMaintenanceTechsSummary = useMemo(() => {
    return techs
      .filter((tech) => isTechBlockedByOutsideMaintenance(tech.name))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [techs, isTechBlockedByOutsideMaintenance]);

  const workshopMaintenanceTechsSummary = useMemo(() => {
    return techs
      .filter((tech) =>
        maintenanceAvailability.workshopMaintenanceTechNames.includes(tech.name)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [techs, maintenanceAvailability.workshopMaintenanceTechNames]);

  const maintenanceSummaryCounts = useMemo(() => {
    return {
      workshop: maintenanceAvailability.workshopTasks.length,
      outside: maintenanceAvailability.outsideWorkshopTasks.length,
      interrupted: maintenanceAvailability.interruptedTasks.length,
    };
  }, [maintenanceAvailability]);

  const maintenanceAttentionCount = useMemo(() => {
    return (
      maintenanceSummaryCounts.workshop +
      maintenanceSummaryCounts.outside +
      maintenanceSummaryCounts.interrupted
    );
  }, [maintenanceSummaryCounts]);

  const interruptedMaintenanceSummary = useMemo(() => {
    const now = Date.now();
    const maxAgeMs = 12 * 60 * 60 * 1000;

    return maintenanceAvailability.interruptedTasks
      .filter((task) => {
        if (task.taskType !== "en_taller") return false;

        const changedAtMs = task.statusChangedAtMs ?? task.assignedAtMs;

        return now - changedAtMs <= maxAgeMs;
      })
      .sort((a, b) => {
        const aTime = a.statusChangedAtMs ?? a.assignedAtMs;
        const bTime = b.statusChangedAtMs ?? b.assignedAtMs;

        return bTime - aTime;
      });
  }, [maintenanceAvailability.interruptedTasks, lastSyncAt]);

  const oldInterruptedMaintenanceSummary = useMemo(() => {
    const now = Date.now();
    const maxAgeMs = 12 * 60 * 60 * 1000;

    return maintenanceAvailability.interruptedTasks.filter((task) => {
      if (task.taskType !== "en_taller") return false;

      const changedAtMs = task.statusChangedAtMs ?? task.assignedAtMs;

      return now - changedAtMs > maxAgeMs;
    });
  }, [maintenanceAvailability.interruptedTasks, lastSyncAt]);

  const maintenanceAvailabilityIsStale = useMemo(() => {
    if (autoSyncPaused) return false;
    if (!maintenanceAvailabilitySyncedAt) return true;

    return Date.now() - maintenanceAvailabilitySyncedAt > 30 * 1000;
  }, [autoSyncPaused, maintenanceAvailabilitySyncedAt, lastSyncAt]);

  const clearMaintenanceHistoryFromPanel = useCallback(async () => {
    const oldHistoryCount = oldInterruptedMaintenanceSummary.length;

    if (oldHistoryCount === 0) {
      window.alert(
        "No hay historial antiguo para limpiar. Las tareas interrumpidas recientes se mantienen para poder revisarlas."
      );
      return;
    }

    const ok = window.confirm(
      `¿Limpiar ${oldHistoryCount} tarea(s) de mantenimiento interrumpida(s) antigua(s)?`
    );

    if (!ok) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/assigned-maintenance-tasks/old-interrupted`,
        {
          method: "DELETE",
          headers: getAdminHeaders(),
        }
      );

      if (!response.ok) {
        window.alert("No se ha podido limpiar el historial de mantenimiento.");
        return;
      }

      const oldInterruptedIds = new Set(
        oldInterruptedMaintenanceSummary.map((task) => task.id)
      );

      setMaintenanceAvailability((prev) => ({
        ...prev,
        interruptedTasks: prev.interruptedTasks.filter(
          (task) => !oldInterruptedIds.has(task.id)
        ),
        activeMaintenanceTasks: prev.activeMaintenanceTasks.filter(
          (task) => !oldInterruptedIds.has(task.id)
        ),
      }));

      await reloadMaintenanceAvailabilityFromBackend();
    } catch (error) {
      console.error("Error limpiando historial de mantenimiento:", error);
      window.alert("Error limpiando historial de mantenimiento.");
    }
  }, [
    getAdminHeaders,
    oldInterruptedMaintenanceSummary,
    reloadMaintenanceAvailabilityFromBackend,
  ]);

  return {
    maintenanceAvailability,
    maintenanceAvailabilitySyncedAt,
    maintenanceAvailabilitySyncError,
    maintenanceAvailabilityIsStale,
    outsideMaintenanceTechsSummary,
    workshopMaintenanceTechsSummary,
    interruptedMaintenanceSummary,
    oldInterruptedMaintenanceSummary,
    maintenanceSummaryCounts,
    maintenanceAttentionCount,
    reloadMaintenanceAvailabilityFromBackend,
    isTechBlockedByOutsideMaintenance,
    hasAnyTechBlockedByOutsideMaintenance,
    getInterruptedMaintenanceTasksForTechs,
    clearMaintenanceHistoryFromPanel,
    formatMaintenanceSyncTime,
  };
}
