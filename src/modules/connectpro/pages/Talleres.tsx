/** Connect Pro — Talleres de la red. */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";
import type { ProviderCompany } from "../types";

type Workshop = {
  id: number; name: string; phone: string | null; latitude: number; longitude: number;
  radiusKm: number; connectStatus: string; currentScore: number;
  providerName: string | null; branchName: string | null; providerCompanyId: number | null;
};

export default function Talleres() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [rows, setRows] = useState<Workshop[]>([]);
  const [providers, setProviders] = useState<ProviderCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", providerCompanyId: "", latitude: "", longitude: "", radiusKm: "60", phone: "" });

  const load = useCallback(() => {
    boFetch<{ data: Workshop[] }>("/workshops").then((r) => setRows(r.data)).catch((e) => setError(e.message));
    boFetch<{ data: ProviderCompany[] }>("/providers").then((r) => setProviders(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const crear = async () => {
    const lat = Number(form.latitude); const lng = Number(form.longitude);
    if (!form.name.trim() || Number.isNaN(lat) || Number.isNaN(lng)) {
      setError("Nombre, latitud y longitud son obligatorios (punto decimal).");
      return;
    }
    setBusy(true);
    try {
      await boFetch("/workshops", {
        method: "POST",
        body: {
          name: form.name.trim(), latitude: lat, longitude: lng,
          radiusKm: Number(form.radiusKm) || 60, phone: form.phone || null,
          providerCompanyId: form.providerCompanyId ? Number(form.providerCompanyId) : null,
        },
      });
      setForm({ name: "", providerCompanyId: "", latitude: "", longitude: "", radiusKm: "60", phone: "" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle title="Talleres" subtitle="Talleres de la red con cobertura y capacidades para recibir asistencias." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {canEdit && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Añadir taller</h2>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Nombre del taller" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select value={form.providerCompanyId} onChange={(e) => setForm({ ...form, providerCompanyId: e.target.value })}>
              <option value="">— Empresa —</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input placeholder="Latitud" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} className="w-28" />
            <Input placeholder="Longitud" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} className="w-28" />
            <Input placeholder="Radio km" value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: e.target.value })} className="w-24" />
            <Input placeholder="Teléfono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-36" />
            <Button onClick={crear} disabled={busy}>Añadir</Button>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState message="Sin talleres en la red todavía." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Taller</Th><Th>Empresa</Th><Th>Teléfono</Th><Th>Ubicación</Th><Th>Radio</Th><Th>Estado</Th><Th>Score</Th>
            </tr></thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <Td className="font-semibold text-slate-100">{w.name}</Td>
                  <Td>{w.providerName ?? "-"}{w.branchName ? ` · ${w.branchName}` : ""}</Td>
                  <Td>{w.phone ?? "-"}</Td>
                  <Td>{w.latitude.toFixed(4)}, {w.longitude.toFixed(4)}</Td>
                  <Td>{w.radiusKm} km</Td>
                  <Td>
                    <Badge className={w.connectStatus === "active" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-400"}>
                      {w.connectStatus === "active" ? "Activo" : w.connectStatus}
                    </Badge>
                  </Td>
                  <Td>{Math.round(w.currentScore)}/100</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
