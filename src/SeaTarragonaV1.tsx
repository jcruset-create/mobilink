import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import AgendaView from "./components/AgendaView";
import QuickTemplateEditor from "./components/QuickTemplateEditor";
import EmptyState from "./components/EmptyState";
import { APP_VERSION } from "./version";
import type { ScheduledJob } from "./components/AgendaView";
import { useAutoSync } from "./modules/useAutoSync";
import { useMaintenanceAvailability } from "./modules/useMaintenanceAvailability";
import {
  assignMaintenanceTaskToBackend,
  loadMaintenanceTasksFromBackend,
  type MaintenanceTask,
} from "./modules/maintenanceApi";
import OperariosTVView from "./components/OperariosTVView";
import WorkshopTV75View from "./components/WorkshopTV75View";
import WorkRankingView from "./components/WorkRankingView";
import QuickEntryQuantityBox from "./components/QuickEntryQuantityBox";
import type {
  AISuggestion,
  AllocationResult,
  AreaKey,
  AssignmentRole,
  CompetencyKey,
  Job,
  JobStatus,
  LinkedTemplate,
  LogItem,
  OperationSummary,
  QuickEntryMode,
  QuickTemplate,
  SavedTechConfig,
  Tech,
  TechClosureStat,
  TechHoursSummary,
  TechLoadStat,
  TechOperationStat,
  TechStatus,
  TemplateKey,
  WorkshopAlert,
} from "./modules/workshopTypes";
import {
  addMinutesToTime,
  formatClock,
  formatMinutes,
  getElapsedMinutes,
  nowMs,
  nowTime,
} from "./modules/time";
import FinishedAndCancelledJobsView from "./components/FinishedAndCancelledJobsView";
import {
  INITIAL_QUICK_DRAFT,
  type QuickDraftState,
  resetQuickDraftAfterCreate,
} from "./modules/quickEntryV2State";

import { buildQuickEntryV2Jobs } from "./modules/quickEntryV2Builder";
import {
  buildAuthorizedJob,
  buildRejectedValidationJob,
  getValidationLabel,
} from "./modules/jobValidation";
import {
  type CustomExtraTask,
  buildSelectableIncludedTasks,
  getIncludedTasksByIds,
} from "./modules/quickTaskSelector";
import {
  type AppView,
  type UserRole,
  canAccessView,
  canUseAdminTools,
  canUseScreens,
  canUseSupervisorTools,
  getDefaultViewForRole,
  isValidUserRole,
} from "./modules/permissions";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Plus,
  ShieldAlert,
  UserCog,
  XCircle,
} from "lucide-react";
import WorkshopWallScreen from "./WorkshopWallScreen";
import {
  AREA_META,
  DEFAULT_QUICK_TEMPLATES,
  DEFAULT_RULES,
} from "./modules/workshopConstants";
import {
  canTechBeProposedForJob,
  canTechReceiveAutomaticWork,
  getTechMinutesInStatus,
  getTechStatusColor,
  getTechStatusLabel,
  isHardBlockedTechStatus,
  isTechUnavailableForAssignment,
  isUnavailableTechStatus,
  normalizeTechStatus,
  updateTechStatusTotals,
} from "./modules/techStatus";
import {
  areaPriority,
  getNextSafeJobId,
  getOperationLabel,
  getPausedMinutes,
  getPredictedTimeForJob,
  getWorkedMinutes,
  isBuiltInTemplateKey,
  isLinkedBlockedJob,
  normalizeJobFromApi,
} from "./modules/jobHelpers";
import {
  isManualUnavailableStatus,
  syncTechsWithActiveJobs,
} from "./modules/techSync";
import { getTechAvatarUrl } from "./modules/techAvatar";
import {
  INITIAL_TECHS,
  createTech,
} from "./modules/techConfig";
import {
  allocateJobPure,
  canAssignTechManuallyToJob,
  canExtractSupportFromJob,
  canSelectTechManuallyForJob,
  getValidationProposalForTech,
  runSelfTests,
} from "./modules/assignment";
import {
  getScheduledJobCurrentPhaseLabel,
  shouldCloseScheduledJobForFinishedJob as shouldCloseScheduledJobForFinishedJobHelper,
} from "./modules/scheduledJobHelpers";
import {
  API_BASE,
  deleteScheduledJobFromBackend,
  fetchWithTimeout,
  loadJobsFromBackend,
  loadLogsFromBackend,
  loadQuickTemplatesFromBackend,
  loadScheduledJobsFromBackend,
  loadTechsFromBackend,
  saveJobToBackend,
  saveTechToBackend,
} from "./modules/workshopApi";
import {
  buildOperationReport,
  buildTechClosureStats,
  buildTechHoursReport,
  buildTechLoadStats,
  buildTechOperationStats,
  buildTechStats,
} from "./modules/workshopReports";
import {
  buildAiRanking,
  buildAiSuggestions,
  buildRecommendedTechByJobId,
  buildWorkshopAlerts,
  getRecommendedTechForJob,
} from "./modules/workshopInsights";
import { downloadBackup } from "./modules/backup";
import {
  DEFAULT_WORKSHOP_ID,
  WORKSHOPS,
  getWorkshopById,
  normalizeWorkshopId,
  type WorkshopId,
} from "./modules/workshops";
import {
  INITIAL_NEW_QUICK_TEMPLATE_V2,
  buildNewQuickTemplateV2,
  getQuickTemplateV2BackendPayload,
  normalizeExistingQuickTemplateV2,
  resetNewQuickTemplateV2,
  validateNewQuickTemplateV2,
  type NewQuickTemplateV2State,
} from "./modules/quickTemplateV2Helpers";
import {
  INITIAL_NEW_CUSTOM_EXTRA_TASK_V2,
  buildCustomExtraTaskV2,
  resetNewCustomExtraTaskV2,
  validateNewCustomExtraTaskV2,
  type NewCustomExtraTaskV2State,
} from "./modules/customExtraTaskV2Helpers";
import CustomExtraTaskV2Fields from "./components/CustomExtraTaskV2Fields";
import { applyScheduledJobV2FieldsToJob } from "./modules/scheduledJobToWorkV2Adapter";
import {
  getJobDisplayAiMinutes,
  getJobDisplayPlannedMinutes,
} from "./modules/workTimeV2Helpers";
import WorkV2InfoBox from "./components/WorkV2InfoBox";
import { getWorkV2LogSuffix } from "./modules/workV2LogHelpers";
import { applyScheduledJobV2PayloadFields } from "./modules/scheduledJobV2PayloadHelpers";
import { applyJobV2PayloadFields } from "./modules/jobV2PayloadHelpers";
import {
  normalizeJobsV2Fields,
  normalizeScheduledJobsV2Fields,
} from "./modules/v2DataNormalizeHelpers";
import { checkAllV2Integrity } from "./modules/v2IntegrityCheckHelpers";
import QuickTemplateV2Fields from "./components/QuickTemplateV2Fields";
import {
  applyScheduledStatusesToTechs,
  getScheduledStatusForTech,
  loadScheduledTechStatuses,
  saveScheduledTechStatuses,
  type ScheduledTechStatus,
} from "./modules/techStatusScheduleHelpers";
import {
  loadScheduledTechStatusesFromBackend,
  saveScheduledTechStatusesToBackend,
} from "./modules/scheduledTechStatusApi";
import RoadsideAssistanceView from "./components/RoadsideAssistanceView";
import RoadsideAssistanceAdminView from "./components/RoadsideAssistanceAdminView";
import {
  createRoadsideAssistanceInBackend,
  createRoadsideVehicleInBackend,
  deactivateRoadsideVehicleInBackend,
  deleteRoadsideOperatorCodeInBackend,
  loadRoadsideAssistancesFromBackend,
  loadRoadsideOperatorCodesFromBackend,
  loadRoadsideVehiclesFromBackend,
  sendRoadsideTrackingWhatsappInBackend,
  updateRoadsideAssistanceInBackend,
  updateRoadsideAssistanceStatusInBackend,
  updateRoadsideOperatorCodeInBackend,
  updateRoadsideVehicleInBackend,
} from "./modules/roadsideAssistanceApi";
import type {
  RoadsideAssistance,
  RoadsideAssistanceDraft,
  RoadsideAssistanceEditDraft,
  RoadsideAssistanceStatus,
  RoadsideOperatorCode,
  RoadsideVehicle,
  RoadsideVehicleDraft,
} from "./modules/roadsideAssistanceTypes";
function removeSupportFromPreviousJob(tech: Tech, jobs: Job[]): Job[] {
  if (tech.currentJobId == null) return jobs;

  return jobs.map((job) => {
    if (job.id !== tech.currentJobId) return job;
    if (!job.assignedNames.includes(tech.name)) return job;

    const index = job.assignedNames.indexOf(tech.name);

    // Nunca tocar si era responsable
    if (index === 0) return job;

    const nextAssignedNames = job.assignedNames.filter((n) => n !== tech.name);

    let nextReason = job.reason;

    if (job.area === "camion") {
      nextReason =
        nextAssignedNames.length >= 2
          ? "Camión asignado con 1 responsable y 1 apoyo disponible."
          : "Camión asignado con 1 responsable.";
    } else {
      nextReason = `${getOperationLabel(job)} sin refuerzo por reasignación automática.`;
    }

    return {
      ...job,
      assignedNames: nextAssignedNames,
      reason: nextReason,
    };
  });
}

function applyAssignmentToTechs(
  assignedNames: string[],
  job: Job,
  techs: Tech[]
): Tech[] {
  return techs.map((tech) => {
    const idx = assignedNames.indexOf(tech.name);
    if (idx === -1) return tech;
    const isMain = idx === 0;
    return {
      ...tech,
      status: (isMain ? "ocupado" : "refuerzo") as TechStatus,
      currentJobId: job.id,
    };
  });
}

function belongsToWorkshop(
  item: { workshopId?: string | null },
  selectedWorkshopId: WorkshopId
) {
  return normalizeWorkshopId(item.workshopId) === selectedWorkshopId;
}

const AUTO_STANDBY_TIMES = ["13:30", "18:30"] as const;
const AUTO_STANDBY_GRACE_MINUTES = 20;

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getAutoStandbyTrigger(date: Date) {
  for (const time of AUTO_STANDBY_TIMES) {
    const [hours, minutes] = time.split(":").map(Number);
    const triggerAt = new Date(date);
    triggerAt.setHours(hours, minutes, 0, 0);

    const elapsedMs = date.getTime() - triggerAt.getTime();

    if (
      elapsedMs >= 0 &&
      elapsedMs < AUTO_STANDBY_GRACE_MINUTES * 60 * 1000
    ) {
      return time;
    }
  }

  return null;
}

function getAutoStandbyStorageKey(workshopId: WorkshopId, time: string, date: Date) {
  return `sea-auto-standby:${workshopId}:${formatLocalDateKey(date)}:${time}`;
}

export default function SeaTarragonaV1() {
  const [initialAutoAssignDone, setInitialAutoAssignDone] = useState(false);
  const [rules, setRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState("");
  const [techs, setTechs] = useState<Tech[]>(INITIAL_TECHS);
const [scheduledTechStatuses, setScheduledTechStatuses] = useState<
  ScheduledTechStatus[]
>(() => loadScheduledTechStatuses());
const [scheduledTechStatusesLoaded, setScheduledTechStatusesLoaded] =
  useState(false);

useEffect(() => {
  let cancelled = false;

  async function loadScheduledTechStatuses() {
    try {
      const data = await loadScheduledTechStatusesFromBackend();

      if (cancelled) return;

      if (Array.isArray(data)) {
        setScheduledTechStatuses(data);
      }
    } catch (error) {
      console.error("Error cargando estados técnicos desde backend:", error);
    } finally {
      if (!cancelled) {
        setScheduledTechStatusesLoaded(true);
      }
    }
  }

  void loadScheduledTechStatuses();

  return () => {
    cancelled = true;
  };
}, []);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [roadsideAssistances, setRoadsideAssistances] = useState<
    RoadsideAssistance[]
  >([]);
  const [roadsideVehicles, setRoadsideVehicles] = useState<RoadsideVehicle[]>(
    []
  );
  const [roadsideOperatorCodes, setRoadsideOperatorCodes] = useState<
    RoadsideOperatorCode[]
  >([]);
  const [roadsideAssistancesLoading, setRoadsideAssistancesLoading] =
    useState(false);
  const [roadsideAssistanceError, setRoadsideAssistanceError] = useState("");
  const [roadsideVehicleError, setRoadsideVehicleError] = useState("");
  const [roadsideOperatorCodeError, setRoadsideOperatorCodeError] =
    useState("");
  const scheduledJobsLoadedRef = useRef(false);
  const scheduledJobsDirtyRef = useRef(false);
  const scheduledJobsSaveVersionRef = useRef(0);
  const autoStandbyRunningRef = useRef(false);
  const [scheduledJobsLoaded, setScheduledJobsLoaded] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
  return localStorage.getItem("sea-authenticated") === "true";
});

const [loginPassword, setLoginPassword] = useState("");
const [loginError, setLoginError] = useState("");
const [loginLoading, setLoginLoading] = useState(false);
const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
const [userRole, setUserRole] = useState<UserRole | null>(() => {
  const stored = localStorage.getItem("sea-role");

  if (isValidUserRole(stored)) {
    return stored;
  }

  return null;
});

const isAdmin = canUseAdminTools(userRole);
const isSupervisor = canUseSupervisorTools(userRole);
const userCanUseScreens = canUseScreens(userRole);
const [selectedWorkshopId, setSelectedWorkshopId] = useState<WorkshopId>(() => {
  try {
    const saved = localStorage.getItem("sea-selected-workshop");
    return normalizeWorkshopId(saved || DEFAULT_WORKSHOP_ID);
  } catch {
    return DEFAULT_WORKSHOP_ID;
  }
});

const selectedWorkshop = getWorkshopById(selectedWorkshopId);

const effectiveTechs = useMemo(
  () =>
    applyScheduledStatusesToTechs({
      techs,
      scheduledStatuses: scheduledTechStatuses,
    }),
  [techs, scheduledTechStatuses]
);

useEffect(() => {
  try {
    localStorage.setItem("sea-selected-workshop", selectedWorkshopId);
  } catch {
    // No rompemos la app si localStorage falla.
  }
}, [selectedWorkshopId]);

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [nextJobId, setNextJobId] = useState(() => {
    try {
      if (typeof window === "undefined") return 1;
      const saved = window.localStorage.getItem("nextJobId");
      return saved ? Number(saved) || 1 : 1;
    } catch {
      return 1;
    }
  });

  const [formOpen, setFormOpen] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [draft, setDraft] = useState<{
    area: AreaKey;
    plate: string;
    urgent: boolean;
    template: string;
  }>({
    area: "camion",
    plate: "",
    urgent: false,
    template: "",
  });

const [quickTemplates, setQuickTemplates] = useState<QuickTemplate[]>([]);

const [linkedTemplates, setLinkedTemplates] = useState<LinkedTemplate[]>(() => {
  try {
    if (typeof window === "undefined") return [];

    const saved = window.localStorage.getItem("linkedTemplates");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
});

const [linkedTemplateDraft, setLinkedTemplateDraft] = useState<{
  label: string;
  firstTemplateKey: string;
  secondTemplateKey: string;
}>({
  label: "",
  firstTemplateKey: "",
  secondTemplateKey: "",
});

useEffect(() => {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "linkedTemplates",
        JSON.stringify(linkedTemplates)
      );
    }
  } catch {}
}, [linkedTemplates]);

useEffect(() => {
  if (quickTemplates.length === 0) return;

  setLinkedTemplateDraft((prev) => {
    const firstExists = quickTemplates.some(
      (template) => template.key === prev.firstTemplateKey
    );

    const secondExists = quickTemplates.some(
      (template) => template.key === prev.secondTemplateKey
    );

    return {
      ...prev,
      firstTemplateKey: firstExists
        ? prev.firstTemplateKey
        : quickTemplates[0]?.key ?? "",
      secondTemplateKey: secondExists
        ? prev.secondTemplateKey
        : quickTemplates[1]?.key ?? quickTemplates[0]?.key ?? "",
    };
  });
}, [quickTemplates]);

const [quickDraft, setQuickDraft] =
  useState<QuickDraftState>(INITIAL_QUICK_DRAFT);
const [quickSelectedArea, setQuickSelectedArea] = useState<AreaKey>("camion");
const [quickSelectedMode, setQuickSelectedMode] =
  useState<"quick" | "maintenance">("quick");
const [maintenanceTasks, setMaintenanceTasks] = useState<MaintenanceTask[]>([]);
// Maintenance task CRUD state
const [maintTaskForm, setMaintTaskForm] = useState<{ label: string; type: "en_taller" | "fuera_taller" }>({ label: "", type: "en_taller" });
const [maintTaskEditing, setMaintTaskEditing] = useState<string | null>(null);
const [maintTaskSaving, setMaintTaskSaving] = useState(false);
const [maintenanceDraft, setMaintenanceDraft] = useState<{
  techName: string;
  taskId: string;
}>({
  techName: "",
  taskId: "",
});
const [customExtraTasks, setCustomExtraTasks] = useState<CustomExtraTask[]>(() => {
  try {
    if (typeof window === "undefined") return [];

    const saved = window.localStorage.getItem("customExtraTasks");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
});

const [newCustomExtraTask, setNewCustomExtraTask] =
  useState<NewCustomExtraTaskV2State>(INITIAL_NEW_CUSTOM_EXTRA_TASK_V2);
useEffect(() => {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "customExtraTasks",
        JSON.stringify(customExtraTasks)
      );
    }
  } catch {}
}, [customExtraTasks]);
const [newQuickTemplate, setNewQuickTemplate] =
  useState<NewQuickTemplateV2State>(INITIAL_NEW_QUICK_TEMPLATE_V2);

const [editingQuickTemplateKey, setEditingQuickTemplateKey] = useState<string | null>(null);
const stickyHeaderRef = useRef<HTMLDivElement>(null);


const [workshopPinModal, setWorkshopPinModal] = useState<{ techName: string } | null>(null);
const [workshopPinInput, setWorkshopPinInput] = useState("");
const [workshopPinSaving, setWorkshopPinSaving] = useState(false);
const [workshopPinError, setWorkshopPinError] = useState("");

const [log, setLog] = useState<LogItem[]>([]);
const [externalAIAnswer, setExternalAIAnswer] = useState("");
const [externalAILoading, setExternalAILoading] = useState(false);
const [newTechName, setNewTechName] = useState("");
const [tick, setTick] = useState(0);
const [view, setView] = useState<AppView>(() => {
  const storedRole = localStorage.getItem("sea-role");

  if (isValidUserRole(storedRole)) {
    return getDefaultViewForRole(storedRole);
  }

  return "operativo";
});

const autoSyncPaused =
  formOpen ||
  quickEntryOpen ||
  resetConfirmOpen ||
  editingQuickTemplateKey !== null;

const {
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
} = useMaintenanceAvailability({
  techs,
  isAuthenticated,
  autoSyncPaused,
  lastSyncAt,
  getAdminHeaders,
});

const visibleJobs = useMemo(
  () => jobs.filter((job) => belongsToWorkshop(job, selectedWorkshopId)),
  [jobs, selectedWorkshopId]
);

const visibleScheduledJobs = useMemo(
  () =>
    scheduledJobs.filter((job) =>
      belongsToWorkshop(job, selectedWorkshopId)
    ),
  [scheduledJobs, selectedWorkshopId]
);

const visibleRoadsideAssistances = useMemo(
  () =>
    roadsideAssistances.filter((assistance) =>
      belongsToWorkshop(assistance, selectedWorkshopId)
    ),
  [roadsideAssistances, selectedWorkshopId]
);

const visibleRoadsideVehicles = useMemo(
  () =>
    roadsideVehicles.filter((vehicle) =>
      belongsToWorkshop(vehicle, selectedWorkshopId)
    ),
  [roadsideVehicles, selectedWorkshopId]
);

const visibleTechs = useMemo(() => {
  const visibleJobIds = new Set(visibleJobs.map((job) => job.id));

  return effectiveTechs.filter((tech) => {
    if (belongsToWorkshop(tech, selectedWorkshopId)) return true;

    return (
      tech.currentJobId != null &&
      visibleJobIds.has(tech.currentJobId)
    );
  });
}, [effectiveTechs, visibleJobs, selectedWorkshopId]);

const roadsideEligibleTechNames = useMemo(
  () =>
    new Set(
      roadsideOperatorCodes
        .filter((item) => item.hasCustomCode)
        .map((item) => item.techName)
    ),
  [roadsideOperatorCodes]
);

const visibleRoadsideTechs = useMemo(
  () => visibleTechs.filter((tech) => roadsideEligibleTechNames.has(tech.name)),
  [visibleTechs, roadsideEligibleTechNames]
);

const visibleQuickTemplates = useMemo(
  () =>
    quickTemplates.filter((template) =>
      belongsToWorkshop(template, selectedWorkshopId)
    ),
  [quickTemplates, selectedWorkshopId]
);

const visibleLinkedTemplates = useMemo(
  () =>
    linkedTemplates.filter((template) =>
      belongsToWorkshop(template, selectedWorkshopId)
    ),
  [linkedTemplates, selectedWorkshopId]
);

const maintenanceTechCandidates = useMemo(() => {
  return visibleTechs
    .filter((tech) => {
      const status = tech.status === "supervisor" ? "disponible" : tech.status;

      return (
        tech.currentJobId == null &&
        !tech.blocked &&
        !isUnavailableTechStatus(status)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}, [visibleTechs]);

useEffect(() => {
  let cancelled = false;

  async function loadMaintenanceTasks() {
    try {
      const data = await loadMaintenanceTasksFromBackend();

      if (!cancelled) {
        setMaintenanceTasks(data);
      }
    } catch (error) {
      console.error("Error cargando tareas de mantenimiento:", error);
    }
  }

  if (isAuthenticated) {
    void loadMaintenanceTasks();
  }

  return () => {
    cancelled = true;
  };
}, [isAuthenticated]);



useEffect(() => {
  if (!isAuthenticated || !isSupervisor) return;

  void reloadRoadsideAssistancesFromBackend();
  void reloadRoadsideVehiclesFromBackend();
  void reloadRoadsideOperatorCodesFromBackend();
}, [isAuthenticated, isSupervisor]);

useEffect(() => {
  setMaintenanceDraft((prev) => {
    const techExists = maintenanceTechCandidates.some(
      (tech) => tech.name === prev.techName
    );

    const taskExists = maintenanceTasks.some((task) => task.id === prev.taskId);

    return {
      techName: techExists
        ? prev.techName
        : maintenanceTechCandidates[0]?.name ?? "",
      taskId: taskExists ? prev.taskId : maintenanceTasks[0]?.id ?? "",
    };
  });
}, [maintenanceTechCandidates, maintenanceTasks]);



useEffect(() => {
  if (!userRole) return;

  if (!canAccessView(userRole, view)) {
    setView(getDefaultViewForRole(userRole));
  }
}, [userRole, view]);
  useEffect(() => {
    async function loadRules() {
      try {
        const response = await fetchWithTimeout(`${API_BASE}/api/rules`);
        const data = await response.json();
        setRules(
          Array.isArray(data)
            ? data.map((item: { id: number; text: string }) => item.text)
            : DEFAULT_RULES
        );
      } catch (error) {
        console.error("Error cargando reglas:", error);
        setRules(DEFAULT_RULES);
      }
    }

    loadRules();
  }, []);

  useEffect(() => {
  if (!quickDraft.templateKey && quickTemplates.length > 0) {
    setQuickDraft((prev) => ({
      ...prev,
      templateKey: quickTemplates[0].key,
    }));
  }
}, [quickDraft.templateKey, quickTemplates]);

useEffect(() => {
  async function loadJobs() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/jobs`);
      const data = await response.json();
      const normalized = Array.isArray(data) ? data.map(normalizeJobFromApi) : [];
      setJobs(normalized);

      const maxId = normalized.reduce(
        (max: number, job: Job) => (job.id > max ? job.id : max),
        0
      );
      setNextJobId(maxId + 1);
      setJobsLoaded(true);
    } catch (error) {
      console.error("Error cargando trabajos:", error);
      setJobsLoaded(false);
    }
  }

  loadJobs();
}, []);

useEffect(() => {
  if (!techs.length) return;
  setTechs((prev) => syncTechsWithActiveJobs(prev, jobs));
}, [jobs]);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("rules", JSON.stringify(rules));
      }
    } catch {}
  }, [rules]);

useEffect(() => {
  async function loadQuickTemplates() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/quick-templates`);
      const data = await response.json();

      setQuickTemplates(
        Array.isArray(data)
          ? data.map((item: any) => ({
              ...item,
              allowedTechs: Array.isArray(item.allowedTechs) ? item.allowedTechs : [],
              priorityOrder: Array.isArray(item.priorityOrder) ? item.priorityOrder : [],
            }))
          : DEFAULT_QUICK_TEMPLATES
      );
    } catch (error) {
      console.error("Error cargando entradas rápidas:", error);
      setQuickTemplates(DEFAULT_QUICK_TEMPLATES);
    }
  }

  loadQuickTemplates();
}, []);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "quickTemplates",
          JSON.stringify(quickTemplates)
        );
      }
    } catch {}
  }, [quickTemplates]);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const configs: SavedTechConfig[] = techs.map((t) => ({
        name: t.name,
        competencies: t.competencies,
        priorities: t.priorities,
      }));
      window.localStorage.setItem("techConfigs", JSON.stringify(configs));
    } catch {}
  }, [techs]);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("jobs", JSON.stringify(jobs));
      }
    } catch {}
  }, [jobs]);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("nextJobId", String(nextJobId));
      }
    } catch {}
  }, [nextJobId]);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("log", JSON.stringify(log));
      }
    } catch {}
  }, [log]);

useEffect(() => {
async function loadTechs() {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/techs`);
    const data = await response.json();

    if (!Array.isArray(data)) return;

    setTechs(() => {
      const merged = INITIAL_TECHS.map((baseTech) => {
        const found = data.find((t: any) => t.name === baseTech.name);

        const hasCompetencies =
          found?.competencies &&
          Object.keys(found.competencies).length > 0;

        const hasPriorities =
          found?.priorities &&
          Object.keys(found.priorities).length > 0;

        if (!found) return baseTech;

        const loadedStatus =
  found.status === "supervisor"
    ? ("disponible" as TechStatus)
    : ((found.status ?? baseTech.status) as TechStatus);

const isManualUnavailable = isManualUnavailableStatus(loadedStatus);

return {
  ...baseTech,
  status: loadedStatus,
  blocked: isManualUnavailable,
  currentJobId: isManualUnavailable ? null : found.currentJobId ?? null,
          competencies: hasCompetencies
            ? found.competencies
            : baseTech.competencies,
          priorities: hasPriorities
            ? found.priorities
            : baseTech.priorities,
          avatar: found.avatar ?? baseTech.avatar ?? null,
          statusChangedAtMs:
            found.statusChangedAtMs ?? baseTech.statusChangedAtMs,
          statusTotals: found.statusTotals ?? baseTech.statusTotals ?? {},
        };
      });

      const synced = syncTechsWithActiveJobs(merged, jobs);

      return applyManualTechStatusOverrides(synced);
    });
  } catch (error) {
    console.error("Error cargando técnicos:", error);
  }
}
  loadTechs();
}, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
  async function loadLogs() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/logs`);
      const data = await response.json();
      setLog(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error cargando logs:", error);
    }
  }

  loadLogs();
}, []);

