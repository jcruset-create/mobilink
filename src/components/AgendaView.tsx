import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  type IncludedTask,
  type CustomExtraTask,
  buildSelectableIncludedTasks,
  getIncludedTasksByIds,
} from "../modules/quickTaskSelector";

import {
  DEFAULT_WORKSHOP_ID,
  getWorkshopById,
  normalizeWorkshopId,
  type WorkshopId,
} from "../modules/workshops";

import type {
  Tech,
  TechStatus,
} from "../modules/workshopTypes";

import {
  SCHEDULED_TECH_STATUS_OPTIONS,
  createScheduledTechStatus,
  type ScheduledTechStatus,
} from "../modules/techStatusScheduleHelpers";

import { getTechStatusLabel } from "../modules/techStatus";
import { buildScheduledJobV2FieldsFromTemplate } from "../modules/scheduledJobV2Helpers";
import { getAgendaWhatsappV2Description } from "../modules/agendaWhatsappV2Helpers";

import ScheduledJobQuantityBox from "./ScheduledJobQuantityBox";
import ScheduledJobV2MiniLine from "./ScheduledJobV2MiniLine";
type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";

type ScheduledJobStatus =
  | "programado"
  | "en_cola"
  | "activo"
  | "cerrado"
  | "cancelado"
  | "eliminado"
  | "llego";

type QuickTemplate = {
  key: string;
  label: string;
  area: AreaKey;
  mode: "single" | "team";
  allowedTechs: string[];
  priorityOrder: string[];
  standardMinutes?: number | null;
  workshopId?: WorkshopId | string | null;

  // V2
  usesQuantity?: boolean;
  unitMinutes?: number | null;
  unitPrice?: number | null;
};

export type ScheduledJob = {
  id: number;
  workshopId?: WorkshopId | string | null;
  date: string;
  startTime: string;
  endTime: string;
  templateKey: string;
  templateLabel?: string;
  area: AreaKey;
  plate: string;
  customerName: string;
  customerPhone: string;
  sendWhatsAppOnSave?: boolean;
  manualReminderEnabled?: boolean;
  manualReminderDate?: string;
  manualReminderTime?: string;
  sendReminder24h?: boolean;
  sendReminder1h?: boolean;
  whatsappReminder24hSentAtMs?: number | null;
  whatsappReminder1hSentAtMs?: number | null;
  manualReminderSentAtMs?: number | null;
  notes?: string;
  urgent: boolean;
  includedTasks?: IncludedTask[];
  estimatedMinutes?: number;
  assignedTech?: string | null;
  status: ScheduledJobStatus;
  arrivedAtMs?: number | null;
  jobId?: number | null;
  secondJobId?: number | null;
  googleEventId?: string | null;
  linkedTemplateId?: string | null;
  linkedTemplateLabel?: string | null;
  firstTemplateKey?: string | null;
  secondTemplateKey?: string | null;
  createdAtMs?: number;
    /**
   * V2:
   * Cantidad, minutos por unidad y precio por unidad para agenda.
   * Compatibilidad:
   * - quantity vacío = 1
   * - unitMinutes vacío = estimatedMinutes o standardMinutes de plantilla
   * - unitPrice vacío = 0
   */
  quantity?: number | null;
  unitMinutes?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
};

type DateReminderColor = "red" | "orange" | "blue" | "green" | "slate";

type DateReminderKind = "normal" | "tech_status";

type DateReminder = {
  id: number;
  workshopId?: WorkshopId | string | null;
  kind?: DateReminderKind;
  title: string;
  startDate: string;
  endDate: string;
  color: DateReminderColor;
  notes?: string;

  // Estado técnico programado
  techStatusId?: string;
  techName?: string;
  techStatus?: TechStatus;
};

type ReminderDraft = {
  kind: DateReminderKind;
  title: string;
  startDate: string;
  endDate: string;
  color: DateReminderColor;
  notes: string;
  techName: string;
  techStatus: TechStatus;
};

type Props = {
  scheduledJobs: ScheduledJob[];
  setScheduledJobs: Dispatch<SetStateAction<ScheduledJob[]>>;
  quickTemplates: QuickTemplate[];
  selectedWorkshopId: WorkshopId | string;
  customExtraTasks?: CustomExtraTask[];
  AREA_META: any;
  onBack: () => void;
  appendLog: (text: string) => void;
  confirmScheduledArrival: (scheduled: ScheduledJob) => void;
  deleteScheduledJobFromBackend?: (id: number) => Promise<void>;
  cancelScheduledJob: (id: number) => void;

  techs: Tech[];
  scheduledTechStatuses: ScheduledTechStatus[];
  setScheduledTechStatuses: Dispatch<SetStateAction<ScheduledTechStatus[]>>;

  linkedTemplates?: {
    id: string;
    label: string;
    firstTemplateKey: string;
    secondTemplateKey: string;
    workshopId?: WorkshopId | string | null;
  }[];
};

const SLOT_MINUTES = 15;
const SLOT_HEIGHT = 24;
const DEFAULT_ESTIMATED_MINUTES = 45;

function timeToMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatLocalDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDigitalClock(date: Date) {
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getWeekDays(weekOffset = 0) {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  const diff = day === 0 ? -6 : 1 - day;

  monday.setDate(today.getDate() + diff + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  return Array.from({ length: 6 }).map((_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);

    return {
      index,
      date: formatLocalDate(date),
      label: date.toLocaleDateString("es-ES", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      }),
    };
  });
}

function getDayStart(dayIndex: number) {
  if (dayIndex === 5) return 9 * 60;
  return 8 * 60 + 30;
}

function getDayEnd(dayIndex: number) {
  if (dayIndex === 5) return 13 * 60 + 15;
  return 18 * 60 + 45;
}

function isWorkingTime(dayIndex: number, time: string) {
  const minutes = timeToMinutes(time);

  if (dayIndex === 5) {
    return minutes >= 9 * 60 && minutes <= 13 * 60;
  }

  const morning = minutes >= 8 * 60 + 30 && minutes <= 13 * 60 + 30;
  const afternoon = minutes >= 15 * 60 && minutes <= 18 * 60 + 30;

  return morning || afternoon;
}

function getTimeSlotsForDay(dayIndex: number) {
  const start = getDayStart(dayIndex);
  const end = getDayEnd(dayIndex);
  const slots: string[] = [];

  for (let t = start; t < end; t += SLOT_MINUTES) {
    slots.push(minutesToTime(t));
  }

  return slots;
}

function addMinutesToTime(time: string, minutes: number) {
  return minutesToTime(timeToMinutes(time) + minutes);
}

function getTodayKey() {
  return formatLocalDate(new Date());
}

function createDateReminderId() {
  return Date.now() + Math.floor(Math.random() * 100000);
}

function isPastDate(date: string) {
  return date < getTodayKey();
}

function isPastDateTime(date: string, time: string) {
  const today = getTodayKey();

  if (date < today) return true;
  if (date > today) return false;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return timeToMinutes(time) <= nowMinutes;
}

function getValidSlotsForDate(date: string, dayIndex: number) {
  return getTimeSlotsForDay(dayIndex).filter(
    (slot) => isWorkingTime(dayIndex, slot) && !isPastDateTime(date, slot)
  );
}

function getFirstAvailableSlotInWeek(
  days: { index: number; date: string; label: string }[]
) {
  const today = getTodayKey();

  for (const day of days) {
    if (day.date < today) continue;

    const validSlots = getValidSlotsForDate(day.date, day.index);

    if (validSlots.length > 0) {
      return {
        date: day.date,
        startTime: validSlots[0],
      };
    }
  }

  return null;
}

function getScheduledDate(job: any): string {
  if (job.date) return job.date;

  if (job.start) {
    return String(job.start).slice(0, 10);
  }

  return "";
}

function getScheduledStartTime(job: any): string {
  if (job.startTime) return job.startTime;

  if (job.start) {
    return String(job.start).slice(11, 16);
  }

  return "08:30";
}

function getScheduledEndTime(job: any): string {
  if (job.endTime) return job.endTime;

  if (job.end) {
    return String(job.end).slice(11, 16);
  }

  return addMinutesToTime(getScheduledStartTime(job), DEFAULT_ESTIMATED_MINUTES);
}

