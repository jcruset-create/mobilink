import React, { useMemo, useRef, useState, type SetStateAction } from "react";
import type { ScheduledJob } from "../components/AgendaView";
import type {
  AllocationResult,
  Job,
  QuickTemplate,
  Tech,
} from "./workshopTypes";
import { shouldCloseScheduledJobForFinishedJob as shouldCloseScheduledJobForFinishedJobHelper } from "./scheduledJobHelpers";
import {
  API_BASE,
  deleteScheduledJobFromBackend,
  fetchWithTimeout,
  loadScheduledJobsFromBackend,
  saveJobToBackend,
  saveTechToBackend,
} from "./workshopApi";
import { applyScheduledJobV2FieldsToJob } from "./scheduledJobToWorkV2Adapter";
import { applyScheduledJobV2PayloadFields } from "./scheduledJobV2PayloadHelpers";
import {
  normalizeJobsV2Fields,
  normalizeScheduledJobsV2Fields,
} from "./v2DataNormalizeHelpers";
import { belongsToWorkshop } from "./assignmentMutations";
import { normalizeWorkshopId, type WorkshopId } from "./workshops";
import { timeToMinutes } from "./workshopPureHelpers";
import { getAdminHeaders } from "./adminHeaders";
import { addMinutesToTime, nowMs } from "./time";
import { isBuiltInTemplateKey } from "./jobHelpers";

/**
 * Dependencias que el hook toma del componente.
 *
 * Las piezas del ciclo de trabajos (`allocateJob`, `setJobs`, `setTechs`,
 * `setNextJobId`, `reloadJobsFromBackend`) se reciben por parámetro a propósito:
 * `confirmScheduledArrival` necesita crear trabajos pero NO queremos acoplar este
 * hook con el dominio de trabajos (PASO 7). No se mueve aquí `allocateJob` ni `createJob`.
 */
export interface UseScheduledJobsParams {
  selectedWorkshopId: WorkshopId;
  visibleJobs: Job[];
  jobs: Job[];
  quickTemplates: QuickTemplate[];
  effectiveTechs: Tech[];
  nextJobId: number;
  appendLog: (text: string) => void;
  // ── Callbacks del ciclo de trabajos (PASO 7) ──
  allocateJob: (
    job: Job,
    baseTechs: Tech[],
    baseJobs: Job[],
    logResult?: boolean
  ) => AllocationResult;
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  setTechs: React.Dispatch<React.SetStateAction<Tech[]>>;
  setNextJobId: React.Dispatch<React.SetStateAction<number>>;
  reloadJobsFromBackend: () => Promise<void>;
}

