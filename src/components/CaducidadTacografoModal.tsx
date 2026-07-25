import { useEffect, useState } from "react";
import {
  calcularFechaAviso,
  formatSpanishDateKey,
  getFechaCaducidadPorDefecto,
  type CaducidadReminder,
} from "../modules/caducidadHelpers";
import {
  createCaducidadReminder,
  updateCaducidadReminder,
  type CaducidadDraft,
} from "../modules/caducidadApi";

type Props = {
  open: boolean;
  /** Recordatorio a editar; null para crear uno nuevo. */
  editing: CaducidadReminder | null;
  workshopId: string;
  onClose: () => void;
  onSaved: (reminder: CaducidadReminder) => void;
};

// Solo tacógrafo: el tipo indica qué revisión de tacógrafo es.
const TIPOS_CADUCIDAD = [
  { value: "tacografo_analogico", label: "Revisión Tacógrafo Analógico" },
  { value: "tacografo_digital_3_0", label: "Revisión Tacógrafo Digital 3.0" },
  { value: "tacografo_digital_4_0", label: "Revisión Tacógrafo Digital 4.0" },
  { value: "tacografo_digital_4_1", label: "Revisión Tacógrafo Digital 4.1" },
  { value: "tacografo_digital_4_1_actualizacion", label: "Revisión Tacógrafo Digital 4.1 + Actualización" },
];

function todayKey() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function emptyDraft(workshopId: string): CaducidadDraft {
  return {
    workshopId,
    cliente_nombre: "",
    vehiculo: "",
    matricula: "",
    telefono: "",
    unidad: "",
    tipo_caducidad: TIPOS_CADUCIDAD[0].value,
    // La revisión de tacógrafo caduca a los 2 años → se propone hoy + 2 años (editable).
    fecha_caducidad: getFechaCaducidadPorDefecto(todayKey()),
    dias_antelacion: 15,
    dias_antelacion2: 7,
    enviar_whatsapp: true,
    enviar_sms: true,
    observaciones: "",
  };
}

