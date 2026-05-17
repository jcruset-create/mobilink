import type { IncludedTask } from "./quickTaskSelector";

export type TechStatus =
  | "disponible"
  | "ocupado"
  | "refuerzo"
  | "nodisponible"
  | "supervisor"
  | "vacaciones"
  | "baja"
  | "permiso"
  | "otro_taller";

export type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";

export type JobStatus =
  | "espera"
  | "validacion"
  | "activo"
  | "parado"
  | "cerrado"
  | "bloqueado";

export type TemplateKey = "alineacion_camion" | "pinchazo_camion";

export type QuickEntryMode = "single" | "team";

export type CompetencyKey = AreaKey | TemplateKey;

export type AssignmentRole = "responsable" | "apoyo";

export type QuickTemplate = {
  key: string;
  label: string;
  area: AreaKey;
  mode: QuickEntryMode;
  allowedTechs: string[];
  priorityOrder: string[];
  standardMinutes?: number | null;
};

export type LinkedTemplate = {
  id: string;
  label: string;
  firstTemplateKey: string;
  secondTemplateKey: string;
};

export type RoleCapability = {
  responsable: boolean;
  apoyo: boolean;
};

export type RolePriority = {
  responsable: number;
  apoyo: number;
};

export type Tech = {
  name: string;
  status: TechStatus;
  currentJobId: number | null;
  blocked: boolean;
  competencies: Record<CompetencyKey, RoleCapability>;
  priorities: Record<AreaKey, RolePriority>;
  avatar?: string;
  statusChangedAtMs?: number | null;
  statusTotals?: Partial<Record<TechStatus, number>>;
};

export type SavedTechConfig = {
  name: string;
  competencies: Record<CompetencyKey, RoleCapability>;
  priorities: Record<AreaKey, RolePriority>;
};

export type Job = {
  id: number;
  area: AreaKey;
  plate: string;
  urgent: boolean;
  status: JobStatus;
  assignedNames: string[];
  reason: string;
  customerName?: string;
  customerPhone?: string;
  createdAtMs: number;
  startedAtMs: number | null;
  closedAtMs?: number;
  template?: TemplateKey | null;
  quickEntryLabel?: string | null;
  quickEntryMode?: QuickEntryMode | null;
  includedTasks?: IncludedTask[];
  actualMinutes?: number | null;
  workedAccumulatedMinutes?: number | null;
  pausedAccumulatedMinutes?: number | null;
  pausedAtMs?: number | null;
  linkedGroupId?: string | null;
  dependsOnJobId?: number | null;
  blockedReason?: string | null;
  linkedOrder?: 1 | 2 | null;
  blockedByJobId?: number | null;
};

export type AllocationResult = {
  assigned: boolean;
  assignedNames: string[];
  reason: string;
  techs: Tech[];
  jobs: Job[];
  needsRamonApproval?: boolean;
};

export type CandidateOptions = {
  includeSupport?: boolean;
  allowSupervisorManual?: boolean;
  forSupportRole?: boolean;
  allowRamonAuto?: boolean;
};

export type LogItem = { id: number; time: string; text: string };

export type TestResult = { name: string; pass: boolean };

export type OperationSummary = {
  key: string;
  label: string;
  count: number;
  averageMinutes: number;
  lastMinutes: number | null;
};

export type TechHoursSummary = {
  name: string;
  responsable: { daily: number; weekly: number; monthly: number };
  apoyo: { daily: number; weekly: number; monthly: number };
};

export type TechLoadStat = {
  techName: string;
  activeCount: number;
  totalOpenMinutes: number;
};

export type JobPrediction = {
  predictedMinutes: number | null;
  source: "template" | "area" | "none";
};

export type WorkshopAlert = {
  id: string;
  level: "info" | "warning" | "danger";
  text: string;
};

export type TechOperationStat = {
  techName: string;
  operationKey: string;
  operationLabel: string;
  totalMinutes: number;
  count: number;
  averageMinutes: number;
};

export type TechClosureStat = {
  techName: string;
  closedCount: number;
  totalMinutes: number;
  averageMinutes: number;
};

export type AISuggestion = {
  id: string;
  text: string;
};