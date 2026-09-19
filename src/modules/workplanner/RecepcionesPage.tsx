import { useCallback, useEffect, useMemo, useState } from "react";
import { CarFront, Check, Loader2, RefreshCw, ScanLine, X } from "lucide-react";

import { allocateJobPure } from "../assignment";
import { buildTechLoadStats, buildTechStats } from "../workshopReports";
import {
  API_BASE,
  loadJobsFromBackend,
  loadQuickTemplatesFromBackend,
  loadTechsFromBackend,
} from "../workshopApi";
import { getAdminHeaders } from "../adminHeaders";
import { DEFAULT_WORKSHOP_ID, normalizeWorkshopId } from "../workshops";
import {
  jobDesdeRecepcion,
  loQueFaltaParaConvertir,
  posibleDuplicado,
  type RecepcionVehiculo,
} from "../recepcionVehiculo";
import { explicaPropuesta } from "./PartesTrabajoPage";
import type { AreaKey, Job, QuickTemplate, Tech } from "../workshopTypes";

/**
 * Recepciones de vehículos llegadas desde el patio.
 *
 * Lo que manda la APK es lo que el operario vio: una matrícula, quizá una
 * foto, quizá una idea de qué hay que hacer. Aquí se revisa y se decide. Nada
 * se convierte en trabajo solo: la captura propone, una persona valida.
 */

const AREAS: AreaKey[] = ["camion", "movil", "tacografo", "turismo", "mecanica"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as any)?.error || `Error ${res.status}`);
  return body as T;
}

