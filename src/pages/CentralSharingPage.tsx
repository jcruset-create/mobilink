/**
 * Mobilink Assist — pantalla "Central": el taller decide qué furgonetas y
 * qué técnicos son visibles para Central (la red de asistencia).
 * Por defecto nada se comparte hasta que se active aquí.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Truck, User, Wifi } from "lucide-react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Vehicle = {
  id: number;
  name: string;
  plate: string | null;
  base: string | null;
  active: boolean;
  compartidoCentral: boolean;
};
type Tech = {
  name: string;
  status: string;
  blocked: boolean;
  roadsideCapable: boolean;
  compartidoCentral: boolean;
  currentRoadsideAssistanceId: number | null;
};

export default function CentralSharingPage() {
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/central-sharing`, { headers: getAdminHeaders() as HeadersInit });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error cargando");
      setVehicles(data.vehicles ?? []);
      setTechs(data.techs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggleVehicle(v: Vehicle) {
    setBusy(`v${v.id}`);
    setVehicles((prev) => prev.map((x) => (x.id === v.id ? { ...x, compartidoCentral: !x.compartidoCentral } : x)));
    try {
      await fetch(`${API_BASE}/api/central-sharing/vehicle/${v.id}`, {
        method: "PATCH",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ compartido: !v.compartidoCentral }),
      });
    } catch { void load(); } finally { setBusy(null); }
  }

  async function toggleTech(t: Tech) {
    setBusy(`t${t.name}`);
    setTechs((prev) => prev.map((x) => (x.name === t.name ? { ...x, compartidoCentral: !x.compartidoCentral } : x)));
    try {
      await fetch(`${API_BASE}/api/central-sharing/tech/${encodeURIComponent(t.name)}`, {
        method: "PATCH",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ compartido: !t.compartidoCentral }),
      });
    } catch { void load(); } finally { setBusy(null); }
  }

  async function bulk(tipo: "vehicles" | "techs", compartido: boolean) {
    setBusy(`bulk-${tipo}`);
    try {
      await fetch(`${API_BASE}/api/central-sharing/bulk`, {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ tipo, compartido }),
      });
      await load();
    } finally { setBusy(null); }
  }

  const nShared = useMemo(
    () => ({
      v: vehicles.filter((v) => v.compartidoCentral).length,
      t: techs.filter((t) => t.compartidoCentral).length,
    }),
    [vehicles, techs]
  );

  function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-slate-600"} disabled:opacity-50`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/asistencias")} className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 hover:bg-slate-700">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-indigo-400" />
            <div>
              <h1 className="text-base font-bold">Compartir con Central</h1>
              <div className="text-xs text-slate-400">{nShared.v} furgonetas · {nShared.t} técnicos compartidos</div>
            </div>
          </div>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium hover:bg-slate-700">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4">
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">{error}</div>}
        <p className="text-sm text-slate-400">
          Activa qué furgonetas y técnicos de tu taller son visibles para Central. Lo que dejes desactivado no aparecerá en la red.
        </p>

        {/* Furgonetas */}
        <section className="rounded-xl border border-slate-700 bg-slate-800/60">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300">
              <Truck className="h-4 w-4" /> Furgonetas
            </div>
            <div className="flex gap-2">
              <button onClick={() => void bulk("vehicles", true)} disabled={busy === "bulk-vehicles"} className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/25">Compartir todas</button>
              <button onClick={() => void bulk("vehicles", false)} disabled={busy === "bulk-vehicles"} className="rounded-lg border border-slate-600 bg-slate-700/40 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-700">Ocultar todas</button>
            </div>
          </div>
          <div className="divide-y divide-slate-700/60">
            {loading ? (
              <div className="px-4 py-8 text-center text-slate-500">Cargando…</div>
            ) : vehicles.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500">Sin furgonetas.</div>
            ) : vehicles.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-bold">{v.name} {v.plate && <span className="text-slate-400">· {v.plate}</span>}</div>
                  <div className="text-xs text-slate-500">{v.base || "Sin base"}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${v.compartidoCentral ? "bg-indigo-500/20 text-indigo-200" : "bg-slate-700 text-slate-400"}`}>
                    {v.compartidoCentral ? "En Central" : "Solo taller"}
                  </span>
                  <Toggle on={v.compartidoCentral} disabled={busy === `v${v.id}`} onClick={() => void toggleVehicle(v)} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Técnicos */}
        <section className="rounded-xl border border-slate-700 bg-slate-800/60">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-300">
              <User className="h-4 w-4" /> Técnicos
            </div>
            <div className="flex gap-2">
              <button onClick={() => void bulk("techs", true)} disabled={busy === "bulk-techs"} className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/25">Compartir todos</button>
              <button onClick={() => void bulk("techs", false)} disabled={busy === "bulk-techs"} className="rounded-lg border border-slate-600 bg-slate-700/40 px-2.5 py-1 text-[11px] font-bold text-slate-300 hover:bg-slate-700">Ocultar todos</button>
            </div>
          </div>
          <div className="divide-y divide-slate-700/60">
            {loading ? (
              <div className="px-4 py-8 text-center text-slate-500">Cargando…</div>
            ) : techs.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500">Sin técnicos.</div>
            ) : techs.map((t) => (
              <div key={t.name} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-bold">{t.name}</div>
                  <div className="text-xs text-slate-500">
                    {t.blocked ? "Bloqueado" : t.currentRoadsideAssistanceId ? "En asistencia" : "Libre"}
                    {t.roadsideCapable ? " · carretera" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${t.compartidoCentral ? "bg-indigo-500/20 text-indigo-200" : "bg-slate-700 text-slate-400"}`}>
                    {t.compartidoCentral ? "En Central" : "Solo taller"}
                  </span>
                  <Toggle on={t.compartidoCentral} disabled={busy === `t${t.name}`} onClick={() => void toggleTech(t)} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
