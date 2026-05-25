import type { IncludedTask } from "./quickTaskSelector";
import type { WorkshopId } from "./workshops";

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
  workshopId?: WorkshopId | string | null;

  /**
   * V2:
   * - usesQuantity: indica si este servicio se trabaja por cantidad.
   * - unitMinutes: minutos por unidad.
   * - unitPrice: precio por unidad.
   *
   * Compatibilidad:
   * Si no existen, la app debe interpretar cantidad = 1,
   * unitMinutes = standardMinutes y unitPrice = 0.
   */
  usesQuantity?: boolean;
  unitMinutes?: number | null;
  unitPrice?: number | null;
};

export type LinkedTemplate = {
  id: string;
  label: string;
  firstTemplateKey: string;
  secondTemplateKey: string;
  workshopId?: WorkshopId | string | null;
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
  workshopId?: WorkshopId | string | null;
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
  workshopId?: WorkshopId | string | null;
  competencies: Record<CompetencyKey, RoleCapability>;
  priorities: Record<AreaKey, RolePriority>;
};

export type Job = {
  id: number;
  workshopId?: WorkshopId | string | null;
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

  /**
   * Tiempo estándar total previsto para el trabajo.
   * En v2 se mantiene como total calculado para compatibilidad:
   * quantity × unitMinutes.
   */
  standardMinutes?: number | null;

  actualMinutes?: number | null;
  workedAccumulatedMinutes?: number | null;
  pausedAccumulatedMinutes?: number | null;
  pausedAtMs?: number | null;
  linkedGroupId?: string | null;
  dependsOnJobId?: number | null;
  blockedReason?: string | null;
  linkedOrder?: 1 | 2 | null;
  blockedByJobId?: number | null;

  /**
   * Reserva manual desde cola:
   * permite elegir un técnico ocupado para que el trabajo se inicie
   * automáticamente cuando ese técnico termine su trabajo actual.
   */
  reservedTechName?: string | null;
  reservedAtMs?: number | null;

  /**
   * V2:
   * Cantidad, tiempo unitario y precio unitario del trabajo.
   *
   * Compatibilidad:
   * - quantity vacío = 1
   * - unitMinutes vacío = standardMinutes
   * - unitPrice vacío = 0
   * - standardMinutes se mantiene como tiempo total calculado
   *   para no romper pantallas antiguas.
   */
  quantity?: number | null;
  unitMinutes?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
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
  workshopId?: WorkshopId | string | null;
  responsable: { daily: number; weekly: number; monthly: number };
  apoyo: { daily: number; weekly: number; monthly: number };
};

export type TechLoadStat = {
  techName: string;
  workshopId?: WorkshopId | string | null;
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
  workshopId?: WorkshopId | string | null;
  operationKey: string;
  operationLabel: string;
  totalMinutes: number;
  count: number;
  averageMinutes: number;
};

export type TechClosureStat = {
  techName: string;
  workshopId?: WorkshopId | string | null;
  closedCount: number;
  totalMinutes: number;
  averageMinutes: number;
};

export type AISuggestion = {
  id: string;
  text: string;
};