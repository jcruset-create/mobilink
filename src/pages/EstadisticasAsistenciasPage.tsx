/**
 * Estadísticas de las asistencias: cifras clave comparadas con el periodo
 * anterior, volumen por día, tiempo por fase, día y franja horaria,
 * distancia, por cliente (con su ficha), por operario, tipo de avería y
 * control de calidad. Con filtros y exportación a Excel.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { Download, RefreshCw } from "lucide-react";
import AssistSidebar from "../components/AssistSidebar";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import { fmtMin, periodo, RANGOS, type Rango } from "../modules/estadisticasAsist";
import {
  BarrasPorDia, CifrasClave, ControlCalidad, Distancias, Fases, MapaCalor, TablaClientes, TablaOperarios,
  TiposAveria, type Estadisticas,
} from "../components/estadisticas/Graficos";

type Opciones = { clientes: string[]; operarios: string[]; furgonetas: string[]; tiposAveria: string[]; origenes: string[] };
type Respuesta = Estadisticas & { opciones: Opciones; detalle?: any[] };

const FILTROS: { clave: keyof Filtros; etiqueta: string; opciones: keyof Opciones; todos: string }[] = [
  { clave: "cliente", etiqueta: "Cliente", opciones: "clientes", todos: "Todos" },
  { clave: "operario", etiqueta: "Operario", opciones: "operarios", todos: "Todos" },
  { clave: "furgoneta", etiqueta: "Furgoneta", opciones: "furgonetas", todos: "Todas" },
  { clave: "tipoAveria", etiqueta: "Tipo de avería", opciones: "tiposAveria", todos: "Todos" },
  { clave: "origen", etiqueta: "Origen", opciones: "origenes", todos: "Todos" },
];
type Filtros = { cliente: string; operario: string; furgoneta: string; tipoAveria: string; origen: string };
const SIN_FILTROS: Filtros = { cliente: "", operario: "", furgoneta: "", tipoAveria: "", origen: "" };

export function consultaEstadisticas(p: { desdeMs: number; hastaMs: number }, f: Partial<Filtros>, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams({ desde: String(p.desdeMs), hasta: String(p.hastaMs), ...extra });
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  return qs.toString();
}

export default function EstadisticasAsistenciasPage() {
  const navigate = useNavigate();
  const [rango, setRango] = useState<Rango>("mes");
  const [personal, setPersonal] = useState({ desde: "", hasta: "" });
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState(false);

  const p = useMemo(() => periodo(rango, new Date(), personal), [rango, personal]);

  const cargar = useCallback(async () => {
    if (!p) return;
    setCargando(true);
    try {
      const r = await fetch(`${API_BASE}/api/roadside-assistances/estadisticas?${consultaEstadisticas(p, filtros)}`, { headers: getAdminHeaders() });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? "Error de servidor");
      setDatos(d);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [p, filtros]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function exportar() {
    if (!p) return;
    setExportando(true);
    try {
      const r = await fetch(`${API_BASE}/api/roadside-assistances/estadisticas?${consultaEstadisticas(p, filtros, { detalle: "1" })}`, { headers: getAdminHeaders() });
      const d: Respuesta = await r.json();
      if (!r.ok) throw new Error((d as any)?.error ?? "Error de servidor");
      const wb = XLSX.utils.book_new();
      const res = d.resumen;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        { Dato: "Asistencias", Valor: res.total },
        { Dato: "Realizadas", Valor: res.realizadas },
        { Dato: "Anuladas", Valor: res.anuladas },
        { Dato: "Llegada media", Valor: fmtMin(res.llegadaMediaMin) },
        { Dato: "Reparación media", Valor: fmtMin(res.reparacionMediaMin) },
        { Dato: "Servicio completo medio", Valor: fmtMin(res.servicioMedioMin) },
        { Dato: "Km por asistencia", Valor: res.kmMedio ?? "" },
        { Dato: `Llegadas en < ${d.objetivos.llegadaMin} min (%)`, Valor: res.pctLlegadaObjetivo ?? "" },
        { Dato: "Valoración media", Valor: res.valoracionMedia ?? "" },
        ...d.fases.map((f) => ({ Dato: `Fase: ${f.nombre}`, Valor: fmtMin(f.min) })),
      ]), "Resumen");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.clientes.map((c) => ({
        Cliente: c.cliente, Asistencias: c.asistencias, "% del total": c.pct, "Llegada media (min)": c.llegadaMediaMin,
        "Reparación media (min)": c.reparacionMediaMin, "Km medios": c.kmMedio, "Distancia media (km)": c.distanciaMediaKm,
        Anuladas: c.anuladas, Remolques: c.remolques, "Valoración": c.valoracionMedia, Encuestas: c.encuestas,
      }))), "Clientes");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.operarios.map((o) => ({
        Operario: o.operario, Furgoneta: o.furgoneta ?? "", Asistencias: o.asistencias, "Asignar → salir (min)": o.salidaMediaMin,
        "Llegada media (min)": o.llegadaMediaMin, "Reparación media (min)": o.reparacionMediaMin, "Km totales": o.kmTotal, "Horas en servicio": o.horasServicio,
      }))), "Operarios");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((d.detalle ?? []).map((a) => ({
        "#": a.id, Fecha: new Date(a.createdAtMs).toLocaleString("es-ES"), Cliente: a.cliente, Matrícula: a.matricula,
        Estado: a.estado, Origen: a.origen, "Tipo de avería": a.tipoAveria, Operario: a.operario, Furgoneta: a.furgoneta,
        "Asignar (min)": a.asignarMin, "Salir (min)": a.salirMin, "Llegada (min)": a.llegadaMin, "Reparación (min)": a.reparacionMin,
        "Servicio (min)": a.servicioMin, "Distancia (km)": a.distanciaKm, "Km recorridos": a.kmRecorridos, Valoración: a.valoracion,
      }))), "Asistencias");
      XLSX.writeFile(wb, `estadisticas_asistencias_${new Date(p.desdeMs).toISOString().slice(0, 10)}_${new Date(p.hastaMs).toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExportando(false);
    }
  }

  const abrirCliente = (cliente: string) => {
    if (!p) return;
    navigate(`/asistencias/estadisticas/cliente?${new URLSearchParams({ nombre: cliente, rango, desde: String(p.desdeMs), hasta: String(p.hastaMs) })}`);
  };

  const op = datos?.opciones;

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <AssistSidebar active="estadisticas" />
      <main className="min-w-0 flex-1 p-4 pt-16 md:pt-4">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Mobilink Assist</div>
              <h1 className="text-2xl font-black">Estadísticas de asistencias</h1>
              {p && (
                <div className="text-sm text-slate-400">
                  {new Date(p.desdeMs).toLocaleDateString("es-ES")} – {new Date(p.hastaMs).toLocaleDateString("es-ES")} · comparado con el periodo anterior de la misma duración
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {RANGOS.map((r) => (
                <button
                  key={r.clave}
                  type="button"
                  onClick={() => setRango(r.clave)}
                  className={`min-h-[40px] rounded-lg border px-3.5 text-sm font-semibold ${rango === r.clave ? "border-sky-500 bg-sky-600 text-white" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"}`}
                >
                  {r.etiqueta}
                </button>
              ))}
              <button type="button" onClick={() => void cargar()} aria-label="Actualizar" className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-3 hover:bg-slate-800">
                <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                disabled={!datos || exportando}
                onClick={() => void exportar()}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-600/15 px-3.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-600/25 disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> {exportando ? "Exportando…" : "Exportar Excel"}
              </button>
            </div>
          </div>

          {rango === "personalizado" && (
            <div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-slate-400">Desde
                <input type="date" value={personal.desde} onChange={(e) => setPersonal((x) => ({ ...x, desde: e.target.value }))} className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold uppercase text-slate-400">Hasta
                <input type="date" value={personal.hasta} onChange={(e) => setPersonal((x) => ({ ...x, hasta: e.target.value }))} className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-100" />
              </label>
              {!p && <div className="self-center text-sm text-slate-400">Elige las dos fechas (la segunda, después de la primera).</div>}
            </div>
          )}

          <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            {FILTROS.map((f) => (
              <label key={f.clave} className="flex flex-col gap-1 text-[11px] font-bold uppercase text-slate-400">
                {f.etiqueta}
                <select
                  value={filtros[f.clave]}
                  onChange={(e) => setFiltros((x) => ({ ...x, [f.clave]: e.target.value }))}
                  className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm font-medium normal-case text-slate-100"
                >
                  <option value="">{f.todos}</option>
                  {(op?.[f.opciones] ?? []).map((o) => <option key={o} value={o}>{f.clave === "origen" ? ORIGEN[o] ?? o : o}</option>)}
                  {filtros[f.clave] && !(op?.[f.opciones] ?? []).includes(filtros[f.clave]) && <option value={filtros[f.clave]}>{filtros[f.clave]}</option>}
                </select>
              </label>
            ))}
          </div>

          {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          {!datos && !error && <div className="p-10 text-center text-slate-400">Calculando…</div>}

          {datos && (
            <>
              <CifrasClave r={datos.resumen} a={datos.anterior} objetivoMin={datos.objetivos.llegadaMin} />
              <div className="flex flex-wrap gap-4">
                <div className="min-w-0 flex-[999_1_560px]"><BarrasPorDia dias={datos.porDia} /></div>
                <div className="min-w-0 flex-[1_1_360px]"><Fases fases={datos.fases} /></div>
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="min-w-0 flex-[999_1_560px]"><MapaCalor franjas={datos.franjas} /></div>
                <div className="min-w-0 flex-[1_1_360px]"><Distancias tramos={datos.distancias} r={datos.resumen} /></div>
              </div>
              <TablaClientes filas={datos.clientes} onAbrir={abrirCliente} />
              <div className="flex flex-wrap gap-4">
                <div className="min-w-0 flex-[999_1_560px]"><TablaOperarios filas={datos.operarios} objetivoSalirMin={datos.objetivos.salirMin} /></div>
                <div className="min-w-0 flex-[1_1_360px]"><TiposAveria averias={datos.averias} /></div>
              </div>
              <ControlCalidad alertas={datos.alertas} fichas={datos.fichas ?? {}} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export const ORIGEN: Record<string, string> = { taller: "Taller / panel", central: "Central" };
