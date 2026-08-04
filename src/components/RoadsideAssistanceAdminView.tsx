import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Edit3,
  FileText,
  KeyRound,
  List,
  Map as MapIcon,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  Save,
  Store,
  Trash2,
  Truck,
  Wifi,
  X,
} from "lucide-react";

import type { Tech } from "../modules/workshopTypes";
import type {
  RoadsideOperatorCode,
  RoadsideVehicle,
  RoadsideVehicleDraft,
} from "../modules/roadsideAssistanceTypes";
import {
  loadWorkshopConfigFromBackend,
  saveWorkshopConfigToBackend,
  type WorkshopConfig,
} from "../modules/roadsideAssistanceApi";

const INITIAL_VEHICLE_DRAFT: RoadsideVehicleDraft = {
  name: "",
  plate: "",
  webfleetVehicleId: "",
  base: "",
  marca: "",
  modelo: "",
  esTaller: false,
  notes: "",
  active: true,
};

function buildVehicleDraft(vehicle: RoadsideVehicle): RoadsideVehicleDraft {
  return {
    name: vehicle.name || "",
    plate: vehicle.plate || "",
    webfleetVehicleId: vehicle.webfleetVehicleId || "",
    base: vehicle.base || "",
    marca: vehicle.marca || "",
    modelo: vehicle.modelo || "",
    esTaller: vehicle.esTaller === true,
    notes: vehicle.notes || "",
    active: vehicle.active !== false,
  };
}

// Titular de la furgoneta: lo que identifica al vehículo de un vistazo es la
// marca y el modelo con su matrícula ("Peugeot Boxer - 6133LXF"); el número
// interno ("Furgoneta 001") va debajo. Si no hay marca ni modelo se cae al
// nombre para no dejar la tarjeta sin título.
function getVehicleLabel(vehicle: RoadsideVehicle) {
  const marcaModelo = [vehicle.marca, vehicle.modelo].filter(Boolean).join(" ").trim();
  return [marcaModelo || vehicle.name, vehicle.plate].filter(Boolean).join(" - ");
}

// Línea secundaria: el número de furgoneta, salvo que ya se esté usando como
// título por no haber marca ni modelo (evita repetirlo dos veces).
function getVehicleSubLabel(vehicle: RoadsideVehicle) {
  const marcaModelo = [vehicle.marca, vehicle.modelo].filter(Boolean).join(" ").trim();
  return marcaModelo ? vehicle.name : "";
}

type Props = {
  techs: Tech[];
  vehicles: RoadsideVehicle[];
  operatorCodes: RoadsideOperatorCode[];
  error: string;
  onBack: () => void;
  onRefresh: () => void;
  onCreateVehicle: (draft: RoadsideVehicleDraft) => Promise<void>;
  onUpdateVehicle: (
    vehicle: RoadsideVehicle,
    draft: RoadsideVehicleDraft
  ) => Promise<void>;
  onDeactivateVehicle: (vehicle: RoadsideVehicle) => Promise<void>;
  onUpdateOperatorCode: (techName: string, code: string) => Promise<void>;
  onDeleteOperatorCode: (techName: string) => Promise<void>;
};