function getSolidAreaClass(area: AreaKey) {
  if (area === "camion") return "bg-red-600 text-white border-red-700";
  if (area === "movil") return "bg-amber-400 text-white border-amber-500";
  if (area === "tacografo") return "bg-orange-500 text-white border-orange-600";
  if (area === "turismo") return "bg-sky-500 text-white border-sky-600";
  return "bg-emerald-500 text-white border-emerald-600";
}

function getScheduledJobCardClass(job: ScheduledJob) {
  if (job.status === "en_cola") {
    return "bg-violet-600 text-white border-violet-700";
  }

  if (job.status === "activo") {
    return "bg-emerald-600 text-white border-emerald-700";
  }

  if (job.status === "cerrado") {
    return "bg-slate-500 text-white border-slate-600 opacity-80";
  }

  if (job.status === "cancelado") {
    return "bg-red-900 text-white border-red-950 opacity-70";
  }

  return getSolidAreaClass(job.area);
}

function getScheduledJobStatusLabel(status: ScheduledJobStatus) {
  if (status === "programado") return "Programado";
  if (status === "en_cola") return "Pendiente validar";
  if (status === "activo") return "Activo";
  if (status === "cerrado") return "Cerrado";
  if (status === "cancelado") return "Cancelado";
  if (status === "llego") return "Llegó";

  return status;
}

function layoutOverlappingJobs(jobs: ScheduledJob[]) {
  const sorted = [...jobs].sort(
    (a, b) =>
      timeToMinutes(getScheduledStartTime(a)) -
      timeToMinutes(getScheduledStartTime(b))
  );

  const result: {
    job: ScheduledJob;
    column: number;
    columns: number;
  }[] = [];

  let cluster: ScheduledJob[] = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;

    const columnsEnd: number[] = [];
    const local: { job: ScheduledJob; column: number }[] = [];

    for (const job of cluster) {
      const start = timeToMinutes(getScheduledStartTime(job));
      const end = timeToMinutes(getScheduledEndTime(job));

      let column = columnsEnd.findIndex((colEnd) => colEnd <= start);

      if (column === -1) {
        column = columnsEnd.length;
        columnsEnd.push(end);
      } else {
        columnsEnd[column] = end;
      }

      local.push({ job, column });
    }

    const totalColumns = Math.max(1, columnsEnd.length);

    for (const item of local) {
      result.push({
        job: item.job,
        column: item.column,
        columns: totalColumns,
      });
    }

    cluster = [];
    clusterEnd = -1;
  };

  for (const job of sorted) {
    const start = timeToMinutes(getScheduledStartTime(job));
    const end = timeToMinutes(getScheduledEndTime(job));

    if (cluster.length === 0) {
      cluster.push(job);
      clusterEnd = end;
      continue;
    }

    if (start < clusterEnd) {
      cluster.push(job);
      clusterEnd = Math.max(clusterEnd, end);
    } else {
      flushCluster();
      cluster.push(job);
      clusterEnd = end;
    }
  }

  flushCluster();

  return result;
}

export default function AgendaView({
  scheduledJobs,
  setScheduledJobs,
  quickTemplates,
  selectedWorkshopId,
  customExtraTasks = [],
  linkedTemplates = [],
  AREA_META,
  onBack,
  appendLog,
  cancelScheduledJob,
  deleteScheduledJobFromBackend,
  techs,
  scheduledTechStatuses,
  setScheduledTechStatuses,
}: Props) {
  const safeSelectedWorkshopId = normalizeWorkshopId(selectedWorkshopId);
  const selectedWorkshop = getWorkshopById(safeSelectedWorkshopId);

  function getItemWorkshopId(item: { workshopId?: string | null }) {
    return normalizeWorkshopId(item.workshopId ?? DEFAULT_WORKSHOP_ID);
  }

  function belongsToSelectedWorkshop(item: { workshopId?: string | null }) {
    return getItemWorkshopId(item) === safeSelectedWorkshopId;
  }

  const scheduledJobsForSelectedWorkshop = scheduledJobs.filter(
    belongsToSelectedWorkshop
  );

  const [weekOffset, setWeekOffset] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentClock, setCurrentClock] = useState(() => new Date());

useEffect(() => {
  const timer = window.setInterval(() => {
    setCurrentClock(new Date());
  }, 1000);

  return () => window.clearInterval(timer);
}, []);
  const [calendarMode, setCalendarMode] = useState<"week" | "day">("week");
  const [selectedDayDate, setSelectedDayDate] = useState<string>("");
  const [editingJobId, setEditingJobId] = useState<number | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<{
    date: string;
    startTime: string;
  } | null>(null);

  const [selectedArea, setSelectedArea] = useState<AreaKey>("camion");

  const [dateReminders, setDateReminders] = useState<DateReminder[]>(() => {
    try {
      if (typeof window === "undefined") return [];

      const saved = window.localStorage.getItem("agendaDateReminders");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [reminderModalOpen, setReminderModalOpen] = useState(false);

const [reminderDraft, setReminderDraft] = useState<ReminderDraft>({
  kind: "normal",
  title: "",
  startDate: getTodayKey(),
  endDate: getTodayKey(),
  color: "red",
  notes: "",
  techName: "",
  techStatus: "vacaciones",
});

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "agendaDateReminders",
        JSON.stringify(dateReminders)
      );
    } catch {
      // Si localStorage no está disponible, la agenda seguirá funcionando.
    }
  }, [dateReminders]);

  const [draft, setDraft] = useState({
  templateKey: quickTemplates[0]?.key ?? "",
  plate: "",
  customerName: "",
  customerPhone: "",
  notes: "",
  urgent: false,
  sendWhatsAppOnSave: true,
  manualReminderEnabled: false,
  manualReminderDate: "",
  manualReminderTime: "",
  sendReminder24h: true,
  sendReminder1h: true,
  estimatedMinutes: DEFAULT_ESTIMATED_MINUTES,
  linkedTemplateKey: "",
  includedTaskIds: [] as string[],
  quantity: "1",
});

  const [includedTasksOpen, setIncludedTasksOpen] = useState(false);

  const templatesForSelectedArea = quickTemplates.filter(
    (template) => template.area === selectedArea
  );

  const selectedTemplate = quickTemplates.find(
    (template) => template.key === draft.templateKey
  );

  const availableIncludedTasks = selectedTemplate
    ? buildSelectableIncludedTasks(
        selectedTemplate.area,
        quickTemplates,
        customExtraTasks,
        selectedTemplate.key
      )
    : [];

  const selectedIncludedTasks = getIncludedTasksByIds(
    draft.includedTaskIds,
    availableIncludedTasks
  );

  const days = getWeekDays(weekOffset);

  const visibleDays =
    calendarMode === "day"
      ? days.filter((day) => day.date === (selectedDayDate || getTodayKey()))
      : days;

  const finalVisibleDays =
    visibleDays.length > 0 ? visibleDays : days.length > 0 ? [days[0]] : [];

  const todayKey = formatLocalDate(new Date());

  function getReminderColorClass(color: DateReminderColor) {
    if (color === "orange") return "bg-orange-600 border-orange-700 text-white";
    if (color === "blue") return "bg-blue-600 border-blue-700 text-white";
    if (color === "green") return "bg-emerald-600 border-emerald-700 text-white";
    if (color === "slate") return "bg-slate-600 border-slate-700 text-white";

    return "bg-red-600 border-red-700 text-white";
  }

function getVisibleDateReminders() {
  return dateReminders
    .filter(belongsToSelectedWorkshop)
    .filter((reminder) =>
      finalVisibleDays.some(
        (day) => day.date >= reminder.startDate && day.date <= reminder.endDate
      )
    )
    .slice()
    .sort((a, b) => {
      if (a.startDate !== b.startDate) {
        return a.startDate.localeCompare(b.startDate);
      }

      if (a.endDate !== b.endDate) {
        return a.endDate.localeCompare(b.endDate);
      }

      return Number(a.id) - Number(b.id);
    });
}

  function getReminderGridRange(reminder: DateReminder) {
    const visibleIndexes = finalVisibleDays
      .map((day, index) => ({ day, index }))
      .filter(
        ({ day }) => day.date >= reminder.startDate && day.date <= reminder.endDate
      )
      .map(({ index }) => index);

    if (visibleIndexes.length === 0) return null;

    const firstIndex = Math.min(...visibleIndexes);
    const lastIndex = Math.max(...visibleIndexes);

    return {
      // +2 porque la primera columna es la columna de horas.
      gridColumn: `${firstIndex + 2} / ${lastIndex + 3}`,
    };
  }