useEffect(() => {
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
  loadScheduledJobs();
}, []);

useEffect(() => {
  const issues = checkAllV2Integrity({
    jobs,
    scheduledJobs,
  });

  if (issues.length === 0) {
    console.log("CHECK V2 OK: no hay incidencias v2.");
    return;
  }

  console.warn("CHECK V2: incidencias encontradas", issues);
}, [jobs, scheduledJobs]);

useEffect(() => {
  if (initialAutoAssignDone) return;
  if (!jobs.length || !techs.length) return;

  const hasWaiting = jobs.some((job) => job.status === "espera");
  if (!hasWaiting) {
    setInitialAutoAssignDone(true);
    return;
  }

const hasAvailableTech = techs.some(
  (tech) =>
    !tech.blocked &&
    tech.currentJobId == null &&
    !isTechBlockedByOutsideMaintenance(tech.name) &&
    (tech.status === "disponible" || tech.status === "supervisor")
);

  if (!hasAvailableTech) {
    setInitialAutoAssignDone(true);
    return;
  }

  // Cola manual: no asignamos automáticamente al cargar.
setInitialAutoAssignDone(true);
}, [jobs, techs, initialAutoAssignDone]);

const activeJobs = useMemo(
  () =>
    visibleJobs.filter(
      (job) =>
        job.status === "activo" ||
        job.status === "validacion" ||
        job.status === "espera" ||
        job.status === "parado"
    ),
  [visibleJobs]
);

const validationJobs = useMemo(
  () =>
    [...activeJobs]
      .filter((job) => job.status === "validacion")
      .sort((a, b) =>
        a.urgent !== b.urgent
          ? a.urgent
            ? -1
            : 1
          : a.createdAtMs - b.createdAtMs
      ),
  [activeJobs]
);

  const closedJobs = useMemo(
    () => visibleJobs.filter((job) => job.status === "cerrado"),
    [visibleJobs]
  );

  const waitingJobs = useMemo(
    () =>
      [...activeJobs]
        .filter((job) => job.status === "espera")
        .sort((a, b) =>
          a.urgent !== b.urgent
            ? a.urgent
              ? -1
              : 1
            : areaPriority(a.area) - areaPriority(b.area)
        ),
    [activeJobs]
  );
  

  const runningJobs = useMemo(
    () =>
      [...activeJobs]
        .filter((job) => job.status === "activo")
        .sort((a, b) =>
          a.urgent !== b.urgent
            ? a.urgent
              ? -1
              : 1
            : areaPriority(a.area) - areaPriority(b.area)
        ),
    [activeJobs]
  );

useEffect(() => {
  if (!isAuthenticated || !jobsLoaded) return;

  const checkedAt = new Date();
  const triggerTime = getAutoStandbyTrigger(checkedAt);

  if (!triggerTime) return;

  const storageKey = getAutoStandbyStorageKey(
    selectedWorkshopId,
    triggerTime,
    checkedAt
  );

  try {
    if (window.localStorage.getItem(storageKey)) return;
  } catch {}

  if (autoStandbyRunningRef.current) return;

  autoStandbyRunningRef.current = true;

  try {
    window.localStorage.setItem(storageKey, String(checkedAt.getTime()));
  } catch {}

  void pauseActiveJobsForStandby(triggerTime).finally(() => {
    autoStandbyRunningRef.current = false;
  });
}, [
  isAuthenticated,
  jobsLoaded,
  runningJobs.length,
  selectedWorkshopId,
  tick,
]);

  const workingTechsSummary = useMemo(() => {
  return visibleTechs
    .filter((tech) => {
      if (tech.currentJobId == null) return false;

      const job = visibleJobs.find((item) => item.id === tech.currentJobId);

      return Boolean(job && job.status === "activo");
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}, [visibleTechs, visibleJobs]);

const availableTechsSummary = useMemo(() => {
  return visibleTechs
    .filter((tech) => {
      const status = tech.status === "supervisor" ? "disponible" : tech.status;

      return (
        status === "disponible" &&
        tech.currentJobId == null &&
        !isUnavailableTechStatus(status) &&
        !isTechBlockedByOutsideMaintenance(tech.name)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}, [visibleTechs, isTechBlockedByOutsideMaintenance]);



const pausedJobs = useMemo(() => {
  const map = new Map<string, Job>();

  [...activeJobs]
    .filter((job) => job.status === "parado" && !isLinkedBlockedJob(job))
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .forEach((job) => {
      const key = `${job.plate}-${getOperationLabel(job)}-${job.status}`;

      if (!map.has(key)) {
        map.set(key, job);
      }
    });

  return Array.from(map.values());
}, [activeJobs]);

const blockedJobs = useMemo(
  () =>
    [...activeJobs]
      .filter((job) => isLinkedBlockedJob(job))
      .sort((a, b) => a.createdAtMs - b.createdAtMs),
  [activeJobs]
);
  const operationReport = useMemo<OperationSummary[]>(
  () => buildOperationReport(closedJobs),
  [closedJobs]
);

 const techStats = useMemo(
  () => buildTechStats(closedJobs),
  [closedJobs]
);

const techLoadStats = useMemo<TechLoadStat[]>(
  () => buildTechLoadStats(visibleJobs, visibleTechs),
  [visibleJobs, visibleTechs]
);

useEffect(() => {
  console.log("SELF TESTS:", runSelfTests(techStats, techLoadStats));
}, [techStats, techLoadStats]);
useAutoSync({
  enabled: isAuthenticated,
  paused: autoSyncPaused,
  intervalMs: 5000,
  onSync: async () => {
    await reloadJobsFromBackend();
    await reloadQuickTemplatesFromBackend();

    // IMPORTANTE:
    // No recargamos agenda en autosync para no pisar citas recién creadas.
    // La agenda se guarda al crear/editar/cancelar.
    // await reloadScheduledJobsFromBackend();

    await reloadLogsFromBackend();
    await reloadTechsFromBackend();
    await reloadMaintenanceAvailabilityFromBackend();
  },
  onSynced: () => {
    setLastSyncAt(Date.now());
  },
});

useEffect(() => {
  if (!isAuthenticated) return;
  if (!userRole) return;

  if (!canAccessView(userRole, view)) {
    setView(getDefaultViewForRole(userRole));
  }
}, [isAuthenticated, userRole, view]);
useEffect(() => {
  if (!isAuthenticated) return;

  reloadScheduledJobsFromBackend();
}, [isAuthenticated]);

useEffect(() => {
  if (!scheduledJobsLoaded) return;

  fetchWithTimeout(`${API_BASE}/api/scheduled-jobs`, {
    method: "PUT",
    headers: getAdminHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(
  scheduledJobs.map((job) =>
    applyScheduledJobV2PayloadFields(job, job)
  )
),
  }).catch((error) => {
    console.error("Error guardando agenda:", error);
  });
}, [scheduledJobs, scheduledJobsLoaded]);

useEffect(() => {
  saveScheduledTechStatuses(scheduledTechStatuses);

  if (!scheduledTechStatusesLoaded) return;

  void saveScheduledTechStatusesToBackend(scheduledTechStatuses).catch(
    (error) => {
      console.error("Error guardando estados técnicos en backend:", error);
      appendLog("Error guardando estados programados de técnicos.");
    }
  );
}, [scheduledTechStatuses, scheduledTechStatusesLoaded]);


const techHoursReport = useMemo<TechHoursSummary[]>(
  () => buildTechHoursReport(closedJobs, visibleTechs),
  [closedJobs, visibleTechs]
);

const workshopAlerts = useMemo<WorkshopAlert[]>(
  () =>
    buildWorkshopAlerts({
      waitingJobs,
      runningJobs,
      techLoadStats,
      operationReport,
    }),
  [waitingJobs, runningJobs, techLoadStats, operationReport]
);

const techOperationStats = useMemo<TechOperationStat[]>(
  () => buildTechOperationStats(closedJobs),
  [closedJobs]
);
const techClosureStats = useMemo<TechClosureStat[]>(
  () => buildTechClosureStats(closedJobs, visibleTechs),
  [closedJobs, visibleTechs]
);

const aiRanking = useMemo(
  () => buildAiRanking(techOperationStats),
  [techOperationStats]
);

const aiSuggestions = useMemo<AISuggestion[]>(
  () =>
    buildAiSuggestions({
      aiRanking,
      techOperationStats,
      techClosureStats,
    }),
  [aiRanking, techOperationStats, techClosureStats]
);

const recommendedTechByJobId = useMemo(
  () =>
    buildRecommendedTechByJobId({
      runningJobs,
      techs,
      quickTemplates,
      techOperationStats,
    }),
  [runningJobs, techs, quickTemplates, techOperationStats]
);

const jobsForScreens = useMemo(
  () =>
    visibleJobs.map((job) => {
      const displayMinutes = getDisplayMinutesForJob(job);

      if (displayMinutes == null || displayMinutes <= 0) {
        return job;
      }

      return {
        ...job,
        standardMinutes: displayMinutes,
        estimatedMinutes: displayMinutes,
        predictedMinutes: displayMinutes,
        aiMinutes: displayMinutes,
        screenEstimatedMinutes: displayMinutes,
        screenAiMinutes: displayMinutes,
        screenPrevistoMinutes: displayMinutes,
      };
    }),
  [visibleJobs, scheduledJobs, quickTemplates]
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


async function askExternalAIWorkshop() {
  try {
    setExternalAILoading(true);
    setExternalAIAnswer("");

    const aiJobs = activeJobs.filter(
      (job) => job.status === "espera" || job.status === "activo"
    );

    const response = await fetch(`${API_BASE}/api/ai/taller`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobs: aiJobs,
        techs: visibleTechs,
        operationReport,
        techOperationStats,
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || data?.message || "Error IA");
    }

    const cleanText = (data.text || "")
  .replace(/```json/g, "")
  .replace(/```/g, "")
  .trim();

setExternalAIAnswer(cleanText || "La IA no devolvió respuesta.");
    appendLog("Consulta enviada a ChatGPT.");
  } catch (error) {
    console.error("Error consultando IA externa:", error);
    setExternalAIAnswer(
      error instanceof Error
        ? `Error consultando ChatGPT: ${error.message}`
        : "Error consultando ChatGPT."
    );
    appendLog("Error consultando ChatGPT.");
  } finally {
    setExternalAILoading(false);
  }
}
async function handleLogin() {
  setLoginError("");
  setLoginLoading(true);

  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password: loginPassword,
      }),
    });

    if (!response.ok) {
      setLoginError("Contraseña incorrecta");
      return;
    }

const data = await response.json();

localStorage.setItem("sea-authenticated", "true");
localStorage.setItem("sea-admin-token", loginPassword);
localStorage.setItem("sea-role", data.role);

const role = isValidUserRole(data.role) ? data.role : null;

setUserRole(role);
setIsAuthenticated(true);
setLoginPassword("");

setView(getDefaultViewForRole(role));
  } catch (error) {
    console.error("Error iniciando sesión:", error);
    setLoginError("No se pudo iniciar sesión");
  } finally {
    setLoginLoading(false);
  }
}
function getAdminHeaders(extra?: HeadersInit): HeadersInit {
  const token = localStorage.getItem("sea-admin-token") ?? "";

  return {
    ...(extra ?? {}),
    "x-admin-token": token,
  };
}
function appendLog(text: string) {
  const entry: LogItem = {
    id: Date.now() + Math.random(),
    time: nowTime(),
    text,
  };

  setLog((prev) => [entry, ...prev].slice(0, 50));

  fetchWithTimeout(`${API_BASE}/api/logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(entry),
  }).catch((error) => {
    console.error("Error guardando log:", error);
  });
}
 
async function reloadTechsFromBackend(currentJobs = jobs) {
  try {
   const data = await loadTechsFromBackend();

if (!Array.isArray(data)) return;

    setTechs(() => {
      const merged = INITIAL_TECHS.map((baseTech) => {
        const found = data.find((tech: any) => tech.name === baseTech.name);

        const hasCompetencies =
          found?.competencies &&
          Object.keys(found.competencies).length > 0;

        const hasPriorities =
          found?.priorities &&
          Object.keys(found.priorities).length > 0;

        return found
  ? {
      ...baseTech,
      status:
  found.status === "supervisor"
    ? ("disponible" as TechStatus)
    : ((found.status ?? baseTech.status) as TechStatus),

blocked: isUnavailableTechStatus(
  found.status === "supervisor"
    ? ("disponible" as TechStatus)
    : ((found.status ?? baseTech.status) as TechStatus)
),
      currentJobId: found.currentJobId ?? null,
      competencies: hasCompetencies
        ? found.competencies
        : baseTech.competencies,
      priorities: hasPriorities
        ? found.priorities
        : baseTech.priorities,
      avatar: found.avatar ?? baseTech.avatar ?? null,
      statusChangedAtMs:
        found.statusChangedAtMs ?? baseTech.statusChangedAtMs ?? nowMs(),
      statusTotals: found.statusTotals ?? baseTech.statusTotals ?? {},
    }
  : baseTech;
      });

      return syncTechsWithActiveJobs(merged, currentJobs);
    });
  } catch (error) {
    console.error("Error recargando técnicos:", error);
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

async function reloadRoadsideAssistancesFromBackend() {
  setRoadsideAssistancesLoading(true);
  setRoadsideAssistanceError("");

  try {
    const data = await loadRoadsideAssistancesFromBackend(true);
    setRoadsideAssistances(data);
  } catch (error) {
    console.error("Error recargando asistencias carretera:", error);
    setRoadsideAssistanceError(
      error instanceof Error
        ? error.message
        : "Error cargando asistencias carretera."
    );
  } finally {
    setRoadsideAssistancesLoading(false);
  }
}

async function reloadRoadsideVehiclesFromBackend() {
  setRoadsideVehicleError("");

  try {
    const data = await loadRoadsideVehiclesFromBackend(true);
    setRoadsideVehicles(data);
  } catch (error) {
    console.error("Error recargando furgonetas carretera:", error);
    setRoadsideVehicleError(
      error instanceof Error ? error.message : "Error cargando furgonetas."
    );
  }
}

async function reloadRoadsideOperatorCodesFromBackend() {
  setRoadsideOperatorCodeError("");

  try {
    const data = await loadRoadsideOperatorCodesFromBackend();
    setRoadsideOperatorCodes(data);
  } catch (error) {
    console.error("Error recargando codigos de operario:", error);
    setRoadsideOperatorCodeError(
      error instanceof Error
        ? error.message
        : "Error cargando codigos de operario."
    );
  }
}

async function createRoadsideVehicle(draft: RoadsideVehicleDraft) {
  const created = await createRoadsideVehicleInBackend({
    ...draft,
    workshopId: selectedWorkshopId,
  });

  setRoadsideVehicles((prev) => [
    created,
    ...prev.filter((item) => item.id !== created.id),
  ]);

  appendLog(`Furgoneta creada: ${created.name}.`);
}

async function updateRoadsideVehicle(
  vehicle: RoadsideVehicle,
  draft: RoadsideVehicleDraft
) {
  const updated = await updateRoadsideVehicleInBackend(vehicle.id, {
    ...draft,
    workshopId: vehicle.workshopId ?? selectedWorkshopId,
  });

  setRoadsideVehicles((prev) =>
    prev.map((item) => (item.id === updated.id ? updated : item))
  );

  appendLog(`Furgoneta actualizada: ${updated.name}.`);
}

async function deactivateRoadsideVehicle(vehicle: RoadsideVehicle) {
  const updated = await deactivateRoadsideVehicleInBackend(vehicle.id);

  setRoadsideVehicles((prev) =>
    prev.map((item) => (item.id === updated.id ? updated : item))
  );

  appendLog(`Furgoneta desactivada: ${updated.name}.`);
}

async function updateRoadsideOperatorCode(techName: string, code: string) {
  const updated = await updateRoadsideOperatorCodeInBackend(techName, code);

  setRoadsideOperatorCodes((prev) => {
    const exists = prev.some((item) => item.techName === updated.techName);

    if (!exists) {
      return [...prev, updated];
    }

    return prev.map((item) =>
      item.techName === updated.techName ? updated : item
    );
  });

  appendLog(`Codigo operario actualizado: ${updated.techName}.`);
}

async function deleteRoadsideOperatorCode(techName: string) {
  const deleted = await deleteRoadsideOperatorCodeInBackend(techName);

  setRoadsideOperatorCodes((prev) =>
    prev.filter((item) => item.techName !== deleted.techName)
  );

  appendLog(`Operario baja asistencia: ${deleted.techName}.`);
}

async function createRoadsideAssistance(draft: RoadsideAssistanceDraft) {
  const created = await createRoadsideAssistanceInBackend({
    ...draft,
    workshopId: selectedWorkshopId,
  });

  let assistanceToStore = created;

  if (draft.sendTrackingWhatsapp && created.customerPhone) {
    try {
      const result = await sendRoadsideTrackingWhatsappInBackend(created.id);
      assistanceToStore = result.assistance;
      appendLog(
        `WhatsApp seguimiento enviado a ${created.customerPhone}: ${
          created.plate || created.customerName || created.id
        }.`
      );
    } catch (error) {
      console.error("Error enviando WhatsApp seguimiento:", error);
      appendLog(
        `Asistencia creada pero WhatsApp no enviado: ${
          created.plate || created.customerName || created.id
        }.`
      );
    }
  }

  setRoadsideAssistances((prev) => [
    assistanceToStore,
    ...prev.filter((item) => item.id !== assistanceToStore.id),
  ]);

  appendLog(
    `Asistencia carretera creada: ${
      assistanceToStore.plate ||
      assistanceToStore.customerName ||
      assistanceToStore.customerPhone
    }.`
  );
}

async function updateRoadsideAssistance(
  assistance: RoadsideAssistance,
  draft: RoadsideAssistanceEditDraft
) {
  let updated = await updateRoadsideAssistanceInBackend(assistance.id, {
    ...draft,
    workshopId: assistance.workshopId ?? selectedWorkshopId,
  });

  const assignedNow =
    !assistance.assignedTechName && Boolean(updated.assignedTechName);

  if (
    (draft.sendTrackingWhatsapp || assignedNow) &&
    updated.customerPhone &&
    !updated.trackingWhatsappSentAtMs
  ) {
    try {
      const result = await sendRoadsideTrackingWhatsappInBackend(updated.id);
      updated = result.assistance;
      appendLog(
        `WhatsApp seguimiento enviado a ${updated.customerPhone}: ${
          updated.plate || updated.customerName || updated.id
        }.`
      );
    } catch (error) {
      console.error("Error enviando WhatsApp seguimiento:", error);
      appendLog(
        `Asistencia actualizada pero WhatsApp no enviado: ${
          updated.plate || updated.customerName || updated.id
        }.`
      );
    }
  }

  setRoadsideAssistances((prev) =>
    prev.map((item) => (item.id === updated.id ? updated : item))
  );

  appendLog(
    `Asistencia carretera actualizada: ${
      updated.plate || updated.customerName || updated.customerPhone
    }.`
  );
}

async function sendRoadsideTrackingWhatsapp(assistance: RoadsideAssistance) {
  const result = await sendRoadsideTrackingWhatsappInBackend(assistance.id);

  setRoadsideAssistances((prev) =>
    prev.map((item) =>
      item.id === result.assistance.id ? result.assistance : item
    )
  );

  appendLog(
    `WhatsApp seguimiento enviado a ${assistance.customerPhone}: ${
      assistance.plate || assistance.customerName || assistance.id
    }.`
  );
}

async function updateRoadsideAssistanceStatus(
  assistance: RoadsideAssistance,
  status: RoadsideAssistanceStatus
) {
  let updated = await updateRoadsideAssistanceStatusInBackend(
    assistance.id,
    status
  );

  if (
    status === "asignada" &&
    updated.customerPhone &&
    !updated.trackingWhatsappSentAtMs
  ) {
    try {
      const result = await sendRoadsideTrackingWhatsappInBackend(updated.id);
      updated = result.assistance;
      appendLog(
        `WhatsApp seguimiento enviado a ${updated.customerPhone}: ${
          updated.plate || updated.customerName || updated.id
        }.`
      );
    } catch (error) {
      console.error("Error enviando WhatsApp seguimiento:", error);
      appendLog(
        `Estado actualizado pero WhatsApp no enviado: ${
          updated.plate || updated.customerName || updated.id
        }.`
      );
    }
  }

  setRoadsideAssistances((prev) =>
    prev.map((item) => (item.id === updated.id ? updated : item))
  );

  appendLog(
    `Asistencia carretera ${updated.id}: estado ${updated.status}.`
  );
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

async function reloadJobsFromBackend() {
  try {
    const data = await loadJobsFromBackend();
    setJobs(normalizeJobsV2Fields(Array.isArray(data) ? data : []));
  } catch (error) {
    console.error("Error recargando trabajos:", error);
  }
}

async function reloadLogsFromBackend() {
  try {
    const data = await loadLogsFromBackend();
    setLog(data);
  } catch (error) {
    console.error("Error recargando logs:", error);
  }
}

function getScheduledJobByRelatedJobId(jobId: number) {
  return (
    scheduledJobs.find(
      (scheduled) =>
        scheduled.jobId === jobId || scheduled.secondJobId === jobId
    ) ?? null
  );
}

function timeToMinutes(time: string): number {
  const [hoursRaw, minutesRaw] = time.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
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

function getDisplayMinutesForJob(job: Job): number | null {
  const scheduledMinutes = getScheduledEstimatedMinutesForJob(job);

  if (scheduledMinutes != null && scheduledMinutes > 0) {
    return scheduledMinutes;
  }

  const includedTasksMinutes = (job.includedTasks ?? []).reduce(
    (total, task) => {
      const minutes = Number(task.standardMinutes);

      return Number.isFinite(minutes) && minutes > 0
        ? total + minutes
        : total;
    },
    0
  );

  if (includedTasksMinutes > 0) {
    return Math.round(includedTasksMinutes);
  }

  const normalizedJobLabel = String(job.quickEntryLabel ?? "")
    .trim()
    .toLowerCase();

  const normalizedJobTemplate = String(job.template ?? "")
    .trim()
    .toLowerCase();

  const template = quickTemplates.find((item) => {
    const itemKey = String(item.key ?? "").trim().toLowerCase();
    const itemLabel = String(item.label ?? "").trim().toLowerCase();

    if (normalizedJobTemplate && itemKey === normalizedJobTemplate) {
      return true;
    }

    if (normalizedJobLabel && itemLabel === normalizedJobLabel) {
      return true;
    }

    return false;
  });

  const templateMinutes = Number(template?.standardMinutes);

  if (Number.isFinite(templateMinutes) && templateMinutes > 0) {
    return Math.round(templateMinutes);
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
async function reloadQuickTemplatesFromBackend() {
  try {
    const data = await loadQuickTemplatesFromBackend();

    setQuickTemplates(
      Array.isArray(data)
        ? data.map((item: any) => ({
            ...item,
            allowedTechs: Array.isArray(item.allowedTechs)
              ? item.allowedTechs
              : [],
            priorityOrder: Array.isArray(item.priorityOrder)
              ? item.priorityOrder
              : [],
          }))
        : DEFAULT_QUICK_TEMPLATES
    );
  } catch (error) {
    console.error("Error recargando entradas rápidas:", error);
  }
}

async function uploadTechAvatar(file: File, techName: string) {
  const formData = new FormData();
  formData.append("avatar", file);

  try {
    const response = await fetchWithTimeout(
      `${API_BASE}/api/techs/${encodeURIComponent(techName)}/avatar`,
      {
        method: "POST",
        headers: getAdminHeaders(),
        body: formData,
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("Error subiendo avatar:", response.status, text);
      alert(`No se pudo subir la foto de ${techName}.`);
      return;
    }

    const updatedTech = await response.json();

    setTechs((prev) =>
      prev.map((t) =>
        t.name === techName
          ? {
              ...t,
              avatar: updatedTech.avatar ?? null,
            }
          : t
      )
    );

    appendLog(`Foto actualizada para ${techName}.`);

    await reloadTechsFromBackend();
  } catch (error) {
    console.error("Error subiendo avatar:", error);
    alert(`Error subiendo la foto de ${techName}.`);
  }
}

function handleTechImageUpload(
  event: React.ChangeEvent<HTMLInputElement>,
  techName: string
) {
  const file = event.target.files?.[0];
  if (!file) return;
  uploadTechAvatar(file, techName);
}

function allocateJob(
  job: Job,
  baseTechs: Tech[],
  baseJobs: Job[],
  logResult = true
): AllocationResult {
  const isProtectedTech = (tech: Tech) =>
    isHardBlockedTechStatus(tech.status) || isManualUnavailableStatus(tech.status);

  const protectedStatusesByName = new Map(
    baseTechs
      .filter((tech) => isProtectedTech(tech))
      .map((tech) => [tech.name, tech.status])
  );

  const makeWaitingJob = (reason: string): Job => ({
    ...job,
    status: "espera" as JobStatus,
    assignedNames: [],
    reason: job.reason ? `${job.reason}. ${reason}` : reason,
    startedAtMs: null,
  });

  const upsertJobInList = (jobsToUpdate: Job[], nextJob: Job) => {
    const exists = jobsToUpdate.some((item) => item.id === nextJob.id);

    if (!exists) {
      return [nextJob, ...jobsToUpdate];
    }

    return jobsToUpdate.map((item) =>
      item.id === nextJob.id ? { ...item, ...nextJob } : item
    );
  };

  const restoreProtectedTechs = (techsToRestore: Tech[]) => {
    const byName = new Map(techsToRestore.map((tech) => [tech.name, tech]));

    for (const originalTech of baseTechs) {
      if (!byName.has(originalTech.name)) {
        byName.set(originalTech.name, originalTech);
      }
    }

    return Array.from(byName.values()).map((tech) => {
      const protectedStatus = protectedStatusesByName.get(tech.name);

      if (protectedStatus) {
        return {
          ...tech,
          status: protectedStatus,
          currentJobId: null,
        };
      }

      return tech;
    });
  };

  const safeBaseTechs = baseTechs.map((tech) => {
    if (isProtectedTech(tech)) {
      return {
        ...tech,
        status: tech.status,
        currentJobId: -999999,
        blocked: true,
      };
    }

    return tech;
  });

  const hasPossibleResponsible = safeBaseTechs.some((tech) => {
    if (isProtectedTech(tech)) return false;
    if (!canTechReceiveAutomaticWork(tech)) return false;

    return canSelectTechManuallyForJob(
      tech,
      job,
      baseJobs,
      quickTemplates,
      "responsable"
    );
  });

  if (!hasPossibleResponsible) {
    const reason = "Sin técnicos disponibles. Pasa a cola de trabajo.";
    const waitingJob = makeWaitingJob(reason);

    if (logResult) {
      appendLog(
        `${AREA_META[job.area].label} ${job.plate} queda en cola: ${reason}`
      );
    }

    return {
      assigned: false,
      assignedNames: [],
      reason,
      techs: restoreProtectedTechs(safeBaseTechs),
      jobs: upsertJobInList(baseJobs, waitingJob),
      needsRamonApproval: false,
    };
  }

  const result = allocateJobPure(
    job,
    safeBaseTechs,
    baseJobs,
    quickTemplates,
    techStats,
    techLoadStats
  );

  const assignedNames = result.assignedNames ?? [];

if (hasAnyTechBlockedByOutsideMaintenance(assignedNames)) {
  const reason =
    "Asignación bloqueada: uno de los técnicos propuestos está en mantenimiento fuera de taller.";
  const waitingJob = makeWaitingJob(reason);

  return {
    assigned: false,
    assignedNames: [],
    reason,
    techs: restoreProtectedTechs(safeBaseTechs),
    jobs: upsertJobInList(baseJobs, waitingJob),
    needsRamonApproval: false,
  };
}
  const hasProtectedAssigned = assignedNames.some((name) => {
    const tech = baseTechs.find((item) => item.name === name);
    return tech ? isProtectedTech(tech) : false;
  });

  if (hasProtectedAssigned) {
    const reason =
      "Asignación bloqueada: uno de los técnicos propuestos está en vacaciones, baja, permiso, otro taller o no disponible.";
    const waitingJob = makeWaitingJob(reason);

    if (logResult) {
      appendLog(
        `${AREA_META[job.area].label} ${job.plate} queda en cola: ${reason}`
      );
    }

    return {
      assigned: false,
      assignedNames: [],
      reason,
      techs: restoreProtectedTechs(safeBaseTechs),
      jobs: upsertJobInList(baseJobs, waitingJob),
      needsRamonApproval: false,
    };
  }

   const safeResult: AllocationResult = {
    ...result,
    techs: restoreProtectedTechs(result.techs),
    jobs: result.jobs.map((item) => {
      if (item.id !== job.id) return item;

      const cleanAssignedNames = (item.assignedNames ?? []).filter((name) => {
        const tech = baseTechs.find((baseTech) => baseTech.name === name);
        return tech ? !isProtectedTech(tech) : true;
      });

      if (result.assigned && cleanAssignedNames.length === 0) {
        return makeWaitingJob(
          "Sin técnicos disponibles. Pasa a cola de trabajo."
        );
      }

      return {
        ...item,
        assignedNames: cleanAssignedNames,
      };
    }),
  };

  if (!safeResult.assigned) {
    const reason =
      safeResult.reason || "Sin técnicos disponibles. Pasa a cola de trabajo.";
    const waitingJob = makeWaitingJob(reason);

    safeResult.jobs = upsertJobInList(safeResult.jobs, waitingJob);
  }

  if (logResult) {
    appendLog(
      safeResult.assigned
        ? `${AREA_META[job.area].label} ${
            job.plate
          } asignado a ${safeResult.assignedNames.join(" + ")}.`
        : `${AREA_META[job.area].label} ${job.plate} queda en espera: ${
            safeResult.reason || "Sin técnicos disponibles."
          }`
    );
  }

  return safeResult;
}

function recalcWaitingQueue(_updatedTechs = techs, _updatedJobs = jobs) {
  // COLA MANUAL:
  // No asignamos trabajos de cola automáticamente.
  // La cola solo se mueve si el usuario elige técnico manualmente
  // o si hay una reserva para un técnico que acaba de quedar libre.
  return;
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

async function createJob() {
  if (!draft.plate.trim()) return;

  const safeJobId = getNextSafeJobId(jobs, nextJobId);

const baseJob: Job = {
  id: safeJobId,
  workshopId: selectedWorkshopId,
  area: draft.area,
  plate: draft.plate.trim().toUpperCase(),
  urgent: draft.urgent,
  status: "espera",
  assignedNames: [],
  reason: "Pendiente de asignación",
  createdAtMs: nowMs(),
  startedAtMs: null,
  template: (draft.template || null) as TemplateKey | null,
};
const result = allocateJob(baseJob, effectiveTechs, [baseJob, ...jobs], true);
const finalJob = result.jobs.find((j) => j.id === baseJob.id) ?? baseJob;

// UI rápida: ahora solo crea propuesta en validación.
// No movemos técnicos ni apoyos automáticamente.
setTechs(result.techs);
setJobs(result.jobs);
setNextJobId((v) => v + 1);
setDraft({ area: draft.area, plate: "", urgent: false, template: "" });
setFormOpen(false);

  try {
   const response = await fetchWithTimeout(`${API_BASE}/api/jobs`, {
  method: "POST",
  headers: getAdminHeaders({
    "Content-Type": "application/json",
  }),
  body: JSON.stringify(finalJob),
});

if (!response.ok) {
  const errorData = await response.json().catch(() => null);

  if (response.status === 409 && errorData?.blockedTechNames?.length > 0) {
    window.alert(
      `No se puede asignar el trabajo.\n\nTécnico fuera de taller por mantenimiento: ${errorData.blockedTechNames.join(
        ", "
      )}`
    );

    return;
  }

  window.alert(errorData?.error || "Error guardando el trabajo.");
  return;
}

 for (const tech of result.techs) {
  saveTechToBackend(tech);
}

await reloadJobsFromBackend();
recalcWaitingQueue(result.techs, result.jobs);
  } catch (error) {
    console.error("Error guardando trabajo:", error);
  }
}


function addLinkedTemplate() {
  const firstTemplate = quickTemplates.find(
    (template) => template.key === linkedTemplateDraft.firstTemplateKey
  );

  const secondTemplate = quickTemplates.find(
    (template) => template.key === linkedTemplateDraft.secondTemplateKey
  );

  if (!firstTemplate || !secondTemplate) {
    alert("Selecciona los dos trabajos vinculados.");
    return;
  }

  const defaultLabel = `${firstTemplate.label} → ${secondTemplate.label}`;
  const label = linkedTemplateDraft.label.trim() || defaultLabel;

  const template: LinkedTemplate = {
    id: `linked-template-${Date.now()}`,
    workshopId: selectedWorkshopId,
    label,
    firstTemplateKey: firstTemplate.key,
    secondTemplateKey: secondTemplate.key,
  };

  setLinkedTemplates((prev) => [template, ...prev]);

  setLinkedTemplateDraft((prev) => ({
    ...prev,
    label: "",
  }));

  appendLog(`Plantilla vinculada creada: ${label}.`);
}

function removeLinkedTemplate(id: string) {
  const template = linkedTemplates.find((item) => item.id === id);

  setLinkedTemplates((prev) => prev.filter((item) => item.id !== id));

  if (template) {
    appendLog(`Plantilla vinculada eliminada: ${template.label}.`);
  }
}


async function createTemplateEntry() {
  const firstTemplate = quickTemplates.find(
    (item) => item.key === quickDraft.templateKey
  );

  if (!firstTemplate) {
    alert("No se encuentra la entrada rápida seleccionada.");
    return;
  }

  if (!quickDraft.plate.trim()) {
    alert("Escribe una matrícula.");
    return;
  }

  const secondTemplate = quickDraft.linkedTemplateKey
    ? quickTemplates.find((item) => item.key === quickDraft.linkedTemplateKey)
    : null;

  const availableIncludedTasks = buildSelectableIncludedTasks(
    firstTemplate.area,
    quickTemplates,
    customExtraTasks,
    firstTemplate.key
  );

  const selectedIncludedTasks = getIncludedTasksByIds(
    quickDraft.includedTaskIds,
    availableIncludedTasks
  );

  const createdAtMs = nowMs();
  const safeJobId = getNextSafeJobId(jobs, nextJobId);
  const secondSafeJobId = safeJobId + 1;

  const builtEntry = buildQuickEntryV2Jobs({
    safeJobId,
    secondSafeJobId,
    selectedWorkshopId,
    firstTemplate,
    secondTemplate,
    plate: quickDraft.plate,
    urgent: quickDraft.urgent,
    customerName: quickDraft.customerName,
    customerPhone: quickDraft.customerPhone,
    selectedIncludedTasks,
    quantity: quickDraft.quantity,
    createdAtMs,
  });

  const result = allocateJob(
  builtEntry.firstJob,
  effectiveTechs,
  [builtEntry.firstJob, ...jobs],
  true
);

  let finalJobs: Job[] = result.jobs;

  let jobsToSave: Job[] = [
    result.jobs.find((job) => job.id === builtEntry.firstJob.id) ??
      builtEntry.firstJob,
  ];

  if (builtEntry.secondJob) {
    finalJobs = [builtEntry.secondJob, ...result.jobs];
    jobsToSave = [...jobsToSave, builtEntry.secondJob];
  }

  const plate = builtEntry.firstJob.plate;
  const isLinkedEntry = Boolean(builtEntry.secondJob);

  try {
    for (const job of jobsToSave) {
      await saveJobToBackend(job);
    }

    for (const tech of result.techs) {
      await saveTechToBackend(tech);
    }

    setTechs(result.techs);
    setJobs(finalJobs);

    setNextJobId((value) =>
      Math.max(
        value,
        builtEntry.secondJob ? secondSafeJobId + 1 : safeJobId + 1
      )
    );

    setQuickDraft((prev) => resetQuickDraftAfterCreate(prev));

    setQuickEntryOpen(false);

    appendLog(
      isLinkedEntry && secondTemplate
        ? `Nueva entrada vinculada creada: ${plate} · ${firstTemplate.label} → ${secondTemplate.label}. Cantidad: ${builtEntry.quantity}. Tiempo previsto: ${formatMinutes(
            builtEntry.firstJobTotalMinutes
          )}. Importe: ${builtEntry.firstJobTotalPrice.toLocaleString(
            "es-ES",
            {
              style: "currency",
              currency: "EUR",
            }
          )}. Pendiente de validar antes de iniciar.`
        : selectedIncludedTasks.length > 0
        ? `Nueva entrada creada: ${firstTemplate.label} (${plate}) con tareas: ${selectedIncludedTasks
            .map((task) => task.label)
            .join(" + ")}. Cantidad: ${
            builtEntry.quantity
          }. Tiempo previsto: ${formatMinutes(
            builtEntry.firstJobTotalMinutes
          )}. Importe: ${builtEntry.firstJobTotalPrice.toLocaleString(
            "es-ES",
            {
              style: "currency",
              currency: "EUR",
            }
          )}. Pendiente de validar antes de iniciar.`
        : `Nueva entrada creada: ${firstTemplate.label} (${plate}). Cantidad: ${
            builtEntry.quantity
          }. Tiempo previsto: ${formatMinutes(
            builtEntry.firstJobTotalMinutes
          )}. Importe: ${builtEntry.firstJobTotalPrice.toLocaleString(
            "es-ES",
            {
              style: "currency",
              currency: "EUR",
            }
          )}. Pendiente de validar antes de iniciar.`
    );

    await reloadJobsFromBackend();
    await reloadTechsFromBackend();
  } catch (error) {
    console.error("Error guardando entrada rápida:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido guardando la entrada rápida.";

    alert(
      `No se ha podido guardar la entrada rápida.\n\nMatrícula: ${plate}\n\n${message}`
    );

    appendLog(`Error guardando entrada rápida ${plate}.`);
  }
}

async function saveMaintTask() {
  const label = maintTaskForm.label.trim();
  if (!label) return;
  setMaintTaskSaving(true);
  try {
    if (maintTaskEditing) {
      const resp = await fetchWithTimeout(`${API_BASE}/api/maintenance-tasks/${maintTaskEditing}`, {
        method: "PUT",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ label, type: maintTaskForm.type }),
      });
      if (resp.ok) {
        const updated = await resp.json() as MaintenanceTask;
        setMaintenanceTasks((prev) => prev.map((t) => t.id === maintTaskEditing ? updated : t));
        setMaintTaskEditing(null);
        setMaintTaskForm({ label: "", type: "en_taller" });
      }
    } else {
      const newTask: MaintenanceTask = { id: `maint-${Date.now()}`, label, type: maintTaskForm.type };
      const resp = await fetchWithTimeout(`${API_BASE}/api/maintenance-tasks`, {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(newTask),
      });
      const saved = resp.ok ? (await resp.json() as MaintenanceTask) : newTask;
      setMaintenanceTasks((prev) => [...prev, saved]);
      setMaintTaskForm({ label: "", type: "en_taller" });
    }
  } finally {
    setMaintTaskSaving(false);
  }
}

async function deleteMaintTask(id: string) {
  if (!window.confirm("¿Eliminar esta tarea de mantenimiento?")) return;
  await fetchWithTimeout(`${API_BASE}/api/maintenance-tasks/${id}`, {
    method: "DELETE",
    headers: getAdminHeaders(),
  });
  setMaintenanceTasks((prev) => prev.filter((t) => t.id !== id));
  if (maintTaskEditing === id) { setMaintTaskEditing(null); setMaintTaskForm({ label: "", type: "en_taller" }); }
}

async function assignQuickMaintenanceTask() {
  const techName = maintenanceDraft.techName.trim();

  const task = maintenanceTasks.find(
    (item) => item.id === maintenanceDraft.taskId
  );

  if (!techName || !task) {
    alert("Selecciona técnico y tarea de mantenimiento.");
    return;
  }

  const tech = maintenanceTechCandidates.find((item) => item.name === techName);

  if (!tech) {
    alert("El técnico seleccionado no está disponible para mantenimiento.");
    return;
  }

  try {
    await assignMaintenanceTaskToBackend({
      task,
      techName,
    });

    appendLog(
      `Mantenimiento asignado a ${techName}: ${task.label} (${
        task.type === "fuera_taller" ? "fuera de taller" : "en taller"
      }).`
    );

    await reloadMaintenanceAvailabilityFromBackend();
  } catch (error) {
    console.error("Error asignando mantenimiento rápido:", error);

    const message =
      error instanceof Error
        ? error.message
        : "No se pudo asignar la tarea de mantenimiento.";

    alert(message);
  }
}

function addCustomExtraTask() {
  const validationError = validateNewCustomExtraTaskV2(newCustomExtraTask);

  if (validationError) {
    alert(validationError);
    return;
  }

  const task = buildCustomExtraTaskV2(newCustomExtraTask);

  setCustomExtraTasks((prev) =>
    [...prev, task].sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" })
    )
  );

  setNewCustomExtraTask(resetNewCustomExtraTaskV2(task.area));

  appendLog(`Tarea extra creada: ${task.label}.`);
}

function removeCustomExtraTask(id: string) {
  const task = customExtraTasks.find((item) => item.id === id);

  setCustomExtraTasks((prev) => prev.filter((item) => item.id !== id));

  if (task) {
    appendLog(`Tarea extra eliminada: ${task.label}.`);
  }
}
async function addQuickTemplate() {
  const validationError = validateNewQuickTemplateV2(newQuickTemplate);

  if (validationError) {
    alert(validationError);
    return;
  }

  const template = buildNewQuickTemplateV2({
    draft: newQuickTemplate,
    selectedWorkshopId,
  });

  const finalAllowedTechs = template.allowedTechs ?? [];
  const label = template.label;

  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/quick-templates`, {
      method: "POST",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(getQuickTemplateV2BackendPayload(template)),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Error creando entrada rápida:", {
        status: response.status,
        responseText,
        template,
      });

      alert(
        `No se pudo crear la entrada rápida.\n\nCódigo: ${response.status}\n${responseText}`
      );

      appendLog(`Error al crear la entrada rápida: ${label}.`);
      return;
    }

    let savedTemplate: QuickTemplate;

    try {
      savedTemplate = responseText ? JSON.parse(responseText) : template;
    } catch {
      savedTemplate = template;
    }

    setQuickTemplates((prev) => {
      const exists = prev.some((item) => item.key === savedTemplate.key);

      if (exists) {
        return prev.map((item) =>
          item.key === savedTemplate.key ? savedTemplate : item
        );
      }

      return [...prev, savedTemplate];
    });

    setQuickSelectedArea(savedTemplate.area);

    setQuickDraft((prev) => ({
      ...prev,
      templateKey: savedTemplate.key,
      linkedTemplateKey: "",
      includedTaskIds: prev.includedTaskIds ?? [],
      quantity: "1",
    }));

    setNewQuickTemplate(resetNewQuickTemplateV2(savedTemplate.area));

    appendLog(
      finalAllowedTechs.length === 0
        ? `Entrada rápida creada sin técnicos fijos: ${label}.`
        : `Entrada rápida creada: ${label}.`
    );
  } catch (error) {
    console.error("Error guardando entrada rápida:", error);

    alert(
      "Error de conexión al crear la entrada rápida. Revisa que el servidor esté arrancado en el puerto 4000."
    );

    appendLog(`Error al crear la entrada rápida: ${label}.`);
  }
}

