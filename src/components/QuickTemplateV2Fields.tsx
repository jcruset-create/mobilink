import type { NewQuickTemplateV2State } from "../modules/quickTemplateV2Helpers";

type Props = {
  draft: NewQuickTemplateV2State;
  setDraft: React.Dispatch<React.SetStateAction<NewQuickTemplateV2State>>;
};

function normalizeNumberText(value: string) {
  return value.replace(",", ".");
}

export default function QuickTemplateV2Fields({ draft, setDraft }: Props) {
  const minutesValue = draft.usesQuantity
    ? draft.unitMinutes
    : draft.standardMinutes || draft.unitMinutes;

  return (
    <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-black text-blue-950">
            Cantidad, tiempo y precio
          </div>
          <div className="text-xs font-semibold text-blue-700">
            Para trabajos como montar neumático: cantidad × minutos unidad.
          </div>
        </div>

        <label className="flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-900">
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
        <label className="grid gap-1 text-xs font-bold text-blue-900">
          {draft.usesQuantity
            ? "Minutos por unidad"
            : "Tiempo estándar en minutos"}
          <input
            type="number"
            min="0"
            value={minutesValue}
            onChange={(event) => {
              const value = normalizeNumberText(event.target.value);

              setDraft((prev) => ({
                ...prev,
                unitMinutes: value,
                standardMinutes: value,
              }));
            }}
            placeholder={
              draft.usesQuantity ? "Ej. 15 por unidad" : "Ej. 45 total"
            }
            className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="grid gap-1 text-xs font-bold text-blue-900">
          Precio por unidad
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.unitPrice}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                unitPrice: normalizeNumberText(event.target.value),
              }))
            }
            placeholder="Ej. 25"
            className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm"
          />
        </label>

        <div className="rounded-xl border border-blue-200 bg-white px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-wide text-blue-400">
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
        <div className="mt-3 rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-blue-800">
          Ejemplo: si pones cantidad 4 en agenda, el tiempo será 4 ×{" "}
          {draft.unitMinutes || "0"} min.
        </div>
      )}
    </div>
  );
}