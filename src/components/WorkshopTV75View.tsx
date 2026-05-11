type AreaKey = "camion" | "movil" | "tacografo" | "turismo" | "mecanica";

type JobForTV75 = {
  id: number;
  plate: string;
  area: AreaKey;
  status: string;
  urgent?: boolean;
  assignedNames?: string[];
  quickEntryLabel?: string | null;
  template?: any;
  reason?: string;
  startedAtMs?: number | null;
  createdAtMs?: number | null;
};

type TechForTV75 = {
  name: string;
  status: string;
  currentJobId?: number | null;
  avatar?: string | null;
};

type OperationLabelJob = Pick<
  JobForTV75,
  "template" | "area" | "quickEntryLabel"
>;

type Props = {
  jobs: JobForTV75[];
  techs: TechForTV75[];
  finishJob: (jobId: number) => void;
  moveJobToStandBy: (jobId: number) => void;
  getOperationLabel: (job: OperationLabelJob) => string;
  onBack?: () => void;
  onLogout?: () => void;
};

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

function normalizeStatus(status?: string) {
  return (status || "").toLowerCase().trim();
}

function getAreaLabel(area: AreaKey) {
  if (area === "camion") return "Camión";
  if (area === "movil") return "Móvil";
  if (area === "tacografo") return "Tacógrafo";
  if (area === "turismo") return "Turismo";
  if (area === "mecanica") return "Mecánica";
  return area;
}

function getAreaClass(area: AreaKey) {
  if (area === "camion") return "border-red-200 bg-red-50 text-red-800";
  if (area === "movil") return "border-amber-200 bg-amber-50 text-amber-800";
  if (area === "tacografo") return "border-orange-200 bg-orange-50 text-orange-800";
  if (area === "turismo") return "border-sky-200 bg-sky-50 text-sky-800";
  if (area === "mecanica") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function getTechStatusLabel(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "disponible") return "Disponible";
  if (normalized === "ocupado") return "Ocupado";
  if (normalized === "refuerzo") return "Refuerzo";
  if (normalized === "supervisor") return "Supervisor";
  if (normalized === "permiso") return "Permiso";
  if (normalized === "vacaciones") return "Vacaciones";
  if (normalized === "baja") return "Baja";
  if (normalized === "otro_taller") return "Otro taller";
  if (normalized === "en_otro_taller") return "Otro taller";
  if (normalized === "nodisponible") return "No disponible";

  return status || "-";
}

function getTechCardClass(status: string) {
  const normalized = normalizeStatus(status);

  if (normalized === "disponible" || normalized === "supervisor") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (normalized === "ocupado") {
    return "border-red-200 bg-red-50 text-red-900";
  }

  if (normalized === "refuerzo") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getAvatarUrl(tech?: TechForTV75 | null) {
  if (!tech?.avatar) return "";
  if (tech.avatar.startsWith("http")) return tech.avatar;
  return `${API_BASE}${tech.avatar}`;
}

function TechAvatar({ tech }: { tech?: TechForTV75 | null }) {
  const imageUrl = getAvatarUrl(tech);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={tech?.name || "Técnico"}
        className="h-10 w-10 rounded-full border border-white object-cover shadow-sm"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white bg-white/80 text-sm font-black shadow-sm">
      {getInitials(tech?.name || "?")}
    </div>
  );
}