async function removeQuickTemplate(key: string) {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE}/api/quick-templates/${key}`,
      {
        method: "DELETE",
        headers: getAdminHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error("No se pudo eliminar la entrada rápida");
    }

    setQuickTemplates((prev) => prev.filter((t) => t.key !== key));

setQuickDraft((prev) => ({
  ...resetQuickDraftAfterCreate(prev),
  templateKey: prev.templateKey,
}));

    appendLog("Entrada rápida eliminada.");
  } catch (error) {
    console.error("Error eliminando entrada rápida:", error);
    appendLog("Error al eliminar la entrada rápida.");
  }
}

async function deleteWaitingJob(jobId: number) {
  const target = jobs.find((job) => job.id === jobId);
  if (!target || target.status !== "espera") return;

  const ok = window.confirm(
    `¿Eliminar el trabajo en cola ${target.plate}? Esta acción no se puede deshacer.`
  );

  if (!ok) return;

  const updatedJobs = jobs.filter((job) => job.id !== jobId);

  setJobs(updatedJobs);
  appendLog(`Trabajo en cola eliminado: ${target.plate}.`);

  try {
await fetch(`${API_BASE}/api/jobs/${jobId}`, {
  method: "DELETE",
  headers: getAdminHeaders(),
});

    await reloadJobsFromBackend();
  } catch (error) {
    console.error("Error eliminando trabajo:", error);
    appendLog(`Error al eliminar ${target.plate}.`);
  }
}

async function pauseActiveJobsForStandby(triggerTime: string) {
  const activeJobsToPause = jobs.filter(
    (job) =>
      job.status === "activo" &&
      belongsToWorkshop(job, selectedWorkshopId)
  );

  if (activeJobsToPause.length === 0) return;

  const pausedAtMs = nowMs();
  const assignedNamesToFree = new Set<string>();
  const pausedJobsById = new Map<number, Job>();

  for (const job of activeJobsToPause) {
    const assignedNames = job.assignedNames ?? [];

    for (const name of assignedNames) {
      assignedNamesToFree.add(name);
    }

    const currentWorked = getElapsedMinutes(job.startedAtMs, pausedAtMs) ?? 0;
    const totalWorked = (job.workedAccumulatedMinutes ?? 0) + currentWorked;
    const reason = job.reason || "Trabajo";

    pausedJobsById.set(job.id, {
      ...job,
      status: "parado",
      workedAccumulatedMinutes: totalWorked,
      pausedAccumulatedMinutes: job.pausedAccumulatedMinutes ?? 0,
      pausedAtMs,
      startedAtMs: null,
      reason: reason.includes("STAND BY")
        ? reason
        : `${reason} · STAND BY automatico ${triggerTime}.`,
    });
  }

  const updatedJobs = jobs.map((job) => pausedJobsById.get(job.id) ?? job);
  const updatedTechs = techs.map((tech) =>
    assignedNamesToFree.has(tech.name)
      ? {
          ...tech,
          status: "disponible" as TechStatus,
          currentJobId: null,
        }
      : tech
  );

  setJobs(updatedJobs);
  setTechs(updatedTechs);

  appendLog(
    `Stand by automatico ${triggerTime}: ${activeJobsToPause.length} trabajo(s) activo(s) pausado(s).`
  );

  try {
    for (const pausedJob of pausedJobsById.values()) {
      await saveJobToBackend(pausedJob);
    }

    for (const tech of updatedTechs) {
      if (assignedNamesToFree.has(tech.name)) {
        await saveTechToBackend(tech);
      }
    }

    recalcWaitingQueue(updatedTechs, updatedJobs);
  } catch (error) {
    console.error("Error aplicando stand by automatico:", error);
    appendLog(`Error al aplicar stand by automatico de las ${triggerTime}.`);
  }
}

async function pauseJob(jobId: number) {
  const target = jobs.find((job) => job.id === jobId);
  if (!target || target.status !== "activo") return;

  const pausedAtMs = nowMs();
  const assignedNames = target.assignedNames ?? [];

  const currentWorked = getElapsedMinutes(target.startedAtMs, pausedAtMs) ?? 0;
  const totalWorked = (target.workedAccumulatedMinutes ?? 0) + currentWorked;

  const pausedJob: Job = {
    ...target,
    status: "parado",
    workedAccumulatedMinutes: totalWorked,
    pausedAccumulatedMinutes: target.pausedAccumulatedMinutes ?? 0,
    pausedAtMs,
    startedAtMs: null,
    reason: target.reason?.includes("STAND BY")
      ? target.reason
      : `${target.reason || "Trabajo"} · STAND BY temporalmente.`,
  };

  const updatedJobs: Job[] = jobs.map((job) =>
    job.id === jobId ? pausedJob : job
  );

  const updatedTechs: Tech[] = techs.map((tech) =>
    assignedNames.includes(tech.name)
      ? {
          ...tech,
          status: "disponible" as TechStatus,
          currentJobId: null,
        }
      : tech
  );

  setJobs(updatedJobs);
  setTechs(updatedTechs);

  appendLog(
    `Trabajo en stand by: ${target.plate}. Trabajado acumulado: ${formatMinutes(
      totalWorked
    )}.`
  );

  try {
    await saveJobToBackend(pausedJob);

    for (const tech of updatedTechs) {
      saveTechToBackend(tech);
    }

    recalcWaitingQueue(updatedTechs, updatedJobs);
  } catch (error) {
    console.error("Error parando trabajo:", error);
    appendLog(`Error al poner en stand by ${target.plate}.`);
  }
}

async function reactivatePausedJob(jobId: number) {
  const target = jobs.find((job) => job.id === jobId);
  if (!target || target.status !== "parado") return;

  const reactivatedAtMs = nowMs();

  const currentPaused =
    target.pausedAtMs != null
      ? getElapsedMinutes(target.pausedAtMs, reactivatedAtMs) ?? 0
      : 0;

  const totalPaused = (target.pausedAccumulatedMinutes ?? 0) + currentPaused;

  const cleanedReason = (target.reason || "pendiente de asignación")
    .replace(" · STAND BY temporalmente.", "")
    .replace(" · PARADO temporalmente.", "");

  const reopenedJob: Job = {
    ...target,
    status: "espera",
    assignedNames: [],
    startedAtMs: null,
    pausedAtMs: null,
    pausedAccumulatedMinutes: totalPaused,
    workedAccumulatedMinutes: target.workedAccumulatedMinutes ?? 0,
    reason: `Reactivado: ${cleanedReason}`,
  };

  const updatedJobs: Job[] = jobs.map((job) =>
    job.id === jobId ? reopenedJob : job
  );

  setJobs(updatedJobs);

  appendLog(
    `Trabajo reactivado: ${target.plate}. Trabajado acumulado: ${formatMinutes(
      reopenedJob.workedAccumulatedMinutes
    )}. Parado acumulado: ${formatMinutes(totalPaused)}.`
  );

  try {
    await saveJobToBackend(reopenedJob);

    // Primero intenta asignar cola con técnicos libres.
    recalcWaitingQueue(techs, updatedJobs);
  } catch (error) {
    console.error("Error reactivando trabajo:", error);
    appendLog(`Error al reactivar ${target.plate}.`);
  }
}

function updateValidationResponsible(jobId: number, responsibleName: string) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "validacion") return;

  const tech = techs.find((item) => item.name === responsibleName);
  if (!tech) return;

  if (
    !canSelectTechManuallyForJob(
  tech,
  job,
  jobs,
  quickTemplates,
  "responsable"
)
  ) {
    alert(
      `${tech.name} no se puede proponer como responsable.\n\nNo está disponible, ya está ocupado o no tiene competencia.`
    );

    appendLog(
      `${tech.name} no se puede proponer como responsable para ${job.plate}.`
    );

    return;
  }

  const currentAssigned = job.assignedNames ?? [];
  const currentSupport = currentAssigned[1] ?? "";

  const nextAssignedNames =
    currentSupport && currentSupport !== responsibleName
      ? [responsibleName, currentSupport]
      : [responsibleName];

  const updatedJob: Job = {
    ...job,
    assignedNames: nextAssignedNames,
    reason: `Propuesta modificada manualmente. Responsable propuesto: ${responsibleName}${
      nextAssignedNames[1] ? `. Apoyo propuesto: ${nextAssignedNames[1]}` : ""
    }. Pendiente de autorización.`,
  };

  setJobs((prev) =>
    prev.map((item) => (item.id === jobId ? updatedJob : item))
  );

  saveJobToBackend(updatedJob);

  appendLog(
    `Propuesta modificada para ${job.plate}: responsable ${responsibleName}.`
  );
}

function updateValidationSupport(jobId: number, supportName: string) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "validacion") return;

  const assignedNames = job.assignedNames ?? [];
  const responsibleName = assignedNames[0] ?? "";

  if (!responsibleName) {
    alert("Primero selecciona un responsable propuesto.");
    return;
  }

  if (supportName === responsibleName) {
    alert("El apoyo no puede ser el mismo que el responsable.");
    return;
  }

  const tech = techs.find((item) => item.name === supportName);
  if (!tech) return;

  if (
  !canSelectTechManuallyForJob(
  tech,
  job,
  jobs,
  quickTemplates,
  "apoyo"
)
  ) {
    alert(
      `${tech.name} no se puede proponer como apoyo.\n\nNo está disponible, ya está ocupado o no tiene competencia.`
    );

    appendLog(`${tech.name} no se puede proponer como apoyo para ${job.plate}.`);

    return;
  }

  const updatedJob: Job = {
    ...job,
    assignedNames: [responsibleName, supportName],
    reason: `Propuesta modificada manualmente. Responsable propuesto: ${responsibleName}. Apoyo propuesto: ${supportName}. Pendiente de autorización.`,
  };

  setJobs((prev) =>
    prev.map((item) => (item.id === jobId ? updatedJob : item))
  );

  saveJobToBackend(updatedJob);

  appendLog(`Propuesta modificada para ${job.plate}: apoyo ${supportName}.`);
}

function removeValidationSupport(jobId: number) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "validacion") return;

  const assignedNames = job.assignedNames ?? [];
  const responsibleName = assignedNames[0] ?? "";

  if (!responsibleName) {
    alert("La propuesta no tiene responsable.");
    return;
  }

  const updatedJob: Job = {
    ...job,
    assignedNames: [responsibleName],
    reason: `Propuesta modificada manualmente. Responsable propuesto: ${responsibleName}. Sin apoyo propuesto. Pendiente de autorización.`,
  };

  setJobs((prev) =>
    prev.map((item) => (item.id === jobId ? updatedJob : item))
  );

  saveJobToBackend(updatedJob);

  appendLog(`Apoyo propuesto quitado para ${job.plate}.`);
}

async function authorizeProposedJob(jobId: number) {
  const job = jobs.find((item) => item.id === jobId);

  if (!job || job.status !== "validacion") return;

  const assignedNames = job.assignedNames ?? [];

  if (assignedNames.length === 0) {
    alert("No hay técnicos propuestos para iniciar este trabajo.");
    appendLog(`No se puede iniciar ${job.plate}: no hay técnicos propuestos.`);
    return;
  }

  if (hasAnyTechBlockedByOutsideMaintenance(assignedNames)) {
    appendLog(
      `No se puede iniciar ${job.plate}: técnico en mantenimiento fuera de taller.`
    );
    return;
  }

  for (const techName of assignedNames) {
    const tech = techs.find((item) => item.name === techName);

    if (!tech) {
      alert(`No se puede iniciar: ${techName} ya no existe como técnico.`);
      appendLog(`No se puede iniciar ${job.plate}: ${techName} no existe.`);
      return;
    }

    if (isTechUnavailableForAssignment(tech)) {
      alert(
        `No se puede iniciar el trabajo.\n\n${tech.name} no está disponible.`
      );
      appendLog(
        `No se puede iniciar ${job.plate}: ${tech.name} no está disponible.`
      );
      return;
    }

    if (tech.currentJobId != null) {
      alert(
        `No se puede iniciar el trabajo.\n\n${tech.name} ya está asignado a otro trabajo.`
      );
      appendLog(
        `No se puede iniciar ${job.plate}: ${tech.name} ya está asignado.`
      );
      return;
    }

    if (tech.status !== "disponible") {
      alert(
        `No se puede iniciar el trabajo.\n\n${tech.name} no está libre actualmente.`
      );
      appendLog(
        `No se puede iniciar ${job.plate}: ${tech.name} no está libre.`
      );
      return;
    }
  }

  const startedJob = buildAuthorizedJob(job, nowMs()) as Job;

  const updatedJobs: Job[] = jobs.map((item) =>
    item.id === jobId ? startedJob : item
  );

  const updatedTechs: Tech[] = techs.map((tech) => {
    const index = assignedNames.indexOf(tech.name);

    if (index === -1) return tech;

    const isResponsible = index === 0;

    return {
      ...tech,
      status: isResponsible
  ? ("ocupado" as TechStatus)
  : ("refuerzo" as TechStatus),
      currentJobId: jobId,
      blocked: isUnavailableTechStatus(tech.status),
    };
  });

  setJobs(updatedJobs);
  setTechs(updatedTechs);

void updateScheduledJobStatusByJobId(jobId, "activo");

  appendLog(
    `Inicio autorizado: ${job.plate} asignado a ${assignedNames.join(" + ")}.`
  );

  try {
    await saveJobToBackend(startedJob);

    for (const tech of updatedTechs) {
      if (assignedNames.includes(tech.name)) {
        saveTechToBackend(tech);
      }
    }

    recalcWaitingQueue(updatedTechs, updatedJobs);
  } catch (error) {
    console.error("Error autorizando inicio:", error);
    appendLog(`Error al autorizar inicio de ${job.plate}.`);
  }
}

async function rejectProposedJob(jobId: number) {
  const job = jobs.find((item) => item.id === jobId);

  if (!job || job.status !== "validacion") return;

  const updatedJob = buildRejectedValidationJob(job) as Job;

  const updatedJobs: Job[] = jobs.map((item) =>
    item.id === jobId ? updatedJob : item
  );

setJobs(updatedJobs);
void updateScheduledJobStatusByJobId(jobId, "en_cola");

  appendLog(
    `Propuesta rechazada para ${job.plate}. El trabajo vuelve a cola y queda pendiente de nueva validación.`
  );

  try {
    await saveJobToBackend(updatedJob);

        recalcWaitingQueue(techs, updatedJobs);
  } catch (error) {
    console.error("Error rechazando propuesta:", error);
    appendLog(`Error al rechazar propuesta de ${job.plate}.`);
  }
}

async function assignWaitingJobManually(jobId: number, techName: string) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || (job.status !== "espera" && job.status !== "validacion")) return;

  const tech = techs.find((item) => item.name === techName);
  if (!tech) return;

  if (hasAnyTechBlockedByOutsideMaintenance([techName])) {
    appendLog(
      `No se puede asignar ${job.plate} a ${techName}: mantenimiento fuera de taller.`
    );
    return;
  }

  const techIsFree =
    tech.currentJobId == null &&
    tech.status === "disponible" &&
    !tech.blocked &&
    !isTechBlockedByOutsideMaintenance(tech.name);

  if (!techIsFree) {
    alert(
      `${tech.name} no está libre ahora.\n\nUsa "Asignar o reservar técnico" para dejarlo reservado hasta que acabe su trabajo actual.`
    );
    return;
  }

  if (
    !canAssignTechManuallyToJob(
      tech,
      job,
      jobs,
      quickTemplates,
      "responsable"
    )
  ) {
    appendLog(
      `${tech.name} no se puede asignar a ${getOperationLabel(
        job
      )}: no está disponible, ya está ocupado o no tiene competencia.`
    );

    alert(
      `${tech.name} no se puede asignar.\n\nNo está disponible, ya está ocupado o no tiene competencia.`
    );

    return;
  }

  const assignedNames = [techName];

  // Al asignar manualmente desde cola → pasa a "validacion" (pendiente de confirmación)
  // El supervisor deberá confirmar antes de que empiece, igual que una entrada nueva
  const updatedJob: Job = {
    ...job,
    status: "validacion",
    assignedNames,
    startedAtMs: null,
    reservedTechName: null,
    reservedAtMs: null,
    reason:
      job.status === "validacion"
        ? `Propuesta reasignada manualmente. Pendiente de confirmar. Responsable: ${techName}.`
        : `Asignado manualmente desde cola. Pendiente de confirmar. Responsable: ${techName}.`,
  };

  const updatedJobs: Job[] = jobs.map((item) =>
    item.id === jobId ? updatedJob : item
  );

  // El técnico queda libre hasta que se confirme — no lo marcamos ocupado todavía
  setJobs(updatedJobs);

  appendLog(
    `Trabajo en cola ${job.plate} asignado a ${techName}. Pendiente de confirmación.`
  );

  try {
    await saveJobToBackend(updatedJob);
  } catch (error) {
    console.error("Error asignando trabajo en cola:", error);
    appendLog(`Error al asignar ${job.plate}.`);
  }
}

async function startReservedJobsForFreedTechs(
  freedTechNames: string[],
  baseJobs: Job[],
  baseTechs: Tech[]
): Promise<{ jobs: Job[]; techs: Tech[] }> {
  let nextJobs = [...baseJobs];
  let nextTechs = [...baseTechs];

  for (const techName of freedTechNames) {
    const reservedJob = nextJobs
      .filter((job) => job.status === "espera")
      .filter((job) => job.reservedTechName === techName)
      .sort((a, b) => {
        const aReservedAt = a.reservedAtMs ?? a.createdAtMs;
        const bReservedAt = b.reservedAtMs ?? b.createdAtMs;

        return aReservedAt - bReservedAt;
      })[0];

    if (!reservedJob) continue;

    const tech = nextTechs.find((item) => item.name === techName);

    if (!tech) continue;

    const techIsFree =
      tech.currentJobId == null &&
      tech.status === "disponible" &&
      !isTechBlockedByOutsideMaintenance(tech.name);

    if (!techIsFree) continue;

    if (
      !canAssignTechManuallyToJob(
        tech,
        reservedJob,
        nextJobs,
        quickTemplates,
        "responsable"
      )
    ) {
      appendLog(
        `No se pudo iniciar la reserva ${reservedJob.plate} para ${techName}: ya no cumple condiciones.`
      );
      continue;
    }

    const startedJob: Job = {
      ...reservedJob,
      status: "activo",
      assignedNames: [techName],
      startedAtMs: nowMs(),
      reservedTechName: null,
      reservedAtMs: null,
      reason: `Inicio automático de reserva manual. Responsable: ${techName}.`,
    };

    nextJobs = nextJobs.map((item) =>
      item.id === startedJob.id ? startedJob : item
    );

    nextTechs = nextTechs.map((item) =>
      item.name === techName
        ? {
            ...item,
            status: "ocupado" as TechStatus,
            currentJobId: startedJob.id,
            blocked: isUnavailableTechStatus(item.status),
          }
        : item
    );

    try {
      await saveJobToBackend(startedJob);

      const changedTech = nextTechs.find((item) => item.name === techName);
      if (changedTech) {
        await saveTechToBackend(changedTech);
      }

      appendLog(
        `Trabajo reservado iniciado: ${startedJob.plate} asignado a ${techName}.`
      );
    } catch (error) {
      console.error("Error iniciando reserva manual:", error);
      appendLog(`Error iniciando reserva ${startedJob.plate} para ${techName}.`);
    }
  }

  return {
    jobs: nextJobs,
    techs: nextTechs,
  };
}

async function assignOrReserveWaitingJobManually(jobId: number, techName: string) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "espera") return;

  const tech = techs.find((item) => item.name === techName);
  if (!tech) return;

  if (hasAnyTechBlockedByOutsideMaintenance([techName])) {
    appendLog(
      `No se puede reservar ${job.plate} para ${techName}: mantenimiento fuera de taller.`
    );
    return;
  }

  const techIsFree =
    tech.currentJobId == null &&
    tech.status === "disponible" &&
    !tech.blocked &&
    !isTechBlockedByOutsideMaintenance(tech.name);

  if (techIsFree) {
    await assignWaitingJobManually(jobId, techName);
    return;
  }

  if (
    isHardBlockedTechStatus(tech.status) ||
    isManualUnavailableStatus(tech.status) ||
    isUnavailableTechStatus(tech.status)
  ) {
    alert(
      `${tech.name} no se puede reservar.\n\nEstá en estado ${getTechStatusLabel(
        tech.status
      )}.`
    );
    return;
  }

  const reservedJob: Job = {
    ...job,
    reservedTechName: techName,
    reservedAtMs: nowMs(),
    assignedNames: [],
    status: "espera",
    startedAtMs: null,
    reason: `Reservado manualmente para ${techName}. Se iniciará cuando termine su trabajo actual.`,
  };

  const updatedJobs = jobs.map((item) =>
    item.id === jobId ? reservedJob : item
  );

  setJobs(updatedJobs);

  try {
    await saveJobToBackend(reservedJob);

    appendLog(
      `Trabajo ${job.plate} reservado para ${techName} cuando quede libre.`
    );
  } catch (error) {
    console.error("Error reservando trabajo:", error);
    appendLog(`Error reservando ${job.plate} para ${techName}.`);
  }
}


async function deleteValidationJob(jobId: number) {
  const job = jobs.find((item) => item.id === jobId);

  if (!job) return;

  const ok = window.confirm(
    `¿Eliminar la tarea pendiente de validar ${job.plate}?`
  );

  if (!ok) return;

  const closedAtMs = nowMs();

  const deletedJob: Job = {
    ...job,
    status: "cerrado",
    closedAtMs,
    reason: job.reason
      ? `${job.reason} Eliminado desde pendientes de validar.`
      : "Eliminado desde pendientes de validar.",
  };

  const nextJobs = jobs.map((item) =>
    item.id === jobId ? deletedJob : item
  );

  const nextTechs = techs.map((tech) => {
    if (tech.currentJobId !== jobId) return tech;

    return {
      ...tech,
      currentJobId: null,
      status: tech.status === "ocupado" ? "disponible" : tech.status,
    };
  });

  setJobs(nextJobs);
  setTechs(nextTechs);

  try {
    await saveJobToBackend(deletedJob);

    for (const tech of nextTechs) {
      await saveTechToBackend(tech);
    }

    appendLog(`Tarea pendiente eliminada: ${job.plate}.`);

    await reloadJobsFromBackend();
    await reloadTechsFromBackend();
  } catch (error) {
    console.error("Error eliminando tarea pendiente:", error);
    appendLog(`Error eliminando tarea pendiente ${job.plate}.`);
  }
}

function sendValidationJobToQueue(jobId: number) {
  const job = jobs.find((item) => item.id === jobId);

  if (!job) return;

  const ok = window.confirm(
    `¿Enviar ${job.plate} a cola de trabajo?\n\nSe quitará la propuesta actual y quedará pendiente de asignación.`
  );

  if (!ok) return;

  const assignedNames = job.assignedNames ?? [];

  const updatedJob: Job = {
    ...job,
    status: "espera" as JobStatus,
    assignedNames: [],
    startedAtMs: null,
    reason: job.reason
      ? `${job.reason}. Enviado manualmente a cola de trabajo.`
      : "Enviado manualmente a cola de trabajo.",
  };

  const nextJobs = jobs.map((item) =>
    item.id === jobId ? updatedJob : item
  );

  const nextTechs = techs.map((tech) => {
    if (!assignedNames.includes(tech.name)) return tech;

    if (isHardBlockedTechStatus(tech.status)) {
      return {
        ...tech,
        currentJobId: null,
      };
    }

    return {
      ...tech,
      currentJobId: null,
      status: normalizeTechStatus(tech.status),
    };
  });

  setJobs(nextJobs);
  setTechs(nextTechs);

  saveJobToBackend(updatedJob);

  for (const tech of nextTechs) {
    if (assignedNames.includes(tech.name)) {
      saveTechToBackend(tech);
    }
  }

  appendLog(`Trabajo ${job.plate} enviado a cola de trabajo.`);
}

function appendFinishedWhatsappLog(job: Job, whatsapp: any) {
  if (!whatsapp) return;

  if (whatsapp.status === "sent") {
    appendLog(
      `WhatsApp finalizacion enviado a ${job.customerPhone || "cliente"} · ${
        job.plate
      }.`
    );
    return;
  }

  if (whatsapp.status === "error") {
    appendLog(
      `Error enviando WhatsApp finalizacion a ${
        job.customerPhone || "cliente"
      } · ${job.plate}.`
    );
    return;
  }

  if (whatsapp.reason === "missing_twilio_credentials") {
    appendLog("WhatsApp finalizacion no enviado: faltan credenciales Twilio.");
    return;
  }

  if (whatsapp.reason === "missing_job_finished_template") {
    appendLog(
      "WhatsApp finalizacion no enviado: falta TWILIO_JOB_FINISHED_CONTENT_SID."
    );
  }
}

async function finishJob(jobId: number) {
  const target = jobs.find((job) => job.id === jobId);
  if (!target) return;

  const assignedNames = Array.isArray(target.assignedNames)
    ? target.assignedNames
    : [];

  const closedAtMs = nowMs();

  const actualMinutes = getWorkedMinutes(target, closedAtMs);
  const pausedMinutes = getPausedMinutes(target, closedAtMs);

  const closedJob: Job = {
    ...target,
    status: "cerrado",
    closedAtMs,
    actualMinutes,
    workedAccumulatedMinutes: actualMinutes,
    pausedAccumulatedMinutes: pausedMinutes,
    pausedAtMs: null,
    startedAtMs: null,
  };

  const jobsAfterClose: Job[] = jobs.map((job) =>
    job.id === jobId ? closedJob : job
  );

  const freedTechs: Tech[] = techs.map((tech) =>
    assignedNames.includes(tech.name)
      ? {
          ...tech,
          status: "disponible" as TechStatus,
          currentJobId: null,
        }
      : tech
  );

  const linkedJobToReactivate = jobsAfterClose.find((job) => {
    if (job.status !== "parado") return false;
    if (job.id === jobId) return false;

    if (job.dependsOnJobId === jobId) return true;

    if (
      target.linkedGroupId &&
      job.linkedGroupId === target.linkedGroupId &&
      job.linkedOrder === 2
    ) {
      return true;
    }

    if (
      job.plate === target.plate &&
      ((job.reason || "").includes("Pendiente del trabajo anterior") ||
        (job.reason || "").includes("Trabajo vinculado") ||
        !!job.blockedReason ||
        job.linkedOrder === 2)
    ) {
      return true;
    }

    return false;
  });

  let finalJobs: Job[] = jobsAfterClose;
  let finalTechs: Tech[] = freedTechs;
  let reactivatedLinkedJob: Job | null = null;

  if (linkedJobToReactivate) {
    const reopenedLinkedJob: Job = {
      ...linkedJobToReactivate,
      status: "espera",
      assignedNames: [],
      startedAtMs: null,
      pausedAtMs: null,
      dependsOnJobId: null,
      blockedReason: null,
      reason: `Trabajo vinculado desbloqueado tras finalizar ${getOperationLabel(
        target
      )}. Pendiente de validación manual antes de iniciar.`,
    };

    const jobsWithReopened = jobsAfterClose.map((job) =>
      job.id === reopenedLinkedJob.id ? reopenedLinkedJob : job
    );

    const result = allocateJob(
      reopenedLinkedJob,
      freedTechs,
      jobsWithReopened,
      true
    );

    finalJobs = result.jobs;
    finalTechs = result.techs;

    reactivatedLinkedJob =
      result.jobs.find((job) => job.id === reopenedLinkedJob.id) ??
      reopenedLinkedJob;
  }

  const reservedStartResult = await startReservedJobsForFreedTechs(
    assignedNames,
    finalJobs,
    finalTechs
  );

  finalJobs = reservedStartResult.jobs;
  finalTechs = reservedStartResult.techs;

 setJobs(normalizeJobsV2Fields(finalJobs));
setTechs(finalTechs);

  if (shouldCloseScheduledJobForFinishedJob(jobId)) {
    void updateScheduledJobStatusByJobId(jobId, "cerrado");
  } else {
    void updateScheduledJobStatusByJobId(jobId, "en_cola");
  }

appendLog(
  `Trabajo ${target.plate} finalizado. Trabajado: ${formatMinutes(
    actualMinutes
  )}. Parado: ${formatMinutes(pausedMinutes)}${getWorkV2LogSuffix(
    closedJob
  )}.`
);

  if (reactivatedLinkedJob) {
    appendLog(
      `Trabajo vinculado desbloqueado: ${
        reactivatedLinkedJob.plate
      } · ${getOperationLabel(
        reactivatedLinkedJob
      )}. Queda pendiente de validar antes de iniciar.`
    );
  }

  try {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/finish`, {
      method: "POST",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
     body: JSON.stringify(
  applyJobV2PayloadFields(
    {
      closedAtMs,
      actualMinutes,
      workedAccumulatedMinutes: actualMinutes,
      pausedAccumulatedMinutes: pausedMinutes,
      status: "cerrado",
      startedAtMs: null,
    },
    closedJob
  )
),
    });

    if (!response.ok) {
      await saveJobToBackend(closedJob);
    } else {
      const responseData = await response.json().catch(() => null);
      appendFinishedWhatsappLog(closedJob, responseData?.whatsapp);
    }

    if (reactivatedLinkedJob) {
      await saveJobToBackend(reactivatedLinkedJob);
    }

    for (const tech of finalTechs) {
      await saveTechToBackend(tech);
    }

    const interruptedTasksToResume =
      getInterruptedMaintenanceTasksForTechs(assignedNames);

    if (interruptedTasksToResume.length > 0) {
      window.alert(
        `Trabajo finalizado.\n\nHay mantenimiento interrumpido pendiente de reanudar:\n\n${interruptedTasksToResume
          .map((task) => `${task.techName}: ${task.taskLabel}`)
          .join("\n")}`
      );
    }

    // Cola manual: no reasignamos automáticamente trabajos de cola.
    await reloadJobsFromBackend();
  } catch (error) {
    console.error("Error cerrando trabajo:", error);

    try {
      await saveJobToBackend(closedJob);
      await reloadJobsFromBackend();
    } catch (fallbackError) {
      console.error("Error guardando cierre fallback:", fallbackError);
      appendLog(`Error al finalizar ${target.plate}.`);
    }
  }
}

