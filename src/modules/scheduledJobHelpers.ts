import type { Job } from "./workshopTypes";
import type { ScheduledJob } from "../components/AgendaView";

export function getScheduledJobCurrentPhaseLabel(
  scheduled: ScheduledJob,
  jobsToCheck: Job[]
) {
  const firstJob =
    scheduled.jobId != null
      ? jobsToCheck.find((job) => job.id === scheduled.jobId)
      : null;

  const secondJob =
    scheduled.secondJobId != null
      ? jobsToCheck.find((job) => job.id === scheduled.secondJobId)
      : null;

  if (!scheduled.secondJobId) {
    if (!firstJob) return "Trabajo pendiente";
    if (firstJob.status === "validacion") return "Pendiente de validar";
    if (firstJob.status === "activo") return "Trabajo en curso";
    if (firstJob.status === "espera") return "En cola";
    if (firstJob.status === "cerrado") return "Trabajo cerrado";
    return "Trabajo pendiente";
  }

  if (firstJob && firstJob.status !== "cerrado") {
    if (firstJob.status === "validacion") {
      return "1º trabajo pendiente de validar";
    }

    if (firstJob.status === "activo") {
      return "1º trabajo en curso";
    }

    if (firstJob.status === "espera") {
      return "1º trabajo en cola";
    }

    return "1º trabajo pendiente";
  }

  if (secondJob) {
    if (secondJob.status === "parado") {
      return "2º trabajo bloqueado";
    }

    if (secondJob.status === "validacion") {
      return "2º trabajo pendiente de validar";
    }

    if (secondJob.status === "activo") {
      return "2º trabajo en curso";
    }

    if (secondJob.status === "espera") {
      return "2º trabajo en cola";
    }

    if (secondJob.status === "cerrado") {
      return "Cita completada";
    }
  }

  return "Trabajo vinculado pendiente";
}

export function shouldCloseScheduledJobForFinishedJob(
  scheduled: ScheduledJob | null,
  jobId: number
) {
  if (!scheduled) return false;

  if (!scheduled.secondJobId) {
    return scheduled.jobId === jobId;
  }

  return scheduled.secondJobId === jobId;
}