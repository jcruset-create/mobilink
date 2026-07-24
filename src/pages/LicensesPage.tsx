/**
 * Mobilink SW Licencias — panel de administración de licencias (/licencias).
 *
 * Listado con filtros, búsqueda, estado visual y días restantes; acciones de
 * activar, renovar, suspender/reanudar y cancelar; historial completo y
 * gráficas básicas. Usa la API /api/licenses con el token de administrador.
 * Estilo visual unificado con Mobilink Assist (tema oscuro slate).
 */

import { apiFetch } from "../modules/apiFetch";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../modules/administracion/services/supabase";
import logoLicencias from "../assets/logo-licencias.png";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

type License = {
  id: number;
  uuid: string;
  customerName: string;
  companyName: string;
  plan: string;
  status: string;
  activatedAtMs: number | null;
  expiresAtMs: number | null;
  daysLeft: number | null;
  graceDays: number;
  maxUsers: number;
  maxDevices: number;
  aiMonthlyLimit: number;
  modules: string[];
  activationKey: string;
  notes: string | null;
  blocked: boolean;
  createdAtMs: number;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  active: "Activa",
  expiring: "Próx. vencimiento",
  grace_period: "Periodo de gracia",
  expired: "Caducada",
  suspended: "Suspendida",
  cancelled: "Cancelada",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  expiring: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  grace_period: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  expired: "border-red-500/40 bg-red-500/10 text-red-300",
  suspended: "border-slate-600 bg-slate-800 text-slate-300",
  cancelled: "border-red-500/50 bg-red-500/20 text-red-200",
};

function fmtDate(ms: number | null) {
  if (!ms) return "-";
  return new Date(ms).toLocaleDateString("es-ES");
}