async function updateQuickTemplate(updatedTemplate: QuickTemplate) {
const safeTemplate = normalizeExistingQuickTemplateV2(
  updatedTemplate,
  selectedWorkshopId
);

  if (!safeTemplate.label) {
    alert("Escribe un nombre para la entrada rápida.");
    return;
  }

  setQuickTemplates((prev) =>
    prev.map((template) =>
      template.key === safeTemplate.key ? safeTemplate : template
    )
  );

  try {
    const response = await fetchWithTimeout(
  `${API_BASE}/api/quick-templates/${encodeURIComponent(safeTemplate.key)}`,
  {
    method: "PUT",
    headers: getAdminHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(getQuickTemplateV2BackendPayload(safeTemplate)),
  }
);

    const text = await response.text();

    if (!response.ok) {
  console.error("Error servidor guardando entrada rápida:", {
    status: response.status,
    text,
    safeTemplate,
  });

  throw new Error(
    text || `No se pudo guardar la entrada rápida. Código ${response.status}`
  );
}

    appendLog(
      `Entrada rápida actualizada: ${safeTemplate.label} · ${
        safeTemplate.standardMinutes ?? "-"
      } min.`
    );

    setEditingQuickTemplateKey(null);

    await reloadQuickTemplatesFromBackend();
  } catch (error) {
    console.error("Error actualizando entrada rápida:", error);
    appendLog(`Error actualizando entrada rápida ${safeTemplate.label}.`);
    alert(
  error instanceof Error
    ? error.message
    : "No se pudo guardar la entrada rápida en el servidor."
);
  }
}
const MANUAL_TECH_STATUS_KEY = "manualTechStatusOverrides";