function openDateReminderModal() {
  setReminderDraft({
    kind: "normal",
    title: "",
    startDate: days[0]?.date ?? getTodayKey(),
    endDate: days[5]?.date ?? getTodayKey(),
    color: "red",
    notes: "",
    techName: "",
    techStatus: "vacaciones",
  });

  setReminderModalOpen(true);
}

function saveDateReminder() {
  if (!reminderDraft.startDate || !reminderDraft.endDate) {
    alert("Selecciona fecha inicio y fecha final.");
    return;
  }

  if (reminderDraft.endDate < reminderDraft.startDate) {
    alert("La fecha final no puede ser anterior a la fecha inicial.");
    return;
  }

  if (reminderDraft.kind === "tech_status") {
    const techName = reminderDraft.techName.trim();

    if (!techName) {
      alert("Selecciona un técnico.");
      return;
    }

   const scheduledStatus = createScheduledTechStatus({
  techName,
  status: reminderDraft.techStatus,
  startDate: reminderDraft.startDate,
  endDate: reminderDraft.endDate,
  label: `${techName} · ${getTechStatusLabel(reminderDraft.techStatus)}`,
  notes: reminderDraft.notes.trim() || undefined,
  workshopId: safeSelectedWorkshopId,
});

    const alreadyExists = scheduledTechStatuses.some(
  (item: ScheduledTechStatus) =>
    item.techName === scheduledStatus.techName &&
    item.status === scheduledStatus.status &&
    item.startDate === scheduledStatus.startDate &&
    item.endDate === scheduledStatus.endDate
);

    const title =
      reminderDraft.title.trim() ||
      `${techName} · ${getTechStatusLabel(reminderDraft.techStatus)}`;

    const reminder: DateReminder = {
      id: createDateReminderId(),
      workshopId: safeSelectedWorkshopId,
      kind: "tech_status",
      title: title.toUpperCase(),
      startDate: reminderDraft.startDate,
      endDate: reminderDraft.endDate,
      color: reminderDraft.color || "orange",
      notes: reminderDraft.notes.trim(),
      techStatusId: scheduledStatus.id,
      techName,
      techStatus: reminderDraft.techStatus,
    };

    if (!alreadyExists) {
      setScheduledTechStatuses((prev) => [scheduledStatus, ...prev]);
    }

    setDateReminders((prev) => [...prev, reminder]);

    appendLog(
      `Estado técnico programado: ${techName} · ${getTechStatusLabel(
        reminderDraft.techStatus
      )} · ${reminder.startDate} a ${reminder.endDate}.`
    );

    setReminderModalOpen(false);

    setReminderDraft({
      kind: "normal",
      title: "",
      startDate: getTodayKey(),
      endDate: getTodayKey(),
      color: "red",
      notes: "",
      techName: "",
      techStatus: "vacaciones",
    });

    return;
  }

  if (!reminderDraft.title.trim()) {
    alert("Escribe un título para el recordatorio.");
    return;
  }

  const reminder: DateReminder = {
    id: createDateReminderId(),
    workshopId: safeSelectedWorkshopId,
    kind: "normal",
    title: reminderDraft.title.trim().toUpperCase(),
    startDate: reminderDraft.startDate,
    endDate: reminderDraft.endDate,
    color: reminderDraft.color,
    notes: reminderDraft.notes.trim(),
  };

  setDateReminders((prev) => [...prev, reminder]);

  appendLog(
    `Recordatorio creado: ${reminder.title} · ${reminder.startDate} a ${reminder.endDate}.`
  );

  setReminderModalOpen(false);

  setReminderDraft({
    kind: "normal",
    title: "",
    startDate: getTodayKey(),
    endDate: getTodayKey(),
    color: "red",
    notes: "",
    techName: "",
    techStatus: "vacaciones",
  });
}

function deleteDateReminder(id: number) {
  const reminder = dateReminders.find((item) => item.id === id);
  if (!reminder) return;

  const ok = window.confirm(`¿Eliminar el recordatorio "${reminder.title}"?`);
  if (!ok) return;

  setDateReminders((prev) => prev.filter((item) => item.id !== id));

  if (reminder.kind === "tech_status") {
    setScheduledTechStatuses((prev) =>
      prev.filter((item) => {
        if (reminder.techStatusId && item.id === reminder.techStatusId) {
          return false;
        }

        const sameLegacyStatus =
          item.techName === reminder.techName &&
          item.status === reminder.techStatus &&
          item.startDate === reminder.startDate &&
          item.endDate === reminder.endDate;

        return !sameLegacyStatus;
      })
    );
  }

  appendLog(`Recordatorio eliminado: ${reminder.title}.`);
}

  function normalizeMinutes(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return fallback;
  }

  return numberValue;
}

function getTemplateEstimatedMinutes(templateKey: string) {
  const template = quickTemplates.find((item) => item.key === templateKey);

  return normalizeMinutes(template?.standardMinutes, DEFAULT_ESTIMATED_MINUTES);
}