export default function RoadsideAssistanceAdminView({
  techs,
  vehicles,
  operatorCodes,
  error,
  onBack,
  onRefresh,
  onCreateVehicle,
  onUpdateVehicle,
  onDeactivateVehicle,
  onUpdateOperatorCode,
  onDeleteOperatorCode,
}: Props) {
  const [adminTab, setAdminTab] = useState<"furgonetas" | "operarios" | "taller">(
    "furgonetas"
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [vehicleDraft, setVehicleDraft] =
    useState<RoadsideVehicleDraft>(INITIAL_VEHICLE_DRAFT);
  const [editingVehicle, setEditingVehicle] = useState<RoadsideVehicle | null>(
    null
  );
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleError, setVehicleError] = useState("");
  const [operatorCodeDrafts, setOperatorCodeDrafts] = useState<
    Record<string, string>
  >({});
  const [operatorCodeSavingName, setOperatorCodeSavingName] = useState<
    string | null
  >(null);
  const [operatorCodeError, setOperatorCodeError] = useState("");
  const [newOperatorName, setNewOperatorName] = useState("");
  const [newOperatorCode, setNewOperatorCode] = useState("");
  const [addingOperator, setAddingOperator] = useState(false);

  const [workshopConfig, setWorkshopConfig] = useState<WorkshopConfig>({
    taller_lat: "", taller_lng: "", taller_direccion: "", taller_radio_m: "300",
  });
  const [workshopConfigSaving, setWorkshopConfigSaving] = useState(false);
  const [workshopConfigMsg, setWorkshopConfigMsg] = useState("");

  const operatorCodesByTech = useMemo(() => {
    return new Map(operatorCodes.map((item) => [item.techName, item]));
  }, [operatorCodes]);

  const activeVehicleCount = vehicles.filter(
    (vehicle) => vehicle.active
  ).length;

  const availableTechs = useMemo(
    () =>
      techs
        .filter((tech) => !operatorCodesByTech.has(tech.name))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [techs, operatorCodesByTech]
  );

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    operatorCodes.forEach((item) => { nextDrafts[item.techName] = item.code || ""; });
    setOperatorCodeDrafts(nextDrafts);
  }, [operatorCodes]);

  useEffect(() => {
    loadWorkshopConfigFromBackend().then(setWorkshopConfig).catch(() => {});
  }, []);

  async function handleSaveWorkshopConfig() {
    setWorkshopConfigSaving(true);
    setWorkshopConfigMsg("");
    try {
      await saveWorkshopConfigToBackend(workshopConfig);
      setWorkshopConfigMsg("Configuración guardada correctamente.");
      setTimeout(() => setWorkshopConfigMsg(""), 4000);
    } catch (err) {
      setWorkshopConfigMsg(err instanceof Error ? err.message : "Error guardando.");
    } finally {
      setWorkshopConfigSaving(false);
    }
  }

  function startVehicleEdit(vehicle: RoadsideVehicle) {
    setEditingVehicle(vehicle);
    setVehicleDraft(buildVehicleDraft(vehicle));
    setVehicleError("");
  }

  function resetVehicleForm() {
    setEditingVehicle(null);
    setVehicleDraft(INITIAL_VEHICLE_DRAFT);
    setVehicleError("");
  }

  async function handleSaveVehicle() {
    setVehicleError("");

    if (!vehicleDraft.name.trim()) {
      setVehicleError("El nombre de la furgoneta es obligatorio.");
      return;
    }

    setVehicleSaving(true);

    try {
      if (editingVehicle) {
        await onUpdateVehicle(editingVehicle, vehicleDraft);
      } else {
        await onCreateVehicle(vehicleDraft);
      }

      resetVehicleForm();
    } catch (saveError) {
      setVehicleError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar la furgoneta."
      );
    } finally {
      setVehicleSaving(false);
    }
  }

  async function handleDeactivateVehicle(vehicle: RoadsideVehicle) {
    setVehicleError("");
    setVehicleSaving(true);

    try {
      await onDeactivateVehicle(vehicle);

      if (editingVehicle?.id === vehicle.id) {
        resetVehicleForm();
      }
    } catch (deleteError) {
      setVehicleError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo desactivar la furgoneta."
      );
    } finally {
      setVehicleSaving(false);
    }
  }

  function generateOperatorCode(techName: string) {
    const number =
      typeof window !== "undefined" && window.crypto
        ? window.crypto.getRandomValues(new Uint32Array(1))[0] % 9000
        : Math.floor(Math.random() * 9000);

    setOperatorCodeDrafts((prev) => ({
      ...prev,
      [techName]: String(1000 + number),
    }));
  }

  function generateNewOperatorCode() {
    const number =
      typeof window !== "undefined" && window.crypto
        ? window.crypto.getRandomValues(new Uint32Array(1))[0] % 9000
        : Math.floor(Math.random() * 9000);

    setNewOperatorCode(String(1000 + number));
  }

  async function handleAddOperator() {
    const techName = newOperatorName.trim();
    const code = newOperatorCode.trim();

    setOperatorCodeError("");

    if (!techName) {
      setOperatorCodeError("Selecciona un operario para darlo de alta.");
      return;
    }

    if (code.length < 4) {
      setOperatorCodeError("El codigo debe tener al menos 4 caracteres.");
      return;
    }

    setAddingOperator(true);

    try {
      await onUpdateOperatorCode(techName, code);
      setNewOperatorName("");
      setNewOperatorCode("");
    } catch (saveError) {
      setOperatorCodeError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo dar de alta el operario."
      );
    } finally {
      setAddingOperator(false);
    }
  }

  async function handleSaveOperatorCode(techName: string) {
    const code = String(operatorCodeDrafts[techName] || "").trim();

    setOperatorCodeError("");

    if (code.length < 4) {
      setOperatorCodeError("El codigo debe tener al menos 4 caracteres.");
      return;
    }

    setOperatorCodeSavingName(techName);

    try {
      await onUpdateOperatorCode(techName, code);
    } catch (saveError) {
      setOperatorCodeError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar el codigo."
      );
    } finally {
      setOperatorCodeSavingName(null);
    }
  }

  async function handleDeleteOperatorCode(techName: string) {
    setOperatorCodeError("");

    const confirmed = window.confirm(
      `Dar de baja a ${techName} de asistencias?\n\nNo se borra el tecnico del taller, solo se le retira el acceso a asistencia movil.`
    );

    if (!confirmed) return;

    setOperatorCodeSavingName(techName);

    try {
      await onDeleteOperatorCode(techName);
      setOperatorCodeDrafts((prev) => {
        const next = { ...prev };
        delete next[techName];
        return next;
      });
    } catch (deleteError) {
      setOperatorCodeError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo dar de baja el operario."
      );
    } finally {
      setOperatorCodeSavingName(null);
    }
  }

  // Salir a la vista de asistencias abriendo una pestaña concreta. El panel lee
  // ?tab= al montarse, así que basta con dejarlo puesto antes de volver.
  function irAAsistencias(tab: "nueva" | "activas" | "cerradas" | "historial") {
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${window.location.pathname}?tab=${tab}`);
    }
    setSidebarOpen(false);
    onBack();
  }

  const enlaceLateral =
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left font-medium text-slate-300 hover:bg-slate-800";

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100">
      {/* Backdrop del cajón en móvil */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Barra lateral: la misma que el panel de asistencias, para poder
             saltar de una pantalla a otra sin botón "Volver" ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 md:static md:z-auto md:w-52 md:flex-shrink-0 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-end p-2 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 pt-1 text-sm md:pt-3">
          <button type="button" onClick={() => irAAsistencias("nueva")} className={enlaceLateral}>
            <Plus className="h-4 w-4 shrink-0" /> Nueva asistencia
          </button>
          <button type="button" onClick={() => irAAsistencias("activas")} className={enlaceLateral}>
            <Clock3 className="h-4 w-4 shrink-0" /> Activas
          </button>
          <button type="button" onClick={() => irAAsistencias("cerradas")} className={enlaceLateral}>
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Últimas cerradas
          </button>
          <button type="button" onClick={() => irAAsistencias("historial")} className={enlaceLateral}>
            <FileText className="h-4 w-4 shrink-0" /> Historial
          </button>

          <div className="my-2 border-t border-slate-800" />
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Configuración
          </div>
          <div className="flex items-center gap-2.5 rounded-lg bg-red-600 px-3 py-2 font-medium text-white">
            <Truck className="h-4 w-4 shrink-0" /> Furgonetas y operarios
          </div>

          <div className="my-2 border-t border-slate-800" />
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Herramientas
          </div>
          <a href="/flota" target="_blank" rel="noopener noreferrer" className={enlaceLateral}>
            <MapIcon className="h-4 w-4 shrink-0" /> Mapa flota
          </a>
          <a href="/asistencias/central" className={enlaceLateral}>
            <Wifi className="h-4 w-4 shrink-0" /> Central
          </a>
          <a href="/asistencias/talleres" className={enlaceLateral}>
            <Store className="h-4 w-4 shrink-0" /> Talleres
          </a>
          <a href="/otf" target="_blank" rel="noopener noreferrer" className={enlaceLateral}>
            <Truck className="h-4 w-4 shrink-0" /> OTF
          </a>
          <a href="/vehiculo" target="_blank" rel="noopener noreferrer" className={enlaceLateral}>
            <List className="h-4 w-4 shrink-0" /> Historial vehículo
          </a>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:bg-slate-700 md:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center justify-center px-1">
              <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-9 md:h-12" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold md:text-base">Furgonetas y operarios</h1>
              <div className="text-xs text-slate-400">
                {activeVehicleCount} furgonetas · {operatorCodes.length} operarios
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Actualizar</span>
            </button>
          </div>
        </header>

      <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4">

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-300">
            {error}
          </div>
        )}

        {/* Pestañas: cada cosa en la suya en vez de todo apilado en la misma
            pantalla, que en móvil obligaba a un scroll larguísimo. */}
        <nav className="flex gap-1 rounded-xl border border-slate-700 bg-slate-800 p-1">
          {([
            ["furgonetas", "Furgonetas", Truck, activeVehicleCount],
            ["operarios", "Operarios", KeyRound, operatorCodes.length],
            ["taller", "Taller base", MapPin, null],
          ] as const).map(([tab, label, Icon, badge]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setAdminTab(tab)}
              aria-current={adminTab === tab}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                adminTab === tab
                  ? "bg-red-600 text-white"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
              {badge != null && badge > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                    adminTab === tab ? "bg-red-800 text-white" : "bg-slate-700 text-slate-200"
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="grid gap-5">
          <section
            className={`rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-sm ${
              adminTab === "furgonetas" ? "" : "hidden"
            }`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase text-slate-200">
                Furgonetas
              </h2>
              <Truck className="h-5 w-5 text-slate-400" />
            </div>

            <div className="space-y-3">
              <input
                value={vehicleDraft.name}
                onChange={(event) =>
                  setVehicleDraft((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="Nombre, ejemplo: Furgoneta 1"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
              />

              <input
                value={vehicleDraft.plate}
                onChange={(event) =>
                  setVehicleDraft((prev) => ({
                    ...prev,
                    plate: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="Matricula"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 uppercase"
              />

              <input
                value={vehicleDraft.webfleetVehicleId}
                onChange={(event) =>
                  setVehicleDraft((prev) => ({
                    ...prev,
                    webfleetVehicleId: event.target.value,
                  }))
                }
                placeholder="ID Webfleet (ej: 012)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
              />

              <input
                value={vehicleDraft.base}
                onChange={(event) =>
                  setVehicleDraft((prev) => ({
                    ...prev,
                    base: event.target.value,
                  }))
                }
                placeholder="Base (ej: Tarragona, Reus...)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  value={vehicleDraft.marca}
                  onChange={(event) =>
                    setVehicleDraft((prev) => ({
                      ...prev,
                      marca: event.target.value,
                    }))
                  }
                  placeholder="Marca (ej: Mercedes)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
                <input
                  value={vehicleDraft.modelo}
                  onChange={(event) =>
                    setVehicleDraft((prev) => ({
                      ...prev,
                      modelo: event.target.value,
                    }))
                  }
                  placeholder="Modelo (ej: Sprinter)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked={vehicleDraft.esTaller}
                  onChange={(event) =>
                    setVehicleDraft((prev) => ({
                      ...prev,
                      esTaller: event.target.checked,
                    }))
                  }
                />
                <span className="text-sm font-black text-slate-200">
                  Furgoneta taller
                </span>
              </label>

              <textarea
                value={vehicleDraft.notes}
                onChange={(event) =>
                  setVehicleDraft((prev) => ({
                    ...prev,
                    notes: event.target.value,
                  }))
                }
                rows={2}
                placeholder="Notas"
                className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
              />

              <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked={vehicleDraft.active}
                  onChange={(event) =>
                    setVehicleDraft((prev) => ({
                      ...prev,
                      active: event.target.checked,
                    }))
                  }
                />
                <span className="text-sm font-black text-slate-200">
                  Furgoneta activa
                </span>
              </label>

              {vehicleError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-300">
                  {vehicleError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveVehicle}
                  disabled={vehicleSaving}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {editingVehicle ? "Guardar" : "Crear"}
                </button>

                {editingVehicle && (
                  <button
                    type="button"
                    onClick={resetVehicleForm}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-black text-slate-200 hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              <div className="space-y-2 pt-2">
                {vehicles.length === 0 && (
                  <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm font-bold text-slate-400">
                    No hay furgonetas creadas.
                  </div>
                )}

                {vehicles.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className={`rounded-lg border px-3 py-2 ${
                      vehicle.active
                        ? "border-slate-700 bg-slate-950"
                        : "border-slate-800 bg-slate-950 opacity-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-100">
                          {getVehicleLabel(vehicle)}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {vehicle.webfleetVehicleId && (
                            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-300">
                              WF: {vehicle.webfleetVehicleId}
                            </span>
                          )}
                          {vehicle.base && (
                            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-200">
                              {vehicle.base}
                            </span>
                          )}
                          {vehicle.esTaller && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                              Taller
                            </span>
                          )}
                        </div>
                        {getVehicleSubLabel(vehicle) && (
                          <div className="mt-0.5 truncate text-xs text-slate-400">
                            {getVehicleSubLabel(vehicle)}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => startVehicleEdit(vehicle)}
                          className="rounded-md border border-slate-700 bg-slate-950 p-2 text-slate-300 hover:bg-slate-800"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>

                        {vehicle.active && (
                          <button
                            type="button"
                            onClick={() => handleDeactivateVehicle(vehicle)}
                            className="rounded-md border border-red-500/40 bg-slate-950 p-2 text-red-300 hover:bg-red-500/15"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section
            className={`rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-sm ${
              adminTab === "operarios" ? "" : "hidden"
            }`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase text-slate-200">
                Operarios asistencia
              </h2>
              <KeyRound className="h-5 w-5 text-slate-400" />
            </div>

            {operatorCodeError && (
              <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-300">
                {operatorCodeError}
              </div>
            )}

            <div className="mb-4 rounded-lg border border-slate-700 bg-slate-950 p-3">
              <div className="mb-3 text-xs font-black uppercase text-slate-400">
                Alta operario
              </div>

              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_40px_110px]">
                <select
                  value={newOperatorName}
                  onChange={(event) => setNewOperatorName(event.target.value)}
                  className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 font-black"
                >
                  <option value="">
                    {availableTechs.length
                      ? "Selecciona operario"
                      : "No hay tecnicos pendientes"}
                  </option>
                  {availableTechs.map((tech) => (
                    <option key={tech.name} value={tech.name}>
                      {tech.name}
                    </option>
                  ))}
                </select>

                <input
                  value={newOperatorCode}
                  inputMode="numeric"
                  onChange={(event) => setNewOperatorCode(event.target.value)}
                  placeholder="Codigo"
                  className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 font-black"
                />

                <button
                  type="button"
                  title="Generar codigo"
                  onClick={generateNewOperatorCode}
                  disabled={!availableTechs.length}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={handleAddOperator}
                  disabled={addingOperator || !availableTechs.length}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-black text-white hover:bg-red-500 disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  Alta
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {operatorCodes.length === 0 && (
                <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-4 text-sm font-bold text-slate-400">
                  No hay operarios dados de alta para asistencia.
                </div>
              )}

              {operatorCodes.map((codeRecord) => {
                const techName = codeRecord.techName;
                const draftCode = operatorCodeDrafts[techName] || "";
                const isSaving = operatorCodeSavingName === techName;

                return (
                  <div
                    key={`operator-code-${techName}`}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate text-sm font-black text-slate-100">
                        {techName}
                      </div>
                      <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-black text-emerald-300">
                        Activo
                      </span>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_40px_40px_40px] gap-2">
                      <input
                        value={draftCode}
                        inputMode="numeric"
                        onChange={(event) =>
                          setOperatorCodeDrafts((prev) => ({
                            ...prev,
                            [techName]: event.target.value,
                          }))
                        }
                        className="min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 font-black"
                      />

                      <button
                        type="button"
                        title="Generar codigo"
                        onClick={() => generateOperatorCode(techName)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        title="Guardar codigo"
                        onClick={() => handleSaveOperatorCode(techName)}
                        disabled={isSaving}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        title="Dar de baja"
                        onClick={() => handleDeleteOperatorCode(techName)}
                        disabled={isSaving}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/40 bg-slate-950 text-red-300 hover:bg-red-500/15 disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Taller base / Geofencing */}
        <section
          className={`rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-sm ${
            adminTab === "taller" ? "" : "hidden"
          }`}
        >
          <div className="mb-4 flex items-center gap-2">
            <MapPin className="h-5 w-5 text-slate-400" />
            <h2 className="text-sm font-black uppercase text-slate-200">
              Taller base — geofencing automático
            </h2>
          </div>
          <p className="mb-4 text-xs text-slate-400">
            Cuando el operario llega a menos del radio configurado, la asistencia pasa automáticamente a <strong>Llegada al taller</strong>.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">Dirección</label>
              <input
                value={workshopConfig.taller_direccion}
                onChange={(e) => setWorkshopConfig((p) => ({ ...p, taller_direccion: e.target.value }))}
                placeholder="C/ Exemple, 1 — Tarragona"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">Latitud GPS</label>
              <input
                value={workshopConfig.taller_lat}
                onChange={(e) => setWorkshopConfig((p) => ({ ...p, taller_lat: e.target.value }))}
                placeholder="41.121134"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">Longitud GPS</label>
              <input
                value={workshopConfig.taller_lng}
                onChange={(e) => setWorkshopConfig((p) => ({ ...p, taller_lng: e.target.value }))}
                placeholder="1.242743"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">Radio detección (metros)</label>
              <input
                type="number"
                min={50}
                max={2000}
                value={workshopConfig.taller_radio_m}
                onChange={(e) => setWorkshopConfig((p) => ({ ...p, taller_radio_m: e.target.value }))}
                placeholder="300"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 font-mono"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveWorkshopConfig}
              disabled={workshopConfigSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {workshopConfigSaving ? "Guardando..." : "Guardar configuración"}
            </button>
            {workshopConfigMsg && (
              <span className={`text-sm font-semibold ${workshopConfigMsg.startsWith("Error") || workshopConfigMsg.startsWith("No se") ? "text-red-400" : "text-emerald-400"}`}>
                {workshopConfigMsg}
              </span>
            )}
          </div>

          {workshopConfig.taller_lat && workshopConfig.taller_lng && (
            <p className="mt-3 text-xs text-slate-400">
              Posición actual: {workshopConfig.taller_lat}, {workshopConfig.taller_lng} — radio {workshopConfig.taller_radio_m}m
              {" · "}
              <a
                href={`https://maps.google.com/?q=${workshopConfig.taller_lat},${workshopConfig.taller_lng}`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-slate-200"
              >
                Ver en Maps
              </a>
            </p>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
