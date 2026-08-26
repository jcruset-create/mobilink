/**
 * Mobilink Assist — Historial de Órdenes de Trabajo de Flota (OTF).
 * Tabla al estilo del historial de asistencias: búsqueda por texto, filtro
 * por estado y por operario, con acceso a la ficha y al informe PDF.
 */

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import AssistSidebar from "../components/AssistSidebar";
import { fetchOtfList } from "../modules/roadsideAssistanceApi";

const STATUS_OTF: Record<string, string> = {
  planificada: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  en_curso: "border-blue-500/40 bg-blue-500/15 text-blue-300",
  finalizada: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  cancelada: "border-red-500/40 bg-red-500/15 text-red-300",
};

const STATUS_LABELS: Record<string, string> = {
  planificada: "Planificada",
  en_curso: "En curso",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};

function formatFecha(ms: number | null | undefined) {
  if (!ms) return "—";
  const d = new Date(ms);
  return {
    dia: d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" }),
    hora: d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
  };
}

export default function OtfHistorialPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [operario, setOperario] = useState("");

  async function load() {
    setLoading(true);
    try {
      setList(await fetchOtfList());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const operarios = useMemo(
    () => Array.from(new Set(list.map((o) => o.assignedTechName).filter(Boolean))).sort() as string[],
    [list]
  );

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return list.filter((o) => {
      if (estado && o.status !== estado) return false;
      if (operario && o.assignedTechName !== operario) return false;
      if (t) {
        const campos = [o.clientName, o.baseName, o.direccion, o.assignedTechName, o.assignedVehicleName]
          .filter(Boolean)
          .map((s: any) => String(s).toLowerCase());
        if (!campos.some((s: string) => s.includes(t))) return false;
      }
      return true;
    });
  }, [list, q, estado, operario]);

  function abrirPdf(id: number) {
    const token = localStorage.getItem("sea-admin-token") ?? "";
    window.open(`/api/otf/${id}/report.pdf?token=${encodeURIComponent(token)}`, "_blank");
  }

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100">
      <AssistSidebar active="otf" />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 pl-14 backdrop-blur md:pl-4">
          <div className="flex items-center gap-3">
            <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-9 md:h-12" />
            <div>
              <h1 className="text-sm font-bold md:text-base">Historial de OTF</h1>
              <div className="text-xs text-slate-400">{visibles.length} de {list.length} órdenes</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/otf" className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500">← Volver a OTF</a>
            <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700">
              <RefreshCw className="h-4 w-4" /> Actualizar
            </button>
          </div>
        </header>

        <main className="w-full space-y-3 p-4">
          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar cliente, base, operario, furgoneta…"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/40"
              />
            </div>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Todos los estados</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select
              value={operario}
              onChange={(e) => setOperario(e.target.value)}
              className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Todos los operarios</option>
              {operarios.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Tabla */}
          <section className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-800/60">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/60 text-[11px] font-black uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Base</th>
                  <th className="px-4 py-3">Operario</th>
                  <th className="px-4 py-3">Trabajos</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Cargando…</td></tr>
                ) : visibles.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Sin resultados.</td></tr>
                ) : (
                  visibles.map((o) => {
                    const f = formatFecha(o.createdAtMs) as any;
                    return (
                      <tr key={o.id} className="hover:bg-slate-800/80">
                        <td className="px-4 py-3">
                          <div className="text-xs font-bold text-slate-200">{f.dia}</div>
                          <div className="text-[10px] text-slate-500">{f.hora}</div>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-100">{o.clientName || "—"}</td>
                        <td className="px-4 py-3 text-slate-300">{o.baseName || o.direccion || "—"}</td>
                        <td className="px-4 py-3 text-slate-300">{o.assignedTechName || "—"}</td>
                        <td className="px-4 py-3 font-bold text-orange-400">
                          {o.progreso?.hechos ?? 0} / {o.progreso?.total ?? 0}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_OTF[o.status] ?? ""}`}>
                            {STATUS_LABELS[o.status] ?? o.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <a
                              href={`/otf?id=${o.id}`}
                              className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700"
                            >
                              Ver
                            </a>
                            <button
                              onClick={() => abrirPdf(o.id)}
                              className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700"
                            >
                              PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>
        </main>
      </div>
    </div>
  );
}
