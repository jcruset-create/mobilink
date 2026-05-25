import { useState } from "react";

import type {
  AreaKey,
  QuickEntryMode,
  QuickTemplate,
} from "../modules/workshopTypes";

type QuickTemplateEditorProps = {
  template: QuickTemplate;
  techs: { name: string }[];
  onSave: (template: QuickTemplate) => void;
};

function toNullableNumber(value: string) {
  if (value.trim() === "") return null;

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeMinutes(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }

  return Math.round(numberValue);
}

function normalizeMoney(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }

  return Math.round(numberValue * 100) / 100;
}

export default function QuickTemplateEditor({
  template,
  techs,
  onSave,
}: QuickTemplateEditorProps) {
  const initialUnitMinutes =
    template.unitMinutes === null || template.unitMinutes === undefined
      ? template.standardMinutes ?? null
      : template.unitMinutes;

  const [draft, setDraft] = useState<QuickTemplate>({
    ...template,
    allowedTechs: Array.isArray(template.allowedTechs)
      ? template.allowedTechs
      : [],
    priorityOrder: Array.isArray(template.priorityOrder)
      ? template.priorityOrder
      : [],
    usesQuantity: Boolean(template.usesQuantity),
    unitMinutes: normalizeMinutes(initialUnitMinutes),
    unitPrice: normalizeMoney(template.unitPrice),
    standardMinutes:
      template.standardMinutes === null ||
      template.standardMinutes === undefined
        ? null
        : normalizeMinutes(template.standardMinutes),
  });

  const priorityOrder =
    draft.priorityOrder.length > 0 ? draft.priorityOrder : draft.allowedTechs;

  const unitMinutes = normalizeMinutes(draft.unitMinutes);
  const unitPrice = normalizeMoney(draft.unitPrice);

  const previewMinutes = draft.usesQuantity
    ? unitMinutes ?? 0
    : normalizeMinutes(draft.standardMinutes) ?? unitMinutes ?? 0;

  const handleSave = () => {
    const safeUnitMinutes = normalizeMinutes(draft.unitMinutes);
    const safeUnitPrice = normalizeMoney(draft.unitPrice);
    const safeStandardMinutes = draft.usesQuantity
      ? safeUnitMinutes
      : normalizeMinutes(draft.standardMinutes) ?? safeUnitMinutes;

    onSave({
      ...draft,
      standardMinutes: safeStandardMinutes,
      unitMinutes: safeUnitMinutes,
      unitPrice: safeUnitPrice,
      usesQuantity: Boolean(draft.usesQuantity),
      allowedTechs: Array.isArray(draft.allowedTechs) ? draft.allowedTechs : [],
      priorityOrder: Array.isArray(draft.priorityOrder)
        ? draft.priorityOrder
        : [],
    });
  };

  return (
    <div className="space-y-4">
      <input
        value={draft.label}
        onChange={(e) =>
          setDraft((prev) => ({
            ...prev,
            label: e.target.value,
          }))
        }
        placeholder="Nombre entrada rápida"
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
      />

      <select
        value={draft.area}
        onChange={(e) =>
          setDraft((prev) => ({
            ...prev,
            area: e.target.value as AreaKey,
          }))
        }
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
      >
        <option value="camion">Camión</option>
        <option value="movil">Móvil</option>
        <option value="tacografo">Tacógrafo</option>
        <option value="turismo">Turismo</option>
        <option value="mecanica">Mecánica</option>
      </select>

      <select
        value={draft.mode}
        onChange={(e) =>
          setDraft((prev) => ({
            ...prev,
            mode: e.target.value as QuickEntryMode,
          }))
        }
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
      >
        <option value="single">1 técnico</option>
        <option value="team">técnico + refuerzo</option>
      </select>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-black text-slate-800">
              Cantidad, tiempo y precio
            </div>
            <div className="text-xs font-semibold text-slate-500">
              V2 preparado para trabajos por unidades.
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(draft.usesQuantity)}
              onChange={(event) =>
                setDraft((prev) => {
                  const checked = event.target.checked;
                  const nextUnitMinutes =
                    normalizeMinutes(prev.unitMinutes) ??
                    normalizeMinutes(prev.standardMinutes);

                  return {
                    ...prev,
                    usesQuantity: checked,
                    unitMinutes: nextUnitMinutes,
                    standardMinutes: checked
                      ? nextUnitMinutes
                      : normalizeMinutes(prev.standardMinutes) ??
                        nextUnitMinutes,
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
              value={
                draft.usesQuantity
                  ? draft.unitMinutes ?? ""
                  : draft.standardMinutes ?? draft.unitMinutes ?? ""
              }
              onChange={(event) => {
                const value = toNullableNumber(event.target.value);

                setDraft((prev) => ({
                  ...prev,
                  unitMinutes: value,
                  standardMinutes: draft.usesQuantity ? value : value,
                }));
              }}
              placeholder={
                draft.usesQuantity
                  ? "Ej. 15 por unidad"
                  : "Ej. 45 total"
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <label className="grid gap-1 text-xs font-bold text-slate-600">
            Precio por unidad
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.unitPrice ?? ""}
              onChange={(event) => {
                const value = toNullableNumber(event.target.value);

                setDraft((prev) => ({
                  ...prev,
                  unitPrice: value,
                }));
              }}
              placeholder="Ej. 25"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>

          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
              Vista previa
            </div>
            <div className="text-sm font-black text-slate-900">
              {draft.usesQuantity
                ? `${previewMinutes || 0} min / unidad`
                : `${previewMinutes || 0} min total`}
            </div>
            <div className="text-xs font-bold text-slate-500">
              Precio: {(unitPrice ?? 0).toLocaleString("es-ES", {
                style: "currency",
                currency: "EUR",
              })}{" "}
              / unidad
            </div>
          </div>
        </div>

        {draft.usesQuantity && (
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
            Esta entrada se podrá usar con cantidad. Ejemplo: cantidad 4 ×{" "}
            {unitMinutes ?? 0} min = {(unitMinutes ?? 0) * 4} min.
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">
          Técnicos competentes
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {techs.map((tech) => {
            const checked = draft.allowedTechs.includes(tech.name);

            return (
              <label
                key={`edit-allowed-${template.key}-${tech.name}`}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const nextAllowed = e.target.checked
                      ? [...draft.allowedTechs, tech.name]
                      : draft.allowedTechs.filter(
                          (name) => name !== tech.name
                        );

                    const filteredPriority = draft.priorityOrder.filter(
                      (name) => nextAllowed.includes(name)
                    );

                    const missing = nextAllowed.filter(
                      (name) => !filteredPriority.includes(name)
                    );

                    setDraft((prev) => ({
                      ...prev,
                      allowedTechs: nextAllowed,
                      priorityOrder: [...filteredPriority, ...missing],
                    }));
                  }}
                />

                <span>{tech.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">
          Orden de prioridad
        </div>

        <div className="space-y-2">
          {draft.allowedTechs.length === 0 ? (
            <div className="text-sm text-slate-500">
              Si no marcas ningún técnico, se usarán las reglas generales del
              programa.
            </div>
          ) : (
            priorityOrder.map((techName, index) => (
              <div
                key={`edit-priority-${template.key}-${techName}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span>
                  {index + 1}. {techName}
                </span>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const arr = [...priorityOrder];
                      const currentIndex = arr.indexOf(techName);

                      if (currentIndex <= 0) return;

                      [arr[currentIndex - 1], arr[currentIndex]] = [
                        arr[currentIndex],
                        arr[currentIndex - 1],
                      ];

                      setDraft((prev) => ({
                        ...prev,
                        priorityOrder: arr,
                      }));
                    }}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  >
                    ↑
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const arr = [...priorityOrder];
                      const currentIndex = arr.indexOf(techName);

                      if (
                        currentIndex === -1 ||
                        currentIndex >= arr.length - 1
                      ) {
                        return;
                      }

                      [arr[currentIndex], arr[currentIndex + 1]] = [
                        arr[currentIndex + 1],
                        arr[currentIndex],
                      ];

                      setDraft((prev) => ({
                        ...prev,
                        priorityOrder: arr,
                      }));
                    }}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
      >
        Guardar cambios
      </button>
    </div>
  );
}