import { useState, type Dispatch, type SetStateAction } from "react";
import AgendaView from "./AgendaView";
import { AREA_META } from "../modules/workshopConstants";
import { API_BASE, deleteScheduledJobFromBackend, fetchWithTimeout } from "../modules/workshopApi";
import { getAdminHeaders } from "../modules/adminHeaders";
import { formatMinutes } from "../modules/time";
import { getOperationLabel, getWorkedMinutes } from "../modules/jobHelpers";
import { canAssignTechManuallyToJob, canSelectTechManuallyForJob } from "../modules/assignment";
import { isHardBlockedTechStatus } from "../modules/techStatus";
import { isManualUnavailableStatus } from "../modules/techSync";
import type { ScheduledTechStatus } from "../modules/techStatusScheduleHelpers";
import type { CustomExtraTask } from "../modules/quickTaskSelector";
import type { QuickDraftState } from "../modules/quickEntryV2State";
import type { MaintenanceTask } from "../modules/maintenanceApi";
import type { AppView } from "../modules/permissions";
import type {
  AreaKey,
  Job,
  LinkedTemplate,
  QuickTemplate,
  Tech,
} from "../modules/workshopTypes";
import type { WorkshopId } from "../modules/workshops";
import type { useScheduledJobs } from "../modules/useScheduledJobs";
import type { useRoadside } from "../modules/useRoadside";
import type { MaintenanceAvailability } from "../modules/useMaintenanceAvailability";

type MaintenanceDraft = { taskId: string; techName: string };

export type Operativo2ViewProps = {
  // Identidad / navegación
  userName: string | null;
  setView: (view: AppView) => void;
  canView: (view: AppView) => boolean;

  // Datos del taller
  jobs: Job[];
  visibleJobs: Job[];
  visibleTechs: Tech[];
  quickTemplates: QuickTemplate[];
  visibleQuickTemplates: QuickTemplate[];
  visibleLinkedTemplates: LinkedTemplate[];
  customExtraTasks: CustomExtraTask[];
  selectedWorkshopId: WorkshopId;
  maintenanceTasks: MaintenanceTask[];
  maintenanceTechCandidates: Tech[];

  // Derivados
  availableTechsSummary: { name: string }[];
  workingTechsSummary: { name: string }[];
  runningJobs: Job[];
  waitingJobs: Job[];
  pausedJobs: Job[];
  validationJobs: Job[];

  // Entradas rápidas / mantenimiento
  quickDraft: QuickDraftState;
  setQuickDraft: Dispatch<SetStateAction<QuickDraftState>>;
  quickSelectedArea: AreaKey;
  setQuickSelectedArea: Dispatch<SetStateAction<AreaKey>>;
  quickSelectedMode: "quick" | "maintenance";
  setQuickSelectedMode: Dispatch<SetStateAction<"quick" | "maintenance">>;
  maintenanceDraft: MaintenanceDraft;
  setMaintenanceDraft: Dispatch<SetStateAction<MaintenanceDraft>>;
  setQuickEntryOpen: Dispatch<SetStateAction<boolean>>;

  // Estados programados de técnicos
  scheduledTechStatuses: ScheduledTechStatus[];
  setScheduledTechStatuses: Dispatch<SetStateAction<ScheduledTechStatus[]>>;

  // Hooks del panel
  agenda: ReturnType<typeof useScheduledJobs>;
  roadside: ReturnType<typeof useRoadside>;
  maintenanceAvailability: MaintenanceAvailability;
  reloadMaintenanceAvailabilityFromBackend: () => Promise<void> | void;
  isTechBlockedByOutsideMaintenance: (techName: string) => boolean;

  // Acciones del ciclo de trabajo (viven en el panel)
  appendLog: (text: string) => void;
  assignQuickMaintenanceTask: () => Promise<void> | void;
  deleteWaitingJob: (jobId: number) => Promise<void> | void;
  pauseJob: (jobId: number) => Promise<void> | void;
  reactivatePausedJob: (jobId: number) => Promise<void> | void;
  updateValidationResponsible: (jobId: number, responsibleName: string) => void;
  addValidationExtraSupport: (jobId: number, supportName: string) => void;
  removeValidationSupportByName: (jobId: number, nameToRemove: string) => void;
  authorizeProposedJob: (jobId: number) => Promise<void> | void;
  rejectProposedJob: (jobId: number) => Promise<void> | void;
  assignOrReserveWaitingJobManually: (jobId: number, techName: string) => Promise<void> | void;
  deleteValidationJob: (jobId: number) => Promise<void> | void;
  sendValidationJobToQueue: (jobId: number) => void;
  finishJob: (jobId: number) => Promise<void> | void;
  reassignJob: (jobId: number, techName: string) => void;
  addExtraSupportToJob: (jobId: number, supportName: string) => void;
  removeSupportByNameFromJob: (jobId: number, nameToRemove: string) => void;

  /** Furgonetas activas del taller y las que ya están retenidas por otro trabajo. */
  furgonetas: { id: number; name: string; plate?: string | null }[];
  furgonetasOcupadasEnTaller: Map<number, string>;
  furgonetasEnAsistencia: Set<string>;
  asignarFurgonetaAlTrabajo: (jobId: number, vehicleId: number | null) => Promise<void> | void;

  /**
   * Modo embebido (Mobilink WorkPlanner): la vista fluye dentro del layout del
   * módulo en vez de ocupar la pantalla como overlay, y oculta su barra de
   * navegación al resto de vistas del panel de taller.
   */
  embebido?: boolean;
};

