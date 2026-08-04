import type { Job } from "../modules/workshopTypes";

export type FurgonetaOpcion = { id: number; name: string; plate?: string | null };

type Props = {
  job: Job;
  /** Furgonetas activas del taller. */
  furgonetas: FurgonetaOpcion[];
  /** Retenidas por otro trabajo de taller: id → matrícula del trabajo. */
  ocupadasEnTaller: Map<number, string>;
  /** Retenidas por una asistencia en curso, por nombre. */
  enAsistencia: Set<string>;
  onAsignar: (jobId: number, vehicleId: number | null) => Promise<void> | void;
  /** Paleta oscura (Operativo 2) o clara (panel de taller). */
  oscuro?: boolean;
};

/**
 * Selector de unidad móvil para los trabajos del área "movil".
 *
 * Mientras el trabajo siga abierto, la furgoneta elegida deja de ofrecerse en
 * Assist. Sólo se listan las libres; la del propio trabajo aparece siempre,
 * para poder cambiarla o liberarla.
 */
export default function SelectorFurgoneta({
  job,
  furgonetas,
  ocupadasEnTaller,
  enAsistencia,
  onAsignar,
  oscuro,
}: Props) {
  if (job.area !== "movil") return null;

  const disponibles = furgonetas.filter((v) => {
    if (v.id === job.assignedVehicleId) return true;
    if (ocupadasEnTaller.has(v.id)) return false;
    if (enAsistencia.has(v.name)) return false;
    return true;
  });

  const asignada = Boolean(job.assignedVehicleId);

  const estilo = oscuro
    ? asignada
      ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
      : "border-rose-500/60 bg-rose-500/10 text-rose-200"
    : asignada
      ? "border-sky-300 bg-sky-50 text-sky-800"
      : "border-red-300 bg-red-50 text-red-700";

  return (
    <select
      value={job.assignedVehicleId ?? ""}
      onChange={(e) => {
        const valor = e.target.value;
        void onAsignar(job.id, valor ? Number(valor) : null);
      }}
      title={asignada ? "Unidad móvil asignada" : "Asigna una furgoneta para poder autorizar"}
      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${estilo}`}
    >
      <option value="">🚐 Furgoneta…</option>
      {disponibles.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
          {v.plate ? ` · ${v.plate}` : ""}
        </option>
      ))}
    </select>
  );
}