function normalizeTechNameKey(name: string) {
  return name
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getManualTechStatusOverrides(): Record<string, TechStatus> {
  try {
    const raw = localStorage.getItem(MANUAL_TECH_STATUS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function applyManualTechStatusOverrides(techsToApply: Tech[]): Tech[] {
  const overrides = getManualTechStatusOverrides();

  return techsToApply.map((tech) => {
    const key = normalizeTechNameKey(tech.name);
    const forcedStatus = overrides[key];

    if (!forcedStatus) return tech;

    return {
      ...tech,
      status: forcedStatus,
      blocked: isManualUnavailableStatus(forcedStatus),
      currentJobId: null,
    };
  });
}
async function setTechManual(name: string, nextStatus: TechStatus) {
  const tech = techs.find((item) => item.name === name);
  if (!tech) return;

  const changedAtMs = nowMs();
  const isGoingUnavailable = isUnavailableTechStatus(nextStatus);
  const isGoingHardBlocked = isHardBlockedTechStatus(nextStatus);
  const isGoingFree = nextStatus === "disponible";

  const validationProposal = getValidationProposalForTech(name, jobs);

  let workingJobs: Job[] = jobs;

  if (validationProposal && tech.currentJobId == null) {
    const ok = window.confirm(
      `${name} está propuesto para ${validationProposal.plate}.\n\nSi cambias su estado, se quitará de la propuesta pendiente. ¿Continuar?`
    );

    if (!ok) return;

    workingJobs = jobs.map((job) =>
      job.id === validationProposal.id
        ? {
            ...job,
            assignedNames: (job.assignedNames ?? []).filter(
              (assignedName) => assignedName !== name
            ),
            reason: `Propuesta actualizada manualmente. ${name} quitado por cambio de estado.`,
          }
        : job
    );

    setJobs(workingJobs);

    const updatedProposal = workingJobs.find(
      (job) => job.id === validationProposal.id
    );

    if (updatedProposal) {
      await saveJobToBackend(updatedProposal);
    }

    appendLog(
      `${name} quitado de la propuesta ${validationProposal.plate} por cambio de estado.`
    );
  }

  const currentJob =
    tech.currentJobId != null
      ? workingJobs.find((job) => job.id === tech.currentJobId)
      : null;

  if (currentJob && currentJob.status === "activo") {
    const assignedNames = currentJob.assignedNames ?? [];
    const isResponsible = assignedNames[0] === name;
    const isSupport = assignedNames.slice(1).includes(name);

    if (isResponsible) {
      alert(
        `${name} está como responsable en ${currentJob.plate}.\n\nPrimero reasigna el responsable o finaliza/pon en stand by el trabajo.`
      );

      appendLog(
        `No se cambió el estado de ${name}: es responsable activo en ${currentJob.plate}.`
      );

      return;
    }

    if (isSupport && (isGoingUnavailable || isGoingFree || isGoingHardBlocked)) {
      const ok = window.confirm(
        `${name} está como apoyo en ${currentJob.plate}.\n\n¿Quieres quitarlo de apoyo y cambiar su estado a ${getTechStatusLabel(
          nextStatus
        )}?`
      );

      if (!ok) return;

      const responsibleName = assignedNames[0];

      const updatedJob: Job = {
        ...currentJob,
        assignedNames: responsibleName ? [responsibleName] : [],
        reason: `Apoyo ${name} quitado manualmente por cambio de estado.`,
      };

      const updatedTechs: Tech[] = techs.map((item) => {
        if (item.name !== name) return item;

        return updateTechStatusTotals(
          {
            ...item,
            currentJobId: null,
          },
          nextStatus,
          changedAtMs
        );
      });

      const updatedJobs: Job[] = workingJobs.map((job) =>
        job.id === currentJob.id ? updatedJob : job
      );

      setTechs(updatedTechs);
      setJobs(updatedJobs);

      appendLog(
        `${name} quitado como apoyo de ${currentJob.plate} y cambia a ${getTechStatusLabel(
          nextStatus
        )}.`
      );

      try {
        await saveJobToBackend(updatedJob);

        const changedTech = updatedTechs.find((item) => item.name === name);
        if (changedTech) {
          await saveTechToBackend(changedTech);
        }

        if (isGoingFree) {
          recalcWaitingQueue(updatedTechs, updatedJobs);
        }
      } catch (error) {
        console.error("Error cambiando estado de apoyo:", error);
        appendLog(`Error al cambiar estado de ${name}.`);
      }

      return;
    }

    alert(
      `${name} está asignado a ${currentJob.plate}.\n\nPrimero libera el técnico desde el trabajo.`
    );

    return;
  }

  const updated: Tech[] = techs.map((item) => {
    if (item.name !== name) return item;

    const baseTech: Tech = {
      ...item,
      currentJobId: isGoingUnavailable || isGoingHardBlocked ? null : item.currentJobId,
    };

    return updateTechStatusTotals(baseTech, nextStatus, changedAtMs);
  });

  setTechs(updated);

  const changed = updated.find((item) => item.name === name);

  if (changed) {
    try {
      await saveTechToBackend(changed);

      appendLog(`${name} cambia a estado: ${getTechStatusLabel(nextStatus)}.`);

      if (isGoingFree) {
        recalcWaitingQueue(updated, workingJobs);
      }
    } catch (error) {
      console.error("Error guardando estado del técnico:", error);
      appendLog(`Error guardando estado de ${name}.`);
    }
  }
}



async function resetAllSystem() {
  try {
    setResetError("");

    const response = await fetchWithTimeout(`${API_BASE}/api/reset`, {
  method: "POST",
  headers: getAdminHeaders({
    "Content-Type": "application/json",
  }),
  body: JSON.stringify({
    password: resetPassword,
  }),
});

    const data = await response.json();

    if (!response.ok) {
      setResetError(data?.error || "No se pudo reiniciar el sistema.");
      return;
    }

    setJobs([]);
    setLog([]);
    setNextJobId(1);
    setInitialAutoAssignDone(false);
    setResetPassword("");
    setResetConfirmOpen(false);

    const responseTechs = await fetchWithTimeout(`${API_BASE}/api/techs`);
    const techsData = await responseTechs.json();

    if (Array.isArray(techsData)) {
      const merged = INITIAL_TECHS.map((baseTech) => {
        const found = techsData.find((t: any) => t.name === baseTech.name);

        return found
  ? {
      ...baseTech,
      status: (found.status ?? baseTech.status) as TechStatus,
      blocked:
        isUnavailableTechStatus((found.status ?? baseTech.status) as TechStatus) ||
        !!found.blocked,
      currentJobId: found.currentJobId ?? null,
      competencies:
        found.competencies && Object.keys(found.competencies).length > 0
          ? found.competencies
          : baseTech.competencies,
      priorities:
        found.priorities && Object.keys(found.priorities).length > 0
          ? found.priorities
          : baseTech.priorities,
      avatar: found.avatar ?? baseTech.avatar ?? null,
      statusChangedAtMs:
        found.statusChangedAtMs ?? baseTech.statusChangedAtMs ?? nowMs(),
      statusTotals: found.statusTotals ?? baseTech.statusTotals ?? {},
    }
  : baseTech;
      });

      setTechs(merged);
    }

    appendLog("Sistema reiniciado manualmente por jefe.");
  } catch (error) {
    console.error("Error reiniciando sistema:", error);
    setResetError("Error de conexión al reiniciar.");
  }
}

function reassignJob(jobId: number, techName: string) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "activo") return;

  const tech = techs.find((item) => item.name === techName);
  if (!tech) return;

  if (hasAnyTechBlockedByOutsideMaintenance([techName])) {
    appendLog(
      `No se puede reasignar ${job.plate} a ${techName}: mantenimiento fuera de taller.`
    );
    return;
  }

  const previousAssignedNames = job.assignedNames ?? [];
  const previousResponsibleName = previousAssignedNames[0] ?? "";
  const previousSupportName = previousAssignedNames[1] ?? "";

  if (techName === previousResponsibleName) {
    appendLog(`${tech.name} ya es el responsable de ${job.plate}.`);
    return;
  }

  if (
    !canSelectTechManuallyForJob(
      tech,
      job,
      jobs,
      quickTemplates,
      "responsable"
    )
  ) {
    appendLog(
      `${tech.name} no se puede poner como responsable de ${job.plate}: no está disponible, está ocupado, bloqueado o reservado.`
    );

    alert(
      `${tech.name} no se puede poner como responsable.\n\nNo está disponible, está ocupado, bloqueado o reservado.`
    );

    return;
  }

  const canReuseAsSupport = canExtractSupportFromJob(tech, jobs);

  let cleanedJobs = [...jobs];

  // Si el nuevo responsable era apoyo en otro trabajo, se quita de allí.
  // Esto solo pasa por acción manual.
  if (canReuseAsSupport && tech.currentJobId != null) {
    cleanedJobs = removeSupportFromPreviousJob(tech, cleanedJobs);
  }

  // Liberar a los técnicos que estaban en este trabajo antes de reasignar.
  const releasedTechs: Tech[] = techs.map((item) => {
    if (previousAssignedNames.includes(item.name)) {
      return {
        ...item,
        status: "disponible" as TechStatus,
        currentJobId: null,
      };
    }

    if (item.name === techName && canReuseAsSupport) {
      return {
        ...item,
        status: normalizeTechStatus(tech.status),
        currentJobId: null,
      };
    }

    return item;
  });

  const reassignedNames = [techName];

  // Mantener el apoyo anterior solo si sigue siendo válido y no es el nuevo responsable.
  // No buscamos un apoyo nuevo automáticamente: eso se hace con el selector de apoyo.
  if (previousSupportName && previousSupportName !== techName) {
    const previousSupport = releasedTechs.find(
      (item) => item.name === previousSupportName
    );

    if (
      previousSupport &&
      canSelectTechManuallyForJob(
        previousSupport,
        job,
        cleanedJobs,
        quickTemplates,
        "apoyo"
      )
    ) {
      reassignedNames.push(previousSupportName);
    }
  }

  const updatedJobs: Job[] = cleanedJobs.map((item) =>
    item.id !== job.id
      ? item
      : {
          ...item,
          assignedNames: reassignedNames,
          reason:
            job.area === "camion"
              ? `Reasignación manual por Ramón. Responsable actual: ${techName}. Apoyo activo: ${
                  reassignedNames[1] || "ninguno"
                }.`
              : `Reasignación manual por Ramón. Responsable actual: ${reassignedNames.join(
                  " + "
                )}.`,
        }
  );

  const updatedJob = updatedJobs.find((item) => item.id === job.id) ?? job;

  const reassignedTechs = applyAssignmentToTechs(
    reassignedNames,
    updatedJob,
    releasedTechs
  );

  setTechs(reassignedTechs);
  setJobs(updatedJobs);

  for (const item of reassignedTechs) {
    saveTechToBackend(item);
  }

  saveJobToBackend(updatedJob);

  appendLog(
    `Ramón reasigna ${job.plate}: responsable ${techName}${
      reassignedNames[1] ? `, apoyo ${reassignedNames[1]}` : ", sin apoyo"
    }.`
  );

  // Después de reasignar, solo recalculamos propuestas.
  // No añadimos apoyos automáticos.
  recalcWaitingQueue(reassignedTechs, updatedJobs);
}
  
  function addTech() {
    const name = newTechName.trim();
    if (!name || techs.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      return;
    }
    setTechs((prev) => [...prev, { ...createTech(name), workshopId: selectedWorkshopId }]);
    setNewTechName("");
    appendLog(`Técnico añadido: ${name}.`);
  }
function changeSupportForJob(jobId: number, newSupportName: string) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "activo") return;

  const assignedNames = job.assignedNames ?? [];
  const responsibleName = assignedNames[0] ?? null;
  const currentSupportNames = assignedNames.slice(1);

  if (!responsibleName) {
    appendLog(`No se puede cambiar apoyo en ${job.plate}: no tiene responsable.`);
    return;
  }

  if (!newSupportName) return;

  if (newSupportName === responsibleName) {
    appendLog(`No se puede poner al responsable como apoyo en ${job.plate}.`);
    return;
  }

  const newSupport = techs.find((tech) => tech.name === newSupportName);
  if (!newSupport) return;

  if (hasAnyTechBlockedByOutsideMaintenance([newSupportName])) {
    appendLog(
      `No se puede poner apoyo ${newSupportName} en ${job.plate}: mantenimiento fuera de taller.`
    );
    return;
  }

  if (
    !canAssignTechManuallyToJob(
      newSupport,
      job,
      jobs,
      quickTemplates,
      "apoyo"
    )
  ) {
    appendLog(
      `${newSupport.name} no se puede poner como apoyo en ${job.plate}: no está disponible, ya está ocupado o no tiene competencia.`
    );
    return;
  }

  const previousSupportNames = currentSupportNames.filter(
    (name) => name !== newSupportName
  );

  const nextAssignedNames = [responsibleName, newSupportName];

  const updatedJob: Job = {
    ...job,
    assignedNames: nextAssignedNames,
    reason: `Apoyo cambiado manualmente. Responsable: ${responsibleName}. Apoyo: ${newSupportName}.`,
  };

  const updatedJobs: Job[] = jobs.map((item) =>
    item.id === jobId ? updatedJob : item
  );

  const updatedTechs: Tech[] = techs.map((tech) => {
    if (previousSupportNames.includes(tech.name)) {
      return {
        ...tech,
        status: isHardBlockedTechStatus(tech.status)
  ? tech.status
  : ("disponible" as TechStatus),
        currentJobId: null,
      };
    }

    if (tech.name === newSupportName) {
      return {
        ...tech,
        status: "refuerzo" as TechStatus,
        currentJobId: jobId,
      };
    }

    return tech;
  });

  setJobs(updatedJobs);
  setTechs(updatedTechs);

  saveJobToBackend(updatedJob);

  for (const tech of updatedTechs) {
    if (
      previousSupportNames.includes(tech.name) ||
      tech.name === newSupportName
    ) {
      saveTechToBackend(tech);
    }
  }

  appendLog(`Apoyo cambiado en ${job.plate}: ${newSupportName}.`);
}

function removeSupportFromJobManually(jobId: number) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "activo") return;

  const assignedNames = job.assignedNames ?? [];
  const responsibleName = assignedNames[0] ?? null;
  const supportNames = assignedNames.slice(1);

  if (!responsibleName) {
    appendLog(`No se puede quitar apoyo en ${job.plate}: no tiene responsable.`);
    return;
  }

  if (supportNames.length === 0) {
    appendLog(`El trabajo ${job.plate} no tiene apoyo asignado.`);
    return;
  }

  const updatedJob: Job = {
    ...job,
    assignedNames: [responsibleName],
    reason: `Apoyo quitado manualmente. Responsable: ${responsibleName}. Sin apoyo activo.`,
  };

  const updatedJobs: Job[] = jobs.map((item) =>
    item.id === jobId ? updatedJob : item
  );

  const updatedTechs: Tech[] = techs.map((tech) => {
    if (supportNames.includes(tech.name)) {
      return {
        ...tech,
        status: isHardBlockedTechStatus(tech.status)
  ? tech.status
  : ("disponible" as TechStatus),
        currentJobId: null,
      };
    }

    return tech;
  });

  setJobs(updatedJobs);
  setTechs(updatedTechs);

  saveJobToBackend(updatedJob);

  for (const tech of updatedTechs) {
    if (supportNames.includes(tech.name)) {
      saveTechToBackend(tech);
    }
  }

  appendLog(
    `Apoyo quitado en ${job.plate}: ${supportNames.join(
      " + "
    )} queda disponible.`
  );
}

function addSupportToJob(jobId: number, forcedSupportName?: string) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "activo") return;

  const assignedNames = job.assignedNames ?? [];

  if (assignedNames.length >= 2 && !forcedSupportName) {
    appendLog(`El trabajo ${job.plate} ya tiene apoyo asignado.`);
    return;
  }

  
  const candidates = techs
    .filter((tech) => canTechBeProposedForJob(tech))
    .filter((tech) => !isTechBlockedByOutsideMaintenance(tech.name));

  const support = forcedSupportName
    ? candidates.find((candidate) => candidate.name === forcedSupportName)
    : candidates[0];

  if (!support) {
    appendLog(`No hay apoyo disponible para ${job.plate}.`);
    alert("No hay apoyo disponible válido para este trabajo.");
    return;
  }

  if (hasAnyTechBlockedByOutsideMaintenance([support.name])) {
    appendLog(
      `No se puede añadir apoyo ${support.name} en ${job.plate}: mantenimiento fuera de taller.`
    );
    return;
  }

  const responsibleName = assignedNames[0];

  if (!responsibleName) {
    appendLog(`No se puede añadir apoyo a ${job.plate}: falta responsable.`);
    return;
  }

  const nextAssignedNames = [responsibleName, support.name];

  const updatedJob: Job = {
    ...job,
    assignedNames: nextAssignedNames,
    reason: assignedNames[1]
      ? `Apoyo cambiado manualmente: ${support.name}.`
      : `Apoyo añadido manualmente: ${support.name}.`,
  };

  const updatedJobs: Job[] = jobs.map((item) =>
    item.id === job.id ? updatedJob : item
  );

  const updatedTechs: Tech[] = techs.map((tech) => {
    if (tech.name === assignedNames[1] && tech.name !== support.name) {
      return {
        ...tech,
        status: "disponible" as TechStatus,
        currentJobId: null,
      };
    }

    if (tech.name === support.name) {
      return {
        ...tech,
        status: "refuerzo" as TechStatus,
        currentJobId: job.id,
      };
    }

    return tech;
  });

  setJobs(updatedJobs);
  setTechs(updatedTechs);

  const oldSupportName = assignedNames[1];

  appendLog(
    oldSupportName
      ? `Apoyo cambiado en ${job.plate}: ${oldSupportName} → ${support.name}.`
      : `Apoyo manual añadido en ${job.plate}: ${support.name}.`
  );

  try {
    saveJobToBackend(updatedJob);

    for (const tech of updatedTechs) {
      if (tech.name === support.name || tech.name === oldSupportName) {
        saveTechToBackend(tech);
      }
    }
  } catch (error) {
    console.error("Error cambiando apoyo:", error);
    appendLog(`Error al cambiar apoyo en ${job.plate}.`);
  }
}

function removeSupportFromActiveJob(jobId: number) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status !== "activo") return;

  const assignedNames = job.assignedNames ?? [];
  const responsibleName = assignedNames[0];
  const supportName = assignedNames[1];

  if (!responsibleName || !supportName) {
    appendLog(`El trabajo ${job.plate} no tiene apoyo para quitar.`);
    return;
  }

  const updatedJob: Job = {
    ...job,
    assignedNames: [responsibleName],
    reason: `Apoyo quitado manualmente. Responsable activo: ${responsibleName}.`,
  };

  const updatedJobs: Job[] = jobs.map((item) =>
    item.id === job.id ? updatedJob : item
  );

  const updatedTechs: Tech[] = techs.map((tech) =>
    tech.name === supportName
      ? {
          ...tech,
          status: "disponible" as TechStatus,
          currentJobId: null,
        }
      : tech
  );

  setJobs(updatedJobs);
  setTechs(updatedTechs);

  appendLog(`Apoyo quitado en ${job.plate}: ${supportName} queda disponible.`);

  try {
    saveJobToBackend(updatedJob);

    const releasedTech = updatedTechs.find((tech) => tech.name === supportName);
    if (releasedTech) {
      saveTechToBackend(releasedTech);
    }

    recalcWaitingQueue(updatedTechs, updatedJobs);
  } catch (error) {
    console.error("Error quitando apoyo:", error);
    appendLog(`Error al quitar apoyo en ${job.plate}.`);
  }
}

  function removeTech(name: string) {
    if (name === "Ramón") return;
    setTechs((prev) => prev.filter((t) => t.name !== name));
    appendLog(`Técnico eliminado: ${name}.`);
  }

function updateTechCompetency(
  name: string,
  key: CompetencyKey,
  role: AssignmentRole,
  value: boolean
) {
  setTechs((prev) => {
    const updated = prev.map((t) =>
      t.name === name
        ? {
            ...t,
            competencies: {
              ...t.competencies,
              [key]: { ...t.competencies[key], [role]: value },
            },
          }
        : t
    );

    const changed = updated.find((t) => t.name === name);
    if (changed) saveTechToBackend(changed);

    return updated;
  });
}

function updateTechPriority(
  name: string,
  area: AreaKey,
  role: AssignmentRole,
  value: number
) {
  const nextValue = Number.isFinite(value) && value > 0 ? value : 99;

  setTechs((prev) => {
    const updated = prev.map((t) =>
      t.name === name
        ? {
            ...t,
            priorities: {
              ...t.priorities,
              [area]: { ...t.priorities[area], [role]: nextValue },
            },
          }
        : t
    );

    const changed = updated.find((t) => t.name === name);
    if (changed) saveTechToBackend(changed);

    return updated;
  });
}


if (userRole === "tv75") {
  return (
    <WorkshopTV75View
      jobs={jobsForScreens}
      techs={visibleTechs}
      finishJob={finishJob}
      moveJobToStandBy={pauseJob}
      getOperationLabel={getOperationLabel}
      onBack={undefined}
      onLogout={() => {
        localStorage.removeItem("sea-authenticated");
        localStorage.removeItem("sea-admin-token");
        localStorage.removeItem("sea-role");

        setUserRole(null);
        setIsAuthenticated(false);
        setView("operativo");
      }}
    />
  );
}

if (view === "pantalla" && canAccessView(userRole, "pantalla")) {
  return (
    <WorkshopWallScreen
  jobs={visibleJobs}
  techs={visibleTechs}
  scheduledJobs={visibleScheduledJobs}
  quickTemplates={visibleQuickTemplates}
  onBack={() => setView("operativo")}
/>
  );
}


if (view === "operarios" && canAccessView(userRole, "operarios")) {
  return (
    <OperariosTVView
      jobs={jobsForScreens}
      techs={visibleTechs}
      finishJob={finishJob}
      moveJobToStandBy={pauseJob}
      getOperationLabel={getOperationLabel}
      onBack={() => {
        setView("operativo");
        void reloadMaintenanceAvailabilityFromBackend();
      }}
      onGoWorkshopScreen={() => setView("pantalla")}
      canGoBack={canAccessView(userRole, "operativo")}
      onLogout={() => {
        localStorage.removeItem("sea-authenticated");
        localStorage.removeItem("sea-admin-token");
        localStorage.removeItem("sea-role");

        setUserRole(null);
        setIsAuthenticated(false);
        setView("operativo");
      }}
      onSetWorkshopPin={isSupervisor ? (techName) => {
        setWorkshopPinModal({ techName });
        setWorkshopPinInput("");
        setWorkshopPinError("");
      } : undefined}
    />
  );
}
if (view === "workshop_tv_75" && canAccessView(userRole, "workshop_tv_75")) {
  return (
    <WorkshopTV75View
      jobs={jobsForScreens}
      techs={visibleTechs}
      finishJob={finishJob}
      moveJobToStandBy={pauseJob}
      getOperationLabel={getOperationLabel}
      onBack={
        canAccessView(userRole, "operativo")
          ? () => setView("operativo")
          : undefined
      }
      onLogout={() => {
        localStorage.removeItem("sea-authenticated");
        localStorage.removeItem("sea-admin-token");
        localStorage.removeItem("sea-role");

        setUserRole(null);
        setIsAuthenticated(false);
        setView("operativo");
      }}
    />
  );
}
if (view === "agenda" && canAccessView(userRole, "agenda")) {
  return (
    <AgendaView
  scheduledJobs={scheduledJobs}
  setScheduledJobs={setScheduledJobsAndSave}
  quickTemplates={visibleQuickTemplates}
  selectedWorkshopId={selectedWorkshopId}
  customExtraTasks={customExtraTasks}
  linkedTemplates={visibleLinkedTemplates}
  AREA_META={AREA_META}
  onBack={() => setView("operativo")}
  appendLog={appendLog}
  confirmScheduledArrival={confirmScheduledArrival}
  cancelScheduledJob={cancelScheduledJob}
  deleteScheduledJobFromBackend={deleteScheduledJobFromBackend}
  techs={visibleTechs}
  scheduledTechStatuses={scheduledTechStatuses}
  setScheduledTechStatuses={setScheduledTechStatuses}
  queueJobs={visibleJobs.filter((j) => j.status === "espera" || j.status === "validacion")}
/>
  );
}

if (view === "asistencias" && canAccessView(userRole, "asistencias")) {
  return (
    <RoadsideAssistanceView
      assistances={visibleRoadsideAssistances}
      techs={visibleRoadsideTechs}
      vehicles={visibleRoadsideVehicles}
      loading={roadsideAssistancesLoading}
      error={
        roadsideAssistanceError ||
        roadsideVehicleError
      }
      onBack={() => setView("operativo")}
      onRefresh={() => {
        void reloadRoadsideAssistancesFromBackend();
        void reloadRoadsideVehiclesFromBackend();
      }}
      onOpenSettings={
        isAdmin
          ? () => {
              setView("asistencias_config");
              void reloadRoadsideVehiclesFromBackend();
              void reloadRoadsideOperatorCodesFromBackend();
            }
          : undefined
      }
      onCreate={createRoadsideAssistance}
      onUpdate={updateRoadsideAssistance}
      onSendTrackingWhatsapp={sendRoadsideTrackingWhatsapp}
      onStatusChange={updateRoadsideAssistanceStatus}
    />
  );
}

if (
  view === "asistencias_config" &&
  canAccessView(userRole, "asistencias_config")
) {
  return (
    <RoadsideAssistanceAdminView
      techs={visibleTechs}
      vehicles={visibleRoadsideVehicles}
      operatorCodes={roadsideOperatorCodes}
      error={roadsideVehicleError || roadsideOperatorCodeError}
      onBack={() => setView("asistencias")}
      onRefresh={() => {
        void reloadRoadsideVehiclesFromBackend();
        void reloadRoadsideOperatorCodesFromBackend();
      }}
      onCreateVehicle={createRoadsideVehicle}
      onUpdateVehicle={updateRoadsideVehicle}
      onDeactivateVehicle={deactivateRoadsideVehicle}
      onUpdateOperatorCode={updateRoadsideOperatorCode}
      onDeleteOperatorCode={deleteRoadsideOperatorCode}
    />
  );
}

if (view === "ranking" && canAccessView(userRole, "ranking")) {
  return (
    <WorkRankingView
      jobs={visibleJobs}
      techs={visibleTechs}
      quickTemplates={visibleQuickTemplates}
      getOperationLabel={getOperationLabel}
      onBack={() => setView("operativo")}
    />
  );
}

if (view === "historico" && canAccessView(userRole, "historico")) {
  return (
    <FinishedAndCancelledJobsView
      jobs={visibleJobs}
      getOperationLabel={getOperationLabel}
      onBack={() => setView("operativo")}
    />
  );
}
if (!isAuthenticated) {
  return (
    <div className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto mt-24 max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2 text-xl font-semibold">
          Acceso SEA Tarragona
        </div>

        <p className="mb-5 text-sm text-slate-500">
          Introduce la contraseña para acceder al panel.
        </p>

        <input
          type="password"
          value={loginPassword}
          onChange={(e) => setLoginPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleLogin();
            }
          }}
          placeholder="Contraseña"
          className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
        />

        {loginError && (
          <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {loginError}
          </div>
        )}

        <button
          type="button"
          onClick={handleLogin}
          disabled={loginLoading}
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {loginLoading ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
}
return (
  <div className="min-h-screen bg-slate-50 px-2 py-6 text-slate-900">
    <div className="mx-auto w-full max-w-[98vw] space-y-6">
<div
  ref={stickyHeaderRef}
  className="sticky top-0 z-30 bg-slate-50 pb-3 pt-3"
>
  <div className="flex flex-col gap-3">
<div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg backdrop-blur md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <UserCog className="h-8 w-8" />
          <div>
<h1 className="text-2xl font-semibold">
  {selectedWorkshop.name} · Panel {APP_VERSION}
</h1>          <p className="text-sm text-slate-600">
  Pantalla dividida en Operativo y Ajustes
</p>

<div className="mt-1 text-xs text-slate-400">
  Sincronización automática cada 5 s
  {lastSyncAt && (
    <>
      {" "}
      · Última:{" "}
      {new Date(lastSyncAt).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}
    </>
  )}
</div>
          </div>
        </div>
<div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
  <label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">
    Taller actual
  </label>

  <select
    value={selectedWorkshopId}
    onChange={(event) =>
      setSelectedWorkshopId(normalizeWorkshopId(event.target.value))
    }
    className="min-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
  >
    {WORKSHOPS.filter((workshop) => workshop.active).map((workshop) => (
      <option key={workshop.id} value={workshop.id}>
        {workshop.name}
      </option>
    ))}
  </select>
</div>
       <div className="flex flex-wrap gap-2">
  {canAccessView(userRole, "operativo") && (
    <button
      type="button"
      onClick={() => {
        setView("operativo");
        void reloadMaintenanceAvailabilityFromBackend();
      }}
      className={`rounded-2xl px-4 py-2 text-sm font-medium ${
        view === "operativo"
          ? "bg-slate-900 text-white"
          : "border border-slate-200 bg-white text-slate-700"
      }`}
    >
      Operativo
    </button>
  )}

  {canAccessView(userRole, "operativo2") && (
    <button
      type="button"
      onClick={() => {
        setView("operativo2");
        void reloadMaintenanceAvailabilityFromBackend();
      }}
      className={`rounded-2xl px-4 py-2 text-sm font-medium ${
        view === "operativo2"
          ? "bg-slate-900 text-white"
          : "border border-slate-200 bg-white text-slate-700"
      }`}
    >
      Operativo 2
    </button>
  )}

  {canAccessView(userRole, "agenda") && (
    <button
  type="button"
  onClick={() => setView("agenda")}
  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
    view === "agenda"
      ? "border border-yellow-300 bg-yellow-200 text-yellow-950 shadow-sm"
      : "border border-yellow-200 bg-yellow-50 text-yellow-900 hover:bg-yellow-100"
  }`}
>
  Agenda
</button>


  )}

  {canAccessView(userRole, "asistencias") && (
    <button
      type="button"
      onClick={() => {
        setView("asistencias");
        void reloadRoadsideAssistancesFromBackend();
        void reloadRoadsideVehiclesFromBackend();
        void reloadRoadsideOperatorCodesFromBackend();
      }}
      className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
        view === "asistencias"
          ? "border border-red-300 bg-red-100 text-red-950 shadow-sm"
          : "border border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
      }`}
    >
      Asistencias
    </button>
  )}

  {canAccessView(userRole, "asistencias_config") && (
    <button
      type="button"
      onClick={() => {
        setView("asistencias_config");
        void reloadRoadsideVehiclesFromBackend();
        void reloadRoadsideOperatorCodesFromBackend();
      }}
      className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
        view === "asistencias_config"
          ? "border border-red-300 bg-red-100 text-red-950 shadow-sm"
          : "border border-red-200 bg-white text-red-800 hover:bg-red-50"
      }`}
    >
      Config. asistencia
    </button>
  )}

{canAccessView(userRole, "entradas") && (
  <button
    type="button"
    onClick={() => setView("entradas")}
    className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
      view === "entradas"
        ? "border border-yellow-300 bg-yellow-200 text-yellow-950 shadow-sm"
        : "border border-yellow-200 bg-yellow-50 text-yellow-900 hover:bg-yellow-100"
    }`}
  >
    Entradas rápidas
  </button>
)}

  <button
  type="button"
  onClick={() => {
    window.location.href = "/almacen-neumaticos";
  }}
  className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-gray-100"