export function useScheduledJobs({
  selectedWorkshopId,
  visibleJobs,
  jobs,
  quickTemplates,
  effectiveTechs,
  nextJobId,
  appendLog,
  allocateJob,
  setJobs,
  setTechs,
  setNextJobId,
  reloadJobsFromBackend,
}: UseScheduledJobsParams) {
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [scheduledJobsLoaded, setScheduledJobsLoaded] = useState(false);

  const scheduledJobsLoadedRef = useRef(false);
  const scheduledJobsDirtyRef = useRef(false);
  const scheduledJobsSaveVersionRef = useRef(0);

  const visibleScheduledJobs = useMemo(
    () =>
      scheduledJobs.filter((job) =>
        belongsToWorkshop(job, selectedWorkshopId)
      ),
    [scheduledJobs, selectedWorkshopId]
  );

  const dueScheduledJobs = useMemo(() => {
    const nowMsValue = Date.now();
    const oneHourFromNow = nowMsValue + 60 * 60 * 1000;

    const now = new Date(nowMsValue);

    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}`;

    return visibleScheduledJobs
      .filter((job) => {
        const status = String(job.status ?? "").trim().toLowerCase();

        return status === "programado";
      })
      .filter((job) => job.jobId == null)
      .filter((job) => job.secondJobId == null)
      .filter((job) => job.arrivedAtMs == null)
      .filter((job) => job.date === today)
      .filter((job) => {
        const startMs = new Date(`${job.date}T${job.startTime}`).getTime();

        if (Number.isNaN(startMs)) return false;

        return startMs <= oneHourFromNow;
      })
      .sort((a, b) => {
        const aMs = new Date(`${a.date}T${a.startTime}`).getTime();
        const bMs = new Date(`${b.date}T${b.startTime}`).getTime();

        return aMs - bMs;
      });
  }, [visibleScheduledJobs]);

  const arrivedPendingValidationScheduledJobs = useMemo(() => {
    return visibleScheduledJobs
      .filter((scheduled) => {
        if (scheduled.status !== "en_cola") return false;

        if (!scheduled.jobId) return false;

        const linkedJob = visibleJobs.find((job) => job.id === scheduled.jobId);

        if (!linkedJob) return false;

        return linkedJob.status === "validacion";
      })
      .sort((a, b) => {
        const aMs =
          a.arrivedAtMs ?? new Date(`${a.date}T${a.startTime}`).getTime();

        const bMs =
          b.arrivedAtMs ?? new Date(`${b.date}T${b.startTime}`).getTime();

        return aMs - bMs;
      });
  }, [visibleScheduledJobs, visibleJobs]);

  async function loadScheduledJobs() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/scheduled-jobs`);
      const data = await response.json();

      setScheduledJobs(
        normalizeScheduledJobsV2Fields(Array.isArray(data) ? data : [])
      );
    } catch (error) {
      console.error("Error cargando agenda:", error);
      setScheduledJobs([]);
    } finally {
      setScheduledJobsLoaded(true);
    }
  }

  async function reloadScheduledJobsFromBackend() {
    try {
      if (scheduledJobsDirtyRef.current) {
        console.log(
          "Agenda con cambios pendientes. No se recarga para no pisar datos locales."
        );
        return;
      }

      const data = await loadScheduledJobsFromBackend();

      scheduledJobsLoadedRef.current = true;
      setScheduledJobs(data);
    } catch (error) {
      console.error("Error recargando agenda:", error);
    }
  }

  async function saveScheduledJobsToBackend(
    items: ScheduledJob[],
    saveVersion: number
  ) {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/scheduled-jobs`, {
        method: "PUT",
        headers: getAdminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(items),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Error guardando agenda:", response.status, text);
        appendLog("Error guardando agenda.");
        return;
      }

      if (scheduledJobsSaveVersionRef.current === saveVersion) {
        scheduledJobsDirtyRef.current = false;
      }
    } catch (error) {
      console.error("Error guardando agenda:", error);
      appendLog("Error guardando agenda.");
    }
  }

  function setScheduledJobsAndSave(action: SetStateAction<ScheduledJob[]>) {
    setScheduledJobs((prev) => {
      const next =
        typeof action === "function"
          ? (action as (previous: ScheduledJob[]) => ScheduledJob[])(prev)
          : action;

      if (scheduledJobsLoadedRef.current) {
        scheduledJobsDirtyRef.current = true;
        scheduledJobsSaveVersionRef.current += 1;

        const saveVersion = scheduledJobsSaveVersionRef.current;

        void saveScheduledJobsToBackend(next, saveVersion);
      }

      return next;
    });
  }

  function getScheduledJobByRelatedJobId(jobId: number) {
    return (
      scheduledJobs.find(
        (scheduled) =>
          scheduled.jobId === jobId || scheduled.secondJobId === jobId
      ) ?? null
    );
  }

  function getScheduledEstimatedMinutesForJob(job: Job): number | null {
    const scheduled = getScheduledJobByRelatedJobId(job.id);

    if (!scheduled) return null;

    const directMinutes = Number(scheduled.estimatedMinutes);

    if (Number.isFinite(directMinutes) && directMinutes > 0) {
      return Math.round(directMinutes);
    }

    if (scheduled.startTime && scheduled.endTime) {
      const start = timeToMinutes(scheduled.startTime);
      const end = timeToMinutes(scheduled.endTime);
      const diff = end - start;

      if (Number.isFinite(diff) && diff > 0) {
        return Math.round(diff);
      }
    }

    return null;
  }

  function shouldCloseScheduledJobForFinishedJob(jobId: number) {
    const scheduled = getScheduledJobByRelatedJobId(jobId);
    return shouldCloseScheduledJobForFinishedJobHelper(scheduled, jobId);
  }

  async function updateScheduledJobStatusByJobId(
    jobId: number,
    status: ScheduledJob["status"]
  ) {
    const updatedScheduledJobs = scheduledJobs.map((scheduled) =>
      scheduled.jobId === jobId || scheduled.secondJobId === jobId
        ? {
            ...scheduled,
            status,
          }
        : scheduled
    );

    const payload = updatedScheduledJobs.map((scheduled) =>
      applyScheduledJobV2PayloadFields(scheduled, scheduled)
    );

    setScheduledJobs(normalizeScheduledJobsV2Fields(updatedScheduledJobs));

    try {
      await fetchWithTimeout(`${API_BASE}/api/scheduled-jobs`, {
        method: "PUT",
        headers: getAdminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Error actualizando estado de agenda:", error);
      appendLog("Error actualizando estado de una cita en agenda.");
    }
  }

  function updateScheduledJobField(
    scheduledId: number,
    field: "plate" | "customerName" | "customerPhone" | "notes",
    value: string
  ) {
    setScheduledJobsAndSave((prev) =>
      prev.map((item) =>
        item.id === scheduledId
          ? {
              ...item,
              [field]: field === "plate" ? value.toUpperCase() : value,
            }
          : item
      )
    );
  }

  function updateScheduledJobTemplate(
    scheduledId: number,
    nextTemplateKey: string
  ) {
    const template = quickTemplates.find((item) => item.key === nextTemplateKey);

    if (!template) return;

    setScheduledJobsAndSave((prev) =>
      prev.map((item) => {
        if (item.id !== scheduledId) return item;

        const standardMinutes = template.standardMinutes ?? 45;

        return {
          ...item,
          templateKey: template.key,
          area: template.area,
          linkedTemplateId: null,
          linkedTemplateLabel: null,
          firstTemplateKey: null,
          secondTemplateKey: null,
          endTime: addMinutesToTime(item.startTime, standardMinutes),
        };
      })
    );
  }

  function cancelScheduledJob(id: number) {
    const scheduled = scheduledJobs.find((item) => item.id === id);
    if (!scheduled) return;

    setScheduledJobsAndSave((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "cancelado",
              cancelledAtMs: nowMs(),
            }
          : item
      )
    );

    appendLog(`Cita cancelada: ${scheduled.plate}.`);
  }

  async function deleteArrivedScheduledJob(scheduledId: number) {
    const scheduled = scheduledJobs.find((item) => item.id === scheduledId);

    if (!scheduled) return;

    const linkedJob = scheduled.jobId
      ? jobs.find((job) => job.id === scheduled.jobId)
      : null;

    const ok = window.confirm(
      `¿Eliminar esta cita llegada pendiente?\n\nMatrícula: ${
        scheduled.plate
      }\n\nEsto solo quitará la tarjeta de "Citas llegadas pendientes de validar".${
        linkedJob
          ? `\n\nEl trabajo operativo ${linkedJob.plate} seguirá en su estado actual: ${linkedJob.status}.`
          : "\n\nNo se ha encontrado trabajo operativo vinculado."
      }`
    );

    if (!ok) return;

    setScheduledJobs((prev) =>
      prev.filter((item) => item.id !== scheduledId)
    );

    try {
      if (deleteScheduledJobFromBackend) {
        await deleteScheduledJobFromBackend(scheduledId);
      }

      appendLog(`Cita llegada eliminada: ${scheduled.plate}.`);
    } catch (error) {
      console.error("Error eliminando cita llegada:", error);

      setScheduledJobs((prev) => {
        const exists = prev.some((item) => item.id === scheduled.id);
        return exists ? prev : [...prev, scheduled];
      });

      appendLog(`Error eliminando cita llegada ${scheduled.plate}.`);

      alert(
        "No se pudo eliminar la cita llegada del servidor. Se ha restaurado en pantalla."
      );
    }
  }

  async function confirmScheduledArrival(scheduled: ScheduledJob) {
    const currentScheduled =
      scheduledJobs.find((item) => item.id === scheduled.id) ?? scheduled;

    if (currentScheduled.status !== "programado") return;
    if (currentScheduled.jobId != null) return;

    const isLinkedJob =
      !!currentScheduled.firstTemplateKey &&
      !!currentScheduled.secondTemplateKey &&
      !!currentScheduled.linkedTemplateLabel;

    const firstTemplateKey = isLinkedJob
      ? currentScheduled.firstTemplateKey
      : currentScheduled.templateKey;

    const firstTemplate = quickTemplates.find(
      (item) => item.key === firstTemplateKey
    );

    if (!firstTemplate) return;

    const createdAt = nowMs();
    const arrivedAtMs = nowMs();

    const maxExistingJobId = jobs.reduce(
      (max, job) => Math.max(max, Number(job.id) || 0),
      0
    );

    const firstJobId = Math.max(nextJobId, maxExistingJobId + 1);
    const secondJobId = firstJobId + 1;

    const linkedGroupId = isLinkedJob
      ? `linked-${currentScheduled.id}-${createdAt}`
      : null;

    const scheduledIncludedTasks = Array.isArray(currentScheduled.includedTasks)
      ? currentScheduled.includedTasks
      : [];

    const customerInfo = [
      currentScheduled.customerName
        ? `Cliente: ${currentScheduled.customerName}`
        : "",
      currentScheduled.customerPhone
        ? `Teléfono: ${currentScheduled.customerPhone}`
        : "",
      currentScheduled.notes
        ? `Observaciones: ${currentScheduled.notes}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const firstJobReasonBase =
      scheduledIncludedTasks.length > 0
        ? `Llegada confirmada desde agenda con tareas incluidas: ${scheduledIncludedTasks
            .map((task) => task.label)
            .join(" + ")}.`
        : isLinkedJob
        ? `Trabajo combinado iniciado desde agenda: ${currentScheduled.linkedTemplateLabel}.`
        : `Llegada confirmada desde agenda: ${
            currentScheduled.customerName || "cliente"
          }.`;

    const firstJobBase: Job = {
      id: firstJobId,
      workshopId: normalizeWorkshopId(
        currentScheduled.workshopId ?? selectedWorkshopId
      ),
      area: firstTemplate.area,
      plate: currentScheduled.plate.trim().toUpperCase(),
      urgent: currentScheduled.urgent,
      status: "espera",
      assignedNames: [],
      reason: customerInfo
        ? `${firstJobReasonBase} ${customerInfo}.`
        : firstJobReasonBase,

      customerName: currentScheduled.customerName || undefined,
      customerPhone: currentScheduled.customerPhone || undefined,

      createdAtMs: createdAt,
      startedAtMs: null,
      template: isBuiltInTemplateKey(firstTemplate.key) ? firstTemplate.key : null,
      quickEntryLabel: firstTemplate.label,
      quickEntryMode: firstTemplate.mode,
      includedTasks: scheduledIncludedTasks,

      linkedGroupId,
      linkedOrder: isLinkedJob ? 1 : null,
      dependsOnJobId: null,
      blockedReason: null,
    };

    const firstJob = applyScheduledJobV2FieldsToJob({
      job: firstJobBase,
      scheduled: currentScheduled,
      template: firstTemplate,
    });

    const result = allocateJob(firstJob, effectiveTechs, [firstJob, ...jobs], true);
    let jobsToSet = result.jobs;
    let jobsToSave: Job[] = [
      result.jobs.find((item) => item.id === firstJob.id) ?? firstJob,
    ];

    let createdSecondJobId: number | null = null;

    if (isLinkedJob) {
      const secondTemplate = quickTemplates.find(
        (item) => item.key === currentScheduled.secondTemplateKey
      );

      if (secondTemplate) {
        const secondJobReasonBase = `Pendiente del trabajo anterior: ${firstTemplate.label}. Trabajo combinado: ${currentScheduled.linkedTemplateLabel}.`;

        const secondJobBase: Job = {
          id: secondJobId,
          workshopId: normalizeWorkshopId(
            currentScheduled.workshopId ?? selectedWorkshopId
          ),
          area: secondTemplate.area,
          plate: currentScheduled.plate.trim().toUpperCase(),
          urgent: currentScheduled.urgent,
          status: "parado",
          assignedNames: [],
          reason: customerInfo
            ? `${secondJobReasonBase} ${customerInfo}.`
            : secondJobReasonBase,

          customerName: currentScheduled.customerName || undefined,
          customerPhone: currentScheduled.customerPhone || undefined,

          createdAtMs: createdAt + 1,
          startedAtMs: null,
          pausedAtMs: arrivedAtMs,
          workedAccumulatedMinutes: 0,
          pausedAccumulatedMinutes: 0,
          template: isBuiltInTemplateKey(secondTemplate.key)
            ? secondTemplate.key
            : null,
          quickEntryLabel: secondTemplate.label,
          quickEntryMode: secondTemplate.mode,
          includedTasks: [],

          linkedGroupId,
          linkedOrder: 2,
          dependsOnJobId: firstJob.id,
          blockedReason: `Pendiente de finalizar ${firstTemplate.label}.`,
        };

        const secondJob = applyScheduledJobV2FieldsToJob({
          job: secondJobBase,
          scheduled: {
            ...currentScheduled,
            templateKey: secondTemplate.key,
            includedTasks: [],
          },
          template: secondTemplate,
        });

        jobsToSet = [secondJob, ...result.jobs];
        jobsToSave = [...jobsToSave, secondJob];
        createdSecondJobId = secondJob.id;
      }
    }

    setJobs(normalizeJobsV2Fields(jobsToSet));
    setTechs(result.techs);

    setNextJobId((value) =>
      Math.max(value, firstJobId + jobsToSave.length)
    );

    // Calculamos el array actualizado aquí (no dentro del setter) para poder
    // guardarlo explícitamente en el try y evitar el bug de fire-and-forget.
    const updatedScheduledJobs = normalizeScheduledJobsV2Fields(
      scheduledJobs.map((item) =>
        item.id === currentScheduled.id
          ? {
              ...item,
              status: "en_cola" as const,
              arrivedAtMs,
              jobId: firstJob.id,
              secondJobId: createdSecondJobId,
            }
          : item
      )
    );

    // Actualiza UI inmediatamente (sin fire-and-forget)
    setScheduledJobs(updatedScheduledJobs);

    try {
      for (const job of jobsToSave) {
        await saveJobToBackend(job);
      }

      for (const tech of result.techs) {
        await saveTechToBackend(tech);
      }

      // Guardamos la agenda de forma explícita (awaited) para que el estado
      // persista en backend aunque el usuario recargue la página enseguida.
      scheduledJobsDirtyRef.current = true;
      scheduledJobsSaveVersionRef.current += 1;
      await saveScheduledJobsToBackend(
        updatedScheduledJobs,
        scheduledJobsSaveVersionRef.current
      );

      appendLog(
        scheduledIncludedTasks.length > 0
          ? `Llegada confirmada: ${currentScheduled.plate} · ${
              firstTemplate.label
            } + ${scheduledIncludedTasks
              .map((task) => task.label)
              .join(" + ")}${
              currentScheduled.notes ? ` · Obs: ${currentScheduled.notes}` : ""
            }. Pendiente de validar antes de iniciar.`
          : isLinkedJob
          ? `Llegada confirmada: ${currentScheduled.plate} · ${
              currentScheduled.linkedTemplateLabel
            }${
              currentScheduled.notes ? ` · Obs: ${currentScheduled.notes}` : ""
            }. Queda pendiente de validar antes de iniciar.`
          : `Llegada confirmada: ${currentScheduled.plate}${
              currentScheduled.notes ? ` · Obs: ${currentScheduled.notes}` : ""
            }. Queda pendiente de validar antes de iniciar.`
      );

      await reloadJobsFromBackend();
    } catch (error) {
      console.error("Error confirmando llegada:", error);
      appendLog(`Error guardando trabajo ${currentScheduled.plate}.`);
    }
  }

  return {
    scheduledJobs,
    setScheduledJobsAndSave,
    scheduledJobsLoaded,
    visibleScheduledJobs,
    dueScheduledJobs,
    arrivedPendingValidationScheduledJobs,
    loadScheduledJobs,
    reloadScheduledJobsFromBackend,
    getScheduledJobByRelatedJobId,
    getScheduledEstimatedMinutesForJob,
    shouldCloseScheduledJobForFinishedJob,
    updateScheduledJobStatusByJobId,
    updateScheduledJobField,
    updateScheduledJobTemplate,
    cancelScheduledJob,
    deleteArrivedScheduledJob,
    confirmScheduledArrival,
  };
}
