/**
 * Mobilink Assist Connect Pro — panel de administración (/connect).
 *
 * Gestión de la plataforma de integración B2B: asistencias entrantes de
 * partners externos, partners y sus API keys, y talleres de la red Connect.
 * Usa la API /api/connect/admin con la misma autenticación que Licencias
 * (sesión Supabase + token de admin clásico como respaldo).
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../modules/administracion/services/supabase";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

type Partner = {
  id: number;
  uuid: string;
  name: string;
  contactEmail: string | null;
  status: string;
  assignmentMode: string;
  createdAtMs: number;
};

type Workshop = {
  id: number;
  coreWorkshopId: string | null;
  name: string;
  phone: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
  connectStatus: string;
  currentScore: number;
};

type Assistance = {
  id: number;
  uuid: string;
  partnerName: string;
  workshopName: string | null;
  externalReference: string | null;
  status: string;
  priority: string;
  serviceType: string;
  address: string;
  customerName: string;
  assignmentExplanation: string | null;
  createdAtMs: number;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  searching: "Buscando taller",
  assigned: "Asignada",
  technician_assigned: "Técnico asignado",
  en_route: "En ruta",
  arrived: "En el punto",
  in_progress: "En trabajo",
  finished: "Finalizada",
  cancelled: "Cancelada",
  no_coverage: "Sin cobertura",
  assignment_failed: "Fallo asignación",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  searching: "border-sky-200 bg-sky-50 text-sky-800",
  assigned: "border-blue-200 bg-blue-50 text-blue-800",
  technician_assigned: "border-indigo-200 bg-indigo-50 text-indigo-800",
  en_route: "border-violet-200 bg-violet-50 text-violet-800",
  arrived: "border-cyan-200 bg-cyan-50 text-cyan-800",
  in_progress: "border-teal-200 bg-teal-50 text-teal-800",
  finished: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cancelled: "border-red-200 bg-red-50 text-red-800",
  no_coverage: "border-orange-300 bg-orange-50 text-orange-800",
  assignment_failed: "border-red-300 bg-red-100 text-red-900",
};

function fmtDateTime(ms: number) {
  return new Date(Number(ms)).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

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

async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_BASE}/api/connect/admin${path}`, {
    method: options?.method ?? "GET",
    headers: await authHeaders(),
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || json?.error || `Error HTTP ${res.status}`);
  return json as T;
}

type Tab = "asistencias" | "partners" | "talleres";

export default function ConnectPage() {
  const [tab, setTab] = useState<Tab>("asistencias");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">🔗 Connect Pro</h1>
            <p className="text-sm text-slate-500">
              Plataforma de integración B2B: asistencias de partners externos hacia la red de talleres.
            </p>
          </div>
          <Link to="/sea" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            ← Volver al hub
          </Link>
        </div>

        <div className="mb-4 flex gap-2">
          {(
            [
              ["asistencias", "Asistencias"],
              ["partners", "Partners y API keys"],
              ["talleres", "Talleres de la red"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setError(null); }}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                tab === id ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>
        )}

        {tab === "asistencias" && <AssistancesTab onError={setError} />}
        {tab === "partners" && <PartnersTab onError={setError} />}
        {tab === "talleres" && <WorkshopsTab onError={setError} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asistencias
// ---------------------------------------------------------------------------

function AssistancesTab({ onError }: { onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<Assistance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api<{ data: Assistance[] }>("/assistances?limit=100");
      setRows(data);
      onError(null);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        Todavía no ha entrado ninguna asistencia por Connect Pro.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Partner</th>
            <th className="px-3 py-2">Ref. externa</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Dirección</th>
            <th className="px-3 py-2">Servicio</th>
            <th className="px-3 py-2">Taller</th>
            <th className="px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 align-top hover:bg-slate-50" title={a.assignmentExplanation ?? undefined}>
              <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtDateTime(a.createdAtMs)}</td>
              <td className="px-3 py-2 font-medium text-slate-800">{a.partnerName}</td>
              <td className="px-3 py-2 text-slate-600">{a.externalReference ?? "-"}</td>
              <td className="px-3 py-2 text-slate-700">
                {a.customerName}
                {a.priority === "urgente" && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700">urgente</span>}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2 text-slate-600">{a.address}</td>
              <td className="px-3 py-2 text-slate-600">{a.serviceType}</td>
              <td className="px-3 py-2 text-slate-600">{a.workshopName ?? "-"}</td>
              <td className="px-3 py-2">
                <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[a.status] ?? "border-slate-200 bg-slate-50 text-slate-600"}`}>
                  {STATUS_LABELS[a.status] ?? a.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partners y API keys
// ---------------------------------------------------------------------------

function PartnersTab({ onError }: { onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<Partner[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [newKey, setNewKey] = useState<{ partnerId: number; key: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api<{ data: Partner[] }>("/partners");
      setRows(data);
      onError(null);
    } catch (e: any) {
      onError(e.message);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const crear = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api("/partners", { method: "POST", body: { name: name.trim(), contactEmail: email.trim() || null } });
      setName(""); setEmail("");
      await load();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const generarKey = async (partnerId: number) => {
    setBusy(true);
    try {
      const r = await api<{ api_key: string }>(`/partners/${partnerId}/api-keys`, { method: "POST", body: { name: "clave generada desde panel" } });
      setNewKey({ partnerId, key: r.api_key });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Nuevo partner</h2>
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (p. ej. Aseguradora X)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email de contacto (opcional)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button onClick={crear} disabled={busy || !name.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Crear partner
          </button>
        </div>
      </div>

      {newKey && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
          <p className="mb-1 font-semibold text-emerald-900">API key generada — cópiala ahora, no se volverá a mostrar:</p>
          <code className="block select-all break-all rounded bg-white p-2 text-emerald-800">{newKey.key}</code>
          <button onClick={() => setNewKey(null)} className="mt-2 text-xs text-emerald-700 underline">Cerrar</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="px-3 py-2">Partner</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Modo asignación</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Alta</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                <td className="px-3 py-2 text-slate-600">{p.contactEmail ?? "-"}</td>
                <td className="px-3 py-2 text-slate-600">{p.assignmentMode === "auto" ? "Automática" : "Manual"}</td>
                <td className="px-3 py-2 text-slate-600">{p.status === "active" ? "Activo" : p.status}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtDateTime(p.createdAtMs)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => generarKey(p.id)} disabled={busy}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                    Generar API key
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Sin partners todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Talleres de la red
// ---------------------------------------------------------------------------

function WorkshopsTab({ onError }: { onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<Workshop[]>([]);
  const [form, setForm] = useState({ name: "", latitude: "", longitude: "", radiusKm: "60", phone: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api<{ data: Workshop[] }>("/workshops");
      setRows(data);
      onError(null);
    } catch (e: any) {
      onError(e.message);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const crear = async () => {
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.name.trim() || Number.isNaN(lat) || Number.isNaN(lng)) {
      onError("Nombre, latitud y longitud son obligatorios (usa punto decimal).");
      return;
    }
    setBusy(true);
    try {
      await api("/workshops", {
        method: "POST",
        body: { name: form.name.trim(), latitude: lat, longitude: lng, radiusKm: Number(form.radiusKm) || 60, phone: form.phone.trim() || null },
      });
      setForm({ name: "", latitude: "", longitude: "", radiusKm: "60", phone: "" });
      await load();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Añadir taller a la red Connect</h2>
        <div className="flex flex-wrap gap-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del taller"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="Latitud (41.1189)"
            className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="Longitud (1.2445)"
            className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: e.target.value })} placeholder="Radio km"
            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Teléfono (opcional)"
            className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button onClick={crear} disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Añadir taller
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="px-3 py-2">Taller</th>
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Ubicación</th>
              <th className="px-3 py-2">Radio</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-800">{w.name}</td>
                <td className="px-3 py-2 text-slate-600">{w.phone ?? "-"}</td>
                <td className="px-3 py-2 text-slate-600">{w.latitude.toFixed(4)}, {w.longitude.toFixed(4)}</td>
                <td className="px-3 py-2 text-slate-600">{w.radiusKm} km</td>
                <td className="px-3 py-2 text-slate-600">{w.connectStatus === "active" ? "Activo" : w.connectStatus}</td>
                <td className="px-3 py-2 text-slate-700">{Math.round(w.currentScore)}/100</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Sin talleres en la red todavía.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
