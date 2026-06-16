import type { ChangeEvent } from "react";
import type {
  AreaKey,
  AssignmentRole,
  CompetencyKey,
  Tech,
} from "../modules/workshopTypes";
import { getTechAvatarUrl } from "../modules/techAvatar";

type Props = {
  techs: Tech[];
  newTechName: string;
  setNewTechName: (value: string) => void;
  addTech: () => void;
  removeTech: (name: string) => void;
  updateTechCompetency: (
    name: string,
    key: CompetencyKey,
    role: AssignmentRole,
    value: boolean
  ) => void;
  updateTechPriority: (
    name: string,
    area: AreaKey,
    role: AssignmentRole,
    value: number
  ) => void;
  updateTechRoadsideCapable: (name: string, value: boolean) => void;
  handleTechImageUpload: (
    event: ChangeEvent<HTMLInputElement>,
    techName: string
  ) => void;
  onSetWorkshopPin: (techName: string) => void;
  onBack: () => void;
};

const COMPETENCY_KEYS: { key: CompetencyKey; label: string }[] = [
  { key: "camion", label: "Camión" },
  { key: "movil", label: "Móvil" },
  { key: "tacografo", label: "Tacógrafo" },
  { key: "turismo", label: "Turismo" },
  { key: "mecanica", label: "Mecánica" },
  { key: "alineacion_camion", label: "Alineación camión" },
  { key: "pinchazo_camion", label: "Pinchazo camión" },
];

const PRIORITY_AREAS: { key: AreaKey; label: string }[] = [
  { key: "camion", label: "Camión" },
  { key: "movil", label: "Móvil" },
  { key: "tacografo", label: "Tacógrafo" },
  { key: "turismo", label: "Turismo" },
  { key: "mecanica", label: "Mecánica" },
];

export default function TecnicosView({
  techs,
  newTechName,
  setNewTechName,
  addTech,
  removeTech,
  updateTechCompetency,
  updateTechPriority,
  updateTechRoadsideCapable,
  handleTechImageUpload,
  onSetWorkshopPin,
  onBack,
}: Props) {
  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-2xl font-black">Técnicos</h1>
            <p className="text-sm text-slate-500">
              Crear, editar, asignar PIN y competencias — usado por todos los
              módulos de la aplicación
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium hover:bg-slate-50"
          >
            Volver
          </button>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex gap-2">
            <input
              value={newTechName}
              onChange={(e) => setNewTechName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTech();
              }}
              placeholder="Nombre del nuevo técnico"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            />
            <button
              type="button"
              onClick={addTech}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
            >
              Añadir técnico
            </button>
          </div>

          <div className="space-y-3">
            {techs.map((tech) => (
              <div
                key={tech.name}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
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

                    <label className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
                      <input
                        type="checkbox"
                        checked={Boolean(tech.roadsideCapable)}
                        onChange={(e) =>
                          updateTechRoadsideCapable(tech.name, e.target.checked)
                        }
                      />
                      Apto carretera
                    </label>

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

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-1 pr-3">Competencia</th>
                        {COMPETENCY_KEYS.map(({ key, label }) => (
                          <th key={key} className="px-2 py-1 text-center">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-bold">Responsable</td>
                        {COMPETENCY_KEYS.map(({ key }) => (
                          <td key={key} className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={tech.competencies[key].responsable}
                              onChange={(e) =>
                                updateTechCompetency(
                                  tech.name,
                                  key,
                                  "responsable",
                                  e.target.checked
                                )
                              }
                            />
                          </td>
                        ))}
                      </tr>
                      <tr className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-bold">Apoyo</td>
                        {COMPETENCY_KEYS.map(({ key }) => (
                          <td key={key} className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={tech.competencies[key].apoyo}
                              onChange={(e) =>
                                updateTechCompetency(
                                  tech.name,
                                  key,
                                  "apoyo",
                                  e.target.checked
                                )
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-1 pr-3">Prioridad asignación</th>
                        {PRIORITY_AREAS.map(({ key, label }) => (
                          <th key={key} className="px-2 py-1 text-center">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-bold">Responsable</td>
                        {PRIORITY_AREAS.map(({ key }) => (
                          <td key={key} className="px-2 py-2 text-center">
                            <input
                              type="number"
                              min={1}
                              value={tech.priorities[key].responsable}
                              onChange={(e) =>
                                updateTechPriority(
                                  tech.name,
                                  key,
                                  "responsable",
                                  Number(e.target.value)
                                )
                              }
                              className="w-16 rounded border border-slate-200 px-2 py-1 text-center"
                            />
                          </td>
                        ))}
                      </tr>
                      <tr className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-bold">Apoyo</td>
                        {PRIORITY_AREAS.map(({ key }) => (
                          <td key={key} className="px-2 py-2 text-center">
                            <input
                              type="number"
                              min={1}
                              value={tech.priorities[key].apoyo}
                              onChange={(e) =>
                                updateTechPriority(
                                  tech.name,
                                  key,
                                  "apoyo",
                                  Number(e.target.value)
                                )
                              }
                              className="w-16 rounded border border-slate-200 px-2 py-1 text-center"
                            />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
