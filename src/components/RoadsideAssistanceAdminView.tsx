import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Edit3,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Truck,
} from "lucide-react";

import type { Tech } from "../modules/workshopTypes";
import type {
  RoadsideOperatorCode,
  RoadsideVehicle,
  RoadsideVehicleDraft,
} from "../modules/roadsideAssistanceTypes";

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

function getVehicleLabel(vehicle: RoadsideVehicle) {
  return [vehicle.name, vehicle.plate].filter(Boolean).join(" - ");
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

    operatorCodes.forEach((item) => {
      nextDrafts[item.techName] = item.code || "";
    });

    setOperatorCodeDrafts(nextDrafts);
  }, [operatorCodes]);

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

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-200 bg-red-50">
              <Truck className="h-6 w-6 text-red-700" />
            </div>
            <div>
              <h1 className="text-xl font-black">
                Configuracion asistencia
              </h1>
              <div className="text-sm font-medium text-slate-500">
                {activeVehicleCount} furgonetas activas - {operatorCodes.length} operarios asistencia
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase text-slate-700">
                Furgonetas
              </h2>
              <Truck className="h-5 w-5 text-slate-500" />
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase outline-none focus:ring-2 focus:ring-slate-300"
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
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
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
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
                <span className="text-sm font-black text-slate-700">
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
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              />

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
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
                <span className="text-sm font-black text-slate-700">
                  Furgoneta activa
                </span>
              </label>

              {vehicleError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {vehicleError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveVehicle}
                  disabled={vehicleSaving}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {editingVehicle ? "Guardar" : "Crear"}
                </button>

                {editingVehicle && (
                  <button
                    type="button"
                    onClick={resetVehicleForm}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              <div className="space-y-2 pt-2">
                {vehicles.length === 0 && (
                  <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm font-bold text-slate-400">
                    No hay furgonetas creadas.
                  </div>
                )}

                {vehicles.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className={`rounded-lg border px-3 py-2 ${
                      vehicle.active
                        ? "border-slate-200 bg-slate-50"
                        : "border-slate-200 bg-white opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-800">
                          {getVehicleLabel(vehicle)}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {vehicle.webfleetVehicleId && (
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                              WF: {vehicle.webfleetVehicleId}
                            </span>
                          )}
                          {vehicle.base && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                              {vehicle.base}
                            </span>
                          )}
                          {vehicle.esTaller && (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                              Taller
                            </span>
                          )}
                        </div>
                        {(vehicle.marca || vehicle.modelo) && (
                          <div className="mt-0.5 truncate text-xs text-slate-400">
                            {[vehicle.marca, vehicle.modelo].filter(Boolean).join(" ")}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => startVehicleEdit(vehicle)}
                          className="rounded-md border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>

                        {vehicle.active && (
                          <button
                            type="button"
                            onClick={() => handleDeactivateVehicle(vehicle)}
                            className="rounded-md border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50"
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

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase text-slate-700">
                Operarios asistencia
              </h2>
              <KeyRound className="h-5 w-5 text-slate-500" />
            </div>

            {operatorCodeError && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {operatorCodeError}
              </div>
            )}

            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 text-xs font-black uppercase text-slate-500">
                Alta operario
              </div>

              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_40px_110px]">
                <select
                  value={newOperatorName}
                  onChange={(event) => setNewOperatorName(event.target.value)}
                  className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black outline-none focus:ring-2 focus:ring-slate-300"
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
                  className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black outline-none focus:ring-2 focus:ring-slate-300"
                />

                <button
                  type="button"
                  title="Generar codigo"
                  onClick={generateNewOperatorCode}
                  disabled={!availableTechs.length}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={handleAddOperator}
                  disabled={addingOperator || !availableTechs.length}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  Alta
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {operatorCodes.length === 0 && (
                <div className="rounded-lg bg-slate-50 px-3 py-4 text-sm font-bold text-slate-400">
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
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="min-w-0 truncate text-sm font-black text-slate-800">
                        {techName}
                      </div>
                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
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
                        className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black outline-none focus:ring-2 focus:ring-slate-300"
                      />

                      <button
                        type="button"
                        title="Generar codigo"
                        onClick={() => generateOperatorCode(techName)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        title="Guardar codigo"
                        onClick={() => handleSaveOperatorCode(techName)}
                        disabled={isSaving}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        <Save className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        title="Dar de baja"
                        onClick={() => handleDeleteOperatorCode(techName)}
                        disabled={isSaving}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-60"
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
      </div>
    </div>
  );
}
