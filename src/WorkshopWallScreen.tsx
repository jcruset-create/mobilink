import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ScheduledJob } from "./components/AgendaView";
import {
  CheckCircle2,
  Clock3,
  Monitor,
  ShieldAlert,
  Zap,
  TimerReset,
  PauseCircle,
} from "lucide-react";

type IncludedTaskForWall = {
  id: string;
  label: string;
  area?: string;
  standardMinutes?: number | null;
  source?: string;
};

type Job = {
  id: number;
  plate: string;
  area: string;
  status: string;
  urgent?: boolean;
  assignedNames?: string[];
  reason?: string;
  quickEntryLabel?: string | null;
  template?: string | null;
  startedAtMs?: number | null;
  createdAtMs?: number | null;
  actualMinutes?: number | null;
  includedTasks?: IncludedTaskForWall[];
};

type Tech = {
  name: string;
  status: string;
  currentJobId?: number | null;
};

type QuickTemplateForWall = {
  key: string;
  label: string;
  area?: string;
};

type ScheduledJobForWall = ScheduledJob & {
  includedTasks?: IncludedTaskForWall[];
};

type WorkshopWallScreenProps = {
  jobs?: Job[];
  techs?: Tech[];
  scheduledJobs?: ScheduledJobForWall[];
  quickTemplates?: QuickTemplateForWall[];
  onBack: () => void;
};

function LiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="mt-1 text-4xl font-semibold tabular-nums">
      {now.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </div>
  );
}

