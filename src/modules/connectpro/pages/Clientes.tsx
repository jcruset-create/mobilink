/** Connect Pro — Clientes del centro de control (aseguradoras, flotas…). */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, Card, Th, Td, Badge, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";
import { fmtDateTime } from "../types";

export type Client = {
  id: number; name: string; taxId: string | null; contactEmail: string | null; contactPhone: string | null;
  defaultSlaMinutes: number | null; defaultPriority: string; notes: string | null;
  active: boolean; createdAtMs: number;
};

export default function Clientes() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [rows, setRows] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", contactEmail: "", contactPhone: "", defaultSlaMinutes: "", defaultPriority: "normal" });

  const load = useCallback(() => {
    boFetch<{ data: Client[] }>("/clients").then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const crear = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await boFetch("/clients", {
        method: "POST",
        body: { ...form, defaultSlaMinutes: form.defaultSlaMinutes ? Number(form.defaultSlaMinutes) : null },
      });
      setForm({ name: "", contactEmail: "", contactPhone: "", defaultSlaMinutes: "", defaultPriority: "normal" });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const toggle = async (c: Client) => {
    setBusy(true);
    try { await boFetch(`/clients/${c.id}`, { method: "PATCH", body: { active: !c.active } }); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle title="Clientes" subtitle="Cuentas cliente del centro de control. Su SLA y prioridad se aplican por defecto al crear asistencias." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {canEdit && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Nuevo cliente</h2>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Nombre (Aseguradora X, Flota Y…)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-64" />
            <Input placeholder="Email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            <Input placeholder="Teléfono" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="w-36" />
            <Input placeholder="SLA (min)" value={form.defaultSlaMinutes} onChange={(e) => setForm({ ...form, defaultSlaMinutes: e.target.value })} className="w-24" />
            <Select value={form.defaultPriority} onChange={(e) => setForm({ ...form, defaultPriority: e.target.value })}>
              <option value="normal">Prioridad normal</option>
              <option value="urgente">Prioridad urgente</option>
            </Select>
            <Button onClick={crear} disabled={busy || !form.name.trim()}>Crear cliente</Button>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyState message="Sin clientes todavía." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Cliente</Th><Th>Contacto</Th><Th>SLA por defecto</Th><Th>Prioridad</Th><Th>Estado</Th><Th>Alta</Th>{canEdit && <Th></Th>}
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <Td className="font-semibold text-slate-100">{c.name}</Td>
                  <Td>{[c.contactEmail, c.contactPhone].filter(Boolean).join(" · ") || "-"}</Td>
                  <Td>{c.defaultSlaMinutes ? `${c.defaultSlaMinutes} min` : "—"}</Td>
                  <Td>{c.defaultPriority === "urgente" ? <Badge className="border-red-500/40 bg-red-500/10 text-red-300">Urgente</Badge> : "Normal"}</Td>
                  <Td>
                    <Badge className={c.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-500"}>
                      {c.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </Td>
                  <Td>{fmtDateTime(c.createdAtMs)}</Td>
                  {canEdit && (
                    <Td><Button variant="ghost" disabled={busy} onClick={() => toggle(c)}>{c.active ? "Desactivar" : "Activar"}</Button></Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