/**
 * Vista "Operativo 2": tablero oscuro con el estado del taller (trabajando,
 * disponibles, cola, validaciones) y las entradas rápidas.
 *
 * Extraída de SeaTarragonaV1 sin cambios de comportamiento: toda la lógica de
 * negocio (asignar, pausar, cerrar, autorizar…) sigue viviendo en el panel y
 * llega aquí como props, de modo que la vista pueda montarse también desde
 * Mobilink WorkPlanner.
 */
export default function Operativo2View({
  userName,
  setView,
  canView,
  jobs,
  visibleJobs,
  visibleTechs,
  quickTemplates,
  visibleQuickTemplates,
  visibleLinkedTemplates,
  customExtraTasks,
  selectedWorkshopId,
  maintenanceTasks,
  maintenanceTechCandidates,
  availableTechsSummary,
  workingTechsSummary,
  runningJobs,
  waitingJobs,
  pausedJobs,
  validationJobs,
  quickDraft,
  setQuickDraft,
  quickSelectedArea,
  setQuickSelectedArea,
  quickSelectedMode,
  setQuickSelectedMode,
  maintenanceDraft,
  setMaintenanceDraft,
  setQuickEntryOpen,
  scheduledTechStatuses,
  setScheduledTechStatuses,
  agenda,
  roadside,
  maintenanceAvailability,
  reloadMaintenanceAvailabilityFromBackend,
  isTechBlockedByOutsideMaintenance,
  appendLog,
  assignQuickMaintenanceTask,
  deleteWaitingJob,
  pauseJob,
  reactivatePausedJob,
  updateValidationResponsible,
  addValidationExtraSupport,
  removeValidationSupportByName,
  authorizeProposedJob,
  rejectProposedJob,
  assignOrReserveWaitingJobManually,
  deleteValidationJob,
  sendValidationJobToQueue,
  finishJob,
  reassignJob,
  addExtraSupportToJob,
  removeSupportByNameFromJob,
  furgonetas,
  furgonetasOcupadasEnTaller,
  furgonetasEnAsistencia,
  asignarFurgonetaAlTrabajo,
  embebido,
}: Operativo2ViewProps) {
  const [op2CitaOpen, setOp2CitaOpen] = useState(false);
  const isTestTech = (name: string) => /prova|prueba|\btest\b/i.test(name);
  const disponibles = availableTechsSummary.filter((t) => !isTestTech(t.name));
  const responsables = new Set<string>();
  const soportes = new Set<string>();
  for (const j of runningJobs) (j.assignedNames || []).forEach((n, i) => (i === 0 ? responsables : soportes).add(n));

  // Asistencias de carretera en curso (el operario asignado está trabajando)
  const ROADSIDE_ACTIVE = ["asignada", "en_camino", "en_punto", "inicio_reparacion", "en_camino_base"];
  const ROADSIDE_LABEL: Record<string, string> = { asignada: "Asignada", en_camino: "En camino", en_punto: "En punto", inicio_reparacion: "Reparando", en_camino_base: "Volviendo" };
  const activeAssistances = (roadside.visibleRoadsideAssistances ?? []).filter(
    (a) => ROADSIDE_ACTIVE.includes(a.status) && a.assignedTechName
  );
  for (const a of activeAssistances) if (a.assignedTechName) responsables.add(a.assignedTechName);
  // Técnicos ocupados en una asistencia de carretera: no elegibles para nada.
  const roadsideBusyTechNames = new Set(activeAssistances.map((a) => a.assignedTechName as string).filter(Boolean));

  // Tareas de mantenimiento en curso.
  // Si el técnico ya está ocupado en un trabajo real (responsable/apoyo) o en carretera,
  // se ignora su tarea de mantenimiento (no puede estar en dos sitios a la vez).
  const busyTechNames = new Set<string>([...responsables, ...soportes]);
  const maintActive = (maintenanceAvailability.activeMaintenanceTasks ?? []).filter(
    (t) => t.techName && !isTestTech(t.techName) && !busyTechNames.has(t.techName)
  );
  const maintTechNames = new Set(maintActive.map((t) => t.techName));

  // TRABAJANDO: técnicos de taller ocupados + operarios de asistencias + mantenimiento
  const trabajandoNames = Array.from(new Set([
    ...workingTechsSummary.map((t) => t.name),
    ...activeAssistances.map((a) => a.assignedTechName as string),
    ...maintActive.map((t) => t.techName),
  ])).filter((n) => !isTestTech(n));
  const trabajando = trabajandoNames.map((name) => ({ name }));
  const techColor = (n: string) => (responsables.has(n) ? "text-rose-400" : soportes.has(n) ? "text-orange-400" : maintTechNames.has(n) ? "text-yellow-300" : "text-slate-200");
  /**
   * Selector de unidad móvil para los trabajos del área "movil". Se ocultan
   * las furgonetas que ya retiene otro trabajo o una asistencia en curso; la
   * del propio trabajo siempre se ve, para poder cambiarla o liberarla.
   */
  function SelectorFurgoneta({ job }: { job: Job }) {
    if (job.area !== "movil") return null;

    const disponibles = furgonetas.filter((v) => {
      if (v.id === job.assignedVehicleId) return true;
      if (furgonetasOcupadasEnTaller.has(v.id)) return false;
      if (furgonetasEnAsistencia.has(v.name)) return false;
      return true;
    });

    return (
      <select
        value={job.assignedVehicleId ?? ""}
        onChange={(e) => {
          const valor = e.target.value;
          void asignarFurgonetaAlTrabajo(job.id, valor ? Number(valor) : null);
        }}
        title="Unidad móvil asignada"
        className={`rounded border px-1.5 py-1 text-[11px] ${
          job.assignedVehicleId
            ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
            : "border-rose-500/60 bg-rose-500/10 text-rose-200"
        }`}
      >
        <option value="">🚐 Furgoneta…</option>
        {disponibles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}{v.plate ? ` · ${v.plate}` : ""}
          </option>
        ))}
      </select>
    );
  }

  const agendados = agenda.dueScheduledJobs ?? [];
  const refuerzos = visibleTechs.filter((t) => !isTestTech(t.name) && t.status === "refuerzo");
  const bloqueadosCount = visibleJobs.filter((j) => j.status === "bloqueado").length;

  return (
    <div
      className={
        embebido
          // Dentro de WorkPlanner sigue siendo una capa fija (por debajo de la
          // topbar del módulo y de los diálogos del panel, que van a z-50): así
          // tapa el resto del árbol del panel, que se monta detrás para que sus
          // diálogos —entrada rápida, plantillas…— sigan funcionando.
          ? "fixed inset-x-0 bottom-0 top-[44px] z-30 overflow-auto bg-slate-900 p-3 text-slate-100"
          : "fixed inset-0 z-40 overflow-auto bg-slate-900 p-3 text-slate-100"
      }
    >
      {/* Barra superior (solo en el panel: dentro de WorkPlanner navega su menú) */}
      <div className={`mb-2 items-center justify-between ${embebido ? "hidden" : "flex"}`}>
        <span className="text-sm font-bold">📊 Mobilink · Operativo 2{userName ? <span className="ml-2 rounded bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-100">👤 {userName}</span> : null}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setView("operarios"); void reloadMaintenanceAvailabilityFromBackend(); }} className="rounded bg-sky-700 px-3 py-1 text-[12px] font-semibold text-white hover:bg-sky-600">Técnicos</button>
          <button type="button" onClick={() => setView("entradas2")} className="rounded bg-emerald-700 px-3 py-1 text-[12px] font-semibold text-white hover:bg-emerald-600">ER</button>
          {(canView("agenda2") || canView("agenda")) && (
            <button type="button" onClick={() => setView("agenda2")} className="rounded bg-amber-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-amber-500">Agenda 2</button>
          )}
          <button type="button" onClick={() => { window.location.href = "/administracion"; }} className="rounded bg-indigo-700 px-3 py-1 text-[12px] font-semibold text-white hover:bg-indigo-600">Administración</button>
          <button type="button" onClick={() => setView("operativo")} className="rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200 hover:bg-slate-700">← Volver</button>
        </div>
      </div>
      {/* Cabecera */}
      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="mb-1 text-[10px] font-bold text-sky-300">TRABAJANDO ({trabajando.length})</div>
          <div className="flex flex-wrap gap-1">
            {trabajando.length === 0 ? <span className="text-[11px] text-slate-500">—</span> :
              trabajando.map((t) => <span key={t.name} className={`rounded bg-slate-700 px-1.5 py-0.5 text-[11px] font-semibold ${techColor(t.name)}`}>{t.name}</span>)}
          </div>
          <div className="mt-1 text-[9px] text-slate-500"><span className="text-rose-400">●</span> responsable · <span className="text-orange-400">●</span> soporte</div>
        </div>
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="mb-1 text-[10px] font-bold text-emerald-300">DISPONIBLES ({disponibles.length})</div>
          <div className="flex flex-wrap gap-1">
            {disponibles.length === 0 ? <span className="text-[11px] text-slate-500">—</span> :
              disponibles.map((t) => <span key={t.name} className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] text-emerald-300">{t.name}</span>)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="mb-1 text-[10px] font-bold text-sky-300">RESUMEN</div>
          <div className="flex flex-wrap gap-1 text-[11px]">
            <span className="rounded bg-slate-700 px-1.5 py-0.5">Activos {runningJobs.length + activeAssistances.length + maintActive.length}</span>
            <span className="rounded bg-slate-700 px-1.5 py-0.5">Cola {waitingJobs.length}</span>
            <span className="rounded bg-slate-700 px-1.5 py-0.5">Stand by {pausedJobs.length}</span>
            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-rose-400">Urgentes {runningJobs.filter((j) => j.urgent).length}</span>
          </div>
        </div>
      </div>

      {/* Entradas rápidas */}
      <div className="mt-2 rounded-lg bg-slate-800 p-2">
        <div className="mb-1 text-[10px] font-bold text-slate-400">ENTRADAS RÁPIDAS</div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {(Object.keys(AREA_META) as AreaKey[]).map((a) => {
            const meta = AREA_META[a];
            const Icon = meta.icon;
            const count = quickTemplates.filter((t) => t.area === a).length;
            const active = quickSelectedMode === "quick" && quickSelectedArea === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setQuickSelectedMode("quick");
                  setQuickSelectedArea(a);
                  const first = quickTemplates.filter((t) => t.area === a).sort((x, y) => x.label.localeCompare(y.label, "es"))[0];
                  setQuickDraft((prev) => ({ ...prev, templateKey: first?.key ?? "", linkedTemplateKey: "", includedTaskIds: [] }));
                }}
                className={`flex flex-col items-center gap-0.5 rounded-lg border p-2 ${active ? "border-sky-400 bg-slate-700" : "border-slate-600 bg-slate-900"}`}
              >
                <Icon className="h-4 w-4 text-slate-200" />
                <span className="text-[11px] font-semibold">{meta.label}</span>
                <span className="text-[9px] text-slate-500">{count} entradas</span>
              </button>
            );
          })}
          {/* Mantenimiento */}
          <button
            type="button"
            onClick={() => setQuickSelectedMode("maintenance")}
            className={`flex flex-col items-center gap-0.5 rounded-lg border p-2 ${quickSelectedMode === "maintenance" ? "border-amber-400 bg-slate-700" : "border-slate-600 bg-slate-900"}`}
          >
            <span className="text-base leading-4">⚙️</span>
            <span className="text-[11px] font-semibold">Mantenimiento</span>
            <span className="text-[9px] text-slate-500">{maintenanceTasks.length} tareas</span>
          </button>
        </div>

        {quickSelectedMode === "quick" && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <select
              value={quickDraft.templateKey}
              onChange={(e) => setQuickDraft((prev) => ({ ...prev, templateKey: e.target.value, linkedTemplateKey: "", includedTaskIds: [] }))}
              className="min-w-[200px] flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-[12px]"
            >
              {quickTemplates.filter((t) => t.area === quickSelectedArea).sort((x, y) => x.label.localeCompare(y.label, "es")).map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!quickDraft.templateKey}
              onClick={() => setQuickEntryOpen(true)}
              className="rounded bg-emerald-600 px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
            >
              Crear entrada
            </button>
          </div>
        )}

        {quickSelectedMode === "maintenance" && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <select
              value={maintenanceDraft.taskId}
              onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, taskId: e.target.value }))}
              className="min-w-[200px] flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-[12px]"
            >
              <option value="">{maintenanceTasks.length ? "Selecciona tarea…" : "Sin tareas"}</option>
              {maintenanceTasks.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.type === "fuera_taller" ? "fuera" : "taller"})</option>)}
            </select>
            <select
              value={maintenanceDraft.techName}
              onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, techName: e.target.value }))}
              className="min-w-[140px] rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-[12px]"
            >
              <option value="">Técnico…</option>
              {maintenanceTechCandidates.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
            <button
              type="button"
              disabled={!maintenanceDraft.taskId || !maintenanceDraft.techName}
              onClick={() => { void assignQuickMaintenanceTask(); }}
              className="rounded bg-amber-500 px-4 py-1.5 text-[12px] font-bold text-slate-900 disabled:opacity-40"
            >
              Asignar
            </button>
          </div>
        )}
      </div>

      {/* Pendientes de validar (autorizar/asignar) */}
      {validationJobs.length > 0 && (
        <div className="mt-2 rounded-lg border border-rose-500/50 bg-rose-950/40 p-2">
          <div className="mb-1.5 text-[10px] font-bold text-rose-300">PENDIENTES DE VALIDAR ({validationJobs.length})</div>
          <div className="space-y-1.5">
            {validationJobs.map((job) => {
              const assignedNames = job.assignedNames ?? [];
              return (
                <div key={job.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-900 p-2">
                  <span className="text-[12px] font-bold">{job.plate}{job.urgent ? " ⚠️" : ""}</span>
                  <span className="text-[11px] text-slate-400">{getOperationLabel(job)}</span>
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) updateValidationResponsible(job.id, e.target.value); }}
                    className="rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-[11px]"
                  >
                    <option value="">Resp: {assignedNames[0] ?? "—"}</option>
                    {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => canSelectTechManuallyForJob(t, job, jobs, quickTemplates, "responsable") || t.name === assignedNames[0]).filter((t) => t.name === assignedNames[0] || !isTechBlockedByOutsideMaintenance(t.name)).map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                  {assignedNames.slice(1).map((n) => (
                    <span key={n} className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">
                      {n}<button type="button" onClick={() => removeValidationSupportByName(job.id, n)} className="font-bold">✕</button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) addValidationExtraSupport(job.id, e.target.value); }}
                    className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[11px] text-amber-300"
                  >
                    <option value="">+ Apoyo…</option>
                    {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => !assignedNames.includes(t.name) && canSelectTechManuallyForJob(t, job, jobs, quickTemplates, "apoyo") && !isTechBlockedByOutsideMaintenance(t.name)).map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                  <SelectorFurgoneta job={job} />
                  <button type="button" disabled={assignedNames.length === 0 || (job.area === "movil" && !job.assignedVehicleId)} title={job.area === "movil" && !job.assignedVehicleId ? "Asigna una furgoneta antes de autorizar" : undefined} onClick={() => { void authorizeProposedJob(job.id); }} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40">✓ Autorizar</button>
                  <button type="button" onClick={() => sendValidationJobToQueue(job.id)} className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-300">Cola</button>
                  <button type="button" onClick={() => { void rejectProposedJob(job.id); }} className="rounded border border-slate-500/40 bg-slate-700 px-2 py-1 text-[11px] text-slate-200">Rechazar</button>
                  <button type="button" onClick={() => { void deleteValidationJob(job.id); }} className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white">Eliminar</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cuerpo */}
      <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_1fr]">
        {/* Trabajos activos con asignación */}
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="mb-1.5 text-[10px] font-bold text-slate-400">TRABAJOS ACTIVOS ({runningJobs.length + activeAssistances.length + maintActive.length})</div>
          <div className="space-y-1.5">
            {runningJobs.length === 0 && activeAssistances.length === 0 && maintActive.length === 0 && <div className="text-[11px] text-slate-500">Sin trabajos activos</div>}
            {true && (
              <>
              {runningJobs.map((job) => {
                const assignedNames = job.assignedNames ?? [];
                return (
                  <div key={job.id} className="rounded-lg bg-slate-900 p-2" style={{ borderLeft: `3px solid ${job.urgent ? "#fb7185" : "#34d399"}` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold">{job.plate}{job.urgent ? " ⚠️" : ""} <span className="font-normal text-slate-400">· {getOperationLabel(job)}</span></span>
                      <span className="text-[10px] text-slate-400">⏱ {formatMinutes(getWorkedMinutes(job))}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { reassignJob(job.id, e.target.value); e.currentTarget.value = ""; } }}
                        className="rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-[11px]"
                      >
                        <option value="">Resp: {assignedNames[0] ?? "—"}</option>
                        {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => AREA_META[job.area].order.includes(t.name)).filter((t) => t.name === assignedNames[0] || (!isTechBlockedByOutsideMaintenance(t.name) && canSelectTechManuallyForJob(t, job, jobs, quickTemplates, "responsable"))).map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      {assignedNames.slice(1).map((n) => (
                        <span key={n} className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">
                          {n}<button type="button" onClick={() => removeSupportByNameFromJob(job.id, n)} className="font-bold">✕</button>
                        </span>
                      ))}
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) addExtraSupportToJob(job.id, e.target.value); }}
                        className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[11px] text-amber-300"
                      >
                        <option value="">+ Apoyo…</option>
                        {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => !assignedNames.includes(t.name) && canAssignTechManuallyToJob(t, job, jobs, quickTemplates, "apoyo") && !isTechBlockedByOutsideMaintenance(t.name)).map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      <SelectorFurgoneta job={job} />
                      <button type="button" onClick={() => pauseJob(job.id)} className="rounded border border-orange-400/40 bg-orange-400/10 px-2 py-1 text-[11px] text-orange-300">Stand by</button>
                      <button type="button" onClick={() => finishJob(job.id)} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white">✓ Cerrar</button>
                    </div>
                  </div>
                );
              })}
              </>
            )}
            {activeAssistances.map((a) => (
              <div key={`asist-${a.id}`} className="rounded-lg bg-slate-900 p-2" style={{ borderLeft: "3px solid #f0843a" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-bold">{a.plate} <span className="font-normal text-slate-400">· {a.trabajosARealizar || a.descripcionAveria || "Asistencia carretera"}</span></span>
                  <span className="shrink-0 rounded bg-orange-500/20 px-1.5 py-0.5 text-[9px] font-bold text-orange-300">CARRETERA · {ROADSIDE_LABEL[a.status] ?? a.status}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-orange-300">{a.assignedTechName}</div>
              </div>
            ))}
            {maintActive.map((t) => (
              <div key={`maint-${t.id}`} className="rounded-lg bg-slate-900 p-2" style={{ borderLeft: "3px solid #f0c040" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-bold">{t.taskLabel}</span>
                  <span className="shrink-0 rounded bg-yellow-500/20 px-1.5 py-0.5 text-[9px] font-bold text-yellow-300">MANTENIMIENTO · {t.taskType === "fuera_taller" ? "fuera" : "taller"}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-yellow-300">{t.techName}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await fetchWithTimeout(`${API_BASE}/api/assigned-maintenance-tasks/${t.id}/finish`, { method: "PUT", headers: getAdminHeaders() });
                        await reloadMaintenanceAvailabilityFromBackend();
                      } catch { /* noop */ }
                    }}
                    className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white"
                  >
                    ✓ Finalizar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Derecha */}
        <div className="space-y-2">
          <div className="rounded-lg bg-slate-800 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400">LLEGADAS / AGENDADOS ({agendados.length})</span>
              <button type="button" onClick={() => setOp2CitaOpen(true)} className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">+ Programar cita</button>
            </div>
            <div className="space-y-1">
              {agendados.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded bg-slate-900 px-2 py-1 text-[11px]">
                  <span><span className="text-amber-300">{s.startTime}</span> · {s.plate || s.templateLabel || s.area}{s.customerName ? <span className="text-slate-400"> · {s.customerName}</span> : null}</span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => agenda.confirmScheduledArrival(s)} className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">Llegó</button>
                    <button type="button" onClick={() => void agenda.markScheduledJobDone(s.id)} className="rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Realizada</button>
                    <button type="button" onClick={() => void agenda.deleteScheduledJobById(s.id)} className="rounded border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold text-rose-300">Cancelar</button>
                  </span>
                </div>
              ))}
              {agendados.length === 0 && (
                <div className="rounded border border-dashed border-slate-600 px-2 py-1.5 text-center text-[10px] text-slate-500">📅 Las citas nuevas de la agenda aparecen aquí</div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-slate-800 p-2">
              <div className="text-[10px] font-bold text-slate-400">COLA ({waitingJobs.length})</div>
              <div className="mt-1 space-y-1 text-[11px] text-slate-300">
                {waitingJobs.length === 0 ? <span className="text-slate-500">Vacía</span> : waitingJobs.slice(0, 8).map((j) => (
                  <div key={j.id} className="rounded bg-slate-900 p-1.5">
                    <div>{j.plate} <span className="text-slate-500">· {getOperationLabel(j)}</span></div>
                    <div className="mt-1 flex gap-1">
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { assignOrReserveWaitingJobManually(j.id, e.target.value); e.currentTarget.value = ""; } }}
                        className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px]"
                      >
                        <option value="">Asignar…</option>
                        {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => !t.blocked && !isHardBlockedTechStatus(t.status) && !isManualUnavailableStatus(t.status) && !isTechBlockedByOutsideMaintenance(t.name) && canAssignTechManuallyToJob(t, j, jobs, quickTemplates, "responsable")).map((t) => {
                          const busy = t.currentJobId != null || t.status === "ocupado" || t.status === "refuerzo";
                          return <option key={t.name} value={t.name}>{busy ? `${t.name} (cuando acabe)` : `${t.name} (libre)`}</option>;
                        })}
                      </select>
                      <button type="button" onClick={() => deleteWaitingJob(j.id)} className="shrink-0 rounded border border-rose-400/40 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-slate-800 p-2">
              <div className="text-[10px] font-bold text-slate-400">STAND BY ({pausedJobs.length})</div>
              <div className="mt-1 space-y-1 text-[11px] text-slate-300">
                {pausedJobs.length === 0 ? <span className="text-slate-500">Sin trabajos</span> : pausedJobs.slice(0, 8).map((j) => (
                  <div key={j.id} className="rounded bg-slate-900 p-1.5">
                    <div>{j.plate} <span className="text-slate-500">· {getOperationLabel(j)}</span></div>
                    <div className="mt-1 flex gap-1">
                      <button type="button" onClick={() => reactivatePausedJob(j.id)} className="rounded bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-slate-900">Reactivar</button>
                      <button type="button" onClick={() => finishJob(j.id)} className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">Finalizar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pie: KPIs / Alertas / Total técnicos */}
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="text-[10px] font-bold text-slate-400">KPIs</div>
          <div className="mt-0.5 text-[11px] text-slate-200">
            Libres {disponibles.length} · Resp. {responsables.size} · Refz {refuerzos.length} · <span className="text-rose-400">Urg {runningJobs.filter((j) => j.urgent).length}</span>
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="text-[10px] font-bold text-slate-400">Alertas</div>
          <div className="mt-0.5 text-[11px]">
            <span className="text-rose-400">{bloqueadosCount} bloq</span> · <span className="text-orange-300">{runningJobs.filter((j) => j.urgent).length} urg</span> · <span className="text-emerald-300">{runningJobs.length + activeAssistances.length + maintActive.length} act</span>
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="text-[10px] font-bold text-slate-400">Total técnicos</div>
          <div className="mt-0.5 text-[11px] text-slate-200">{trabajando.length + disponibles.length} · trabajando {trabajando.length} · libres {disponibles.length}</div>
        </div>
      </div>

      {op2CitaOpen && (
        <AgendaView
          embeddedModalOnly
          onClose={() => setOp2CitaOpen(false)}
          scheduledJobs={agenda.scheduledJobs}
          setScheduledJobs={agenda.setScheduledJobsAndSave}
          quickTemplates={visibleQuickTemplates}
          selectedWorkshopId={selectedWorkshopId}
          customExtraTasks={customExtraTasks}
          linkedTemplates={visibleLinkedTemplates}
          AREA_META={AREA_META}
          onBack={() => setOp2CitaOpen(false)}
          appendLog={appendLog}
          confirmScheduledArrival={agenda.confirmScheduledArrival}
          cancelScheduledJob={agenda.cancelScheduledJob}
          deleteScheduledJobFromBackend={deleteScheduledJobFromBackend}
          techs={visibleTechs}
          scheduledTechStatuses={scheduledTechStatuses}
          setScheduledTechStatuses={setScheduledTechStatuses}
          queueJobs={visibleJobs.filter((j) => j.status === "espera" || j.status === "validacion")}
        />
      )}
    </div>
  );
}
