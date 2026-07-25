import { useEffect, useState } from "react";
import {
  AGENDA_DAY_LABELS,
  DEFAULT_AGENDA_CONFIG,
  getBridgeSaturday,
  validateAgendaConfig,
  type AgendaConfig,
  type AgendaDaySchedule,
} from "../modules/agendaConfig";
import { saveAgendaConfig } from "../modules/agendaConfigApi";

type Props = {
  open: boolean;
  config: AgendaConfig;
  onClose: () => void;
  onSaved: (config: AgendaConfig) => void;
};

function formatSpanishDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return dateKey;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export default function AgendaConfigModal({ open, config, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<AgendaConfig>(config);
  const [newHoliday, setNewHoliday] = useState("");
  const [newHolidayLabel, setNewHolidayLabel] = useState("");
  const [newHolidayYearly, setNewHolidayYearly] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Festivo en viernes recién añadido, a la espera de decidir si se hace puente.
  const [bridgePrompt, setBridgePrompt] = useState<
    { holidayDate: string; holidayLabel: string; saturday: string } | null
  >(null);

  useEffect(() => {
    if (!open) return;
    setDraft(config);
    setNewHoliday("");
    setNewHolidayLabel("");
    setNewHolidayYearly(true);
    setBridgePrompt(null);
    setError("");
  }, [open, config]);

  if (!open) return null;

  function updateDay(index: number, patch: Partial<AgendaDaySchedule>) {
    setDraft((prev) => ({
      ...prev,
      days: prev.days.map((day, i) => (i === index ? { ...day, ...patch } : day)),
    }));
  }

  function addHoliday() {
    const date = newHoliday.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Selecciona la fecha del festivo.");
      return;
    }

    if (draft.holidays.some((h) => h.date === date)) {
      setError("Ese día ya está en la lista de festivos.");
      return;
    }

    const label = newHolidayLabel.trim();

    const next: AgendaConfig = {
      ...draft,
      holidays: [...draft.holidays, { date, label, yearly: newHolidayYearly }].sort(
        (a, b) => a.date.localeCompare(b.date)
      ),
    };

    setError("");
    setDraft(next);
    setNewHoliday("");
    setNewHolidayLabel("");
    setNewHolidayYearly(true);

    // Si cae en viernes, preguntar si se hace puente cerrando también el sábado.
    const saturday = getBridgeSaturday(next, date);
    setBridgePrompt(saturday ? { holidayDate: date, holidayLabel: label, saturday } : null);
  }

  function acceptBridge() {
    if (!bridgePrompt) return;

    const { saturday, holidayLabel } = bridgePrompt;

    setDraft((prev) => ({
      ...prev,
      holidays: [
        ...prev.holidays,
        {
          date: saturday,
          // El puente depende del día de la semana, así que nunca es anual.
          label: holidayLabel ? `Puente (${holidayLabel})` : "Puente",
          yearly: false,
        },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    }));

    setBridgePrompt(null);
  }

  function removeHoliday(date: string) {
    setDraft((prev) => ({
      ...prev,
      holidays: prev.holidays.filter((h) => h.date !== date),
    }));
  }

  function toggleHolidayYearly(date: string) {
    setDraft((prev) => ({
      ...prev,
      holidays: prev.holidays.map((h) =>
        h.date === date ? { ...h, yearly: !h.yearly } : h
      ),
    }));
  }

  async function save() {
    const errors = validateAgendaConfig(draft);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await saveAgendaConfig(draft);
      onSaved(saved);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Error guardando la configuración.");
    } finally {
      setSaving(false);
    }
  }

  const timeClass = "w-full rounded-xl border border-slate-200 px-2 py-2 text-sm";
  const labelClass = "mb-1 block text-xs font-medium text-slate-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-semibold">Configuración de la agenda</h3>
        <p className="mt-1 text-sm text-slate-500">
          Define el horario de cada día y los festivos. Las horas fuera de horario y
          los días cerrados quedan bloqueados en la agenda.
        </p>

        <div className="mt-5 space-y-6">
          <section>
            <h4 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-600">
              Horario semanal
            </h4>

            <div className="space-y-2">
              {draft.days.map((day, index) => (
                <div
                  key={index}
                  className="grid items-end gap-2 rounded-2xl border border-slate-200 p-3 md:grid-cols-[130px_repeat(4,1fr)]"
                >
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={!day.closed}
                      onChange={(e) => updateDay(index, { closed: !e.target.checked })}
                    />
                    {AGENDA_DAY_LABELS[index]}
                  </label>

                  {day.closed ? (
                    <div className="text-sm text-slate-400 md:col-span-4">Cerrado todo el día</div>
                  ) : (
                    <>
                      <div>
                        <label className={labelClass}>Mañana desde</label>
                        <input
                          type="time"
                          value={day.morningStart}
                          onChange={(e) => updateDay(index, { morningStart: e.target.value })}
                          className={timeClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Mañana hasta</label>
                        <input
                          type="time"
                          value={day.morningEnd}
                          onChange={(e) => updateDay(index, { morningEnd: e.target.value })}
                          className={timeClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Tarde desde</label>
                        <input
                          type="time"
                          value={day.afternoonStart}
                          onChange={(e) => updateDay(index, { afternoonStart: e.target.value })}
                          className={timeClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Tarde hasta</label>
                        <input
                          type="time"
                          value={day.afternoonEnd}
                          onChange={(e) => updateDay(index, { afternoonEnd: e.target.value })}
                          className={timeClass}
                        />
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-2 text-xs text-slate-500">
              Deja el turno de tarde vacío para los días con jornada continua.
            </p>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-600">
              Cierres especiales
            </h4>

            <label className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-3 text-sm">
              <input
                type="checkbox"
                checked={draft.closedSaturdaysInAugust}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, closedSaturdaysInAugust: e.target.checked }))
                }
              />
              Cerrado los sábados de agosto
            </label>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-600">
              Días festivos
            </h4>

            <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
              <input
                type="date"
                value={newHoliday}
                onChange={(e) => setNewHoliday(e.target.value)}
                className="rounded-2xl border border-slate-200 px-3 py-3"
              />
              <input
                value={newHolidayLabel}
                onChange={(e) => setNewHolidayLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addHoliday();
                }}
                placeholder="Motivo (p. ej. Diada de Catalunya)"
                className="rounded-2xl border border-slate-200 px-3 py-3"
              />
              <button
                type="button"
                onClick={addHoliday}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Añadir
              </button>
            </div>

            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={newHolidayYearly}
                onChange={(e) => setNewHolidayYearly(e.target.checked)}
              />
              Se repite cada año en la misma fecha
            </label>

            {bridgePrompt && (
              <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p>
                  El{" "}
                  <strong>{formatSpanishDateKey(bridgePrompt.holidayDate)}</strong>
                  {bridgePrompt.holidayLabel ? ` (${bridgePrompt.holidayLabel})` : ""} cae
                  en <strong>viernes</strong>. ¿Quieres hacer puente y cerrar también el
                  sábado <strong>{formatSpanishDateKey(bridgePrompt.saturday)}</strong>?
                </p>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={acceptBridge}
                    className="rounded-2xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                  >
                    Sí, cerrar el sábado
                  </button>
                  <button
                    type="button"
                    onClick={() => setBridgePrompt(null)}
                    className="rounded-2xl border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                  >
                    No, solo el viernes
                  </button>
                </div>
              </div>
            )}

            {draft.holidays.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Todavía no hay festivos configurados.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {draft.holidays.map((holiday) => {
                  const bridge = getBridgeSaturday(draft, holiday.date);

                  return (
                    <div
                      key={holiday.date}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    >
                      <span className="font-semibold">
                        {formatSpanishDateKey(holiday.date)}
                      </span>
                      <span className="flex-1 truncate">
                        {holiday.label || <span className="text-red-400">Sin motivo</span>}
                      </span>

                      {bridge && (
                        <button
                          type="button"
                          onClick={() =>
                            setBridgePrompt({
                              holidayDate: holiday.date,
                              holidayLabel: holiday.label,
                              saturday: bridge,
                            })
                          }
                          className="rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                          title="Cae en viernes: puedes cerrar también el sábado"
                        >
                          Viernes · hacer puente
                        </button>
                      )}

                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={holiday.yearly}
                          onChange={() => toggleHolidayYearly(holiday.date)}
                        />
                        Cada año
                      </label>

                      <button
                        type="button"
                        onClick={() => removeHoliday(holiday.date)}
                        className="font-black"
                        title="Quitar festivo"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-2 text-xs text-slate-500">
              Los festivos marcados como "cada año" bloquean esa misma fecha en los
              años siguientes; el resto solo bloquean el día concreto.
            </p>
          </section>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDraft(DEFAULT_AGENDA_CONFIG)}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Restaurar horario estándar
            </button>

            <div className="flex gap-2">
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
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Guardando..." : "Guardar configuración"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
