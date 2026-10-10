import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Images, RefreshCw } from "lucide-react";
import { API_BASE, loadJobsFromBackend } from "../workshopApi";
import { getAdminHeaders } from "../adminHeaders";
import { getOperationLabel } from "../jobHelpers";
import { AREA_META } from "../workshopConstants";
import { normalizeWorkshopId, DEFAULT_WORKSHOP_ID, WORKSHOPS } from "../workshops";
import { formatMinutes } from "../time";
import {
  agrupaPorDia,
  estadoHistorico,
  fechaDelHistorico,
  filtraHistorico,
  minutosDelHistorico,
  rangoUltimoMes,
  resumenHistorico,
  type EstadoHistorico,
} from "../historicoTrabajos";
import type { Job } from "../workshopTypes";

/**
 * Análisis y estadísticas. De momento, una pestaña: el histórico de trabajos.
 *
 * Las fotos no se suben aquí ni se guardan aquí: ya viajan con el trabajo
 * desde que se recibió el vehículo en el patio (`job_files`). Esta pantalla
 * solo las pide y las enseña, que es lo que faltaba.
 */

type FicheroDeTrabajo = {
  id: number;
  url: string;
  fileName: string | null;
  techName: string | null;
  createdAtMs: number | null;
  tipo: string | null;
};

const PESTANAS = [{ key: "historico", label: "Histórico de trabajos" }] as const;

function fechaInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function inicioDelDia(valor: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

function finDelDia(valor: string): number | null {
  const inicio = inicioDelDia(valor);
  return inicio == null ? null : inicio + 24 * 60 * 60 * 1000 - 1;
}

function rotuloDeDia(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const diferencia = Math.round((hoy.getTime() - fecha.getTime()) / (24 * 60 * 60 * 1000));

  const largo = fecha.toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
  });

  if (diferencia === 0) return `Hoy · ${largo}`;
  if (diferencia === 1) return `Ayer · ${largo}`;
  return largo;
}

