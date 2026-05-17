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

export default function QuickTemplateEditor({
  template,
  techs,
  onSave,
}: QuickTemplateEditorProps) {
  const [draft, setDraft] = useState<QuickTemplate>({
    ...template,
    allowedTechs: Array.isArray(template.allowedTechs)
      ? template.allowedTechs
      : [],
    priorityOrder: Array.isArray(template.priorityOrder)
      ? template.priorityOrder
      : [],
    standardMinutes:
      template.standardMinutes === null ||
      template.standardMinutes === undefined
        ? null
        : Number(template.standardMinutes),
  });

  const priorityOrder =
    draft.priorityOrder.length > 0 ? draft.priorityOrder : draft.allowedTechs;

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

      <input
        type="number"
        min="0"
        value={draft.standardMinutes ?? ""}
        onChange={(e) => {
          const value = e.target.value;

          setDraft((prev) => ({
            ...prev,
            standardMinutes: value === "" ? null : Number(value),
          }));
        }}
        placeholder="Tiempo estándar en minutos"
        className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
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
        onClick={() => onSave(draft)}
        className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
      >
        Guardar cambios
      </button>
    </div>
  );
}