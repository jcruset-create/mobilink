export type ValidationTechStatus =
  | "disponible"
  | "ocupado"
  | "refuerzo"
  | "nodisponible"
  | "supervisor"
  | "vacaciones"
  | "baja"
  | "permiso"
  | "otro_taller";

export type ValidationJobStatus =
  | "espera"
  | "validacion"
  | "activo"
  | "parado"
  | "cerrado"
  | "bloqueado";

export type ValidationAssignmentRole = "responsable" | "apoyo";

export type ValidationRoleCapability = {
  responsable: boolean;
  apoyo: boolean;
};

export type ValidationTech = {
  name: string;
  status: ValidationTechStatus;
  currentJobId: number | null;
  blocked: boolean;
  competencies: Record<string, ValidationRoleCapability>;
};

export type ValidationQuickTemplate = {
  key: string;
  label: string;
  area: string;
  allowedTechs: string[];
};

export type ValidationJob = {
  id: number;
  area: string;
  plate: string;
  status: ValidationJobStatus;
  assignedNames: string[];
  reason: string;
  startedAtMs: number | null;
  template?: string | null;
  quickEntryLabel?: string | null;
};

export function isUnavailableTechStatus(status: ValidationTechStatus) {
  return [
    "nodisponible",
    "vacaciones",
    "baja",
    "permiso",
    "otro_taller",
  ].includes(status);
}

export function isTechUnavailableForAssignment(tech: ValidationTech) {
  return tech.blocked || isUnavailableTechStatus(tech.status);
}

export function getValidationLabel(job: Pick<ValidationJob, "assignedNames">) {
  const assignedNames = job.assignedNames ?? [];

  if (assignedNames.length === 0) {
    return "Pendiente de propuesta";
  }

  return `Propuesta: ${assignedNames.join(" + ")}`;
}

export function canStartProposedJob(
  job: Pick<ValidationJob, "assignedNames">,
  techs: ValidationTech[]
) {
  const assignedNames = job.assignedNames ?? [];

  if (assignedNames.length === 0) {
    return {
      ok: false,
      reason: "No hay técnicos propuestos.",
    };
  }

  for (const name of assignedNames) {
    const tech = techs.find((item) => item.name === name);

    if (!tech) {
      return {
        ok: false,
        reason: `${name} ya no existe como técnico.`,
      };
    }

    if (isTechUnavailableForAssignment(tech)) {
      return {
        ok: false,
        reason: `${name} no está disponible.`,
      };
    }

    if (tech.currentJobId != null) {
      return {
        ok: false,
        reason: `${name} ya está asignado a otro trabajo.`,
      };
    }

    if (tech.status !== "disponible" && tech.status !== "supervisor") {
      return {
        ok: false,
        reason: `${name} no está libre actualmente.`,
      };
    }
  }

  return {
    ok: true,
    reason: "",
  };
}

export function buildValidationJob<
  T extends {
    status: string;
    assignedNames: string[];
    reason: string;
    startedAtMs: number | null;
  }
>(job: T, assignedNames: string[], reason: string): T {
  return {
    ...job,
    status: "validacion",
    assignedNames,
    reason: `${reason} Pendiente de validación manual antes de iniciar.`,
    startedAtMs: null,
  };
}

export function buildAuthorizedJob<
  T extends {
    status: string;
    assignedNames: string[];
    reason: string;
    startedAtMs: number | null;
  }
>(job: T, startedAtMs: number): T {
  const assignedNames = job.assignedNames ?? [];

  return {
    ...job,
    status: "activo",
    startedAtMs,
    reason: `Inicio autorizado manualmente. Asignados: ${assignedNames.join(
      " + "
    )}.`,
  };
}

export function buildRejectedValidationJob<
  T extends {
    status: string;
    assignedNames: string[];
    reason: string;
    startedAtMs: number | null;
  }
>(job: T): T {
  return {
    ...job,
    status: "espera",
    assignedNames: [],
    startedAtMs: null,
    reason: "Propuesta rechazada. Pendiente de reasignación.",
  };
}