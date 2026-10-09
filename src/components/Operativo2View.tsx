import { useState, type Dispatch, type SetStateAction } from "react";
import AgendaView from "./AgendaView";
import SelectorFurgoneta from "./SelectorFurgoneta";
import PuntoEnCola from "./PuntoEnCola";
import { esTecnicoDePrueba } from "../modules/tecnicosDePrueba";
import { AREA_META } from "../modules/workshopConstants";
import { API_BASE, deleteScheduledJobFromBackend, fetchWithTimeout } from "../modules/workshopApi";
import { getAdminHeaders } from "../modules/adminHeaders";
import { formatMinutes } from "../modules/time";
import { getOperationLabel, getQuickTemplateForJob, getWorkedMinutes } from "../modules/jobHelpers";
import { canAssignTechManuallyToJob, canSelectTechManuallyForJob, motivoNoAsignable } from "../modules/assignment";
import { isHardBlockedTechStatus } from "../modules/techStatus";
import { isManualUnavailableStatus } from "../modules/techSync";
import { tecnicosNoDisponibles } from "../modules/tecnicosNoDisponibles";
import { useRecepcionesPendientes } from "../modules/useRecepcionesPendientes";
import { horaDeRecepcion, idsDeCitasYaRecibidas } from "../modules/recepcionVehiculo";
import { getTodayDateValue } from "../modules/techStatusScheduleHelpers";
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
  updateValidationPlate: (jobId: number, plate: string) => void;
  /** Corrige la operación de una entrada pendiente de validar. */
  updateValidationOperacion: (jobId: number, templateKey: string) => void;
  /** Programar estados de técnico: solo administradores. Se pasa a la agenda. */
  puedeEditarEstadoTecnico?: boolean;
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
/**
 * La matrícula de una entrada en validación, corregible con un clic.
 *
 * Se teclea a mano y se equivoca uno a menudo. Hasta ahora había que eliminar
 * la entrada y crearla de nuevo; ahora se pulsa, se corrige, y Enter (o salir
 * del campo) la guarda. Escape deja la que había.
 */