function getEstimatedMinutesWithIncludedTasks(
  templateKey: string,
  includedTaskIds: string[]
) {
  const baseMinutes = getTemplateEstimatedMinutes(templateKey);

  const template = quickTemplates.find((item) => item.key === templateKey);

  if (!template) return baseMinutes;

  const availableTasks = buildSelectableIncludedTasks(
    template.area,
    quickTemplates,
    customExtraTasks,
    template.key
  );

  const selectedTasks = getIncludedTasksByIds(includedTaskIds, availableTasks);

  const extraMinutes = selectedTasks.reduce(
    (total, task) => total + normalizeMinutes(task.standardMinutes, 0),
    0
  );

  return baseMinutes + extraMinutes;
}

 
  function resetDraft(templateKey = quickTemplates[0]?.key ?? "") {
  setDraft({
    templateKey,
    plate: "",
    customerName: "",
    customerPhone: "",
    notes: "",
    urgent: false,
    sendWhatsAppOnSave: true,
    manualReminderEnabled: false,
    manualReminderDate: "",
    manualReminderTime: "",
    sendReminder24h: true,
    sendReminder1h: true,
    estimatedMinutes: getEstimatedMinutesWithIncludedTasks(templateKey, []),
    linkedTemplateKey: "",
    includedTaskIds: [],
    quantity: "1",
  });
}

  function getFirstTemplateForArea(area: AreaKey) {
    return (
      quickTemplates
        .filter((template) => template.area === area)
        .slice()
        .sort((a, b) =>
          a.label.localeCompare(b.label, "es", { sensitivity: "base" })
        )[0] ?? quickTemplates[0]
    );
  }

  function openNewAppointment(date: string, startTime: string) {
    const day = days.find((item) => item.date === date);

    if (!day) return;

    if (isPastDateTime(date, startTime)) {
      alert("No se pueden crear citas en días u horas ya pasadas.");
      return;
    }

    const firstTemplate = getFirstTemplateForArea("camion");
    const firstTemplateKey = firstTemplate?.key ?? "";
    const firstArea = firstTemplate?.area ?? "camion";

    setSelectedArea(firstArea);
    setEditingJobId(null);
    setSelectedSlot({ date, startTime });

    setDraft({
      templateKey: firstTemplateKey,
      plate: "",
      customerName: "",
      customerPhone: "",
      notes: "",
      urgent: false,
      sendWhatsAppOnSave: true,
      manualReminderEnabled: false,
      manualReminderDate: "",
      manualReminderTime: "",
      sendReminder24h: true,
      sendReminder1h: true,
      estimatedMinutes: getEstimatedMinutesWithIncludedTasks(
        firstTemplateKey,
        []
      ),
      linkedTemplateKey: "",
      includedTaskIds: [],
      quantity: "1",
    });
    setIncludedTasksOpen(false);
    setModalOpen(true);
  }

  function openNewAppointmentFromHeader() {
    const currentWeekDays = getWeekDays(0);
    const firstAvailable = getFirstAvailableSlotInWeek(currentWeekDays);

    if (!firstAvailable) {
      alert("No quedan horas disponibles esta semana.");
      return;
    }

    setWeekOffset(0);
    setEditingJobId(null);

    setSelectedSlot({
      date: firstAvailable.date,
      startTime: firstAvailable.startTime,
    });

    const firstTemplate = getFirstTemplateForArea("camion");
    const firstTemplateKey = firstTemplate?.key ?? "";

    setSelectedArea(firstTemplate?.area ?? "camion");

    setDraft({
      templateKey: firstTemplateKey,
      plate: "",
      customerName: "",
      customerPhone: "",
      notes: "",
      urgent: false,
      sendWhatsAppOnSave: true,
      manualReminderEnabled: false,
      manualReminderDate: "",
      manualReminderTime: "",
      sendReminder24h: true,
      sendReminder1h: true,
      estimatedMinutes: getEstimatedMinutesWithIncludedTasks(
        firstTemplateKey,
        []
      ),
      linkedTemplateKey: "",
      includedTaskIds: [],
    quantity: "1",
    });
    setIncludedTasksOpen(false);
    setModalOpen(true);
  }

  function openEditAppointment(job: ScheduledJob) {
    setSelectedArea(job.area);
    setEditingJobId(job.id);

    setSelectedSlot({
      date: getScheduledDate(job),
      startTime: getScheduledStartTime(job),
    });

    setDraft({
      templateKey: job.firstTemplateKey || job.templateKey,
      linkedTemplateKey: job.secondTemplateKey || "",
      plate: job.plate,
      customerName: job.customerName,
      customerPhone: job.customerPhone,
      notes: job.notes || "",
      urgent: job.urgent,
      sendWhatsAppOnSave: false,
      manualReminderEnabled: job.manualReminderEnabled ?? false,
      manualReminderDate: job.manualReminderDate ?? "",
      manualReminderTime: job.manualReminderTime ?? "",
      sendReminder24h: job.sendReminder24h ?? true,
      sendReminder1h: job.sendReminder1h ?? true,
      estimatedMinutes: Math.max(
        15,
        timeToMinutes(getScheduledEndTime(job)) -
          timeToMinutes(getScheduledStartTime(job))
      ),
      includedTaskIds: (job.includedTasks ?? []).map((task) => task.id),
    quantity: String(job.quantity ?? 1),
    });

    setIncludedTasksOpen((job.includedTasks ?? []).length > 0);
    setModalOpen(true);setModalOpen(true);
  }

  async function createScheduledJob() {
    if (!selectedSlot || !draft.templateKey || !draft.plate.trim()) return;

    if (isPastDateTime(selectedSlot.date, selectedSlot.startTime)) {
      alert("No se puede guardar una cita en una fecha u hora pasada.");
      return;
    }

    const selectedLinkedTemplate = linkedTemplates.find(
      (linked) =>
        linked.firstTemplateKey === draft.templateKey &&
        linked.secondTemplateKey === draft.linkedTemplateKey
    );

    const finalTemplateKey = selectedLinkedTemplate
      ? selectedLinkedTemplate.firstTemplateKey
      : draft.templateKey || templatesForSelectedArea[0]?.key || "";

    const template = quickTemplates.find((t) => t.key === finalTemplateKey);

    if (!template) {
      alert("No se encuentra la entrada rápida seleccionada.");
      return;
    }

    const availableTasksForSave = buildSelectableIncludedTasks(
      template.area,
      quickTemplates,
      customExtraTasks,
      template.key
    );

    const includedTasks = getIncludedTasksByIds(
      draft.includedTaskIds,
      availableTasksForSave
    );

    const v2Fields = buildScheduledJobV2FieldsFromTemplate({
  template,
  quantity: draft.quantity,
  includedTasks,
});

const safeEstimatedMinutes = Math.max(
  15,
  normalizeMinutes(v2Fields.estimatedMinutes, DEFAULT_ESTIMATED_MINUTES)
);

    const nextData = {
      workshopId: safeSelectedWorkshopId,
      date: selectedSlot.date,
      startTime: selectedSlot.startTime,
endTime: addMinutesToTime(selectedSlot.startTime, safeEstimatedMinutes),
      templateKey: template.key,
templateLabel: template.label,
area: template.area,

      linkedTemplateId: selectedLinkedTemplate?.id ?? null,
      linkedTemplateLabel: selectedLinkedTemplate?.label ?? null,
      firstTemplateKey: selectedLinkedTemplate?.firstTemplateKey ?? null,
      secondTemplateKey: selectedLinkedTemplate?.secondTemplateKey ?? null,

      plate: draft.plate.trim().toUpperCase(),
      customerName: draft.customerName.trim(),
      customerPhone: draft.customerPhone.trim(),
      notes: draft.notes.trim(),
      urgent: draft.urgent,
      sendWhatsAppOnSave: draft.sendWhatsAppOnSave,
      manualReminderEnabled: draft.manualReminderEnabled,
      manualReminderDate: draft.manualReminderDate,
      manualReminderTime: draft.manualReminderTime,
      sendReminder24h: draft.sendReminder24h,
      sendReminder1h: draft.sendReminder1h,
      whatsappReminder24hSentAtMs: null,
      whatsappReminder1hSentAtMs: null,
      manualReminderSentAtMs: null,
      includedTasks,
      estimatedMinutes: safeEstimatedMinutes,
      quantity: v2Fields.quantity,
      unitMinutes: v2Fields.unitMinutes,
      unitPrice: v2Fields.unitPrice,
      totalPrice: v2Fields.totalPrice,    };

    const logLabel = selectedLinkedTemplate
      ? selectedLinkedTemplate.label
      : includedTasks.length > 0
      ? `${template.label} + ${includedTasks
          .map((task) => task.label)
          .join(" + ")}`
      : template.label;

    if (editingJobId != null) {
      setScheduledJobs((prev) =>
        prev.map((item) =>
          item.id === editingJobId
            ? {
                ...item,
                ...nextData,
              }
            : item
        )
      );

      appendLog(`Cita editada: ${nextData.plate} · ${logLabel}.`);
    } else {
      const scheduled: ScheduledJob = {
        id: Date.now(),
        ...nextData,
        status: "programado",
        assignedTech: null,
        createdAtMs: Date.now(),
      };

      setScheduledJobs((prev) => [...prev, scheduled]);
      appendLog(`Cita programada: ${scheduled.plate} · ${logLabel}.`);

      if (draft.sendWhatsAppOnSave && scheduled.customerPhone.trim()) {
        try {
          await fetch("/api/whatsapp/send-agenda-reminder", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
body: JSON.stringify({
  customerName: scheduled.customerName,
  customerPhone: scheduled.customerPhone,
  jobDescription: getAgendaWhatsappV2Description({
    scheduled,
    baseDescription: logLabel,
  }),
  plate: scheduled.plate,
  date: scheduled.date,
  time: scheduled.startTime,
}),
          });

          appendLog(`WhatsApp enviado a ${scheduled.customerPhone}`);
        } catch (error) {
          console.error("Error enviando WhatsApp automático:", error);
        }
      }
    }

    resetDraft();
    setEditingJobId(null);
    setModalOpen(false);
    setSelectedSlot(null);
  }

  async function deleteScheduledJob(id: number) {
  const job = scheduledJobs.find((item) => item.id === id);
  if (!job) return;

  const ok = window.confirm(
    `¿Eliminar definitivamente la cita ${job.plate} del ${job.date} a las ${job.startTime}?`
  );

  if (!ok) return;

  setScheduledJobs((prev) => prev.filter((item) => item.id !== id));

  try {
    if (deleteScheduledJobFromBackend) {
      await deleteScheduledJobFromBackend(id);
    }

    appendLog(`Cita eliminada: ${job.plate} · ${job.date} · ${job.startTime}.`);
  } catch (error) {
    console.error("Error eliminando cita:", error);

    setScheduledJobs((prev) => {
      const exists = prev.some((item) => item.id === job.id);
      return exists ? prev : [...prev, job];
    });

    appendLog(`Error eliminando cita ${job.plate}.`);

    alert(
      "No se pudo eliminar la cita del servidor. Se ha restaurado en la agenda."
    );
  }
}

  function cleanExpiredScheduledJobs() {
    const now = new Date();
    const nowKey = formatLocalDate(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const expiredJobs = scheduledJobsForSelectedWorkshop.filter((job) => {
      if (job.status === "cancelado") return true;
      if (job.status === "cerrado") return true;

      const jobDate = getScheduledDate(job);
      const jobEndTime = getScheduledEndTime(job);
      const jobEndMinutes = timeToMinutes(jobEndTime);

      if (jobDate < nowKey) return true;
      if (jobDate === nowKey && jobEndMinutes < nowMinutes) return true;

      return false;
    });

    if (expiredJobs.length === 0) {
      alert("No hay citas vencidas para limpiar.");
      return;
    }

    const ok = window.confirm(
      `Se eliminarán ${expiredJobs.length} citas vencidas/canceladas. ¿Continuar?`
    );

    if (!ok) return;

    const expiredIds = new Set(expiredJobs.map((job) => job.id));

    setScheduledJobs((prev) => prev.filter((job) => !expiredIds.has(job.id)));
    appendLog(`Agenda limpiada: ${expiredJobs.length} citas vencidas eliminadas.`);
  }
async function sendAgendaWhatsApp(job: ScheduledJob) {
  try {
    if (!job.customerPhone?.trim()) {
      alert("Esta cita no tiene teléfono de cliente.");
      return;
    }

    const template = quickTemplates.find((t) => t.key === job.templateKey);

    const jobDescription =
      job.linkedTemplateLabel ||
      template?.label ||
      "trabajo programado";

    const res = await fetch("/api/whatsapp/send-agenda-reminder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
  customerName: job.customerName || "cliente",
  customerPhone: job.customerPhone,
  jobDescription: getAgendaWhatsappV2Description({
  scheduled: job,
  baseDescription: jobDescription,
}),
  plate: job.plate,
  date: job.date,
  time: job.startTime,
}),
    });

    const data = await res.json();

    if (!data.success) {
      alert("Error enviando WhatsApp: " + data.message);
      return;
    }