/**
 * Cabeceras de autenticación: token de sesión de Supabase (Bearer), igual que
 * el resto de módulos del hub. Mantiene el token de admin clásico como respaldo
 * para quien entre desde el panel de taller.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* sin sesión Supabase: se usa el respaldo clásico */
  }
  const classic = localStorage.getItem("sea-admin-token");
  if (classic) headers["x-admin-token"] = classic;
  return headers;
}

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [historyFor, setHistoryFor] = useState<License | null>(null);
  const [history, setHistory] = useState<any | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (query.trim()) params.set("q", query.trim());
      const res = await apiFetch(`${API_BASE}/api/licenses?${params}`, { headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error cargando licencias");
      setLicenses(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando licencias");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(lic: License, path: string, body?: Record<string, unknown>) {
    setBusyId(lic.id);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/licenses/${lic.id}/${path}`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Error en ${path}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Error en ${path}`);
    } finally {
      setBusyId(null);
    }
  }

  async function openHistory(lic: License) {
    setHistoryFor(lic);
    setHistory(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/licenses/${lic.id}/history`, { headers: await authHeaders() });
      const data = await res.json();
      if (res.ok) setHistory(data);
    } catch {
      /* historial no disponible */
    }
  }

  // Gráficas básicas: distribución por estado y vencimientos por año
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of licenses) counts[l.status] = (counts[l.status] ?? 0) + 1;
    return counts;
  }, [licenses]);

  const expiryByYear = useMemo(() => {
    const byYear: Record<string, number> = {};
    for (const l of licenses) {
      if (l.expiresAtMs) {
        const y = String(new Date(l.expiresAtMs).getFullYear());
        byYear[y] = (byYear[y] ?? 0) + 1;
      }
    }
    return Object.entries(byYear).sort(([a], [b]) => a.localeCompare(b));
  }, [licenses]);

  const maxStatusCount = Math.max(1, ...Object.values(statusCounts));

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-2.5 backdrop-blur md:px-6">
        <img src={logoLicencias} alt="Mobilink SW Licencias" className="h-12 w-auto md:h-14" />
        <div className="text-right">
          <div className="text-xs text-slate-400">Administración</div>
          <div className="text-lg font-black text-white">Licencias</div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] space-y-5 px-4 py-6">
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, empresa, UUID o plan…"
            className="w-72 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-slate-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
          >
            Actualizar
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400"
          >
            + Nueva licencia
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-400">Por estado</div>
            <div className="space-y-2">
              {Object.entries(STATUS_LABELS).map(([k, label]) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <span className="w-32 text-slate-400">{label}</span>
                  <div className="h-3 flex-1 rounded bg-slate-800">
                    <div
                      className="h-3 rounded bg-amber-500"
                      style={{ width: `${((statusCounts[k] ?? 0) / maxStatusCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-bold text-slate-200">{statusCounts[k] ?? 0}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="mb-3 text-xs font-black uppercase tracking-wide text-slate-400">Vencimientos por año</div>
            {expiryByYear.length === 0 ? (
              <div className="text-sm text-slate-500">Sin licencias con caducidad.</div>
            ) : (
              <div className="flex h-28 items-end gap-3">
                {expiryByYear.map(([year, count]) => (
                  <div key={year} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-blue-500"
                      style={{ height: `${(count / Math.max(...expiryByYear.map(([, c]) => c))) * 88}px` }}
                    />
                    <span className="text-[10px] text-slate-500">{year}</span>
                    <span className="text-xs font-bold text-slate-200">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Activación</th>
                <th className="px-4 py-3">Caducidad</th>
                <th className="px-4 py-3">Días rest.</th>
                <th className="px-4 py-3">Límites</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Cargando…</td></tr>
              ) : licenses.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Sin licencias.</td></tr>
              ) : (
                licenses.map((l) => (
                  <tr key={l.id} className="border-b border-slate-800/60 align-top">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-100">{l.customerName}</div>
                      <div className="text-xs text-slate-400">{l.companyName}</div>
                      <div className="mt-1 font-mono text-[10px] text-slate-500">{l.uuid}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-200">{l.plan}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_STYLES[l.status] ?? ""}`}>
                        {STATUS_LABELS[l.status] ?? l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{fmtDate(l.activatedAtMs)}</td>
                    <td className="px-4 py-3 text-slate-300">{fmtDate(l.expiresAtMs)}</td>
                    <td className="px-4 py-3">
                      {l.daysLeft == null ? "-" : (
                        <span className={l.daysLeft <= 30 ? "font-bold text-red-400" : l.daysLeft <= 180 ? "font-bold text-orange-400" : "text-slate-300"}>
                          {l.daysLeft}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {l.maxUsers} usu. · {l.maxDevices} disp. · {l.aiMonthlyLimit} IA/mes
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {l.status === "pending" && (
                          <button type="button" disabled={busyId === l.id} onClick={() => void action(l, "activate")}
                            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20">
                            Activar
                          </button>
                        )}
                        {!["cancelled", "pending"].includes(l.status) && (
                          <button type="button" disabled={busyId === l.id} onClick={() => void action(l, "renew")}
                            className="rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-xs font-bold text-blue-300 hover:bg-blue-500/20">
                            Renovar
                          </button>
                        )}
                        {l.status === "suspended" ? (
                          <button type="button" disabled={busyId === l.id} onClick={() => void action(l, "resume")}
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700">
                            Reanudar
                          </button>
                        ) : !["cancelled", "pending"].includes(l.status) && (
                          <button type="button" disabled={busyId === l.id} onClick={() => void action(l, "suspend")}
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700">
                            Suspender
                          </button>
                        )}
                        {l.status !== "cancelled" && (
                          <button type="button" disabled={busyId === l.id}
                            onClick={() => { if (window.confirm(`¿Cancelar la licencia de ${l.customerName}? Es irreversible.`)) void action(l, "cancel"); }}
                            className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-bold text-red-300 hover:bg-red-500/20">
                            Cancelar
                          </button>
                        )}
                        <button type="button" onClick={() => void openHistory(l)}
                          className="rounded border border-slate-700 px-2 py-1 text-xs font-bold text-slate-400 hover:bg-slate-800">
                          Historial
                        </button>
                      </div>
                      <div className="mt-1 text-right font-mono text-[10px] text-slate-500">{l.activationKey}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </main>

      {showCreate && <CreateLicenseModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />}

      {historyFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setHistoryFor(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-5 text-slate-100" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-black">Historial · {historyFor.customerName}</div>
              <button type="button" onClick={() => setHistoryFor(null)} className="text-slate-500 hover:text-slate-200">✕</button>
            </div>
            {!history ? (
              <div className="py-6 text-center text-slate-500">Cargando…</div>
            ) : (
              <div className="space-y-4 text-sm">
                {history.renewals.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-black uppercase text-slate-400">Renovaciones</div>
                    {history.renewals.map((r: any) => (
                      <div key={r.id} className="border-b border-slate-800 py-1 text-xs text-slate-300">
                        {fmtDate(r.renewedAtMs)} · {fmtDate(r.previousExpiresAtMs)} → <b>{fmtDate(r.newExpiresAtMs)}</b>
                        {r.renewedBy ? ` · ${r.renewedBy}` : ""}{r.note ? ` · ${r.note}` : ""}
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <div className="mb-1 text-xs font-black uppercase text-slate-400">Auditoría</div>
                  {history.history.map((h: any) => (
                    <div key={h.id} className="border-b border-slate-800 py-1 text-xs text-slate-300">
                      {new Date(h.createdAtMs).toLocaleString("es-ES")} · <b>{h.action}</b>
                      {h.detail ? ` · ${h.detail}` : ""}{h.performedBy ? ` · ${h.performedBy}` : ""}
                    </div>
                  ))}
                </div>
                {history.notifications.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-black uppercase text-slate-400">Avisos enviados</div>
                    {history.notifications.map((n: any) => (
                      <div key={n.id} className="border-b border-slate-800 py-1 text-xs text-slate-300">
                        {new Date(n.sentAtMs).toLocaleString("es-ES")} · aviso {n.daysBefore} días antes del vencimiento
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateLicenseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    customerName: "",
    companyName: "",
    plan: "standard",
    maxUsers: "5",
    maxDevices: "5",
    aiMonthlyLimit: "1000",
    graceDays: "30",
    modules: "asistencias",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!form.customerName.trim()) { setError("El cliente es obligatorio"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/licenses`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          customerName: form.customerName.trim(),
          companyName: form.companyName.trim(),
          plan: form.plan.trim(),
          maxUsers: Number(form.maxUsers),
          maxDevices: Number(form.maxDevices),
          aiMonthlyLimit: Number(form.aiMonthlyLimit),
          graceDays: Number(form.graceDays),
          modules: form.modules.split(",").map((m) => m.trim()).filter(Boolean),
          notes: form.notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error creando licencia");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando licencia");
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, key: keyof typeof form, type = "text") => (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-400">{label}</span>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-slate-500"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-slate-900 p-5 text-slate-100" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 font-black">Nueva licencia</div>
        {error && <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          {field("Cliente *", "customerName")}
          {field("Empresa", "companyName")}
          {field("Plan", "plan")}
          {field("Módulos (coma)", "modules")}
          {field("Usuarios", "maxUsers", "number")}
          {field("Dispositivos", "maxDevices", "number")}
          {field("Límite IA/mes", "aiMonthlyLimit", "number")}
          {field("Días de gracia", "graceDays", "number")}
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-bold text-slate-400">Notas</span>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            rows={2}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-slate-500"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800">
            Cerrar
          </button>
          <button type="button" disabled={saving} onClick={() => void submit()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
            {saving ? "Creando…" : "Crear licencia"}
          </button>
        </div>
      </div>
    </div>
  );
}
