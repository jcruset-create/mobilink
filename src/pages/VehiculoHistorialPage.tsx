import { useEffect, useState } from "react";
import { fetchVehiculoHistorial } from "../modules/roadsideAssistanceApi";

function fmt(ms?: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const ASIST_BADGE: Record<string, string> = {
  llegada_taller: "bg-emerald-100 text-emerald-800",
  cancelada: "bg-red-100 text-red-700",
  redirigida: "bg-orange-100 text-orange-800",
};
const TRAB_BADGE: Record<string, string> = {
  finalizado: "bg-emerald-100 text-emerald-800",
  no_realizado: "bg-red-100 text-red-700",
  en_proceso: "bg-blue-100 text-blue-800",
};

export default function VehiculoHistorialPage() {
  const [plate, setPlate] = useState("");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(p?: string) {
    const q = (p ?? plate).trim();
    if (!q) return;
    setLoading(true); setError(null);
    try {
      setData(await fetchVehiculoHistorial(q));
    } catch (e: any) {
      setError(e.message); setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("plate");
    if (p) { setPlate(p); search(p); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <header className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-black">🔎 Historial del vehículo</h1>
          <a href="/" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">← Volver</a>
        </header>

        <div className="mb-4 flex gap-2">
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Matrícula (ej. 7890JKL)"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase outline-none focus:ring-2 focus:ring-slate-300"
          />
          <button onClick={() => search()} className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-black text-white">Buscar</button>
        </div>

        {loading && <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Buscando…</div>}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        {data && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-2xl font-black">{data.plate}</div>
              <div className="mt-1 text-sm text-slate-600">
                {data.resumen.totalAsistencias} asistencias · {data.resumen.totalTrabajosOtf} trabajos OTF
                {data.resumen.clientes?.length ? ` · ${data.resumen.clientes.join(", ")}` : ""}
              </div>
              <div className="mt-1 text-xs text-slate-400">Última intervención: {fmt(data.resumen.ultimaMs)}</div>
              {data.alerta && (
                <div className="mt-2 inline-block rounded-lg bg-amber-50 px-3 py-1 text-sm font-bold text-amber-800 border border-amber-200">{data.alerta}</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-black uppercase text-slate-500">Asistencias</h2>
              {data.asistencias.length === 0 ? <div className="text-sm text-slate-400">Sin asistencias</div> : (
                <div className="space-y-2">
                  {data.asistencias.map((a: any) => (
                    <div key={a.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold">{fmt(a.createdAtMs)} · {a.customerName || "—"}</div>
                        <div className="text-xs text-slate-600">{a.descripcionAveria || a.notes || a.address || ""}</div>
                        {a.assignedTechName && <div className="text-xs text-slate-400">{a.assignedTechName}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ASIST_BADGE[a.status] ?? "bg-slate-100 text-slate-700"}`}>{a.status}</span>
                        <button
                          onClick={() => {
                            const token = localStorage.getItem("sea-admin-token") ?? "";
                            window.open(`/api/roadside-assistances/${a.id}/report.pdf?token=${encodeURIComponent(token)}`, "_blank");
                          }}
                          className="rounded border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-white"
                        >PDF</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-black uppercase text-slate-500">Trabajos de flota (OTF)</h2>
              {data.trabajosOtf.length === 0 ? <div className="text-sm text-slate-400">Sin trabajos OTF</div> : (
                <div className="space-y-2">
                  {data.trabajosOtf.map((t: any) => (
                    <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold">{fmt(t.fecha)} · {t.clientName || "—"}{t.baseName ? ` (${t.baseName})` : ""}</div>
                        <div className="text-xs text-slate-600">{t.trabajo}</div>
                        {t.origen === "tecnico_campo" && <div className="text-[11px] font-bold text-orange-700">Añadido en campo</div>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${TRAB_BADGE[t.status] ?? "bg-slate-100 text-slate-700"}`}>{t.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