function hora(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export default function AnalisisPage() {
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]["key"]>("historico");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [workshopId, setWorkshopId] = useState<string>(() => {
    const guardado = window.localStorage.getItem("sea-selected-workshop");
    return normalizeWorkshopId(guardado ?? DEFAULT_WORKSHOP_ID);
  });

  const rangoInicial = useMemo(() => rangoUltimoMes(Date.now()), []);
  const [desde, setDesde] = useState(() => fechaInput(rangoInicial.desdeMs));
  const [hasta, setHasta] = useState(() => fechaInput(rangoInicial.hastaMs));
  const [texto, setTexto] = useState("");
  const [area, setArea] = useState("");
  const [estado, setEstado] = useState<EstadoHistorico | "todos">("todos");

  const [abierto, setAbierto] = useState<number | null>(null);
  const [ficheros, setFicheros] = useState<Record<number, FicheroDeTrabajo[] | "cargando" | "error">>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      // `scope=all` trae también los cerrados: el operativo solo pide los de
      // los últimos días, y aquí se mira hacia atrás.
      const data = await loadJobsFromBackend("all");
      setJobs(Array.isArray(data) ? (data as Job[]) : []);
    } catch (e: any) {
      setError(e?.message || "Error cargando el histórico.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const delTaller = useMemo(
    () => jobs.filter((j) => !j.workshopId || normalizeWorkshopId(j.workshopId) === workshopId),
    [jobs, workshopId]
  );

  const filtrados = useMemo(
    () =>
      filtraHistorico(delTaller, {
        texto,
        desdeMs: inicioDelDia(desde),
        hastaMs: finDelDia(hasta),
        area: area || null,
        estado,
      }),
    [delTaller, texto, desde, hasta, area, estado]
  );

  const dias = useMemo(() => agrupaPorDia(filtrados), [filtrados]);
  const resumen = useMemo(() => resumenHistorico(filtrados), [filtrados]);

  /** Las fotos se piden solo al abrir la ficha: son muchas y pesan. */
  async function abrir(job: Job) {
    const id = Number(job.id);
    setAbierto((prev) => (prev === id ? null : id));
    if (ficheros[id] !== undefined) return;

    setFicheros((prev) => ({ ...prev, [id]: "cargando" }));
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${id}/files`, {
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = await res.json();
      setFicheros((prev) => ({ ...prev, [id]: Array.isArray(body) ? body : [] }));
    } catch {
      setFicheros((prev) => ({ ...prev, [id]: "error" }));
    }
  }

  function exportarCsv() {
    const cabecera = [
      "Fecha", "Hora", "Estado", "Matrícula", "Cliente", "Operación", "Área",
      "Técnicos", "Minutos", "Parte",
    ];
    const filas = filtrados.map((j) => {
      const ms = fechaDelHistorico(j);
      return [
        new Date(ms).toLocaleDateString("es-ES"),
        hora(ms),
        estadoHistorico(j) === "cancelado" ? "Cancelado" : "Realizado",
        j.plate ?? "",
        j.customerName ?? "",
        getOperationLabel(j),
        j.area ?? "",
        (j.assignedNames ?? []).join(" + "),
        String(minutosDelHistorico(j)),
        j.ptNumero ?? "",
      ];
    });

    const csv = [cabecera, ...filas]
      .map((fila) => fila.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n");

    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `historico-${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-full bg-slate-900 p-4 text-slate-100">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Análisis y estadísticas</h1>
          <p className="text-xs text-slate-400">
            Lo que ya se ha hecho, con sus fotos, su parte y quién lo hizo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={workshopId}
            onChange={(e) => setWorkshopId(normalizeWorkshopId(e.target.value))}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
          >
            {WORKSHOPS.map((w) => <option key={w.id} value={w.id}>{w.shortName}</option>)}
          </select>
          <button
            type="button"
            onClick={exportarCsv}
            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
          >
            <Download className="h-4 w-4" /> CSV
          </button>
          <button
            type="button"
            onClick={() => void cargar()}
            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
          >
            <RefreshCw className="h-4 w-4" /> Recargar
          </button>
        </div>
      </div>

      <div className="mb-3 flex gap-1 border-b border-slate-700">
        {PESTANAS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPestana(p.key)}
            className={`rounded-t-lg px-3 py-2 text-sm font-semibold ${
              pestana === p.key
                ? "border-x border-t border-slate-700 bg-slate-800 text-slate-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {pestana === "historico" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              id="historico-buscar"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Matrícula, cliente, nº de parte…"
              className="min-w-[230px] flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            />
            <input
              id="historico-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            />
            <input
              id="historico-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            />
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            >
              <option value="">Todas las áreas</option>
              {Object.entries(AREA_META).map(([k, v]: [string, any]) => (
                <option key={k} value={k}>{v?.label ?? k}</option>
              ))}
            </select>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoHistorico | "todos")}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            >
              <option value="todos">Realizados y cancelados</option>
              <option value="realizado">Solo realizados</option>
              <option value="cancelado">Solo cancelados</option>
            </select>
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Trabajos</div>
              <div className="font-mono text-xl font-bold">{resumen.total}</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Horas trabajadas</div>
              <div className="font-mono text-xl font-bold">{formatMinutes(resumen.minutos)}</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Cancelados</div>
              <div className="font-mono text-xl font-bold text-rose-400">{resumen.cancelados}</div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Días con trabajo</div>
              <div className="font-mono text-xl font-bold">{dias.length}</div>
            </div>
          </div>

          {error && (
            <div className="mb-3 rounded-lg border border-rose-500/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}

          {cargando ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-sm text-slate-400">
              Cargando el histórico…
            </div>
          ) : dias.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-600 p-8 text-center text-sm text-slate-400">
              No hay trabajos cerrados con ese filtro.
            </div>
          ) : (
            dias.map((grupo) => (
              <div key={grupo.dia}>
                <div className="mb-1.5 mt-4 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <span className="text-[13px] text-slate-200">{rotuloDeDia(grupo.dia)}</span>
                  <span>· {grupo.trabajos.length} trabajo(s) · {formatMinutes(grupo.minutos)}</span>
                </div>

                <div className="space-y-1.5">
                  {grupo.trabajos.map((job) => {
                    const id = Number(job.id);
                    const cancelado = estadoHistorico(job) === "cancelado";
                    const abiertoEste = abierto === id;
                    const suyos = ficheros[id];
                    const fotos = Array.isArray(suyos)
                      ? suyos.filter((f) => f.tipo !== "firma")
                      : [];

                    return (
                      <div key={id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
                        <button
                          type="button"
                          onClick={() => void abrir(job)}
                          className="flex w-full flex-wrap items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-700/40"
                        >
                          <span className="min-w-[92px] font-mono text-[15px] font-bold">{job.plate}</span>
                          <span className="min-w-[180px] flex-1 text-[13px]">
                            {getOperationLabel(job)}
                            {job.customerName ? <span className="text-slate-400"> · {job.customerName}</span> : null}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              cancelado
                                ? "border-rose-400/50 bg-rose-400/10 text-rose-300"
                                : "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                            }`}
                          >
                            {cancelado ? "Cancelado" : "Realizado"}
                          </span>
                          <span className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] text-slate-400">
                            <span>{(job.assignedNames ?? []).join(" + ") || "—"}</span>
                            <span>{formatMinutes(minutosDelHistorico(job))}</span>
                            <span>{hora(fechaDelHistorico(job))}</span>
                          </span>
                        </button>

                        {abiertoEste && (
                          <div className="grid gap-3 border-t border-slate-700 bg-slate-900/50 p-3 md:grid-cols-2">
                            <div>
                              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ficha</h4>
                              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                                <dt className="text-slate-400">Cliente</dt>
                                <dd>{job.customerName || "—"}</dd>
                                <dt className="text-slate-400">Área</dt>
                                <dd>{(AREA_META as any)[String(job.area)]?.label ?? job.area}</dd>
                                {job.ptNumero && (<><dt className="text-slate-400">Parte</dt><dd>{job.ptNumero}</dd></>)}
                                <dt className="text-slate-400">Técnicos</dt>
                                <dd>{(job.assignedNames ?? []).join(" + ") || "—"}</dd>
                                <dt className="text-slate-400">Entrada</dt>
                                <dd>{new Date(job.createdAtMs).toLocaleString("es-ES")}</dd>
                                <dt className="text-slate-400">{cancelado ? "Cancelado" : "Cierre"}</dt>
                                <dd>{job.closedAtMs ? new Date(job.closedAtMs).toLocaleString("es-ES") : "—"}</dd>
                              </dl>

                              {job.includedTasks && job.includedTasks.length > 0 && (
                                <>
                                  <h4 className="mb-1 mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tareas</h4>
                                  <ul className="list-disc pl-4 text-[12.5px]">
                                    {job.includedTasks.map((t, i) => <li key={i}>{t.label}</li>)}
                                  </ul>
                                </>
                              )}

                              {job.materiales && job.materiales.length > 0 && (
                                <>
                                  <h4 className="mb-1 mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Material</h4>
                                  <ul className="list-disc pl-4 text-[12.5px]">
                                    {job.materiales.map((m, i) => (
                                      <li key={i}>{m.descripcion} · {m.unidades} ud.</li>
                                    ))}
                                  </ul>
                                </>
                              )}

                              {job.reason && (
                                <p className="mt-2.5 text-[11px] leading-snug text-slate-500">{job.reason}</p>
                              )}
                            </div>

                            <div>
                              <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                <Images className="h-3.5 w-3.5" /> Fotos{Array.isArray(suyos) ? ` (${fotos.length})` : ""}
                              </h4>

                              {suyos === "cargando" && <p className="text-xs text-slate-500">Cargando…</p>}
                              {suyos === "error" && <p className="text-xs text-rose-300">No se pudieron cargar las fotos.</p>}
                              {Array.isArray(suyos) && fotos.length === 0 && (
                                <p className="rounded-lg border border-dashed border-slate-600 p-3 text-center text-xs text-slate-500">
                                  Este trabajo no tiene fotos.
                                </p>
                              )}

                              {fotos.length > 0 && (
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1.5">
                                  {fotos.map((f) => (
                                    <a
                                      key={f.id}
                                      href={f.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={`${f.fileName ?? "Foto"}${f.techName ? ` · ${f.techName}` : ""}`}
                                      className="block overflow-hidden rounded-lg border border-slate-600"
                                    >
                                      <img
                                        src={f.url}
                                        alt={f.fileName ?? "Foto del trabajo"}
                                        loading="lazy"
                                        className="aspect-[4/3] w-full object-cover"
                                      />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          <p className="mt-4 max-w-3xl text-xs text-slate-500">
            Las fotos son las que se hicieron al recibir el vehículo en el patio y las que subió el
            técnico desde la APK: viajan con el trabajo desde el primer día y se conservan al
            cerrarlo. Aquí solo se enseñan.
          </p>
        </>
      )}
    </div>
  );
}
