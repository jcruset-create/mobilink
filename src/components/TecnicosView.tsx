import { type ChangeEvent, useState } from "react";
import { Pencil, Phone, Plus, X } from "lucide-react";
import type {
  AreaKey,
  AssignmentRole,
  CompetencyKey,
  RoleCapability,
  RolePriority,
  Tech,
} from "../modules/workshopTypes";
import { getTechAvatarUrl } from "../modules/techAvatar";
import {
  defaultCompetencies,
  defaultPriorities,
} from "../modules/techConfig";

type Props = {
  techs: Tech[];
  removeTech: (name: string) => void;
  handleTechImageUpload: (
    event: ChangeEvent<HTMLInputElement>,
    techName: string
  ) => void;
  onSetWorkshopPin: (techName: string) => void;
  onSaveTech: (data: {
    name: string;
    phone: string;
    isNew: boolean;
    competencies: Record<CompetencyKey, RoleCapability>;
    priorities: Record<AreaKey, RolePriority>;
    roadsideCapable: boolean;
  }) => void;
  onBack: () => void;
};

const COMPETENCY_KEYS: { key: CompetencyKey; label: string }[] = [
  { key: "camion", label: "Camión" },
  { key: "movil", label: "Móvil" },
  { key: "tacografo", label: "Tacógrafo" },
  { key: "turismo", label: "Turismo" },
  { key: "mecanica", label: "Mecánica" },
  { key: "alineacion_camion", label: "Alineación" },
  { key: "pinchazo_camion", label: "Pinchazo" },
];

const PRIORITY_AREAS: { key: AreaKey; label: string }[] = [
  { key: "camion", label: "Camión" },
  { key: "movil", label: "Móvil" },
  { key: "tacografo", label: "Tacógrafo" },
  { key: "turismo", label: "Turismo" },
  { key: "mecanica", label: "Mecánica" },
];

type ModalState =
  | {
      mode: "new";
      name: string;
      phone: string;
      roadsideCapable: boolean;
      competencies: Record<CompetencyKey, RoleCapability>;
      priorities: Record<AreaKey, RolePriority>;
    }
  | {
      mode: "edit";
      tech: Tech;
      phone: string;
      roadsideCapable: boolean;
      competencies: Record<CompetencyKey, RoleCapability>;
      priorities: Record<AreaKey, RolePriority>;
    };