function MiniJobCard({
  job,
  techs,
  getOperationLabel,
}: {
  job: JobForTV75;
  techs: TechForTV75[];
  getOperationLabel: (job: OperationLabelJob) => string;
}) {
  const assignedNames = job.assignedNames ?? [];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${getAreaClass(
            job.area
          )}`}
        >
          {getAreaLabel(job.area)}
        </span>

        <span className="text-[10px] font-bold text-slate-400">#{job.id}</span>
      </div>

      <div className="text-2xl font-black leading-none text-slate-950">
        {job.plate || "SIN MATRÍCULA"}
      </div>

      <div className="mt-1 truncate text-sm font-bold text-slate-700">
        {getOperationLabel(job)}
      </div>

      {assignedNames.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {assignedNames.map((name, index) => {
            const tech = techs.find((item) => item.name === name);

            return (
              <div
                key={name}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1"
              >
                <TechAvatar tech={tech} />
                <div>
                  <div className="text-xs font-black">{name}</div>
                  <div className="text-[9px] font-bold uppercase text-slate-400">
                    {index === 0 ? "Responsable" : "Apoyo"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {job.reason && (
        <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
          {job.reason}
        </div>
      )}
    </div>
  );
}

export default function WorkshopTV75View({
  jobs,
  techs,
  finishJob,
  moveJobToStandBy,
  getOperationLabel,
  onBack,
  onLogout,
}: Props) {
  const activeJobs = jobs.filter((job) => job.status === "activo");
  const validationJobs = jobs.filter((job) => job.status === "validacion");
  const standByJobs = jobs.filter((job) => job.status === "parado");
  const waitingJobs = jobs.filter((job) => job.status === "espera");


return (
  <div className="relative h-screen overflow-hidden bg-slate-100 p-2 text-slate-900 tv75-scale">
    {onLogout && (
      <button
        type="button"
        onClick={onLogout}
        className="fixed right-4 top-4 z-50 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-black text-red-700 shadow-lg hover:bg-red-100"
      >
        Salir
      </button>
    )}

    {/* aquí sigue el resto de tu pantalla */}       <header className="mb-3 flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div>
          <h1 className="text-2xl font-black leading-tight">
            Pantalla taller TV 75"
          </h1>
          <p className="text-xs font-medium text-slate-500">
            Vista grande para operarios · trabajos, cola y técnicos
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
            Activos {activeJobs.length}
          </div>

          <div className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-700">
            Validar {validationJobs.length}
          </div>

          <div className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700">
            Stand by {standByJobs.length}
          </div>
          {onLogout && (
  <button
    type="button"
    onClick={onLogout}
    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-black text-red-700 hover:bg-red-100"
  >
    Salir
  </button>
)}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700"
            >
              Volver
            </button>
          )}
        </div>
      </header>

      <main className="grid h-[calc(100vh-86px)] gap-3 overflow-hidden xl:grid-cols-[2fr_0.9fr_0.9fr_0.9fr]">
        <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black">Trabajos activos</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
              {activeJobs.length}
            </span>
          </div>

          {activeJobs.length === 0 ? (
            <div className="flex h-[calc(100%-44px)] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm font-bold text-slate-500">
              No hay trabajos activos.
            </div>
          ) : (
            <div className="grid max-h-[calc(100vh-150px)] gap-3 overflow-auto pr-1 2xl:grid-cols-2">
              {activeJobs.slice(0, 10).map((job) => (
                <div
                  key={job.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                >
                  <MiniJobCard
                    job={job}
                    techs={techs}
                    getOperationLabel={getOperationLabel}
                  />

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => finishJob(job.id)}
                      className="rounded-2xl bg-slate-900 px-3 py-3 text-xs font-black text-white"
                    >
                      Finalizar
                    </button>

                    <button
                      type="button"
                      onClick={() => moveJobToStandBy(job.id)}
                      className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs font-black text-amber-700"
                    >
                      Stand by
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-hidden rounded-3xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black text-violet-900">Validar</h2>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-700">
              {validationJobs.length}
            </span>
          </div>

          <div className="max-h-[calc(100vh-150px)] space-y-3 overflow-auto pr-1">
            {validationJobs.length === 0 ? (
              <div className="rounded-2xl bg-white/70 p-5 text-center text-xs font-bold text-violet-700">
                Sin pendientes.
              </div>
            ) : (
              validationJobs.map((job) => (
                <MiniJobCard
                  key={job.id}
                  job={job}
                  techs={techs}
                  getOperationLabel={getOperationLabel}
                />
              ))
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-3xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black text-orange-900">Stand by</h2>
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700">
              {standByJobs.length}
            </span>
          </div>

          <div className="max-h-[38vh] space-y-3 overflow-auto pr-1">
            {standByJobs.length === 0 ? (
              <div className="rounded-2xl bg-white/70 p-5 text-center text-xs font-bold text-orange-700">
                Sin stand by.
              </div>
            ) : (
              standByJobs.map((job) => (
                <MiniJobCard
                  key={job.id}
                  job={job}
                  techs={techs}
                  getOperationLabel={getOperationLabel}
                />
              ))
            )}
          </div>

          <div className="mt-4 rounded-3xl border border-sky-200 bg-sky-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-black text-sky-900">Cola</h2>
              <span className="rounded-full bg-sky-100 px-3 py-1 text-[10px] font-black text-sky-700">
                {waitingJobs.length}
              </span>
            </div>

            <div className="max-h-[30vh] space-y-2 overflow-auto pr-1">
              {waitingJobs.length === 0 ? (
                <div className="rounded-2xl bg-white/70 p-4 text-center text-xs font-bold text-sky-700">
                  Sin cola.
                </div>
              ) : (
                waitingJobs.map((job) => (
                  <MiniJobCard
                    key={job.id}
                    job={job}
                    techs={techs}
                    getOperationLabel={getOperationLabel}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black">Técnicos</h2>
            <span className="text-[10px] font-bold text-slate-500">
              Estado actual
            </span>
          </div>

          <div className="max-h-[calc(100vh-150px)] space-y-2 overflow-auto pr-1">
            {techs.map((tech) => {
              const currentJob =
                tech.currentJobId != null
                  ? jobs.find((job) => job.id === tech.currentJobId)
                  : null;

              return (
                <div
                  key={tech.name}
                  className={`rounded-2xl border px-3 py-3 ${getTechCardClass(
                    tech.status
                  )}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <TechAvatar tech={tech} />

                      <div className="min-w-0">
                        <div className="truncate text-sm font-black">
                          {tech.name}
                        </div>

                        <div className="truncate text-[10px] font-bold opacity-80">
                          {currentJob
                            ? `${currentJob.plate} · ${getOperationLabel(
                                currentJob
                              )}`
                            : "Sin trabajo activo"}
                        </div>
                      </div>
                    </div>

                    <span className="shrink-0 rounded-full border border-white/80 bg-white/80 px-2 py-1 text-[9px] font-black uppercase">
                      {getTechStatusLabel(tech.status)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}