function hora(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

export default function RecepcionesPage() {
  const workshopId = normalizeWorkshopId(DEFAULT_WORKSHOP_ID);

  const [recepciones, setRecepciones] = useState<RecepcionVehiculo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [plantillas, setPlantillas] = useState<QuickTemplate[]>([]);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [lista, jobsBackend, techsBackend, plantillasBackend] = await Promise.all([
        api<RecepcionVehiculo[]>("/api/recepcion-vehiculos?estado=pendiente"),
        loadJobsFromBackend(),
        loadTechsFromBackend(),
        loadQuickTemplatesFromBackend(),
      ]);
      setRecepciones(lista);
      setJobs(jobsBackend ?? []);
      setTechs(techsBackend ?? []);
      setPlantillas(plantillasBackend ?? []);
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar las recepciones.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const actual = useMemo(
    () => recepciones.find((r) => r.id === seleccionada) ?? null,
    [recepciones, seleccionada]
  );

  const plantillasDelTaller = useMemo(
    () => plantillas.filter((p) => !p.workshopId || p.workshopId === workshopId),
    [plantillas, workshopId]
  );

  /** Cambia un campo de la recepción abierta, en pantalla y en el servidor. */
  async function editar(campo: keyof RecepcionVehiculo, valor: unknown) {
    if (!actual) return;
    const antes = actual;
    setRecepciones((lista) =>
      lista.map((r) => (r.id === antes.id ? { ...r, [campo]: valor } as RecepcionVehiculo : r))
    );
    try {
      const guardada = await api<RecepcionVehiculo>(`/api/recepcion-vehiculos/${antes.id}`, {
        method: "PUT",
        body: JSON.stringify({ [campo]: valor }),
      });
      setRecepciones((lista) => lista.map((r) => (r.id === guardada.id ? guardada : r)));
    } catch (e: any) {
      // Si el servidor la rechaza, se vuelve a lo que había: dejar la pantalla
      // diciendo una cosa y la base otra es peor que el propio fallo.
      setRecepciones((lista) => lista.map((r) => (r.id === antes.id ? antes : r)));
      setError(e?.message || "No se pudo guardar el cambio.");
    }
  }

  /** La propuesta de técnico, con el mismo motor que el resto del módulo. */
  const propuesta = useMemo(() => {
    if (!actual) return null;
    const plantilla =
      plantillasDelTaller.find((p) => p.key === actual.plantillaKey) ?? null;
    const siguienteId =
      jobs.reduce((max, j) => Math.max(max, Number(j.id) || 0), 0) + 1;

    const base = jobDesdeRecepcion(actual, siguienteId, plantilla, Date.now());
    const techStats = buildTechStats(jobs);
    const techLoadStats = buildTechLoadStats(jobs, techs);

    const resultado = allocateJobPure(
      base,
      techs,
      [base, ...jobs],
      plantillasDelTaller,
      techStats,
      techLoadStats
    );
    const conPropuesta = resultado.jobs.find((j) => j.id === base.id) ?? base;

    return {
      job: conPropuesta,
      porQue: explicaPropuesta(conPropuesta.assignedNames ?? [], base, techStats, techLoadStats),
    };
  }, [actual, jobs, techs, plantillasDelTaller]);

  async function convertir() {
    if (!actual || !propuesta) return;
    const falta = loQueFaltaParaConvertir(actual);
    if (falta.length > 0) {
      setError(`Antes de convertir hay que decidir ${falta.join(", ")}.`);
      return;
    }

    setGuardando(true);
    setError("");
    try {
      const job: Job = {
        ...propuesta.job,
        status: "validacion",
        reason: [propuesta.job.reason, propuesta.porQue].filter(Boolean).join(" "),
      };
      await api(`/api/recepcion-vehiculos/${actual.id}/convertir`, {
        method: "POST",
        body: JSON.stringify(job),
      });
      setAviso(
        `${job.plate} · ${job.quickEntryLabel} → ` +
          (job.assignedNames?.length
            ? job.assignedNames.join(" + ")
            : "sin técnico libre") +
          ". Pendiente de validar."
      );
      setSeleccionada(null);
      await cargar();
    } catch (e: any) {
      setError(e?.message || "No se pudo convertir la recepción.");
    } finally {
      setGuardando(false);
    }
  }

  async function descartar() {
    if (!actual) return;
    const motivo = window.prompt("¿Por qué se descarta esta recepción?")?.trim();
    if (!motivo) return;
    setGuardando(true);
    setError("");
    try {
      await api(`/api/recepcion-vehiculos/${actual.id}/descartar`, {
        method: "POST",
        body: JSON.stringify({ motivo }),
      });
      setSeleccionada(null);
      await cargar();
    } catch (e: any) {
      setError(e?.message || "No se pudo descartar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="min-h-full bg-slate-900 p-4 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Recepción de vehículos</h1>
            <p className="text-xs text-slate-400">
              Lo que se ha recibido en el patio. Nada se convierte en trabajo
              hasta que alguien lo valida aquí.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void cargar()}
            disabled={cargando}
            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700 disabled:opacity-50"
          >
            {cargando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Actualizar
          </button>
        </div>

        {error && (
          <div className="mb-4 whitespace-pre-line rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
        {aviso && (
          <div className="mb-4 whitespace-pre-line rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">
            {aviso}
          </div>
        )}

        {!cargando && recepciones.length === 0 && (
          <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-sm text-slate-400">
            <CarFront className="mx-auto mb-2 h-8 w-8 text-slate-600" />
            No hay vehículos pendientes de revisar.
          </div>
        )}

        <div className="space-y-2">
          {recepciones.map((r) => {
            const duplicada = posibleDuplicado(
              recepciones.filter((o) => o.id !== r.id),
              r.matricula,
              Date.now()
            );
            const abierta = r.id === seleccionada;
            return (
              <div
                key={r.id}
                className="rounded-2xl border border-slate-700 bg-slate-800 p-4"
              >
                <button
                  type="button"
                  onClick={() => setSeleccionada(abierta ? null : r.id)}
                  className="flex w-full flex-wrap items-center gap-3 text-left"
                >
                  <span className="text-base font-black tracking-wide">{r.matricula}</span>
                  {r.scheduledJobId != null && (
                    <span
                      className="rounded bg-sky-900/60 px-1.5 py-0.5 text-[10px] font-bold text-sky-200"
                      title="Salió de una cita de la agenda. Al convertirla, la cita queda cerrada y su botón «Llegó» ya no puede crear otro trabajo."
                    >
                      con cita
                    </span>
                  )}
                  {r.matriculaOcr && (
                    <span
                      className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-200"
                      title="La matrícula la leyó la IA de una foto. Compruébala."
                    >
                      <ScanLine className="mr-1 inline h-3 w-3" />
                      leída por IA
                    </span>
                  )}
                  {r.kilometrosOcr != null && r.kilometrosOcr === r.kilometros && (
                    <span
                      className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-200"
                      title="Los kilómetros los leyó la IA de una foto del cuadro. Compruébalos."
                    >
                      km por IA
                    </span>
                  )}
                  {duplicada && (
                    <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                      ya recibido hoy
                    </span>
                  )}
                  <span className="flex-1 truncate text-sm text-slate-400">
                    {r.clienteNombre || "Sin cliente"}
                    {r.kilometros ? ` · ${r.kilometros.toLocaleString("es-ES")} km` : ""}
                    {" · "}
                    {r.operacionLabel || "Sin operación"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {hora(r.creadaAtMs)} · {r.operarioNombre}
                  </span>
                </button>

                {abierta && actual && (
                  <div className="mt-4 space-y-3 border-t border-slate-700 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-slate-400">
                        Matrícula
                        <input
                          defaultValue={actual.matricula}
                          onBlur={(e) => {
                            const v = e.target.value.trim().toUpperCase();
                            if (v && v !== actual.matricula) void editar("matricula", v);
                          }}
                          className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Cliente
                        <input
                          defaultValue={actual.clienteNombre ?? ""}
                          onBlur={(e) => void editar("clienteNombre", e.target.value.trim())}
                          className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Kilómetros
                        <input
                          type="number"
                          defaultValue={actual.kilometros ?? ""}
                          onBlur={(e) => {
                            const v = Number(e.target.value.replace(/[^0-9]/g, ""));
                            const km = Number.isFinite(v) && v > 0 ? v : null;
                            if (km !== (actual.kilometros ?? null)) void editar("kilometros", km);
                          }}
                          className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Área
                        <select
                          value={actual.area ?? ""}
                          onChange={(e) => void editar("area", e.target.value)}
                          className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        >
                          <option value="">— elegir —</option>
                          {AREAS.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-400">
                        Operación
                        <select
                          value={actual.plantillaKey ?? ""}
                          onChange={(e) => void editar("plantillaKey", e.target.value)}
                          className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                        >
                          <option value="">— elegir —</option>
                          {plantillasDelTaller.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {actual.notas && (
                      <p className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-300">
                        {actual.notas}
                      </p>
                    )}

                    {actual.fotos.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {actual.fotos.map((f, i) => (
                          <a key={i} href={f.url} target="_blank" rel="noreferrer">
                            <img
                              src={f.url}
                              alt={f.nombre ?? "Foto de la recepción"}
                              className="h-20 w-28 rounded-lg border border-slate-700 object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    )}

                    {propuesta && (
                      <div className="rounded-lg border border-sky-900 bg-sky-950/30 px-3 py-2 text-sm text-sky-200">
                        <strong>
                          {propuesta.job.assignedNames?.length
                            ? propuesta.job.assignedNames.join(" + ")
                            : "Sin técnico libre"}
                        </strong>
                        <span className="ml-2 text-xs text-sky-300/80">{propuesta.porQue}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void convertir()}
                        disabled={guardando}
                        className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        {guardando ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Convertir en trabajo
                      </button>
                      <button
                        type="button"
                        onClick={() => void descartar()}
                        disabled={guardando}
                        className="flex items-center gap-2 rounded-lg border border-rose-700 bg-rose-950/40 px-4 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-900/40 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        Descartar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