>
  Almacén neumáticos
</button>

<button
  type="button"
  onClick={() => {
    window.location.href = "/cobros";
  }}
  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
>
  Cobros
</button>
{canAccessView(userRole, "ranking") && (
  <button
    type="button"
    onClick={() => setView("ranking")}
    className={`rounded-2xl px-4 py-2 text-sm font-medium ${
      view === "ranking"
        ? "bg-slate-900 text-white"
        : "border border-slate-200 bg-white text-slate-700"
    }`}
  >
    Ranking trabajos
  </button>
)}
  {canAccessView(userRole, "historico") && (
  <button
    type="button"
    onClick={() => setView("historico")}
    className={`rounded-2xl px-4 py-2 text-sm font-medium ${
      view === "historico"
        ? "bg-slate-900 text-white"
        : "border border-slate-200 bg-white text-slate-700"
    }`}
  >
    Histórico
  </button>
)}

  {userCanUseScreens && canAccessView(userRole, "operarios") && (
    <button
      type="button"
      onClick={() => {
        setView("operarios");
        void reloadMaintenanceAvailabilityFromBackend();
      }}
      className={`flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium ${
        view === "operarios"
          ? "bg-slate-900 text-white"
          : "border border-slate-200 bg-white text-slate-700"
      }`}
    >
      <span>Pantalla técnicos</span>

      {maintenanceAttentionCount > 0 && (
        <span
          title={`Mantenimiento: ${maintenanceSummaryCounts.workshop} en taller, ${maintenanceSummaryCounts.outside} fuera de taller, ${maintenanceSummaryCounts.interrupted} interrumpidas`}
          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
            maintenanceSummaryCounts.outside > 0
              ? "bg-red-100 text-red-700"
              : maintenanceSummaryCounts.interrupted > 0
              ? "bg-sky-100 text-sky-700"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {maintenanceAttentionCount}
        </span>
      )}
    </button>
  )}

  {canAccessView(userRole, "workshop_tv_75") && (
    <button
      type="button"
      onClick={() => setView("workshop_tv_75")}
      className={`rounded-2xl px-4 py-2 text-sm font-medium ${
        view === "workshop_tv_75"
          ? "bg-slate-900 text-white"
          : "border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
      }`}
    >
      Pantalla taller TV 75"
    </button>
  )}

  {userCanUseScreens && canAccessView(userRole, "pantalla") && (
    <button
      type="button"
      onClick={() => setView("pantalla")}
      className={`rounded-2xl px-4 py-2 text-sm font-medium ${
        view === "pantalla"
          ? "bg-slate-900 text-white"
          : "border border-slate-200 bg-white text-slate-700"
      }`}
    >
      Pantalla taller
    </button>
  )}

  {canAccessView(userRole, "ajustes") && (
    <button
      type="button"
      onClick={() => setView("ajustes")}
      className={`rounded-2xl px-4 py-2 text-sm font-medium ${
        view === "ajustes"
          ? "bg-slate-900 text-white"
          : "border border-slate-200 bg-white text-slate-700"
      }`}
    >
      Ajustes
    </button>
  )}

  <button
    type="button"
    onClick={() => {
      localStorage.removeItem("sea-authenticated");
      localStorage.removeItem("sea-admin-token");
      localStorage.removeItem("sea-role");

      setUserRole(null);
      setIsAuthenticated(false);
      setView("operativo");
    }}
    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
  >
    Salir
  </button>
