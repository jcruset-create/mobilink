type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";
type TemplateKey = "alineacion_camion" | "pinchazo_camion";

type JobForOperarios = {
  id: number;
  plate: string;
  status: string;
  area: AreaKey;
  assignedNames?: string[];
  template?: TemplateKey | null;
  quickEntryLabel?: string | null;
  includedTasks?: {
    id: string;
    label: string;
    area: AreaKey;
    source: "quickTemplate" | "customExtra";
    templateKey?: string | null;
    standardMinutes?: number | null;
  }[];
};

type TechForOperarios = {
  name: string;
  status: string;
  currentJobId?: number | null;
  avatar?: string | null;
};

type OperationLabelJob = Pick<
  JobForOperarios,
  "template" | "area" | "quickEntryLabel"
>;

type Props = {
  jobs: JobForOperarios[];
  techs: TechForOperarios[];
  finishJob: (jobId: number) => void;
  moveJobToStandBy: (jobId: number) => void;
  getOperationLabel: (job: OperationLabelJob) => string;
  onBack: () => void;
  onGoWorkshopScreen?: () => void;
  canGoBack?: boolean;
  onLogout?: () => void;
};

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

function normalizeTechStatus(status?: string) {
  return (status || "").toLowerCase().trim();
}

function getTechStatusLabel(status: string) {
  const normalized = normalizeTechStatus(status);

  if (normalized === "otro_taller") return "EN OTRO TALLER";
  if (normalized === "en_otro_taller") return "EN OTRO TALLER";
  if (normalized === "nodisponible") return "NO DISPONIBLE";
  if (normalized === "disponible") return "DISPONIBLE";
  if (normalized === "ocupado") return "OCUPADO";
  if (normalized === "vacaciones") return "VACACIONES";
  if (normalized === "baja") return "BAJA";
  if (normalized === "permiso") return "PERMISO";
  if (normalized === "supervisor") return "SUPERVISOR";
  if (normalized === "refuerzo") return "REFUERZO";

  return (status || "-").toUpperCase();
}

function getTechCardClass(status: string) {
  const normalized = normalizeTechStatus(status);

  if (normalized === "disponible" || normalized === "supervisor") {
    return "border-green-300 bg-green-200 text-green-950";
  }

  if (normalized === "refuerzo") {
    return "border-yellow-300 bg-yellow-200 text-yellow-950";
  }

  if (normalized === "ocupado") {
    return "border-red-300 bg-red-200 text-red-950";
  }

  return "border-slate-300 bg-slate-200 text-slate-800";
}

function getAreaClass(area: AreaKey) {
  if (area === "camion") return "bg-red-100 text-red-700";
  if (area === "movil") return "bg-amber-100 text-amber-700";
  if (area === "tacografo") return "bg-orange-100 text-orange-700";
  if (area === "turismo") return "bg-sky-100 text-sky-700";
  if (area === "mecanica") return "bg-emerald-100 text-emerald-700";

  return "bg-slate-100 text-slate-700";
}

function getTechInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getTechAvatarUrl(tech?: TechForOperarios | null) {
  if (!tech?.avatar) return "";

  if (tech.avatar.startsWith("http")) return tech.avatar;

  return `${API_BASE}${tech.avatar}`;
}