export default function CaducidadTacografoModal({
  open,
  editing,
  workshopId,
  onClose,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<CaducidadDraft>(() => emptyDraft(workshopId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    if (editing) {
      setDraft({
        workshopId: editing.workshopId ?? workshopId,
        cliente_nombre: editing.cliente_nombre,
        vehiculo: editing.vehiculo,
        matricula: editing.matricula,
        unidad: editing.unidad ?? "",
        telefono: editing.telefono,
        tipo_caducidad: editing.tipo_caducidad,
        fecha_caducidad: editing.fecha_caducidad,
        dias_antelacion: editing.dias_antelacion,
        dias_antelacion2: editing.dias_antelacion2 ?? 7,
        enviar_whatsapp: editing.enviar_whatsapp,
        enviar_sms: editing.enviar_sms,
        observaciones: editing.observaciones,
      });
    } else {
      setDraft(emptyDraft(workshopId));
    }
  }, [open, editing, workshopId]);

  if (!open) return null;

  const fechaAviso = calcularFechaAviso(draft.fecha_caducidad, draft.dias_antelacion);
  const fechaAviso2 = calcularFechaAviso(draft.fecha_caducidad, draft.dias_antelacion2);

  async function save() {
    if (!draft.cliente_nombre.trim()) return setError("Escribe el nombre del cliente.");
    if (!draft.matricula.trim()) return setError("Escribe la matrícula.");
    if (!draft.telefono.trim()) return setError("Escribe el teléfono móvil.");
    if (!fechaAviso) return setError("Selecciona la fecha de caducidad.");
    if (!draft.enviar_whatsapp && !draft.enviar_sms) {
      return setError("Activa al menos un canal de aviso (WhatsApp o SMS).");
    }

    setSaving(true);
    setError("");
    try {
      const saved = editing
        ? await updateCaducidadReminder(editing.id, draft)
        : await createCaducidadReminder(draft);
      onSaved(saved);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Error guardando el recordatorio.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-2xl border border-slate-200 px-3 py-3";
  const labelClass = "mb-1 block text-xs font-medium text-slate-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-semibold">
          {editing ? "Editar caducidad de tacógrafo" : "Nueva caducidad de tacógrafo"}
        </h3>

        <p className="mt-1 text-sm text-slate-500">
          El cliente recibirá un aviso automático {draft.dias_antelacion} días antes
          de la fecha de caducidad por los canales activados.
        </p>

        <div className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelClass}>Cliente</label>
              <input
                value={draft.cliente_nombre}
                onChange={(e) => setDraft((p) => ({ ...p, cliente_nombre: e.target.value }))}
                placeholder="Transportes Ejemplo"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Teléfono móvil</label>
              <input
                value={draft.telefono}
                onChange={(e) => setDraft((p) => ({ ...p, telefono: e.target.value }))}
                placeholder="600 000 000"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelClass}>Vehículo</label>
              <input
                value={draft.vehiculo}
                onChange={(e) => setDraft((p) => ({ ...p, vehiculo: e.target.value }))}
                placeholder="Camión rígido, tractora..."
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Matrícula</label>
              <input
                value={draft.matricula}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, matricula: e.target.value.toUpperCase() }))
                }
                placeholder="1234 ABC"
                className={`${inputClass} uppercase`}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Nº unidad</label>
            <input
              value={draft.unidad}
              onChange={(e) => setDraft((p) => ({ ...p, unidad: e.target.value }))}
              placeholder="Nº de unidad / flota"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Tipo de revisión</label>
            <select
              value={draft.tipo_caducidad}
              onChange={(e) => setDraft((p) => ({ ...p, tipo_caducidad: e.target.value }))}
              className={inputClass}
            >
              {!TIPOS_CADUCIDAD.some((tipo) => tipo.value === draft.tipo_caducidad) && (
                <option value={draft.tipo_caducidad}>{draft.tipo_caducidad}</option>
              )}
              {TIPOS_CADUCIDAD.map((tipo) => (
                <option key={tipo.value} value={tipo.value}>
                  {tipo.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelClass}>Fecha de caducidad (2 años desde hoy, editable)</label>
              <input
                type="date"
                value={draft.fecha_caducidad}
                onChange={(e) => setDraft((p) => ({ ...p, fecha_caducidad: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>1er aviso (días)</label>
                <input
                  type="number"
                  min={0}
                  value={draft.dias_antelacion}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      dias_antelacion: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                    }))
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>2º aviso (días)</label>
                <input
                  type="number"
                  min={0}
                  value={draft.dias_antelacion2}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      dias_antelacion2: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                    }))
                  }
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {fechaAviso && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              1er aviso el <strong>{formatSpanishDateKey(fechaAviso)}</strong>
              {fechaAviso2 && (
                <>
                  {" "}· 2º aviso el <strong>{formatSpanishDateKey(fechaAviso2)}</strong>
                </>
              )}
              . Si cae en fin de semana se adelanta al viernes.
            </div>
          )}

          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              <input
                type="checkbox"
                checked={draft.enviar_whatsapp}
                onChange={(e) => setDraft((p) => ({ ...p, enviar_whatsapp: e.target.checked }))}
              />
              Enviar por WhatsApp
            </label>
            <label className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              <input
                type="checkbox"
                checked={draft.enviar_sms}
                onChange={(e) => setDraft((p) => ({ ...p, enviar_sms: e.target.checked }))}
              />
              Enviar por SMS
            </label>
          </div>

          <div>
            <label className={labelClass}>Observaciones</label>
            <textarea
              value={draft.observaciones}
              onChange={(e) => setDraft((p) => ({ ...p, observaciones: e.target.value }))}
              rows={3}
              className={inputClass}
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-2xl bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60"
            >
              {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear recordatorio"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