function MatriculaEditable({
  valor,
  urgente,
  onCambiar,
}: {
  valor: string;
  urgente: boolean;
  onCambiar: (plate: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor);

  function confirmar() {
    setEditando(false);
    const limpia = texto.trim().toUpperCase();
    if (limpia && limpia !== valor) onCambiar(limpia);
    else setTexto(valor);
  }

  if (!editando) {
    return (
      <button
        type="button"
        title="Corregir matrícula"
        onClick={() => { setTexto(valor); setEditando(true); }}
        className="rounded border border-transparent px-1 text-[12px] font-bold hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        {valor}{urgente ? " ⚠️" : ""} <span className="text-[10px] font-normal text-slate-500">✎</span>
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={texto}
      onChange={(e) => setTexto(e.target.value.toUpperCase())}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); confirmar(); }
        if (e.key === "Escape") { setTexto(valor); setEditando(false); }
      }}
      className="w-24 rounded border border-emerald-500 bg-white dark:bg-slate-800 px-1.5 py-0.5 text-[12px] font-bold uppercase text-slate-900 dark:text-white outline-none"
    />
  );
}

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
  updateValidationPlate,
  updateValidationOperacion,
  puedeEditarEstadoTecnico = false,
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
  /*
   * Tema de Operativo 2. Se guarda por navegador, no por usuario: es la
   * pantalla la que está en un sitio con mucha o poca luz, no la persona.
   * Por defecto, oscuro, que es como ha sido siempre.
   */
  const [tema, setTema] = useState<"oscuro" | "claro">(() => {
    try {
      return localStorage.getItem("sea-tema-operativo2") === "claro" ? "claro" : "oscuro";
    } catch {
      return "oscuro";
    }
  });
  function cambiarTema() {
    const siguiente = tema === "oscuro" ? "claro" : "oscuro";
    setTema(siguiente);
    try { localStorage.setItem("sea-tema-operativo2", siguiente); } catch { /* sin almacenamiento */ }
  }
  // Se piden aquí y no por props: llegar hasta esta pantalla desde arriba
  // significaría atravesar SeaTarragonaV1, que ya pasa medio centenar.
  const { recepciones: recepcionesPendientes } = useRecepcionesPendientes(selectedWorkshopId);
  const isTestTech = esTecnicoDePrueba;
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
  const techColor = (n: string) => (responsables.has(n) ? "text-rose-600 dark:text-rose-400" : soportes.has(n) ? "text-orange-600 dark:text-orange-400" : maintTechNames.has(n) ? "text-yellow-700 dark:text-yellow-300" : "text-slate-800 dark:text-slate-200");
  /*
   * Las citas cuyo vehículo YA está en el patio salen de «Llegadas» y pasan a
   * verse arriba, en «Pendientes de recepción».
   *
   * No es solo orden: mientras siguiera aquí conservaba su botón «Llegó», y
   * ese botón crea el trabajo por su cuenta. Al validar después la recepción
   * saldría un segundo trabajo del mismo vehículo. La cita no se cierra hasta
   * esa validación, así que esta ventana puede durar horas.
   */
  const citasYaRecibidas = idsDeCitasYaRecibidas(recepcionesPendientes);
  const agendados = (agenda.dueScheduledJobs ?? []).filter(
    (s) => !citasYaRecibidas.has(Number(s.id))
  );
  const refuerzos = visibleTechs.filter((t) => !isTestTech(t.name) && t.status === "refuerzo");

  // Quién NO puede coger trabajo y por qué. Sin esto, alguien de vacaciones o
  // de baja simplemente no aparecía en la pantalla y no había forma de saber si
  // faltaba por fichar o es que no estaba.
  const noDisponibles = tecnicosNoDisponibles({
    techs: visibleTechs.filter((t) => !isTestTech(t.name)),
    trabajando: trabajandoNames,
    estadosProgramados: scheduledTechStatuses,
    hoy: getTodayDateValue(),
    bloqueadoEnOtroTaller: isTechBlockedByOutsideMaintenance,
  });

  const colorMotivo = (status: string) =>
    status === "baja"
      ? "text-rose-700 dark:text-rose-300"
      : status === "vacaciones"
        ? "text-amber-700 dark:text-amber-300"
        : status === "permiso"
          ? "text-violet-700 dark:text-violet-300"
          : "text-slate-700 dark:text-slate-300";

  const fechaCorta = (fecha?: string) => {
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(fecha || ""));
    return m ? `${m[2]}/${m[1]}` : "";
  };
  const bloqueadosCount = visibleJobs.filter((j) => j.status === "bloqueado").length;

  return (
    <div
      className={(tema === "oscuro" ? "dark " : "") + (
        embebido
          // Dentro de WorkPlanner sigue siendo una capa fija (por debajo de la
          // topbar del módulo y de los diálogos del panel, que van a z-50): así
          // tapa el resto del árbol del panel, que se monta detrás para que sus
          // diálogos —entrada rápida, plantillas…— sigan funcionando.
          ? "fixed inset-x-0 bottom-0 top-[44px] z-30 overflow-auto bg-slate-100 dark:bg-slate-900 p-3 text-slate-900 dark:text-slate-100"
          : "fixed inset-0 z-40 overflow-auto bg-slate-100 dark:bg-slate-900 p-3 text-slate-900 dark:text-slate-100"
      )}
      data-tema={tema}
    >
      {/* Barra superior (solo en el panel: dentro de WorkPlanner navega su menú) */}
      <div className={`mb-2 items-center justify-between ${embebido ? "hidden" : "flex"}`}>
        <span className="text-sm font-bold">📊 Mobilink · Operativo 2{userName ? <span className="ml-2 rounded bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-900 dark:text-slate-100">👤 {userName}</span> : null}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { setView("operarios"); void reloadMaintenanceAvailabilityFromBackend(); }} className="rounded bg-sky-700 px-3 py-1 text-[12px] font-semibold text-white hover:bg-sky-600">Técnicos</button>
          <button type="button" onClick={() => setView("entradas2")} className="rounded bg-emerald-700 px-3 py-1 text-[12px] font-semibold text-white hover:bg-emerald-600">ER</button>
          {(canView("agenda2") || canView("agenda")) && (
            <button type="button" onClick={() => setView("agenda2")} className="rounded bg-amber-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-amber-500">Agenda 2</button>
          )}
          <button type="button" onClick={() => { window.location.href = "/administracion"; }} className="rounded bg-indigo-700 px-3 py-1 text-[12px] font-semibold text-white hover:bg-indigo-600">Administración</button>
          <button type="button" onClick={() => setView("operativo")} className="rounded bg-white dark:bg-slate-800 px-3 py-1 text-[12px] text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700">← Volver</button>
        </div>
      </div>
      {/* Tema: también cuando la barra de arriba va oculta dentro de WorkPlanner */}
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={cambiarTema}
          title={tema === "oscuro" ? "Cambiar a fondo blanco" : "Cambiar a fondo oscuro"}
          className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          {tema === "oscuro" ? "☀️ Fondo blanco" : "🌙 Fondo oscuro"}
        </button>
      </div>
      {/* Cabecera */}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
          <div className="mb-1 text-[10px] font-bold text-sky-700 dark:text-sky-300">TRABAJANDO ({trabajando.length})</div>
          <div className="flex flex-wrap gap-1">
            {trabajando.length === 0 ? <span className="text-[11px] text-slate-500">—</span> :
              trabajando.map((t) => <span key={t.name} className={`rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[11px] font-semibold ${techColor(t.name)}`}>{t.name}</span>)}
          </div>
          <div className="mt-1 text-[9px] text-slate-500"><span className="text-rose-600 dark:text-rose-400">●</span> responsable · <span className="text-orange-600 dark:text-orange-400">●</span> soporte</div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
          <div className="mb-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">DISPONIBLES ({disponibles.length})</div>
          <div className="flex flex-wrap gap-1">
            {disponibles.length === 0 ? <span className="text-[11px] text-slate-500">—</span> :
              disponibles.map((t) => <span key={t.name} className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">{t.name}</span>)}
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
              NO DISPONIBLES ({noDisponibles.length})
            </span>
            <button
              type="button"
              onClick={() => setView("operarios")}
              className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[9px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
              title="El estado de cada técnico se cambia en Pantalla técnicos"
            >
              Cambiar estado
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {noDisponibles.length === 0 ? (
              <span className="text-[11px] text-slate-500">Nadie ausente</span>
            ) : (
              noDisponibles.map((t) => (
                <span
                  key={t.name}
                  className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[11px]"
                  title={
                    t.hasta
                      ? `${t.motivo} · ${t.desde} → ${t.hasta} (programado en la agenda)`
                      : `${t.motivo} · estado puesto a mano en Pantalla técnicos`
                  }
                >
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{t.name}</span>{" "}
                  <span className={colorMotivo(t.status)}>{t.motivo}</span>
                  {t.hasta && (
                    <span className="text-slate-600 dark:text-slate-400"> · hasta {fechaCorta(t.hasta)}</span>
                  )}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
          <div className="mb-1 text-[10px] font-bold text-sky-700 dark:text-sky-300">RESUMEN</div>
          <div className="flex flex-wrap gap-1 text-[11px]">
            <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5">Activos {runningJobs.length + activeAssistances.length + maintActive.length}</span>
            <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5">Cola {waitingJobs.length}</span>
            <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5">Stand by {pausedJobs.length}</span>
            <span className="rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-rose-600 dark:text-rose-400">Urgentes {runningJobs.filter((j) => j.urgent).length}</span>
          </div>
        </div>
      </div>

      {/* Entradas rápidas */}
      <div className="mt-2 rounded-lg bg-white dark:bg-slate-800 p-2">
        <div className="mb-1 text-[10px] font-bold text-slate-600 dark:text-slate-400">ENTRADAS RÁPIDAS</div>
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
                className={`flex flex-col items-center gap-0.5 rounded-lg border p-2 ${active ? "border-sky-400 bg-slate-200 dark:bg-slate-700" : "border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900"}`}
              >
                <Icon className="h-4 w-4 text-slate-800 dark:text-slate-200" />
                <span className="text-[11px] font-semibold">{meta.label}</span>
                <span className="text-[9px] text-slate-500">{count} entradas</span>
              </button>
            );
          })}
          {/* Mantenimiento */}
          <button
            type="button"
            onClick={() => setQuickSelectedMode("maintenance")}
            className={`flex flex-col items-center gap-0.5 rounded-lg border p-2 ${quickSelectedMode === "maintenance" ? "border-amber-400 bg-slate-200 dark:bg-slate-700" : "border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900"}`}
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
              className="min-w-[200px] flex-1 rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-[12px]"
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
              className="min-w-[200px] flex-1 rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-[12px]"
            >
              <option value="">{maintenanceTasks.length ? "Selecciona tarea…" : "Sin tareas"}</option>
              {maintenanceTasks.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.type === "fuera_taller" ? "fuera" : "taller"})</option>)}
            </select>
            <select
              value={maintenanceDraft.techName}
              onChange={(e) => setMaintenanceDraft((prev) => ({ ...prev, techName: e.target.value }))}
              className="min-w-[140px] rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-2 py-1.5 text-[12px]"
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
        <div className="mt-2 rounded-lg border border-rose-500/50 bg-rose-50 dark:bg-rose-950/40 p-2">
          <div className="mb-1.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">PENDIENTES DE VALIDAR ({validationJobs.length})</div>
          <div className="space-y-1.5">
            {validationJobs.map((job) => {
              const assignedNames = job.assignedNames ?? [];
              return (
                <div key={job.id} className="rounded-lg bg-slate-100 dark:bg-slate-900 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                  <MatriculaEditable
                    valor={job.plate}
                    urgente={Boolean(job.urgent)}
                    onCambiar={(plate) => updateValidationPlate(job.id, plate)}
                  />
                  {/* La operación se escoge rápido y se falla: aquí se corrige
                      sin rehacer la entrada. Ver updateValidationOperacion. */}
                  <select
                    value={getQuickTemplateForJob(job, quickTemplates)?.key ?? ""}
                    onChange={(e) => { if (e.target.value) updateValidationOperacion(job.id, e.target.value); }}
                    title="Corregir la operación"
                    className="max-w-[230px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-[11px]"
                  >
                    {getQuickTemplateForJob(job, quickTemplates) == null && (
                      <option value="">{getOperationLabel(job)}</option>
                    )}
                    {quickTemplates
                      .filter((p) => !p.workshopId || p.workshopId === selectedWorkshopId)
                      .map((p) => (
                        <option key={p.key} value={p.key}>{p.label}</option>
                      ))}
                  </select>
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) updateValidationResponsible(job.id, e.target.value); }}
                    className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-[11px]"
                  >
                    <option value="">Resp: {assignedNames[0] ?? "—"}</option>
                    {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => canSelectTechManuallyForJob(t, job, jobs, quickTemplates, "responsable") || t.name === assignedNames[0]).filter((t) => t.name === assignedNames[0] || !isTechBlockedByOutsideMaintenance(t.name)).map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                  {assignedNames.slice(1).map((n) => (
                    <span key={n} className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                      {n}<button type="button" onClick={() => removeValidationSupportByName(job.id, n)} className="font-bold">✕</button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) addValidationExtraSupport(job.id, e.target.value); }}
                    className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[11px] text-amber-700 dark:text-amber-300"
                  >
                    <option value="">+ Apoyo…</option>
                    {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => !assignedNames.includes(t.name) && canSelectTechManuallyForJob(t, job, jobs, quickTemplates, "apoyo") && !isTechBlockedByOutsideMaintenance(t.name)).map((t) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                  <SelectorFurgoneta
                    job={job}
                    furgonetas={furgonetas}
                    ocupadasEnTaller={furgonetasOcupadasEnTaller}
                    enAsistencia={furgonetasEnAsistencia}
                    onAsignar={asignarFurgonetaAlTrabajo}
                    oscuro={tema === "oscuro"}
                  />
                  <button type="button" disabled={assignedNames.length === 0 || (job.area === "movil" && !job.assignedVehicleId)} title={job.area === "movil" && !job.assignedVehicleId ? "Asigna una furgoneta antes de autorizar" : undefined} onClick={() => { void authorizeProposedJob(job.id); }} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-40">✓ Autorizar</button>
                  <button type="button" onClick={() => sendValidationJobToQueue(job.id)} className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">Cola</button>
                  <button type="button" onClick={() => { void rejectProposedJob(job.id); }} className="rounded border border-slate-400/60 dark:border-slate-500/40 bg-slate-200 dark:bg-slate-700 px-2 py-1 text-[11px] text-slate-800 dark:text-slate-200">Rechazar</button>
                  <button type="button" onClick={() => { void deleteValidationJob(job.id); }} className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white">Eliminar</button>
                  </div>

                  {/* Por qué se propone a ese técnico: sin el motivo, o te fías
                      a ciegas o lo cambias a ojo. */}
                  {job.reason && (
                    <div className="mt-1 text-[10px] leading-snug text-slate-600 dark:text-slate-400">
                      {job.reason}
                      {job.quantity && job.quantity > 1 ? ` · Cantidad: ${job.quantity}` : ""}
                      {job.ptNumero ? ` · Parte ${job.ptNumero}` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cuerpo */}
      <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_1fr]">
        {/* Trabajos activos con asignación */}
        <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
          <div className="mb-1.5 text-[10px] font-bold text-slate-600 dark:text-slate-400">TRABAJOS ACTIVOS ({runningJobs.length + activeAssistances.length + maintActive.length})</div>
          <div className="space-y-1.5">
            {runningJobs.length === 0 && activeAssistances.length === 0 && maintActive.length === 0 && <div className="text-[11px] text-slate-500">Sin trabajos activos</div>}
            {true && (
              <>
              {runningJobs.map((job) => {
                const assignedNames = job.assignedNames ?? [];
                return (
                  <div key={job.id} className="rounded-lg bg-slate-100 dark:bg-slate-900 p-2" style={{ borderLeft: `3px solid ${job.urgent ? "#fb7185" : "#34d399"}` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold">
                        {job.customerName ? (
                          <span className="text-sky-700 dark:text-sky-300">{job.customerName} · </span>
                        ) : null}
                        {job.plate}{job.urgent ? " ⚠️" : ""} <span className="font-normal text-slate-600 dark:text-slate-400">· {getOperationLabel(job)}</span>
                      </span>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400">⏱ {formatMinutes(getWorkedMinutes(job))}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { reassignJob(job.id, e.target.value); e.currentTarget.value = ""; } }}
                        className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-[11px]"
                      >
                        <option value="">Resp: {assignedNames[0] ?? "—"}</option>
                        {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => AREA_META[job.area].order.includes(t.name)).filter((t) => t.name === assignedNames[0] || (!isTechBlockedByOutsideMaintenance(t.name) && canSelectTechManuallyForJob(t, job, jobs, quickTemplates, "responsable"))).map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      {assignedNames.slice(1).map((n) => (
                        <span key={n} className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                          {n}<button type="button" onClick={() => removeSupportByNameFromJob(job.id, n)} className="font-bold">✕</button>
                        </span>
                      ))}
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) addExtraSupportToJob(job.id, e.target.value); }}
                        className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[11px] text-amber-700 dark:text-amber-300"
                      >
                        <option value="">+ Apoyo…</option>
                        {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => !assignedNames.includes(t.name) && canAssignTechManuallyToJob(t, job, jobs, quickTemplates, "apoyo") && !isTechBlockedByOutsideMaintenance(t.name)).map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      <SelectorFurgoneta
                    job={job}
                    furgonetas={furgonetas}
                    ocupadasEnTaller={furgonetasOcupadasEnTaller}
                    enAsistencia={furgonetasEnAsistencia}
                    onAsignar={asignarFurgonetaAlTrabajo}
                    oscuro={tema === "oscuro"}
                  />
                      <button type="button" onClick={() => pauseJob(job.id)} className="rounded border border-orange-400/40 bg-orange-400/10 px-2 py-1 text-[11px] text-orange-700 dark:text-orange-300">Stand by</button>
                      <button type="button" onClick={() => finishJob(job.id)} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white">✓ Cerrar</button>
                    </div>
                  </div>
                );
              })}
              </>
            )}
            {activeAssistances.map((a) => (
              <div key={`asist-${a.id}`} className="rounded-lg bg-slate-100 dark:bg-slate-900 p-2" style={{ borderLeft: "3px solid #f0843a" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-bold">{a.plate} <span className="font-normal text-slate-600 dark:text-slate-400">· {a.trabajosARealizar || a.descripcionAveria || "Asistencia carretera"}</span></span>
                  <span className="shrink-0 rounded bg-orange-500/20 px-1.5 py-0.5 text-[9px] font-bold text-orange-700 dark:text-orange-300">CARRETERA · {ROADSIDE_LABEL[a.status] ?? a.status}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-orange-700 dark:text-orange-300">{a.assignedTechName}</div>
              </div>
            ))}
            {maintActive.map((t) => (
              <div key={`maint-${t.id}`} className="rounded-lg bg-slate-100 dark:bg-slate-900 p-2" style={{ borderLeft: "3px solid #f0c040" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-bold">{t.taskLabel}</span>
                  <span className="shrink-0 rounded bg-yellow-500/20 px-1.5 py-0.5 text-[9px] font-bold text-yellow-700 dark:text-yellow-300">MANTENIMIENTO · {t.taskType === "fuera_taller" ? "fuera" : "taller"}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-yellow-700 dark:text-yellow-300">{t.techName}</span>
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
          {/* ── Recibidos en el patio, sin validar ──────────────────────────
              Va ARRIBA del todo y no dentro de «Llegadas» a propósito: una
              llegada agendada es una cita que se esperaba; esto es un vehículo
              que ya está en el patio y del que todavía no hay trabajo. Mientras
              nadie lo valide, no existe en ninguna otra parte de la pantalla. */}
          <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400">
                PENDIENTES DE RECEPCIÓN ({recepcionesPendientes.length})
              </span>
              {recepcionesPendientes.length > 0 && (
                <a
                  href="/workplanner/recepciones"
                  className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-slate-900"
                >
                  Validar
                </a>
              )}
            </div>
            <div className="space-y-1">
              {recepcionesPendientes.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded bg-slate-100 dark:bg-slate-900 px-2 py-1 text-[11px]"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-amber-700 dark:text-amber-300">{horaDeRecepcion(r.creadaAtMs)}</span>
                    {" · "}
                    <span className="font-bold">{r.matricula}</span>
                    {r.clienteNombre ? <span className="text-slate-600 dark:text-slate-400"> · {r.clienteNombre}</span> : null}
                    {r.kilometros ? (
                      <span className="text-slate-600 dark:text-slate-400"> · {r.kilometros.toLocaleString("es-ES")} km</span>
                    ) : null}
                    <span className="text-slate-500"> · {r.operacionLabel || "sin operación"}</span>
                    {r.scheduledJobId != null ? (
                      <span
                        className="ml-1 rounded bg-sky-100 dark:bg-sky-900/60 px-1 py-0.5 text-[9px] font-bold text-sky-800 dark:text-sky-200"
                        title="Venía de una cita de la agenda. Por eso ya no sale arriba en Llegadas."
                      >
                        con cita
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">{r.operarioNombre}</span>
                </div>
              ))}
              {recepcionesPendientes.length === 0 && (
                <div className="rounded border border-dashed border-slate-300 dark:border-slate-600 px-2 py-1.5 text-center text-[10px] text-slate-500">
                  🚗 Los vehículos recibidos con la APK aparecen aquí
                </div>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400">LLEGADAS / AGENDADOS ({agendados.length})</span>
              <button type="button" onClick={() => setOp2CitaOpen(true)} className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">+ Programar cita</button>
            </div>
            <div className="space-y-1">
              {agendados.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded bg-slate-100 dark:bg-slate-900 px-2 py-1 text-[11px]">
                  <span><span className="text-amber-700 dark:text-amber-300">{s.startTime}</span> · {s.plate || s.templateLabel || s.area}{s.customerName ? <span className="text-slate-600 dark:text-slate-400"> · {s.customerName}</span> : null}</span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => agenda.confirmScheduledArrival(s)} className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">Llegó</button>
                    <button type="button" onClick={() => void agenda.markScheduledJobDone(s.id)} className="rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">Realizada</button>
                    <button type="button" onClick={() => void agenda.deleteScheduledJobById(s.id)} className="rounded border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">Cancelar</button>
                  </span>
                </div>
              ))}
              {agendados.length === 0 && (
                <div className="rounded border border-dashed border-slate-300 dark:border-slate-600 px-2 py-1.5 text-center text-[10px] text-slate-500">📅 Las citas nuevas de la agenda aparecen aquí</div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
              <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400">COLA ({waitingJobs.length})</div>
              <div className="mt-1 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                {waitingJobs.length === 0 ? <span className="text-slate-500">Vacía</span> : waitingJobs.slice(0, 8).map((j) => (
                  <div key={j.id} className="rounded bg-slate-100 dark:bg-slate-900 p-1.5">
                    <div><PuntoEnCola />{j.plate} <span className="text-slate-500">· {getOperationLabel(j)}</span></div>
                    <div className="mt-1 flex gap-1">
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { assignOrReserveWaitingJobManually(j.id, e.target.value); e.currentTarget.value = ""; } }}
                        className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1 py-0.5 text-[10px]"
                      >
                        <option value="">Asignar…</option>
                        {visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name)).filter((t) => !t.blocked && !isHardBlockedTechStatus(t.status) && !isManualUnavailableStatus(t.status) && !isTechBlockedByOutsideMaintenance(t.name) && canAssignTechManuallyToJob(t, j, jobs, quickTemplates, "responsable")).map((t) => {
                          const busy = t.currentJobId != null || t.status === "ocupado" || t.status === "refuerzo";
                          return <option key={t.name} value={t.name}>{busy ? `${t.name} (cuando acabe)` : `${t.name} (libre)`}</option>;
                        })}
                      </select>
                      <button type="button" onClick={() => deleteWaitingJob(j.id)} className="shrink-0 rounded border border-rose-400/40 bg-rose-400/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">Eliminar</button>
                    </div>
                    {(() => {
                      // Si nadie sale en «Asignar…», decir por qué: un desplegable
                      // vacío con tres técnicos libres en pantalla parece un fallo.
                      const candidatos = visibleTechs.filter((t) => !isTestTech(t.name) && !roadsideBusyTechNames.has(t.name) && !t.blocked && !isHardBlockedTechStatus(t.status) && !isManualUnavailableStatus(t.status) && !isTechBlockedByOutsideMaintenance(t.name));
                      if (candidatos.some((t) => canAssignTechManuallyToJob(t, j, jobs, quickTemplates, "responsable"))) return null;
                      const motivos = candidatos
                        .map((t) => ({ n: t.name, m: motivoNoAsignable(t, j, jobs, quickTemplates, "responsable") }))
                        .filter((x) => x.m);
                      return (
                        <div className="mt-1 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-1 text-[10px] text-amber-800 dark:text-amber-200">
                          Nadie se puede asignar: {motivos.length === 0 ? "no hay técnicos en este taller." : motivos.map((x) => `${x.n} (${x.m})`).join(" · ")}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
              <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400">STAND BY ({pausedJobs.length})</div>
              <div className="mt-1 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
                {pausedJobs.length === 0 ? <span className="text-slate-500">Sin trabajos</span> : pausedJobs.slice(0, 8).map((j) => (
                  <div key={j.id} className="rounded bg-slate-100 dark:bg-slate-900 p-1.5">
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
        <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400">KPIs</div>
          <div className="mt-0.5 text-[11px] text-slate-800 dark:text-slate-200">
            Libres {disponibles.length} · Resp. {responsables.size} · Refz {refuerzos.length} · <span className="text-rose-600 dark:text-rose-400">Urg {runningJobs.filter((j) => j.urgent).length}</span>
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400">Alertas</div>
          <div className="mt-0.5 text-[11px]">
            <span className="text-rose-600 dark:text-rose-400">{bloqueadosCount} bloq</span> · <span className="text-orange-700 dark:text-orange-300">{runningJobs.filter((j) => j.urgent).length} urg</span> · <span className="text-emerald-700 dark:text-emerald-300">{runningJobs.length + activeAssistances.length + maintActive.length} act</span>
          </div>
        </div>
        <div className="rounded-lg bg-white dark:bg-slate-800 p-2">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400">Total técnicos</div>
          <div className="mt-0.5 text-[11px] text-slate-800 dark:text-slate-200">
            {trabajando.length + disponibles.length + noDisponibles.length} · trabajando{" "}
            {trabajando.length} · libres {disponibles.length} ·{" "}
            <span className="text-amber-700 dark:text-amber-300">ausentes {noDisponibles.length}</span>
          </div>
        </div>
      </div>

      {op2CitaOpen && (
        <AgendaView
          embeddedModalOnly
          puedeEditarEstadoTecnico={puedeEditarEstadoTecnico}
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
