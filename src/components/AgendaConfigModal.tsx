import { useEffect, useState } from "react";
import {
  AGENDA_DAY_LABELS,
  DEFAULT_AGENDA_CONFIG,
  getBridgeSaturday,
  getFridayBridgeStatus,
  validateAgendaConfig,
  type AgendaConfig,
  type AgendaDaySchedule,
  type AgendaSpecialDay,
} from "../modules/agendaConfig";
import {
  saveAgendaConfig,
  suggestHolidaysWithAI,
  type FestivoSugerido,
} from "../modules/agendaConfigApi";

type Props = {
  open: boolean;
  config: AgendaConfig;
  onClose: () => void;
  onSaved: (config: AgendaConfig) => void;
  /** Paleta oscura de Agenda 2 / WorkPlanner. Por defecto, tema claro. */
  dark?: boolean;
};

function formatSpanishDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return dateKey;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export default function AgendaConfigModal({
  open,
  config,
  onClose,
  onSaved,
  dark = false,
}: Props) {
  const [draft, setDraft] = useState<AgendaConfig>(config);
  const [newHoliday, setNewHoliday] = useState("");
  const [newHolidayLabel, setNewHolidayLabel] = useState("");
  const [newHolidayYearly, setNewHolidayYearly] = useState(true);
  const [newSpecial, setNewSpecial] = useState({
    date: "",
    label: "",
    yearly: true,
    morningStart: "08:30",
    morningEnd: "14:00",
    afternoonStart: "",
    afternoonEnd: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Generador de festivos con IA
  const [aiCity, setAiCity] = useState("Tarragona");
  const [aiYear, setAiYear] = useState(String(new Date().getFullYear()));
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<FestivoSugerido[] | null>(null);
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
    setNewSpecial({
      date: "",
      label: "",
      yearly: true,
      morningStart: "08:30",
      morningEnd: "14:00",
      afternoonStart: "",
      afternoonEnd: "",
    });
    setBridgePrompt(null);
    setAiResult(null);
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

  function addSpecialDay() {
    const date = newSpecial.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Selecciona la fecha de la jornada especial.");
      return;
    }

    if (draft.specialDays.some((s) => s.date === date)) {
      setError("Ese día ya tiene una jornada especial configurada.");
      return;
    }

    setError("");
    setDraft((prev) => ({
      ...prev,
      specialDays: [
        ...prev.specialDays,
        {
          date,
          label: newSpecial.label.trim(),
          yearly: newSpecial.yearly,
          closed: false,
          morningStart: newSpecial.morningStart,
          morningEnd: newSpecial.morningEnd,
          afternoonStart: newSpecial.afternoonStart,
          afternoonEnd: newSpecial.afternoonEnd,
        },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    }));

    setNewSpecial({
      date: "",
      label: "",
      yearly: true,
      morningStart: "08:30",
      morningEnd: "14:00",
      afternoonStart: "",
      afternoonEnd: "",
    });
  }

  function updateSpecialDay(date: string, patch: Partial<AgendaSpecialDay>) {
    setDraft((prev) => ({
      ...prev,
      specialDays: prev.specialDays.map((s) =>
        s.date === date ? { ...s, ...patch } : s
      ),
    }));
  }

  function removeSpecialDay(date: string) {
    setDraft((prev) => ({
      ...prev,
      specialDays: prev.specialDays.filter((s) => s.date !== date),
    }));
  }

  async function generateHolidaysWithAI() {
    const year = Number(aiYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setError("Indica un año válido para buscar los festivos.");
      return;
    }
    if (!aiCity.trim()) {
      setError("Indica la ciudad para buscar los festivos.");
      return;
    }

    setAiLoading(true);
    setError("");
    setAiResult(null);
    try {
      const festivos = await suggestHolidaysWithAI(year, aiCity.trim());
      setAiResult(festivos);
    } catch (e: any) {
      setError(e?.message || "Error consultando los festivos con IA.");
    } finally {
      setAiLoading(false);
    }
  }

  /** Añade los festivos propuestos que aún no estén en la lista. */
  function applyAiHolidays() {
    if (!aiResult) return;

    setDraft((prev) => {
      const existing = new Set(prev.holidays.map((h) => h.date));
      const nuevos = aiResult
        .filter((f) => !existing.has(f.date))
        .map((f) => ({ date: f.date, label: f.label, yearly: f.yearly }));

      return {
        ...prev,
        holidays: [...prev.holidays, ...nuevos].sort((a, b) =>
          a.date.localeCompare(b.date)
        ),
      };
    });

    setAiResult(null);
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

  // Paleta del modal. La rama clara reproduce exactamente las clases originales,
  // así que la Agenda 1 queda igual; la oscura sigue los colores de Agenda 2.
  const th = {
    overlay: dark ? "bg-slate-950/70" : "bg-slate-900/40",
    panel: dark
      ? "border border-slate-700 bg-slate-800 text-slate-100"
      : "bg-white text-slate-900",
    subtitle: dark ? "text-slate-400" : "text-slate-500",
    sectionTitle: dark ? "text-slate-300" : "text-slate-600",
    hint: dark ? "text-slate-400" : "text-slate-500",
    faint: dark ? "text-slate-500" : "text-slate-400",
    body: dark ? "text-slate-300" : "text-slate-600",
    card: dark ? "border-slate-700 bg-slate-900/60" : "border-slate-200",
    input: dark
      ? "border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500"
      : "border-slate-200",
    primaryBtn: dark
      ? "bg-emerald-600 text-white hover:bg-emerald-500"
      : "bg-slate-900 text-white",
    neutralBtn: dark
      ? "border-slate-600 bg-slate-700 text-slate-100 hover:bg-slate-600"
      : "border-slate-200 text-slate-600 hover:bg-slate-50",
    amberCard: dark ? "border-amber-700/60 bg-amber-950/30" : "border-amber-200 bg-amber-50",
    amberText: dark ? "text-amber-200" : "text-amber-900",
    amberFaint: dark ? "text-amber-500/70" : "text-amber-500",
    amberBtnGhost: dark
      ? "border-amber-700 text-amber-200 hover:bg-amber-900/40"
      : "border-amber-300 text-amber-800 hover:bg-amber-100",
    indigoCard: dark ? "border-indigo-800/60 bg-indigo-950/40" : "border-indigo-200 bg-indigo-50",
    indigoTitle: dark ? "text-indigo-200" : "text-indigo-900",
    indigoText: dark ? "text-indigo-300" : "text-indigo-700",
    indigoInput: dark
      ? "border-indigo-800 bg-slate-900 text-slate-100 placeholder:text-slate-500"
      : "border-indigo-200",
    indigoInner: dark ? "border-indigo-800/60 bg-slate-900" : "border-indigo-200 bg-white",
    redCard: dark ? "border-rose-800/60 bg-rose-950/30 text-rose-200" : "border-red-200 bg-red-50 text-red-800",
    redFaint: dark ? "text-rose-400/70" : "text-red-400",
    redGhostBtn: dark
      ? "border-rose-600 bg-rose-900/40 text-rose-200 hover:bg-rose-900/70"
      : "border-red-400 bg-white text-red-700 hover:bg-red-100",
    emeraldChip: dark
      ? "border-emerald-700 bg-emerald-900/40 text-emerald-300"
      : "border-emerald-400 bg-emerald-50 text-emerald-700",
    errorBox: dark
      ? "border-rose-800 bg-rose-950/40 text-rose-300"
      : "border-red-200 bg-red-50 text-red-700",
    scopeChip: dark ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500",
    ok: dark ? "text-emerald-400" : "text-emerald-600",
    warn: dark ? "text-rose-400" : "text-red-600",
    scopeChipLocal: dark
      ? "bg-amber-900/50 font-bold text-amber-200"
      : "bg-amber-100 font-bold text-amber-800",
  };

  const timeClass = `w-full rounded-xl border px-2 py-2 text-sm ${th.input}`;
  const labelClass = `mb-1 block text-xs font-medium ${th.subtitle}`;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${th.overlay}`}>
      <div className={`max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-3xl p-6 shadow-2xl ${th.panel}`}>
        <h3 className="text-xl font-semibold">Configuración de la agenda</h3>
        <p className={`mt-1 text-sm ${th.subtitle}`}>
          Define el horario de cada día y los festivos. Las horas fuera de horario y
          los días cerrados quedan bloqueados en la agenda.
        </p>

        <div className="mt-5 space-y-6">
          <section>
            <h4 className={`mb-2 text-sm font-black uppercase tracking-wide ${th.sectionTitle}`}>
              Horario semanal
            </h4>

            <div className="space-y-2">
              {draft.days.map((day, index) => (
                <div
                  key={index}
                  className={`grid items-end gap-2 rounded-2xl border p-3 md:grid-cols-[130px_repeat(4,1fr)] ${th.card}`}
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
                    <div className={`text-sm md:col-span-4 ${th.faint}`}>Cerrado todo el día</div>
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

            <p className={`mt-2 text-xs ${th.hint}`}>
              Deja el turno de tarde vacío para los días con jornada continua.
            </p>
          </section>

          <section>
            <h4 className={`mb-2 text-sm font-black uppercase tracking-wide ${th.sectionTitle}`}>
              Cierres especiales
            </h4>

            <label className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm ${th.card}`}>
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
            <h4 className={`mb-2 text-sm font-black uppercase tracking-wide ${th.sectionTitle}`}>
              Días con horario especial
            </h4>
            <p className={`mb-2 text-xs ${th.hint}`}>
              Jornadas puntuales distintas al horario semanal, por ejemplo el 24 de
              diciembre de 8:30 a 14:00.
            </p>

            <div className={`rounded-2xl border p-3 ${th.card}`}>
              <div className="grid gap-2 md:grid-cols-[170px_1fr]">
                <input
                  type="date"
                  value={newSpecial.date}
                  onChange={(e) => setNewSpecial((p) => ({ ...p, date: e.target.value }))}
                  className={`rounded-2xl border px-3 py-3 ${th.input}`}
                />
                <input
                  value={newSpecial.label}
                  onChange={(e) => setNewSpecial((p) => ({ ...p, label: e.target.value }))}
                  placeholder="Motivo (p. ej. Nochebuena)"
                  className={`rounded-2xl border px-3 py-3 ${th.input}`}
                />
              </div>

              <div className="mt-2 grid gap-2 md:grid-cols-4">
                <div>
                  <label className={labelClass}>Mañana desde</label>
                  <input
                    type="time"
                    value={newSpecial.morningStart}
                    onChange={(e) => setNewSpecial((p) => ({ ...p, morningStart: e.target.value }))}
                    className={timeClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Mañana hasta</label>
                  <input
                    type="time"
                    value={newSpecial.morningEnd}
                    onChange={(e) => setNewSpecial((p) => ({ ...p, morningEnd: e.target.value }))}
                    className={timeClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Tarde desde</label>
                  <input
                    type="time"
                    value={newSpecial.afternoonStart}
                    onChange={(e) => setNewSpecial((p) => ({ ...p, afternoonStart: e.target.value }))}
                    className={timeClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Tarde hasta</label>
                  <input
                    type="time"
                    value={newSpecial.afternoonEnd}
                    onChange={(e) => setNewSpecial((p) => ({ ...p, afternoonEnd: e.target.value }))}
                    className={timeClass}
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className={`flex items-center gap-2 text-sm ${th.body}`}>
                  <input
                    type="checkbox"
                    checked={newSpecial.yearly}
                    onChange={(e) => setNewSpecial((p) => ({ ...p, yearly: e.target.checked }))}
                  />
                  Se repite cada año en la misma fecha
                </label>

                <button
                  type="button"
                  onClick={addSpecialDay}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium ${th.primaryBtn}`}
                >
                  Añadir jornada especial
                </button>
              </div>
            </div>

            {draft.specialDays.length === 0 ? (
              <p className={`mt-3 text-sm ${th.faint}`}>
                Todavía no hay jornadas especiales configuradas.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {draft.specialDays.map((special) => (
                  <div
                    key={special.date}
                    className={`rounded-2xl border px-3 py-2 ${th.amberCard}`}
                  >
                    <div className={`flex flex-wrap items-center gap-3 text-sm ${th.amberText}`}>
                      <span className="font-semibold">
                        {formatSpanishDateKey(special.date)}
                      </span>
                      <span className="flex-1 truncate">
                        {special.label || <span className={th.amberFaint}>Sin motivo</span>}
                      </span>

                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={special.yearly}
                          onChange={() =>
                            updateSpecialDay(special.date, { yearly: !special.yearly })
                          }
                        />
                        Cada año
                      </label>

                      <button
                        type="button"
                        onClick={() => removeSpecialDay(special.date)}
                        className="font-black"
                        title="Quitar jornada especial"
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-2 grid gap-2 md:grid-cols-4">
                      <div>
                        <label className={labelClass}>Mañana desde</label>
                        <input
                          type="time"
                          value={special.morningStart}
                          onChange={(e) =>
                            updateSpecialDay(special.date, { morningStart: e.target.value })
                          }
                          className={timeClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Mañana hasta</label>
                        <input
                          type="time"
                          value={special.morningEnd}
                          onChange={(e) =>
                            updateSpecialDay(special.date, { morningEnd: e.target.value })
                          }
                          className={timeClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Tarde desde</label>
                        <input
                          type="time"
                          value={special.afternoonStart}
                          onChange={(e) =>
                            updateSpecialDay(special.date, { afternoonStart: e.target.value })
                          }
                          className={timeClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Tarde hasta</label>
                        <input
                          type="time"
                          value={special.afternoonEnd}
                          onChange={(e) =>
                            updateSpecialDay(special.date, { afternoonEnd: e.target.value })
                          }
                          className={timeClass}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h4 className={`mb-2 text-sm font-black uppercase tracking-wide ${th.sectionTitle}`}>
              Días festivos
            </h4>

            <div className={`mb-3 rounded-2xl border p-3 ${th.indigoCard}`}>
              <p className={`text-sm font-semibold ${th.indigoTitle}`}>
                Generar festivos automáticamente
              </p>
              <p className={`mt-1 text-xs ${th.indigoText}`}>
                Consulta con IA los festivos no laborables (nacionales, autonómicos y
                locales) de una ciudad. Revísalos antes de añadirlos.
              </p>

              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_120px_auto]">
                <input
                  value={aiCity}
                  onChange={(e) => setAiCity(e.target.value)}
                  placeholder="Ciudad (p. ej. Tarragona)"
                  className={`rounded-2xl border px-3 py-3 ${th.indigoInput}`}
                />
                <input
                  type="number"
                  value={aiYear}
                  onChange={(e) => setAiYear(e.target.value)}
                  placeholder="Año"
                  className={`rounded-2xl border px-3 py-3 ${th.indigoInput}`}
                />
                <button
                  type="button"
                  onClick={() => void generateHolidaysWithAI()}
                  disabled={aiLoading}
                  className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {aiLoading ? "Consultando..." : "Buscar festivos"}
                </button>
              </div>

              {aiResult && (
                <div className={`mt-3 rounded-2xl border p-3 ${th.indigoInner}`}>
                  <p className={`text-sm font-semibold ${th.body}`}>
                    {aiResult.length} festivos encontrados en {aiCity} ({aiYear})
                    {" · "}
                    <span
                      className={
                        aiResult.filter((f) => f.scope === "local").length === 2
                          ? th.ok
                          : th.warn
                      }
                    >
                      {aiResult.filter((f) => f.scope === "local").length} locales
                    </span>
                  </p>

                  {aiResult.filter((f) => f.scope === "local").length !== 2 && (
                    <p className={`mt-1 text-xs ${th.warn}`}>
                      En España cada municipio tiene 2 festivos locales. Revisa el
                      calendario oficial y añade a mano los que falten.
                    </p>
                  )}

                  <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                    {aiResult.map((festivo) => {
                      const yaEsta = draft.holidays.some((h) => h.date === festivo.date);

                      return (
                        <div
                          key={festivo.date}
                          className={`flex flex-wrap items-center gap-2 text-sm ${th.body}`}
                        >
                          <span className="w-24 font-semibold">
                            {formatSpanishDateKey(festivo.date)}
                          </span>
                          <span className="flex-1 truncate">{festivo.label}</span>
                          {festivo.scope && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                                festivo.scope === "local"
                                  ? th.scopeChipLocal
                                  : th.scopeChip
                              }`}
                            >
                              {festivo.scope}
                            </span>
                          )}
                          {festivo.confidence === "baja" && (
                            <span
                              className={`text-xs font-semibold ${th.warn}`}
                              title="La IA no está segura de este festivo: compruébalo"
                            >
                              revisar
                            </span>
                          )}
                          <span className={`text-xs ${th.faint}`}>
                            {festivo.yearly ? "cada año" : "solo este año"}
                          </span>
                          {yaEsta && (
                            <span className={`text-xs font-semibold ${th.ok}`}>
                              ya añadido
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={applyAiHolidays}
                      className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      Añadir a la lista
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiResult(null)}
                      className={`rounded-2xl border px-4 py-2 text-sm font-medium ${th.neutralBtn}`}
                    >
                      Descartar
                    </button>
                  </div>

                  <p className={`mt-2 text-xs ${th.hint}`}>
                    Los festivos móviles (Semana Santa) se añaden solo para ese año; los
                    de fecha fija quedan marcados como "cada año".
                  </p>
                </div>
              )}
            </div>

            <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
              <input
                type="date"
                value={newHoliday}
                onChange={(e) => setNewHoliday(e.target.value)}
                className={`rounded-2xl border px-3 py-3 ${th.input}`}
              />
              <input
                value={newHolidayLabel}
                onChange={(e) => setNewHolidayLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addHoliday();
                }}
                placeholder="Motivo (p. ej. Diada de Catalunya)"
                className={`rounded-2xl border px-3 py-3 ${th.input}`}
              />
              <button
                type="button"
                onClick={addHoliday}
                className={`rounded-2xl px-4 py-2 text-sm font-medium ${th.primaryBtn}`}
              >
                Añadir
              </button>
            </div>

            <label className={`mt-2 flex items-center gap-2 text-sm ${th.body}`}>
              <input
                type="checkbox"
                checked={newHolidayYearly}
                onChange={(e) => setNewHolidayYearly(e.target.checked)}
              />
              Se repite cada año en la misma fecha
            </label>

            {bridgePrompt && (
              <div className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${th.amberCard} ${th.amberText}`}>
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
                    className={`rounded-2xl border px-4 py-2 text-sm font-medium ${th.amberBtnGhost}`}
                  >
                    No, solo el viernes
                  </button>
                </div>
              </div>
            )}

            {draft.holidays.length === 0 ? (
              <p className={`mt-3 text-sm ${th.faint}`}>Todavía no hay festivos configurados.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {draft.holidays.map((holiday) => {
                  const bridge = getFridayBridgeStatus(draft, holiday.date);

                  return (
                    <div
                      key={holiday.date}
                      className={`flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-2 text-sm ${th.redCard}`}
                    >
                      <span className="font-semibold">
                        {formatSpanishDateKey(holiday.date)}
                      </span>
                      <span className="flex-1 truncate">
                        {holiday.label || <span className={th.redFaint}>Sin motivo</span>}
                      </span>

                      {bridge.state === "pending" && (
                        <button
                          type="button"
                          onClick={() =>
                            setBridgePrompt({
                              holidayDate: holiday.date,
                              holidayLabel: holiday.label,
                              saturday: bridge.saturday,
                            })
                          }
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${th.redGhostBtn}`}
                          title={`Cae en viernes: puedes cerrar también el sábado ${formatSpanishDateKey(
                            bridge.saturday
                          )}`}
                        >
                          <span aria-hidden>🔺</span> Cae en viernes · hacer puente
                        </button>
                      )}

                      {bridge.state === "done" && (
                        <span
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${th.emeraldChip}`}
                          title={`Puente hecho: el sábado ${formatSpanishDateKey(
                            bridge.saturday
                          )} también está cerrado`}
                        >
                          <span aria-hidden>🟢</span> Puente hecho
                        </span>
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

            <p className={`mt-2 text-xs ${th.hint}`}>
              Los festivos marcados como "cada año" bloquean esa misma fecha en los
              años siguientes; el resto solo bloquean el día concreto.
            </p>
          </section>

          {error && (
            <div className={`rounded-2xl border px-4 py-3 text-sm ${th.errorBox}`}>
              {error}
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDraft(DEFAULT_AGENDA_CONFIG)}
              className={`rounded-2xl border px-4 py-2 text-sm font-medium ${th.neutralBtn}`}
            >
              Restaurar horario estándar
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`rounded-2xl border px-4 py-2 text-sm font-medium ${th.neutralBtn}`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className={`rounded-2xl px-4 py-2 text-sm font-medium disabled:opacity-60 ${th.primaryBtn}`}
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