appendLog(
  `WhatsApp reenviado manualmente a ${job.customerName || job.customerPhone} · ${job.plate}.`
);    alert("WhatsApp enviado correctamente.");
  } catch (error) {
    console.error("Error enviando WhatsApp:", error);
    alert("Error conectando con el servidor de WhatsApp.");
  }
}

  const visibleDateReminders = getVisibleDateReminders();
  const allDayReminderRows = Math.max(1, visibleDateReminders.length);

  return (
    <div className="h-screen overflow-hidden bg-slate-50 p-3 text-slate-900">
      <div className="w-full space-y-4">
        <div className="sticky top-0 z-50 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
  <div>
    <h1 className="text-2xl font-semibold">Agenda semanal</h1>
    <p className="text-sm text-slate-500">
      Vista tipo Calendar · lunes a sábado
    </p>
  </div>

  <div className="rounded-2xl border border-slate-200 bg-slate-950 px-5 py-3 text-center shadow-sm">
    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
      Hora actual
    </div>

    <div className="font-mono text-3xl font-black tabular-nums tracking-wider text-white">
      {formatDigitalClock(currentClock)}
    </div>
  </div>
</div>

          <div className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
            Taller: {selectedWorkshop.shortName} · Citas cargadas:{" "}
            {scheduledJobsForSelectedWorkshop.length} · Semana: {days[0]?.date} a{" "}
            {days[5]?.date}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openNewAppointmentFromHeader}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              + Nueva cita
            </button>

            <button
              type="button"
              onClick={openDateReminderModal}
              className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              + Recordatorio fechas
            </button>

            <button
              type="button"
              onClick={cleanExpiredScheduledJobs}
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Limpiar vencidas
            </button>

            <button
              type="button"
              onClick={() => setWeekOffset((v) => v - 1)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium"
            >
              ← Semana anterior
            </button>

            <button
              type="button"
              onClick={() => {
                setWeekOffset(0);
                setSelectedDayDate(getTodayKey());
              }}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium"
            >
              Hoy
            </button>

            <button
              type="button"
              onClick={() => {
                if (calendarMode === "week") {
                  setSelectedDayDate(getTodayKey());
                  setCalendarMode("day");
                } else {
                  setCalendarMode("week");
                }
              }}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium"
            >
              {calendarMode === "week" ? "Vista día" : "Vista semana"}
            </button>

            {calendarMode === "day" && (
              <select
                value={selectedDayDate || getTodayKey()}
                onChange={(e) => setSelectedDayDate(e.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium"
              >
                {days.map((day) => (
                  <option key={day.date} value={day.date}>
                    {day.label}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => setWeekOffset((v) => v + 1)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium"
            >
              Semana siguiente →
            </button>

            <button
              type="button"
              onClick={onBack}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium"
            >
              Volver a operativo
            </button>
          </div>
        </div>

        <div className="h-[calc(100vh-130px)] w-full overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div
            className={`sticky top-0 z-40 grid border-b border-slate-200 bg-white ${
              calendarMode === "day"
                ? "min-w-[900px] grid-cols-[70px_1fr]"
                : "min-w-[1180px] grid-cols-[70px_repeat(6,1fr)]"
            }`}
          >
            <div className="p-3 text-xs font-medium text-slate-500">Hora</div>

            {finalVisibleDays.map((day) => (
              <div
                key={day.date}
                className="border-l border-slate-200 p-3 text-sm font-semibold capitalize"
              >
                {day.label}
              </div>
            ))}
          </div>

          <div
            className={`sticky top-[45px] z-30 grid border-b border-slate-200 bg-white ${
              calendarMode === "day"
                ? "min-w-[900px] grid-cols-[70px_1fr]"
                : "min-w-[1180px] grid-cols-[70px_repeat(6,1fr)]"
            }`}
            style={{
              gridTemplateRows: `repeat(${allDayReminderRows}, minmax(30px, auto))`,
            }}
          >
            <div
              className="z-10 border-r border-slate-200 bg-white p-2 text-[11px] font-bold text-slate-500"
              style={{ gridColumn: "1 / 2", gridRow: `1 / ${allDayReminderRows + 1}` }}
            >
              Todo el día
            </div>

            {finalVisibleDays.map((day, index) => (
              <div
                key={`all-day-bg-${day.date}`}
                className="border-l border-slate-200 bg-slate-50/80"
                style={{
                  gridColumn: `${index + 2} / ${index + 3}`,
                  gridRow: `1 / ${allDayReminderRows + 1}`,
                }}
              />
            ))}

            {visibleDateReminders.map((reminder, index) => {
              const range = getReminderGridRange(reminder);
              if (!range) return null;

              return (
                <div
                  key={reminder.id}
                  title={reminder.notes || reminder.title}
                  className={`z-20 mx-1 my-1 flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[10px] font-black uppercase shadow-sm ${getReminderColorClass(
                    reminder.color
                  )}`}
                  style={{
                    gridColumn: range.gridColumn,
                    gridRow: `${index + 1} / ${index + 2}`,
                  }}
                >
                  <span className="truncate">
                    {reminder.title}
                    <span className="ml-2 font-medium opacity-90">
                      {reminder.startDate} → {reminder.endDate}
                    </span>
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteDateReminder(reminder.id);
                    }}
                    className="shrink-0 rounded bg-white/90 px-1.5 py-0.5 text-[9px] font-black text-slate-700"
                    title="Eliminar recordatorio"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <div
            className={`grid ${
              calendarMode === "day"
                ? "min-w-[900px] grid-cols-[70px_1fr]"
                : "min-w-[1180px] grid-cols-[70px_repeat(6,1fr)]"
            }`}
          >
            <div>
              {getTimeSlotsForDay(0).map((slot) => (
                <div
                  key={slot}
                  style={{ height: SLOT_HEIGHT }}
                  className="border-b border-slate-100 p-2 text-xs text-slate-400"
                >
                  {slot}
                </div>
              ))}
            </div>

            {finalVisibleDays.map((day) => {
              const slots = getTimeSlotsForDay(day.index);
              const dayStart = 8 * 60 + 30;
              const dayHeight = slots.length * SLOT_HEIGHT;

              const dayJobs = scheduledJobsForSelectedWorkshop
  .filter((job) => job.status !== "cancelado")
  .filter((job) => job.status !== "eliminado")
  .filter((job) => getScheduledDate(job) === day.date)
  .map((job) => ({
    ...job,
    startTime: getScheduledStartTime(job),
    endTime: getScheduledEndTime(job),
  }));

              const laidOutJobs = layoutOverlappingJobs(dayJobs);

              const now = new Date();
              const nowMinutes = now.getHours() * 60 + now.getMinutes();
              const showNowLine =
                day.date === todayKey &&
                nowMinutes >= getDayStart(day.index) &&
                nowMinutes <= getDayEnd(day.index);

              return (
                <div
                  key={day.date}
                  className="relative border-l border-slate-200"
                  style={{ height: dayHeight }}
                >
                  {slots.map((slot) => {
                    const working = isWorkingTime(day.index, slot);
                    const past = isPastDateTime(day.date, slot);
                    const disabled = !working || past;

                    let cellClass = "bg-slate-200/70";

                    if (working && !past) {
                      cellClass =
                        "cursor-pointer bg-emerald-50 hover:bg-emerald-100";
                    }

                    if (working && past) {
                      cellClass = "bg-red-50";
                    }

                    return (
                      <div
                        key={`${day.date}-${slot}`}
                        style={{ height: SLOT_HEIGHT }}
                        onClick={() => {
                          if (disabled || !isWorkingTime(day.index, slot)) return;
                          openNewAppointment(day.date, slot);
                        }}
                        className={`relative border-b border-slate-100 ${
                          !isWorkingTime(day.index, slot)
                            ? "cursor-not-allowed bg-slate-200"
                            : cellClass
                        }`}
                      />
                    );
                  })}

                  {showNowLine && (
                    <div
                      className="absolute left-0 right-0 z-30 h-[2px] bg-red-500"
                      style={{
                        top:
                          ((nowMinutes - dayStart) / SLOT_MINUTES) *
                          SLOT_HEIGHT,
                      }}
                    >
                      <div className="absolute -left-2 -top-[5px] h-3 w-3 rounded-full bg-red-500" />
                    </div>
                  )}

                  {laidOutJobs.map(({ job, column, columns }) => {
                    const template = quickTemplates.find(
                      (t) => t.key === job.templateKey
                    );

                    const jobStartTime = getScheduledStartTime(job);
                    const jobEndTime = getScheduledEndTime(job);

                    const start = timeToMinutes(jobStartTime);
                    const end = timeToMinutes(jobEndTime);

                    const safeStart = Math.max(start, dayStart);
                    const safeEnd = Math.min(end, getDayEnd(day.index));

                    const top =
                      ((safeStart - dayStart) / SLOT_MINUTES) * SLOT_HEIGHT;

                    const height = Math.max(
                      50,
                      ((safeEnd - safeStart) / SLOT_MINUTES) * SLOT_HEIGHT - 6
                    );

                    const width = 100 / columns;
                    const left = column * width;

                    return (
                      <div
                        key={job.id}
                        onClick={(e) => {
                          e.stopPropagation();

                          if (
                            job.status === "cerrado" ||
                            job.status === "cancelado"
                          ) {
                            return;
                          }

                          openEditAppointment(job);
                        }}
                        className={`absolute z-40 cursor-pointer overflow-hidden rounded-xl border-2 p-2 text-sm font-semibold shadow-md ${getScheduledJobCardClass(
                          job
                        )}`}
                        style={{
                          top,
                          height,
                          left: `calc(${left}% + 4px)`,
                          width: `calc(${width}% - 8px)`,
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate uppercase">
                            {job.linkedTemplateLabel ||
                              template?.label ||
                              "Operación"}
                          </div>

                          <span className="shrink-0 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-black uppercase text-slate-800">
                            {getScheduledJobStatusLabel(job.status)}
                          </span>
                        </div>

                        {job.includedTasks && job.includedTasks.length > 0 && (
                          <div className="truncate text-[10px] font-normal opacity-90">
                            +{" "}
                            {job.includedTasks
                              .map((task) => task.label)
                              .join(" + ")}
                          </div>
                        )}

                        <div className="truncate">{job.plate}</div>

                        <div className="text-xs font-normal">
                          {jobStartTime} – {jobEndTime}
                        </div>
                        <ScheduledJobV2MiniLine job={job} />

                        {job.customerName && (
                          <div className="truncate text-xs font-normal opacity-90">
                            {job.customerName}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1 text-[9px] font-black">
  {job.sendWhatsAppOnSave && (
    <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-green-700">
      WA guardar
    </span>
  )}

  {job.manualReminderEnabled && (
    <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-emerald-700">
      WA manual
    </span>
  )}

  {job.sendReminder24h && (
    <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-blue-700">
      WA 24h
    </span>
  )}

  {job.sendReminder1h && (
    <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-violet-700">
      WA 1h
    </span>
  )}
</div>
<div className="mt-1 flex flex-wrap gap-1 text-[10px] font-black">
  {job.sendWhatsAppOnSave && (
    <span className="rounded-md bg-green-100 px-1.5 py-0.5 text-green-800">
      WhatsApp guardar
    </span>
  )}

  {job.manualReminderEnabled && (
    <span
      className={`rounded-md px-1.5 py-0.5 ${
        job.manualReminderSentAtMs
          ? "bg-emerald-700 text-white"
          : "bg-emerald-100 text-emerald-800"
      }`}
    >
      {job.manualReminderSentAtMs ? "Manual enviado" : "Manual"}
    </span>
  )}

  {job.sendReminder24h && (
    <span
      className={`rounded-md px-1.5 py-0.5 ${
        job.whatsappReminder24hSentAtMs
          ? "bg-blue-700 text-white"
          : "bg-blue-100 text-blue-800"
      }`}
    >
      {job.whatsappReminder24hSentAtMs ? "24h enviado" : "24h"}
    </span>
  )}

  {job.sendReminder1h && (
    <span
      className={`rounded-md px-1.5 py-0.5 ${
        job.whatsappReminder1hSentAtMs
          ? "bg-violet-700 text-white"
          : "bg-violet-100 text-violet-800"
      }`}
    >
      {job.whatsappReminder1hSentAtMs ? "1h enviado" : "1h"}
    </span>
  )}
</div>
                        {job.notes && (
                          <div className="truncate text-[10px] font-normal opacity-90">
                            Obs: {job.notes}
                          </div>
                        )}

                        <div className="absolute bottom-1 left-1 right-1 flex gap-1">
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      sendAgendaWhatsApp(job);
    }}
    className="flex-1 rounded-md bg-green-500 px-1 py-0.5 text-[9px] font-semibold text-white shadow-sm"
  >
    WhatsApp
  </button>

  {job.status === "programado" && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        cancelScheduledJob(job.id);
      }}
      className="flex-1 rounded-md bg-white/95 px-1 py-0.5 text-[9px] font-semibold text-red-600 shadow-sm"
    >
      Cancelar
    </button>
  )}

  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      deleteScheduledJob(job.id);
    }}
    className="flex-1 rounded-md bg-white/95 px-1 py-0.5 text-[9px] font-semibold text-slate-700 shadow-sm"
  >
    Eliminar
  </button>
</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

{reminderModalOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
    <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
      <h3 className="text-xl font-semibold">Nuevo recordatorio por fechas</h3>

      <p className="mt-1 text-sm text-slate-500">
        Crea un recordatorio normal de agenda o programa el estado de un técnico
        durante un rango de fechas.
      </p>

      <div className="mt-5 space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              setReminderDraft((prev) => ({
                ...prev,
                kind: "normal",
                color: prev.color === "orange" ? "red" : prev.color,
              }))
            }
            className={`rounded-2xl border px-3 py-3 text-sm font-black ${
              reminderDraft.kind === "normal"
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            Recordatorio normal
          </button>

          <button
            type="button"
            onClick={() =>
              setReminderDraft((prev) => ({
                ...prev,
                kind: "tech_status",
                color: "orange",
                title:
                  prev.techName && prev.techStatus
                    ? `${prev.techName} · ${getTechStatusLabel(
                        prev.techStatus
                      )}`
                    : prev.title,
              }))
            }
            className={`rounded-2xl border px-3 py-3 text-sm font-black ${
              reminderDraft.kind === "tech_status"
                ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            Estado técnico
          </button>
        </div>

        {reminderDraft.kind === "tech_status" ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Técnico
                </label>

                <select
                  value={reminderDraft.techName}
                  onChange={(e) => {
                    const techName = e.target.value;

                    setReminderDraft((prev) => ({
                      ...prev,
                      techName,
                      title: techName
                        ? `${techName} · ${getTechStatusLabel(
                            prev.techStatus
                          )}`
                        : prev.title,
                    }));
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">Selecciona técnico</option>
                  {techs.map((tech) => (
                    <option key={tech.name} value={tech.name}>
                      {tech.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Estado
                </label>

                <select
                  value={reminderDraft.techStatus}
                  onChange={(e) => {
                    const techStatus = e.target.value as TechStatus;

                    setReminderDraft((prev) => ({
                      ...prev,
                      techStatus,
                      title: prev.techName
                        ? `${prev.techName} · ${getTechStatusLabel(
                            techStatus
                          )}`
                        : prev.title,
                    }));
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  {SCHEDULED_TECH_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {getTechStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <input
              value={reminderDraft.title}
              onChange={(e) =>
                setReminderDraft((prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
              placeholder="Título del estado técnico"
              className="w-full rounded-2xl border border-slate-200 px-3 py-3 uppercase"
            />
          </>
        ) : (
          <input
            value={reminderDraft.title}
            onChange={(e) =>
              setReminderDraft((prev) => ({
                ...prev,
                title: e.target.value,
              }))
            }
            placeholder="Ej: SUPERVISIÓN TACÓGRAFO JORDI CRUSET"
            className="w-full rounded-2xl border border-slate-200 px-3 py-3 uppercase"
          />
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Fecha inicio
            </label>

            <input
              type="date"
              value={reminderDraft.startDate}
              onChange={(e) =>
                setReminderDraft((prev) => ({
                  ...prev,
                  startDate: e.target.value,
                  endDate:
                    prev.endDate < e.target.value
                      ? e.target.value
                      : prev.endDate,
                }))
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Fecha final
            </label>

            <input
              type="date"
              value={reminderDraft.endDate}
              onChange={(e) =>
                setReminderDraft((prev) => ({
                  ...prev,
                  endDate: e.target.value,
                }))
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <select
          value={reminderDraft.color}
          onChange={(e) =>
            setReminderDraft((prev) => ({
              ...prev,
              color: e.target.value as DateReminderColor,
            }))
          }
          className="w-full rounded-2xl border border-slate-200 px-3 py-3"
        >
          <option value="red">Rojo</option>
          <option value="orange">Naranja</option>
          <option value="blue">Azul</option>
          <option value="green">Verde</option>
          <option value="slate">Gris</option>
        </select>

        <textarea
          value={reminderDraft.notes}
          onChange={(e) =>
            setReminderDraft((prev) => ({
              ...prev,
              notes: e.target.value,
            }))
          }
          placeholder="Observaciones"
          rows={3}
          className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-3"
        />
      </div>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => setReminderModalOpen(false)}
          className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium"
        >
          Cancelar
        </button>

        <button
          type="button"
          onClick={saveDateReminder}
          className="flex-1 rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white"
        >
          {reminderDraft.kind === "tech_status"
            ? "Guardar estado técnico"
            : "Guardar recordatorio"}
        </button>
      </div>
    </div>
  </div>
)}

        {modalOpen && selectedSlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
                <h3 className="text-xl font-semibold">
                  {editingJobId != null ? "Editar cita" : "Nueva cita"}
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  Selecciona día, hora, operación y datos del cliente.
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <div className="mb-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      Día
                    </label>

                    <select
                      value={selectedSlot.date}
                      onChange={(e) => {
                        const nextDate = e.target.value;
                        const day = days.find((d) => d.date === nextDate);

                        if (!day) return;

                        const validSlots = getValidSlotsForDate(
                          nextDate,
                          day.index
                        );

                        if (validSlots.length === 0) {
                          alert("Este día no tiene horas disponibles.");
                          return;
                        }

                        setSelectedSlot({
                          date: nextDate,
                          startTime: validSlots[0],
                        });
                      }}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    >
                      {days.map((day) => (
                        <option
                          key={day.date}
                          value={day.date}
                          disabled={isPastDate(day.date)}
                        >
                          {day.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      Hora
                    </label>

                    <select
                      value={selectedSlot.startTime}
                      onChange={(e) =>
                        setSelectedSlot((prev) =>
                          prev ? { ...prev, startTime: e.target.value } : prev
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    >
                      {(() => {
                        const selectedDay = days.find(
                          (d) => d.date === selectedSlot.date
                        );
                        const slots = selectedDay
                          ? getValidSlotsForDate(
                              selectedSlot.date,
                              selectedDay.index
                            )
                          : [];

                        return slots.map((slot) => (
                          <option key={slot} value={slot}>
                            {slot}
                          </option>
                        ));
                      })()}
                    </select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="grid grid-cols-5 gap-2">
                      {(
                        [
                          "camion",
                          "movil",
                          "tacografo",
                          "turismo",
                          "mecanica",
                        ] as AreaKey[]
                      ).map((area) => {
                        const areaTemplates = quickTemplates
                          .filter((template) => template.area === area)
                          .slice()
                          .sort((a, b) =>
                            a.label.localeCompare(b.label, "es", {
                              sensitivity: "base",
                            })
                          );

                        const areaLinkedTemplates = linkedTemplates
                          .filter((linked) => {
                            const firstTemplate = quickTemplates.find(
                              (template) =>
                                template.key === linked.firstTemplateKey
                            );

                            return firstTemplate?.area === area;
                          })
                          .slice()
                          .sort((a, b) =>
                            a.label.localeCompare(b.label, "es", {
                              sensitivity: "base",
                            })
                          );

                        const meta = AREA_META[area];
                        const Icon = meta.icon;
                        const active = selectedArea === area;
                        const totalEntries =
                          areaTemplates.length + areaLinkedTemplates.length;

                        return (
                          <button
                            key={area}
                            type="button"
                            onClick={() => {
                              const firstLinked = areaLinkedTemplates[0];
                              const firstTemplate = areaTemplates[0];

                              const nextTemplateKey = firstLinked
                                ? firstLinked.firstTemplateKey
                                : firstTemplate?.key ?? "";

                              setSelectedArea(area);

                              setDraft((prev) => ({
                                ...prev,
                                templateKey: nextTemplateKey,
                                linkedTemplateKey: firstLinked
                                  ? firstLinked.secondTemplateKey
                                  : "",
                                includedTaskIds: [],
                                estimatedMinutes:
                                  getEstimatedMinutesWithIncludedTasks(
                                    nextTemplateKey,
                                    []
                                  ),
                              }));
                            }}
                            className={`rounded-2xl border px-2 py-2 text-xs font-semibold transition ${meta.color} ${
                              active
                                ? "ring-2 ring-slate-900 ring-offset-2"
                                : "opacity-80 hover:opacity-100"
                            }`}
                            title={meta.label}
                          >
                            <Icon className="mx-auto mb-1 h-4 w-4" />

                            <span className="block truncate font-bold">
                              {meta.label}
                            </span>

                            <span className="mt-1 block text-[10px] font-medium opacity-70">
                              {totalEntries} entradas
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {(() => {
                      const linkedTemplatesForSelectedArea = linkedTemplates
                        .filter((linked) => {
                          const firstTemplate = quickTemplates.find(
                            (template) =>
                              template.key === linked.firstTemplateKey
                          );

                          return firstTemplate?.area === selectedArea;
                        })
                        .slice()
                        .sort((a, b) =>
                          a.label.localeCompare(b.label, "es", {
                            sensitivity: "base",
                          })
                        );

                      const templatesForSelectedAreaSorted = quickTemplates
                        .filter((template) => template.area === selectedArea)
                        .slice()
                        .sort((a, b) =>
                          a.label.localeCompare(b.label, "es", {
                            sensitivity: "base",
                          })
                        );

                      const hasEntries =
                        linkedTemplatesForSelectedArea.length > 0 ||
                        templatesForSelectedAreaSorted.length > 0;

                      const selectedValue = draft.linkedTemplateKey
                        ? `${draft.templateKey}|||${draft.linkedTemplateKey}`
                        : draft.templateKey;

                      return (
                        <select
                          value={hasEntries ? selectedValue : ""}
                          disabled={!hasEntries}
                          onChange={(e) => {
  const [templateKey, linkedTemplateKey] = e.target.value.split("|||");
  const nextIncludedTaskIds: string[] = [];

  setIncludedTasksOpen(false);

  const nextTemplate = quickTemplates.find((item) => item.key === templateKey);

const nextV2 = nextTemplate
  ? buildScheduledJobV2FieldsFromTemplate({
      template: nextTemplate,
      quantity: "1",
      includedTasks: [],
    })
  : null;

setDraft((prev) => ({
  ...prev,
  templateKey,
  linkedTemplateKey: linkedTemplateKey || "",
  includedTaskIds: nextIncludedTaskIds,
  quantity: "1",
  estimatedMinutes: nextV2
    ? Math.max(15, nextV2.estimatedMinutes)
    : getEstimatedMinutesWithIncludedTasks(templateKey, nextIncludedTaskIds),
}));
}}
                          className="w-full rounded-2xl border-2 border-yellow-300 bg-yellow-100 px-3 py-3 font-black text-red-700 shadow-sm disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {!hasEntries && (
                            <option value="">
                              Sin entradas rápidas para{" "}
                              {AREA_META[selectedArea].label}
                            </option>
                          )}

                          {linkedTemplatesForSelectedArea.length > 0 && (
                            <optgroup label="Trabajos vinculados">
                              {linkedTemplatesForSelectedArea.map((linked) => (
                                <option
                                  key={linked.id}
                                  value={`${linked.firstTemplateKey}|||${linked.secondTemplateKey}`}
                                  className="bg-yellow-100 font-bold text-red-700"
                                >
                                  {linked.label}
                                </option>
                              ))}
                            </optgroup>
                          )}

                          {templatesForSelectedAreaSorted.length > 0 && (
                            <optgroup label="Entradas rápidas">
                              {templatesForSelectedAreaSorted.map(
                                (template) => (
                                  <option
                                    key={template.key}
                                    value={template.key}
                                    className="bg-yellow-100 font-bold text-red-700"
                                  >
                                    {template.label}
                                  </option>
                                )
                              )}
                            </optgroup>
                          )}
                        </select>
                      );
                    })()}

                    <ScheduledJobQuantityBox
                      template={selectedTemplate ?? null}
                      quantity={draft.quantity}
                      includedTasks={selectedIncludedTasks}
                      onQuantityChange={(value) => {
                        const nextV2 = selectedTemplate
                          ? buildScheduledJobV2FieldsFromTemplate({
                              template: selectedTemplate,
                              quantity: value,
                              includedTasks: selectedIncludedTasks,
                            })
                          : null;

                        setDraft((prev) => ({
                          ...prev,
                          quantity: value,
                          estimatedMinutes: nextV2
                            ? Math.max(15, nextV2.estimatedMinutes)
                            : prev.estimatedMinutes,
                        }));
                      }}
                    />
                  </div>

                  {availableIncludedTasks.length > 0 && (
  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
    <button
      type="button"
      onClick={() => setIncludedTasksOpen((prev) => !prev)}
      className="flex w-full items-center justify-between gap-3 text-left"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-emerald-900">
          Añadir tareas al mismo trabajo
        </div>

        <div className="mt-1 text-xs text-emerald-700">
          {selectedIncludedTasks.length > 0
            ? `${selectedIncludedTasks.length} tarea${
                selectedIncludedTasks.length === 1 ? "" : "s"
              } seleccionada${
                selectedIncludedTasks.length === 1 ? "" : "s"
              }`
            : "Opcional · pulsa para desplegar la lista"}
        </div>
      </div>

      <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-800 shadow-sm">
        {includedTasksOpen ? "▲" : "▼"}
      </span>
    </button>

    {selectedIncludedTasks.length > 0 && (
      <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-800">
        Se añadirán al mismo trabajo:{" "}
        <span className="font-semibold">
          {selectedIncludedTasks.map((task) => task.label).join(" + ")}
        </span>
      </div>
    )}

    {includedTasksOpen && (
      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
        {availableIncludedTasks.map((task) => {
          const checked = draft.includedTaskIds.includes(task.id);

          return (
            <label
              key={task.id}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setDraft((prev) => {
                      const nextIncludedTaskIds = e.target.checked
                        ? Array.from(
                            new Set([...prev.includedTaskIds, task.id])
                          )
                        : prev.includedTaskIds.filter((id) => id !== task.id);

                      return {
                        ...prev,
                        includedTaskIds: nextIncludedTaskIds,
                        estimatedMinutes: getEstimatedMinutesWithIncludedTasks(
                          prev.templateKey,
                          nextIncludedTaskIds
                        ),
                      };
                    });
                  }}
                  className="h-4 w-4 shrink-0"
                />

                <span className="truncate font-medium text-emerald-900">
                  {task.label}
                </span>
              </span>

              {task.standardMinutes != null && (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {task.standardMinutes} min
                </span>
              )}
            </label>
          );
        })}
      </div>
    )}
  </div>
)}

                  <input
                    value={draft.plate}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, plate: e.target.value }))
                    }
                    placeholder="Matrícula"
                    className="w-full rounded-2xl border border-slate-200 px-3 py-3 uppercase"
                  />

                  <input
                    value={draft.customerName}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        customerName: e.target.value,
                      }))
                    }
                    placeholder="Nombre cliente"
                    className="w-full rounded-2xl border border-slate-200 px-3 py-3"
                  />

                  <input
                    value={draft.customerPhone}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        customerPhone: e.target.value,
                      }))
                    }
                    placeholder="Teléfono móvil"
                    className="w-full rounded-2xl border border-slate-200 px-3 py-3"
                  />

                  <textarea
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    placeholder="Observaciones"
                    rows={3}
                    className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-3"
                  />

                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={draft.estimatedMinutes}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        estimatedMinutes:
                          Number(e.target.value) || DEFAULT_ESTIMATED_MINUTES,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 px-3 py-3"
                    placeholder="Duración prevista en minutos"
                  />

                  <div className="rounded-2xl border border-slate-200 px-3 py-3 text-sm text-slate-500">
                    Fin previsto:{" "}
                    <span className="font-medium text-slate-900">
                      {addMinutesToTime(
                        selectedSlot.startTime,
                        draft.estimatedMinutes
                      )}
                    </span>
                  </div>

                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={draft.urgent}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          urgent: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm font-medium">Urgente</span>
                  </label>

                  <label className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={draft.sendWhatsAppOnSave}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          sendWhatsAppOnSave: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm font-bold text-green-800">
                      Enviar WhatsApp al guardar cita
                    </span>
                  </label>

                  <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-3">
                    <div className="text-sm font-black text-green-900">
                      Recordatorios WhatsApp
                    </div>

                    <label className="flex items-center gap-3 rounded-xl bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        checked={draft.manualReminderEnabled}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            manualReminderEnabled: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-bold text-green-800">
                        Programar recordatorio manual
                      </span>
                    </label>

                    {draft.manualReminderEnabled && (
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          type="date"
                          value={draft.manualReminderDate}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              manualReminderDate: e.target.value,
                            }))
                          }
                          className="rounded-xl border border-green-200 px-3 py-2 text-sm"
                        />

                        <input
                          type="time"
                          value={draft.manualReminderTime}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              manualReminderTime: e.target.value,
                            }))
                          }
                          className="rounded-xl border border-green-200 px-3 py-2 text-sm"
                        />
                      </div>
                    )}

                    <label className="flex items-center gap-3 rounded-xl bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        checked={draft.sendReminder24h}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            sendReminder24h: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-bold text-green-800">
                        Recordatorio 24h antes
                      </span>
                    </label>

                    <label className="flex items-center gap-3 rounded-xl bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        checked={draft.sendReminder1h}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            sendReminder1h: e.target.checked,
                          }))
                        }
                      />
                      <span className="text-sm font-bold text-green-800">
                        Recordatorio 1h antes
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setModalOpen(false);
                      setEditingJobId(null);
                      setSelectedSlot(null);
                      resetDraft();
                    }}
                    className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    onClick={createScheduledJob}
                    disabled={
                      !draft.plate.trim() ||
                      !draft.templateKey ||
                      quickTemplates.length === 0 ||
                      !selectedSlot ||
                      isPastDateTime(selectedSlot.date, selectedSlot.startTime)
                    }
                    className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {editingJobId != null ? "Guardar cambios" : "Guardar cita"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}