function TechAvatar({
  tech,
  size = "normal",
}: {
  tech?: TechForOperarios | null;
  size?: "normal" | "large";
}) {
  const imageUrl = getTechAvatarUrl(tech);
  const sizeClass = size === "large" ? "h-14 w-14 text-xl" : "h-9 w-9 text-sm";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={tech?.name || "Técnico"}
        className={`${sizeClass} rounded-full border border-white/70 object-cover shadow-sm`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} flex items-center justify-center rounded-full border border-white/70 bg-white/70 font-bold shadow-sm`}
    >
      {getTechInitials(tech?.name || "?")}
    </div>
  );
}

function SmallJobCard({
  job,
  techs,
  getOperationLabel,
}: {
  job: JobForOperarios;
  techs: TechForOperarios[];
  getOperationLabel: (job: OperationLabelJob) => string;
}) {
  const assignedNames = job.assignedNames || [];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${getAreaClass(
            job.area
          )}`}
        >
          {job.area}
        </span>

        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
          #{job.id}
        </span>
      </div>

      <div className="text-lg font-black text-slate-950">{job.plate}</div>

      <div className="text-xs font-semibold text-slate-700">
        {getOperationLabel(job)}
      </div>
      {job.includedTasks && job.includedTasks.length > 0 && (
  <div className="mt-2 space-y-1">
    {job.includedTasks.map((task) => (
      <div
        key={task.id}
        className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800"
      >
        ✓ {task.label}
      </div>
    ))}
  </div>
)}

      {assignedNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {assignedNames.map((name) => {
            const tech = techs.find((item) => item.name === name);

            return (
              <div
                key={name}
                className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold"
              >
                <TechAvatar tech={tech} />
                {name}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function OperariosTVView({
  jobs,
  techs,
  finishJob,
  moveJobToStandBy,
  getOperationLabel,
  onBack,
  onGoWorkshopScreen,
  canGoBack = true,
  onLogout,
}: Props) {
  const activeJobs = jobs.filter((job) => job.status === "activo");
  const standByJobs = jobs.filter((job) => job.status === "parado");
  const waitingJobs = jobs.filter((job) => job.status === "espera");

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-black">Pantalla técnicos</h1>
          <p className="text-sm text-slate-500">
            Vista simple para TV / técnicos
          </p>
        </div>

<div className="flex flex-wrap gap-2">
  {onGoWorkshopScreen && (
    <button
      type="button"
      onClick={onGoWorkshopScreen}
      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
    >
      Pantalla taller
    </button>
  )}

  {canGoBack && (
    <button
      type="button"
      onClick={onBack}
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium"
    >
      Volver a operativo
    </button>
  )}

  {onLogout && (
    <button
      type="button"
      onClick={onLogout}
      className="rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
    >
      Salir
    </button>
  )}
</div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_0.9fr_0.7fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-black">Trabajos asignados</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
              {activeJobs.length}
            </span>
          </div>

          {activeJobs.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
              No hay trabajos activos.
            </div>
          ) : (
            <div className="grid gap-3 2xl:grid-cols-2">
              {activeJobs.slice(0, 6).map((job) => {
                const assignedNames = job.assignedNames || [];

                return (
                  <div
                    key={job.id}
                    className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="mb-3 flex flex-wrap gap-3">
                      {assignedNames.length > 0 ? (
                        assignedNames.map((name) => {
                          const tech = techs.find(
                            (item) => item.name === name
                          );

                          return (
                            <div
                              key={name}
                              className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2 shadow-sm"
                            >
                              <TechAvatar tech={tech} size="large" />
                              <div className="text-2xl font-black">{name}</div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm text-slate-400">
                          Sin técnicos asignados
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${getAreaClass(
                              job.area
                            )}`}
                          >
                            {job.area}
                          </span>

                          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">
                            #{job.id}
                          </span>
                        </div>

                        <div className="text-4xl font-black tracking-wide">
                          {job.plate}
                        </div>

                        <div className="mt-1 text-xl font-bold text-slate-700">
                          {getOperationLabel(job)}
                        </div>
                        {job.includedTasks && job.includedTasks.length > 0 && (
  <div className="mt-3 rounded-2xl border border-emerald-200 bg-white p-3">
    <div className="mb-2 text-xs font-black uppercase tracking-wide text-emerald-700">
      Tareas incluidas
    </div>

    <div className="grid gap-1">
      {job.includedTasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900"
        >
          <span>✓ {task.label}</span>

          {task.standardMinutes != null && (
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-emerald-700">
              {task.standardMinutes} min
            </span>
          )}
        </div>
      ))}
    </div>
  </div>
)}
                      </div>

                      <div className="grid min-w-[190px] gap-2">
                        <button
                          type="button"
                          onClick={() => finishJob(job.id)}
                          className="rounded-2xl bg-slate-900 px-4 py-4 text-lg font-bold text-white"
                        >
                          Finalizar
                        </button>

                        <button
                          type="button"
                          onClick={() => moveJobToStandBy(job.id)}
                          className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-lg font-bold text-amber-700"
                        >
                          Stand by
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-4">
          <section className="rounded-3xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-orange-900">
                Trabajos en Stand by
              </h2>

              <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-700">
                {standByJobs.length}
              </span>
            </div>

            {standByJobs.length === 0 ? (
              <div className="rounded-2xl bg-white/60 p-4 text-center text-sm text-orange-700">
                Sin trabajos en stand by.
              </div>
            ) : (
              <div className="space-y-2">
                {standByJobs.map((job) => (
                  <SmallJobCard
                    key={job.id}
                    job={job}
                    techs={techs}
                    getOperationLabel={getOperationLabel}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-sky-900">
                Cola de trabajo
              </h2>

              <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-bold text-sky-700">
                {waitingJobs.length}
              </span>
            </div>

            {waitingJobs.length === 0 ? (
              <div className="rounded-2xl bg-white/60 p-4 text-center text-sm text-sky-700">
                Sin trabajos en cola.
              </div>
            ) : (
              <div className="space-y-2">
                {waitingJobs.map((job) => (
                  <SmallJobCard
                    key={job.id}
                    job={job}
                    techs={techs}
                    getOperationLabel={getOperationLabel}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black">Estado técnicos</h2>
            <span className="text-xs text-slate-500">No editable</span>
          </div>

          <div className="space-y-2">
            {techs.map((tech) => {
              const currentJob =
                tech.currentJobId != null
                  ? jobs.find((job) => job.id === tech.currentJobId)
                  : null;

              return (
                <div
                  key={tech.name}
                  className={`rounded-2xl border p-3 ${getTechCardClass(
                    tech.status
                  )}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <TechAvatar tech={tech} />

                      <div className="min-w-0">
                        <div className="truncate text-lg font-black">
                          {tech.name}
                        </div>

                        <div className="truncate text-xs font-semibold opacity-80">
                          {currentJob
                            ? `${currentJob.plate} · ${getOperationLabel(
                                currentJob
                              )}`
                            : "Sin trabajo asignado"}
                        </div>
                      </div>
                    </div>

                    <span className="shrink-0 rounded-full border border-white/80 bg-white/80 px-2 py-1 text-[10px] font-black">
                      {getTechStatusLabel(tech.status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}