export default function WorkshopWallScreen({
  jobs = [],
  techs = [],
  scheduledJobs = [],
  quickTemplates = [],
  onBack,
}: WorkshopWallScreenProps) {
  const active = jobs.filter(
    (job) => job.status === "activo" || job.status === "en_proceso"
  );

  const waiting = jobs.filter(
    (job) => job.status === "espera" || job.status === "pendiente"
  );

  const paused = jobs.filter(
    (job) => job.status === "parado" || job.status === "standby"
  );

  const tvScheduledJobs = scheduledJobs
    .filter((job) => job.status === "programado")
    .filter((job) => {
      const startMs = new Date(`${job.date}T${job.startTime}`).getTime();

      if (Number.isNaN(startMs)) return false;

      const oneHourFromNow = Date.now() + 60 * 60 * 1000;

      return startMs <= oneHourFromNow;
    })
    .sort((a, b) => {
      const aMs = new Date(`${a.date}T${a.startTime}`).getTime();
      const bMs = new Date(`${b.date}T${b.startTime}`).getTime();

      return aMs - bMs;
    });

  const availableTechs = techs.filter(
    (tech) => tech.status === "disponible"
  ).length;

  const responsibleTechs = techs.filter(
    (tech) => tech.status === "ocupado"
  ).length;

  const supportTechs = techs.filter(
    (tech) => tech.status === "refuerzo"
  ).length;

  const urgentJobs = jobs.filter((job) => job.urgent).length;

  function MiniKpi({
    title,
    value,
    tone,
  }: {
    title: string;
    value: number;
    tone: "emerald" | "red" | "amber" | "violet";
  }) {
    const tones = {
      emerald: "text-emerald-300 border-emerald-400/20 bg-emerald-500/10",
      red: "text-red-300 border-red-400/20 bg-red-500/10",
      amber: "text-amber-300 border-amber-400/20 bg-amber-500/10",
      violet: "text-violet-300 border-violet-400/20 bg-violet-500/10",
    };

    return (
      <motion.div
        animate={
          title === "Urgentes" && value > 0
            ? { scale: [1, 1.03, 1] }
            : { scale: 1 }
        }
        transition={
          title === "Urgentes" && value > 0
            ? { repeat: Infinity, duration: 1.2 }
            : { duration: 0.2 }
        }
        className={`flex items-center justify-between border-r border-white/10 px-6 py-4 ${tones[tone]}`}
      >
        <div className="text-xs uppercase tracking-[0.3em]">{title}</div>
        <div className="text-3xl font-bold">{value}</div>
      </motion.div>
    );
  }

  function getElapsedMinutes(ms?: number | null) {
    if (!ms) return null;
    return Math.max(0, Math.round((Date.now() - ms) / 60000));
  }

  function formatMinutes(minutes?: number | null) {
    if (minutes == null || Number.isNaN(minutes)) return "-";

    const rounded = Math.round(minutes);
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;

    return h > 0 ? `${h} h ${m} min` : `${m} min`;
  }

  function formatTemplateKey(templateKey?: string | null) {
    if (!templateKey) return "";

    return templateKey
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function getTemplateLabel(templateKey?: string | null) {
    if (!templateKey) return "";

    return (
      quickTemplates.find((template) => template.key === templateKey)?.label ||
      formatTemplateKey(templateKey)
    );
  }

  function getScheduledMainLabel(job: ScheduledJobForWall) {
    if (job.linkedTemplateLabel) return job.linkedTemplateLabel;

    return (
      getTemplateLabel(job.firstTemplateKey || job.templateKey) ||
      "Trabajo programado"
    );
  }

  function getScheduledSecondLabel(job: ScheduledJobForWall) {
    if (!job.secondTemplateKey) return "";

    return getTemplateLabel(job.secondTemplateKey);
  }

  function getIncludedTasks(job: ScheduledJobForWall) {
    return Array.isArray(job.includedTasks) ? job.includedTasks : [];
  }

  function getJobCardClass(job: Job) {
    const area = job.area?.toLowerCase() ?? "";

    if (job.urgent) return "border-red-400/50 bg-red-500/25 text-red-50";
    if (area.includes("camion")) {
      return "border-red-300/50 bg-red-500/15 text-red-50";
    }
    if (area.includes("movil")) {
      return "border-amber-300/50 bg-amber-500/15 text-amber-50";
    }
    if (area.includes("tacografo")) {
      return "border-violet-300/50 bg-violet-500/15 text-violet-50";
    }
    if (area.includes("turismo")) {
      return "border-sky-300/50 bg-sky-500/15 text-sky-50";
    }
    if (area.includes("mecanica")) {
      return "border-emerald-300/50 bg-emerald-500/15 text-emerald-50";
    }

    return "border-slate-300/30 bg-slate-500/10 text-slate-50";
  }

  function getTechCardClass(status: string) {
    if (status === "disponible") {
      return "border-emerald-400/20 bg-emerald-500/15";
    }

    if (status === "ocupado") {
      return "border-red-400/20 bg-red-500/20";
    }

    if (status === "refuerzo") {
      return "border-amber-400/20 bg-amber-500/15";
    }

    if (status === "supervisor") {
      return "border-violet-400/20 bg-violet-500/15";
    }

    return "border-slate-400/20 bg-slate-500/10";
  }

  function getStatusPill(status: string) {
    if (status === "disponible") {
      return "border-emerald-400/30 bg-emerald-500/20 text-emerald-100";
    }

    if (status === "ocupado") {
      return "border-red-400/30 bg-red-500/20 text-red-100";
    }

    if (status === "refuerzo") {
      return "border-amber-400/30 bg-amber-500/20 text-amber-100";
    }

    if (status === "supervisor") {
      return "border-violet-400/30 bg-violet-500/20 text-violet-100";
    }

    return "border-slate-400/20 bg-slate-500/10 text-slate-200";
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-[1800px] space-y-6">
        <header className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between gap-4 p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-3xl bg-white/10 p-4">
                <Monitor className="h-9 w-9 text-white" />
              </div>

              <div>
                <h1 className="text-4xl font-bold tracking-tight">
                  Pantalla TV · Taller SEA Tarragona
                </h1>

                <p className="mt-1 text-lg text-slate-300">
                  Dashboard operativo en tiempo real
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={onBack}
                className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20"
              >
                ← Volver
              </button>

              <div className="rounded-3xl border border-slate-800 bg-slate-950 px-6 py-3 text-right">
                <div className="text-xs uppercase tracking-[0.4em] text-slate-400">
                  Hora actual
                </div>

                <LiveClock />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 border-t border-slate-800">
            <MiniKpi title="Libres" value={availableTechs} tone="emerald" />
            <MiniKpi title="Responsables" value={responsibleTechs} tone="red" />
            <MiniKpi title="Refuerzos" value={supportTechs} tone="amber" />
            <MiniKpi title="Urgentes" value={urgentJobs} tone="violet" />
          </div>
        </header>

        <main className="grid gap-6 xl:grid-cols-[1fr_460px]">
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Clock3 className="h-5 w-5" />
                Trabajos activos
              </h2>

              <span className="rounded-full bg-slate-800 px-4 py-1 text-sm font-semibold text-slate-300">
                {active.length} en marcha
              </span>
            </div>

            {active.length === 0 ? (
              <div className="flex min-h-[260px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-950/40 text-slate-300">
                Sin trabajos activos.
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {active.map((job) => (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-3xl border p-5 ${getJobCardClass(job)}`}
                  >
                    <div className="text-3xl font-bold">{job.plate}</div>

                    <div className="mt-2 text-lg opacity-90">
                      {job.quickEntryLabel || job.area}
                    </div>

                    {job.includedTasks && job.includedTasks.length > 0 && (
                      <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-emerald-100">
                          Tareas incluidas
                        </div>

                        <div className="mt-1 text-sm font-bold text-emerald-50">
                          {job.includedTasks
                            .map((task) => task.label)
                            .join(" + ")}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 text-sm opacity-80">
                      Tiempo activo:{" "}
                      <span className="font-semibold">
                        {formatMinutes(getElapsedMinutes(job.startedAtMs))}
                      </span>
                    </div>

                    {job.assignedNames && job.assignedNames.length > 0 && (
                      <div className="mt-3 text-sm opacity-90">
                        Asignados:{" "}
                        <span className="font-semibold">
                          {job.assignedNames.join(" + ")}
                        </span>
                      </div>
                    )}

                    {job.urgent && (
                      <div className="mt-4 inline-flex rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white">
                        URGENTE
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold">Cola de espera</h2>

                <span className="rounded-full bg-amber-500/20 px-4 py-1 text-sm font-semibold text-amber-200">
                  {waiting.length}
                </span>
              </div>

              {waiting.length === 0 ? (
                <div className="rounded-3xl border border-slate-800 bg-slate-950/40 p-8 text-center">
                  <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />

                  <div className="mt-3 text-lg font-bold">Sin espera</div>

                  <div className="mt-1 text-sm text-slate-400">
                    No hay trabajos pendientes.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {waiting.map((job) => (
                    <div
                      key={job.id}
                      className={`rounded-2xl border p-4 ${getJobCardClass(
                        job
                      )}`}
                    >
                      <div className="text-xl font-bold">{job.plate}</div>

                      <div className="text-sm opacity-90">
                        {job.quickEntryLabel || job.area}
                      </div>

                      {job.includedTasks && job.includedTasks.length > 0 && (
                        <div className="mt-2 text-xs font-semibold opacity-90">
                          +{" "}
                          {job.includedTasks
                            .map((task) => task.label)
                            .join(" + ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-orange-900/50 bg-orange-950/30 p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xl font-bold text-orange-100">
                  <PauseCircle className="h-5 w-5" />
                  Trabajos parados
                </h2>

                <span className="rounded-full bg-orange-500/20 px-4 py-1 text-sm font-semibold text-orange-100">
                  {paused.length}
                </span>
              </div>

              {paused.length === 0 ? (
                <div className="rounded-2xl border border-orange-900/40 bg-slate-950/30 p-6 text-center text-sm text-orange-100">
                  Sin trabajos parados.
                </div>
              ) : (
                <div className="space-y-3">
                  {paused.map((job) => (
                    <div
                      key={job.id}
                      className="rounded-2xl border border-orange-700/50 bg-orange-900/30 p-4"
                    >
                      <div className="text-xl font-bold text-white">
                        {job.plate}
                      </div>

                      <div className="text-sm text-orange-100">
                        {job.quickEntryLabel || job.area}
                      </div>

                      {job.includedTasks && job.includedTasks.length > 0 && (
                        <div className="mt-2 text-xs font-semibold text-orange-100">
                          +{" "}
                          {job.includedTasks
                            .map((task) => task.label)
                            .join(" + ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-violet-900/40 bg-violet-950/30 p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xl font-bold text-violet-100">
                  <TimerReset className="h-5 w-5" />
                  Citas programadas pendientes de llegada
                </h2>

                <span className="rounded-full bg-violet-900 px-4 py-1 text-sm font-semibold text-violet-100">
                  {tvScheduledJobs.length}
                </span>
              </div>

              {tvScheduledJobs.length === 0 ? (
                <div className="rounded-2xl border border-violet-900/40 bg-slate-950/30 p-6 text-center text-sm text-slate-300">
                  Sin citas próximas pendientes.
                </div>
              ) : (
                <div className="space-y-4">
                  {tvScheduledJobs.map((job) => {
                    const mainLabel = getScheduledMainLabel(job);
                    const secondLabel = getScheduledSecondLabel(job);
                    const includedTasks = getIncludedTasks(job);

                    return (
                      <div
                        key={job.id}
                        className="rounded-3xl border border-violet-700/60 bg-violet-900/40 p-4 shadow-lg"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-3xl font-black tracking-wide text-white">
                              {job.plate || "Sin matrícula"}
                            </div>

                            <div className="mt-1 text-sm font-bold text-violet-100">
                              {job.date} · {job.startTime}
                            </div>
                          </div>

                          {job.urgent && (
                            <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white">
                              URGENTE
                            </span>
                          )}
                        </div>

                        <div className="rounded-2xl border border-violet-600/40 bg-violet-950/50 px-4 py-3">
                          <div className="text-[10px] font-black uppercase tracking-widest text-violet-300">
                            Trabajo programado
                          </div>

                          <div className="mt-1 text-lg font-black text-white">
                            {mainLabel}
                          </div>

                          {secondLabel && (
                            <div className="mt-2 rounded-xl border border-fuchsia-400/40 bg-fuchsia-950/50 px-3 py-2 text-sm font-bold text-fuchsia-100">
                              Después: {secondLabel}
                            </div>
                          )}

                          {includedTasks.length > 0 && (
                            <div className="mt-2 rounded-xl border border-emerald-400/40 bg-emerald-950/50 px-3 py-2">
                              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">
                                Tareas incluidas
                              </div>

                              <div className="mt-1 text-sm font-bold text-emerald-100">
                                {includedTasks
                                  .map((task) => task.label)
                                  .join(" + ")}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 grid gap-2 text-xs font-semibold text-violet-100">
                          <div className="rounded-xl bg-violet-950/50 px-3 py-2">
                            Cliente: {job.customerName || "Sin nombre"}
                          </div>

                          <div className="rounded-xl bg-violet-950/50 px-3 py-2">
                            Teléfono: {job.customerPhone || "Sin teléfono"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
              <div className="mb-4 flex items-center gap-2 text-xl font-bold">
                <ShieldAlert className="h-5 w-5" />
                Alertas
              </div>

              <div className="rounded-2xl border border-sky-500/20 bg-sky-500/15 px-4 py-3 text-sm font-semibold text-sky-100">
                Operativa estable. Sin alertas críticas.
              </div>
            </section>
          </aside>
        </main>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Zap className="h-5 w-5" />
              Estado del equipo
            </h2>

            <span className="rounded-full bg-slate-800 px-4 py-1 text-sm font-semibold text-slate-300">
              {techs.length} técnicos visibles
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {techs.map((tech) => (
              <div
                key={tech.name}
                className={`rounded-2xl border p-4 ${getTechCardClass(
                  tech.status
                )}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold">{tech.name}</div>

                    <div className="mt-1 text-xs opacity-80">
                      {tech.currentJobId
                        ? `Trabajo ${tech.currentJobId}`
                        : "Sin trabajo activo"}
                    </div>
                  </div>

                  <span
                    className={`rounded-full border px-3 py-1 text-[10px] font-bold ${getStatusPill(
                      tech.status
                    )}`}
                  >
                    {tech.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}