</div>
      </div>

      {(view === "operativo" || view === "operativo2") && (
  <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wide text-red-800">
            Técnicos trabajando
          </h2>

          <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-black text-red-700">
            {workingTechsSummary.length}
          </span>
        </div>

        {workingTechsSummary.length === 0 ? (
          <div className="rounded-xl bg-white px-3 py-3 text-sm font-medium text-red-400">
            Ningún técnico trabajando ahora.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {workingTechsSummary.map((tech) => {
              const job = visibleJobs.find((item) => item.id === tech.currentJobId);

              return (
                <div
                  key={`working-summary-${tech.name}`}
                  className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm"
                >
                  <div className="font-black text-red-900">
                    {tech.name}
                  </div>


                  {job && (
                    <div className="mt-0.5 text-xs font-medium text-red-600">
                      {job.customerName?.trim() ? (
                        <div>{job.customerName}</div>
                      ) : null}

                      <div>
                        {job.plate} · {getOperationLabel(job)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wide text-emerald-800">
              Técnicos disponibles
            </h2>



            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold hidden">
              <span
                className={
                  maintenanceAvailabilitySyncError
                    ? "text-red-600"
                    : autoSyncPaused || maintenanceAvailabilityIsStale
                    ? "text-amber-600"
                    : "text-emerald-600"
                }
              >
                Mant.:{" "}
                {autoSyncPaused
                  ? `Pausado ${formatMaintenanceSyncTime(
                      maintenanceAvailabilitySyncedAt
                    )}`
                  : maintenanceAvailabilitySyncError
                  ? "Error"
                  : maintenanceAvailabilityIsStale
                  ? `Desactualizado ${formatMaintenanceSyncTime(
                      maintenanceAvailabilitySyncedAt
                    )}`
                  : `OK ${formatMaintenanceSyncTime(
                      maintenanceAvailabilitySyncedAt
                    )}`}
              </span>

              {!autoSyncPaused &&
                (maintenanceAvailabilitySyncError ||
                  maintenanceAvailabilityIsStale) && (
                  <button
                    type="button"
                    onClick={() => {
                      void reloadMaintenanceAvailabilityFromBackend();
                    }}
                    className={`rounded-lg border bg-white px-2 py-1 text-[10px] font-black hover:bg-slate-50 ${
                      maintenanceAvailabilitySyncError
                        ? "border-red-200 text-red-700 hover:bg-red-50"
                        : "border-amber-200 text-amber-700 hover:bg-amber-50"
                    }`}
                  >
                    Reintentar
                  </button>
                )}
            </div>
          </div>

          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-black text-emerald-700">
            {availableTechsSummary.length}
          </span>
        </div>

        {false && (maintenanceSummaryCounts.workshop > 0 ||
          maintenanceSummaryCounts.outside > 0 ||
          maintenanceSummaryCounts.interrupted > 0) && (
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-emerald-700">
                Mant. en taller
              </div>
              <div className="text-2xl font-black text-emerald-900">
                {maintenanceSummaryCounts.workshop}
              </div>
              <div className="text-[11px] font-semibold text-emerald-700">
                No bloquea trabajos
              </div>
            </div>

            <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-red-700">
                Fuera taller
              </div>
              <div className="text-2xl font-black text-red-900">
                {maintenanceSummaryCounts.outside}
              </div>
              <div className="text-[11px] font-semibold text-red-700">
                Bloquea trabajos
              </div>
            </div>

            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-sky-700">
                Interrumpidas
              </div>

              <div className="text-2xl font-black text-sky-900">
                {maintenanceSummaryCounts.interrupted}
              </div>

              <div className="mb-2 text-[11px] font-semibold text-sky-700">
                Pendientes revisar
              </div>

              {oldInterruptedMaintenanceSummary.length > 0 ? (
                <div className="grid gap-2">
                  <div className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-[11px] font-bold text-sky-700">
                    {oldInterruptedMaintenanceSummary.length} antigua(s) se
                    pueden limpiar
                  </div>

                  <button
                    type="button"
                    onClick={clearMaintenanceHistoryFromPanel}
                    className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-[11px] font-black text-sky-700 hover:bg-sky-100"
                  >
                    Limpiar antiguas
                  </button>
                </div>
              ) : (
                maintenanceSummaryCounts.interrupted > 0 && (
                  <div className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-[11px] font-bold text-sky-700">
                    Todas son recientes
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {availableTechsSummary.length === 0 ? (
          <div className="rounded-xl bg-white px-3 py-3 text-sm font-medium text-emerald-400">
            No hay técnicos disponibles.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
{availableTechsSummary.map((tech) => (
  <div
    key={`available-summary-${tech.name}`}
    className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-black text-emerald-900"
  >
    {tech.name}
  </div>
))}
          </div>
        )}

        {false && outsideMaintenanceTechsSummary.length > 0 && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-red-700">
                  Fuera de taller por mantenimiento
                </div>
                <div className="text-xs font-semibold text-red-600">
                  No disponibles para trabajos reales
                </div>
              </div>

              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-700">
                {outsideMaintenanceTechsSummary.length}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {outsideMaintenanceTechsSummary.map((tech) => {
                const task = maintenanceAvailability.outsideWorkshopTasks.find(
                  (item) => item.techName === tech.name
                );

                return (
                  <span
                    key={tech.name}
                    className="rounded-full border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-700"
                  >
                    {tech.name}
                    {task ? ` · ${task.taskLabel}` : ""}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {false && workshopMaintenanceTechsSummary.length > 0 && (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-emerald-700">
                  En mantenimiento en taller
                </div>
                <div className="text-xs font-semibold text-emerald-600">
                  Siguen disponibles para trabajos reales
                </div>
              </div>

              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                {workshopMaintenanceTechsSummary.length}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {workshopMaintenanceTechsSummary.map((tech) => {
                const task = maintenanceAvailability.workshopTasks.find(
                  (item) => item.techName === tech.name
                );

                return (
                  <span
                    key={tech.name}
                    className="rounded-full border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700"
                  >
                    {tech.name}
                    {task ? ` · ${task.taskLabel}` : ""}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {false && interruptedMaintenanceSummary.length > 0 && (
          <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-sky-700">
                  Mantenimiento interrumpido
                </div>
                <div className="text-xs font-semibold text-sky-600">
                  Interrumpidas recientemente. Revisar en Pantalla técnicos
                </div>
              </div>

              <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-black text-sky-700">
                {interruptedMaintenanceSummary.length}
              </span>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {interruptedMaintenanceSummary.slice(0, 4).map((task) => (
                <span
                  key={task.id}
                  className="rounded-full border border-sky-200 bg-white px-3 py-2 text-xs font-black text-sky-700"
                >
                  {task.techName} · {task.taskLabel}
                </span>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setView("operarios");
                void reloadMaintenanceAvailabilityFromBackend();
              }}
              className="rounded-xl bg-sky-700 px-4 py-2 text-xs font-black text-white hover:bg-sky-800"
            >
              Ir a Pantalla técnicos
            </button>
          </div>
        )}
      </div>
    </div>
  </section>
)}
    <div
  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
>
  <div className="mb-3 flex items-center justify-between gap-3">
    <div className="text-sm font-medium text-slate-700">
      Entradas rápidas
    </div>

    <div className="text-xs text-slate-400">
  Selecciona pictograma y trabajo
</div>
  </div>

  {view === "entradas" && isSupervisor && (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 text-sm font-medium text-slate-700">
        Crear entrada rápida
      </div>

      <div className="grid gap-4 md:grid-cols-4">
  <input
    value={newQuickTemplate.label}
    onChange={(e) =>
      setNewQuickTemplate((p) => ({
        ...p,
        label: e.target.value,
      }))
    }
    placeholder="Nombre entrada rápida"
    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
  />


  <select
    value={newQuickTemplate.area}
    onChange={(e) =>
      setNewQuickTemplate((p) => ({
        ...p,
        area: e.target.value as AreaKey,
      }))
    }
    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
  >
    {Object.entries(AREA_META).map(([key, meta]) => (
      <option key={key} value={key}>
        {meta.label}
      </option>
    ))}
  </select>

  <select
    value={newQuickTemplate.mode}
    onChange={(e) =>
      setNewQuickTemplate((p) => ({
        ...p,
        mode: e.target.value as QuickEntryMode,
      }))
    }
    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
  >
    <option value="single">1 técnico</option>
    <option value="team">técnico + refuerzo</option>
  </select>
</div>

      <QuickTemplateV2Fields
  draft={newQuickTemplate}
  setDraft={setNewQuickTemplate}
/>

<div className="mt-4">
  <div className="mb-2 text-sm font-medium text-slate-700">
    Técnicos capacitados
  </div>
        <div className="grid gap-2 md:grid-cols-3">
          {visibleTechs.map((tech) => {
              const checked = newQuickTemplate.allowedTechs.includes(
                tech.name
              );

              return (
                <label
                  key={`allowed-${tech.name}`}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const nextAllowed = e.target.checked
                        ? [...newQuickTemplate.allowedTechs, tech.name]
                        : newQuickTemplate.allowedTechs.filter(
                            (name) => name !== tech.name
                          );

                      setNewQuickTemplate((prev) => {
                        const filteredPriority = prev.priorityOrder.filter(
                          (name) => nextAllowed.includes(name)
                        );

                        const missing = nextAllowed.filter(
                          (name) => !filteredPriority.includes(name)
                        );

                        return {
                          ...prev,
                          allowedTechs: nextAllowed,
                          priorityOrder: [...filteredPriority, ...missing],
                        };
                      });
                    }}
                  />
                  <span>{tech.name}</span>
                </label>
              );
            })}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-sm font-medium text-slate-700">
          Orden de prioridad
        </div>

        <div className="space-y-2">
          {newQuickTemplate.allowedTechs.length === 0 ? (
            <div className="text-sm text-slate-500">
              Si no marcas ningún técnico, se usarán las reglas generales del programa.
            </div>
          ) : (
            (
              newQuickTemplate.priorityOrder.length > 0
                ? newQuickTemplate.priorityOrder
                : newQuickTemplate.allowedTechs
            ).map((techName, index) => {
              const priorityOrder =
                newQuickTemplate.priorityOrder.length > 0
                  ? newQuickTemplate.priorityOrder
                  : newQuickTemplate.allowedTechs;

              return (
                <div
                  key={`priority-${techName}`}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <span>
                    {index + 1}. {techName}
                    {(() => {
                      const simulatedTemplate: QuickTemplate = {
                        key: "preview",
                        label:
                          newQuickTemplate.label || "Nueva entrada rápida",
                        area: newQuickTemplate.area,
                        mode: newQuickTemplate.mode,
                        allowedTechs: newQuickTemplate.allowedTechs,
                        priorityOrder:
                          newQuickTemplate.priorityOrder.length > 0
                            ? newQuickTemplate.priorityOrder
                            : newQuickTemplate.allowedTechs,
                      };

                      const recommended = getRecommendedTechForJob(
                        {
                          area: simulatedTemplate.area,
                          template: null,
                          quickEntryLabel: simulatedTemplate.label,
                        },
                        techs,
                        [simulatedTemplate, ...quickTemplates],
                        techOperationStats
                      );

                      return recommended === techName ? (
                        <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                          IA
                        </span>
                      ) : null;
                    })()}
                  </span>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const arr = [...priorityOrder];
                        const currentIndex = arr.indexOf(techName);
                        if (currentIndex <= 0) return;

                        [arr[currentIndex - 1], arr[currentIndex]] = [
                          arr[currentIndex],
                          arr[currentIndex - 1],
                        ];

                        setNewQuickTemplate((prev) => ({
                          ...prev,
                          priorityOrder: arr,
                        }));
                      }}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const arr = [...priorityOrder];
                        const currentIndex = arr.indexOf(techName);

                        if (
                          currentIndex === -1 ||
                          currentIndex >= arr.length - 1
                        ) {
                          return;
                        }

                        [arr[currentIndex], arr[currentIndex + 1]] = [
                          arr[currentIndex + 1],
                          arr[currentIndex],
                        ];

                        setNewQuickTemplate((prev) => ({
                          ...prev,
                          priorityOrder: arr,
                        }));
                      }}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={addQuickTemplate}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
        >
          Añadir entrada rápida
        </button>
      </div>
    </div>
  )}

 {view === "entradas" && (
  <div className="mb-5 rounded-2xl border border-violet-200 bg-violet-50 p-4">
    <div className="mb-3">
      <div className="text-sm font-semibold text-violet-900">
        Crear plantilla vinculada
      </div>
      <div className="mt-1 text-xs text-violet-700">
        Crea una entrada rápida compuesta: el segundo trabajo queda bloqueado hasta finalizar el primero.
      </div>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-violet-700">
          1º trabajo
        </label>

        <select
          value={linkedTemplateDraft.firstTemplateKey}
          onChange={(e) =>
            setLinkedTemplateDraft((prev) => ({
              ...prev,
              firstTemplateKey: e.target.value,
            }))
          }
          className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm"
        >
          {quickTemplates.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-violet-700">
          2º trabajo bloqueado
        </label>

        <select
          value={linkedTemplateDraft.secondTemplateKey}
          onChange={(e) =>
            setLinkedTemplateDraft((prev) => ({
              ...prev,
              secondTemplateKey: e.target.value,
            }))
          }
          className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm"
        >
          {quickTemplates.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
        </select>
      </div>
    </div>

    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
      <input
        value={linkedTemplateDraft.label}
        onChange={(e) =>
          setLinkedTemplateDraft((prev) => ({
            ...prev,
            label: e.target.value,
          }))
        }
        placeholder="Nombre opcional. Ej: Neumáticos dirección → Alineación"
        className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm"
      />

      <button
        type="button"
        onClick={addLinkedTemplate}
        disabled={quickTemplates.length < 2}
        className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-40"
      >
        Guardar vinculada
      </button>
    </div>

    {linkedTemplates.length > 0 && (
      <div className="mt-4 space-y-2">
        <div className="text-xs font-medium text-violet-700">
          Plantillas vinculadas guardadas
        </div>

        {linkedTemplates.map((template) => (
          <div
            key={template.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm"
          >
            <span className="font-medium text-violet-900">
              {template.label}
            </span>

            <button
              type="button"
              onClick={() => removeLinkedTemplate(template.id)}
              className="text-xs font-medium text-red-600 hover:text-red-700"
            >
              Eliminar
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
)}

<div className="space-y-4">
<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
  {(["camion", "movil", "tacografo", "turismo", "mecanica"] as AreaKey[]).map(
    (area) => {
      const areaTemplates = quickTemplates.filter(
        (template) => template.area === area
      );

      const areaLinkedTemplates = linkedTemplates.filter((linked) => {
        const firstTemplate = quickTemplates.find(
          (template) => template.key === linked.firstTemplateKey
        );

        return firstTemplate?.area === area;
      });

      const meta = AREA_META[area];
      const Icon = meta.icon;
      const active = quickSelectedMode === "quick" && quickSelectedArea === area;
      const totalEntries = areaTemplates.length + areaLinkedTemplates.length;

      return (
        <button
          key={`quick-icon-${area}`}
          type="button"
          onClick={() => {
            setQuickSelectedMode("quick");
            setQuickSelectedArea(area);

            const firstLinked = [...areaLinkedTemplates].sort((a, b) =>
              a.label.localeCompare(b.label, "es", {
                sensitivity: "base",
              })
            )[0];

            const firstTemplate = [...areaTemplates].sort((a, b) =>
              a.label.localeCompare(b.label, "es", {
                sensitivity: "base",
              })
            )[0];

            if (firstLinked) {
              setQuickDraft((prev) => ({
                ...prev,
                templateKey: firstLinked.firstTemplateKey,
                linkedTemplateKey: firstLinked.secondTemplateKey,
                includedTaskIds: [],
              }));

              return;
            }

            setQuickDraft((prev) => ({
              ...prev,
              templateKey: firstTemplate?.key ?? "",
              linkedTemplateKey: "",
              includedTaskIds: [],
            }));
          }}
          className={`rounded-2xl border px-3 py-3 text-xs font-semibold transition ${meta.color} ${
            active
              ? "ring-2 ring-slate-900 ring-offset-2"
              : "opacity-80 hover:opacity-100"
          }`}
          title={meta.label}
        >
          <Icon className="mx-auto mb-1 h-6 w-6" />

          <span className="block truncate text-[11px] font-bold">
            {meta.label}
          </span>

          <span className="mt-1 block text-[10px] font-medium opacity-70">
            {totalEntries} entradas
          </span>
        </button>
      );
    }
  )}

  <button
    key="quick-icon-maintenance"
    type="button"
    onClick={() => setQuickSelectedMode("maintenance")}
    className={`rounded-2xl border px-3 py-3 text-xs font-semibold transition ${
      quickSelectedMode === "maintenance"
        ? "border-amber-300 bg-amber-100 text-amber-950 ring-2 ring-slate-900 ring-offset-2"
        : "border-amber-200 bg-amber-50 text-amber-900 opacity-80 hover:opacity-100"
    }`}
    title="Mantenimiento"
  >
    <ShieldAlert className="mx-auto mb-1 h-6 w-6" />

    <span className="block truncate text-[11px] font-bold">
      Mantenimiento
    </span>

    <span className="mt-1 block text-[10px] font-medium opacity-70">
      {maintenanceTasks.length} tareas
    </span>
  </button>
</div>

  {quickSelectedMode === "maintenance" && (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="h-4 w-4" />
          Mantenimiento
        </div>

        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] uppercase opacity-80">
          {maintenanceTasks.length} tareas
        </span>
      </div>

      {maintenanceTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-200 bg-white/60 px-3 py-2 text-xs text-amber-700">
          No hay tareas de mantenimiento cargadas.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <select
            value={maintenanceDraft.techName}
            onChange={(event) =>
              setMaintenanceDraft((prev) => ({
                ...prev,
                techName: event.target.value,
              }))
            }
            className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm"
          >
            {maintenanceTechCandidates.length === 0 ? (
              <option value="">Sin técnicos libres</option>
            ) : (
              maintenanceTechCandidates.map((tech) => (
                <option key={`maintenance-tech-${tech.name}`} value={tech.name}>
                  {tech.name}
                </option>
              ))
            )}
          </select>

          <select
            value={maintenanceDraft.taskId}
            onChange={(event) =>
              setMaintenanceDraft((prev) => ({
                ...prev,
                taskId: event.target.value,
              }))
            }
            className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm"
          >
            {maintenanceTasks
              .slice()
              .sort((a, b) => {
                if (a.type !== b.type) {
                  return a.type === "fuera_taller" ? -1 : 1;
                }

                return a.label.localeCompare(b.label, "es", {
                  sensitivity: "base",
                });
              })
              .map((task) => (
                <option key={task.id} value={task.id}>
                  {task.type === "fuera_taller" ? "Fuera taller" : "En taller"} ·{" "}
                  {task.label}
                </option>
              ))}
          </select>

          <button
            type="button"
            onClick={() => {
              void assignQuickMaintenanceTask();
            }}
            disabled={!maintenanceDraft.techName || !maintenanceDraft.taskId}
            className="rounded-2xl bg-amber-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            Asignar mantenimiento
          </button>
        </div>
      )}

      <div className="mt-3 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-xs font-semibold text-amber-800">
        En taller: no bloquea trabajos reales · Fuera taller: bloquea trabajos reales.
      </div>

      {/* ── Gestionar tareas de mantenimiento ── */}
      <div className="mt-4 rounded-2xl border border-amber-300 bg-white p-4">
        <div className="mb-3 text-sm font-bold text-amber-900">
          {maintTaskEditing ? "✏️ Editar tarea" : "➕ Nueva tarea de mantenimiento"}
        </div>

        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={maintTaskForm.label}
            onChange={(e) => setMaintTaskForm((p) => ({ ...p, label: e.target.value }))}
            placeholder="Ej: Cambio de aceite, Revisión frenos..."
            className="flex-1 min-w-0 rounded-xl border border-amber-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-300"
          />
          <select
            value={maintTaskForm.type}
            onChange={(e) => setMaintTaskForm((p) => ({ ...p, type: e.target.value as "en_taller" | "fuera_taller" }))}
            className="rounded-xl border border-amber-200 px-3 py-2 text-sm bg-white"
          >
            <option value="en_taller">En taller</option>
            <option value="fuera_taller">Fuera taller</option>
          </select>
          <button
            type="button"
            disabled={!maintTaskForm.label.trim() || maintTaskSaving}
            onClick={() => { void saveMaintTask(); }}
            className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-amber-800"
          >
            {maintTaskSaving ? "..." : maintTaskEditing ? "Guardar" : "Añadir"}
          </button>
          {maintTaskEditing && (
            <button
              type="button"
              onClick={() => { setMaintTaskEditing(null); setMaintTaskForm({ label: "", type: "en_taller" }); }}
              className="rounded-xl border border-amber-200 px-4 py-2 text-sm text-amber-700 hover:bg-amber-50"
            >
              Cancelar
            </button>
          )}
        </div>

        {maintenanceTasks.length > 0 && (
          <div className="mt-3 space-y-1">
            {maintenanceTasks
              .slice()
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === "fuera_taller" ? -1 : 1;
                return a.label.localeCompare(b.label, "es", { sensitivity: "base" });
              })
              .map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2"
                >
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${task.type === "fuera_taller" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                    {task.type === "fuera_taller" ? "Fuera" : "Taller"}
                  </span>
                  <span className="flex-1 text-sm text-slate-800">{task.label}</span>
                  <button
                    type="button"
                    onClick={() => { setMaintTaskEditing(task.id); setMaintTaskForm({ label: task.label, type: task.type }); }}
                    className="text-xs text-amber-700 hover:text-amber-900"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => { void deleteMaintTask(task.id); }}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )}

  {quickSelectedMode === "quick" && (() => {
    const areaMeta = AREA_META[quickSelectedArea];
    const Icon = areaMeta.icon;

    const templatesForArea = quickTemplates
      .filter((template) => template.area === quickSelectedArea)
      .slice()
      .sort((a, b) =>
        a.label.localeCompare(b.label, "es", {
          sensitivity: "base",
        })
      );

    const linkedTemplatesForArea = linkedTemplates
      .filter((linked) => {
        const firstTemplate = quickTemplates.find(
          (template) => template.key === linked.firstTemplateKey
        );

        return firstTemplate?.area === quickSelectedArea;
      })
      .slice()
      .sort((a, b) =>
        a.label.localeCompare(b.label, "es", {
          sensitivity: "base",
        })
      );

    const totalEntries = templatesForArea.length + linkedTemplatesForArea.length;

    const selectedValue = quickDraft.linkedTemplateKey
      ? `${quickDraft.templateKey}|||${quickDraft.linkedTemplateKey}`
      : quickDraft.templateKey;

    return (
      <div className={`rounded-2xl border p-3 ${areaMeta.color}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4" />
            {areaMeta.label}
          </div>

          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] uppercase opacity-80">
            {totalEntries} entradas
          </span>
        </div>

        {totalEntries === 0 ? (
          <div className="rounded-xl border border-dashed border-white/70 bg-white/50 px-3 py-2 text-xs opacity-70">
            Sin entradas rápidas para {areaMeta.label}.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <select
              value={selectedValue}
              onChange={(e) => {
                const [templateKey, linkedTemplateKey] =
                  e.target.value.split("|||");

                setQuickDraft((prev) => ({
                  ...prev,
                  templateKey,
                  linkedTemplateKey: linkedTemplateKey || "",
                }));
              }}
              className="w-full rounded-2xl border border-white/70 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm"
            >
              {linkedTemplatesForArea.length > 0 && (
                <optgroup label="Trabajos vinculados">
                  {linkedTemplatesForArea.map((linked) => (
                    <option
                      key={linked.id}
                      value={`${linked.firstTemplateKey}|||${linked.secondTemplateKey}`}
                    >
                      {linked.label}
                    </option>
                  ))}
                </optgroup>
              )}

              {templatesForArea.length > 0 && (
                <optgroup label="Entradas rápidas">
                  {templatesForArea.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <button
              type="button"
              onClick={() => {
                if (!quickDraft.templateKey) return;
                setQuickEntryOpen(true);
              }}
              disabled={!quickDraft.templateKey}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              Crear entrada
            </button>
          </div>
        )}
{view === "entradas" && templatesForArea.length > 0 && (
  <div className="mt-3 flex flex-wrap gap-2">
    {templatesForArea.map((template) => (
      <div
        key={`quick-admin-actions-${template.key}`}
        className="flex items-center gap-2 rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-xs text-slate-700"
      >
        <span className="font-medium">{template.label}</span>

        <button
          type="button"
          onClick={() =>
            setEditingQuickTemplateKey(
              editingQuickTemplateKey === template.key
                ? null
                : template.key
            )
          }
          className="font-medium text-blue-600 hover:text-blue-700"
        >
          Editar
        </button>

        <button
          type="button"
          onClick={() => removeQuickTemplate(template.key)}
          className="font-medium text-red-600 hover:text-red-700"
        >
          Eliminar
        </button>
      </div>
    ))}
  </div>
)}


          {view === "entradas" &&
  templatesForArea
    .filter((template) => editingQuickTemplateKey === template.key)
            .map((template) => (
              <div
                key={`editor-${template.key}`}
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white p-4 text-slate-900"
              >
                <div className="mb-3 text-sm font-medium text-slate-700">
                  Editar entrada rápida
                </div>

                <QuickTemplateEditor
                  template={template}
                  techs={techs}
                  onSave={updateQuickTemplate}
                />
              </div>
            ))}
      </div>
    );
  })()}
</div>
{view === "entradas" && isSupervisor && (
  <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
    <div className="mb-3">
      <div className="text-sm font-semibold text-emerald-900">
        Crear tarea extra seleccionable
      </div>

      <div className="mt-1 text-xs text-emerald-700">
        Estas tareas aparecerán como opciones para añadir al mismo trabajo.
      </div>
    </div>

    <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
      <input
        value={newCustomExtraTask.label}
        onChange={(e) =>
          setNewCustomExtraTask((prev) => ({
            ...prev,
            label: e.target.value,
          }))
        }
        placeholder="Ej: 2 equilibrados, Cambiar válvula, Revisar presión"
        className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm"
      />

      <select
        value={newCustomExtraTask.area}
        onChange={(e) =>
          setNewCustomExtraTask((prev) => ({
            ...prev,
            area: e.target.value as AreaKey,
          }))
        }
        className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm"
      >
        {Object.entries(AREA_META).map(([key, meta]) => (
          <option key={key} value={key}>
            {meta.label}
          </option>
        ))}
      </select>

      <CustomExtraTaskV2Fields
  draft={newCustomExtraTask}
  setDraft={setNewCustomExtraTask}
/>

      <button
        type="button"
        onClick={addCustomExtraTask}
        disabled={!newCustomExtraTask.label.trim()}
        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Añadir tarea
      </button>
    </div>

    {customExtraTasks.length > 0 && (
      <div className="mt-4 space-y-2">
        <div className="text-xs font-medium text-emerald-700">
          Tareas extra guardadas
        </div>

        <div className="flex flex-wrap gap-2">
          {customExtraTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs"
            >
              <span className="font-medium text-emerald-900">
                {AREA_META[task.area].label} · {task.label}
              </span>

              {task.standardMinutes != null && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  {task.standardMinutes} min
                </span>
              )}

              <button
                type="button"
                onClick={() => removeCustomExtraTask(task.id)}
                className="font-medium text-red-600 hover:text-red-700"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}

</div>
  </div>
</div>

      {view === "ajustes" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-slate-700">
              Reglas del sistema
            </div>
           {isAdmin && (
  <button
    onClick={() => {
      setResetError("");
      setResetPassword("");
      setResetConfirmOpen(true);
    }}
    className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
  >
    Reiniciar jornada
  </button>
)}
          </div>

          <div className="space-y-2">
            {rules.map((rule, i) => (
              <div key={`${rule}-${i}`} className="flex items-center gap-2">
                <input
                  value={rule}
                  onChange={(e) => {
                    const updated = [...rules];
                    updated[i] = e.target.value;
                    setRules(updated);
                  }}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => setRules(rules.filter((_, idx) => idx !== i))}
                  className="text-xs text-red-600"
                >
                  X
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="Nueva regla"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              onClick={() => {
                if (!newRule.trim()) return;
                setRules([...rules, newRule.trim()]);
                setNewRule("");
              }}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            >
              Añadir
            </button>
          </div>
        </div>
      )}

      {view === "ajustes" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 text-sm font-medium text-slate-700">
            Informe de tiempos por operación
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-3">Operación</th>
                  <th className="py-2 pr-3">Realizadas</th>
                  <th className="py-2 pr-3">Última</th>
                  <th className="py-2">Media prevista</th>
                </tr>
              </thead>
              <tbody>
                {operationReport.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-sm text-slate-500">
                      Todavía no hay trabajos cerrados con duración registrada.
                    </td>
                  </tr>
                ) : (
                  operationReport.map((item) => (
                    <tr key={item.key} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-medium">{item.label}</td>
                      <td className="py-2 pr-3">{item.count}</td>
                      <td className="py-2 pr-3">
                        {formatMinutes(item.lastMinutes)}
                      </td>
                      <td className="py-2 font-semibold">
                        {formatMinutes(item.averageMinutes)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

            {view === "ajustes" && isAdmin && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-800">
            Copia de seguridad
          </div>

          <p className="mb-4 text-sm text-slate-500">
            Descarga un archivo JSON con técnicos, trabajos, logs, reglas y entradas rápidas.
          </p>

          <button
            type="button"
            onClick={downloadBackup}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
          >
            Descargar backup
          </button>
        </div>
      )}
      {view === "ajustes" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 text-sm font-medium text-slate-700">
            Horas invertidas por técnico
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-3">Técnico</th>
                  <th className="py-2 pr-3">Resp. día</th>
                  <th className="py-2 pr-3">Resp. semana</th>
                  <th className="py-2 pr-3">Resp. mes</th>
                  <th className="py-2 pr-3">Apoyo día</th>
                  <th className="py-2 pr-3">Apoyo semana</th>
                  <th className="py-2">Apoyo mes</th>
                </tr>
              </thead>
              <tbody>
                {techHoursReport.map((item) => (
                  <tr key={item.name} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-medium">{item.name}</td>
                    <td className="py-2 pr-3">
                      {formatMinutes(item.responsable.daily)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatMinutes(item.responsable.weekly)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatMinutes(item.responsable.monthly)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatMinutes(item.apoyo.daily)}
                    </td>
                    <td className="py-2 pr-3">
                      {formatMinutes(item.apoyo.weekly)}
                    </td>
                    <td className="py-2">
                      {formatMinutes(item.apoyo.monthly)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "ajustes" && (
  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 text-sm font-medium text-slate-700">
      IA de tiempos reales
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 p-4">
        <div className="mb-3 text-sm font-medium text-slate-700">
          Ranking IA por operación
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <div className="mb-2 font-medium">Alineación</div>
            <div className="space-y-2">
              {aiRanking.alineacion.length === 0 ? (
                <div className="text-slate-500">Sin datos todavía.</div>
              ) : (
                aiRanking.alineacion.map((item, index) => (
                  <div
                    key={`ia-alineacion-${item.techName}-${index}`}
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  >
                    {index + 1}. {item.techName} · {formatMinutes(item.averageMinutes)} de media · {item.count} trabajos
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 font-medium">Móvil</div>
            <div className="space-y-2">
              {aiRanking.movil.length === 0 ? (
                <div className="text-slate-500">Sin datos todavía.</div>
              ) : (
                aiRanking.movil.map((item, index) => (
                  <div
                    key={`ia-movil-${item.techName}-${index}`}
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  >
                    {index + 1}. {item.techName} · {formatMinutes(item.averageMinutes)} de media · {item.count} trabajos
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 font-medium">Tacógrafo</div>
            <div className="space-y-2">
              {aiRanking.tacografo.length === 0 ? (
                <div className="text-slate-500">Sin datos todavía.</div>
              ) : (
                aiRanking.tacografo.map((item, index) => (
                  <div
                    key={`ia-tacografo-${item.techName}-${index}`}
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  >
                    {index + 1}. {item.techName} · {formatMinutes(item.averageMinutes)} de media · {item.count} trabajos
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 p-4">
        <div className="mb-3 text-sm font-medium text-slate-700">
          Sugerencias IA
        </div>

        <div className="space-y-2 text-sm">
          {aiSuggestions.length === 0 ? (
            <div className="text-slate-500">
              Aún no hay suficiente histórico para generar sugerencias.
            </div>
          ) : (
            aiSuggestions.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-violet-900"
              >
                {item.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  </div>
)}

     {view === "ajustes" && (
  <div className="grid gap-4 md:grid-cols-4">
    {Object.entries(AREA_META).map(([key, meta]) => {
      const Icon = meta.icon;

      return (
        <button
          key={key}
          onClick={() => {
            setDraft({
              area: key as AreaKey,
              plate: "",
              urgent: false,
              template: "",
            });
            setFormOpen(true);
          }}
          className={`rounded-3xl border p-5 text-left shadow-sm transition hover:shadow-md ${meta.color}`}
        >
          <div className="flex items-center justify-between">
            <Icon className="h-7 w-7" />
            <Plus className="h-5 w-5" />
          </div>

          <div className="mt-4 text-lg font-semibold">
            + {meta.label}
          </div>

          <p className="mt-1 text-sm opacity-80">
            Nueva entrada con matrícula y urgencia
          </p>
        </button>
      );
    })}
  </div>
)}

{arrivedPendingValidationScheduledJobs.length > 0 && (
  <div className="rounded-3xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-sm font-semibold text-violet-900">
        Citas llegadas pendientes de validar
      </div>

      <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700">
        {arrivedPendingValidationScheduledJobs.length}
      </span>
    </div>

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {arrivedPendingValidationScheduledJobs.map((scheduled) => {
        const relatedJob =
  scheduled.jobId != null
    ? jobs.find((job) => job.id === scheduled.jobId)
    : null;

const secondRelatedJob =
  scheduled.secondJobId != null
    ? jobs.find((job) => job.id === scheduled.secondJobId)
    : null;

const phaseLabel = getScheduledJobCurrentPhaseLabel(scheduled, jobs);

        return (
          <div
            key={scheduled.id}
            className="rounded-2xl border border-violet-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-violet-950">
                  {scheduled.plate || "Sin matrícula"}
                </div>

                <div className="mt-1 text-sm text-violet-700">
                  {scheduled.date} · {scheduled.startTime}
                </div>
              </div>

              <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-bold uppercase text-violet-700">
  {phaseLabel}
</span>
            </div>

            <div className="mt-2 text-sm text-violet-800">
              {scheduled.linkedTemplateLabel ||
                relatedJob?.quickEntryLabel ||
                "Trabajo pendiente de validar"}
            </div>

            {relatedJob && (
              <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-900">
                {relatedJob.assignedNames?.length
                  ? `Propuesta: ${relatedJob.assignedNames.join(" + ")}`
                  : "Sin propuesta todavía"}
              </div>
            )}

            {secondRelatedJob && (
  <div className="mt-2 rounded-xl border border-fuchsia-100 bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-900">
    <div className="font-semibold">
      2º trabajo: {getOperationLabel(secondRelatedJob)}
    </div>

    <div className="mt-1">
      Estado: {secondRelatedJob.status}
    </div>

    {secondRelatedJob.assignedNames?.length > 0 && (
      <div className="mt-1">
        Propuesta: {secondRelatedJob.assignedNames.join(" + ")}
      </div>
    )}
  </div>
)}

            <div className="mt-2 text-xs text-slate-500">
              Cliente: {scheduled.customerName || "Sin nombre"}
            </div>

            <div className="mt-1 text-xs text-slate-500">
              Teléfono: {scheduled.customerPhone || "Sin teléfono"}
            </div>

            <div className="mt-3 text-xs text-violet-700">
              Autoriza el inicio desde el bloque “Pendientes de validar”.
              <button
  type="button"
  onClick={() => deleteArrivedScheduledJob(scheduled.id)}
  className="mt-3 w-full rounded-2xl border border-red-300 bg-red-600 px-4 py-3 text-sm font-black text-white hover:bg-red-700"
>
  Eliminar cita llegada
</button>
                    </div>
          </div>
        );
      })}
    </div>
  </div>
)}

{(view === "operativo" || view === "operativo2") && dueScheduledJobs.length > 0 && (
  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-2 shadow-sm">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div>
        <h2 className="text-sm font-black text-amber-950">
          Citas pendientes de llegada
        </h2>
        <p className="text-[10px] font-medium text-amber-700">
          Pulsa “Llegó” para pasarlas a operativo.
        </p>
      </div>

      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-black text-amber-800">
        {dueScheduledJobs.length}
      </span>
    </div>

    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {dueScheduledJobs.map((job) => {
        const secondTemplate = job.secondTemplateKey
          ? quickTemplates.find(
              (template) => template.key === job.secondTemplateKey
            )
          : null;

        const includedTasks = Array.isArray(job.includedTasks)
          ? job.includedTasks
          : [];

        const appointmentMs = new Date(
          `${job.date}T${job.startTime}`
        ).getTime();

        const isLate =
          !Number.isNaN(appointmentMs) && appointmentMs <= Date.now();

        return (
          <div
            key={job.id}
            className={`rounded-xl border bg-white p-2 shadow-sm ${
              isLate ? "border-red-300" : "border-amber-200"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <input
                  value={job.plate}
                  onChange={(e) =>
                    updateScheduledJobField(job.id, "plate", e.target.value)
                  }
                  placeholder="Matrícula"
                  className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1 text-sm font-black uppercase tracking-wide text-slate-950"
                />

                <div className="mt-1 text-xs font-bold text-amber-900">
                  {job.date} · {job.startTime}
                </div>
              </div>

              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                  isLate
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {isLate ? "Pendiente" : "Próxima"}
              </span>
            </div>

            <div className="rounded-xl border border-amber-100 bg-amber-50 px-2 py-2">
              <div className="text-[9px] font-bold uppercase text-amber-600">
                Trabajo
              </div>

              <select
                value={job.firstTemplateKey || job.templateKey}
                onChange={(e) =>
                  updateScheduledJobTemplate(job.id, e.target.value)
                }
                className="mt-1 w-full rounded-lg border border-yellow-300 bg-yellow-100 px-2 py-1 text-xs font-bold text-red-700"
              >
                {quickTemplates
                  .slice()
                  .sort((a, b) =>
                    a.label.localeCompare(b.label, "es", {
                      sensitivity: "base",
                    })
                  )
                  .map((template) => (
                    <option
                      key={template.key}
                      value={template.key}
                      className="bg-yellow-100 font-bold text-red-700"
                    >
                      {template.label}
                    </option>
                  ))}
              </select>

              {secondTemplate && (
                <div className="mt-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-800">
                  Después: {secondTemplate.label}
                </div>
              )}

              {includedTasks.length > 0 && (
                <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-900">
                  {includedTasks.map((task) => task.label).join(" + ")}
                </div>
              )}
            </div>

            <div className="mt-2 grid gap-1 text-xs">
              <input
                value={job.customerName || ""}
                onChange={(e) =>
                  updateScheduledJobField(
                    job.id,
                    "customerName",
                    e.target.value
                  )
                }
                placeholder="Cliente"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              />

              <input
                value={job.customerPhone || ""}
                onChange={(e) =>
                  updateScheduledJobField(
                    job.id,
                    "customerPhone",
                    e.target.value
                  )
                }
                placeholder="Teléfono"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              />

              <textarea
                value={job.notes || ""}
                onChange={(e) =>
                  updateScheduledJobField(job.id, "notes", e.target.value)
                }
                placeholder="Observaciones"
                rows={1}
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              />

              {job.urgent && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-black text-red-700">
                  URGENTE
                </div>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => confirmScheduledArrival(job)}
                className="rounded-xl bg-green-600 px-2 py-2 text-xs font-black text-white hover:bg-green-700"
              >
                Llegó
              </button>

              <button
                type="button"
                onClick={() => cancelScheduledJob(job.id)}
                className="rounded-xl border border-red-200 bg-white px-2 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}

{(view === "operativo" || view === "operativo2") && validationJobs.length > 0 && (
  <section className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 shadow-sm">
    <div className="mb-2 flex items-center gap-2">
      <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Pendientes de validar</span>
      <span className="rounded-full bg-violet-200 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">{validationJobs.length}</span>
    </div>
    <div className="flex flex-col gap-2">
      {validationJobs.map((job) => {
        const Icon = AREA_META[job.area].icon;
        const assignedNames = job.assignedNames ?? [];
        return (
          <div key={job.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2">
            {/* icono + matrícula + operación */}
            <div className={`rounded-lg border p-1 ${AREA_META[job.area].color}`}>
              <Icon className="h-3 w-3" />
            </div>
            <span className="text-xs font-bold text-violet-950">{job.plate}</span>
            {job.urgent && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">URGENTE</span>}
            <span className="text-xs text-violet-700">{getOperationLabel(job)}</span>
            <span className="rounded-lg border border-violet-100 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800">{getValidationLabel(job)}</span>
            {assignedNames.length > 0 && (
              <span className="text-[11px] text-slate-500">{assignedNames.join(" + ")}</span>
            )}
            {job.reason && <span className="text-[11px] text-slate-400">{job.reason}</span>}

            {/* selects y botones compactos */}
            <select
              value={assignedNames[0] ?? ""}
              onChange={(e) => { if (e.target.value) updateValidationResponsible(job.id, e.target.value); }}
              className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-xs"
            >
              <option value="">Responsable…</option>
              {techs
                .filter((tech) => canSelectTechManuallyForJob(tech, job, jobs, quickTemplates, "responsable") || tech.name === assignedNames[0])
                .filter((tech) => tech.name === assignedNames[0] || !isTechBlockedByOutsideMaintenance(tech.name))
                .map((tech) => <option key={tech.name} value={tech.name}>{tech.name}</option>)}
            </select>

            {["camion", "movil"].includes(job.area) && (
              <>
                <select
                  value={assignedNames[1] ?? ""}
                  onChange={(e) => { if (e.target.value) updateValidationSupport(job.id, e.target.value); }}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
                >
                  <option value="">Apoyo…</option>
                  {techs
                    .filter((tech) => tech.name !== assignedNames[0])
                    .filter((tech) => canSelectTechManuallyForJob(tech, job, jobs, quickTemplates, "apoyo") || tech.name === assignedNames[1])
                    .filter((tech) => tech.name === assignedNames[1] || !isTechBlockedByOutsideMaintenance(tech.name))
                    .map((tech) => <option key={tech.name} value={tech.name}>{tech.name}</option>)}
                </select>
                {assignedNames.length > 1 && (
                  <button type="button" onClick={() => removeValidationSupport(job.id)} className="rounded-lg border border-amber-200 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50">✕ apoyo</button>
                )}
              </>
            )}

            <button type="button" onClick={() => authorizeProposedJob(job.id)} disabled={assignedNames.length === 0} className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40">✓ Autorizar</button>
            <button type="button" onClick={() => sendValidationJobToQueue(job.id)} className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100">Cola</button>
            <button type="button" onClick={() => rejectProposedJob(job.id)} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100">Rechazar</button>
            <button type="button" onClick={() => deleteValidationJob(job.id)} className="rounded-lg border border-red-300 bg-red-600 px-2 py-1 text-xs font-bold text-white hover:bg-red-700">Eliminar</button>
          </div>
        );
      })}
    </div>
  </section>
)}
<div className={`grid gap-6 xl:grid-cols-[1.1fr_1.4fr_1fr] ${view === "operativo2" ? "hidden" : ""}`}>
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Técnicos</h2>
            <span className="text-xs text-slate-500">
              Control manual de Ramón
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Nombre</th>
                  <th className="py-2">Estado</th>
                  <th className="py-2">Trabajo</th>
                  <th className="py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleTechs.map((tech) => {
  const currentJob = jobs.find(
    (job) => job.id === tech.currentJobId
  );

  const scheduledStatus = getScheduledStatusForTech({
    techName: tech.name,
    scheduledStatuses: scheduledTechStatuses,
  });

  const validationProposal = getValidationProposalForTech(
    tech.name,
    jobs
  );

const isReservedForValidation = Boolean(validationProposal && !currentJob);

const isOutsideMaintenance = isTechBlockedByOutsideMaintenance(tech.name);

const displayedTechStatus = isOutsideMaintenance
  ? ("no_disponible" as TechStatus)
  : tech.status;

const rowColor = isOutsideMaintenance
  ? "bg-red-50 border-red-200 text-red-800"
  : isReservedForValidation
    ? "bg-violet-50 border-violet-200 text-violet-800"
    : getTechStatusColor(displayedTechStatus);

const textColor = "";
  return (
                    <tr key={tech.name} className={`border-t ${rowColor}`}>
                      <td className={`py-2 font-medium ${textColor}`}>
  <div className="flex items-center gap-2">
    <img
      src={getTechAvatarUrl(tech)}
      alt={tech.name}
      className="h-8 w-8 rounded-full border object-cover"
    />
    <span>{tech.name}</span>
  </div>
</td>
                      <td className={`py-2 ${textColor}`}>
  {isReservedForValidation && validationProposal && (
    <div className="mb-1 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700">
      Reservado · {validationProposal.plate}
    </div>
  )}

<select
  value={displayedTechStatus}
  disabled={Boolean(scheduledStatus && scheduledStatus.status !== "disponible")}
  onChange={(e) =>
    setTechManual(tech.name, e.target.value as TechStatus)
  }
  className={`rounded-lg border border-slate-200 px-2 py-1 ${
    scheduledStatus && scheduledStatus.status !== "disponible"
      ? "cursor-not-allowed bg-indigo-50 font-bold text-indigo-700"
      : "bg-white"
  }`}
>
{scheduledStatus && scheduledStatus.status !== "disponible" && (
  <div className="mt-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
    Bloqueado por agenda · {scheduledStatus.startDate} →{" "}
    {scheduledStatus.endDate}
  </div>
)}

                          <option value="disponible">disponible</option>
<option value="refuerzo">refuerzo</option>
<option value="ocupado">ocupado</option>
<option value="nodisponible">nodisponible</option>
<option value="no_disponible">no disponible</option>
<option value="permiso">permiso</option>
<option value="vacaciones">vacaciones</option>
<option value="baja">baja</option>
<option value="otro_taller">otro taller</option>

                        </select>
                      </td>
<td className={`py-2 text-xs ${textColor}`}>
 <div>
  {isOutsideMaintenance
    ? "Mantenimiento fuera de taller"
    : currentJob
    ? `${AREA_META[currentJob.area].label} · ${currentJob.plate}`
    : validationProposal
    ? `Propuesto en ${validationProposal.plate} · ${getOperationLabel(
        validationProposal
      )}`
    : "-"}
</div>

  {validationProposal && !currentJob && (
    <div className="mt-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
      Pendiente de autorizar
    </div>
  )}

  {isUnavailableTechStatus(tech.status) && (
    <div className="mt-1 text-[10px] font-medium text-slate-500">
      {getTechStatusLabel(tech.status)}:{" "}
      {formatMinutes(getTechMinutesInStatus(tech, tech.status))}
    </div>
  )}
</td>
                      <td className="py-2">
  <div className="flex items-center gap-3">
    <label className="cursor-pointer text-xs text-blue-600 hover:text-blue-700">
      Foto
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleTechImageUpload(e, tech.name)}
      />
    </label>

    {view === "ajustes" && (
      <button
        onClick={() => { setWorkshopPinModal({ techName: tech.name }); setWorkshopPinInput(""); setWorkshopPinError(""); }}
        className="text-xs text-slate-600 hover:text-slate-900"
        title="Asignar PIN portal móvil"
      >
        🔑 PIN
      </button>
    )}

    {view === "ajustes" && tech.name !== "Ramón" && (
      <button
        onClick={() => removeTech(tech.name)}
        className="text-xs text-red-600 hover:text-red-700"
      >
        Eliminar
      </button>
    )}
  </div>
</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {view === "ajustes" && (
            <div className="mt-6 rounded-2xl border border-slate-200 p-3">
              <div className="mb-3 text-sm font-medium text-slate-700">
                Competencias y prioridad de asignación
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-2 pr-2">Técnico</th>
                      <th className="py-2 pr-2">Cam R</th>
                      <th className="py-2 pr-2">Cam A</th>
                      <th className="py-2 pr-2">Mov R</th>
                      <th className="py-2 pr-2">Mov A</th>
                      <th className="py-2 pr-2">Tac R</th>
                      <th className="py-2 pr-2">Tac A</th>
                      <th className="py-2 pr-2">Tur R</th>
                      <th className="py-2 pr-2">Tur A</th>
                      <th className="py-2 pr-2">Mec R</th>
                      <th className="py-2 pr-2">Mec A</th>
                      <th className="py-2 pr-2">Ali R</th>
                      <th className="py-2 pr-2">Ali A</th>
                      <th className="py-2 pr-2">Pin R</th>
                      <th className="py-2 pr-2">Pin A</th>
                      <th className="py-2 pr-2">Pr Cam R</th>
                      <th className="py-2 pr-2">Pr Cam A</th>
                      <th className="py-2 pr-2">Pr Mov R</th>
                      <th className="py-2 pr-2">Pr Mov A</th>
                      <th className="py-2 pr-2">Pr Tac R</th>
                      <th className="py-2 pr-2">Pr Tac A</th>
                      <th className="py-2 pr-2">Pr Tur R</th>
                      <th className="py-2 pr-2">Pr Tur A</th>
                      <th className="py-2 pr-2">Pr Mec R</th>
                      <th className="py-2 pr-2">Pr Mec A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTechs.map((tech) => (
                      <tr
                        key={`cfg-${tech.name}`}
                        className="border-t border-slate-100"
                      >
                        <td className="py-2 pr-2 font-medium">{tech.name}</td>
                        {(
                          [
                            "camion",
                            "movil",
                            "tacografo",
                            "turismo",
                            "mecanica",
                            "alineacion_camion",
                            "pinchazo_camion",
                          ] as CompetencyKey[]
                        ).flatMap((key) =>
                          (["responsable", "apoyo"] as AssignmentRole[]).map(
                            (role) => (
                              <td
                                key={`${key}-${role}`}
                                className="py-2 pr-2 text-center"
                              >
                                <input
                                  type="checkbox"
                                  checked={tech.competencies[key][role]}
                                  onChange={(e) =>
                                    updateTechCompetency(
                                      tech.name,
                                      key,
                                      role,
                                      e.target.checked
                                    )
                                  }
                                />
                              </td>
                            )
                          )
                        )}
                        {(
                          [
                            "camion",
                            "movil",
                            "tacografo",
                            "turismo",
                            "mecanica",
                          ] as AreaKey[]
                        ).flatMap((area) =>
                          (["responsable", "apoyo"] as AssignmentRole[]).map(
                            (role) => (
                              <td key={`${area}-${role}`} className="py-2 pr-2">
                                <input
                                  type="number"
                                  min={1}
                                  value={tech.priorities[area][role]}
                                  onChange={(e) =>
                                    updateTechPriority(
                                      tech.name,
                                      area,
                                      role,
                                      Number(e.target.value)
                                    )
                                  }
                                  className="w-16 rounded border border-slate-200 px-2 py-1"
                                />
                              </td>
                            )
                          )
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === "ajustes" && (
            <div className="mt-4 flex gap-2">
              <input
                value={newTechName}
                onChange={(e) => setNewTechName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTech();
                }}
                placeholder="Nuevo técnico"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                onClick={addTech}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
              >
                Añadir
              </button>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Trabajos activos</h2>
            <span className="text-xs text-slate-500">Con tiempo real</span>
          </div>

          <div className="space-y-3">
            {runningJobs.length === 0 && (
              <EmptyState
                icon={Clock3}
                title="Sin trabajos activos"
                text="Cuando entre el primer vehículo, aparecerá aquí con su responsable."
              />
            )}

            {runningJobs.map((job) => {
  const Icon = AREA_META[job.area].icon;
  const prediction = getPredictedTimeForJob(job, operationReport);
  const assignedNames = job.assignedNames ?? [];

const workedMinutes = getWorkedMinutes(job);
const templateForJob =
  job.template != null
    ? quickTemplates.find((template) => template.key === job.template) ?? null
    : quickTemplates.find((template) => template.label === job.quickEntryLabel) ??
      null;

const aiMinutes = getJobDisplayAiMinutes({
  job,
  prediction,
  template: templateForJob,
});

const previstoMinutes = getJobDisplayPlannedMinutes({
  job,
  prediction,
  template: templateForJob,
});
console.log("DEBUG tiempos trabajo activo", {
  jobId: job.id,
  plate: job.plate,
  quantity: job.quantity,
  unitMinutes: job.unitMinutes,
  standardMinutes: job.standardMinutes,
  predictedMinutes: prediction.predictedMinutes,
  aiMinutes,
  previstoMinutes,
});
  return (
    <div
      key={job.id}
      className="rounded-2xl border border-slate-200 p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className={`rounded-xl border p-2 ${AREA_META[job.area].color}`}>
              <Icon className="h-4 w-4" />
            </div>

            <div>
              <div className="font-semibold">{job.plate}</div>
              {(job.customerName || job.customerPhone) && (
  <div className="mt-1 text-xs text-slate-500">
    {job.customerName && <div>Cliente: {job.customerName}</div>}
    {job.customerPhone && <div>Teléfono: {job.customerPhone}</div>}
  </div>
)}
              <div className="text-sm text-slate-500">
                {getOperationLabel(job)}
              </div>
            </div>

            {job.urgent && (
              <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
                URGENTE
              </span>
            )}
          </div>

          <div className="mt-3 text-sm text-slate-700">
            <div className="mb-1">Asignados:</div>

            <div className="flex flex-wrap gap-3">
              {assignedNames.length === 0 ? (
                <span className="text-xs text-slate-500">Sin asignar</span>
              ) : (
                assignedNames.map((name) => {
                  const assignedTech = techs.find((t) => t.name === name);

                  return (
                    <div key={name} className="flex items-center gap-2">
                      <img
                        src={getTechAvatarUrl(assignedTech)}
                        alt={name}
                        className="h-7 w-7 rounded-full border object-cover"
                      />
                      <span className="font-medium">{name}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-1 text-xs text-slate-500">
            Inicio: {formatClock(job.startedAtMs || job.createdAtMs)}
          </div>

          <div className="mt-1 text-xs text-slate-500">
            Tiempo trabajado:{" "}
            <span className="font-medium">
              {formatMinutes(workedMinutes)}
            </span>
          </div>

          <div className="mt-1 text-xs text-slate-500">
            Tiempo parado:{" "}
            <span className="font-medium">
              {formatMinutes(getPausedMinutes(job))}
            </span>
          </div>

          <div className="mt-1 text-xs text-slate-500">
            Tiempo previsto IA:{" "}
            <span className="font-medium">
              {formatMinutes(aiMinutes)}
            </span>
            {prediction.source !== "none" && (
              <span className="ml-1 text-slate-400">
                ({prediction.source === "template" ? "plantilla" : "área"})
              </span>
            )}
          </div>

          <div className="mt-1 text-xs text-slate-500">
  Tiempo previsto:{" "}
  <span className="font-medium">
    {formatMinutes(previstoMinutes)}
  </span>
</div>

          <div className="mt-1 text-xs text-slate-500">
            Motivo: {job.reason || "Sin motivo especificado."}
          </div>
          {job.includedTasks && job.includedTasks.length > 0 && (
  <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
      Tareas incluidas
    </div>

    <div className="space-y-1">
      {job.includedTasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs font-medium text-emerald-900"
        >
          <span>✓ {task.label}</span>

          {task.standardMinutes != null && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              {task.standardMinutes} min
            </span>
          )}
        </div>
      ))}
    </div>
  </div>
)}

          {recommendedTechByJobId[job.id] && (
            <div className="mt-1 text-xs text-violet-700">
              Sugerencia IA responsable:{" "}
              <span className="font-medium">
                {recommendedTechByJobId[job.id]}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          <button
            onClick={() => pauseJob(job.id)}
            className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700"
          >
            Stand by
          </button>

{["camion", "movil"].includes(job.area) && (
  <>
    {assignedNames.length < 2 ? (
      <button
        type="button"
        onClick={() => addSupportToJob(job.id)}
        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
      >
        Añadir apoyo
      </button>
    ) : (
      <button
        type="button"
        onClick={() => removeSupportFromActiveJob(job.id)}
        className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700"
      >
        Quitar apoyo
      </button>
    )}

    <select
      defaultValue=""
      onChange={(event) => {
        if (event.target.value) {
          addSupportToJob(job.id, event.target.value);
          event.currentTarget.value = "";
        }
      }}
      className="rounded-xl border border-amber-200 bg-white px-2 py-2 text-sm"
    >
      <option value="">
        {assignedNames.length >= 2 ? "Cambiar apoyo" : "Elegir apoyo"}
      </option>

      {techs
  .filter((tech) => tech.name !== assignedNames[0])
  .filter((tech) =>
    canSelectTechManuallyForJob(
      tech,
      job,
      jobs,
      quickTemplates,
      "apoyo"
    )
  )
  .filter((tech) => !isTechBlockedByOutsideMaintenance(tech.name))
  .map((tech) => (
    <option key={tech.name} value={tech.name}>
      {tech.name}
    </option>
  ))}
    </select>
  </>
)}

<select
  defaultValue=""
  onChange={(event) => {
    if (event.target.value) {
      reassignJob(job.id, event.target.value);
      event.currentTarget.value = "";
    }
  }}
  className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm"
>
  <option value="">Cambiar responsable</option>

  {techs
    .filter((tech) => AREA_META[job.area].order.includes(tech.name))
    .filter((tech) => {
      const currentResponsible = assignedNames[0];

      if (tech.name === currentResponsible) return true;
      if (isTechBlockedByOutsideMaintenance(tech.name)) return false;

      return canSelectTechManuallyForJob(
        tech,
        job,
        jobs,
        quickTemplates,
        "responsable"
      );
    })
    .map((tech) => {
      const recommended = recommendedTechByJobId[job.id] === tech.name;
      const currentResponsible = assignedNames[0] === tech.name;

      return (
        <option key={tech.name} value={tech.name}>
          {currentResponsible
            ? `${tech.name} (actual)`
            : recommended
            ? `⭐ ${tech.name} (IA)`
            : tech.name}
        </option>
      );
    })}
</select>

{["camion", "movil"].includes(job.area) && (
  <>
    <select
      value={assignedNames[1] ?? ""}
      onChange={(event) => {
        if (event.target.value) {
          changeSupportForJob(job.id, event.target.value);
        }
      }}
      className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-2 text-sm font-medium text-amber-800"
    >
      <option value="">Cambiar apoyo</option>
      {techs
        .filter((tech) => tech.name !== assignedNames[0])
        .filter(
          (tech) =>
            canAssignTechManuallyToJob(
              tech,
              job,
              jobs,
              quickTemplates,
              "apoyo"
            ) || tech.name === assignedNames[1]
        )
        .filter(
          (tech) =>
            tech.name === assignedNames[1] ||
            !isTechBlockedByOutsideMaintenance(tech.name)
        )
        .map((tech) => (
          <option key={tech.name} value={tech.name}>
            {tech.name}
          </option>
        ))}
    </select>

    {assignedNames.length > 1 && (
      <button
        type="button"
        onClick={() => removeSupportFromJobManually(job.id)}
        className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
      >
        Quitar apoyo
      </button>
    )}
  </>
)}
        </div>
      </div>
    </div>
  );
})}
          </div>
        </section>
        
        <div className="space-y-6">
<section className="rounded-3xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
  <div className="mb-4 flex items-center justify-between">
    <h2 className="text-lg font-semibold text-orange-900">
      Trabajos en Stand by
    </h2>

    <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700">
      {pausedJobs.length}
    </span>
  </div>

  {blockedJobs.length > 0 && (
  <section className="rounded-3xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-violet-900">
        Trabajos vinculados bloqueados
      </h2>

      <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700">
        {blockedJobs.length}
      </span>
    </div>

    <div className="space-y-3">
      {blockedJobs.map((job) => {
        const previousJob = jobs.find(
          (item) => item.id === job.dependsOnJobId
        );

        return (
          <div
            key={job.id}
            className="rounded-2xl border border-violet-200 bg-white p-3"
          >
            <div className="font-semibold text-violet-900">
              {job.plate}
            </div>

            <div className="mt-1 text-xs text-violet-700">
              {getOperationLabel(job)}
            </div>

            <div className="mt-1 text-xs text-slate-500">
              {job.blockedReason || "Pendiente de trabajo anterior."}
            </div>

            {previousJob && (
              <div className="mt-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                Depende de: {getOperationLabel(previousJob)} ·{" "}
                {previousJob.status}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </section>
)}

  <div className="space-y-3">
    {pausedJobs.length === 0 ? (
      <EmptyState
        icon={Clock3}
        title="Sin trabajos en stand by"
        text="No hay trabajos detenidos temporalmente."
      />
    ) : (
      pausedJobs.map((job) => (
        <div
          key={job.id}
          className="rounded-2xl border border-orange-200 bg-white p-3"
        >
          <div className="font-semibold text-orange-900">
            {job.plate}
          </div>

          <div className="mt-1 text-xs text-orange-700">
            {getOperationLabel(job)}
          </div>

          <div className="mt-1 text-xs text-slate-500">
            {job.reason || "Trabajo en stand by."}
          </div>

          <div className="mt-2 space-y-1 text-xs text-orange-700">
            <div>
              Trabajado:{" "}
              <span className="font-medium">
               {formatMinutes(getWorkedMinutes(job))}
              </span>
            </div>

            <div>
              Parado:{" "}
              <span className="font-medium">
                {formatMinutes(getPausedMinutes(job))}
              </span>
            </div>
          </div>

          <button
            onClick={() => reactivatePausedJob(job.id)}
            className="mt-3 rounded-xl bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700"
          >
            Reactivar
          </button>
        </div>
      ))
    )}
  </div>
</section>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Cola de espera</h2>
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>

            <div className="space-y-3">
              {waitingJobs.length === 0 && (
                <EmptyState
                  icon={CheckCircle2}
                  title="Sin espera"
                  text="No hay trabajos pendientes de asignación."
                />
              )}

              {waitingJobs.map((job) => {
                const Icon = AREA_META[job.area].icon;
                const prediction = getPredictedTimeForJob(job, operationReport);

                const displayMinutes = getDisplayMinutesForJob(job);
                const predictedMinutesRaw = Number(prediction.predictedMinutes);

                const safePredictedMinutes =
                  Number.isFinite(predictedMinutesRaw) && predictedMinutesRaw > 0
                    ? Math.round(predictedMinutesRaw)
                    : 0;

                const previstoMinutes = displayMinutes ?? safePredictedMinutes;

                return (
                  <div
                    key={job.id}
                    className="rounded-2xl border border-amber-200 bg-amber-50 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-amber-700" />
                      <div className="font-medium text-amber-900">
                        {job.plate}
                      </div>
                      {job.urgent && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          URGENTE
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-xs text-amber-800">
                      {getOperationLabel(job)}
                    </div>
                    <div className="mt-1 text-xs text-amber-700">
                    Tiempo previsto: {formatMinutes(previstoMinutes)}
                    </div>

<WorkV2InfoBox job={job} />
                    <div className="mt-1 text-xs text-amber-700">
                      {job.reason}
                    </div>

                    {job.reservedTechName && (
                      <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                        Reservado para {job.reservedTechName} cuando acabe su trabajo actual.
                      </div>
                    )}

                    <div className="mt-3 flex flex-col gap-2">
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value) {
                            assignOrReserveWaitingJobManually(
                              job.id,
                              event.target.value
                            );
                            event.currentTarget.value = "";
                          }
                        }}
                        className="rounded-xl border border-amber-200 bg-white px-2 py-2 text-sm"
                      >
                        <option value="">Asignar o reservar técnico</option>
                        {techs
                          .filter((tech) => !tech.blocked)
                          .filter((tech) => !isHardBlockedTechStatus(tech.status))
                          .filter((tech) => !isManualUnavailableStatus(tech.status))
                          .filter((tech) => !isTechBlockedByOutsideMaintenance(tech.name))
                          .filter((tech) =>
                            canAssignTechManuallyToJob(
                              tech,
                              job,
                              jobs,
                              quickTemplates,
                              "responsable"
                            )
                          )
                          .map((tech) => {
                            const techIsBusy =
                              tech.currentJobId != null ||
                              tech.status === "ocupado" ||
                              tech.status === "refuerzo";

                            return (
                              <option key={tech.name} value={tech.name}>
                                {techIsBusy
                                  ? `${tech.name} (cuando acabe)`
                                  : `${tech.name} (libre)`}
                              </option>
                            );
                          })}
                      </select>

                      <button
                        onClick={() => deleteWaitingJob(job.id)}
                        className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600"
                      >
                        Eliminar de cola
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          
            
          {view === "ajustes" && (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Últimos trabajos cerrados
                </h2>
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>

              <div className="space-y-3 text-sm">
                {closedJobs.length === 0 && (
                  <EmptyState
                    icon={Clock3}
                    title="Sin histórico"
                    text="Al cerrar trabajos aparecerán aquí con su duración real."
                  />
                )}

                {[...closedJobs]
                  .sort((a, b) => (b.closedAtMs || 0) - (a.closedAtMs || 0))
                  .slice(0, 8)
                  .map((job) => (
                    <div
                      key={job.id}
                      className="rounded-2xl border border-slate-200 p-3"
                    >
                      <div className="font-medium">
                        {job.plate} · {getOperationLabel(job)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Cerrado: {formatClock(job.closedAtMs)}
                      </div>
                      <div className="mt-1 text-xs text-slate-700">
                        Tiempo real:{" "}
                        <span className="font-medium">
                          {formatMinutes(job.actualMinutes)}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Actividad</h2>
              <ShieldAlert className="h-5 w-5 text-slate-500" />
            </div>

            <div className="space-y-3 text-sm">
              {log.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200 p-3"
                >
                  <div className="text-xs text-slate-400">{item.time}</div>
                  <div className="mt-1 text-slate-700">{item.text}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

{(view === "operativo" || view === "operativo2") && (
  <div className="rounded-3xl border border-violet-200 bg-white p-5 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-sm font-medium text-violet-700">
        ChatGPT externo
      </div>

      <button
        type="button"
        onClick={askExternalAIWorkshop}
        disabled={externalAILoading}
        className="rounded-2xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {externalAILoading ? "Consultando..." : "Consultar ChatGPT"}
      </button>
    </div>

    {externalAIAnswer ? (
      <pre className="whitespace-pre-wrap rounded-2xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-900">
        {externalAIAnswer}
      </pre>
    ) : (
      <div className="text-sm text-slate-500">
        Pulsa el botón para pedir una recomendación externa.
      </div>
    )}
  </div>
)}

{(view === "operativo" || view === "operativo2") && (
<div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
  <div className="mb-3 text-sm font-medium text-slate-700">
    Alertas IA del taller
  </div>

  <div className="space-y-2">
    {workshopAlerts.map((alert) => (
      <div
        key={alert.id}
        className={`rounded-2xl border px-3 py-2 text-sm ${
          alert.level === "danger"
            ? "border-red-200 bg-red-50 text-red-800"
            : alert.level === "warning"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-sky-200 bg-sky-50 text-sky-800"
        }`}
      >
        {alert.text}
      </div>
    ))}
  </div>
</div>
)}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-semibold">
                  Nuevo {AREA_META[draft.area].label}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Matrícula + urgencia + asignación automática
                </p>
              </div>
              <button
                onClick={() => setFormOpen(false)}
                className="rounded-xl p-2 hover:bg-slate-100"
              >
                <XCircle className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Área</label>
                <select
                  value={draft.area}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      area: event.target.value as AreaKey,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-3 py-3"
                >
                  {Object.entries(AREA_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Matrícula
                </label>
                <input
                  value={draft.plate}
                  
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, plate: event.target.value }))
                  }
                  placeholder="1234ABC"
                  className="w-full rounded-2xl border border-slate-200 px-3 py-3 uppercase"
                />
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-3">
                <input
                  type="checkbox"
                  checked={draft.urgent}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      urgent: event.target.checked,
                    }))
                  }
                />
                <span className="text-sm font-medium">Marcar como urgente</span>
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setFormOpen(false)}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={createJob}
                className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white"
              >
                Guardar y asignar
              </button>
            </div>
          </div>
        </div>
      )}

      {quickEntryOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3">
    <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold">Nueva entrada rápida</h3>
            <p className="mt-1 text-sm text-slate-500">
              Plantilla + matrícula + urgencia
            </p>
          </div>

          <button
            type="button"
            onClick={() => setQuickEntryOpen(false)}
            className="rounded-xl p-2 hover:bg-slate-100"
          >
            <XCircle className="h-5 w-5 text-slate-500" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-4">
          
          <div>
            <label className="mb-2 block text-sm font-medium">Tipo</label>

            <select
              value={
                quickDraft.linkedTemplateKey
                  ? `${quickDraft.templateKey}|||${quickDraft.linkedTemplateKey}`
                  : quickDraft.templateKey
              }
              onChange={(event) => {
  const [templateKey, linkedTemplateKey] =
    event.target.value.split("|||");

  setQuickDraft((prev) => ({
    ...prev,
    templateKey,
    linkedTemplateKey: linkedTemplateKey || "",
    includedTaskIds: [],
    quantity: "1",
  }));
}}
              className="w-full rounded-2xl border border-slate-200 px-3 py-3"
            >
              {linkedTemplates
                .filter((linked) => {
                  const firstTemplate = quickTemplates.find(
                    (template) => template.key === linked.firstTemplateKey
                  );

                  return firstTemplate?.area === quickSelectedArea;
                })
                .sort((a, b) =>
                  a.label.localeCompare(b.label, "es", {
                    sensitivity: "base",
                  })
                )
                .map((linked) => (
                  <option
                    key={linked.id}
                    value={`${linked.firstTemplateKey}|||${linked.secondTemplateKey}`}
                  >
                    {linked.label}
                  </option>
                ))}

              {quickTemplates
                .filter((template) => template.area === quickSelectedArea)
                .sort((a, b) =>
                  a.label.localeCompare(b.label, "es", {
                    sensitivity: "base",
                  })
                )
                .map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.label}
                  </option>
                ))}
           </select>

<QuickEntryQuantityBox
  template={
    quickTemplates.find((template) => template.key === quickDraft.templateKey) ??
    null
  }
  quantity={quickDraft.quantity}
  setQuantity={(value) =>
    setQuickDraft((prev) => ({
      ...prev,
      quantity: value,
    }))
  }
/>

{(() => {
  const selectedTemplate = quickTemplates.find(
    (template) => template.key === quickDraft.templateKey
  );

  if (!selectedTemplate) return null;

  const availableIncludedTasks = buildSelectableIncludedTasks(
    selectedTemplate.area,
    quickTemplates,
    customExtraTasks,
    selectedTemplate.key
  );

  if (availableIncludedTasks.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black text-slate-800">
            Trabajos adicionales
          </div>

          <div className="text-[10px] font-semibold text-slate-400">
            Selecciona extras si este trabajo incluye más operaciones.
          </div>
        </div>

        <div className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">
          {quickDraft.includedTaskIds.length} seleccionados
        </div>
      </div>

      <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
        {availableIncludedTasks.map((task) => {
          const checked = quickDraft.includedTaskIds.includes(task.id);

          return (
            <label
              key={task.id}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
                checked
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const nextIds = event.target.checked
                      ? [...quickDraft.includedTaskIds, task.id]
                      : quickDraft.includedTaskIds.filter(
                          (id) => id !== task.id
                        );

                    setQuickDraft((prev) => ({
                      ...prev,
                      includedTaskIds: nextIds,
                    }));
                  }}
                />

                <span className="truncate">{task.label}</span>
              </div>

              {task.standardMinutes != null && (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                  {task.standardMinutes} min
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
})()}
          </div>

          <div>
  <label className="mb-2 block text-sm font-medium">Matrícula</label>

  <input
    value={quickDraft.plate}
    onChange={(event) =>
      setQuickDraft((prev) => ({
        ...prev,
        plate: event.target.value,
      }))
    }
    placeholder="1234ABC"
    className="w-full rounded-2xl border border-slate-200 px-3 py-3 uppercase"
  />
</div>

<div>
  <label className="mb-2 block text-sm font-medium">
    Cliente
  </label>

  <input
    value={quickDraft.customerName ?? ""}
    onChange={(event) =>
      setQuickDraft((prev) => ({
        ...prev,
        customerName: event.target.value,
      }))
    }
    placeholder="Nombre del cliente"
    className="w-full rounded-2xl border border-slate-200 px-3 py-3"
  />
</div>

<div>
  <label className="mb-2 block text-sm font-medium">
    Teléfono
  </label>

  <input
    value={quickDraft.customerPhone ?? ""}
    onChange={(event) =>
      setQuickDraft((prev) => ({
        ...prev,
        customerPhone: event.target.value,
      }))
    }
    placeholder="Teléfono móvil"
    className="w-full rounded-2xl border border-slate-200 px-3 py-3"
  />
</div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-3">
            <input
              type="checkbox"
              checked={quickDraft.urgent}
              onChange={(event) =>
                setQuickDraft((prev) => ({
                  ...prev,
                  urgent: event.target.checked,
                }))
              }
            />
            <span className="text-sm font-medium">Marcar como urgente</span>
          </label>
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setQuickEntryOpen(false)}
            className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={createTemplateEntry}
            className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white"
          >
            Guardar y asignar
          </button>
        </div>
      </div>
    </div>
  </div>
)}
    </div>
    {resetConfirmOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3">
  <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xl font-semibold text-red-700">
            Confirmar reinicio del sistema
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Esta acción borrará trabajos y logs de la jornada actual.
          </p>
        </div>

        <button
          onClick={() => {
            setResetConfirmOpen(false);
            setResetPassword("");
            setResetError("");
          }}
          className="rounded-xl p-2 hover:bg-slate-100"
        >
          <XCircle className="h-5 w-5 text-slate-500" />
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Solo el jefe debe realizar este reinicio.
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            Contraseña de jefe
          </label>
          <input
            type="password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            placeholder="Introduce la contraseña"
            className="w-full rounded-2xl border border-slate-200 px-3 py-3"
          />
        </div>

        {resetError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {resetError}
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => {
            setResetConfirmOpen(false);
            setResetPassword("");
            setResetError("");
          }}
          className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium"
        >
          Cancelar
        </button>

        <button
          onClick={resetAllSystem}
          className="flex-1 rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-700"
        >
          Confirmar reset
        </button>
      </div>
    </div>
  </div>
)}

{workshopPinModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3">
    <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl p-6">
      <h3 className="text-lg font-semibold mb-1">PIN taller — {workshopPinModal.techName}</h3>
      <p className="text-sm text-slate-500 mb-4">Introduce un PIN de 4 dígitos para el portal móvil del operario.</p>
      <input
        type="text"
        inputMode="numeric"
        maxLength={4}
        value={workshopPinInput}
        onChange={(e) => { setWorkshopPinInput(e.target.value.replace(/\D/g, "").slice(0, 4)); setWorkshopPinError(""); }}
        placeholder="1234"
        className="w-full rounded-xl border border-slate-200 px-3 py-3 text-center text-2xl font-black tracking-widest outline-none focus:ring-2 focus:ring-slate-300 mb-3"
      />
      {workshopPinError && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">{workshopPinError}</div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => { setWorkshopPinModal(null); setWorkshopPinInput(""); setWorkshopPinError(""); }}
          className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={workshopPinSaving}
          onClick={async () => {
            if (workshopPinInput.length !== 4) {
              setWorkshopPinError("El PIN debe tener 4 dígitos");
              return;
            }
            setWorkshopPinSaving(true);
            try {
              const resp = await fetchWithTimeout(`${API_BASE}/api/techs/${encodeURIComponent(workshopPinModal.techName)}/workshop-pin`, {
                method: "PUT",
                headers: getAdminHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ pin: workshopPinInput }),
              });
              if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                setWorkshopPinError((data as { error?: string }).error ?? "Error guardando PIN");
              } else {
                setWorkshopPinModal(null);
                setWorkshopPinInput("");
                setWorkshopPinError("");
              }
            } catch {
              setWorkshopPinError("Error de conexión");
            } finally {
              setWorkshopPinSaving(false);
            }
          }}
          className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {workshopPinSaving ? "Guardando..." : "Guardar PIN"}
        </button>
      </div>
    </div>
  </div>
)}
  </div>
);
}
