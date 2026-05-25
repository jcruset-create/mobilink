import type { NewCustomExtraTaskV2State } from "../modules/customExtraTaskV2Helpers";

type Props = {
  draft: NewCustomExtraTaskV2State;
  setDraft: React.Dispatch<React.SetStateAction<NewCustomExtraTaskV2State>>;
};

function toNullableStringNumber(value: string) {
  return value.replace(",", ".");
}

export default function CustomExtraTaskV2Fields({ draft, setDraft }: Props) {
  const minutesValue = draft.usesQuantity
    ? draft.unitMinutes
    : draft.standardMinutes || draft.unitMinutes;

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-black text-slate-800">
            Cantidad, tiempo y precio
          </div>
          <div className="text-xs font-semibold text-slate-500">
            Configuración v2 para tareas extra.
          </div>
        </div>

        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
          <input
            type="checkbox"
            checked={draft.usesQuantity}
            onChange={(event) =>
              setDraft((prev) => {
                const checked = event.target.checked;
                const nextMinutes = prev.unitMinutes || prev.standardMinutes;

                return {
                  ...prev,
                  usesQuantity: checked,
                  unitMinutes: nextMinutes,
                  standardMinutes: checked
                    ? nextMinutes
                    : prev.standardMinutes || nextMinutes,
                };
              })
            }
          />
          Usar cantidad
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-xs font-bold text-slate-600">
          {draft.usesQuantity
            ? "Minutos por unidad"
            : "Tiempo estándar en minutos"}
          <input
            type="number"
            min="0"
            value={minutesValue}
            onChange={(event) => {
              const value = toNullableStringNumber(event.target.value);

              setDraft((prev) => ({
                ...prev,
                unitMinutes: value,
                standardMinutes: draft.usesQuantity ? value : value,
              }));
            }}
            placeholder={
              draft.usesQuantity ? "Ej. 5 por unidad" : "Ej. 15 total"
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="grid gap-1 text-xs font-bold text-slate-600">
          Precio por unidad
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.unitPrice}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                unitPrice: toNullableStringNumber(event.target.value),
              }))
            }
            placeholder="Ej. 10"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>

        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
            Vista previa
          </div>

          <div className="text-sm font-black text-slate-900">
            {draft.usesQuantity
              ? `${draft.unitMinutes || "0"} min / unidad`
              : `${draft.standardMinutes || draft.unitMinutes || "0"} min total`}
          </div>

          <div className="text-xs font-bold text-slate-500">
            Precio:{" "}
            {Number(draft.unitPrice || 0).toLocaleString("es-ES", {
              style: "currency",
              currency: "EUR",
            })}{" "}
            / unidad
          </div>
        </div>
      </div>

      {draft.usesQuantity && (
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
          Esta tarea extra se podrá calcular por cantidad.
        </div>
      )}
    </div>
  );
}