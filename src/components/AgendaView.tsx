import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  type IncludedTask,
  type CustomExtraTask,
  buildSelectableIncludedTasks,
  getIncludedTasksByIds,
} from "../modules/quickTaskSelector";

type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";

type ScheduledJobStatus =
  | "programado"
  | "en_cola"
  | "activo"
  | "cerrado"
  | "cancelado"
  | "llego";

type QuickTemplate = {
  key: string;
  label: string;
  area: AreaKey;
  mode: "single" | "team";
  allowedTechs: string[];
  priorityOrder: string[];
  standardMinutes?: number | null;
};

export type ScheduledJob = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  templateKey: string;
  area: AreaKey;
  plate: string;
  customerName: string;
  customerPhone: string;
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
};

type Props = {
  scheduledJobs: ScheduledJob[];
  setScheduledJobs: Dispatch<SetStateAction<ScheduledJob[]>>;
  quickTemplates: QuickTemplate[];
  customExtraTasks?: CustomExtraTask[];
  AREA_META: any;
  onBack: () => void;
  appendLog: (text: string) => void;
  confirmScheduledArrival: (scheduled: ScheduledJob) => void;
  cancelScheduledJob: (id: number) => void;
  linkedTemplates?: {
    id: string;
    label: string;
    firstTemplateKey: string;
    secondTemplateKey: string;
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
  customExtraTasks = [],
  linkedTemplates = [],
  AREA_META,
  onBack,
  appendLog,
  cancelScheduledJob,
}: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState<"week" | "day">("week");
  const [selectedDayDate, setSelectedDayDate] = useState<string>("");
  const [editingJobId, setEditingJobId] = useState<number | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<{
    date: string;
    startTime: string;
  } | null>(null);

  const [selectedArea, setSelectedArea] = useState<AreaKey>("camion");

  const [draft, setDraft] = useState({
    templateKey: quickTemplates[0]?.key ?? "",
    plate: "",
    customerName: "",
    customerPhone: "",
    notes: "",
    urgent: false,
    estimatedMinutes: DEFAULT_ESTIMATED_MINUTES,
    linkedTemplateKey: "",
    includedTaskIds: [] as string[],
  });

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
      estimatedMinutes: getEstimatedMinutesWithIncludedTasks(templateKey, []),
      linkedTemplateKey: "",
      includedTaskIds: [],
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
      estimatedMinutes: getEstimatedMinutesWithIncludedTasks(
        firstTemplateKey,
        []
      ),
      linkedTemplateKey: "",
      includedTaskIds: [],
    });

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
      estimatedMinutes: getEstimatedMinutesWithIncludedTasks(
        firstTemplateKey,
        []
      ),
      linkedTemplateKey: "",
      includedTaskIds: [],
    });

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
      estimatedMinutes: Math.max(
        15,
        timeToMinutes(getScheduledEndTime(job)) -
          timeToMinutes(getScheduledStartTime(job))
      ),
      includedTaskIds: (job.includedTasks ?? []).map((task) => task.id),
    });

    setModalOpen(true);
  }

  function createScheduledJob() {
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

    const estimatedMinutes = getEstimatedMinutesWithIncludedTasks(
  template.key,
  draft.includedTaskIds
);

const safeEstimatedMinutes = Math.max(
  15,
  normalizeMinutes(estimatedMinutes, DEFAULT_ESTIMATED_MINUTES)
);

    const nextData = {
      date: selectedSlot.date,
      startTime: selectedSlot.startTime,
endTime: addMinutesToTime(selectedSlot.startTime, safeEstimatedMinutes),
      templateKey: template.key,
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
      includedTasks,
estimatedMinutes: safeEstimatedMinutes,    };

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
    }

    resetDraft();
    setEditingJobId(null);
    setModalOpen(false);
    setSelectedSlot(null);
  }

  function deleteScheduledJob(id: number) {
    const job = scheduledJobs.find((item) => item.id === id);
    if (!job) return;

    const ok = window.confirm(
      `¿Eliminar definitivamente la cita ${job.plate} del ${job.date} a las ${job.startTime}?`
    );

    if (!ok) return;

    setScheduledJobs((prev) => prev.filter((item) => item.id !== id));

    appendLog(`Cita eliminada: ${job.plate} · ${job.date} · ${job.startTime}.`);
  }

  function cleanExpiredScheduledJobs() {
    const now = new Date();
    const nowKey = formatLocalDate(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const expiredJobs = scheduledJobs.filter((job) => {
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

  return (
    <div className="h-screen overflow-hidden bg-slate-50 p-3 text-slate-900">
      <div className="w-full space-y-4">
        <div className="sticky top-0 z-50 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Agenda semanal</h1>
            <p className="text-sm text-slate-500">
              Vista tipo Calendar · lunes a sábado
            </p>
          </div>

          <div className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
            Citas cargadas: {scheduledJobs.length} · Semana: {days[0]?.date} a{" "}
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

              const dayJobs = scheduledJobs
                .filter((job) => job.status !== "cancelado")
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

                        {job.customerName && (
                          <div className="truncate text-xs font-normal opacity-90">
                            {job.customerName}
                          </div>
                        )}

                        {job.notes && (
                          <div className="truncate text-[10px] font-normal opacity-90">
                            Obs: {job.notes}
                          </div>
                        )}

                        <div className="absolute bottom-1 left-1 right-1 flex gap-1">
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

  setDraft((prev) => ({
    ...prev,
    templateKey,
    linkedTemplateKey: linkedTemplateKey || "",
    includedTaskIds: nextIncludedTaskIds,
    estimatedMinutes: getEstimatedMinutesWithIncludedTasks(
      templateKey,
      nextIncludedTaskIds
    ),
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
                  </div>

                  {availableIncludedTasks.length > 0 && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                      <div className="mb-2 text-sm font-semibold text-emerald-900">
                        Añadir tareas al mismo trabajo
                      </div>

                      <div className="space-y-2">
                        {availableIncludedTasks.map((task) => {
                          const checked = draft.includedTaskIds.includes(
                            task.id
                          );

                          return (
                            <label
                              key={task.id}
                              className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm"
                            >
                              <span className="flex items-center gap-2">
                               <input
  type="checkbox"
  checked={checked}
  onChange={(e) => {
    setDraft((prev) => {
      const nextIncludedTaskIds = e.target.checked
        ? Array.from(new Set([...prev.includedTaskIds, task.id]))
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
/>

                                <span className="font-medium text-emerald-900">
                                  {task.label}
                                </span>
                              </span>

                              {task.standardMinutes != null && (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  {task.standardMinutes} min
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      {selectedIncludedTasks.length > 0 && (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-800">
                          Se añadirán al mismo trabajo:{" "}
                          <span className="font-semibold">
                            {selectedIncludedTasks
                              .map((task) => task.label)
                              .join(" + ")}
                          </span>
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