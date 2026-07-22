/** Connect Pro — Partners e integraciones (partners API + generación de keys). */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../administracion/services/supabase";
import { PageTitle, Card, Th, Td, Badge, Input, Button, ErrorBanner } from "../components/ui";
import { fmtDateTime } from "../types";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

type Partner = {
  id: number; name: string; contactEmail: string | null; status: string;
  assignmentMode: string; createdAtMs: number;
};

/** Los partners se gestionan por la API admin existente (token de sesión + respaldo clásico). */
async function adminFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch { /* respaldo clásico */ }
  const classic = localStorage.getItem("sea-admin-token");
  if (classic) headers["x-admin-token"] = classic;
  const res = await fetch(`${API_BASE}/api/connect/admin${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || json?.error || `Error HTTP ${res.status}`);
  return json as T;
}

export default function Integraciones() {
  const [rows, setRows] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", contactEmail: "" });
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<{ data: Partner[] }>("/partners").then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const crear = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await adminFetch("/partners", { method: "POST", body: form });
      setForm({ name: "", contactEmail: "" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const generarKey = async (partnerId: number) => {
    setBusy(true);
    try {
      const r = await adminFetch<{ api_key: string }>(`/partners/${partnerId}/api-keys`, { method: "POST", body: { name: "clave desde backoffice" } });
      setNewKey(r.api_key);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle title="Partners e integraciones" subtitle="Plataformas externas que envían asistencias por la API de Connect Pro." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Nuevo partner</h2>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Nombre (p. ej. Aseguradora X)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Email de contacto" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          <Button onClick={crear} disabled={busy || !form.name.trim()}>Crear partner</Button>
        </div>
      </Card>

      {newKey && (
        <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="mb-1 font-semibold text-emerald-300">API key generada — cópiala ahora, no se volverá a mostrar:</p>
          <code className="block select-all break-all rounded bg-slate-900 p-2 text-emerald-300">{newKey}</code>
          <button onClick={() => setNewKey(null)} className="mt-2 text-xs text-emerald-400 underline">Cerrar</button>
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-slate-700">
            <Th>Partner</Th><Th>Email</Th><Th>Asignación</Th><Th>Estado</Th><Th>Alta</Th><Th></Th>
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <Td className="font-semibold text-slate-100">{p.name}</Td>
                <Td>{p.contactEmail ?? "-"}</Td>
                <Td>{p.assignmentMode === "auto" ? "Automática" : "Manual"}</Td>
                <Td>
                  <Badge className={p.status === "active" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-red-500/40 bg-red-500/10 text-red-300"}>
                    {p.status === "active" ? "Activo" : p.status}
                  </Badge>
                </Td>
                <Td>{fmtDateTime(p.createdAtMs)}</Td>
                <Td><Button variant="ghost" onClick={() => generarKey(p.id)} disabled={busy}>Generar API key</Button></Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td className="py-8 text-center">Sin partners todavía.</Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