export default function TecnicosView({
  techs,
  removeTech,
  handleTechImageUpload,
  onSetWorkshopPin,
  onSaveTech,
  onBack,
}: Props) {
  const [modal, setModal] = useState<ModalState | null>(null);

  function openNew() {
    const placeholder = "__new__";
    setModal({
      mode: "new",
      name: "",
      phone: "",
      roadsideCapable: false,
      competencies: defaultCompetencies(placeholder),
      priorities: defaultPriorities(placeholder),
    });
  }

  function openEdit(tech: Tech) {
    setModal({
      mode: "edit",
      tech,
      phone: tech.phone ?? "",
      roadsideCapable: Boolean(tech.roadsideCapable),
      competencies: { ...tech.competencies } as Record<CompetencyKey, RoleCapability>,
      priorities: { ...tech.priorities } as Record<AreaKey, RolePriority>,
    });
  }

  function closeModal() {
    setModal(null);
  }

  function handleSave() {
    if (!modal) return;
    if (modal.mode === "new") {
      const name = modal.name.trim();
      if (!name) return;
      onSaveTech({
        name,
        phone: modal.phone.trim(),
        isNew: true,
        competencies: modal.competencies,
        priorities: modal.priorities,
        roadsideCapable: modal.roadsideCapable,
      });
    } else {
      onSaveTech({
        name: modal.tech.name,
        phone: modal.phone.trim(),
        isNew: false,
        competencies: modal.competencies,
        priorities: modal.priorities,
        roadsideCapable: modal.roadsideCapable,
      });
    }
    closeModal();
  }

  function setCompetency(key: CompetencyKey, role: AssignmentRole, value: boolean) {
    setModal((prev) =>
      prev
        ? {
            ...prev,
            competencies: {
              ...prev.competencies,
              [key]: { ...(prev.competencies[key] ?? { responsable: false, apoyo: false }), [role]: value },
            },
          }
        : prev
    );
  }

  function setPriority(key: AreaKey, role: AssignmentRole, value: number) {
    setModal((prev) =>
      prev
        ? {
            ...prev,
            priorities: {
              ...prev.priorities,
              [key]: { ...(prev.priorities[key] ?? { responsable: 99, apoyo: 99 }), [role]: value },
            },
          }
        : prev
    );
  }

  const editingTech = modal?.mode === "edit" ? modal.tech : null;

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-[1500px] space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-2xl font-black">Técnicos</h1>
            <p className="text-sm text-slate-500">
              Crear, editar, asignar PIN y competencias
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700"
            >
              <Plus className="h-4 w-4" />
              Añadir técnico
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium hover:bg-slate-50"
            >
              Volver
            </button>
          </div>
        </div>

        {/* Grid de técnicos */}
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-3">
            {techs.map((tech) => (
              <div
                key={tech.name}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={getTechAvatarUrl(tech)}
                      alt={tech.name}
                      className="h-12 w-12 rounded-full border object-cover"
                    />
                    <div>
                      <div className="text-lg font-black">{tech.name}</div>
                      <div className="text-xs font-semibold text-slate-500">
                        {tech.status}
                      </div>
                      {tech.phone && (
                        <a
                          href={`tel:${tech.phone}`}
                          className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
                        >
                          <Phone className="h-3 w-3" />
                          {tech.phone}
                        </a>
                      )}
                      {Boolean(tech.roadsideCapable) && (
                        <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">
                          Apto carretera
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(tech)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil className="h-3 w-3" />
                      Editar
                    </button>

                    <label className="cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100">
                      Cambiar foto
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleTechImageUpload(e, tech.name)}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => onSetWorkshopPin(tech.name)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      🔑 PIN portal móvil
                    </button>

                    {tech.name !== "Ramón" && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `¿Eliminar al técnico ${tech.name}? Esta acción no se puede deshacer.`
                            )
                          ) {
                            removeTech(tech.name);
                          }
                        }}
                        className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Modal ficha técnico ── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-black">
                {modal.mode === "new" ? "Nuevo técnico" : `Editar ${modal.tech.name}`}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full p-1 hover:bg-slate-100"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Foto (edit only) */}
              {modal.mode === "edit" && (
                <div className="flex items-center gap-4">
                  <img
                    src={getTechAvatarUrl(modal.tech)}
                    alt={modal.tech.name}
                    className="h-16 w-16 rounded-full border object-cover"
                  />
                  <label className="cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100">
                    Cambiar foto
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleTechImageUpload(e, modal.tech.name)}
                    />
                  </label>
                </div>
              )}

              {/* Nombre */}
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">
                  Nombre *
                </span>
                {modal.mode === "new" ? (
                  <input
                    type="text"
                    autoFocus
                    placeholder="Nombre del técnico"
                    value={modal.name}
                    onChange={(e) =>
                      setModal((prev) =>
                        prev?.mode === "new" ? { ...prev, name: e.target.value } : prev
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                  />
                ) : (
                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                    {modal.tech.name}
                  </div>
                )}
              </label>

              {/* Teléfono */}
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">
                  Teléfono
                </span>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    type="tel"
                    placeholder="6XX XXX XXX"
                    value={modal.phone}
                    onChange={(e) =>
                      setModal((prev) =>
                        prev ? { ...prev, phone: e.target.value } : prev
                      )
                    }
                    className="w-full text-sm outline-none"
                  />
                </div>
              </label>

              {/* Apto carretera */}
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <input
                  type="checkbox"
                  checked={modal.roadsideCapable}
                  onChange={(e) =>
                    setModal((prev) =>
                      prev ? { ...prev, roadsideCapable: e.target.checked } : prev
                    )
                  }
                />
                <span className="text-sm font-bold text-emerald-800">Apto carretera</span>
              </label>

              {/* PIN (edit only) */}
              {modal.mode === "edit" && (
                <button
                  type="button"
                  onClick={() => { onSetWorkshopPin(editingTech!.name); closeModal(); }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  🔑 Cambiar PIN portal móvil
                </button>
              )}

              {/* Competencias */}
              <div>
                <div className="mb-2 text-xs font-bold text-slate-600">Competencias</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-1 pr-3">Rol</th>
                        {COMPETENCY_KEYS.map(({ key, label }) => (
                          <th key={key} className="px-2 py-1 text-center">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(["responsable", "apoyo"] as AssignmentRole[]).map((role) => (
                        <tr key={role} className="border-t border-slate-100">
                          <td className="py-2 pr-3 font-bold capitalize">{role}</td>
                          {COMPETENCY_KEYS.map(({ key }) => (
                            <td key={key} className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={modal.competencies[key]?.[role] ?? false}
                                onChange={(e) => setCompetency(key, role, e.target.checked)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Prioridades */}
              <div>
                <div className="mb-2 text-xs font-bold text-slate-600">Prioridades</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-1 pr-3">Rol</th>
                        {PRIORITY_AREAS.map(({ key, label }) => (
                          <th key={key} className="px-2 py-1 text-center">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(["responsable", "apoyo"] as AssignmentRole[]).map((role) => (
                        <tr key={role} className="border-t border-slate-100">
                          <td className="py-2 pr-3 font-bold capitalize">{role}</td>
                          {PRIORITY_AREAS.map(({ key }) => (
                            <td key={key} className="px-2 py-2 text-center">
                              <input
                                type="number"
                                min={1}
                                value={modal.priorities[key]?.[role] ?? 99}
                                onChange={(e) => setPriority(key, role, Number(e.target.value))}
                                className="w-16 rounded border border-slate-200 px-2 py-1 text-center"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={modal.mode === "new" && !modal.name.trim()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-700 disabled:opacity-40"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
